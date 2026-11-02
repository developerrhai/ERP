// Generic record rules (docs/phase3-4 B3): who sees which rows (unit from the context, data scope
// OWN / DEPARTMENT / ALL), create with a gap-free code and an Idempotency-Key, If-Match edits,
// soft delete + undo, the allowed status changes, bulk delete with a per-id report, and the audited
// .xlsx export. A financial year that is CLOSED blocks every write (409 PERIOD_CLOSED).
import { createHash, createHmac } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { AuthContext, RequestMeta } from '../../core/auth/auth-context';
import { recordAudit } from '../../core/audit/audit-service';
import type { RequestContext } from '../../core/context/resolve-context';
import { env } from '../../config/env';
import { prisma } from '../../core/db/prisma';
import type { Db } from '../../core/db/prisma';
import { AppError, Errors } from '../../core/http/errors';
import { accessUserOf, scopeFor } from '../../core/rbac/access';
import { hasMinRole } from '../../core/rbac/role-rules';
import {
  applyAadhaar,
  assertMaskedUnchanged,
  deriveColumns,
  publicData,
  validateRecordInput,
} from '../../engine/record-input';
import { assertDateOrder } from '../../engine/date-order';
import { buildPageSchema, codePrefix } from '../../engine/field-schema';
import type { PageSchema } from '../../engine/field-schema';
import { kindOf } from '../../engine/kinds';
import { auditLogRepository } from '../audit-logs/repository';
import { toAuditLogDto } from '../audit-logs/service';
import { buildWorkbook } from './export';
import { recordRepository as repo, orderSql } from './repository';
import type { RecordRow, Visibility } from './repository';
import { MAX_EXPORT_ROWS } from './schemas';
import type { AuditQuery, ExportRecordsQuery, ListRecordsQuery } from './schemas';

export interface Caller {
  auth: AuthContext;
  ctx: RequestContext;
  meta: RequestMeta;
}

export interface RecordDto {
  id: string;
  code: string;
  status: string;
  unitId: string;
  fyId: string;
  department: string;
  data: Record<string, unknown>;
  version: number;
  amount: number | null;
  createdAt: string;
  createdBy: { id: string; name: string };
  updatedAt: string;
  deletedAt: string | null;
}

