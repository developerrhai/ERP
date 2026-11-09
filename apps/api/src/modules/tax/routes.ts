// Phase 11 API (/api/v1/tax). authenticate -> requirePasswordChanged -> resolveContext -> requirePageAction -> zod -> service.
// R-12: every route prepares data or records numbers a person typed in; nothing here calls GSTN, the IRP, the e-way
// portal or TRACES.
import { Router } from 'express';
import type { Request, RequestHandler, Response } from 'express';
import { z } from 'zod';
import { authenticate, requirePasswordChanged } from '../../core/auth/authenticate';
import { resolveContext } from '../../core/context/resolve-context';
import { asyncHandler } from '../../core/http/async-handler';
import { Errors } from '../../core/http/errors';
import { validate, validated } from '../../core/http/validate';
import { requirePageAction } from '../../core/rbac/access';
import type { Action } from '../../core/rbac/permission-model';
import { runIdempotent } from '../approvals/idempotent';
import { uuid } from '../inventory/routes-shared';
import { einvoiceService, ewayService } from './einvoice-service';
import { gstr2bService } from './gstr2b-service';
import { returnsService } from './returns-service';
import { settlementService } from './settlement-service';
import { registerWorkbook, tdsReports } from './tds-service';

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM.');
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.');
const amt = z
  .union([z.number(), z.string()])
  .transform((v) => String(v))
  .refine((v) => /^\d+(\.\d{1,2})?$/.test(v), 'Enter an amount like 100.50.');
