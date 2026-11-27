// Centralized Quality dashboard: All Departments filter, Import / Export / All Data on top, and the live graphs
// (incoming acceptance ring, in-process defect trend with shift / hour drill-down, supplier columns, customer complaint
// status with the 8D gates, rejection and revoke dial). Every figure comes from GET /qms/dashboard.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useToast } from '../../../components/Toast';
import { qget, qlist } from '../../../lib/qmsApi';
import { useLoad } from '../../../lib/useLoad';
import type { ActionSet } from '../../../types';
import { dmy, Empty, ErrorBox, PageHead, Pill, todayIso } from '../../finance/shared';
import { Columns, Donut, Gauge, ProgressList, SERIES, STATUS, TrendLine } from './charts';
import { ImportDialog } from './ImportDialog';
import { messageOf, PriorityPill, saveCsv } from './shared';

interface Dash {
  from: string;
  to: string;
  departments: string[];
  incoming: {
    accepted: number;
    conditional: number;
    partial: number;
    rejected: number;
    decided: number;
    pending: number;
    acceptancePct: number | null;
    conditionalPct: number | null;
    rejectionPct: number | null;
    previousAcceptancePct: number | null;
  };
  inProcess: { drill: string; machines: string[]; series: { label: string; sheets: number; checks: number; failed: number; rate: number }[]; checks: number; failed: number; rate: number | null };
  suppliers: { totalDefects: number; rows: { supplier: string; lots: number; rejectedLots: number; defects: number; rating: number | null }[] };
  complaints: { total: number; open: number; pending: number; closed: number; priority: Record<'MINOR' | 'MAJOR' | 'CRITICAL', number>; stages: { key: string; label: string; done: number }[] };
  revoke: { rejected: number; openLots: number; revoked: number; pending: number; revokedPct: number | null };
}
interface DataRow {
  type: string;
  page: string;
  id: string;
  number: string;
  date: string;
  party: string | null;
  title: string | null;
  status: string;
  priority: string | null;
  department: string | null;
}

const daysAgo = (n: number): string => new Date(Date.parse(`${todayIso()}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
const show = (v: number | null): string => (v === null ? '—' : `${v}%`);

function Card({ title, to, value, sub, note, children }: { title: string; to: string; value: string; sub: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="qv-card" aria-label={title}>
      <header>
        <h3>{title}</h3>
        <Link to={to} className="qv-open" aria-label={`Open ${title}`}>
          Open →
        </Link>
      </header>
      <p className="qv-figure">
        <b>{value}</b>
        <span>{sub}</span>
      </p>
      {children}
      {note ? <p className="qv-note">{note}</p> : null}
    </section>
  );
}

function AllData({ department, canExport }: { department: string; canExport: boolean }) {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const load = useLoad(() => qlist<DataRow>('/all-data', { q: q || undefined, type: type || undefined, department: department || undefined, page, size: 25 }), [q, type, department, page]);
  const rows = load.data?.rows ?? [];
  const total = load.data?.meta.total ?? 0;
  const types = (load.data?.meta as { types?: string[] } | undefined)?.types ?? [];
  const pages = Math.max(1, Math.ceil(total / 25));
  const exportAll = async (): Promise<void> => {
    const out: unknown[][] = [['Type', 'Number', 'Date', 'Party', 'Title', 'Status', 'Priority', 'Department']];
    try {
      for (let p = 1; p <= 100; p += 1) {
        const r = await qlist<DataRow>('/all-data', { q: q || undefined, type: type || undefined, department: department || undefined, page: p, size: 100 });
        out.push(...r.rows.map((x) => [x.type, x.number, x.date, x.party, x.title, x.status, x.priority, x.department]));
        if (r.rows.length < 100) break;
      }
      saveCsv('quality-all-data.csv', out);
    } catch (e) {
      toast(messageOf(e));
    }
  };
  return (
    <section aria-label="All Data">
      <div className="toolbar">
        <input
          aria-label="Search all data"
          placeholder="Search number, party, title or status"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
        <select
          aria-label="Record type"
          value={type}
          onChange={(e) => {
            setType(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All record types</option>
          {(type && !types.includes(type) ? [type, ...types] : types).map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <span className="qv-count">{total} records</span>
        {canExport ? (
          <button type="button" className="btn" disabled={total === 0} title={total === 0 ? 'There is nothing to export.' : undefined} onClick={() => void exportAll()}>
            Export list
          </button>
        ) : null}
      </div>
      {department ? <p className="qv-note">Only records that carry a department are listed for {department}: customer and conformance NCRs and meeting minutes.</p> : null}
      <ErrorBox message={load.error} />
      <div className="card table-wrap">
        <table className="register-table plain">
          <thead>
            <tr>
              <th>Type</th>
              <th>Number</th>
              <th>Date</th>
              <th>Party / source</th>
              <th>Title</th>
              <th>Status</th>
              <th>Priority</th>
              <th>Department</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.type}-${r.id}`}>
                <td>{r.type}</td>
                <td>
                  <Link to={`/m/${r.page}`}>{r.number}</Link>
                </td>
                <td>{dmy(r.date)}</td>
                <td>{r.party ?? '—'}</td>
                <td>{r.title ?? '—'}</td>
                <td>
                  <Pill>{r.status}</Pill>
                </td>
                <td>
                  <PriorityPill value={r.priority} />
                </td>
                <td>{r.department ?? '—'}</td>
              </tr>
            ))}
            {rows.length === 0 && !load.loading ? <Empty cols={8}>No quality record matches.</Empty> : null}
          </tbody>
        </table>
      </div>
      <div className="actions">
        <button type="button" className="btn sm" disabled={page <= 1} title={page <= 1 ? 'This is the first page.' : undefined} onClick={() => setPage((p) => p - 1)}>
          Previous
        </button>
        <span>
          Page {page} of {pages}
        </span>
        <button type="button" className="btn sm" disabled={page >= pages} title={page >= pages ? 'This is the last page.' : undefined} onClick={() => setPage((p) => p + 1)}>
          Next
        </button>
      </div>
    </section>
  );
}

