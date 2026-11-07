// /inventory counts: cycle + weekly powder sheet (wms-cycle) and physical verification (wms-physical).
import type { Request, Response, Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../core/http/async-handler';
import { parseIfMatch } from '../../core/http/if-match';
import { validate, validated } from '../../core/http/validate';
import { requirePageAction } from '../../core/rbac/access';
import { countService } from './count-service';
import { callerOf, isoDate, pageQuery, qtyNum, uuid } from './routes-shared';

const idParams = z.object({ id: uuid }).strict();
const lineParams = z.object({ id: uuid, lineId: uuid }).strict();
const ver = (req: Request): number => parseIfMatch(req.get('if-match')) ?? -1;

export function mountCountsRoutes(r: Router): void {
  const lq = z
    .object({
      q: z.string().trim().max(60).optional(),
      status: z.string().max(14).optional(),
      countType: z.enum(['CYCLE', 'PHYSICAL', 'POWDER_WEEKLY']).optional(),
      ...pageQuery,
    })
    .strict();
  r.get(
    '/counts',
    requirePageAction('wms-cycle', 'view'),
    validate({ query: lq }),
    asyncHandler(async (req: Request, res: Response) => {
      const q = validated(res, 'query', lq);
      const { rows, total } = await countService.list(callerOf(req), q);
      res.json({ data: rows, meta: { page: q.page, size: q.size, total } });
    }),
  );
  r.get(
    '/counts/:id',
    requirePageAction('wms-cycle', 'view'),
    validate({ params: idParams }),
    asyncHandler(async (req: Request, res: Response) => {
      const c = await countService.get(callerOf(req), String(req.params.id));
      res.set('ETag', `"${c.version}"`).json({ data: c });
    }),
  );
  const cb = z
    .object({
      countType: z.enum(['CYCLE', 'PHYSICAL', 'POWDER_WEEKLY']),
      warehouseId: uuid,
      plannedDate: isoDate.optional(),
      itemIds: z.array(uuid).max(500).optional(),
      monthLabel: z
        .string()
        .regex(/^\d{4}-\d{2}$/)
        .nullish(),
      frequency: z.enum(['Weekly', 'Monthly', 'Quarterly', 'Yearly']).nullish(),
      blind: z.boolean().optional(),
      freezeWarehouse: z.boolean().optional(),
      tolerancePct: z.number().min(0).max(100).optional(),
      toleranceValue: z.number().min(0).optional(),
    })
    .strict();
  r.post(
    '/counts',
    requirePageAction('wms-cycle', 'add'),
    validate({ body: cb }),
    asyncHandler(async (req: Request, res: Response) => {
      const b = validated(res, 'body', cb);
      const c = await countService.create(callerOf(req), {
        ...b,
        monthLabel: b.monthLabel ?? null,
        frequency: b.frequency ?? null,
      });
      res.status(201).set('ETag', `"${c.version}"`).json({ data: c });
    }),
  );
  const step = (path: string, action: 'edit' | 'approve', fn: (req: Request) => Promise<unknown>) =>
    r.post(
      `/counts/:id/${path}`,
      requirePageAction('wms-cycle', action),
      validate({ params: idParams }),
      asyncHandler(async (req: Request, res: Response) => {
        res.json({ data: await fn(req) });
      }),
    );
  step('start', 'edit', (req) =>
    countService.start(callerOf(req), String(req.params.id), ver(req)),
  );
  step('review', 'edit', (req) =>
    countService.submitForReview(callerOf(req), String(req.params.id), ver(req)),
  );
  step('approve', 'approve', (req) =>
    countService.approve(callerOf(req), String(req.params.id), ver(req)),
  );
  step('cancel', 'edit', (req) =>
    countService.cancel(callerOf(req), String(req.params.id), ver(req)),
  );
  const pb = z
    .object({ lineIds: z.array(uuid).max(1000).optional() })
    .strict()
    .default({});
  r.post(
    '/counts/:id/post',
    requirePageAction('wms-cycle', 'post'),
    validate({ params: idParams, body: pb }),
    asyncHandler(async (req: Request, res: Response) => {
      res.json({
        data: await countService.post(
          callerOf(req),
          String(req.params.id),
          ver(req),
          validated(res, 'body', pb).lineIds,
        ),
      });
    }),
  );
  const clb = z.object({ closureNote: z.string().max(300) }).strict();
  r.post(
    '/counts/:id/close',
    requirePageAction('wms-cycle', 'edit'),
    validate({ params: idParams, body: clb }),
    asyncHandler(async (req: Request, res: Response) => {
      res.json({
        data: await countService.close(
          callerOf(req),
          String(req.params.id),
          ver(req),
          validated(res, 'body', clb).closureNote,
        ),
      });
    }),
  );
  const eb = z.object({ qty: qtyNum, remarks: z.string().max(300).nullish() }).strict();
  r.post(
    '/counts/:id/lines/:lineId/count',
    requirePageAction('wms-cycle', 'edit'),
    validate({ params: lineParams, body: eb }),
    asyncHandler(async (req: Request, res: Response) => {
      const b = validated(res, 'body', eb);
      res.json({
        data: await countService.enter(
          callerOf(req),
          String(req.params.id),
          String(req.params.lineId),
          b.qty,
          b.remarks,
        ),
      });
    }),
  );
}
