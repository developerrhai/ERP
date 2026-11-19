// The Settings tab of every page: which columns a user hides on a page (kept per user on the server, so it follows the user to
// any device; nothing is kept in the browser), and the company pick-lists - item, category, vendor and
// manufacturer - that are managed from that tab. Pages register their columns here so the Settings tab can list them.
import { useSyncExternalStore } from 'react';
import { api } from './api';

export interface ColumnInfo {
  key: string;
  label: string;
}

type Hidden = Record<string, string[]>;

let hidden: Hidden = {};
let version = 0;
const listeners = new Set<() => void>();
const registered = new Map<string, ColumnInfo[]>();
let loadedFromServer = false;
let saveTimer: ReturnType<typeof setTimeout> | undefined;

function emit(): void {
  version += 1;
  listeners.forEach((l) => l());
}
function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

function saveSoon(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void api<{ hidden: Hidden }>('/settings/columns', { method: 'PUT', body: { hidden } }).catch(() => undefined);
  }, 600);
}

/** Once per visit: take the user's saved choice from the server (it wins over this browser's copy). */
export function loadColumnPrefs(): void {
  if (loadedFromServer) return;
  loadedFromServer = true;
  void api<{ hidden: Hidden }>('/settings/columns')
    .then((r) => {
      if (r?.hidden && Object.keys(r.hidden).length > 0) {
        hidden = { ...hidden, ...r.hidden };
        emit();
      }
    })
    .catch(() => undefined);
}

export function registerColumns(pageId: string, cols: ColumnInfo[]): void {
  const next = cols.filter((c) => c.key && c.label);
  const prev = registered.get(pageId);
  if (prev && prev.length === next.length && prev.every((c, i) => c.key === next[i]?.key)) return;
  registered.set(pageId, next);
  emit();
}

export function columnsOf(pageId: string): ColumnInfo[] {
  return registered.get(pageId) ?? [];
}

export function hiddenOf(pageId: string): string[] {
  return hidden[pageId] ?? [];
}

export function setHiddenColumns(pageId: string, keys: string[]): void {
  const next = { ...hidden };
  if (keys.length === 0) delete next[pageId];
  else next[pageId] = [...new Set(keys)];
  hidden = next;
  saveSoon();
  emit();
}

/** The hidden column keys of a page (re-renders when the Settings tab changes them). */
export function useHiddenColumns(pageId: string): ReadonlySet<string> {
  useSyncExternalStore(subscribe, () => version, () => version);
  return new Set(hiddenOf(pageId));
}

/** The columns registered by the page body (re-renders when a page registers them). */
export function useRegisteredColumns(pageId: string): ColumnInfo[] {
  useSyncExternalStore(subscribe, () => version, () => version);
  return columnsOf(pageId);
}

// ---- pick-lists ---------------------------------------------------------------------------------------------------
export const LIST_KINDS = [
  { kind: 'item', label: 'Items' },
  { kind: 'category', label: 'Categories' },
  { kind: 'vendor', label: 'Vendors' },
  { kind: 'manufacturer', label: 'Manufacturers' },
] as const;
export type ListKind = (typeof LIST_KINDS)[number]['kind'];
export type PickLists = Record<ListKind, string[]>;

export const listsApi = {
  get: () => api<PickLists>('/settings/lists'),
  put: (kind: ListKind, values: string[]) => api<PickLists>(`/settings/lists/${kind}`, { method: 'PUT', body: { values } }),
};

/** Cleaned copy of a list: trimmed, no blanks, no case-insensitive duplicates (same rule as the API). */
export function cleanList(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const v = raw.trim().replace(/\s+/g, ' ');
    const k = v.toLowerCase();
    if (!v || seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}
