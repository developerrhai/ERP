// /inventory ageing, expiry, valuation, GL comparison, reorder, integrity, pre-flight, GL cut-over.
import type { Request, Response, Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../core/http/async-handler';
import { parseIfMatch } from '../../core/http/if-match';
import { validate, validated } from '../../core/http/validate';
import { requirePageAction } from '../../core/rbac/access';
import { cutoverService, preflight } from './ops-service';
import { ageing, expiry, glCompare, integrity, reorderService, valuation } from './reports-service';
import { callerOf, isoDate, pageQuery, qtyNum, uuid } from './routes-shared';
import { concreteUnit } from './typed';

const idParams = z.object({ id: uuid }).strict();

export function mountReportsRoutes(r: Router): void {
  const aq = z
    .object({ asOf: isoDate.optional(), warehouseId: uuid.optional(), ...pageQuery })
    .strict();
  r.get(
    '/reports/ageing',
    requirePageAction('inv-ageing', 'view'),
    validate({ query: aq }),
    asyncHandler(async (req: Request, res: Response) => {
      const q = validated(res, 'query', aq);
      const out = await ageing(callerOf(req), q);
      res.json({
        data: out.rows,
        meta: { page: q.page, size: q.size, total: out.total, asOf: out.asOf },
      });
    }),
  );
  const eq = z
    .object({
      asOf: isoDate.optional(),
      band: z.enum(['Expired', 'Critical', 'High', 'Medium', 'Low']).optional(),
      warehouseId: uuid.optional(),
      ...pageQuery,
    })
    .strict();
  r.get(
    '/reports/expiry',
    requirePageAction('inv-expiry', 'view'),
    validate({ query: eq }),
    asyncHandler(async (req: Request, res: Response) => {
      const q = validated(res, 'query', eq);
      const out = await expiry(callerOf(req), q);
      res.json({
        data: out.rows,
        meta: {
          page: q.page,
          size: q.size,
          total: out.total,
          asOf: out.asOf,
          expiredValue: out.expiredValue,
        },
      });
    }),
  );
  const vq = z
    .object({ from: isoDate, to: isoDate, warehouseId: uuid.optional(), ...pageQuery })
    .strict();
  r.get(
    '/reports/valuation',
    requirePageAction('inv-valuation', 'view'),
    validate({ query: vq }),
    asyncHandler(async (req: Request, res: Response) => {
      const q = validated(res, 'query', vq);
      const out = await valuation(callerOf(req), q);
      res.json({
        data: out.rows,
        meta: { page: q.page, size: q.size, total: out.total, from: out.from, to: out.to },
      });
    }),
  );
  const gq = z.object({ asOf: isoDate.optional() }).strict();
  r.get(
    '/reports/gl-compare',
    requirePageAction('inv-valuation', 'view'),
    validate({ query: gq }),
    asyncHandler(async (req: Request, res: Response) => {
      res.json({ data: await glCompare(callerOf(req), validated(res, 'query', gq).asOf) });
    }),
  );
  r.get(
    '/integrity',
    requirePageAction('inv-valuation', 'controls'),
    asyncHandler(async (_req: Request, res: Response) => {
      res.json({ data: await integrity() });
    }),
  );
  r.get(
    '/preflight',
    requirePageAction('inv-valuation', 'controls'),
    asyncHandler(async (_req: Request, res: Response) => {
      res.json({ data: await preflight() });
    }),
  );
  r.get(
    '/gl-cutover',
    requirePageAction('inv-valuation', 'controls'),
    validate({ query: gq }),
    asyncHandler(async (req: Request, res: Response) => {
      res.json({
        data: await cutoverService.plan(
          concreteUnit(callerOf(req)),
          validated(res, 'query', gq).asOf,
        ),
      });
    }),
  );
  const cb = z.object({ asOf: isoDate }).strict();
  r.post(
    '/gl-cutover',
    requirePageAction('inv-valuation', 'controls'),
    validate({ body: cb }),
    asyncHandler(async (req: Request, res: Response) => {
      res.status(201).json({
        data: await cutoverService.run(
          callerOf(req),
          concreteUnit(callerOf(req)),
          validated(res, 'body', cb).asOf,
        ),
      });
    }),
  );

  // ---- reorder ----
  const pq = z
    .object({ status: z.string().max(14).optional(), warehouseId: uuid.optional(), ...pageQuery })
    .strict();
  r.get(
    '/reorder/policies',
    requirePageAction('inv-reorder', 'view'),
    validate({ query: pq }),
    asyncHandler(async (req: Request, res: Response) => {
      const q = validated(res, 'query', pq);
      const out = await reorderService.list(callerOf(req), q);
      res.json({ data: out.rows, meta: { page: q.page, size: q.size, total: out.total } });
    }),
  );
  const pb = z
    .object({
      itemId: uuid,
      warehouseId: uuid,
      method: z.enum(['MIN_MAX', 'ROP_EOQ']).optional(),
      minQty: qtyNum.optional(),
      maxQty: qtyNum.optional(),
      leadTimeDays: z.number().int().min(0).max(365).optional(),
      serviceLevelPct: qtyNum.optional(),
      orderingCost: qtyNum.optional(),
      holdingCostPct: qtyNum.optional(),
      orderMultiple: qtyNum.optional(),
      preferredSupplierId: uuid.nullish(),
      status: z.enum(['Active', 'Inactive']).optional(),
    })
    .strict();
  r.post(
    '/reorder/policies',
    requirePageAction('inv-reorder', 'add'),
    validate({ body: pb }),
    asyncHandler(async (req: Request, res: Response) => {
      const p = await reorderService.save(callerOf(req), null, null, validated(res, 'body', pb));
      res
        .status(201)
        .set('ETag', `"${p.version}"`)
        .json({ data: { id: p.id, version: p.version } });
    }),
  );
  r.put(
    '/reorder/policies/:id',
    requirePageAction('inv-reorder', 'edit'),
    validate({ params: idParams, body: pb }),
    asyncHandler(async (req: Request, res: Response) => {
      const p = await reorderService.save(
        callerOf(req),
        String(req.params.id),
        parseIfMatch(req.get('if-match')) ?? -1,
        validated(res, 'body', pb),
      );
      res.set('ETag', `"${p.version}"`).json({ data: { id: p.id, version: p.version } });
    }),
  );
  r.post(
    '/reorder/recalculate',
    requirePageAction('inv-reorder', 'edit'),
    asyncHandler(async (_req: Request, res: Response) => {
      res.json({ data: await reorderService.recalculate() });
    }),
  );
  const sq = z
    .object({ status: z.enum(['Open', 'Converted', 'Dismissed']).optional(), ...pageQuery })
    .strict();
  r.get(
    '/reorder/suggestions',
    requirePageAction('inv-reorder', 'view'),
    validate({ query: sq }),
    asyncHandler(async (req: Request, res: Response) => {
      const q = validated(res, 'query', sq);
      const out = await reorderService.suggestions(callerOf(req), q);
      res.json({ data: out.rows, meta: { page: q.page, size: q.size, total: out.total } });
    }),
  );
  const rb = z
    .object({ action: z.enum(['convert', 'dismiss']), text: z.string().max(300) })
    .strict();
  r.post(
    '/reorder/suggestions/:id',
    requirePageAction('inv-reorder', 'edit'),
    validate({ params: idParams, body: rb }),
    asyncHandler(async (req: Request, res: Response) => {
      const b = validated(res, 'body', rb);
      const s = await reorderService.resolve(
        callerOf(req),
        String(req.params.id),
        b.action,
        b.text,
      );
      res.json({ data: { id: s.id, status: s.status } });
    }),
  );
}
