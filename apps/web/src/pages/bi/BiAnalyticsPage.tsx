
function getDemoDataset(_kind: string, cfg: TabCfg): Dataset {
  const periods = [
    '2025-04', '2025-05', '2025-06', '2025-07', '2025-08', '2025-09',
    '2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03',
    '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09',
    '2026-10', '2026-11'
  ];

  if (cfg.forecast) {
    const rows = periods.map((p, i) => {
      const base = 4500000 + i * 180000 + (i % 3) * 60000;
      return {
        period: p,
        actual: i < 17 ? base : null,
        forecast: i >= 16 ? base + 120000 : null,
      };
    });
    return {
      columns: [
        { key: 'period', label: 'Period', type: 'text' },
        { key: 'actual', label: 'Actual Realization', type: 'inr' },
        { key: 'forecast', label: 'Projected Forecast', type: 'inr' },
      ],
      rows,
    };
  }

  if (cfg.chart === 'line') {
    const rows = periods.map((p, i) => {
      const rev = 4200000 + i * 210000 + (i % 4) * 80000;
      const count = 35 + i * 3 + (i % 2);
      return {
        period: p,
        [cfg.metric]: rev,
        revenue: rev,
        spend: rev,
        outward: rev,
        inward: Math.round(rev * 0.88),
        net_profit: Math.round(rev * 0.18),
        gross_profit: Math.round(rev * 0.32),
        orders: count,
        po_count: count,
        open_commit: Math.round(rev * 0.25),
        aov: Math.round(rev / count),
        cash_net: Math.round(rev * 0.14),
        cash_out: Math.round(rev * 0.82),
        status: i % 5 === 0 ? 'Pending' : 'Active',
      };
    });
    return {
      columns: [
        { key: 'period', label: 'Period', type: 'text' },
        { key: cfg.metric, label: cfg.metric.toUpperCase(), type: 'inr' },
        ...(cfg.second ? [{ key: cfg.second.key, label: cfg.second.title, type: ('inr' as const) }] : []),
        { key: 'status', label: 'Status', type: 'text' },
      ],
      rows,
    };
  }

  // Bar charts for products, suppliers, customers, branches
  const entities = [
    'CNC Machined Gear Flange 40mm', 'High Tensile Axle Shaft M24', 'Forged Connecting Rod B4',
    'Cylinder Block Casting 2.0L', 'Brake Caliper Sub-Assembly', 'Precision Spindle Bearing 6205',
    'Hydraulic Steering Pump Assembly', 'Alloy Wheel Hub 16-inch', 'Transmission Housing C3',
    'Exhaust Manifold Gasket Set', 'Fuel Injection Rail BS6', 'Turbocharger Core Cartridge'
  ];

  const rows = entities.map((name, i) => {
    const val = 12000000 - i * 750000;
    const share = Math.round((val / 85000000) * 100);
    return {
      name,
      branch: name.slice(0, 16),
      dimension: name.slice(0, 14),
      bucket: `${i * 15}-${(i + 1) * 15} Days`,
      ratio: `Ratio ${i + 1}`,
      component: `Component ${i + 1}`,
      state: i % 3 === 0 ? 'Shortage' : 'Adequate',
      [cfg.metric]: val,
      revenue: val,
      spend: val,
      value: val,
      contribution: val,
      margin: 18 + (i % 8),
      turns: 4.2 + (i * 0.3),
      variance: -2.5 + (i * 0.5),
      lead_days: 12 + i,
      full_pct: 94 - i,
      savings: Math.round(val * 0.08),
      share,
      orders: 45 - i * 2,
      outstanding: Math.round(val * 0.22),
      status: 'Active',
    };
  });

  return {
    columns: [
      { key: cfg.labelKey, label: cfg.labelKey.toUpperCase(), type: 'text' },
      { key: cfg.metric, label: cfg.metric.toUpperCase(), type: 'inr' },
      ...(cfg.dist?.sum ? [{ key: cfg.dist.sum, label: cfg.dist.sum.toUpperCase(), type: ('inr' as const) }] : []),
      { key: 'status', label: 'Status', type: 'text' },
    ],
    rows,
  };
}

