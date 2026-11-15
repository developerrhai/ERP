// apps/api/src/modules/bi/analytics-service.ts
// Read-only analytics for the BI dashboards (bi-sales ... bi-profit), the BI library pages and the AI insight pages.
// Every number is computed from real records in SQL (or by the statistics helpers in bi-calc.ts); when there is no
// data the datasets are simply empty. Nothing is invented, nothing is written.
import { prisma } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { accessUserOf, can } from '../../core/rbac/access';
import { query } from '../procurement/core';
import type { Caller } from '../records/service';
import { detectZScoreAnomaly, holtForecast } from './bi-calc';

export type ColType = 'text' | 'inr' | 'int' | 'pct' | 'num' | 'date';
export interface Col {
  key: string;
  label: string;
  type: ColType;
}
export type Cell = string | number | null;
export interface Dataset {
  columns: Col[];
  rows: Array<Record<string, Cell>>;
}
export const ANALYTICS_KINDS = ['sales', 'purchase', 'inventory', 'finance', 'branch', 'profit'] as const;
export type AnalyticsKind = (typeof ANALYTICS_KINDS)[number];
export interface AnalyticsResult {
  kind: AnalyticsKind;
  generatedAt: string;
  scope: 'ALL_UNITS' | 'UNIT';
  notes: string[];
  /** current-state numbers shown as KPI cards on the first tab */
  kpis: Array<{ label: string; value: number | null; type: ColType; hint: string }>;
  datasets: Record<string, Dataset>;
}

const RESOURCE: Record<AnalyticsKind, string> = {
  sales: 'sales-orders',
  purchase: 'scm-po',
  inventory: 'inv-stock',
  finance: 'fin-gl',
  branch: 'fin-gl',
  profit: 'fin-gl',
};

type R = Record<string, unknown>;
const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
/** Text of a raw SQL value (strings, numbers, bigints; anything else is blank). */
const s = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'bigint' || typeof v === 'boolean' ? String(v) : '');
const nn = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const r2 = (v: number): number => Math.round(v * 100) / 100;
const pct = (a: number, b: number): number | null => (b ? r2((a / b) * 100) : null);
const iso = (v: unknown): string | null => {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return s(v).slice(0, 10);
};

async function allowed(caller: Caller, resource: string): Promise<boolean> {
  if (caller.auth.level >= 99) return true;
  return can(accessUserOf(caller.auth.user), resource, 'view');
}
const unitOf = (caller: Caller): string | null => (!caller.ctx.allUnits && caller.ctx.unitId ? caller.ctx.unitId : null);
const q = (sql: string, ...args: unknown[]): Promise<R[]> => query(prisma, sql, ...args) as Promise<R[]>;

/** Calendar month sequence helper: the last 12 months, oldest first. */
const MONTHS = `SELECT (date_trunc('month', CURRENT_DATE) - (g || ' month')::interval)::date AS ms FROM generate_series(11, 0, -1) g`;

function nextPeriods(last: string, count: number): string[] {
  const [y, m] = last.split('-').map(Number) as [number, number];
  const out: string[] = [];
  for (let i = 1; i <= count; i++) {
    const t = y * 12 + (m - 1) + i;
    out.push(`${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`);
  }
  return out;
}

/** Holt forecast rows (history + next 3 periods). Empty when there is no signal or fewer than 6 periods. */
function forecastDataset(periods: string[], values: number[], what: string): { ds: Dataset; note: string | null } {
  const cols: Col[] = [
    { key: 'period', label: 'Period', type: 'text' },
    { key: 'actual', label: `Actual ${what}`, type: 'num' },
    { key: 'forecast', label: 'Forecast', type: 'num' },
    { key: 'low', label: 'Low', type: 'num' },
    { key: 'high', label: 'High', type: 'num' },
  ];
  if (periods.length < 6 || values.every((v) => v === 0)) return { ds: { columns: cols, rows: [] }, note: null };
  const f = holtForecast(values, 0.5, 0.3, 3);
  const rows: Dataset['rows'] = periods.map((p, i) => ({ period: p, actual: values[i]!, forecast: null, low: null, high: null }));
  nextPeriods(periods[periods.length - 1]!, 3).forEach((p, i) => {
    const pt = f.points[i]!;
    rows.push({ period: p, actual: null, forecast: r2(Math.max(0, pt.estimate)), low: r2(Math.max(0, pt.lo)), high: r2(Math.max(0, pt.hi)) });
  });
  return { ds: { columns: cols, rows }, note: `Forecast: ${f.label} (MAPE ${r2(f.mape)}%, RMSE ${r2(f.rmse)}).` };
}

function withShare(rows: Array<Record<string, Cell>>, valueKey: string, shareKey = 'share'): void {
  const total = rows.reduce((s, r) => s + n(r[valueKey]), 0);
  rows.forEach((r) => (r[shareKey] = total ? r2((n(r[valueKey]) / total) * 100) : null));
}

function rank(rows: Array<Record<string, Cell>>, key: string): void {
  [...rows].sort((a, b) => n(b[key]) - n(a[key])).forEach((r, i) => (r.rank = i + 1));
}

// ============================================================================ SALES
async function sales(caller: Caller): Promise<AnalyticsResult> {
  const u = unitOf(caller);
  const SO = `so.deleted_at IS NULL AND so.status IN ('Approved','Posted') AND ($1::uuid IS NULL OR so.unit_id = $1::uuid)`;
  const monthly = await q(
    `WITH m AS (${MONTHS})
     SELECT to_char(m.ms, 'YYYY-MM') AS period,
       COALESCE((SELECT SUM(so.grand_total) FROM sales_orders so WHERE ${SO} AND date_trunc('month', so.order_date) = m.ms), 0)::float8 AS revenue,
       (SELECT COUNT(*) FROM sales_orders so WHERE ${SO} AND date_trunc('month', so.order_date) = m.ms)::int AS orders,
       (SELECT COUNT(*) FROM customers c WHERE c.deleted_at IS NULL AND date_trunc('month', c.created_at) = m.ms)::int AS new_customers,
       (SELECT SUM(l.taxable - l.qty * i.standard_cost) * 100 / NULLIF(SUM(l.taxable), 0)
          FROM sales_order_lines l JOIN sales_orders so ON so.id = l.order_id JOIN items i ON i.id = l.item_id
         WHERE ${SO} AND i.standard_cost > 0 AND date_trunc('month', so.order_date) = m.ms)::float8 AS margin,
       (SELECT COUNT(*) FILTER (WHERE o.status = 'Won') * 100.0 / NULLIF(COUNT(*), 0)
          FROM opportunities o WHERE o.deleted_at IS NULL AND o.status IN ('Won','Lost') AND date_trunc('month', o.closed_at) = m.ms
           AND ($1::uuid IS NULL OR o.unit_id = $1::uuid))::float8 AS win_rate
     FROM m ORDER BY m.ms`,
    u,
  );
  const curPeriod = new Date().toISOString().slice(0, 7);
  const monthlyRows = monthly.map((r) => ({
    period: String(r.period),
    revenue: n(r.revenue),
    orders: n(r.orders),
    aov: n(r.orders) ? r2(n(r.revenue) / n(r.orders)) : null,
    margin: nn(r.margin) === null ? null : r2(n(r.margin)),
    new_customers: n(r.new_customers),
    win_rate: nn(r.win_rate) === null ? null : r2(n(r.win_rate)),
    status: String(r.period) === curPeriod ? 'Open' : 'Closed',
  }));

  const products = (
    await q(
      `SELECT i.code AS code, i.name AS name, SUM(l.qty)::float8 AS qty, SUM(l.taxable)::float8 AS revenue,
              COUNT(DISTINCT l.order_id)::int AS orders,
              (SUM(l.taxable - l.qty * i.standard_cost) FILTER (WHERE i.standard_cost > 0) * 100
                 / NULLIF(SUM(l.taxable) FILTER (WHERE i.standard_cost > 0), 0))::float8 AS margin
         FROM sales_order_lines l JOIN sales_orders so ON so.id = l.order_id JOIN items i ON i.id = l.item_id
        WHERE ${SO} AND so.order_date >= CURRENT_DATE - interval '12 months'
        GROUP BY i.code, i.name ORDER BY revenue DESC LIMIT 25`,
      u,
    )
  ).map((r) => ({ code: String(r.code), name: String(r.name), qty: r2(n(r.qty)), revenue: r2(n(r.revenue)), orders: n(r.orders), margin: nn(r.margin) === null ? null : r2(n(r.margin)), share: null as Cell }));
  withShare(products, 'revenue');

  const customers = (
    await q(
      `SELECT c.code AS code, c.name AS name, COUNT(*)::int AS orders, SUM(so.grand_total)::float8 AS revenue,
              MAX(so.order_date) AS last_order,
              COALESCE((SELECT SUM(si.grand_total - si.received_amount) FROM sales_invoices si
                         WHERE si.customer_id = c.id AND si.deleted_at IS NULL AND si.grand_total > si.received_amount), 0)::float8 AS outstanding
         FROM sales_orders so JOIN customers c ON c.id = so.customer_id
        WHERE ${SO} AND so.order_date >= CURRENT_DATE - interval '12 months'
        GROUP BY c.id, c.code, c.name ORDER BY revenue DESC LIMIT 25`,
      u,
    )
  ).map((r) => ({
    code: String(r.code),
    name: String(r.name),
    orders: n(r.orders),
    revenue: r2(n(r.revenue)),
    aov: n(r.orders) ? r2(n(r.revenue) / n(r.orders)) : null,
    last_order: iso(r.last_order),
    outstanding: r2(n(r.outstanding)),
    share: null as Cell,
  }));
  withShare(customers, 'revenue');

  const people = (
    await q(
      `SELECT COALESCE(us.name, 'Unassigned') AS name, COUNT(*)::int AS orders, SUM(so.grand_total)::float8 AS revenue,
              COUNT(DISTINCT so.customer_id)::int AS customers
         FROM sales_orders so JOIN customers c ON c.id = so.customer_id
         LEFT JOIN users us ON us.id = COALESCE(c.sales_person_id, so.created_by_id)
        WHERE ${SO} AND so.order_date >= CURRENT_DATE - interval '12 months'
        GROUP BY 1 ORDER BY revenue DESC LIMIT 25`,
      u,
    )
  ).map((r) => ({
    name: String(r.name),
    orders: n(r.orders),
    revenue: r2(n(r.revenue)),
    customers: n(r.customers),
    aov: n(r.orders) ? r2(n(r.revenue) / n(r.orders)) : null,
    share: null as Cell,
  }));
  withShare(people, 'revenue');

  const fc = forecastDataset(monthlyRows.map((r) => r.period), monthlyRows.map((r) => r.revenue), 'Revenue');
  const k = await q(
    `SELECT
       COALESCE((SELECT SUM(so.grand_total) FROM sales_orders so WHERE ${SO} AND date_trunc('month', so.order_date) = date_trunc('month', CURRENT_DATE)), 0)::float8 AS mtd,
       COALESCE((SELECT SUM(si.grand_total - si.received_amount) FROM sales_invoices si WHERE si.deleted_at IS NULL AND si.grand_total > si.received_amount AND ($1::uuid IS NULL OR si.unit_id = $1::uuid)), 0)::float8 AS ar,
       (SELECT COUNT(*) FROM opportunities o WHERE o.deleted_at IS NULL AND o.status NOT IN ('Won','Lost') AND ($1::uuid IS NULL OR o.unit_id = $1::uuid))::int AS open_opps`,
    u,
  );
  const total12 = monthlyRows.reduce((s, r) => s + r.revenue, 0);
  const orders12 = monthlyRows.reduce((s, r) => s + r.orders, 0);
  return {
    kind: 'sales',
    generatedAt: new Date().toISOString(),
    scope: u ? 'UNIT' : 'ALL_UNITS',
    notes: [
      'Revenue = grand total of Approved and Posted sales orders, by order date. Gross margin is taxable value less quantity x item standard cost, for items that have a standard cost.',
      'Win rate = Won / (Won + Lost) opportunities closed in the month.',
      ...(fc.note ? [fc.note] : []),
    ],
    kpis: [
      { label: 'Revenue (12 months)', value: r2(total12), type: 'inr', hint: 'Approved and Posted orders' },
      { label: 'Revenue this month', value: r2(n(k[0]?.mtd)), type: 'inr', hint: 'Month to date' },
      { label: 'Orders (12 months)', value: orders12, type: 'int', hint: 'Approved and Posted orders' },
      { label: 'Average order value', value: orders12 ? r2(total12 / orders12) : null, type: 'inr', hint: 'Revenue / orders' },
      { label: 'Open receivables', value: r2(n(k[0]?.ar)), type: 'inr', hint: 'Unpaid invoice balance' },
      { label: 'Open opportunities', value: n(k[0]?.open_opps), type: 'int', hint: 'Not yet Won or Lost' },
    ],
    datasets: {
      monthly: {
        columns: [
          { key: 'period', label: 'Period', type: 'text' },
          { key: 'revenue', label: 'Revenue', type: 'inr' },
          { key: 'orders', label: 'Orders', type: 'int' },
          { key: 'aov', label: 'Average Order Value', type: 'inr' },
          { key: 'margin', label: 'Gross Margin %', type: 'pct' },
          { key: 'new_customers', label: 'New Customers', type: 'int' },
          { key: 'win_rate', label: 'Win Rate %', type: 'pct' },
          { key: 'status', label: 'Status', type: 'text' },
        ],
        rows: monthlyRows,
      },
      products: {
        columns: [
          { key: 'code', label: 'Item Code', type: 'text' },
          { key: 'name', label: 'Product', type: 'text' },
          { key: 'qty', label: 'Quantity', type: 'num' },
          { key: 'revenue', label: 'Revenue', type: 'inr' },
          { key: 'orders', label: 'Orders', type: 'int' },
          { key: 'margin', label: 'Gross Margin %', type: 'pct' },
          { key: 'share', label: 'Share %', type: 'pct' },
        ],
        rows: products,
      },
      customers: {
        columns: [
          { key: 'code', label: 'Customer Code', type: 'text' },
          { key: 'name', label: 'Customer', type: 'text' },
          { key: 'orders', label: 'Orders', type: 'int' },
          { key: 'revenue', label: 'Revenue', type: 'inr' },
          { key: 'aov', label: 'Average Order Value', type: 'inr' },
          { key: 'last_order', label: 'Last Order', type: 'date' },
          { key: 'outstanding', label: 'Outstanding', type: 'inr' },
          { key: 'share', label: 'Share %', type: 'pct' },
        ],
        rows: customers,
      },
      people: {
        columns: [
          { key: 'name', label: 'Salesperson', type: 'text' },
          { key: 'orders', label: 'Orders', type: 'int' },
          { key: 'revenue', label: 'Revenue', type: 'inr' },
          { key: 'customers', label: 'Customers', type: 'int' },
          { key: 'aov', label: 'Average Order Value', type: 'inr' },
          { key: 'share', label: 'Share %', type: 'pct' },
        ],
        rows: people,
      },
      forecast: fc.ds,
    },
  };
}

