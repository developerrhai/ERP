/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-base-to-string */
// The library rows are loosely typed JSON from /bi/library (like the other BI pages), hence the any-related rule exceptions above.
// BI library pages: Custom Dashboards (bi-dashboards), Saved Reports (bi-reports), Report Builder (bi-builder), Report Scheduler (bi-scheduler).
// V40 tab names and columns; every row is a real record (dashboards, report_definitions, report_runs, report_schedules, bi_datasets).
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ErrorMessage } from '../../components/ErrorMessage';
import { biApi } from '../../lib/biApi';
import { useLoad } from '../../lib/useLoad';
import { v40TabsFor } from '../frame/V40TabFrame';
import { BarChart } from './BiCharts';
import { ChartCard, DataTable, Empty, Kpi, useOpenTab } from './BiParts';
import { distribution, type Col, type Row } from './analyticsModel';
import './bi-dashboards.css';

type J = Record<string, any>;
interface Library {
  dashboards: J[];
  reports: J[];
  runs: J[];
  schedules: J[];
  datasets: J[];
}

const TITLES: Record<string, string> = {
  'bi-dashboards': 'Custom Dashboards',
  'bi-reports': 'Saved Reports',
  'bi-builder': 'Report Builder',
  'bi-scheduler': 'Report Scheduler',
};
const PURPOSE = 'Design, distribute and analyze governed reports, dashboards, KPIs and scheduled insights.';
const d10 = (v: unknown): string | null => (v ? String(v).slice(0, 10) : null);
const dt = (v: unknown): string | null => (v ? String(v).replace('T', ' ').slice(0, 16) : null);
const T = (key: string, label: string): Col => ({ key, label, type: 'text' });
const I = (key: string, label: string): Col => ({ key, label, type: 'int' });
const D = (key: string, label: string): Col => ({ key, label, type: 'date' });
const GRAPHS = /^analytics/i;


export function BiLibraryPage({ pageId }: { pageId: string }) {
  const tabs = useMemo(() => v40TabsFor(pageId), [pageId]);
  const open = useOpenTab(tabs);
  const { data, loading, error, reload } = useLoad<Library>(() => biApi.getLibrary(), [pageId]);
  return (
    <div className="bi-dash">
      <h1>{TITLES[pageId] ?? 'Business Intelligence'}</h1>
      <p className="bi-purpose">{PURPOSE}</p>
      {error ? <ErrorMessage>{error}</ErrorMessage> : null}
      {loading ? <p className="muted">Loading…</p> : null}
      {data ? (
        pageId === 'bi-dashboards' ? (
          <Dashboards lib={data} tab={open.name} />
        ) : pageId === 'bi-reports' ? (
          <Reports lib={data} tab={open.name} />
        ) : pageId === 'bi-builder' ? (
          <Builder lib={data} tab={open.name} reload={reload} />
        ) : (
          <Scheduler lib={data} tab={open.name} reload={reload} />
        )
      ) : null}
    </div>
  );
}

function Cards({ items }: { items: Array<[string, string, string]> }) {
  return (
    <div className="kpis">
      {items.map(([l, v, h]) => (
        <Kpi key={l} label={l} value={v} hint={h} />
      ))}
    </div>
  );
}

function DocumentsNote() {
  return (
    <Empty>
      Files are not stored on BI pages. Attach and find documents in <Link to="/m/dms-docs">Document Management</Link>.
    </Empty>
  );
}

function RunsTable({ lib }: { lib: Library }) {
  const rows: Row[] = lib.runs.map((r) => ({ at: dt(r.executed_at), code: r.report_code, name: r.report_name, by: r.run_by ?? '—', rows: Number(r.row_count), ms: Number(r.duration_ms) }));
  return <DataTable title="Run History" columns={[T('at', 'Run At'), T('code', 'Report ID'), T('name', 'Report Name'), T('by', 'Run By'), I('rows', 'Rows'), I('ms', 'Duration (ms)')]} rows={rows} empty="No report has been run yet." />;
}

