// Phase 7 API: /api/v1/finance/... (docs/phases/PHASE-07.md; 05c §7.3). Every route: authenticate ->
// requirePasswordChanged -> resolveContext -> requirePageAction(page, action) -> validate(zod) -> handler.
// Money crosses the wire as decimal strings. Posting endpoints honour Idempotency-Key.
import { Router } from 'express';
import type { Request, RequestHandler, Response } from 'express';
import { z } from 'zod';
import { requestMeta, requireAuth } from '../../core/auth/auth-context';
import { authenticate, requirePasswordChanged } from '../../core/auth/authenticate';
import {
  assertUnitChoice,
  requireConcreteUnit,
  resolveContext,
} from '../../core/context/resolve-context';
import { prisma } from '../../core/db/prisma';
import { recordAudit } from '../../core/audit/audit-service';
import { asyncHandler } from '../../core/http/async-handler';
import { Errors } from '../../core/http/errors';
import { parseIfMatch } from '../../core/http/if-match';
import { validate, validated } from '../../core/http/validate';
import { accessUserOf, can, requirePageAction } from '../../core/rbac/access';
import { runIdempotent } from '../approvals/idempotent';
import { accountsService, costCentersService, profitCentersService } from './accounts-service';
import type { Actor } from './accounts-service';
import { budgetService } from './budget-service';
import { cashBankService } from './cash-bank-service';
import { closeService } from './close-service';
import { expenseService } from './expense-service';
import { fxService } from './fx-service';
import { limitsService } from './limits-service';
import { notesApproval, notesService } from './notes-service';
import { recurringService } from './recurring-service';
import { taxService } from './tax-service';
import { isoDate, money } from './money';
import { openItemService } from './open-items-service';
import { PostingService } from './posting-service';
import { recoService } from './reco-service';
import { reportsService } from './reports-service';
import { journalService, MANUAL_VOUCHER_TYPES } from './journal-service';

const uuid = z.string().uuid('Invalid id.');
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-11-30.');
const moneyStr = z
  .union([z.string().regex(/^-?\d+(\.\d+)?$/, 'Enter an amount like 1234.50.'), z.number()])
  .transform((v) => String(v));
const idParams = z.object({ id: uuid }).strict();
const pageQuery = {
  page: z.coerce.number().int().min(1).max(100000).default(1),
  size: z.coerce.number().int().min(1).max(200).default(20),
};

const actorOf = (req: Request): Actor => ({
  userId: requireAuth(req).userId,
  meta: requestMeta(req),
});
const callerOf = (req: Request) => ({ auth: requireAuth(req), meta: requestMeta(req) });
const ctxUnit = (req: Request): string | null => req.ctx?.unitId ?? null;
const meta = (total: number, page: number, size: number) => ({ page, size, total });

/** Body unit must be one the caller may work in. */
async function unitFromBody(req: Request, unitId: string): Promise<string> {
  const user = requireAuth(req).user;
  await assertUnitChoice(
    { id: user.id, role: user.role, defaultUnitId: user.defaultUnitId },
    unitId,
  );
  return unitId;
}

/** A second permission check that depends on the request (cash vs bank, receivable vs payable). */
function alsoCan(pick: (req: Request) => [string, Parameters<typeof can>[2]]): RequestHandler {
  return asyncHandler(async (req, _res, next) => {
    const [page, action] = pick(req);
    if (!(await can(accessUserOf(requireAuth(req)), page, action))) throw Errors.forbidden();
    next();
  });
}

