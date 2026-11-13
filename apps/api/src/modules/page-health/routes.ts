// Phase 22: GET /meta/registry (registry v2, any signed-in user) and GET /admin/page-health
// (crawler results of the latest run; needs view on admin-page-health).
import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { authenticate, requirePasswordChanged } from '../../core/auth/authenticate';
import { resolveContext } from '../../core/context/resolve-context';
import { prisma } from '../../core/db/prisma';
import { asyncHandler } from '../../core/http/async-handler';
import { validate, validated } from '../../core/http/validate';
import { escapeLike } from '../../core/http/query-safety';
import { requirePageAction } from '../../core/rbac/access';
import { loadRegistryV2 } from './registry-v2';

/** Page-load budget used to colour the p95 column (ms). The crawler measures with the real UI. */
export const PAGE_LOAD_BUDGET_MS = 2000;

const healthQuery = z
  .object({
    status: z.enum(['OK', 'ERROR']).optional(),
    role: z.string().max(32).optional(),
    q: z.string().max(60).optional(),
    page: z.coerce.number().int().min(1).max(100000).default(1),
    size: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();

interface HealthRow {
  page_id: string;
  role_code: string;
  unit_combo: string;
  status: string;
  error_kind: string | null;
  error_text: string | null;
  p95_ms: number | null;
  checked_at: Date;
}

export function createPageHealthRouter(): Router {
  const router = Router();
  router.use(['/admin/page-health'], authenticate, requirePasswordChanged);
  const r = Router();
  r.use(resolveContext);
  router.use('/admin/page-health', r);

  r.get(
    '/',
    requirePageAction('admin-page-health', 'view'),
    validate({ query: healthQuery }),
    asyncHandler(async (_req, res) => {
      const q = validated(res, 'query', healthQuery);
      const run = await prisma.$queryRaw<{ run_id: string; checked_at: Date }[]>`
        SELECT run_id, max(checked_at) AS checked_at FROM page_health
         GROUP BY run_id ORDER BY max(checked_at) DESC LIMIT 1`;
      const runId = run[0]?.run_id ?? null;
      if (runId === null) {
        res.json({
          data: [],
          meta: { page: 1, size: q.size, total: 0, runId: null, checkedAt: null, errors: 0, budgetMs: PAGE_LOAD_BUDGET_MS },
        });
        return;
      }
      const like = q.q ? `%${escapeLike(q.q)}%` : null;
      const where = Prisma.sql`run_id = ${runId}::uuid
        ${q.status ? Prisma.sql`AND status = ${q.status}` : Prisma.empty}
        ${q.role ? Prisma.sql`AND role_code = ${q.role}` : Prisma.empty}
        ${like ? Prisma.sql`AND page_id ILIKE ${like}` : Prisma.empty}`;
      const [rows, counts] = await Promise.all([
        prisma.$queryRaw<HealthRow[]>`
          SELECT page_id, role_code, unit_combo, status, error_kind, error_text, p95_ms, checked_at
            FROM page_health WHERE ${where}
           ORDER BY (status = 'ERROR') DESC, page_id, role_code, unit_combo
           LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size}`,
        prisma.$queryRaw<{ total: number; errors: number }[]>`
          SELECT count(*)::int AS total, count(*) FILTER (WHERE status = 'ERROR')::int AS errors
            FROM page_health WHERE run_id = ${runId}::uuid`,
      ]);
      const filtered = await prisma.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM page_health WHERE ${where}`;
      res.json({
        data: rows.map((h) => ({
          pageId: h.page_id,
          role: h.role_code,
          unitCombo: h.unit_combo,
          status: h.status,
          errorKind: h.error_kind,
          errorText: h.error_text,
          p95Ms: h.p95_ms,
          overBudget: h.p95_ms !== null && h.p95_ms > PAGE_LOAD_BUDGET_MS,
          checkedAt: h.checked_at.toISOString(),
        })),
        meta: {
          page: q.page,
          size: q.size,
          total: filtered[0]?.n ?? 0,
          runId,
          checkedAt: run[0]?.checked_at.toISOString() ?? null,
          pagesChecked: counts[0]?.total ?? 0,
          errors: counts[0]?.errors ?? 0,
          budgetMs: PAGE_LOAD_BUDGET_MS,
        },
      });
    }),
  );

  return router;
}

/** Mounted inside the /meta router (already authenticated). */
export function registryHandler() {
  return asyncHandler((_req, res) => {
    const reg = loadRegistryV2();
    res.json({ data: reg, meta: { total: reg.pages.length } });
    return Promise.resolve();
  });
}