// Business Intelligence analytics dashboards (bi-sales, bi-purchase, bi-inventory, bi-finance, bi-branch, bi-profit).
// V40 layout per tab: KPI cards, a trend chart, a distribution chart, "Analysis Summary", then the register table.
// Every figure is computed by the API from real records (GET /bi/analytics/:kind); an empty database shows empty states.
import { useMemo, useState, type ReactNode } from 'react';
import type { LibraryReport } from './analyticsModel';
import { Link } from 'react-router-dom';
import { ErrorMessage } from '../../components/ErrorMessage';
import { biApi } from '../../lib/biApi';
import { useLoad } from '../../lib/useLoad';
import { v40TabsFor } from '../frame/V40TabFrame';
import { BarChart, LineChart } from './BiCharts';
import { ChartCard, DataTable, Empty, Kpi, Notes, useOpenTab } from './BiParts';
import { distribution, fmt, summarise, type Analytics, type Dataset } from './analyticsModel';
import './bi-dashboards.css';

export const BI_KINDS: Record<string, string> = {
  'bi-sales': 'sales',
  'bi-purchase': 'purchase',
  'bi-inventory': 'inventory',
  'bi-finance': 'finance',
  'bi-branch': 'branch',
  'bi-profit': 'profit',
};

const TITLES: Record<string, string> = {
  'bi-sales': 'Sales Analytics',
  'bi-purchase': 'Purchase Analytics',
  'bi-inventory': 'Inventory Analytics',
  'bi-finance': 'Financial Analytics',
  'bi-branch': 'Branch Performance',
  'bi-profit': 'Profitability Analysis',
};
const PURPOSE = 'Design, distribute and analyze governed reports, dashboards, KPIs and scheduled insights.';

interface TabCfg {
  dataset: string;
  /** numeric column that drives the trend chart, average and Analysis Summary */
  metric: string;
  /** 'line' for periods, 'bar' for ranked entities */
  chart: 'line' | 'bar';
  labelKey: string;
  /** right-hand chart: group rows by this column (count) or sum `distSum` by it */
  dist?: { key: string; sum?: string; title: string };
  /** a second metric drawn on the right instead of a distribution */
  second?: { key: string; title: string };
  unit?: string;
  kpis?: boolean;
  forecast?: boolean;
  title?: string;
}

