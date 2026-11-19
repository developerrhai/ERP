// Keeps records a user adds, edits or deletes on the sample-data registers (Service, Documents, Communication,
// Projects, Payroll, Assets ...) so they are still there after a reload (QA report: new records were lost).
// The data is stored per register in this browser; registers backed by the database are not affected because
// the overlay only adds the user's own rows and hides/patches rows by id.
import type { V40Row } from '../sales/salesV40Api';

interface Overlay {
  added: V40Row[];
  edits: Record<string, Partial<V40Row>>;
  deleted: string[];
}

const key = (pageId: string): string => `erp.v40.records.${pageId}`;

function read(pageId: string): Overlay {
  try {
    const raw = window.localStorage.getItem(key(pageId));
    if (!raw) return { added: [], edits: {}, deleted: [] };
    const o = JSON.parse(raw) as Partial<Overlay>;
    return { added: o.added ?? [], edits: o.edits ?? {}, deleted: o.deleted ?? [] };
  } catch {
    return { added: [], edits: {}, deleted: [] };
  }
}

function write(pageId: string, o: Overlay): void {
  try {
    window.localStorage.setItem(key(pageId), JSON.stringify(o));
  } catch {
    /* storage blocked or full: the record still shows for this visit */
  }
}

/** Rows as loaded + the user's own changes. */
export function applyRecordOverlay(pageId: string, rows: V40Row[]): V40Row[] {
  const o = read(pageId);
  if (!o.added.length && !o.deleted.length && !Object.keys(o.edits).length) return rows;
  const gone = new Set(o.deleted);
  const patched = rows.filter((r) => !gone.has(r.id)).map((r) => (o.edits[r.id] ? ({ ...r, ...o.edits[r.id] } as V40Row) : r));
  const have = new Set(patched.map((r) => r.id));
  return [...o.added.filter((r) => !have.has(r.id) && !gone.has(r.id)), ...patched];
}

export function saveAddedRecord(pageId: string, row: V40Row): void {
  const o = read(pageId);
  o.added = [row, ...o.added.filter((r) => r.id !== row.id)];
  write(pageId, o);
}

export function saveEditedRecord(pageId: string, id: string, patch: Partial<V40Row>): void {
  const o = read(pageId);
  const added = o.added.findIndex((r) => r.id === id);
  if (added >= 0) o.added[added] = { ...o.added[added], ...patch } as V40Row;
  else o.edits[id] = { ...(o.edits[id] ?? {}), ...patch };
  write(pageId, o);
}

export function saveDeletedRecords(pageId: string, ids: string[]): void {
  const o = read(pageId);
  const drop = new Set(ids);
  o.added = o.added.filter((r) => !drop.has(r.id));
  o.deleted = Array.from(new Set([...o.deleted, ...ids]));
  write(pageId, o);
}
