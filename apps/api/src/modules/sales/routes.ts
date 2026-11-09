// Phase 10 API (/api/v1): /crm and /sales. Every route: authenticate -> requirePasswordChanged -> resolveContext ->
// requirePageAction(page, action) -> validate(zod) -> service. Verbs honour the Idempotency-Key.
import { Router } from 'express';
import type { Request, RequestHandler, Response } from 'express';
import { z } from 'zod';
import { authenticate, requirePasswordChanged } from '../../core/auth/authenticate';
import { resolveContext } from '../../core/context/resolve-context';
import { asyncHandler } from '../../core/http/async-handler';
import { parseIfMatch } from '../../core/http/if-match';
import { validate, validated } from '../../core/http/validate';
import { requirePageAction } from '../../core/rbac/access';
import type { Action } from '../../core/rbac/permission-model';
import { runIdempotent } from '../approvals/idempotent';
import { callerOf, isoDate, pageQuery, uuid } from '../inventory/routes-shared';
import { softDelete, submitDoc, todayIst } from '../procurement/core';
import type { DocDef, Row } from '../procurement/core';
import type { Crud } from '../procurement/crud';
import {
  FB_DEF,
  FU_DEF,
  LEAD_DEF,
  MTG_DEF,
  OPP_DEF,
  crmActions,
  creditOverview,
  customer360,
  demandPlan,
  feedbackCrud,
  followupCrud,
  forecastService,
  leadCrud,
  meetingCrud,
  npsReport,
  oppCrud,
  sourceService,
} from './crm-service';
import {
  CRFQ_DEF,
  SO_DEF,
  SQ_DEF,
  orderActions,
  orderCrud,
  quotationActions,
  quotationCrud,
  rfqActions,
  rfqCrud,
} from './docs-service';
import {
  DISP_DEF,
  INV_DEF,
  RET_DEF,
  challanPdf,
  dispatchList,
  dispatchService,
  invoiceService,
  receiptService,
  returnService,
} from './fulfilment-service';

const dec = z
  .union([z.number(), z.string().regex(/^-?\d+(\.\d+)?$/, 'Enter a number.')])
  .transform((v) => String(v));
const pos = dec.refine((v) => Number(v) > 0, 'Enter a number greater than 0.');
const ymd = isoDate;
const ts = z
  .string()
  .datetime({ offset: true })
  .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/));
const idp = z.object({ id: uuid }).strict();
const listQ = z
  .object({
    q: z.string().trim().max(100).optional(),
    status: z.string().max(24).optional(),
    customerId: uuid.optional(),
    supplierId: uuid.optional(),
    sort: z.string().max(30).optional(),
    ...pageQuery,
  })
  .strict();
const reasonB = z
  .object({ reason: z.string().trim().min(5, 'Give a reason of at least 5 letters.').max(300) })
  .strict();
