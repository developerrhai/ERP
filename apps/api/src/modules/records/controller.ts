// HTTP layer for /pages/:pageId (schema, records, audit, preview): validated input, If-Match /
// Idempotency-Key headers, {data} out. A typed Inventory page is answered by its own handler
// (modules/inventory), every other page by the generic engine. No business rules here.
import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import { abandonIdempotent, beginIdempotent, finishIdempotent } from '../../core/http/idempotency';
import { requestMeta, requireAuth } from '../../core/auth/auth-context';
import { recordAudit } from '../../core/audit/audit-service';
import { prisma } from '../../core/db/prisma';
import { AppError, Errors } from '../../core/http/errors';
import { parseIfMatch, parseOptionalIfMatch } from '../../core/http/if-match';
import { validated } from '../../core/http/validate';
import { buildPageSchema } from '../../engine/field-schema';
import { accessUserOf, can } from '../../core/rbac/access';
import type { Requires } from '../../kit/types';
import { kitAudit } from '../../kit/audit-view';
import { kitSchemaFor } from '../../kit/registry';
import { typedAudit } from '../inventory/audit';
import { typedSchema } from '../inventory/definitions';
import { buildTypedWorkbook } from '../inventory/export';
import { previewAdjustment, previewTransfer } from '../inventory/stock/service';
import { typedHandlerFor } from '../inventory/typed-pages';
import { recordPdfService } from './pdf';
import { recordService } from './service';
import type { Caller } from './service';
import {
  actionBodySchema,
  actionParamsSchema,
  auditQuerySchema,
  bulkBodySchema,
  exportRecordsQuerySchema,
  idempotencyKeySchema,
  listRecordsQuerySchema,
  MAX_EXPORT_ROWS,
  pageParamsSchema,
  previewQuerySchema,
  recordBodySchema,
  recordParamsSchema,
  restoreBodySchema,
  submitBulkBodySchema,
  statusBodySchema,
  typedExportQuerySchema,
  typedListQuerySchema,
} from './schemas';

/** Typed-page export query: the static filters plus the page's own (schema-built) filter params. */
type TypedExportQuery = z.output<typeof typedExportQuerySchema> & {
  filters?: Record<string, string>;
};

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function callerOf(req: Request): Caller {
  if (!req.ctx) throw Errors.unauthenticated();
  return { auth: requireAuth(req), ctx: req.ctx, meta: requestMeta(req) };
}

function idempotencyKeyOf(req: Request): string | undefined {
  const header = req.get('idempotency-key');
  if (header === undefined) return undefined;
  const parsed = idempotencyKeySchema.safeParse(header);
  if (!parsed.success) {
    throw Errors.badRequest(parsed.error.issues[0]?.message ?? 'Invalid Idempotency-Key header.');
  }
  return parsed.data;
}

function sendXlsx(res: Response, buffer: Buffer, filename: string): void {
  res
    .set({
      'Content-Type': XLSX_TYPE,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    })
    .send(buffer);
}

function sendPdf(res: Response, buffer: Buffer, filename: string): void {
  res
    .set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${filename}"`,
      'Cache-Control': 'no-store',
    })
    .send(buffer);
}

/** A typed page that does not offer this operation (Stock Balance is list-only). */
function need<T>(fn: T | undefined): T {
  if (!fn) throw Errors.readOnly();
  return fn;
}

