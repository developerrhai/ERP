// Phase 22-A: one rule for every GET list - `limit` (alias of `size`) is at most 100.
//   ?limit=1000                -> 400 PAGE_LIMIT_TOO_LARGE "Maximum 100 rows per page."
//   ?size=101                  -> unchanged: each list's own schema answers 422 (existing contract)
//   ?limit=25 (no size)        -> read by existing handlers as size=25
// With no limit/size every list falls back to its own default (<= 25).
import type { NextFunction, Request, Response } from 'express';
import { MAX_LIMIT, parseLimit } from '../pagination';

/** Routes whose own schema already defines `limit` (lookups max 50, notifications): never rewritten. */
const NATIVE_LIMIT = /^\/(lookups|notifications|notification-preferences|inventory\/lookups)(\/|$)/;

export function listLimitGuard(req: Request, _res: Response, next: NextFunction): void {
  if (req.method !== 'GET' || NATIVE_LIMIT.test(req.path)) return next();
  const q = req.query as Record<string, unknown>;
  try {
    const raw = q.limit;
    if (typeof raw === 'string' && raw !== '') parseLimit(raw, MAX_LIMIT, MAX_LIMIT);
  } catch (e) {
    return next(e);
  }
  // handlers know `size`; strict query schemas would refuse the unknown `limit` key
  if (typeof q.limit === 'string' && q.limit !== '' && q.size === undefined) q.size = q.limit;
  delete q.limit;
  next();
}