function SchedulesTable({ lib, title, columns }: { lib: Library; title: string; columns?: Col[] }) {
  const rows: Row[] = lib.schedules.map((s) => ({
    id: String(s.id).slice(0, 8).toUpperCase(),
    report: s.report_name,
    frequency: `${s.cron_expr} (${s.timezone})`,
    recipients: Number(s.recipients),
    format: s.format,
    last: dt(s.last_run),
    next: dt(s.next_run_at),
    status: s.active ? 'Active' : 'Paused',
  }));
  const all: Col[] = [T('id', 'Schedule ID'), T('report', 'Report'), T('frequency', 'Frequency'), I('recipients', 'Recipients'), T('format', 'Format'), T('last', 'Last Run'), T('next', 'Next Run'), T('status', 'Status')];
  return <DataTable title={title} columns={columns ?? all} rows={rows} empty="No schedules yet." />;
}

// ------------------------------------------------------------------ Custom Dashboards
function Dashboards({ lib, tab }: { lib: Library; tab: string }) {
  const rows: Row[] = lib.dashboards.map((d) => ({
    id: String(d.id).slice(0, 8).toUpperCase(),
    name: d.name,
    owner: d.owner ?? (d.department ? `${d.department} department` : '—'),
    widgets: Number(d.widgets ?? 0),
    shared: d.scope === 'DEPARTMENT' ? `${d.department ?? 'All'} department` : 'Only the owner',
    filters: d.department ? `Department: ${d.department}` : 'None',
    isDefault: d.is_default ? 'Yes' : 'No',
    created: d10(d.created_at),
  }));
  const base = [T('id', 'Dashboard ID'), T('name', 'Dashboard Name')];
  if (GRAPHS.test(tab)) {
    return (
      <>
        <Cards
          items={[
            ['Dashboards', String(rows.length), 'Visible to you'],
            ['Department dashboards', String(lib.dashboards.filter((d) => d.scope === 'DEPARTMENT').length), 'Shared with a department'],
            ['Personal dashboards', String(lib.dashboards.filter((d) => d.scope === 'USER').length), 'Only the owner'],
            ['Widgets', String(rows.reduce((s, r) => s + Number(r.widgets), 0)), 'Across all dashboards'],
          ]}
        />
        {rows.length === 0 ? (
          <Empty>No dashboards have been created yet.</Empty>
        ) : (
          <div className="bi-two">
            <ChartCard title="Widgets per Dashboard">
              <BarChart label="Widgets per dashboard" items={rows.map((r) => ({ label: String(r.name), value: Number(r.widgets) }))} />
            </ChartCard>
            <ChartCard title="Status / Business Distribution">
              <BarChart label="Dashboards by sharing" items={distribution({ columns: [], rows }, 'shared')} />
            </ChartCard>
          </div>
        )}
      </>
    );
  }
  if (/^documents$/i.test(tab)) return <DocumentsNote />;
  if (/^reports$/i.test(tab)) return <Reports lib={lib} tab="Report Library" />;
  if (tab === 'Widget Layout') return <DataTable title={tab} columns={[...base, I('widgets', 'Widget Count'), T('isDefault', 'Default'), D('created', 'Created')]} rows={rows} empty="No dashboards yet." />;
  if (tab === 'Filters') return <DataTable title={tab} columns={[...base, T('filters', 'Default Filters'), T('shared', 'Shared With')]} rows={rows} empty="No dashboards yet." />;
  if (tab === 'Sharing') return <DataTable title={tab} columns={[...base, T('owner', 'Owner'), T('shared', 'Shared With')]} rows={rows} empty="No dashboards yet." />;
  if (tab === 'Subscriptions') return <SchedulesTable lib={lib} title="Subscriptions (scheduled report deliveries)" />;
  if (tab === 'Dashboard Usage') {
    return (
      <>
        <Empty>Dashboard views are not recorded by the ERP, so there is no per-dashboard usage count. Report runs are recorded and shown below.</Empty>
        <RunsTable lib={lib} />
      </>
    );
  }
  return (
    <>
      <Cards
        items={[
          ['Dashboards', String(rows.length), 'Visible to you'],
          ['Widgets', String(rows.reduce((s, r) => s + Number(r.widgets), 0)), 'Across all dashboards'],
        ]}
      />
      <DataTable title="Dashboard Library" columns={[...base, T('owner', 'Owner'), I('widgets', 'Widget Count'), T('shared', 'Shared With'), T('filters', 'Default Filters'), D('created', 'Created')]} rows={rows} empty="No dashboards have been created yet." />
    </>
  );
}

