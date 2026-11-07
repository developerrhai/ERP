// Format & Settings service (docs/phases/PHASE-06B.md §3). One lifecycle for formats and rule sets:
//   save draft (If-Match) -> publish with a reason (new ACTIVE version, the old one RETIRED) ->
//   restore an old version as a NEW draft. Published versions are never edited (a DB trigger also
//   enforces it). Who may change: the Department Head of the page's owner department, and
//   Administrators. A money-affecting rule set goes through the Phase 5 approval engine when the
//   page's module control says approval is required.
import { Prisma } from '@prisma/client';
import type { AuthContext, RequestMeta } from '../../core/auth/auth-context';
import { recordAudit } from '../../core/audit/audit-service';
import { prisma } from '../../core/db/prisma';
import type { Db } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { ADMIN_LEVEL } from '../../core/rbac/role-rules';
import { pageInfo } from '../../core/registry';
import { RuleEngine, validateDefinition } from '../../core/settings/rule-engine';
import { validateFormatSchema } from '../../core/settings/format-schema';
import {
  formatTemplateWorkbook,
  parseFormatWorkbook,
  parseRateTableWorkbook,
  rateTemplateWorkbook,
} from '../../core/settings/excel-importer';
import type { ImportReport } from '../../core/settings/excel-importer';
import { SETTINGS_APPROVAL_DOC_TYPE } from '../../core/settings/constants';
import { approvalService } from '../approvals/service';
import { defaultStorage } from '../../core/storage';
import { builtInScanner, extensionOf, sanitizeFilename, sniffKind } from '../../core/scan';
import { settingsRepository as repo, keyOf } from './repository';
import type { DraftInput, SeriesKey, Target, VersionRow } from './repository';

const TX = { maxWait: 15_000, timeout: 15_000 };
const OPEN = ['DRAFT', 'PENDING_APPROVAL'];

export interface Actor {
  auth: AuthContext;
  meta: RequestMeta;
}

export interface VersionDto {
  id: string;
  target: Target;
  pageId: string;
  /** Row version for If-Match / ETag. */
  version: number;
  /** The document version number shown as "v3". */
  versionNo: number;
  status: string;
  name: string;
  reason: string | null;
  content: unknown;
  kind: string | null;
  code: string | null;
  moneyAffecting: boolean | null;
  customer: { id: string; name: string } | null;
  unit: { id: string; name: string } | null;
  sourceFileId: string | null;
  createdAt: string;
  createdBy: { id: string; name: string } | null;
  updatedAt: string;
  publishedAt: string | null;
  publishedBy: { id: string; name: string } | null;
  retiredAt: string | null;
}

export interface SettingsAccess {
  pageId: string;
  ownerDepartment: string;
  canEdit: boolean;
  approvalRequired: boolean;
}

/** Department Head of the owner department (any of their departments), or Administrator and above. */
export async function settingsAccess(auth: AuthContext, pageId: string): Promise<SettingsAccess> {
  if (!pageInfo(pageId)) throw Errors.notFound('Unknown page.');
  const control = await repo.controlOf(pageId);
  const owner = control?.ownerDepartment ?? 'Administration';
  const isHead = auth.roleCode === 'DEPT_HEAD' && auth.departments.includes(owner);
  return {
    pageId,
    ownerDepartment: owner,
    canEdit: auth.level >= ADMIN_LEVEL || isHead,
    approvalRequired: control?.approvalRequired ?? true,
  };
}

export async function assertCanEdit(auth: AuthContext, pageId: string): Promise<SettingsAccess> {
  const access = await settingsAccess(auth, pageId);
  if (!access.canEdit) throw Errors.formatNotAllowed(access.ownerDepartment);
  return access;
}