const empty = z.object({}).strict().default({});
const h = (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
  asyncHandler(async (req, res) => {
    await fn(req, res);
  });
const g = (page: string, action: Action): RequestHandler => requirePageAction(page, action);

export function createSalesRouter(): Router {
  const router = Router();
  router.use(['/crm', '/sales'], authenticate, requirePasswordChanged, resolveContext);
  const send = (res: Response, data: object, status = 200) => {
    const v = (data as { version?: number }).version;
    if (v !== undefined) res.set('ETag', `"${v}"`);
    res.status(status).json({ data });
  };
  const verb = <B extends z.ZodTypeAny>(
    path: string,
    page: string,
    action: Action,
    scope: string,
    schema: B,
    run: (req: Request, id: string, body: z.infer<B>) => Promise<object>,
    params: z.ZodTypeAny = idp,
  ) => {
    router.post(
      path,
      g(page, action),
      validate({ params, body: schema }),
      h(async (req, res) => {
        const body = validated(res, 'body', schema) as z.infer<B>;
        const id = String(req.params.id ?? '');
        await runIdempotent(
          req,
          res,
          req.auth!.userId,
          `${scope}:${id}`,
          [path, id, body],
          async () => (await run(req, id, body)) as { version: number } & object,
        );
      }),
    );
  };

  function mountDoc(
    path: string,
    def: DocDef,
    crud: Crud,
    bodyS: z.ZodObject<z.ZodRawShape>,
    opts: { submit?: boolean } = {},
  ) {
    const update = bodyS.partial().strict();
    router.get(
      path,
      g(def.pageId, 'view'),
      validate({ query: listQ }),
      h(async (req, res) => {
        const q = validated(res, 'query', listQ);
        const { rows, total } = await crud.list(callerOf(req), q);
        res.json({ data: rows, meta: { page: q.page, size: q.size, total } });
      }),
    );
    router.get(
      `${path}/:id`,
      g(def.pageId, 'view'),
      validate({ params: idp }),
      h(async (req, res) => send(res, await crud.get(callerOf(req), String(req.params.id)))),
    );
    router.post(
      path,
      g(def.pageId, 'add'),
      validate({ body: bodyS }),
      h(async (req, res) => {
        const { lines, ...header } = validated(res, 'body', bodyS) as Row & { lines?: Row[] };
        send(res, await crud.create(callerOf(req), { header, lines: lines ?? [] }), 201);
      }),
    );
    router.put(
      `${path}/:id`,
      g(def.pageId, 'edit'),
      validate({ params: idp, body: update }),
      h(async (req, res) => {
        const { lines, ...header } = validated(res, 'body', update) as Row & { lines?: Row[] };
        send(
          res,
          await crud.update(
            callerOf(req),
            String(req.params.id),
            parseIfMatch(req.get('if-match')),
            { header, ...(lines ? { lines } : {}) },
          ),
        );
      }),
    );
    router.delete(
      `${path}/:id`,
      g(def.pageId, 'delete'),
      validate({ params: idp }),
      h(async (req, res) => {
        await softDelete(
          callerOf(req),
          def,
          String(req.params.id),
          parseIfMatch(req.get('if-match')),
        );
        res.status(204).end();
      }),
    );
    if (opts.submit !== false)
      verb(
        `${path}/:id/submit`,
        def.pageId,
        'submit',
        `submit:${def.pageId}`,
        empty,
        async (req, id) => {
          await submitDoc(callerOf(req), def, id, parseIfMatch(req.get('if-match')));
          return crud.get(callerOf(req), id);
        },
      );
  }

  // ------------------------------------------------------------------ CRM
  router.get(
    '/crm/sources',
    g('crm-sources', 'view'),
    h(async (_req, res) => res.json({ data: await sourceService.list() })),
  );
  router.post(
    '/crm/sources',
    g('crm-sources', 'add'),
    validate({
      body: z
        .object({
          code: z
            .string()
            .trim()
            .regex(/^[A-Za-z0-9_-]{2,20}$/, 'Use 2-20 letters or digits.'),
          name: z.string().trim().min(2).max(80),
        })
        .strict(),
    }),
    h(async (req, res) =>
      send(
        res,
        await sourceService.create(
          callerOf(req),
          validated(res, 'body', z.object({ code: z.string(), name: z.string() })),
        ),
        201,
      ),
    ),
  );
  router.put(
    '/crm/sources/:id',
    g('crm-sources', 'edit'),
    validate({
      params: idp,
      body: z
        .object({
          name: z.string().trim().min(2).max(80).optional(),
          status: z.enum(['Active', 'Inactive']).optional(),
        })
        .strict(),
    }),
    h(async (req, res) =>
      res.json({
        data: await sourceService.update(
          callerOf(req),
          String(req.params.id),
          validated(
            res,
            'body',
            z.object({
              name: z.string().optional(),
              status: z.enum(['Active', 'Inactive']).optional(),
            }),
          ),
        ),
      }),
    ),
  );

  mountDoc(
    '/crm/leads',
    LEAD_DEF,
    leadCrud,
    z
      .object({
        name: z.string().trim().min(2).max(150),
        company: z.string().max(150).nullish(),
        mobile: z.string().max(20).nullish(),
        email: z.string().email().max(150).nullish(),
        stateCode: z.string().length(2).nullish(),
        sourceId: uuid.nullish(),
        assignedToId: uuid.nullish(),
        interest: z.string().max(300).nullish(),
        estValue: dec.nullish(),
        score: z.number().int().min(0).max(100).optional(),
      })
      .strict(),
    { submit: false },
  );
  verb(
    '/crm/leads/:id/status',
    'crm-leads',
    'edit',
    'lead-status',
    z
      .object({
        status: z.enum(['Contacted', 'Qualified', 'Unqualified']),
        lostReason: z.string().max(300).optional(),
      })
      .strict(),
    (req, id, b) => crmActions.leadStatus(callerOf(req), id, b),
  );
  verb(
    '/crm/leads/:id/convert',
    'crm-leads',
    'edit',
    'lead-convert',
    z
      .object({
        customerId: uuid.optional(),
        title: z.string().max(200).optional(),
        amount: dec.optional(),
      })
      .strict()
      .default({}),
    (req, id, b) => crmActions.convert(callerOf(req), id, b),
  );

  mountDoc(
    '/crm/opportunities',
    OPP_DEF,
    oppCrud,
    z
      .object({
        customerId: uuid.nullish(),
        leadId: uuid.nullish(),
        title: z.string().trim().min(2).max(200),
        amount: dec.optional(),
        probability: z.number().int().min(0).max(100).optional(),
        expectedClose: ymd.nullish(),
        ownerId: uuid.nullish(),
      })
      .strict(),
    { submit: false },
  );
  verb(
    '/crm/opportunities/:id/move-stage',
    'crm-pipeline',
    'edit',
    'opp-stage',
    z
      .object({
        stage: z.enum(['Prospecting', 'Qualification', 'Proposal', 'Negotiation', 'Won', 'Lost']),
        note: z.string().max(300).optional(),
        lostReason: z.string().max(300).optional(),
      })
      .strict(),
    (req, id, b) => crmActions.moveStage(callerOf(req), id, b),
  );
  router.get(
    '/crm/opportunities/:id/history',
    g('crm-opportunities', 'view'),
    validate({ params: idp }),
    h(async (req, res) =>
      res.json({ data: await crmActions.history(callerOf(req), String(req.params.id)) }),
    ),
  );
  router.get(
    '/crm/pipeline',
    g('crm-pipeline', 'view'),
    h(async (req, res) => res.json({ data: await crmActions.pipeline(callerOf(req)) })),
  );

  mountDoc(
    '/crm/followups',
    FU_DEF,
    followupCrud,
    z
      .object({
        relatedType: z.enum(['LEAD', 'OPPORTUNITY', 'CUSTOMER', 'ORDER']).optional(),
        relatedId: uuid.nullish(),
        customerId: uuid.nullish(),
        title: z.string().trim().min(2).max(200),
        kind: z.string().max(12).optional(),
        dueAt: ts,
        assignedToId: uuid.nullish(),
      })
      .strict(),
    { submit: false },
  );
  verb(
    '/crm/followups/:id/done',
    'crm-followups',
    'edit',
    'fu-done',
    z.object({ outcome: z.string().trim().min(3).max(300) }).strict(),
    (req, id, b) => crmActions.followupDone(callerOf(req), id, b.outcome),
  );
  mountDoc(
    '/crm/meetings',
    MTG_DEF,
    meetingCrud,
    z
      .object({
        relatedType: z.enum(['LEAD', 'OPPORTUNITY', 'CUSTOMER', 'ORDER']).optional(),
        relatedId: uuid.nullish(),
        customerId: uuid.nullish(),
        subject: z.string().trim().min(2).max(200),
        kind: z.enum(['Meeting', 'Call']).optional(),
        startsAt: ts,
        durationMin: z.number().int().min(1).max(1440).nullish(),
        attendees: z.string().max(300).nullish(),
        ownerId: uuid.nullish(),
      })
      .strict(),
    { submit: false },
  );
  verb(
    '/crm/meetings/:id/held',
    'crm-meetings',
    'edit',
    'mtg-held',
    z.object({ outcome: z.string().trim().min(3).max(500) }).strict(),
    (req, id, b) => crmActions.meetingHeld(callerOf(req), id, b.outcome),
  );
  mountDoc(
    '/crm/feedback',
    FB_DEF,
    feedbackCrud,
    z
      .object({
        customerId: uuid,
        rating: z.number().int().min(0).max(10),
        category: z.string().max(20).optional(),
        comment: z.string().max(1000).nullish(),
        givenOn: ymd.optional(),
      })
      .strict(),
    { submit: false },
  );
  verb(
    '/crm/feedback/:id/status',
    'crm-feedback',
    'edit',
    'fb-status',
    z
      .object({
        status: z.enum(['In review', 'Closed']),
        actionNote: z.string().max(500).optional(),
      })
      .strict(),
    (req, id, b) => crmActions.feedbackStatus(callerOf(req), id, b),
  );
  router.get(
    '/crm/feedback-nps',
    g('crm-feedback', 'view'),
    h(async (req, res) => res.json({ data: await npsReport(callerOf(req)) })),
  );
  router.get(
    '/crm/customers/:id/360',
    g('crm-customer360', 'view'),
    validate({ params: idp }),
    h(async (req, res) =>
      res.json({ data: await customer360(callerOf(req), String(req.params.id)) }),
    ),
  );

  // ------------------------------------------------------------------ pre-sales: customer RFQ + quotation
  const rfqLine = z
    .object({
      itemId: uuid.nullish(),
      description: z.string().max(300).nullish(),
      partNo: z.string().max(60).nullish(),
      qty: pos,
      uom: z.string().max(20).optional(),
      targetRate: dec.nullish(),
    })
    .strict();
  mountDoc(
    '/sales/rfq',
    CRFQ_DEF,
    rfqCrud,
    z
      .object({
        customerId: uuid,
        opportunityId: uuid.nullish(),
        customerRef: z.string().max(60).nullish(),
        receivedOn: ymd.optional(),
        requiredBy: ymd.nullish(),
        description: z.string().max(500).nullish(),
        estimatedValue: dec.optional(),
        lines: z.array(rfqLine).min(1).max(200),
      })
      .strict(),
    { submit: false },
  );
  verb(
    '/sales/rfq/:id/engineering-review',
    'sales-quotations',
    'edit',
    'crfq-eng',
    z.object({ feasible: z.boolean(), note: z.string().trim().min(3).max(500) }).strict(),
    (req, id, b) => rfqActions.engineeringReview(callerOf(req), id, b),
  );
  verb(
    '/sales/rfq/:id/finance-review',
    'sales-quotations',
    'approve',
    'crfq-fin',
    z.object({ marginPct: dec, note: z.string().trim().min(3).max(500) }).strict(),
    (req, id, b) => rfqActions.financeReview(callerOf(req), id, b),
  );
  verb(
    '/sales/rfq/:id/to-quotation',
    'sales-quotations',
    'add',
    'crfq-quote',
    z.object({ gstPct: dec.optional() }).strict().default({}),
    (req, id, b) => rfqActions.toQuotation(callerOf(req), id, b),
  );

  const qLine = z
    .object({
      itemId: uuid.nullish(),
      description: z.string().max(300).nullish(),
      partNo: z.string().max(60).nullish(),
      qty: pos,
      uom: z.string().max(20).optional(),
      rate: dec.optional(),
      discountPct: dec.optional(),
      gstPct: dec.optional(),
      unitCost: dec.nullish(),
      costBreakup: z.record(z.unknown()).nullish(),
      leadDays: z.number().int().min(0).max(1000).nullish(),
    })
    .strict();
  mountDoc(
    '/sales/quotations',
    SQ_DEF,
    quotationCrud,
    z
      .object({
        customerId: uuid,
        rfqId: uuid.nullish(),
        opportunityId: uuid.nullish(),
        quoteDate: ymd.optional(),
        validUntil: ymd.nullish(),
        formatCode: z.string().max(40).nullish(),
        paymentTermId: uuid.nullish(),
        priceListId: uuid.nullish(),
        customerRef: z.string().max(60).nullish(),
        notes: z.string().max(500).nullish(),
        lines: z.array(qLine).min(1).max(300),
      })
      .strict(),
  );
  verb(
    '/sales/quotations/:id/revise',
    'sales-quotations',
    'edit',
    'sq-revise',
    reasonB,
    (req, id, b) => quotationActions.revise(callerOf(req), id, b.reason),
  );
  router.get(
    '/sales/quotations/:id/revisions',
    g('sales-quotations', 'view'),
    validate({ params: idp }),
    h(async (req, res) =>
      res.json({ data: await quotationActions.revisions(callerOf(req), String(req.params.id)) }),
    ),
  );
  verb(
    '/sales/quotations/:id/customer-decision',
    'sales-quotations',
    'edit',
    'sq-decide',
    z
      .object({
        decision: z.enum(['ACCEPTED', 'REJECTED']),
        customerRef: z.string().max(60).optional(),
        decidedOn: ymd.optional(),
      })
      .strict(),
    (req, id, b) => quotationActions.customerDecision(callerOf(req), id, b),
  );
  verb(
    '/sales/quotations/:id/to-order',
    'sales-orders',
    'add',
    'sq-order',
    z
      .object({
        customerPoNo: z.string().max(60).optional(),
        customerPoDate: ymd.optional(),
        deliveryDate: ymd.optional(),
      })
      .strict()
      .default({}),
    (req, id, b) => quotationActions.toOrder(callerOf(req), id, b),
  );

  // ------------------------------------------------------------------ orders
  const oLine = z
    .object({
      itemId: uuid,
      description: z.string().max(300).nullish(),
      partNo: z.string().max(60).nullish(),
      colour: z.string().max(60).nullish(),
      qty: pos,
      uom: z.string().max(20).optional(),
      rate: dec.optional(),
      discountPct: dec.optional(),
      gstPct: dec.optional(),
      deliveryDate: ymd.nullish(),
      warehouseId: uuid.nullish(),
    })
    .strict();
  mountDoc(
    '/sales/orders',
    SO_DEF,
    orderCrud,
    z
      .object({
        customerId: uuid,
        quotationId: uuid.nullish(),
        customerPoNo: z.string().max(60).nullish(),
        customerPoDate: ymd.nullish(),
        orderDate: ymd.optional(),
        deliveryDate: ymd.nullish(),
        shipTo: z.string().max(300).nullish(),
        paymentTermId: uuid.nullish(),
        notes: z.string().max(500).nullish(),
        lines: z.array(oLine).min(1).max(300),
      })
      .strict(),
  );
  verb(
    '/sales/orders/:id/credit-override',
    'sales-credit',
    'approve',
    'so-credit',
    reasonB,
    (req, id, b) => orderActions.creditOverride(callerOf(req), id, b.reason),
  );
  verb(
    '/sales/orders/:id/reserve',
    'sales-reservations',
    'add',
    'so-reserve',
    z
      .object({
        warehouseId: uuid.optional(),
        priority: z.enum(['Critical', 'High', 'Medium', 'Low']).optional(),
      })
      .strict()
      .default({}),
    (req, id, b) => orderActions.reserve(callerOf(req), id, b),
  );
  verb(
    '/sales/orders/:id/short-close',
    'sales-orders',
    'edit',
    'so-close',
    z
      .object({ lineIds: z.array(uuid).optional(), reason: z.string().trim().min(5).max(300) })
      .strict(),
    (req, id, b) => orderActions.closeLines(callerOf(req), id, b),
  );

  // ------------------------------------------------------------------ dispatch
  const dLine = z
    .object({
      orderLineId: uuid,
      qty: pos,
      batchNo: z.string().max(60).nullish(),
      serialNos: z.array(z.string().max(60)).max(5000).nullish(),
      inspectionSerial: z.string().max(60).nullish(),
      remark: z.string().max(200).nullish(),
    })
    .strict();
  const dBody = z
    .object({
      orderId: uuid,
      warehouseId: uuid,
      dispatchDate: ymd.optional(),
      vehicleNo: z.string().max(30).nullish(),
      transporter: z.string().max(100).nullish(),
      lrNo: z.string().max(40).nullish(),
      driver: z.string().max(80).nullish(),
      shipTo: z.string().max(300).nullish(),
      weightKg: dec.nullish(),
      remark: z.string().max(300).nullish(),
      lines: z.array(dLine).min(1).max(300),
    })
    .strict();
  router.get(
    '/sales/dispatch',
    g('sales-dispatch', 'view'),
    validate({ query: listQ }),
    h(async (req, res) => {
      const q = validated(res, 'query', listQ);
      const r = await dispatchService.list(callerOf(req), q);
      res.json({ data: r.rows, meta: { page: q.page, size: q.size, total: r.total } });
    }),
  );
  router.get(
    '/sales/dispatch/from-order/:id',
    g('sales-dispatch', 'add'),
    validate({ params: idp }),
    h(async (req, res) =>
      res.json({ data: await dispatchService.fromOrder(callerOf(req), String(req.params.id)) }),
    ),
  );
  router.get(
    '/sales/dispatch/:id/challan.pdf',
    g('sales-dispatch', 'print'),
    validate({ params: idp }),
    h(async (req, res) => {
      const pdf = await challanPdf(callerOf(req), String(req.params.id));
      res
        .set('Content-Type', 'application/pdf')
        .set('Content-Disposition', 'inline; filename="delivery-challan.pdf"')
        .send(pdf);
    }),
  );
  router.get(
    '/sales/dispatch/:id',
    g('sales-dispatch', 'view'),
    validate({ params: idp }),
    h(async (req, res) =>
      send(res, await dispatchService.get(callerOf(req), String(req.params.id))),
    ),
  );
  router.post(
    '/sales/dispatch',
    g('sales-dispatch', 'add'),
    validate({ body: dBody }),
    h(async (req, res) =>
      send(
        res,
        await dispatchService.create(callerOf(req), validated(res, 'body', dBody) as never),
        201,
      ),
    ),
  );
  router.put(
    '/sales/dispatch/:id',
    g('sales-dispatch', 'edit'),
    validate({ params: idp, body: dBody }),
    h(async (req, res) =>
      send(
        res,
        await dispatchService.update(
          callerOf(req),
          String(req.params.id),
          parseIfMatch(req.get('if-match')),
          validated(res, 'body', dBody) as never,
        ),
      ),
    ),
  );
  router.delete(
    '/sales/dispatch/:id',
    g('sales-dispatch', 'delete'),
    validate({ params: idp }),
    h(async (req, res) => {
      await softDelete(
        callerOf(req),
        DISP_DEF,
        String(req.params.id),
        parseIfMatch(req.get('if-match')),
      );
      res.status(204).end();
    }),
  );
  verb(
    '/sales/dispatch/:id/submit',
    'sales-dispatch',
    'submit',
    'disp-submit',
    empty,
    async (req, id) => {
      await submitDoc(callerOf(req), DISP_DEF, id, parseIfMatch(req.get('if-match')));
      return dispatchService.get(callerOf(req), id);
    },
  );
  verb('/sales/dispatch/:id/post', 'sales-dispatch', 'post', 'disp-post', empty, (req, id) =>
    dispatchService.post(callerOf(req), id),
  );
  verb(
    '/sales/dispatch/:id/cancel',
    'sales-dispatch',
    'cancel',
    'disp-cancel',
    reasonB,
    (req, id, b) => dispatchService.cancel(callerOf(req), id, b.reason),
  );
  router.get(
    '/sales/dispatch-list',
    g('sales-dispatch', 'view'),
    validate({ query: z.object({ date: ymd.optional() }).strict() }),
    h(async (req, res) =>
      res.json({
        data: await dispatchList(
          callerOf(req),
          validated(res, 'query', z.object({ date: ymd.optional() })).date ?? todayIst(),
        ),
      }),
    ),
  );

  // ------------------------------------------------------------------ invoices
  const iBody = z
    .object({
      dispatchId: uuid,
      invoiceDate: ymd.optional(),
      freight: dec.nullish(),
      notes: z.string().max(500).nullish(),
      lines: z.array(z.object({ dispatchLineId: uuid, qty: pos }).strict()).optional(),
    })
    .strict();
  router.get(
    '/sales/invoices',
    g('sales-invoices', 'view'),
    validate({ query: listQ }),
    h(async (req, res) => {
      const q = validated(res, 'query', listQ);
      const r = await invoiceService.list(callerOf(req), q);
      res.json({ data: r.rows, meta: { page: q.page, size: q.size, total: r.total } });
    }),
  );
  router.get(
    '/sales/invoices/from-dispatch/:id',
    g('sales-invoices', 'add'),
    validate({ params: idp }),
    h(async (req, res) =>
      res.json({ data: await invoiceService.fromDispatch(callerOf(req), String(req.params.id)) }),
    ),
  );
  router.get(
    '/sales/invoices/:id',
    g('sales-invoices', 'view'),
    validate({ params: idp }),
    h(async (req, res) =>
      send(res, await invoiceService.get(callerOf(req), String(req.params.id))),
    ),
  );
  router.post(
    '/sales/invoices',
    g('sales-invoices', 'add'),
    validate({ body: iBody }),
    h(async (req, res) =>
      send(
        res,
        await invoiceService.create(callerOf(req), validated(res, 'body', iBody) as never),
        201,
      ),
    ),
  );
  router.put(
    '/sales/invoices/:id',
    g('sales-invoices', 'edit'),
    validate({ params: idp, body: iBody }),
    h(async (req, res) =>
      send(
        res,
        await invoiceService.update(
          callerOf(req),
          String(req.params.id),
          parseIfMatch(req.get('if-match')),
          validated(res, 'body', iBody) as never,
        ),
      ),
    ),
  );
  router.delete(
    '/sales/invoices/:id',
    g('sales-invoices', 'delete'),
    validate({ params: idp }),
    h(async (req, res) => {
      await softDelete(
        callerOf(req),
        INV_DEF,
        String(req.params.id),
        parseIfMatch(req.get('if-match')),
      );
      res.status(204).end();
    }),
  );
  verb(
    '/sales/invoices/:id/submit',
    'sales-invoices',
    'submit',
    'inv-submit',
    empty,
    async (req, id) => {
      await submitDoc(callerOf(req), INV_DEF, id, parseIfMatch(req.get('if-match')));
      return invoiceService.get(callerOf(req), id);
    },
  );
  verb('/sales/invoices/:id/post', 'sales-invoices', 'post', 'inv-post', empty, (req, id) =>
    invoiceService.post(callerOf(req), id),
  );
  verb(
    '/sales/invoices/:id/cancel',
    'sales-invoices',
    'cancel',
    'inv-cancel',
    reasonB,
    (req, id, b) => invoiceService.cancel(callerOf(req), id, b.reason),
  );

  // ------------------------------------------------------------------ collections
  const rBody = z
    .object({
      customerId: uuid,
      bankAccountId: uuid,
      amount: pos,
      mode: z.enum(['NEFT', 'RTGS', 'IMPS', 'UPI', 'Cheque', 'Cash']),
      receiptDate: ymd.optional(),
      reference: z.string().max(60).nullish(),
      allocations: z
        .array(z.object({ invoiceId: uuid, amount: pos }).strict())
        .max(100)
        .optional(),
    })
    .strict();
  router.get(
    '/sales/collections/outstanding',
    g('sales-collections', 'view'),
    h(async (req, res) => res.json({ data: await receiptService.outstanding(callerOf(req)) })),
  );
  router.get(
    '/sales/receipts',
    g('sales-collections', 'view'),
    validate({ query: listQ }),
    h(async (req, res) => {
      const q = validated(res, 'query', listQ);
      const r = await receiptService.list(callerOf(req), q);
      res.json({ data: r.rows, meta: { page: q.page, size: q.size, total: r.total } });
    }),
  );
  router.post(
    '/sales/receipts',
    g('sales-collections', 'post'),
    validate({ body: rBody }),
    h(async (req, res) => {
      const b = validated(res, 'body', rBody) as never;
      await runIdempotent(
        req,
        res,
        req.auth!.userId,
        'receipt',
        [b],
        async () => (await receiptService.post(callerOf(req), b)) as { version: number } & object,
      );
    }),
  );

  // ------------------------------------------------------------------ returns
  const retBody = z
    .object({
      invoiceId: uuid,
      warehouseId: uuid,
      returnDate: ymd.optional(),
      reason: z.string().max(300).nullish(),
      lines: z
        .array(
          z
            .object({ invoiceLineId: uuid, qty: pos, reason: z.string().max(200).nullish() })
            .strict(),
        )
        .min(1)
        .max(200),
    })
    .strict();
  router.get(
    '/sales/returns',
    g('sales-returns', 'view'),
    validate({ query: listQ }),
    h(async (req, res) => {
      const q = validated(res, 'query', listQ);
      const r = await returnService.list(callerOf(req), q);
      res.json({ data: r.rows, meta: { page: q.page, size: q.size, total: r.total } });
    }),
  );
  router.get(
    '/sales/returns/:id',
    g('sales-returns', 'view'),
    validate({ params: idp }),
    h(async (req, res) => send(res, await returnService.get(callerOf(req), String(req.params.id)))),
  );
  router.post(
    '/sales/returns',
    g('sales-returns', 'add'),
    validate({ body: retBody }),
    h(async (req, res) =>
      send(
        res,
        await returnService.create(callerOf(req), validated(res, 'body', retBody) as never),
        201,
      ),
    ),
  );
  router.put(
    '/sales/returns/:id',
    g('sales-returns', 'edit'),
    validate({ params: idp, body: retBody }),
    h(async (req, res) =>
      send(
        res,
        await returnService.update(
          callerOf(req),
          String(req.params.id),
          parseIfMatch(req.get('if-match')),
          validated(res, 'body', retBody) as never,
        ),
      ),
    ),
  );
  router.delete(
    '/sales/returns/:id',
    g('sales-returns', 'delete'),
    validate({ params: idp }),
    h(async (req, res) => {
      await softDelete(
        callerOf(req),
        RET_DEF,
        String(req.params.id),
        parseIfMatch(req.get('if-match')),
      );
      res.status(204).end();
    }),
  );
  verb(
    '/sales/returns/:id/submit',
    'sales-returns',
    'submit',
    'ret-submit',
    empty,
    async (req, id) => {
      await submitDoc(callerOf(req), RET_DEF, id, parseIfMatch(req.get('if-match')));
      return returnService.get(callerOf(req), id);
    },
  );
  verb('/sales/returns/:id/post', 'sales-returns', 'post', 'ret-post', empty, (req, id) =>
    returnService.post(callerOf(req), id),
  );

  router.get(
    '/sales/credit/overview',
    g('sales-credit', 'view'),
    h(async (_req, res) => res.json({ data: await creditOverview() })),
  );
  // ------------------------------------------------------------------ demand planning + credit view
  router.get(
    '/sales/demand-plan',
    g('sales-orders', 'view'),
    validate({
      query: z
        .object({
          from: z
            .string()
            .regex(/^\d{4}-\d{2}$/)
            .optional(),
          to: z
            .string()
            .regex(/^\d{4}-\d{2}$/)
            .optional(),
        })
        .strict(),
    }),
    h(async (req, res) =>
      res.json({
        data: await demandPlan(
          callerOf(req),
          validated(
            res,
            'query',
            z.object({ from: z.string().optional(), to: z.string().optional() }),
          ),
        ),
      }),
    ),
  );
  router.get(
    '/sales/forecasts',
    g('sales-orders', 'view'),
    h(async (req, res) => res.json({ data: await forecastService.list(callerOf(req)) })),
  );
  router.post(
    '/sales/forecasts',
    g('sales-orders', 'add'),
    validate({
      body: z
        .object({
          itemId: uuid,
          month: z.string().regex(/^\d{4}-\d{2}$/),
          qty: dec,
          customerId: uuid.nullish(),
          notes: z.string().max(300).nullish(),
        })
        .strict(),
    }),
    h(async (req, res) =>
      res.json({
        data: await forecastService.upsert(
          callerOf(req),
          validated(
            res,
            'body',
            z.object({ itemId: z.string(), month: z.string(), qty: z.string() }),
          ) as never,
        ),
      }),
    ),
  );
  return router;
}