// ------------------------------------------------------------------ Saved Reports
function Reports({ lib, tab }: { lib: Library; tab: string }) {
  const rows: Row[] = lib.reports.map((r) => ({
    code: r.code,
    name: r.name,
    category: r.dataset_label,
    owner: r.owner ?? (r.is_system ? 'System' : '—'),
    shared: r.visibility === 'ALL' ? 'Everyone' : r.visibility === 'DEPARTMENT' ? `${r.department ?? ''} department` : 'Only the owner',
    last: dt(r.last_run),
    runs: Number(r.run_count),
    resource: r.permission_resource,
    chart: r.chart_type,
  }));
  if (GRAPHS.test(tab) || tab === 'Usage Analytics') {
    const total = rows.reduce((s, r) => s + Number(r.runs), 0);
    return (
      <>
        <Cards
          items={[
            ['Reports', String(rows.length), 'Visible to you'],
            ['Total runs', String(total), 'All time'],
            ['Runs recorded', String(lib.runs.length), 'Latest 100'],
            ['Schedules', String(lib.schedules.length), 'Scheduled deliveries'],
          ]}
        />
        {rows.length === 0 ? (
          <Empty>No saved reports yet.</Empty>
        ) : (
          <div className="bi-two">
            <ChartCard title="Runs per Report">
              <BarChart label="Runs per report" items={rows.slice(0, 12).map((r) => ({ label: String(r.name), value: Number(r.runs) }))} />
            </ChartCard>
            <ChartCard title="Status / Business Distribution">
              <BarChart label="Reports by data source" items={distribution({ columns: [], rows }, 'category')} />
            </ChartCard>
          </div>
        )}
        {tab === 'Usage Analytics' ? <DataTable title="Usage" columns={[T('code', 'Report ID'), T('name', 'Report Name'), I('runs', 'Run Count'), T('last', 'Last Run')]} rows={rows} empty="No reports." /> : null}
      </>
    );
  }
  if (/^documents$/i.test(tab)) return <DocumentsNote />;
  if (tab === 'Favorites') {
    return <Empty>Favourite reports are not stored by the ERP yet, so there is nothing to list. Open the Report Library to run any report.</Empty>;
  }
  if (tab === 'Permissions') return <DataTable title="Permissions" columns={[T('code', 'Report ID'), T('name', 'Report Name'), T('shared', 'Shared With'), T('resource', 'Permission Needed to View Data')]} rows={rows} empty="No reports." />;
  if (tab === 'Run History') return <RunsTable lib={lib} />;
  if (tab === 'Exports') return <SchedulesTable lib={lib} title="Exports (scheduled deliveries and formats)" />;
  return (
    <>
      <DataTable title="Report Library" columns={[T('code', 'Report ID'), T('name', 'Report Name'), T('category', 'Category'), T('owner', 'Owner'), T('shared', 'Shared With'), T('last', 'Last Run'), I('runs', 'Run Count')]} rows={rows} empty="No saved reports yet. Build one in Report Builder." aside={<Link to="/m/bi-builder">New report</Link>} />
    </>
  );
}

