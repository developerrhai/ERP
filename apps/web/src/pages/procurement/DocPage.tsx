// One screen for the header + lines purchasing documents: Purchase Requisition, RFQ, Vendor Quotation, Purchase Order,
// Rate Contract and Debit Note. A document goes Draft -> Submit -> Approved (-> Post / Cancel where it posts).
// The list, the "New" form (header fields + line grid) and the detail dialog are driven by a small config per page.
import { useState } from 'react';
import { Modal } from '../../components/Modal';
import { Pager } from '../../components/Pager';
import { useToast } from '../../components/Toast';
import { toUiError } from '../../lib/errors';
import { lookupItems, lookupWarehouses, type Ref } from '../../lib/inventoryApi';
import {
  createDoc,
  deleteDoc,
  getDoc,
  listDocs,
  lookupCustomers,
  lookupSuppliers,
  updateDoc,
  verb,
  type Doc,
  type Option,
  type Row,
} from '../../lib/scmApi';
import { useLoad } from '../../lib/useLoad';
import type { ActionSet } from '../../types';
import { dmy, Empty, ErrorBox, inr, PageHead, Pill, todayIso } from '../finance/shared';

type FieldType =
  | 'text'
  | 'number'
  | 'date'
  | 'supplier'
  | 'item'
  | 'warehouse'
  | 'select'
  | 'check'
  | 'ref'
  | 'customer';
export interface FieldCfg {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: [string, string][];
  /** type 'ref': the list endpoint of the document to pick */
  refPath?: string;
  /** line only: pre-filled value */
  def?: string;
}
/** Extra input for an action: asked in a small dialog first; `body` is always sent. */
export interface MoreExtra {
  ask?: { key: string; label: string; type: 'text' | 'number' }[];
  body?: Record<string, unknown>;
}
export interface DocCfg {
  title: string;
  sub: string;
  path: string;
  add: string;
  columns: { key: string; label: string; fmt?: 'inr' | 'date' | 'pill' | 'num' }[];
  header: FieldCfg[];
  lines?: FieldCfg[];
  post?: boolean;
  cancel?: boolean;
  /** show "Invite suppliers" on the detail dialog (RFQ) */
  invite?: boolean;
  /** show the "Delivery tracking" button (Purchase Orders, client requirement 1) */
  delivery?: boolean;
  /** extra verbs on the detail dialog: [verb, label, status the document must be in, needs a reason] */
  more?: [string, string, string, boolean, MoreExtra?][];
}

const s = (v: unknown): string =>
  v === null || v === undefined
    ? ''
    : typeof v === 'object'
      ? JSON.stringify(v)
      : String(v as string | number | boolean);

function show(v: unknown, fmt?: string): string {
  if (fmt === 'inr') return inr(s(v));
  if (fmt === 'date') return dmy(s(v));
  return s(v) || '—';
}

export function DocPage({ cfg, actions }: { cfg: DocCfg; actions: ActionSet }) {
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Doc | 'new' | null>(null);
  const [viewing, setViewing] = useState<Doc | null>(null);
  const [error, setError] = useState('');
  const [tracking, setTracking] = useState(false);
  const list = useLoad(
    () => listDocs(cfg.path, { page, size: 20, status, q }),
    [cfg.path, page, status, q],
  );

  async function open(row: Doc) {
    try {
      setViewing(await getDoc(cfg.path, row.id));
    } catch (e) {
      setError(toUiError(e).message);
    }
  }
  const rows = list.data?.rows ?? [];
  return (
    <>
      <PageHead title={cfg.title} sub={cfg.sub}>
        {cfg.delivery ? (
          <button type="button" className="btn" onClick={() => setTracking(true)}>
            Delivery tracking
          </button>
        ) : null}
        {actions.add ? (
          <button type="button" className="btn primary" onClick={() => setEditing('new')}>
            {cfg.add}
          </button>
        ) : null}
      </PageHead>
      <ErrorBox message={error || list.error} />
      <div className="toolbar">
        <input
          aria-label="Search by number"
          placeholder="Search by number"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
        <select
          aria-label="Status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All statuses</option>
          {['Draft', 'Pending Approval', 'Approved', 'Rejected', 'Posted', 'Cancelled'].map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
      </div>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Number</th>
              {cfg.columns.map((c) => (
                <th key={c.key}>{c.label}</th>
              ))}
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !list.loading ? (
              <Empty cols={cfg.columns.length + 2}>
                Nothing here yet. {actions.add ? `Click ${cfg.add}.` : ''}
              </Empty>
            ) : null}
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <button type="button" className="link" onClick={() => void open(r)}>
                    {s(r.number)}
                  </button>
                </td>
                {cfg.columns.map((c) => (
                  <td key={c.key}>{show(r[c.key], c.fmt)}</td>
                ))}
                <td>
                  <Pill>{r.status}</Pill>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager page={page} size={20} total={list.data?.meta.total ?? 0} onPage={setPage} />
      {tracking ? <DeliveryTracking onClose={() => setTracking(false)} /> : null}
      {editing ? (
        <DocForm
          cfg={cfg}
          doc={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(d) => {
            setEditing(null);
            toast(`Saved ${s(d.number)}`);
            list.reload();
          }}
        />
      ) : null}
      {viewing ? (
        <DocDetail
          cfg={cfg}
          doc={viewing}
          actions={actions}
          onClose={() => setViewing(null)}
          onEdit={() => {
            setEditing(viewing);
            setViewing(null);
          }}
          onChanged={(d, msg) => {
            setViewing(d);
            toast(msg);
            list.reload();
          }}
          onDeleted={() => {
            setViewing(null);
            list.reload();
          }}
        />
      ) : null}
    </>
  );
}

