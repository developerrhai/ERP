// V40 page my-approvals ("My Department Approvals"): the manager inbox for department acceptance, operational
// approvals, sent movements and decision history. Every row is a real department movement (GET /work/inbox);
// Received / Accepted / Return / Move Forward / Complete are the Phase 25 actions. Nothing forwards by itself.
// The V40 button row (Return, Import, Export, Duplicates, Project History) comes from the shell ActionBar.
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { HistoryDrawer, MoveForwardDialog, ReturnDialog } from '../../components/MoveForward';
import { useToast } from '../../components/Toast';
import { ApiError } from '../../lib/api';
import { workApi, type AuditRow, type Dept, type Movement } from '../../lib/workApi';

type View = 'pending' | 'received' | 'sent' | 'completed' | 'audit';

/** V40 tab labels, in V40 order; the server tab each one reads. */
const VIEWS: { key: View; label: string; tab: string }[] = [
  { key: 'pending', label: 'Pending for Acceptance', tab: 'pending' },
  { key: 'received', label: 'Received', tab: 'accept' },
  { key: 'sent', label: 'Sent by My Department', tab: 'sent' },
  { key: 'completed', label: 'Completed / History', tab: 'completed' },
  { key: 'audit', label: 'Audit', tab: 'audit' },
];

const CYCLE =
  'A working department can choose any Approval Department. When that approval is Accepted, the work becomes Ready to Move. The system does not auto-forward; the working department chooses the next department with Move Forward.';
const RULE =
  'For routed records, Accepted remains disabled until the destination department marks the record Received in the Received / Accepted tab.';

