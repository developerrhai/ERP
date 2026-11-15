// V40 Command Center: control-tower hero with six KPIs, risk-by-area chart, add-item form and the
// command data table. Items are the real open department movements; nothing is invented.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { workApi, type Dept, type InboxCounts, type Movement } from '../../lib/workApi';
import { BarChart } from './BarChart';
import './executive.css';

const MAX_ROWS = 300;

export function CommandCenterPage() {
  const [rows, setRows] = useState<Movement[]>([]);
  const [counts, setCounts] = useState<InboxCounts | null>(null);
  const [depts, setDepts] = useState<Dept[]>([]);
  const [deptId, setDeptId] = useState('all');
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    void workApi.departments().then(setDepts, () => setDepts([]));
  }, []);

  useEffect(() => {
    let alive = true;
    setLoaded(false);
    setFailed(false);
    void (async () => {
      try {
        const c = await workApi.counts('all');
        const acc: Movement[] = [];
        let cursor: string | undefined;
        for (;;) {
          const page = await workApi.inbox({ dept: 'all', tab: 'open', cursor });
          acc.push(...page.rows);
          if (!page.hasMore || !page.nextCursor || acc.length >= MAX_ROWS) break;
          cursor = page.nextCursor;
        }
        if (!alive) return;
        setCounts(c);
        setRows(acc);
      } catch {
        if (alive) setFailed(true);
      } finally {
        if (alive) setLoaded(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const shown = useMemo(() => (deptId === 'all' ? rows : rows.filter((r) => r.to_department_id === deptId)), [rows, deptId]);
  const critical = rows.filter((r) => r.priority === 'Critical').length;
  const high = rows.filter((r) => r.priority === 'High').length;
  const late = rows.filter((r) => r.is_late).length;
  const areas = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.to_department, (m.get(r.to_department) ?? 0) + 1);
    return [...m.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  }, [rows]);
  const system: 'GREEN' | 'AMBER' | 'RED' = critical > 0 ? 'RED' : late > 0 ? 'AMBER' : 'GREEN';
  const num = (n: number | null | undefined) => (n === null || n === undefined ? '—' : String(n));

  return (
    <div className="ex-page" data-testid="command-center">
      <section className="ex-hero" style={{ display: 'block' }}>
        <small>Enterprise Control Tower</small>
        <h2>Command Center</h2>
        <p>Live cross-functional action board built from open department work, approvals and handovers.</p>
        <div className="ex-kpis">
          <div className="ex-kpi"><small>Open Items</small><b>{num(counts?.open)}</b></div>
          <div className="ex-kpi"><small>Critical</small><b>{loaded && !failed ? critical : '—'}</b></div>
          <div className="ex-kpi"><small>High Priority</small><b>{loaded && !failed ? high : '—'}</b></div>
          <div className="ex-kpi"><small>Value Exposure</small><b title="No exposure value is recorded on department movements">—</b></div>
          <div className="ex-kpi"><small>Departments</small><b>{loaded && !failed ? areas.length : '—'}</b></div>
          <div className="ex-kpi">
            <small>System</small>
            <b className="ex-sys"><i className={system} />{loaded && !failed ? system : '—'}</b>
          </div>
        </div>
      </section>

      <div className="ex-head">
        <div>
          <h2>Enterprise Command Center</h2>
          <p>Add, review and open cross-functional ERP actions.</p>
        </div>
        <div className="ex-actions">
          <Link className="btn" to="/m/notification-center">Notification Center</Link>
          <Link className="btn" to="/m/global-search">Global Search</Link>
          <Link className="btn" to="/m/project-global-history">Project History</Link>
        </div>
      </div>

      <div className="ex-two-even">
        <div className="ex-card ex-card-pad">
          <h3 style={{ margin: 0, fontSize: 13 }}>Risk by Business Area</h3>
          <BarChart bars={areas} empty={loaded ? 'No open items.' : 'Loading…'} />
        </div>
        <div className="ex-card ex-card-pad">
          <h3 style={{ margin: '0 0 10px', fontSize: 13 }}>Add Command Item</h3>
          <div className="ex-form">
            <label>Action / Issue<input placeholder="Example: Review urgent dispatch" disabled /></label>
            <label>Owner<input disabled /></label>
            <label>Severity
              <select disabled defaultValue="Medium"><option>Critical</option><option>High</option><option>Medium</option><option>Low</option></select>
            </label>
            <label>Due Date<input type="date" disabled /></label>
          </div>
          <p style={{ fontSize: 11, color: 'var(--muted)' }}>
            Items are created by sending a record to a department (Move Forward on any document); they then appear below.
          </p>
          <button type="button" className="btn primary" disabled title="Create items by moving a document to a department">
            ＋ Add to Command Center
          </button>
        </div>
      </div>

      <div className="ex-filter">
        <b>Department Filter</b>
        <select aria-label="Department Filter" value={deptId} onChange={(e) => setDeptId(e.target.value)}>
          <option value="all">All Departments</option>
          {depts.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
        <small>Quick filter for department-wise records on this page.</small>
      </div>

      <div className="ex-card">
        <div className="ex-title">
          <h3>Command Data • {shown.length} items</h3>
        </div>
        <div className="ex-scroll">
          <table className="ex-table">
            <thead>
              <tr>
                <th>Area</th><th>Issue</th><th>Record</th><th>Owner</th><th>Due</th><th>Exposure</th><th>Severity</th><th>Status</th><th>Open</th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 ? (
                <tr><td colSpan={9} className="ex-empty">{failed ? 'Could not load command data.' : loaded ? 'No open command items.' : 'Loading…'}</td></tr>
              ) : (
                shown.map((r) => (
                  <tr key={r.id}>
                    <td>{r.to_department}</td>
                    <td>{r.route_type}<small>{r.work_status}</small></td>
                    <td><b>{r.doc_no ?? r.number}</b></td>
                    <td>{r.assigned_manager ?? '—'}</td>
                    <td>{r.required_by ? r.required_by.slice(0, 10) : r.sla_due_at ? r.sla_due_at.slice(0, 10) : '—'}</td>
                    <td>—</td>
                    <td><span className={`ex-pri ${r.priority === 'Normal' ? 'Medium' : r.priority}`}>{r.priority === 'Normal' ? 'Medium' : r.priority}</span></td>
                    <td>{r.state}</td>
                    <td><Link className="btn" to="/m/document-movement-center">Open Record</Link></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
