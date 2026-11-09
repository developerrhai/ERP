// Phase 14 API: /api/v1/maint (CMMS) and /api/v1/assets (register and fixed-asset documents). authenticate ->
// requirePasswordChanged -> resolveContext -> permission -> zod -> service. The permission page follows the screen: maint-machines,
// maint-equipment, maint-preventive, maint-breakdown, maint-workorders, maint-spares, maint-schedule, maint-downtime, maint-mtbf,
// maint-alerts, asset-master, asset-capitalization, asset-allocation, asset-transfer, asset-maintenance, asset-depreciation,
// asset-disposal, asset-qr.
import { Router } from 'express';
import type { Request, RequestHandler, Response } from 'express';
import QRCode from 'qrcode';
import { z } from 'zod';
import { authenticate, requirePasswordChanged } from '../../core/auth/authenticate';
import { resolveContext } from '../../core/context/resolve-context';
import { asyncHandler } from '../../core/http/async-handler';
import { Errors } from '../../core/http/errors';
import { parseIfMatch } from '../../core/http/if-match';
import { validate, validated } from '../../core/http/validate';
import { finishPdf, newPdf } from '../../core/pdf';
import { accessUserOf, can, requirePageAction } from '../../core/rbac/access';
import type { Action } from '../../core/rbac/permission-model';
import { runIdempotent } from '../approvals/idempotent';
import { prisma } from '../../core/db/prisma';
import { callerOf, isoDate, pageQuery, uuid } from '../inventory/routes-shared';
import { query } from '../procurement/core';
import type { Caller } from '../records/service';
import { ASSET_CLASSES, ASSET_KINDS, assetService } from './asset-service';
import { faService } from './fa-service';
import { maintService } from './maint-service';

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
const reasonB = z.object({ reason: txt(300) }).strict();
const h = (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
  asyncHandler(async (req, res) => {
    await fn(req, res);
  });
const g = (page: string, a: Action): RequestHandler => requirePageAction(page, a);
const ver = (req: Request) => parseIfMatch(req.get('if-match'));
const bool = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true')
  .optional();

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
async function firstPage(req: Request, pages: readonly string[], action: Action): Promise<string> {
  if (!req.auth) throw Errors.unauthenticated();
  const u = accessUserOf(req.auth);
  for (const p of pages) if (await can(u, p, action)) return p;
  throw Errors.forbidden();
}

const ASSET_PAGES = [
  'asset-master',
  'maint-machines',
  'maint-equipment',
  'asset-qr',
  'asset-maintenance',
  'maint-workorders',
  'maint-preventive',
  'maint-breakdown',
  'maint-downtime',
  'asset-allocation',
  'asset-transfer',
  'asset-capitalization',
  'asset-disposal',
  'asset-depreciation',
] as const;

export function createAssetsRouter(): Router {
  const router = Router();
  router.use(['/maint', '/assets'], authenticate, requirePasswordChanged, resolveContext);
  const C = (req: Request): Caller => callerOf(req);
  const send = (res: Response, data: object, status = 200) => {
    const v = (data as { version?: number }).version;
    if (v !== undefined) res.set('ETag', `"${v}"`);
    res.status(status).json({ data });
  };
  const paged = (
    res: Response,
    rows: unknown[],
    total: number,
    p: number,
    size: number,
    extra = {},
  ) => res.json({ data: rows, meta: { page: p, size, total, ...extra } });
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
      req.auth!.userId,
      `${scope}:${req.ctx?.unitId ?? 'all'}`,
      [req.path, ...parts],
      async () => {
        const r = await fn();
        return { ...r, version: Number((r as { version?: unknown }).version ?? 0) };
      },
    );

  // ---------------------------------------------------------------- categories, blocks
  router.get(
    '/assets/categories',
    anyView(...ASSET_PAGES),
    validate({ query: noQ }),
    h(async (_req, res) => res.json({ data: await assetService.listCategories() })),
  );
  const catB = z
    .object({
      code: z
        .string()
        .trim()
        .regex(/^[A-Za-z0-9_-]{2,20}$/, 'Use 2 to 20 letters, digits, - or _.')
        .optional(),
      name: txt(120),
      assetClass: z.enum(ASSET_CLASSES),
      assetAccount: txt(20),
      accumDepAccount: opt(20),
      expenseAccount: opt(20),
      cwipAccount: opt(20),
      itcEligible: z.boolean().optional(),
      isMaintainableDefault: z.boolean().optional(),
      nesd: z.boolean().optional(),
      itBlockCode: opt(20),
      status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
    })
    .strict();
  router.post(
    '/assets/categories',
    g('asset-master', 'add'),
    validate({ body: catB }),
    h(async (req, res) =>
      send(
        res,
        await assetService.saveCategory(C(req), 'asset-master', null, validated(res, 'body', catB)),
        201,
      ),
    ),
  );
  router.put(
    '/assets/categories/:id',
    g('asset-master', 'edit'),
    validate({ params: idp, body: catB }),
    h(async (req, res) =>
      send(
        res,
        await assetService.saveCategory(
          C(req),
          'asset-master',
          String(req.params.id),
          validated(res, 'body', catB),
        ),
      ),
    ),
  );
  const bpB = z
    .object({
      effectiveFrom: isoDate,
      method: z.enum(['SLM', 'WDV']),
      usefulLifeMonths: z.number().int().min(1).max(1200),
      residualPct: num,
      sch2Ref: opt(120),
    })
    .strict();
  router.put(
    '/assets/categories/:id/book-params',
    g('asset-master', 'edit'),
    validate({ params: idp, body: bpB }),
    h(async (req, res) =>
      res.json({
        data: await assetService.saveBookParam(
          C(req),
          'asset-master',
          String(req.params.id),
          validated(res, 'body', bpB),
        ),
      }),
    ),
  );
  router.get(
    '/assets/it-blocks',
    anyView(...ASSET_PAGES),
    validate({ query: noQ }),
    h(async (_req, res) => res.json({ data: await assetService.listBlocks() })),
  );
  const brB = z
    .object({
      blockCode: txt(20),
      name: opt(120),
      effectiveFrom: isoDate,
      ratePct: num,
      actRef: txt(60),
    })
    .strict();
  router.put(
    '/assets/it-blocks/rates',
    g('asset-depreciation', 'edit'),
    validate({ body: brB }),
    h(async (req, res) =>
      res.json({
        data: await assetService.saveBlockRate(
          C(req),
          'asset-depreciation',
          validated(res, 'body', brB),
        ),
      }),
    ),
  );

  // ---------------------------------------------------------------- assets: three views of the same rows
  const listQ = z
    .object({
      status: z.enum(['CWIP', 'ACTIVE', 'IDLE', 'UNDER_MAINT', 'DISPOSED']).optional(),
      categoryId: uuid.optional(),
      parentId: uuid.optional(),
      maintainable: bool,
      q: opt(80),
      ...pageQuery,
    })
    .strict();
  const assetB = z
    .object({
      name: txt(160),
      categoryId: uuid,
      assetKind: z.enum(ASSET_KINDS).optional(),
      parentAssetId: uuid.optional(),
      isComponent: z.boolean().optional(),
      isMaintainable: z.boolean().optional(),
      department: opt(60),
      location: opt(120),
      costCentreId: uuid.optional(),
      workCentreId: uuid.optional(),
      make: opt(80),
      model: opt(80),
      serialNo: opt(80),
      criticality: z.enum(['A', 'B', 'C']).optional(),
      commissionDate: isoDate.optional(),
      warrantyEnd: isoDate.optional(),
      supplierId: uuid.optional(),
      purchaseInvoiceRef: opt(60),
      putToUseDate: isoDate.optional(),
      itBlockId: uuid.optional(),
      notes: opt(300),
    })
    .strict();
  const assetU = assetB
    .omit({ categoryId: true })
    .partial()
    .extend({ status: z.enum(['ACTIVE', 'IDLE']).optional() })
    .strict();
  const views = [
    { base: '/maint/machines', page: 'maint-machines', kinds: ['MACHINE'] },
    { base: '/maint/equipment', page: 'maint-equipment', kinds: ['EQUIPMENT'] },
    { base: '/assets/register', page: 'asset-master', kinds: [] as string[] },
  ];
  for (const v of views) {
    router.get(
      v.base,
      g(v.page, 'view'),
      validate({ query: listQ }),
      h(async (req, res) => {
        const q = validated(res, 'query', listQ);
        const r = await assetService.list(C(req), v.page, { ...q, kinds: v.kinds });
        paged(res, r.rows, r.total, q.page, q.size);
      }),
    );
    router.post(
      v.base,
      g(v.page, 'add'),
      validate({ body: assetB }),
      h(async (req, res) => {
        const b = validated(res, 'body', assetB);
        const kind = v.kinds[0] as (typeof ASSET_KINDS)[number] | undefined;
        send(
          res,
          await assetService.create(C(req), v.page, { ...b, ...(kind ? { assetKind: kind } : {}) }),
          201,
        );
      }),
    );
    router.patch(
      `${v.base}/:id`,
      g(v.page, 'edit'),
      validate({ params: idp, body: assetU }),
      h(async (req, res) =>
        send(
          res,
          await assetService.update(
            C(req),
            v.page,
            String(req.params.id),
            ver(req),
            validated(res, 'body', assetU),
          ),
        ),
      ),
    );
  }
  router.get(
    '/assets/lookup',
    anyView(...ASSET_PAGES),
    validate({ query: z.object({ q: opt(80), maintainable: bool, ...pageQuery }).strict() }),
    h(async (req, res) => {
      const q = validated(
        res,
        'query',
        z.object({ q: opt(80), maintainable: bool, ...pageQuery }).strict(),
      );
      const r = await assetService.list(C(req), await firstPage(req, ASSET_PAGES, 'view'), {
        ...q,
        kinds: [],
      });
      paged(res, r.rows, r.total, q.page, q.size);
    }),
  );
  router.get(
    '/assets/by-id/:id',
    anyView(...ASSET_PAGES),
    validate({ params: idp }),
    h(async (req, res) =>
      send(
        res,
        await assetService.get(
          C(req),
          await firstPage(req, ASSET_PAGES, 'view'),
          String(req.params.id),
        ),
      ),
    ),
  );
  router.get(
    '/assets/by-id/:id/readings',
    anyView(...ASSET_PAGES),
    validate({ params: idp }),
    h(async (req, res) =>
      res.json({
        data: await assetService.readings(
          C(req),
          await firstPage(req, ASSET_PAGES, 'view'),
          String(req.params.id),
        ),
      }),
    ),
  );
  const meterB = z
    .object({ meterType: z.enum(['RUN_HRS', 'STROKES', 'KM']), uom: opt(10) })
    .strict();
  router.post(
    '/assets/by-id/:id/meters',
    anyView('maint-machines', 'maint-equipment', 'asset-master'),
    validate({ params: idp, body: meterB }),
    h(async (req, res) => {
      const page = await firstPage(
        req,
        ['maint-machines', 'maint-equipment', 'asset-master'],
        'edit',
      );
      send(
        res,
        await assetService.addMeter(
          C(req),
          page,
          String(req.params.id),
          validated(res, 'body', meterB),
        ),
        201,
      );
    }),
  );
  const readB = z
    .object({ value: num, readingAt: ts.optional(), isReset: z.boolean().optional() })
    .strict();
  router.post(
    '/assets/meters/:id/readings',
    anyView('maint-machines', 'maint-equipment', 'asset-master'),
    validate({ params: idp, body: readB }),
    h(async (req, res) => {
      const page = await firstPage(
        req,
        ['maint-machines', 'maint-equipment', 'asset-master'],
        'edit',
      );
      send(
        res,
        await assetService.addReading(
          C(req),
          page,
          String(req.params.id),
          validated(res, 'body', readB),
        ),
        201,
      );
    }),
  );

  // ---------------------------------------------------------------- small lookups for the forms
  const LOOK = [
    'asset-allocation',
    'asset-transfer',
    'maint-workorders',
    'asset-maintenance',
    'maint-machines',
    'maint-equipment',
    'asset-master',
    'asset-capitalization',
  ] as const;
  router.get(
    '/assets/lookup-users',
    anyView(...LOOK),
    validate({ query: noQ }),
    h(async (_req, res) => {
      res.json({
        data: await query(
          prisma,
          `SELECT id::text, name FROM users WHERE status='ACTIVE' ORDER BY name LIMIT 500`,
        ),
      });
    }),
  );
  router.get(
    '/assets/lookup-units',
    anyView(...LOOK),
    validate({ query: noQ }),
    h(async (_req, res) => {
      res.json({
        data: await query(
          prisma,
          `SELECT id::text, code, name FROM units WHERE status='ACTIVE' ORDER BY code`,
        ),
      });
    }),
  );
  router.get(
    '/assets/lookup-cost-centres',
    anyView(...LOOK),
    validate({ query: noQ }),
    h(async (req, res) => {
      res.json({
        data: await query(
          prisma,
          `SELECT id::text, code, name FROM cost_centers WHERE deleted_at IS NULL AND NOT is_group AND status='Active' AND ($1::uuid IS NULL OR unit_id=$1::uuid) ORDER BY code LIMIT 300`,
          C(req).ctx.unitId ?? null,
        ),
      });
    }),
  );
  router.get(
    '/assets/lookup-accounts',
    anyView('asset-capitalization', 'asset-disposal', 'asset-master'),
    validate({ query: noQ }),
    h(async (_req, res) => {
      res.json({
        data: await query(
          prisma,
          `SELECT code, name FROM accounts WHERE posting_allowed AND NOT party_required AND deleted_at IS NULL ORDER BY code LIMIT 600`,
        ),
      });
    }),
  );

  // ---------------------------------------------------------------- checklists, PM plans, schedules
  router.get(
    '/maint/checklists',
    anyView('maint-preventive', 'maint-workorders'),
    validate({ query: noQ }),
    h(async (_req, res) => res.json({ data: await maintService.listChecklists() })),
  );
  const clB = z
    .object({
      code: z
        .string()
        .trim()
        .regex(/^[A-Za-z0-9_-]{2,20}$/)
        .optional(),
      name: txt(120),
      items: z
        .array(
          z
            .object({
              text: txt(300),
              answerType: z.enum(['OK_NOTOK', 'NUMBER', 'TEXT']).optional(),
              min: num.optional(),
              max: num.optional(),
            })
            .strict(),
        )
        .min(1)
        .max(100),
    })
    .strict();
  router.post(
    '/maint/checklists',
    g('maint-preventive', 'add'),
    validate({ body: clB }),
    h(async (req, res) =>
      res.status(201).json({
        data: await maintService.saveChecklist(
          C(req),
          'maint-preventive',
          null,
          validated(res, 'body', clB),
        ),
      }),
    ),
  );
  router.put(
    '/maint/checklists/:id',
    g('maint-preventive', 'edit'),
    validate({ params: idp, body: clB }),
    h(async (req, res) =>
      res.json({
        data: await maintService.saveChecklist(
          C(req),
          'maint-preventive',
          String(req.params.id),
          validated(res, 'body', clB),
        ),
      }),
    ),
  );

  const planQ = z.object({ assetId: uuid.optional(), active: bool, ...pageQuery }).strict();
  router.get(
    '/maint/plans',
    g('maint-preventive', 'view'),
    validate({ query: planQ }),
    h(async (req, res) => {
      const q = validated(res, 'query', planQ);
      const r = await maintService.listPlans(C(req), 'maint-preventive', q);
      paged(res, r.rows, r.total, q.page, q.size);
    }),
  );
  router.get(
    '/maint/plans/:id',
    g('maint-preventive', 'view'),
    validate({ params: idp }),
    h(async (req, res) =>
      send(res, await maintService.getPlan(C(req), 'maint-preventive', String(req.params.id))),
    ),
  );
  const planB = z
    .object({
      assetId: uuid,
      title: txt(160),
      triggerType: z.enum(['TIME', 'METER', 'BOTH']),
      intervalDays: z.number().int().min(1).max(3650).optional(),
      meterId: uuid.optional(),
      intervalMeter: pos.optional(),
      leadDays: z.number().int().min(0).max(90).optional(),
      estHours: num.optional(),
      skillDesignation: opt(80),
      checklistTemplateId: uuid.optional(),
      startFrom: isoDate.optional(),
      spares: z
        .array(z.object({ itemId: uuid, qty: pos, uom: opt(20) }).strict())
        .max(50)
        .optional(),
    })
    .strict();
  router.post(
    '/maint/plans',
    g('maint-preventive', 'add'),
    validate({ body: planB }),
    h(async (req, res) =>
      send(
        res,
        await maintService.createPlan(C(req), 'maint-preventive', validated(res, 'body', planB)),
        201,
      ),
    ),
  );
  router.post(
    '/maint/plans/:id/activate',
    g('maint-preventive', 'edit'),
    validate({ params: idp }),
    h(async (req, res) =>
      send(
        res,
        await maintService.setPlanActive(
          C(req),
          'maint-preventive',
          String(req.params.id),
          ver(req),
          true,
        ),
      ),
    ),
  );
  router.post(
    '/maint/plans/:id/deactivate',
    g('maint-preventive', 'edit'),
    validate({ params: idp }),
    h(async (req, res) =>
      send(
        res,
        await maintService.setPlanActive(
          C(req),
          'maint-preventive',
          String(req.params.id),
          ver(req),
          false,
        ),
      ),
    ),
  );

  const schQ = z
    .object({
      status: z.enum(['PLANNED', 'WO_CREATED', 'DONE', 'SKIPPED']).optional(),
      from: isoDate.optional(),
      to: isoDate.optional(),
      ...pageQuery,
    })
    .strict();
  router.get(
    '/maint/schedules',
    g('maint-schedule', 'view'),
    validate({ query: schQ }),
    h(async (req, res) => {
      const q = validated(res, 'query', schQ);
      const r = await maintService.listSchedules(C(req), 'maint-schedule', q);
      paged(res, r.rows, r.total, q.page, q.size);
    }),
  );
  router.post(
    '/maint/schedules/generate',
    g('maint-schedule', 'post'),
    validate({ body: noQ }),
    h(async (req, res) => {
      await idem(req, res, 'maint-gen', [], async () => ({
        ...(await maintService.generate(C(req))),
        version: 0,
      }));
    }),
  );
  router.post(
    '/maint/schedules/:id/skip',
    g('maint-schedule', 'edit'),
    validate({ params: idp }),
    h(async (req, res) =>
      send(res, await maintService.skipSchedule(C(req), 'maint-schedule', String(req.params.id))),
    ),
  );

  // ---------------------------------------------------------------- breakdowns
  const bdQ = z
    .object({
      status: z.enum(['OPEN', 'ACK', 'IN_REPAIR', 'RESOLVED', 'CLOSED', 'CANCELLED']).optional(),
      assetId: uuid.optional(),
      ...pageQuery,
    })
    .strict();
  router.get(
    '/maint/breakdowns',
    g('maint-breakdown', 'view'),
    validate({ query: bdQ }),
    h(async (req, res) => {
      const q = validated(res, 'query', bdQ);
      const r = await maintService.listBreakdowns(C(req), 'maint-breakdown', q);
      paged(res, r.rows, r.total, q.page, q.size);
    }),
  );
  router.get(
    '/maint/breakdowns/:id',
    g('maint-breakdown', 'view'),
    validate({ params: idp }),
    h(async (req, res) =>
      send(res, await maintService.getBreakdown(C(req), 'maint-breakdown', String(req.params.id))),
    ),
  );
  const bdB = z
    .object({
      assetId: uuid,
      symptom: txt(400),
      priority: z.enum(['P1', 'P2', 'P3']).optional(),
      machineStopped: z.boolean().optional(),
      reportedAt: ts.optional(),
      photos: z.array(txt(200)).max(6).optional(),
    })
    .strict();
  router.post(
    '/maint/breakdowns',
    g('maint-breakdown', 'add'),
    validate({ body: bdB }),
    h(async (req, res) => {
      const b = validated(res, 'body', bdB);
      await idem(req, res, 'maint-bd', [b], () => maintService.raise(C(req), 'maint-breakdown', b));
    }),
  );
  router.post(
    '/maint/breakdowns/:id/acknowledge',
    g('maint-breakdown', 'edit'),
    validate({ params: idp }),
    h(async (req, res) =>
      send(
        res,
        await maintService.acknowledge(C(req), 'maint-breakdown', String(req.params.id), ver(req)),
      ),
    ),
  );
  router.post(
    '/maint/breakdowns/:id/start-repair',
    g('maint-breakdown', 'edit'),
    validate({ params: idp }),
    h(async (req, res) =>
      send(
        res,
        await maintService.startRepair(C(req), 'maint-breakdown', String(req.params.id), ver(req)),
      ),
    ),
  );
  const resB = z
    .object({
      failureMode: txt(20),
      failureCause: txt(20),
      failureMechanism: opt(20),
      rootCause: opt(400),
      repairedAt: ts.optional(),
    })
    .strict();
  router.post(
    '/maint/breakdowns/:id/resolve',
    g('maint-breakdown', 'edit'),
    validate({ params: idp, body: resB }),
    h(async (req, res) =>
      send(
        res,
        await maintService.resolve(
          C(req),
          'maint-breakdown',
          String(req.params.id),
          ver(req),
          validated(res, 'body', resB),
        ),
      ),
    ),
  );
  router.post(
    '/maint/breakdowns/:id/close',
    g('maint-breakdown', 'approve'),
    validate({ params: idp }),
    h(async (req, res) =>
      send(
        res,
        await maintService.closeBreakdown(
          C(req),
          'maint-breakdown',
          String(req.params.id),
          ver(req),
        ),
      ),
    ),
  );
  router.post(
    '/maint/breakdowns/:id/cancel',
    g('maint-breakdown', 'cancel'),
    validate({ params: idp, body: reasonB }),
    h(async (req, res) =>
      send(
        res,
        await maintService.cancelBreakdown(
          C(req),
          'maint-breakdown',
          String(req.params.id),
          ver(req),
          validated(res, 'body', reasonB).reason,
        ),
      ),
    ),
  );
  router.get(
    '/maint/failure-codes',
    anyView('maint-breakdown', 'maint-mtbf'),
    validate({ query: noQ }),
    h(async (_req, res) => {
      res.json({
        data: await query(prisma, `SELECT kind, code, name FROM failure_codes ORDER BY kind, code`),
      });
    }),
  );

  // ---------------------------------------------------------------- work orders (machines and equipment / other assets)
  const woQ = z
    .object({
      type: z.enum(['PM', 'BREAKDOWN', 'CORRECTIVE', 'CALIBRATION', 'AMC']).optional(),
      status: z
        .enum(['PLANNED', 'APPROVED', 'IN_PROGRESS', 'COMPLETED', 'CLOSED', 'CANCELLED'])
        .optional(),
      assetId: uuid.optional(),
      ...pageQuery,
    })
    .strict();
  const woB = z
    .object({
      assetId: uuid,
      woType: z.enum(['PM', 'CORRECTIVE', 'CALIBRATION', 'AMC']),
      description: txt(400),
      priority: z.enum(['P1', 'P2', 'P3']).optional(),
      plannedStart: isoDate.optional(),
      plannedEnd: isoDate.optional(),
      estCost: num.optional(),
      checklistTemplateId: uuid.optional(),
    })
    .strict();
  const woViews = [
    {
      base: '/maint/work-orders',
      page: 'maint-workorders',
      kinds: ['MACHINE', 'EQUIPMENT'],
      notKinds: [] as string[],
    },
    {
      base: '/assets/maintenance',
      page: 'asset-maintenance',
      kinds: [] as string[],
      notKinds: ['MACHINE', 'EQUIPMENT'],
    },
  ];
  const taskB = z.object({ result: txt(200) }).strict();
  const spareB = z.object({ itemId: uuid, qty: pos, warehouseId: uuid.optional() }).strict();
  const issueB = z.object({ qty: pos, warehouseId: uuid.optional() }).strict();
  const retB = z.object({ qty: pos }).strict();
  const labB = z
    .object({
      employeeId: uuid.optional(),
      vendorName: opt(120),
      startAt: ts,
      endAt: ts,
      rate: num,
    })
    .strict();
  const vcB = z.object({ supplierId: uuid.optional(), invoiceRef: opt(60), amount: pos }).strict();
  const sp2 = z.object({ id: uuid, sid: uuid }).strict();
  const tk2 = z.object({ id: uuid, tid: uuid }).strict();
  for (const v of woViews) {
    const P = v.page;
    router.get(
      v.base,
      g(P, 'view'),
      validate({ query: woQ }),
      h(async (req, res) => {
        const q = validated(res, 'query', woQ);
        const r = await maintService.listWorkOrders(C(req), P, {
          ...q,
          kinds: v.kinds,
          notKinds: v.notKinds,
        });
        paged(res, r.rows, r.total, q.page, q.size);
      }),
    );
    router.get(
      `${v.base}/:id`,
      g(P, 'view'),
      validate({ params: idp }),
      h(async (req, res) =>
        send(res, await maintService.getWorkOrder(C(req), P, String(req.params.id))),
      ),
    );
    router.post(
      v.base,
      g(P, 'add'),
      validate({ body: woB }),
      h(async (req, res) => {
        const b = validated(res, 'body', woB);
        await idem(req, res, 'mwo-create', [b], () => maintService.createWorkOrder(C(req), P, b));
      }),
    );
    router.post(
      `${v.base}/:id/submit`,
      g(P, 'submit'),
      validate({ params: idp }),
      h(async (req, res) =>
        send(res, await maintService.submitWo(C(req), P, String(req.params.id), ver(req))),
      ),
    );
    router.post(
      `${v.base}/:id/approve`,
      g(P, 'approve'),
      validate({ params: idp }),
      h(async (req, res) =>
        send(res, await maintService.approveWo(C(req), P, String(req.params.id), ver(req), true)),
      ),
    );
    router.post(
      `${v.base}/:id/reject`,
      g(P, 'approve'),
      validate({ params: idp }),
      h(async (req, res) =>
        send(res, await maintService.approveWo(C(req), P, String(req.params.id), ver(req), false)),
      ),
    );
    router.post(
      `${v.base}/:id/start`,
      g(P, 'post'),
      validate({ params: idp }),
      h(async (req, res) =>
        send(res, await maintService.startWo(C(req), P, String(req.params.id))),
      ),
    );
    router.put(
      `${v.base}/:id/tasks/:tid`,
      g(P, 'post'),
      validate({ params: tk2, body: taskB }),
      h(async (req, res) =>
        send(
          res,
          await maintService.recordTask(
            C(req),
            P,
            String(req.params.id),
            String(req.params.tid),
            validated(res, 'body', taskB).result,
          ),
        ),
      ),
    );
    router.post(
      `${v.base}/:id/spares`,
      g(P, 'edit'),
      validate({ params: idp, body: spareB }),
      h(async (req, res) =>
        send(
          res,
          await maintService.addSpare(
            C(req),
            P,
            String(req.params.id),
            validated(res, 'body', spareB),
          ),
          201,
        ),
      ),
    );
    router.post(
      `${v.base}/:id/spares/:sid/issue`,
      g(P, 'post'),
      validate({ params: sp2, body: issueB }),
      h(async (req, res) => {
        const b = validated(res, 'body', issueB);
        await idem(req, res, 'mwo-issue', [req.params.id, req.params.sid, b], () =>
          maintService.issueSpare(C(req), P, String(req.params.id), String(req.params.sid), b),
        );
      }),
    );
    router.post(
      `${v.base}/:id/spares/:sid/return`,
      g(P, 'post'),
      validate({ params: sp2, body: retB }),
      h(async (req, res) => {
        const b = validated(res, 'body', retB);
        await idem(req, res, 'mwo-return', [req.params.id, req.params.sid, b], () =>
          maintService.returnSpare(C(req), P, String(req.params.id), String(req.params.sid), b.qty),
        );
      }),
    );
    router.post(
      `${v.base}/:id/labour`,
      g(P, 'edit'),
      validate({ params: idp, body: labB }),
      h(async (req, res) =>
        send(
          res,
          await maintService.addLabour(
            C(req),
            P,
            String(req.params.id),
            validated(res, 'body', labB),
          ),
          201,
        ),
      ),
    );
    router.post(
      `${v.base}/:id/vendor-charges`,
      g(P, 'edit'),
      validate({ params: idp, body: vcB }),
      h(async (req, res) =>
        send(
          res,
          await maintService.addVendorCharge(
            C(req),
            P,
            String(req.params.id),
            validated(res, 'body', vcB),
          ),
          201,
        ),
      ),
    );
    router.post(
      `${v.base}/:id/complete`,
      g(P, 'post'),
      validate({ params: idp }),
      h(async (req, res) =>
        send(res, await maintService.completeWo(C(req), P, String(req.params.id), ver(req))),
      ),
    );
    router.post(
      `${v.base}/:id/sign-off`,
      g(P, 'approve'),
      validate({ params: idp }),
      h(async (req, res) =>
        send(res, await maintService.signOffWo(C(req), P, String(req.params.id), ver(req))),
      ),
    );
    router.post(
      `${v.base}/:id/cancel`,
      g(P, 'cancel'),
      validate({ params: idp, body: reasonB }),
      h(async (req, res) =>
        send(
          res,
          await maintService.cancelWo(
            C(req),
            P,
            String(req.params.id),
            ver(req),
            validated(res, 'body', reasonB).reason,
          ),
        ),
      ),
    );
  }

  // ---------------------------------------------------------------- downtime, alerts, reports
  const dtQ = z
    .object({
      assetId: uuid.optional(),
      type: z.enum(['PLANNED', 'UNPLANNED']).optional(),
      from: isoDate.optional(),
      to: isoDate.optional(),
      ...pageQuery,
    })
    .strict();
  router.get(
    '/maint/downtime',
    g('maint-downtime', 'view'),
    validate({ query: dtQ }),
    h(async (req, res) => {
      const q = validated(res, 'query', dtQ);
      const r = await maintService.listDowntime(C(req), 'maint-downtime', q);
      paged(res, r.rows, r.total, q.page, q.size, { totalMinutes: r.totalMinutes });
    }),
  );
  const dtB = z
    .object({
      assetId: uuid,
      startAt: ts,
      endAt: ts.optional(),
      dtType: z.enum(['PLANNED', 'UNPLANNED']),
      reason: opt(200),
      productionOrderId: uuid.optional(),
      lostQty: num.optional(),
      costImpact: num.optional(),
    })
    .strict();
  router.post(
    '/maint/downtime',
    g('maint-downtime', 'add'),
    validate({ body: dtB }),
    h(async (req, res) =>
      send(
        res,
        await maintService.logDowntime(C(req), 'maint-downtime', validated(res, 'body', dtB)),
        201,
      ),
    ),
  );
  const endB = z.object({ endAt: ts.optional() }).strict();
  router.post(
    '/maint/downtime/:id/end',
    g('maint-downtime', 'edit'),
    validate({ params: idp, body: endB }),
    h(async (req, res) =>
      send(
        res,
        await maintService.endDowntime(
          C(req),
          'maint-downtime',
          String(req.params.id),
          validated(res, 'body', endB).endAt,
        ),
      ),
    ),
  );
  const mtbfQ = z.object({ from: isoDate, to: isoDate }).strict();
  router.get(
    '/maint/reports/mtbf',
    g('maint-mtbf', 'view'),
    validate({ query: mtbfQ }),
    h(async (req, res) =>
      send(res, await maintService.mtbf(C(req), 'maint-mtbf', validated(res, 'query', mtbfQ))),
    ),
  );
  const spQ = z.object({ q: opt(80), ...pageQuery }).strict();
  router.get(
    '/maint/spares',
    g('maint-spares', 'view'),
    validate({ query: spQ }),
    h(async (req, res) => {
      const q = validated(res, 'query', spQ);
      const r = await maintService.spares(C(req), q);
      paged(res, r.rows, r.total, q.page, q.size);
    }),
  );
  const alQ = z
    .object({ status: z.enum(['OPEN', 'ACK', 'CLEARED']).optional(), ...pageQuery })
    .strict();
  router.get(
    '/maint/alerts',
    g('maint-alerts', 'view'),
    validate({ query: alQ }),
    h(async (req, res) => {
      const q = validated(res, 'query', alQ);
      const r = await maintService.listAlerts(C(req), q);
      paged(res, r.rows, r.total, q.page, q.size);
    }),
  );
  router.post(
    '/maint/alerts/run',
    g('maint-alerts', 'post'),
    validate({ body: noQ }),
    h(async (req, res) => {
      const unit = C(req).ctx.unitId;
      if (!unit) throw Errors.validation({ unit: 'Choose one unit in the top bar first.' });
      send(res, { created: await maintService.runAlerts(unit) });
    }),
  );
  router.post(
    '/maint/alerts/:id/acknowledge',
    g('maint-alerts', 'edit'),
    validate({ params: idp }),
    h(async (req, res) =>
      send(res, await maintService.ackAlert(C(req), 'maint-alerts', String(req.params.id))),
    ),
  );
  router.get(
    '/maint/alert-rules',
    g('maint-alerts', 'view'),
    validate({ query: noQ }),
    h(async (_req, res) => res.json({ data: await maintService.listAlertRules() })),
  );
  const arB = z
    .object({
      leadDays: z.number().int().min(0).max(365).optional(),
      escalationMinutes: z.array(z.number().int().min(1).max(100000)).max(5).optional(),
      active: z.boolean().optional(),
    })
    .strict();
  const arP = z
    .object({
      type: z.enum([
        'PM_DUE',
        'PM_OVERDUE',
        'BREAKDOWN_UNACK',
        'WARRANTY_EXPIRY',
        'SPARE_LOW',
        'LOAN_RETURN_DUE',
      ]),
    })
    .strict();
  router.put(
    '/maint/alert-rules/:type',
    g('maint-alerts', 'controls'),
    validate({ params: arP, body: arB }),
    h(async (req, res) =>
      res.json({
        data: await maintService.saveAlertRule(
          C(req),
          'maint-alerts',
          String(req.params.type),
          validated(res, 'body', arB),
        ),
      }),
    ),
  );

  // ---------------------------------------------------------------- capitalisation
  const stQ = (vals: [string, ...string[]]) =>
    z.object({ status: z.enum(vals).optional(), assetId: uuid.optional(), ...pageQuery }).strict();
  const capQ = stQ(['DRAFT', 'POSTED', 'CANCELLED']);
  router.get(
    '/assets/capitalisations',
    g('asset-capitalization', 'view'),
    validate({ query: capQ }),
    h(async (req, res) => {
      const q = validated(res, 'query', capQ);
      const r = await faService.listCap(C(req), 'asset-capitalization', q);
      paged(res, r.rows, r.total, q.page, q.size);
    }),
  );
  router.get(
    '/assets/capitalisations/:id',
    g('asset-capitalization', 'view'),
    validate({ params: idp }),
    h(async (req, res) =>
      send(res, await faService.getCap(C(req), 'asset-capitalization', String(req.params.id))),
    ),
  );
  const capB = z
    .object({
      assetId: uuid,
      capitalisationDate: isoDate,
      source: z.enum(['PURCHASE', 'CWIP', 'OPENING_IMPORT']),
      lines: z
        .array(
          z
            .object({
              component: z.enum([
                'BASE',
                'FREIGHT',
                'INSTALLATION',
                'TESTING',
                'PROF_FEE',
                'OTHER',
              ]),
              sourceDocRef: opt(60),
              amount: pos,
              glSourceAccount: txt(20),
              gstAmount: num.optional(),
              gstAddedToCost: z.boolean().optional(),
            })
            .strict(),
        )
        .min(1)
        .max(30),
      residualOverridePct: num.optional(),
      residualJustification: opt(300),
    })
    .strict();
  router.post(
    '/assets/capitalisations',
    g('asset-capitalization', 'add'),
    validate({ body: capB }),
    h(async (req, res) => {
      const b = validated(res, 'body', capB);
      await idem(req, res, 'cap-create', [b], () =>
        faService.createCap(C(req), 'asset-capitalization', b),
      );
    }),
  );
  router.post(
    '/assets/capitalisations/:id/submit',
    g('asset-capitalization', 'submit'),
    validate({ params: idp }),
    h(async (req, res) =>
      send(
        res,
        await faService.submitCap(C(req), 'asset-capitalization', String(req.params.id), ver(req)),
      ),
    ),
  );
  router.post(
    '/assets/capitalisations/:id/approve',
    g('asset-capitalization', 'approve'),
    validate({ params: idp }),
    h(async (req, res) =>
      send(
        res,
        await faService.approveCap(
          C(req),
          'asset-capitalization',
          String(req.params.id),
          ver(req),
          true,
        ),
      ),
    ),
  );
  router.post(
    '/assets/capitalisations/:id/reject',
    g('asset-capitalization', 'approve'),
    validate({ params: idp }),
    h(async (req, res) =>
      send(
        res,
        await faService.approveCap(
          C(req),
          'asset-capitalization',
          String(req.params.id),
          ver(req),
          false,
        ),
      ),
    ),
  );
  router.post(
    '/assets/capitalisations/:id/post',
    g('asset-capitalization', 'post'),
    validate({ params: idp }),
    h(async (req, res) => {
      const id = String(req.params.id);
      await idem(req, res, 'cap-post', [id], () =>
        faService.postCap(C(req), 'asset-capitalization', id, ver(req)),
      );
    }),
  );
  router.post(
    '/assets/capitalisations/:id/cancel',
    g('asset-capitalization', 'cancel'),
    validate({ params: idp, body: reasonB }),
    h(async (req, res) =>
      send(
        res,
        await faService.cancelCap(
          C(req),
          'asset-capitalization',
          String(req.params.id),
          ver(req),
          validated(res, 'body', reasonB).reason,
        ),
      ),
    ),
  );

  // ---------------------------------------------------------------- allocation
  const alcQ = stQ(['ALLOCATED', 'RETURNED']);
  router.get(
    '/assets/allocations',
    g('asset-allocation', 'view'),
    validate({ query: alcQ }),
    h(async (req, res) => {
      const q = validated(res, 'query', alcQ);
      const r = await faService.listAlloc(C(req), 'asset-allocation', q);
      paged(res, r.rows, r.total, q.page, q.size);
    }),
  );
  const alcB = z
    .object({
      assetId: uuid,
      employeeId: uuid.optional(),
      department: opt(60),
      location: opt(120),
      allocatedOn: isoDate.optional(),
      conditionOut: opt(120),
      handoverDoc: opt(120),
      returnDue: isoDate.optional(),
    })
    .strict();
  router.post(
    '/assets/allocations',
    g('asset-allocation', 'add'),
    validate({ body: alcB }),
    h(async (req, res) =>
      send(
        res,
        await faService.allocate(C(req), 'asset-allocation', validated(res, 'body', alcB)),
        201,
      ),
    ),
  );
  const retAB = z.object({ returnedOn: isoDate.optional(), conditionIn: opt(120) }).strict();
  router.post(
    '/assets/allocations/:id/return',
    g('asset-allocation', 'edit'),
    validate({ params: idp, body: retAB }),
    h(async (req, res) =>
      send(
        res,
        await faService.returnAlloc(
          C(req),
          'asset-allocation',
          String(req.params.id),
          validated(res, 'body', retAB),
        ),
      ),
    ),
  );

  // ---------------------------------------------------------------- transfer
  const trQ = stQ(['DRAFT', 'COMPLETED', 'CANCELLED']);
  router.get(
    '/assets/transfers',
    g('asset-transfer', 'view'),
    validate({ query: trQ }),
    h(async (req, res) => {
      const q = validated(res, 'query', trQ);
      const r = await faService.listTransfers(C(req), 'asset-transfer', q);
      paged(res, r.rows, r.total, q.page, q.size);
    }),
  );
  const trB = z
    .object({
      assetId: uuid,
      toUnitId: uuid.optional(),
      toLocation: opt(120),
      toEmployeeId: uuid.optional(),
      toCostCentreId: uuid.optional(),
      condition: opt(120),
    })
    .strict();
  router.post(
    '/assets/transfers',
    g('asset-transfer', 'add'),
    validate({ body: trB }),
    h(async (req, res) =>
      send(
        res,
        await faService.createTransfer(C(req), 'asset-transfer', validated(res, 'body', trB)),
        201,
      ),
    ),
  );
  router.post(
    '/assets/transfers/:id/submit',
    g('asset-transfer', 'submit'),
    validate({ params: idp }),
    h(async (req, res) =>
      send(
        res,
        await faService.submitTransfer(C(req), 'asset-transfer', String(req.params.id), ver(req)),
      ),
    ),
  );
  router.post(
    '/assets/transfers/:id/approve',
    g('asset-transfer', 'approve'),
    validate({ params: idp }),
    h(async (req, res) =>
      send(
        res,
        await faService.approveTransfer(
          C(req),
          'asset-transfer',
          String(req.params.id),
          ver(req),
          true,
        ),
      ),
    ),
  );
  router.post(
    '/assets/transfers/:id/reject',
    g('asset-transfer', 'approve'),
    validate({ params: idp }),
    h(async (req, res) =>
      send(
        res,
        await faService.approveTransfer(
          C(req),
          'asset-transfer',
          String(req.params.id),
          ver(req),
          false,
        ),
      ),
    ),
  );
  const cmpB = z
    .object({ verifiedById: uuid.optional(), transferDate: isoDate.optional() })
    .strict();
  router.post(
    '/assets/transfers/:id/complete',
    g('asset-transfer', 'post'),
    validate({ params: idp, body: cmpB }),
    h(async (req, res) => {
      const id = String(req.params.id);
      const b = validated(res, 'body', cmpB);
      await idem(req, res, 'tr-complete', [id, b], () =>
        faService.completeTransfer(C(req), 'asset-transfer', id, ver(req), b),
      );
    }),
  );
  router.post(
    '/assets/transfers/:id/cancel',
    g('asset-transfer', 'cancel'),
    validate({ params: idp }),
    h(async (req, res) =>
      send(
        res,
        await faService.cancelTransfer(C(req), 'asset-transfer', String(req.params.id), ver(req)),
      ),
    ),
  );

  // ---------------------------------------------------------------- disposal
  const dpQ = stQ(['DRAFT', 'POSTED', 'CANCELLED']);
  router.get(
    '/assets/disposals',
    g('asset-disposal', 'view'),
    validate({ query: dpQ }),
    h(async (req, res) => {
      const q = validated(res, 'query', dpQ);
      const r = await faService.listDisposals(C(req), 'asset-disposal', q);
      paged(res, r.rows, r.total, q.page, q.size);
    }),
  );
  router.get(
    '/assets/disposals/:id',
    g('asset-disposal', 'view'),
    validate({ params: idp }),
    h(async (req, res) =>
      send(res, await faService.getDisposal(C(req), 'asset-disposal', String(req.params.id))),
    ),
  );
  const dpB = z
    .object({
      assetId: uuid,
      method: z.enum(['SALE', 'SCRAP', 'WRITE_OFF', 'DONATION']),
      disposalDate: isoDate.optional(),
      buyer: opt(160),
      saleValue: num.optional(),
      gstOnSale: num.optional(),
      gstIntraState: z.boolean().optional(),
      proceedsAccount: opt(20),
      itcTaken: num.optional(),
      quartersUsed: z.number().int().min(0).max(40).optional(),
    })
    .strict();
  router.post(
    '/assets/disposals',
    g('asset-disposal', 'add'),
    validate({ body: dpB }),
    h(async (req, res) =>
      send(
        res,
        await faService.createDisposal(C(req), 'asset-disposal', validated(res, 'body', dpB)),
        201,
      ),
    ),
  );
  router.post(
    '/assets/disposals/:id/submit',
    g('asset-disposal', 'submit'),
    validate({ params: idp }),
    h(async (req, res) =>
      send(
        res,
        await faService.submitDisposal(C(req), 'asset-disposal', String(req.params.id), ver(req)),
      ),
    ),
  );
  router.post(
    '/assets/disposals/:id/approve',
    g('asset-disposal', 'approve'),
    validate({ params: idp }),
    h(async (req, res) =>
      send(
        res,
        await faService.approveDisposal(
          C(req),
          'asset-disposal',
          String(req.params.id),
          ver(req),
          true,
        ),
      ),
    ),
  );
  router.post(
    '/assets/disposals/:id/reject',
    g('asset-disposal', 'approve'),
    validate({ params: idp }),
    h(async (req, res) =>
      send(
        res,
        await faService.approveDisposal(
          C(req),
          'asset-disposal',
          String(req.params.id),
          ver(req),
          false,
        ),
      ),
    ),
  );
  router.post(
    '/assets/disposals/:id/post',
    g('asset-disposal', 'post'),
    validate({ params: idp }),
    h(async (req, res) => {
      const id = String(req.params.id);
      await idem(req, res, 'dsp-post', [id], () =>
        faService.postDisposal(C(req), 'asset-disposal', id, ver(req)),
      );
    }),
  );
  router.post(
    '/assets/disposals/:id/cancel',
    g('asset-disposal', 'cancel'),
    validate({ params: idp, body: reasonB }),
    h(async (req, res) =>
      send(
        res,
        await faService.cancelDisposal(
          C(req),
          'asset-disposal',
          String(req.params.id),
          ver(req),
          validated(res, 'body', reasonB).reason,
        ),
      ),
    ),
  );
  router.post(
    '/assets/revaluations',
    g('asset-master', 'controls'),
    h(async () => faService.revalue()),
  );
  router.post(
    '/assets/impairments',
    g('asset-master', 'controls'),
    h(async () => faService.impair()),
  );

  // ---------------------------------------------------------------- depreciation
  const runQ = z
    .object({
      area: z.enum(['BOOK', 'TAX']).optional(),
      status: z.enum(['DRAFT', 'POSTED', 'REVERSED']).optional(),
      ...pageQuery,
    })
    .strict();
  router.get(
    '/assets/depreciation/runs',
    g('asset-depreciation', 'view'),
    validate({ query: runQ }),
    h(async (req, res) => {
      const q = validated(res, 'query', runQ);
      const r = await faService.listRuns(C(req), 'asset-depreciation', q);
      paged(res, r.rows, r.total, q.page, q.size);
    }),
  );
  router.get(
    '/assets/depreciation/runs/:id',
    g('asset-depreciation', 'view'),
    validate({ params: idp }),
    h(async (req, res) =>
      send(res, await faService.getRun(C(req), 'asset-depreciation', String(req.params.id))),
    ),
  );
  const runB = z
    .object({
      area: z.enum(['BOOK', 'TAX']),
      period: z
        .string()
        .regex(/^\d{4}-\d{2}$/, 'Use a month like 2026-11.')
        .optional(),
      openings: z.record(z.string(), num).optional(),
    })
    .strict();
  router.post(
    '/assets/depreciation/runs',
    g('asset-depreciation', 'add'),
    validate({ body: runB }),
    h(async (req, res) => {
      const b = validated(res, 'body', runB);
      await idem(req, res, 'dep-create', [b], () =>
        faService.createRun(C(req), 'asset-depreciation', b),
      );
    }),
  );
  router.post(
    '/assets/depreciation/runs/:id/post',
    g('asset-depreciation', 'post'),
    validate({ params: idp }),
    h(async (req, res) => {
      const id = String(req.params.id);
      await idem(req, res, 'dep-post', [id], () =>
        faService.postRun(C(req), 'asset-depreciation', id, ver(req)),
      );
    }),
  );
  router.post(
    '/assets/depreciation/runs/:id/reverse',
    g('asset-depreciation', 'cancel'),
    validate({ params: idp, body: reasonB }),
    h(async (req, res) =>
      send(
        res,
        await faService.reverseRun(
          C(req),
          'asset-depreciation',
          String(req.params.id),
          ver(req),
          validated(res, 'body', reasonB).reason,
        ),
      ),
    ),
  );
  router.get(
    '/assets/depreciation/block-ledger',
    g('asset-depreciation', 'view'),
    validate({ query: noQ }),
    h(async (req, res) => res.json({ data: await faService.blockLedger(C(req)) })),
  );
  const shB = z
    .object({
      assetId: uuid,
      period: z.string().regex(/^\d{4}-\d{2}$/, 'Use a month like 2026-11.'),
      singleDays: z.number().int().min(0).max(31),
      doubleDays: z.number().int().min(0).max(31),
      tripleDays: z.number().int().min(0).max(31),
    })
    .strict();
  router.put(
    '/assets/depreciation/shift-usage',
    g('asset-depreciation', 'edit'),
    validate({ body: shB }),
    h(async (req, res) =>
      send(
        res,
        await faService.saveShiftUsage(C(req), 'asset-depreciation', validated(res, 'body', shB)),
      ),
    ),
  );

  // ---------------------------------------------------------------- QR, scans, physical verification
  const lblB = z.object({ ids: z.array(uuid).min(1).max(100) }).strict();
  router.post(
    '/assets/qr/labels',
    g('asset-qr', 'print'),
    validate({ body: lblB }),
    h(async (req, res) => {
      const labels = await faService.labelTokens(
        C(req),
        'asset-qr',
        validated(res, 'body', lblB).ids,
      );
      const doc = newPdf({ title: 'Asset labels' });
      let i = 0;
      for (const l of labels) {
        const col = i % 3;
        const row = Math.floor(i / 3) % 6;
        if (i > 0 && i % 18 === 0) doc.addPage();
        const x = 40 + col * 175;
        const y = 40 + row * 125;
        doc.rect(x, y, 165, 115).stroke();
        doc.image(
          await QRCode.toBuffer(`ASSET:${l.token}`, { margin: 1, width: 150 }),
          x + 6,
          y + 6,
          { width: 70 },
        );
        doc
          .fontSize(9)
          .font('Sans-Bold')
          .text(l.assetNo, x + 82, y + 10, { width: 78 });
        doc
          .fontSize(8)
          .font('Sans')
          .text(l.name.slice(0, 60), x + 82, y + 26, { width: 78 });
        doc.fontSize(7).text('Scan to open', x + 6, y + 98);
        i++;
      }
      res
        .set('Content-Type', 'application/pdf')
        .set('Content-Disposition', 'inline; filename="asset-labels.pdf"')
        .send(await finishPdf(doc));
    }),
  );
  const scB = z
    .object({
      token: txt(60),
      purpose: z.enum(['VIEW', 'VERIFY', 'BREAKDOWN']).optional(),
      location: opt(120),
    })
    .strict();
  router.post(
    '/assets/qr/scan',
    anyView('asset-qr', 'maint-breakdown', 'asset-master'),
    validate({ body: scB }),
    h(async (req, res) => {
      const b = validated(res, 'body', scB);
      send(
        res,
        await faService.scan(
          C(req),
          await firstPage(req, ['asset-qr', 'maint-breakdown', 'asset-master'], 'view'),
          { ...b, token: b.token.replace(/^ASSET:/, '') },
        ),
      );
    }),
  );
  router.get(
    '/assets/verifications',
    g('asset-qr', 'view'),
    validate({ query: noQ }),
    h(async (req, res) => res.json({ data: await faService.listVerifications(C(req)) })),
  );
  const pvB = z.object({ title: txt(160), location: opt(120) }).strict();
  router.post(
    '/assets/verifications',
    g('asset-qr', 'add'),
    validate({ body: pvB }),
    h(async (req, res) =>
      send(
        res,
        await faService.startVerification(C(req), 'asset-qr', validated(res, 'body', pvB)),
        201,
      ),
    ),
  );
  router.get(
    '/assets/verifications/:id',
    g('asset-qr', 'view'),
    validate({ params: idp }),
    h(async (req, res) =>
      send(res, await faService.getVerification(C(req), 'asset-qr', String(req.params.id))),
    ),
  );
  const pvP = z.object({ id: uuid, assetId: uuid }).strict();
  const pvL = z
    .object({ found: z.boolean(), condition: opt(120), locationFound: opt(120) })
    .strict();
  router.put(
    '/assets/verifications/:id/lines/:assetId',
    g('asset-qr', 'edit'),
    validate({ params: pvP, body: pvL }),
    h(async (req, res) =>
      send(
        res,
        await faService.verifyLine(
          C(req),
          'asset-qr',
          String(req.params.id),
          String(req.params.assetId),
          validated(res, 'body', pvL),
        ),
      ),
    ),
  );
  router.post(
    '/assets/verifications/:id/close',
    g('asset-qr', 'post'),
    validate({ params: idp }),
    h(async (req, res) =>
      send(res, await faService.closeVerification(C(req), 'asset-qr', String(req.params.id))),
    ),
  );

  return router;
}
