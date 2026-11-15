// BI analytics, BI library and AI insight dashboards: V40 tabs and labels, numbers shown are the ones the API returned,
// empty data gives empty states, charts are accessible SVG, filters and the Copilot work.
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  getAnalytics: vi.fn(),
  getLibrary: vi.fn(),
  getAiOverview: vi.fn(),
  createConversation: vi.fn(),
  askCopilot: vi.fn(),
  createSchedule: vi.fn(),
  queryDataset: vi.fn(),
  createReport: vi.fn(),
}));
vi.mock('../../lib/biApi', () => ({ biApi: api }));
vi.mock('../generic/engineApi', () => ({ listPageAudit: () => Promise.resolve({ rows: [], meta: { page: 1, size: 20, total: 0 } }) }));
vi.mock('../../lib/approvalsApi', async (orig) => ({ ...(await orig<typeof import('../../lib/approvalsApi')>()), getRequests: () => Promise.resolve({ rows: [], meta: { page: 1, size: 25, total: 0 } }) }));

import { V40TabFrame, v40TabsFor } from '../frame/V40TabFrame';
import { AiInsightsPage } from './AiInsightsPage';
import { BiAnalyticsPage } from './BiAnalyticsPage';
import { BiLibraryPage } from './BiLibraryPage';
import { BarChart, LineChart } from './BiCharts';
import { distribution, fmt, summarise } from './analyticsModel';

const monthly = {
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
  rows: [
    { period: '2026-09', revenue: 100000, orders: 4, aov: 25000, margin: 20, new_customers: 1, win_rate: null, status: 'Closed' },
    { period: '2026-10', revenue: 150000, orders: 5, aov: 30000, margin: 22.5, new_customers: 0, win_rate: 50, status: 'Closed' },
    { period: '2026-11', revenue: 200000, orders: 6, aov: 33333.33, margin: 25, new_customers: 2, win_rate: 60, status: 'Open' },
  ],
};
const salesData = (rows = monthly.rows) => ({
  kind: 'sales',
  generatedAt: '2026-11-15T00:00:00Z',
  scope: 'ALL_UNITS',
  notes: ['Revenue = grand total of Approved and Posted sales orders.'],
  kpis: [
    { label: 'Revenue (12 months)', value: 450000, type: 'inr', hint: 'Approved and Posted orders' },
    { label: 'Orders (12 months)', value: 15, type: 'int', hint: 'Approved and Posted orders' },
  ],
  datasets: {
    monthly: { ...monthly, rows },
    products: { columns: [{ key: 'name', label: 'Product', type: 'text' }, { key: 'revenue', label: 'Revenue', type: 'inr' }, { key: 'share', label: 'Share %', type: 'pct' }], rows: [{ name: 'Gearbox', revenue: 300000, share: 66.7 }] },
    customers: { columns: [], rows: [] },
    people: { columns: [], rows: [] },
    forecast: { columns: [], rows: [] },
  },
});

const wrap = (pageId: string, ui: React.ReactElement, tab = 0) =>
  render(
    <MemoryRouter initialEntries={[tab ? `/m/${pageId}?tab=${tab}` : `/m/${pageId}`]}>
      <V40TabFrame pageId={pageId} tabs={v40TabsFor(pageId)}>
        {ui}
      </V40TabFrame>
    </MemoryRouter>,
  );

beforeEach(() => {
  Object.values(api).forEach((m) => m.mockReset());
});

describe('analytics model', () => {
  it('summarises a table from its own rows only', () => {
    const st = summarise(monthly as never, 'revenue');
    expect(st.records).toBe(3);
    expect(st.avg).toBe(150000);
    expect(st.min).toBe(100000);
    expect(st.max).toBe(200000);
    expect(st.direction).toBe('Increasing');
    expect(st.fit).toBe(100); // a perfectly straight series
    expect(st.completeness).toBeLessThan(100); // one win rate is null
    const none = summarise({ columns: monthly.columns, rows: [] } as never, 'revenue');
    expect(none.records).toBe(0);
    expect(none.avg).toBeNull();
    expect(none.risk).toBe(0);
  });
  it('formats rupees, percents and blanks, and counts distributions', () => {
    expect(fmt(1234567, 'inr')).toBe('₹ 12,34,567');
    expect(fmt(12.34, 'pct')).toBe('12.3%');
    expect(fmt(null, 'inr')).toBe('—');
    expect(distribution({ columns: [], rows: [{ s: 'Open' }, { s: 'Open' }, { s: 'Closed' }] }, 's')).toEqual([{ label: 'Open', value: 2 }, { label: 'Closed', value: 1 }]);
  });
});

