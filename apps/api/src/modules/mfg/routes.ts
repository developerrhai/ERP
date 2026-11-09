// Phase 13 API (/api/v1/mfg, spec PHASE-13 section 6, ERRATA E-26). authenticate -> requirePasswordChanged ->
// resolveContext -> permission -> zod -> service. The permission page follows the screen: work centres and masters
// mfg-workcenters, BOM mfg-bom, routing mfg-routing, production plans mfg-plan, production orders mfg-orders, MRP and item
// planning mfg-mrp, job cards and downtime mfg-workorders, production receipts mfg-fg, scrap mfg-scrap, rework mfg-rework,
// WIP mfg-wip, costing mfg-costing, shop floor and OEE mfg-shopfloor. The old daily board lives under /mfg/day-board.
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
import { prisma } from '../../core/db/prisma';
import { query } from '../procurement/core';
import { callerOf, idemOf, isoDate, pageQuery, uuid } from '../inventory/routes-shared';
import type { Caller } from '../records/service';
import { boardService } from './board-service';
import { bomService } from './bom-service';
import {
  REPORTS,
  assertReport,
  bomPdf,
  jobCardPdf,
  mrpPdf,
  mrpWorkbook,
  orderPdf,
  reportWorkbook,
  routingPdf,
  travellerPdf,
} from './export-service';
import { jobCardService } from './jobcard-service';
import './lot-hook';
import { WORK_CENTRE_KINDS, masterService } from './master-service';
import { mrpService } from './mrp-service';
import { orderService } from './order-service';
import { planService } from './plan-service';
import { reportsService } from './reports-service';
import { routingService } from './routing-service';
import { scrapService } from './scrap-service';

const num = z
  .union([z.number(), z.string()])
  .transform((v) => String(v))
  .refine((v) => /^\d+(\.\d+)?$/.test(v), 'Enter a number.');
