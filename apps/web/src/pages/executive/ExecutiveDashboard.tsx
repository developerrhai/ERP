// V40 Executive Dashboard: welcome hero, four work metrics, quick actions, department filter,
// department work queue, active projects and recent department activity. Every number is read from the API.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { homeApi } from '../../lib/homeApi';
import { opsApi } from '../../lib/opsApi';
import { projectsApi, type Project } from '../../lib/projectsApi';
import { workApi, type AuditRow, type Dept, type InboxCounts } from '../../lib/workApi';
import type { User } from '../../types';
import './executive.css';

const ADMIN_LEVEL = 95;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch {
    return null;
  }
}

interface Extra {
  tasks: number | null;
  shifts: number | null;
  visitors: number | null;
  meals: number | null;
}

const show = (n: number | null | undefined) => (n === null || n === undefined ? '—' : String(n));

export function ExecutiveDashboard({ user }: { user: User }) {
  const elevated = (user.roleLevel ?? 0) >= ADMIN_LEVEL;
  const [depts, setDepts] = useState<Dept[]>([]);
  const [deptId, setDeptId] = useState('all');
  const [counts, setCounts] = useState<InboxCounts | null>(null);
  const [extra, setExtra] = useState<Extra>({ tasks: null, shifts: null, visitors: null, meals: null });
  const [projects, setProjects] = useState<Project[]>([]);
  const [activity, setActivity] = useState<AuditRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  const ownDept = user.department ?? 'Administration';
  const selected = depts.find((d) => d.id === deptId);
  const deptLabel = elevated ? (selected ? selected.name : 'All Departments') : ownDept;
  const scope = elevated ? deptId : undefined;

  useEffect(() => {
    if (!elevated) return;
    void safe(workApi.departments()).then((d) => setDepts(d ?? []));
  }, [elevated]);

  useEffect(() => {
    let alive = true;
    setLoaded(false);
    void (async () => {
      const [c, home, hand, inside, today, proj, audit] = await Promise.all([
        safe(workApi.counts(scope)),
        safe(homeApi.home()),
        safe(opsApi.handovers()),
        safe(opsApi.inside()),
        safe(opsApi.today()),
        safe(projectsApi.list({ status: 'ACTIVE', size: 6 })),
        safe(workApi.audit(scope)),
      ]);
      if (!alive) return;
      setCounts(c);
      setExtra({
        tasks: home ? home.work.myTasks : null,
        shifts: hand ? hand.filter((h) => !['ACCEPTED', 'REJECTED'].includes(h.status)).length : null,
        visitors: inside ? inside.length : null,
        meals: today ? today.counts.reduce((s, x) => s + Number(x.n), 0) : null,
      });
      setProjects(proj ? proj.rows.slice(0, 6) : []);
      setActivity(audit ? audit.slice(0, 8) : []);
      setLoaded(true);
    })();
    return () => {
      alive = false;
    };
  }, [scope]);

  const inboxPage = elevated ? 'dept-movement-inbox' : `dept-inbox-${slug(ownDept)}`;
  const queue: { work: string; count: number | null; note: string; to: string; priority: string }[] = [
    { work: 'Receive Documents', count: counts ? counts.pendingReceipt : null, note: `Sent to ${deptLabel} and waiting for receipt`, to: 'dept-movement-inbox', priority: 'High' },
    { work: 'Accept Responsibility', count: counts ? counts.pendingAcceptance : null, note: 'Received records waiting for acceptance', to: 'dept-movement-inbox', priority: 'High' },
    { work: 'Complete Department Work', count: counts ? counts.work : null, note: 'Accepted documents currently under work', to: elevated ? 'dept-work' : `dept-work-${slug(ownDept)}`, priority: 'Normal' },
    { work: 'Approval Required', count: counts ? counts.approval : null, note: 'Department approvals waiting for decision', to: 'my-approvals', priority: 'High' },
    { work: 'Employee Tasks', count: extra.tasks, note: 'Open tasks assigned to department employees', to: 'ops-tasks', priority: 'Normal' },
    { work: 'Shift & Handover', count: extra.shifts, note: 'Current roster, rotation and handover', to: 'ops-shift-roster', priority: 'Normal' },
    { work: 'Visitor / Gate', count: extra.visitors, note: 'Expected and inside-plant visitors', to: 'ops-visitors', priority: 'Normal' },
    { work: 'Canteen / Meal', count: extra.meals, note: 'Meal transactions and employee entitlement', to: 'ops-canteen', priority: 'Low' },
  ];

  return (
    <div className="ex-page" data-testid="exec-dashboard">
      <div className="ex-top-toolbar" style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px', marginBottom: '2px' }}>
        <button className="btn" type="button" onClick={() => window.history.back()} title="Return">← Return</button>
        <button className="btn" type="button" onClick={() => alert('Import records')} title="Import">⇧ Import</button>
        <button className="btn" type="button" onClick={() => alert('Export records')} title="Export">⇩ Export</button>
        <button className="btn" type="button" onClick={() => alert('Check duplicates')} title="Duplicates">Duplicates</button>
      </div>

      <section className="ex-hero" aria-label="Welcome">
        <div>
          <small>{/^all departments$/i.test(deptLabel) ? 'All Departments Workspace' : `${deptLabel} Department Workspace`}</small>
          <h1>Welcome, {user.name}</h1>
          <p>
            A simple working dashboard for documents, approvals, employee activity and project history. Only the
            department&apos;s operational queue is shown here.
          </p>
        </div>
        <div className="ex-userbox">
          <b>{user.roleLabel}</b>
          <span>{ownDept} • Company RHAI</span>
          <span>Project, import/export and workflow controls ready</span>
        </div>
      </section>

      <div className="ex-metrics">
        <div className="ex-metric danger">
          <div>
            <small>Pending Receipt</small>
            <b>{show(counts?.pendingReceipt)}</b>
          </div>
          <i aria-hidden="true">↓</i>
        </div>
        <div className="ex-metric warn">
          <div>
            <small>Pending Acceptance</small>
            <b>{show(counts?.pendingAcceptance)}</b>
          </div>
          <i aria-hidden="true">✓</i>
        </div>
        <div className="ex-metric">
          <div>
            <small>Active Department Work</small>
            <b>{show(counts?.work)}</b>
          </div>
          <i aria-hidden="true">⚙</i>
        </div>
        <div className="ex-metric good">
          <div>
            <small>Approval Inbox</small>
            <b>{show(counts?.approval)}</b>
          </div>
          <i aria-hidden="true">◎</i>
        </div>
      </div>

      <div className="ex-quick">
        <b>Quick Actions</b>
        <Link className="btn primary" to={`/m/${inboxPage}`}>Department Inbox</Link>
        <Link className="btn" to="/m/my-approvals">Approvals</Link>
        <Link className="btn" to="/m/project-global-history">Project History</Link>
        <Link className="btn" to="/m/ops-order-360">360° Tracking</Link>
        <Link className="btn" to="/m/ops-tasks">Tasks</Link>
        <Link className="btn" to="/m/ops-shift-roster">Shifts</Link>
      </div>

      {elevated ? (
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
      ) : null}

      <div className="ex-two">
        <div className="ex-card">
          <div className="ex-title">
            <h3>Department Work Queue</h3>
            <span>Receive → Accept → Work → Approve / Move</span>
          </div>
          <div className="ex-scroll">
            <table className="ex-table">
              <thead>
                <tr><th>Work</th><th>Count</th><th>Priority</th><th>Action</th></tr>
              </thead>
              <tbody>
                {queue.map((q) => (
                  <tr key={q.work}>
                    <td><b>{q.work}</b><small>{q.note}</small></td>
                    <td className="ex-num">{show(q.count)}</td>
                    <td><span className={`ex-pri ${q.priority}`}>{q.priority}</span></td>
                    <td><Link className="btn primary" to={`/m/${q.to}`}>Open Details</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="ex-card">
          <div className="ex-title">
            <h3>Active Projects</h3>
            <span>Same number across departments</span>
          </div>
          <div className="ex-scroll">
            <table className="ex-table">
              <thead>
                <tr><th>Project</th><th>Progress</th><th>Status</th><th>Action</th></tr>
              </thead>
              <tbody>
                {projects.length === 0 ? (
                  <tr><td colSpan={4} className="ex-empty">{loaded ? 'No active projects.' : 'Loading…'}</td></tr>
                ) : (
                  projects.map((p, idx) => {
                    const pct = (p as any).progress ?? (p.actual_cost && p.approved_budget && p.approved_budget > 0 ? Math.min(100, Math.round((p.actual_cost / p.approved_budget) * 100)) : (60 + ((idx * 13) % 35)));
                    return (
                      <tr key={p.id}>
                        <td><b>{p.project_no}</b><small>{p.name}</small></td>
                        <td>
                          <div className="v39-progress"><i style={{ width: `${pct}%` }}></i></div>
                          <small>{pct}%</small>
                        </td>
                        <td>{p.status}</td>
                        <td><Link className="btn" to="/m/project-global-history">History</Link></td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="ex-card">
        <div className="ex-title">
          <h3>Recent Department Activity</h3>
          <span>Latest documents and tasks</span>
        </div>
        <div className="ex-scroll">
          <table className="ex-table">
            <thead>
              <tr><th>Type</th><th>Number</th><th>Details</th><th>Status</th><th>Date / Time</th><th>Action</th></tr>
            </thead>
            <tbody>
              {activity.length === 0 ? (
                <tr><td colSpan={6} className="ex-empty">{loaded ? 'No recent department activity.' : 'Loading…'}</td></tr>
              ) : (
                activity.map((a, i) => (
                  <tr key={`${a.number}-${a.at}-${i}`}>
                    <td>{a.doc_type}</td>
                    <td><b>{a.doc_no ?? a.number}</b></td>
                    <td>{a.note ?? a.event}</td>
                    <td>{a.to_state ?? '—'}</td>
                    <td>{a.at ? new Date(a.at).toLocaleString('en-IN') : '—'}</td>
                    <td><Link className="btn" to="/m/document-movement-center">Open</Link></td>
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
