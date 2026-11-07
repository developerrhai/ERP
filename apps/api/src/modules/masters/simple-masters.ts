/* eslint-disable @typescript-eslint/no-base-to-string, @typescript-eslint/no-unsafe-argument --
   One table-driven factory over several Prisma delegates: values are dynamically shaped on purpose. */
// Simple Phase 6 masters served by one factory (docs/phases/PHASE-06.md §6): HSN / SAC (+ dated rates),
// GST rates, GST registrations, payment terms, banks, territories, party groups, item groups and price
// lists. Each: GET list / GET one (ETag) / POST (Idempotency-Key) / PATCH (If-Match) / DELETE (soft).
// Page permissions: tax-hsn, admin-taxes, tax-gst, sales-pricelist, inv-items. Payment terms, banks,
// territories and party groups wait for their NEW page ids (owner-approved in Phase 6); until the registry
// additions exist they use admin-settings "controls" (ERRATA E-32 note).
import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { requestMeta, requireAuth } from '../../core/auth/auth-context';
import { recordAudit } from '../../core/audit/audit-service';
import { authenticate, requirePasswordChanged } from '../../core/auth/authenticate';
import { prisma } from '../../core/db/prisma';
import { asyncHandler } from '../../core/http/async-handler';
import { AppError, Errors } from '../../core/http/errors';
import { parseIfMatch } from '../../core/http/if-match';
import { validate, validated } from '../../core/http/validate';
import { requirePageAction } from '../../core/rbac/access';
import type { Action } from '../../core/rbac/permission-model';
import { runIdempotent } from '../approvals/idempotent';
import { checkTermsSum, validateGstin } from './party-rules';
import { knownStates, taxService } from './tax-service';

const uuid = z.string().regex(/^[0-9a-fA-F-]{36}$/, 'Invalid id.');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-11-30.');
const status = z.enum(['ACTIVE', 'INACTIVE']);
const money = z.union([z.number().min(0), z.string().regex(/^\d+(\.\d{1,6})?$/)]);
const d = (s: string): Date => new Date(`${s}T00:00:00Z`);

interface Delegate {
  findMany(args: unknown): Promise<unknown[]>;
  count(args: unknown): Promise<number>;
  findFirst(args: unknown): Promise<Record<string, unknown> | null>;
  create(args: unknown): Promise<Record<string, unknown>>;
  update(args: unknown): Promise<Record<string, unknown>>;
}

interface MasterConfig {
  path: string;
  page: string;
  /** Interim: pages that do not exist in the registry yet use admin-settings. */
  writeAction: Action;
  audit: string;
  label: string;
  delegate: () => Delegate;
  search: string[];
  createSchema: z.ZodTypeAny;
  /** Body -> prisma data (create). */
  toCreate: (b: Record<string, unknown>) => Record<string, unknown>;
  /** Body -> prisma data (patch; only the keys sent). */
  toPatch: (b: Record<string, unknown>) => Record<string, unknown>;
  include?: Record<string, unknown>;
  /** Extra checks on the final body of a create / patch. */
  check?: (b: Record<string, unknown>) => Promise<void> | void;
  orderBy?: Record<string, unknown>;
}

const pick = (
  b: Record<string, unknown>,
  map: Record<string, string>,
  convert: Record<string, (v: never) => unknown> = {},
) => {
  const out: Record<string, unknown> = {};
  for (const [from, to] of Object.entries(map)) {
    if (b[from] === undefined) continue;
    const v = b[from];
    out[to] = v === null ? null : convert[from] ? convert[from](v as never) : v;
  }
  return out;
};