const pos = num.refine((v) => Number(v) > 0, 'Enter a number greater than 0.');
const txt = (n: number) => z.string().trim().min(1, 'This is required.').max(n);
const opt = (n: number) => z.string().trim().max(n).optional();
const ts = z.string().datetime({ offset: true, message: 'Use a date and time.' });
const idp = z.object({ id: uuid }).strict();
const noQ = z.object({}).strict();
const h = (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
  asyncHandler(async (req, res) => {
    await fn(req, res);
  });
const g = (page: string, a: Action): RequestHandler => requirePageAction(page, a);
const me = (req: Request): string => req.auth!.userId;
const ver = (req: Request) => parseIfMatch(req.get('if-match'));

/** passes when the user may view at least one of the pages (shared reads: reasons, orders, settings) */
const anyView =
  (...pages: string[]): RequestHandler =>
  (req, _res, next) => {
    void (async () => {
      if (!req.auth) throw Errors.unauthenticated();
      const u = accessUserOf(req.auth);
      for (const p of pages) if (await can(u, p, 'view')) return;
      throw Errors.forbidden();
    })().then(
      () => next(),
      (e: unknown) => next(e),
    );
  };

/** the first of the pages the user can do `action` on, so one shared read scopes by the right screen */
async function firstPage(req: Request, pages: readonly string[], action: Action): Promise<string> {
  if (!req.auth) throw Errors.unauthenticated();
  const u = accessUserOf(req.auth);
  for (const p of pages) if (await can(u, p, action)) return p;
  throw Errors.forbidden();
}
const canDo = async (req: Request, page: string, a: Action): Promise<boolean> =>
  !!req.auth && (await can(accessUserOf(req.auth), page, a));

const ORDER_PAGES = [
  'mfg-orders',
  'mfg-workorders',
  'mfg-fg',
  'mfg-wip',
  'mfg-scrap',
  'mfg-rework',
  'mfg-costing',
  'mfg-shopfloor',
  'mfg-plan',
] as const;
const READ_ALL = [...ORDER_PAGES, 'mfg-mrp', 'mfg-bom', 'mfg-routing', 'mfg-workcenters'] as const;

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
  const C = (req: Request): Caller => callerOf(req);

  // ---------------------------------------------------------------- work centres, calendars, reasons, settings
  const wcQ = z
    .object({ q: opt(80), status: z.enum(['ACTIVE', 'INACTIVE']).optional(), ...pageQuery })
    .strict();
  router.get(
    ['/mfg/work-centers', '/mfg/work-centres'],
    anyView('mfg-workcenters', 'mfg-workorders', 'mfg-routing', 'mfg-plan', 'mfg-shopfloor'),
    validate({ query: wcQ }),
    h(async (req, res) => {
      const q = validated(res, 'query', wcQ);
      const r = await masterService.listWorkCentres(
        C(req),
        await firstPage(
          req,
          ['mfg-workcenters', 'mfg-workorders', 'mfg-routing', 'mfg-plan', 'mfg-shopfloor'],
          'view',
        ),
        q,
      );
      paged(res, r.rows, r.total, q.page, q.size);
    }),
  );
  const money = num.refine((v) => Number(v) <= 100000000, 'That is too large.');
  const wcB = z
    .object({
      code: z
        .string()
        .trim()
        .regex(/^[A-Za-z0-9][A-Za-z0-9_\-/]{0,29}$/, 'Use letters, digits, - _ /.'),
      name: txt(120),
      kind: z.enum(WORK_CENTRE_KINDS).optional(),
      department: opt(80),
      costCentreId: uuid.optional(),
      machineCount: z.number().int().min(0).max(1000).optional(),
      labourCount: z.number().int().min(0).max(1000).optional(),
      calendarId: uuid.optional(),
      hoursPerShift: pos.refine((v) => Number(v) <= 24, 'Up to 24 hours.').optional(),
      shiftsPerDay: z.number().int().min(1).max(4).optional(),
      normalCapacityHrs: num.refine((v) => Number(v) <= 24 * 4, 'That is too large.').optional(),
      labourRatePerHr: money.optional(),
      overheadRatePerHr: money.optional(),
      oeeTargetPct: num.refine((v) => Number(v) <= 100, 'Up to 100.').optional(),
      efficiencyPct: num.refine((v) => Number(v) <= 100 && Number(v) > 0, '1 to 100.').optional(),
      assetRef: opt(60),
      notes: opt(300),
    })
    .strict();
  router.post(
    ['/mfg/work-centers', '/mfg/work-centres'],
    g('mfg-workcenters', 'add'),
    validate({ body: wcB }),
    h(async (req, res) =>
      send(
        res,
        await masterService.createWorkCentre(
          C(req),
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
    ['/mfg/work-centers/:id', '/mfg/work-centres/:id'],
    g('mfg-workcenters', 'edit'),
    validate({ params: idp, body: wcU }),
    h(async (req, res) =>
      send(
        res,
        await masterService.updateWorkCentre(
          C(req),
          'mfg-workcenters',
          String(req.params.id),
          ver(req),
          validated(res, 'body', wcU),
        ),
      ),
    ),
  );

  router.get(
    '/mfg/cost-centers',
    anyView('mfg-workcenters'),
    validate({ query: noQ }),
    h(async (req, res) => {
      const unitId = C(req).ctx.unitId;
      const r = await query(
        prisma,
        `SELECT id::text, code, name FROM cost_centers WHERE deleted_at IS NULL AND NOT is_group AND status='Active' AND ($1::uuid IS NULL OR unit_id=$1::uuid) ORDER BY code LIMIT 300`,
        unitId ?? null,
      );
      res.json({ data: r });
    }),
  );
  router.get(
    '/mfg/calendars',
    anyView('mfg-workcenters', 'mfg-plan', 'mfg-shopfloor'),
    validate({ query: noQ }),
    h(async (req, res) => res.json({ data: await masterService.listCalendars(C(req)) })),
  );
  const calB = z
    .object({
      name: txt(80),
      workDays: z.array(z.number().int().min(0).max(6)).max(7),
      exceptions: z
        .array(z.object({ date: isoDate, availableHrs: num, reason: opt(120) }).strict())
        .max(400)
        .optional(),
    })
    .strict();
  router.post(
    '/mfg/calendars',
    g('mfg-workcenters', 'add'),
    validate({ body: calB }),
    h(async (req, res) =>
      send(
        res,
        await masterService.saveCalendar(
          C(req),
          'mfg-workcenters',
          null,
          validated(res, 'body', calB),
        ),
        201,
      ),
    ),
  );
  router.put(
    '/mfg/calendars/:id',
    g('mfg-workcenters', 'edit'),
    validate({ params: idp, body: calB }),
    h(async (req, res) =>
      send(
        res,
        await masterService.saveCalendar(
          C(req),
          'mfg-workcenters',
          String(req.params.id),
          validated(res, 'body', calB),
        ),
      ),
    ),
  );

  for (const [path, kind] of [
    ['downtime-reasons', 'downtime'],
    ['scrap-reasons', 'scrap'],
  ] as const) {
    router.get(
      `/mfg/${path}`,
      anyView(...READ_ALL),
      validate({ query: noQ }),
      h(async (_req, res) => res.json({ data: await masterService.listReasons(kind) })),
    );
    const rB = z
      .object({
        code: z
          .string()
          .trim()
          .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,19}$/, 'Use letters, digits, - _.'),
        name: txt(80),
        category: z.enum(['PLANNED', 'UNPLANNED']).optional(),
        countsAgainstAvailability: z.boolean().optional(),
        normal: z.boolean().optional(),
        status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
      })
      .strict();
    router.post(
      `/mfg/${path}`,
      g('mfg-workcenters', 'add'),
      validate({ body: rB }),
      h(async (req, res) =>
        send(
          res,
          await masterService.saveReason(
            C(req),
            'mfg-workcenters',
            kind,
            validated(res, 'body', rB),
          ),
          201,
        ),
      ),
    );
  }

  const itemP = z.object({ itemId: uuid }).strict();
  router.get(
    '/mfg/item-planning/:itemId',
    anyView('mfg-mrp', 'mfg-bom', 'mfg-plan'),
    validate({ params: itemP }),
    h(async (req, res) => send(res, await masterService.getPlanning(String(req.params.itemId)))),
  );
  const ipB = z
    .object({
      makeOrBuy: z.enum(['MAKE', 'BUY']).optional(),
      leadTimeDays: z.number().int().min(0).max(730).optional(),
      safetyStock: num.optional(),
      lotSizing: z.enum(['LFL', 'FIXED', 'EOQ']).optional(),
      fixedLotQty: num.nullable().optional(),
      minOrderQty: num.nullable().optional(),
      orderMultiple: num.nullable().optional(),
      eoqSetupCost: num.nullable().optional(),
      eoqHoldingRate: num.nullable().optional(),
      backflushWhId: uuid.nullable().optional(),
      wipWhId: uuid.nullable().optional(),
      fgWhId: uuid.nullable().optional(),
    })
    .strict();
  router.put(
    '/mfg/item-planning/:itemId',
    g('mfg-mrp', 'edit'),
    validate({ params: itemP, body: ipB }),
    h(async (req, res) =>
      send(
        res,
        await masterService.savePlanning(
          C(req),
          'mfg-mrp',
          String(req.params.itemId),
          validated(res, 'body', ipB),
        ),
      ),
    ),
  );

  router.get(
    '/mfg/settings',
    anyView(...READ_ALL),
    validate({ query: noQ }),
    h(async (req, res) =>
      res.json({ data: await masterService.settings(C(req).ctx.unitId ?? null) }),
    ),
  );
  const setP = z
    .object({ key: z.enum(['OVER_ISSUE_PCT', 'ORDER_APPROVAL_VALUE', 'SCRAP_APPROVAL_VALUE']) })
    .strict();
  const setB = z.object({ value: num.nullable() }).strict();
  router.put(
    '/mfg/settings/:key',
    g('mfg-workcenters', 'approve'),
    validate({ params: setP, body: setB }),
    h(async (req, res) =>
      res.json({
        data: await masterService.saveSetting(
          C(req),
          'mfg-workcenters',
          req.params.key as 'OVER_ISSUE_PCT' | 'ORDER_APPROVAL_VALUE' | 'SCRAP_APPROVAL_VALUE',
          validated(res, 'body', setB).value,
        ),
      }),
    ),
  );

  // ---------------------------------------------------------------- BOM
  const bomQ = z
    .object({
      itemId: uuid.optional(),
      status: z.enum(['DRAFT', 'PENDING_APPROVAL', 'RELEASED', 'OBSOLETE']).optional(),
      q: opt(80),
      ...pageQuery,
    })
    .strict();
  router.get(
    '/mfg/boms',
    anyView('mfg-bom', 'mfg-orders', 'mfg-mrp', 'mfg-plan'),
    validate({ query: bomQ }),
    h(async (req, res) => {
      const q = validated(res, 'query', bomQ);
      const r = await bomService.list(
        C(req),
        await firstPage(req, ['mfg-bom', 'mfg-orders', 'mfg-mrp', 'mfg-plan'], 'view'),
        q,
      );
      paged(res, r.rows, r.total, q.page, q.size);
    }),
  );
  router.get(
    '/mfg/boms/:id',
    anyView('mfg-bom', 'mfg-orders', 'mfg-mrp', 'mfg-plan'),
    validate({ params: idp }),
    h(async (req, res) =>
      send(
        res,
        await bomService.get(
          C(req),
          await firstPage(req, ['mfg-bom', 'mfg-orders', 'mfg-mrp', 'mfg-plan'], 'view'),
          String(req.params.id),
        ),
      ),
    ),
  );
  const lineB = z
    .object({
      itemId: uuid,
      qtyPer: pos,
      uom: opt(20),
      conversionFactor: pos.optional(),
      scrapPct: num.refine((v) => Number(v) <= 50, 'Scrap is 0 to 50 percent.').optional(),
      issueMethod: z.enum(['MANUAL', 'BACKFLUSH']).optional(),
      operationSeq: z.number().int().min(1).max(9999).optional(),
      effectiveFrom: isoDate.optional(),
      effectiveTo: isoDate.optional(),
      isPhantom: z.boolean().optional(),
      referenceDesignator: opt(60),
      remarks: opt(200),
      alternates: z
        .array(
          z
            .object({
              altItemId: uuid,
              priority: z.number().int().min(1).max(9).optional(),
              ratio: pos.optional(),
            })
            .strict(),
        )
        .max(10)
        .optional(),
    })
    .strict();
  const bomB = z
    .object({
      itemId: uuid,
      baseQty: pos.optional(),
      bomType: z.enum(['STANDARD', 'ENGINEERING', 'REWORK']).optional(),
      effectiveFrom: isoDate.optional(),
      effectiveTo: isoDate.optional(),
      routingId: uuid.optional(),
      notes: opt(300),
      lines: z.array(lineB).min(1, 'Add at least one component.').max(300),
    })
    .strict();
  router.post(
    '/mfg/boms',
    g('mfg-bom', 'add'),
    validate({ body: bomB }),
    h(async (req, res) =>
      send(res, await bomService.create(C(req), 'mfg-bom', validated(res, 'body', bomB)), 201),
    ),
  );
  const bomU = bomB.omit({ itemId: true }).partial().strict();
  router.patch(
    '/mfg/boms/:id',
    g('mfg-bom', 'edit'),
    validate({ params: idp, body: bomU }),
    h(async (req, res) =>
      send(
        res,
        await bomService.update(
          C(req),
          'mfg-bom',
          String(req.params.id),
          ver(req),
          validated(res, 'body', bomU),
        ),
      ),
    ),
  );
  router.post(
    '/mfg/boms/:id/submit',
    g('mfg-bom', 'edit'),
    validate({ params: idp }),
    h(async (req, res) =>
      send(res, await bomService.submit(C(req), 'mfg-bom', String(req.params.id), ver(req))),
    ),
  );
  const reasonB = z.object({ reason: txt(300) }).strict();
  router.post(
    '/mfg/boms/:id/reject',
    g('mfg-bom', 'approve'),
    validate({ params: idp, body: reasonB }),
    h(async (req, res) =>
      send(
        res,
        await bomService.reject(
          C(req),
          'mfg-bom',
          String(req.params.id),
          ver(req),
          validated(res, 'body', reasonB).reason,
        ),
      ),
    ),
  );
  router.post(
    '/mfg/boms/:id/release',
    g('mfg-bom', 'approve'),
    validate({ params: idp }),
    h(async (req, res) =>
      send(res, await bomService.release(C(req), 'mfg-bom', String(req.params.id), ver(req))),
    ),
  );
  router.post(
    '/mfg/boms/:id/revise',
    g('mfg-bom', 'add'),
    validate({ params: idp }),
    h(async (req, res) =>
      send(res, await bomService.revise(C(req), 'mfg-bom', String(req.params.id)), 201),
    ),
  );
  router.post(
    '/mfg/boms/:id/obsolete',
    g('mfg-bom', 'approve'),
    validate({ params: idp }),
    h(async (req, res) =>
      send(res, await bomService.obsolete(C(req), 'mfg-bom', String(req.params.id), ver(req))),
    ),
  );
  router.post(
    '/mfg/boms/:id/set-default',
    g('mfg-bom', 'approve'),
    validate({ params: idp }),
    h(async (req, res) =>
      send(res, await bomService.setDefault(C(req), 'mfg-bom', String(req.params.id), ver(req))),
    ),
  );
  const expl = z.object({ qty: pos.optional(), date: isoDate.optional() }).strict();
  const today = () => new Date().toISOString().slice(0, 10);
  router.get(
    '/mfg/boms/:id/explode',
    g('mfg-bom', 'view'),
    validate({ params: idp, query: expl }),
    h(async (req, res) => {
      const q = validated(res, 'query', expl);
      send(
        res,
        await bomService.explodeBom(
          C(req),
          'mfg-bom',
          String(req.params.id),
          q.qty ?? '1',
          q.date ?? today(),
        ),
      );
    }),
  );
  router.get(
    '/mfg/boms/:id/tree',
    g('mfg-bom', 'view'),
    validate({ params: idp, query: expl }),
    h(async (req, res) => {
      const q = validated(res, 'query', expl);
      send(
        res,
        await bomService.tree(
          C(req),
          'mfg-bom',
          String(req.params.id),
          q.qty ?? '1',
          q.date ?? today(),
        ),
      );
    }),
  );
  router.get(
    '/mfg/boms/:id/cost-rollup',
    g('mfg-bom', 'view'),
    validate({ params: idp }),
    h(async (req, res) =>
      send(res, await bomService.costRollup(C(req), 'mfg-bom', String(req.params.id))),
    ),
  );
  const impB = z
    .object({
      rows: z
        .array(
          z
            .object({
              itemCode: txt(60),
              baseQty: num.optional(),
              lines: z
                .array(
                  z
                    .object({
                      componentCode: txt(60),
                      qtyPerBase: num,
                      uom: opt(20),
                      scrapPct: num.optional(),
                      isPhantom: z.boolean().optional(),
                      issueMethod: z.enum(['MANUAL', 'BACKFLUSH']).optional(),
                    })
                    .strict(),
                )
                .min(1)
                .max(300),
            })
            .strict(),
        )
        .min(1)
        .max(500),
    })
    .strict();
  router.post(
    '/mfg/boms/import',
    g('mfg-bom', 'add'),
    validate({ body: impB }),
    h(async (req, res) => {
      const b = validated(res, 'body', impB);
      await idem(req, res, 'mfg-bom-import', [b], async () => ({
        ...(await bomService.importBoms(C(req), 'mfg-bom', b.rows)),
        version: 0,
      }));
    }),
  );

  // ---------------------------------------------------------------- routing
  const rtQ = bomQ;
  router.get(
    '/mfg/routings',
    anyView('mfg-routing', 'mfg-orders', 'mfg-bom', 'mfg-plan'),
    validate({ query: rtQ }),
    h(async (req, res) => {
      const q = validated(res, 'query', rtQ);
      const r = await routingService.list(
        C(req),
        await firstPage(req, ['mfg-routing', 'mfg-orders', 'mfg-bom', 'mfg-plan'], 'view'),
        q,
      );
      paged(res, r.rows, r.total, q.page, q.size);
    }),
  );
  router.get(
    '/mfg/routings/:id',
    anyView('mfg-routing', 'mfg-orders', 'mfg-bom', 'mfg-plan'),
    validate({ params: idp }),
    h(async (req, res) =>
      send(
        res,
        await routingService.get(
          C(req),
          await firstPage(req, ['mfg-routing', 'mfg-orders', 'mfg-bom', 'mfg-plan'], 'view'),
          String(req.params.id),
        ),
      ),
    ),
  );
  const opB = z
    .object({
      seq: z.number().int().min(1).max(9999),
      name: txt(120),
      workCentreId: uuid,
      setupMinutes: num.optional(),
      runMinutes: num.optional(),
      queueMinutes: num.optional(),
      moveMinutes: num.optional(),
      qcRequired: z.boolean().optional(),
      qmsPlanRef: opt(60),
      isOutside: z.boolean().optional(),
      toolingNote: opt(200),
    })
    .strict();
  const rtB = z
    .object({
      itemId: uuid,
      effectiveFrom: isoDate.optional(),
      notes: opt(300),
      ops: z.array(opB).min(1, 'Add at least one operation.').max(60),
    })
    .strict();
  router.post(
    '/mfg/routings',
    g('mfg-routing', 'add'),
    validate({ body: rtB }),
    h(async (req, res) =>
      send(
        res,
        await routingService.create(C(req), 'mfg-routing', validated(res, 'body', rtB)),
        201,
      ),
    ),
  );
  const rtU = rtB.omit({ itemId: true }).partial().strict();
  router.patch(
    '/mfg/routings/:id',
    g('mfg-routing', 'edit'),
    validate({ params: idp, body: rtU }),
    h(async (req, res) =>
      send(
        res,
        await routingService.update(
          C(req),
          'mfg-routing',
          String(req.params.id),
          ver(req),
          validated(res, 'body', rtU),
        ),
      ),
    ),
  );
  router.post(
    '/mfg/routings/:id/release',
    g('mfg-routing', 'approve'),
    validate({ params: idp }),
    h(async (req, res) =>
      send(
        res,
        await routingService.release(C(req), 'mfg-routing', String(req.params.id), ver(req)),
      ),
    ),
  );
  router.post(
    '/mfg/routings/:id/revise',
    g('mfg-routing', 'add'),
    validate({ params: idp }),
    h(async (req, res) =>
      send(res, await routingService.revise(C(req), 'mfg-routing', String(req.params.id)), 201),
    ),
  );
  router.post(
    '/mfg/routings/:id/obsolete',
    g('mfg-routing', 'approve'),
    validate({ params: idp }),
    h(async (req, res) =>
      send(
        res,
        await routingService.obsolete(C(req), 'mfg-routing', String(req.params.id), ver(req)),
      ),
    ),
  );

  // ---------------------------------------------------------------- production plans
  const ppQ = z
    .object({
      status: z.enum(['DRAFT', 'SUBMITTED', 'RELEASED', 'CLOSED']).optional(),
      ...pageQuery,
    })
    .strict();
  router.get(
    '/mfg/production-plans',
    g('mfg-plan', 'view'),
    validate({ query: ppQ }),
    h(async (req, res) => {
      const q = validated(res, 'query', ppQ);
      const r = await planService.list(C(req), 'mfg-plan', q);
      paged(res, r.rows, r.total, q.page, q.size);
    }),
  );
  router.get(
    '/mfg/production-plans/:id',
    g('mfg-plan', 'view'),
    validate({ params: idp }),
    h(async (req, res) =>
      send(res, await planService.get(C(req), 'mfg-plan', String(req.params.id))),
    ),
  );
  const ppLine = z
    .object({
      demandSource: z.enum(['SALES_ORDER', 'MANUAL', 'FORECAST']).optional(),
      soLineId: uuid.optional(),
      itemId: uuid,
      demandQty: num.optional(),
      plannedQty: pos,
      requiredDate: isoDate,
    })
    .strict();
  const ppB = z
    .object({
      planDate: isoDate.optional(),
      horizonDays: z.number().int().min(1).max(365).optional(),
      notes: opt(300),
      lines: z.array(ppLine).max(500).optional(),
    })
    .strict();
  router.post(
    '/mfg/production-plans',
    g('mfg-plan', 'add'),
    validate({ body: ppB }),
    h(async (req, res) =>
      send(res, await planService.create(C(req), 'mfg-plan', validated(res, 'body', ppB)), 201),
    ),
  );
  const ppU = ppB.omit({ planDate: true }).strict();
  router.patch(
    '/mfg/production-plans/:id',
    g('mfg-plan', 'edit'),
    validate({ params: idp, body: ppU }),
    h(async (req, res) =>
      send(
        res,
        await planService.update(
          C(req),
          'mfg-plan',
          String(req.params.id),
          ver(req),
          validated(res, 'body', ppU),
        ),
      ),
    ),
  );
  router.post(
    '/mfg/production-plans/:id/pull-demand',
    g('mfg-plan', 'edit'),
    validate({ params: idp }),
    h(async (req, res) =>
      send(res, await planService.pullDemand(C(req), 'mfg-plan', String(req.params.id))),
    ),
  );
  router.post(
    '/mfg/production-plans/:id/check-capacity',
    g('mfg-plan', 'view'),
    validate({ params: idp }),
    h(async (req, res) =>
      send(res, await planService.checkCapacity(C(req), 'mfg-plan', String(req.params.id))),
    ),
  );
  router.post(
    '/mfg/production-plans/:id/check-material',
    g('mfg-plan', 'view'),
    validate({ params: idp }),
    h(async (req, res) =>
      send(res, await planService.checkMaterial(C(req), 'mfg-plan', String(req.params.id))),
    ),
  );
  router.post(
    '/mfg/production-plans/:id/submit',
    g('mfg-plan', 'edit'),
    validate({ params: idp }),
    h(async (req, res) =>
      send(
        res,
        await planService.setStatus(
          C(req),
          'mfg-plan',
          String(req.params.id),
          ver(req),
          ['DRAFT'],
          'SUBMITTED',
        ),
      ),
    ),
  );
  router.post(
    '/mfg/production-plans/:id/release',
    g('mfg-plan', 'approve'),
    validate({ params: idp }),
    h(async (req, res) =>
      send(
        res,
        await planService.setStatus(
          C(req),
          'mfg-plan',
          String(req.params.id),
          ver(req),
          ['DRAFT', 'SUBMITTED'],
          'RELEASED',
        ),
      ),
    ),
  );
  router.post(
    '/mfg/production-plans/:id/close',
    g('mfg-plan', 'approve'),
    validate({ params: idp }),
    h(async (req, res) =>
      send(
        res,
        await planService.setStatus(
          C(req),
          'mfg-plan',
          String(req.params.id),
          ver(req),
          ['RELEASED'],
          'CLOSED',
        ),
      ),
    ),
  );
  router.post(
    '/mfg/production-plans/:id/run-mrp',
    g('mfg-mrp', 'post'),
    validate({ params: idp }),
    h(async (req, res) => {
      const id = String(req.params.id);
      await idem(req, res, 'mfg-plan-mrp', [id], () => planService.runMrp(C(req), 'mfg-plan', id));
    }),
  );

  // ---------------------------------------------------------------- MRP
  const mrQ = z
    .object({ status: z.enum(['QUEUED', 'RUNNING', 'DONE', 'FAILED']).optional(), ...pageQuery })
    .strict();
  router.get(
    '/mfg/mrp-runs',
    g('mfg-mrp', 'view'),
    validate({ query: mrQ }),
    h(async (req, res) => {
      const q = validated(res, 'query', mrQ);
      const r = await mrpService.list(C(req), 'mfg-mrp', q);
      paged(res, r.rows, r.total, q.page, q.size);
    }),
  );
  const mrB = z
    .object({
      horizonDays: z.number().int().min(1).max(365).optional(),
      bucket: z.enum(['DAY', 'WEEK']).optional(),
      includeSo: z.boolean().optional(),
      planId: uuid.optional(),
      notes: opt(300),
    })
    .strict();
  router.post(
    '/mfg/mrp-runs',
    g('mfg-mrp', 'post'),
    validate({ body: mrB }),
    h(async (req, res) => {
      const b = validated(res, 'body', mrB);
      await idem(req, res, 'mfg-mrp-run', [b], () => mrpService.enqueueRun(C(req), 'mfg-mrp', b));
    }),
  );
  router.get(
    '/mfg/mrp-runs/:id',
    g('mfg-mrp', 'view'),
    validate({ params: idp }),
    h(async (req, res) =>
      send(res, await mrpService.get(C(req), 'mfg-mrp', String(req.params.id))),
    ),
  );
  const sugQ = z
    .object({ status: z.enum(['OPEN', 'FIRMED', 'CONVERTED', 'IGNORED']).optional() })
    .strict();
  router.get(
    '/mfg/mrp-runs/:id/suggestions',
    g('mfg-mrp', 'view'),
    validate({ params: idp, query: sugQ }),
    h(async (req, res) =>
      res.json({
        data: await mrpService.suggestions(
          C(req),
          'mfg-mrp',
          String(req.params.id),
          validated(res, 'query', sugQ).status,
        ),
      }),
    ),
  );
  const bkQ = z.object({ itemId: uuid.optional() }).strict();
  router.get(
    '/mfg/mrp-runs/:id/buckets',
    g('mfg-mrp', 'view'),
    validate({ params: idp, query: bkQ }),
    h(async (req, res) =>
      res.json({
        data: await mrpService.buckets(
          C(req),
          'mfg-mrp',
          String(req.params.id),
          validated(res, 'query', bkQ).itemId,
        ),
      }),
    ),
  );
  router.get(
    '/mfg/mrp-runs/:id/pegging',
    g('mfg-mrp', 'view'),
    validate({ params: idp }),
    h(async (req, res) =>
      res.json({ data: await mrpService.pegging(C(req), 'mfg-mrp', String(req.params.id)) }),
    ),
  );
  router.get(
    '/mfg/mrp-runs/:id/exceptions',
    g('mfg-mrp', 'view'),
    validate({ params: idp }),
    h(async (req, res) =>
      res.json({ data: await mrpService.exceptions(C(req), 'mfg-mrp', String(req.params.id)) }),
    ),
  );
  router.post(
    '/mfg/mrp-suggestions/:id/firm',
    g('mfg-mrp', 'edit'),
    validate({ params: idp }),
    h(async (req, res) =>
      send(res, await mrpService.firm(C(req), 'mfg-mrp', String(req.params.id))),
    ),
  );
  router.post(
    '/mfg/mrp-suggestions/:id/ignore',
    g('mfg-mrp', 'edit'),
    validate({ params: idp }),
    h(async (req, res) =>
      send(res, await mrpService.ignore(C(req), 'mfg-mrp', String(req.params.id))),
    ),
  );
  const whB = z.object({ warehouseId: uuid.optional(), rmWarehouseId: uuid.optional() }).strict();
  router.post(
    '/mfg/mrp-suggestions/:id/convert',
    g('mfg-mrp', 'approve'),
    validate({ params: idp, body: whB }),
    h(async (req, res) => {
      const id = String(req.params.id);
      const b = validated(res, 'body', whB);
      await idem(req, res, 'mfg-mrp-convert', [id, b], () =>
        mrpService.convert(C(req), 'mfg-mrp', id, b),
      );
    }),
  );
  const cbB = whB.extend({ ids: z.array(uuid).min(1).max(200) }).strict();
  router.post(
    '/mfg/mrp-suggestions/convert-bulk',
    g('mfg-mrp', 'approve'),
    validate({ body: cbB }),
    h(async (req, res) => {
      const { ids, ...w } = validated(res, 'body', cbB);
      await idem(req, res, 'mfg-mrp-convert-bulk', [ids, w], async () => ({
        ...(await mrpService.convertBulk(C(req), 'mfg-mrp', ids, w)),
        version: 0,
      }));
    }),
  );

  // ---------------------------------------------------------------- production orders
  const ordQ = z
    .object({
      status: z
        .enum([
          'Planned',
          'Pending Approval',
          'Released',
          'In Progress',
          'Completed',
          'Closed',
          'Cancelled',
        ])
        .optional(),
      itemId: uuid.optional(),
      q: opt(80),
      from: isoDate.optional(),
      to: isoDate.optional(),
      ...pageQuery,
    })
    .strict();
  /** one list, many screens: they read the same rows, scoped by the screen the caller asks through */
  for (const base of ['production-orders', 'orders'] as const) {
    router.get(
      `/mfg/${base}`,
      anyView(...ORDER_PAGES),
      validate({ query: ordQ }),
      h(async (req, res) => {
        const q = validated(res, 'query', ordQ);
        const r = await orderService.list(C(req), await firstPage(req, ORDER_PAGES, 'view'), q);
        paged(res, r.rows, r.total, q.page, q.size);
      }),
    );
  }
  router.get(
    '/mfg/production-orders/:id',
    anyView(...ORDER_PAGES),
    validate({ params: idp }),
    h(async (req, res) =>
      send(
        res,
        await orderService.get(
          C(req),
          await firstPage(req, ORDER_PAGES, 'view'),
          String(req.params.id),
        ),
      ),
    ),
  );
  router.get(
    '/mfg/production-orders/:id/materials',
    anyView(...ORDER_PAGES),
    validate({ params: idp }),
    h(async (req, res) => {
      const o = await orderService.get(
        C(req),
        await firstPage(req, ORDER_PAGES, 'view'),
        String(req.params.id),
      );
      res.json({ data: o.materials ?? [] });
    }),
  );
  router.get(
    '/mfg/production-orders/:id/cost-sheet',
    anyView('mfg-costing', 'mfg-orders', 'mfg-wip'),
    validate({ params: idp }),
    h(async (req, res) =>
      send(
        res,
        await reportsService.costSheet(
          C(req),
          await firstPage(req, ['mfg-costing', 'mfg-orders', 'mfg-wip'], 'view'),
          String(req.params.id),
        ),
      ),
    ),
  );
  const ordB = z
    .object({
      itemId: uuid,
      qty: pos,
      dueDate: isoDate,
      startDate: isoDate.optional(),
      customerId: uuid.optional(),
      customerPoNo: opt(60),
      warehouseId: uuid,
      rmWarehouseId: uuid,
      wipWhId: uuid.optional(),
      priority: z.number().int().min(1).max(5).optional(),
      overProductionPct: num.refine((v) => Number(v) <= 100, 'Up to 100.').optional(),
      sourceType: z.enum(['MANUAL', 'SALES_ORDER', 'MRP', 'PLAN']).optional(),
      sourceId: uuid.optional(),
      planLineId: uuid.optional(),
      soLineId: uuid.optional(),
      suggestionId: uuid.optional(),
      notes: opt(300),
    })
    .strict();
  router.post(
    '/mfg/production-orders',
    g('mfg-orders', 'add'),
    validate({ body: ordB }),
    h(async (req, res) => {
      const b = validated(res, 'body', ordB);
      await idem(req, res, 'mfg-order-create', [b], () =>
        orderService.create(C(req), 'mfg-orders', b),
      );
    }),
  );
  const ordU = ordB.omit({ itemId: true, sourceType: true, sourceId: true }).partial().strict();
  router.patch(
    '/mfg/production-orders/:id',
    g('mfg-orders', 'edit'),
    validate({ params: idp, body: ordU }),
    h(async (req, res) =>
      send(
        res,
        await orderService.update(
          C(req),
          'mfg-orders',
          String(req.params.id),
          ver(req),
          validated(res, 'body', ordU),
        ),
      ),
    ),
  );
  router.post(
    '/mfg/production-orders/:id/release',
    g('mfg-orders', 'post'),
    validate({ params: idp }),
    h(async (req, res) => {
      const id = String(req.params.id);
      const v = ver(req);
      const approver = await canDo(req, 'mfg-orders', 'approve');
      await idem(req, res, 'mfg-order-release', [id, v], () =>
        orderService.release(C(req), 'mfg-orders', id, v, approver),
      );
    }),
  );
  router.post(
    '/mfg/production-orders/:id/approve',
    g('mfg-orders', 'approve'),
    validate({ params: idp }),
    h(async (req, res) => {
      const id = String(req.params.id);
      const v = ver(req);
      await idem(req, res, 'mfg-order-release', [id, v], () =>
        orderService.release(C(req), 'mfg-orders', id, v, true),
      );
    }),
  );
  router.post(
    '/mfg/production-orders/:id/start-complete',
    g('mfg-orders', 'post'),
    validate({ params: idp }),
    h(async (req, res) =>
      send(
        res,
        await orderService.technicallyComplete(C(req), 'mfg-orders', String(req.params.id)),
      ),
    ),
  );
  const noteB = z.object({ note: opt(300) }).strict();
  router.post(
    '/mfg/production-orders/:id/close',
    g('mfg-orders', 'approve'),
    validate({ params: idp, body: noteB }),
    h(async (req, res) => {
      const id = String(req.params.id);
      const v = ver(req);
      const note = validated(res, 'body', noteB).note;
      await idem(req, res, 'mfg-order-close', [id, v], () =>
        orderService.close(C(req), 'mfg-orders', id, v, note),
      );
    }),
  );
  router.post(
    '/mfg/production-orders/:id/cancel',
    g('mfg-orders', 'cancel'),
    validate({ params: idp, body: reasonB }),
    h(async (req, res) =>
      send(
        res,
        await orderService.cancel(
          C(req),
          'mfg-orders',
          String(req.params.id),
          ver(req),
          validated(res, 'body', reasonB).reason,
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
              qty: pos,
              batchNo: opt(60),
              serialNos: z.array(txt(60)).max(500).optional(),
            })
            .strict(),
        )
        .min(1)
        .max(100),
    })
    .strict();
  router.post(
    '/mfg/production-orders/:id/issue',
    g('mfg-orders', 'post'),
    validate({ params: idp, body: issueB }),
    h(async (req, res) => {
      const id = String(req.params.id);
      const b = validated(res, 'body', issueB);
      const sup = await canDo(req, 'mfg-orders', 'approve');
      await idem(req, res, 'mfg-order-issue', [id, b], () =>
        orderService.issue(C(req), 'mfg-orders', id, b.lines, sup),
      );
    }),
  );
  const retB = z
    .object({
      lines: z
        .array(z.object({ materialId: uuid, qty: pos, batchNo: opt(60) }).strict())
        .min(1)
        .max(100),
    })
    .strict();
  router.post(
    '/mfg/production-orders/:id/return',
    g('mfg-orders', 'post'),
    validate({ params: idp, body: retB }),
    h(async (req, res) => {
      const id = String(req.params.id);
      const b = validated(res, 'body', retB);
      await idem(req, res, 'mfg-order-return', [id, b], () =>
        orderService.returnMaterial(C(req), 'mfg-orders', id, b.lines),
      );
    }),
  );

  // ---------------------------------------------------------------- production receipts (finished goods)
  const rcB = z
    .object({
      orderId: uuid,
      qty: pos,
      batchNo: opt(60),
      serialNos: z.array(txt(60)).max(1000).optional(),
    })
    .strict();
  router.post(
    '/mfg/production-receipts',
    g('mfg-fg', 'post'),
    validate({ body: rcB }),
    h(async (req, res) => {
      const { orderId, ...b } = validated(res, 'body', rcB);
      await idem(req, res, 'mfg-receipt', [orderId, b], () =>
        orderService.receive(C(req), 'mfg-fg', orderId, b),
      );
    }),
  );
  router.post(
    '/mfg/production-receipts/:id/cancel',
    g('mfg-fg', 'cancel'),
    validate({ params: idp, body: reasonB }),
    h(async (req, res) =>
      send(
        res,
        await orderService.cancelReceipt(
          C(req),
          'mfg-fg',
          String(req.params.id),
          validated(res, 'body', reasonB).reason,
        ),
      ),
    ),
  );

  // ---------------------------------------------------------------- job cards, time logs, downtime
  const jcQ = z
    .object({
      workCentreId: uuid.optional(),
      status: z.enum(['Pending', 'In Progress', 'Paused', 'Done']).optional(),
      orderId: uuid.optional(),
      q: opt(80),
      ...pageQuery,
    })
    .strict();
  router.get(
    '/mfg/job-cards',
    anyView('mfg-workorders', 'mfg-shopfloor'),
    validate({ query: jcQ }),
    h(async (req, res) => {
      const q = validated(res, 'query', jcQ);
      const r = await jobCardService.list(
        C(req),
        await firstPage(req, ['mfg-workorders', 'mfg-shopfloor'], 'view'),
        q,
      );
      paged(res, r.rows, r.total, q.page, q.size);
    }),
  );
  router.get(
    '/mfg/job-cards/:id',
    anyView('mfg-workorders', 'mfg-shopfloor'),
    validate({ params: idp }),
    h(async (req, res) =>
      send(
        res,
        await jobCardService.get(
          C(req),
          await firstPage(req, ['mfg-workorders', 'mfg-shopfloor'], 'view'),
          String(req.params.id),
        ),
      ),
    ),
  );
  const startB = z.object({ kind: z.enum(['SETUP', 'RUN']), operator: opt(80) }).strict();
  router.post(
    '/mfg/job-cards/:id/start',
    g('mfg-workorders', 'post'),
    validate({ params: idp, body: startB }),
    h(async (req, res) => {
      const id = String(req.params.id);
      const b = validated(res, 'body', startB);
      const k = idemOf(req);
      await idem(req, res, 'mfg-jc-start', [id, b], () =>
        jobCardService.start(C(req), 'mfg-workorders', id, {
          ...b,
          ...(k ? { idempotencyKey: k } : {}),
        }),
      );
    }),
  );
  const pauseB = z.object({ reasonId: uuid, remarks: opt(200) }).strict();
  router.post(
    '/mfg/job-cards/:id/pause',
    g('mfg-workorders', 'post'),
    validate({ params: idp, body: pauseB }),
    h(async (req, res) => {
      const id = String(req.params.id);
      const b = validated(res, 'body', pauseB);
      await idem(req, res, 'mfg-jc-pause', [id, b], () =>
        jobCardService.pause(C(req), 'mfg-workorders', id, b),
      );
    }),
  );
  const resumeB = z.object({ operator: opt(80) }).strict();
  router.post(
    '/mfg/job-cards/:id/resume',
    g('mfg-workorders', 'post'),
    validate({ params: idp, body: resumeB }),
    h(async (req, res) => {
      const id = String(req.params.id);
      const b = validated(res, 'body', resumeB);
      await idem(req, res, 'mfg-jc-resume', [id, b], () =>
        jobCardService.resume(C(req), 'mfg-workorders', id, b),
      );
    }),
  );
  const logB = z
    .object({
      kind: z.enum(['SETUP', 'RUN']),
      fromTs: ts,
      toTs: ts,
      operator: opt(80),
      good: num.optional(),
      rejected: num.optional(),
    })
    .strict();
  router.post(
    '/mfg/job-cards/:id/time-logs',
    g('mfg-workorders', 'post'),
    validate({ params: idp, body: logB }),
    h(async (req, res) => {
      const id = String(req.params.id);
      const b = validated(res, 'body', logB);
      const k = idemOf(req);
      await idem(req, res, 'mfg-jc-log', [id, b], () =>
        jobCardService.logTime(C(req), 'mfg-workorders', id, {
          ...b,
          ...(k ? { idempotencyKey: k } : {}),
        }),
      );
    }),
  );
  const doneB = z
    .object({
      good: num.optional(),
      rejected: num.optional(),
      scrap: num.optional(),
      rework: num.optional(),
      scrapReasonId: uuid.optional(),
      reason: opt(200),
      operator: opt(80),
    })
    .strict();
  router.post(
    '/mfg/job-cards/:id/complete',
    g('mfg-workorders', 'post'),
    validate({ params: idp, body: doneB }),
    h(async (req, res) => {
      const id = String(req.params.id);
      const b = validated(res, 'body', doneB);
      const k = idemOf(req);
      await idem(req, res, 'mfg-jc-done', [id, b], () =>
        jobCardService.complete(C(req), 'mfg-workorders', id, {
          ...b,
          ...(k ? { idempotencyKey: k } : {}),
        }),
      );
    }),
  );
  const dtB = z.object({ workCentreId: uuid, reasonId: uuid, remarks: opt(200) }).strict();
  router.post(
    '/mfg/downtime',
    g('mfg-workorders', 'post'),
    validate({ body: dtB }),
    h(async (req, res) =>
      send(
        res,
        await jobCardService.startDowntime(C(req), 'mfg-workorders', validated(res, 'body', dtB)),
        201,
      ),
    ),
  );
  router.post(
    '/mfg/downtime/:id/end',
    g('mfg-workorders', 'post'),
    validate({ params: idp }),
    h(async (req, res) =>
      send(res, await jobCardService.endDowntime(C(req), 'mfg-workorders', String(req.params.id))),
    ),
  );

  // ---------------------------------------------------------------- scrap
  const scQ = z
    .object({
      orderId: uuid.optional(),
      status: z.enum(['Draft', 'Submitted', 'Cancelled']).optional(),
      from: isoDate.optional(),
      to: isoDate.optional(),
      q: opt(80),
      ...pageQuery,
    })
    .strict();
  router.get(
    '/mfg/scrap-entries',
    g('mfg-scrap', 'view'),
    validate({ query: scQ }),
    h(async (req, res) => {
      const q = validated(res, 'query', scQ);
      const r = await scrapService.list(C(req), 'mfg-scrap', q);
      paged(res, r.rows, r.total, q.page, q.size);
    }),
  );
  router.get(
    '/mfg/scrap-entries/:id',
    g('mfg-scrap', 'view'),
    validate({ params: idp }),
    h(async (req, res) =>
      send(res, await scrapService.get(C(req), 'mfg-scrap', String(req.params.id))),
    ),
  );
  const scB = z
    .object({
      orderId: uuid,
      opId: uuid.optional(),
      qty: pos,
      reasonId: uuid.optional(),
      reason: opt(200),
      isNormal: z.boolean().optional(),
      recoverableQty: num.optional(),
      recoveryItemId: uuid.optional(),
      recoveryValue: num.optional(),
      disposalMethod: opt(60),
    })
    .strict();
  router.post(
    '/mfg/scrap-entries',
    g('mfg-scrap', 'add'),
    validate({ body: scB }),
    h(async (req, res) => {
      const b = validated(res, 'body', scB);
      await idem(req, res, 'mfg-scrap-create', [b], () =>
        scrapService.create(C(req), 'mfg-scrap', b),
      );
    }),
  );
  router.post(
    '/mfg/scrap-entries/:id/submit',
    g('mfg-scrap', 'post'),
    validate({ params: idp }),
    h(async (req, res) => {
      const id = String(req.params.id);
      const approver = await canDo(req, 'mfg-scrap', 'approve');
      await idem(req, res, 'mfg-scrap-submit', [id], () =>
        scrapService.submit(C(req), 'mfg-scrap', id, approver),
      );
    }),
  );
  router.post(
    '/mfg/scrap-entries/:id/cancel',
    g('mfg-scrap', 'cancel'),
    validate({ params: idp, body: reasonB }),
    h(async (req, res) =>
      send(
        res,
        await scrapService.cancel(
          C(req),
          'mfg-scrap',
          String(req.params.id),
          validated(res, 'body', reasonB).reason,
        ),
      ),
    ),
  );

  // ---------------------------------------------------------------- rework orders
  const rwQ = z
    .object({
      status: z.enum(['Open', 'Done', 'Cancelled']).optional(),
      orderId: uuid.optional(),
      q: opt(80),
      ...pageQuery,
    })
    .strict();
  router.get(
    '/mfg/rework-orders',
    g('mfg-rework', 'view'),
    validate({ query: rwQ }),
    h(async (req, res) => {
      const q = validated(res, 'query', rwQ);
      const r = await jobCardService.listRework(C(req), 'mfg-rework', q);
      paged(res, r.rows, r.total, q.page, q.size);
    }),
  );
  router.post(
    '/mfg/rework-orders/:id/release',
    g('mfg-rework', 'post'),
    validate({ params: idp }),
    h(async (req, res) =>
      send(res, await jobCardService.releaseRework(C(req), 'mfg-rework', String(req.params.id))),
    ),
  );
  const rwB = z
    .object({
      qtyOk: num,
      qtyScrap: num,
      hours: num.optional(),
      materialCost: num.optional(),
      reinspection: z.enum(['ACCEPTED', 'REJECTED', 'PENDING']).optional(),
      note: opt(300),
    })
    .strict();
  router.post(
    '/mfg/rework-orders/:id/complete',
    g('mfg-rework', 'post'),
    validate({ params: idp, body: rwB }),
    h(async (req, res) => {
      const id = String(req.params.id);
      const b = validated(res, 'body', rwB);
      await idem(req, res, 'mfg-rework-done', [id, b], () =>
        jobCardService.completeRework(C(req), 'mfg-rework', id, b),
      );
    }),
  );

  // ---------------------------------------------------------------- reports, shop floor
  const pgQ = z.object({ ...pageQuery }).strict();
  router.get(
    '/mfg/reports/wip',
    g('mfg-wip', 'view'),
    validate({ query: pgQ }),
    h(async (req, res) =>
      send(res, await reportsService.wip(C(req), 'mfg-wip', validated(res, 'query', pgQ))),
    ),
  );
  router.get(
    '/mfg/reports/wip-reconciliation',
    g('mfg-wip', 'view'),
    validate({ query: noQ }),
    h(async (req, res) => send(res, await reportsService.wipReconciliation(C(req)))),
  );
  const costQ = z.object({ status: opt(20), q: opt(80), ...pageQuery }).strict();
  router.get(
    '/mfg/reports/costing',
    g('mfg-costing', 'view'),
    validate({ query: costQ }),
    h(async (req, res) =>
      send(
        res,
        await reportsService.costing(C(req), 'mfg-costing', validated(res, 'query', costQ)),
      ),
    ),
  );
  router.get(
    '/mfg/reports/variance',
    g('mfg-costing', 'view'),
    validate({ query: pgQ }),
    h(async (req, res) =>
      send(
        res,
        await reportsService.variances(C(req), 'mfg-costing', validated(res, 'query', pgQ)),
      ),
    ),
  );
  router.get(
    '/mfg/reports/yield',
    g('mfg-costing', 'view'),
    validate({ query: pgQ }),
    h(async (req, res) =>
      send(
        res,
        await reportsService.yieldReport(C(req), 'mfg-costing', validated(res, 'query', pgQ)),
      ),
    ),
  );
  const rangeQ = z.object({ from: isoDate, to: isoDate, workCentreId: uuid.optional() }).strict();
  router.get(
    '/mfg/reports/oee',
    g('mfg-shopfloor', 'view'),
    validate({ query: rangeQ }),
    h(async (req, res) =>
      send(res, await reportsService.oee(C(req), validated(res, 'query', rangeQ))),
    ),
  );
  const adhQ = z.object({ from: isoDate, to: isoDate }).strict();
  router.get(
    '/mfg/reports/plan-adherence',
    g('mfg-plan', 'view'),
    validate({ query: adhQ }),
    h(async (req, res) =>
      send(
        res,
        await reportsService.planAdherence(C(req), 'mfg-plan', validated(res, 'query', adhQ)),
      ),
    ),
  );
  const sfQ = z.object({ date: isoDate.optional() }).strict();
  router.get(
    '/mfg/shopfloor/summary',
    g('mfg-shopfloor', 'view'),
    validate({ query: sfQ }),
    h(async (req, res) =>
      send(res, await reportsService.shopFloor(C(req), validated(res, 'query', sfQ))),
    ),
  );
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
      send(res, await reportsService.capacity(C(req), 'mfg-plan', validated(res, 'query', capQ))),
    ),
  );

  // ---------------------------------------------------------------- daily board (kept from the first build)
  const planQ = z
    .object({
      from: isoDate.optional(),
      to: isoDate.optional(),
      orderId: uuid.optional(),
      ...pageQuery,
    })
    .strict();
  router.get(
    '/mfg/day-board',
    g('mfg-plan', 'view'),
    validate({ query: planQ }),
    h(async (req, res) => {
      const q = validated(res, 'query', planQ);
      const r = await boardService.listPlan(C(req), 'mfg-plan', q);
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
    '/mfg/day-board',
    g('mfg-plan', 'add'),
    validate({ body: planB }),
    h(async (req, res) =>
      send(
        res,
        await boardService.createPlan(C(req), 'mfg-plan', validated(res, 'body', planB)),
        201,
      ),
    ),
  );
  const planU = planB.omit({ orderId: true, itemId: true }).partial().strict();
  router.patch(
    '/mfg/day-board/:id',
    g('mfg-plan', 'edit'),
    validate({ params: idp, body: planU }),
    h(async (req, res) =>
      send(
        res,
        await boardService.updatePlan(
          C(req),
          'mfg-plan',
          String(req.params.id),
          ver(req),
          validated(res, 'body', planU),
        ),
      ),
    ),
  );
  router.delete(
    '/mfg/day-board/:id',
    g('mfg-plan', 'delete'),
    validate({ params: idp }),
    h(async (req, res) => {
      await boardService.deletePlan(C(req), 'mfg-plan', String(req.params.id));
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
      const r = await boardService.listJwLines(C(req), 'mfg-orders', q);
      paged(res, r.rows, r.total, q.page, q.size);
    }),
  );
  router.get(
    '/mfg/jobwork/lines/:id',
    g('mfg-orders', 'view'),
    validate({ params: idp }),
    h(async (req, res) =>
      send(res, await boardService.getJwLine(C(req), 'mfg-orders', String(req.params.id))),
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
        await boardService.createJwLine(C(req), 'mfg-orders', validated(res, 'body', jwB)),
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
          C(req),
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
        boardService.addJwMove(C(req), 'mfg-orders', id, b),
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
          C(req),
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
      const r = await boardService.listChallanRework(C(req), 'mfg-rework', q);
      paged(res, r.rows, r.total, q.page, q.size);
    }),
  );
  router.get(
    '/mfg/challan-rework/:id',
    g('mfg-rework', 'view'),
    validate({ params: idp }),
    h(async (req, res) =>
      send(res, await boardService.getChallanRework(C(req), 'mfg-rework', String(req.params.id))),
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
        await boardService.createChallanRework(C(req), 'mfg-rework', validated(res, 'body', crB)),
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
        boardService.addReworkDone(C(req), 'mfg-rework', id, b),
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
          C(req),
          'mfg-rework',
          String(req.params.id),
          String(req.params.doneId),
        ),
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
      const rows = await rep.load(C(req), validated(res, 'query', expQ));
      xlsx(res, `mfg-${name}`, await reportWorkbook(rep, rows));
    }),
  );
  router.get(
    '/mfg/mrp-runs/:id/export',
    g('mfg-mrp', 'print'),
    validate({ params: idp }),
    h(async (req, res) => xlsx(res, 'mfg-mrp', await mrpWorkbook(C(req), String(req.params.id)))),
  );
  router.get(
    '/mfg/mrp-runs/:id/print',
    g('mfg-mrp', 'print'),
    validate({ params: idp }),
    h(async (req, res) => pdf(res, 'mrp', await mrpPdf(C(req), String(req.params.id)))),
  );
  router.get(
    '/mfg/production-orders/:id/print',
    g('mfg-orders', 'print'),
    validate({ params: idp }),
    h(async (req, res) =>
      pdf(res, 'production-order', await orderPdf(C(req), String(req.params.id))),
    ),
  );
  router.get(
    '/mfg/production-orders/:id/traveller',
    g('mfg-orders', 'print'),
    validate({ params: idp }),
    h(async (req, res) => pdf(res, 'traveller', await travellerPdf(C(req), String(req.params.id)))),
  );
  router.get(
    '/mfg/job-cards/:id/print',
    g('mfg-workorders', 'print'),
    validate({ params: idp }),
    h(async (req, res) => pdf(res, 'job-card', await jobCardPdf(C(req), String(req.params.id)))),
  );
  router.get(
    '/mfg/boms/:id/print',
    g('mfg-bom', 'print'),
    validate({ params: idp }),
    h(async (req, res) =>
      pdf(res, 'bill-of-materials', await bomPdf(C(req), String(req.params.id))),
    ),
  );
  router.get(
    '/mfg/routings/:id/print',
    g('mfg-routing', 'print'),
    validate({ params: idp }),
    h(async (req, res) => pdf(res, 'routing', await routingPdf(C(req), String(req.params.id)))),
  );

  return router;
}