export function QualityDashboard({ actions }: { actions: ActionSet }) {
  const [department, setDepartment] = useState('');
  const [from, setFrom] = useState(() => daysAgo(179));
  const [to, setTo] = useState(todayIso);
  const [drill, setDrill] = useState('day');
  const [machine, setMachine] = useState('');
  const [all, setAll] = useState(false);
  const [importing, setImporting] = useState(false);
  const [tick, setTick] = useState(0);
  const load = useLoad(
    () => qget<Dash>('/dashboard', { from, to, department: department || undefined, drill, machine: machine || undefined }),
    [from, to, department, drill, machine, tick],
  );
  // the last answer stays on screen (dimmed) while a new one is fetched
  const d = load.data;

  const exportDashboard = (): void => {
    if (!d) return;
    saveCsv('quality-dashboard.csv', [
      ['Quality dashboard', `${d.from} to ${d.to}`, department || 'All Departments'],
      [],
      ['Incoming quality', 'Lots', 'Share %'],
      ['Accepted', d.incoming.accepted, d.incoming.acceptancePct],
      ['Conditionally accepted', d.incoming.conditional, d.incoming.conditionalPct],
      ['Partly rejected', d.incoming.partial],
      ['Rejected', d.incoming.rejected],
      ['Rejection ratio (rejected + partly)', d.incoming.rejected + d.incoming.partial, d.incoming.rejectionPct],
      ['Waiting for decision', d.incoming.pending],
      [],
      [`In-process by ${d.inProcess.drill}`, 'Sheets', 'Checks', 'Failed', 'Defect rate %'],
      ...d.inProcess.series.map((s) => [s.label, s.sheets, s.checks, s.failed, s.rate]),
      [],
      ['Supplier', 'Defects', 'Lots', 'Rejected lots', 'Quality rating %'],
      ...d.suppliers.rows.map((s) => [s.supplier, s.defects, s.lots, s.rejectedLots, s.rating]),
      [],
      ['Customer complaints', 'Count'],
      ['Open', d.complaints.open],
      ['Pending acceptance', d.complaints.pending],
      ['Closed', d.complaints.closed],
      ['Minor', d.complaints.priority.MINOR],
      ['Major', d.complaints.priority.MAJOR],
      ['Critical', d.complaints.priority.CRITICAL],
      ...d.complaints.stages.map((s) => [`${s.label} passed`, s.done]),
      [],
      ['Rejection and revoke', 'Value'],
      ['Rejected lots', d.revoke.rejected],
      ['Revoke requests waiting', d.revoke.pending],
      ['Revoked', d.revoke.revoked],
      ['Revoked %', d.revoke.revokedPct],
    ]);
  };

  const notByDepartment = department ? 'Not recorded by department: shows every department.' : undefined;
  const inc = d?.incoming;
  const change = inc && inc.acceptancePct !== null && inc.previousAcceptancePct !== null ? Math.round((inc.acceptancePct - inc.previousAcceptancePct) * 10) / 10 : null;

  return (
    <div className="qv-page qv-dashboard">
      <PageHead title="Centralized System Dashboard" sub="Quality across all departments, counted from the live records.">
        {actions.import ? (
          <button type="button" className="btn" onClick={() => setImporting(true)}>
            ⇧ Import
          </button>
        ) : null}
        {actions.export ? (
          <button type="button" className="btn" disabled={!d} title={d ? undefined : 'Loading.'} onClick={exportDashboard}>
            ⇩ Export
          </button>
        ) : null}
        <button type="button" className={`btn${all ? ' primary' : ''}`} aria-pressed={all} onClick={() => setAll((x) => !x)}>
          {all ? '← Dashboard' : 'All Data'}
        </button>
      </PageHead>
      <div className="toolbar qv-filters">
        <select aria-label="Department" value={department} onChange={(e) => setDepartment(e.target.value)}>
          <option value="">All Departments</option>
          {(d?.departments ?? []).map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
        {all ? null : (
          <>
            {([['30 days', 29], ['90 days', 89], ['6 months', 179], ['1 year', 364]] as const).map(([label, back]) => (
              <button
                key={label}
                type="button"
                className={`btn sm${from === daysAgo(back) && to === todayIso() ? ' primary' : ''}`}
                onClick={() => {
                  setFrom(daysAgo(back));
                  setTo(todayIso());
                }}
              >
                {label}
              </button>
            ))}
            <label htmlFor="qv-d-from">From</label>
            <input id="qv-d-from" type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} />
            <label htmlFor="qv-d-to">To</label>
            <input id="qv-d-to" type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} />
          </>
        )}
      </div>
      <ErrorBox message={load.error} />
      {all ? (
        <AllData department={department} canExport={actions.export} />
      ) : !d ? (
        load.loading ? <p role="status">Loading…</p> : null
      ) : (
        <div className={`qv-grid${load.loading ? ' stale' : ''}`}>
          <Card
            title="In. Quality"
            to="/m/qms-incoming"
            value={show(d.incoming.acceptancePct)}
            sub={`Incoming lots accepted · ${d.incoming.decided} decided${change === null ? '' : ` · ${change >= 0 ? '▲' : '▼'} ${Math.abs(change)} pts on the period before`}`}
            note={notByDepartment ?? `Conditionally accepted ${show(d.incoming.conditionalPct)} · Rejection ratio ${show(d.incoming.rejectionPct)} · ${d.incoming.pending} waiting for a decision`}
          >
            <Donut
              caption="Incoming lots by decision"
              center={show(d.incoming.acceptancePct)}
              slices={[
                { label: 'Accepted', value: d.incoming.accepted, color: STATUS.good },
                { label: 'Conditionally accepted', value: d.incoming.conditional, color: STATUS.warning },
                { label: 'Partly rejected', value: d.incoming.partial, color: STATUS.serious },
                { label: 'Rejected', value: d.incoming.rejected, color: STATUS.critical },
              ]}
            />
          </Card>
          <Card
            title="In-Process"
            to="/m/qms-process"
            value={show(d.inProcess.rate)}
            sub={`Defect rate · ${d.inProcess.failed} of ${d.inProcess.checks} checks failed`}
            note={notByDepartment}
          >
            <div className="toolbar qv-drill">
              <select aria-label="Show defect rate by" value={drill} onChange={(e) => setDrill(e.target.value)}>
                <option value="day">By day</option>
                <option value="shift">By shift</option>
                <option value="hour">By hour</option>
                <option value="machine">By machine / line</option>
              </select>
              <select aria-label="Machine" value={machine} onChange={(e) => setMachine(e.target.value)}>
                <option value="">All machines</option>
                {d.inProcess.machines.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </div>
            {d.inProcess.series.length === 0 ? (
              <p className="qv-empty">No in-process sheet was submitted in these dates.</p>
            ) : d.inProcess.drill === 'day' || d.inProcess.drill === 'hour' ? (
              <TrendLine
                unit="%"
                caption="In-process defect rate"
                points={d.inProcess.series.map((s) => ({
                  label: d.inProcess.drill === 'day' ? dmy(s.label).slice(0, 5) : s.label,
                  value: s.rate,
                  tip: `${d.inProcess.drill === 'day' ? dmy(s.label) : s.label}: ${s.rate}% (${s.failed} of ${s.checks} checks, ${s.sheets} sheet(s))`,
                }))}
              />
            ) : (
              <ProgressList rows={d.inProcess.series.map((s) => ({ label: s.label, value: s.failed, of: s.checks, color: SERIES.blue, text: `${s.rate}% · ${s.failed} of ${s.checks}` }))} />
            )}
          </Card>
          <Card title="Supplier" to="/m/qms-supplier" value={String(d.suppliers.totalDefects)} sub="Supplier defects (failed checks and rejected lots)" note={notByDepartment}>
            {d.suppliers.rows.length === 0 ? (
              <p className="qv-empty">No supplier lot was inspected in these dates.</p>
            ) : (
              <>
                <Columns
                  caption="Defects by supplier"
                  bars={d.suppliers.rows.slice(0, 6).map((s) => ({
                    label: s.supplier,
                    value: s.defects,
                    tip: `${s.supplier}: ${s.defects} defect(s), quality rating ${show(s.rating)}`,
                  }))}
                />
                <table className="register-table plain qv-mini">
                  <thead>
                    <tr>
                      <th>Supplier</th>
                      <th>Defects</th>
                      <th>Lots</th>
                      <th>Rating</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.suppliers.rows.map((s) => (
                      <tr key={s.supplier}>
                        <td>{s.supplier}</td>
                        <td className="num">{s.defects}</td>
                        <td className="num">{s.lots}</td>
                        <td className="num">{show(s.rating)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </Card>
          <Card title="Customer Complaint" to="/m/qms-customer-ncr" value={String(d.complaints.open + d.complaints.pending)} sub={`Open complaints · ${d.complaints.closed} closed of ${d.complaints.total}`}>
            <h4>Status</h4>
            <ProgressList
              rows={[
                { label: 'Open', value: d.complaints.open, of: d.complaints.total, color: SERIES.blue },
                { label: 'Pending acceptance', value: d.complaints.pending, of: d.complaints.total, color: SERIES.orange },
                { label: 'Closed', value: d.complaints.closed, of: d.complaints.total, color: STATUS.good },
              ]}
            />
            <h4>Priority</h4>
            <ProgressList
              rows={[
                { label: 'Minor', value: d.complaints.priority.MINOR, of: d.complaints.total, color: STATUS.warning },
                { label: 'Major', value: d.complaints.priority.MAJOR, of: d.complaints.total, color: STATUS.serious },
                { label: 'Critical', value: d.complaints.priority.CRITICAL, of: d.complaints.total, color: STATUS.critical },
              ]}
            />
          </Card>
          <Card
            title="Complaint 8D Gates"
            to="/m/qms-customer-ncr?tab=3"
            value={d.complaints.total ? `${Math.round((d.complaints.stages.reduce((a, s) => a + s.done, 0) / (d.complaints.total * 8)) * 100)}%` : '—'}
            sub="8D stage completion across the complaints"
          >
            <ProgressList rows={d.complaints.stages.map((s) => ({ label: s.label, value: s.done, of: d.complaints.total, color: SERIES.blue }))} />
          </Card>
          <Card title="Internal Rejection Revoke" to="/m/qms-rejection-revoke" value={String(d.revoke.rejected)} sub={`Rejected lots · ${d.revoke.openLots} still open`} note={notByDepartment}>
            <Gauge share={(d.revoke.revokedPct ?? 0) / 100} color={STATUS.critical} value={show(d.revoke.revokedPct)} caption="Rejections revoked in these dates" />
            <ProgressList
              rows={[
                { label: 'Revoked', value: d.revoke.revoked, of: d.revoke.rejected, color: STATUS.critical },
                { label: 'Revoke requests waiting (now)', value: d.revoke.pending, of: Math.max(d.revoke.rejected, d.revoke.pending), color: STATUS.warning, text: String(d.revoke.pending) },
              ]}
            />
          </Card>
        </div>
      )}
      {importing ? <ImportDialog kinds={['customer-ncr', 'conformance-ncr', 'cost']} onClose={() => setImporting(false)} onDone={() => setTick((n) => n + 1)} /> : null}
    </div>
  );
}