// ------------------------------------------------------------------ Report Builder
function Builder({ lib, tab, reload }: { lib: Library; tab: string; reload: () => void }) {
  const [ds, setDs] = useState<string>(lib.datasets[0]?.code ?? '');
  const dataset = lib.datasets.find((d) => d.code === ds);
  const cols: J[] = Array.isArray(dataset?.columns) ? dataset.columns : [];
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<string[] | null>(null);
  const [preview, setPreview] = useState<Row[]>([]);
  const [previewed, setPreviewed] = useState(false);
  const [scope, setScope] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [groupBy, setGroupBy] = useState('');
  const [measure, setMeasure] = useState('');
  const chosen = picked ?? cols.map((c) => c.key as string);
  const colDefs: Col[] = cols.filter((c) => chosen.includes(c.key)).map((c) => ({ key: c.key, label: c.label, type: c.type === 'number' ? 'num' : 'text' }));

  const reports: Row[] = lib.reports.map((r) => ({
    code: r.code,
    name: r.name,
    source: r.dataset_label,
    dims: Number(r.group_count),
    measures: Number(r.column_count),
    filters: Number(r.filter_count),
    viz: r.chart_type,
    status: r.is_system ? 'System' : 'Saved',
  }));
  const selector = (
    <div className="bi-form">
      <label>
        Data source
        <select
          value={ds}
          onChange={(e) => {
            setDs(e.target.value);
            setPicked(null);
            setPreview([]);
            setPreviewed(false);
            setGroupBy('');
            setMeasure('');
          }}
        >
          {lib.datasets.map((d) => (
            <option key={String(d.code)} value={String(d.code)}>
              {String(d.label)}
            </option>
          ))}
        </select>
      </label>
    </div>
  );

  const runPreview = async (): Promise<void> => {
    setErr('');
    try {
      const res = await biApi.queryDataset({ datasetCode: ds, columns: chosen, limit: 200 });
      setPreview((res.rows ?? []) as Row[]);
      setScope(String(res.scopeApplied ?? ''));
      setPreviewed(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'The query was blocked.');
    }
  };
  const save = async (): Promise<void> => {
    setErr('');
    setMsg('');
    if (!name.trim()) return setErr('Give the report a name first.');
    try {
      await biApi.createReport({ code: `RPT_${Date.now().toString().slice(-6)}`, name: name.trim(), datasetCode: ds, columns: chosen, chartType: groupBy && measure ? 'BAR' : 'TABLE', groupBy: groupBy ? [groupBy] : [] });
      setName('');
      setMsg('Report saved.');
      reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save the report.');
    }
  };

  const grouped = useMemo(() => {
    if (!groupBy || !measure) return [];
    const m = new Map<string, number>();
    for (const r of preview) m.set(String(r[groupBy] ?? 'Blank'), (m.get(String(r[groupBy] ?? 'Blank')) ?? 0) + Number(r[measure] ?? 0));
    return [...m.entries()].map(([label, value]) => ({ label, value: Math.round(value * 100) / 100 })).sort((a, b) => b.value - a.value).slice(0, 12);
  }, [preview, groupBy, measure]);

  if (GRAPHS.test(tab)) {
    return (
      <>
        <Cards
          items={[
            ['Reports', String(reports.length), 'Saved definitions'],
            ['Data sources', String(lib.datasets.length), 'Governed datasets'],
            ['Chart reports', String(reports.filter((r) => r.viz !== 'TABLE').length), 'With a chart type'],
            ['Runs', String(lib.runs.length), 'Latest 100'],
          ]}
        />
        {reports.length === 0 ? (
          <Empty>No reports yet. Use Preview &amp; Publish to save the first one.</Empty>
        ) : (
          <div className="bi-two">
            <ChartCard title="Reports by Data Source">
              <BarChart label="Reports by data source" items={distribution({ columns: [], rows: reports }, 'source')} />
            </ChartCard>
            <ChartCard title="Status / Business Distribution">
              <BarChart label="Reports by visualisation" items={distribution({ columns: [], rows: reports }, 'viz')} />
            </ChartCard>
          </div>
        )}
      </>
    );
  }
  if (/^documents$/i.test(tab)) return <DocumentsNote />;
  if (/^reports$/i.test(tab)) return <Reports lib={lib} tab="Report Library" />;
  if (tab === 'Data Sources') {
    return <DataTable title="Data Sources" columns={[T('code', 'Data Source'), T('label', 'Label'), T('dept', 'Owner Department'), I('n', 'Fields'), T('res', 'Permission Needed')]} rows={lib.datasets.map((d) => ({ code: d.code, label: d.label, dept: d.owner_department, n: Number(d.column_count), res: d.permission_resource }))} empty="No data sources." />;
  }
  if (tab === 'Fields & Measures' || tab === 'Filters & Groups') {
    const rows: Row[] = cols.map((c) => ({ key: c.key, label: c.label, type: c.type === 'number' ? 'Measure (number)' : c.type === 'date' ? 'Date' : 'Dimension (text)', sensitive: c.sensitive ? 'Masked' : 'Open', filter: c.filterable ? 'Yes' : 'No', group: c.groupable ? 'Yes' : 'No' }));
    return (
      <>
        {selector}
        <DataTable title={tab} columns={tab === 'Fields & Measures' ? [T('key', 'Field'), T('label', 'Label'), T('type', 'Role'), T('sensitive', 'Sensitive Data')] : [T('key', 'Field'), T('label', 'Label'), T('filter', 'Can Filter'), T('group', 'Can Group')]} rows={rows} empty="This data source has no fields." />
      </>
    );
  }
  if (tab === 'Chart Builder') {
    const dims = cols.filter((c) => c.groupable);
    const meas = cols.filter((c) => c.type === 'number');
    return (
      <>
        {selector}
        <div className="bi-form">
          <label>
            Group by
            <select value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
              <option value="">Choose a field</option>
              {dims.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Measure (sum)
            <select value={measure} onChange={(e) => setMeasure(e.target.value)}>
              <option value="">Choose a field</option>
              {meas.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="btn primary" onClick={() => void runPreview()}>
            Build chart
          </button>
        </div>
        {err ? <p className="bi-err" role="alert">{err}</p> : null}
        {grouped.length ? (
          <ChartCard title={`${meas.find((c) => c.key === measure)?.label ?? ''} by ${dims.find((c) => c.key === groupBy)?.label ?? ''}`} sub={`From up to 200 records you can see (${scope})`}>
            <BarChart label="Chart builder preview" items={grouped} />
          </ChartCard>
        ) : (
          <Empty>{previewed ? 'No rows to chart for this selection.' : 'Pick a field to group by and a measure, then build the chart.'}</Empty>
        )}
      </>
    );
  }
  if (tab === 'Preview & Publish') {
    return (
      <>
        {selector}
        <div className="bi-form">
          <label>
            Report name
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={150} />
          </label>
          <button type="button" className="btn" onClick={() => void runPreview()}>
            Preview
          </button>
          <button type="button" className="btn primary" onClick={() => void save()}>
            Publish report
          </button>
        </div>
        <div className="bi-form">
          {cols.map((c) => (
            <label key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 400 }}>
              <input
                type="checkbox"
                checked={chosen.includes(c.key)}
                onChange={(e) => setPicked(e.target.checked ? [...chosen, c.key] : chosen.filter((k) => k !== c.key))}
              />
              {c.label}
            </label>
          ))}
        </div>
        {err ? <p className="bi-err" role="alert">{err}</p> : null}
        {msg ? <p className="bi-note" role="status">{msg}</p> : null}
        {previewed ? <DataTable title={`Preview (${preview.length} rows, scope ${scope})`} columns={colDefs} rows={preview} empty="No rows match your access." /> : <Empty>Press Preview to see the rows this report would return for you.</Empty>}
      </>
    );
  }
  // Report Designer
  return (
    <DataTable
      title="Report Designer"
      columns={[T('code', 'Report ID'), T('name', 'Report Name'), T('source', 'Data Source'), I('dims', 'Dimensions'), I('measures', 'Measures'), I('filters', 'Filters'), T('viz', 'Visualization'), T('status', 'Status')]}
      rows={reports}
      empty="No reports yet. Use Preview & Publish to create one."
    />
  );
}

