// /inventory reservations, holds, availability, stock-status change, scan (pages inv-reservation, inv-stock, wms-barcode).
import { randomUUID } from 'node:crypto';
import type { Request, Response, Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../core/db/prisma';
import { asyncHandler } from '../../core/http/async-handler';
import { Errors } from '../../core/http/errors';
import { parseIfMatch } from '../../core/http/if-match';
import { validate, validated } from '../../core/http/validate';
import { requirePageAction } from '../../core/rbac/access';
import { D } from './money';
import { holdService, reservationService } from './reservations-service';
import { callerOf, isoDate, pageQuery, qtyNum, uuid } from './routes-shared';
import { scan } from './scan-service';
import { availability, StockService } from './stock/stock-service';
import { concreteUnit } from './typed';

const idParams = z.object({ id: uuid }).strict();
const ver = (req: Request): number => parseIfMatch(req.get('if-match')) ?? -1;
const statusEnum = z.enum(['UNRESTRICTED', 'QUALITY_INSPECTION', 'BLOCKED']);

export function mountStockRoutes(r: Router): void {
  const rq = z
    .object({
      q: z.string().trim().max(100).optional(),
      status: z.string().max(12).optional(),
      itemId: uuid.optional(),
      warehouseId: uuid.optional(),
      ...pageQuery,
    })
    .strict();
  r.get(
    '/reservations',
    requirePageAction('inv-reservation', 'view'),
    validate({ query: rq }),
    asyncHandler(async (req: Request, res: Response) => {
      const q = validated(res, 'query', rq);
      const { rows, total } = await reservationService.list(callerOf(req), q);
      res.json({ data: rows, meta: { page: q.page, size: q.size, total } });
    }),
  );
  const rb = z
    .object({
      itemId: uuid,
      warehouseId: uuid,
      batchId: uuid.nullish(),
      requiredQty: qtyNum,
      priority: z.enum(['Critical', 'High', 'Medium', 'Low']).optional(),
      reservedUntil: isoDate.nullish(),
      demandType: z.string().max(30).optional(),
      demandRef: z.string().max(60).nullish(),
    })
    .strict();
  r.post(
    '/reservations',
    requirePageAction('inv-reservation', 'add'),
    validate({ body: rb }),
    asyncHandler(async (req: Request, res: Response) => {
      const c = await reservationService.create(callerOf(req), validated(res, 'body', rb));
      res.status(201).set('ETag', `"${c.version}"`).json({ data: c });
    }),
  );
  const rel = z.object({ reason: z.string().max(300) }).strict();
  r.post(
    '/reservations/:id/release',
    requirePageAction('inv-reservation', 'edit'),
    validate({ params: idParams, body: rel }),
    asyncHandler(async (req: Request, res: Response) => {
      res.json({
        data: await reservationService.release(
          callerOf(req),
          String(req.params.id),
          ver(req),
          validated(res, 'body', rel).reason,
        ),
      });
    }),
  );
  const ext = z.object({ days: z.number().int().min(1).max(90) }).strict();
  r.post(
    '/reservations/:id/extend',
    requirePageAction('inv-reservation', 'edit'),
    validate({ params: idParams, body: ext }),
    asyncHandler(async (req: Request, res: Response) => {
      res.json({
        data: await reservationService.extend(
          callerOf(req),
          String(req.params.id),
          ver(req),
          validated(res, 'body', ext).days,
        ),
      });
    }),
  );

  const hq = z
    .object({ status: z.string().max(10).optional(), itemId: uuid.optional(), ...pageQuery })
    .strict();
  r.get(
    '/holds',
    requirePageAction('inv-reservation', 'view'),
    validate({ query: hq }),
    asyncHandler(async (req: Request, res: Response) => {
      const q = validated(res, 'query', hq);
      const { rows, total } = await holdService.list(callerOf(req), q);
      res.json({ data: rows, meta: { page: q.page, size: q.size, total } });
    }),
  );
  const hb = z
    .object({
      itemId: uuid,
      warehouseId: uuid,
      batchId: uuid.nullish(),
      qty: qtyNum,
      reason: z.string().max(300),
    })
    .strict();
  r.post(
    '/holds',
    requirePageAction('inv-reservation', 'add'),
    validate({ body: hb }),
    asyncHandler(async (req: Request, res: Response) => {
      const h = await holdService.place(callerOf(req), validated(res, 'body', hb));
      res.status(201).json({ data: { id: h.id, code: h.code, version: h.version } });
    }),
  );
  r.post(
    '/holds/:id/release',
    requirePageAction('inv-reservation', 'edit'),
    validate({ params: idParams }),
    asyncHandler(async (req: Request, res: Response) => {
      const h = await holdService.release(callerOf(req), String(req.params.id), ver(req));
      res.json({ data: { id: h.id, status: h.status, version: h.version } });
    }),
  );

  // Availability of one item in one warehouse (voucher and reservation screens).
  const av = z.object({ itemId: uuid, warehouseId: uuid }).strict();
  r.get(
    '/availability',
    requirePageAction('inv-stock', 'view'),
    validate({ query: av }),
    asyncHandler(async (_req: Request, res: Response) => {
      const q = validated(res, 'query', av);
      const a = await availability(prisma, q.itemId, q.warehouseId);
      res.json({
        data: Object.fromEntries(
          Object.entries(a).map(([k, v]) => [k, (v as { toNumber(): number }).toNumber()]),
        ),
      });
    }),
  );

  // Quality Inspection -> Unrestricted / Blocked (the Phase 12 Usage Decision calls the same StockService method).
  const sc = z
    .object({
      itemId: uuid,
      warehouseId: uuid,
      batchId: uuid.nullish(),
      binId: uuid.nullish(),
      qty: qtyNum,
      from: statusEnum,
      to: statusEnum,
      reason: z.string().min(3).max(300),
    })
    .strict();
  r.post(
    '/stock-status',
    requirePageAction('inv-stock', 'approve'),
    validate({ body: sc }),
    asyncHandler(async (req: Request, res: Response) => {
      const b = validated(res, 'body', sc);
      const caller = callerOf(req);
      const unitId = concreteUnit(caller);
      const wh = await prisma.warehouse.findFirst({
        where: { id: b.warehouseId, deletedAt: null },
      });
      if (!wh || wh.unitId !== unitId)
        throw Errors.contextInvalid('This warehouse belongs to another unit. Switch unit first.');
      const voucherId = randomUUID();
      await prisma.$transaction(async (tx) => {
        await StockService.changeStatus(tx, {
          itemId: b.itemId,
          warehouseId: b.warehouseId,
          batchId: b.batchId ?? null,
          binId: b.binId ?? null,
          qty: D(b.qty),
          from: b.from,
          to: b.to,
          postingDate: new Date().toISOString().slice(0, 10),
          voucherId,
          voucherNo: `STS-${voucherId.slice(0, 8).toUpperCase()}`,
          createdById: caller.auth.userId,
        });
        await StockService.assertEquality(tx, [b]);
      });
      res.json({ data: { ok: true } });
    }),
  );

  const sb = z
    .object({
      raw: z.string().min(1).max(300),
      context: z.enum(['LOOKUP', 'RECEIVE', 'COUNT', 'TRANSFER', 'ISSUE']).default('LOOKUP'),
      warehouseId: uuid.optional(),
      expectItemId: uuid.optional(),
    })
    .strict();
  r.post(
    '/scan',
    requirePageAction('wms-barcode', 'view'),
    validate({ body: sb }),
    asyncHandler(async (req: Request, res: Response) => {
      res.json({ data: await scan(callerOf(req), validated(res, 'body', sb)) });
    }),
  );
}
