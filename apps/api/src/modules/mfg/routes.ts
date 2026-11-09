// Phase 13 API (/api/v1/mfg, ERRATA E-26). authenticate -> requirePasswordChanged -> resolveContext -> permission -> zod ->
// service. The permission page follows the screen: work centres mfg-workcenters, BOM mfg-bom, routing mfg-routing, daily
// board mfg-plan, production orders and the job-work registers mfg-orders, MRP mfg-mrp, operations mfg-workorders, finished
// goods mfg-fg, scrap mfg-scrap, rework and the challan rework register mfg-rework, WIP mfg-wip, costing mfg-costing,
// dashboard mfg-shopfloor.
import { Router } from 'express';
import type { Request, RequestHandler, Response } from 'express';
import { z } from 'zod';
import { authenticate, requirePasswordChanged } from '../../core/auth/authenticate';
import { resolveContext } from '../../core/context/resolve-context';
import { asyncHandler } from '../../core/http/async-handler';
import { parseIfMatch } from '../../core/http/if-match';
import { validate, validated } from '../../core/http/validate';
import { Errors } from '../../core/http/errors';
import { accessUserOf, can, requirePageAction } from '../../core/rbac/access';
import type { Action } from '../../core/rbac/permission-model';
import { runIdempotent } from '../approvals/idempotent';
import { callerOf, isoDate, pageQuery, uuid } from '../inventory/routes-shared';
import { boardService } from './board-service';
import {
  REPORTS,
  assertReport,
  bomPdf,
  mrpPdf,
  mrpWorkbook,
  orderPdf,
  reportWorkbook,
  routingPdf,
} from './export-service';
import { WORK_CENTRE_KINDS, masterService } from './master-service';
import { mrpService } from './mrp-service';
import { orderService } from './order-service';
import { reportsService } from './reports-service';

const num = z
  .union([z.number(), z.string()])
  .transform((v) => String(v))
  .refine((v) => /^\d+(\.\d+)?$/.test(v), 'Enter a number.');
