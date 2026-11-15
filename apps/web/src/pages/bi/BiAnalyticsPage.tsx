// Business Intelligence analytics dashboards (bi-sales, bi-purchase, bi-inventory, bi-finance, bi-branch, bi-profit).
// V40 layout per tab: KPI cards, a trend chart, a distribution chart, "Analysis Summary", then the register table.
// Every figure is computed by the API from real records (GET /bi/analytics/:kind); an empty database shows empty states.
import { useMemo, type ReactNode } from 'react';
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
          <TabBody data={data} tab={tabName} cfg={cfg} graphsView={isGraphs} />
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

function TabBody({ data, tab, cfg, graphsView }: { data: Analytics; tab: string; cfg: TabCfg; graphsView: boolean }) {
  const ds: Dataset = useMemo(() => data.datasets[cfg.dataset] ?? { columns: [], rows: [] }, [data, cfg.dataset]);
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
          <div className="card panel" style={{ marginTop: 12 }}>
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
      {!graphsView ? <DataTable title={title} columns={ds.columns} rows={ds.rows} empty="No records." /> : null}
      <Notes notes={data.notes} />
    </>
  );
}