describe('charts', () => {
  it('draw accessible SVG with a text summary and per-mark titles', () => {
    render(
      <>
        <LineChart label="Revenue trend" labels={['A', 'B', 'C']} series={[{ name: 'Revenue', values: [1, 3, 2], tone: 'a' }]} />
        <BarChart label="Risk by module" items={[{ label: 'Sales', value: 40 }, { label: 'Purchase', value: 0 }]} />
      </>,
    );
    expect(screen.getByRole('img', { name: /Revenue trend/ })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Risk by module.*Sales 40/ })).toBeInTheDocument();
    expect(screen.getByText('Sales: 40')).toBeInTheDocument();
  });
  it('draw nothing without data', () => {
    const { container } = render(<BarChart label="x" items={[]} />);
    expect(container.querySelector('svg')).toBeNull();
  });
});

describe('BiAnalyticsPage', () => {
  it('shows V40 tabs, the real KPI cards, trend and distribution charts, analysis summary and the table', async () => {
    api.getAnalytics.mockResolvedValue(salesData());
    wrap('bi-sales', <BiAnalyticsPage pageId="bi-sales" />);
    expect(screen.getByRole('heading', { name: 'Sales Analytics' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Revenue Trend' })).toBeInTheDocument();
    await screen.findByText('Revenue (12 months)');
    expect(api.getAnalytics).toHaveBeenCalledWith('sales');
    expect(screen.getByText('₹ 4,50,000')).toBeInTheDocument(); // server KPI, not recomputed
    for (const l of ['Records', 'Average', 'AI Risk', 'Data Quality', 'Analysis Summary', 'Detected Outliers', 'Trend Direction']) expect(screen.getAllByText(l).length).toBeGreaterThan(0);
    expect(screen.getByText('Sales KPI Summary • Trend & Forecast')).toBeInTheDocument();
    expect(screen.getAllByRole('img').length).toBeGreaterThanOrEqual(2);
    const table = screen.getByRole('table');
    expect(within(table).getByText('2026-10')).toBeInTheDocument();
    expect(within(table).getByText('₹ 1,50,000')).toBeInTheDocument();
    expect(screen.getByText('How these numbers are computed')).toBeInTheDocument();
  });

  it('switches content with the tab and uses the matching dataset', async () => {
    api.getAnalytics.mockResolvedValue(salesData());
    const user = userEvent.setup();
    wrap('bi-sales', <BiAnalyticsPage pageId="bi-sales" />);
    await screen.findByText('Revenue (12 months)');
    await user.click(screen.getByRole('tab', { name: 'Product Mix' }));
    await waitFor(() => expect(screen.getAllByText('Gearbox').length).toBeGreaterThan(0));
    expect(screen.queryByText('Revenue (12 months)')).toBeNull(); // KPI row is the first tab only
  });

  it('gives an empty state, not numbers, when there is no data', async () => {
    api.getAnalytics.mockResolvedValue(salesData([]));
    wrap('bi-sales', <BiAnalyticsPage pageId="bi-sales" />);
    await screen.findByText(/No records yet for Sales KPI Summary/);
    expect(screen.getByText('Records').parentElement).toHaveTextContent('0');
    expect(screen.queryAllByRole('img')).toHaveLength(0);
  });

  it('shows the API error', async () => {
    api.getAnalytics.mockRejectedValue(new Error('You do not have access to sales analytics.'));
    wrap('bi-sales', <BiAnalyticsPage pageId="bi-sales" />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('Records')).toBeNull(); // no invented cards on error
  });
});

const overview = {
  generatedAt: '2026-11-15T00:00:00Z',
  health: 72,
  dataQuality: 91.5,
  findings: [
    { module: 'Sales', type: 'Risk', severity: 'High', finding: '3 invoice(s) worth Rs 90,000 are past due.', confidence: 100, evidence: 'Rs 100,000 open receivables' },
    { module: 'Inventory', type: 'Risk', severity: 'Low', finding: '2 of 10 items are below reorder level.', confidence: 100, evidence: 'On hand vs reorder level' },
    { module: 'Sales', type: 'Automation', severity: 'Low', finding: 'Automate payment reminders.', confidence: null, evidence: '3 overdue invoices' },
  ],
  moduleRisk: [{ module: 'Sales', risk: 40 }, { module: 'Inventory', risk: 5 }],
  trend: Array.from({ length: 20 }, (_, i) => ({ label: `W${i}`, value: 1000 + i * 10 })),
  trendLabel: 'Weekly sales order value (last 20 weeks)',
  governance: { aiEnabled: false, externalModel: false, userCostInr: 0, orgCostInr: 0, userCap: 100, orgCap: 500 },
  skipped: [],
};

describe('AiInsightsPage', () => {
  it('shows the V40 cards, findings table, filter, copilot and governance from the API data', async () => {
    api.getAiOverview.mockResolvedValue(overview);
    const user = userEvent.setup();
    render(<AiInsightsPage pageId="ai-copilot" />);
    expect(screen.getByRole('heading', { name: 'Advanced AI Business Analysis' })).toBeInTheDocument();
    await screen.findByText('72/100');
    for (const l of ['Business Health', 'Data Quality', 'AI Findings', 'Automation Candidates', '20-Point Business Trend + Forecast', 'Cross-Module Risk', 'Enterprise AI Copilot', 'AI Governance Controls', 'Department Filter']) expect(screen.getByText(l)).toBeInTheDocument();
    expect(screen.getByText('3 AI Findings')).toBeInTheDocument();
    for (const h of ['#', 'Module', 'Type', 'Severity', 'Finding / Recommended Action', 'Confidence']) expect(screen.getByRole('columnheader', { name: h })).toBeInTheDocument();
    expect(screen.getByText(/3 invoice\(s\) worth Rs 90,000/)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Department Filter'), 'Inventory');
    expect(screen.getByText('1 AI Findings')).toBeInTheDocument();
    expect(screen.queryByText(/3 invoice/)).toBeNull();
  });

  it('opens on the matching department for ai-sales', async () => {
    api.getAiOverview.mockResolvedValue(overview);
    render(<AiInsightsPage pageId="ai-sales" />);
    await screen.findByText('72/100');
    expect(screen.getByLabelText('Department Filter')).toHaveValue('Sales');
    expect(screen.getByText('2 AI Findings')).toBeInTheDocument();
  });

  it('asks the real Copilot and shows its refusal when AI is off', async () => {
    api.getAiOverview.mockResolvedValue(overview);
    api.createConversation.mockResolvedValue({ id: 'c1' });
    api.askCopilot.mockRejectedValueOnce(new Error('AI is off — Admin can enable it in AI Settings'));
    const user = userEvent.setup();
    render(<AiInsightsPage pageId="ai-copilot" />);
    await screen.findByText('72/100');
    await user.type(screen.getByLabelText('Ask the AI Copilot'), 'overdue customers');
    await user.click(screen.getByRole('button', { name: 'Ask AI' }));
    expect(await screen.findByText(/AI is off/)).toBeInTheDocument();
    expect(api.askCopilot).toHaveBeenCalledWith('c1', 'overdue customers');
  });

  it('shows an empty trend message when there are no sales', async () => {
    api.getAiOverview.mockResolvedValue({ ...overview, findings: [], trend: overview.trend.map((t) => ({ ...t, value: 0 })), moduleRisk: [] });
    render(<AiInsightsPage pageId="ai-demand" />);
    await screen.findByText('0 AI Findings');
    expect(screen.getByText(/no trend to draw/)).toBeInTheDocument();
    expect(screen.getByText(/every rule that could run found nothing/)).toBeInTheDocument();
  });
});

const library = {
  dashboards: [{ id: 'abcdef1234', name: 'Sales Overview', scope: 'DEPARTMENT', department: 'Sales', is_default: true, created_at: '2026-11-01T00:00:00Z', widgets: 5, owner: null }],
  reports: [{ id: 'r1', code: 'RPT_1', name: 'Open invoices', dataset_label: 'Sales Invoices', visibility: 'ALL', department: 'Sales', is_system: false, owner: 'Asha', run_count: 3, last_run: '2026-11-10T10:00:00Z', permission_resource: 'sales-invoices', chart_type: 'TABLE', column_count: 3, filter_count: 1, group_count: 0 }],
  runs: [{ id: 'x', executed_at: '2026-11-10T10:00:00Z', row_count: 12, duration_ms: 40, report_code: 'RPT_1', report_name: 'Open invoices', run_by: 'Asha' }],
  schedules: [{ id: 'abcdef12', cron_expr: '0 8 * * 1', timezone: 'Asia/Kolkata', format: 'PDF', next_run_at: '2026-11-16T02:30:00Z', active: true, recipients: 2, report_name: 'Open invoices', report_code: 'RPT_1', last_run: null }],
  datasets: [{ code: 'invoices', label: 'Sales Invoices', owner_department: 'Sales', permission_resource: 'sales-invoices', column_count: 2, columns: [{ key: 'customer_name', label: 'Customer', type: 'string', sensitive: false, filterable: true, groupable: true }, { key: 'grand_total', label: 'Grand Total', type: 'number', sensitive: false, filterable: true, groupable: false }] }],
};

describe('BiLibraryPage', () => {
  it('Custom Dashboards: V40 tabs and the real dashboard row', async () => {
    api.getLibrary.mockResolvedValue(library);
    wrap('bi-dashboards', <BiLibraryPage pageId="bi-dashboards" />);
    expect(screen.getByRole('heading', { name: 'Custom Dashboards' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Dashboard Usage' })).toBeInTheDocument();
    expect(await screen.findByText('Sales Overview')).toBeInTheDocument();
    expect(screen.getByText('ABCDEF12')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Widget Count' })).toBeInTheDocument();
  });

  it('Custom Dashboards: usage tab says views are not recorded instead of inventing counts', async () => {
    api.getLibrary.mockResolvedValue(library);
    wrap('bi-dashboards', <BiLibraryPage pageId="bi-dashboards" />, 5);
    expect(await screen.findByText(/Dashboard views are not recorded/)).toBeInTheDocument();
    expect(screen.getByText('Open invoices')).toBeInTheDocument();
  });

  it('Saved Reports: library rows; favourites are an honest empty state', async () => {
    api.getLibrary.mockResolvedValue(library);
    wrap('bi-reports', <BiLibraryPage pageId="bi-reports" />);
    expect(await screen.findByText('Open invoices')).toBeInTheDocument();
    expect(screen.getByText('RPT_1')).toBeInTheDocument();
  });

  it('Saved Reports: Favorites tab does not invent favourites', async () => {
    api.getLibrary.mockResolvedValue(library);
    wrap('bi-reports', <BiLibraryPage pageId="bi-reports" />, 1);
    expect(await screen.findByText(/Favourite reports are not stored/)).toBeInTheDocument();
  });

  it('Report Scheduler: lists schedules and adds one through the API', async () => {
    api.getLibrary.mockResolvedValue(library);
    api.createSchedule.mockResolvedValue({});
    const user = userEvent.setup();
    wrap('bi-scheduler', <BiLibraryPage pageId="bi-scheduler" />);
    expect(await screen.findByText('0 8 * * 1 (Asia/Kolkata)')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add schedule' }));
    expect(api.createSchedule).toHaveBeenCalledWith({ reportId: 'r1', cronExpr: '0 8 * * 1', format: 'CSV', recipientUserIds: [] });
  });

  it('Report Builder: data sources and fields come from the governed datasets', async () => {
    api.getLibrary.mockResolvedValue(library);
    wrap('bi-builder', <BiLibraryPage pageId="bi-builder" />, 2);
    expect(await screen.findByText('Grand Total')).toBeInTheDocument();
    expect(screen.getByText('Measure (number)')).toBeInTheDocument();
  });

  it('empty library shows empty states', async () => {
    api.getLibrary.mockResolvedValue({ dashboards: [], reports: [], runs: [], schedules: [], datasets: [] });
    wrap('bi-dashboards', <BiLibraryPage pageId="bi-dashboards" />);
    expect(await screen.findByText('No dashboards have been created yet.')).toBeInTheDocument();
  });
});
