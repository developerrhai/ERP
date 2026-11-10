// Phase 20-E: Opaque keyset pagination cursors & 10,000+ capped count helpers (§5(a)).
import { Errors } from './errors';

export interface KeysetCursor {
  /** ISO date/timestamp or string sort key */
  s: string;
  /** Tie-breaker UUID */
  id: string;
}

export function encodeKeysetCursor(sortValue: Date | string, id: string): string {
  const s = sortValue instanceof Date ? sortValue.toISOString() : String(sortValue);
  return Buffer.from(JSON.stringify({ s, id }), 'utf8').toString('base64url');
}

export function decodeKeysetCursor(cursor: string): KeysetCursor {
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as { s?: unknown }).s === 'string' &&
      typeof (parsed as { id?: unknown }).id === 'string' &&
      /^[0-9a-f-]{36}$/i.test((parsed as { id: string }).id)
    ) {
      return { s: (parsed as { s: string }).s, id: (parsed as { id: string }).id };
    }
  } catch {
    // fall through
  }
  throw Errors.badRequest('Invalid pagination cursor.');
}

export const COUNT_DISPLAY_CAP = 10_000;

export function formatCappedCount(total: number): { total: number; totalDisplay: string; hasMoreThanCap: boolean } {
  if (total > COUNT_DISPLAY_CAP) {
    return { total, totalDisplay: '10,000+', hasMoreThanCap: true };
  }
  return { total, totalDisplay: total.toLocaleString('en-IN'), hasMoreThanCap: false };
}

