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
  type Gate,
  type ProjectOption,
} from '../../lib/spineApi';
import { useLoad } from '../../lib/useLoad';
import { lookupCustomers } from '../../lib/scmApi';
import { Combobox, DateField } from '../../ui/components';
import type { ActionSet } from '../../types';
import { V40Register } from '../sales/V40Register';
import { EnquiryDialog } from './EnquiryDialog';

const errText = (e: unknown): string => {
  if (e instanceof ApiError) {
    const f = Object.values(e.fields ?? {});
    return f.length > 0 ? f.join(' ') : e.message;
  }
  return 'That did not work.';
};
const when = (v: string | null): string =>
  v
    ? new Date(v).toLocaleString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';

// ---------------------------------------------------------------------------------------------- project picker
function ProjectPicker({
  value,
  onPick,
}: {
  value: ProjectOption | null;
  onPick: (p: ProjectOption | null) => void;
}) {
  const [q, setQ] = useState('');
  const [list, setList] = useState<ProjectOption[]>([]);
  useEffect(() => {
    let alive = true;
    void spineApi.options(q).then(
      (r) => alive && setList(r),
      () => alive && setList([]),
    );
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
        {value && !list.some((p) => p.id === value.id) ? (
          <option value={value.id}>
            {value.code} {value.name}
          </option>
        ) : null}
        {list.map((p) => (
          <option key={p.id} value={p.id}>
            {p.code} · {p.name}
          </option>
        ))}
      </select>
      <input
        placeholder="Search project"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label="Search project"
      />
    </label>
  );
}

/** Customer picker for an enquiry that is still a prospect (BUG-02): the same customer search the quotation form uses. */
function CustomerField({
  prospect,
  value,
  error,
  onPick,
}: {
  prospect: string | null;
  value: { value: string; label: string } | null;
  error: string;
  onPick: (o: { value: string; label: string } | null) => void;
}) {
  return (
    <div className="field">
      <label htmlFor="enq-customer">Customer *</label>
      <Combobox
        id="enq-customer"
        value={value}
        placeholder={prospect ? `Search customer (prospect: ${prospect})` : 'Search customer'}
        search={async (q) =>
          (await lookupCustomers(q)).map((c) => ({ value: c.id, label: c.label }))
        }
        onPick={onPick}
      />
      <small className="muted">
        {prospect ? `"${prospect}" is not linked to a customer yet. ` : ''}Pick it here; if the customer is
        new, create it in Customers first.
      </small>
      {error ? (
        <p role="alert" className="msg error show static">
          {error}
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- Sales Enquiries
const STATUSES = ['New', 'Qualified', 'Quoted', 'Won', 'Lost'] as const;

export function SalesEnquiriesPage({ actions }: { actions?: ActionSet } = {}) {
  const toast = useToast();
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const list = useLoad(
    () => spineApi.enquiries({ status: status || undefined, q: q || undefined }),
    [status, q],
  );
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [form, setForm] = useState({ prospectName: '', product: '', qty: '', projectTemplate: '' });
  const [lost, setLost] = useState<Enquiry | null>(null);
  const [reason, setReason] = useState('');
  // an enquiry line is free text with no HSN, so the GST rate is asked for here
  const [quoting, setQuoting] = useState<Enquiry | null>(null);
  const [gst, setGst] = useState('18');
  const [gstError, setGstError] = useState('');
  // BUG-02: an enquiry with no customer yet (a prospect) gets its customer picked on the step that needs it
  const [custPick, setCustPick] = useState<{ value: string; label: string } | null>(null);
  const [custError, setCustError] = useState('');
  const [projFor, setProjFor] = useState<Enquiry | null>(null);

  async function makeQuotation() {
    if (!quoting) return;
    const n = Number(gst);
    if (gst.trim() === '' || Number.isNaN(n) || n < 0 || n > 28) {
      setGstError('Enter the GST % for this item, between 0 and 28.');
      return;
    }
    setCustError('');
    try {
      if (custPick) await spineApi.toQuotation(quoting.id, n, custPick.value);
      else await spineApi.toQuotation(quoting.id, n);
      toast('Draft quotation created.');
      setQuoting(null);
      list.reload();
    } catch (e) {
      if (e instanceof ApiError && e.fields?.customerId) setCustError(e.fields.customerId);
      else setGstError(e instanceof ApiError && e.fields?.gstPct ? e.fields.gstPct : errText(e));
    }
  }

  /** Create Project: if the enquiry has no customer to link, ask for one instead of failing with a toast. */
  async function makeProject(e: Enquiry, customerId?: string) {
    try {
      if (customerId) await spineApi.toProject(e.id, undefined, customerId);
      else await spineApi.toProject(e.id);
      toast('Project created with its gates.');
      setProjFor(null);
      list.reload();
    } catch (err) {
      if (err instanceof ApiError && err.fields?.customerId) {
        setCustError(err.fields.customerId);
        setCustPick(null);
        setProjFor(await fullEnquiry(e));
      } else toast(errText(err));
    }
  }

  /** The full enquiry (product, prospect, customer) for a dialog: from the list when it has it, else from the server. */
  async function fullEnquiry(e: Enquiry): Promise<Enquiry> {
    if (e.product !== undefined) return e;
    try {
      return await spineApi.enquiry(e.id);
    } catch {
      return e;
    }
  }

  async function openQuotation(e: Enquiry) {
    const full = await fullEnquiry(e);
    setQuoting(full);
    setGst('18');
    setGstError('');
    setCustPick(null);
    setCustError('');
  }

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
          <p className="muted">
            Qualify an enquiry, make a quotation, start a project for a new product, then win or
            lose it.
          </p>
        </div>
        <button type="button" className="btn primary" onClick={() => setAdding(true)}>
          ＋ Add
        </button>
      </div>
      <div className="inline-form">
        <label>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            {STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label>
          Search
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Number, product or name"
          />
        </label>
      </div>
      {list.error ? <p role="alert">{list.error}</p> : null}
      <V40Register
        pageId="sales-enquiries"
        reloadKey={list.data}
        onChanged={list.reload}
        onOpen={setOpenId}
        {...(actions ? { actions } : {})}
        rowExtra={(r) => {
          // The buttons follow the row the table shows (the Sales register API), not a second capped list: a row on a
          // later page is not in that list, and its buttons used to vanish. Details load when a button needs them.
          const known = (list.data ?? []).find((x) => x.id === r.id);
          const e = {
            ...(known ?? { id: r.id, number: r.number, project_id: null }),
            status: r.status,
          } as Enquiry;
          return (
            <>
              {e.status === 'New' ? (
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => void run(() => spineApi.qualify(e.id), 'Qualified.')}
                >
                  Qualify
                </button>
              ) : null}
              {e.status === 'New' || e.status === 'Qualified' ? (
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => void openQuotation(e)}
                >
                  Create Quotation
                </button>
              ) : null}
              {!e.project_id && e.status !== 'Lost' && e.status !== 'Won' ? (
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => void makeProject(e)}
                >
                  Create Project
                </button>
              ) : null}
              {e.status === 'Quoted' ? (
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => void run(() => spineApi.won(e.id), 'Marked Won.')}
                >
                  Won
                </button>
              ) : null}
              {['New', 'Qualified', 'Quoted'].includes(e.status) ? (
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => {
                    setLost(e);
                    setReason('');
                  }}
                >
                  Lost
                </button>
              ) : null}
            </>
          );
        }}
        fallback={
          <div className="table-wrap">
            <table className="register-table">
              <thead>
                <tr>
                  <th>Number</th>
                  <th>Date</th>
                  <th>Customer / prospect</th>
                  <th>Product</th>
                  <th>Qty</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {(list.data ?? []).map((e) => (
                  <tr key={e.id}>
                    <td>{e.number}</td>
                    <td>{e.enq_date?.slice(0, 10)}</td>
                    <td>{e.customer_name ?? e.prospect_name}</td>
                    <td>
                      {e.product}
                      {e.project_template ? (
                        <span className="muted"> · {e.project_template}</span>
                      ) : null}
                    </td>
                    <td>{e.qty ?? '—'}</td>
                    <td>
                      <span
                        className={`rag ${e.status === 'Won' ? 'rag-green' : e.status === 'Lost' ? 'rag-red' : ''}`}
                      >
                        {e.status}
                      </span>
                      {e.lost_reason ? <div className="muted">{e.lost_reason}</div> : null}
                    </td>
                    <td className="row-actions">
                      {e.status === 'New' ? (
                        <button
                          type="button"
                          className="btn"
                          onClick={() => void run(() => spineApi.qualify(e.id), 'Qualified.')}
                        >
                          Qualify
                        </button>
                      ) : null}
                      {e.status === 'New' || e.status === 'Qualified' ? (
                        <button
                          type="button"
                          className="btn primary"
                          onClick={() => {
                            setQuoting(e);
                            setGst('18');
                            setGstError('');
                            setCustPick(null);
                            setCustError('');
                          }}
                        >
                          Create Quotation
                        </button>
                      ) : null}
                      {!e.project_id && e.status !== 'Lost' && e.status !== 'Won' ? (
                        <button
                          type="button"
                          className="btn"
                          onClick={() => void makeProject(e)}
                        >
                          Create Project
                        </button>
                      ) : null}
                      {e.status === 'Quoted' ? (
                        <button
                          type="button"
                          className="btn"
                          onClick={() => void run(() => spineApi.won(e.id), 'Marked Won.')}
                        >
                          Won
                        </button>
                      ) : null}
                      {['New', 'Qualified', 'Quoted'].includes(e.status) ? (
                        <button
                          type="button"
                          className="btn"
                          onClick={() => {
                            setLost(e);
                            setReason('');
                          }}
                        >
                          Lost
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
                {!list.loading && (list.data ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={7}>No enquiries yet. Press Add.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        }
      />
      {openId ? (
        <EnquiryDialog
          id={openId}
          canEdit={actions?.edit ?? true}
          onClose={() => setOpenId(null)}
          onChanged={list.reload}
        />
      ) : null}
      {adding ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Add enquiry">
          <div className="modal">
            <h2>New enquiry</h2>
            <label>
              Customer or prospect name
              <input
                value={form.prospectName}
                onChange={(e) => setForm({ ...form, prospectName: e.target.value })}
              />
            </label>
            <label>
              Product
              <input
                value={form.product}
                onChange={(e) => setForm({ ...form, product: e.target.value })}
              />
            </label>
            <label>
              Quantity
              <input
                inputMode="decimal"
                value={form.qty}
                onChange={(e) => setForm({ ...form, qty: e.target.value })}
              />
            </label>
            <label>
              New product template
              <select
                value={form.projectTemplate}
                onChange={(e) => setForm({ ...form, projectTemplate: e.target.value })}
              >
                <option value="">None (ordinary enquiry)</option>
                <option value="BLDC">BLDC motor</option>
                <option value="SPPM">SPPM machine</option>
                <option value="CUSTOM">Custom</option>
              </select>
            </label>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setAdding(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={() =>
                  void run(
                    () =>
                      spineApi
                        .addEnquiry({
                          prospectName: form.prospectName || null,
                          product: form.product,
                          qty: form.qty ? Number(form.qty) : null,
                          projectTemplate: form.projectTemplate || null,
                        })
                        .then(() => setAdding(false)),
                    'Enquiry saved.',
                  )
                }
              >
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {quoting ? (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Create quotation"
        >
          <div className="modal">
            <h2>Quotation for {quoting.number}</h2>
            <p className="muted">
              {quoting.product} has no HSN code, so its GST rate cannot be looked up. Enter the GST
              % to charge.
            </p>
            <label>
              GST % (0 to 28)
              <input
                inputMode="decimal"
                value={gst}
                onChange={(e) => {
                  setGst(e.target.value);
                  setGstError('');
                }}
                aria-invalid={gstError ? true : undefined}
              />
            </label>
            {gstError ? (
              <p role="alert" className="msg error show static">
                {gstError}
              </p>
            ) : null}
            {!quoting.customer_id ? (
              <CustomerField
                prospect={quoting.prospect_name}
                value={custPick}
                error={custError}
                onPick={(o) => {
                  setCustPick(o);
                  setCustError('');
                }}
              />
            ) : null}
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setQuoting(null)}>
                Cancel
              </button>
              <button type="button" className="btn primary" onClick={() => void makeQuotation()}>
                Create Quotation
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {projFor ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Create project">
          <div className="modal">
            <h2>Project for {projFor.number}</h2>
            <p className="muted">A project needs a customer. Pick the customer for this enquiry.</p>
            <CustomerField
              prospect={projFor.prospect_name}
              value={custPick}
              error={custError}
              onPick={(o) => {
                setCustPick(o);
                setCustError('');
              }}
            />
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setProjFor(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={!custPick}
                onClick={() => custPick && void makeProject(projFor, custPick.value)}
              >
                Create Project
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {lost ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Lost reason">
          <div className="modal">
            <h2>Why was {lost.number} lost?</h2>
            <label>
              Lost reason
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} />
            </label>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setLost(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={() =>
                  void run(
                    () => spineApi.markLost(lost.id, reason).then(() => setLost(null)),
                    'Marked Lost.',
                  )
                }
              >
                Mark Lost
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- 360
// ---------------------------------------------------------------------------------------------- exceptions
export { ProcessExceptionsPage } from './ProcessExceptionsPage';

// ---------------------------------------------------------------------------------------------- stage gates
const GATE_COLOUR: Record<Gate['state'], string> = {
  LOCKED: '',
  OPEN: 'rag-amber',
  IN_WORK: 'rag-amber',
  SUBMITTED: 'rag-amber',
  APPROVED: 'rag-green',
  REJECTED: 'rag-red',
};

export function StageGatesPage({
  section = 'gates',
}: {
  section?: 'gates' | 'specs' | 'tests' | 'docs';
}) {
  const toast = useToast();
  const [project, setProject] = useState<ProjectOption | null>(null);
  const pid = project?.id ?? '';
  const gates = useLoad<Gate[]>(() => (pid ? spineApi.gates(pid) : Promise.resolve([])), [pid]);
  const specs = useLoad(() => (pid ? spineApi.specs(pid) : Promise.resolve([])), [pid]);
  const tests = useLoad(() => (pid ? spineApi.tests(pid) : Promise.resolve([])), [pid]);
  const docs = useLoad(() => (pid ? spineApi.docs(pid) : Promise.resolve([])), [pid]);
  const [tab, setTab] = useState(section);
  const [f, setF] = useState({
    parameter: '',
    target: '',
    tol: '',
    unit: '',
    testName: '',
    value: '',
    specId: '',
    gateId: '',
    docType: 'URS',
    title: '',
  });
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
        <div>
          <h1>Project Stage Gates</h1>
          <p className="muted">
            A gate can be submitted only when its deliverable is approved, its tests passed and the
            earlier gates are approved. Nothing moves by itself.
          </p>
        </div>
        {project ? (
          <button
            type="button"
            className="btn"
            onClick={() =>
              void spineApi.dossier(project.id).then(
                (x) => saveBlob(x, 'dossier.pdf'),
                (e: unknown) => toast(errText(e)),
              )
            }
          >
            Download dossier PDF
          </button>
        ) : null}
      </div>
      <div className="inline-form">
        <ProjectPicker value={project} onPick={setProject} />
      </div>
      <div role="tablist" className="tabs-row">
        {(
          [
            ['gates', 'Gates'],
            ['specs', 'Specifications'],
            ['tests', 'Test records'],
            ['docs', 'Documents'],
          ] as const
        ).map(([k, l]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            className={`btn${tab === k ? ' primary' : ''}`}
            onClick={() => setTab(k)}
          >
            {l}
          </button>
        ))}
      </div>
      {!project ? (
        <p className="muted">
          Choose a project. Projects start from Sales Enquiries ➜ Create Project, or here with a
          template.
        </p>
      ) : null}
      {project && tab === 'gates' ? (
        <>
          {(gates.data ?? []).length === 0 ? (
            <div className="panel">
              <p>This project has no gates yet.</p>
              {['BLDC', 'SPPM', 'CUSTOM'].map((t) => (
                <button
                  key={t}
                  type="button"
                  className="btn"
                  onClick={() =>
                    void run(() => spineApi.applyTemplate(pid, t), `${t} gates created.`, [
                      gates.reload,
                    ])
                  }
                >
                  Use {t} template
                </button>
              ))}
            </div>
          ) : null}
          <div className="gate-rail">
            {(gates.data ?? []).map((g) => (
              <article key={g.id} className="panel gate-card" aria-label={`Gate ${g.code}`}>
                <h3>
                  {g.state === 'LOCKED' ? '🔒 ' : ''}
                  {g.code}
                </h3>
                <p>
                  <strong>{g.name}</strong>
                </p>
                <p>
                  <span className={`rag ${GATE_COLOUR[g.state]}`}>{g.state.replace('_', ' ')}</span>{' '}
                  · {g.owner_department ?? '—'}
                </p>
                <p className="muted">
                  Deliverable: {g.deliverable_name ?? '—'}
                  {g.deliverable_doc_type ? ` (${g.deliverable_doc_type})` : ''}
                </p>
                <div className="progress" aria-label={`Readiness ${g.readinessPct} percent`}>
                  <div className="progress-bar" style={{ width: `${g.readinessPct}%` }} />
                </div>
                <p className="muted">
                  Ready {g.readinessPct} %
                  {g.missing.length > 0 && g.state !== 'APPROVED'
                    ? ` · needs ${g.missing.join(', ')}`
                    : ''}
                </p>
                {g.reject_comment ? <p role="alert">Rejected: {g.reject_comment}</p> : null}
                <label>
                  Due
                  <DateField
                    value={g.due_date?.slice(0, 10) ?? ''}
                    onChange={(e) =>
                      void run(
                        () => spineApi.setDue(pid, g.id, e.target.value || null),
                        'Due date saved.',
                        [gates.reload],
                      )
                    }
                  />
                </label>
                <div className="row-actions">
                  {g.state === 'OPEN' ? (
                    <button
                      type="button"
                      className="btn"
                      onClick={() =>
                        void run(() => spineApi.startGate(pid, g.id), 'Gate started.', [
                          gates.reload,
                        ])
                      }
                    >
                      Start
                    </button>
                  ) : null}
                  {g.state === 'OPEN' || g.state === 'IN_WORK' ? (
                    <button
                      type="button"
                      className="btn primary"
                      onClick={() =>
                        void run(() => spineApi.submitGate(pid, g.id), 'Submitted.', reloadAll())
                      }
                    >
                      Submit
                    </button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        </>
      ) : null}
      {project && tab === 'specs' ? (
        <>
          <div className="inline-form">
            <label>
              Parameter
              <input value={f.parameter} onChange={(e) => set('parameter', e.target.value)} />
            </label>
            <label>
              Target
              <input
                inputMode="decimal"
                value={f.target}
                onChange={(e) => set('target', e.target.value)}
              />
            </label>
            <label>
              Tolerance ±
              <input
                inputMode="decimal"
                value={f.tol}
                onChange={(e) => set('tol', e.target.value)}
              />
            </label>
            <label>
              Unit
              <input value={f.unit} onChange={(e) => set('unit', e.target.value)} />
            </label>
            <button
              type="button"
              className="btn primary"
              onClick={() =>
                void run(
                  () =>
                    spineApi.addSpec(pid, {
                      parameter: f.parameter,
                      target: f.target ? Number(f.target) : null,
                      tolMinus: f.tol ? Number(f.tol) : null,
                      tolPlus: f.tol ? Number(f.tol) : null,
                      unit: f.unit || null,
                    }),
                  'Specification added.',
                  [specs.reload],
                )
              }
            >
              Add
            </button>
          </div>
          <table className="register-table">
            <thead>
              <tr>
                <th>No</th>
                <th>Parameter</th>
                <th>Target</th>
                <th>− / +</th>
                <th>Unit</th>
                <th>Rev</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(specs.data ?? []).map((s) => (
                <tr key={s.id}>
                  <td>{s.spec_no}</td>
                  <td>{s.parameter}</td>
                  <td>{s.target ?? '—'}</td>
                  <td>
                    {s.tol_minus ?? '—'} / {s.tol_plus ?? '—'}
                  </td>
                  <td>{s.unit ?? ''}</td>
                  <td>{s.revision}</td>
                  <td>{s.status}</td>
                  <td>
                    {s.status === 'Draft' ? (
                      <button
                        type="button"
                        className="btn"
                        onClick={() =>
                          void run(() => spineApi.approveSpec(pid, s.id), 'Approved.', [
                            specs.reload,
                          ])
                        }
                      >
                        Approve
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
      {project && tab === 'tests' ? (
        <>
          <div className="inline-form">
            <label>
              Test
              <input value={f.testName} onChange={(e) => set('testName', e.target.value)} />
            </label>
            <label>
              Gate
              <select value={f.gateId} onChange={(e) => set('gateId', e.target.value)}>
                <option value="">None</option>
                {(gates.data ?? []).map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.code}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Specification
              <select value={f.specId} onChange={(e) => set('specId', e.target.value)}>
                <option value="">None</option>
                {(specs.data ?? [])
                  .filter((s) => s.status !== 'Superseded')
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.spec_no} {s.parameter}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Value
              <input
                inputMode="decimal"
                value={f.value}
                onChange={(e) => set('value', e.target.value)}
              />
            </label>
            <button
              type="button"
              className="btn primary"
              onClick={() =>
                void run(
                  () =>
                    spineApi.addTest(pid, {
                      testName: f.testName,
                      gateId: f.gateId || null,
                      specId: f.specId || null,
                      value: f.value ? Number(f.value) : null,
                    }),
                  'Test saved.',
                  reloadAll(),
                )
              }
            >
              Add
            </button>
          </div>
          <table className="register-table">
            <thead>
              <tr>
                <th>Test</th>
                <th>Gate</th>
                <th>Spec</th>
                <th>Value</th>
                <th>Result</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {(tests.data ?? []).map((t) => (
                <tr key={t.id}>
                  <td>{t.test_name}</td>
                  <td>{t.gate_code ?? '—'}</td>
                  <td>{t.spec_no ?? '—'}</td>
                  <td>{t.value ?? '—'}</td>
                  <td>
                    <span
                      className={`rag ${t.result === 'OK' ? 'rag-green' : t.result === 'NG' ? 'rag-red' : ''}`}
                    >
                      {t.result ?? 'Pending'}
                    </span>
                  </td>
                  <td>{when(t.tested_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
      {project && tab === 'docs' ? (
        <>
          <div className="inline-form">
            <label>
              Type
              <select value={f.docType} onChange={(e) => set('docType', e.target.value)}>
                {[
                  'URS',
                  'CHARTER',
                  'SPEC',
                  'DRR',
                  'BOM',
                  'PO',
                  'IQC',
                  'JC',
                  'TR',
                  'FAT',
                  'DC',
                  'SAT',
                  'INV',
                  'CLOSE',
                ].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
            <label>
              Title
              <input value={f.title} onChange={(e) => set('title', e.target.value)} />
            </label>
            <label>
              Gate
              <select value={f.gateId} onChange={(e) => set('gateId', e.target.value)}>
                <option value="">None</option>
                {(gates.data ?? []).map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.code}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="btn primary"
              onClick={() =>
                void run(
                  () =>
                    spineApi.addDoc(pid, {
                      docType: f.docType,
                      title: f.title,
                      gateId: f.gateId || null,
                    }),
                  'Document added.',
                  [docs.reload],
                )
              }
            >
              Add
            </button>
          </div>
          <table className="register-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Title</th>
                <th>Gate</th>
                <th>Rev</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(docs.data ?? []).map((d) => (
                <tr key={d.id}>
                  <td>{d.doc_type}</td>
                  <td>{d.title}</td>
                  <td>{d.gate_code ?? '—'}</td>
                  <td>{d.revision}</td>
                  <td>{d.status}</td>
                  <td>
                    {d.status === 'Draft' ? (
                      <button
                        type="button"
                        className="btn"
                        onClick={() =>
                          void run(() => spineApi.approveDoc(pid, d.id), 'Approved.', reloadAll())
                        }
                      >
                        Approve
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
      <p className="muted">
        <Link to="/m/project-global-history">See the project history</Link>
      </p>
    </div>
  );
}