// ============================================================================ PURCHASE
async function purchase(caller: Caller): Promise<AnalyticsResult> {
  const u = unitOf(caller);
  const PO = `po.deleted_at IS NULL AND po.status IN ('Approved','Posted') AND ($1::uuid IS NULL OR po.unit_id = $1::uuid)`;
  const monthly = await q(
    `WITH m AS (${MONTHS})
     SELECT to_char(m.ms, 'YYYY-MM') AS period,
       COALESCE((SELECT SUM(po.grand_total) FROM purchase_orders po WHERE ${PO} AND date_trunc('month', po.po_date) = m.ms), 0)::float8 AS spend,
       (SELECT COUNT(*) FROM purchase_orders po WHERE ${PO} AND date_trunc('month', po.po_date) = m.ms)::int AS po_count,
       (SELECT COUNT(DISTINCT po.supplier_id) FROM purchase_orders po WHERE ${PO} AND date_trunc('month', po.po_date) = m.ms)::int AS suppliers,
       (SELECT COUNT(*) FILTER (WHERE l.received_qty >= l.qty) * 100.0 / NULLIF(COUNT(*), 0)
          FROM purchase_order_lines l JOIN purchase_orders po ON po.id = l.po_id WHERE ${PO} AND date_trunc('month', po.po_date) = m.ms)::float8 AS full_pct,
       COALESCE((SELECT SUM(l.taxable * GREATEST(0, 1 - l.received_qty / NULLIF(l.qty, 0)))
          FROM purchase_order_lines l JOIN purchase_orders po ON po.id = l.po_id WHERE ${PO} AND date_trunc('month', po.po_date) = m.ms), 0)::float8 AS open_commit
     FROM m ORDER BY m.ms`,
    u,
  );
  const curPeriod = new Date().toISOString().slice(0, 7);
  const monthlyRows = monthly.map((r) => ({
    period: String(r.period),
    spend: r2(n(r.spend)),
    po_count: n(r.po_count),
    suppliers: n(r.suppliers),
    full_pct: nn(r.full_pct) === null ? null : r2(n(r.full_pct)),
    open_commit: r2(n(r.open_commit)),
    status: String(r.period) === curPeriod ? 'Open' : 'Closed',
  }));

  const supplierRows = (
    await q(
      `SELECT s.code AS code, s.name AS name, COUNT(DISTINCT po.id)::int AS pos, SUM(po.grand_total)::float8 AS spend,
              (SELECT AVG(first_g.d) FROM (
                 SELECT MIN(g.receipt_date) - p2.po_date AS d FROM purchase_orders p2
                   JOIN goods_receipts g ON g.po_id = p2.id AND g.deleted_at IS NULL
                  WHERE p2.supplier_id = s.id AND p2.deleted_at IS NULL AND p2.po_date >= CURRENT_DATE - interval '12 months'
                    AND ($1::uuid IS NULL OR p2.unit_id = $1::uuid)
                  GROUP BY p2.id, p2.po_date) first_g)::float8 AS lead_days,
              (SELECT COUNT(*) FILTER (WHERE l.received_qty >= l.qty) * 100.0 / NULLIF(COUNT(*), 0)
                 FROM purchase_order_lines l JOIN purchase_orders p3 ON p3.id = l.po_id
                WHERE p3.supplier_id = s.id AND p3.deleted_at IS NULL AND p3.status IN ('Approved','Posted')
                  AND p3.po_date >= CURRENT_DATE - interval '12 months' AND ($1::uuid IS NULL OR p3.unit_id = $1::uuid))::float8 AS full_pct
         FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id
        WHERE ${PO} AND po.po_date >= CURRENT_DATE - interval '12 months'
        GROUP BY s.id, s.code, s.name ORDER BY spend DESC LIMIT 25`,
      u,
    )
  ).map((r) => ({
    code: String(r.code),
    name: String(r.name),
    pos: n(r.pos),
    spend: r2(n(r.spend)),
    lead_days: nn(r.lead_days) === null ? null : r2(n(r.lead_days)),
    full_pct: nn(r.full_pct) === null ? null : r2(n(r.full_pct)),
    share: null as Cell,
  }));
  withShare(supplierRows, 'spend');

  const items = (
    await q(
      `SELECT COALESCE(i.code, 'SERVICE') AS code, COALESCE(i.name, MAX(l.service_text), 'Service') AS name, COUNT(*)::int AS lines,
              SUM(l.qty)::float8 AS qty, SUM(l.taxable)::float8 AS spend,
              MIN(l.rate)::float8 AS min_rate, MAX(l.rate)::float8 AS max_rate, AVG(l.rate)::float8 AS avg_rate,
              COALESCE(SUM((a.avg_rate - l.rate) * l.qty) FILTER (WHERE l.rate < a.avg_rate), 0)::float8 AS savings
         FROM purchase_order_lines l JOIN purchase_orders po ON po.id = l.po_id
         LEFT JOIN items i ON i.id = l.item_id
         JOIN LATERAL (SELECT AVG(l2.rate) AS avg_rate FROM purchase_order_lines l2 WHERE l2.item_id IS NOT DISTINCT FROM l.item_id) a ON true
        WHERE ${PO} AND po.po_date >= CURRENT_DATE - interval '12 months'
        GROUP BY i.code, i.name ORDER BY spend DESC LIMIT 25`,
      u,
    )
  ).map((r) => ({
    code: String(r.code),
    name: String(r.name),
    lines: n(r.lines),
    qty: r2(n(r.qty)),
    spend: r2(n(r.spend)),
    min_rate: r2(n(r.min_rate)),
    max_rate: r2(n(r.max_rate)),
    avg_rate: r2(n(r.avg_rate)),
    variance: n(r.avg_rate) ? r2(((n(r.max_rate) - n(r.min_rate)) / n(r.avg_rate)) * 100) : null,
    savings: r2(n(r.savings)),
  }));

  const fc = forecastDataset(monthlyRows.map((r) => r.period), monthlyRows.map((r) => r.spend), 'Spend');
  const total12 = monthlyRows.reduce((s, r) => s + r.spend, 0);
  const pos12 = monthlyRows.reduce((s, r) => s + r.po_count, 0);
  const openCommit = monthlyRows.reduce((s, r) => s + r.open_commit, 0);
  const savings = items.reduce((s, r) => s + n(r.savings), 0);
  return {
    kind: 'purchase',
    generatedAt: new Date().toISOString(),
    scope: u ? 'UNIT' : 'ALL_UNITS',
    notes: [
      'Spend = grand total of Approved and Posted purchase orders, by PO date.',
      'Fully received % = PO lines whose received quantity reached the ordered quantity (the ERP does not store a promised-date delivery check per line).',
      'Lead time = days from PO date to the first goods receipt. Price variance = (highest - lowest rate) / average rate. Savings = (item average rate - paid rate) x quantity on lines bought below the item average.',
      ...(fc.note ? [fc.note] : []),
    ],
    kpis: [
      { label: 'Purchase spend (12 months)', value: r2(total12), type: 'inr', hint: 'Approved and Posted POs' },
      { label: 'Purchase orders', value: pos12, type: 'int', hint: 'Last 12 months' },
      { label: 'Open commitments', value: r2(openCommit), type: 'inr', hint: 'Value not yet received' },
      { label: 'Savings vs average rate', value: r2(savings), type: 'inr', hint: 'Lines bought below item average' },
    ],
    datasets: {
      monthly: {
        columns: [
          { key: 'period', label: 'Period', type: 'text' },
          { key: 'spend', label: 'Purchase Spend', type: 'inr' },
          { key: 'po_count', label: 'PO Count', type: 'int' },
          { key: 'suppliers', label: 'Supplier Count', type: 'int' },
          { key: 'full_pct', label: 'Fully Received %', type: 'pct' },
          { key: 'open_commit', label: 'Open Commitments', type: 'inr' },
          { key: 'status', label: 'Status', type: 'text' },
        ],
        rows: monthlyRows,
      },
      suppliers: {
        columns: [
          { key: 'code', label: 'Supplier Code', type: 'text' },
          { key: 'name', label: 'Supplier', type: 'text' },
          { key: 'pos', label: 'PO Count', type: 'int' },
          { key: 'spend', label: 'Spend', type: 'inr' },
          { key: 'share', label: 'Share %', type: 'pct' },
          { key: 'lead_days', label: 'Lead Time (days)', type: 'num' },
          { key: 'full_pct', label: 'Fully Received %', type: 'pct' },
        ],
        rows: supplierRows,
      },
      items: {
        columns: [
          { key: 'code', label: 'Item Code', type: 'text' },
          { key: 'name', label: 'Item', type: 'text' },
          { key: 'lines', label: 'PO Lines', type: 'int' },
          { key: 'spend', label: 'Spend', type: 'inr' },
          { key: 'min_rate', label: 'Lowest Rate', type: 'inr' },
          { key: 'max_rate', label: 'Highest Rate', type: 'inr' },
          { key: 'avg_rate', label: 'Average Rate', type: 'inr' },
          { key: 'variance', label: 'Price Variance %', type: 'pct' },
          { key: 'savings', label: 'Savings', type: 'inr' },
        ],
        rows: items,
      },
      forecast: fc.ds,
    },
  };
}

