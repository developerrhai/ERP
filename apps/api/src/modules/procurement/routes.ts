// Phase 9 API (/api/v1): scm (PR, RFQ, quotes, comparison, PO, contracts, GRN, purchase invoice, reports, alerts),
// wms put-away, fin debit notes and fin AP. Every route: authenticate -> requirePasswordChanged -> resolveContext
// -> requirePageAction(page, action) -> validate(zod) -> service. Idempotency-Key is honoured on every posting verb.
import { Router } from 'express';
import type { Request, RequestHandler, Response } from 'express';
import { z } from 'zod';
import { authenticate, requirePasswordChanged } from '../../core/auth/authenticate';
import { resolveContext } from '../../core/context/resolve-context';
import { asyncHandler } from '../../core/http/async-handler';
import { parseIfMatch } from '../../core/http/if-match';
import { validate, validated } from '../../core/http/validate';
import { prisma } from '../../core/db/prisma';
import { requirePageAction } from '../../core/rbac/access';
import type { Action } from '../../core/rbac/permission-model';
import { runIdempotent } from '../approvals/idempotent';
import { callerOf, isoDate, pageQuery, uuid } from '../inventory/routes-shared';
import { TX, norm, softDelete, submitDoc, S } from './core';
import type { Crud } from './crud';
import {
  CMP_DEF,
  CON_DEF,
  PR_DEF,
  RFQ_DEF,
  VQ_DEF,
  cmpActions,
  cmpCrud,
  conCrud,
  prActions,
  prBudgetCheck,
  prCrud,
  rfqActions,
  rfqCrud,
  vqActions,
  vqCrud,
} from './sourcing-service';
import { PO_DEF, deliveryTracking, poActions, poCrud } from './po-service';
import { GRN_DEF, grnService, putaway } from './grn-service';
import { DN_DEF, PINV_DEF, debitNoteService, invoiceService } from './invoice-service';
import { SPP_DEF, apService } from './ap-service';
import { SupplierScoreService, reportsService } from './reports-service';
import { evaluateMonth } from './jobs';
import type { DocDef, Row } from './core';