// ------------------------------------------------------------------------------------------------ form
function Input({
  f,
  value,
  onChange,
  error,
}: {
  f: FieldCfg;
  value: string;
  onChange: (v: string, extra?: Record<string, string>) => void;
  error?: string | undefined;
}) {
  const suppliers = useLoad<Option[]>(
    () => (f.type === 'supplier' ? lookupSuppliers() : Promise.resolve([])),
    [f.type],
  );
  const customers = useLoad<Option[]>(
    () => (f.type === 'customer' ? lookupCustomers() : Promise.resolve([])),
    [f.type],
  );
  const warehouses = useLoad<Ref[]>(
    () => (f.type === 'warehouse' ? lookupWarehouses() : Promise.resolve([])),
    [f.type],
  );
  const refs = useLoad<Option[]>(
    () =>
      f.type === 'ref' && f.refPath
        ? listDocs(f.refPath, { size: 100 }).then((r) =>
            r.rows.map((d) => ({ id: d.id, label: `${s(d.number)} · ${d.status}` })),
          )
        : Promise.resolve([]),
    [f.type, f.refPath],
  );
  const items = useLoad<Ref[]>(
    () => (f.type === 'item' ? lookupItems('') : Promise.resolve([])),
    [f.type],
  );
  const common = { 'aria-invalid': error ? true : undefined, id: `f-${f.key}` };
  let control;
  if (f.type === 'supplier')
    control = (
      <select {...common} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose a supplier…</option>
        {(suppliers.data ?? []).map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    );
  else if (f.type === 'customer')
    control = (
      <select {...common} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose a customer…</option>
        {(customers.data ?? []).map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    );
  else if (f.type === 'warehouse')
    control = (
      <select {...common} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose a warehouse…</option>
        {(warehouses.data ?? []).map((o) => (
          <option key={o.id} value={o.id}>
            {o.code} · {o.name}
          </option>
        ))}
      </select>
    );
  else if (f.type === 'item')
    control = (
      <select
        {...common}
        value={value}
        onChange={(e) => {
          const it = (items.data ?? []).find((x) => x.id === e.target.value);
          onChange(e.target.value, it ? { uom: it.uom ?? '' } : {});
        }}
      >
        <option value="">Choose an item…</option>
        {(items.data ?? []).map((o) => (
          <option key={o.id} value={o.id}>
            {o.code} · {o.name}
          </option>
        ))}
      </select>
    );
  else if (f.type === 'ref')
    control = (
      <select {...common} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose…</option>
        {(refs.data ?? []).map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    );
  else if (f.type === 'select')
    control = (
      <select {...common} value={value} onChange={(e) => onChange(e.target.value)}>
        {(f.options ?? []).map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    );
  else if (f.type === 'check')
    control = (
      <input
        {...common}
        type="checkbox"
        checked={value === 'true'}
        onChange={(e) => onChange(e.target.checked ? 'true' : 'false')}
      />
    );
  else
    control = (
      <input
        {...common}
        type={f.type === 'date' ? 'date' : f.type === 'number' ? 'number' : 'text'}
        step={f.type === 'number' ? 'any' : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  return (
    <div className="field">
      <label htmlFor={`f-${f.key}`}>
        {f.label}
        {f.required ? ' *' : ''}
      </label>
      {control}
      {error ? <span className="field-error">{error}</span> : null}
    </div>
  );
}

const INT_KEYS = ['leadDays', 'rating', 'probability', 'durationMin', 'score'];

function toBody(fields: FieldCfg[], vals: Record<string, string>): Row {
  const out: Row = {};
  for (const f of fields) {
    const v = vals[f.key] ?? '';
    if (f.type === 'check') {
      out[f.key] = v === 'true';
      continue;
    }
    if (v === '') continue;
    out[f.key] = f.type === 'number' && INT_KEYS.includes(f.key) ? Number(v) : v;
  }
  return out;
}

function DocForm({
  cfg,
  doc,
  onClose,
  onSaved,
}: {
  cfg: DocCfg;
  doc: Doc | null;
  onClose: () => void;
  onSaved: (d: Doc) => void;
}) {
  const initial = (fields: FieldCfg[], src: Row | null): Record<string, string> => {
    const o: Record<string, string> = {};
    for (const f of fields)
      o[f.key] = src
        ? s(src[f.key])
        : f.type === 'date' && f.key.toLowerCase().includes('date') && !f.def
          ? ''
          : (f.def ?? '');
    return o;
  };
  const [head, setHead] = useState(() => {
    const o = initial(cfg.header, doc);
    return doc
      ? o
      : {
          ...o,
          ...(cfg.header.some((h) => h.key === 'invoiceDate') ? { invoiceDate: todayIso() } : {}),
        };
  });
  const [lines, setLines] = useState<Record<string, string>[]>(() =>
    cfg.lines
      ? doc && Array.isArray(doc.lines) && doc.lines.length
        ? (doc.lines as Row[]).map((l) => ({ ...initial(cfg.lines ?? [], l), id: s(l.id) }))
        : [initial(cfg.lines, null)]
      : [],
  );
  const [fields, setFields] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setMsg('');
    setFields({});
    try {
      const body: Row = { ...toBody(cfg.header, head) };
      if (cfg.lines) {
        body.lines = lines.map((l) => ({
          ...toBody(cfg.lines ?? [], l),
          ...(l.id ? { id: l.id } : {}),
        }));
      }
      const saved = doc
        ? await updateDoc(cfg.path, doc.id, doc.version, body)
        : await createDoc(cfg.path, body);
      onSaved(saved);
    } catch (e) {
      const u = toUiError(e);
      setMsg(u.message);
      setFields(u.fields);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={doc ? `Edit ${s(doc.number)}` : cfg.add.replace('＋ ', '')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" disabled={busy} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save draft'}
          </button>
        </>
      }
    >
      <ErrorBox message={msg} />
      <div className="form-grid">
        {cfg.header.map((f) => (
          <Input
            key={f.key}
            f={f}
            value={head[f.key] ?? ''}
            error={fields[f.key]}
            onChange={(v) => setHead((h) => ({ ...h, [f.key]: v }))}
          />
        ))}
      </div>
      {cfg.lines ? (
        <>
          <h3>Lines</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {cfg.lines.map((f) => (
                    <th key={f.key}>{f.label}</th>
                  ))}
                  <th />
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={l.id || i}>
                    {cfg.lines?.map((f) => (
                      <td key={f.key}>
                        <Input
                          f={{ ...f, label: f.label }}
                          value={l[f.key] ?? ''}
                          error={fields[`lines.${i}.${f.key}`]}
                          onChange={(v, extra) =>
                            setLines((ls) =>
                              ls.map((x, j) =>
                                j === i ? { ...x, [f.key]: v, ...(extra ?? {}) } : x,
                              ),
                            )
                          }
                        />
                      </td>
                    ))}
                    <td>
                      <button
                        type="button"
                        className="btn sm danger"
                        disabled={lines.length === 1}
                        onClick={() => setLines((ls) => ls.filter((_x, j) => j !== i))}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            type="button"
            className="btn sm"
            onClick={() => setLines((ls) => [...ls, initial(cfg.lines ?? [], null)])}
          >
            ＋ Add line
          </button>
        </>
      ) : null}
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ detail
function DocDetail({
  cfg,
  doc,
  actions,
  onClose,
  onEdit,
  onChanged,
  onDeleted,
}: {
  cfg: DocCfg;
  doc: Doc;
  actions: ActionSet;
  onClose: () => void;
  onEdit: () => void;
  onChanged: (d: Doc, msg: string) => void;
  onDeleted: () => void;
}) {
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [asking, setAsking] = useState<{ name: string; label: string; extra: MoreExtra } | null>(
    null,
  );
  const lines = (Array.isArray(doc.lines) ? doc.lines : []) as Row[];
  const editable = doc.status === 'Draft' || doc.status === 'Rejected';

  async function run(name: string, label: string, body: unknown = {}, withVersion = false) {
    setBusy(true);
    setMsg('');
    try {
      await verb(cfg.path, doc.id, name, body, withVersion ? doc.version : undefined);
      onChanged(await getDoc(cfg.path, doc.id), `${label}: ${s(doc.number)}`);
    } catch (e) {
      setMsg(toUiError(e).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={`${cfg.title} ${s(doc.number)}`}
      sub={s(doc.supplierName) || s(doc.customerName)}
      onClose={onClose}
      footer={
        <>
          {editable && actions.edit ? (
            <button type="button" className="btn" onClick={onEdit}>
              Edit
            </button>
          ) : null}
          {editable && actions.delete && doc.status === 'Draft' ? (
            <button
              type="button"
              className="btn danger"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                deleteDoc(cfg.path, doc.id, doc.version)
                  .then(onDeleted)
                  .catch((e: unknown) => setMsg(toUiError(e).message))
                  .finally(() => setBusy(false));
              }}
            >
              Delete
            </button>
          ) : null}
          {editable && actions.submit ? (
            <button
              type="button"
              className="btn primary"
              disabled={busy}
              onClick={() => void run('submit', 'Submitted', {}, true)}
            >
              Submit
            </button>
          ) : null}
          {cfg.post && doc.status === 'Approved' && actions.post ? (
            <button
              type="button"
              className="btn primary"
              disabled={busy}
              onClick={() => void run('post', 'Posted')}
            >
              Post
            </button>
          ) : null}
          {(cfg.more ?? [])
            .filter(([, , st]) => st.split(',').includes(doc.status))
            .map(([name, label, , needsReason, extra]) => (
              <button
                key={`${name}-${label}`}
                type="button"
                className="btn"
                disabled={busy || (needsReason && reason.trim().length < 5)}
                title={
                  needsReason && reason.trim().length < 5
                    ? 'Type a reason of at least 5 letters first'
                    : undefined
                }
                onClick={() =>
                  extra?.ask
                    ? setAsking({ name, label, extra })
                    : void run(name, label, {
                        ...(extra?.body ?? {}),
                        ...(needsReason ? { reason } : {}),
                      })
                }
              >
                {label}
              </button>
            ))}
          {cfg.cancel && doc.status === 'Posted' && actions.cancel ? (
            <button
              type="button"
              className="btn danger"
              disabled={busy || reason.trim().length < 5}
              title={
                reason.trim().length < 5 ? 'Type a reason of at least 5 letters first' : undefined
              }
              onClick={() => void run('cancel', 'Cancelled', { reason })}
            >
              Cancel document
            </button>
          ) : null}
        </>
      }
    >
      <ErrorBox message={msg} />
      <p>
        <Pill>{doc.status}</Pill>
      </p>
      <dl className="kv">
        {cfg.columns.map((c) => (
          <div key={c.key}>
            <dt>{c.label}</dt>
            <dd>{show(doc[c.key], c.fmt)}</dd>
          </div>
        ))}
      </dl>
      {lines.length > 0 && cfg.lines ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                {cfg.lines.map((f) => (
                  <th key={f.key}>{f.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={s(l.id)}>
                  <td>{s(l.lineNo)}</td>
                  {cfg.lines?.map((f) => <td key={f.key}>{s(l[f.key]) || '—'}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {cfg.invite ? <InviteBox cfg={cfg} doc={doc} onChanged={onChanged} /> : null}
      {asking ? (
        <AskDialog
          title={asking.label}
          fields={asking.extra.ask ?? []}
          onClose={() => setAsking(null)}
          onOk={(vals) => {
            const a = asking;
            setAsking(null);
            void run(a.name, a.label, { ...(a.extra.body ?? {}), ...vals });
          }}
        />
      ) : null}
      {(cfg.more?.some(([, , , r]) => r) || cfg.cancel) && doc.status !== 'Draft' ? (
        <div className="field">
          <label htmlFor="reason">Reason (for cancel / amend)</label>
          <input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
      ) : null}
    </Modal>
  );
}

function InviteBox({
  cfg,
  doc,
  onChanged,
}: {
  cfg: DocCfg;
  doc: Doc;
  onChanged: (d: Doc, msg: string) => void;
}) {
  const sup = useLoad<Option[]>(() => lookupSuppliers(), []);
  const [pick, setPick] = useState('');
  const [msg, setMsg] = useState('');
  return (
    <div className="field">
      <label htmlFor="invite">Invite a supplier</label>
      <ErrorBox message={msg} />
      <select id="invite" value={pick} onChange={(e) => setPick(e.target.value)}>
        <option value="">Choose a supplier…</option>
        {(sup.data ?? []).map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="btn sm"
        disabled={!pick}
        onClick={() => {
          setMsg('');
          verb(cfg.path, doc.id, 'invite', { supplierIds: [pick] })
            .then(async () => onChanged(await getDoc(cfg.path, doc.id), 'Supplier invited'))
            .catch((e: unknown) => setMsg(toUiError(e).message));
        }}
      >
        Invite
      </button>
    </div>
  );
}

const DELIVERY_LABEL: Record<string, string> = {
  OPEN: 'Open',
  PARTLY_RECEIVED: 'Partly received',
  CLOSED: 'Closed',
  DELAYED: 'Delayed',
};
function DeliveryTracking({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState('');
  const rows = useLoad(() => listDocs<Row>('/scm/po-delivery', { size: 200, status }), [status]);
  return (
    <Modal
      title="Delivery tracking"
      sub="Every open purchase order line: expected date, quantity received and what is still due."
      onClose={onClose}
      footer={
        <button type="button" className="btn" onClick={onClose}>
          Close
        </button>
      }
    >
      <ErrorBox message={rows.error} />
      <div className="toolbar">
        <select
          aria-label="Delivery status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">All</option>
          {Object.entries(DELIVERY_LABEL).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>PO</th>
              <th>Supplier</th>
              <th>Item</th>
              <th>Part no.</th>
              <th>PO date</th>
              <th>Lead days</th>
              <th>Expected</th>
              <th>PO qty</th>
              <th>Received</th>
              <th>Balance</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {(rows.data?.rows ?? []).length === 0 && !rows.loading ? (
              <Empty cols={11}>No open purchase order lines.</Empty>
            ) : null}
            {(rows.data?.rows ?? []).map((r) => (
              <tr key={s(r.id)} className={r.status === 'DELAYED' ? 'row-red' : undefined}>
                <td>{s(r.poNo)}</td>
                <td>{s(r.supplierName)}</td>
                <td>{s(r.itemCode)}</td>
                <td>{s(r.partNo) || '—'}</td>
                <td>{dmy(s(r.poDate))}</td>
                <td>{s(r.leadDays) || '—'}</td>
                <td>{dmy(s(r.expectedDate))}</td>
                <td>{s(r.poQty)}</td>
                <td>{s(r.receivedQty)}</td>
                <td>{s(r.balanceQty)}</td>
                <td>
                  <Pill>{DELIVERY_LABEL[s(r.status)] ?? s(r.status)}</Pill>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

function AskDialog({
  title,
  fields,
  onClose,
  onOk,
}: {
  title: string;
  fields: { key: string; label: string; type: 'text' | 'number' }[];
  onClose: () => void;
  onOk: (vals: Record<string, string>) => void;
}) {
  const [vals, setVals] = useState<Record<string, string>>({});
  const ready = fields.every((f) => (vals[f.key] ?? '').trim().length > 0);
  return (
    <Modal
      title={title}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={!ready}
            onClick={() => onOk(vals)}
          >
            OK
          </button>
        </>
      }
    >
      {fields.map((f) => (
        <div className="field" key={f.key}>
          <label htmlFor={`ask-${f.key}`}>{f.label} *</label>
          <input
            id={`ask-${f.key}`}
            type={f.type === 'number' ? 'number' : 'text'}
            value={vals[f.key] ?? ''}
            onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })}
          />
        </div>
      ))}
    </Modal>
  );
}
