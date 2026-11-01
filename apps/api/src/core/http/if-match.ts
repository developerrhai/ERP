// Optimistic-locking header parsing shared by every PATCH/PUT of a versioned row (Phase 1 §7,
// Phase 2 §3). Missing -> 400 "If-Match header required"; malformed -> 400.
import { Errors } from './errors';

/** Accepts `3`, `"3"` or `W/"3"`. Version 0 is allowed (a row that does not exist yet). */
export function parseIfMatch(header: string | undefined): number {
  if (header === undefined || header.trim() === '') {
    throw Errors.badRequest('If-Match header required');
  }
  const match = /^(?:W\/)?"?(\d{1,9})"?$/.exec(header.trim());
  if (!match?.[1]) throw Errors.badRequest('If-Match must be the record version number.');
  return Number(match[1]);
}

/** Optional variant (DELETE): undefined when absent, otherwise validated like parseIfMatch. */
export function parseOptionalIfMatch(header: string | undefined): number | undefined {
  if (header === undefined || header.trim() === '') return undefined;
  return parseIfMatch(header);
}