// ------------------------------------------------------------------ Report Scheduler
function Scheduler({ lib, tab, reload }: { lib: Library; tab: string; reload: () => void }) {
  const [reportId, setReportId] = useState('');
  const [cron, setCron] = useState('0 8 * * 1');
  const [format, setFormat] = useState<'CSV' | 'XLSX' | 'PDF'>('CSV');
  const [err, setErr] = useState('');
  const create = async (): Promise<void> => {
    setErr('');
    try {
      await biApi.createSchedule({ reportId: reportId || lib.reports[0]?.id, cronExpr: cron, format, recipientUserIds: [] });
      reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not create the schedule.');
    }
  };
  if (GRAPHS.test(tab)) {
    const rows: Row[] = lib.schedules.map((s) => ({ format: s.format, status: s.active ? 'Active' : 'Paused', report: s.report_name }));
    return (
      <>
        <Cards
          items={[
            ['Schedules', String(rows.length), 'Visible to you'],
            ['Active', String(rows.filter((r) => r.status === 'Active').length), 'Will run'],
            ['Paused', String(rows.filter((r) => r.status === 'Paused').length), 'Not running'],
            ['Reports scheduled', String(new Set(rows.map((r) => r.report)).size), 'Distinct reports'],
          ]}
        />
        {rows.length === 0 ? (
          <Empty>No schedules yet.</Empty>
        ) : (
          <div className="bi-two">
            <ChartCard title="Schedules by Format">
              <BarChart label="Schedules by format" items={distribution({ columns: [], rows }, 'format')} />
            </ChartCard>
            <ChartCard title="Status / Business Distribution">
              <BarChart label="Schedules by status" items={distribution({ columns: [], rows }, 'status')} />
            </ChartCard>
          </div>
        )}
      </>
    );
  }
  if (/^documents$/i.test(tab)) return <DocumentsNote />;
  if (/^reports$/i.test(tab)) return <Reports lib={lib} tab="Report Library" />;
  if (tab === 'Run History') return <RunsTable lib={lib} />;
  if (tab === 'Calendar & Schedule') {
    const upcoming = [...lib.schedules].filter((s) => s.next_run_at && s.active).sort((a, b) => String(a.next_run_at).localeCompare(String(b.next_run_at)));
    const rows: Row[] = upcoming.map((s) => ({ when: dt(s.next_run_at), report: s.report_name, frequency: `${s.cron_expr} (${s.timezone})`, format: s.format }));
    return <DataTable title="Upcoming deliveries" columns={[T('when', 'Next Run'), T('report', 'Report'), T('frequency', 'Frequency'), T('format', 'Format')]} rows={rows} empty="No upcoming schedule." />;
  }
  const emph: Record<string, string[]> = {
    'Report Selection': ['id', 'report', 'status'],
    Frequency: ['id', 'report', 'frequency', 'next'],
    Recipients: ['id', 'report', 'recipients'],
    'Delivery Format': ['id', 'report', 'format'],
  };
  const all: Col[] = [T('id', 'Schedule ID'), T('report', 'Report'), T('frequency', 'Frequency'), I('recipients', 'Recipients'), T('format', 'Format'), T('last', 'Last Run'), T('next', 'Next Run'), T('status', 'Status')];
  const keep = emph[tab];
  return (
    <>
      <SchedulesTable lib={lib} title={tab || 'Schedule Register'} columns={keep ? all.filter((c) => keep.includes(c.key)) : all} />
      {!keep || tab === 'Report Selection' ? (
        <div className="card bi-table-card">
          <div className="bi-form">
            <label>
              Report
              <select value={reportId} onChange={(e) => setReportId(e.target.value)}>
                {lib.reports.map((r) => (
                  <option key={String(r.id)} value={String(r.id)}>
                    {String(r.name)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Frequency (cron)
              <input value={cron} onChange={(e) => setCron(e.target.value)} />
            </label>
            <label>
              Format
              <select value={format} onChange={(e) => setFormat(e.target.value as 'CSV' | 'XLSX' | 'PDF')}>
                <option value="CSV">CSV</option>
                <option value="XLSX">XLSX</option>
                <option value="PDF">PDF</option>
              </select>
            </label>
            <button type="button" className="btn primary" onClick={() => void create()} disabled={lib.reports.length === 0}>
              Add schedule
            </button>
          </div>
          {err ? <p className="bi-err" role="alert" style={{ padding: '0 14px' }}>{err}</p> : null}
        </div>
      ) : null}
    </>
  );
}