// ============================================================================ INVENTORY
async function inventory(caller: Caller): Promise<AnalyticsResult> {
  const u = unitOf(caller);
  const monthly = await q(
    `WITH m AS (${MONTHS})
     SELECT to_char(m.ms, 'YYYY-MM') AS period,
       COALESCE(SUM(sl.qty_in * sl.rate), 0)::float8 AS inward,
       COALESCE(SUM(sl.qty_out * sl.rate), 0)::float8 AS outward,
       COALESCE(SUM(sl.qty_out), 0)::float8 AS out_qty,
       COUNT(sl.id)::int AS movements
     FROM m LEFT JOIN stock_ledger sl ON date_trunc('month', sl.posting_date) = m.ms AND ($1::uuid IS NULL OR sl.unit_id = $1::uuid)
     GROUP BY m.ms ORDER BY m.ms`,
    u,
  );
  const monthlyRows = monthly.map((r) => ({
    period: String(r.period),
    inward: r2(n(r.inward)),
    outward: r2(n(r.outward)),
    net: r2(n(r.inward) - n(r.outward)),
    movements: n(r.movements),
    out_qty: r2(n(r.out_qty)),
  }));

  const stock = await q(
    `SELECT i.id AS id, i.code AS code, i.name AS name, i.reorder_level::float8 AS reorder,
            SUM(sb.on_hand)::float8 AS on_hand, SUM(sb.value)::float8 AS value, COUNT(DISTINCT sb.warehouse_id)::int AS warehouses,
            (SELECT MAX(sl.posting_date) FROM stock_ledger sl WHERE sl.item_id = i.id) AS last_move,
            COALESCE((SELECT SUM(sl.qty_out * sl.rate) FROM stock_ledger sl WHERE sl.item_id = i.id AND sl.posting_date >= CURRENT_DATE - interval '12 months'), 0)::float8 AS issues12
       FROM stock_balances sb JOIN items i ON i.id = sb.item_id JOIN warehouses w ON w.id = sb.warehouse_id
      WHERE ($1::uuid IS NULL OR w.unit_id = $1::uuid)
      GROUP BY i.id, i.code, i.name, i.reorder_level`,
    u,
  );
  const totalValue = stock.reduce((s, r) => s + n(r.value), 0);
  const today = Date.now();
  const bucket = (days: number | null): string => (days === null ? 'No movement' : days <= 30 ? '0-30 days' : days <= 90 ? '31-90 days' : days <= 180 ? '91-180 days' : 'Over 180 days');

  const stockRows = stock
    .map((r) => ({ code: String(r.code), name: String(r.name), warehouses: n(r.warehouses), on_hand: r2(n(r.on_hand)), avg_rate: n(r.on_hand) ? r2(n(r.value) / n(r.on_hand)) : null, value: r2(n(r.value)), share: null as Cell }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 30);
  withShare(stockRows, 'value');
  // share relative to the full stock value, not only the top 30
  stockRows.forEach((r) => (r.share = totalValue ? r2((r.value / totalValue) * 100) : null));

  const turnRows = stock
    .filter((r) => n(r.value) > 0 || n(r.issues12) > 0)
    .map((r) => {
      const turns = n(r.value) > 0 ? n(r.issues12) / n(r.value) : null;
      return { code: String(r.code), name: String(r.name), value: r2(n(r.value)), issues: r2(n(r.issues12)), turns: turns === null ? null : r2(turns), days: turns ? r2(365 / turns) : null };
    })
    .sort((a, b) => b.value - a.value)
    .slice(0, 30);

  const ageRows = stock
    .filter((r) => n(r.on_hand) > 0)
    .map((r) => {
      const days = r.last_move ? Math.max(0, Math.floor((today - new Date(String(iso(r.last_move))).getTime()) / 86400000)) : null;
      return { code: String(r.code), name: String(r.name), value: r2(n(r.value)), last_move: iso(r.last_move), days, bucket: bucket(days) };
    })
    .sort((a, b) => b.value - a.value)
    .slice(0, 40);

  const issues = stock
    .filter((r) => n(r.reorder) > 0)
    .map((r) => {
      const oh = n(r.on_hand);
      const ro = n(r.reorder);
      const state = oh < ro ? 'Shortage' : oh > ro * 3 ? 'Overstock' : 'OK';
      return { code: String(r.code), name: String(r.name), on_hand: r2(oh), reorder: r2(ro), gap: r2(oh - ro), value: r2(n(r.value)), state };
    })
    .filter((r) => r.state !== 'OK')
    .sort((a, b) => a.gap - b.gap)
    .slice(0, 40);

  const slowValue = ageRows.filter((r) => r.days === null || r.days > 180).reduce((s, r) => s + r.value, 0);
  const fc = forecastDataset(monthlyRows.map((r) => r.period), monthlyRows.map((r) => r.out_qty), 'Issue Qty');
  const issues12 = stock.reduce((s, r) => s + n(r.issues12), 0);
  return {
    kind: 'inventory',
    generatedAt: new Date().toISOString(),
    scope: u ? 'UNIT' : 'ALL_UNITS',
    notes: [
      'Stock value = SUM(stock balance value) over the warehouses you can see. Turns = issues over the last 12 months / current stock value; days on hand = 365 / turns.',
      'Ageing buckets use the date of the last stock movement of the item. Shortage = on hand below the reorder level; overstock = on hand above 3 x reorder level (items with a reorder level only).',
      ...(fc.note ? [fc.note] : []),
    ],
    kpis: [
      { label: 'Stock value', value: r2(totalValue), type: 'inr', hint: 'All visible warehouses' },
      { label: 'Inventory turns', value: totalValue ? r2(issues12 / totalValue) : null, type: 'num', hint: 'Issues 12 months / stock value' },
      { label: 'Days on hand', value: issues12 ? r2((totalValue / issues12) * 365) : null, type: 'num', hint: '365 / turns' },
      { label: 'Slow stock value', value: r2(slowValue), type: 'inr', hint: 'No movement in 180+ days (top 40 items by value)' },
      { label: 'Shortage SKUs', value: issues.filter((r) => r.state === 'Shortage').length, type: 'int', hint: 'Below reorder level' },
      { label: 'Overstock SKUs', value: issues.filter((r) => r.state === 'Overstock').length, type: 'int', hint: 'Above 3 x reorder level' },
    ],
    datasets: {
      monthly: {
        columns: [
          { key: 'period', label: 'Period', type: 'text' },
          { key: 'inward', label: 'Inward Value', type: 'inr' },
          { key: 'outward', label: 'Outward Value', type: 'inr' },
          { key: 'net', label: 'Net Change', type: 'inr' },
          { key: 'movements', label: 'Movements', type: 'int' },
        ],
        rows: monthlyRows,
      },
      stock: {
        columns: [
          { key: 'code', label: 'SKU', type: 'text' },
          { key: 'name', label: 'Item', type: 'text' },
          { key: 'warehouses', label: 'Warehouses', type: 'int' },
          { key: 'on_hand', label: 'On Hand', type: 'num' },
          { key: 'avg_rate', label: 'Average Rate', type: 'inr' },
          { key: 'value', label: 'Stock Value', type: 'inr' },
          { key: 'share', label: 'Share %', type: 'pct' },
        ],
        rows: stockRows,
      },
      turnover: {
        columns: [
          { key: 'code', label: 'SKU', type: 'text' },
          { key: 'name', label: 'Item', type: 'text' },
          { key: 'value', label: 'Stock Value', type: 'inr' },
          { key: 'issues', label: 'Issues (12 months)', type: 'inr' },
          { key: 'turns', label: 'Inventory Turns', type: 'num' },
          { key: 'days', label: 'Days on Hand', type: 'num' },
        ],
        rows: turnRows,
      },
      ageing: {
        columns: [
          { key: 'code', label: 'SKU', type: 'text' },
          { key: 'name', label: 'Item', type: 'text' },
          { key: 'value', label: 'Stock Value', type: 'inr' },
          { key: 'last_move', label: 'Last Movement', type: 'date' },
          { key: 'days', label: 'Days Since', type: 'int' },
          { key: 'bucket', label: 'Age Bucket', type: 'text' },
        ],
        rows: ageRows,
      },
      issues: {
        columns: [
          { key: 'code', label: 'SKU', type: 'text' },
          { key: 'name', label: 'Item', type: 'text' },
          { key: 'on_hand', label: 'On Hand', type: 'num' },
          { key: 'reorder', label: 'Reorder Level', type: 'num' },
          { key: 'gap', label: 'Gap', type: 'num' },
          { key: 'value', label: 'Stock Value', type: 'inr' },
          { key: 'state', label: 'Status', type: 'text' },
        ],
        rows: issues,
      },
      forecast: fc.ds,
    },
  };
}

// ============================================================================ FINANCE
const GL_FLAGS = `NOT ge.is_closing AND ($1::uuid IS NULL OR ge.unit_id = $1::uuid)`;
async function finance(caller: Caller): Promise<AnalyticsResult> {
  const u = unitOf(caller);
  const monthly = await q(
    `WITH m AS (${MONTHS})
     SELECT to_char(m.ms, 'YYYY-MM') AS period,
       COALESCE(SUM(ge.credit - ge.debit) FILTER (WHERE a.root_type = 'Income'), 0)::float8 AS revenue,
       COALESCE(SUM(ge.debit - ge.credit) FILTER (WHERE a.root_type = 'Expense'), 0)::float8 AS expense,
       COALESCE(SUM(ge.debit - ge.credit) FILTER (WHERE a.root_type = 'Expense' AND a.sub_type = 'COGS'), 0)::float8 AS cogs,
       COALESCE(SUM(ge.debit) FILTER (WHERE a.cf_class = 'CASH'), 0)::float8 AS cash_in,
       COALESCE(SUM(ge.credit) FILTER (WHERE a.cf_class = 'CASH'), 0)::float8 AS cash_out
     FROM m LEFT JOIN gl_entries ge ON date_trunc('month', ge.posting_date) = m.ms AND ${GL_FLAGS}
            LEFT JOIN accounts a ON a.id = ge.account_id
     GROUP BY m.ms ORDER BY m.ms`,
    u,
  );
  const monthlyRows = monthly.map((r) => {
    const rev = n(r.revenue);
    const exp = n(r.expense);
    return {
      period: String(r.period),
      revenue: r2(rev),
      gross_profit: r2(rev - n(r.cogs)),
      expense: r2(exp),
      net_profit: r2(rev - exp),
      net_margin: pct(rev - exp, rev),
      cash_in: r2(n(r.cash_in)),
      cash_out: r2(n(r.cash_out)),
      cash_net: r2(n(r.cash_in) - n(r.cash_out)),
    };
  });
  const pit = await q(
    `SELECT
       COALESCE((SELECT SUM(si.grand_total - si.received_amount) FROM sales_invoices si WHERE si.deleted_at IS NULL AND si.grand_total > si.received_amount AND ($1::uuid IS NULL OR si.unit_id = $1::uuid)), 0)::float8 AS ar,
       COALESCE((SELECT SUM(ge.credit - ge.debit) FROM gl_entries ge JOIN accounts a ON a.id = ge.account_id WHERE a.sub_type = 'Payable' AND ($1::uuid IS NULL OR ge.unit_id = $1::uuid)), 0)::float8 AS ap,
       COALESCE((SELECT SUM(ge.debit - ge.credit) FROM gl_entries ge JOIN accounts a ON a.id = ge.account_id WHERE a.cf_class = 'CASH' AND ($1::uuid IS NULL OR ge.unit_id = $1::uuid)), 0)::float8 AS cash,
       COALESCE((SELECT SUM(sb.value) FROM stock_balances sb JOIN warehouses w ON w.id = sb.warehouse_id WHERE ($1::uuid IS NULL OR w.unit_id = $1::uuid)), 0)::float8 AS stock,
       COALESCE((SELECT SUM(si.grand_total) FROM sales_invoices si WHERE si.deleted_at IS NULL AND si.invoice_date >= CURRENT_DATE - interval '90 days' AND ($1::uuid IS NULL OR si.unit_id = $1::uuid)), 0)::float8 AS inv90,
       COALESCE((SELECT SUM(si.grand_total - si.received_amount) FROM sales_invoices si WHERE si.deleted_at IS NULL AND si.invoice_date >= CURRENT_DATE - interval '90 days' AND ($1::uuid IS NULL OR si.unit_id = $1::uuid)), 0)::float8 AS ar90`,
    u,
  );
  const p = pit[0] ?? {};
  const ar = n(p.ar);
  const ap = n(p.ap);
  const cash = n(p.cash);
  const stockV = n(p.stock);
  const rev12 = monthlyRows.reduce((s, r) => s + r.revenue, 0);
  const gp12 = monthlyRows.reduce((s, r) => s + r.gross_profit, 0);
  const np12 = monthlyRows.reduce((s, r) => s + r.net_profit, 0);
  const exp12 = monthlyRows.reduce((s, r) => s + r.expense, 0);

  const working = [
    { component: 'Receivables', amount: r2(ar), basis: 'Unpaid sales invoice balance' },
    { component: 'Inventory', amount: r2(stockV), basis: 'Stock balance value' },
    { component: 'Cash and bank', amount: r2(cash), basis: 'Cash and bank GL balance' },
    { component: 'Payables', amount: r2(-ap), basis: 'Payable control accounts (credit balance)' },
    { component: 'Net working capital', amount: r2(ar + stockV + cash - ap), basis: 'Receivables + inventory + cash - payables' },
  ];
  const hasWc = ar || stockV || cash || ap;

  const budgets = (
    await q(
      `SELECT b.name AS name, a.code AS account, a.name AS account_name, a.root_type AS root_type,
              COALESCE((SELECT SUM(bm.amount) FROM budget_months bm WHERE bm.budget_id = b.id), 0)::float8 AS budget,
              COALESCE((SELECT SUM(CASE WHEN a.root_type = 'Income' THEN ge.credit - ge.debit ELSE ge.debit - ge.credit END)
                          FROM gl_entries ge WHERE ge.account_id = b.account_id AND ge.fy_id = b.fy_id AND NOT ge.is_closing
                           AND ($1::uuid IS NULL OR ge.unit_id = $1::uuid)), 0)::float8 AS actual
         FROM budgets b JOIN accounts a ON a.id = b.account_id
        WHERE b.deleted_at IS NULL AND ($1::uuid IS NULL OR b.unit_id = $1::uuid)
        ORDER BY b.name LIMIT 50`,
      u,
    )
  ).map((r) => ({
    name: String(r.name),
    account: `${s(r.account)} ${s(r.account_name)}`,
    budget: r2(n(r.budget)),
    actual: r2(n(r.actual)),
    variance: r2(n(r.actual) - n(r.budget)),
    variance_pct: pct(n(r.actual) - n(r.budget), n(r.budget)),
    status: n(r.budget) === 0 ? 'No budget' : (r.root_type === 'Income' ? n(r.actual) >= n(r.budget) : n(r.actual) <= n(r.budget)) ? 'Within plan' : 'Off plan',
  }));

  const dso = n(p.inv90) ? r2((n(p.ar90) * 90) / n(p.inv90)) : null;
  const ratios = [
    { ratio: 'Gross margin %', value: pct(gp12, rev12), basis: '(Revenue - cost of goods sold) / revenue, last 12 months' },
    { ratio: 'Net margin %', value: pct(np12, rev12), basis: '(Revenue - all expenses) / revenue, last 12 months' },
    { ratio: 'Expense ratio %', value: pct(exp12, rev12), basis: 'All expenses / revenue, last 12 months' },
    { ratio: 'DSO (days)', value: dso, basis: 'Open balance of invoices of the last 90 days x 90 / invoiced value' },
    { ratio: 'Receivables to payables', value: ap ? r2(ar / ap) : null, basis: 'Open receivables / payable balance' },
    { ratio: 'Cash to payables', value: ap ? r2(cash / ap) : null, basis: 'Cash and bank / payable balance' },
  ].filter((x) => x.value !== null);

  const fc = forecastDataset(monthlyRows.map((r) => r.period), monthlyRows.map((r) => r.revenue), 'Revenue');
  return {
    kind: 'finance',
    generatedAt: new Date().toISOString(),
    scope: u ? 'UNIT' : 'ALL_UNITS',
    notes: [
      'All profit figures come from GL entries (closing entries excluded): revenue = Income accounts, gross profit = revenue less COGS accounts, net profit = revenue less all Expense accounts.',
      'EBITDA is not shown: the chart of accounts has no interest / tax classification to add back.',
      ...(fc.note ? [fc.note] : []),
    ],
    kpis: [
      { label: 'Revenue (12 months)', value: r2(rev12), type: 'inr', hint: 'GL income accounts' },
      { label: 'Net profit (12 months)', value: r2(np12), type: 'inr', hint: 'Revenue - expenses' },
      { label: 'Receivables', value: r2(ar), type: 'inr', hint: 'Unpaid invoice balance' },
      { label: 'Payables', value: r2(ap), type: 'inr', hint: 'GL payable accounts' },
      { label: 'Cash and bank', value: r2(cash), type: 'inr', hint: 'GL cash accounts' },
      { label: 'DSO (days)', value: dso, type: 'num', hint: '90-day basis' },
    ],
    datasets: {
      monthly: {
        columns: [
          { key: 'period', label: 'Period', type: 'text' },
          { key: 'revenue', label: 'Revenue', type: 'inr' },
          { key: 'gross_profit', label: 'Gross Profit', type: 'inr' },
          { key: 'expense', label: 'Expenses', type: 'inr' },
          { key: 'net_profit', label: 'Net Profit', type: 'inr' },
          { key: 'net_margin', label: 'Net Margin %', type: 'pct' },
        ],
        rows: monthlyRows,
      },
      working: {
        columns: [
          { key: 'component', label: 'Component', type: 'text' },
          { key: 'amount', label: 'Amount', type: 'inr' },
          { key: 'basis', label: 'Basis', type: 'text' },
        ],
        rows: hasWc ? working : [],
      },
      cash: {
        columns: [
          { key: 'period', label: 'Period', type: 'text' },
          { key: 'cash_in', label: 'Cash In (debits)', type: 'inr' },
          { key: 'cash_out', label: 'Cash Out (credits)', type: 'inr' },
          { key: 'cash_net', label: 'Net Cash Flow', type: 'inr' },
        ],
        rows: monthlyRows,
      },
      budget: {
        columns: [
          { key: 'name', label: 'Budget', type: 'text' },
          { key: 'account', label: 'Account', type: 'text' },
          { key: 'budget', label: 'Budget', type: 'inr' },
          { key: 'actual', label: 'Actual', type: 'inr' },
          { key: 'variance', label: 'Variance', type: 'inr' },
          { key: 'variance_pct', label: 'Variance %', type: 'pct' },
          { key: 'status', label: 'Status', type: 'text' },
        ],
        rows: budgets,
      },
      ratios: {
        columns: [
          { key: 'ratio', label: 'Ratio', type: 'text' },
          { key: 'value', label: 'Value', type: 'num' },
          { key: 'basis', label: 'How it is computed', type: 'text' },
        ],
        rows: ratios,
      },
      forecast: fc.ds,
    },
  };
}

// ============================================================================ BRANCH (units)
async function branch(caller: Caller): Promise<AnalyticsResult> {
  const u = unitOf(caller);
  const rows = await q(
    `SELECT un.code AS code, un.name AS name,
       COALESCE((SELECT SUM(so.grand_total) FROM sales_orders so WHERE so.unit_id = un.id AND so.deleted_at IS NULL AND so.status IN ('Approved','Posted') AND so.order_date >= CURRENT_DATE - interval '12 months'), 0)::float8 AS revenue,
       COALESCE((SELECT SUM(ge.credit - ge.debit) FROM gl_entries ge JOIN accounts a ON a.id = ge.account_id WHERE ge.unit_id = un.id AND NOT ge.is_closing AND a.root_type = 'Income' AND ge.posting_date >= CURRENT_DATE - interval '12 months'), 0)::float8 AS gl_income,
       COALESCE((SELECT SUM(ge.debit - ge.credit) FROM gl_entries ge JOIN accounts a ON a.id = ge.account_id WHERE ge.unit_id = un.id AND NOT ge.is_closing AND a.sub_type = 'COGS' AND ge.posting_date >= CURRENT_DATE - interval '12 months'), 0)::float8 AS gl_cogs,
       COALESCE((SELECT SUM(ge.debit - ge.credit) FROM gl_entries ge JOIN accounts a ON a.id = ge.account_id WHERE ge.unit_id = un.id AND NOT ge.is_closing AND a.root_type = 'Expense' AND ge.posting_date >= CURRENT_DATE - interval '12 months'), 0)::float8 AS gl_expense,
       COALESCE((SELECT SUM(sb.value) FROM stock_balances sb JOIN warehouses w ON w.id = sb.warehouse_id WHERE w.unit_id = un.id), 0)::float8 AS stock,
       (SELECT COUNT(DISTINCT e.id) FROM employees e JOIN employee_assignments ea ON ea.employee_id = e.id AND ea.effective_to IS NULL WHERE e.deleted_at IS NULL AND e.status = 'ACTIVE' AND ea.unit_id = un.id)::int AS employees,
       (SELECT COUNT(*) FROM sales_orders so WHERE so.unit_id = un.id AND so.deleted_at IS NULL AND so.status IN ('Approved','Posted') AND so.order_date >= CURRENT_DATE - interval '12 months')::int AS orders,
       (SELECT COUNT(DISTINCT so.customer_id) FROM sales_orders so WHERE so.unit_id = un.id AND so.deleted_at IS NULL AND so.status IN ('Approved','Posted') AND so.order_date >= CURRENT_DATE - interval '12 months')::int AS customers,
       un.status AS status
     FROM units un WHERE ($1::uuid IS NULL OR un.id = $1::uuid) ORDER BY un.code`,
    u,
  );
  const out = rows.map((r) => ({
    branch: `${s(r.code)} ${s(r.name)}`,
    revenue: r2(n(r.revenue)),
    gross_profit: r2(n(r.gl_income) - n(r.gl_cogs)),
    net_profit: r2(n(r.gl_income) - n(r.gl_expense)),
    stock: r2(n(r.stock)),
    employees: n(r.employees),
    orders: n(r.orders),
    customers: n(r.customers),
    status: s(r.status),
    rank: null as Cell,
  }));
  rank(out, 'revenue');
  const totalRev = out.reduce((s, r) => s + r.revenue, 0);
  return {
    kind: 'branch',
    generatedAt: new Date().toISOString(),
    scope: u ? 'UNIT' : 'ALL_UNITS',
    notes: [
      'A branch is a unit. Revenue = Approved and Posted sales orders of the last 12 months; profit comes from the GL entries posted to the unit in the same window (closing entries excluded).',
      'Rank = position by revenue. No health score is shown because the ERP defines no formula for it.',
    ],
    kpis: [
      { label: 'Branches', value: out.length, type: 'int', hint: 'Units you can see' },
      { label: 'Revenue (12 months)', value: r2(totalRev), type: 'inr', hint: 'All visible branches' },
      { label: 'Net profit (12 months)', value: r2(out.reduce((s, r) => s + r.net_profit, 0)), type: 'inr', hint: 'GL based' },
      { label: 'Employees', value: out.reduce((s, r) => s + r.employees, 0), type: 'int', hint: 'Active, current assignment' },
    ],
    datasets: {
      branches: {
        columns: [
          { key: 'branch', label: 'Branch', type: 'text' },
          { key: 'revenue', label: 'Revenue', type: 'inr' },
          { key: 'gross_profit', label: 'Gross Profit', type: 'inr' },
          { key: 'net_profit', label: 'Net Profit', type: 'inr' },
          { key: 'stock', label: 'Inventory Value', type: 'inr' },
          { key: 'employees', label: 'Employee Count', type: 'int' },
          { key: 'orders', label: 'Sales Orders', type: 'int' },
          { key: 'customers', label: 'Customer Count', type: 'int' },
          { key: 'rank', label: 'Rank', type: 'int' },
          { key: 'status', label: 'Status', type: 'text' },
        ],
        rows: out,
      },
    },
  };
}

// ============================================================================ PROFITABILITY
async function profit(caller: Caller): Promise<AnalyticsResult> {
  const u = unitOf(caller);
  const SO = `so.deleted_at IS NULL AND so.status IN ('Approved','Posted') AND ($1::uuid IS NULL OR so.unit_id = $1::uuid) AND so.order_date >= CURRENT_DATE - interval '12 months'`;
  const mk = (dimension: string, rows: R[]): Array<Record<string, Cell>> =>
    rows.map((r) => ({
      dimension,
      name: String(r.name),
      revenue: r2(n(r.revenue)),
      cost: r2(n(r.cost)),
      contribution: r2(n(r.revenue) - n(r.cost)),
      margin: pct(n(r.revenue) - n(r.cost), n(r.revenue)),
      rank: null,
    }));
  const productRows = mk(
    'Product',
    await q(
      `SELECT i.code || ' ' || i.name AS name, SUM(l.taxable)::float8 AS revenue, SUM(l.qty * i.standard_cost)::float8 AS cost
         FROM sales_order_lines l JOIN sales_orders so ON so.id = l.order_id JOIN items i ON i.id = l.item_id
        WHERE ${SO} AND i.standard_cost > 0 GROUP BY i.id, i.code, i.name ORDER BY SUM(l.taxable - l.qty * i.standard_cost) DESC LIMIT 15`,
      u,
    ),
  );
  const customerRows = mk(
    'Customer',
    await q(
      `SELECT c.code || ' ' || c.name AS name, SUM(l.taxable)::float8 AS revenue, SUM(l.qty * i.standard_cost)::float8 AS cost
         FROM sales_order_lines l JOIN sales_orders so ON so.id = l.order_id JOIN customers c ON c.id = so.customer_id JOIN items i ON i.id = l.item_id
        WHERE ${SO} AND i.standard_cost > 0 GROUP BY c.id, c.code, c.name ORDER BY SUM(l.taxable - l.qty * i.standard_cost) DESC LIMIT 15`,
      u,
    ),
  );
  const branchRows = mk(
    'Branch',
    await q(
      `SELECT un.code || ' ' || un.name AS name,
         COALESCE(SUM(ge.credit - ge.debit) FILTER (WHERE a.root_type = 'Income'), 0)::float8 AS revenue,
         COALESCE(SUM(ge.debit - ge.credit) FILTER (WHERE a.root_type = 'Expense'), 0)::float8 AS cost
         FROM units un LEFT JOIN gl_entries ge ON ge.unit_id = un.id AND NOT ge.is_closing AND ge.posting_date >= CURRENT_DATE - interval '12 months'
         LEFT JOIN accounts a ON a.id = ge.account_id
        WHERE ($1::uuid IS NULL OR un.id = $1::uuid) GROUP BY un.id, un.code, un.name`,
      u,
    ),
  ).filter((r) => n(r.revenue) !== 0 || n(r.cost) !== 0);
  const projectRows = mk(
    'Project',
    await q(
      `SELECT p.code || ' ' || p.name AS name,
         COALESCE(SUM(ge.credit - ge.debit) FILTER (WHERE a.root_type = 'Income'), 0)::float8 AS revenue,
         COALESCE(SUM(ge.debit - ge.credit) FILTER (WHERE a.root_type = 'Expense'), 0)::float8 AS cost
         FROM projects p JOIN gl_entries ge ON ge.project_id = p.id AND NOT ge.is_closing JOIN accounts a ON a.id = ge.account_id
        WHERE ($1::uuid IS NULL OR p.unit_id = $1::uuid) GROUP BY p.id, p.code, p.name ORDER BY 1 LIMIT 30`,
      u,
    ).catch(() => [] as R[]),
  );
  for (const set of [productRows, customerRows, branchRows, projectRows]) rank(set, 'contribution');
  const all = [...productRows, ...customerRows, ...branchRows, ...projectRows];
  const summary = [productRows, customerRows, branchRows, projectRows].flatMap((s) => [...s].sort((a, b) => n(a.rank) - n(b.rank)).slice(0, 5));
  const contrib = [...productRows];
  const totalContribution = contrib.reduce((s, r) => s + n(r.contribution), 0);
  contrib.forEach((r) => (r.share = totalContribution > 0 ? r2((n(r.contribution) / totalContribution) * 100) : null));
  const cols: Col[] = [
    { key: 'dimension', label: 'Dimension', type: 'text' },
    { key: 'name', label: 'Name', type: 'text' },
    { key: 'revenue', label: 'Revenue', type: 'inr' },
    { key: 'cost', label: 'Direct Cost', type: 'inr' },
    { key: 'contribution', label: 'Contribution', type: 'inr' },
    { key: 'margin', label: 'Margin %', type: 'pct' },
    { key: 'rank', label: 'Rank', type: 'int' },
  ];
  const totalRev = productRows.reduce((s, r) => s + n(r.revenue), 0);
  return {
    kind: 'profit',
    generatedAt: new Date().toISOString(),
    scope: u ? 'UNIT' : 'ALL_UNITS',
    notes: [
      'Product and customer margin = taxable sales-order value less quantity x item standard cost (only items that have a standard cost), last 12 months.',
      'Branch and project margin = Income less Expense GL entries (closing entries excluded). Allocated cost is not shown: the ERP does not allocate overheads.',
      'Rank is within each dimension, by contribution.',
    ],
    kpis: [
      { label: 'Product revenue (top 15)', value: r2(totalRev), type: 'inr', hint: 'Items with a standard cost' },
      { label: 'Product contribution', value: r2(totalContribution), type: 'inr', hint: 'Revenue - standard cost' },
      { label: 'Blended product margin', value: pct(totalContribution, totalRev), type: 'pct', hint: 'Contribution / revenue' },
      { label: 'Rows analysed', value: all.length, type: 'int', hint: 'Products, customers, branches, projects' },
    ],
    datasets: {
      summary: { columns: cols, rows: summary },
      product: { columns: cols, rows: productRows },
      customer: { columns: cols, rows: customerRows },
      branch: { columns: cols, rows: branchRows },
      project: { columns: cols, rows: projectRows },
      contribution: { columns: [...cols.slice(0, 2), cols[4]!, { key: 'share', label: 'Share of Contribution %', type: 'pct' }, cols[5]!, cols[6]!], rows: contrib },
    },
  };
}

// ============================================================================ PUBLIC
export async function getAnalytics(caller: Caller, kind: string): Promise<AnalyticsResult> {
  if (!(ANALYTICS_KINDS as readonly string[]).includes(kind)) throw Errors.notFound(`Unknown analytics page: ${kind}`);
  const k = kind as AnalyticsKind;
  if (!(await allowed(caller, RESOURCE[k]))) throw Errors.forbidden(`You do not have access to ${k} analytics.`);
  const fn = { sales, purchase, inventory, finance, branch, profit }[k];
  return fn(caller);
}

// ============================================================================ BI LIBRARY (dashboards, reports, runs, schedules)
export async function getLibrary(caller: Caller): Promise<{
  dashboards: R[];
  reports: R[];
  runs: R[];
  schedules: R[];
  datasets: R[];
}> {
  const uid = caller.auth.userId;
  const dept = String((caller.auth.user as { department?: string } | undefined)?.department ?? '');
  const dashboards = await q(
    `SELECT d.id, d.name, d.scope, d.department, d.is_default, d.created_at, jsonb_array_length(d.layout)::int AS widgets, u.name AS owner
       FROM dashboards d LEFT JOIN users u ON u.id = d.user_id
      WHERE d.scope = 'DEPARTMENT' OR d.user_id = $1::uuid ORDER BY d.created_at DESC LIMIT 200`,
    uid,
  );
  const reports = await q(
    `SELECT r.id, r.code, r.name, r.dataset_code, d.label AS dataset_label, r.chart_type, r.visibility, r.department, r.is_system, r.created_at, d.permission_resource AS permission_resource,
            u.name AS owner,
            (SELECT COUNT(*)::int FROM report_runs rr WHERE rr.report_id = r.id) AS run_count,
            (SELECT MAX(rr.executed_at) FROM report_runs rr WHERE rr.report_id = r.id) AS last_run,
            jsonb_array_length(r.columns)::int AS column_count, jsonb_array_length(r.filters)::int AS filter_count,
            jsonb_array_length(r.group_by)::int AS group_count
       FROM report_definitions r JOIN bi_datasets d ON d.code = r.dataset_code LEFT JOIN users u ON u.id = r.created_by_id
      WHERE r.visibility = 'ALL' OR r.created_by_id = $1::uuid OR r.department = $2 ORDER BY r.created_at DESC LIMIT 300`,
    uid,
    dept,
  );
  const runs = await q(
    `SELECT rr.id, rr.executed_at, rr.row_count, rr.duration_ms, r.code AS report_code, r.name AS report_name, u.name AS run_by
       FROM report_runs rr JOIN report_definitions r ON r.id = rr.report_id LEFT JOIN users u ON u.id = rr.run_by_id
      WHERE r.visibility = 'ALL' OR r.created_by_id = $1::uuid OR r.department = $2 ORDER BY rr.executed_at DESC LIMIT 100`,
    uid,
    dept,
  );
  const schedules = await q(
    `SELECT s.id, s.cron_expr, s.timezone, s.format, s.next_run_at, s.active, s.created_at, jsonb_array_length(s.recipient_user_ids)::int AS recipients,
            r.name AS report_name, r.code AS report_code, u.name AS run_as,
            (SELECT MAX(rr.executed_at) FROM report_runs rr WHERE rr.report_id = s.report_id) AS last_run
       FROM report_schedules s JOIN report_definitions r ON r.id = s.report_id LEFT JOIN users u ON u.id = s.run_as_user_id
      WHERE r.visibility = 'ALL' OR r.created_by_id = $1::uuid OR r.department = $2 ORDER BY s.created_at DESC LIMIT 200`,
    uid,
    dept,
  );
  const datasets = await q(`SELECT code, label, owner_department, permission_resource, jsonb_array_length(columns)::int AS column_count, columns FROM bi_datasets ORDER BY label`);
  const clean = (rows: R[]): R[] => rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v])));
  return { dashboards: clean(dashboards), reports: clean(reports), runs: clean(runs), schedules: clean(schedules), datasets: clean(datasets) };
}