const configs: MasterConfig[] = [
  {
    path: 'hsn-sac',
    page: 'tax-hsn',
    writeAction: 'edit',
    audit: 'HSN',
    label: 'HSN / SAC code',
    delegate: () => prisma.hsnSacCode as unknown as Delegate,
    search: ['code', 'description'],
    orderBy: { code: 'asc' },
    createSchema: z
      .object({
        code: z.string().regex(/^([0-9]{4}|[0-9]{6}|[0-9]{8})$/, 'HSN / SAC is 4, 6 or 8 digits.'),
        description: z.string().trim().min(2).max(300),
        defaultUqc: z.string().max(10).nullish(),
        status: status.optional(),
      })
      .strict(),
    toCreate: (b) =>
      pick(b, {
        code: 'code',
        description: 'description',
        defaultUqc: 'defaultUqc',
        status: 'status',
      }),
    toPatch: (b) =>
      pick(b, { description: 'description', defaultUqc: 'defaultUqc', status: 'status' }),
  },
  {
    path: 'gst-rates',
    page: 'admin-taxes',
    writeAction: 'edit',
    audit: 'GST_RATE',
    label: 'GST rate',
    delegate: () => prisma.gstRate as unknown as Delegate,
    search: ['code', 'name'],
    orderBy: { effectiveFrom: 'desc' },
    createSchema: z
      .object({
        code: z.string().regex(/^[A-Z0-9_]{2,30}$/, 'Use capital letters, digits and _.'),
        name: z.string().trim().min(2).max(100),
        kind: z.enum(['TAXABLE', 'NIL', 'EXEMPT', 'NON_GST']).default('TAXABLE'),
        igstPct: z.union([z.number().min(0).max(100), z.string().regex(/^\d+(\.\d{1,4})?$/)]),
        effectiveFrom: isoDate,
        effectiveTo: isoDate.nullish(),
        status: status.optional(),
      })
      .strict(),
    toCreate: (b) =>
      pick(
        b,
        {
          code: 'code',
          name: 'name',
          kind: 'kind',
          igstPct: 'igstPct',
          effectiveFrom: 'effectiveFrom',
          effectiveTo: 'effectiveTo',
          status: 'status',
        },
        { effectiveFrom: d as never, effectiveTo: d as never },
      ),
    toPatch: (b) =>
      pick(
        b,
        { name: 'name', effectiveTo: 'effectiveTo', status: 'status' },
        { effectiveTo: d as never },
      ),
    check: (b) => {
      if (b.effectiveTo && b.effectiveFrom && String(b.effectiveTo) < String(b.effectiveFrom)) {
        throw Errors.validation({ effectiveTo: 'The end date cannot be before the start date.' });
      }
    },
  },
  {
    path: 'gst-registrations',
    page: 'tax-gst',
    writeAction: 'edit',
    audit: 'GST_REGISTRATION',
    label: 'GST registration',
    delegate: () => prisma.gstRegistration as unknown as Delegate,
    search: ['gstin', 'legalName'],
    orderBy: { createdAt: 'asc' },
    createSchema: z
      .object({
        unitId: uuid,
        gstin: z.string().trim().max(20),
        legalName: z.string().trim().min(2).max(200),
        tradeName: z.string().trim().max(200).nullish(),
        registrationType: z.enum(['REGULAR', 'COMPOSITION', 'SEZ']),
        effectiveFrom: isoDate,
        einvoiceEnabled: z.boolean().optional(),
        ewayEnabled: z.boolean().optional(),
        minHsnDigits: z.union([z.literal(4), z.literal(6), z.literal(8)]).optional(),
        status: status.optional(),
      })
      .strict(),
    toCreate: (b) => ({
      ...pick(
        b,
        {
          unitId: 'unitId',
          legalName: 'legalName',
          tradeName: 'tradeName',
          registrationType: 'registrationType',
          effectiveFrom: 'effectiveFrom',
          einvoiceEnabled: 'einvoiceEnabled',
          ewayEnabled: 'ewayEnabled',
          minHsnDigits: 'minHsnDigits',
          status: 'status',
        },
        { effectiveFrom: d as never },
      ),
      gstin: String(b.gstin).replace(/\s+/g, '').toUpperCase(),
      stateCode: String(b.gstin).replace(/\s+/g, '').slice(0, 2),
    }),
    toPatch: (b) =>
      pick(b, {
        legalName: 'legalName',
        tradeName: 'tradeName',
        einvoiceEnabled: 'einvoiceEnabled',
        ewayEnabled: 'ewayEnabled',
        minHsnDigits: 'minHsnDigits',
        status: 'status',
      }),
    check: async (b) => {
      if (b.gstin === undefined) return;
      const states = await knownStates();
      const r = validateGstin(String(b.gstin), states.codes);
      if (!r.ok) throw new AppError(422, r.code as never, r.message, { gstin: r.message });
    },
  },
  {
    path: 'item-groups',
    page: 'inv-items',
    writeAction: 'edit',
    audit: 'ITEM_GROUP',
    label: 'Item group',
    delegate: () => prisma.itemGroup as unknown as Delegate,
    search: ['code', 'name'],
    orderBy: { code: 'asc' },
    createSchema: z
      .object({
        code: z.string().regex(/^[A-Z0-9_/-]{2,40}$/, 'Use capital letters, digits, _ / -.'),
        name: z.string().trim().min(2).max(120),
        parentId: uuid.nullish(),
        defaultHsnId: uuid.nullish(),
        status: status.optional(),
      })
      .strict(),
    toCreate: (b) =>
      pick(b, {
        code: 'code',
        name: 'name',
        parentId: 'parentId',
        defaultHsnId: 'defaultHsnId',
        status: 'status',
      }),
    toPatch: (b) =>
      pick(b, {
        name: 'name',
        parentId: 'parentId',
        defaultHsnId: 'defaultHsnId',
        status: 'status',
      }),
  },
  {
    path: 'banks',
    page: 'admin-settings',
    writeAction: 'controls',
    audit: 'BANK',
    label: 'Bank',
    delegate: () => prisma.bank as unknown as Delegate,
    search: ['code', 'name'],
    orderBy: { name: 'asc' },
    createSchema: z
      .object({
        code: z.string().regex(/^[A-Z]{4}$/, 'Use the first 4 letters of the IFSC.'),
        name: z.string().trim().min(2).max(120),
        status: status.optional(),
      })
      .strict(),
    toCreate: (b) => pick(b, { code: 'code', name: 'name', status: 'status' }),
    toPatch: (b) => pick(b, { name: 'name', status: 'status' }),
  },
  {
    path: 'territories',
    page: 'admin-settings',
    writeAction: 'controls',
    audit: 'TERRITORY',
    label: 'Territory',
    delegate: () => prisma.territory as unknown as Delegate,
    search: ['code', 'name'],
    orderBy: { code: 'asc' },
    createSchema: z
      .object({
        code: z.string().regex(/^[A-Z0-9_/-]{2,20}$/),
        name: z.string().trim().min(2).max(80),
        parentId: uuid.nullish(),
        stateCode: z.string().length(2).nullish(),
        status: status.optional(),
      })
      .strict(),
    toCreate: (b) =>
      pick(b, {
        code: 'code',
        name: 'name',
        parentId: 'parentId',
        stateCode: 'stateCode',
        status: 'status',
      }),
    toPatch: (b) =>
      pick(b, { name: 'name', parentId: 'parentId', stateCode: 'stateCode', status: 'status' }),
  },
  {
    path: 'party-groups',
    page: 'admin-settings',
    writeAction: 'controls',
    audit: 'PARTY_GROUP',
    label: 'Group',
    delegate: () => prisma.partyGroup as unknown as Delegate,
    search: ['code', 'name'],
    orderBy: { code: 'asc' },
    createSchema: z
      .object({
        kind: z.enum(['CUSTOMER', 'SUPPLIER']),
        code: z.string().regex(/^[A-Z0-9_/-]{2,20}$/),
        name: z.string().trim().min(2).max(80),
        parentId: uuid.nullish(),
        defaultPaymentTermId: uuid.nullish(),
        defaultPriceListId: uuid.nullish(),
        controlAccountKey: z.string().max(40).nullish(),
        status: status.optional(),
      })
      .strict(),
    toCreate: (b) =>
      pick(b, {
        kind: 'kind',
        code: 'code',
        name: 'name',
        parentId: 'parentId',
        defaultPaymentTermId: 'defaultPaymentTermId',
        defaultPriceListId: 'defaultPriceListId',
        controlAccountKey: 'controlAccountKey',
        status: 'status',
      }),
    toPatch: (b) =>
      pick(b, {
        name: 'name',
        parentId: 'parentId',
        defaultPaymentTermId: 'defaultPaymentTermId',
        defaultPriceListId: 'defaultPriceListId',
        controlAccountKey: 'controlAccountKey',
        status: 'status',
      }),
  },
  {
    path: 'payment-terms',
    page: 'admin-settings',
    writeAction: 'controls',
    audit: 'PAYMENT_TERM',
    label: 'Payment term',
    delegate: () => prisma.paymentTerm as unknown as Delegate,
    search: ['code', 'name'],
    orderBy: { code: 'asc' },
    include: { lines: { orderBy: { lineNo: 'asc' } } },
    createSchema: z
      .object({
        code: z.string().regex(/^[A-Z0-9_-]{2,20}$/),
        name: z.string().trim().min(2).max(80),
        description: z.string().max(300).nullish(),
        status: status.optional(),
        lines: z
          .array(
            z
              .object({
                portionPct: z.union([
                  z.number().gt(0).max(100),
                  z.string().regex(/^\d+(\.\d{1,4})?$/),
                ]),
                dueBasis: z.enum([
                  'ADVANCE',
                  'INVOICE_DATE',
                  'END_OF_INVOICE_MONTH',
                  'RECEIPT_OF_GOODS',
                ]),
                days: z.number().int().min(0).max(365),
                discountPct: z.number().min(0).max(100).optional(),
                discountDays: z.number().int().min(0).max(365).optional(),
              })
              .strict(),
          )
          .min(1)
          .max(12),
      })
      .strict(),
    toCreate: (b) => ({
      ...pick(b, { code: 'code', name: 'name', description: 'description', status: 'status' }),
      lines: {
        create: (b.lines as Record<string, unknown>[]).map((l, i) => ({
          lineNo: i + 1,
          portionPct: l.portionPct,
          dueBasis: l.dueBasis,
          days: l.days,
          discountPct: l.discountPct ?? 0,
          discountDays: l.discountDays ?? 0,
        })),
      },
    }),
    toPatch: (b) => pick(b, { name: 'name', description: 'description', status: 'status' }),
    check: (b) => {
      if (!Array.isArray(b.lines)) return;
      const bad = checkTermsSum(b.lines as never);
      if (bad) throw new AppError(422, 'TERMS_SUM', bad, { lines: bad });
    },
  },
  {
    path: 'price-lists',
    page: 'sales-pricelist',
    writeAction: 'edit',
    audit: 'PRICE_LIST',
    label: 'Price list',
    delegate: () => prisma.priceList as unknown as Delegate,
    search: ['code', 'name'],
    orderBy: { code: 'asc' },
    include: { items: true },
    createSchema: z
      .object({
        code: z.string().regex(/^[A-Z0-9_/-]{2,30}$/),
        name: z.string().trim().min(2).max(120),
        kind: z.enum(['SELLING', 'BUYING']).default('SELLING'),
        currencyCode: z.string().length(3).optional(),
        customerId: uuid.nullish(),
        supplierId: uuid.nullish(),
        customerGroupId: uuid.nullish(),
        priceIncludesTax: z.boolean().optional(),
        validFrom: isoDate.nullish(),
        validTo: isoDate.nullish(),
        isDefault: z.boolean().optional(),
        status: status.optional(),
        items: z
          .array(
            z
              .object({
                itemId: uuid,
                uomCode: z.string().max(20),
                minQty: z.number().min(0).optional(),
                rate: money,
                discountPct: z.number().min(0).max(100).optional(),
                validFrom: isoDate.nullish(),
                validTo: isoDate.nullish(),
              })
              .strict(),
          )
          .max(500)
          .optional(),
      })
      .strict(),
    toCreate: (b) => ({
      ...pick(
        b,
        {
          code: 'code',
          name: 'name',
          kind: 'kind',
          currencyCode: 'currencyCode',
          customerId: 'customerId',
          supplierId: 'supplierId',
          customerGroupId: 'customerGroupId',
          priceIncludesTax: 'priceIncludesTax',
          validFrom: 'validFrom',
          validTo: 'validTo',
          isDefault: 'isDefault',
          status: 'status',
        },
        { validFrom: d as never, validTo: d as never },
      ),
      ...(Array.isArray(b.items)
        ? {
            items: {
              create: (b.items as Record<string, unknown>[]).map((i) => ({
                itemId: i.itemId,
                uomCode: i.uomCode,
                minQty: i.minQty ?? 0,
                rate: i.rate,
                discountPct: i.discountPct ?? 0,
                validFrom: i.validFrom ? d(String(i.validFrom)) : null,
                validTo: i.validTo ? d(String(i.validTo)) : null,
              })),
            },
          }
        : {}),
    }),
    toPatch: (b) =>
      pick(
        b,
        {
          name: 'name',
          priceIncludesTax: 'priceIncludesTax',
          validFrom: 'validFrom',
          validTo: 'validTo',
          isDefault: 'isDefault',
          status: 'status',
        },
        { validFrom: d as never, validTo: d as never },
      ),
    check: (b) => {
      if (b.validFrom && b.validTo && String(b.validTo) < String(b.validFrom)) {
        throw new AppError(422, 'PRICE_DATES', 'Valid To must be on or after Valid From.', {
          validTo: 'Valid To must be on or after Valid From.',
        });
      }
      for (const i of (b.items as Record<string, unknown>[] | undefined) ?? []) {
        if (i.validFrom && i.validTo && String(i.validTo) < String(i.validFrom)) {
          throw new AppError(422, 'PRICE_DATES', 'Valid To must be on or after Valid From.', {
            validTo: 'Valid To must be on or after Valid From.',
          });
        }
      }
    },
  },
];

