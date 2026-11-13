// Phase 25 pages: Department Inbox, Work Center, All Department Movements and the Workflow Matrix.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { HistoryDrawer, MoveForwardDialog, ReturnDialog } from '../../components/MoveForward';
import { useToast } from '../../components/Toast';
import { ApiError } from '../../lib/api';
import { workApi, type Dept, type Movement, type WorkRule } from '../../lib/workApi';
import { useLoad } from '../../lib/useLoad';
import type { ActionSet } from '../../types';

const TABS: { key: string; label: string }[] = [
  { key: 'receive', label: 'To Receive' },
  { key: 'accept', label: 'To Accept' },
  { key: 'work', label: 'In Work' },
  { key: 'returned', label: 'Returned' },
  { key: 'sent', label: 'Sent by us' },
  { key: 'all', label: 'All' },
];

function SlaChip({ m }: { m: Movement }) {
  if (!m.sla_due_at) return <span className="muted">—</span>;
  const due = new Date(m.sla_due_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  return <span className={`rag ${m.is_late ? 'rag-red' : 'rag-green'}`}>{m.is_late ? `Late · ${due}` : `Due ${due}`}</span>;
}

function useDepartments(): Dept[] {
  const d = useLoad(() => workApi.departments(), []);
  return d.data ?? [];
}

export function DeptInboxPage({ all = false }: { all?: boolean }) {
  const toast = useToast();
  const depts = useDepartments();
  const [dept, setDept] = useState('');
  const [tab, setTab] = useState(all ? 'all' : 'receive');
  const [lateOnly, setLateOnly] = useState(false);
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Movement[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const [returning, setReturning] = useState<Movement | null>(null);
  const [history, setHistory] = useState<Movement | null>(null);
  const [forwarding, setForwarding] = useState<Movement | null>(null);

  useEffect(() => {
    let alive = true;
    setBusy(true);
    workApi.inbox({ dept: dept || undefined, tab, late: lateOnly, q: q || undefined }).then(
      (r) => {
        if (!alive) return;
        setRows(r.rows);
        setCursor(r.nextCursor);
        setMore(r.hasMore);
        setError('');
        setBusy(false);
      },
      (e: unknown) => {
        if (!alive) return;
        setError(e instanceof ApiError ? e.message : 'Could not load the inbox.');
        setBusy(false);
      },
    );
    return () => {
      alive = false;
    };
  }, [dept, tab, lateOnly, q, tick]);

  async function loadMore() {
    if (!cursor) return;
    const r = await workApi.inbox({ dept: dept || undefined, tab, late: lateOnly, q: q || undefined, cursor });
    setRows((cur) => [...cur, ...r.rows]);
    setCursor(r.nextCursor);
    setMore(r.hasMore);
  }

  async function act(m: Movement, action: 'receive' | 'accept' | 'recall' | 'complete') {
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
      <div className="page-head">
        <div>
          <h1>{all ? 'All Department Movements' : 'Department Inbox'}</h1>
          <p className="muted">Work moves only when a person presses a button. Every step is stamped with a name and a time.</p>
        </div>
      </div>
      <div className="inline-form">
        <label>
          Department
          <select value={dept} onChange={(e) => setDept(e.target.value)}>
            <option value="">{all ? 'All departments' : 'My department'}</option>
            {depts.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Search
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Number or document" />
        </label>
        <label className="plant-remember">
          <input type="checkbox" checked={lateOnly} onChange={(e) => setLateOnly(e.target.checked)} /> Late only
        </label>
      </div>
      <div role="tablist" className="tabs-row">
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={`btn${tab === t.key ? ' primary' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      {error ? <p role="alert">{error}</p> : null}
      <div className="table-wrap">
        <table className="register-table">
          <thead>
            <tr>
              <th>Number</th>
              <th>Document</th>
              <th>From</th>
              <th>To</th>
              <th>Sent</th>
              <th>SLA</th>
              <th>Priority</th>
              <th>State</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.id}>
                <td>{m.number}</td>
                <td>
                  <Link to={`/m/${m.doc_type}`}>{m.doc_no ?? m.doc_type}</Link>
                  {m.handover_note ? <div className="muted">{m.handover_note}</div> : null}
                </td>
                <td>{m.from_department}</td>
                <td>{m.to_department}</td>
                <td>{new Date(m.sent_at).toLocaleString('en-IN')}</td>
                <td>
                  <SlaChip m={m} />
                </td>
                <td>{m.priority}</td>
                <td>{m.state.replace('_', ' ')}</td>
                <td className="row-actions">
                  {m.state === 'SENT' ? (
                    <>
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
                        Accepted
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
                      <button type="button" className="btn" onClick={() => setReturning(m)}>
                        Return
                      </button>
                    </>
                  ) : null}
                  <Link className="btn" to={`/m/${m.doc_type}`}>
                    Open
                  </Link>
                  <button type="button" className="btn" onClick={() => setHistory(m)}>
                    History
                  </button>
                </td>
              </tr>
            ))}
            {!busy && rows.length === 0 ? (
              <tr>
                <td colSpan={9}>Nothing here. No movements yet.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {more ? (
        <button type="button" className="btn" onClick={() => void loadMore()}>
          Next
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
      {history ? <HistoryDrawer docType={history.doc_type} docId={history.doc_id} title={history.doc_no ?? history.doc_type} onClose={() => setHistory(null)} /> : null}
      {forwarding ? (
        <MoveForwardDialog
          docType={forwarding.doc_type}
          docId={forwarding.doc_id}
          {...(forwarding.doc_no ? { docNo: forwarding.doc_no } : {})}
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

export function DeptWorkPage() {
  const wc = useLoad(() => workApi.workCenter(), []);
  const [forwarding, setForwarding] = useState<Movement | null>(null);
  if (wc.error) return <p role="alert">{wc.error}</p>;
  if (!wc.data) return <p className="muted">Loading…</p>;
  return (
    <div className="dash-page">
      <div className="page-head">
        <h1>Department Work Center</h1>
      </div>
      {wc.data.groups.length === 0 ? <p className="muted">No accepted work yet. Accept items in the Department Inbox.</p> : null}
      {wc.data.groups.map((g) => (
        <section key={g.docType} aria-label={g.docType}>
          <h2>{g.docType}</h2>
          <div className="table-wrap">
            <table className="register-table">
              <thead>
                <tr>
                  <th>Number</th>
                  <th>Document</th>
                  <th>From</th>
                  <th>Accepted</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {g.items.map((m) => (
                  <tr key={m.id}>
                    <td>{m.number}</td>
                    <td>{m.doc_no ?? m.doc_type}</td>
                    <td>{m.from_department}</td>
                    <td>{m.accepted_at ? new Date(m.accepted_at).toLocaleString('en-IN') : '—'}</td>
                    <td className="row-actions">
                      <Link className="btn" to={`/m/${m.doc_type}`}>
                        Open Work
                      </Link>
                      <button type="button" className="btn primary" onClick={() => setForwarding(m)}>
                        Move Forward
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      {forwarding ? (
        <MoveForwardDialog
          docType={forwarding.doc_type}
          docId={forwarding.doc_id}
          {...(forwarding.doc_no ? { docNo: forwarding.doc_no } : {})}
          fromDepartment={forwarding.to_department}
          onClose={() => setForwarding(null)}
          onMoved={() => {
            setForwarding(null);
            wc.reload();
          }}
        />
      ) : null}
    </div>
  );
}

export function WorkflowMatrixPage({ actions }: { actions: ActionSet }) {
  const rules = useLoad(() => workApi.rules(), []);
  const depts = useDepartments();
  const toast = useToast();
  const [draft, setDraft] = useState<Record<string, WorkRule>>({});

  const rows = (rules.data ?? []).map((r) => draft[r.module_id] ?? r);
  const change = (r: WorkRule, patch: Partial<WorkRule>) => setDraft((d) => ({ ...d, [r.module_id]: { ...r, ...patch } }));

  async function save(r: WorkRule) {
    try {
      await workApi.saveRule(r.module_id, {
        ownerDepartmentId: r.owner_department_id,
        nextDepartmentId: r.next_department_id,
        approvalDepartmentId: r.approval_department_id,
        routeMode: r.route_mode,
        slaDays: r.sla_days,
        routedEdit: r.routed_edit,
        active: r.active,
        requiredAttachmentTypes: r.required_attachment_types,
        requiredFields: r.required_fields,
      });
      toast(`Saved ${r.module_id}.`);
      setDraft((d) => {
        const n = { ...d };
        delete n[r.module_id];
        return n;
      });
      rules.reload();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not save the rule.');
    }
  }

  const deptSelect = (value: string | null, onChange: (v: string | null) => void, label: string) => (
    <select aria-label={label} value={value ?? ''} disabled={!actions.edit} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">—</option>
      {depts.map((d) => (
        <option key={d.id} value={d.id}>
          {d.name}
        </option>
      ))}
    </select>
  );

  return (
    <div className="dash-page">
      <div className="page-head">
        <div>
          <h1>Workflow Matrix</h1>
          <p className="muted">Which department owns each document and which one normally receives it next. Move Forward suggests this; the person still decides.</p>
        </div>
      </div>
      {rules.error ? <p role="alert">{rules.error}</p> : null}
      <div className="table-wrap">
        <table className="register-table">
          <thead>
            <tr>
              <th>Page</th>
              <th>Owner</th>
              <th>Next</th>
              <th>Approval</th>
              <th>Mode</th>
              <th>SLA days</th>
              <th>Routed edit</th>
              <th>Active</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.module_id}>
                <td>{r.module_id}</td>
                <td>{deptSelect(r.owner_department_id, (v) => change(r, { owner_department_id: v }), `Owner of ${r.module_id}`)}</td>
                <td>{deptSelect(r.next_department_id, (v) => change(r, { next_department_id: v }), `Next after ${r.module_id}`)}</td>
                <td>{deptSelect(r.approval_department_id, (v) => change(r, { approval_department_id: v }), `Approval for ${r.module_id}`)}</td>
                <td>
                  <select aria-label={`Mode of ${r.module_id}`} value={r.route_mode} disabled={!actions.edit} onChange={(e) => change(r, { route_mode: e.target.value as 'MANUAL' | 'SUGGEST' })}>
                    <option>SUGGEST</option>
                    <option>MANUAL</option>
                  </select>
                </td>
                <td>
                  <input type="number" min="0" step="0.5" aria-label={`SLA days of ${r.module_id}`} value={r.sla_days} disabled={!actions.edit} onChange={(e) => change(r, { sla_days: Number(e.target.value) })} style={{ width: 70 }} />
                </td>
                <td>
                  <input type="checkbox" aria-label={`Routed edit of ${r.module_id}`} checked={r.routed_edit} disabled={!actions.edit} onChange={(e) => change(r, { routed_edit: e.target.checked })} />
                </td>
                <td>
                  <input type="checkbox" aria-label={`${r.module_id} active`} checked={r.active} disabled={!actions.edit} onChange={(e) => change(r, { active: e.target.checked })} />
                </td>
                <td>
                  {actions.edit && draft[r.module_id] ? (
                    <button type="button" className="btn primary" onClick={() => void save(r)}>
                      Save
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
            {rules.data && rows.length === 0 ? (
              <tr>
                <td colSpan={9}>No rules yet.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
