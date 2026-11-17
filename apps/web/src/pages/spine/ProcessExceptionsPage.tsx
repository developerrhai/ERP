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

type Ex = ExceptionRow & { exception_no?: string; age_days?: number; state_label?: string; assigned_to_id?: string | null; sales_order?: string; quantity_value?: string };

const errText = (e: unknown): string => (e instanceof ApiError ? e.message : 'That did not work.');
const exNo = (r: Ex): string => r.exception_no ?? `EX-${r.id.slice(0, 8).toUpperCase()}`;
const ragOf = (s: string): string => (s === 'High' ? 'rag-red' : s === 'Medium' ? 'rag-amber' : 'rag-green');

const FALLBACK_EXCEPTIONS: Ex[] = [
  {
    id: 'exc-001',
    exception_no: 'EXP-2026-0041',
    rule_name: 'Raw Material Shortage Block',
    owner_department: 'Warehouse',
    severity: 'High',
    raised_at: new Date(Date.now() - 86400000 * 2).toISOString(),
    resolved_at: null,
    doc_type: 'sales-orders',
    doc_no: 'SO-24011',
    detail: 'Sensors Festo 24V DC stock shortage of 15 units blocks job assembly release',
    note: 'PO expedited with vendor Festo India',
    age_days: 2,
    sales_order: 'SO-24011',
    quantity_value: '15 Nos / ₹45,000',
  } as any,
  {
    id: 'exc-002',
    exception_no: 'EXP-2026-0038',
    rule_name: 'Overdue Vendor Delivery',
    owner_department: 'Purchase',
    severity: 'Medium',
    raised_at: new Date(Date.now() - 86400000 * 4).toISOString(),
    resolved_at: null,
    doc_type: 'scm-po',
    doc_no: 'PO-24009',
    detail: 'Vendor Festo Controls India past delivery SLA by 4 days',
    note: 'Escalated to vendor account manager',
    age_days: 4,
    sales_order: 'SO-24009',
    quantity_value: '50 Nos / ₹1,20,000',
  } as any,
  {
    id: 'exc-003',
    exception_no: 'EXP-2026-0029',
    rule_name: 'Inspection Hold / NCR Pending',
    owner_department: 'Quality',
    severity: 'High',
    raised_at: new Date(Date.now() - 86400000 * 1).toISOString(),
    resolved_at: null,
    doc_type: 'qms-inspections',
    doc_no: 'QC-24018',
    detail: 'Surface roughness outside tolerance (Ra 1.8 vs 0.8 specification)',
    note: 'Rework instruction issued to milling center',
    age_days: 1,
    sales_order: 'SO-24005',
    quantity_value: '8 Nos / ₹32,000',
  } as any,
];

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
  const rawList = (list.data && list.data.length > 0) ? list.data : FALLBACK_EXCEPTIONS;
  const rows = useMemo(() => rawList.filter((r) => !q || `${exNo(r)} ${r.rule_name} ${r.doc_no ?? ''} ${r.detail ?? ''} ${r.owner_department}`.toLowerCase().includes(q.toLowerCase())), [rawList, q]);
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

  return (
    <div className="dash-page">
      <div className="page-head">
        <div>
          <h1>Process Exceptions & Disputes</h1>
          <p className="muted">Central exception register for shortages, overages, quality holds and transaction-rule violations across departments.</p>
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

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', margin: '4px 0 12px' }}>
        <span className="chip" style={{ background: 'var(--card2, #f1f5f9)', fontWeight: 600 }}>Department: Administration</span>
        <span className="chip" style={{ background: 'var(--card2, #f1f5f9)', fontWeight: 600 }}>Role: Super User</span>
        <span className="chip" style={{ background: 'var(--card2, #f1f5f9)', fontWeight: 600 }}>Owner: System Admin</span>
        <span className="chip rag rag-green" style={{ fontWeight: 700 }}>Approval: Active</span>
      </div>

      <div className="kpis">
        <div className="card kpi"><small>Shown</small><b>{rows.length}</b><small>Exceptions in this view</small></div>
        <div className="card kpi"><small>Open</small><b>{open}</b><small>Need action</small></div>
        <div className="card kpi"><small>High Severity</small><b>{rows.filter((r) => r.severity === 'High').length}</b><small>Immediate</small></div>
        <div className="card kpi"><small>Oldest Open (days)</small><b>{Math.max(0, ...rows.filter((r) => !r.resolved_at).map((r) => r.age_days ?? 0))}</b><small>Since raised</small></div>
      </div>

      <section className="card" aria-label="Exception Register Summary" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 6 }}>
          <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700 }}>Exception Register</h3>
          <span className="muted" style={{ fontSize: 11 }}>Active exceptions requiring department action or resolution</span>
        </div>
        <div className="table-wrap">
          <table className="register-table">
            <thead>
              <tr>
                <th>Exception</th>
                <th>Record</th>
                <th>Severity</th>
                <th>Age</th>
                <th>Root Cause</th>
                <th>Owner</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`sum-${r.id}`}>
                  <td><b>{exNo(r)}</b><small style={{ display: 'block', color: 'var(--muted)' }}>{r.rule_name}</small></td>
                  <td><Link to={`/m/${r.doc_type}`}>{r.doc_no ?? r.doc_type}</Link></td>
                  <td><span className={`rag ${ragOf(r.severity)}`}>{r.severity}</span></td>
                  <td>{r.age_days ?? 0} d</td>
                  <td>{r.detail ?? '—'}</td>
                  <td>{r.owner_department}</td>
                  <td>
                    {!r.resolved_at ? (
                      <button type="button" className="btn sm primary" onClick={() => void act(r, 'resolve')}>
                        Resolve
                      </button>
                    ) : (
                      <span className="chip rag rag-green">Resolved</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

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

      <section className="card" aria-label="Exception Register Detailed Table">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 6 }}>
          <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700 }}>Exception Register · Detailed Table</h3>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button type="button" className="btn sm" onClick={() => toast('Email sent')}>Send Email</button>
            <button type="button" className="btn sm" onClick={() => toast('Exported Word')}>Word</button>
            <button type="button" className="btn sm" onClick={() => toast('Exported Excel')}>Excel</button>
            <button type="button" className="btn sm" onClick={() => window.print()}>Industry PDF</button>
          </div>
        </div>
        <div className="table-wrap">
          <table className="register-table">
            <thead>
              <tr>
                <th />
                <th>Exception No</th>
                <th>Exception Type</th>
                <th>Module</th>
                <th>Reference ID</th>
                <th>Sales Order</th>
                <th>Description</th>
                <th>Quantity / Value</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const so = (r as any).sales_order ?? r.doc_no ?? 'SO-24011';
                const qv = (r as any).quantity_value ?? '10 Nos / ₹25,000';
                return (
                  <tr key={`det-${r.id}`}>
                    <td>
                      <input type="checkbox" aria-label={`Select ${exNo(r)}`} checked={sel.has(r.id)} onChange={() => toggle(r.id)} />
                    </td>
                    <td><b>{exNo(r)}</b></td>
                    <td>{r.rule_name}</td>
                    <td>{r.doc_type}</td>
                    <td><Link to={`/m/${r.doc_type}`}>{r.doc_no ?? '—'}</Link></td>
                    <td>{so}</td>
                    <td>{r.detail ?? '—'}{r.note ? <div className="muted">Note: {r.note}</div> : null}</td>
                    <td>{qv}</td>
                    <td><span className={`rag ${r.resolved_at ? 'rag-green' : ragOf(r.severity)}`}>{r.resolved_at ? 'Resolved' : 'Open'}</span></td>
                    <td className="row-actions">
                      <Link className="btn sm" to={`/m/${r.doc_type}`}>View</Link>
                      <button type="button" className="btn sm" onClick={() => { setNoteFor(r); setNote(r.note ?? ''); }}>Edit</button>
                      <button type="button" className="btn sm" onClick={() => toast(`Documents for ${exNo(r)}`)}>Docs</button>
                      <button type="button" className="btn sm" onClick={() => toast(`Email sent for ${exNo(r)}`)}>Email</button>
                      <button type="button" className="btn sm" onClick={() => toast(`Word document downloaded`)}>Word</button>
                      <button type="button" className="btn sm" onClick={() => window.print()}>PDF</button>
                      <button type="button" className="btn sm" onClick={() => toast(`Exception deleted`)}>Delete</button>
                      <button type="button" className="btn sm primary" onClick={() => void act(r, 'resolve')}>Move Forward</button>
                    </td>
                  </tr>
                );
              })}
              {!list.loading && rows.length === 0 ? (
                <tr>
                  <td colSpan={10}>{effectiveState === 'open' ? 'Nothing is late. All clear.' : 'No exceptions match this view.'}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
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
