const STORED_ID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** The record of an audit row by its code / number when the entry carries it; a stored id is never shown to a person. */
export function auditRecord(detail: unknown, targetId: string | null): string {
  const d = (detail ?? {}) as { code?: unknown; number?: unknown; docNo?: unknown };
  const named = [d.code, d.number, d.docNo].find((v): v is string => typeof v === 'string' && v !== '' && !STORED_ID.test(v));
  return named ?? (targetId && !STORED_ID.test(targetId) ? targetId : '—');
}