// ============================================================================ AI OVERVIEW (rule + statistics based findings)
export type Severity = 'High' | 'Medium' | 'Low';
export type FindingType = 'Forecast' | 'Risk' | 'Anomaly' | 'Data Quality' | 'Automation';
export interface Finding {
  module: string;
  type: FindingType;
  severity: Severity;
  finding: string;
  /** 0-100 or null: 100 for exact counts; model fit for forecasts; null when the rule has no statistical basis */
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

const inr = (v: number): string => `Rs ${Math.round(v).toLocaleString('en-IN')}`;
const sevFromRatio = (ratio: number, high: number, med: number): Severity => (ratio >= high ? 'High' : ratio >= med ? 'Medium' : 'Low');
const WEIGHT: Record<Severity, number> = { High: 40, Medium: 20, Low: 5 };

export async function getAiOverview(caller: Caller): Promise<AiOverview> {
  const u = unitOf(caller);
  const findings: Finding[] = [];
  const skipped: string[] = [];
  const modules = ['Sales', 'Purchase', 'Inventory', 'Finance', 'Production', 'Quality', 'Service', 'Projects', 'Administration'];
  const perm: Record<string, string> = { Sales: 'sales-orders', Purchase: 'scm-po', Inventory: 'inv-stock', Finance: 'fin-gl', Production: 'mfg-orders', Quality: 'qms-incoming', Service: 'service-tickets', Projects: 'proj-projects', Administration: 'admin-approval' };
  const okMod: Record<string, boolean> = {};
  for (const m of modules) okMod[m] = await allowed(caller, perm[m]!);

  const run = async (module: string, label: string, fn: () => Promise<void>): Promise<void> => {
    if (!okMod[module]) return;
    try {
      await fn();
    } catch {
      skipped.push(label);
    }
  };

  // ---- Sales
  let weekly: Array<{ label: string; value: number }> = [];
  await run('Sales', 'Sales trend', async () => {
    const w = await q(
      `WITH wk AS (SELECT (date_trunc('week', CURRENT_DATE) - (g || ' week')::interval)::date AS ws FROM generate_series(19, 0, -1) g)
       SELECT to_char(wk.ws, 'DD Mon') AS label,
              COALESCE((SELECT SUM(so.grand_total) FROM sales_orders so WHERE so.deleted_at IS NULL AND so.status IN ('Approved','Posted')
                         AND so.order_date >= wk.ws AND so.order_date < wk.ws + 7 AND ($1::uuid IS NULL OR so.unit_id = $1::uuid)), 0)::float8 AS value
         FROM wk ORDER BY wk.ws`,
      u,
    );
    weekly = w.map((r) => ({ label: String(r.label), value: r2(n(r.value)) }));
  });
  await run('Sales', 'Revenue forecast and anomaly', async () => {
    const m = await q(
      `WITH m AS (${MONTHS})
       SELECT COALESCE((SELECT SUM(so.grand_total) FROM sales_orders so WHERE so.deleted_at IS NULL AND so.status IN ('Approved','Posted')
                         AND date_trunc('month', so.order_date) = m.ms AND ($1::uuid IS NULL OR so.unit_id = $1::uuid)), 0)::float8 AS v
         FROM m ORDER BY m.ms`,
      u,
    );
    const series = m.map((r) => n(r.v));
    if (series.some((v) => v > 0) && series.length >= 6) {
      const f = holtForecast(series, 0.5, 0.3, 3);
      const last3 = series.slice(-3).reduce((s, v) => s + v, 0) / 3;
      const next = f.points[0]!.estimate;
      const change = last3 ? ((next - last3) / last3) * 100 : 0;
      findings.push({
        module: 'Sales',
        type: 'Forecast',
        severity: change <= -20 ? 'High' : change <= -5 ? 'Medium' : 'Low',
        finding: `Next-month sales order value is forecast at ${inr(Math.max(0, next))} (${change >= 0 ? '+' : ''}${r2(change)}% against the last 3-month average). ${change <= -5 ? 'Review the pipeline and pending quotations.' : 'No action needed.'}`,
        confidence: Math.max(0, Math.min(100, Math.round(100 - f.mape))),
        evidence: f.label,
      });
      const z = detectZScoreAnomaly(series.slice(0, -1), series[series.length - 1]!);
      if (z.anomaly) {
        findings.push({ module: 'Sales', type: 'Anomaly', severity: 'Medium', finding: `This month's sales order value ${inr(series[series.length - 1]!)} deviates from the previous 11 months (z = ${z.zScore}). Check for a one-off order or missing postings.`, confidence: Math.min(99, Math.round(Math.abs(Number(z.zScore)) * 20)), evidence: `Mean ${inr(Number(z.mean))}` });
      }
    }
  });
  await run('Sales', 'Overdue receivables', async () => {
    const r = await q(
      `SELECT COUNT(*) FILTER (WHERE due_date < CURRENT_DATE)::int AS overdue_n,
              COALESCE(SUM(grand_total - received_amount) FILTER (WHERE due_date < CURRENT_DATE), 0)::float8 AS overdue,
              COALESCE(SUM(grand_total - received_amount), 0)::float8 AS open_amt,
              COALESCE(MAX(CURRENT_DATE - due_date) FILTER (WHERE due_date < CURRENT_DATE), 0)::int AS max_days
         FROM sales_invoices WHERE deleted_at IS NULL AND grand_total > received_amount AND ($1::uuid IS NULL OR unit_id = $1::uuid)`,
      u,
    );
    const x = r[0] ?? {};
    if (n(x.overdue_n) > 0) {
      findings.push({ module: 'Sales', type: 'Risk', severity: sevFromRatio(n(x.overdue) / Math.max(1, n(x.open_amt)), 0.5, 0.2), finding: `${n(x.overdue_n)} invoice(s) worth ${inr(n(x.overdue))} are past due (oldest ${n(x.max_days)} days). Prioritise collection from the largest balances.`, confidence: 100, evidence: `${inr(n(x.open_amt))} open receivables` });
      findings.push({ module: 'Sales', type: 'Automation', severity: 'Low', finding: 'Automate payment reminders for invoices that are more than 7 days overdue, with escalation to the account manager after 30 days.', confidence: null, evidence: `${n(x.overdue_n)} overdue invoices` });
    }
  });

  // ---- Purchase
  await run('Purchase', 'Late purchase orders', async () => {
    const r = await q(
      `SELECT COUNT(DISTINCT po.id)::int AS pos, COALESCE(SUM(l.taxable * (1 - l.received_qty / NULLIF(l.qty, 0))), 0)::float8 AS val
         FROM purchase_order_lines l JOIN purchase_orders po ON po.id = l.po_id
        WHERE po.deleted_at IS NULL AND po.status IN ('Approved','Posted') AND l.received_qty < l.qty AND l.delivery_date < CURRENT_DATE
          AND ($1::uuid IS NULL OR po.unit_id = $1::uuid)`,
      u,
    );
    const x = r[0] ?? {};
    if (n(x.pos) > 0) findings.push({ module: 'Purchase', type: 'Risk', severity: n(x.pos) >= 10 ? 'High' : n(x.pos) >= 3 ? 'Medium' : 'Low', finding: `${n(x.pos)} purchase order(s) have lines past their delivery date and not fully received (about ${inr(n(x.val))} outstanding). Chase the suppliers or re-plan.`, confidence: 100, evidence: 'PO line delivery date vs received quantity' });
  });
  await run('Purchase', 'Supplier fulfilment', async () => {
    const r = await q(
      `SELECT s.name AS name, COUNT(*)::int AS lines, (COUNT(*) FILTER (WHERE l.received_qty >= l.qty) * 100.0 / COUNT(*))::float8 AS full_pct
         FROM purchase_order_lines l JOIN purchase_orders po ON po.id = l.po_id JOIN suppliers s ON s.id = po.supplier_id
        WHERE po.deleted_at IS NULL AND po.status IN ('Approved','Posted') AND po.po_date < CURRENT_DATE - 30 AND ($1::uuid IS NULL OR po.unit_id = $1::uuid)
        GROUP BY s.id, s.name HAVING COUNT(*) >= 3 AND COUNT(*) FILTER (WHERE l.received_qty >= l.qty) * 100.0 / COUNT(*) < 70 ORDER BY 3 LIMIT 3`,
      u,
    );
    for (const x of r) findings.push({ module: 'Purchase', type: 'Risk', severity: n(x.full_pct) < 40 ? 'High' : 'Medium', finding: `Supplier ${s(x.name)} fully delivered only ${r2(n(x.full_pct))}% of ${n(x.lines)} PO lines older than 30 days. Consider re-allocating critical items.`, confidence: 100, evidence: 'Received qty vs ordered qty' });
  });

  // ---- Inventory
  await run('Inventory', 'Stock levels', async () => {
    const r = await q(
      `WITH t AS (SELECT i.id, i.reorder_level, COALESCE(SUM(sb.on_hand), 0) AS oh FROM items i
                   LEFT JOIN stock_balances sb ON sb.item_id = i.id LEFT JOIN warehouses w ON w.id = sb.warehouse_id AND ($1::uuid IS NULL OR w.unit_id = $1::uuid)
                  WHERE i.deleted_at IS NULL AND i.reorder_level > 0 GROUP BY i.id, i.reorder_level)
       SELECT COUNT(*) FILTER (WHERE oh < reorder_level)::int AS short, COUNT(*)::int AS tracked FROM t`,
      u,
    );
    const x = r[0] ?? {};
    if (n(x.short) > 0) findings.push({ module: 'Inventory', type: 'Risk', severity: sevFromRatio(n(x.short) / Math.max(1, n(x.tracked)), 0.3, 0.1), finding: `${n(x.short)} of ${n(x.tracked)} items with a reorder level are below it. Raise purchase requisitions for the fast movers first.`, confidence: 100, evidence: 'On hand vs reorder level' });
    if (n(x.short) > 0) findings.push({ module: 'Inventory', type: 'Automation', severity: 'Low', finding: 'Generate a purchase requisition automatically when an item falls below its reorder level, and send it for approval.', confidence: null, evidence: `${n(x.short)} items below reorder level` });
  });
  await run('Inventory', 'Slow stock', async () => {
    const r = await q(
      `SELECT COUNT(*)::int AS items, COALESCE(SUM(v), 0)::float8 AS val FROM (
         SELECT i.id, SUM(sb.value) AS v, MAX(sl.posting_date) AS last_move FROM stock_balances sb JOIN items i ON i.id = sb.item_id JOIN warehouses w ON w.id = sb.warehouse_id
           LEFT JOIN stock_ledger sl ON sl.item_id = i.id
          WHERE ($1::uuid IS NULL OR w.unit_id = $1::uuid) AND sb.on_hand > 0 GROUP BY i.id) t
        WHERE last_move IS NULL OR last_move < CURRENT_DATE - 180`,
      u,
    );
    const tot = await q(`SELECT COALESCE(SUM(sb.value), 0)::float8 AS v FROM stock_balances sb JOIN warehouses w ON w.id = sb.warehouse_id WHERE ($1::uuid IS NULL OR w.unit_id = $1::uuid)`, u);
    const x = r[0] ?? {};
    if (n(x.items) > 0) findings.push({ module: 'Inventory', type: 'Risk', severity: sevFromRatio(n(x.val) / Math.max(1, n(tot[0]?.v)), 0.3, 0.1), finding: `${n(x.items)} item(s) worth ${inr(n(x.val))} have had no stock movement for 180+ days. Review them before replenishing.`, confidence: 100, evidence: `${r2((n(x.val) / Math.max(1, n(tot[0]?.v))) * 100)}% of stock value` });
  });

  // ---- Finance
  await run('Finance', 'Budget variance', async () => {
    const r = await q(
      `SELECT COUNT(*)::int AS off FROM (
         SELECT b.id, COALESCE((SELECT SUM(bm.amount) FROM budget_months bm WHERE bm.budget_id = b.id), 0) AS bud,
                COALESCE((SELECT SUM(CASE WHEN a.root_type = 'Income' THEN ge.credit - ge.debit ELSE ge.debit - ge.credit END) FROM gl_entries ge
                           WHERE ge.account_id = b.account_id AND ge.fy_id = b.fy_id AND NOT ge.is_closing), 0) AS act, a.root_type AS rt
           FROM budgets b JOIN accounts a ON a.id = b.account_id WHERE b.deleted_at IS NULL AND ($1::uuid IS NULL OR b.unit_id = $1::uuid)) t
        WHERE bud > 0 AND rt = 'Expense' AND act > bud`,
      u,
    );
    if (n(r[0]?.off) > 0) findings.push({ module: 'Finance', type: 'Risk', severity: n(r[0]?.off) >= 5 ? 'High' : 'Medium', finding: `${n(r[0]?.off)} expense budget(s) are already over their budget for the financial year. Freeze discretionary spend on these accounts or revise the budget.`, confidence: 100, evidence: 'GL actual vs budget months' });
  });
  await run('Finance', 'Cash position', async () => {
    const r = await q(`SELECT COALESCE(SUM(ge.debit - ge.credit), 0)::float8 AS bal, COUNT(*)::int AS cnt FROM gl_entries ge JOIN accounts a ON a.id = ge.account_id WHERE a.cf_class = 'CASH' AND ($1::uuid IS NULL OR ge.unit_id = $1::uuid)`, u);
    if (n(r[0]?.cnt) > 0 && n(r[0]?.bal) < 0) findings.push({ module: 'Finance', type: 'Risk', severity: 'High', finding: `Cash and bank accounts show a negative combined balance of ${inr(n(r[0]?.bal))}. Check unposted receipts and bank reconciliation.`, confidence: 100, evidence: 'Cash accounts, GL' });
  });

  // ---- Production / Quality / Service / Projects / Administration
  await run('Production', 'Production orders', async () => {
    const r = await q(`SELECT COUNT(*)::int AS late FROM mfg_orders WHERE deleted_at IS NULL AND status IN ('Planned','Released','In Progress') AND due_date < CURRENT_DATE AND ($1::uuid IS NULL OR unit_id = $1::uuid)`, u);
    if (n(r[0]?.late) > 0) findings.push({ module: 'Production', type: 'Risk', severity: n(r[0]?.late) >= 10 ? 'High' : n(r[0]?.late) >= 3 ? 'Medium' : 'Low', finding: `${n(r[0]?.late)} production order(s) are past their due date and still open. Re-plan capacity or expedite material.`, confidence: 100, evidence: 'Due date vs status' });
  });
  await run('Quality', 'First pass yield', async () => {
    const r = await q(`SELECT COUNT(*)::int AS cnt, COALESCE(SUM(accepted_qty), 0)::float8 AS acc, COALESCE(SUM(lot_qty), 0)::float8 AS lot FROM qms_inspections WHERE deleted_at IS NULL AND ($1::uuid IS NULL OR unit_id = $1::uuid)`, u);
    const x = r[0] ?? {};
    if (n(x.lot) > 0) {
      const fpy = (n(x.acc) / n(x.lot)) * 100;
      if (fpy < 98) findings.push({ module: 'Quality', type: 'Risk', severity: fpy < 90 ? 'High' : fpy < 95 ? 'Medium' : 'Low', finding: `First pass yield over ${n(x.cnt)} inspections is ${r2(fpy)}% (target 98%). Review recurring rejection causes.`, confidence: 100, evidence: 'Accepted qty / lot qty' });
    }
  });
  await run('Service', 'Service SLA', async () => {
    const r = await q(`SELECT COUNT(*) FILTER (WHERE sla_state = 'BREACHED')::int AS breached, COUNT(*) FILTER (WHERE status NOT IN ('RESOLVED','CLOSED'))::int AS open_n FROM service_tickets`);
    if (n(r[0]?.breached) > 0) findings.push({ module: 'Service', type: 'Risk', severity: n(r[0]?.breached) >= 5 ? 'High' : 'Medium', finding: `${n(r[0]?.breached)} service ticket(s) breached their SLA (${n(r[0]?.open_n)} tickets are open). Reassign technicians for the oldest breaches.`, confidence: 100, evidence: 'SLA state' });
  });
  await run('Projects', 'Project health', async () => {
    const r = await q(`SELECT COUNT(*) FILTER (WHERE health = 'RED')::int AS red, COUNT(*) FILTER (WHERE health = 'AMBER')::int AS amber FROM projects WHERE status NOT IN ('COMPLETED','CLOSED') AND ($1::uuid IS NULL OR unit_id = $1::uuid)`, u);
    const x = r[0] ?? {};
    if (n(x.red) + n(x.amber) > 0) findings.push({ module: 'Projects', type: 'Risk', severity: n(x.red) > 0 ? 'High' : 'Medium', finding: `${n(x.red)} project(s) are RED and ${n(x.amber)} AMBER (cost or schedule index below 0.95). Hold a recovery review.`, confidence: 100, evidence: 'Project health' });
  });
  await run('Administration', 'Pending approvals', async () => {
    const r = await q(
      `SELECT COUNT(*)::int AS old_n, COALESCE(MAX(EXTRACT(DAY FROM now() - requested_at)), 0)::int AS max_days FROM approval_requests
        WHERE status = 'PENDING' AND requested_at < now() - interval '3 days' AND ($1::uuid IS NULL OR unit_id = $1::uuid)`,
      u,
    );
    if (n(r[0]?.old_n) > 0) {
      findings.push({ module: 'Administration', type: 'Risk', severity: n(r[0]?.old_n) >= 10 ? 'High' : 'Medium', finding: `${n(r[0]?.old_n)} approval request(s) have been waiting for more than 3 days (oldest ${n(r[0]?.max_days)} days). Remind approvers or delegate.`, confidence: 100, evidence: 'Pending approval age' });
      findings.push({ module: 'Administration', type: 'Automation', severity: 'Low', finding: 'Auto-escalate approvals pending more than 3 days to the next approver level.', confidence: null, evidence: `${n(r[0]?.old_n)} aged approvals` });
    }
  });

  // ---- Data quality (master data completeness)
  let dqPct: number | null = null;
  try {
    const d = await q(
      `SELECT (SELECT COUNT(*) FROM customers WHERE deleted_at IS NULL AND status = 'ACTIVE')::int AS cust,
              (SELECT COUNT(*) FROM customers WHERE deleted_at IS NULL AND status = 'ACTIVE' AND credit_limit IS NULL)::int AS cust_gap,
              (SELECT COUNT(*) FROM items WHERE deleted_at IS NULL AND status = 'ACTIVE')::int AS items,
              (SELECT COUNT(*) FROM items WHERE deleted_at IS NULL AND status = 'ACTIVE' AND COALESCE(standard_cost, 0) = 0)::int AS item_gap,
              (SELECT COUNT(*) FROM suppliers WHERE deleted_at IS NULL AND status = 'ACTIVE')::int AS sup,
              (SELECT COUNT(*) FROM suppliers WHERE deleted_at IS NULL AND status = 'ACTIVE' AND COALESCE(pan, '') = '')::int AS sup_gap`,
    );
    const x = d[0] ?? {};
    const total = n(x.cust) + n(x.items) + n(x.sup);
    const gaps = n(x.cust_gap) + n(x.item_gap) + n(x.sup_gap);
    dqPct = total ? r2(((total - gaps) / total) * 100) : null;
    if (n(x.item_gap) > 0) findings.push({ module: 'Inventory', type: 'Data Quality', severity: sevFromRatio(n(x.item_gap) / Math.max(1, n(x.items)), 0.5, 0.2), finding: `${n(x.item_gap)} of ${n(x.items)} active items have no standard cost, so their margin cannot be analysed. Make standard cost mandatory on the item master.`, confidence: 100, evidence: 'Item master completeness' });
    if (n(x.cust_gap) > 0) findings.push({ module: 'Sales', type: 'Data Quality', severity: sevFromRatio(n(x.cust_gap) / Math.max(1, n(x.cust)), 0.3, 0.1), finding: `${n(x.cust_gap)} active customer(s) have no credit limit set. Set limits so order approval can check credit exposure.`, confidence: 100, evidence: 'Customer master completeness (credit limit)' });
    if (n(x.sup_gap) > 0) findings.push({ module: 'Purchase', type: 'Data Quality', severity: sevFromRatio(n(x.sup_gap) / Math.max(1, n(x.sup)), 0.3, 0.1), finding: `${n(x.sup_gap)} active supplier(s) have no PAN, which blocks correct TDS deduction. Collect PAN before the next payment.`, confidence: 100, evidence: 'Supplier master completeness' });
  } catch {
    skipped.push('Master data completeness');
  }

  // ---- Statistical anomalies already recorded by the insight scanner
  try {
    const ins = await q(`SELECT kind, severity, message, score, department FROM ai_insights WHERE ($1::uuid IS NULL OR unit_id = $1::uuid OR unit_id IS NULL) ORDER BY detected_at DESC LIMIT 5`, u);
    for (const r of ins) findings.push({ module: s(r.department) || 'Administration', type: 'Anomaly', severity: String(r.severity) === 'CRITICAL' ? 'High' : 'Medium', finding: String(r.message), confidence: r.score === null ? null : Math.min(99, Math.round(Math.abs(n(r.score)) * 20)), evidence: 'Recorded insight' });
  } catch {
    skipped.push('Recorded insights');
  }

  const sevOrder: Record<Severity, number> = { High: 0, Medium: 1, Low: 2 };
  findings.sort((a, b) => sevOrder[a.severity] - sevOrder[b.severity]);
  const risk: Record<string, number> = Object.fromEntries(modules.map((m) => [m, 0]));
  for (const f of findings) if (f.type !== 'Automation' && f.type !== 'Forecast') risk[f.module] = Math.min(100, (risk[f.module] ?? 0) + WEIGHT[f.severity]);
  const health = Math.max(0, 100 - Math.round(findings.filter((f) => f.type !== 'Automation' && f.type !== 'Forecast').reduce((s, f) => s + WEIGHT[f.severity] / 2, 0)));

  const st = await (async () => {
    try {
      const s = await q(`SELECT enabled, user_daily_inr_cap, org_daily_inr_cap FROM ai_settings WHERE id = 1`);
      const uRows = await q(`SELECT COALESCE(SUM(cost_inr), 0)::float8 AS c FROM ai_usage_daily WHERE usage_date = CURRENT_DATE AND user_id = $1::uuid`, caller.auth.userId);
      const oRows = await q(`SELECT COALESCE(SUM(cost_inr), 0)::float8 AS c FROM ai_usage_daily WHERE usage_date = CURRENT_DATE`);
      return { enabled: Boolean(s[0]?.enabled), uc: n(s[0]?.user_daily_inr_cap ?? 100), oc: n(s[0]?.org_daily_inr_cap ?? 500), u: n(uRows[0]?.c), o: n(oRows[0]?.c) };
    } catch {
      return { enabled: false, uc: 100, oc: 500, u: 0, o: 0 };
    }
  })();

  return {
    generatedAt: new Date().toISOString(),
    health,
    dataQuality: dqPct,
    findings,
    moduleRisk: modules.filter((m) => okMod[m]).map((m) => ({ module: m, risk: risk[m] ?? 0 })),
    trend: weekly,
    trendLabel: 'Weekly sales order value (last 20 weeks)',
    governance: { aiEnabled: st.enabled, externalModel: Boolean(process.env.ANTHROPIC_API_KEY), userCostInr: st.u, orgCostInr: st.o, userCap: st.uc, orgCap: st.oc },
    skipped,
  };
}