const idp = z.object({ id: uuid }).strict();
const h = (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
  asyncHandler(async (req, res) => {
    await fn(req, res);
  });
const g = (page: string, a: Action): RequestHandler => requirePageAction(page, a);
const pageGuard = (page: string | ((req: Request) => string), a: Action): RequestHandler =>
  typeof page === 'string' ? g(page, a) : (req, res, next) => g(page(req), a)(req, res, next);
const unit = (req: Request): string | null => req.ctx?.unitId ?? null;
const me = (req: Request): string => req.auth!.userId;
const today = (): string => new Date().toISOString().slice(0, 10);

export function createTaxRouter(): Router {
  const router = Router();
  router.use('/tax', authenticate, requirePasswordChanged, resolveContext);
  const ok = (res: Response, data: unknown, status = 200) => res.status(status).json({ data });

  // idempotent money-moving POST (a double click or a retry answers the first result)
  const post = <B extends z.ZodTypeAny>(
    path: string,
    page: string | ((req: Request) => string),
    action: Action,
    scope: string,
    schema: B,
    run: (req: Request, body: z.infer<B>) => Promise<object>,
    params: z.ZodTypeAny = z.object({}).passthrough(),
  ) =>
    router.post(
      path,
      pageGuard(page, action),
      validate({ params, body: schema }),
      h(async (req, res) => {
        const body = validated(res, 'body', schema) as z.infer<B>;
        await runIdempotent(
          req,
          res,
          me(req),
          `${scope}:${unit(req) ?? 'all'}`,
          [path, req.params, body],
          async () => ({ version: 1, ...(await run(req, body)) }) as { version: number } & object,
        );
      }),
    );

  const monthQ = z.object({ month, asOf: ymd.optional() }).strict();

  // ---- GSTR-1 ---------------------------------------------------------------------------------------------------
  router.get(
    '/tax/gstr1',
    g('tax-gstr1', 'view'),
    validate({ query: monthQ }),
    h(async (req, res) => {
      const q = validated(res, 'query', monthQ);
      const r = await returnsService.gstr1(unit(req), q.month);
      const { file: _file, ...rest } = r;
      void _file;
      ok(res, rest);
    }),
  );
  router.get(
    '/tax/gstr1/file',
    g('tax-gstr1', 'view'),
    validate({ query: monthQ }),
    h(async (req, res) => {
      const q = validated(res, 'query', monthQ);
      const r = await returnsService.gstr1(unit(req), q.month);
      if (!r.canPrepare)
        throw Errors.validation({
          month: 'The GSTR-1 still has errors. Fix them, then download the file.',
        });
      res.setHeader('Content-Type', 'application/json');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="GSTR1_${r.gstin}_${q.month.replace('-', '')}.json"`,
      );
      res.send(JSON.stringify(r.file, null, 2));
    }),
  );
  router.get(
    '/tax/gstr3b',
    g('tax-gstr3b', 'view'),
    validate({ query: monthQ }),
    h(async (req, res) => {
      const q = validated(res, 'query', monthQ);
      ok(res, await returnsService.gstr3b(unit(req), q.month, q.asOf));
    }),
  );
  router.get(
    '/tax/returns',
    g('tax-gstr1', 'view'),
    h(async (req, res) => ok(res, await returnsService.list(unit(req)))),
  );
  const fileB = z
    .object({
      type: z.enum(['GSTR1', 'GSTR3B']),
      month,
      arn: z.string().trim().min(8).max(30),
      filedOn: ymd,
    })
    .strict();
  post(
    '/tax/returns/file',
    (req) =>
      (req.body as { type?: string } | undefined)?.type === 'GSTR3B' ? 'tax-gstr3b' : 'tax-gstr1',
    'post',
    'tax-file',
    fileB,
    async (req, b) => {
      return returnsService.markFiled(unit(req), b, me(req));
    },
  );

  // ---- settlement -------------------------------------------------------------------------------------------------
  const setQ = z.object({ month, paidOn: ymd.optional() }).strict();
  router.get(
    '/tax/settlement',
    g('tax-gstr3b', 'view'),
    validate({ query: setQ }),
    h(async (req, res) => {
      const q = validated(res, 'query', setQ);
      ok(res, await settlementService.preview(unit(req), q.month, q.paidOn ?? today()));
    }),
  );
  const setB = z
    .object({
      month,
      paidOn: ymd,
      bankAccountId: uuid,
      challanNo: z.string().trim().min(3).max(40),
    })
    .strict();
  post('/tax/settlement', 'tax-gstr3b', 'post', 'tax-settle', setB, (req, b) =>
    settlementService.post(unit(req), b, { userId: me(req) }),
  );
  const cancelB = z.object({ month, reason: z.string().trim().min(5).max(300) }).strict();
  post('/tax/settlement/cancel', 'tax-gstr3b', 'cancel', 'tax-settle-cancel', cancelB, (req, b) =>
    settlementService.cancel(unit(req), b.month, b.reason, { userId: me(req) }),
  );

  // ---- GSTR-2B and ITC --------------------------------------------------------------------------------------------
  const m1 = z.object({ month }).strict();
  router.get(
    '/tax/gstr2b',
    g('tax-gstr3b', 'view'),
    validate({ query: m1 }),
    h(async (req, res) => {
      ok(res, await gstr2bService.report(unit(req), validated(res, 'query', m1).month));
    }),
  );
  const impB = z
    .object({ month, sourceName: z.string().trim().max(200).optional(), payload: z.unknown() })
    .strict();
  post('/tax/gstr2b/import', 'tax-gstr3b', 'add', 'tax-2b', impB, (req, b) =>
    gstr2bService.import(
      unit(req),
      { month: b.month, ...(b.sourceName ? { sourceName: b.sourceName } : {}), payload: b.payload },
      me(req),
    ),
  );
  router.get(
    '/tax/itc/reversals',
    g('tax-gstr3b', 'view'),
    validate({ query: m1 }),
    h(async (req, res) => {
      ok(res, await gstr2bService.reversals(unit(req), validated(res, 'query', m1).month));
    }),
  );
  const revB = z
    .object({
      kind: z.enum(['R37A', 'S17_5', 'MANUAL']),
      date: ymd,
      cgst: amt.default('0'),
      sgst: amt.default('0'),
      igst: amt.default('0'),
      note: z.string().trim().min(5).max(300),
      invoiceId: uuid.optional(),
    })
    .strict();
  post('/tax/itc/reversals', 'tax-gstr3b', 'add', 'tax-itc-rev', revB, (req, b) =>
    gstr2bService.manualReversal(unit(req), b, { userId: me(req) }),
  );
  router.get(
    '/tax/itc/due-180',
    g('tax-gstr3b', 'view'),
    h(async (req, res) => ok(res, await gstr2bService.due180(unit(req), today()))),
  );

  // ---- e-invoice --------------------------------------------------------------------------------------------------
  router.get(
    '/tax/einvoice/pending',
    g('tax-einvoice', 'view'),
    h(async (req, res) => ok(res, await einvoiceService.pending(unit(req)))),
  );
  router.get(
    '/tax/einvoice/records',
    g('tax-einvoice', 'view'),
    h(async (req, res) => ok(res, await einvoiceService.records(unit(req)))),
  );
  const reqQ = z.object({ docType: z.enum(['INV', 'CRN']), docId: uuid }).strict();
  router.get(
    '/tax/einvoice/request-json',
    g('tax-einvoice', 'view'),
    validate({ query: reqQ }),
    h(async (req, res) => {
      const q = validated(res, 'query', reqQ);
      ok(res, await einvoiceService.requestJson(unit(req), q.docType, q.docId));
    }),
  );
  const einB = z
    .object({
      docType: z.enum(['INV', 'CRN']),
      docId: uuid,
      irn: z.string().trim().length(64),
      ackNo: z.string().trim().min(6).max(20),
      ackDate: z.string().min(10),
      signedQr: z.string().max(5000).optional(),
    })
    .strict();
  post('/tax/einvoice', 'tax-einvoice', 'add', 'tax-einv', einB, (req, b) =>
    einvoiceService.record(unit(req), b, me(req)),
  );
  post(
    '/tax/einvoice/:id/cancel',
    'tax-einvoice',
    'cancel',
    'tax-einv-cancel',
    z.object({ reason: z.string().trim().min(5).max(300) }).strict(),
    (req, b) => einvoiceService.cancel(unit(req), String(req.params.id), b.reason, me(req)),
    idp,
  );

  // ---- e-way bill -------------------------------------------------------------------------------------------------
  router.get(
    '/tax/eway/pending',
    g('tax-eway', 'view'),
    h(async (req, res) => ok(res, await ewayService.pending(unit(req)))),
  );
  router.get(
    '/tax/eway',
    g('tax-eway', 'view'),
    h(async (req, res) => ok(res, await ewayService.list(unit(req)))),
  );
  const ewQ = z
    .object({ invoiceId: uuid, distanceKm: z.coerce.number().int().positive().optional() })
    .strict();
  router.get(
    '/tax/eway/request-json',
    g('tax-eway', 'view'),
    validate({ query: ewQ }),
    h(async (req, res) => {
      const q = validated(res, 'query', ewQ);
      ok(res, await ewayService.requestJson(unit(req), q.invoiceId, q.distanceKm));
    }),
  );
  const ewB = z
    .object({
      invoiceId: uuid,
      ewbNo: z.string().trim().length(12),
      ewbDate: z.string().min(10),
      distanceKm: z.number().int().positive(),
      vehicleNo: z.string().trim().max(20).optional(),
      transporter: z.string().trim().max(120).optional(),
      transporterId: z.string().trim().max(15).optional(),
    })
    .strict();
  post('/tax/eway', 'tax-eway', 'add', 'tax-ewb', ewB, (req, b) =>
    ewayService.record(unit(req), b, me(req)),
  );
  post(
    '/tax/eway/:id/extend',
    'tax-eway',
    'edit',
    'tax-ewb-ext',
    z
      .object({
        remainingKm: z.number().int().positive(),
        reason: z.string().trim().min(5).max(300),
      })
      .strict(),
    (req, b) => ewayService.extend(unit(req), String(req.params.id), b, me(req)),
    idp,
  );
  post(
    '/tax/eway/:id/cancel',
    'tax-eway',
    'cancel',
    'tax-ewb-cancel',
    z.object({ reason: z.string().trim().min(5).max(300) }).strict(),
    (req, b) => ewayService.cancel(unit(req), String(req.params.id), b.reason, me(req)),
    idp,
  );

  // ---- TDS / TCS --------------------------------------------------------------------------------------------------
  const kindQ = z.enum(['TDS', 'TCS']);
  const sumQ = z
    .object({
      kind: kindQ.default('TDS'),
      from: ymd,
      to: ymd,
      by: z.enum(['deductee', 'section', 'quarter']).default('deductee'),
    })
    .strict();
  router.get(
    '/tax/tds/summary',
    g('tax-tds', 'view'),
    validate({ query: sumQ }),
    h(async (req, res) => {
      const q = validated(res, 'query', sumQ);
      ok(res, await tdsReports.summary({ unitId: unit(req), ...q }));
    }),
  );
  const retQ = z
    .object({
      kind: kindQ.default('TDS'),
      fy: z.coerce.number().int().min(2017).max(2100),
      quarter: z.coerce.number().int().min(1).max(4),
      asOf: ymd.optional(),
    })
    .strict();
  router.get(
    '/tax/tds/return',
    g('tax-tds', 'view'),
    validate({ query: retQ }),
    h(async (req, res) => {
      const q = validated(res, 'query', retQ);
      ok(
        res,
        await tdsReports.returnData({
          unitId: unit(req),
          kind: q.kind,
          fyStart: q.fy,
          quarter: q.quarter as 1 | 2 | 3 | 4,
          asOf: q.asOf ?? today(),
        }),
      );
    }),
  );
  router.get(
    '/tax/tds/challan-map',
    g('tax-tds', 'view'),
    validate({ query: z.object({ kind: kindQ.default('TDS') }).strict() }),
    h(async (req, res) => {
      ok(res, await tdsReports.challanMap(unit(req), (req.query.kind as 'TDS' | 'TCS') ?? 'TDS'));
    }),
  );
  router.get(
    '/tax/tds/ldc',
    g('tax-tds', 'view'),
    h(async (_req, res) => ok(res, await tdsReports.certs())),
  );
  const ldcB = z
    .object({
      supplierId: uuid,
      sectionCode: z.string().trim().min(2).max(12),
      certNo: z.string().trim().min(3).max(40),
      ratePct: amt,
      validFrom: ymd,
      validTo: ymd,
      maxAmount: amt.optional(),
    })
    .strict();
  post('/tax/tds/ldc', 'tax-tds', 'add', 'tax-ldc', ldcB, (req, b) =>
    tdsReports.addCert(b, me(req)),
  );
  router.delete(
    '/tax/tds/ldc/:id',
    g('tax-tds', 'delete'),
    validate({ params: idp }),
    h(async (req, res) => {
      ok(res, await tdsReports.deleteCert(String(req.params.id), me(req)));
    }),
  );

  // ---- statutory rules as data (R-11) ---------------------------------------------------------------------------
  router.get(
    '/tax/rules',
    g('tax-gst', 'view'),
    h(async (_req, res) => ok(res, await tdsReports.rules())),
  );
  const ruleB = z
    .object({
      valueNum: amt.nullish(),
      valueText: z.string().trim().max(200).nullish(),
      needsReview: z.boolean().optional(),
    })
    .strict();
  router.patch(
    '/tax/rules/:id',
    g('tax-gst', 'edit'),
    validate({ params: idp, body: ruleB }),
    h(async (req, res) => {
      ok(
        res,
        await tdsReports.updateRule(String(req.params.id), validated(res, 'body', ruleB), me(req)),
      );
    }),
  );

  // ---- register exports -------------------------------------------------------------------------------------------
  const expQ = z.object({ from: ymd, to: ymd }).strict();
  for (const [kind, page] of [
    ['sales', 'tax-salesreg'],
    ['purchase', 'tax-purchasereg'],
    ['tds', 'tax-tds'],
    ['tcs', 'tax-tcs'],
  ] as const) {
    router.get(
      `/tax/registers/${kind}/export.xlsx`,
      g(page, 'view'),
      validate({ query: expQ }),
      h(async (req, res) => {
        const q = validated(res, 'query', expQ);
        const buf = await registerWorkbook(kind, { from: q.from, to: q.to, unitId: unit(req) });
        res.setHeader(
          'Content-Type',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        );
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="${kind}-register_${q.from}_${q.to}.xlsx"`,
        );
        res.send(buf);
      }),
    );
  }
  return router;
}
