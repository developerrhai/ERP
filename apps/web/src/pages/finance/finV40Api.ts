// Client of GET /finance/v40/:pageId and GET /tax/v40/:pageId - the V40 tab views of the Finance and Tax pages
// (apps/api/src/modules/finance/v40-engine.ts).
import { request } from '../../lib/api';

export type FinColType = 'text' | 'date' | 'inr' | 'num' | 'pill' | 'docs' | 'actions' | 'time';
export interface FinColumn {
  key: string;
  label: string;
  type: FinColType;
  /** false = V40 shows the column but the database has no source for it (a dash is shown) */
  source: boolean;
}
export type FinRow = Record<string, string | null> & { id: string; number: string; status: string };
export interface FinPanel {
  title: string;
  columns: FinColumn[];
  rows: (Record<string, string | null> & { id?: string })[];
}
export interface FinCard {
  label: string;
  value: string | null;
  type: 'inr' | 'num' | 'text';
}
export interface FinPage {
  rows: FinRow[];
  columns: FinColumn[];
  total: number;
  panel: FinPanel | null;
  cards: FinCard[];
  distribution: { label: string; count: number }[];
  audit: boolean;
  noSource: string[];
}

export const FINANCE_V40_IDS: ReadonlySet<string> = new Set([
  'fin-ap',
  'fin-ar',
  'fin-ageing',
  'fin-gl',
  'fin-cashbook',
  'fin-bankbook',
  'fin-journal',
  'fin-coa',
  'fin-costcenter',
  'fin-profitcenter',
  'fin-bankreco',
  'fin-creditnote',
  'fin-debitnote',
  'fin-expenses',
  'fin-budget',
  'fin-trial',
  'fin-pnl',
  'fin-bs',
  'fin-cashflow',
]);
export const TAX_V40_IDS: ReadonlySet<string> = new Set([
  'tax-salesreg',
  'tax-purchasereg',
  'tax-gstr1',
  'tax-gstr3b',
  'tax-tds',
  'tax-tcs',
  'tax-einvoice',
  'tax-eway',
  'tax-gst',
  'tax-hsn',
]);
export const hasFinV40 = (id: string): boolean => FINANCE_V40_IDS.has(id) || TAX_V40_IDS.has(id);

export async function getFinV40(
  pageId: string,
  p: { tab: string; first: boolean; q?: string; status?: string; page: number; size: number },
): Promise<FinPage> {
  const qs = new URLSearchParams({
    tab: p.tab,
    first: p.first ? '1' : '0',
    page: String(p.page),
    size: String(p.size),
  });
  if (p.q) qs.set('q', p.q);
  if (p.status) qs.set('status', p.status);
  const base = TAX_V40_IDS.has(pageId) ? 'tax' : 'finance';
  const r = await request<FinRow[]>(`/${base}/v40/${pageId}?${qs.toString()}`);
  const meta = (r.meta ?? {}) as unknown as Partial<FinPage>;
  return {
    rows: r.data,
    columns: meta.columns ?? [],
    total: meta.total ?? r.data.length,
    panel: meta.panel ?? null,
    cards: meta.cards ?? [],
    distribution: meta.distribution ?? [],
    audit: Boolean(meta.audit),
    noSource: meta.noSource ?? [],
  };
}
