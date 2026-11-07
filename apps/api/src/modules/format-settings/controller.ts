// HTTP layer of the Format & Settings API: reads the validated input, calls ONE service method.
import type { Request, Response } from 'express';
import { requestMeta, requireAuth } from '../../core/auth/auth-context';
import { parseIfMatch } from '../../core/http/if-match';
import { readSingleFile } from '../../core/http/multipart';
import { validated } from '../../core/http/validate';
import { runIdempotent } from '../approvals/idempotent';
import { FormatService } from './resolve';
import {
  changesQuerySchema,
  codeParamsSchema,
  evaluateBodySchema,
  formatKeyQuerySchema,
  formatVersionsQuerySchema,
  globalIdParamsSchema,
  idParamsSchema,
  importQuerySchema,
  listAllQuerySchema,
  optionalReasonBodySchema,
  pageParamsSchema,
  reasonBodySchema,
  resolveQuerySchema,
  saveFormatBodySchema,
  saveRuleBodySchema,
  templateQuerySchema,
} from './schemas';
import { formatSettingsService as svc } from './service';
import type { Actor } from './service';
import type { Target } from './repository';

const actorOf = (req: Request): Actor => ({ auth: requireAuth(req), meta: requestMeta(req) });
const IMPORT_MAX_BYTES = 5 * 1024 * 1024;

function lifecycle(target: Target) {
  return {
    publish: async (req: Request, res: Response): Promise<void> => {
      const { pageId, id } = validated(res, 'params', idParamsSchema);
      const { reason } = validated(res, 'body', reasonBodySchema);
      const expected = parseIfMatch(req.get('if-match'));
      const actor = actorOf(req);
      await runIdempotent(
        req,
        res,
        actor.auth.userId,
        `settings:publish:${id}`,
        [pageId, id, expected, reason],
        (key) => svc.publish(actor, pageId, target, id, expected, reason, key),
      );
    },
    retire: async (req: Request, res: Response): Promise<void> => {
      const { pageId, id } = validated(res, 'params', idParamsSchema);
      const { reason } = validated(res, 'body', reasonBodySchema);
      const expected = parseIfMatch(req.get('if-match'));
      const actor = actorOf(req);
      await runIdempotent(
        req,
        res,
        actor.auth.userId,
        `settings:retire:${id}`,
        [pageId, id, expected, reason],
        () => svc.retire(actor, pageId, target, id, expected, reason),
      );
    },
    restore: async (req: Request, res: Response): Promise<void> => {
      const { pageId, id } = validated(res, 'params', idParamsSchema);
      const { reason } = validated(res, 'body', optionalReasonBodySchema);
      const actor = actorOf(req);
      await runIdempotent(
        req,
        res,
        actor.auth.userId,
        `settings:restore:${id}`,
        [pageId, id, reason ?? null],
        () => svc.restore(actor, pageId, target, id, reason),
      );
    },
    discard: async (req: Request, res: Response): Promise<void> => {
      const { pageId, id } = validated(res, 'params', idParamsSchema);
      const expected = parseIfMatch(req.get('if-match'));
      await svc.discard(actorOf(req), pageId, target, id, expected);
      res.status(204).end();
    },
  };
}