const listQuery = z
  .object({
    q: z.string().trim().max(100).optional(),
    status: status.optional(),
    page: z.coerce.number().int().min(1).max(100000).default(1),
    size: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();
const idParams = z.object({ id: uuid }).strict();

function mapDbError(err: unknown): never {
  const msg = err instanceof Error ? err.message : '';
  if (/Unique constraint|unique_violation|P2002/i.test(msg)) {
    throw Errors.duplicate({ code: 'This code is already in use.' });
  }
  if (/Foreign key|P2003/i.test(msg))
    throw Errors.validation({ _: 'One of the chosen values does not exist.' });
  if (err instanceof AppError) throw err;
  throw err;
}

export function createSimpleMastersRouter(): Router {
  const router = Router();
  router.use(
    configs.map((c) => `/${c.path}`),
    authenticate,
    requirePasswordChanged,
  );

  for (const c of configs) {
    const base = `/${c.path}`;
    const own = (action: Action) => requirePageAction(c.page, action);
    const del = () => c.delegate();

    router.get(
      base,
      own('view'),
      validate({ query: listQuery }),
      asyncHandler(async (_req: Request, res: Response) => {
        const q = validated(res, 'query', listQuery);
        const where: Record<string, unknown> = {
          ...(c.path === 'hsn-sac' ||
          c.path === 'gst-rates' ||
          c.path === 'gst-registrations' ||
          c.path === 'item-groups' ||
          c.path === 'banks' ||
          c.path === 'territories' ||
          c.path === 'party-groups' ||
          c.path === 'payment-terms' ||
          c.path === 'price-lists'
            ? { deletedAt: null }
            : {}),
          ...(q.status ? { status: q.status } : {}),
          ...(q.q
            ? { OR: c.search.map((f) => ({ [f]: { contains: q.q, mode: 'insensitive' } })) }
            : {}),
        };
        const [rows, total] = await Promise.all([
          del().findMany({
            where,
            ...(c.include ? { include: c.include } : {}),
            orderBy: c.orderBy,
            skip: (q.page - 1) * q.size,
            take: q.size,
          }),
          del().count({ where }),
        ]);
        res
          .set('Cache-Control', 'no-store')
          .json({ data: rows, meta: { page: q.page, size: q.size, total } });
      }),
    );

    router.get(
      `${base}/:id`,
      own('view'),
      validate({ params: idParams }),
      asyncHandler(async (_req: Request, res: Response) => {
        const { id } = validated(res, 'params', idParams);
        const row = await del().findFirst({
          where: { id, deletedAt: null },
          ...(c.include ? { include: c.include } : {}),
        });
        if (!row) throw Errors.notFound(`${c.label} not found.`);
        res.set('ETag', `"${String(row.version ?? 1)}"`).json({ data: row });
      }),
    );

    router.post(
      base,
      own(c.writeAction === 'controls' ? 'controls' : 'add'),
      validate({ body: c.createSchema }),
      asyncHandler(async (req: Request, res: Response) => {
        const body = validated(res, 'body', c.createSchema) as Record<string, unknown>;
        const auth = requireAuth(req);
        await runIdempotent(req, res, auth.userId, `masters:${c.path}:create`, [body], async () => {
          await c.check?.(body);
          try {
            const row = await del().create({
              data: { ...c.toCreate(body), createdById: auth.userId, updatedById: auth.userId },
              ...(c.include ? { include: c.include } : {}),
            });
            await recordAudit({
              action: `${c.audit}_CREATED`,
              actorId: auth.userId,
              targetType: c.label,
              targetId: String(row.id),
              meta: requestMeta(req),
              detail: {
                code: String(row.code ?? ''),
                after: JSON.parse(JSON.stringify(body)) as never,
              },
            });
            return row as { version: number };
          } catch (err) {
            return mapDbError(err);
          }
        });
      }),
    );

    router.patch(
      `${base}/:id`,
      own(c.writeAction),
      validate({
        params: idParams,
        body:
          c.createSchema instanceof z.ZodObject
            ? c.createSchema.partial().strict()
            : c.createSchema,
      }),
      asyncHandler(async (req: Request, res: Response) => {
        const { id } = validated(res, 'params', idParams);
        const body = validated(res, 'body', c.createSchema) as Record<string, unknown>;
        const version = parseIfMatch(req.get('if-match'));
        const auth = requireAuth(req);
        const current = await del().findFirst({ where: { id, deletedAt: null } });
        if (!current) throw Errors.notFound(`${c.label} not found.`);
        if (Number(current.version) !== version) throw Errors.versionConflict();
        await c.check?.(body);
        const data = c.toPatch(body);
        if (Object.keys(data).length === 0) {
          res.set('ETag', `"${String(current.version)}"`).json({ data: current });
          return;
        }
        try {
          const updated = await del().update({
            where: { id },
            data: {
              ...data,
              version: { increment: 1 },
              updatedById: auth.userId,
              updatedAt: new Date(),
            },
            ...(c.include ? { include: c.include } : {}),
          });
          await recordAudit({
            action: `${c.audit}_UPDATED`,
            actorId: auth.userId,
            targetType: c.label,
            targetId: id,
            meta: requestMeta(req),
            detail: {
              code: String(updated.code ?? ''),
              after: JSON.parse(JSON.stringify(body)) as never,
            },
          });
          res.set('ETag', `"${String(updated.version)}"`).json({ data: updated });
        } catch (err) {
          mapDbError(err);
        }
      }),
    );

    router.delete(
      `${base}/:id`,
      own('delete'),
      validate({ params: idParams }),
      asyncHandler(async (req: Request, res: Response) => {
        const { id } = validated(res, 'params', idParams);
        const auth = requireAuth(req);
        const current = await del().findFirst({ where: { id, deletedAt: null } });
        if (!current) throw Errors.notFound(`${c.label} not found.`);
        await del().update({
          where: { id },
          data: { deletedAt: new Date(), deletedById: auth.userId, version: { increment: 1 } },
        });
        await recordAudit({
          action: `${c.audit}_DELETED`,
          actorId: auth.userId,
          targetType: c.label,
          targetId: id,
          meta: requestMeta(req),
          detail: { code: String(current.code ?? '') },
        });
        res.status(204).end();
      }),
    );
  }

  // ---- dated rates of an HSN code (adding one ends the open rate the day before) ----------------------------
  const rateBody = z
    .object({
      gstRateId: uuid,
      cessPct: z.union([z.number().min(0), z.string().regex(/^\d+(\.\d{1,4})?$/)]).optional(),
      conditionNote: z.string().max(200).nullish(),
      effectiveFrom: isoDate,
      effectiveTo: isoDate.nullish(),
    })
    .strict();
  router.use('/hsn-sac/:id/rates', authenticate, requirePasswordChanged);
  router.get(
    '/hsn-sac/:id/rates',
    requirePageAction('tax-hsn', 'view'),
    validate({ params: idParams }),
    asyncHandler(async (_req: Request, res: Response) => {
      const { id } = validated(res, 'params', idParams);
      res.json({
        data: await prisma.hsnSacRate.findMany({
          where: { hsnId: id },
          orderBy: { effectiveFrom: 'desc' },
        }),
      });
    }),
  );
  router.post(
    '/hsn-sac/:id/rates',
    requirePageAction('tax-hsn', 'edit'),
    validate({ params: idParams, body: rateBody }),
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = validated(res, 'params', idParams);
      const body = validated(res, 'body', rateBody);
      const auth = requireAuth(req);
      const row = await prisma.$transaction((tx) =>
        taxService.addHsnRate(
          id,
          { ...body, ...(body.cessPct === undefined ? {} : { cessPct: body.cessPct }) },
          auth.userId,
          tx,
        ),
      );
      await recordAudit({
        action: 'HSN_RATE_ADDED',
        actorId: auth.userId,
        targetType: 'HSN / SAC code',
        targetId: id,
        meta: requestMeta(req),
        detail: { effectiveFrom: body.effectiveFrom },
      });
      res.status(201).json({ data: row });
    }),
  );

  // ---- item UOM conversions --------------------------------------------------------------------------------
  const convBody = z
    .object({
      uomCode: z.string().max(20),
      factor: z.union([z.number().gt(0), z.string().regex(/^\d+(\.\d{1,6})?$/)]),
    })
    .strict();
  router.use('/items/:id/uom-conversions', authenticate, requirePasswordChanged);
  router.get(
    '/items/:id/uom-conversions',
    requirePageAction('inv-items', 'view'),
    validate({ params: idParams }),
    asyncHandler(async (_req: Request, res: Response) => {
      const { id } = validated(res, 'params', idParams);
      res.json({ data: await prisma.itemUomConversion.findMany({ where: { itemId: id } }) });
    }),
  );
  router.put(
    '/items/:id/uom-conversions',
    requirePageAction('inv-items', 'edit'),
    validate({
      params: idParams,
      body: z.object({ conversions: z.array(convBody).max(20) }).strict(),
    }),
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = validated(res, 'params', idParams);
      const body = validated(res, 'body', z.object({ conversions: z.array(convBody) }));
      const auth = requireAuth(req);
      const item = await prisma.item.findFirst({ where: { id, deletedAt: null } });
      if (!item) throw Errors.notFound('Item not found.');
      const seen = new Set<string>();
      for (const c of body.conversions) {
        if (c.uomCode === item.baseUom)
          throw Errors.validation({ uomCode: 'The base unit needs no conversion.' });
        if (seen.has(c.uomCode))
          throw Errors.validation({ uomCode: `${c.uomCode} is listed twice.` });
        seen.add(c.uomCode);
        const uom = await prisma.uom.findFirst({ where: { code: c.uomCode } });
        if (!uom)
          throw Errors.validation({ uomCode: `${c.uomCode} is not a known unit of measure.` });
      }
      await prisma.$transaction([
        prisma.itemUomConversion.deleteMany({ where: { itemId: id } }),
        prisma.itemUomConversion.createMany({
          data: body.conversions.map((c) => ({ itemId: id, uomCode: c.uomCode, factor: c.factor })),
        }),
      ]);
      await recordAudit({
        action: 'ITEM_UOM_CONVERSION_UPDATED',
        actorId: auth.userId,
        targetType: 'Item',
        targetId: id,
        meta: requestMeta(req),
        detail: { count: body.conversions.length },
      });
      res.json({ data: await prisma.itemUomConversion.findMany({ where: { itemId: id } }) });
    }),
  );

  return router;
}