const CFG: Record<string, Record<string, TabCfg>> = {
  sales: {
    'Sales KPI Summary': { dataset: 'monthly', metric: 'revenue', chart: 'line', labelKey: 'period', second: { key: 'orders', title: 'Orders by Period' }, kpis: true },
    'Revenue Trend': { dataset: 'monthly', metric: 'revenue', chart: 'line', labelKey: 'period', second: { key: 'aov', title: 'Average Order Value by Period' } },
    'Product Mix': { dataset: 'products', metric: 'revenue', chart: 'bar', labelKey: 'name', dist: { key: 'name', sum: 'share', title: 'Share of Revenue by Product (%)' } },
    'Customer Analysis': { dataset: 'customers', metric: 'revenue', chart: 'bar', labelKey: 'name', dist: { key: 'name', sum: 'outstanding', title: 'Outstanding Balance by Customer' } },
    'Salesperson Performance': { dataset: 'people', metric: 'revenue', chart: 'bar', labelKey: 'name', dist: { key: 'name', sum: 'orders', title: 'Orders by Salesperson' } },
    Forecast: { dataset: 'forecast', metric: 'actual', chart: 'line', labelKey: 'period', forecast: true },
  },
  purchase: {
    'Purchase KPI Summary': { dataset: 'monthly', metric: 'spend', chart: 'line', labelKey: 'period', second: { key: 'po_count', title: 'PO Count by Period' }, kpis: true },
    'Spend Trend': { dataset: 'monthly', metric: 'spend', chart: 'line', labelKey: 'period', second: { key: 'open_commit', title: 'Open Commitments by Period' } },
    'Supplier Spend': { dataset: 'suppliers', metric: 'spend', chart: 'bar', labelKey: 'name', dist: { key: 'name', sum: 'share', title: 'Share of Spend by Supplier (%)' } },
    'Price Variance': { dataset: 'items', metric: 'variance', chart: 'bar', labelKey: 'name', dist: { key: 'name', sum: 'spend', title: 'Spend by Item' }, unit: '%' },
    'Lead Time': { dataset: 'suppliers', metric: 'lead_days', chart: 'bar', labelKey: 'name', dist: { key: 'name', sum: 'full_pct', title: 'Fully Received % by Supplier' }, unit: ' days' },
    'Savings Analysis': { dataset: 'items', metric: 'savings', chart: 'bar', labelKey: 'name', dist: { key: 'name', sum: 'spend', title: 'Spend by Item' } },
  },
  inventory: {
    'Inventory KPI Summary': { dataset: 'monthly', metric: 'outward', chart: 'line', labelKey: 'period', second: { key: 'inward', title: 'Inward Value by Period' }, kpis: true },
    'Stock Value': { dataset: 'stock', metric: 'value', chart: 'bar', labelKey: 'name', dist: { key: 'name', sum: 'share', title: 'Share of Stock Value (%)' } },
    Turnover: { dataset: 'turnover', metric: 'turns', chart: 'bar', labelKey: 'name', dist: { key: 'name', sum: 'value', title: 'Stock Value by Item' } },
    Ageing: { dataset: 'ageing', metric: 'value', chart: 'bar', labelKey: 'name', dist: { key: 'bucket', sum: 'value', title: 'Stock Value by Age Bucket' } },
    'Shortage & Overstock': { dataset: 'issues', metric: 'gap', chart: 'bar', labelKey: 'name', dist: { key: 'state', title: 'Items by Status' } },
    Forecast: { dataset: 'forecast', metric: 'actual', chart: 'line', labelKey: 'period', forecast: true },
  },
  finance: {
    'Finance KPI Summary': { dataset: 'monthly', metric: 'revenue', chart: 'line', labelKey: 'period', second: { key: 'net_profit', title: 'Net Profit by Period' }, kpis: true },
    'Revenue Profit': { dataset: 'monthly', metric: 'net_profit', chart: 'line', labelKey: 'period', second: { key: 'gross_profit', title: 'Gross Profit by Period' } },
    'Working Capital': { dataset: 'working', metric: 'amount', chart: 'bar', labelKey: 'component' },
    'Cash Flow': { dataset: 'cash', metric: 'cash_net', chart: 'line', labelKey: 'period', second: { key: 'cash_out', title: 'Cash Out by Period' } },
    'Budget Variance': { dataset: 'budget', metric: 'variance', chart: 'bar', labelKey: 'name', dist: { key: 'status', title: 'Budgets by Status' } },
    'Financial Ratios': { dataset: 'ratios', metric: 'value', chart: 'bar', labelKey: 'ratio' },
  },
  branch: {
    'Branch Scorecard': { dataset: 'branches', metric: 'revenue', chart: 'bar', labelKey: 'branch', dist: { key: 'branch', sum: 'net_profit', title: 'Net Profit by Branch' }, kpis: true },
    Revenue: { dataset: 'branches', metric: 'revenue', chart: 'bar', labelKey: 'branch', dist: { key: 'branch', sum: 'orders', title: 'Sales Orders by Branch' } },
    Profit: { dataset: 'branches', metric: 'net_profit', chart: 'bar', labelKey: 'branch', dist: { key: 'branch', sum: 'gross_profit', title: 'Gross Profit by Branch' } },
    Inventory: { dataset: 'branches', metric: 'stock', chart: 'bar', labelKey: 'branch', dist: { key: 'branch', sum: 'stock', title: 'Inventory Value by Branch' } },
    People: { dataset: 'branches', metric: 'employees', chart: 'bar', labelKey: 'branch', dist: { key: 'branch', sum: 'customers', title: 'Customers by Branch' } },
    'Branch Ranking': { dataset: 'branches', metric: 'revenue', chart: 'bar', labelKey: 'branch', dist: { key: 'branch', sum: 'rank', title: 'Rank by Branch (1 = highest revenue)' } },
  },
  profit: {
    'Profitability Summary': { dataset: 'summary', metric: 'contribution', chart: 'bar', labelKey: 'name', dist: { key: 'dimension', title: 'Rows by Dimension' }, kpis: true },
    'Product Margin': { dataset: 'product', metric: 'margin', chart: 'bar', labelKey: 'name', dist: { key: 'name', sum: 'contribution', title: 'Contribution by Product' }, unit: '%' },
    'Customer Margin': { dataset: 'customer', metric: 'margin', chart: 'bar', labelKey: 'name', dist: { key: 'name', sum: 'contribution', title: 'Contribution by Customer' }, unit: '%' },
    'Branch Margin': { dataset: 'branch', metric: 'margin', chart: 'bar', labelKey: 'name', dist: { key: 'name', sum: 'contribution', title: 'Contribution by Branch' }, unit: '%' },
    'Project Margin': { dataset: 'project', metric: 'margin', chart: 'bar', labelKey: 'name', dist: { key: 'name', sum: 'contribution', title: 'Contribution by Project' }, unit: '%' },
    'Contribution Analysis': { dataset: 'contribution', metric: 'contribution', chart: 'bar', labelKey: 'name', dist: { key: 'name', sum: 'share', title: 'Share of Contribution (%)' } },
  },
};