export const formatSettingsController = {
  // ---- formats -----------------------------------------------------------------------------------
  listFormats: async (req: Request, res: Response): Promise<void> => {
    const { pageId } = validated(res, 'params', pageParamsSchema);
    const { kind } = validated(res, 'query', formatKeyQuerySchema);
    const { access, items } = await svc.listPage(requireAuth(req), pageId, 'FORMAT', kind);
    res.set('Cache-Control', 'no-store').json({
      data: items,
      meta: { ownerDepartment: access.ownerDepartment, canEdit: access.canEdit },
    });
  },
  resolveFormat: async (req: Request, res: Response): Promise<void> => {
    const { pageId } = validated(res, 'params', pageParamsSchema);
    const q = validated(res, 'query', resolveQuerySchema);
    await svc.access(requireAuth(req), pageId);
    const format = await FormatService.resolve(pageId, q.kind, q);
    res.set('Cache-Control', 'no-store').json({ data: format });
  },
  formatVersions: async (req: Request, res: Response): Promise<void> => {
    const { pageId } = validated(res, 'params', pageParamsSchema);
    const q = validated(res, 'query', formatVersionsQuerySchema);
    const data = await svc.versions(requireAuth(req), pageId, {
      target: 'FORMAT',
      pageId,
      kind: q.kind,
      customerId: q.customerId ?? null,
      unitId: q.unitId ?? null,
    });
    res.set('Cache-Control', 'no-store').json({ data });
  },
  saveFormat: async (req: Request, res: Response): Promise<void> => {
    const { pageId } = validated(res, 'params', pageParamsSchema);
    const body = validated(res, 'body', saveFormatBodySchema);
    const expected = parseIfMatch(req.get('if-match'));
    const actor = actorOf(req);
    await runIdempotent(
      req,
      res,
      actor.auth.userId,
      `settings:format:${pageId}`,
      [pageId, body, expected],
      () => svc.saveFormat(actor, pageId, body, expected),
    );
  },
  formats: lifecycle('FORMAT'),

  // ---- rule sets ---------------------------------------------------------------------------------
  listRules: async (req: Request, res: Response): Promise<void> => {
    const { pageId } = validated(res, 'params', pageParamsSchema);
    const { access, items } = await svc.listPage(requireAuth(req), pageId, 'RULE_SET');
    res.set('Cache-Control', 'no-store').json({
      data: items,
      meta: {
        ownerDepartment: access.ownerDepartment,
        canEdit: access.canEdit,
        approvalRequired: access.approvalRequired,
      },
    });
  },
  ruleVersions: async (req: Request, res: Response): Promise<void> => {
    const { pageId, code } = validated(res, 'params', codeParamsSchema);
    const data = await svc.versions(requireAuth(req), pageId, { target: 'RULE_SET', pageId, code });
    res.set('Cache-Control', 'no-store').json({ data });
  },
  saveRule: async (req: Request, res: Response): Promise<void> => {
    const { pageId } = validated(res, 'params', pageParamsSchema);
    const body = validated(res, 'body', saveRuleBodySchema);
    const expected = parseIfMatch(req.get('if-match'));
    const actor = actorOf(req);
    await runIdempotent(
      req,
      res,
      actor.auth.userId,
      `settings:rule:${pageId}`,
      [pageId, body, expected],
      () => svc.saveRule(actor, pageId, body, expected),
    );
  },
  evaluate: async (req: Request, res: Response): Promise<void> => {
    const { pageId } = validated(res, 'params', pageParamsSchema);
    const body = validated(res, 'body', evaluateBodySchema);
    res
      .set('Cache-Control', 'no-store')
      .json({ data: await svc.evaluate(requireAuth(req), pageId, body) });
  },
  rules: lifecycle('RULE_SET'),

  // ---- Excel -------------------------------------------------------------------------------------
  template: async (_req: Request, res: Response): Promise<void> => {
    const { target } = validated(res, 'query', templateQuerySchema);
    const { buffer, filename } = await svc.template(target);
    res
      .set({
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      })
      .send(buffer);
  },
  importExcel: async (req: Request, res: Response): Promise<void> => {
    const { pageId } = validated(res, 'params', pageParamsSchema);
    const q = validated(res, 'query', importQuerySchema);
    const upload = await readSingleFile(req, IMPORT_MAX_BYTES);
    const data = await svc.importExcel(actorOf(req), pageId, q, upload.file);
    res.status(data.draft ? 201 : 200).json({ data });
  },

  // ---- admin-formats (global) --------------------------------------------------------------------
  listAll: async (_req: Request, res: Response): Promise<void> => {
    const q = validated(res, 'query', listAllQuerySchema);
    const { items, total } = await svc.listAll({
      q: q.q,
      pageId: q.pageId,
      type: q.type,
      status: q.status,
      offset: (q.page - 1) * q.size,
      limit: q.size,
    });
    res
      .set('Cache-Control', 'no-store')
      .json({ data: items, meta: { page: q.page, size: q.size, total } });
  },
  versionsById: async (_req: Request, res: Response): Promise<void> => {
    const { id } = validated(res, 'params', globalIdParamsSchema);
    res.set('Cache-Control', 'no-store').json({ data: await svc.versionsById(id) });
  },
  changes: async (_req: Request, res: Response): Promise<void> => {
    const q = validated(res, 'query', changesQuerySchema);
    const { items, total } = await svc.changes({
      pageId: q.pageId,
      offset: (q.page - 1) * q.size,
      limit: q.size,
    });
    res
      .set('Cache-Control', 'no-store')
      .json({ data: items, meta: { page: q.page, size: q.size, total } });
  },
};
