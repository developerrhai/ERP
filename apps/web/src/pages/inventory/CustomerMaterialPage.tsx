// Customer Material: the customer's own material kept in our stores. It has no value and is kept apart from our stock
// and books, so it can never be used by mistake. Three jobs: material arrived (Receipt), material used for the
// customer's job (Issue), material sent back (Return). Written for store staff: big buttons, plain words, the
// quantity left is shown before you type.
import { Fragment, useState, type ReactNode } from 'react';
import { Modal } from '../../components/Modal';
import { Pager } from '../../components/Pager';
import { useToast } from '../../components/Toast';
import { toUiError } from '../../lib/errors';
import {
  cmBalances,
  cmCancel,
  cmCustomers,
  cmDoc,
  cmDocs,
  cmHistory,
  cmLots,
  cmReceive,
  cmTake,
  type CmDoc,
  type CmDocLine,
  type CmLot,
  type CmType,
  type Ref,
} from '../../lib/inventoryApi';
import { useLoad } from '../../lib/useLoad';
import type { ActionSet } from '../../types';
import { Guide, type GuideDef } from './guides';
import {
  dmy,
  Empty,
  ErrorBox,
  ItemPicker,
  PageHead,
  Pill,
  qty,
  todayIso,
  WarehouseSelect,
} from './shared';
import { DateField } from '../../ui/components';

const GUIDE: GuideDef = {
  goal: 'This is the customer’s own material kept in our store. It is NOT our stock and has no rupee value, so it never mixes with our stock or accounts.',
  steps: [
    {
      who: 'Store keeper',
      what: 'Material arrives with the customer’s challan: click "1. Material received from customer" and copy the challan number and quantity.',
    },
    {
      who: 'Store keeper',
      what: 'When production takes it for the customer’s job: click "2. Use material for a job" and write the job or work order number.',
    },
    {
      who: 'Store keeper',
      what: 'To give leftover or rejected material back: click "3. Send material back" and write our return challan number.',
    },
    {
      who: 'Manager',
      what: 'Check "Material we hold" every week, especially the red Expired / Expiring lines. Cancel a wrong entry with a reason.',
    },
  ],
  tip: 'Each receipt makes one "lot" per item. Issue and return pick a lot, so the quantity left is always exact. A wrong entry is cancelled, never edited.',
};

const TYPE_LABEL: Record<CmType, string> = {
  RECEIPT: 'Received',
  ISSUE: 'Used for job',
  RETURN: 'Sent back',
};
const EXPIRY_LABEL: Record<string, string> = {
  expired: 'Expired',
  soon: 'Expires soon',
  ok: 'In date',
  none: '',
};

function ExpiryPill({ state }: { state: string }) {
  return EXPIRY_LABEL[state] ? <Pill tone={state}>{EXPIRY_LABEL[state]}</Pill> : null;
}

