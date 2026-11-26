// /inventory/v40/...: the V40 tab layouts of the Inventory pages (columns + real rows per tab) and the Allocate / Reallocate
// button of their rows. Read access follows the page permission; Allocate needs "edit" on Stock Reservation.
import type { NextFunction, Request, Response, Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../../core/http/async-handler';
import { Errors } from '../../../core/http/errors';
import { validate, validated } from '../../../core/http/validate';
import { requirePageAction } from '../../../core/rbac/access';
import { callerOf, isoDate, pageQuery, uuid } from '../routes-shared';
import { runDataset } from './datasets';
import { PAGES, resolveCols, specFor } from './model';
import { allocateStock } from './allocate';
import { holderScope } from '../../work/holder-filter';
import { SUMMARY_PAGES, workspaceSummary } from './summary';

const params = z.object({ pageId: z.string().max(40) }).strict();
const query = z
  .object({
    tab: z.string().trim().max(60).optional(),
    q: z.string().trim().max(100).optional(),
    status: z.string().trim().max(30).optional(),
    /** Department Filter of the item / stock pages. */
    department: z.string().trim().min(1).max(60).optional(),
    /** Valuation only: the period (defaults to the financial year so far). */
    from: isoDate.optional(),
    to: isoDate.optional(),
    ...pageQuery,
  })
  .strict();
const body = z.object({ itemId: uuid, warehouseId: uuid.nullish() }).strict();

/** Product / Raw Material Master are views of the item master: they use the Item / SKU Master permission. */
const PERMISSION_PAGE: Record<string, string> = { 'master-products': 'inv-items', 'master-materials': 'inv-items' };

export function mountV40Routes(r: Router): void {
  const viewGuards = new Map(
    Object.keys(PAGES).map((id) => [id, requirePageAction(PERMISSION_PAGE[id] ?? id, 'view')] as const),
  );
  r.get(
    '/v40/:pageId/summary',
    validate({ params }),
    (req: Request, res: Response, next: NextFunction) => {
      const guard = SUMMARY_PAGES.has(String(req.params.pageId)) ? viewGuards.get(String(req.params.pageId)) : undefined;
      if (guard) guard(req, res, next);
      else next(Errors.notFound('This page has no summary.'));
    },
    asyncHandler(async (req: Request, res: Response) => {
      const { pageId } = validated(res, 'params', params);
      res.set('Cache-Control', 'no-store').json({ data: await workspaceSummary(callerOf(req), pageId) });
    }),
  );

  r.get(
    '/v40/:pageId',
    validate({ params, query }),
    (req: Request, _res: Response, next: NextFunction) => {
      if (!PAGES[String(req.params.pageId)]) next(Errors.notFound('This page has no V40 tab layouts.'));
      else next();
    },
    (req: Request, res: Response, next: NextFunction) => {
      const guard = viewGuards.get(String(req.params.pageId));
      if (guard) guard(req, res, next);
      else next(Errors.notFound('This page has no V40 tab layouts.'));
    },
    asyncHandler(async (req: Request, res: Response) => {
      const { pageId } = validated(res, 'params', params);
      const q = validated(res, 'query', query);
      const page = PAGES[pageId];
      const spec = specFor(pageId, q.tab ?? '');
      if (!page || !spec) throw Errors.notFound('This page has no V40 tab layouts.');
      const held = q.department
        ? await holderScope(pageId === 'inv-stock' ? 'inv-stock' : 'inv-items', q.department, 'Warehouse')
        : undefined;
      const out = await runDataset(
        spec.dataset,
        callerOf(req),
        { q: q.q, status: q.status, variant: spec.variant, from: q.from, to: q.to, held, page: q.page, size: q.size },
        page,
        pageId,
      );
      res.json({
        data: {
          columns: resolveCols(spec),
          statuses: spec.statuses ?? [],
          rows: out.rows,
        },
        meta: { page: q.page, size: q.size, total: out.total, tab: q.tab ?? null, totals: out.totals ?? [] },
      });
    }),
  );

  r.post(
    '/v40/allocate',
    requirePageAction('inv-reservation', 'edit'),
    validate({ body }),
    asyncHandler(async (req: Request, res: Response) => {
      const b = validated(res, 'body', body);
      res.json({ data: await allocateStock(callerOf(req), b.itemId, b.warehouseId ?? null) });
    }),
  );
}
