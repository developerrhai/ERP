// Route table for /lookups: items (`view` on inv-items) and warehouses (`view` on wms-warehouses),
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
import { requirePageAction } from '../../../core/rbac/access';
import { lookupService } from './service';

const base = {
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
};
const itemsQuery = z.object(base).strict();
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

export function createLookupsRouter(): Router {
  const router = Router();
  router.use(authenticate, requirePasswordChanged, resolveContext);

  router.get(
    '/items',
    requirePageAction('inv-items', 'view'),
    validate({ query: itemsQuery }),
    asyncHandler(async (_req: Request, res: Response) => {
      const query = validated(res, 'query', itemsQuery);
      res.json({ data: await lookupService.items(query) });
    }),
  );

  router.get(
    '/warehouses',
    requirePageAction('wms-warehouses', 'view'),
    validate({ query: warehousesQuery }),
    asyncHandler(async (req: Request, res: Response) => {
      const query = validated(res, 'query', warehousesQuery);
      if (!req.ctx) throw Errors.unauthenticated();
      const caller = { auth: requireAuth(req), ctx: req.ctx, meta: requestMeta(req) };
      res.json({ data: await lookupService.warehouses(caller, query) });
    }),
  );
  return router;
}