export const recordsController = {
  schema: async (_req: Request, res: Response): Promise<void> => {
    const { pageId } = validated(res, 'params', pageParamsSchema);
    const schema = typedSchema(pageId) ?? buildPageSchema(pageId);
    if (!schema) throw Errors.notFound('Unknown page.');
    // The module control (System Control Center) tells who owns the page and whether it needs approval.
    const control = await prisma.moduleControl.findUnique({
      where: { pageId },
      select: { ownerDepartment: true, approvalRequired: true },
    });
    const isReadOnlyCreate = 'readOnlyCreate' in schema && Boolean(schema.readOnlyCreate);
    const responseData: Record<string, unknown> = {
      ...schema,
      ownerDepartment: control?.ownerDepartment ?? null,
      approvalRequired: control?.approvalRequired ?? false,
    };
    if (!isReadOnlyCreate) {
      delete responseData.readOnlyCreate;
    }
    res.json({ data: responseData });
  },

  list: async (req: Request, res: Response): Promise<void> => {
    const { pageId } = validated(res, 'params', pageParamsSchema);
    const typed = typedHandlerFor(pageId);
    if (typed) {
      const query = validated(res, 'query', typedListQuerySchema);
      const { rows, total, totals } = await typed.list(callerOf(req), query);
      res.json({
        data: rows,
        meta: { page: query.page, size: query.size, total, ...(totals ? { totals } : {}) },
      });
      return;
    }
    const query = validated(res, 'query', listRecordsQuerySchema);
    const { rows, total } = await recordService.list(callerOf(req), pageId, query);
    res.json({ data: rows, meta: { page: query.page, size: query.size, total } });
  },

  get: async (req: Request, res: Response): Promise<void> => {
    const { pageId, id } = validated(res, 'params', recordParamsSchema);
    const typed = typedHandlerFor(pageId);
    const record = typed
      ? await typed.get(callerOf(req), id)
      : await recordService.get(callerOf(req), pageId, id);
    res.set('ETag', `"${record.version}"`).json({ data: record });
  },

  create: async (req: Request, res: Response): Promise<void> => {
    const { pageId } = validated(res, 'params', pageParamsSchema);
    const schema = typedSchema(pageId);
    if (schema?.readOnlyCreate) {
      throw Errors.readOnly('Records of this page are created by other documents.');
    }
    const body = validated(res, 'body', recordBodySchema);
    const typed = typedHandlerFor(pageId);
    if (typed) {
      const record = await need(typed.create?.bind(typed))(callerOf(req), body.data);
      res.status(201).set('ETag', `"${record.version}"`).json({ data: record });
      return;
    }
    const { record, replay } = await recordService.create(
      callerOf(req),
      pageId,
      body.data,
      idempotencyKeyOf(req),
      body.unitId,
    );
    if (replay) res.set('Idempotent-Replay', 'true');
    res.status(201).set('ETag', `"${record.version}"`).json({ data: record });
  },

  update: async (req: Request, res: Response): Promise<void> => {
    const version = parseIfMatch(req.get('if-match'));
    const { pageId, id } = validated(res, 'params', recordParamsSchema);
    const body = validated(res, 'body', recordBodySchema);
    const typed = typedHandlerFor(pageId);
    const record = typed
      ? await need(typed.update?.bind(typed))(callerOf(req), id, version, body.data)
      : await recordService.update(callerOf(req), pageId, id, version, body.data);
    res.set('ETag', `"${record.version}"`).json({ data: record });
  },

  remove: async (req: Request, res: Response): Promise<void> => {
    const version = parseOptionalIfMatch(req.get('if-match'));
    const { pageId, id } = validated(res, 'params', recordParamsSchema);
    const typed = typedHandlerFor(pageId);
    res.json({
      data: typed
        ? await need(typed.remove?.bind(typed))(callerOf(req), id, version)
        : await recordService.remove(callerOf(req), pageId, id, version),
    });
  },

  restore: async (req: Request, res: Response): Promise<void> => {
    const { pageId, id } = validated(res, 'params', recordParamsSchema);
    const body = validated(res, 'body', restoreBodySchema);
    const typed = typedHandlerFor(pageId);
    const record = typed
      ? await need(typed.restore?.bind(typed))(callerOf(req), id, body.undoToken)
      : await recordService.restore(callerOf(req), pageId, id, body.undoToken);
    res.set('ETag', `"${record.version}"`).json({ data: record });
  },

  status: async (req: Request, res: Response): Promise<void> => {
    const version = parseOptionalIfMatch(req.get('if-match'));
    const { pageId, id } = validated(res, 'params', recordParamsSchema);
    const body = validated(res, 'body', statusBodySchema);
    if (typedHandlerFor(pageId)) {
      throw Errors.notFound(
        'This page changes status through its actions (POST .../actions/:action).',
      );
    }
    const record = await recordService.changeStatus(callerOf(req), pageId, id, body.to, version);
    res.set('ETag', `"${record.version}"`).json({ data: record });
  },

  action: async (req: Request, res: Response): Promise<void> => {
    const { pageId, id, action } = validated(res, 'params', actionParamsSchema);
    const body = validated(res, 'body', actionBodySchema);
    if (body.payload && JSON.stringify(body.payload).length > 100 * 1024) {
      throw Errors.payloadTooLarge();
    }
    const typed = typedHandlerFor(pageId);
    if (!typed?.action) throw Errors.notFound('Unknown action.');
    const auth = requireAuth(req);
    const user = accessUserOf(auth);
    if (
      !(await can(user, pageId, 'view')) &&
      !(await can(user, pageId, 'edit')) &&
      !(await can(user, pageId, 'delete'))
    ) {
      throw Errors.forbidden();
    }
    const existing = await typed.get(callerOf(req), id);
    const schema = typedSchema(pageId);
    const actionDef = schema?.actions?.find((a) => a.key === action);
    if (!actionDef) throw Errors.notFound('Unknown action.');
    let requiredPerm: Requires = actionDef.requires ?? 'edit';
    if (actionDef.requiresFrom && actionDef.requiresFrom.length > 0) {
      if (!actionDef.requiresFrom.includes(existing.status)) {
        requiredPerm = 'edit';
      }
    }
    const allowed = await can(user, pageId, requiredPerm);
    if (!allowed) throw Errors.forbidden();

    const { record, replay } = await typed.action(
      callerOf(req),
      id,
      action,
      body,
      idempotencyKeyOf(req),
    );
    if (replay) res.set('Idempotent-Replay', 'true');
    res.set('ETag', `"${record.version}"`).json({ data: record });
  },

  bulk: async (req: Request, res: Response): Promise<void> => {
    const { pageId } = validated(res, 'params', pageParamsSchema);
    const body = validated(res, 'body', bulkBodySchema);
    const typed = typedHandlerFor(pageId);
    if (!typed) {
      res.json({ data: await recordService.bulkDelete(callerOf(req), pageId, body.ids) });
      return;
    }
    const remove = need(typed.remove?.bind(typed));
    const report: { id: string; ok: boolean; error?: { code: string; message: string } }[] = [];
    for (const id of body.ids) {
      try {
        await remove(callerOf(req), id, undefined);
        report.push({ id, ok: true });
      } catch (err) {
        if (!(err instanceof AppError)) throw err;
        report.push({ id, ok: false, error: { code: err.code, message: err.message } });
      }
    }
    res.json({ data: report });
  },

  summary: async (req: Request, res: Response): Promise<void> => {
    const { pageId } = validated(res, 'params', pageParamsSchema);
    res
      .set('Cache-Control', 'no-store')
      .json({ data: await recordService.summary(callerOf(req), pageId) });
  },

  quality: async (req: Request, res: Response): Promise<void> => {
    const { pageId } = validated(res, 'params', pageParamsSchema);
    res
      .set('Cache-Control', 'no-store')
      .json({ data: await recordService.quality(callerOf(req), pageId) });
  },

  submit: async (req: Request, res: Response): Promise<void> => {
    const { pageId, id } = validated(res, 'params', recordParamsSchema);
    const version = parseIfMatch(req.get('if-match'));
    const scope = `records:submit:${pageId}:${id}`;
    const caller = callerOf(req);
    const key = idempotencyKeyOf(req);
    if (key) {
      const hash = createHash('sha256')
        .update(JSON.stringify([pageId, id, version]))
        .digest('hex');
      const start = await beginIdempotent(caller.auth.userId, scope, key, hash);
      if (start.kind === 'mismatch') {
        throw Errors.conflict('This Idempotency-Key was already used for a different request.');
      }
      if (start.kind === 'in_progress') throw Errors.inProgress();
      if (start.kind === 'replay') {
        const stored = start.body as { data?: { version?: number } } | null;
        res.set('Idempotent-Replay', 'true');
        if (stored?.data?.version !== undefined) res.set('ETag', `"${stored.data.version}"`);
        res.json({ data: stored?.data ?? {} });
        return;
      }
    }
    try {
      const record = await recordService.submit(caller, pageId, id, version);
      if (key) {
        await finishIdempotent(caller.auth.userId, scope, key, 200, {
          data: JSON.parse(JSON.stringify(record)) as Prisma.InputJsonObject,
        });
      }
      res.set('ETag', `"${record.version}"`).json({ data: record });
    } catch (err) {
      if (key) await abandonIdempotent(caller.auth.userId, scope, key);
      throw err;
    }
  },

  submitBulk: async (req: Request, res: Response): Promise<void> => {
    const { pageId } = validated(res, 'params', pageParamsSchema);
    const body = validated(res, 'body', submitBulkBodySchema);
    res.json({ data: await recordService.submitBulk(callerOf(req), pageId, body.ids) });
  },

  exportCsv: async (req: Request, res: Response): Promise<void> => {
    const { pageId } = validated(res, 'params', pageParamsSchema);
    if (typedHandlerFor(pageId)) {
      throw Errors.notGeneric('CSV export is available for generic pages.');
    }
    const query = validated(res, 'query', exportRecordsQuerySchema);
    const { buffer, filename } = await recordService.exportFile(
      callerOf(req),
      pageId,
      query,
      'csv',
    );
    res
      .set({
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      })
      .send(buffer);
  },

  recordPdf: async (req: Request, res: Response): Promise<void> => {
    const { pageId, id } = validated(res, 'params', recordParamsSchema);
    if (typedHandlerFor(pageId)) throw Errors.notGeneric('Use the page print templates.');
    const buffer = await recordPdfService.recordPdf(callerOf(req), pageId, id);
    sendPdf(res, buffer, `${pageId}-${id}.pdf`);
  },

  listPdf: async (req: Request, res: Response): Promise<void> => {
    const { pageId } = validated(res, 'params', pageParamsSchema);
    if (typedHandlerFor(pageId)) throw Errors.notGeneric('Use the page print templates.');
    const query = validated(res, 'query', exportRecordsQuerySchema);
    const buffer = await recordPdfService.listPdf(callerOf(req), pageId, query);
    sendPdf(res, buffer, `${pageId}-${new Date().toISOString().slice(0, 10)}.pdf`);
  },

  export: async (req: Request, res: Response): Promise<void> => {
    const { pageId } = validated(res, 'params', pageParamsSchema);
    const typed = typedHandlerFor(pageId);
    if (!typed) {
      const query = validated(res, 'query', exportRecordsQuerySchema);
      const { buffer, filename } = await recordService.exportXlsx(callerOf(req), pageId, query);
      sendXlsx(res, buffer, filename);
      return;
    }
    const query = validated(res, 'query', typedExportQuerySchema) as TypedExportQuery;
    const schema = typedSchema(pageId);
    if (!schema) throw Errors.notFound('Unknown page.');
    const { rows, total, totals } = await need(typed.exportRows?.bind(typed))(callerOf(req), {
      ...query,
      page: 1,
      size: MAX_EXPORT_ROWS,
    });
    if (total > MAX_EXPORT_ROWS) {
      throw Errors.validation({
        _: `More than ${MAX_EXPORT_ROWS} rows match. Narrow the filters and try again.`,
      });
    }
    const wanted = query.ids ? new Set(query.ids) : null;
    const picked = wanted ? rows.filter((r) => wanted.has(r.id)) : rows;
    const caller = callerOf(req);
    await recordAudit({
      action: 'RECORDS_EXPORTED',
      actorId: caller.auth.userId,
      targetType: 'Record',
      targetId: pageId,
      meta: caller.meta,
      detail: {
        pageId,
        count: picked.length,
        filters: {
          ...(query.q ? { q: query.q } : {}),
          ...(query.status ? { status: query.status } : {}),
          ...(query.view ? { view: query.view } : {}),
          ...(query.filters ? query.filters : {}),
          unitId: caller.ctx.unitId,
          fyId: caller.ctx.fyId,
        },
      },
    });
    const buffer = await buildTypedWorkbook(schema, picked, wanted ? undefined : totals);
    sendXlsx(res, buffer, `${pageId}-${new Date().toISOString().slice(0, 10)}.xlsx`);
  },

  audit: async (req: Request, res: Response): Promise<void> => {
    const { pageId } = validated(res, 'params', pageParamsSchema);
    const query = validated(res, 'query', auditQuerySchema);
    const typed = typedHandlerFor(pageId);
    let result: { rows: unknown[]; total: number };
    if (typed) {
      result = kitSchemaFor(pageId)
        ? await kitAudit(callerOf(req), pageId, query)
        : await typedAudit(callerOf(req), pageId, query);
    } else {
      result = await recordService.audit(callerOf(req), pageId, query);
    }
    res.json({
      data: result.rows,
      meta: { page: query.page, size: query.size, total: result.total },
    });
  },

  recordAudit: async (req: Request, res: Response): Promise<void> => {
    const { pageId, id } = validated(res, 'params', recordParamsSchema);
    const query = validated(res, 'query', auditQuerySchema);
    const typed = typedHandlerFor(pageId);
    if (typed) {
      await typed.get(callerOf(req), id);
      const { rows, total } = kitSchemaFor(pageId)
        ? await kitAudit(callerOf(req), pageId, query, id)
        : await typedAudit(callerOf(req), pageId, query, id);
      res.json({ data: rows, meta: { page: query.page, size: query.size, total } });
      return;
    }
    const { rows, total } = await recordService.audit(callerOf(req), pageId, query, id);
    res.json({ data: rows, meta: { page: query.page, size: query.size, total } });
  },

  /** Live figures for computed fields: adjustment (system qty, rate) and transfer (available, rate). */
  preview: async (req: Request, res: Response): Promise<void> => {
    const { pageId } = validated(res, 'params', pageParamsSchema);
    const query = validated(res, 'query', previewQuerySchema);
    const caller = callerOf(req);
    if (pageId === 'inv-adjustment') {
      res.json({ data: await previewAdjustment(caller, query.itemId, query.warehouseId) });
    } else if (pageId === 'inv-transfer') {
      res.json({ data: await previewTransfer(caller, query.itemId, query.warehouseId) });
    } else {
      throw Errors.notFound('This page has no preview.');
    }
  },
};