function toDto(row: RecordRow): RecordDto {
  return {
    id: row.id,
    code: row.code,
    status: row.status,
    unitId: row.unitId,
    fyId: row.fyId,
    department: row.department,
    data: publicData(row.data),
    version: row.version,
    amount: row.amount,
    createdAt: row.createdAt.toISOString(),
    createdBy: { id: row.createdById, name: row.createdByName },
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
}

/** Typed Inventory pages answer through their own handlers; every other non-generic page is refused. */
export function assertServed(pageId: string): 'generic' | 'typed' {
  const kind = kindOf(pageId);
  if (!kind) throw Errors.notFound('Unknown page.');
  if (kind === 'generic' || kind === 'typed') return kind;
  throw Errors.notGeneric();
}

/** The schema of a page the generic engine serves; 404 for an unknown page, 404 NOT_GENERIC otherwise. */
export function genericSchema(pageId: string): PageSchema {
  const kind = kindOf(pageId);
  if (!kind) throw Errors.notFound('Unknown page.');
  if (kind !== 'generic') {
    throw Errors.notGeneric(
      kind === 'typed'
        ? 'This page has its own storage; it is not served by the generic record engine.'
        : 'This page is not served by the generic record engine.',
    );
  }
  const schema = buildPageSchema(pageId);
  if (!schema) throw Errors.notFound('Unknown page.');
  return schema;
}

async function visibilityFor(
  caller: Caller,
  schema: PageSchema,
  options: { fy?: boolean; deleted?: 'no' | 'only' | 'any' } = {},
): Promise<Visibility> {
  const user = caller.auth.user;
  const access = accessUserOf(user);
  const [scope, control] = await Promise.all([
    scopeFor(access, schema.pageId),
    prisma.moduleControl.findUnique({
      where: { pageId: schema.pageId },
      select: { ownerDepartment: true },
    }),
  ]);
  return {
    pageId: schema.pageId,
    unitId: caller.ctx.unitId,
    noUnit: caller.ctx.unitId === null && !caller.ctx.allUnits,
    ...(options.fy ? { fyId: caller.ctx.fyId } : {}),
    scope,
    userId: user.id,
    department: user.department,
    ownerIsMine: control !== null && control.ownerDepartment === user.department,
    deleted: options.deleted ?? 'no',
  };
}

function requireConcreteUnit(caller: Caller): string {
  if (caller.ctx.unitId === null) {
    throw Errors.contextInvalid('Choose a unit first: "All units" is for viewing lists only.');
  }
  return caller.ctx.unitId;
}

async function assertFyOpen(fyId: string): Promise<{ code: string }> {
  const fy = await prisma.financialYear.findUnique({ where: { id: fyId } });
  if (!fy) throw Errors.contextInvalid('Unknown financial year.');
  if (fy.status !== 'OPEN') throw Errors.periodClosed(`Financial year ${fy.code} is closed.`);
  return { code: fy.code };
}

function assertRowFyOpen(row: RecordRow): void {
  if (row.fyStatus !== 'OPEN') {
    throw Errors.periodClosed(`Financial year ${row.fyCode} is closed.`);
  }
}

function sortOrder(schema: PageSchema, sort: string) {
  const order = orderSql(schema, sort);
  if (!order)
    throw Errors.validation({
      sort: 'Sort by one of the page fields, code, status, createdAt or updatedAt.',
    });
  return order;
}

function assertCanSeeDeleted(caller: Caller): void {
  if (!hasMinRole(caller.auth.role, 'ADMIN')) {
    throw Errors.forbidden('Only administrators can list deleted records.');
  }
}

function undoToken(id: string, deletedAt: Date): string {
  return createHmac('sha256', env.JWT_ACCESS_SECRET)
    .update(`undo:${id}:${deletedAt.getTime()}`)
    .digest('hex')
    .slice(0, 32);
}

async function load(caller: Caller, schema: PageSchema, id: string, deleted: 'no' | 'only' = 'no') {
  const row = await repo.find(id, await visibilityFor(caller, schema, { deleted }));
  if (!row) throw Errors.notFound('Record not found.');
  return row;
}

function changedKeys(before: Record<string, unknown>, after: Record<string, unknown>) {
  const b: Prisma.InputJsonObject = {};
  const a: Prisma.InputJsonObject = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    if (JSON.stringify(before[key]) === JSON.stringify(after[key])) continue;
    if (before[key] !== undefined)
      Object.assign(b, { [key]: before[key] as Prisma.InputJsonValue });
    if (after[key] !== undefined) Object.assign(a, { [key]: after[key] as Prisma.InputJsonValue });
  }
  return { before: b, after: a, changed: Object.keys(a).length > 0 || Object.keys(b).length > 0 };
}

const TX = { maxWait: 15_000, timeout: 15_000 };

async function audit(
  tx: Db,
  action: Parameters<typeof recordAudit>[0]['action'],
  caller: Caller,
  row: { id: string; code: string },
  pageId: string,
  detail: Prisma.InputJsonObject = {},
) {
  await recordAudit(
    {
      action,
      actorId: caller.auth.userId,
      targetType: 'Record',
      targetId: row.id,
      meta: caller.meta,
      detail: { pageId, code: row.code, ...detail },
    },
    tx,
  );
}

