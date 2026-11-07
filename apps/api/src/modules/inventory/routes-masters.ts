// /inventory batches, serials, bins (pages inv-batch, inv-serial, wms-bins).
import type { Request, Response, Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../core/http/async-handler';
import { parseIfMatch } from '../../core/http/if-match';
import { validate, validated } from '../../core/http/validate';
import { requirePageAction } from '../../core/rbac/access';
import { callerOf, isoDate, pageQuery, uuid } from './routes-shared';
import { batchService, binService, serialService } from './masters-service';

const idParams = z.object({ id: uuid }).strict();
const ver = (req: Request): number => parseIfMatch(req.get('if-match')) ?? -1;

export function mountMastersRoutes(r: Router): void {
  // ---- batches ----
  const bq = z
    .object({
      q: z.string().trim().max(100).optional(),
      itemId: uuid.optional(),
      qcStatus: z.string().max(12).optional(),
      warehouseId: uuid.optional(),
      withStockOnly: z
        .enum(['true', 'false'])
        .transform((v) => v === 'true')
        .optional(),
      ...pageQuery,
    })
    .strict();
  r.get(
    '/batches',
    requirePageAction('inv-batch', 'view'),
    validate({ query: bq }),
    asyncHandler(async (_req: Request, res: Response) => {
      const q = validated(res, 'query', bq);
      const { rows, total } = await batchService.list(q);
      res.json({ data: rows, meta: { page: q.page, size: q.size, total } });
    }),
  );
  r.get(
    '/batches/:id',
    requirePageAction('inv-batch', 'view'),
    validate({ params: idParams }),
    asyncHandler(async (req: Request, res: Response) => {
      res.json({ data: await batchService.get(String(req.params.id)) });
    }),
  );
  const bp = z
    .object({
      supplierName: z.string().max(150).nullish(),
      grnRef: z.string().max(60).nullish(),
      notes: z.string().max(300).nullish(),
      disposition: z.string().max(20).nullish(),
    })
    .strict();
  r.patch(
    '/batches/:id',
    requirePageAction('inv-batch', 'edit'),
    validate({ params: idParams, body: bp }),
    asyncHandler(async (req: Request, res: Response) => {
      const b = await batchService.patch(
        callerOf(req),
        String(req.params.id),
        ver(req),
        validated(res, 'body', bp),
      );
      res.set('ETag', `"${b.version}"`).json({ data: await batchService.get(b.id) });
    }),
  );
  const qcBody = z
    .object({ to: z.enum(['Released', 'On Hold', 'Rejected']), reason: z.string().max(300) })
    .strict();
  r.post(
    '/batches/:id/qc',
    requirePageAction('inv-batch', 'approve'),
    validate({ params: idParams, body: qcBody }),
    asyncHandler(async (req: Request, res: Response) => {
      const b = validated(res, 'body', qcBody);
      const out = await batchService.setQc(
        callerOf(req),
        String(req.params.id),
        ver(req),
        b.to,
        b.reason,
      );
      res.json({ data: await batchService.get(out.id) });
    }),
  );
  const exBody = z.object({ expiryDate: isoDate, reason: z.string().max(300) }).strict();
  r.post(
    '/batches/:id/extend-expiry',
    requirePageAction('inv-batch', 'edit'),
    validate({ params: idParams, body: exBody }),
    asyncHandler(async (req: Request, res: Response) => {
      const b = validated(res, 'body', exBody);
      const out = await batchService.extendExpiry(
        callerOf(req),
        String(req.params.id),
        ver(req),
        b.expiryDate,
        b.reason,
      );
      res.json({ data: await batchService.get(out.id) });
    }),
  );
  const rcBody = z
    .object({
      action: z.enum(['start', 'close']),
      reason: z.string().max(300),
      closeTo: z.enum(['Released', 'Rejected']).optional(),
    })
    .strict();
  r.post(
    '/batches/:id/recall',
    requirePageAction('inv-batch', 'approve'),
    validate({ params: idParams, body: rcBody }),
    asyncHandler(async (req: Request, res: Response) => {
      const b = validated(res, 'body', rcBody);
      const out = await batchService.recall(
        callerOf(req),
        String(req.params.id),
        ver(req),
        b.action,
        b.reason,
        b.closeTo,
      );
      res.json({ data: { ...(await batchService.get(out.batch.id)), affected: out.affected } });
    }),
  );

  // ---- serials ----
  const sq = z
    .object({
      q: z.string().trim().max(100).optional(),
      itemId: uuid.optional(),
      status: z.string().max(12).optional(),
      warehouseId: uuid.optional(),
      ...pageQuery,
    })
    .strict();
  r.get(
    '/serials',
    requirePageAction('inv-serial', 'view'),
    validate({ query: sq }),
    asyncHandler(async (_req: Request, res: Response) => {
      const q = validated(res, 'query', sq);
      const { rows, total } = await serialService.list(q);
      res.json({ data: rows, meta: { page: q.page, size: q.size, total } });
    }),
  );
  r.get(
    '/serials/:id',
    requirePageAction('inv-serial', 'view'),
    validate({ params: idParams }),
    asyncHandler(async (req: Request, res: Response) => {
      res.json({ data: await serialService.history(String(req.params.id)) });
    }),
  );

  // ---- bins ----
  const binQ = z
    .object({
      q: z.string().trim().max(60).optional(),
      warehouseId: uuid.optional(),
      status: z.enum(['Active', 'Inactive']).optional(),
      ...pageQuery,
    })
    .strict();
  r.get(
    '/bins',
    requirePageAction('wms-bins', 'view'),
    validate({ query: binQ }),
    asyncHandler(async (_req: Request, res: Response) => {
      const q = validated(res, 'query', binQ);
      const { rows, total } = await binService.list(q);
      res.json({ data: rows, meta: { page: q.page, size: q.size, total } });
    }),
  );
  const binTypes = z.enum(['Storage', 'Staging', 'Quarantine', 'Pick Face']);
  const binB = z
    .object({
      warehouseId: uuid,
      code: z.string().min(1).max(30),
      name: z.string().max(100).nullish(),
      zone: z.string().max(30).nullish(),
      binType: binTypes.optional(),
      capacity: z.number().min(0).nullish(),
    })
    .strict();
  r.post(
    '/bins',
    requirePageAction('wms-bins', 'add'),
    validate({ body: binB }),
    asyncHandler(async (req: Request, res: Response) => {
      const b = await binService.create(callerOf(req), validated(res, 'body', binB));
      res.status(201).set('ETag', `"${b.version}"`).json({ data: b });
    }),
  );
  const binP = z
    .object({
      name: z.string().max(100).nullish(),
      zone: z.string().max(30).nullish(),
      binType: binTypes.optional(),
      capacity: z.number().min(0).nullish(),
      status: z.enum(['Active', 'Inactive']).optional(),
    })
    .strict();
  r.patch(
    '/bins/:id',
    requirePageAction('wms-bins', 'edit'),
    validate({ params: idParams, body: binP }),
    asyncHandler(async (req: Request, res: Response) => {
      const b = await binService.update(
        callerOf(req),
        String(req.params.id),
        ver(req),
        validated(res, 'body', binP),
      );
      res.set('ETag', `"${b.version}"`).json({ data: b });
    }),
  );
  r.delete(
    '/bins/:id',
    requirePageAction('wms-bins', 'delete'),
    validate({ params: idParams }),
    asyncHandler(async (req: Request, res: Response) => {
      await binService.remove(callerOf(req), String(req.params.id));
      res.status(204).end();
    }),
  );
}