export function CustomerMaterialPage({
  actions,
  toolbar,
}: {
  actions: ActionSet;
  toolbar: ReactNode;
}) {
  const toast = useToast();
  const [view, setView] = useState<'hold' | 'docs'>('hold');
  const [form, setForm] = useState<'RECEIPT' | 'ISSUE' | 'RETURN' | null>(null);
  const [tick, setTick] = useState(0);
  const done = (msg: string) => {
    setForm(null);
    setTick((t) => t + 1);
    toast(msg);
  };
  return (
    <>
      <PageHead
        title="Customer Material"
        sub="Material that belongs to a customer and is kept in our stores. Not our stock; no value."
      />
      <Guide title="Customer Material" def={GUIDE} defaultOpen />
      {toolbar}
      {actions.add ? (
        <div className="cm-summary">
          <button type="button" className="cm-big" onClick={() => setForm('RECEIPT')}>
            <strong>1. Material received from customer</strong>
            <span>Customer sent material with a challan</span>
          </button>
          <button type="button" className="cm-big" onClick={() => setForm('ISSUE')}>
            <strong>2. Use material for a job</strong>
            <span>Production takes it for the customer’s job</span>
          </button>
          <button type="button" className="cm-big" onClick={() => setForm('RETURN')}>
            <strong>3. Send material back</strong>
            <span>Return leftover or rejected material</span>
          </button>
        </div>
      ) : null}
      <div className="tabs" role="tablist" aria-label="Customer material views">
        {(['hold', 'docs'] as const).map((v) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={view === v}
            className={`tab${view === v ? ' active' : ''}`}
            onClick={() => setView(v)}
          >
            {v === 'hold' ? 'Material we hold' : 'Receipts, issues & returns'}
          </button>
        ))}
      </div>
      {view === 'hold' ? (
        <HoldView tick={tick} />
      ) : (
        <DocsView tick={tick} actions={actions} onChanged={() => setTick((t) => t + 1)} />
      )}
      {form === 'RECEIPT' ? (
        <ReceiptForm
          onClose={() => setForm(null)}
          onDone={(c) => done(`Received. Document ${c}`)}
        />
      ) : null}
      {form === 'ISSUE' || form === 'RETURN' ? (
        <TakeForm
          type={form}
          onClose={() => setForm(null)}
          onDone={(c) => done(`${form === 'ISSUE' ? 'Used for job' : 'Sent back'}. Document ${c}`)}
        />
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------
function HoldView({ tick }: { tick: number }) {
  const list = useLoad(() => cmBalances(), [tick]);
  const [open, setOpen] = useState<string | null>(null);
  const [history, setHistory] = useState<CmLot | null>(null);
  const rows = list.data ?? [];
  return (
    <>
      <ErrorBox message={list.error} />
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Customer</th>
              <th scope="col">Item</th>
              <th scope="col">Warehouse</th>
              <th scope="col" style={{ textAlign: 'right' }}>
                Quantity we hold
              </th>
              <th scope="col">Earliest expiry</th>
              <th scope="col">Details</th>
            </tr>
          </thead>
          <tbody>
            {!list.loading && rows.length === 0 ? (
              <Empty cols={6}>
                Nothing yet. When a customer sends material, click "1. Material received from
                customer".
              </Empty>
            ) : null}
            {rows.map((r) => {
              const key = `${r.customerId}|${r.itemId}|${r.warehouseCode}`;
              return (
                <Fragment key={key}>
                  <tr>
                    <td>{r.customerName}</td>
                    <td>
                      <strong>{r.itemCode}</strong> · {r.itemName}
                    </td>
                    <td>{r.warehouseCode}</td>
                    <td style={{ textAlign: 'right' }}>{qty(r.balanceQty)}</td>
                    <td>
                      {r.nextExpiry ? dmy(r.nextExpiry) : '—'} <ExpiryPill state={r.expiry} />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn"
                        aria-expanded={open === key}
                        onClick={() => setOpen(open === key ? null : key)}
                      >
                        {open === key ? 'Hide lots' : 'Show lots'}
                      </button>
                    </td>
                  </tr>
                  {open === key ? (
                    <tr>
                      <td colSpan={6}>
                        <LotsOf
                          customerId={r.customerId}
                          itemId={r.itemId}
                          tick={tick}
                          onHistory={setHistory}
                        />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {history ? <HistoryDialog lot={history} onClose={() => setHistory(null)} /> : null}
    </>
  );
}

function LotsOf({
  customerId,
  itemId,
  tick,
  onHistory,
}: {
  customerId: string;
  itemId: string;
  tick: number;
  onHistory: (l: CmLot) => void;
}) {
  const list = useLoad(() => cmLots({ customerId }), [customerId, tick]);
  const rows = (list.data?.rows ?? []).filter((l) => l.itemId === itemId);
  return (
    <table>
      <thead>
        <tr>
          <th scope="col">Customer challan</th>
          <th scope="col">Batch</th>
          <th scope="col">Expiry</th>
          <th scope="col" style={{ textAlign: 'right' }}>
            Received
          </th>
          <th scope="col" style={{ textAlign: 'right' }}>
            Left
          </th>
          <th scope="col">History</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((l) => (
          <tr key={l.id}>
            <td>
              {l.challanNo} <small>({dmy(l.challanDate)})</small>
            </td>
            <td>{l.batchNo ?? '—'}</td>
            <td>
              {l.expiryDate ? dmy(l.expiryDate) : '—'} <ExpiryPill state={l.expiry} />
            </td>
            <td style={{ textAlign: 'right' }}>{qty(l.receivedQty)}</td>
            <td style={{ textAlign: 'right' }}>
              <strong>{qty(l.balanceQty)}</strong>
            </td>
            <td>
              <button type="button" className="btn" onClick={() => onHistory(l)}>
                See movements
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function HistoryDialog({ lot, onClose }: { lot: CmLot; onClose: () => void }) {
  const h = useLoad(() => cmHistory(lot.id), [lot.id]);
  return (
    <Modal
      title={`${lot.itemCode} · challan ${lot.challanNo}`}
      sub="Every movement of this lot, newest first."
      onClose={onClose}
      footer={
        <button type="button" className="btn" onClick={onClose}>
          Close
        </button>
      }
    >
      <ErrorBox message={h.error} />
      <table>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">What happened</th>
            <th scope="col">Document</th>
            <th scope="col" style={{ textAlign: 'right' }}>
              Quantity
            </th>
            <th scope="col" style={{ textAlign: 'right' }}>
              Left after
            </th>
            <th scope="col">By</th>
          </tr>
        </thead>
        <tbody>
          {(h.data ?? []).map((e) => (
            <tr key={e.id}>
              <td>{dmy(e.date)}</td>
              <td>
                {e.type === 'REVERSAL' ? 'Cancelled (reversed)' : TYPE_LABEL[e.type as CmType]}
              </td>
              <td>{e.docCode}</td>
              <td style={{ textAlign: 'right' }}>
                {e.qty > 0 ? '+' : ''}
                {qty(e.qty)}
              </td>
              <td style={{ textAlign: 'right' }}>{qty(e.balanceAfter)}</td>
              <td>{e.by}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}

// ---------------------------------------------------------------------------------------------------------
function DocsView({
  tick,
  actions,
  onChanged,
}: {
  tick: number;
  actions: ActionSet;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [type, setType] = useState('');
  const [q, setQ] = useState('');
  const list = useLoad(
    () => cmDocs({ page, ...(type ? { type } : {}), ...(q ? { q } : {}) }),
    [page, type, q, tick],
  );
  const [viewing, setViewing] = useState<CmDoc | null>(null);
  const [cancelling, setCancelling] = useState<CmDoc | null>(null);
  const open = async (id: string) => {
    try {
      setViewing(await cmDoc(id));
    } catch (e) {
      toast(toUiError(e).message);
    }
  };
  return (
    <>
      <div className="filters">
        <input
          aria-label="Search"
          placeholder="Search document, challan or job number"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
        <select
          aria-label="Kind"
          value={type}
          onChange={(e) => {
            setType(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All kinds</option>
          <option value="RECEIPT">Received</option>
          <option value="ISSUE">Used for job</option>
          <option value="RETURN">Sent back</option>
        </select>
      </div>
      <ErrorBox message={list.error} />
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Number</th>
              <th scope="col">Date</th>
              <th scope="col">What</th>
              <th scope="col">Customer</th>
              <th scope="col">Challan / Job</th>
              <th scope="col" style={{ textAlign: 'right' }}>
                Quantity
              </th>
              <th scope="col">Status</th>
              <th scope="col">Action</th>
            </tr>
          </thead>
          <tbody>
            {!list.loading && (list.data?.rows.length ?? 0) === 0 ? (
              <Empty cols={8}>No documents yet.</Empty>
            ) : null}
            {(list.data?.rows ?? []).map((d) => (
              <tr key={d.id}>
                <td>
                  <button type="button" className="link" onClick={() => void open(d.id)}>
                    <strong>{d.code}</strong>
                  </button>
                </td>
                <td>{dmy(d.date)}</td>
                <td>{TYPE_LABEL[d.type]}</td>
                <td>{d.customerName}</td>
                <td>{d.type === 'ISSUE' ? d.reference : d.challanNo}</td>
                <td style={{ textAlign: 'right' }}>{qty(d.totalQty ?? null)}</td>
                <td>
                  <Pill>{d.status}</Pill>
                </td>
                <td>
                  {actions.edit && d.status === 'Posted' ? (
                    <button type="button" className="btn danger" onClick={() => setCancelling(d)}>
                      Cancel
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager page={page} size={20} total={list.data?.meta.total ?? 0} onPage={setPage} />
      {viewing ? <DocDialog doc={viewing} onClose={() => setViewing(null)} /> : null}
      {cancelling ? (
        <CancelDialog
          doc={cancelling}
          onClose={() => setCancelling(null)}
          onDone={() => {
            setCancelling(null);
            toast('Cancelled. The material is back as it was.');
            onChanged();
          }}
        />
      ) : null}
    </>
  );
}

function DocDialog({ doc, onClose }: { doc: CmDoc; onClose: () => void }) {
  const lines = Array.isArray(doc.lines) ? doc.lines : [];
  return (
    <Modal
      title={`${doc.code} · ${TYPE_LABEL[doc.type]}`}
      sub={`${doc.customerName} · ${dmy(doc.date)} · ${doc.warehouseCode}`}
      onClose={onClose}
      footer={
        <button type="button" className="btn" onClick={onClose}>
          Close
        </button>
      }
    >
      <dl className="kv">
        {doc.challanNo ? (
          <>
            <dt>Challan</dt>
            <dd>
              {doc.challanNo} ({dmy(doc.challanDate)})
            </dd>
          </>
        ) : null}
        {doc.vehicleNo ? (
          <>
            <dt>Vehicle</dt>
            <dd>{doc.vehicleNo}</dd>
          </>
        ) : null}
        {doc.reference ? (
          <>
            <dt>Job / reason</dt>
            <dd>{doc.reference}</dd>
          </>
        ) : null}
        {doc.status === 'Cancelled' ? (
          <>
            <dt>Cancelled</dt>
            <dd>
              {dmy(doc.cancelDate)} · {doc.cancelReason}
            </dd>
          </>
        ) : null}
      </dl>
      <table>
        <thead>
          <tr>
            <th scope="col">Item</th>
            <th scope="col">Batch</th>
            <th scope="col">Expiry</th>
            <th scope="col" style={{ textAlign: 'right' }}>
              Quantity
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l: CmDocLine) => (
            <tr key={l.id}>
              <td>
                {l.itemCode} · {l.itemName}
              </td>
              <td>{l.batchNo ?? '—'}</td>
              <td>{l.expiryDate ? dmy(l.expiryDate) : '—'}</td>
              <td style={{ textAlign: 'right' }}>{qty(l.qty)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}

function CancelDialog({
  doc,
  onClose,
  onDone,
}: {
  doc: CmDoc;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  const [date, setDate] = useState(todayIso());
  const [msg, setMsg] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    setMsg('');
    setFields({});
    try {
      await cmCancel(doc.id, doc.version, reason, date);
      onDone();
    } catch (e) {
      const u = toUiError(e);
      setMsg(u.message);
      setFields(u.fields);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={`Cancel ${doc.code}?`}
      sub="Use this only for a wrong entry. The material goes back as it was; the original entry stays in the history."
      size="sm"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Keep it
          </button>
          <button type="button" className="btn danger" disabled={busy} onClick={() => void go()}>
            Cancel document
          </button>
        </>
      }
    >
      <ErrorBox message={msg} />
      <div className="field">
        <label>
          Cancel date
          <DateField
            value={date}
            max={todayIso()}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        {fields.date ? <span className="field-error">{fields.date}</span> : null}
      </div>
      <div className="field">
        <label>
          Why is it being cancelled? (at least 5 letters)
          <input value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        {fields.reason ? <span className="field-error">{fields.reason}</span> : null}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------------------------------------
function CustomerSelect({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (id: string) => void;
  error?: string | undefined;
}) {
  const { data } = useLoad(() => cmCustomers(), []);
  return (
    <div className="field">
      <label>
        Customer
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={error ? true : undefined}
        >
          <option value="">Choose the customer…</option>
          {(data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.code})
            </option>
          ))}
        </select>
      </label>
      {error ? <span className="field-error">{error}</span> : null}
    </div>
  );
}

interface RLine {
  item: Ref | null;
  qty: string;
  batchNo: string;
  mfgDate: string;
  expiryDate: string;
}
const blankR = (): RLine => ({ item: null, qty: '', batchNo: '', mfgDate: '', expiryDate: '' });

function ReceiptForm({ onClose, onDone }: { onClose: () => void; onDone: (code: string) => void }) {
  const [customerId, setCustomer] = useState('');
  const [warehouseId, setWarehouse] = useState('');
  const [docDate, setDate] = useState(todayIso());
  const [challanNo, setChallanNo] = useState('');
  const [challanDate, setChallanDate] = useState(todayIso());
  const [vehicleNo, setVehicle] = useState('');
  const [lines, setLines] = useState<RLine[]>([blankR()]);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (i: number, p: Partial<RLine>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...p } : l)));
  const save = async () => {
    setBusy(true);
    setMsg('');
    setFields({});
    try {
      const d = await cmReceive({
        customerId,
        warehouseId,
        docDate,
        challanNo,
        challanDate,
        vehicleNo: vehicleNo || null,
        lines: lines
          .filter((l) => l.item)
          .map((l) => ({
            itemId: l.item!.id,
            qty: Number(l.qty),
            batchNo: l.batchNo || null,
            mfgDate: l.mfgDate || null,
            expiryDate: l.expiryDate || null,
          })),
      });
      onDone(d.code);
    } catch (e) {
      const u = toUiError(e);
      setMsg(u.message);
      setFields(u.fields);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Material received from customer"
      sub="Copy these details from the customer’s challan. When you click Save, the material is recorded at once."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          <button type="button" className="btn primary" disabled={busy} onClick={() => void save()}>
            Save received material
          </button>
        </>
      }
    >
      <ErrorBox message={msg} />
      <div className="form-grid">
        <CustomerSelect value={customerId} onChange={setCustomer} error={fields.customerId} />
        <WarehouseSelect
          value={warehouseId}
          onChange={setWarehouse}
          label="Store where it is kept"
          error={fields.warehouseId}
        />
        <div className="field">
          <label>
            Customer challan number
            <input value={challanNo} onChange={(e) => setChallanNo(e.target.value)} />
          </label>
          {fields.challanNo ? <span className="field-error">{fields.challanNo}</span> : null}
        </div>
        <div className="field">
          <label>
            Date on the challan
            <DateField
              value={challanDate}
              max={todayIso()}
              onChange={(e) => setChallanDate(e.target.value)}
            />
          </label>
          {fields.challanDate ? <span className="field-error">{fields.challanDate}</span> : null}
        </div>
        <div className="field">
          <label>
            Date received
            <DateField
              value={docDate}
              max={todayIso()}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          {fields.docDate ? <span className="field-error">{fields.docDate}</span> : null}
        </div>
        <div className="field">
          <label>
            Vehicle number (optional)
            <input value={vehicleNo} onChange={(e) => setVehicle(e.target.value)} />
          </label>
        </div>
      </div>
      <h3>Items received</h3>
      {lines.map((l, i) => (
        <div className="form-grid cm-line" key={i}>
          <ItemPicker
            value={l.item}
            label={`Item ${i + 1}`}
            onPick={(item) => set(i, { item })}
            error={fields[`lines.${i}.itemId`]}
          />
          <div className="field">
            <label>
              Quantity
              <input
                inputMode="decimal"
                value={l.qty}
                onChange={(e) => set(i, { qty: e.target.value })}
                aria-invalid={fields[`lines.${i}.qty`] ? true : undefined}
              />
            </label>
            {fields[`lines.${i}.qty`] ? (
              <span className="field-error">{fields[`lines.${i}.qty`]}</span>
            ) : null}
          </div>
          <div className="field">
            <label>
              Batch number (if printed on the pack)
              <input value={l.batchNo} onChange={(e) => set(i, { batchNo: e.target.value })} />
            </label>
            {fields[`lines.${i}.batchNo`] ? (
              <span className="field-error">{fields[`lines.${i}.batchNo`]}</span>
            ) : null}
          </div>
          <div className="field">
            <label>
              Made on (optional)
              <DateField
                value={l.mfgDate}
                onChange={(e) => set(i, { mfgDate: e.target.value })}
              />
            </label>
          </div>
          <div className="field">
            <label>
              Expires on (if printed)
              <DateField
                value={l.expiryDate}
                onChange={(e) => set(i, { expiryDate: e.target.value })}
              />
            </label>
            {fields[`lines.${i}.expiryDate`] ? (
              <span className="field-error">{fields[`lines.${i}.expiryDate`]}</span>
            ) : null}
          </div>
          {lines.length > 1 ? (
            <button
              type="button"
              className="btn"
              onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
            >
              Remove this item
            </button>
          ) : null}
        </div>
      ))}
      <button type="button" className="btn" onClick={() => setLines((ls) => [...ls, blankR()])}>
        ＋ Add another item
      </button>
    </Modal>
  );
}

interface TLine {
  lotId: string;
  qty: string;
}

function TakeForm({
  type,
  onClose,
  onDone,
}: {
  type: 'ISSUE' | 'RETURN';
  onClose: () => void;
  onDone: (code: string) => void;
}) {
  const issue = type === 'ISSUE';
  const [customerId, setCustomer] = useState('');
  const [warehouseId, setWarehouse] = useState('');
  const [docDate, setDate] = useState(todayIso());
  const [reference, setReference] = useState('');
  const [challanNo, setChallanNo] = useState('');
  const [vehicleNo, setVehicle] = useState('');
  const [lines, setLines] = useState<TLine[]>([{ lotId: '', qty: '' }]);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const ready = customerId !== '' && warehouseId !== '';
  const lots = useLoad(
    () =>
      ready
        ? cmLots({ customerId, warehouseId, withBalanceOnly: true })
        : Promise.resolve({ rows: [] as CmLot[], meta: { page: 1, size: 0, total: 0 } }),
    [customerId, warehouseId, ready],
  );
  const options = lots.data?.rows ?? [];
  const lotOf = (id: string) => options.find((l) => l.id === id);
  const set = (i: number, p: Partial<TLine>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...p } : l)));
  const save = async () => {
    setBusy(true);
    setMsg('');
    setFields({});
    try {
      const d = await cmTake(issue ? 'issues' : 'returns', {
        customerId,
        warehouseId,
        docDate,
        ...(issue
          ? { reference }
          : { challanNo, challanDate: docDate, vehicleNo: vehicleNo || null }),
        lines: lines.filter((l) => l.lotId).map((l) => ({ lotId: l.lotId, qty: Number(l.qty) })),
      });
      onDone(d.code);
    } catch (e) {
      const u = toUiError(e);
      setMsg(u.message);
      setFields(u.fields);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={issue ? 'Use material for a job' : 'Send material back to customer'}
      sub={
        issue
          ? 'Choose the customer and store, then pick which lot to take from. The quantity left is shown.'
          : 'Choose the customer and store, pick the lot, and write our return challan number.'
      }
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          <button type="button" className="btn primary" disabled={busy} onClick={() => void save()}>
            {issue ? 'Save: material used' : 'Save: material sent back'}
          </button>
        </>
      }
    >
      <ErrorBox message={msg} />
      <div className="form-grid">
        <CustomerSelect value={customerId} onChange={setCustomer} error={fields.customerId} />
        <WarehouseSelect
          value={warehouseId}
          onChange={setWarehouse}
          label="Store where it is kept"
          error={fields.warehouseId}
        />
        <div className="field">
          <label>
            Date
            <DateField
              value={docDate}
              max={todayIso()}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          {fields.docDate ? <span className="field-error">{fields.docDate}</span> : null}
        </div>
        {issue ? (
          <div className="field">
            <label>
              Job or work order number
              <input value={reference} onChange={(e) => setReference(e.target.value)} />
            </label>
            {fields.reference ? <span className="field-error">{fields.reference}</span> : null}
          </div>
        ) : (
          <>
            <div className="field">
              <label>
                Our return challan number
                <input value={challanNo} onChange={(e) => setChallanNo(e.target.value)} />
              </label>
              {fields.challanNo ? <span className="field-error">{fields.challanNo}</span> : null}
            </div>
            <div className="field">
              <label>
                Vehicle number (optional)
                <input value={vehicleNo} onChange={(e) => setVehicle(e.target.value)} />
              </label>
            </div>
          </>
        )}
      </div>
      <h3>{issue ? 'Take from which lot?' : 'Send back from which lot?'}</h3>
      {ready && !lots.loading && options.length === 0 ? (
        <div className="notice" role="note">
          This customer has no material left in this store. Check the customer and store, or receive
          the material first.
        </div>
      ) : null}
      {!ready ? (
        <div className="notice">
          Choose the customer and the store first; the lots will appear here.
        </div>
      ) : null}
      {lines.map((l, i) => {
        const lot = lotOf(l.lotId);
        return (
          <div className="form-grid cm-line" key={i}>
            <div className="field">
              <label>
                Lot
                <select
                  value={l.lotId}
                  onChange={(e) => set(i, { lotId: e.target.value })}
                  aria-invalid={fields[`lines.${i}.lotId`] ? true : undefined}
                >
                  <option value="">Choose the lot…</option>
                  {options.map((o) => (
                    <option key={o.id} value={o.id} disabled={issue && o.expiry === 'expired'}>
                      {o.itemCode} · {o.itemName}
                      {o.batchNo ? ` · batch ${o.batchNo}` : ''} · challan {o.challanNo} ·{' '}
                      {qty(o.balanceQty)} left
                      {o.expiry === 'expired' ? ' · EXPIRED' : ''}
                    </option>
                  ))}
                </select>
              </label>
              {fields[`lines.${i}.lotId`] ? (
                <span className="field-error">{fields[`lines.${i}.lotId`]}</span>
              ) : null}
            </div>
            <div className="field">
              <label>
                Quantity{lot ? ` (up to ${qty(lot.balanceQty)})` : ''}
                <input
                  inputMode="decimal"
                  value={l.qty}
                  onChange={(e) => set(i, { qty: e.target.value })}
                  aria-invalid={fields[`lines.${i}.qty`] ? true : undefined}
                />
              </label>
              {fields[`lines.${i}.qty`] ? (
                <span className="field-error">{fields[`lines.${i}.qty`]}</span>
              ) : null}
            </div>
            {lines.length > 1 ? (
              <button
                type="button"
                className="btn"
                onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
              >
                Remove this line
              </button>
            ) : null}
          </div>
        );
      })}
      <button
        type="button"
        className="btn"
        onClick={() => setLines((ls) => [...ls, { lotId: '', qty: '' }])}
      >
        ＋ Add another lot
      </button>
    </Modal>
  );
}
