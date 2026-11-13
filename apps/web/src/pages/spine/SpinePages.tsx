// Phase 26 pages: Sales Enquiries, 360 Order Tracking, Project History, Process Exceptions, Project Stage Gates
// (with specifications, tests, documents and the dossier PDF).
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useToast } from '../../components/Toast';
import { ApiError } from '../../lib/api';
import {
  saveBlob,
  spineApi,
  type Enquiry,
  type ExceptionRow,
  type Gate,
  type HistoryRow,
  type Order360,
  type ProjectOption,
} from '../../lib/spineApi';
import { useLoad } from '../../lib/useLoad';

const errText = (e: unknown): string => {
  if (e instanceof ApiError) {
    const f = Object.values(e.fields ?? {});
    return f.length > 0 ? f.join(' ') : e.message;
  }
  return 'That did not work.';
};
const when = (v: string | null): string => (v ? new Date(v).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

// ---------------------------------------------------------------------------------------------- project picker
function ProjectPicker({ value, onPick }: { value: ProjectOption | null; onPick: (p: ProjectOption | null) => void }) {
  const [q, setQ] = useState('');
  const [list, setList] = useState<ProjectOption[]>([]);
  useEffect(() => {
    let alive = true;
    void spineApi.options(q).then((r) => alive && setList(r), () => alive && setList([]));
    return () => {
      alive = false;
    };
  }, [q]);
  return (
    <label>
      Project
      <select
        value={value?.id ?? ''}
        onChange={(e) => onPick(list.find((p) => p.id === e.target.value) ?? null)}
        aria-label="Project"
      >
        <option value="">Choose a project</option>
        {value && !list.some((p) => p.id === value.id) ? <option value={value.id}>{value.code} {value.name}</option> : null}
        {list.map((p) => (
          <option key={p.id} value={p.id}>{p.code} · {p.name}</option>
        ))}
      </select>
      <input placeholder="Search project" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search project" />
    </label>
  );
}

// ---------------------------------------------------------------------------------------------- Sales Enquiries
const STATUSES = ['New', 'Qualified', 'Quoted', 'Won', 'Lost'] as const;

export function SalesEnquiriesPage() {
  const toast = useToast();
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const list = useLoad(() => spineApi.enquiries({ status: status || undefined, q: q || undefined }), [status, q]);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ prospectName: '', product: '', qty: '', projectTemplate: '' });
  const [lost, setLost] = useState<Enquiry | null>(null);
  const [reason, setReason] = useState('');

  async function run(fn: () => Promise<unknown>, ok: string) {
    try {
      await fn();
      toast(ok);
      list.reload();
    } catch (e) {
      toast(errText(e));
    }
  }

  return (
    <div className="dash-page">
      <div className="page-head">
        <div>
          <h1>Sales Enquiries</h1>
          <p className="muted">Qualify an enquiry, make a quotation, start a project for a new product, then win or lose it.</p>
        </div>
        <button type="button" className="btn primary" onClick={() => setAdding(true)}>＋ Add</button>
      </div>
      <div className="inline-form">
        <label>Status
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            {STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
        <label>Search<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Number, product or name" /></label>
      </div>
      {list.error ? <p role="alert">{list.error}</p> : null}
      <div className="table-wrap">
        <table className="register-table">
          <thead><tr><th>Number</th><th>Date</th><th>Customer / prospect</th><th>Product</th><th>Qty</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            {(list.data ?? []).map((e) => (
              <tr key={e.id}>
                <td>{e.number}</td>
                <td>{e.enq_date?.slice(0, 10)}</td>
                <td>{e.customer_name ?? e.prospect_name}</td>
                <td>{e.product}{e.project_template ? <span className="muted"> · {e.project_template}</span> : null}</td>
                <td>{e.qty ?? '—'}</td>
                <td><span className={`rag ${e.status === 'Won' ? 'rag-green' : e.status === 'Lost' ? 'rag-red' : ''}`}>{e.status}</span>{e.lost_reason ? <div className="muted">{e.lost_reason}</div> : null}</td>
                <td className="row-actions">
                  {e.status === 'New' ? <button type="button" className="btn" onClick={() => void run(() => spineApi.qualify(e.id), 'Qualified.')}>Qualify</button> : null}
                  {e.status === 'New' || e.status === 'Qualified' ? <button type="button" className="btn primary" onClick={() => void run(() => spineApi.toQuotation(e.id), 'Draft quotation created.')}>Create Quotation</button> : null}
                  {!e.project_id && e.status !== 'Lost' && e.status !== 'Won' ? <button type="button" className="btn" onClick={() => void run(() => spineApi.toProject(e.id), 'Project created with its gates.')}>Create Project</button> : null}
                  {e.status === 'Quoted' ? <button type="button" className="btn" onClick={() => void run(() => spineApi.won(e.id), 'Marked Won.')}>Won</button> : null}
                  {['New', 'Qualified', 'Quoted'].includes(e.status) ? <button type="button" className="btn" onClick={() => { setLost(e); setReason(''); }}>Lost</button> : null}
                </td>
              </tr>
            ))}
            {!list.loading && (list.data ?? []).length === 0 ? <tr><td colSpan={7}>No enquiries yet. Press Add.</td></tr> : null}
          </tbody>
        </table>
      </div>
      {adding ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Add enquiry">
          <div className="modal">
            <h2>New enquiry</h2>
            <label>Customer or prospect name<input value={form.prospectName} onChange={(e) => setForm({ ...form, prospectName: e.target.value })} /></label>
            <label>Product<input value={form.product} onChange={(e) => setForm({ ...form, product: e.target.value })} /></label>
            <label>Quantity<input inputMode="decimal" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} /></label>
            <label>New product template
              <select value={form.projectTemplate} onChange={(e) => setForm({ ...form, projectTemplate: e.target.value })}>
                <option value="">None (ordinary enquiry)</option>
                <option value="BLDC">BLDC motor</option>
                <option value="SPPM">SPPM machine</option>
                <option value="CUSTOM">Custom</option>
              </select>
            </label>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setAdding(false)}>Cancel</button>
              <button
                type="button"
                className="btn primary"
                onClick={() =>
                  void run(
                    () => spineApi.addEnquiry({ prospectName: form.prospectName || null, product: form.product, qty: form.qty ? Number(form.qty) : null, projectTemplate: form.projectTemplate || null }).then(() => setAdding(false)),
                    'Enquiry saved.',
                  )
                }
              >Save</button>
            </div>
          </div>
        </div>
      ) : null}
      {lost ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Lost reason">
          <div className="modal">
            <h2>Why was {lost.number} lost?</h2>
            <label>Lost reason<textarea value={reason} onChange={(e) => setReason(e.target.value)} /></label>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setLost(null)}>Cancel</button>
              <button type="button" className="btn primary" onClick={() => void run(() => spineApi.markLost(lost.id, reason).then(() => setLost(null)), 'Marked Lost.')}>Mark Lost</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- 360
