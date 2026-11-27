// Route table for /lookups: items (`view` on inv-items) and warehouses (`view` on wms-warehouses, or a form that picks one),
// both after the unit / FY context is resolved. Strict query schemas; limit 1-50 (default 20).
import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { authenticate, requirePasswordChanged } from '../../../core/auth/authenticate';
import { requestMeta, requireAuth } from '../../../core/auth/auth-context';
import { resolveContext } from '../../../core/context/resolve-context';
import { asyncHandler } from '../../../core/http/async-handler';
import { Errors } from '../../../core/http/errors';
import { validate, validated } from '../../../core/http/validate';
import { accessUserOf, can } from '../../../core/rbac/access';
import { searchHsn } from '../../masters/current-gst';
import { lookupService } from './service';

const base = {
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
};
const itemsQuery = z.object(base).strict();
/** `tax=true` adds the item's HSN / SAC code and today's GST %, which document lines fill themselves with. */
const itemLinesQuery = z.object({ ...base, tax: z.enum(['true', 'false']).transform((v) => v === 'true').optional() }).strict();
const warehousesQuery = z
  .object({
    ...base,
    unitId: z.string().uuid('Invalid unit id.').optional(),
    any: z
      .enum(['true', 'false'])
      .transform((v) => v === 'true')
      .optional(),
  })
  .strict();

/** Pages whose forms pick an item on a line: their users need the item list (code, name, unit only) even without the Inventory pages (WF-04). */
const ITEM_PICKER_PAGES = ['sales-quotations', 'sales-orders', 'sales-enquiries', 'sales-dispatch', 'sales-invoices'] as const;

const canPickItems = asyncHandler(async (req: Request, _res: Response, next) => {
  if (!req.auth) throw Errors.unauthenticated();
  const user = accessUserOf(req.auth);
  if (await can(user, 'inv-items', 'view')) return next();
  for (const page of ITEM_PICKER_PAGES) {
    if ((await can(user, page, 'add')) || (await can(user, page, 'edit'))) return next();
  }
  throw Errors.forbidden();
});

/** Sales pages whose forms pick a warehouse: their users need its code and name, not the Warehouse pages. */
const WAREHOUSE_PICKER_PAGES = ['sales-returns'] as const;

const canPickWarehouses = asyncHandler(async (req: Request, res: Response, next) => {
  if (!req.auth) throw Errors.unauthenticated();
  const user = accessUserOf(req.auth);
  if (await can(user, 'wms-warehouses', 'view')) return next();
  for (const page of WAREHOUSE_PICKER_PAGES) {
    if ((await can(user, page, 'add')) || (await can(user, page, 'edit'))) {
      // only the form's own list: the plant in hand, never every plant at once
      res.locals.ownPlantOnly = true;
      return next();
    }
  }
  throw Errors.forbidden();
});

export function createLookupsRouter(): Router {
  const router = Router();
  router.use(authenticate, requirePasswordChanged, resolveContext);

  router.get(
    '/items',
    canPickItems,
    validate({ query: itemLinesQuery }),
    asyncHandler(async (_req: Request, res: Response) => {
      const query = validated(res, 'query', itemLinesQuery);
      res.json({ data: await lookupService.items(query) });
    }),
  );

  router.get(
    '/hsn-sac',
    canPickItems,
    validate({ query: itemsQuery }),
    asyncHandler(async (_req: Request, res: Response) => {
      const query = validated(res, 'query', itemsQuery);
      res.json({ data: await searchHsn(query.q ?? '', query.limit) });
    }),
  );

  router.get(
    '/warehouses',
    canPickWarehouses,
    validate({ query: warehousesQuery }),
    asyncHandler(async (req: Request, res: Response) => {
      const query = validated(res, 'query', warehousesQuery);
      if (!req.ctx) throw Errors.unauthenticated();
      const caller = { auth: requireAuth(req), ctx: req.ctx, meta: requestMeta(req) };
      const asked = res.locals.ownPlantOnly === true ? { ...query, any: false } : query;
      res.json({ data: await lookupService.warehouses(caller, asked) });
    }),
  );
  return router;
}
