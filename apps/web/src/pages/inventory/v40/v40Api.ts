// Client of /inventory/v40: the V40 tab layouts of the Inventory pages (columns + real rows) and the Allocate button.
import { api, request } from '../../../lib/api';

export type V40Format =
  | 'text'
  | 'qty'
  | 'money'
  | 'date'
  | 'datetime'
  | 'days'
  | 'status'
  | 'allocate'
  | 'open';

export interface V40Column {
  key: string;
  label: string;
  format: V40Format;
}

export interface V40TabRow {
  id: string | null;
  status?: string;
  alloc: { itemId: string; warehouseId: string | null } | null;
  /** In-app page that owns the record (defaults to the page the tab belongs to). */
  page?: string | null;
  version?: number | null;
  cells: Record<string, unknown>;
}

export interface V40Total {
  label: string;
  value: number;
  format: 'qty' | 'money';
}

export interface V40Answer {
  columns: V40Column[];
  statuses: string[];
  rows: V40TabRow[];
  total: number;
  totals: V40Total[];
}

export async function getV40Tab(
  pageId: string,
  tab: string,
  q: { q?: string; status?: string; page: number; size: number; from?: string; to?: string },
): Promise<V40Answer> {
  const p = new URLSearchParams({ tab, page: String(q.page), size: String(q.size) });
  if (q.from) p.set('from', q.from);
  if (q.to) p.set('to', q.to);
  if (q.q) p.set('q', q.q);
  if (q.status) p.set('status', q.status);
  const res = await request<Omit<V40Answer, 'total' | 'totals'>>(`/inventory/v40/${encodeURIComponent(pageId)}?${p.toString()}`);
  const meta = (res.meta ?? {}) as { total?: number; totals?: V40Total[] };
  return { ...res.data, total: meta.total ?? res.data.rows.length, totals: meta.totals ?? [] };
}

export interface AllocateResult {
  warehouses: number;
  reservedBefore: number;
  reservedAfter: number;
  allocated: number;
  waiting: number;
}

export function allocateStock(itemId: string, warehouseId: string | null): Promise<AllocateResult> {
  return api<AllocateResult>('/inventory/v40/allocate', { method: 'POST', body: { itemId, warehouseId } });
}