export const recordService = {
  async list(caller: Caller, pageId: string, query: ListRecordsQuery) {
    const schema = genericSchema(pageId);
    if (query.deleted) assertCanSeeDeleted(caller);
    const v = await visibilityFor(caller, schema, {
      fy: true,
      deleted: query.deleted ? 'only' : 'no',
    });
    const { rows, total } = await repo.list(
      v,
      {
        sort: query.sort,
        ...(query.q ? { q: query.q } : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      sortOrder(schema, query.sort),
      { offset: (query.page - 1) * query.size, limit: query.size },
    );
    return { rows: rows.map(toDto), total };
  },

  async get(caller: Caller, pageId: string, id: string): Promise<RecordDto> {
    const schema = genericSchema(pageId);
    return toDto(await load(caller, schema, id));
  },

  async create(
    caller: Caller,
    pageId: string,
    input: Record<string, unknown>,
    idempotencyKey: string | undefined,
  ): Promise<{ record: RecordDto; replay: boolean }> {
    const schema = genericSchema(pageId);
    const unitId = requireConcreteUnit(caller);
    const fy = await assertFyOpen(caller.ctx.fyId);
    const validated = validateRecordInput(schema, input, 'create');
    const data = applyAadhaar({ ...validated.values }, validated.aadhaar);
    assertDateOrder(schema, data, new Set(Object.keys(validated.values)));
    const derived = deriveColumns(schema, data);
    const unit = await prisma.unit.findUnique({ where: { id: unitId } });
    if (!unit) throw Errors.contextInvalid('Unknown unit.');
    const user = caller.auth.user;
    const requestHash = createHash('sha256')
      .update(JSON.stringify([pageId, unitId, caller.ctx.fyId, input]))
      .digest('hex');

    try {
      return await prisma.$transaction(async (tx) => {
        if (idempotencyKey) {
          await repo.lockIdempotency(user.id, idempotencyKey, tx);
          const seen = await repo.findIdempotency(user.id, idempotencyKey, tx);
          if (seen) {
            if (seen.requestHash !== requestHash) {
              throw Errors.conflict(
                'This Idempotency-Key was already used for a different request.',
              );
            }
            const row = await repo.find(
              seen.recordId,
              {
                pageId,
                unitId: null,
                noUnit: false,
                scope: 'ALL',
                userId: user.id,
                department: user.department,
                ownerIsMine: true,
                deleted: 'no',
              },
              tx,
            );
            if (row) return { record: toDto(row), replay: true };
          }
        }
        const number = await repo.nextNumber(pageId, unitId, caller.ctx.fyId, tx);
        const code = `${codePrefix(schema.title)}/${unit.code}/${fy.code.slice(2)}/${String(number).padStart(5, '0')}`;
        const created = await repo.create(
          {
            pageId,
            unitId,
            fyId: caller.ctx.fyId,
            department: user.department ?? 'Administration',
            code,
            status: schema.master ? 'Active' : 'Draft',
            amount: derived.amount,
            docDate: derived.docDate ? new Date(`${derived.docDate}T00:00:00Z`) : null,
            data: data as Prisma.InputJsonObject,
            createdById: user.id,
          },
          tx,
        );
        await audit(tx, 'RECORD_CREATED', caller, { id: created.id, code }, pageId, {
          after: publicData(data) as Prisma.InputJsonObject,
        });
        if (idempotencyKey) {
          await repo.saveIdempotency(
            { userId: user.id, key: idempotencyKey, requestHash, recordId: created.id },
            tx,
          );
        }
        const row = await repo.find(
          created.id,
          {
            pageId,
            unitId: null,
            noUnit: false,
            scope: 'ALL',
            userId: user.id,
            department: user.department,
            ownerIsMine: true,
            deleted: 'no',
          },
          tx,
        );
        if (!row) throw Errors.notFound('Record not found.');
        return { record: toDto(row), replay: false };
      }, TX);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw Errors.conflict('Could not allocate a unique code. Please retry.');
      }
      throw err;
    }
  },

  async update(
    caller: Caller,
    pageId: string,
    id: string,
    expectedVersion: number,
    input: Record<string, unknown>,
  ): Promise<RecordDto> {
    const schema = genericSchema(pageId);
    requireConcreteUnit(caller);
    const current = await load(caller, schema, id);
    assertRowFyOpen(current);
    if (!schema.editableStatuses.includes(current.status)) {
      throw Errors.recordLocked(`A ${current.status} record cannot be edited.`);
    }
    if (expectedVersion !== current.version) throw Errors.versionConflict();
    const validated = validateRecordInput(schema, input, 'patch');
    assertMaskedUnchanged(schema, validated.values, current.data);
    const next: Record<string, unknown> = { ...current.data };
    for (const key of validated.cleared) {
      delete next[key];
      delete next[`_h_${key}`];
    }
    applyAadhaar(Object.assign(next, validated.values), validated.aadhaar);
    assertDateOrder(
      schema,
      next,
      new Set([...Object.keys(validated.values), ...validated.cleared]),
    );
    const diff = changedKeys(publicData(current.data), publicData(next));
    // Nothing changes: return the current row without a version bump or an audit row.
    if (!diff.changed) return toDto(current);
    const derived = deriveColumns(schema, next);
    const updated = await prisma.$transaction(async (tx) => {
      const ok = await repo.updateIfVersion(
        id,
        expectedVersion,
        {
          data: next as Prisma.InputJsonObject,
          amount: derived.amount,
          docDate: derived.docDate ? new Date(`${derived.docDate}T00:00:00Z`) : null,
          updatedById: caller.auth.userId,
        },
        tx,
      );
      if (!ok) throw Errors.versionConflict();
      await audit(tx, 'RECORD_UPDATED', caller, current, pageId, {
        before: diff.before,
        after: diff.after,
      });
      const fresh = await repo.find(id, await visibilityFor(caller, schema), tx);
      if (!fresh) throw Errors.notFound('Record not found.');
      return fresh;
    }, TX);
    return toDto(updated);
  },

  /** Soft delete; returns the token the web sends to /restore ("Undo", valid as long as it matches). */
  async remove(
    caller: Caller,
    pageId: string,
    id: string,
    expectedVersion: number | undefined,
    bulk = false,
  ): Promise<{ undoToken: string }> {
    const schema = genericSchema(pageId);
    requireConcreteUnit(caller);
    const current = await load(caller, schema, id);
    assertRowFyOpen(current);
    if (expectedVersion !== undefined && expectedVersion !== current.version) {
      throw Errors.versionConflict();
    }
    const at = new Date();
    await prisma.$transaction(async (tx) => {
      if (!(await repo.softDelete(id, caller.auth.userId, at, tx)))
        throw Errors.notFound('Record not found.');
      await audit(tx, 'RECORD_DELETED', caller, current, pageId, {
        before: publicData(current.data) as Prisma.InputJsonObject,
        ...(bulk ? { bulk: true } : {}),
      });
    }, TX);
    const row = await prisma.genericRecord.findUnique({
      where: { id },
      select: { deletedAt: true },
    });
    return { undoToken: undoToken(id, row?.deletedAt ?? at) };
  },

  async restore(
    caller: Caller,
    pageId: string,
    id: string,
    token: string | undefined,
  ): Promise<RecordDto> {
    const schema = genericSchema(pageId);
    requireConcreteUnit(caller);
    const current = await load(caller, schema, id, 'only');
    assertRowFyOpen(current);
    if (token !== undefined && current.deletedAt && token !== undoToken(id, current.deletedAt)) {
      throw Errors.validation({ undoToken: 'This undo token does not match the deleted record.' });
    }
    const restored = await prisma.$transaction(async (tx) => {
      if (!(await repo.restore(id, caller.auth.userId, tx)))
        throw Errors.notFound('Record not found.');
      await audit(tx, 'RECORD_RESTORED', caller, current, pageId);
      const fresh = await repo.find(id, await visibilityFor(caller, schema), tx);
      if (!fresh) throw Errors.notFound('Record not found.');
      return fresh;
    }, TX);
    return toDto(restored);
  },

  async changeStatus(
    caller: Caller,
    pageId: string,
    id: string,
    to: string,
    expectedVersion: number | undefined,
  ): Promise<RecordDto> {
    const schema = genericSchema(pageId);
    requireConcreteUnit(caller);
    const current = await load(caller, schema, id);
    assertRowFyOpen(current);
    if (expectedVersion !== undefined && expectedVersion !== current.version) {
      throw Errors.versionConflict();
    }
    if (to === 'Approved' || to === 'Rejected') {
      throw Errors.validation({
        to: 'Approval statuses are set by the approval workflow, not here.',
      });
    }
    const allowed = schema.transitions[current.status] ?? [];
    if (!allowed.includes(to)) {
      throw Errors.validation({
        to:
          allowed.length > 0
            ? `From ${current.status} you can only move to: ${allowed.join(', ')}.`
            : `A record that is ${current.status} cannot change status.`,
      });
    }
    const updated = await prisma.$transaction(async (tx) => {
      const ok = await repo.updateIfVersion(
        id,
        current.version,
        { status: to, updatedById: caller.auth.userId },
        tx,
      );
      if (!ok) throw Errors.versionConflict();
      await audit(tx, 'RECORD_STATUS_CHANGED', caller, current, pageId, {
        from: current.status,
        to,
      });
      const fresh = await repo.find(id, await visibilityFor(caller, schema), tx);
      if (!fresh) throw Errors.notFound('Record not found.');
      return fresh;
    }, TX);
    return toDto(updated);
  },

  /** One report entry per id, in the order given; one failure never stops the others. */
  async bulkDelete(caller: Caller, pageId: string, ids: readonly string[]) {
    genericSchema(pageId);
    requireConcreteUnit(caller);
    const report: { id: string; ok: boolean; error?: { code: string; message: string } }[] = [];
    for (const id of ids) {
      try {
        await this.remove(caller, pageId, id, undefined, true);
        report.push({ id, ok: true });
      } catch (err) {
        if (!(err instanceof AppError)) throw err;
        report.push({ id, ok: false, error: { code: err.code, message: err.message } });
      }
    }
    return report;
  },

  /**
   * Audit rows of the records on a page (or of one record) that the caller may see: same unit
   * context and data scope as the lists, deleted records included. Same row shape as /audit-logs;
   * the IP address and user agent are only shown to ADMIN and above.
   */
  async audit(caller: Caller, pageId: string, query: AuditQuery, recordId?: string) {
    const schema = genericSchema(pageId);
    const v = await visibilityFor(caller, schema, { deleted: 'any' });
    if (recordId && !(await repo.find(recordId, v))) throw Errors.notFound('Record not found.');
    const { ids, total } = await repo.auditIds(v, recordId, {
      offset: (query.page - 1) * query.size,
      limit: query.size,
    });
    const rows = (await auditLogRepository.findByIds(ids)).map(toAuditLogDto);
    const privileged = hasMinRole(caller.auth.role, 'ADMIN');
    return {
      rows: privileged ? rows : rows.map((r) => ({ ...r, ip: null, userAgent: null })),
      total,
    };
  },

  async exportXlsx(caller: Caller, pageId: string, query: ExportRecordsQuery) {
    const schema = genericSchema(pageId);
    if (query.deleted) assertCanSeeDeleted(caller);
    const v = await visibilityFor(caller, schema, {
      fy: true,
      deleted: query.deleted ? 'only' : 'no',
    });
    const filters = {
      sort: query.sort,
      ...(query.q ? { q: query.q } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.ids ? { ids: query.ids } : {}),
    };
    const rows = await repo.exportRows(
      v,
      filters,
      sortOrder(schema, query.sort),
      MAX_EXPORT_ROWS + 1,
    );
    if (rows.length > MAX_EXPORT_ROWS) {
      throw Errors.validation({
        _: `More than ${MAX_EXPORT_ROWS} rows match. Narrow the filters and try again.`,
      });
    }
    const buffer = await buildWorkbook(schema, rows);
    await recordAudit({
      action: 'RECORDS_EXPORTED',
      actorId: caller.auth.userId,
      targetType: 'Record',
      targetId: pageId,
      meta: caller.meta,
      detail: {
        pageId,
        count: rows.length,
        filters: {
          ...(query.q ? { q: query.q } : {}),
          ...(query.status ? { status: query.status } : {}),
          ...(query.ids ? { ids: query.ids.length } : {}),
          unitId: caller.ctx.unitId,
          fyId: caller.ctx.fyId,
        },
      },
    });
    return { buffer, filename: `${pageId}-${new Date().toISOString().slice(0, 10)}.xlsx` };
  },
};
