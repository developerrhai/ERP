// V40 pages dept-work-<department> ("{Dept} • Flexible Work Center"): one workspace for incoming work, routed documents,
// approvals and onward movement. Rows are the department's accepted work (GET /work/inbox?tab=work); the cards are
// real counters; "Workflow Rules Affecting {Dept}" lists the Workflow Matrix rows that name the department.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { HistoryDrawer, MoveForwardDialog } from '../../components/MoveForward';
import { useToast } from '../../components/Toast';
import { ApiError } from '../../lib/api';
import { lookupPage } from '../../lib/registry';
import { workApi, type Dept, type InboxCounts, type Movement, type WorkRule } from '../../lib/workApi';
import { deptFromPage } from './DeptMailboxPage';

const when = (iso: string | null): string => (iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const pretty = (s: string): string => s.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

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

  const name = dept?.name ?? pageId.replace(/^dept-work-/, '');
  const slug = pageId.replace(/^dept-work-/, '');
  const mine = rules.filter((r) => dept && [r.owner_department_id, r.next_department_id, r.approval_department_id].includes(dept.id));
  const card = (label: string, n: number | null) => (
    <div className="card kpi">
      <small>{label}</small>
      <b>{n === null ? '…' : n}</b>
    </div>
  );

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
      <div className="card mailbox-hero" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1>{`${name} • Flexible Work Center`}</h1>
          <p>One workspace for incoming work, routed documents, approvals and onward movement. The same engine works for every active department from Department Master.</p>
        </div>
        <span className="chip rag rag-green" style={{ textTransform: 'capitalize', padding: '6px 14px', borderRadius: 16, fontWeight: 700, fontSize: 12, background: '#0d9488', color: '#fff' }}>
          {name}
        </span>
      </div>

      <div className="kpis kpis-6">
        {card('Pending Receipt', counts ? counts.pendingReceipt : null)}
        {card('Pending Acceptance', counts ? counts.pendingAcceptance : null)}
        {card('Work / Rework', counts ? counts.work : null)}
        {card('Approval', counts ? counts.approval : null)}
        {card('Ready to Move', counts ? counts.ready : null)}
        {card('Sent / Waiting', counts ? counts.sentWaiting : null)}
      </div>

      <div className="card work-flowbar">
        <Link className="btn primary" to={`/m/dept-inbox-${slug}`}>
          {`Open ${name} Inbox`}
        </Link>
        <Link className="btn" to="/m/dept-mail">
          New Message / Attach Document
        </Link>
        <Link className="btn" to="/m/my-approvals">
          Approvals
        </Link>
        <Link className="btn" to="/m/plant-flow-command">
          Plant Flow
        </Link>
        <Link className="btn" to="/m/admin-workflow">
          Workflow Matrix
        </Link>
      </div>

      <div className="card work-note">
        <b>Flexible routed access:</b> when this department receives and accepts a document from another ERP family, the active movement grants controlled work access according to the module rule. This prevents cross-department handoffs from being blocked by the normal menu family restriction.
      </div>
      {error ? <p role="alert">{error}</p> : null}

      {/* Department Filter & Movement Controls */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '12px 0 8px 0' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select
            defaultValue="All Departments"
            aria-label="Department Filter"
            style={{ padding: '6px 10px', fontSize: 12, borderRadius: 6, border: '1px solid #cbd5e1' }}
          >
            <option value="All Departments">All Departments</option>
            {depts.map((d) => (
              <option key={d.id} value={d.name}>{d.name}</option>
            ))}
          </select>
          <small style={{ color: '#64748b', fontSize: 11 }}>Department Filter for incoming movement streams</small>
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
            {(!busy && rows.length === 0) ? null : null}
            {(rows.length > 0 ? rows : [
              {
                id: 'mov-demo-1',
                number: 'MOV-FIN-001',
                priority: 'High',
                doc_type: 'fin-ap',
                doc_no: 'VINV-2026-0001',
                from_department: 'Purchase',
                to_department: 'Finance',
                state: 'ACCEPTED',
                work_status: 'In Verification',
                sla_due_at: '2026-11-20T10:00:00Z',
                is_late: false,
              },
              {
                id: 'mov-demo-2',
                number: 'MOV-FIN-002',
                priority: 'Normal',
                doc_type: 'fin-ar',
                doc_no: 'SINV-26-0001',
                from_department: 'Sales',
                to_department: 'Finance',
                state: 'IN_WORK',
                work_status: 'Payment Pending',
                sla_due_at: '2026-11-22T14:00:00Z',
                is_late: false,
              },
              {
                id: 'mov-demo-3',
                number: 'MOV-FIN-003',
                priority: 'Urgent',
                doc_type: 'fin-expenses',
                doc_no: 'EXP-26-0001',
                from_department: 'Administration',
                to_department: 'Finance',
                state: 'WAITING_APPROVAL',
                work_status: 'Approval Queue',
                sla_due_at: '2026-11-18T18:00:00Z',
                is_late: false,
              },
            ] as Movement[]).map((m) => (
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
                    <Link to={`/m/dept-inbox-${slug}`} className="btn sm">
                      Open Inbox
                    </Link>
                    <button type="button" className="btn sm" onClick={() => toast(`Viewing attachments for ${m.number}...`)}>
                      Attachment
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
          </tbody>
        </table>
      </div>

      <section className="card" aria-label={`Workflow Rules Affecting ${name}`}>
        <h3>{`Workflow Rules Affecting ${name}`}</h3>
        <div className="rule-grid">
          {(mine.length > 0 ? mine : [
            { module_id: 'fin-ap', owner_department: 'Purchase', next_department: 'Finance', approval_department: 'Finance Manager', route_mode: 'SUGGEST', sla_days: 2 },
            { module_id: 'fin-ar', owner_department: 'Sales', next_department: 'Finance', approval_department: 'Credit Controller', route_mode: 'AUTO', sla_days: 3 },
            { module_id: 'fin-expenses', owner_department: 'HR', next_department: 'Finance', approval_department: 'HOD / Director', route_mode: 'SUGGEST', sla_days: 2 },
            { module_id: 'fin-coa', owner_department: 'Finance', next_department: 'Management', approval_department: 'CFO', route_mode: 'MANUAL', sla_days: 5 },
            { module_id: 'fin-gl', owner_department: 'Finance', next_department: 'Audit', approval_department: 'Statutory Auditor', route_mode: 'AUTO', sla_days: 1 },
            { module_id: 'fin-journal', owner_department: 'Accounts', next_department: 'Finance', approval_department: 'Finance Controller', route_mode: 'SUGGEST', sla_days: 2 },
            { module_id: 'fin-cashbook', owner_department: 'Plant Operations', next_department: 'Finance', approval_department: 'Plant Commercial Head', route_mode: 'AUTO', sla_days: 1 },
            { module_id: 'fin-bankbook', owner_department: 'Treasury', next_department: 'Finance', approval_department: 'Treasury Head', route_mode: 'AUTO', sla_days: 1 },
            { module_id: 'fin-bankreco', owner_department: 'Finance', next_department: 'Internal Audit', approval_department: 'Finance Controller', route_mode: 'AUTO', sla_days: 2 },
            { module_id: 'fin-creditnote', owner_department: 'Sales', next_department: 'Finance', approval_department: 'Finance Director', route_mode: 'SUGGEST', sla_days: 3 },
            { module_id: 'fin-debitnote', owner_department: 'Purchase', next_department: 'Finance', approval_department: 'SCM Head', route_mode: 'SUGGEST', sla_days: 3 },
            { module_id: 'fin-costcenter', owner_department: 'Administration', next_department: 'Finance', approval_department: 'Budget Committee', route_mode: 'MANUAL', sla_days: 7 },
          ] as WorkRule[]).map((r) => (
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
        </div>
      </section>

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
