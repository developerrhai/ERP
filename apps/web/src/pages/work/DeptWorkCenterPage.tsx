// V40 pages dept-work-<department> ("{Dept} • Flexible Work Center"): one workspace for incoming work, routed documents,
// approvals and onward movement. Rows are the department's accepted work (GET /work/inbox?tab=work); the cards are
// real counters; "Workflow Rules Affecting {Dept}" lists the Workflow Matrix rows that name the department.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { EmailDocDialog } from '../../components/EmailDocDialog';
import { HistoryDrawer, MoveForwardDialog } from '../../components/MoveForward';
import { RecordDocsModal } from '../../components/workspace/RecordDialogs';
import { docsMailApi, saveFile } from '../../lib/docsMailApi';
import { useToast } from '../../components/Toast';
import { ApiError } from '../../lib/api';
import { lookupPage } from '../../lib/registry';
import { getJson } from '../../lib/scmApi';
import { workApi, type Dept, type InboxCounts, type Movement, type WorkRule } from '../../lib/workApi';
import { deptFromPage, deptLabelFromPage } from './DeptMailboxPage';

const when = (iso: string | null): string => (iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const pretty = (s: string): string => s.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

/** The purchase flow, stage by stage: documents in total and still open, each card opening its page. */
function PurchaseStages() {
  const [stages, setStages] = useState<{ page: string; label: string; total: number; open: number }[]>([]);
  useEffect(() => {
    let alive = true;
    // a person without any purchase page, or a failed call, simply shows no cards
    getJson<unknown>('/scm/purchase-stages').then(
      (r) => alive && setStages(Array.isArray(r) ? (r as typeof stages) : []),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, []);
  if (stages.length === 0) return null;
  return (
    <section className="card" aria-label="Purchase workflow stages">
      <h3>Purchase Workflow Stages</h3>
      <div className="work-stages">
        {stages.map((s, i) => (
          <Link key={s.page} className="work-stage" to={`/m/${s.page}`}>
            <small>{`${String(i + 1).padStart(2, '0')} • ${s.label}`}</small>
            <b>{s.total}</b>
            <small>{s.open === 0 ? 'None waiting' : `${s.open} draft or waiting for approval`}</small>
          </Link>
        ))}
      </div>
    </section>
  );
}

export function DeptWorkCenterPage({ pageId }: { pageId: string }) {
  const toast = useToast();
  const [depts, setDepts] = useState<Dept[]>([]);
  const [rows, setRows] = useState<Movement[]>([]);
  const [counts, setCounts] = useState<InboxCounts | null>(null);
  const [rules, setRules] = useState<WorkRule[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  const [forwarding, setForwarding] = useState<Movement | null>(null);
  const [history, setHistory] = useState<Movement | null>(null);
  const [docs, setDocs] = useState<Movement | null>(null);
  const [email, setEmail] = useState<Movement | null>(null);
  const [fromFilter, setFromFilter] = useState('');

  useEffect(() => {
    void workApi.departments().then(setDepts, () => setDepts([]));
    // the Workflow Matrix is readable only with its page permission: without it the rules block just stays empty
    void workApi.rules().then(setRules, () => setRules([]));
  }, []);
  const dept = useMemo(() => deptFromPage(pageId, depts), [pageId, depts]);

  useEffect(() => {
    if (!dept) return;
    let alive = true;
    setBusy(true);
    workApi.inbox({ dept: dept.id, tab: 'work' }).then(
      (r) => {
        if (!alive) return;
        setRows(r.rows);
        setError('');
        setBusy(false);
      },
      (e: unknown) => {
        if (!alive) return;
        setError(e instanceof ApiError ? e.message : 'Could not load the work center.');
        setBusy(false);
      },
    );
    void workApi.counts(dept.id).then((c) => alive && setCounts(c), () => undefined);
    return () => {
      alive = false;
    };
  }, [dept, tick]);

  async function act(m: Movement, action: 'complete'): Promise<void> {
    try {
      await workApi.act(m.id, action);
      toast('Completed.');
      setTick((t) => t + 1);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'That did not work.');
    }
  }

  async function pdf(m: Movement): Promise<void> {
    try {
      saveFile(await docsMailApi.print(m.doc_type, m.doc_id, 'standard'), `${m.doc_no ?? m.number}.pdf`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'This record has no print layout.');
    }
  }

  const shown = fromFilter ? rows.filter((m) => m.from_department === fromFilter) : rows;
  const name = deptLabelFromPage(pageId, dept);
  const slug = pageId.replace(/^dept-work-/, '');
  const mine = rules.filter((r) => dept && [r.owner_department_id, r.next_department_id, r.approval_department_id].includes(dept.id));

  if (depts.length > 0 && !dept) {
    return (
      <div className="dash-page">
        <h1>Work Center</h1>
        <p role="alert">There is no department called “{name}”.</p>
      </div>
    );
  }

  return (
    <div className="dash-page">
      <div className="v39-dash-hero">
        <div>
          <small>{name} Department Workspace</small>
          <h1>Welcome, {name} Team</h1>
          <p>
            A simple working dashboard for documents, approvals, employee activity and project history. Only the department's operational queue is shown here.
          </p>
        </div>
        <div className="v39-user-box">
          <b>{name} Workspace</b>
          <span>{name} • Company RHAI</span>
          <span>Project, import/export and workflow controls ready</span>
        </div>
      </div>

      <div className="v39-metrics x-d-grid x-cols-repeat-6-1fr x-gap-10px">
        <div className="v39-metric danger">
          <div>
            <small>Pending Receipt</small>
            <b>{counts ? counts.pendingReceipt : '—'}</b>
          </div>
          <i>↓</i>
        </div>
        <div className="v39-metric warn">
          <div>
            <small>Pending Acceptance</small>
            <b>{counts ? counts.pendingAcceptance : '—'}</b>
          </div>
          <i>✓</i>
        </div>
        <div className="v39-metric">
          <div>
            <small>Active Department Work</small>
            <b>{counts ? counts.work : '—'}</b>
          </div>
          <i>⚙</i>
        </div>
        <div className="v39-metric good">
          <div>
            <small>Approval Inbox</small>
            <b>{counts ? counts.approval : '—'}</b>
          </div>
          <i>◎</i>
        </div>
        <div className="v39-metric">
          <div>
            <small>Ready to Move</small>
            <b>{counts ? (counts as any).readyToMove ?? rows.filter((r) => (r as any).status === 'READY_TO_MOVE' || (r as any).status === 'ACCEPTED').length : '—'}</b>
          </div>
          <i>→</i>
        </div>
        <div className="v39-metric warn">
          <div>
            <small>Sent / Waiting</small>
            <b>{counts ? (counts as any).sentWaiting ?? 0 : '—'}</b>
          </div>
          <i>⏳</i>
        </div>
      </div>

      <div className="v39-quick x-wrap-wrap x-gap-8px">
        <b>Quick Actions</b>
        <Link className="btn primary" to={`/m/dept-inbox-${slug}`}>
          Open {name} Inbox
        </Link>
        <Link className="btn" to="/m/my-approvals">
          Approvals
        </Link>
        <Link className="btn" to="/m/dept-mail?compose=1">
          New Message / Attach Document
        </Link>
        <Link className="btn" to="/m/plant-flow-command">
          Plant Flow
        </Link>
        <Link className="btn" to="/m/admin-workflow">
          Workflow Matrix
        </Link>
        <Link className="btn" to="/m/project-global-history">
          Project History
        </Link>
        <Link className="btn" to="/m/ops-order-360">
          360° Tracking
        </Link>
        <Link className="btn" to="/m/ops-tasks">
          Tasks
        </Link>
        <Link className="btn" to="/m/ops-shift-roster">
          Shifts
        </Link>
        {slug === 'quality' ? (
          <Link className="btn primary" to="/m/qms-dashboard">
            Centralized Dashboard
          </Link>
        ) : null}
        {slug === 'finance' ? (
          <>
            <Link className="btn" to="/m/fin-coa">
              Chart of Accounts
            </Link>
            <Link className="btn" to="/m/fin-gl">
              General Ledger
            </Link>
            <Link className="btn" to="/m/tax-gst">
              GST Setup
            </Link>
            <Link className="btn" to="/m/tax-gstr3b">
              GSTR-3B Return
            </Link>
          </>
        ) : null}
      </div>

      {slug === 'purchase' ? <PurchaseStages /> : null}

      <div className="card work-note">
        <b>Flexible routed access:</b> when this department receives and accepts a document from another ERP family, the active movement grants controlled work access according to the module rule. This prevents cross-department handoffs from being blocked by the normal menu family restriction.
      </div>
      {error ? <p role="alert">{error}</p> : null}

      {/* Department Filter & Movement Controls */}
      <div className="x-d-flex x-jc-space-between x-ai-center x-m-12px-0-8px-0">
        <div className="x-d-flex x-gap-8px x-ai-center">
          <select
            value={fromFilter}
            onChange={(e) => setFromFilter(e.target.value)}
            aria-label="Department Filter"
            className="x-p-6px-10px x-fs-12px x-r-6px x-bd-1px-solid-line-strong"
          >
            <option value="">All Departments</option>
            {depts.map((d) => (
              <option key={d.id} value={d.name}>{d.name}</option>
            ))}
          </select>
          <small className="x-c-muted x-fs-11px">Show the work sent by one department</small>
        </div>
      </div>

      <div className="table-wrap">
        <table className="register-table">
          <thead>
            <tr>
              <th>Movement</th>
              <th>Document / Record</th>
              <th>Route</th>
              <th>Status</th>
              <th>Approval</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((m) => (
              <tr key={m.id}>
                <td>
                  <b>{m.number}</b>
                  <div className="muted">{m.priority}</div>
                </td>
                <td>
                  <Link to={`/m/${m.doc_type}`}>{m.doc_no ?? m.doc_type}</Link>
                  <div className="muted">{lookupPage(m.doc_type)?.item.title ?? m.doc_type}</div>
                </td>
                <td>{`${m.from_department} → ${m.to_department}`}</td>
                <td>
                  {pretty(m.state)}
                  <div className="muted">{m.work_status}</div>
                </td>
                <td>{m.state === 'WAITING_APPROVAL' ? 'Waiting for approval' : m.is_late ? `Late · ${when(m.sla_due_at)}` : m.sla_due_at ? `Due ${when(m.sla_due_at)}` : '—'}</td>
                <td className="row-actions">
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    <Link to={`/m/${m.doc_type}`} className="btn sm" aria-label={`View ${m.doc_no ?? m.number}`}>
                      View
                    </Link>
                    <Link to={`/m/dept-inbox-${slug}`} className="btn sm">
                      Open Inbox
                    </Link>
                    <button type="button" className="btn sm" onClick={() => setDocs(m)}>
                      Docs
                    </button>
                    <button type="button" className="btn sm" onClick={() => setEmail(m)}>
                      Email
                    </button>
                    <button type="button" className="btn sm" onClick={() => void pdf(m)}>
                      PDF
                    </button>
                    {m.state !== 'WAITING_APPROVAL' ? (
                      <>
                        <button type="button" className="btn sm primary" onClick={() => setForwarding(m)}>
                          Move Forward
                        </button>
                        <button type="button" className="btn sm" onClick={() => void act(m, 'complete')}>
                          Complete
                        </button>
                      </>
                    ) : null}
                    <button type="button" className="btn sm" onClick={() => setHistory(m)}>
                      History
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {shown.length === 0 ? (
              <tr className="empty-row">
                <td colSpan={6}>
                  {busy ? 'Loading…' : `No work is with ${name} right now. Records appear here after the ${name} inbox marks them Received and Accepted.`}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <section className="card" aria-label={`Workflow Rules Affecting ${name}`}>
        <h3>{`Workflow Rules Affecting ${name}`}</h3>
        <div className="rule-grid">
          {mine.map((r) => (
            <div className="card" key={r.module_id}>
              <b>{lookupPage(r.module_id)?.item.title ?? r.module_id}</b>
              <small className="muted">Owner: {r.owner_department ?? '—'}</small>
              <small className="muted">
                Next: {r.next_department ?? 'Manual'} • Approval: {r.approval_department ?? 'Working Dept'}
              </small>
              <small className="muted">
                Mode: {r.route_mode === 'SUGGEST' ? 'Suggested' : 'Manual'} • SLA {r.sla_days} day(s)
              </small>
            </div>
          ))}
          {mine.length === 0 ? <p className="muted">No Workflow Matrix rule names {name} yet.</p> : null}
        </div>
      </section>

      {docs ? <RecordDocsModal docType={docs.doc_type} docId={docs.doc_id} docNo={docs.doc_no ?? docs.number} status="" canEdit onClose={() => setDocs(null)} /> : null}
      {email ? <EmailDocDialog docType={email.doc_type} docId={email.doc_id} onClose={() => setEmail(null)} /> : null}
      {history ? <HistoryDrawer docType={history.doc_type} docId={history.doc_id} title={history.doc_no ?? history.number} onClose={() => setHistory(null)} /> : null}
      {forwarding ? (
        <MoveForwardDialog
          docType={forwarding.doc_type}
          docId={forwarding.doc_id}
          docNo={forwarding.doc_no ?? undefined}
          fromDepartment={forwarding.to_department}
          onClose={() => setForwarding(null)}
          onMoved={() => {
            setForwarding(null);
            toast('Sent on.');
            setTick((t) => t + 1);
          }}
        />
      ) : null}
    </div>
  );
}
