// Phase 12 API (/api/v1/qms, ERRATA E-26). authenticate -> requirePasswordChanged -> resolveContext -> permission ->
// zod -> service. The permission page follows the form: incoming sheets use qms-incoming, in-process qms-process,
// pre-dispatch / welding / VT qms-final, ISIR qms-supplier, the combined list qms-inspections, rejections and alerts qms-ncr,
// 8D / CI / MOM qms-capa, instruments qms-calibration, templates and plans qms-plans.
import { Router } from 'express';
import type { Request, RequestHandler, Response } from 'express';
import { z } from 'zod';
import { authenticate, requirePasswordChanged } from '../../core/auth/authenticate';
import { resolveContext } from '../../core/context/resolve-context';
import { prisma } from '../../core/db/prisma';
import { asyncHandler } from '../../core/http/async-handler';
import { Errors } from '../../core/http/errors';
import { parseIfMatch } from '../../core/http/if-match';
import { validate, validated } from '../../core/http/validate';
import { accessUserOf, can, requirePageAction } from '../../core/rbac/access';
import type { Action } from '../../core/rbac/permission-model';
import { runIdempotent } from '../approvals/idempotent';
import { callerOf, isoDate, pageQuery, uuid } from '../inventory/routes-shared';
import { formsService, FORM_KINDS, PAGE_OF_FORM } from './forms-service';
import type { FormKind } from './forms-service';
import { createLotForGrnLine } from './inbound';
import {
  KINDS,
  PAGE_OF_KIND,
  cancelInspection,
  createInspection,
  decideInspection,
  getInspection,
  kindOf,
  listInspections,
  planPreview,
  submitInspection,
  updateInspection,
} from './inspection-service';
import type { Kind } from './inspection-service';
import { instrumentsService } from './instruments-service';
import { TEMPLATE_KINDS, masterService } from './master-service';
import { COST_CATEGORIES, DISPOSITIONS, SETTING_KEYS, registersService } from './registers-service';

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM.');
const num = z
  .union([z.number(), z.string()])
  .transform((v) => String(v))
  .refine((v) => /^\d+(\.\d+)?$/.test(v), 'Enter a number.');
const lim = z
  .union([z.number(), z.string(), z.null()])
  .optional()
  .transform((v) => (v === undefined || v === null || String(v).trim() === '' ? null : String(v)));