async function toDtos(rows: VersionRow[]): Promise<VersionDto[]> {
  const [users, customers, units] = await Promise.all([
    repo.userNames(
      rows.flatMap((r) => [r.createdById, r.publishedById].filter((x): x is string => !!x)),
    ),
    repo.customerNames(rows.map((r) => r.customerId).filter((x): x is string => !!x)),
    repo.unitNames(rows.map((r) => r.unitId).filter((x): x is string => !!x)),
  ]);
  const who = (id: string | null) => (id ? { id, name: users.get(id) ?? 'Unknown user' } : null);
  return rows.map((r) => ({
    id: r.id,
    target: r.target,
    pageId: r.pageId,
    version: r.rowVersion,
    versionNo: r.version,
    status: r.status,
    name: r.name,
    reason: r.reason,
    content: r.content,
    kind: r.kind,
    code: r.code,
    moneyAffecting: r.moneyAffecting,
    customer: r.customerId ? { id: r.customerId, name: customers.get(r.customerId) ?? '' } : null,
    unit: r.unitId ? { id: r.unitId, name: units.get(r.unitId) ?? '' } : null,
    sourceFileId: r.sourceFileId,
    createdAt: r.createdAt.toISOString(),
    createdBy: who(r.createdById),
    updatedAt: r.updatedAt.toISOString(),
    publishedAt: r.publishedAt ? r.publishedAt.toISOString() : null,
    publishedBy: who(r.publishedById),
    retiredAt: r.retiredAt ? r.retiredAt.toISOString() : null,
  }));
}

async function toDto(row: VersionRow): Promise<VersionDto> {
  return (await toDtos([row]))[0] as VersionDto;
}

const auditAction = (t: Target, what: 'DRAFTED' | 'PUBLISHED' | 'RETIRED' | 'DISCARDED'): string =>
  `${t === 'FORMAT' ? 'FORMAT' : 'RULE_SET'}_${what}`;

function seriesLabel(row: VersionRow): Prisma.InputJsonObject {
  return {
    pageId: row.pageId,
    version: row.version,
    name: row.name,
    ...(row.kind ? { kind: row.kind } : {}),
    ...(row.code ? { code: row.code } : {}),
    ...(row.customerId ? { customerId: row.customerId } : {}),
    ...(row.unitId ? { unitId: row.unitId } : {}),
  };
}

