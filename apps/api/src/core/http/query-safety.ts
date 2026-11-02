// Shared guards for list endpoints: LIKE-wildcard escaping for free-text search (so `%`, `_` and `\`
// match literally instead of everything) and a cap on the paging offset (deep OFFSET scans are slow).
import { z } from 'zod';

/** Max rows skipped by paging: (page - 1) * size must not exceed this. */
export const MAX_OFFSET = 10_000;

/**
 * Escapes LIKE/ILIKE wildcards with a backslash, PostgreSQL's default escape character. Safe for
 * Prisma `contains` filters and for raw `ILIKE ... ESCAPE '\'`.
 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** Adds the offset cap to a {page, size} query schema (422 on `page` beyond the cap). */
export function offsetWithinCap(query: { page: number; size: number }, ctx: z.RefinementCtx): void {
  if ((query.page - 1) * query.size > MAX_OFFSET) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['page'],
      message: `Page too deep: at most ${MAX_OFFSET} rows can be skipped. Narrow the filters instead.`,
    });
  }
}