const h = (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
  asyncHandler(async (req, res) => {
    await fn(req, res);
  });
const dec = z
  .union([z.number(), z.string().regex(/^-?\d+(\.\d+)?$/, 'Enter a number.')])
  .transform((v) => S(v));
const pos = dec.refine((v) => Number(v) > 0, 'Enter a number greater than 0.');
const ymd = isoDate;
const idp = z.object({ id: uuid }).strict();
const listQ = z
  .object({
    q: z.string().trim().max(100).optional(),
    status: z.string().max(20).optional(),
    supplierId: uuid.optional(),
    sort: z.string().max(30).optional(),
    ...pageQuery,
  })
  .strict();
const reasonB = z
  .object({ reason: z.string().trim().min(5, 'Give a reason of at least 5 letters.').max(300) })
  .strict();

const g = (page: string, action: Action): RequestHandler => requirePageAction(page, action);

export function createProcurementRouter(): Router {
  const router = Router();
  const base = [authenticate, requirePasswordChanged, resolveContext];
  router.use(['/scm', '/wms/putaway', '/fin/debitnote', '/fin/ap'], ...base);

  const send = (res: Response, data: object, status = 200) => {
    const v = (data as { version?: number }).version;
    if (v !== undefined) res.set('ETag', `"${v}"`);
    res.status(status).json({ data });
  };
  /** posting-style verbs: Idempotency-Key replays the stored answer, never acts twice */
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
        const id = S(req.params.id ?? '');
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
  const empty = z.object({}).strict().default({});

  /** list / get / create / update / delete / submit for a header+lines document */
  function mountDoc(
    path: string,
    def: DocDef,
    crud: Crud,
    headerS: z.ZodObject<z.ZodRawShape>,
    lineS: z.ZodObject<z.ZodRawShape> | null,
    opts: { submit?: boolean } = {},
  ) {
    const bodyS = lineS
      ? headerS.extend({ lines: z.array(lineS).min(1, 'Add at least one line.').max(500) })
      : headerS;
    const update = bodyS.partial().extend({}).strict();
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
      h(async (req, res) => send(res, await crud.get(callerOf(req), S(req.params.id)))),
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
          await crud.update(callerOf(req), S(req.params.id), parseIfMatch(req.get('if-match')), {
            header,
            ...(lines ? { lines } : {}),
          }),
        );
      }),
    );
    router.delete(
      `${path}/:id`,
      g(def.pageId, 'delete'),
      validate({ params: idp }),
      h(async (req, res) => {
        await softDelete(callerOf(req), def, S(req.params.id), parseIfMatch(req.get('if-match')));
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

  // ------------------------------------------------------------------ PR
  const prLine = z
    .object({
      itemId: uuid.nullish(),
      serviceText: z.string().max(300).nullish(),
      qty: pos,
      uom: z.string().min(1).max(20),
      estRate: dec.optional(),
      costCenterId: uuid.nullish(),
      requiredDate: ymd.nullish(),
    })
    .strict();
  const prHead = z.object({
    requiredDate: ymd.nullish(),
    requestedById: uuid.nullish(),
    supplierType: z.enum(['MATERIAL', 'CONTRACTOR']).optional(),
    purpose: z.string().max(300).nullish(),
  });
  mountDoc('/scm/pr', PR_DEF, prCrud, prHead.strict(), prLine);
  router.get(
    '/scm/pr/:id/budget',
    g('scm-pr', 'view'),
    validate({ params: idp }),
    h(async (req, res) => {
      const pr = await prCrud.get(callerOf(req), S(req.params.id));
      res.json({
        data: { warnings: await prBudgetCheck(prisma, S(pr.unitId), S(pr.fyId), S(pr.id)) },
      });
    }),
  );
  verb(
    '/scm/pr/:id/close-lines',
    'scm-pr',
    'edit',
    'pr-close',
    z.object({ lines: z.array(z.object({ lineId: uuid, qty: pos }).strict()).min(1) }).strict(),
    (req, id, b) => prActions.closeLines(callerOf(req), id, b),
  );
  verb(
    '/scm/pr/:id/to-rfq',
    'scm-rfq',
    'add',
    'pr-to-rfq',
    z
      .object({ lineIds: z.array(uuid).optional(), dueDate: ymd.optional() })
      .strict()
      .default({}),
    (req, id, b) => prActions.toRfq(callerOf(req), id, b),
  );
  verb(
    '/scm/pr/:id/to-po',
    'scm-po',
    'add',
    'pr-to-po',
    z
      .object({
        supplierId: uuid,
        lineIds: z.array(uuid).optional(),
        shipToWarehouseId: uuid.optional(),
      })
      .strict(),
    (req, id, b) => poActions.fromPr(callerOf(req), id, b),
  );

  // ------------------------------------------------------------------ RFQ
  const rfqLine = z
    .object({
      prLineId: uuid.nullish(),
      itemId: uuid.nullish(),
      serviceText: z.string().max(300).nullish(),
      qty: pos,
      uom: z.string().min(1).max(20),
      requiredDate: ymd.nullish(),
    })
    .strict();
  mountDoc(
    '/scm/rfq',
    RFQ_DEF,
    rfqCrud,
    z
      .object({
        issueDate: ymd.nullish(),
        dueDate: ymd.nullish(),
        supplierType: z.enum(['MATERIAL', 'CONTRACTOR']).optional(),
        notes: z.string().max(500).nullish(),
      })
      .strict(),
    rfqLine,
  );
  verb(
    '/scm/rfq/:id/invite',
    'scm-rfq',
    'edit',
    'rfq-invite',
    z.object({ supplierIds: z.array(uuid).min(1).max(50) }).strict(),
    (req, id, b) => rfqActions.invite(callerOf(req), id, b.supplierIds),
  );
  verb('/scm/rfq/:id/issue', 'scm-rfq', 'post', 'rfq-issue', empty, (req, id) =>
    rfqActions.issue(callerOf(req), id),
  );
  verb(
    '/scm/rfq/:id/extend',
    'scm-rfq',
    'edit',
    'rfq-extend',
    z.object({ dueDate: ymd }).strict(),
    (req, id, b) => rfqActions.extend(callerOf(req), id, b.dueDate),
  );

  // ------------------------------------------------------------------ vendor quote
  const vqLine = z
    .object({
      rfqLineId: uuid.nullish(),
      itemId: uuid.nullish(),
      qty: pos,
      uom: z.string().min(1).max(20),
      rate: dec,
      discountPct: dec.optional(),
      gstPct: dec.optional(),
      leadDays: z.number().int().min(0).max(1000).nullish(),
      landedCost: dec.optional(),
      costBreakup: z.record(z.unknown()).nullish(),
    })
    .strict();
  mountDoc(
    '/scm/vendorquote',
    VQ_DEF,
    vqCrud,
    z
      .object({
        rfqId: uuid.nullish(),
        supplierId: uuid,
        quoteDate: ymd.optional(),
        validUntil: ymd.nullish(),
        paymentTermId: uuid.nullish(),
        freight: dec.optional(),
        otherCharges: dec.optional(),
        technicalCompliance: z.boolean().optional(),
        notes: z.string().max(500).nullish(),
      })
      .strict(),
    vqLine,
  );
  verb('/scm/vendorquote/:id/round', 'scm-vendorquote', 'add', 'vq-round', empty, (req, id) =>
    vqActions.round(callerOf(req), id),
  );

  // ------------------------------------------------------------------ comparison
  router.get(
    '/scm/comparison',
    g('scm-comparison', 'view'),
    validate({ query: listQ }),
    h(async (req, res) => {
      const q = validated(res, 'query', listQ);
      const { rows, total } = await cmpCrud.list(callerOf(req), q);
      res.json({ data: rows, meta: { page: q.page, size: q.size, total } });
    }),
  );
  router.get(
    '/scm/comparison/:id',
    g('scm-comparison', 'view'),
    validate({ params: idp }),
    h(async (req, res) => send(res, await cmpCrud.get(callerOf(req), S(req.params.id)))),
  );
  router.post(
    '/scm/comparison',
    g('scm-comparison', 'add'),
    validate({
      body: z
        .object({
          rfqId: uuid,
          wPrice: z.number().min(0).max(100).optional(),
          wLead: z.number().min(0).max(100).optional(),
          wQuality: z.number().min(0).max(100).optional(),
        })
        .strict(),
    }),
    h(async (req, res) =>
      send(
        res,
        await cmpActions.create(
          callerOf(req),
          validated(
            res,
            'body',
            z.object({
              rfqId: uuid,
              wPrice: z.number().optional(),
              wLead: z.number().optional(),
              wQuality: z.number().optional(),
            }),
          ) as never,
        ),
        201,
      ),
    ),
  );
  router.delete(
    '/scm/comparison/:id',
    g('scm-comparison', 'delete'),
    validate({ params: idp }),
    h(async (req, res) => {
      await softDelete(callerOf(req), CMP_DEF, S(req.params.id), parseIfMatch(req.get('if-match')));
      res.status(204).end();
    }),
  );
  verb(
    '/scm/comparison/:id/submit',
    'scm-comparison',
    'submit',
    'cmp-submit',
    empty,
    async (req, id) => {
      await submitDoc(callerOf(req), CMP_DEF, id, parseIfMatch(req.get('if-match')));
      return cmpCrud.get(callerOf(req), id);
    },
  );
  const simS = z
    .object({
      wPrice: z.number().min(0).max(100),
      wLead: z.number().min(0).max(100),
      wQuality: z.number().min(0).max(100),
    })
    .strict();
  router.post(
    '/scm/comparison/:id/simulate',
    g('scm-comparison', 'view'),
    validate({ params: idp, body: simS }),
    h(async (req, res) =>
      res.json({
        data: await cmpActions.simulate(
          callerOf(req),
          S(req.params.id),
          validated(res, 'body', simS),
        ),
      }),
    ),
  );
  verb(
    '/scm/comparison/:id/award',
    'scm-comparison',
    'approve',
    'cmp-award',
    z.object({ quoteId: uuid, reason: z.string().max(300).optional() }).strict(),
    (req, id, b) => cmpActions.award(callerOf(req), id, b),
  );

  // ------------------------------------------------------------------ contracts
  const conLine = z
    .object({
      itemId: uuid,
      uom: z.string().min(1).max(20),
      rate: dec,
      discountPct: dec.optional(),
      minQty: dec.nullish(),
      maxQty: dec.nullish(),
    })
    .strict();
  mountDoc(
    '/scm/contracts',
    CON_DEF,
    conCrud,
    z
      .object({
        supplierId: uuid,
        title: z.string().max(150).optional(),
        validFrom: ymd,
        validTo: ymd,
        contractType: z.enum(['RATE', 'BLANKET']).optional(),
        maxValue: dec.nullish(),
        notes: z.string().max(500).nullish(),
      })
      .strict(),
    conLine,
  );

  // ------------------------------------------------------------------ PO
  const poLine = z
    .object({
      id: uuid.optional(),
      itemId: uuid.nullish(),
      serviceText: z.string().max(300).nullish(),
      qty: pos,
      uom: z.string().min(1).max(20).optional(),
      rate: dec.optional(),
      discountPct: dec.optional(),
      gstPct: dec.optional(),
      deliveryDate: ymd.nullish(),
      leadDays: z.number().int().min(0).max(1000).nullish(),
      model: z.string().max(60).nullish(),
      partNo: z.string().max(60).nullish(),
      costCenterId: uuid.nullish(),
      prLineId: uuid.nullish(),
      contractLineId: uuid.nullish(),
      overReceiptPct: dec.nullish(),
    })
    .strict();
  mountDoc(
    '/scm/po',
    PO_DEF,
    poCrud,
    z
      .object({
        supplierId: uuid,
        poDate: ymd.optional(),
        poType: z.enum(['Standard', 'Capital', 'Service', 'Subcontract']).optional(),
        supplierType: z.enum(['MATERIAL', 'CONTRACTOR']).optional(),
        shipToWarehouseId: uuid.nullish(),
        paymentTermId: uuid.nullish(),
        contractId: uuid.nullish(),
        notes: z.string().max(500).nullish(),
      })
      .strict(),
    poLine,
  );
  router.get(
    '/scm/po-delivery',
    g('scm-po', 'view'),
    validate({
      query: z
        .object({
          supplierId: uuid.optional(),
          status: z.enum(['OPEN', 'PARTLY_RECEIVED', 'CLOSED', 'DELAYED']).optional(),
          ...pageQuery,
        })
        .strict(),
    }),
    h(async (req, res) => {
      const q = validated(
        res,
        'query',
        z.object({
          supplierId: uuid.optional(),
          status: z.string().optional(),
          page: z.number(),
          size: z.number(),
        }),
      );
      const r = await deliveryTracking(callerOf(req), q as never);
      res.json({ data: r.rows, meta: { page: q.page, size: q.size, total: r.total } });
    }),
  );
  verb('/scm/po/from-comparison/:id', 'scm-po', 'add', 'po-from-cmp', empty, (req, id) =>
    poActions.fromComparison(callerOf(req), id),
  );
  verb('/scm/po/:id/amend', 'scm-po', 'edit', 'po-amend', reasonB, (req, id, b) =>
    poActions.amend(callerOf(req), id, b.reason),
  );
  verb(
    '/scm/po/:id/short-close',
    'scm-po',
    'edit',
    'po-short-close',
    z
      .object({ lineIds: z.array(uuid).optional(), reason: z.string().trim().min(5).max(300) })
      .strict(),
    (req, id, b) => poActions.shortClose(callerOf(req), id, b),
  );
  router.get(
    '/scm/po/:id/revisions',
    g('scm-po', 'view'),
    validate({ params: idp }),
    h(async (req, res) =>
      res.json({ data: await poActions.revisions(callerOf(req), S(req.params.id)) }),
    ),
  );

  // ------------------------------------------------------------------ GRN
  const batchS = z
    .object({
      batchNo: z.string().trim().min(1).max(60),
      mfgDate: ymd.nullish(),
      expiryDate: ymd.nullish(),
      qty: pos,
      serialNos: z.array(z.string().max(60)).nullish(),
    })
    .strict();
  const grnLineS = z
    .object({
      poLineId: uuid,
      receivedQty: pos,
      weight: dec.nullish(),
      batches: z.array(batchS).max(200).optional(),
      serialNos: z.array(z.string().max(60)).max(5000).optional(),
    })
    .strict();
  const grnS = z
    .object({
      poId: uuid,
      warehouseId: uuid,
      receiptDate: ymd.optional(),
      vehicleNo: z.string().max(30).nullish(),
      lrNo: z.string().max(40).nullish(),
      vendorInvoiceRef: z.string().max(60).nullish(),
      notes: z.string().max(500).nullish(),
      lines: z.array(grnLineS).min(1).max(200),
      charges: z
        .array(
          z
            .object({
              chargeType: z.string().min(1).max(20),
              amount: dec,
              basis: z.enum(['VALUE', 'QTY', 'WEIGHT']).optional(),
              capitalize: z.boolean().optional(),
              supplierId: uuid.nullish(),
            })
            .strict(),
        )
        .max(20)
        .optional(),
    })
    .strict();
  router.get(
    '/scm/grn',
    g('scm-grn', 'view'),
    validate({ query: listQ }),
    h(async (req, res) => {
      const q = validated(res, 'query', listQ);
      const r = await grnService.list(callerOf(req), q);
      res.json({ data: r.rows, meta: { page: q.page, size: q.size, total: r.total } });
    }),
  );
  router.get(
    '/scm/grn/from-po/:id',
    g('scm-grn', 'add'),
    validate({ params: idp }),
    h(async (req, res) =>
      res.json({ data: await grnService.fromPo(callerOf(req), S(req.params.id)) }),
    ),
  );
  router.get(
    '/scm/grn/:id',
    g('scm-grn', 'view'),
    validate({ params: idp }),
    h(async (req, res) =>
      send(res, (await grnService.get(callerOf(req), S(req.params.id))) as object),
    ),
  );
  router.post(
    '/scm/grn',
    g('scm-grn', 'add'),
    validate({ body: grnS }),
    h(async (req, res) =>
      send(
        res,
        (await grnService.create(callerOf(req), validated(res, 'body', grnS) as never)) as object,
        201,
      ),
    ),
  );
  router.put(
    '/scm/grn/:id',
    g('scm-grn', 'edit'),
    validate({ params: idp, body: grnS }),
    h(async (req, res) =>
      send(
        res,
        (await grnService.update(
          callerOf(req),
          S(req.params.id),
          parseIfMatch(req.get('if-match')),
          validated(res, 'body', grnS) as never,
        )) as object,
      ),
    ),
  );
  router.delete(
    '/scm/grn/:id',
    g('scm-grn', 'delete'),
    validate({ params: idp }),
    h(async (req, res) => {
      await softDelete(callerOf(req), GRN_DEF, S(req.params.id), parseIfMatch(req.get('if-match')));
      res.status(204).end();
    }),
  );
  verb('/scm/grn/:id/submit', 'scm-grn', 'submit', 'grn-submit', empty, async (req, id) => {
    await submitDoc(callerOf(req), GRN_DEF, id, parseIfMatch(req.get('if-match')));
    return grnService.get(callerOf(req), id);
  });
  verb('/scm/grn/:id/post', 'scm-grn', 'post', 'grn-post', empty, (req, id) =>
    grnService.post(callerOf(req), id),
  );
  verb('/scm/grn/:id/cancel', 'scm-grn', 'cancel', 'grn-cancel', reasonB, (req, id, b) =>
    grnService.cancel(callerOf(req), id, b.reason),
  );
  router.post(
    '/scm/grn/lines/:lineId/qc-decision',
    g('scm-grn', 'approve'),
    validate({
      params: z.object({ lineId: uuid }).strict(),
      body: z
        .object({
          acceptedQty: dec,
          rejectedQty: dec,
          rejectReason: z.string().max(300).optional(),
        })
        .strict(),
    }),
    h(async (req, res) => {
      const b = validated(
        res,
        'body',
        z.object({ acceptedQty: dec, rejectedQty: dec, rejectReason: z.string().optional() }),
      );
      await runIdempotent(
        req,
        res,
        req.auth!.userId,
        `qc:${S(req.params.lineId)}`,
        [b],
        async () =>
          (await grnService.qcDecision(
            callerOf(req),
            S(req.params.lineId),
            b as never,
          )) as unknown as { version: number } & object,
      );
    }),
  );

  // ------------------------------------------------------------------ put-away
  router.get(
    '/wms/putaway/tasks',
    g('wms-putaway', 'view'),
    validate({
      query: z
        .object({
          status: z.enum(['Open', 'Assigned', 'Done', 'Exception', 'Cancelled']).optional(),
          ...pageQuery,
        })
        .strict(),
    }),
    h(async (req, res) => {
      const q = validated(
        res,
        'query',
        z.object({ status: z.string().optional(), page: z.number(), size: z.number() }),
      );
      const r = await putaway.list(callerOf(req), q as never);
      res.json({ data: r.rows, meta: { page: q.page, size: q.size, total: r.total } });
    }),
  );
  verb('/wms/putaway/:id/claim', 'wms-putaway', 'edit', 'pa-claim', empty, (req, id) =>
    putaway.claim(callerOf(req), id),
  );
  verb(
    '/wms/putaway/:id/complete',
    'wms-putaway',
    'edit',
    'pa-complete',
    z.object({ binId: uuid }).strict(),
    (req, id, b) => putaway.complete(callerOf(req), id, b),
  );
  verb('/wms/putaway/:id/exception', 'wms-putaway', 'edit', 'pa-exception', reasonB, (req, id, b) =>
    putaway.exception(callerOf(req), id, b.reason),
  );

  // ------------------------------------------------------------------ purchase invoice
  const invLine = z
    .object({
      grnLineId: uuid.nullish(),
      poLineId: uuid.nullish(),
      itemId: uuid.nullish(),
      description: z.string().max(300).nullish(),
      hsnSac: z.string().max(8).nullish(),
      qty: pos,
      uom: z.string().max(20).nullish(),
      rate: dec,
      gstPct: dec.nullish(),
      cgst: dec.nullish(),
      sgst: dec.nullish(),
      igst: dec.nullish(),
      itcFlag: z
        .enum(['ELIGIBLE', 'CAPITAL_GOODS', 'INPUT_SERVICE', 'INELIGIBLE_17_5', 'NOT_APPLICABLE'])
        .optional(),
      costCenterId: uuid.nullish(),
      landedGrnId: uuid.nullish(),
    })
    .strict();
  const invS = z
    .object({
      supplierId: uuid,
      vendorInvoiceNo: z.string().trim().min(1).max(60),
      invoiceDate: ymd,
      poId: uuid.nullish(),
      isRcm: z.boolean().optional(),
      tdsSectionCode: z.string().max(12).nullish(),
      bankAccountId: uuid.nullish(),
      advanceTerms: z.string().max(300).nullish(),
      notes: z.string().max(500).nullish(),
      lines: z.array(invLine).min(1).max(300),
    })
    .strict();
  const invQ = listQ.extend({
    matchState: z.enum(['PENDING', 'MATCHED', 'ON_HOLD', 'OVERRIDDEN']).optional(),
  });
  router.get(
    '/scm/purchaseinvoice',
    g('scm-purchaseinvoice', 'view'),
    validate({ query: invQ }),
    h(async (req, res) => {
      const q = validated(res, 'query', invQ);
      const r = await invoiceService.list(callerOf(req), q);
      res.json({ data: r.rows, meta: { page: q.page, size: q.size, total: r.total } });
    }),
  );
  router.get(
    '/scm/purchaseinvoice/from-grn/:id',
    g('scm-purchaseinvoice', 'add'),
    validate({ params: idp }),
    h(async (req, res) =>
      res.json({ data: await invoiceService.fromGrn(callerOf(req), S(req.params.id)) }),
    ),
  );
  router.get(
    '/scm/purchaseinvoice/:id',
    g('scm-purchaseinvoice', 'view'),
    validate({ params: idp }),
    h(async (req, res) =>
      send(res, (await invoiceService.get(callerOf(req), S(req.params.id))) as object),
    ),
  );
  router.post(
    '/scm/purchaseinvoice',
    g('scm-purchaseinvoice', 'add'),
    validate({ body: invS }),
    h(async (req, res) =>
      send(
        res,
        (await invoiceService.create(
          callerOf(req),
          validated(res, 'body', invS) as never,
        )) as object,
        201,
      ),
    ),
  );
  router.post(
    '/scm/purchaseinvoice/from-grn',
    g('scm-purchaseinvoice', 'add'),
    validate({ body: invS }),
    h(async (req, res) =>
      send(
        res,
        (await invoiceService.create(
          callerOf(req),
          validated(res, 'body', invS) as never,
        )) as object,
        201,
      ),
    ),
  );
  router.put(
    '/scm/purchaseinvoice/:id',
    g('scm-purchaseinvoice', 'edit'),
    validate({ params: idp, body: invS }),
    h(async (req, res) =>
      send(
        res,
        (await invoiceService.update(
          callerOf(req),
          S(req.params.id),
          parseIfMatch(req.get('if-match')),
          validated(res, 'body', invS) as never,
        )) as object,
      ),
    ),
  );
  router.delete(
    '/scm/purchaseinvoice/:id',
    g('scm-purchaseinvoice', 'delete'),
    validate({ params: idp }),
    h(async (req, res) => {
      await softDelete(
        callerOf(req),
        PINV_DEF,
        S(req.params.id),
        parseIfMatch(req.get('if-match')),
      );
      res.status(204).end();
    }),
  );
  verb(
    '/scm/purchaseinvoice/:id/submit',
    'scm-purchaseinvoice',
    'submit',
    'pinv-submit',
    empty,
    (req, id) => invoiceService.submit(callerOf(req), id, parseIfMatch(req.get('if-match'))),
  );
  verb(
    '/scm/purchaseinvoice/:id/match',
    'scm-purchaseinvoice',
    'edit',
    'pinv-match',
    empty,
    (req, id) => invoiceService.match(callerOf(req), id),
  );
  verb(
    '/scm/purchaseinvoice/:id/post',
    'scm-purchaseinvoice',
    'post',
    'pinv-post',
    empty,
    (req, id) => invoiceService.post(callerOf(req), id),
  );
  verb(
    '/scm/purchaseinvoice/:id/cancel',
    'scm-purchaseinvoice',
    'cancel',
    'pinv-cancel',
    reasonB,
    (req, id, b) => invoiceService.cancel(callerOf(req), id, b.reason),
  );
  verb(
    '/scm/purchaseinvoice/:id/exceptions/:eid/override',
    'scm-purchaseinvoice',
    'approve',
    'pinv-override',
    reasonB,
    (req, id, b) =>
      invoiceService.overrideException(callerOf(req), id, S(req.params.eid), b.reason),
    z.object({ id: uuid, eid: uuid }).strict(),
  );
  verb(
    '/scm/purchaseinvoice/:id/itc',
    'scm-purchaseinvoice',
    'edit',
    'pinv-itc',
    z
      .object({
        flags: z
          .array(
            z
              .object({
                lineId: uuid,
                itcFlag: z.enum([
                  'ELIGIBLE',
                  'CAPITAL_GOODS',
                  'INPUT_SERVICE',
                  'INELIGIBLE_17_5',
                  'NOT_APPLICABLE',
                ]),
              })
              .strict(),
          )
          .min(1),
      })
      .strict(),
    (req, id, b) => invoiceService.setItc(callerOf(req), id, b.flags),
  );
  verb(
    '/scm/purchaseinvoice/:id/gstr2b-status',
    'scm-purchaseinvoice',
    'edit',
    'pinv-2b',
    z.object({ status: z.enum(['NOT_CHECKED', 'MATCHED', 'MISSING', 'MISMATCH']) }).strict(),
    (req, id, b) => invoiceService.setGstr2b(callerOf(req), id, b.status),
  );
  router.get(
    '/scm/purchaseinvoice/:id/tds-preview',
    g('scm-purchaseinvoice', 'view'),
    validate({ params: idp }),
    h(async (req, res) =>
      res.json({ data: await invoiceService.tdsPreview(callerOf(req), S(req.params.id)) }),
    ),
  );

  // ------------------------------------------------------------------ debit notes
  const dnLine = z
    .object({
      grnLineId: uuid.nullish(),
      invoiceLineId: uuid.nullish(),
      qty: dec.optional(),
      rate: dec.optional(),
    })
    .strict();
  const dnS = z
    .object({
      kind: z.enum(['RETURN', 'RATE_DIFF', 'SHORT_SUPPLY', 'QUALITY']),
      supplierId: uuid,
      invoiceId: uuid.nullish(),
      grnId: uuid.nullish(),
      noteDate: ymd.optional(),
      reason: z.string().max(300).nullish(),
      lines: z.array(dnLine).min(1).max(200),
    })
    .strict();
  router.get(
    '/fin/debitnote',
    g('fin-debitnote', 'view'),
    validate({ query: listQ }),
    h(async (req, res) => {
      const q = validated(res, 'query', listQ);
      const r = await debitNoteService.list(callerOf(req), q);
      res.json({ data: r.rows, meta: { page: q.page, size: q.size, total: r.total } });
    }),
  );
  router.get(
    '/fin/debitnote/:id',
    g('fin-debitnote', 'view'),
    validate({ params: idp }),
    h(async (req, res) =>
      send(res, (await debitNoteService.get(callerOf(req), S(req.params.id))) as object),
    ),
  );
  for (const p of ['/fin/debitnote', '/fin/debitnote/from-grn', '/fin/debitnote/from-invoice'])
    router.post(
      p,
      g('fin-debitnote', 'add'),
      validate({ body: dnS }),
      h(async (req, res) =>
        send(
          res,
          (await debitNoteService.create(
            callerOf(req),
            validated(res, 'body', dnS) as never,
          )) as object,
          201,
        ),
      ),
    );
  router.put(
    '/fin/debitnote/:id',
    g('fin-debitnote', 'edit'),
    validate({ params: idp, body: dnS }),
    h(async (req, res) =>
      send(
        res,
        (await debitNoteService.update(
          callerOf(req),
          S(req.params.id),
          parseIfMatch(req.get('if-match')),
          validated(res, 'body', dnS) as never,
        )) as object,
      ),
    ),
  );
  router.delete(
    '/fin/debitnote/:id',
    g('fin-debitnote', 'delete'),
    validate({ params: idp }),
    h(async (req, res) => {
      await softDelete(callerOf(req), DN_DEF, S(req.params.id), parseIfMatch(req.get('if-match')));
      res.status(204).end();
    }),
  );
  verb(
    '/fin/debitnote/:id/submit',
    'fin-debitnote',
    'submit',
    'dn-submit',
    empty,
    async (req, id) => {
      await submitDoc(callerOf(req), DN_DEF, id, parseIfMatch(req.get('if-match')));
      return debitNoteService.get(callerOf(req), id);
    },
  );
  verb('/fin/debitnote/:id/post', 'fin-debitnote', 'post', 'dn-post', empty, (req, id) =>
    debitNoteService.post(callerOf(req), id),
  );
  verb('/fin/debitnote/:id/cancel', 'fin-debitnote', 'cancel', 'dn-cancel', reasonB, (req, id, b) =>
    debitNoteService.cancel(callerOf(req), id, b.reason),
  );

  // ------------------------------------------------------------------ AP
  router.get(
    '/fin/ap/payables',
    g('fin-ap', 'view'),
    validate({ query: z.object({ supplierId: uuid.optional(), asOf: ymd.optional() }).strict() }),
    h(async (req, res) =>
      res.json({
        data: await apService.payables(
          callerOf(req),
          validated(res, 'query', z.object({ supplierId: uuid.optional(), asOf: ymd.optional() })),
        ),
      }),
    ),
  );
  router.get(
    '/fin/ap/ageing',
    g('fin-ap', 'view'),
    validate({ query: z.object({ asOf: ymd.optional() }).strict() }),
    h(async (req, res) =>
      res.json({
        data: await apService.ageing(
          callerOf(req),
          validated(res, 'query', z.object({ asOf: ymd.optional() })).asOf,
        ),
      }),
    ),
  );
  router.get(
    '/fin/ap/due-schedule',
    g('fin-ap', 'view'),
    validate({ query: z.object({ from: ymd.optional(), to: ymd.optional() }).strict() }),
    h(async (req, res) =>
      res.json({
        data: await apService.dueSchedule(
          callerOf(req),
          validated(res, 'query', z.object({ from: ymd.optional(), to: ymd.optional() })),
        ),
      }),
    ),
  );
  router.get(
    '/fin/ap/proposals/:id',
    g('fin-ap', 'view'),
    validate({ params: idp }),
    h(async (req, res) =>
      send(res, (await apService.getProposal(callerOf(req), S(req.params.id))) as object),
    ),
  );
  verb(
    '/fin/ap/proposals',
    'fin-ap',
    'add',
    'spp-create',
    z
      .object({
        dueTill: ymd,
        invoiceIds: z.array(uuid).optional(),
        notes: z.string().max(300).optional(),
      })
      .strict(),
    (req, _id, b) => apService.createProposal(callerOf(req), b),
    z.object({}).strict(),
  );
  verb('/fin/ap/proposals/:id/submit', 'fin-ap', 'submit', 'spp-submit', empty, async (req, id) => {
    await submitDoc(callerOf(req), SPP_DEF, id, parseIfMatch(req.get('if-match')));
    return apService.getProposal(callerOf(req), id);
  });
  router.post(
    '/fin/ap/proposals/:id/to-payments',
    g('fin-ap', 'post'),
    validate({ params: idp }),
    h(async (req, res) =>
      res.status(201).json({ data: await apService.toPayments(callerOf(req), S(req.params.id)) }),
    ),
  );
  router.get(
    '/fin/ap/payments',
    g('fin-ap', 'view'),
    validate({ query: listQ.extend({ proposalId: uuid.optional() }) }),
    h(async (req, res) => {
      const q = validated(res, 'query', listQ.extend({ proposalId: uuid.optional() }));
      const r = await apService.listPayments(callerOf(req), q);
      res.json({ data: r.rows, meta: { page: q.page, size: q.size, total: r.total } });
    }),
  );
  verb(
    '/fin/ap/payments/:id/post',
    'fin-ap',
    'post',
    'spay-post',
    z
      .object({
        bankAccountId: uuid,
        paymentMode: z.enum(['NEFT', 'RTGS', 'IMPS', 'UPI', 'Cheque', 'Cash']),
        utr: z.string().trim().max(40).optional(),
        paymentDate: ymd.optional(),
      })
      .strict(),
    (req, id, b) => apService.postPayment(callerOf(req), id, b),
  );
  verb('/fin/ap/payments/:id/cancel', 'fin-ap', 'cancel', 'spay-cancel', reasonB, (req, id, b) =>
    apService.cancelPayment(callerOf(req), id, b.reason),
  );

  // ------------------------------------------------------------------ reports / alerts
  const rep = (
    path: string,
    run: (req: Request) => Promise<unknown>,
    page = 'scm-purchaseinvoice',
  ) =>
    router.get(
      path,
      g(page, 'view'),
      h(async (req, res) => res.json({ data: await run(req) })),
    );
  rep('/scm/reports/grir', (r) => reportsService.grir(callerOf(r)), 'scm-grn');
  rep('/scm/reports/msme-overdue', (r) => reportsService.msmeOverdue(callerOf(r)), 'fin-ap');
  rep('/scm/reports/itc-180', (r) => reportsService.itc180(callerOf(r)), 'fin-ap');
  rep('/scm/reports/itc-at-risk', (r) => reportsService.itcAtRisk(callerOf(r)), 'fin-ap');
  rep(
    '/scm/reports/po-pending',
    async (r) => (await deliveryTracking(callerOf(r), { page: 1, size: 500 })).rows,
    'scm-po',
  );
  rep(
    '/scm/reports/supplier-scorecard',
    (r) =>
      reportsService.supplierScorecard(
        callerOf(r),
        typeof r.query.period === 'string' ? r.query.period : undefined,
      ),
    'scm-evaluation',
  );
  rep('/scm/reports/kpis', (r) => reportsService.kpis(callerOf(r)), 'scm-po');
  rep('/scm/alerts', (r) => reportsService.alerts(callerOf(r)), 'scm-po');
  // ------------------------------------------------------------------ evaluation + supplier tabs
  router.get(
    '/scm/evaluation',
    g('scm-evaluation', 'view'),
    h(async (req, res) =>
      res.json({
        data: await reportsService.supplierScorecard(
          callerOf(req),
          typeof req.query.period === 'string' ? req.query.period : undefined,
        ),
      }),
    ),
  );
  verb(
    '/scm/evaluation/run',
    'scm-evaluation',
    'add',
    'eval-run',
    z.object({ period: z.string().regex(/^\d{4}-\d{2}$/, 'Use a month like 2026-10.') }).strict(),
    async (req, _id, b) => {
      const c = callerOf(req);
      const n = await evaluateMonth(b.period, c.ctx.unitId ?? undefined);
      return { version: 1, evaluated: n, period: b.period };
    },
    z.object({}).strict(),
  );
  router.get(
    '/scm/suppliers/:id/scorecard',
    g('scm-suppliers', 'view'),
    validate({ params: idp }),
    h(async (req, res) =>
      res.json({ data: await SupplierScoreService.latest(prisma, S(req.params.id)) }),
    ),
  );
  router.get(
    '/scm/suppliers/:id/risk',
    g('scm-suppliers', 'view'),
    validate({ params: idp }),
    h(async (req, res) => {
      const sid = S(req.params.id);
      const s = (
        await prisma.$queryRawUnsafe<Row[]>(
          `SELECT purchase_hold, hold_reason, approval_status, status, msme_category FROM suppliers WHERE id=$1::uuid AND deleted_at IS NULL`,
          sid,
        )
      )[0];
      const ev = await SupplierScoreService.latest(prisma, sid);
      const exp = Number(
        (
          await prisma.$queryRawUnsafe<Row[]>(
            `SELECT count(*)::int AS n FROM supplier_documents WHERE supplier_id=$1::uuid AND valid_to < CURRENT_DATE`,
            sid,
          )
        )[0]?.n ?? 0,
      );
      res.json({
        data: {
          onHold: s?.purchase_hold === true,
          holdReason: s?.hold_reason ?? null,
          approved: s?.approval_status === 'APPROVED',
          expiredDocuments: exp,
          grade: ev?.grade ?? null,
          riskFlag: ev?.riskFlag === true || exp > 0 || s?.purchase_hold === true,
        },
      });
    }),
  );
  router.get(
    '/scm/suppliers/:id/compliance-documents',
    g('scm-suppliers', 'view'),
    validate({ params: idp }),
    h(async (req, res) =>
      res.json({
        data: (
          await prisma.$queryRawUnsafe<Row[]>(
            `SELECT id::text, doc_kind, doc_no, valid_from, valid_to, (valid_to < CURRENT_DATE) AS expired FROM supplier_documents WHERE supplier_id=$1::uuid ORDER BY doc_kind`,
            S(req.params.id),
          )
        ).map((r) => norm(r)),
      }),
    ),
  );
  void TX;
  return router;
}
