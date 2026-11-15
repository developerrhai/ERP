// Types, number formatting and the plain statistics used by the BI / AI dashboards.
// All inputs are rows the API computed from real records; this file only summarises them (no invented numbers).
export type ColType = 'text' | 'inr' | 'int' | 'pct' | 'num' | 'date';
export interface Col {
  key: string;
  label: string;
  type: ColType;
}
export type Cell = string | number | null;
export type Row = Record<string, Cell>;
export interface Dataset {
  columns: Col[];
  rows: Row[];
}
export interface Kpi {
  label: string;
  value: number | null;
  type: ColType;
  hint: string;
}
export interface Analytics {
  kind: string;
  generatedAt: string;
  scope: 'ALL_UNITS' | 'UNIT';
  notes: string[];
  kpis: Kpi[];
  datasets: Record<string, Dataset>;
}
export interface Finding {
  module: string;
  type: string;
  severity: 'High' | 'Medium' | 'Low';
  finding: string;
  confidence: number | null;
  evidence: string;
}
export interface AiOverview {
  generatedAt: string;
  health: number;
  dataQuality: number | null;
  findings: Finding[];
  moduleRisk: Array<{ module: string; risk: number }>;
  trend: Array<{ label: string; value: number }>;
  trendLabel: string;
  governance: { aiEnabled: boolean; externalModel: boolean; userCostInr: number; orgCostInr: number; userCap: number; orgCap: number };
  skipped: string[];
}

export function fmt(value: Cell | undefined, type: ColType): string {
  if (value === null || value === undefined || value === '') return '—';
  if (type === 'text') return String(value);
  if (type === 'date') return String(value).slice(0, 10);
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  if (type === 'inr') return `₹ ${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
  if (type === 'pct') return `${n.toLocaleString('en-IN', { maximumFractionDigits: 1 })}%`;
  if (type === 'int') return n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
  return n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

/** Compact axis labels: 1.2L, 3.4Cr (Indian grouping). */
export function compact(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e7) return `${+(n / 1e7).toFixed(1)}Cr`;
  if (a >= 1e5) return `${+(n / 1e5).toFixed(1)}L`;
  if (a >= 1e3) return `${+(n / 1e3).toFixed(1)}K`;
  return `${+n.toFixed(1)}`;
}

export interface Stats {
  records: number;
  /** numeric values of the primary metric, in row order (nulls skipped) */
  values: number[];
  avg: number | null;
  min: number | null;
  max: number | null;
  outliers: number;
  flagged: number;
  completeness: number;
  risk: number;
  /** last 20 values and the fitted straight line over them */
  recent: number[];
  trend: number[];
  slope: number;
  direction: 'Increasing' | 'Decreasing' | 'Flat' | '—';
  /** R squared of the straight-line fit, 0-100, or null with fewer than 3 points */
  fit: number | null;
}

const FLAG = /shortage|overstock|off plan|overdue|pending|blocked|breach/i;

/** Statistics for one table: V40's cards (records, average, risk, quality) and Analysis Summary, from the rows themselves. */
export function summarise(ds: Dataset, metric: string): Stats {
  const rows = ds.rows;
  const values = rows.map((r) => r[metric]).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  const cells = rows.length * ds.columns.length;
  let filled = 0;
  for (const r of rows) for (const c of ds.columns) if (r[c.key] !== null && r[c.key] !== undefined && r[c.key] !== '') filled++;
  const completeness = cells ? Math.round((filled / cells) * 100) : 100;
  const n = values.length;
  const avg = n ? values.reduce((a, b) => a + b, 0) / n : null;
  const sd = n && avg !== null ? Math.sqrt(values.reduce((s, v) => s + (v - avg) ** 2, 0) / n) : 0;
  const outliers = sd && avg !== null ? values.filter((v) => Math.abs(v - avg) > 1.75 * sd).length : 0;
  const flagged = rows.filter((r) => Object.values(r).some((v) => typeof v === 'string' && FLAG.test(v))).length;
  const risk = rows.length ? Math.min(100, Math.round((flagged / rows.length) * 55 + (n ? (outliers / n) * 30 : 0) + (100 - completeness) * 0.8)) : 0;

  const recent = values.slice(-20);
  const m = recent.length;
  let slope = 0;
  let intercept = recent[0] ?? 0;
  let fit: number | null = null;
  if (m > 1) {
    const sx = ((m - 1) * m) / 2;
    const sy = recent.reduce((a, b) => a + b, 0);
    const sxx = ((m - 1) * m * (2 * m - 1)) / 6;
    const sxy = recent.reduce((a, v, i) => a + i * v, 0);
    const den = m * sxx - sx * sx;
    if (den) {
      slope = (m * sxy - sx * sy) / den;
      intercept = (sy - slope * sx) / m;
    }
    if (m >= 3) {
      const mean = sy / m;
      const ssTot = recent.reduce((s, v) => s + (v - mean) ** 2, 0);
      const ssRes = recent.reduce((s, v, i) => s + (v - (intercept + slope * i)) ** 2, 0);
      fit = ssTot ? Math.round(Math.max(0, 1 - ssRes / ssTot) * 100) : 100;
    }
  }
  const trend = recent.map((_, i) => intercept + slope * i);
  const direction = m < 2 ? '—' : Math.abs(slope) < 1e-9 ? 'Flat' : slope > 0 ? 'Increasing' : 'Decreasing';
  return { records: rows.length, values, avg, min: n ? Math.min(...values) : null, max: n ? Math.max(...values) : null, outliers, flagged, completeness, risk, recent, trend, slope, direction, fit };
}

/** Count (or sum) of rows by one column, largest first, for the distribution bars. */
export function distribution(ds: Dataset, key: string, sumKey?: string, limit = 8): Array<{ label: string; value: number }> {
  const map = new Map<string, number>();
  for (const r of ds.rows) {
    const k = r[key] === null || r[key] === undefined || r[key] === '' ? 'Blank' : String(r[key]);
    map.set(k, (map.get(k) ?? 0) + (sumKey ? Number(r[sumKey] ?? 0) : 1));
  }
  return [...map.entries()]
    .map(([label, value]) => ({ label, value: Math.round(value * 100) / 100 }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

/** The fields of a saved report the Reports tab shows. */
export interface LibraryReport {
  code: string;
  name: string;
  dataset_label: string;
  visibility: string;
  run_count: number;
  last_run: string | null;
}
