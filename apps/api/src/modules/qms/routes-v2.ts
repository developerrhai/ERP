// Routes of the Quality specification v2 (mounted inside the /qms router): Customer and Conformance NCR, Pending
// Acceptance, Rejection & Revoke, Template & Feature, COPQ, the centralized dashboard, All Data and Import.
import type { Request, RequestHandler, Response, Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../core/http/async-handler';
import { Errors } from '../../core/http/errors';
import { parseIfMatch } from '../../core/http/if-match';
import { validate, validated } from '../../core/http/validate';
import { accessUserOf, can, requirePageAction } from '../../core/rbac/access';
import type { Action } from '../../core/rbac/permission-model';
import { prisma } from '../../core/db/prisma';
import { callerOf, isoDate, pageQuery, uuid } from '../inventory/routes-shared';
import { norm, query } from '../procurement/core';
import { FEATURES, PRIORITIES, hasQualityOverride } from './common';
import type { FeatureKey } from './common';
import { copqService } from './copq-service';
import { DASHBOARD_PAGE, DRILLS, IMPORT_KINDS, dashboardService } from './dashboard-service';
import { FORMAT_TYPES, formatService } from './format-service';
import { PAGE_OF_NCR, STAGE_KEYS, ncrService } from './ncr-service';
import type { NcrType } from './ncr-service';
import { COST_CATEGORIES, registersService } from './registers-service';
import { REVOKE_PAGE, revokeService } from './revoke-service';

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM.');
const decimal = z
  .union([z.number(), z.string()])
  .transform((v) => String(v).trim())
  .refine((v) => v === '' || /^\d+(\.\d+)?$/.test(v), 'Enter a number.');
const txt = (n: number, min = 1) => z.string().trim().min(min, 'This is required.').max(n);
const opt = (n: number) => z.string().trim().max(n).nullable().optional();
const idp = z.object({ id: uuid }).strict();
const h = (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
  asyncHandler(async (req, res) => {
    await fn(req, res);
  });
const g = (page: string, a: Action): RequestHandler => requirePageAction(page, a);
const send = (res: Response, data: object, status = 200) => {
  const v = (data as { version?: unknown }).version;
  if (typeof v === 'number') res.set('ETag', `"${v}"`);
  res.status(status).json({ data });
};
async function need(req: Request, page: string, action: Action): Promise<void> {
  if (!req.auth || !(await can(accessUserOf(req.auth), page, action))) throw Errors.forbidden();
}
/** allowed on any one of these pages (Record Document Format opens from Incoming Quality and from Template & Feature) */
const anyOf = (pages: string[], action: Action): RequestHandler =>
  asyncHandler(async (req, _res, next) => {
    if (req.auth) for (const p of pages) if (await can(accessUserOf(req.auth), p, action)) return next();
    throw Errors.forbidden();
  });

export function mountQualityV2(router: Router): void {
  // ---------------------------------------------------------------- Customer NCR / Conformance NCR
  const typeZ = z.enum(['CUSTOMER', 'CONFORMANCE']);
  const ncrBody = z
    .object({
      ncrDate: isoDate.optional(),
      department: txt(60).optional(),
      priority: z.enum(PRIORITIES).optional(),
      result: z.enum(['CONFORMANCE', 'NON_CONFORMANCE']).optional(),
      customerId: uuid.nullable().optional(),
      itemId: uuid.nullable().optional(),
      reference: opt(60),
      process: opt(120),
      title: txt(200, 3),
      description: txt(2000, 3),
      qty: decimal.nullable().optional(),
      claimAmount: decimal.nullable().optional(),
      rootCause: opt(2000),
      correctiveAction: opt(2000),
      preventiveAction: opt(2000),
      ownerName: opt(120),
      targetDate: z.union([isoDate, z.literal('')]).nullable().optional(),
    })
    .strict();
  const createB = ncrBody.extend({ type: typeZ }).strict();
  router.post(
    '/qms/ncrs',
    validate({ body: createB }),
    h(async (req, res) => {
      const b = validated(res, 'body', createB);
      await need(req, PAGE_OF_NCR[b.type], 'add');
      send(res, await ncrService.create(callerOf(req), b), 201);
    }),
  );
  const listQ = z
    .object({
      type: typeZ,
      status: z.enum(['open', 'Open', 'Pending Acceptance', 'Closed', 'Cancelled']).optional(),
      priority: z.enum(PRIORITIES).optional(),
      customerId: uuid.optional(),
      ...pageQuery,
    })
    .strict();
  router.get(
    '/qms/ncrs',
    validate({ query: listQ }),
    h(async (req, res) => {
      const q = validated(res, 'query', listQ);
      await need(req, PAGE_OF_NCR[q.type], 'view');
      const r = await ncrService.list(callerOf(req), q.type, q);
      res.json({ data: r.rows, meta: { page: q.page, size: q.size, total: r.total } });
    }),
  );
  const typeQ = z.object({ type: typeZ, customerId: uuid.optional() }).strict();
  router.get(
    '/qms/ncrs/counts',
    validate({ query: typeQ }),
    h(async (req, res) => {
      const q = validated(res, 'query', typeQ);
      await need(req, PAGE_OF_NCR[q.type], 'view');
      send(res, await ncrService.counts(callerOf(req), q.type, q.customerId));
    }),
  );
  router.get(
    '/qms/ncrs/customers',
    g(PAGE_OF_NCR.CUSTOMER, 'view'),
    h(async (req, res) => send(res, { rows: await ncrService.customerSummary(callerOf(req)) })),
  );
  const gateQ = z.object({ customerId: uuid.optional(), ...pageQuery }).strict();
  router.get(
    '/qms/ncrs/gates',
    g(PAGE_OF_NCR.CUSTOMER, 'view'),
    validate({ query: gateQ }),
    h(async (req, res) => send(res, await ncrService.gates(callerOf(req), validated(res, 'query', gateQ)))),
  );
  const withNcr = (action: Action, fn: (req: Request, res: Response, type: NcrType) => Promise<void>): RequestHandler =>
    h(async (req, res) => {
      const type = await ncrService.typeOf(String(req.params.id));
      await need(req, PAGE_OF_NCR[type], action);
      await fn(req, res, type);
    });
  router.get(
    '/qms/ncrs/:id',
    validate({ params: idp }),
    withNcr('view', async (req, res, type) => send(res, await ncrService.get(callerOf(req), type, String(req.params.id)))),
  );
  const patchB = ncrBody.partial().strict();
  router.patch(
    '/qms/ncrs/:id',
    validate({ params: idp, body: patchB }),
    withNcr('edit', async (req, res, type) =>
      send(res, await ncrService.update(callerOf(req), type, String(req.params.id), parseIfMatch(req.get('if-match')), validated(res, 'body', patchB))),
    ),
  );
  const stageP = z.object({ id: uuid, key: z.enum(STAGE_KEYS) }).strict();
  const stageB = z.object({ text: z.string().max(2000), done: z.boolean() }).strict();
  router.put(
    '/qms/ncrs/:id/stages/:key',
    validate({ params: stageP, body: stageB }),
    withNcr('edit', async (req, res, type) => {
      if (type !== 'CUSTOMER') throw Errors.conflict('The 8D stages belong to a Customer NCR.');
      const p = validated(res, 'params', stageP);
      send(res, await ncrService.stage(callerOf(req), p.id, parseIfMatch(req.get('if-match')), p.key, validated(res, 'body', stageB)));
    }),
  );
  const noteB = z.object({ note: z.string().trim().max(500).optional() }).strict();
  router.post(
    '/qms/ncrs/:id/submit',
    validate({ params: idp, body: noteB }),
    withNcr('submit', async (req, res, type) =>
      send(res, await ncrService.submit(callerOf(req), type, String(req.params.id), validated(res, 'body', noteB).note)),
    ),
  );
  router.post(
    '/qms/ncrs/:id/accept',
    validate({ params: idp, body: noteB }),
    withNcr('approve', async (req, res, type) =>
      send(res, await ncrService.accept(callerOf(req), type, String(req.params.id), validated(res, 'body', noteB).note)),
    ),
  );
  const returnB = z.object({ comment: z.string().trim().min(3, 'Add a comment saying why the record is returned.').max(500) }).strict();
  router.post(
    '/qms/ncrs/:id/return',
    validate({ params: idp, body: returnB }),
    withNcr('approve', async (req, res, type) =>
      send(res, await ncrService.giveBack(callerOf(req), type, String(req.params.id), validated(res, 'body', returnB).comment)),
    ),
  );
  const cancelB = z.object({ reason: z.string().trim().min(3, 'Give the reason.').max(300) }).strict();
  router.post(
    '/qms/ncrs/:id/cancel',
    validate({ params: idp, body: cancelB }),
    withNcr('cancel', async (req, res, type) =>
      send(res, await ncrService.cancel(callerOf(req), type, String(req.params.id), validated(res, 'body', cancelB).reason)),
    ),
  );

  // ---------------------------------------------------------------- Priority tab: open incoming sheets by priority
  router.get(
    '/qms/incoming/queue',
    g('qms-incoming', 'view'),
    h(async (req, res) => {
      const caller = callerOf(req);
      const args: unknown[] = [];
      let unit = '';
      if (caller.ctx.unitId) {
        args.push(caller.ctx.unitId);
        unit = ' AND t.unit_id=$1::uuid';
      } else if (!caller.ctx.allUnits) unit = ' AND false';
      // unpaginated: only the sheets still open (draft or waiting), capped
      const rows = await query(
        prisma,
        `SELECT t.id::text AS id, t.number, to_char(t.doc_date,'YYYY-MM-DD') AS doc_date, t.status, t.priority, t.result, t.result_note,
            t.return_comment, t.version, t.lot_qty::text AS lot_qty, s.name AS supplier_name, i.name AS item_name, u.name AS inspector_name
          FROM qms_inspections t LEFT JOIN suppliers s ON s.id=t.supplier_id LEFT JOIN items i ON i.id=t.item_id LEFT JOIN users u ON u.id=t.inspector_id
         WHERE t.deleted_at IS NULL AND t.kind='INCOMING' AND t.status IN ('Draft','Submitted')${unit}
         ORDER BY CASE t.priority WHEN 'CRITICAL' THEN 0 WHEN 'MAJOR' THEN 1 WHEN 'MINOR' THEN 2 ELSE 3 END, t.doc_date, t.number LIMIT 200`,
        ...args,
      );
      send(res, { rows: rows.map((r) => norm(r)) });
    }),
  );

  // ---------------------------------------------------------------- Rejection & Revoke
  router.get(
    '/qms/revokes/counts',
    g(REVOKE_PAGE, 'view'),
    h(async (req, res) => {
      const caller = callerOf(req);
      send(res, { ...(await revokeService.counts(caller)), canOverride: hasQualityOverride(caller) });
    }),
  );
  router.get(
    '/qms/revokes/rejection/:id',
    g(REVOKE_PAGE, 'view'),
    validate({ params: idp }),
    h(async (req, res) => send(res, await revokeService.history(callerOf(req), String(req.params.id)))),
  );
  const askB = z.object({ rejectionId: uuid, reason: z.string().trim().max(500) }).strict();
  router.post(
    '/qms/revokes',
    g(REVOKE_PAGE, 'add'),
    validate({ body: askB }),
    h(async (req, res) => {
      const b = validated(res, 'body', askB);
      send(res, await revokeService.request(callerOf(req), b.rejectionId, b.reason), 201);
    }),
  );
  router.post(
    '/qms/revokes/override',
    g(REVOKE_PAGE, 'approve'),
    validate({ body: askB }),
    h(async (req, res) => {
      const b = validated(res, 'body', askB);
      send(res, await revokeService.override(callerOf(req), b.rejectionId, b.reason));
    }),
  );
  const decideB = z.object({ approved: z.boolean(), note: z.string().trim().max(500) }).strict();
  router.post(
    '/qms/revokes/:id/decide',
    g(REVOKE_PAGE, 'approve'),
    validate({ params: idp, body: decideB }),
    h(async (req, res) => {
      const b = validated(res, 'body', decideB);
      send(res, await revokeService.decide(callerOf(req), String(req.params.id), b.approved, b.note));
    }),
  );
  router.post(
    '/qms/revokes/:id/withdraw',
    g(REVOKE_PAGE, 'add'),
    validate({ params: idp }),
    h(async (req, res) => send(res, await revokeService.withdraw(callerOf(req), String(req.params.id)))),
  );

  // ---------------------------------------------------------------- Template & Feature / Record Document Format
  const DOC = ['qms-templates', 'qms-incoming'];
  router.get('/qms/categories', anyOf(DOC, 'view'), h(async (_req, res) => send(res, { rows: await formatService.categories() })));
  const catB = z.object({ name: txt(80, 2), description: opt(300) }).strict();
  router.post(
    '/qms/categories',
    anyOf(DOC, 'add'),
    validate({ body: catB }),
    h(async (req, res) => {
      const b = validated(res, 'body', catB);
      send(res, await formatService.createCategory(callerOf(req), b.name, b.description), 201);
    }),
  );
  const catU = catB.partial().extend({ status: z.enum(['ACTIVE', 'INACTIVE']).optional() }).strict();
  router.patch(
    '/qms/categories/:id',
    anyOf(DOC, 'edit'),
    validate({ params: idp, body: catU }),
    h(async (req, res) => send(res, await formatService.updateCategory(callerOf(req), String(req.params.id), validated(res, 'body', catU)))),
  );
  router.delete(
    '/qms/categories/:id',
    anyOf(DOC, 'delete'),
    validate({ params: idp }),
    h(async (req, res) => {
      await formatService.deleteCategory(callerOf(req), String(req.params.id));
      res.status(204).end();
    }),
  );
  const fmtB = z
    .object({
      type: z.enum(FORMAT_TYPES),
      categoryId: uuid.nullable().optional(),
      code: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9 _\-/.]{0,39}$/, 'Use letters, digits, space - _ / .'),
      title: txt(200, 3),
      revision: z.number().int().min(0).max(999).optional(),
      effectiveDate: z.union([isoDate, z.literal('')]).nullable().optional(),
      points: z.array(z.string().max(300)).max(100).optional(),
      notes: opt(1000),
    })
    .strict();
  router.post(
    '/qms/formats',
    anyOf(DOC, 'add'),
    validate({ body: fmtB }),
    h(async (req, res) => send(res, await formatService.create(callerOf(req), validated(res, 'body', fmtB)), 201)),
  );
  const fmtQ = z.object({ type: z.enum(FORMAT_TYPES).optional(), categoryId: uuid.optional(), q: z.string().trim().max(80).optional() }).strict();
  router.get(
    '/qms/formats',
    anyOf(DOC, 'view'),
    validate({ query: fmtQ }),
    h(async (req, res) => send(res, { rows: await formatService.list(validated(res, 'query', fmtQ)) })),
  );
  router.get(
    '/qms/formats/:id',
    anyOf(DOC, 'view'),
    validate({ params: idp }),
    h(async (req, res) => send(res, await formatService.get(String(req.params.id)))),
  );
  const fmtU = fmtB.omit({ type: true }).partial().extend({ status: z.enum(['ACTIVE', 'RETIRED']).optional() }).strict();
  router.patch(
    '/qms/formats/:id',
    anyOf(DOC, 'edit'),
    validate({ params: idp, body: fmtU }),
    h(async (req, res) =>
      send(res, await formatService.update(callerOf(req), String(req.params.id), parseIfMatch(req.get('if-match')), validated(res, 'body', fmtU))),
    ),
  );
  router.delete(
    '/qms/formats/:id',
    anyOf(DOC, 'delete'),
    validate({ params: idp }),
    h(async (req, res) => {
      await formatService.remove(callerOf(req), String(req.params.id));
      res.status(204).end();
    }),
  );
  router.get(
    '/qms/features',
    anyOf(['qms-templates', 'qms-incoming'], 'view'),
    h(async (_req, res) => send(res, { rows: await formatService.features() })),
  );
  const featP = z.object({ key: z.enum(Object.keys(FEATURES) as [FeatureKey, ...FeatureKey[]]) }).strict();
  const featB = z.object({ enabled: z.boolean() }).strict();
  router.put(
    '/qms/features/:key',
    g('qms-templates', 'controls'),
    validate({ params: featP, body: featB }),
    h(async (req, res) =>
      send(res, { rows: await formatService.setFeature(callerOf(req), validated(res, 'params', featP).key, validated(res, 'body', featB).enabled) }),
    ),
  );

  // ---------------------------------------------------------------- COPQ
  const copqQ = z.object({ from: month, to: month }).strict();
  router.get(
    '/qms/copq',
    g('qms-copq', 'view'),
    validate({ query: copqQ }),
    h(async (req, res) => {
      const q = validated(res, 'query', copqQ);
      send(res, await copqService.report(callerOf(req), q.from, q.to));
    }),
  );
  const costB = z.object({ month, category: z.enum(COST_CATEGORIES), description: txt(200, 3), amount: decimal }).strict();
  router.post(
    '/qms/copq/costs',
    g('qms-copq', 'add'),
    validate({ body: costB }),
    h(async (req, res) => send(res, await registersService.addCost(callerOf(req), 'qms-copq', validated(res, 'body', costB)), 201)),
  );
  router.delete(
    '/qms/copq/costs/:id',
    g('qms-copq', 'delete'),
    validate({ params: idp }),
    h(async (req, res) => {
      await registersService.deleteCost(callerOf(req), 'qms-copq', String(req.params.id));
      res.status(204).end();
    }),
  );

  // ---------------------------------------------------------------- centralized dashboard, All Data, Import
  const dashQ = z
    .object({
      from: isoDate.optional(),
      to: isoDate.optional(),
      department: z.string().trim().max(60).optional(),
      drill: z.enum(DRILLS).optional(),
      machine: z.string().trim().max(120).optional(),
    })
    .strict();
  router.get(
    '/qms/dashboard',
    g(DASHBOARD_PAGE, 'view'),
    validate({ query: dashQ }),
    h(async (req, res) => send(res, await dashboardService.summary(callerOf(req), validated(res, 'query', dashQ)))),
  );
  const allQ = z
    .object({
      q: z.string().trim().max(80).optional(),
      type: z.string().trim().max(40).optional(),
      department: z.string().trim().max(60).optional(),
      ...pageQuery,
    })
    .strict();
  router.get(
    '/qms/all-data',
    g(DASHBOARD_PAGE, 'view'),
    validate({ query: allQ }),
    h(async (req, res) => {
      const q = validated(res, 'query', allQ);
      const r = await dashboardService.allData(callerOf(req), q);
      res.json({ data: r.rows, meta: { page: q.page, size: q.size, total: r.total, types: r.types } });
    }),
  );
  const importB = z
    .object({
      kind: z.enum(IMPORT_KINDS),
      rows: z.array(z.record(z.string().max(2000))).min(1, 'The file has no rows.').max(200, 'Import at most 200 rows at a time.'),
    })
    .strict();
  router.post(
    '/qms/import',
    validate({ body: importB }),
    h(async (req, res) => {
      const b = validated(res, 'body', importB);
      send(res, await dashboardService.importRows(callerOf(req), b.kind, b.rows));
    }),
  );
}
