// V40 page process-exceptions: the Exception Register and its working tabs. Delays are found by the server every 30 minutes (Check now runs
// the check at once) and clear by themselves when the cause is fixed. Every tab is a real view of the same exception rows:
// Register / Ownership / Corrective Action / SLA / Closure show different columns, the other V40 tabs use the register columns.
// Note and Resolve write to the exception and to the audit trail on the server; a note is typed in a dialog, never a browser prompt.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { ApiError } from '../../lib/api';
import { controlApi } from '../../lib/controlApi';
import { spineApi, type ExceptionRow } from '../../lib/spineApi';
import { useLoad } from '../../lib/useLoad';
import { useFrame } from '../frame/V40TabFrame';

type Ex = ExceptionRow & { exception_no?: string; age_days?: number; state_label?: string; assigned_to_id?: string | null };

const errText = (e: unknown): string => (e instanceof ApiError ? e.message : 'That did not work.');
const when = (v: string | null): string => (v ? new Date(v).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const exNo = (r: Ex): string => r.exception_no ?? `EX-${r.id.slice(0, 8).toUpperCase()}`;
const ragOf = (s: string): string => (s === 'High' ? 'rag-red' : s === 'Medium' ? 'rag-amber' : 'rag-green');

type Kind = 'register' | 'ownership' | 'action' | 'sla' | 'closure';
const kindOf = (name: string, index: number): Kind => {
  if (index === 0) return 'register';
  if (/^ownership/i.test(name)) return 'ownership';
  if (/corrective/i.test(name)) return 'action';
  if (/^sla/i.test(name)) return 'sla';
  if (/^closure/i.test(name)) return 'closure';
  return 'register';
};

export function ProcessExceptionsPage() {
  const toast = useToast();
  const frame = useFrame();
  const kind = kindOf(frame?.tabName ?? '', frame?.index ?? 0);
  const [state, setState] = useState(kind === 'closure' ? 'resolved' : 'open');
  const [severity, setSeverity] = useState('');
  const [q, setQ] = useState('');
  const [noteFor, setNoteFor] = useState<Ex | null>(null);
  const [note, setNote] = useState('');
  const [assignFor, setAssignFor] = useState<Ex | null>(null);
  const [assignedToId, setAssignedToId] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const userList = useLoad(() => controlApi.users().catch(() => []), []);
  const effectiveState = kind === 'closure' ? 'resolved' : state;
  const list = useLoad<Ex[]>(() => spineApi.exceptions({ state: effectiveState, severity: severity || undefined }) as Promise<Ex[]>, [effectiveState, severity]);
  const rows = useMemo(() => (list.data ?? []).filter((r) => !q || `${exNo(r)} ${r.rule_name} ${r.doc_no ?? ''} ${r.detail ?? ''} ${r.owner_department}`.toLowerCase().includes(q.toLowerCase())), [list.data, q]);
  const open = rows.filter((r) => !r.resolved_at).length;

  async function act(r: Ex, action: 'note' | 'resolve', text?: string): Promise<void> {
    try {
      await spineApi.exceptionAction(r.id, action, text ? { note: text } : {});
      toast(action === 'note' ? 'Note saved.' : 'Exception resolved.');
      list.reload();
    } catch (e) {
      toast(errText(e));
    }
  }
  async function resolveSelected(): Promise<void> {
    const targets = rows.filter((r) => sel.has(r.id) && !r.resolved_at);
    if (targets.length === 0) return void toast('Tick the open exceptions you want to resolve.');
    for (const r of targets) await act(r, 'resolve');
    setSel(new Set());
  }
  const toggle = (id: string): void => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const head = (
    <tr>
      <th />
      <th>Exception No</th>
      <th>Exception Type</th>
      {kind === 'register' ? (<><th>Module</th><th>Reference ID</th><th>Description</th><th>Severity</th><th>Age</th><th>Status</th></>) : null}
      {kind === 'ownership' ? (<><th>Owner Department</th><th>Assigned To</th><th>Severity</th><th>Status</th></>) : null}
      {kind === 'action' ? (<><th>Reference ID</th><th>Corrective Action / Note</th><th>Status</th></>) : null}
      {kind === 'sla' ? (<><th>Reference ID</th><th>Raised</th><th>Age (days)</th><th>Severity</th><th>Status</th></>) : null}
      {kind === 'closure' ? (<><th>Reference ID</th><th>Resolved</th><th>Closed By</th><th>Note</th></>) : null}
      <th>Actions</th>
    </tr>
  );

  return (
    <div className="dash-page">
      <div className="page-head">
        <div>
          <h1>Process Exceptions</h1>
          <p className="muted">Delays found automatically every 30 minutes and cleared by themselves when the cause is fixed.</p>
        </div>
        <div className="actions">
          <button type="button" className="btn" onClick={() => void spineApi.runExceptions().then((r) => { toast(`Checked: ${r.raised} new, ${r.resolved} cleared.`); list.reload(); }, (e: unknown) => toast(errText(e)))}>
            Check now
          </button>
          <button type="button" className="btn" onClick={() => void resolveSelected()}>
            Resolve Selected
          </button>
        </div>
      </div>
      <div className="kpis">
        <div className="card kpi"><small>Shown</small><b>{rows.length}</b><small>Exceptions in this view</small></div>
        <div className="card kpi"><small>Open</small><b>{open}</b><small>Need action</small></div>
        <div className="card kpi"><small>High Severity</small><b>{rows.filter((r) => r.severity === 'High').length}</b><small>Immediate</small></div>
        <div className="card kpi"><small>Oldest Open (days)</small><b>{Math.max(0, ...rows.filter((r) => !r.resolved_at).map((r) => r.age_days ?? 0))}</b><small>Since raised</small></div>
      </div>
      <div className="card inline-form">
        <label>
          Search
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Exception, document, department…" />
        </label>
        {kind !== 'closure' ? (
          <label>
            Show
            <select value={state} onChange={(e) => setState(e.target.value)}>
              <option value="open">Open</option>
              <option value="resolved">Resolved</option>
              <option value="all">All</option>
            </select>
          </label>
        ) : null}
        <label>
          Severity
          <select value={severity} onChange={(e) => setSeverity(e.target.value)}>
            <option value="">All</option>
            <option>High</option>
            <option>Medium</option>
            <option>Low</option>
          </select>
        </label>
      </div>
      {list.error ? <p role="alert">{list.error}</p> : null}
      <div className="table-wrap">
        <table className="register-table">
          <thead>{head}</thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <input type="checkbox" aria-label={`Select ${exNo(r)}`} checked={sel.has(r.id)} onChange={() => toggle(r.id)} />
                </td>
                <td><b>{exNo(r)}</b></td>
                <td>{r.rule_name}</td>
                {kind === 'register' ? (
                  <>
                    <td>{r.doc_type}</td>
                    <td>{r.doc_no ?? '—'}</td>
                    <td>{r.detail ?? '—'}{r.note ? <div className="muted">Note: {r.note}</div> : null}</td>
                    <td><span className={`rag ${ragOf(r.severity)}`}>{r.severity}</span></td>
                    <td>{r.age_days ?? 0} d</td>
                    <td>{r.resolved_at ? 'Resolved' : 'Open'}</td>
                  </>
                ) : null}
                {kind === 'ownership' ? (
                  <>
                    <td>{r.owner_department}</td>
                    <td>
                      {r.assigned_to ? (
                        <span>{r.assigned_to}</span>
                      ) : (
                        <button
                          type="button"
                          className="btn sm"
                          onClick={() => {
                            setAssignFor(r);
                            setAssignedToId(r.assigned_to_id ?? '');
                          }}
                        >
                          Assign
                        </button>
                      )}
                    </td>
                    <td><span className={`rag ${ragOf(r.severity)}`}>{r.severity}</span></td>
                    <td>{r.resolved_at ? 'Resolved' : 'Open'}</td>
                  </>
                ) : null}
                {kind === 'action' ? (
                  <>
                    <td>{r.doc_no ?? '—'}</td>
                    <td>{r.note ?? <span className="muted">No corrective action recorded yet.</span>}</td>
                    <td>{r.resolved_at ? 'Resolved' : 'Open'}</td>
                  </>
                ) : null}
                {kind === 'sla' ? (
                  <>
                    <td>{r.doc_no ?? '—'}</td>
                    <td>{when(r.raised_at)}</td>
                    <td>{r.age_days ?? 0}</td>
                    <td><span className={`rag ${ragOf(r.severity)}`}>{r.severity}</span></td>
                    <td>{r.resolved_at ? 'Resolved' : 'Open'}</td>
                  </>
                ) : null}
                {kind === 'closure' ? (
                  <>
                    <td>{r.doc_no ?? '—'}</td>
                    <td>{when(r.resolved_at)}</td>
                    <td>{(r as Ex & { auto_resolved?: boolean }).auto_resolved ? 'Cleared by itself (cause fixed)' : 'Resolved by a person'}</td>
                    <td>{r.note ?? '—'}</td>
                  </>
                ) : null}
                <td className="row-actions">
                  <Link className="btn sm" to={`/m/${r.doc_type}`}>
                    View
                  </Link>
                  {!r.resolved_at ? (
                    <>
                      <button
                        type="button"
                        className="btn sm"
                        onClick={() => {
                          setAssignFor(r);
                          setAssignedToId(r.assigned_to_id ?? '');
                        }}
                      >
                        Assign
                      </button>
                      <button type="button" className="btn sm" onClick={() => { setNoteFor(r); setNote(r.note ?? ''); }}>
                        Note
                      </button>
                      <button type="button" className="btn sm primary" onClick={() => void act(r, 'resolve')}>
                        Resolve
                      </button>
                    </>
                  ) : null}
                </td>
              </tr>
            ))}
            {!list.loading && rows.length === 0 ? (
              <tr>
                <td colSpan={9}>{effectiveState === 'open' ? 'Nothing is late. All clear.' : 'No exceptions match this view.'}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {noteFor ? (
        <Modal
          title={`Note on ${exNo(noteFor)}`}
          sub={noteFor.rule_name}
          onClose={() => setNoteFor(null)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setNoteFor(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={!note.trim()}
                onClick={() => {
                  const target = noteFor;
                  setNoteFor(null);
                  void act(target, 'note', note.trim());
                }}
              >
                Save Note
              </button>
            </>
          }
        >
          <label>
            Corrective action / note
            <textarea rows={4} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What was done or will be done?" />
          </label>
        </Modal>
      ) : null}
      {assignFor ? (
        <Modal
          title={`Assign ${exNo(assignFor)}`}
          sub={assignFor.rule_name}
          onClose={() => setAssignFor(null)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setAssignFor(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={!assignedToId}
                onClick={async () => {
                  const target = assignFor;
                  const uid = assignedToId;
                  setAssignFor(null);
                  try {
                    await spineApi.exceptionAction(target.id, 'assign', { assignedToId: uid });
                    toast('Exception assigned.');
                    list.reload();
                  } catch (e) {
                    toast(errText(e));
                  }
                }}
              >
                Assign Person
              </button>
            </>
          }
        >
          <label>
            Assign to person
            <select value={assignedToId} onChange={(e) => setAssignedToId(e.target.value)}>
              <option value="">Select a person…</option>
              {(userList.data ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.loginId})
                </option>
              ))}
            </select>
          </label>
        </Modal>
      ) : null}
    </div>
  );
}
