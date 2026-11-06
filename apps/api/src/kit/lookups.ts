// apps/api/src/kit/lookups.ts
// Kit lookup registry and /lookups/:slug router (docs/plans/07-ENGINE-KIT.md §2.7 & T-KIT-03)

import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { authenticate, requirePasswordChanged } from '../core/auth/authenticate';
import { requestMeta, requireAuth } from '../core/auth/auth-context';
import { resolveContext } from '../core/context/resolve-context';
import { prisma, type Db } from '../core/db/prisma';
import { asyncHandler } from '../core/http/async-handler';
import { Errors } from '../core/http/errors';
import { accessUserOf, can } from '../core/rbac/access';
import type { Caller } from '../modules/records/service';

export interface LookupItem {
  id: string;
  code: string;
  name: string;
  extra?: Record<string, string | number | null>;
}

export interface LookupDef {
  name: string;
  pageId: string;
  search: (
    db: Db,
    caller: Caller,
    q: string | undefined,
    limit: number,
    filters: Record<string, string>,
  ) => Promise<LookupItem[]>;
  byId?: (db: Db, ids: string[]) => Promise<LookupItem[]>;
  filters?: string[];
  includeInactive?: boolean;
}

/** Converts camelCase or mixed strings to kebab-case (e.g. purchaseOrders -> purchase-orders). */
export function toKebabCase(s: string): string {
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase();
}

/** Registry of active lookups, keyed by kebab-case slug. */
export const LOOKUP_REGISTRY = new Map<string, LookupDef>();
export const LOOKUP_NAMES = new Map<string, string>(); // name -> moduleName

export function clearKitLookupsForTest(): void {
  LOOKUP_REGISTRY.clear();
  LOOKUP_NAMES.clear();
}

export function createKitLookupsRouter(): Router {
  const router = Router();
  router.use(authenticate, requirePasswordChanged, resolveContext);

  router.get(
    '/:slug',
    asyncHandler(async (req: Request, res: Response) => {
      const slug = req.params.slug ?? '';
      const def = LOOKUP_REGISTRY.get(slug);
      if (!def) {
        throw Errors.notFound('Unknown lookup.');
      }

      if (!req.auth) throw Errors.unauthenticated();
      const user = req.auth.user;
      const allowed = await can(
        accessUserOf(req.auth),
        def.pageId,
        'view',
      );
      if (!allowed) {
        throw Errors.forbidden();
      }

      // Build query validation schema with declared filters and strict mode
      const filterShape: Record<string, z.ZodTypeAny> = {
        q: z.string().trim().max(100).optional(),
        limit: z.coerce.number().int().min(1).max(50).default(20),
      };

      for (const filterKey of def.filters ?? []) {
        filterShape[filterKey] = z.string().trim().max(64).optional();
      }

      const querySchema = z.object(filterShape).strict();
      const parsed = querySchema.safeParse(req.query);
      if (!parsed.success) {
        const fields: Record<string, string> = {};
        for (const issue of parsed.error.issues) {
          const path = issue.path.join('.') || '_';
          fields[path] = issue.message;
        }
        throw Errors.validation(fields);
      }

      const { q, limit, ...rawFilters } = parsed.data as {
        q?: string;
        limit: number;
        [k: string]: unknown;
      };

      const filters: Record<string, string> = {};
      for (const [k, v] of Object.entries(rawFilters)) {
        if (typeof v === 'string') filters[k] = v;
      }

      if (!req.ctx) throw Errors.unauthenticated();
      const caller: Caller = {
        auth: requireAuth(req),
        ctx: req.ctx,
        meta: requestMeta(req),
      };

      const items = await def.search(prisma, caller, q, limit, filters);
      res.json({ data: items });
    }),
  );

  return router;
}
