// GET <family>/v40/:pageId?tab=<V40 tab name>: the V40 tab views of the Finance and Tax pages (see v40-engine.ts).
import type { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../core/http/async-handler';
import { validate, validated } from '../../core/http/validate';
import { requirePageAction } from '../../core/rbac/access';
import { callerOf, pageQuery } from '../inventory/routes-shared';
import { noSourceColumns, runV40 } from './v40-engine';
import type { PageDef } from './v40-engine';

const v40Q = z
  .object({
    tab: z.string().trim().max(60).default(''),
    first: z.enum(['0', '1']).default('0'),
    q: z.string().trim().max(100).optional(),
    status: z.string().max(24).optional(),
    ...pageQuery,
  })
  .strict();

export function mountV40(router: Router, path: string, defs: Record<string, PageDef>): void {
  router.get(
    path,
    (req, res, next) => {
      const pageId = String(req.params.pageId ?? '');
      if (!Object.hasOwn(defs, pageId)) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No V40 views for this page.' } });
        return;
      }
      requirePageAction(pageId, 'view')(req, res, next);
    },
    validate({ query: v40Q }),
    asyncHandler(async (req, res) => {
      const pageId = String(req.params.pageId);
      const q = validated(res, 'query', v40Q);
      const r = await runV40(callerOf(req), defs, pageId, {
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
          cards: r.cards,
          distribution: r.distribution,
          audit: r.audit,
          calendar: r.calendar,
          noSource: noSourceColumns(defs[pageId]),
        },
      });
    }),
  );
}