function p2002(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

async function loadFor(
  target: Target,
  pageId: string,
  id: string,
  db: Db = prisma,
): Promise<VersionRow> {
  const row = await repo.byId(target, id, db);
  if (!row || row.pageId !== pageId) throw Errors.notFound('Not found.');
  return row;
}

/** Activates a DRAFT / PENDING row inside `tx`: the old ACTIVE version is retired first. */
export async function activateVersion(
  tx: Db,
  row: VersionRow,
  publisherId: string,
  reason: string | null,
  extra: { approvedBy?: string } = {},
  meta?: RequestMeta,
): Promise<void> {
  const key = keyOf(row);
  const prev = await repo.activeOfSeries(key, tx);
  if (prev)
    await repo.setStatus(prev.target, prev.id, 'RETIRED', publisherId, { retired: true }, tx);
  await repo.setStatus(row.target, row.id, 'ACTIVE', publisherId, { published: true }, tx);
  await repo.addChange(
    {
      target: row.target,
      targetId: row.id,
      pageId: row.pageId,
      version: row.version,
      action: 'PUBLISHED',
      userId: publisherId,
      reason: reason ?? row.reason,
      before: (prev
        ? { version: prev.version, content: prev.content }
        : null) as Prisma.InputJsonValue,
      after: { version: row.version, content: row.content } as Prisma.InputJsonValue,
    },
    tx,
  );
  await recordAudit(
    {
      action: auditAction(row.target, 'PUBLISHED'),
      actorId: publisherId,
      targetType: row.target === 'FORMAT' ? 'Format' : 'RuleSet',
      targetId: row.id,
      ...(meta ? { meta } : {}),
      detail: {
        ...seriesLabel(row),
        reason: reason ?? row.reason ?? '',
        previousVersion: prev?.version ?? null,
        ...(extra.approvedBy ? { approvedBy: extra.approvedBy } : {}),
      },
    },
    tx,
  );
}

async function validateKeyRefs(customerId: string | null, unitId: string | null): Promise<void> {
  if (customerId && !(await repo.customerExists(customerId))) {
    throw Errors.validation({ customerId: 'Choose an existing customer.' });
  }
  if (unitId && !(await repo.unitExists(unitId))) {
    throw Errors.validation({ unitId: 'Choose an existing unit.' });
  }
}

interface SaveInput {
  key: SeriesKey;
  name: string;
  content: Prisma.InputJsonValue;
  reason: string | null;
  moneyAffecting: boolean;
  sourceFileId?: string | null;
  action?: 'DRAFTED' | 'IMPORTED' | 'RESTORED';
}

async function saveDraftTx(
  tx: Db,
  actor: Actor,
  input: SaveInput,
  expectedRowVersion: number,
): Promise<VersionRow> {
  const userId = actor.auth.userId;
  const draftInput: DraftInput = {
    name: input.name,
    content: input.content,
    reason: input.reason,
    moneyAffecting: input.moneyAffecting,
    sourceFileId: input.sourceFileId ?? null,
  };
  const open = await repo.openDraft(input.key, tx);
  let saved: VersionRow;
  if (!open) {
    if (expectedRowVersion !== 0) throw Errors.versionConflict();
    const version = await repo.nextVersion(input.key, tx);
    saved = await repo.createDraft(input.key, version, draftInput, userId, tx);
  } else {
    if (open.status === 'PENDING_APPROVAL') {
      throw Errors.conflict('This draft is waiting for approval and cannot be changed now.');
    }
    if (expectedRowVersion !== open.rowVersion) throw Errors.versionConflict();
    if (
      !(await repo.updateDraft(open.target, open.id, expectedRowVersion, draftInput, userId, tx))
    ) {
      throw Errors.versionConflict();
    }
    saved = (await repo.byId(open.target, open.id, tx)) as VersionRow;
  }
  const action = input.action ?? 'DRAFTED';
  await repo.addChange(
    {
      target: saved.target,
      targetId: saved.id,
      pageId: saved.pageId,
      version: saved.version,
      action,
      userId,
      reason: input.reason,
      before: (open ? { content: open.content, name: open.name } : null) as Prisma.InputJsonValue,
      after: { content: saved.content, name: saved.name } as Prisma.InputJsonValue,
    },
    tx,
  );
  await recordAudit(
    {
      action: action === 'IMPORTED' ? 'FORMAT_IMPORTED' : auditAction(saved.target, 'DRAFTED'),
      actorId: userId,
      targetType: saved.target === 'FORMAT' ? 'Format' : 'RuleSet',
      targetId: saved.id,
      meta: actor.meta,
      detail: { ...seriesLabel(saved), ...(action !== 'DRAFTED' ? { via: action } : {}) },
    },
    tx,
  );
  return saved;
}

export const formatSettingsService = {
  access: settingsAccess,

  // ---- reads -------------------------------------------------------------------------------------
  async listPage(auth: AuthContext, pageId: string, target: Target, kind?: string) {
    const access = await settingsAccess(auth, pageId);
    const rows = await repo.liveOfPage(target, pageId, { kind });
    return { access, items: await toDtos(rows) };
  },

  async versions(auth: AuthContext, pageId: string, key: SeriesKey): Promise<VersionDto[]> {
    await settingsAccess(auth, pageId);
    return toDtos(await repo.series(key));
  },

  async versionsById(id: string): Promise<VersionDto[]> {
    const row = (await repo.byId('FORMAT', id)) ?? (await repo.byId('RULE_SET', id));
    if (!row) throw Errors.notFound('Not found.');
    return toDtos(await repo.series(keyOf(row)));
  },

  // ---- drafts ------------------------------------------------------------------------------------
  async saveFormat(
    actor: Actor,
    pageId: string,
    body: {
      kind: string;
      customerId?: string | null | undefined;
      unitId?: string | null | undefined;
      name: string;
      schema?: unknown;
      reason?: string | undefined;
    },
    expectedRowVersion: number,
  ): Promise<VersionDto> {
    await assertCanEdit(actor.auth, pageId);
    const schema = validateFormatSchema(body.schema);
    const customerId = body.customerId ?? null;
    const unitId = body.unitId ?? null;
    await validateKeyRefs(customerId, unitId);
    const key: SeriesKey = { target: 'FORMAT', pageId, kind: body.kind, customerId, unitId };
    try {
      const row = await prisma.$transaction(
        (tx) =>
          saveDraftTx(
            tx,
            actor,
            {
              key,
              name: body.name,
              content: schema as unknown as Prisma.InputJsonValue,
              reason: body.reason ?? null,
              moneyAffecting: false,
            },
            expectedRowVersion,
          ),
        TX,
      );
      return await toDto(row);
    } catch (err) {
      if (p2002(err)) throw Errors.versionConflict();
      throw err;
    }
  },

  async saveRule(
    actor: Actor,
    pageId: string,
    body: {
      code: string;
      name: string;
      moneyAffecting: boolean;
      definition?: unknown;
      reason?: string | undefined;
    },
    expectedRowVersion: number,
  ): Promise<VersionDto> {
    await assertCanEdit(actor.auth, pageId);
    const definition = validateDefinition(body.definition);
    const key: SeriesKey = { target: 'RULE_SET', pageId, code: body.code };
    try {
      const row = await prisma.$transaction(
        (tx) =>
          saveDraftTx(
            tx,
            actor,
            {
              key,
              name: body.name,
              content: definition as unknown as Prisma.InputJsonValue,
              reason: body.reason ?? null,
              moneyAffecting: body.moneyAffecting,
            },
            expectedRowVersion,
          ),
        TX,
      );
      return await toDto(row);
    } catch (err) {
      if (p2002(err)) throw Errors.versionConflict();
      throw err;
    }
  },

  async discard(
    actor: Actor,
    pageId: string,
    target: Target,
    id: string,
    expected: number,
  ): Promise<void> {
    await assertCanEdit(actor.auth, pageId);
    await prisma.$transaction(async (tx) => {
      const row = await repo.lock(target, id, tx);
      if (!row || row.pageId !== pageId) throw Errors.notFound('Not found.');
      if (row.status !== 'DRAFT') throw Errors.conflict('Only a draft can be discarded.');
      if (row.rowVersion !== expected) throw Errors.versionConflict();
      await repo.addChange(
        {
          target,
          targetId: row.id,
          pageId,
          version: row.version,
          action: 'DISCARDED',
          userId: actor.auth.userId,
          reason: null,
          before: { content: row.content } as Prisma.InputJsonValue,
        },
        tx,
      );
      await repo.deleteDraft(target, id, tx);
      await recordAudit(
        {
          action: auditAction(target, 'DISCARDED'),
          actorId: actor.auth.userId,
          targetType: target === 'FORMAT' ? 'Format' : 'RuleSet',
          targetId: row.id,
          meta: actor.meta,
          detail: seriesLabel(row),
        },
        tx,
      );
    }, TX);
  },

  /** An older version becomes a NEW draft (history is never rewritten). */
  async restore(
    actor: Actor,
    pageId: string,
    target: Target,
    id: string,
    reason?: string,
  ): Promise<VersionDto> {
    await assertCanEdit(actor.auth, pageId);
    const src = await loadFor(target, pageId, id);
    const row = await prisma
      .$transaction(
        (tx) =>
          saveDraftTx(
            tx,
            actor,
            {
              key: keyOf(src),
              name: src.name,
              content: src.content as Prisma.InputJsonValue,
              reason: reason ?? `Restored from version ${src.version}`,
              moneyAffecting: src.moneyAffecting ?? false,
              action: 'RESTORED',
            },
            0,
          ),
        TX,
      )
      .catch((err: unknown) => {
        if (
          err instanceof Error &&
          'code' in err &&
          (err as { code: string }).code === 'VERSION_CONFLICT'
        ) {
          throw Errors.conflict(
            'A draft already exists. Publish or discard it before restoring an older version.',
          );
        }
        if (p2002(err)) {
          throw Errors.conflict(
            'A draft already exists. Publish or discard it before restoring an older version.',
          );
        }
        throw err;
      });
    return toDto(row);
  },

  // ---- publish / retire -------------------------------------------------------------------------
  async publish(
    actor: Actor,
    pageId: string,
    target: Target,
    id: string,
    expected: number,
    reason: string,
    idemKey?: string,
  ): Promise<VersionDto> {
    const access = await assertCanEdit(actor.auth, pageId);
    let needsApproval = false;
    await prisma.$transaction(async (tx) => {
      const row = await repo.lock(target, id, tx);
      if (!row || row.pageId !== pageId) throw Errors.notFound('Not found.');
      if (row.status === 'PENDING_APPROVAL') {
        throw Errors.conflict('This version is already waiting for approval.');
      }
      if (row.status !== 'DRAFT') throw Errors.conflict('Only a draft can be published.');
      if (row.rowVersion !== expected) throw Errors.versionConflict();
      // The content is checked again: nothing unchecked can become active.
      if (target === 'FORMAT') validateFormatSchema(row.content);
      else validateDefinition(row.content);
      needsApproval =
        target === 'RULE_SET' && row.moneyAffecting === true && access.approvalRequired;
      if (needsApproval) {
        await repo.setReason(target, id, reason, actor.auth.userId, tx);
      } else {
        await repo.setReason(target, id, reason, actor.auth.userId, tx);
        const fresh = (await repo.byId(target, id, tx)) as VersionRow;
        await activateVersion(tx, fresh, actor.auth.userId, reason, {}, actor.meta);
      }
    }, TX);
    if (needsApproval) {
      await approvalService.submit(
        { auth: actor.auth, meta: actor.meta },
        SETTINGS_APPROVAL_DOC_TYPE,
        id,
        { idemKey },
      );
    }
    return toDto(await loadFor(target, pageId, id));
  },

  async retire(
    actor: Actor,
    pageId: string,
    target: Target,
    id: string,
    expected: number,
    reason: string,
  ): Promise<VersionDto> {
    await assertCanEdit(actor.auth, pageId);
    await prisma.$transaction(async (tx) => {
      const row = await repo.lock(target, id, tx);
      if (!row || row.pageId !== pageId) throw Errors.notFound('Not found.');
      if (row.status !== 'ACTIVE') throw Errors.conflict('Only the active version can be retired.');
      if (row.rowVersion !== expected) throw Errors.versionConflict();
      const n = await repo.openDocumentsUsing(target, id, tx);
      if (n > 0) throw Errors.formatInUse(n);
      await repo.setStatus(target, id, 'RETIRED', actor.auth.userId, { reason, retired: true }, tx);
      await repo.addChange(
        {
          target,
          targetId: id,
          pageId,
          version: row.version,
          action: 'RETIRED',
          userId: actor.auth.userId,
          reason,
        },
        tx,
      );
      await recordAudit(
        {
          action: auditAction(target, 'RETIRED'),
          actorId: actor.auth.userId,
          targetType: target === 'FORMAT' ? 'Format' : 'RuleSet',
          targetId: id,
          meta: actor.meta,
          detail: { ...seriesLabel(row), reason },
        },
        tx,
      );
    }, TX);
    return toDto(await loadFor(target, pageId, id));
  },

  // ---- evaluate (pure) ---------------------------------------------------------------------------
  async evaluate(
    auth: AuthContext,
    pageId: string,
    body: {
      id?: string | undefined;
      code?: string | undefined;
      inputs: Record<string, string | number>;
    },
  ) {
    await settingsAccess(auth, pageId);
    let row: VersionRow | null = null;
    if (body.id) {
      row = await repo.byId('RULE_SET', body.id);
      if (row && row.pageId !== pageId) row = null;
    } else if (body.code) {
      row = await repo.activeOfSeries({ target: 'RULE_SET', pageId, code: body.code });
    }
    if (!row) throw Errors.notFound('Rule set not found.');
    const result = RuleEngine.evaluate(row.content, body.inputs);
    return {
      ruleSetId: row.id,
      versionNo: row.version,
      status: row.status,
      outputs: result.outputs,
    };
  },

  // ---- Excel import ------------------------------------------------------------------------------
  async template(target: 'format' | 'rate-table'): Promise<{ buffer: Buffer; filename: string }> {
    return target === 'format'
      ? { buffer: await formatTemplateWorkbook(), filename: 'format-template.xlsx' }
      : { buffer: await rateTemplateWorkbook(), filename: 'rate-table-template.xlsx' };
  },

  async importExcel(
    actor: Actor,
    pageId: string,
    q: {
      target: 'format' | 'rate-table';
      kind?: string | undefined;
      customerId?: string | undefined;
      unitId?: string | undefined;
      code?: string | undefined;
      tableName?: string | undefined;
      name?: string | undefined;
    },
    file: { buffer: Buffer; filename: string },
  ): Promise<{ report: ImportReport; draft: VersionDto | null }> {
    await assertCanEdit(actor.auth, pageId);
    const fileName = sanitizeFilename(file.filename);
    if (
      sniffKind(file.buffer, extensionOf(fileName)) !== 'xlsx' ||
      extensionOf(fileName) !== 'xlsx'
    ) {
      throw Errors.fileTypeNotAllowed('Upload an Excel .xlsx file.');
    }
    if ((await builtInScanner.scan(file.buffer, 'xlsx')).status === 'INFECTED')
      throw Errors.fileInfected();
    if (q.target === 'format') {
      const kind = q.kind ?? 'FORM';
      const customerId = q.customerId ?? null;
      const unitId = q.unitId ?? null;
      await validateKeyRefs(customerId, unitId);
      const parsed = await parseFormatWorkbook(file.buffer);
      if (!parsed.schema) return { report: parsed.report, draft: null };
      const stored = await storeEvidence(actor, fileName, file.buffer);
      const key: SeriesKey = { target: 'FORMAT', pageId, kind, customerId, unitId };
      const open = await repo.openDraft(key);
      const row = await prisma.$transaction(
        (tx) =>
          saveDraftTx(
            tx,
            actor,
            {
              key,
              name: q.name ?? parsed.schema?.title ?? fileName.replace(/\.xlsx$/i, ''),
              content: parsed.schema as unknown as Prisma.InputJsonValue,
              reason: `Imported from ${fileName}`,
              moneyAffecting: false,
              sourceFileId: stored,
              action: 'IMPORTED',
            },
            open?.rowVersion ?? 0,
          ),
        TX,
      );
      return { report: parsed.report, draft: await toDto(row) };
    }

    // rate table -> a draft of the rule set (the active definition plus the new / replaced table)
    const code = q.code;
    if (!code || !/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(code)) {
      throw Errors.validation({ code: 'Enter the rule set code to put the rate table in.' });
    }
    const tableName = q.tableName ?? 'rates';
    if (!/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(tableName)) {
      throw Errors.validation({
        tableName: 'Use letters, digits and underscore, starting with a letter.',
      });
    }
    const parsed = await parseRateTableWorkbook(file.buffer, tableName);
    if (!parsed.table) return { report: parsed.report, draft: null };
    const key: SeriesKey = { target: 'RULE_SET', pageId, code };
    const open = await repo.openDraft(key);
    const base = open ?? (await repo.activeOfSeries(key));
    const def = (base?.content ?? { inputs: [], parameters: [], tables: [], outputs: [] }) as {
      tables?: { name: string }[];
      outputs?: unknown[];
    };
    const tables = [...(def.tables ?? []).filter((t) => t.name !== tableName), parsed.table];
    // A brand-new rule set has no result yet: a placeholder zero result keeps the draft saveable
    // until the head adds the real formulas.
    const outputs =
      (def.outputs?.length ?? 0) > 0
        ? def.outputs
        : [{ name: 'result', expression: '0', places: 2 }];
    const content = { ...def, tables, outputs };
    const definition = validateDefinition(content);
    const stored = await storeEvidence(actor, fileName, file.buffer);
    const draftRow = await prisma.$transaction(
      (tx) =>
        saveDraftTx(
          tx,
          actor,
          {
            key,
            name: q.name ?? base?.name ?? code,
            content: definition as unknown as Prisma.InputJsonValue,
            reason: `Rate table "${tableName}" imported from ${fileName}`,
            moneyAffecting: base?.moneyAffecting ?? true,
            sourceFileId: stored,
            action: 'IMPORTED',
          },
          open?.rowVersion ?? 0,
        ),
      TX,
    );
    return { report: parsed.report, draft: await toDto(draftRow) };
  },

  // ---- global (admin-formats) --------------------------------------------------------------------
  async listAll(q: Parameters<typeof repo.listAll>[0]) {
    const { rows, total } = await repo.listAll(q);
    return { items: await toDtos(rows), total };
  },

  async changes(q: { pageId?: string | undefined; offset: number; limit: number }) {
    const { rows, total } = await repo.changes(q);
    const users = await repo.userNames(
      rows.map((r) => r.changedById).filter((x): x is string => !!x),
    );
    return {
      total,
      items: rows.map((r) => ({
        id: r.id,
        targetType: r.targetType,
        targetId: r.targetId,
        pageId: r.pageId,
        versionNo: r.version,
        action: r.action,
        reason: r.reason,
        changedBy: r.changedById
          ? { id: r.changedById, name: users.get(r.changedById) ?? '' }
          : null,
        at: r.at.toISOString(),
      })),
    };
  },
};

async function storeEvidence(actor: Actor, filename: string, buffer: Buffer): Promise<string> {
  const stored = await defaultStorage.save({
    buffer,
    originalFilename: filename,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    userId: actor.auth.userId,
  });
  await prisma.storedFile.update({
    where: { id: stored.id },
    data: { scanStatus: 'CLEAN', scannedAt: new Date() },
  });
  return stored.id;
}

export { OPEN };