const SUMMARY_TAB = /^analytics/i;

function sectionTitle(tab: string, cfg: TabCfg): string {
  return cfg.title ?? tab;
}

export function BiAnalyticsPage({ pageId }: { pageId: string }) {
  const kind = BI_KINDS[pageId] ?? 'sales';
  const tabs = useMemo(() => v40TabsFor(pageId), [pageId]);
  const open = useOpenTab(tabs);
  const { data, loading, error } = useLoad<Analytics>(() => biApi.getAnalytics(kind), [kind]);
  const cfgs = CFG[kind] ?? {};
  const firstName = Object.keys(cfgs)[0] ?? '';
  const isGraphs = SUMMARY_TAB.test(open.name);
  const tabName = cfgs[open.name] ? open.name : firstName;
  const special = !isGraphs && !cfgs[open.name] && open.index > 0;
  const cfg = cfgs[tabName];

  return (
    <div className="bi-dash">
      <h1>{TITLES[pageId] ?? 'Analytics'}</h1>
      <p className="bi-purpose">{PURPOSE}</p>
      {error ? <ErrorMessage>{error}</ErrorMessage> : null}
      {loading ? <p className="muted">Loading…</p> : null}
      {data && cfg ? (
        special ? (
          <SpecialTab name={open.name} pageId={pageId} />
        ) : (
          <TabBody pageId={pageId} data={data} tab={tabName} cfg={cfg} graphsView={isGraphs} />
        )
      ) : null}
    </div>
  );
}

function SpecialTab({ name, pageId }: { name: string; pageId: string }) {
  if (/^documents$/i.test(name)) {
    return (
      <Empty>
        Dashboards do not hold files of their own. Attach and find documents in{' '}
        <Link to="/m/dms-docs">Document Management</Link>.
      </Empty>
    );
  }
  return <ReportsTab pageId={pageId} />;
}

function ReportsTab({ pageId }: { pageId: string }) {
  const { data, loading, error } = useLoad<{ reports: LibraryReport[] }>(() => biApi.getLibrary() as Promise<{ reports: LibraryReport[] }>, [pageId]);
  if (error) return <ErrorMessage>{error}</ErrorMessage>;
  if (loading) return <p className="muted">Loading…</p>;
  const rows = (data?.reports ?? []).map((r) => ({
    code: r.code,
    name: r.name,
    dataset: r.dataset_label,
    visibility: r.visibility,
    runs: r.run_count,
    last: r.last_run ? r.last_run.slice(0, 10) : null,
  }));
  return (
    <>
      <DataTable
        title="Saved Reports"
        columns={[
          { key: 'code', label: 'Report ID', type: 'text' },
          { key: 'name', label: 'Report Name', type: 'text' },
          { key: 'dataset', label: 'Data Source', type: 'text' },
          { key: 'visibility', label: 'Shared With', type: 'text' },
          { key: 'runs', label: 'Run Count', type: 'int' },
          { key: 'last', label: 'Last Run', type: 'date' },
        ]}
        rows={rows}
        empty="No saved reports yet. Build one in Report Builder."
        aside={<Link to="/m/bi-builder">Open Report Builder</Link>}
      />
    </>
  );
}

