// Client of GET /sales/v40/:pageId - the V40 tab views of the CRM and Sales pages (apps/api/src/modules/sales/v40-views.ts).
import { request } from '../../lib/api';
import { FAM_V40_IDS } from '../v40fam/famIds';

export type V40ColType = 'text' | 'date' | 'inr' | 'num' | 'pill' | 'docs' | 'actions' | 'time';
export interface V40Column {
  key: string;
  label: string;
  type: V40ColType;
  /** false = V40 shows the column but the database has no source for it (a dash is shown) */
  source: boolean;
}
export type V40Row = Record<string, string | null> & { id: string; number: string; status: string };
export interface V40Panel {
  title: string;
  columns: V40Column[];
  rows: (Record<string, string | null> & { id?: string })[];
}
export interface V40Page {
  rows: V40Row[];
  columns: V40Column[];
  total: number;
  panel: V40Panel | null;
  audit: boolean;
  noSource: string[];
}
export interface V40Params {
  tab: string;
  first: boolean;
  q?: string;
  status?: string;
  page: number;
  size: number;
}

/** The pages the endpoint knows (the others keep their own body). */
export const SALES_V40_IDS: ReadonlySet<string> = new Set([
  'sales-orders',
  'sales-quotations',
  'sales-invoices',
  'sales-dispatch',
  'sales-collections',
  'crm-leads',
  'crm-opportunities',
  'crm-followups',
  'crm-meetings',
  'crm-feedback',
  'crm-sources',
  'master-customers',
  'crm-customer360',
  'sales-enquiries',
  'sales-reservations',
  'sales-delivery',
  'sales-credit',
  'sales-returns',
  'sales-pricelist',
]);

export async function getSalesV40(pageId: string, p: V40Params): Promise<V40Page> {
  const qs = new URLSearchParams({
    tab: p.tab,
    first: p.first ? '1' : '0',
    page: String(p.page),
    size: String(p.size),
  });
  if (p.q) qs.set('q', p.q);
  if (p.status) qs.set('status', p.status);

  // If this is an inventory module, /inventory/v40 returns { data: { columns, statuses, rows }, meta: { total, ... } }
  // where each row has { id, status, cells: { ... } }. We normalize it to V40Page (columns + flat row records).
  if (pageId.startsWith('inv-') || pageId === 'master-products' || pageId === 'master-materials') {
    const r = await request<{
      columns: { key: string; label: string; format?: string }[];
      statuses: string[];
      rows: { id: string | null; status?: string; cells: Record<string, unknown> }[];
    }>(`/inventory/v40/${pageId}?${qs.toString()}`);

    const meta = (r.meta ?? {}) as { total?: number };
    const rawData = r.data || { columns: [], statuses: [], rows: [] };
    const cols: V40Column[] = (rawData.columns || []).map((c) => ({
      key: c.key,
      label: c.label,
      type: c.format === 'money' ? 'inr' : c.format === 'qty' || c.format === 'days' ? 'num' : c.format === 'open' ? 'actions' : c.format === 'status' ? 'pill' : 'text',
      source: true,
    }));

    const rows: V40Row[] = (rawData.rows || []).map((row, idx) => {
      const rowId = row.id || `inv-row-${idx + 1}`;
      const recNo = String(row.cells?.itemCode || row.cells?.txnId || row.cells?.openingRef || row.cells?.adjNo || row.cells?.transferNo || row.cells?.resNo || row.cells?.reconNo || row.cells?.batchNo || row.cells?.serialNo || rowId);
      const rowStatus = String(row.status || row.cells?.status || 'Active');
      const flatCells: Record<string, string | null> = { id: rowId, number: recNo, status: rowStatus };
      for (const [k, v] of Object.entries(row.cells || {})) {
        flatCells[k] = v === null || v === undefined ? null : String(v);
      }
      return flatCells as V40Row;
    });

    return {
      rows,
      columns: cols,
      total: meta.total ?? rows.length,
      panel: null,
      audit: false,
      noSource: [],
    };
  }

  const base = pageId.startsWith('qms-')
    ? '/qms'
    : pageId.startsWith('tax-')
      ? '/tax'
      : SALES_V40_IDS.has(pageId)
        ? '/sales'
        : FAM_V40_IDS.has(pageId)
          ? '/fam'
          : '/sales';
  const r = await request<V40Row[]>(`${base}/v40/${pageId}?${qs.toString()}`);
  const meta = (r.meta ?? {}) as unknown as Partial<V40Page> & { total?: number };
  return {
    rows: r.data,
    columns: meta.columns ?? [],
    total: meta.total ?? r.data.length,
    panel: meta.panel ?? null,
    audit: Boolean(meta.audit),
    noSource: meta.noSource ?? [],
  };
}