const pos = num.refine((v) => Number(v) > 0, 'Enter a number greater than 0.');
const hours = num.refine(
  (v) => Number(v) > 0 && Number(v) <= 24,
  'Hours per day: more than 0, up to 24.',
);
const mins = num.refine((v) => Number(v) <= 1000000, 'That is too large.');
const txt = (n: number) => z.string().trim().min(1, 'This is required.').max(n);
const opt = (n: number) => z.string().trim().max(n).optional();
const idp = z.object({ id: uuid }).strict();
const h = (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
  asyncHandler(async (req, res) => {
    await fn(req, res);
  });
const g = (page: string, a: Action): RequestHandler => requirePageAction(page, a);
const me = (req: Request): string => req.auth!.userId;
const ver = (req: Request) => parseIfMatch(req.get('if-match'));

export function createMfgRouter(): Router {
  const router = Router();
  router.use('/mfg', authenticate, requirePasswordChanged, resolveContext);
  const send = (res: Response, data: object, status = 200) => {
    const v = (data as { version?: number }).version;
    if (v !== undefined) res.set('ETag', `"${v}"`);
    res.status(status).json({ data });
  };
  const paged = (
    res: Response,
    rows: unknown[],
    total: number,
    page: number,
    size: number,
    extra = {},
  ) => res.json({ data: rows, meta: { page, size, total, ...extra } });
  /** state-changing document actions: replays with the same Idempotency-Key answer the first result */
  const idem = async (
    req: Request,
    res: Response,
    scope: string,
    parts: unknown[],
    fn: () => Promise<{ version?: unknown } & object>,
  ) =>
    runIdempotent(
      req,
      res,
      me(req),
      `${scope}:${req.ctx?.unitId ?? 'all'}`,
      [req.path, ...parts],
      async () => {
        const r = await fn();
        return { ...r, version: Number((r as { version?: unknown }).version ?? 0) };
      },
    );

  // ---------------------------------------------------------------- work centres
  const wcQ = z
    .object({ q: opt(80), status: z.enum(['ACTIVE', 'INACTIVE']).optional(), ...pageQuery })
    .strict();
  router.get(
    '/mfg/work-centres',
    g('mfg-workcenters', 'view'),
    validate({ query: wcQ }),
    h(async (req, res) => {
      const q = validated(res, 'query', wcQ);
      const r = await masterService.listWorkCentres(callerOf(req), 'mfg-workcenters', q);
      paged(res, r.rows, r.total, q.page, q.size);
    }),
  );
  const wcB = z
    .object({
      code: z
        .string()
        .trim()
        .regex(/^[A-Za-z0-9][A-Za-z0-9_\-/]{0,29}$/, 'Use letters, digits, - _ /.'),
      name: txt(120),
      kind: z.enum(WORK_CENTRE_KINDS).optional(),
      capacityHours: hours.optional(),
      costPerHour: num.optional(),
      assetRef: opt(60),
      notes: opt(300),
    })
    .strict();
  router.post(
    '/mfg/work-centres',
    g('mfg-workcenters', 'add'),
    validate({ body: wcB }),
    h(async (req, res) =>
      send(
        res,
        await masterService.createWorkCentre(
          callerOf(req),
          'mfg-workcenters',
          validated(res, 'body', wcB),
        ),
        201,
      ),
    ),
  );
  const wcU = wcB
    .omit({ code: true })
    .partial()
    .extend({ status: z.enum(['ACTIVE', 'INACTIVE']).optional() })
    .strict();
  router.patch(
    '/mfg/work-centres/:id',
    g('mfg-workcenters', 'edit'),
    validate({ params: idp, body: wcU }),
    h(async (req, res) =>
      send(
        res,
        await masterService.updateWorkCentre(
          callerOf(req),
          'mfg-workcenters',
          String(req.params.id),
          ver(req),
          validated(res, 'body', wcU),
        ),
      ),
    ),
  );

  // ---------------------------------------------------------------- BOM
  const bomQ = z
    .object({
      itemId: uuid.optional(),
      status: z.enum(['DRAFT', 'ACTIVE', 'RETIRED']).optional(),
      q: opt(80),
      ...pageQuery,
    })
    .strict();
  router.get(
    '/mfg/boms',
    g('mfg-bom', 'view'),
    validate({ query: bomQ }),
    h(async (req, res) => {
      const q = validated(res, 'query', bomQ);
      const r = await masterService.listBoms(callerOf(req), 'mfg-bom', q);
      paged(res, r.rows, r.total, q.page, q.size);
    }),
  );
  router.get(
    '/mfg/boms/:id',
    g('mfg-bom', 'view'),
    validate({ params: idp }),
    h(async (req, res) =>
      send(res, await masterService.getBom(callerOf(req), 'mfg-bom', String(req.params.id))),
    ),
  );
  const bomLine = z
    .object({ itemId: uuid, qtyPer: num, scrapPct: num.optional(), notes: opt(200) })
    .strict();
  const bomB = z
    .object({
      itemId: uuid,
      baseQty: pos.optional(),
      notes: opt(300),
      lines: z.array(bomLine).min(1).max(300),
    })
    .strict();
  router.post(
    '/mfg/boms',
    g('mfg-bom', 'add'),
    validate({ body: bomB }),
    h(async (req, res) =>
      send(
        res,
        await masterService.createBom(callerOf(req), 'mfg-bom', validated(res, 'body', bomB)),
        201,
      ),
    ),
  );
  const bomU = z
    .object({
      baseQty: pos.optional(),
      notes: opt(300),
      lines: z.array(bomLine).min(1).max(300).optional(),
    })
    .strict();
  router.patch(
    '/mfg/boms/:id',
    g('mfg-bom', 'edit'),
    validate({ params: idp, body: bomU }),
    h(async (req, res) =>
      send(
        res,
        await masterService.updateBom(
          callerOf(req),
          'mfg-bom',
          String(req.params.id),
          ver(req),
          validated(res, 'body', bomU),
        ),
      ),
    ),
  );
  router.post(
    '/mfg/boms/:id/activate',
    g('mfg-bom', 'approve'),
    validate({ params: idp }),
    h(async (req, res) =>
      send(
        res,
        await masterService.activateBom(callerOf(req), 'mfg-bom', String(req.params.id), ver(req)),
      ),
    ),
  );
  router.post(
    '/mfg/boms/:id/retire',
    g('mfg-bom', 'approve'),
    validate({ params: idp }),
    h(async (req, res) =>
      send(
        res,
        await masterService.retireBom(callerOf(req), 'mfg-bom', String(req.params.id), ver(req)),
      ),
    ),
  );
  router.post(
    '/mfg/boms/:id/new-version',
    g('mfg-bom', 'add'),
    validate({ params: idp }),
    h(async (req, res) =>
      send(
        res,
        await masterService.newBomVersion(callerOf(req), 'mfg-bom', String(req.params.id)),
        201,
      ),
    ),
  );

  // ---------------------------------------------------------------- routing
  router.get(
    '/mfg/routings',
    g('mfg-routing', 'view'),
    validate({ query: bomQ }),
    h(async (req, res) => {
      const q = validated(res, 'query', bomQ);
      const r = await masterService.listRoutings(callerOf(req), 'mfg-routing', q);
      paged(res, r.rows, r.total, q.page, q.size);
    }),
  );
  router.get(
    '/mfg/routings/:id',
    g('mfg-routing', 'view'),
    validate({ params: idp }),
    h(async (req, res) =>
      send(
        res,
        await masterService.getRouting(callerOf(req), 'mfg-routing', String(req.params.id)),
      ),
    ),
  );
  const opZ = z
    .object({
      seq: z.number().int().min(1).max(9999),
      name: txt(120),
      workCentreId: uuid,
      setupMinutes: mins.optional(),
      runMinutes: mins.optional(),
      inspectionRequired: z.boolean().optional(),
    })
    .strict();
  const rtB = z
    .object({ itemId: uuid, notes: opt(300), ops: z.array(opZ).min(1).max(100) })
    .strict();
  router.post(
    '/mfg/routings',
    g('mfg-routing', 'add'),
    validate({ body: rtB }),
    h(async (req, res) =>
      send(
        res,
        await masterService.createRouting(
          callerOf(req),
          'mfg-routing',
          validated(res, 'body', rtB),
        ),
        201,
      ),
    ),
  );
  const rtU = z.object({ notes: opt(300), ops: z.array(opZ).min(1).max(100).optional() }).strict();
  router.patch(
    '/mfg/routings/:id',
    g('mfg-routing', 'edit'),
    validate({ params: idp, body: rtU }),
    h(async (req, res) =>
      send(
        res,
        await masterService.updateRouting(
          callerOf(req),
          'mfg-routing',
          String(req.params.id),
          ver(req),
          validated(res, 'body', rtU),
        ),
      ),
    ),
  );
  router.post(
    '/mfg/routings/:id/activate',
    g('mfg-routing', 'approve'),
    validate({ params: idp }),
    h(async (req, res) =>
      send(
        res,
        await masterService.activateRouting(
          callerOf(req),
          'mfg-routing',
          String(req.params.id),
          ver(req),
        ),
      ),
    ),
  );
  router.post(
    '/mfg/routings/:id/retire',
    g('mfg-routing', 'approve'),
    validate({ params: idp }),
    h(async (req, res) =>
      send(
        res,
        await masterService.retireRouting(
          callerOf(req),
          'mfg-routing',
          String(req.params.id),
          ver(req),
        ),
      ),
    ),
  );
  router.post(
    '/mfg/routings/:id/new-version',
    g('mfg-routing', 'add'),
    validate({ params: idp }),
    h(async (req, res) =>
      send(
        res,
        await masterService.newRoutingVersion(callerOf(req), 'mfg-routing', String(req.params.id)),
        201,
      ),
    ),
  );

  // ---------------------------------------------------------------- production orders
  const ordQ = z
    .object({
      status: z
        .enum(['Planned', 'Released', 'In Progress', 'Completed', 'Closed', 'Cancelled'])
        .optional(),
      itemId: uuid.optional(),
      q: opt(80),
      from: isoDate.optional(),
      to: isoDate.optional(),
      ...pageQuery,
    })
    .strict();
  /** one list, three screens: orders, operations (work orders) and finished goods read the same rows */
  for (const page of ['mfg-orders', 'mfg-workorders', 'mfg-fg', 'mfg-wip', 'mfg-scrap'] as const) {
    router.get(
      `/mfg/orders${page === 'mfg-orders' ? '' : `/for/${page}`}`,
      g(page, 'view'),
      validate({ query: ordQ }),
      h(async (req, res) => {
        const q = validated(res, 'query', ordQ);
        const r = await orderService.list(callerOf(req), page, q);
        paged(res, r.rows, r.total, q.page, q.size);
      }),
    );
    router.get(
      `/mfg/orders/for/${page}/:id`,
      g(page, 'view'),
      validate({ params: idp }),
      h(async (req, res) =>
        send(res, await orderService.get(callerOf(req), page, String(req.params.id))),
      ),
    );
  }
  router.get(
    '/mfg/orders/:id',
    g('mfg-orders', 'view'),
    validate({ params: idp }),
    h(async (req, res) =>
      send(res, await orderService.get(callerOf(req), 'mfg-orders', String(req.params.id))),
    ),
  );
  const ordB = z
    .object({
      itemId: uuid,
      qty: num,
      dueDate: isoDate,
      startDate: isoDate.optional(),
      customerId: uuid.optional(),
      customerPoNo: opt(60),
      warehouseId: uuid,
      rmWarehouseId: uuid,
      notes: opt(300),
    })
    .strict();
  router.post(
    '/mfg/orders',
    g('mfg-orders', 'add'),
    validate({ body: ordB }),
    h(async (req, res) =>
      send(
        res,
        await orderService.create(callerOf(req), 'mfg-orders', validated(res, 'body', ordB)),
        201,
      ),
    ),
  );
  const ordU = ordB.omit({ itemId: true }).partial().strict();
  router.patch(
    '/mfg/orders/:id',
    g('mfg-orders', 'edit'),
    validate({ params: idp, body: ordU }),
    h(async (req, res) =>
      send(
        res,
        await orderService.update(
          callerOf(req),
          'mfg-orders',
          String(req.params.id),
          ver(req),
          validated(res, 'body', ordU),
        ),
      ),
    ),
  );
  router.post(
    '/mfg/orders/:id/release',
    g('mfg-orders', 'approve'),
    validate({ params: idp }),
    h(async (req, res) =>
      send(
        res,
        await orderService.release(callerOf(req), 'mfg-orders', String(req.params.id), ver(req)),
      ),
    ),
  );
  const cancelB = z
    .object({ reason: z.string().trim().min(3, 'Give the reason.').max(300) })
    .strict();
  router.post(
    '/mfg/orders/:id/cancel',
    g('mfg-orders', 'cancel'),
    validate({ params: idp, body: cancelB }),
    h(async (req, res) =>
      send(
        res,
        await orderService.cancel(
          callerOf(req),
          'mfg-orders',
          String(req.params.id),
          ver(req),
          validated(res, 'body', cancelB).reason,
        ),
      ),
    ),
  );
  const closeB = z.object({ note: opt(300) }).strict();
  router.post(
    '/mfg/orders/:id/close',
    g('mfg-orders', 'post'),
    validate({ params: idp, body: closeB }),
    h(async (req, res) =>
      send(
        res,
        await orderService.close(
          callerOf(req),
          'mfg-orders',
          String(req.params.id),
          ver(req),
          validated(res, 'body', closeB).note,
        ),
      ),
    ),
  );
  const issueB = z
    .object({
      lines: z
        .array(
          z
            .object({
              materialId: uuid,
              qty: num,
              batchNo: opt(60),
              serialNos: z.array(z.string().trim().min(1).max(60)).max(500).optional(),
              customerLotId: uuid.optional(),
            })
            .strict(),
        )
        .min(1)
        .max(200),
    })
    .strict();
  router.post(
    '/mfg/orders/:id/issue',
    g('mfg-orders', 'post'),
    validate({ params: idp, body: issueB }),
    h(async (req, res) => {
      const b = validated(res, 'body', issueB);
      const id = String(req.params.id);
      await idem(req, res, 'mfg-issue', [id, b], () =>
        orderService.issue(callerOf(req), 'mfg-orders', id, b.lines),
      );
    }),
  );
  const returnB = z
    .object({
      lines: z
        .array(z.object({ materialId: uuid, qty: num, batchNo: opt(60) }).strict())
        .min(1)
        .max(200),
    })
    .strict();
  router.post(
    '/mfg/orders/:id/return',
    g('mfg-orders', 'post'),
    validate({ params: idp, body: returnB }),
    h(async (req, res) => {
      const b = validated(res, 'body', returnB);
      const id = String(req.params.id);
      await idem(req, res, 'mfg-return', [id, b], () =>
        orderService.returnMaterial(callerOf(req), 'mfg-orders', id, b.lines),
      );
    }),
  );

  // ---------------------------------------------------------------- operations (work orders)
  const opP = z.object({ id: uuid, opId: uuid }).strict();
  const logB = z
    .object({
      good: num.optional(),
      scrap: num.optional(),
      rework: num.optional(),
      minutes: num.optional(),
      operator: opt(80),
      reason: opt(200),
      note: opt(200),
      fromGood: z.boolean().optional(),
      logDate: isoDate.optional(),
    })
    .strict();
  router.post(
    '/mfg/orders/:id/ops/:opId/log',
    g('mfg-workorders', 'edit'),
    validate({ params: opP, body: logB }),
    h(async (req, res) => {
      const b = validated(res, 'body', logB);
      const id = String(req.params.id);
      const opId = String(req.params.opId);
      await idem(req, res, 'mfg-log', [id, opId, b], () =>
        orderService.logOperation(callerOf(req), 'mfg-workorders', id, opId, b),
      );
    }),
  );
  router.post(
    '/mfg/orders/:id/ops/:opId/complete',
    g('mfg-workorders', 'edit'),
    validate({ params: opP }),
    h(async (req, res) => {
      const id = String(req.params.id);
      const opId = String(req.params.opId);
      await idem(req, res, 'mfg-opdone', [id, opId], () =>
        orderService.completeOperation(callerOf(req), 'mfg-workorders', id, opId),
      );
    }),
  );
  const lotB = z.object({ lotQty: num.optional() }).strict();
  router.post(
    '/mfg/orders/:id/ops/:opId/inspection',
    g('mfg-workorders', 'edit'),
    validate({ params: opP, body: lotB }),
    h(async (req, res) => {
      const b = validated(res, 'body', lotB);
      const id = String(req.params.id);
      const opId = String(req.params.opId);
      await idem(req, res, 'mfg-oplot', [id, opId, b], () =>
        orderService.createOpLot(callerOf(req), 'mfg-workorders', id, opId, b.lotQty),
      );
    }),
  );

  // ---------------------------------------------------------------- finished goods
  router.post(
    '/mfg/orders/:id/fg-lots',
    g('mfg-fg', 'add'),
    validate({ params: idp, body: lotB }),
    h(async (req, res) => {
      const b = validated(res, 'body', lotB);
      const id = String(req.params.id);
      await idem(req, res, 'mfg-fglot', [id, b], () =>
        orderService.createFgLot(callerOf(req), 'mfg-fg', id, b.lotQty),
      );
    }),
  );
  const recvB = z
    .object({
      lotId: uuid,
      qty: num,
      batchNo: opt(60),
      serialNos: z.array(z.string().trim().min(1).max(60)).max(500).optional(),
    })
    .strict();
  router.post(
    '/mfg/orders/:id/receive',
    g('mfg-fg', 'post'),
    validate({ params: idp, body: recvB }),
    h(async (req, res) => {
      const b = validated(res, 'body', recvB);
      const id = String(req.params.id);
      await idem(req, res, 'mfg-receive', [id, b], () =>
        orderService.receiveFg(callerOf(req), 'mfg-fg', id, b),
      );
    }),
  );

  // ---------------------------------------------------------------- scrap and rework
  const scrapQ = z
    .object({
      orderId: uuid.optional(),
      from: isoDate.optional(),
      to: isoDate.optional(),
      q: opt(80),
      ...pageQuery,
    })
    .strict();
  router.get(
    '/mfg/scrap',
    g('mfg-scrap', 'view'),
    validate({ query: scrapQ }),
    h(async (req, res) => {
      const q = validated(res, 'query', scrapQ);
      const r = await reportsService.listScrap(callerOf(req), 'mfg-scrap', q);
      paged(res, r.rows, r.total, q.page, q.size, { totalQty: r.totalQty });
    }),
  );
  const scrapB = z
    .object({
      orderId: uuid,
      opId: uuid,
      qty: num,
      reason: txt(200),
      operator: opt(80),
      fromGood: z.boolean().optional(),
    })
    .strict();
  router.post(
    '/mfg/scrap',
    g('mfg-scrap', 'add'),
    validate({ body: scrapB }),
    h(async (req, res) => {
      const b = validated(res, 'body', scrapB);
      await idem(req, res, 'mfg-scrap', [b], () =>
        orderService.logOperation(callerOf(req), 'mfg-scrap', b.orderId, b.opId, {
          scrap: b.qty,
          reason: b.reason,
          ...(b.operator ? { operator: b.operator } : {}),
          ...(b.fromGood ? { fromGood: true } : {}),
        }),
      );
    }),
  );
  const rwQ = z
    .object({
      status: z.enum(['Open', 'Done']).optional(),
      orderId: uuid.optional(),
      q: opt(80),
      ...pageQuery,
    })
    .strict();
  router.get(
    '/mfg/rework',
    g('mfg-rework', 'view'),
    validate({ query: rwQ }),
    h(async (req, res) => {
      const q = validated(res, 'query', rwQ);
      const r = await reportsService.listRework(callerOf(req), 'mfg-rework', q);
      paged(res, r.rows, r.total, q.page, q.size);
    }),
  );
  const rwFin = z
    .object({ qtyOk: num, qtyScrap: num, minutes: mins.optional(), note: opt(200) })
    .strict();
  router.post(
    '/mfg/rework/:id/finish',
    g('mfg-rework', 'edit'),
    validate({ params: idp, body: rwFin }),
    h(async (req, res) => {
      const b = validated(res, 'body', rwFin);
      const id = String(req.params.id);
      await idem(req, res, 'mfg-rwfin', [id, b], () =>
        orderService.finishRework(callerOf(req), 'mfg-rework', id, b),
      );
    }),
  );

  // ---------------------------------------------------------------- WIP, costing, dashboard
  const pgQ = z.object({ ...pageQuery }).strict();
  router.get(
    '/mfg/wip',
    g('mfg-wip', 'view'),
    validate({ query: pgQ }),
    h(async (req, res) => {
      const q = validated(res, 'query', pgQ);
      const r = await reportsService.wip(callerOf(req), 'mfg-wip', q);
      paged(res, r.rows, r.total, q.page, q.size, { totalValue: r.totalValue });
    }),
  );
  const costQ = z
    .object({
      status: z.enum(['Released', 'In Progress', 'Completed', 'Closed']).optional(),
      q: opt(80),
      ...pageQuery,
    })
    .strict();
  router.get(
    '/mfg/costing',
    g('mfg-costing', 'view'),
    validate({ query: costQ }),
    h(async (req, res) => {
      const q = validated(res, 'query', costQ);
      const r = await reportsService.costing(callerOf(req), 'mfg-costing', q);
      paged(res, r.rows, r.total, q.page, q.size);
    }),
  );
  router.get(
    '/mfg/shopfloor',
    g('mfg-shopfloor', 'view'),
    h(async (req, res) =>
      send(res, await reportsService.shopFloor(callerOf(req), 'mfg-shopfloor')),
    ),
  );

  // ---------------------------------------------------------------- MRP
  const mrpQ = z
    .object({ status: z.enum(['Draft', 'Applied', 'Cancelled']).optional(), ...pageQuery })
    .strict();
  router.get(
    '/mfg/mrp',
    g('mfg-mrp', 'view'),
    validate({ query: mrpQ }),
    h(async (req, res) => {
      const q = validated(res, 'query', mrpQ);
      const r = await mrpService.list(callerOf(req), 'mfg-mrp', q);
      paged(res, r.rows, r.total, q.page, q.size);
    }),
  );
  router.get(
    '/mfg/mrp/:id',
    g('mfg-mrp', 'view'),
    validate({ params: idp }),
    h(async (req, res) =>
      send(res, await mrpService.get(callerOf(req), 'mfg-mrp', String(req.params.id))),
    ),
  );
  const mrpB = z
    .object({
      fromDate: isoDate,
      toDate: isoDate,
      includeForecast: z.boolean().optional(),
      bucket: z.enum(['DAY', 'WEEK', 'MONTH', 'RANGE']).optional(),
      notes: opt(300),
    })
    .strict();
  router.post(
    '/mfg/mrp',
    g('mfg-mrp', 'add'),
    validate({ body: mrpB }),
    h(async (req, res) => {
      const b = validated(res, 'body', mrpB);
      await idem(req, res, 'mfg-mrp-run', [b], () => mrpService.run(callerOf(req), 'mfg-mrp', b));
    }),
  );
  const mrpApply = z
    .object({ warehouseId: uuid.optional(), rmWarehouseId: uuid.optional() })
    .strict();
  router.post(
    '/mfg/mrp/:id/apply',
    g('mfg-mrp', 'approve'),
    validate({ params: idp, body: mrpApply }),
    h(async (req, res) => {
      const b = validated(res, 'body', mrpApply);
      const id = String(req.params.id);
      await idem(req, res, 'mfg-mrp-apply', [id, b], () =>
        mrpService.apply(callerOf(req), 'mfg-mrp', id, ver(req), b),
      );
    }),
  );
  router.post(
    '/mfg/mrp/:id/cancel',
    g('mfg-mrp', 'cancel'),
    validate({ params: idp }),
    h(async (req, res) =>
      send(res, await mrpService.cancel(callerOf(req), 'mfg-mrp', String(req.params.id), ver(req))),
    ),
  );

  // ---------------------------------------------------------------- daily board
  const planQ = z
    .object({
      from: isoDate.optional(),
      to: isoDate.optional(),
      orderId: uuid.optional(),
      ...pageQuery,
    })
    .strict();
  router.get(
    '/mfg/plan',
    g('mfg-plan', 'view'),
    validate({ query: planQ }),
    h(async (req, res) => {
      const q = validated(res, 'query', planQ);
      const r = await boardService.listPlan(callerOf(req), 'mfg-plan', q);
      paged(res, r.rows, r.total, q.page, q.size, { totals: r.totals });
    }),
  );
  const planB = z
    .object({
      planDate: isoDate,
      orderId: uuid.optional(),
      itemId: uuid.optional(),
      customerPoNo: opt(60),
      deliveryDate: isoDate.optional(),
      lineQty: num.optional(),
      unit2Qty: num.optional(),
      coatingQty: num.optional(),
      dispatchQty: num.optional(),
      ownerLine: opt(80),
      ownerUnit2: opt(80),
      ownerCoating: opt(80),
      ownerDispatch: opt(80),
      remark: opt(300),
    })
    .strict();
  router.post(
    '/mfg/plan',
    g('mfg-plan', 'add'),
    validate({ body: planB }),
    h(async (req, res) =>
      send(
        res,
        await boardService.createPlan(callerOf(req), 'mfg-plan', validated(res, 'body', planB)),
        201,
      ),
    ),
  );
  const planU = planB.omit({ orderId: true, itemId: true }).partial().strict();
  router.patch(
    '/mfg/plan/:id',
    g('mfg-plan', 'edit'),
    validate({ params: idp, body: planU }),
    h(async (req, res) =>
      send(
        res,
        await boardService.updatePlan(
          callerOf(req),
          'mfg-plan',
          String(req.params.id),
          ver(req),
          validated(res, 'body', planU),
        ),
      ),
    ),
  );
  router.delete(
    '/mfg/plan/:id',
    g('mfg-plan', 'delete'),
    validate({ params: idp }),
    h(async (req, res) => {
      await boardService.deletePlan(callerOf(req), 'mfg-plan', String(req.params.id));
      res.status(204).end();
    }),
  );

  // ---------------------------------------------------------------- job work (registers per customer PO line)
  const jwQ = z
    .object({
      customerId: uuid.optional(),
      status: z.enum(['Open', 'Closed']).optional(),
      q: opt(80),
      ...pageQuery,
    })
    .strict();
  router.get(
    '/mfg/jobwork/lines',
    g('mfg-orders', 'view'),
    validate({ query: jwQ }),
    h(async (req, res) => {
      const q = validated(res, 'query', jwQ);
      const r = await boardService.listJwLines(callerOf(req), 'mfg-orders', q);
      paged(res, r.rows, r.total, q.page, q.size);
    }),
  );
  router.get(
    '/mfg/jobwork/lines/:id',
    g('mfg-orders', 'view'),
    validate({ params: idp }),
    h(async (req, res) =>
      send(res, await boardService.getJwLine(callerOf(req), 'mfg-orders', String(req.params.id))),
    ),
  );
  const jwB = z
    .object({
      customerId: uuid,
      customerPoNo: txt(60),
      poLineNo: z.number().int().min(1).max(9999).optional(),
      itemId: uuid.optional(),
      part: txt(150),
      poQty: num,
      uom: txt(20),
    })
    .strict();
  router.post(
    '/mfg/jobwork/lines',
    g('mfg-orders', 'add'),
    validate({ body: jwB }),
    h(async (req, res) =>
      send(
        res,
        await boardService.createJwLine(callerOf(req), 'mfg-orders', validated(res, 'body', jwB)),
        201,
      ),
    ),
  );
  const jwU = z
    .object({
      poQty: num.optional(),
      part: opt(150),
      status: z.enum(['Open', 'Closed']).optional(),
    })
    .strict();
  router.patch(
    '/mfg/jobwork/lines/:id',
    g('mfg-orders', 'edit'),
    validate({ params: idp, body: jwU }),
    h(async (req, res) =>
      send(
        res,
        await boardService.updateJwLine(
          callerOf(req),
          'mfg-orders',
          String(req.params.id),
          ver(req),
          validated(res, 'body', jwU),
        ),
      ),
    ),
  );
  const jwM = z
    .object({
      direction: z.enum(['INWARD', 'OUTWARD']),
      qty: num,
      moveDate: isoDate.optional(),
      docNo: txt(60),
      remark: opt(200),
    })
    .strict();
  router.post(
    '/mfg/jobwork/lines/:id/moves',
    g('mfg-orders', 'post'),
    validate({ params: idp, body: jwM }),
    h(async (req, res) => {
      const b = validated(res, 'body', jwM);
      const id = String(req.params.id);
      await idem(req, res, 'mfg-jwmove', [id, b], () =>
        boardService.addJwMove(callerOf(req), 'mfg-orders', id, b),
      );
    }),
  );
  const moveP = z.object({ id: uuid, moveId: uuid }).strict();
  router.post(
    '/mfg/jobwork/lines/:id/moves/:moveId/cancel',
    g('mfg-orders', 'cancel'),
    validate({ params: moveP }),
    h(async (req, res) =>
      send(
        res,
        await boardService.cancelJwMove(
          callerOf(req),
          'mfg-orders',
          String(req.params.id),
          String(req.params.moveId),
        ),
      ),
    ),
  );

  // ---------------------------------------------------------------- rework against the customer's challan
  const crQ = z
    .object({
      customerId: uuid.optional(),
      open: z
        .enum(['true', 'false'])
        .transform((v) => v === 'true')
        .optional(),
      q: opt(80),
      ...pageQuery,
    })
    .strict();
  router.get(
    '/mfg/challan-rework',
    g('mfg-rework', 'view'),
    validate({ query: crQ }),
    h(async (req, res) => {
      const q = validated(res, 'query', crQ);
      const r = await boardService.listChallanRework(callerOf(req), 'mfg-rework', q);
      paged(res, r.rows, r.total, q.page, q.size);
    }),
  );
  router.get(
    '/mfg/challan-rework/:id',
    g('mfg-rework', 'view'),
    validate({ params: idp }),
    h(async (req, res) =>
      send(
        res,
        await boardService.getChallanRework(callerOf(req), 'mfg-rework', String(req.params.id)),
      ),
    ),
  );
  const crB = z
    .object({
      customerId: uuid,
      challanNo: txt(60),
      challanDate: isoDate,
      itemId: uuid.optional(),
      part: txt(150),
      challanQty: num,
      remark: opt(200),
    })
    .strict();
  router.post(
    '/mfg/challan-rework',
    g('mfg-rework', 'add'),
    validate({ body: crB }),
    h(async (req, res) =>
      send(
        res,
        await boardService.createChallanRework(
          callerOf(req),
          'mfg-rework',
          validated(res, 'body', crB),
        ),
        201,
      ),
    ),
  );
  const crD = z.object({ qty: num, doneChallanNo: txt(60), doneDate: isoDate.optional() }).strict();
  router.post(
    '/mfg/challan-rework/:id/done',
    g('mfg-rework', 'edit'),
    validate({ params: idp, body: crD }),
    h(async (req, res) => {
      const b = validated(res, 'body', crD);
      const id = String(req.params.id);
      await idem(req, res, 'mfg-crdone', [id, b], () =>
        boardService.addReworkDone(callerOf(req), 'mfg-rework', id, b),
      );
    }),
  );
  const crP = z.object({ id: uuid, doneId: uuid }).strict();
  router.post(
    '/mfg/challan-rework/:id/done/:doneId/cancel',
    g('mfg-rework', 'cancel'),
    validate({ params: crP }),
    h(async (req, res) =>
      send(
        res,
        await boardService.cancelReworkDone(
          callerOf(req),
          'mfg-rework',
          String(req.params.id),
          String(req.params.doneId),
        ),
      ),
    ),
  );

  // ---------------------------------------------------------------- outside processing (subcontract)
  const outB = z
    .object({
      direction: z.enum(['SENT', 'RECEIVED']),
      qty: num,
      qtyScrap: num.optional(),
      docNo: txt(60),
      supplierId: uuid,
      rate: num.optional(),
      moveDate: isoDate.optional(),
      reason: opt(200),
      remark: opt(200),
    })
    .strict();
  router.post(
    '/mfg/orders/:id/ops/:opId/outside',
    g('mfg-workorders', 'edit'),
    validate({ params: opP, body: outB }),
    h(async (req, res) => {
      const b = validated(res, 'body', outB);
      const id = String(req.params.id);
      const opId = String(req.params.opId);
      await idem(req, res, 'mfg-outside', [id, opId, b], () =>
        orderService.outsideMove(callerOf(req), 'mfg-workorders', id, opId, b),
      );
    }),
  );

  // ---------------------------------------------------------------- capacity
  const capQ = z
    .object({
      from: isoDate.optional(),
      days: z.coerce.number().int().min(1).max(365).optional(),
      workDays: z
        .string()
        .regex(/^[0-6](,[0-6]){0,6}$/, 'Use weekday numbers 0 (Sunday) to 6, separated by commas.')
        .optional(),
    })
    .strict();
  router.get(
    '/mfg/capacity',
    g('mfg-plan', 'view'),
    validate({ query: capQ }),
    h(async (req, res) =>
      send(
        res,
        await reportsService.capacity(callerOf(req), 'mfg-plan', validated(res, 'query', capQ)),
      ),
    ),
  );

  // ---------------------------------------------------------------- print and Excel export (page action "print")
  const needPrint = async (req: Request, page: string): Promise<void> => {
    if (!req.auth || !(await can(accessUserOf(req.auth), page, 'print'))) throw Errors.forbidden();
  };
  const xlsx = (res: Response, name: string, buf: Buffer) =>
    res
      .set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .set('Content-Disposition', `attachment; filename="${name}.xlsx"`)
      .send(buf);
  const pdf = (res: Response, name: string, buf: Buffer) =>
    res
      .set('Content-Type', 'application/pdf')
      .set('Content-Disposition', `inline; filename="${name}.pdf"`)
      .send(buf);
  const expP = z.object({ report: z.enum(Object.keys(REPORTS) as [string, ...string[]]) }).strict();
  const expQ = z
    .object({ status: opt(20), from: isoDate.optional(), to: isoDate.optional() })
    .strict();
  router.get(
    '/mfg/export/:report',
    validate({ params: expP, query: expQ }),
    h(async (req, res) => {
      const name = String(req.params.report);
      const rep = assertReport(name);
      await needPrint(req, rep.page);
      const rows = await rep.load(callerOf(req), validated(res, 'query', expQ));
      xlsx(res, `mfg-${name}`, await reportWorkbook(rep, rows));
    }),
  );
  router.get(
    '/mfg/mrp/:id/export',
    g('mfg-mrp', 'print'),
    validate({ params: idp }),
    h(async (req, res) =>
      xlsx(res, 'mfg-mrp', await mrpWorkbook(callerOf(req), String(req.params.id))),
    ),
  );
  router.get(
    '/mfg/orders/:id/print',
    g('mfg-orders', 'print'),
    validate({ params: idp }),
    h(async (req, res) =>
      pdf(res, 'production-order', await orderPdf(callerOf(req), String(req.params.id))),
    ),
  );
  router.get(
    '/mfg/boms/:id/print',
    g('mfg-bom', 'print'),
    validate({ params: idp }),
    h(async (req, res) =>
      pdf(res, 'bill-of-materials', await bomPdf(callerOf(req), String(req.params.id))),
    ),
  );
  router.get(
    '/mfg/routings/:id/print',
    g('mfg-routing', 'print'),
    validate({ params: idp }),
    h(async (req, res) =>
      pdf(res, 'routing', await routingPdf(callerOf(req), String(req.params.id))),
    ),
  );
  router.get(
    '/mfg/mrp/:id/print',
    g('mfg-mrp', 'print'),
    validate({ params: idp }),
    h(async (req, res) => pdf(res, 'mrp', await mrpPdf(callerOf(req), String(req.params.id)))),
  );

  return router;
}