const STAGE_COLOUR: Record<string, string> = { DONE: 'rag-green', ACTIVE: 'rag-amber', NOT_STARTED: '' };

export function Order360Page() {
  const [q, setQ] = useState('');
  const [orders, setOrders] = useState<{ id: string; number: string; status: string }[]>([]);
  const [soId, setSoId] = useState(() => new URLSearchParams(window.location.search).get('so') ?? '');
  const [data, setData] = useState<Order360 | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    void spineApi.orders(q).then((r) => alive && setOrders(Array.isArray(r) ? r : []), () => alive && setOrders([]));
    return () => {
      alive = false;
    };
  }, [q]);
  useEffect(() => {
    if (!soId) {
      setData(null);
      return;
    }
    let alive = true;
    setError('');
    void spineApi.order360(soId).then((r) => alive && setData(r), (e: unknown) => alive && setError(errText(e)));
    return () => {
      alive = false;
    };
  }, [soId]);
  return (
    <div className="dash-page">
      <div className="page-head">
        <div>
          <h1>360° Order Tracking</h1>
          <p className="muted">One order from enquiry to collection. Progress: order 5 · material 25 · production 35 · quality 10 · dispatch 15 · billing 5 · collection 5.</p>
        </div>
      </div>
      <div className="inline-form">
        <label>Find order<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Order number" /></label>
        <label>Sales order
          <select value={soId} onChange={(e) => setSoId(e.target.value)}>
            <option value="">Choose an order</option>
            {orders.map((o) => <option key={o.id} value={o.id}>{o.number} · {o.status}</option>)}
          </select>
        </label>
      </div>
      {error ? <p role="alert">{error}</p> : null}
      {data ? (
        <>
          <div className="panel">
            <strong>{data.order.number}</strong> · {data.order.customer} · Customer PO {data.order.customerPo ?? '—'} · Plant {data.order.plant}
            {data.order.project ? <> · Project {data.order.project}</> : null}
            <div className="progress" aria-label={`Progress ${data.progressPct} percent`}>
              <div className="progress-bar" style={{ width: `${data.progressPct}%` }} />
            </div>
            <p><strong>{data.progressPct} %</strong> complete</p>
            {data.heldBy.map((h) => <p key={h.docNo ?? h.since} className="muted">With {h.department} since {when(h.since)}</p>)}
          </div>
          <ol className="journey-steps" aria-label="Order journey">
            {data.stages.map((s) => (
              <li key={s.key} className={`journey-step ${s.state === 'DONE' ? 'approved' : s.state === 'ACTIVE' ? 'pending' : ''}`}>
                <span className={`rag ${STAGE_COLOUR[s.state] ?? ''}`}>{s.label}</span>
                <div className="muted">{s.total !== null ? `${s.done} of ${s.total}` : s.docs.length > 0 ? `${s.docs.length} document(s)` : 'Not started'}</div>
                {s.docs.slice(0, 3).map((d) => <div key={d.id}>{d.number}</div>)}
              </li>
            ))}
          </ol>
          <div className="table-wrap">
            <table className="register-table">
              <thead><tr><th>Line</th><th>Item</th><th>Ordered</th><th>Dispatched</th><th>Invoiced</th><th>Progress</th></tr></thead>
              <tbody>
                {data.lines.map((l) => (
                  <tr key={l.lineNo}><td>{l.lineNo}</td><td>{l.item ?? '—'}</td><td>{l.ordered}</td><td>{l.dispatched}</td><td>{l.invoiced}</td>
                    <td><div className="progress"><div className="progress-bar" style={{ width: `${l.progressPct}%` }} /></div></td></tr>
                ))}
                {data.lines.length === 0 ? <tr><td colSpan={6}>This order has no lines.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </>
      ) : <p className="muted">Choose an order to see its journey.</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- history
const KINDS = ['DOC_CREATED', 'MOVED', 'RECEIVED', 'ACCEPTED', 'RETURNED', 'SUBMITTED', 'APPROVED', 'REJECTED', 'POSTED', 'CANCELLED', 'GATE_OPENED', 'GATE_APPROVED', 'NOTE', 'ATTACHMENT', 'EXCEPTION'];

export function ProjectHistoryPage() {
  const toast = useToast();
  const [project, setProject] = useState<ProjectOption | null>(null);
  const [kind, setKind] = useState('');
  const hist = useLoad<HistoryRow[]>(() => (project ? spineApi.history(project.id, { kind: kind || undefined }) : Promise.resolve([])), [project?.id, kind]);
  return (
    <div className="dash-page">
      <div className="page-head">
        <div><h1>Project History</h1><p className="muted">Every event of a project across departments. Events of plants you did not choose are hidden.</p></div>
        {project ? (
          <button type="button" className="btn" onClick={() => void spineApi.historyXlsx(project.id).then((f) => saveBlob(f, 'project-history.xlsx'), (e: unknown) => toast(errText(e)))}>Export Excel</button>
        ) : null}
      </div>
      <div className="inline-form">
        <ProjectPicker value={project} onPick={setProject} />
        <label>Event<select value={kind} onChange={(e) => setKind(e.target.value)}><option value="">All</option>{KINDS.map((k) => <option key={k}>{k}</option>)}</select></label>
      </div>
      {hist.error ? <p role="alert">{hist.error}</p> : null}
      <div className="table-wrap">
        <table className="register-table">
          <thead><tr><th>When</th><th>Department</th><th>Person</th><th>Event</th><th>Document</th><th>Text</th></tr></thead>
          <tbody>
            {(hist.data ?? []).map((r) => (
              <tr key={r.id} className={r.masked ? 'muted' : undefined}>
                <td>{when(r.at)}</td><td>{r.department ?? '—'}</td><td>{r.actor ?? '—'}</td><td>{r.kind ?? '—'}</td><td>{r.doc_no ?? '—'}</td><td>{r.text}</td>
              </tr>
            ))}
            {project && !hist.loading && (hist.data ?? []).length === 0 ? <tr><td colSpan={6}>No events yet.</td></tr> : null}
            {!project ? <tr><td colSpan={6}>Choose a project.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- exceptions
export function ProcessExceptionsPage() {
  const toast = useToast();
  const [state, setState] = useState('open');
  const [severity, setSeverity] = useState('');
  const list = useLoad<ExceptionRow[]>(() => spineApi.exceptions({ state, severity: severity || undefined }), [state, severity]);
  const groups = new Map<string, ExceptionRow[]>();
  for (const r of list.data ?? []) groups.set(r.owner_department, [...(groups.get(r.owner_department) ?? []), r]);

  async function act(r: ExceptionRow, action: 'note' | 'resolve') {
    let note: string | undefined;
    if (action === 'note') {
      note = window.prompt('Note') ?? undefined;
      if (!note) return;
    }
    try {
      await spineApi.exceptionAction(r.id, action, note ? { note } : {});
      toast(action === 'note' ? 'Note saved.' : 'Resolved.');
      list.reload();
    } catch (e) {
      toast(errText(e));
    }
  }
  return (
    <div className="dash-page">
      <div className="page-head">
        <div><h1>Process Exceptions</h1><p className="muted">Delays found automatically every 30 minutes and cleared by themselves when the cause is fixed.</p></div>
        <button type="button" className="btn" onClick={() => void spineApi.runExceptions().then((r) => { toast(`Checked: ${r.raised} new, ${r.resolved} cleared.`); list.reload(); }, (e: unknown) => toast(errText(e)))}>Check now</button>
      </div>
      <div className="inline-form">
        <label>Show<select value={state} onChange={(e) => setState(e.target.value)}><option value="open">Open</option><option value="resolved">Resolved</option><option value="all">All</option></select></label>
        <label>Severity<select value={severity} onChange={(e) => setSeverity(e.target.value)}><option value="">All</option><option>High</option><option>Medium</option><option>Low</option></select></label>
      </div>
      {list.error ? <p role="alert">{list.error}</p> : null}
      {[...groups.entries()].map(([dept, rows]) => (
        <section key={dept} className="panel">
          <h2>{dept} <span className="muted">({rows.length})</span></h2>
          <table className="register-table">
            <thead><tr><th>Rule</th><th>Document</th><th>Detail</th><th>Raised</th><th>Severity</th><th>Actions</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.rule_name}</td><td>{r.doc_no ?? r.doc_type}</td><td>{r.detail}{r.note ? <div className="muted">Note: {r.note}</div> : null}</td><td>{when(r.raised_at)}</td>
                  <td><span className={`rag ${r.severity === 'High' ? 'rag-red' : r.severity === 'Medium' ? 'rag-amber' : ''}`}>{r.severity}</span></td>
                  <td className="row-actions">
                    {!r.resolved_at ? <><button type="button" className="btn" onClick={() => void act(r, 'note')}>Note</button><button type="button" className="btn" onClick={() => void act(r, 'resolve')}>Resolve</button></> : <span className="muted">Resolved {when(r.resolved_at)}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
      {!list.loading && (list.data ?? []).length === 0 ? <p className="muted">Nothing is late. All clear.</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- stage gates
const GATE_COLOUR: Record<Gate['state'], string> = { LOCKED: '', OPEN: 'rag-amber', IN_WORK: 'rag-amber', SUBMITTED: 'rag-amber', APPROVED: 'rag-green', REJECTED: 'rag-red' };

export function StageGatesPage({ section = 'gates' }: { section?: 'gates' | 'specs' | 'tests' | 'docs' }) {
  const toast = useToast();
  const [project, setProject] = useState<ProjectOption | null>(null);
  const pid = project?.id ?? '';
  const gates = useLoad<Gate[]>(() => (pid ? spineApi.gates(pid) : Promise.resolve([])), [pid]);
  const specs = useLoad(() => (pid ? spineApi.specs(pid) : Promise.resolve([])), [pid]);
  const tests = useLoad(() => (pid ? spineApi.tests(pid) : Promise.resolve([])), [pid]);
  const docs = useLoad(() => (pid ? spineApi.docs(pid) : Promise.resolve([])), [pid]);
  const [tab, setTab] = useState(section);
  const [f, setF] = useState({ parameter: '', target: '', tol: '', unit: '', testName: '', value: '', specId: '', gateId: '', docType: 'URS', title: '' });
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  async function run(fn: () => Promise<unknown>, ok: string, reload: (() => void)[]) {
    try {
      await fn();
      toast(ok);
      reload.forEach((r) => r());
    } catch (e) {
      toast(errText(e));
    }
  }
  const reloadAll = () => [gates.reload, specs.reload, tests.reload, docs.reload];

  return (
    <div className="dash-page">
      <div className="page-head">
        <div><h1>Project Stage Gates</h1><p className="muted">A gate can be submitted only when its deliverable is approved, its tests passed and the earlier gates are approved. Nothing moves by itself.</p></div>
        {project ? <button type="button" className="btn" onClick={() => void spineApi.dossier(project.id).then((x) => saveBlob(x, 'dossier.pdf'), (e: unknown) => toast(errText(e)))}>Download dossier PDF</button> : null}
      </div>
      <div className="inline-form"><ProjectPicker value={project} onPick={setProject} /></div>
      <div role="tablist" className="tabs-row">
        {([['gates', 'Gates'], ['specs', 'Specifications'], ['tests', 'Test records'], ['docs', 'Documents']] as const).map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={`btn${tab === k ? ' primary' : ''}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {!project ? <p className="muted">Choose a project. Projects start from Sales Enquiries ➜ Create Project, or here with a template.</p> : null}
      {project && tab === 'gates' ? (
        <>
          {(gates.data ?? []).length === 0 ? (
            <div className="panel">
              <p>This project has no gates yet.</p>
              {['BLDC', 'SPPM', 'CUSTOM'].map((t) => <button key={t} type="button" className="btn" onClick={() => void run(() => spineApi.applyTemplate(pid, t), `${t} gates created.`, [gates.reload])}>Use {t} template</button>)}
            </div>
          ) : null}
          <div className="gate-rail">
            {(gates.data ?? []).map((g) => (
              <article key={g.id} className="panel gate-card" aria-label={`Gate ${g.code}`}>
                <h3>{g.state === 'LOCKED' ? '🔒 ' : ''}{g.code}</h3>
                <p><strong>{g.name}</strong></p>
                <p><span className={`rag ${GATE_COLOUR[g.state]}`}>{g.state.replace('_', ' ')}</span> · {g.owner_department ?? '—'}</p>
                <p className="muted">Deliverable: {g.deliverable_name ?? '—'}{g.deliverable_doc_type ? ` (${g.deliverable_doc_type})` : ''}</p>
                <div className="progress" aria-label={`Readiness ${g.readinessPct} percent`}><div className="progress-bar" style={{ width: `${g.readinessPct}%` }} /></div>
                <p className="muted">Ready {g.readinessPct} %{g.missing.length > 0 && g.state !== 'APPROVED' ? ` · needs ${g.missing.join(', ')}` : ''}</p>
                {g.reject_comment ? <p role="alert">Rejected: {g.reject_comment}</p> : null}
                <label>Due<input type="date" value={g.due_date?.slice(0, 10) ?? ''} onChange={(e) => void run(() => spineApi.setDue(pid, g.id, e.target.value || null), 'Due date saved.', [gates.reload])} /></label>
                <div className="row-actions">
                  {g.state === 'OPEN' ? <button type="button" className="btn" onClick={() => void run(() => spineApi.startGate(pid, g.id), 'Gate started.', [gates.reload])}>Start</button> : null}
                  {g.state === 'OPEN' || g.state === 'IN_WORK' ? <button type="button" className="btn primary" onClick={() => void run(() => spineApi.submitGate(pid, g.id), 'Submitted.', reloadAll())}>Submit</button> : null}
                </div>
              </article>
            ))}
          </div>
        </>
      ) : null}
      {project && tab === 'specs' ? (
        <>
          <div className="inline-form">
            <label>Parameter<input value={f.parameter} onChange={(e) => set('parameter', e.target.value)} /></label>
            <label>Target<input inputMode="decimal" value={f.target} onChange={(e) => set('target', e.target.value)} /></label>
            <label>Tolerance ±<input inputMode="decimal" value={f.tol} onChange={(e) => set('tol', e.target.value)} /></label>
            <label>Unit<input value={f.unit} onChange={(e) => set('unit', e.target.value)} /></label>
            <button type="button" className="btn primary" onClick={() => void run(() => spineApi.addSpec(pid, { parameter: f.parameter, target: f.target ? Number(f.target) : null, tolMinus: f.tol ? Number(f.tol) : null, tolPlus: f.tol ? Number(f.tol) : null, unit: f.unit || null }), 'Specification added.', [specs.reload])}>Add</button>
          </div>
          <table className="register-table"><thead><tr><th>No</th><th>Parameter</th><th>Target</th><th>− / +</th><th>Unit</th><th>Rev</th><th>Status</th><th /></tr></thead>
            <tbody>{(specs.data ?? []).map((s) => (
              <tr key={s.id}><td>{s.spec_no}</td><td>{s.parameter}</td><td>{s.target ?? '—'}</td><td>{s.tol_minus ?? '—'} / {s.tol_plus ?? '—'}</td><td>{s.unit ?? ''}</td><td>{s.revision}</td><td>{s.status}</td>
                <td>{s.status === 'Draft' ? <button type="button" className="btn" onClick={() => void run(() => spineApi.approveSpec(pid, s.id), 'Approved.', [specs.reload])}>Approve</button> : null}</td></tr>
            ))}</tbody></table>
        </>
      ) : null}
      {project && tab === 'tests' ? (
        <>
          <div className="inline-form">
            <label>Test<input value={f.testName} onChange={(e) => set('testName', e.target.value)} /></label>
            <label>Gate<select value={f.gateId} onChange={(e) => set('gateId', e.target.value)}><option value="">None</option>{(gates.data ?? []).map((g) => <option key={g.id} value={g.id}>{g.code}</option>)}</select></label>
            <label>Specification<select value={f.specId} onChange={(e) => set('specId', e.target.value)}><option value="">None</option>{(specs.data ?? []).filter((s) => s.status !== 'Superseded').map((s) => <option key={s.id} value={s.id}>{s.spec_no} {s.parameter}</option>)}</select></label>
            <label>Value<input inputMode="decimal" value={f.value} onChange={(e) => set('value', e.target.value)} /></label>
            <button type="button" className="btn primary" onClick={() => void run(() => spineApi.addTest(pid, { testName: f.testName, gateId: f.gateId || null, specId: f.specId || null, value: f.value ? Number(f.value) : null }), 'Test saved.', reloadAll())}>Add</button>
          </div>
          <table className="register-table"><thead><tr><th>Test</th><th>Gate</th><th>Spec</th><th>Value</th><th>Result</th><th>Date</th></tr></thead>
            <tbody>{(tests.data ?? []).map((t) => (
              <tr key={t.id}><td>{t.test_name}</td><td>{t.gate_code ?? '—'}</td><td>{t.spec_no ?? '—'}</td><td>{t.value ?? '—'}</td><td><span className={`rag ${t.result === 'OK' ? 'rag-green' : t.result === 'NG' ? 'rag-red' : ''}`}>{t.result ?? 'Pending'}</span></td><td>{when(t.tested_at)}</td></tr>
            ))}</tbody></table>
        </>
      ) : null}
      {project && tab === 'docs' ? (
        <>
          <div className="inline-form">
            <label>Type<select value={f.docType} onChange={(e) => set('docType', e.target.value)}>{['URS', 'CHARTER', 'SPEC', 'DRR', 'BOM', 'PO', 'IQC', 'JC', 'TR', 'FAT', 'DC', 'SAT', 'INV', 'CLOSE'].map((t) => <option key={t}>{t}</option>)}</select></label>
            <label>Title<input value={f.title} onChange={(e) => set('title', e.target.value)} /></label>
            <label>Gate<select value={f.gateId} onChange={(e) => set('gateId', e.target.value)}><option value="">None</option>{(gates.data ?? []).map((g) => <option key={g.id} value={g.id}>{g.code}</option>)}</select></label>
            <button type="button" className="btn primary" onClick={() => void run(() => spineApi.addDoc(pid, { docType: f.docType, title: f.title, gateId: f.gateId || null }), 'Document added.', [docs.reload])}>Add</button>
          </div>
          <table className="register-table"><thead><tr><th>Type</th><th>Title</th><th>Gate</th><th>Rev</th><th>Status</th><th /></tr></thead>
            <tbody>{(docs.data ?? []).map((d) => (
              <tr key={d.id}><td>{d.doc_type}</td><td>{d.title}</td><td>{d.gate_code ?? '—'}</td><td>{d.revision}</td><td>{d.status}</td>
                <td>{d.status === 'Draft' ? <button type="button" className="btn" onClick={() => void run(() => spineApi.approveDoc(pid, d.id), 'Approved.', reloadAll())}>Approve</button> : null}</td></tr>
            ))}</tbody></table>
        </>
      ) : null}
      <p className="muted"><Link to="/m/project-global-history">See the project history</Link></p>
    </div>
  );
}
