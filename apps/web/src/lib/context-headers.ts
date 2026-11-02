// The X-Unit-Id / X-FY-Id headers api.ts adds to every authenticated call (Phase 3 A2). Kept
// apart from the context store so api.ts does not import the store (no import cycle).
import type { CurrentContext } from '../types';

let current: CurrentContext | null = null;

export function setContextHeaders(next: CurrentContext | null): void {
  current = next;
}

/** "All Units" (unitId null) omits X-Unit-Id; before the context is known nothing is sent. */
export function contextHeaders(): Record<string, string> {
  if (!current) return {};
  const out: Record<string, string> = { 'X-FY-Id': current.fyId };
  if (current.unitId) out['X-Unit-Id'] = current.unitId;
  return out;
}