const txt = (n: number) => z.string().trim().min(1, 'This is required.').max(n);
const opt = (n: number) => z.string().trim().max(n).optional();
const kindZ = z.enum(KINDS as [Kind, ...Kind[]]);
const formKindZ = z.enum(FORM_KINDS as [FormKind, ...FormKind[]]);
const idp = z.object({ id: uuid }).strict();
const h = (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
  asyncHandler(async (req, res) => {
    await fn(req, res);
  });
const g = (page: string, a: Action): RequestHandler => requirePageAction(page, a);
const me = (req: Request): string => req.auth!.userId;

/** permission check that depends on data read first (the kind of a stored sheet) */
async function need(req: Request, page: string, action: Action): Promise<void> {
  if (!req.auth || !(await can(accessUserOf(req.auth), page, action))) throw Errors.forbidden();
}
const pageOfTemplateKind = (k: string): string =>
  k in PAGE_OF_KIND ? PAGE_OF_KIND[k as Kind] : PAGE_OF_FORM[k as FormKind];

const rowZ = z
  .object({
    label: txt(200),
    spec: z.string().trim().max(200).nullish(),
    method: z.string().trim().max(120).nullish(),
    unit: z.string().trim().max(20).nullish(),
    rowType: z.enum(['NUMERIC', 'ATTRIBUTE']).optional(),
    lsl: lim,
    usl: lim,
    readings: z
      .array(z.union([z.string().max(40), z.number(), z.null()]))
      .max(30)
      .optional(),
    extra: z.record(z.string().max(200)).optional(),
    remark: z.string().trim().max(300).nullish(),
  })
  .strict();
const headerZ = z.record(z.unknown());
const fieldZ = z
  .object({
    key: z
      .string()
      .regex(/^[a-z][a-z0-9_]{0,39}$/, 'Use lower-case letters, digits and underscore.'),
    label: txt(120),
    type: z
      .enum([
        'text',
        'textarea',
        'date',
        'number',
        'select',
        'item',
        'customer',
        'supplier',
        'instrument',
      ])
      .optional(),
    required: z.boolean().optional(),
    options: z.array(z.string().max(60)).max(30).optional(),
  })
  .strict();
const charZ = z
  .object({
    name: txt(200),
    spec: z.string().max(200).optional(),
    method: z.string().max(120).optional(),
    unit: z.string().max(20).optional(),
    type: z.enum(['NUMERIC', 'ATTRIBUTE']).optional(),
    lsl: lim,
    usl: lim,
  })
  .strict();

export function createQmsRouter(): Router {
  const router = Router();
  router.use('/qms', authenticate, requirePasswordChanged, resolveContext);
  const send = (res: Response, data: object, status = 200) => {
    const v = (data as { version?: number }).version;
    if (v !== undefined) res.set('ETag', `"${v}"`);
    res.status(status).json({ data });
  };
  const paged = (res: Response, rows: unknown[], total: number, page: number, size: number) =>
    res.json({ data: rows, meta: { page, size, total } });

  // ---------------------------------------------------------------- templates (qms-plans)
  const tplQ = z
    .object({
      kind: z.enum(TEMPLATE_KINDS).optional(),
      status: z.enum(['ACTIVE', 'RETIRED']).optional(),
    })
    .strict();
  router.get(
    '/qms/templates',
    g('qms-plans', 'view'),
    validate({ query: tplQ }),
    h(async (req, res) => {
      const q = validated(res, 'query', tplQ);
      send(res, { rows: await masterService.listTemplates(q.kind, q.status) });
    }),
  );
  const resolveQ = z.object({ kind: z.enum(TEMPLATE_KINDS), customerId: uuid.optional() }).strict();
  router.get(
    '/qms/templates/resolve',
    validate({ query: resolveQ }),
    h(async (req, res) => {
      const q = validated(res, 'query', resolveQ);
      await need(req, pageOfTemplateKind(q.kind), 'view');
      send(res, await masterService.resolve(q.kind, q.customerId ?? null, req.ctx?.unitId ?? null));
    }),
  );
  router.get(
    '/qms/templates/:id',
    g('qms-plans', 'view'),
    validate({ params: idp }),
    h(async (req, res) => send(res, await masterService.getTemplate(String(req.params.id)))),
  );
  const publishB = z
    .object({
      kind: z.enum(TEMPLATE_KINDS),
      name: txt(120),
      customerId: uuid.optional(),
      headerFields: z.array(fieldZ).min(1).max(60),
      rowConfig: z.record(z.unknown()).optional(),
      closeRequires: z.array(z.string()).max(60).optional(),
      reason: z.string().trim().min(3, 'Give the reason for this version.').max(300),
    })
    .strict();
  router.post(
    '/qms/templates',
    g('qms-plans', 'controls'),
    validate({ body: publishB }),
    h(async (req, res) => {
      send(
        res,
        await masterService.publishTemplate(
          callerOf(req),
          'qms-plans',
          validated(res, 'body', publishB),
        ),
        201,
      );
    }),
  );

  // ---------------------------------------------------------------- plans (qms-plans)
  const planQ = z
    .object({
      kind: kindZ.optional(),
      itemId: uuid.optional(),
      status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
    })
    .strict();
  router.get(
    '/qms/plans',
    g('qms-plans', 'view'),
    validate({ query: planQ }),
    h(async (req, res) => {
      const q = validated(res, 'query', planQ);
      send(res, { rows: await masterService.listPlans(q.kind, q.itemId, q.status) });
    }),
  );
  const previewQ = z
    .object({
      kind: kindZ,
      itemId: uuid.optional(),
      customerId: uuid.optional(),
      planId: uuid.optional(),
    })
    .strict();
  router.get(
    '/qms/plans/preview',
    validate({ query: previewQ }),
    h(async (req, res) => {
      const q = validated(res, 'query', previewQ);
      await need(req, PAGE_OF_KIND[q.kind], 'view');
      send(
        res,
        await planPreview(prisma, q.kind, q.itemId ?? null, q.customerId ?? null, q.planId),
      );
    }),
  );
  router.get(
    '/qms/plans/:id',
    g('qms-plans', 'view'),
    validate({ params: idp }),
    h(async (req, res) => send(res, await masterService.getPlan(String(req.params.id)))),
  );
  const planB = z
    .object({
      code: z
        .string()
        .trim()
        .regex(/^[A-Za-z0-9][A-Za-z0-9_\-/]{0,39}$/, 'Use letters, digits, - _ /.'),
      name: txt(150),
      kind: kindZ,
      itemId: uuid.optional(),
      customerId: uuid.optional(),
      characteristics: z.array(charZ).max(200),
      notes: opt(500),
    })
    .strict();
  router.post(
    '/qms/plans',
    g('qms-plans', 'add'),
    validate({ body: planB }),
    h(async (req, res) => {
      const b = validated(res, 'body', planB);
      send(res, await masterService.createPlan(callerOf(req), 'qms-plans', b), 201);
    }),
  );
  const planU = z
    .object({
      name: txt(150).optional(),
      itemId: uuid.nullable().optional(),
      customerId: uuid.nullable().optional(),
      characteristics: z.array(charZ).max(200).optional(),
      status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
      notes: opt(500),
    })
    .strict();
  router.patch(
    '/qms/plans/:id',
    g('qms-plans', 'edit'),
    validate({ params: idp, body: planU }),
    h(async (req, res) => {
      send(
        res,
        await masterService.updatePlan(
          callerOf(req),
          'qms-plans',
          String(req.params.id),
          parseIfMatch(req.get('if-match')),
          validated(res, 'body', planU),
        ),
      );
    }),
  );

  // ---------------------------------------------------------------- inspections
  const listQ = z
    .object({
      kind: kindZ.optional(),
      status: z.enum(['Draft', 'Submitted', 'Decided', 'Cancelled']).optional(),
      q: z.string().trim().max(80).optional(),
      from: isoDate.optional(),
      to: isoDate.optional(),
      ...pageQuery,
    })
    .strict();
  router.get(
    '/qms/inspections',
    validate({ query: listQ }),
    h(async (req, res) => {
      const q = validated(res, 'query', listQ);
      const page = q.kind ? PAGE_OF_KIND[q.kind] : 'qms-inspections';
      await need(req, page, 'view');
      const r = await listInspections(callerOf(req), page, q);
      paged(res, r.rows, r.total, q.page, q.size);
    }),
  );
  const createB = z
    .object({
      kind: kindZ,
      templateId: uuid.optional(),
      planId: uuid.optional(),
      docDate: isoDate.optional(),
      header: headerZ.optional(),
      rows: z.array(rowZ).max(200).optional(),
      lotQty: num.optional(),
    })
    .strict();
  router.post(
    '/qms/inspections',
    validate({ body: createB }),
    h(async (req, res) => {
      const b = validated(res, 'body', createB);
      const page = PAGE_OF_KIND[b.kind];
      await need(req, page, 'add');
      send(res, await createInspection(callerOf(req), page, b), 201);
    }),
  );
  const fromGrnP = z.object({ grnLineId: uuid }).strict();
  router.post(
    '/qms/inspections/from-grn/:grnLineId',
    validate({ params: fromGrnP }),
    h(async (req, res) => {
      await need(req, 'qms-incoming', 'add');
      const grnLineId = String(req.params.grnLineId);
      const own = (
        // unpaginated: rows of one parent (id)
        await prisma.$queryRawUnsafe<{ ok: boolean }[]>(
          `SELECT (g.status='Posted' AND g.unit_id=$2::uuid) AS ok FROM goods_receipt_lines l JOIN goods_receipts g ON g.id=l.grn_id WHERE l.id=$1::uuid`,
          grnLineId,
          req.ctx?.unitId ?? null,
        )
      )[0];
      if (!own?.ok) throw Errors.notFound('Posted receipt line not found in this unit.');
      await runIdempotent(
        req,
        res,
        me(req),
        `qms-lot:${req.ctx?.unitId ?? 'all'}`,
        [req.path, grnLineId],
        async () => {
          const id = await prisma.$transaction((tx) => createLotForGrnLine(tx, grnLineId, me(req)));
          if (!id) throw Errors.conflict('This receipt line does not need inspection.');
          return { version: 1, ...(await getInspection(callerOf(req), 'qms-incoming', id)) };
        },
      );
    }),
  );
  const withKind = (
    action: Action,
    fn: (req: Request, res: Response, kind: Kind, page: string) => Promise<void>,
  ): RequestHandler =>
    h(async (req, res) => {
      const kind = await kindOf(String(req.params.id));
      const page = PAGE_OF_KIND[kind];
      await need(req, page, action);
      await fn(req, res, kind, page);
    });
  router.get(
    '/qms/inspections/:id',
    validate({ params: idp }),
    withKind('view', async (req, res, _k, page) =>
      send(res, await getInspection(callerOf(req), page, String(req.params.id))),
    ),
  );
  const patchB = z
    .object({
      docDate: isoDate.optional(),
      header: headerZ.optional(),
      rows: z.array(rowZ).max(200).optional(),
      lotQty: num.optional(),
    })
    .strict();
  router.patch(
    '/qms/inspections/:id',
    validate({ params: idp, body: patchB }),
    withKind('edit', async (req, res, _k, page) => {
      send(
        res,
        await updateInspection(
          callerOf(req),
          page,
          String(req.params.id),
          parseIfMatch(req.get('if-match')),
          validated(res, 'body', patchB),
        ),
      );
    }),
  );
  const submitB = z
    .object({ result: z.enum(['ACCEPTED', 'REJECTED', 'CONDITIONAL']).optional(), note: opt(500) })
    .strict();
  router.post(
    '/qms/inspections/:id/submit',
    validate({ params: idp, body: submitB }),
    withKind('submit', async (req, res, _k, page) => {
      send(
        res,
        await submitInspection(
          callerOf(req),
          page,
          String(req.params.id),
          parseIfMatch(req.get('if-match')),
          validated(res, 'body', submitB),
        ),
      );
    }),
  );
  const decideB = z.object({ acceptedQty: num, rejectedQty: num, note: opt(500) }).strict();
  router.post(
    '/qms/inspections/:id/decide',
    validate({ params: idp, body: decideB }),
    withKind('approve', async (req, res, _k, page) => {
      const b = validated(res, 'body', decideB);
      const id = String(req.params.id);
      await runIdempotent(
        req,
        res,
        me(req),
        `qms-decide:${req.ctx?.unitId ?? 'all'}`,
        [req.path, id, b],
        async () => {
          const r = await decideInspection(callerOf(req), page, id, b);
          return { version: Number(r.version), ...r };
        },
      );
    }),
  );
  const cancelB = z
    .object({ reason: z.string().trim().min(3, 'Give the reason.').max(300) })
    .strict();
  router.post(
    '/qms/inspections/:id/cancel',
    validate({ params: idp, body: cancelB }),
    withKind('cancel', async (req, res, _k, page) => {
      send(
        res,
        await cancelInspection(
          callerOf(req),
          page,
          String(req.params.id),
          validated(res, 'body', cancelB).reason,
        ),
      );
    }),
  );

  // ---------------------------------------------------------------- forms (8D, alert, MOM, CI)
  const fListQ = z
    .object({
      kind: formKindZ,
      status: z.enum(['Open', 'Closed', 'Cancelled']).optional(),
      q: z.string().trim().max(80).optional(),
      ...pageQuery,
    })
    .strict();
  router.get(
    '/qms/forms',
    validate({ query: fListQ }),
    h(async (req, res) => {
      const q = validated(res, 'query', fListQ);
      await need(req, PAGE_OF_FORM[q.kind], 'view');
      const r = await formsService.list(callerOf(req), PAGE_OF_FORM[q.kind], q);
      paged(res, r.rows, r.total, q.page, q.size);
    }),
  );
  const fCreateB = z
    .object({
      kind: formKindZ,
      title: txt(200),
      docDate: isoDate.optional(),
      data: headerZ,
      capaRef: opt(60),
      customerId: uuid.optional(),
      supplierId: uuid.optional(),
      itemId: uuid.optional(),
    })
    .strict();
  router.post(
    '/qms/forms',
    validate({ body: fCreateB }),
    h(async (req, res) => {
      const b = validated(res, 'body', fCreateB);
      await need(req, PAGE_OF_FORM[b.kind], 'add');
      send(res, await formsService.create(callerOf(req), PAGE_OF_FORM[b.kind], b), 201);
    }),
  );
  const withForm = (
    action: Action,
    fn: (req: Request, res: Response, page: string) => Promise<void>,
  ): RequestHandler =>
    h(async (req, res) => {
      const page = PAGE_OF_FORM[await formsService.kindOf(String(req.params.id))];
      await need(req, page, action);
      await fn(req, res, page);
    });
  router.get(
    '/qms/forms/:id',
    validate({ params: idp }),
    withForm('view', async (req, res, page) =>
      send(res, await formsService.get(callerOf(req), page, String(req.params.id))),
    ),
  );
  const fPatchB = z
    .object({
      title: txt(200).optional(),
      docDate: isoDate.optional(),
      data: headerZ.optional(),
      capaRef: opt(60),
    })
    .strict();
  router.patch(
    '/qms/forms/:id',
    validate({ params: idp, body: fPatchB }),
    withForm('edit', async (req, res, page) => {
      send(
        res,
        await formsService.update(
          callerOf(req),
          page,
          String(req.params.id),
          parseIfMatch(req.get('if-match')),
          validated(res, 'body', fPatchB),
        ),
      );
    }),
  );
  const closeB = z.object({ note: opt(500) }).strict();
  router.post(
    '/qms/forms/:id/close',
    validate({ params: idp, body: closeB }),
    withForm('edit', async (req, res, page) => {
      send(
        res,
        await formsService.close(
          callerOf(req),
          page,
          String(req.params.id),
          parseIfMatch(req.get('if-match')),
          validated(res, 'body', closeB).note,
        ),
      );
    }),
  );
  router.post(
    '/qms/forms/:id/cancel',
    validate({ params: idp, body: cancelB }),
    withForm('cancel', async (req, res, page) => {
      send(
        res,
        await formsService.cancel(
          callerOf(req),
          page,
          String(req.params.id),
          validated(res, 'body', cancelB).reason,
        ),
      );
    }),
  );

  // ---------------------------------------------------------------- rejection / rework register + monitors (qms-ncr)
  const rListQ = z
    .object({
      month: month.optional(),
      status: z.enum(['Open', 'Closed', 'Cancelled']).optional(),
      q: z.string().trim().max(80).optional(),
      ...pageQuery,
    })
    .strict();
  router.get(
    '/qms/rejections',
    g('qms-ncr', 'view'),
    validate({ query: rListQ }),
    h(async (req, res) => {
      const q = validated(res, 'query', rListQ);
      const r = await registersService.listRejections(callerOf(req), 'qms-ncr', q);
      paged(res, r.rows, r.total, q.page, q.size);
    }),
  );
  const sumQ = z.object({ month }).strict();
  router.get(
    '/qms/rejections/summary',
    g('qms-ncr', 'view'),
    validate({ query: sumQ }),
    h(async (req, res) => {
      send(
        res,
        await registersService.rejectionSummary(
          callerOf(req),
          'qms-ncr',
          validated(res, 'query', sumQ).month,
        ),
      );
    }),
  );
  const rejB = z
    .object({
      rejectDate: isoDate.optional(),
      process: txt(80),
      operator: opt(80),
      itemId: uuid.optional(),
      part: txt(150),
      holdQty: num,
      defect: txt(200),
      defectType: txt(60),
      disposition: z.enum(DISPOSITIONS).optional(),
      dispositionNote: opt(300),
    })
    .strict();
  router.post(
    '/qms/rejections',
    g('qms-ncr', 'add'),
    validate({ body: rejB }),
    h(async (req, res) => {
      send(
        res,
        await registersService.createRejection(
          callerOf(req),
          'qms-ncr',
          validated(res, 'body', rejB),
        ),
        201,
      );
    }),
  );
  router.get(
    '/qms/rejections/:id',
    g('qms-ncr', 'view'),
    validate({ params: idp }),
    h(async (req, res) =>
      send(
        res,
        await registersService.getRejection(callerOf(req), 'qms-ncr', String(req.params.id)),
      ),
    ),
  );
  const dispB = z.object({ disposition: z.enum(DISPOSITIONS), note: opt(300) }).strict();
  router.post(
    '/qms/rejections/:id/dispose',
    g('qms-ncr', 'edit'),
    validate({ params: idp, body: dispB }),
    h(async (req, res) => {
      const b = validated(res, 'body', dispB);
      send(
        res,
        await registersService.disposeRejection(
          callerOf(req),
          'qms-ncr',
          String(req.params.id),
          parseIfMatch(req.get('if-match')),
          b.disposition,
          b.note,
        ),
      );
    }),
  );
  router.post(
    '/qms/rejections/:id/cancel',
    g('qms-ncr', 'cancel'),
    validate({ params: idp, body: cancelB }),
    h(async (req, res) => {
      send(
        res,
        await registersService.cancelRejection(
          callerOf(req),
          'qms-ncr',
          String(req.params.id),
          validated(res, 'body', cancelB).reason,
        ),
      );
    }),
  );
  const monthlyB = z
    .object({
      month,
      producedQty: num,
      rejectedQty: num,
      customerRejectedQty: num,
      salesValue: num,
      note: opt(300),
    })
    .strict();
  router.put(
    '/qms/monthly',
    g('qms-ncr', 'edit'),
    validate({ body: monthlyB }),
    h(async (req, res) => {
      send(
        res,
        await registersService.saveMonthly(
          callerOf(req),
          'qms-ncr',
          validated(res, 'body', monthlyB),
        ),
      );
    }),
  );
  const rangeQ = z.object({ from: month, to: month }).strict();
  router.get(
    '/qms/reports/ppm',
    g('qms-ncr', 'view'),
    validate({ query: rangeQ }),
    h(async (req, res) => {
      const q = validated(res, 'query', rangeQ);
      send(res, await registersService.ppmReport(callerOf(req), q.from, q.to));
    }),
  );
  router.get(
    '/qms/reports/quality-cost',
    g('qms-ncr', 'view'),
    validate({ query: rangeQ }),
    h(async (req, res) => {
      const q = validated(res, 'query', rangeQ);
      send(res, await registersService.costReport(callerOf(req), q.from, q.to));
    }),
  );
  router.get(
    '/qms/costs',
    g('qms-ncr', 'view'),
    validate({ query: sumQ }),
    h(async (req, res) => {
      send(res, {
        rows: await registersService.listCosts(callerOf(req), validated(res, 'query', sumQ).month),
      });
    }),
  );
  const costB = z
    .object({ month, category: z.enum(COST_CATEGORIES), description: txt(200), amount: num })
    .strict();
  router.post(
    '/qms/costs',
    g('qms-ncr', 'add'),
    validate({ body: costB }),
    h(async (req, res) => {
      send(
        res,
        await registersService.addCost(callerOf(req), 'qms-ncr', validated(res, 'body', costB)),
        201,
      );
    }),
  );
  router.delete(
    '/qms/costs/:id',
    g('qms-ncr', 'delete'),
    validate({ params: idp }),
    h(async (req, res) => {
      await registersService.deleteCost(callerOf(req), 'qms-ncr', String(req.params.id));
      res.status(204).end();
    }),
  );
  router.get(
    '/qms/settings',
    g('qms-ncr', 'view'),
    h(async (req, res) => send(res, { rows: await registersService.listSettings(callerOf(req)) })),
  );
  const setB = z
    .object({ key: z.enum(SETTING_KEYS), value: num, scope: z.enum(['UNIT', 'ALL']) })
    .strict();
  router.put(
    '/qms/settings',
    g('qms-ncr', 'controls'),
    validate({ body: setB }),
    h(async (req, res) => {
      send(res, {
        rows: await registersService.saveSetting(
          callerOf(req),
          'qms-ncr',
          validated(res, 'body', setB),
        ),
      });
    }),
  );

  // ---------------------------------------------------------------- instruments (qms-calibration)
  const iListQ = z
    .object({
      status: z.enum(['ACTIVE', 'OUT_OF_SERVICE', 'RETIRED']).optional(),
      due: z.enum(['true', 'false']).optional(),
      q: z.string().trim().max(80).optional(),
      ...pageQuery,
    })
    .strict();
  router.get(
    '/qms/instruments',
    g('qms-calibration', 'view'),
    validate({ query: iListQ }),
    h(async (req, res) => {
      const q = validated(res, 'query', iListQ);
      const r = await instrumentsService.list(callerOf(req), 'qms-calibration', {
        ...q,
        due: q.due === 'true',
      });
      res.json({
        data: r.rows,
        meta: { page: q.page, size: q.size, total: r.total, reminderDays: r.reminderDays },
      });
    }),
  );
  const instB = z
    .object({
      historyCardNo: txt(40),
      name: txt(150),
      equipmentNo: txt(60),
      division: opt(80),
      measuringRange: opt(80),
      leastCount: opt(40),
      make: opt(80),
      location: opt(80),
      frequencyMonths: z.number().int().min(1).max(120).optional(),
    })
    .strict();
  router.post(
    '/qms/instruments',
    g('qms-calibration', 'add'),
    validate({ body: instB }),
    h(async (req, res) => {
      send(
        res,
        await instrumentsService.create(
          callerOf(req),
          'qms-calibration',
          validated(res, 'body', instB),
        ),
        201,
      );
    }),
  );
  router.get(
    '/qms/instruments/:id',
    g('qms-calibration', 'view'),
    validate({ params: idp }),
    h(async (req, res) =>
      send(
        res,
        await instrumentsService.get(callerOf(req), 'qms-calibration', String(req.params.id)),
      ),
    ),
  );
  const instU = instB
    .partial()
    .omit({ historyCardNo: true, equipmentNo: true })
    .extend({ status: z.enum(['ACTIVE', 'OUT_OF_SERVICE', 'RETIRED']).optional() })
    .strict();
  router.patch(
    '/qms/instruments/:id',
    g('qms-calibration', 'edit'),
    validate({ params: idp, body: instU }),
    h(async (req, res) => {
      send(
        res,
        await instrumentsService.update(
          callerOf(req),
          'qms-calibration',
          String(req.params.id),
          parseIfMatch(req.get('if-match')),
          validated(res, 'body', instU),
        ),
      );
    }),
  );
  const calB = z
    .object({
      calibratedOn: isoDate,
      validUntil: isoDate.optional(),
      certificateNo: opt(60),
      agency: opt(120),
      result: z.enum(['PASS', 'FAIL']),
      errorFound: opt(200),
      note: opt(300),
    })
    .strict();
  router.post(
    '/qms/instruments/:id/calibrate',
    g('qms-calibration', 'edit'),
    validate({ params: idp, body: calB }),
    h(async (req, res) => {
      send(
        res,
        await instrumentsService.calibrate(
          callerOf(req),
          'qms-calibration',
          String(req.params.id),
          validated(res, 'body', calB),
        ),
      );
    }),
  );

  return router;
}