export function createFinanceRouter(): Router {
  const router = Router();
  router.use(['/finance'], authenticate, requirePasswordChanged);
  const r = Router();
  r.use(resolveContext);
  router.use('/finance', r);

  // ===== chart of accounts ============================================================================
  const accountBody = z
    .object({
      code: z.string().regex(/^[0-9]{4,8}$/, 'Use 4 to 8 digits.'),
      name: z.string().trim().min(2).max(120),
      parentId: uuid.nullish(),
      isGroup: z.boolean().optional(),
      rootType: z.enum(['Asset', 'Liability', 'Equity', 'Income', 'Expense']).optional(),
      subType: z.string().max(30).optional(),
      postingAllowed: z.boolean().optional(),
      costCenterRequired: z.boolean().optional(),
      partyRequired: z.boolean().optional(),
      controlSide: z.enum(['RECEIVABLE', 'PAYABLE']).nullish(),
      cfClass: z.string().max(12).optional(),
    })
    .strict();
  r.get(
    '/accounts',
    requirePageAction('fin-coa', 'view'),
    validate({
      query: z
        .object({
          q: z.string().max(60).optional(),
          status: z.enum(['Active', 'Inactive']).optional(),
          rootType: z.string().max(12).optional(),
          postable: z.coerce.boolean().optional(),
          ...pageQuery,
        })
        .strict(),
    }),
    asyncHandler(async (_req, res) => {
      const q = validated(
        res,
        'query',
        z.object({
          q: z.string().optional(),
          status: z.string().optional(),
          rootType: z.string().optional(),
          postable: z.boolean().optional(),
          page: z.number(),
          size: z.number(),
        }),
      );
      const { rows, total } = await accountsService.list(q);
      res.json({ data: rows, meta: meta(total, q.page, q.size) });
    }),
  );
  r.get(
    '/accounts/:id',
    requirePageAction('fin-coa', 'view'),
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      const a = await accountsService.get(String(req.params.id));
      res.set('ETag', `"${a.version}"`).json({ data: a });
    }),
  );
  r.post(
    '/accounts',
    requirePageAction('fin-coa', 'add'),
    validate({ body: accountBody }),
    asyncHandler(async (req, res) => {
      const a = await accountsService.create(validated(res, 'body', accountBody), actorOf(req));
      res.status(201).set('ETag', `"${a.version}"`).json({ data: a });
    }),
  );
  const accountPatch = accountBody
    .partial()
    .extend({ status: z.enum(['Active', 'Inactive']).optional() })
    .strict();
  r.patch(
    '/accounts/:id',
    requirePageAction('fin-coa', 'edit'),
    validate({ params: idParams, body: accountPatch }),
    asyncHandler(async (req, res) => {
      const a = await accountsService.update(
        String(req.params.id),
        parseIfMatch(req.get('if-match')),
        validated(res, 'body', accountPatch),
        actorOf(req),
      );
      res.set('ETag', `"${a.version}"`).json({ data: a });
    }),
  );
  r.delete(
    '/accounts/:id',
    requirePageAction('fin-coa', 'delete'),
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      await accountsService.remove(String(req.params.id), actorOf(req));
      res.status(204).end();
    }),
  );
  r.get(
    '/account-defaults',
    requirePageAction('fin-coa', 'view'),
    asyncHandler(async (_req, res) => {
      res.json({ data: await accountsService.defaults() });
    }),
  );
  const defaultBody = z.object({ accountId: uuid }).strict();
  r.put(
    '/account-defaults/:key',
    requirePageAction('fin-coa', 'edit'),
    validate({
      params: z.object({ key: z.string().regex(/^[A-Z0-9_]{2,40}$/) }),
      body: defaultBody,
    }),
    asyncHandler(async (req, res) => {
      res.json({
        data: await accountsService.setDefault(
          String(req.params.key),
          validated(res, 'body', defaultBody).accountId,
          actorOf(req),
        ),
      });
    }),
  );

  // ---- posting rules (MAP) -----------------------------------------------------------------------------
  r.get(
    '/posting-rules',
    requirePageAction('fin-coa', 'view'),
    asyncHandler(async (_req, res) => {
      const rules = await prisma.postingRule.findMany({
        orderBy: [{ lineKey: 'asc' }, { seq: 'asc' }],
      });
      res.json({ data: rules });
    }),
  );
  const ruleBody = z
    .object({
      accountSelector: z.enum(['FIXED_CODE', 'DEFAULT_KEY', 'PAYLOAD_BANK_ACCOUNT']),
      accountRef: z.string().max(120),
      isActive: z.boolean().optional(),
    })
    .strict();
  r.put(
    '/posting-rules/:id',
    requirePageAction('fin-coa', 'edit'),
    validate({ params: idParams, body: ruleBody }),
    asyncHandler(async (req, res) => {
      const b = validated(res, 'body', ruleBody);
      const id = String(req.params.id);
      const version = parseIfMatch(req.get('if-match'));
      if (
        b.accountSelector === 'FIXED_CODE' &&
        !(await prisma.account.findFirst({
          where: { code: b.accountRef, deletedAt: null, isGroup: false, status: 'Active' },
        }))
      ) {
        throw Errors.validation({ accountRef: 'No active ledger account has this code.' });
      }
      if (
        b.accountSelector === 'DEFAULT_KEY' &&
        !(await prisma.accountDefault.findUnique({ where: { key: b.accountRef } }))
      ) {
        throw Errors.validation({ accountRef: 'No default account has this key.' });
      }
      const n = await prisma.postingRule.updateMany({
        where: { id, version },
        data: {
          ...b,
          version: { increment: 1 },
          updatedById: requireAuth(req).userId,
          updatedAt: new Date(),
        },
      });
      if (n.count !== 1) throw Errors.versionConflict();
      await recordAudit({
        action: 'RULES_CHANGED',
        actorId: requireAuth(req).userId,
        targetType: 'PostingRule',
        targetId: id,
        meta: requestMeta(req),
        detail: { accountRef: b.accountRef },
      });
      res.json({ data: await prisma.postingRule.findUniqueOrThrow({ where: { id } }) });
    }),
  );

  // ===== cost / profit centres =========================================================================
  const ccBody = z
    .object({
      code: z.string().regex(/^[A-Z0-9-]{2,20}$/, 'Use 2-20 capital letters, digits or dashes.'),
      name: z.string().trim().min(2).max(120),
      parentId: uuid.nullish(),
      unitId: uuid.nullish(),
      department: z.string().max(60).nullish(),
      managerId: uuid.nullish(),
      isGroup: z.boolean().optional(),
    })
    .strict();
  const listQ = z
    .object({
      q: z.string().max(60).optional(),
      status: z.enum(['Active', 'Inactive']).optional(),
      ...pageQuery,
    })
    .strict();
  r.get(
    '/cost-centers',
    requirePageAction('fin-costcenter', 'view'),
    validate({ query: listQ }),
    asyncHandler(async (req, res) => {
      const q = validated(res, 'query', listQ);
      const { rows, total } = await costCentersService.list({ ...q, unitId: ctxUnit(req) });
      res.json({ data: rows, meta: meta(total, q.page, q.size) });
    }),
  );
  r.post(
    '/cost-centers',
    requirePageAction('fin-costcenter', 'add'),
    validate({ body: ccBody }),
    asyncHandler(async (req, res) => {
      res.status(201).json({
        data: await costCentersService.create(validated(res, 'body', ccBody), actorOf(req)),
      });
    }),
  );
  const ccPatch = ccBody
    .omit({ code: true, unitId: true, isGroup: true })
    .partial()
    .extend({ status: z.enum(['Active', 'Inactive']).optional() })
    .strict();
  r.patch(
    '/cost-centers/:id',
    requirePageAction('fin-costcenter', 'edit'),
    validate({ params: idParams, body: ccPatch }),
    asyncHandler(async (req, res) => {
      const c = await costCentersService.update(
        String(req.params.id),
        parseIfMatch(req.get('if-match')),
        validated(res, 'body', ccPatch),
        actorOf(req),
      );
      res.set('ETag', `"${c.version}"`).json({ data: c });
    }),
  );
  r.delete(
    '/cost-centers/:id',
    requirePageAction('fin-costcenter', 'delete'),
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      await costCentersService.remove(String(req.params.id), actorOf(req));
      res.status(204).end();
    }),
  );

  const pcBody = z
    .object({
      code: z.string().regex(/^[A-Z0-9-]{2,20}$/, 'Use 2-20 capital letters, digits or dashes.'),
      name: z.string().trim().min(2).max(120),
      unitId: uuid,
      managerId: uuid.nullish(),
      isDefault: z.boolean().optional(),
    })
    .strict();
  r.get(
    '/profit-centers',
    requirePageAction('fin-profitcenter', 'view'),
    validate({ query: listQ }),
    asyncHandler(async (req, res) => {
      const q = validated(res, 'query', listQ);
      const { rows, total } = await profitCentersService.list({ ...q, unitId: ctxUnit(req) });
      res.json({ data: rows, meta: meta(total, q.page, q.size) });
    }),
  );
  r.post(
    '/profit-centers',
    requirePageAction('fin-profitcenter', 'add'),
    validate({ body: pcBody }),
    asyncHandler(async (req, res) => {
      const b = validated(res, 'body', pcBody);
      await unitFromBody(req, b.unitId);
      res.status(201).json({ data: await profitCentersService.create(b, actorOf(req)) });
    }),
  );
  const pcPatch = pcBody
    .omit({ code: true, unitId: true })
    .partial()
    .extend({ status: z.enum(['Active', 'Inactive']).optional() })
    .strict();
  r.patch(
    '/profit-centers/:id',
    requirePageAction('fin-profitcenter', 'edit'),
    validate({ params: idParams, body: pcPatch }),
    asyncHandler(async (req, res) => {
      const c = await profitCentersService.update(
        String(req.params.id),
        parseIfMatch(req.get('if-match')),
        validated(res, 'body', pcPatch),
        actorOf(req),
      );
      res.set('ETag', `"${c.version}"`).json({ data: c });
    }),
  );
  r.delete(
    '/profit-centers/:id',
    requirePageAction('fin-profitcenter', 'delete'),
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      await profitCentersService.remove(String(req.params.id), actorOf(req));
      res.status(204).end();
    }),
  );

  // ===== journals =====================================================================================
  const lineSchema = z
    .object({
      accountId: uuid,
      debit: moneyStr.default('0'),
      credit: moneyStr.default('0'),
      unitId: uuid.optional(),
      partyId: uuid.optional(),
      costCenterId: uuid.optional(),
      profitCenterId: uuid.optional(),
      narration: z.string().max(300).optional(),
      billDocNo: z.string().max(60).optional(),
      billDocDate: date.optional(),
      billDueDate: date.optional(),
      currencyCode: z.string().length(3).optional(),
      amountFc: moneyStr.optional(),
      fxRate: z
        .string()
        .regex(/^\d+(\.\d{1,6})?$/, 'Enter a rate like 83.2000.')
        .optional(),
      side: z.enum(['DR', 'CR']).optional(),
    })
    .strict();
  const journalBody = z
    .object({
      unitId: uuid,
      docDate: date,
      voucherType: z.enum(MANUAL_VOUCHER_TYPES).default('Journal'),
      narration: z.string().max(1000).optional(),
      referenceNo: z.string().max(60).optional(),
      supportingDoc: z.string().max(200).optional(),
      autoReverseOn: date.optional(),
      lines: z.array(lineSchema).min(1).max(200),
    })
    .strict();
  const journalQuery = z
    .object({
      q: z.string().max(60).optional(),
      status: z.enum(['Draft', 'Posted', 'Cancelled']).optional(),
      postingStatus: z.string().max(20).optional(),
      from: date.optional(),
      to: date.optional(),
      sort: z.enum(['date', '-date']).optional(),
      ...pageQuery,
    })
    .strict();
  r.get(
    '/journals',
    requirePageAction('fin-journal', 'view'),
    validate({ query: journalQuery }),
    asyncHandler(async (req, res) => {
      const q = validated(res, 'query', journalQuery);
      const { rows, total } = await journalService.list({ ...q, unitId: ctxUnit(req) });
      res.json({ data: rows, meta: meta(total, q.page, q.size) });
    }),
  );
  r.get(
    '/journals/:id',
    requirePageAction('fin-journal', 'view'),
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      const j = await journalService.get(String(req.params.id), ctxUnit(req));
      res.set('ETag', `"${j.version}"`).json({ data: j });
    }),
  );
  r.post(
    '/journals',
    requirePageAction('fin-journal', 'add'),
    validate({ body: journalBody }),
    asyncHandler(async (req, res) => {
      const b = validated(res, 'body', journalBody);
      await unitFromBody(req, b.unitId);
      const j = await journalService.createDraft(b, actorOf(req));
      res.status(201).set('ETag', `"${j.version}"`).json({ data: j });
    }),
  );
  r.patch(
    '/journals/:id',
    requirePageAction('fin-journal', 'edit'),
    validate({ params: idParams, body: journalBody.partial() }),
    asyncHandler(async (req, res) => {
      const j = await journalService.updateDraft(
        String(req.params.id),
        parseIfMatch(req.get('if-match')),
        validated(res, 'body', journalBody.partial()),
        actorOf(req),
      );
      res.set('ETag', `"${j.version}"`).json({ data: j });
    }),
  );
  r.delete(
    '/journals/:id',
    requirePageAction('fin-journal', 'delete'),
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      await journalService.deleteDraft(String(req.params.id), actorOf(req));
      res.status(204).end();
    }),
  );
  r.post(
    '/journals/:id/submit',
    requirePageAction('fin-journal', 'submit'),
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      const id = String(req.params.id);
      const version = parseIfMatch(req.get('if-match'));
      await runIdempotent(
        req,
        res,
        requireAuth(req).userId,
        `finance:submit:${id}`,
        [id, version],
        async () => {
          const out = await journalService.submit(callerOf(req), id, version);
          const j = await journalService.get(id);
          return {
            ...j,
            needsApproval: out.needsApproval,
            approval: out.needsApproval ? out.approval : null,
          };
        },
      );
    }),
  );
  const postBody = z
    .object({
      overrideBudget: z
        .object({ reason: z.string().trim().min(5).max(300) })
        .strict()
        .optional(),
    })
    .strict();
  r.post(
    '/journals/:id/post',
    requirePageAction('fin-journal', 'post'),
    validate({ params: idParams, body: postBody }),
    asyncHandler(async (req, res) => {
      const id = String(req.params.id);
      const version = parseIfMatch(req.get('if-match'));
      const pb = validated(res, 'body', postBody);
      if (pb.overrideBudget && !(await can(accessUserOf(requireAuth(req)), 'fin-budget', 'delete')))
        throw Errors.forbidden('You cannot override a budget.');
      await runIdempotent(
        req,
        res,
        requireAuth(req).userId,
        `finance:post:${id}`,
        [id, version, pb],
        async () => {
          const posted = await journalService.post(
            id,
            version,
            actorOf(req),
            pb.overrideBudget ? { overrideBudget: pb.overrideBudget } : {},
          );
          const row = await prisma.journal.findUniqueOrThrow({
            where: { id },
            select: { version: true },
          });
          return { ...posted, version: row.version };
        },
      );
    }),
  );
  const reverseBody = z
    .object({
      reason: z.string().trim().min(5, 'Enter 5 to 300 characters.').max(300),
      reversalDate: date.optional(),
    })
    .strict();
  r.post(
    '/journals/:id/reverse',
    requirePageAction('fin-journal', 'cancel'),
    validate({ params: idParams, body: reverseBody }),
    asyncHandler(async (req, res) => {
      const id = String(req.params.id);
      const b = validated(res, 'body', reverseBody);
      await runIdempotent(
        req,
        res,
        requireAuth(req).userId,
        `finance:reverse:${id}`,
        [id, b.reason, b.reversalDate ?? ''],
        async () => {
          const rev = await journalService.reverse(
            id,
            b.reason,
            actorOf(req),
            b.reversalDate ? { reversalDate: b.reversalDate } : {},
          );
          return { ...rev, version: 1 };
        },
      );
    }),
  );

  // ---- integration: post a producer event through the posting rules (idempotent) -----------------------
  const eventBody = z
    .object({
      event: z.string().max(60),
      docType: z.string().max(60),
      docId: uuid,
      docDate: date,
      unitId: uuid,
      voucherType: z.string().max(30).default('Other'),
      payload: z
        .object({
          docNo: z.string().max(60).optional(),
          dueDate: date.optional(),
          partyId: uuid.optional(),
          partyType: z.string().optional(),
          isImport: z.boolean().optional(),
          invoiceType: z.string().optional(),
          dispatchType: z.string().optional(),
          paymentMode: z.string().optional(),
          bankAccountId: uuid.optional(),
          reverses: z.string().optional(),
          reason: z.string().max(300).optional(),
          tax: z
            .object({
              direction: z.enum(['OUTWARD', 'INWARD']),
              docKind: z.enum(['INV', 'CRN', 'DBN']),
              partyName: z.string().max(150),
              partyGstin: z.string().max(15).optional(),
              partyStateCode: z.string().length(2).optional(),
              placeOfSupplyStateCode: z.string().length(2),
              reverseCharge: z.boolean().optional(),
              lines: z
                .array(
                  z
                    .object({
                      hsn: z.string().max(8),
                      uqc: z.string().max(10).optional(),
                      qty: moneyStr.optional(),
                      taxable: moneyStr,
                      rate: z.string().max(10),
                      cgst: moneyStr,
                      sgst: moneyStr,
                      igst: moneyStr,
                      cess: moneyStr,
                    })
                    .strict(),
                )
                .min(1)
                .max(500),
            })
            .strict()
            .optional(),
          tds: z
            .object({
              sectionCode: z.string().max(10),
              baseAmount: moneyStr,
              ratePct: z.string().max(10),
              tdsAmount: moneyStr,
              kind: z.enum(['TDS', 'TCS']).optional(),
            })
            .strict()
            .optional(),
          lines: z
            .array(
              z
                .object({
                  account: z.string().max(40),
                  debit: moneyStr.default('0'),
                  credit: moneyStr.default('0'),
                  partyId: uuid.optional(),
                  partyType: z.enum(['CUSTOMER', 'SUPPLIER']).optional(),
                  itemType: z.string().optional(),
                  unitId: uuid.optional(),
                  costCenter: z.string().optional(),
                  narration: z.string().max(300).optional(),
                })
                .strict(),
            )
            .min(2),
        })
        .strict(),
    })
    .strict();
  r.post(
    '/events',
    requirePageAction('fin-journal', 'post'),
    validate({ body: eventBody }),
    asyncHandler(async (req, res) => {
      const b = validated(res, 'body', eventBody);
      await unitFromBody(req, b.unitId);
      const actor = actorOf(req);
      const out = await prisma.$transaction(
        async (tx) => {
          if (b.event.endsWith('_CANCELLED')) {
            const orig = b.event.replace(/_CANCELLED$/, '_POSTED');
            const rev = await PostingService.reverseBySource(
              tx,
              orig,
              b.docType,
              b.docId,
              b.payload.reason ?? 'Cancelled by the producing document',
              actor,
            );
            return rev ?? { id: null, replayed: true };
          }
          return PostingService.postJournal(
            tx,
            {
              unitId: b.unitId,
              docDate: b.docDate,
              voucherType: b.voucherType as never,
              source: 'EVENT',
              event: b.event,
              sourceDocType: b.docType,
              sourceDocId: b.docId,
              ...(b.payload.docNo ? { sourceDocNo: b.payload.docNo } : {}),
              payload: b.payload as never,
            },
            actor,
          );
        },
        { maxWait: 15_000, timeout: 30_000 },
      );
      res.status(200).json({ data: out });
    }),
  );

  // ===== open items / ageing ===================================================================================
  const sideGuard = alsoCan((req) => [
    String(req.query.side ?? req.params.side) === 'PAYABLE' ? 'fin-ap' : 'fin-ar',
    'view',
  ]);
  const itemsQ = z
    .object({
      side: z.enum(['RECEIVABLE', 'PAYABLE']),
      partyId: uuid.optional(),
      status: z.string().max(12).optional(),
      ...pageQuery,
    })
    .strict();
  r.get(
    '/open-items',
    sideGuard,
    validate({ query: itemsQ }),
    asyncHandler(async (req, res) => {
      const q = validated(res, 'query', itemsQ);
      const { rows, total } = await openItemService.list({ ...q, unitId: ctxUnit(req) });
      res.json({ data: rows, meta: meta(total, q.page, q.size) });
    }),
  );
  r.get(
    '/open-items/bills',
    requirePageAction('fin-ap', 'view'),
    validate({
      query: z
        .object({ side: z.enum(['RECEIVABLE', 'PAYABLE']).default('PAYABLE'), partyId: uuid })
        .strict(),
    }),
    asyncHandler(async (req, res) => {
      const q = validated(
        res,
        'query',
        z.object({ side: z.enum(['RECEIVABLE', 'PAYABLE']), partyId: z.string() }),
      );
      res.json({ data: await openItemService.openBills(prisma, q.side, q.partyId, ctxUnit(req)) });
    }),
  );
  const holdBody = z
    .object({
      status: z.enum(['Open', 'Blocked', 'Disputed']),
      reason: z.string().max(200).nullish(),
    })
    .strict();
  r.post(
    '/open-items/:id/hold',
    requirePageAction('fin-ap', 'edit'),
    validate({ params: idParams, body: holdBody }),
    asyncHandler(async (req, res) => {
      const b = validated(res, 'body', holdBody);
      res.json({
        data: await openItemService.setHold(
          String(req.params.id),
          b.status,
          b.reason ?? null,
          actorOf(req),
        ),
      });
    }),
  );
  const ageingQ = z
    .object({
      side: z.enum(['RECEIVABLE', 'PAYABLE']),
      asOf: date.default(() => isoDate(new Date())),
    })
    .strict();
  r.get(
    '/reports/ageing',
    requirePageAction('fin-ageing', 'view'),
    validate({ query: ageingQ }),
    asyncHandler(async (req, res) => {
      const q = validated(res, 'query', ageingQ);
      res.json({ data: await reportsService.ageing(q.side, q.asOf, { unitId: ctxUnit(req) }) });
    }),
  );

  // ===== cash / bank / payments ==========================================================================
  const bankBody = z
    .object({
      unitId: uuid,
      accountId: uuid,
      kind: z.enum(['BANK', 'CASH', 'PETTY']),
      name: z.string().trim().min(2).max(120),
      bankName: z.string().max(120).nullish(),
      accountLast4: z
        .string()
        .regex(/^\d{4}$/, 'Last 4 digits only.')
        .nullish(),
      ifsc: z
        .string()
        .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Use an IFSC like HDFC0001234.')
        .nullish(),
    })
    .strict();
  r.get(
    '/bank-accounts',
    requirePageAction('fin-bankbook', 'view'),
    asyncHandler(async (req, res) => {
      res.json({ data: await cashBankService.listBankAccounts({ unitId: ctxUnit(req) }) });
    }),
  );
  r.post(
    '/bank-accounts',
    requirePageAction('fin-bankbook', 'add'),
    validate({ body: bankBody }),
    asyncHandler(async (req, res) => {
      const b = validated(res, 'body', bankBody);
      await unitFromBody(req, b.unitId);
      res.status(201).json({ data: await cashBankService.createBankAccount(b, actorOf(req)) });
    }),
  );
  const bankPatch = z
    .object({
      name: z.string().trim().min(2).max(120).optional(),
      bankName: z.string().max(120).nullish(),
      status: z.enum(['Active', 'Inactive']).optional(),
    })
    .strict();
  r.patch(
    '/bank-accounts/:id',
    requirePageAction('fin-bankbook', 'edit'),
    validate({ params: idParams, body: bankPatch }),
    asyncHandler(async (req, res) => {
      const b = validated(res, 'body', bankPatch);
      res.json({
        data: await cashBankService.updateBankAccount(
          String(req.params.id),
          parseIfMatch(req.get('if-match')),
          { ...b, bankName: b.bankName ?? null },
          actorOf(req),
        ),
      });
    }),
  );

  const paymentBody = z
    .object({
      kind: z.enum(['PAYMENT', 'RECEIPT', 'TRANSFER']),
      docDate: date,
      bankAccountId: uuid,
      supplierId: uuid.optional(),
      counterAccountId: uuid.optional(),
      toBankAccountId: uuid.optional(),
      amount: moneyStr,
      mode: z.enum(['NEFT', 'RTGS', 'IMPS', 'UPI', 'Cheque', 'Cash']),
      referenceNo: z.string().max(60).optional(),
      narration: z.string().max(300).optional(),
      allocations: z
        .array(z.object({ itemId: uuid, amount: moneyStr }).strict())
        .max(100)
        .optional(),
      allowAdvance: z.boolean().optional(),
    })
    .strict();
  const payQ = z
    .object({
      kind: z.enum(['PAYMENT', 'RECEIPT', 'TRANSFER']).optional(),
      status: z.enum(['Posted', 'Cancelled']).optional(),
      bankAccountId: uuid.optional(),
      from: date.optional(),
      to: date.optional(),
      ...pageQuery,
    })
    .strict();
  r.get(
    '/payments',
    requirePageAction('fin-bankbook', 'view'),
    validate({ query: payQ }),
    asyncHandler(async (req, res) => {
      const q = validated(res, 'query', payQ);
      const { rows, total } = await cashBankService.listPayments({ ...q, unitId: ctxUnit(req) });
      res.json({ data: rows, meta: meta(total, q.page, q.size) });
    }),
  );
  r.get(
    '/payments/:id',
    requirePageAction('fin-bankbook', 'view'),
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      res.json({ data: await cashBankService.getPayment(String(req.params.id)) });
    }),
  );
  const cashGuard = alsoCan((req) => [
    (req.body as { mode?: string } | undefined)?.mode === 'Cash' ? 'fin-cashbook' : 'fin-bankbook',
    'add',
  ]);
  r.post(
    '/payments',
    requirePageAction('fin-bankbook', 'add'),
    cashGuard,
    validate({ body: paymentBody }),
    asyncHandler(async (req, res) => {
      const b = validated(res, 'body', paymentBody);
      const bank = await prisma.bankAccount.findFirst({
        where: { id: b.bankAccountId, deletedAt: null },
      });
      if (!bank) throw Errors.validation({ bankAccountId: 'Choose a cash or bank account.' });
      await unitFromBody(req, bank.unitId);
      await runIdempotent(req, res, requireAuth(req).userId, 'finance:payment', [b], async () => {
        const out = await cashBankService.createPayment(b as never, actorOf(req));
        return {
          ...out.payment,
          amount: money(out.payment.amount),
          docDate: isoDate(out.payment.docDate),
          warnings: out.journal.warnings,
        };
      });
    }),
  );
  const cancelBody = z
    .object({ reason: z.string().trim().min(5, 'Enter 5 to 300 characters.').max(300) })
    .strict();
  r.post(
    '/payments/:id/cancel',
    requirePageAction('fin-bankbook', 'cancel'),
    validate({ params: idParams, body: cancelBody }),
    asyncHandler(async (req, res) => {
      const id = String(req.params.id);
      const version = parseIfMatch(req.get('if-match'));
      const b = validated(res, 'body', cancelBody);
      await runIdempotent(
        req,
        res,
        requireAuth(req).userId,
        `finance:payment-cancel:${id}`,
        [id, version, b.reason],
        async () => {
          const p = await cashBankService.cancelPayment(id, version, b.reason, actorOf(req));
          return { ...p, amount: money(p.amount), docDate: isoDate(p.docDate) };
        },
      );
    }),
  );
  const bookQ = z.object({ from: date, to: date }).strict();
  r.get(
    '/books/:id',
    requirePageAction('fin-bankbook', 'view'),
    validate({ params: idParams, query: bookQ }),
    asyncHandler(async (req, res) => {
      const q = validated(res, 'query', bookQ);
      const bank = await prisma.bankAccount.findFirst({
        where: { id: String(req.params.id), deletedAt: null },
      });
      if (!bank) throw Errors.notFound('Cash / bank account not found.');
      if (
        !(await can(
          accessUserOf(requireAuth(req)),
          bank.kind === 'BANK' ? 'fin-bankbook' : 'fin-cashbook',
          'view',
        ))
      )
        throw Errors.forbidden();
      res.json({ data: await cashBankService.book(bank.id, q.from, q.to) });
    }),
  );

  // ===== bank reconciliation =============================================================================
  const stmtBody = z
    .object({
      bankAccountId: uuid,
      periodFrom: date,
      periodTo: date,
      openingBalance: moneyStr,
      closingBalance: moneyStr,
      lines: z
        .array(
          z
            .object({
              txnDate: date,
              description: z.string().max(300).optional(),
              refNo: z.string().max(60).optional(),
              withdrawal: moneyStr.optional(),
              deposit: moneyStr.optional(),
            })
            .strict(),
        )
        .min(1)
        .max(5000),
    })
    .strict();
  r.get(
    '/bank-statements',
    requirePageAction('fin-bankreco', 'view'),
    validate({
      query: z
        .object({
          bankAccountId: uuid.optional(),
          status: z.enum(['Open', 'Reconciled']).optional(),
          ...pageQuery,
        })
        .strict(),
    }),
    asyncHandler(async (_req, res) => {
      const q = validated(
        res,
        'query',
        z.object({
          bankAccountId: z.string().optional(),
          status: z.string().optional(),
          page: z.number(),
          size: z.number(),
        }),
      );
      const { rows, total } = await recoService.list(q);
      res.json({ data: rows, meta: meta(total, q.page, q.size) });
    }),
  );
  r.post(
    '/bank-statements',
    requirePageAction('fin-bankreco', 'add'),
    validate({ body: stmtBody }),
    asyncHandler(async (req, res) => {
      res.status(201).json({
        data: await recoService.importStatement(validated(res, 'body', stmtBody), actorOf(req)),
      });
    }),
  );
  r.get(
    '/bank-statements/:id',
    requirePageAction('fin-bankreco', 'view'),
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      res.json({ data: await recoService.get(String(req.params.id)) });
    }),
  );
  r.get(
    '/bank-statements/:id/suggestions',
    requirePageAction('fin-bankreco', 'view'),
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      res.json({ data: await recoService.suggestions(String(req.params.id)) });
    }),
  );
  const matchBody = z.object({ lineId: uuid, glEntryId: uuid }).strict();
  r.post(
    '/bank-statements/:id/match',
    requirePageAction('fin-bankreco', 'edit'),
    validate({ params: idParams, body: matchBody }),
    asyncHandler(async (req, res) => {
      const b = validated(res, 'body', matchBody);
      res.json({
        data: await recoService.match(String(req.params.id), b.lineId, b.glEntryId, actorOf(req)),
      });
    }),
  );
  const unmatchBody = z.object({ lineId: uuid }).strict();
  r.post(
    '/bank-statements/:id/unmatch',
    requirePageAction('fin-bankreco', 'edit'),
    validate({ params: idParams, body: unmatchBody }),
    asyncHandler(async (req, res) => {
      res.json({
        data: await recoService.unmatch(
          String(req.params.id),
          validated(res, 'body', unmatchBody).lineId,
          actorOf(req),
        ),
      });
    }),
  );
  const entryBody = z.object({ lineId: uuid, counterAccountId: uuid }).strict();
  r.post(
    '/bank-statements/:id/create-entry',
    requirePageAction('fin-bankreco', 'edit'),
    alsoCan(() => ['fin-bankbook', 'add']),
    validate({ params: idParams, body: entryBody }),
    asyncHandler(async (req, res) => {
      const b = validated(res, 'body', entryBody);
      res.json({
        data: await recoService.createEntry(
          String(req.params.id),
          b.lineId,
          b.counterAccountId,
          actorOf(req),
        ),
      });
    }),
  );
  r.post(
    '/bank-statements/:id/reconcile',
    requirePageAction('fin-bankreco', 'approve'),
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      res.json({
        data: await recoService.reconcile(
          String(req.params.id),
          parseIfMatch(req.get('if-match')),
          actorOf(req),
        ),
      });
    }),
  );
  r.post(
    '/bank-statements/:id/reopen',
    requirePageAction('fin-bankreco', 'approve'),
    validate({ params: idParams, body: cancelBody }),
    asyncHandler(async (req, res) => {
      res.json({
        data: await recoService.reopen(
          String(req.params.id),
          parseIfMatch(req.get('if-match')),
          validated(res, 'body', cancelBody).reason,
          actorOf(req),
        ),
      });
    }),
  );

  // ===== budgets =========================================================================================
  const budgetBody = z
    .object({
      fyId: uuid.optional(),
      unitId: uuid,
      accountId: uuid,
      costCenterId: uuid.nullish(),
      name: z.string().trim().min(2).max(120),
      months: z.array(moneyStr).length(12),
    })
    .strict();
  r.get(
    '/budgets',
    requirePageAction('fin-budget', 'view'),
    validate({
      query: z
        .object({ fyId: uuid.optional(), status: z.enum(['Draft', 'Active', 'Closed']).optional() })
        .strict(),
    }),
    asyncHandler(async (req, res) => {
      const q = validated(
        res,
        'query',
        z.object({ fyId: z.string().optional(), status: z.string().optional() }),
      );
      res.json({
        data: await budgetService.list({
          fyId: q.fyId ?? req.ctx!.fyId,
          unitId: ctxUnit(req),
          ...(q.status ? { status: q.status } : {}),
        }),
      });
    }),
  );
  r.post(
    '/budgets',
    requirePageAction('fin-budget', 'add'),
    validate({ body: budgetBody }),
    asyncHandler(async (req, res) => {
      const b = validated(res, 'body', budgetBody);
      await unitFromBody(req, b.unitId);
      res.status(201).json({
        data: await budgetService.create({ ...b, fyId: b.fyId ?? req.ctx!.fyId }, actorOf(req)),
      });
    }),
  );
  const budgetPatch = z
    .object({
      name: z.string().trim().min(2).max(120).optional(),
      months: z.array(moneyStr).length(12).optional(),
    })
    .strict();
  r.patch(
    '/budgets/:id',
    requirePageAction('fin-budget', 'edit'),
    validate({ params: idParams, body: budgetPatch }),
    asyncHandler(async (req, res) => {
      res.json({
        data: await budgetService.update(
          String(req.params.id),
          parseIfMatch(req.get('if-match')),
          validated(res, 'body', budgetPatch),
          actorOf(req),
        ),
      });
    }),
  );
  const statusBody = z.object({ status: z.enum(['Active', 'Closed']) }).strict();
  r.post(
    '/budgets/:id/status',
    requirePageAction('fin-budget', 'approve'),
    validate({ params: idParams, body: statusBody }),
    asyncHandler(async (req, res) => {
      res.json({
        data: await budgetService.setStatus(
          String(req.params.id),
          parseIfMatch(req.get('if-match')),
          validated(res, 'body', statusBody).status,
          actorOf(req),
        ),
      });
    }),
  );
  r.delete(
    '/budgets/:id',
    requirePageAction('fin-budget', 'delete'),
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      await budgetService.remove(String(req.params.id), actorOf(req));
      res.status(204).end();
    }),
  );

  // ===== reports ===========================================================================================
  const asOfQ = z
    .object({
      asOf: date.default(() => isoDate(new Date())),
      profitCenterId: uuid.optional(),
      costCenterId: uuid.optional(),
    })
    .strict();
  const flt = (
    req: Request,
    q: { profitCenterId?: string | undefined; costCenterId?: string | undefined },
  ) => ({
    unitId: ctxUnit(req),
    profitCenterId: q.profitCenterId ?? null,
    costCenterId: q.costCenterId ?? null,
  });
  r.get(
    '/reports/trial-balance',
    requirePageAction('fin-trial', 'view'),
    validate({ query: asOfQ }),
    asyncHandler(async (req, res) => {
      const q = validated(res, 'query', asOfQ);
      res.json({ data: await reportsService.trialBalance(q.asOf, flt(req, q)) });
    }),
  );
  r.get(
    '/reports/balance-sheet',
    requirePageAction('fin-bs', 'view'),
    validate({ query: asOfQ }),
    asyncHandler(async (req, res) => {
      const q = validated(res, 'query', asOfQ);
      res.json({ data: await reportsService.balanceSheet(q.asOf, flt(req, q)) });
    }),
  );
  const rangeQ = z
    .object({
      from: date,
      to: date,
      profitCenterId: uuid.optional(),
      costCenterId: uuid.optional(),
    })
    .strict();
  r.get(
    '/reports/profit-and-loss',
    requirePageAction('fin-pnl', 'view'),
    validate({ query: rangeQ }),
    asyncHandler(async (req, res) => {
      const q = validated(res, 'query', rangeQ);
      res.json({ data: await reportsService.profitAndLoss(q.from, q.to, flt(req, q)) });
    }),
  );
  const glQ = z.object({ accountId: uuid, from: date, to: date }).strict();
  r.get(
    '/reports/general-ledger',
    requirePageAction('fin-gl', 'view'),
    validate({ query: glQ }),
    asyncHandler(async (req, res) => {
      const q = validated(res, 'query', glQ);
      res.json({
        data: await reportsService.generalLedger(q.accountId, q.from, q.to, {
          unitId: ctxUnit(req),
        }),
      });
    }),
  );

  // ===== period close / year-end (administration gate: admin-fy) ==========================================
  r.get(
    '/close/:fyId',
    requirePageAction('admin-fy', 'view'),
    validate({ params: z.object({ fyId: uuid }).strict() }),
    asyncHandler(async (req, res) => {
      res.json({
        data: {
          ...(await closeService.periods(String(req.params.fyId))),
          preview: await closeService.preview(String(req.params.fyId)),
        },
      });
    }),
  );
  r.post(
    '/close/periods/:id/close',
    requirePageAction('admin-fy', 'edit'),
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      res.json({
        data: await closeService.closePeriod(
          String(req.params.id),
          parseIfMatch(req.get('if-match')),
          actorOf(req),
        ),
      });
    }),
  );
  r.post(
    '/close/periods/:id/reopen',
    requirePageAction('admin-fy', 'edit'),
    validate({ params: idParams, body: cancelBody }),
    asyncHandler(async (req, res) => {
      res.json({
        data: await closeService.reopenPeriod(
          String(req.params.id),
          parseIfMatch(req.get('if-match')),
          validated(res, 'body', cancelBody).reason,
          actorOf(req),
        ),
      });
    }),
  );
  r.post(
    '/close/:fyId/year-end',
    requirePageAction('admin-fy', 'edit'),
    validate({ params: z.object({ fyId: uuid }).strict() }),
    asyncHandler(async (req, res) => {
      const fyId = String(req.params.fyId);
      await runIdempotent(
        req,
        res,
        requireAuth(req).userId,
        `finance:year-end:${fyId}`,
        [fyId],
        async () => ({ ...(await closeService.closeYear(fyId, actorOf(req))), version: 1 }),
      );
    }),
  );

  // ===== approval limits (owned by the administrator) ===================================================
  r.get(
    '/approval-limits',
    requirePageAction('admin-settings', 'view'),
    asyncHandler(async (_req, res) => {
      res.json({ data: await limitsService.get() });
    }),
  );
  const limitsBody = z
    .object({
      journalApprovalThreshold: moneyStr.nullable().optional(),
      noteApprovalThreshold: moneyStr.nullable().optional(),
    })
    .strict();
  r.put(
    '/approval-limits',
    requirePageAction('admin-settings', 'controls'),
    validate({ body: limitsBody }),
    asyncHandler(async (req, res) => {
      res.json({ data: await limitsService.set(validated(res, 'body', limitsBody), actorOf(req)) });
    }),
  );

  // ===== credit / debit notes ============================================================================
  const noteBody = z
    .object({
      effect: z.enum(['REDUCE', 'ADD']),
      unitId: uuid,
      partyId: uuid,
      docDate: date,
      counterAccountId: uuid,
      costCenterId: uuid.nullish(),
      amount: moneyStr,
      reason: z.string().trim().min(5, 'Give a reason of at least 5 characters.').max(300),
      againstDocNo: z.string().max(60).nullish(),
    })
    .strict();
  const noteList = z
    .object({ status: z.enum(['Draft', 'Posted', 'Cancelled']).optional(), ...pageQuery })
    .strict();
  for (const [path, page, kind] of [
    ['credit-notes', 'fin-creditnote', 'CREDIT'],
    ['debit-notes', 'fin-debitnote', 'DEBIT'],
  ] as const) {
    r.get(
      `/${path}`,
      requirePageAction(page, 'view'),
      validate({ query: noteList }),
      asyncHandler(async (req, res) => {
        const q = validated(res, 'query', noteList);
        const { rows, total } = await notesService.list({ kind, unitId: ctxUnit(req), ...q });
        res.json({ data: rows, meta: meta(total, q.page, q.size) });
      }),
    );
    r.post(
      `/${path}`,
      requirePageAction(page, 'add'),
      validate({ body: noteBody }),
      asyncHandler(async (req, res) => {
        const b = validated(res, 'body', noteBody);
        await unitFromBody(req, b.unitId);
        const n = await notesService.create({ ...b, kind }, actorOf(req));
        res.status(201).set('ETag', `"${n.version}"`).json({ data: n });
      }),
    );
    r.get(
      `/${path}/:id`,
      requirePageAction(page, 'view'),
      validate({ params: idParams }),
      asyncHandler(async (req, res) => {
        const n = await notesService.get(String(req.params.id));
        if (n.kind !== kind) throw Errors.notFound('Note not found.');
        res.set('ETag', `"${n.version}"`).json({ data: n });
      }),
    );
    r.delete(
      `/${path}/:id`,
      requirePageAction(page, 'delete'),
      validate({ params: idParams }),
      asyncHandler(async (req, res) => {
        await notesService.remove(String(req.params.id), actorOf(req));
        res.status(204).end();
      }),
    );
    r.post(
      `/${path}/:id/submit`,
      requirePageAction(page, 'submit'),
      validate({ params: idParams }),
      asyncHandler(async (req, res) => {
        const id = String(req.params.id);
        const version = parseIfMatch(req.get('if-match'));
        await runIdempotent(
          req,
          res,
          requireAuth(req).userId,
          `finance:note-submit:${id}`,
          [id, version],
          async () => {
            const out = await notesApproval.submit(callerOf(req), id, version);
            const n = await notesService.get(id);
            return {
              ...n,
              needsApproval: out.needsApproval,
              approval: out.needsApproval ? out.approval : null,
            };
          },
        );
      }),
    );
    r.post(
      `/${path}/:id/post`,
      requirePageAction(page, 'post'),
      validate({ params: idParams }),
      asyncHandler(async (req, res) => {
        const id = String(req.params.id);
        const version = parseIfMatch(req.get('if-match'));
        await runIdempotent(
          req,
          res,
          requireAuth(req).userId,
          `finance:note-post:${id}`,
          [id, version],
          () => notesService.post(id, version, actorOf(req)),
        );
      }),
    );
    r.post(
      `/${path}/:id/cancel`,
      requirePageAction(page, 'cancel'),
      validate({ params: idParams, body: cancelBody }),
      asyncHandler(async (req, res) => {
        const id = String(req.params.id);
        const version = parseIfMatch(req.get('if-match'));
        const b = validated(res, 'body', cancelBody);
        await runIdempotent(
          req,
          res,
          requireAuth(req).userId,
          `finance:note-cancel:${id}`,
          [id, version, b.reason],
          () => notesService.cancel(id, version, b.reason, actorOf(req)),
        );
      }),
    );
  }

  // ===== expense claims ==================================================================================
  const claimBody = z
    .object({
      unitId: uuid,
      employeeId: uuid.optional(),
      claimDate: date,
      category: z.string().min(2).max(30),
      expenseAccountId: uuid.optional(),
      costCenterId: uuid.nullish(),
      amount: moneyStr,
      description: z.string().trim().min(3, 'Say what the expense was for.').max(300),
      billNo: z.string().max(60).nullish(),
    })
    .strict();
  r.get(
    '/expense-policies',
    requirePageAction('fin-expenses', 'view'),
    asyncHandler(async (_req, res) => {
      res.json({ data: await expenseService.policies() });
    }),
  );
  const policyBody = z
    .object({
      perClaimLimit: moneyStr,
      perMonthLimit: moneyStr,
      approvalLimit: moneyStr,
      defaultAccountId: uuid.nullish(),
    })
    .strict();
  r.put(
    '/expense-policies/:category',
    requirePageAction('fin-expenses', 'approve'),
    validate({ params: z.object({ category: z.string().max(30) }).strict(), body: policyBody }),
    asyncHandler(async (req, res) => {
      const b = validated(res, 'body', policyBody);
      res.json({
        data: await expenseService.setPolicy(
          String(req.params.category),
          parseIfMatch(req.get('if-match')),
          b,
          actorOf(req),
        ),
      });
    }),
  );
  const claimList = z
    .object({
      status: z.string().max(20).optional(),
      mine: z.coerce.boolean().optional(),
      ...pageQuery,
    })
    .strict();
  r.get(
    '/expenses',
    requirePageAction('fin-expenses', 'view'),
    validate({ query: claimList }),
    asyncHandler(async (req, res) => {
      const q = validated(res, 'query', claimList);
      const seesAll = await can(accessUserOf(requireAuth(req)), 'fin-expenses', 'approve');
      const { rows, total } = await expenseService.list({
        unitId: ctxUnit(req),
        ...(q.status ? { status: q.status } : {}),
        page: q.page,
        size: q.size,
        employeeId: !seesAll || q.mine ? requireAuth(req).userId : null,
      });
      res.json({ data: rows, meta: meta(total, q.page, q.size) });
    }),
  );
  r.post(
    '/expenses',
    requirePageAction('fin-expenses', 'add'),
    validate({ body: claimBody }),
    asyncHandler(async (req, res) => {
      const b = validated(res, 'body', claimBody);
      await unitFromBody(req, b.unitId);
      const others = await can(accessUserOf(requireAuth(req)), 'fin-expenses', 'approve');
      const c = await expenseService.create(b, actorOf(req), others);
      res.status(201).set('ETag', `"${c.version}"`).json({ data: c });
    }),
  );
  r.get(
    '/expenses/:id',
    requirePageAction('fin-expenses', 'view'),
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      const c = await expenseService.get(String(req.params.id));
      const seesAll = await can(accessUserOf(requireAuth(req)), 'fin-expenses', 'approve');
      if (!seesAll && c.employeeId !== requireAuth(req).userId)
        throw Errors.notFound('Expense claim not found.');
      res.set('ETag', `"${c.version}"`).json({ data: c });
    }),
  );
  const claimPatch = z
    .object({
      description: z.string().trim().min(3).max(300).optional(),
      amount: moneyStr.optional(),
      billNo: z.string().max(60).nullish(),
      costCenterId: uuid.nullish(),
    })
    .strict();
  r.patch(
    '/expenses/:id',
    requirePageAction('fin-expenses', 'edit'),
    validate({ params: idParams, body: claimPatch }),
    asyncHandler(async (req, res) => {
      const b = validated(res, 'body', claimPatch);
      res.json({
        data: await expenseService.update(
          String(req.params.id),
          parseIfMatch(req.get('if-match')),
          b,
          actorOf(req),
        ),
      });
    }),
  );
  r.delete(
    '/expenses/:id',
    requirePageAction('fin-expenses', 'delete'),
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      await expenseService.remove(String(req.params.id), actorOf(req));
      res.status(204).end();
    }),
  );
  r.post(
    '/expenses/:id/submit',
    requirePageAction('fin-expenses', 'submit'),
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      const id = String(req.params.id);
      const version = parseIfMatch(req.get('if-match'));
      await runIdempotent(
        req,
        res,
        requireAuth(req).userId,
        `finance:expense-submit:${id}`,
        [id, version],
        async () => {
          await expenseService.submit(callerOf(req), id, version);
          return expenseService.get(id);
        },
      );
    }),
  );
  const payBody = z
    .object({
      bankAccountId: uuid,
      mode: z.enum(['NEFT', 'RTGS', 'IMPS', 'UPI', 'Cheque', 'Cash']),
      docDate: date.default(() => isoDate(new Date())),
    })
    .strict();
  r.post(
    '/expenses/:id/pay',
    requirePageAction('fin-expenses', 'post'),
    validate({ params: idParams, body: payBody }),
    asyncHandler(async (req, res) => {
      const id = String(req.params.id);
      const version = parseIfMatch(req.get('if-match'));
      const b = validated(res, 'body', payBody);
      await runIdempotent(
        req,
        res,
        requireAuth(req).userId,
        `finance:expense-pay:${id}`,
        [id, version, b],
        () => expenseService.pay(id, version, b, actorOf(req)),
      );
    }),
  );
  r.post(
    '/expenses/:id/cancel',
    requirePageAction('fin-expenses', 'cancel'),
    validate({ params: idParams, body: cancelBody }),
    asyncHandler(async (req, res) => {
      const id = String(req.params.id);
      const version = parseIfMatch(req.get('if-match'));
      const b = validated(res, 'body', cancelBody);
      await runIdempotent(
        req,
        res,
        requireAuth(req).userId,
        `finance:expense-cancel:${id}`,
        [id, version, b.reason],
        () => expenseService.cancel(id, version, b.reason, actorOf(req)),
      );
    }),
  );

  // ===== recurring journals ==============================================================================
  const recLine = z
    .object({
      accountId: uuid,
      debit: moneyStr.default('0'),
      credit: moneyStr.default('0'),
      costCenterId: uuid.optional(),
      narration: z.string().max(300).optional(),
    })
    .strict();
  const recBody = z
    .object({
      unitId: uuid,
      name: z.string().trim().min(2).max(120),
      voucherType: z.enum(MANUAL_VOUCHER_TYPES).default('Journal'),
      narration: z.string().max(300).optional(),
      lines: z.array(recLine).min(2).max(100),
      frequency: z.enum(['WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY']),
      nextRun: date,
      endDate: date.nullish(),
      autoPost: z.boolean().optional(),
      reverseNextDay: z.boolean().optional(),
    })
    .strict();
  r.get(
    '/recurring',
    requirePageAction('fin-journal', 'view'),
    asyncHandler(async (req, res) => {
      res.json({ data: await recurringService.list(ctxUnit(req)) });
    }),
  );
  r.post(
    '/recurring',
    requirePageAction('fin-journal', 'add'),
    validate({ body: recBody }),
    asyncHandler(async (req, res) => {
      const b = validated(res, 'body', recBody);
      await unitFromBody(req, b.unitId);
      res.status(201).json({ data: await recurringService.create(b, actorOf(req)) });
    }),
  );
  const recStatus = z.object({ status: z.enum(['Active', 'Paused']) }).strict();
  r.post(
    '/recurring/:id/status',
    requirePageAction('fin-journal', 'edit'),
    validate({ params: idParams, body: recStatus }),
    asyncHandler(async (req, res) => {
      res.json({
        data: await recurringService.setStatus(
          String(req.params.id),
          parseIfMatch(req.get('if-match')),
          validated(res, 'body', recStatus).status,
          actorOf(req),
        ),
      });
    }),
  );
  r.delete(
    '/recurring/:id',
    requirePageAction('fin-journal', 'delete'),
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      await recurringService.remove(String(req.params.id));
      res.status(204).end();
    }),
  );
  const runBody = z.object({ asOf: date.default(() => isoDate(new Date())) }).strict();
  r.post(
    '/recurring/run',
    requirePageAction('fin-journal', 'post'),
    validate({ body: runBody }),
    asyncHandler(async (req, res) => {
      res.json({
        data: await recurringService.run(validated(res, 'body', runBody).asOf, actorOf(req)),
      });
    }),
  );

  // ===== foreign currency ==================================================================================
  const rateQ = z.object({ currency: z.string().length(3).optional(), ...pageQuery }).strict();
  r.get(
    '/fx-rates',
    requirePageAction('fin-journal', 'view'),
    validate({ query: rateQ }),
    asyncHandler(async (_req, res) => {
      const q = validated(res, 'query', rateQ);
      const { rows, total } = await fxService.listRates({
        ...(q.currency ? { currency: q.currency.toUpperCase() } : {}),
        page: q.page,
        size: q.size,
      });
      res.json({ data: rows, meta: meta(total, q.page, q.size) });
    }),
  );
  const rateBody = z
    .object({
      currencyCode: z.string().length(3),
      rateDate: date,
      rate: z.string().regex(/^\d+(\.\d{1,6})?$/, 'Enter a rate like 83.2000.'),
      source: z.string().max(60).optional(),
    })
    .strict();
  r.put(
    '/fx-rates',
    requirePageAction('fin-coa', 'edit'),
    validate({ body: rateBody }),
    asyncHandler(async (req, res) => {
      res.json({ data: await fxService.setRate(validated(res, 'body', rateBody), actorOf(req)) });
    }),
  );
  const rateOn = z.object({ currency: z.string().length(3), date }).strict();
  r.get(
    '/fx-rates/on',
    requirePageAction('fin-journal', 'view'),
    validate({ query: rateOn }),
    asyncHandler(async (_req, res) => {
      const q = validated(res, 'query', rateOn);
      res.json({ data: await fxService.rateOn(q.currency, q.date) });
    }),
  );
  const revalQ = z.object({ asOf: date.default(() => isoDate(new Date())) }).strict();
  r.get(
    '/reports/fx-revaluation',
    requirePageAction('fin-gl', 'view'),
    validate({ query: revalQ }),
    asyncHandler(async (req, res) => {
      res.json({
        data: await fxService.revaluationPreview(
          validated(res, 'query', revalQ).asOf,
          ctxUnit(req),
        ),
      });
    }),
  );

  // ===== cash flow ============================================================================================
  r.get(
    '/reports/cash-flow',
    requirePageAction('fin-cashflow', 'view'),
    validate({ query: rangeQ }),
    asyncHandler(async (req, res) => {
      const q = validated(res, 'query', rangeQ);
      res.json({ data: await reportsService.cashFlow(q.from, q.to, flt(req, q)) });
    }),
  );

  // ===== tax registers (nothing is computed or filed here) ==================================================
  const regQ = z.object({ from: date, to: date }).strict();
  for (const [path, page, direction] of [
    ['sales-register', 'tax-salesreg', 'OUTWARD'],
    ['purchase-register', 'tax-purchasereg', 'INWARD'],
  ] as const) {
    r.get(
      `/tax/${path}`,
      requirePageAction(page, 'view'),
      validate({ query: regQ }),
      asyncHandler(async (req, res) => {
        const q = validated(res, 'query', regQ);
        res.json({
          data: await taxService.register({
            direction,
            from: q.from,
            to: q.to,
            unitId: ctxUnit(req),
          }),
        });
      }),
    );
  }
  for (const [path, page, kind] of [
    ['tds-register', 'tax-tds', 'TDS'],
    ['tcs-register', 'tax-tcs', 'TCS'],
  ] as const) {
    r.get(
      `/tax/${path}`,
      requirePageAction(page, 'view'),
      validate({ query: regQ }),
      asyncHandler(async (req, res) => {
        const q = validated(res, 'query', regQ);
        res.json({
          data: await taxService.tdsRegister({
            kind,
            from: q.from,
            to: q.to,
            unitId: ctxUnit(req),
          }),
        });
      }),
    );
  }
  r.get(
    '/tax/challans',
    requirePageAction('tax-tds', 'view'),
    asyncHandler(async (req, res) => {
      res.json({ data: await taxService.challans(ctxUnit(req)) });
    }),
  );
  const challanBody = z
    .object({
      unitId: uuid,
      taxKind: z.enum(['TDS', 'TCS']),
      bankAccountId: uuid,
      paidOn: date,
      challanNo: z.string().trim().min(3).max(40),
      bsrCode: z.string().max(10).optional(),
      entryIds: z.array(uuid).min(1).max(500),
    })
    .strict();
  r.post(
    '/tax/challans',
    requirePageAction('tax-tds', 'add'),
    alsoCan(() => ['fin-bankbook', 'add']),
    validate({ body: challanBody }),
    asyncHandler(async (req, res) => {
      const b = validated(res, 'body', challanBody);
      await unitFromBody(req, b.unitId);
      res.status(201).json({ data: await taxService.depositChallan(b, actorOf(req)) });
    }),
  );

  void requireConcreteUnit;
  void (null as unknown as Response);
  return router;
}