const when = (iso: string | null): string => (iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');

export function MyApprovalsPage() {
  const toast = useToast();
  const nav = useNavigate();
  const [depts, setDepts] = useState<Dept[]>([]);
  const [dept, setDept] = useState('');
  const [view, setView] = useState<View>('pending');
  const [rows, setRows] = useState<Movement[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  const [returning, setReturning] = useState<Movement | null>(null);
  const [history, setHistory] = useState<Movement | null>(null);
  const [forwarding, setForwarding] = useState<Movement | null>(null);

  useEffect(() => {
    void workApi.departments().then(setDepts, () => setDepts([]));
  }, []);

  useEffect(() => {
    let alive = true;
    setBusy(true);
    const done = (): void => {
      if (alive) setBusy(false);
    };
    const fail = (e: unknown): void => {
      if (!alive) return;
      setError(e instanceof ApiError ? e.message : 'Could not load the approvals.');
      setBusy(false);
    };
    if (view === 'audit') {
      workApi.audit(dept || 'all').then((r) => {
        if (!alive) return;
        setAudit(r);
        setError('');
        done();
      }, fail);
    } else {
      const tab = VIEWS.find((v) => v.key === view)?.tab ?? 'pending';
      workApi.inbox({ dept: dept || 'all', tab }).then((r) => {
        if (!alive) return;
        setRows(r.rows);
        setCursor(r.nextCursor);
        setMore(r.hasMore);
        setError('');
        done();
      }, fail);
    }
    return () => {
      alive = false;
    };
  }, [view, dept, tick]);

  const loadMore = useCallback(async () => {
    if (!cursor) return;
    const tab = VIEWS.find((v) => v.key === view)?.tab ?? 'pending';
    const r = await workApi.inbox({ dept: dept || 'all', tab, cursor });
    setRows((cur) => [...cur, ...r.rows]);
    setCursor(r.nextCursor);
    setMore(r.hasMore);
  }, [cursor, view, dept]);

  async function act(m: Movement, action: 'receive' | 'accept' | 'recall' | 'complete'): Promise<void> {
    try {
      await workApi.act(m.id, action);
      toast(action === 'receive' ? 'Marked Received.' : action === 'accept' ? 'Accepted.' : action === 'recall' ? 'Recalled.' : 'Completed.');
      setTick((t) => t + 1);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'That did not work.');
    }
  }

  return (
    <div className="dash-page">
      <div className="card work-flowbar">
        <b>Department Workflow:</b>
        <button type="button" className="btn primary" aria-current="page">
          Approval Inbox
        </button>
        <Link className="btn" to="/m/dept-movement-inbox">
          Received / Accepted
        </Link>
        <small className="muted">Accepted approval automatically creates the next department Pending Receipt entry.</small>
      </div>

      <div className="page-head">
        <div>
          <h1>My Department Approvals</h1>
          <p className="muted">Manager inbox for department acceptance, operational approvals, sent movements and decision history.</p>
        </div>
        <div className="actions">
          <Link className="btn primary" to="/m/dept-inbox-administration">
            Open Administration Inbox
          </Link>
          <select aria-label="Approval department" value={dept} onChange={(e) => setDept(e.target.value)}>
            <option value="">All Departments</option>
            {depts.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <button type="button" className="btn" onClick={() => nav('/m/my-dashboard')}>
            Department Dashboard
          </button>
          <Link className="btn primary" to="/m/dept-movement-inbox">
            Received / Accepted
          </Link>
        </div>
      </div>

      <div className="card">
        <b>Connected approval cycle:</b>
        <p className="muted">{CYCLE}</p>
      </div>

      <div role="tablist" className="tabs-row">
        {VIEWS.map((v) => (
          <button key={v.key} type="button" role="tab" aria-selected={view === v.key} className={`btn${view === v.key ? ' primary' : ''}`} onClick={() => setView(v.key)}>
            {v.label}
          </button>
        ))}
      </div>
      <div className="card work-note">
        <b>Movement rule:</b> {RULE}
      </div>
      {error ? <p role="alert">{error}</p> : null}

      <div className="table-wrap">
        {view === 'audit' ? (
          <table className="register-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Movement</th>
                <th>Document</th>
                <th>Event</th>
                <th>Department</th>
                <th>By</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {audit.map((a, i) => (
                <tr key={`${a.number}-${a.at}-${i}`}>
                  <td>{when(a.at)}</td>
                  <td>{a.number}</td>
                  <td>{a.doc_no ?? a.doc_type}</td>
                  <td>
                    {a.event}
                    {a.from_state || a.to_state ? <div className="muted">{`${a.from_state ?? '—'} → ${a.to_state ?? '—'}`}</div> : null}
                  </td>
                  <td>{a.department ?? '—'}</td>
                  <td>{a.actor ?? '—'}</td>
                  <td>{a.note ?? ''}</td>
                </tr>
              ))}
              {!busy && audit.length === 0 ? (
                <tr>
                  <td colSpan={7}>No audit events in this view for {dept ? 'this department' : 'All Departments'}.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        ) : (
          <table className="register-table">
            <thead>
              <tr>
                <th>Request / Priority</th>
                <th>Source → Target</th>
                <th>Module / Record</th>
                <th>Requested</th>
                <th>Manager / Due</th>
                <th>Type / Remarks</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id}>
                  <td>
                    <b>{m.number}</b>
                    <div className="muted">{m.priority}</div>
                  </td>
                  <td>{`${m.from_department} → ${m.to_department}`}</td>
                  <td>
                    <Link to={`/m/${m.doc_type}`}>{m.doc_no ?? m.doc_type}</Link>
                    <div className="muted">{m.doc_type}</div>
                  </td>
                  <td>{when(m.sent_at)}</td>
                  <td>
                    {m.assigned_manager ?? '—'}
                    <div className={m.is_late ? 'rag rag-red' : 'muted'}>{m.sla_due_at ? `${m.is_late ? 'Late · ' : 'Due '}${when(m.sla_due_at)}` : '—'}</div>
                  </td>
                  <td>
                    {m.route_type}
                    {m.handover_note ? <div className="muted">{m.handover_note}</div> : null}
                    {m.return_reason ? <div className="muted">Returned: {m.return_reason}</div> : null}
                  </td>
                  <td>{m.state.replace('_', ' ')}</td>
                  <td className="row-actions">
                    <Link className="btn" to={`/m/${m.doc_type}`}>
                      Open
                    </Link>
                    {m.state === 'SENT' ? (
                      <>
                        <button type="button" className="btn primary" onClick={() => void act(m, 'accept')}>
                          Accept
                        </button>
                        <button type="button" className="btn" onClick={() => setReturning(m)}>
                          Reject
                        </button>
                        <button type="button" className="btn" onClick={() => void act(m, 'receive')}>
                          Received
                        </button>
                        <button type="button" className="btn" onClick={() => void act(m, 'recall')}>
                          Recall
                        </button>
                      </>
                    ) : null}
                    {m.state === 'RECEIVED' ? (
                      <>
                        <button type="button" className="btn primary" onClick={() => void act(m, 'accept')}>
                          Accept
                        </button>
                        <button type="button" className="btn" onClick={() => setReturning(m)}>
                          Reject
                        </button>
                        <button type="button" className="btn" onClick={() => setReturning(m)}>
                          Return
                        </button>
                      </>
                    ) : null}
                    {m.state === 'ACCEPTED' || m.state === 'IN_WORK' ? (
                      <>
                        <button type="button" className="btn primary" onClick={() => setForwarding(m)}>
                          Move Forward
                        </button>
                        <button type="button" className="btn" onClick={() => void act(m, 'complete')}>
                          Complete
                        </button>
                      </>
                    ) : null}
                    {m.state !== 'SENT' && m.state !== 'RECEIVED' && m.state !== 'ACCEPTED' && m.state !== 'IN_WORK' ? (
                      <>
                        <button type="button" className="btn primary" onClick={() => void act(m, 'accept')}>
                          Accept
                        </button>
                        <button type="button" className="btn" onClick={() => setReturning(m)}>
                          Reject
                        </button>
                      </>
                    ) : null}
                    <button type="button" className="btn" onClick={() => setHistory(m)}>
                      History
                    </button>
                  </td>
                </tr>
              ))}
              {!busy && rows.length === 0 ? (
                <tr>
                  <td colSpan={8}>No approvals in this view for {dept ? (depts.find((d) => d.id === dept)?.name ?? 'this department') : 'All Departments'}.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        )}
      </div>
      {more && view !== 'audit' ? (
        <button type="button" className="btn" onClick={() => void loadMore()}>
          Load more
        </button>
      ) : null}

      {returning ? (
        <ReturnDialog
          onClose={() => setReturning(null)}
          onConfirm={async (reason) => {
            await workApi.act(returning.id, 'return', { reason });
            setReturning(null);
            toast('Returned to the sender.');
            setTick((t) => t + 1);
          }}
        />
      ) : null}
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
            setTick((t) => t + 1);
          }}
        />
      ) : null}
    </div>
  );
}