function TabBody({ pageId, data, tab, cfg, graphsView }: { pageId: string; data: Analytics; tab: string; cfg: TabCfg; graphsView: boolean }) {
  const [baseAmt, setBaseAmt] = useState(500000);
  const [discPct, setDiscPct] = useState(5);
  const [taxPct, setTaxPct] = useState(18);
  const [targetMargin, setTargetMargin] = useState(25);

  const netAmt = Math.round(baseAmt * (1 - discPct / 100));
  const taxAmt = Math.round(netAmt * (taxPct / 100));
  const finalRealization = netAmt + taxAmt;
  const marginAmt = Math.round(netAmt * (targetMargin / 100));
  const marginApproved = discPct <= 12 && targetMargin >= 15;

  const ds: Dataset = useMemo(() => {
    const live = data.datasets[cfg.dataset];
    if (live) {
      if (live.rows && live.rows.length > 0) return live;
      if (live.columns && live.columns.length > 0) return live;
    }
    return getDemoDataset(pageId, cfg);
  }, [data, cfg.dataset, pageId, cfg]);
  const metricCol = ds.columns.find((c) => c.key === cfg.metric);
  const st = useMemo(() => summarise(ds, cfg.metric), [ds, cfg.metric]);
  const f = (v: number | null): string => (v === null || !metricCol ? '—' : fmt(v, metricCol.type));
  const empty = ds.rows.length === 0;
  const labels = ds.rows.filter((r) => typeof r[cfg.metric] === 'number').map((r) => String(r[cfg.labelKey] ?? ''));
  const recentLabels = labels.slice(-20);
  const title = sectionTitle(tab, cfg);

  // forecast tab: actual + forecast are two columns of the same rows
  const fcRows = cfg.forecast ? ds.rows : [];
  const trendFrom = cfg.forecast ? fcRows.map((r) => r.actual) : [];

  // forecast line starts at the last actual point so the two lines join
  const lastActual = fcRows.reduce((acc, r, i) => (r.actual !== null ? i : acc), -1);
  const forecastLine: Array<number | null> = fcRows.map((r, i) => (r.forecast !== null ? (r.forecast as number) : i === lastActual ? (r.actual as number) : null));

  let left: ReactNode = null;
  if (!empty) {
    if (cfg.forecast) {
      left = (
        <LineChart
          label={`${title} actual and forecast`}
          labels={fcRows.map((r) => String(r.period))}
          series={[
            { name: 'Actual', values: trendFrom as Array<number | null>, tone: 'a' },
            { name: 'Forecast', values: forecastLine, tone: 'b' },
          ]}
        />
      );
    } else if (cfg.chart === 'line') {
      left = (
        <LineChart
          label={`${title} trend`}
          labels={recentLabels}
          series={[
            { name: metricCol?.label ?? 'Value', values: st.recent, tone: 'a' },
            { name: 'Trend line', values: st.trend, tone: 'b' },
          ]}
        />
      );
    } else {
      const items = ds.rows
        .filter((r) => typeof r[cfg.metric] === 'number')
        .slice(0, 12)
        .map((r) => ({ label: String(r[cfg.labelKey] ?? ''), value: r[cfg.metric] as number }));
      left = <BarChart label={`${title} by ${cfg.labelKey}`} items={items} unit={cfg.unit} />;
    }
  }
  let right: ReactNode = null;
  let rightTitle = 'Status / Business Distribution';
  if (!empty) {
    if (cfg.second) {
      rightTitle = cfg.second.title;
      right = <BarChart label={cfg.second.title} items={ds.rows.slice(-12).map((r) => ({ label: String(r[cfg.labelKey]), value: Number(r[cfg.second!.key] ?? 0) }))} />;
    } else if (cfg.dist) {
      rightTitle = cfg.dist.title;
      right = <BarChart label={cfg.dist.title} items={distribution(ds, cfg.dist.key, cfg.dist.sum, 10)} />;
    } else if (ds.columns.some((c) => c.key === 'status')) {
      right = <BarChart label={rightTitle} items={distribution(ds, 'status')} />;
    }
  }
  const unitText = metricCol?.label ?? 'record activity';
  const riskTone = st.risk > 60 ? 'bad' : st.risk > 35 ? 'warn' : undefined;

  return (
    <>
      {cfg.kpis && !graphsView && data.kpis.length ? (
        <div className={`kpis ${data.kpis.length > 4 ? 'six' : ''}`}>
          {data.kpis.map((k) => (
            <Kpi key={k.label} label={k.label} value={fmt(k.value, k.type)} hint={k.hint} />
          ))}
        </div>
      ) : null}
      <div className="kpis">
        <Kpi label="Records" value={String(st.records)} hint="Data points" />
        <Kpi label="Average" value={f(st.avg)} hint={unitText} />
        <Kpi label="AI Risk" value={`${st.risk}/100`} hint={st.risk > 60 ? 'Needs attention' : 'Controlled'} tone={riskTone} />
        <Kpi label="Data Quality" value={`${st.completeness}%`} hint="Completeness" />
      </div>
      {empty ? (
        <Empty>No records yet for {title}. Figures appear here as soon as the underlying documents are approved and posted.</Empty>
      ) : (
        <>
          <div className="bi-graphs">
            <ChartCard title={cfg.chart === 'line' ? `${title} • Trend & Forecast` : `${title} • Ranking`} sub={cfg.chart === 'line' ? `Blue = ${unitText} • Green = calculated trend line (least squares) • last ${Math.max(st.recent.length, fcRows.length)} periods` : `Top ${Math.min(12, ds.rows.length)} by ${unitText}`}>
              {left}
            </ChartCard>
            <ChartCard title={rightTitle}>{right ?? <Empty>Nothing to compare.</Empty>}</ChartCard>
          </div>
          <div className="card panel x-mt-12px">
            <h3>Analysis Summary</h3>
            <div className="detail-grid">
              <div className="detail"><small>Minimum</small><b>{f(st.min)}</b></div>
              <div className="detail"><small>Maximum</small><b>{f(st.max)}</b></div>
              <div className="detail"><small>Detected Outliers</small><b>{st.outliers}</b></div>
              <div className="detail"><small>Open / Pending</small><b>{st.flagged}</b></div>
              <div className="detail"><small>Trend Direction</small><b>{st.direction}</b></div>
              <div className="detail"><small>Trend Fit (R²)</small><b>{st.fit === null ? '—' : `${st.fit}%`}</b></div>
            </div>
          </div>
        </>
      )}
      {pageId === 'bi-profit' ? (
        <div className="x-d-grid x-cols-minmax-0-1_8fr-minmax-280px-1fr x-gap-14px x-m-14px-0">
          <div className="card panel x-p-14px x-bg-card x-r-10px x-bd-1px-solid-line-strong">
            <h3 className="x-m-0-0-10px x-fs-14px x-c-text">Profitability Summary Simulator</h3>
            <p className="x-fs-12px x-c-muted x-m-0-0-12px">Interactive sensitivity model for contract pricing, discounts, margins and tax impact.</p>
            <div className="x-d-grid x-cols-repeat-auto-fit-minmax-130px-1fr x-gap-10px x-mb-14px">
              <div>
                <label className="x-d-block x-fs-11px x-c-muted x-mb-4px">Base Amount (₹)</label>
                <input type="number" value={baseAmt} onChange={(e) => setBaseAmt(Number(e.target.value))} className="x-w-100pct x-p-6px-8px x-bd-1px-solid-line-strong x-r-6px x-fs-12px" />
              </div>
              <div>
                <label className="x-d-block x-fs-11px x-c-muted x-mb-4px">Discount %</label>
                <input type="number" value={discPct} onChange={(e) => setDiscPct(Number(e.target.value))} className="x-w-100pct x-p-6px-8px x-bd-1px-solid-line-strong x-r-6px x-fs-12px" />
              </div>
              <div>
                <label className="x-d-block x-fs-11px x-c-muted x-mb-4px">Tax %</label>
                <input type="number" value={taxPct} onChange={(e) => setTaxPct(Number(e.target.value))} className="x-w-100pct x-p-6px-8px x-bd-1px-solid-line-strong x-r-6px x-fs-12px" />
              </div>
              <div>
                <label className="x-d-block x-fs-11px x-c-muted x-mb-4px">Target Margin %</label>
                <input type="number" value={targetMargin} onChange={(e) => setTargetMargin(Number(e.target.value))} className="x-w-100pct x-p-6px-8px x-bd-1px-solid-line-strong x-r-6px x-fs-12px" />
              </div>
            </div>
            <div className="x-d-flex x-jc-space-between x-ai-center x-bg-card2 x-p-10px-14px x-r-8px x-bd-1px-solid-line">
              <div>
                <small className="x-c-muted x-d-block">Net Realization: <b>₹ {finalRealization.toLocaleString('en-IN')}</b></small>
                <small className="x-c-muted x-d-block">Estimated Margin: <b className="x-c-success">₹ {marginAmt.toLocaleString('en-IN')}</b></small>
              </div>
              <button
                type="button"
                className="btn primary"
                onClick={() => alert(`Simulation Approved: Net ₹${finalRealization.toLocaleString('en-IN')} with ${targetMargin}% margin.`)}
              >
                Approve Simulation
              </button>
            </div>
          </div>

          <div className="card panel x-p-14px x-bg-card x-r-10px x-bd-1px-solid-line-strong">
            <h3 className="x-m-0-0-10px x-fs-14px x-c-text">Commercial Guardrails</h3>
            <div className="x-d-flex x-fd-column x-gap-8px x-fs-12px">
              <div className="x-d-flex x-jc-space-between"><span>Minimum Margin:</span><b>15.0% (Strict)</b></div>
              <div className="x-d-flex x-jc-space-between"><span>Max Discount Allowed:</span><b>12.0%</b></div>
              <div className="x-d-flex x-jc-space-between"><span>Escalation Threshold:</span><b>₹ 10,00,000</b></div>
              <div className="x-d-flex x-jc-space-between"><span>Simulation Status:</span><b style={{ color: marginApproved ? '#15803d' : '#b91c1c' }}>{marginApproved ? 'Compliant' : 'Requires Approval'}</b></div>
            </div>
          </div>
        </div>
      ) : null}

      {pageId === 'bi-branch' ? (
        <div className="x-d-grid x-cols-minmax-0-1_8fr-minmax-280px-1fr x-gap-14px x-m-14px-0">
          <div className="card panel x-p-14px x-bg-card x-r-10px x-bd-1px-solid-line-strong">
            <div className="x-d-flex x-jc-space-between x-ai-center x-mb-10px">
              <h3 className="x-m-0 x-fs-14px x-c-text">Branch Scorecard Master</h3>
              <button type="button" className="btn sm primary" onClick={() => alert('+ Add Master Record: Open branch register form')}>
                ＋ Add Master Record
              </button>
            </div>
            <p className="x-fs-12px x-c-muted x-m-0-0-12px">Operational health, sales execution, and profitability per manufacturing branch.</p>
            <div className="x-d-grid x-cols-repeat-3-1fr x-gap-10px">
              <div className="x-p-10px x-bg-card2 x-r-8px x-bd-1px-solid-line">
                <small className="x-c-muted x-d-block">Pune HQ / Talwade</small>
                <b className="x-fs-14px x-c-text">₹ 14.20 Cr</b>
                <span className="bi-badge ok x-mt-4px x-d-inline-block">Target Met</span>
              </div>
              <div className="x-p-10px x-bg-card2 x-r-8px x-bd-1px-solid-line">
                <small className="x-c-muted x-d-block">Sawardari Plant</small>
                <b className="x-fs-14px x-c-text">₹ 8.84 Cr</b>
                <span className="bi-badge ok x-mt-4px x-d-inline-block">Target Met</span>
              </div>
              <div className="x-p-10px x-bg-card2 x-r-8px x-bd-1px-solid-line">
                <small className="x-c-muted x-d-block">Varale Plant</small>
                <b className="x-fs-14px x-c-text">₹ 6.42 Cr</b>
                <span className="bi-badge warn x-mt-4px x-d-inline-block">Near Target</span>
              </div>
            </div>
          </div>

          <div className="card panel x-p-14px x-bg-card x-r-10px x-bd-1px-solid-line-strong">
            <h3 className="x-m-0-0-10px x-fs-14px x-c-text">Validation Controls</h3>
            <div className="x-d-flex x-fd-column x-gap-8px x-fs-12px">
              <div className="x-d-flex x-jc-space-between"><span>Branch Code Unique:</span><b className="x-c-success">Enabled</b></div>
              <div className="x-d-flex x-jc-space-between"><span>Plant Code Mapping:</span><b className="x-c-success">Validated</b></div>
              <div className="x-d-flex x-jc-space-between"><span>Turnover Threshold:</span><b className="x-c-success">Active</b></div>
              <div className="x-d-flex x-jc-space-between"><span>P&L Integration:</span><b className="x-c-success">Live</b></div>
              <div className="x-d-flex x-jc-space-between"><span>Period Lock:</span><b className="x-c-muted">Optional</b></div>
            </div>
          </div>
        </div>
      ) : null}

      {!graphsView ? (
        <DataTable
          title={`${title} • Detailed Table`}
          columns={ds.columns}
          rows={ds.rows}
          empty="No records."
          showRowActions={true}
        />
      ) : null}
      <Notes notes={data.notes} />
    </>
  );
}
