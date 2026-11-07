// Phase 6 API (docs/phases/PHASE-06.md §6): offline GSTIN / PAN decode, duplicate check, tax-rate and price
// lookups, customers, suppliers (with bank accounts and approval) and credit-change requests.
// Every route needs a signed-in user; writes need the page permission of the master (crm-customer360,
// scm-suppliers). Nothing here calls a government portal (R-12).
import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { requestMeta, requireAuth } from '../../core/auth/auth-context';
import { authenticate, requirePasswordChanged } from '../../core/auth/authenticate';
import { prisma } from '../../core/db/prisma';
import { asyncHandler } from '../../core/http/async-handler';
import { Errors } from '../../core/http/errors';
import { validate, validated } from '../../core/http/validate';
import { accessUserOf, can, requirePageAction } from '../../core/rbac/access';
import { runIdempotent } from '../approvals/idempotent';
import { duplicateService } from './duplicate-service';
import { partyService, SUPPLIER_DOC_TYPE, CREDIT_DOC_TYPE } from './party-service';
import { normaliseGstin, validateGstin, validatePan } from './party-rules';
import { pricingService } from './pricing-service';
import { knownStates, taxService } from './tax-service';

const uuid = z.string().regex(/^[0-9a-fA-F-]{36}$/, 'Invalid id.');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-11-30.');
const regType = z.enum(['REGULAR', 'COMPOSITION', 'UNREGISTERED', 'SEZ', 'OVERSEAS']);

const partyFields = {
  name: z.string().trim().min(2).max(150),
  legalName: z.string().trim().max(200).nullish(),
  gstRegistrationType: regType,
  gstin: z.string().trim().max(20).nullish(),
  pan: z.string().trim().max(12).nullish(),
  stateCode: z.string().length(2).nullish(),
  groupId: uuid.nullish(),
  paymentTermId: uuid.nullish(),
  currencyCode: z.string().length(3).optional(),
  city: z.string().trim().max(100).nullish(),
  mobile: z.string().trim().max(15).nullish(),
  email: z.string().trim().max(254).nullish(),
  differentParty: z.boolean().optional(),
};

const customerBody = z
  .object({
    ...partyFields,
    territoryId: uuid.nullish(),
    salesPersonId: uuid.nullish(),
    priceListId: uuid.nullish(),
    creditLimit: z.union([z.number().min(0), z.string().regex(/^\d+(\.\d{1,2})?$/)]).nullish(),
    creditDays: z.number().int().min(0).max(365).nullish(),
    tier: z.enum(['A', 'B', 'C', 'D']).optional(),
  })
  .strict();

const supplierBody = z
  .object({
    ...partyFields,
    supplierType: z.enum(['MATERIAL', 'CONTRACTOR']).optional(),
    msmeUdyamNo: z.string().trim().max(25).nullish(),
    msmeCategory: z.enum(['MICRO', 'SMALL', 'MEDIUM']).nullish(),
    msmeActivity: z.enum(['MANUFACTURING', 'SERVICES', 'TRADING']).nullish(),
    msmeAgreedDays: z.number().int().min(1).max(45).nullish(),
  })
  .strict();

