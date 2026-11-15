// GET <base>/v40/:pageId?tab=<V40 tab name> for the Manufacturing, Quality and Maintenance families. Same answer shape as
// GET /sales/v40/:pageId (columns + rows + panel); the engine is runV40View in sales/v40-views.ts.
import type { RequestHandler, Request, Response, Router } from 'express';
import { z } from 'zod';
import { validate, validated } from '../core/http/validate';
import { callerOf, pageQuery } from './inventory/routes-shared';
import { noSourceColumns, runV40View } from './sales/v40-views';
import type { PageDef } from './sales/v40-views';

const v40Q = z
  .object({
    tab: z.string().trim().max(60).default(''),
    first: z.enum(['0', '1']).default('0'),
    q: z.string().trim().max(100).optional(),
    status: z.string().max(24).optional(),
    ...pageQuery,
  })
  .strict();

export function mountV40(
  router: Router,
  base: string,
  pages: Record<string, PageDef>,
  g: (page: string, action: 'view') => RequestHandler,
  h: (fn: (req: Request, res: Response) => Promise<unknown>) => RequestHandler,
  /** permission page when it differs from the page id */
  guards: Record<string, string> = {},
): void {
  router.get(
    `${base}/v40/:pageId`,
    (req, res, next) => {
      const pageId = String(req.params.pageId ?? '');
      if (!pages[pageId]) {
        res
          .status(404)
          .json({ error: { code: 'NOT_FOUND', message: 'No V40 views for this page.' } });
        return;
      }
      g(guards[pageId] ?? pageId, 'view')(req, res, next);
    },
    validate({ query: v40Q }),
    h(async (req, res) => {
      const pageId = String(req.params.pageId);
      const q = validated(res, 'query', v40Q);
      const def = pages[pageId]!;
      const r = await runV40View(def, callerOf(req), pageId, {
        tab: q.tab,
        first: q.first === '1',
        q: q.q,
        status: q.status,
        page: q.page,
        size: q.size,
      });
      res.json({
        data: r.rows,
        meta: {
          page: q.page,
          size: q.size,
          total: r.total,
          columns: r.columns,
          panel: r.panel ?? null,
          audit: r.audit,
          noSource: noSourceColumns(pageId, pages),
        },
      });
    }),
  );
}