const listQuery = z
  .object({
    q: z.string().trim().max(100).optional(),
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
    approval: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
    page: z.coerce.number().int().min(1).max(100000).default(1),
    size: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

const idParams = z.object({ id: uuid }).strict();

function callerOf(req: Request) {
  return { auth: requireAuth(req), meta: requestMeta(req) };
}

/** Strips undefined so exactOptionalPropertyTypes-style inputs stay clean. */
function clean<T extends Record<string, unknown>>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

export function createMastersRouter(): Router {
  const router = Router();
  // Only this router's own paths are guarded, so unknown URLs keep answering 404 for everybody.
  router.use(
    ['/statutory', '/parties', '/tax', '/pricing', '/customers', '/suppliers'],
    authenticate,
    requirePasswordChanged,
  );

  // ---- offline decode (never a portal call) ------------------------------------------------------------
  router.get(
    '/statutory/gstin/:gstin',
    asyncHandler(async (req: Request, res: Response) => {
      const states = await knownStates();
      const raw = String(req.params.gstin ?? '');
      const r = validateGstin(raw, states.codes);
      res.set('Cache-Control', 'no-store').json({
        data: r.ok
          ? {
              ok: true,
              gstin: r.gstin,
              stateCode: r.stateCode,
              state: states.names.get(r.stateCode) ?? null,
              pan: r.pan,
              registrationType: 'REGULAR',
              note: 'GSTIN format OK — not checked on portal',
            }
          : { ok: false, gstin: normaliseGstin(raw), code: r.code, message: r.message },
      });
    }),
  );

  router.get(
    '/statutory/pan/:pan',
    asyncHandler((req: Request, res: Response) => {
      const r = validatePan(String(req.params.pan ?? ''));
      res.set('Cache-Control', 'no-store').json({
        data: r.ok
          ? { ok: true, pan: r.pan, holder: r.holder }
          : { ok: false, code: r.code, message: r.message },
      });
      return Promise.resolve();
    }),
  );

  router.post(
    '/parties/check-duplicates',
    validate({
      body: z
        .object({
          kind: z.enum(['CUSTOMER', 'SUPPLIER']),
          gstin: z.string().max(20).nullish(),
          pan: z.string().max(12).nullish(),
          name: z.string().max(150).nullish(),
          city: z.string().max(100).nullish(),
          mobile: z.string().max(15).nullish(),
          email: z.string().max(254).nullish(),
          accountNo: z.string().max(30).nullish(),
          excludeId: uuid.nullish(),
        })
        .strict(),
    }),
    asyncHandler(async (req: Request, res: Response) => {
      const body = validated(
        res,
        'body',
        z.object({ kind: z.enum(['CUSTOMER', 'SUPPLIER']) }).passthrough(),
      ) as unknown as Record<string, string | null | undefined> & { kind: 'CUSTOMER' | 'SUPPLIER' };
      const auth = requireAuth(req);
      const canOverrideBank = await can(accessUserOf(auth.user), SUPPLIER_DOC_TYPE, 'approve');
      const hits = await duplicateService.check({
        ...clean(body),
        kind: body.kind,
        canOverrideBank,
      });
      res.json({ data: hits });
    }),
  );

  // ---- lookups used by forms ----------------------------------------------------------------------------
  router.get(
    '/tax/rate',
    validate({ query: z.object({ itemId: uuid, date: isoDate }).strict() }),
    asyncHandler(async (_req: Request, res: Response) => {
      const q = validated(res, 'query', z.object({ itemId: uuid, date: isoDate }));
      res
        .set('Cache-Control', 'no-store')
        .json({ data: await taxService.rateFor(q.itemId, q.date) });
    }),
  );

  const pricingQuery = z
    .object({
      kind: z.enum(['SELLING', 'BUYING']).optional(),
      customerId: uuid.optional(),
      supplierId: uuid.optional(),
      itemId: uuid,
      qty: z.coerce.number().min(0),
      uom: z.string().max(20).optional(),
      date: isoDate,
    })
    .strict();
  router.get(
    '/pricing/lookup',
    validate({ query: pricingQuery }),
    asyncHandler(async (_req: Request, res: Response) => {
      const q = validated(res, 'query', pricingQuery);
      res.set('Cache-Control', 'no-store').json({
        data: await pricingService.lookup(
          clean({
            kind: q.kind,
            customerId: q.customerId,
            supplierId: q.supplierId,
            itemId: q.itemId,
            qty: q.qty,
            uomCode: q.uom,
            date: q.date,
          }),
        ),
      });
    }),
  );

  // ---- customers ------------------------------------------------------------------------------------------
  router.get(
    '/customers',
    requirePageAction(CREDIT_DOC_TYPE, 'view'),
    validate({ query: listQuery }),
    asyncHandler(async (_req: Request, res: Response) => {
      const q = validated(res, 'query', listQuery);
      const where = {
        deletedAt: null,
        ...(q.status ? { status: q.status } : {}),
        ...(q.q
          ? {
              OR: [
                { name: { contains: q.q, mode: 'insensitive' as const } },
                { code: { contains: q.q, mode: 'insensitive' as const } },
                { gstin: { contains: q.q.toUpperCase() } },
              ],
            }
          : {}),
      };
      const [rows, total] = await Promise.all([
        prisma.customer.findMany({
          where,
          orderBy: { code: 'asc' },
          skip: (q.page - 1) * q.size,
          take: q.size,
        }),
        prisma.customer.count({ where }),
      ]);
      res.json({ data: rows, meta: { page: q.page, size: q.size, total } });
    }),
  );

  router.get(
    '/customers/:id',
    requirePageAction(CREDIT_DOC_TYPE, 'view'),
    validate({ params: idParams }),
    asyncHandler(async (_req: Request, res: Response) => {
      const { id } = validated(res, 'params', idParams);
      const row = await prisma.customer.findFirst({
        where: { id, deletedAt: null },
        include: { addresses: true, contacts: true },
      });
      if (!row) throw Errors.notFound('Customer not found.');
      res.set('ETag', `"${row.version}"`).json({ data: row });
    }),
  );

  router.post(
    '/customers',
    requirePageAction(CREDIT_DOC_TYPE, 'add'),
    validate({ body: customerBody }),
    asyncHandler(async (req: Request, res: Response) => {
      const body = validated(res, 'body', customerBody);
      const caller = callerOf(req);
      await runIdempotent(req, res, caller.auth.userId, 'customers:create', [body], async () =>
        partyService.createCustomer(caller, clean(body) as never),
      );
    }),
  );

  const creditBody = z
    .object({
      newLimit: z.union([z.number().min(0), z.string().regex(/^\d+(\.\d{1,2})?$/)]).nullish(),
      newDays: z.number().int().min(0).max(365).nullish(),
      reason: z.string().max(500),
    })
    .strict();
  router.post(
    '/customers/:id/credit-requests',
    requirePageAction(CREDIT_DOC_TYPE, 'edit'),
    validate({ params: idParams, body: creditBody }),
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = validated(res, 'params', idParams);
      const body = validated(res, 'body', creditBody);
      const out = await partyService.requestCreditChange(callerOf(req), id, clean(body) as never);
      res.status(out.applied ? 200 : 202).json({ data: out });
    }),
  );

  // ---- suppliers ------------------------------------------------------------------------------------------
  router.get(
    '/suppliers',
    requirePageAction(SUPPLIER_DOC_TYPE, 'view'),
    validate({ query: listQuery }),
    asyncHandler(async (_req: Request, res: Response) => {
      const q = validated(res, 'query', listQuery);
      const where = {
        deletedAt: null,
        ...(q.status ? { status: q.status } : {}),
        ...(q.approval ? { approvalStatus: q.approval } : {}),
        ...(q.q
          ? {
              OR: [
                { name: { contains: q.q, mode: 'insensitive' as const } },
                { code: { contains: q.q, mode: 'insensitive' as const } },
                { gstin: { contains: q.q.toUpperCase() } },
              ],
            }
          : {}),
      };
      const [rows, total] = await Promise.all([
        prisma.supplier.findMany({
          where,
          orderBy: { code: 'asc' },
          skip: (q.page - 1) * q.size,
          take: q.size,
        }),
        prisma.supplier.count({ where }),
      ]);
      res.json({ data: rows, meta: { page: q.page, size: q.size, total } });
    }),
  );

  router.get(
    '/suppliers/:id',
    requirePageAction(SUPPLIER_DOC_TYPE, 'view'),
    validate({ params: idParams }),
    asyncHandler(async (_req: Request, res: Response) => {
      const { id } = validated(res, 'params', idParams);
      const row = await prisma.supplier.findFirst({
        where: { id, deletedAt: null },
        include: {
          addresses: true,
          contacts: true,
          documents: true,
          bankAccounts: {
            select: {
              id: true,
              ifsc: true,
              holderName: true,
              accountLast4: true,
              isDefault: true,
              verifiedAt: true,
              changedById: true,
            },
          },
        },
      });
      if (!row) throw Errors.notFound('Supplier not found.');
      res.set('ETag', `"${row.version}"`).json({ data: row });
    }),
  );

  router.post(
    '/suppliers',
    requirePageAction(SUPPLIER_DOC_TYPE, 'add'),
    validate({ body: supplierBody }),
    asyncHandler(async (req: Request, res: Response) => {
      const body = validated(res, 'body', supplierBody);
      const caller = callerOf(req);
      await runIdempotent(req, res, caller.auth.userId, 'suppliers:create', [body], async () =>
        partyService.createSupplier(caller, clean(body) as never),
      );
    }),
  );

  router.post(
    '/suppliers/:id/submit',
    requirePageAction(SUPPLIER_DOC_TYPE, 'submit'),
    validate({ params: idParams }),
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = validated(res, 'params', idParams);
      res.json({ data: await partyService.submitSupplier(callerOf(req), id) });
    }),
  );

  const bankBody = z
    .object({
      ifsc: z.string().trim().max(11),
      holderName: z.string().trim().min(2).max(150),
      accountNo: z.string().trim().max(30),
      accountNoConfirm: z.string().trim().max(30),
      bankId: uuid.nullish(),
    })
    .strict();
  router.post(
    '/suppliers/:id/bank-accounts',
    requirePageAction(SUPPLIER_DOC_TYPE, 'edit'),
    validate({ params: idParams, body: bankBody }),
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = validated(res, 'params', idParams);
      const body = validated(res, 'body', bankBody);
      const auth = requireAuth(req);
      const canOverride = await can(accessUserOf(auth.user), SUPPLIER_DOC_TYPE, 'approve');
      res.status(201).json({
        data: await partyService.addBankAccount(callerOf(req), id, {
          ...clean(body),
          canOverrideDuplicate: canOverride,
        }),
      });
    }),
  );

  const bankParams = z.object({ id: uuid, bid: uuid }).strict();
  router.post(
    '/suppliers/:id/bank-accounts/:bid/verify',
    requirePageAction(SUPPLIER_DOC_TYPE, 'approve'),
    validate({ params: bankParams }),
    asyncHandler(async (req: Request, res: Response) => {
      const { id, bid } = validated(res, 'params', bankParams);
      res.json({ data: await partyService.verifyBankAccount(callerOf(req), id, bid) });
    }),
  );

  return router;
}
