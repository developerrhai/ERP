// Phase 9 screens that are more than a header + lines form: Goods Receipt (receive against a PO, QC decision),
// Purchase Invoice (matching traffic lights, payment readiness), Vendor Comparison, Accounts Payable,
// Put-away (phone) and Supplier Evaluation.
import { useState } from 'react';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { toUiError } from '../../lib/errors';
import { lookupWarehouses, listBins, type Ref } from '../../lib/inventoryApi';
import {
  createDoc,
  getDoc,
  getJson,
  listDocs,
  lookupPos,
  lookupSuppliers,
  post,
  verb,
  type Doc,
  type Option,
  type Row,
} from '../../lib/scmApi';
import { useLoad } from '../../lib/useLoad';
import type { ActionSet } from '../../types';
import { dmy, Empty, ErrorBox, inr, PageHead, Pill, todayIso } from '../finance/shared';

const s = (v: unknown): string =>
  v === null || v === undefined
    ? ''
    : typeof v === 'object'
      ? JSON.stringify(v)
      : String(v as string | number | boolean);
const rowsOf = (v: unknown): Row[] => (Array.isArray(v) ? (v as Row[]) : []);

// ------------------------------------------------------------------------------------------------ GRN
export function GrnPage({ actions }: { actions: ActionSet }) {
  const toast = useToast();
  const list = useLoad(() => listDocs('/scm/grn', { size: 50 }), []);
  const [receiving, setReceiving] = useState(false);
  const [open, setOpen] = useState<Doc | null>(null);
  const [error, setError] = useState('');
  return (
    <>
      <PageHead
        title="Goods Receipt / GRN"
        sub="Receive goods against an approved purchase order. Items that need inspection wait in Quality Inspection."
      >
        {actions.add ? (
          <button type="button" className="btn primary" onClick={() => setReceiving(true)}>
            ＋ Receive against PO
          </button>
        ) : null}
      </PageHead>
      <ErrorBox message={error || list.error} />
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Receipt</th>
              <th>PO</th>
              <th>Supplier</th>
              <th>Date</th>
              <th>Value</th>
              <th>Inspection</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {(list.data?.rows ?? []).length === 0 && !list.loading ? (
              <Empty cols={7}>No receipts yet. Click ＋ Receive against PO.</Empty>
            ) : null}
            {(list.data?.rows ?? []).map((g) => (
              <tr key={g.id}>
                <td>
                  <button
                    type="button"
                    className="link"
                    onClick={() =>
                      void getDoc('/scm/grn', g.id)
                        .then(setOpen)
                        .catch((e: unknown) => setError(toUiError(e).message))
                    }
                  >
                    {s(g.number)}
                  </button>
                </td>
                <td>{s(g.poNo)}</td>
                <td>{s(g.supplierName)}</td>
                <td>{dmy(s(g.receiptDate))}</td>
                <td>{inr(s(g.totalValue))}</td>
                <td>{s(g.qcStatus)}</td>
                <td>
                  <Pill>{g.status}</Pill>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {receiving ? (
        <ReceiveForm
          onClose={() => setReceiving(false)}
          onSaved={(g, msg) => {
            setReceiving(false);
            toast(msg);
            setOpen(g);
            list.reload();
          }}
        />
      ) : null}
      {open ? (
        <GrnDetail
          grn={open}
          actions={actions}
          onClose={() => setOpen(null)}
          onChanged={(g, msg) => {
            setOpen(g);
            toast(msg);
            list.reload();
          }}
        />
      ) : null}
    </>
  );
}

function ReceiveForm({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (g: Doc, msg: string) => void;
}) {
  const pos = useLoad<Option[]>(() => lookupPos(), []);
  const whs = useLoad<Ref[]>(() => lookupWarehouses(), []);
  const [poId, setPoId] = useState('');
  const [wh, setWh] = useState('');
  const [lines, setLines] = useState<
    {
      poLineId: string;
      label: string;
      open: string;
      qty: string;
      batches: string;
      serials: string;
      tracked: string;
    }[]
  >([]);
  const [freight, setFreight] = useState('');
  const [msg, setMsg] = useState('');
  async function pick(id: string) {
    setPoId(id);
    setLines([]);
    if (!id) return;
    try {
      const r = await getJson<{ warehouseId: string | null; lines: Row[] }>(
        `/scm/grn/from-po/${id}`,
      );
      if (r.warehouseId) setWh(r.warehouseId);
      setLines(
        r.lines.map((l) => ({
          poLineId: s(l.id),
          label: `${s(l.itemCode)} · ${s(l.itemName)} (${s(l.uom)})`,
          open: s(l.openQty),
          qty: s(l.openQty),
          batches: '',
          serials: '',
          tracked: l.batchTracked === true ? 'batch' : l.serialTracked === true ? 'serial' : '',
        })),
      );
    } catch (e) {
      setMsg(toUiError(e).message);
    }
  }
  async function save() {
    setMsg('');
    try {
      const body = {
        poId,
        warehouseId: wh,
        lines: lines
          .filter((l) => Number(l.qty) > 0)
          .map((l) => ({
            poLineId: l.poLineId,
            receivedQty: l.qty,
            ...(l.tracked === 'batch'
              ? {
                  // "BATCH1:50, BATCH2:50"
                  batches: l.batches
                    .split(',')
                    .map((x) => x.trim())
                    .filter(Boolean)
                    .map((x) => ({
                      batchNo: x.split(':')[0] ?? '',
                      qty: x.split(':')[1] ?? l.qty,
                    })),
                }
              : {}),
            ...(l.tracked === 'serial'
              ? {
                  serialNos: l.serials
                    .split(',')
                    .map((x) => x.trim())
                    .filter(Boolean),
                }
              : {}),
          })),
        ...(Number(freight) > 0 ? { charges: [{ chargeType: 'FREIGHT', amount: freight }] } : {}),
      };
      const g = await createDoc('/scm/grn', body);
      await verb('/scm/grn', g.id, 'submit', {}, g.version);
      const done = await getDoc('/scm/grn', g.id);
      const hold = rowsOf(done.lines).filter((l) => l.qcRequired === true).length;
      onSaved(done, hold ? `Stock in QC hold: ${hold} lines` : `Receipt ${s(done.number)} saved`);
    } catch (e) {
      setMsg(toUiError(e).message);
    }
  }
  return (
    <Modal
      title="Receive against PO"
      sub="Pick the purchase order, then type what arrived."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={!poId || !wh || lines.length === 0}
            onClick={() => void save()}
          >
            Save and submit
          </button>
        </>
      }
    >
      <ErrorBox message={msg} />
      <div className="form-grid">
        <div className="field">
          <label htmlFor="po">Purchase order *</label>
          <select id="po" value={poId} onChange={(e) => void pick(e.target.value)}>
            <option value="">Choose…</option>
            {(pos.data ?? []).map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="wh">Warehouse *</label>
          <select id="wh" value={wh} onChange={(e) => setWh(e.target.value)}>
            <option value="">Choose…</option>
            {(whs.data ?? []).map((w) => (
              <option key={w.id} value={w.id}>
                {w.code} · {w.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="fr">Freight to add to stock cost</label>
          <input
            id="fr"
            type="number"
            value={freight}
            onChange={(e) => setFreight(e.target.value)}
          />
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th>Still to receive</th>
              <th>Received now</th>
              <th>Batch / serial numbers</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={l.poLineId}>
                <td>{l.label}</td>
                <td>{l.open}</td>
                <td>
                  <input
                    aria-label={`Received ${l.label}`}
                    type="number"
                    value={l.qty}
                    onChange={(e) =>
                      setLines((ls) =>
                        ls.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)),
                      )
                    }
                  />
                </td>
                <td>
                  {l.tracked === 'batch' ? (
                    <input
                      aria-label={`Batches ${l.label}`}
                      placeholder="BATCH1:50, BATCH2:50"
                      value={l.batches}
                      onChange={(e) =>
                        setLines((ls) =>
                          ls.map((x, j) => (j === i ? { ...x, batches: e.target.value } : x)),
                        )
                      }
                    />
                  ) : l.tracked === 'serial' ? (
                    <input
                      aria-label={`Serial numbers ${l.label}`}
                      placeholder="SN1, SN2, SN3"
                      value={l.serials}
                      onChange={(e) =>
                        setLines((ls) =>
                          ls.map((x, j) => (j === i ? { ...x, serials: e.target.value } : x)),
                        )
                      }
                    />
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

function GrnDetail({
  grn,
  actions,
  onClose,
  onChanged,
}: {
  grn: Doc;
  actions: ActionSet;
  onClose: () => void;
  onChanged: (g: Doc, msg: string) => void;
}) {
  const [msg, setMsg] = useState('');
  const [reason, setReason] = useState('');
  const [dec, setDec] = useState<Record<string, { a: string; r: string }>>({});
  const lines = rowsOf(grn.lines);
  async function run(fn: () => Promise<unknown>, text: string) {
    setMsg('');
    try {
      await fn();
      onChanged(await getDoc('/scm/grn', grn.id), text);
    } catch (e) {
      setMsg(toUiError(e).message);
    }
  }
  return (
    <Modal
      title={`Goods receipt ${s(grn.number)}`}
      sub={`${s(grn.supplierName)} · PO ${s(grn.poNo)}`}
      onClose={onClose}
      footer={
        <>
          {grn.status === 'Draft' && actions.submit ? (
            <button
              type="button"
              className="btn primary"
              onClick={() =>
                void run(() => verb('/scm/grn', grn.id, 'submit', {}, grn.version), 'Submitted')
              }
            >
              Submit
            </button>
          ) : null}
          {grn.status === 'Approved' && actions.post ? (
            <button
              type="button"
              className="btn primary"
              onClick={() => void run(() => verb('/scm/grn', grn.id, 'post'), 'Posted')}
            >
              Post
            </button>
          ) : null}
          {grn.status === 'Posted' && actions.cancel ? (
            <button
              type="button"
              className="btn danger"
              disabled={reason.trim().length < 5}
              title={reason.trim().length < 5 ? 'Type a reason first' : undefined}
              onClick={() =>
                void run(() => verb('/scm/grn', grn.id, 'cancel', { reason }), 'Cancelled')
              }
            >
              Cancel receipt
            </button>
          ) : null}
        </>
      }
    >
      <ErrorBox message={msg} />
      <p>
        <Pill>{grn.status}</Pill> Inspection: {s(grn.qcStatus)} · Put-away: {s(grn.putawayStatus)}
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Received</th>
              <th>Accepted</th>
              <th>Rejected</th>
              <th>Unit cost</th>
              <th>Inspection</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const d = dec[s(l.id)] ?? { a: s(l.receivedQty), r: '0' };
              const pending = grn.status === 'Posted' && l.qcState === 'PENDING';
              return (
                <tr key={s(l.id)}>
                  <td>{s(l.lineNo)}</td>
                  <td>{s(l.receivedQty)}</td>
                  <td>{s(l.acceptedQty)}</td>
                  <td>{s(l.rejectedQty)}</td>
                  <td>{s(l.unitCost)}</td>
                  <td>{s(l.qcState)}</td>
                  <td>
                    {pending && actions.approve ? (
                      <span className="row-gap">
                        <input
                          aria-label="Accepted quantity"
                          type="number"
                          value={d.a}
                          onChange={(e) =>
                            setDec({ ...dec, [s(l.id)]: { ...d, a: e.target.value } })
                          }
                        />
                        <input
                          aria-label="Rejected quantity"
                          type="number"
                          value={d.r}
                          onChange={(e) =>
                            setDec({ ...dec, [s(l.id)]: { ...d, r: e.target.value } })
                          }
                        />
                        <button
                          type="button"
                          className="btn sm primary"
                          onClick={() =>
                            void run(
                              () =>
                                post(`/scm/grn/lines/${s(l.id)}/qc-decision`, {
                                  acceptedQty: d.a,
                                  rejectedQty: d.r,
                                  rejectReason:
                                    Number(d.r) > 0 ? 'Rejected at inspection' : undefined,
                                }),
                              'Inspection decision saved',
                            )
                          }
                        >
                          Decide
                        </button>
                      </span>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {grn.status === 'Posted' ? (
        <div className="field">
          <label htmlFor="gr">Reason (to cancel)</label>
          <input id="gr" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
      ) : null}
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ purchase invoice
export function InvoicePage({ actions }: { actions: ActionSet }) {
  const toast = useToast();
  const list = useLoad(() => listDocs('/scm/purchaseinvoice', { size: 50 }), []);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<Doc | null>(null);
  const [error, setError] = useState('');
  return (
    <>
      <PageHead
        title="Purchase Invoice"
        sub="Enter the supplier's invoice against a goods receipt. Quantity, rate and tax are matched before it can be approved."
      >
        {actions.add ? (
          <button type="button" className="btn primary" onClick={() => setCreating(true)}>
            ＋ New Purchase Invoice
          </button>
        ) : null}
      </PageHead>
      <ErrorBox message={error || list.error} />
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Our no.</th>
              <th>Supplier invoice</th>
              <th>Supplier</th>
              <th>Date</th>
              <th>Net payable</th>
              <th>Matching</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {(list.data?.rows ?? []).length === 0 && !list.loading ? (
              <Empty cols={7}>No invoices yet.</Empty>
            ) : null}
            {(list.data?.rows ?? []).map((i) => (
              <tr key={i.id}>
                <td>
                  <button
                    type="button"
                    className="link"
                    onClick={() =>
                      void getDoc('/scm/purchaseinvoice', i.id)
                        .then(setOpen)
                        .catch((e: unknown) => setError(toUiError(e).message))
                    }
                  >
                    {s(i.number)}
                  </button>
                </td>
                <td>{s(i.vendorInvoiceNo)}</td>
                <td>{s(i.supplierName)}</td>
                <td>{dmy(s(i.invoiceDate))}</td>
                <td>{inr(s(i.netPayable))}</td>
                <td>
                  <Pill
                    tone={
                      i.matchState === 'ON_HOLD'
                        ? 'rejected'
                        : i.matchState === 'OVERRIDDEN'
                          ? 'pending-approval'
                          : 'approved'
                    }
                  >
                    {s(i.matchState)}
                  </Pill>
                </td>
                <td>
                  <Pill>{i.status}</Pill>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {creating ? (
        <InvoiceForm
          onClose={() => setCreating(false)}
          onSaved={(d) => {
            setCreating(false);
            toast(`Saved ${s(d.number)}`);
            setOpen(d);
            list.reload();
          }}
        />
      ) : null}
      {open ? (
        <InvoiceDetail
          inv={open}
          actions={actions}
          onClose={() => setOpen(null)}
          onChanged={(d, msg) => {
            setOpen(d);
            toast(msg);
            list.reload();
          }}
        />
      ) : null}
    </>
  );
}

function InvoiceForm({ onClose, onSaved }: { onClose: () => void; onSaved: (d: Doc) => void }) {
  const sups = useLoad<Option[]>(() => lookupSuppliers(), []);
  const grns = useLoad(() => listDocs('/scm/grn', { status: 'Posted', size: 100 }), []);
  const [supplierId, setSupplierId] = useState('');
  const [grnId, setGrnId] = useState('');
  const [no, setNo] = useState('');
  const [date, setDate] = useState(todayIst());
  const [lines, setLines] = useState<
    { grnLineId: string; label: string; qty: string; rate: string; gstPct: string }[]
  >([]);
  const [msg, setMsg] = useState('');
  async function pick(id: string) {
    setGrnId(id);
    setLines([]);
    if (!id) return;
    try {
      const r = await getJson<{ supplierId: string; lines: Row[] }>(
        `/scm/purchaseinvoice/from-grn/${id}`,
      );
      setSupplierId(r.supplierId);
      setLines(
        r.lines.map((l) => ({
          grnLineId: s(l.grnLineId),
          label: `${s(l.itemCode)} · ${s(l.itemName)}`,
          qty: s(l.qty),
          rate: s(l.rate),
          gstPct: s(l.gstPct),
        })),
      );
    } catch (e) {
      setMsg(toUiError(e).message);
    }
  }
  async function save() {
    setMsg('');
    try {
      onSaved(
        await createDoc('/scm/purchaseinvoice', {
          supplierId,
          vendorInvoiceNo: no,
          invoiceDate: date,
          lines: lines.map((l) => ({
            grnLineId: l.grnLineId,
            qty: l.qty,
            rate: l.rate,
            gstPct: l.gstPct,
          })),
        }),
      );
    } catch (e) {
      setMsg(toUiError(e).message);
    }
  }
  return (
    <Modal
      title="New Purchase Invoice"
      sub="Pick the goods receipt it is for; the lines come pre-filled."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={!supplierId || !no || lines.length === 0}
            onClick={() => void save()}
          >
            Save draft
          </button>
        </>
      }
    >
      <ErrorBox message={msg} />
      <div className="form-grid">
        <div className="field">
          <label htmlFor="g">Goods receipt *</label>
          <select id="g" value={grnId} onChange={(e) => void pick(e.target.value)}>
            <option value="">Choose…</option>
            {(grns.data?.rows ?? []).map((g) => (
              <option key={g.id} value={g.id}>
                {s(g.number)} · {s(g.supplierName)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Supplier</label>
          <select value={supplierId} disabled>
            {(sups.data ?? []).map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="n">Supplier invoice number *</label>
          <input id="n" value={no} onChange={(e) => setNo(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="d">Invoice date *</label>
          <input id="d" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th>Billed qty</th>
              <th>Rate</th>
              <th>GST %</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={l.grnLineId}>
                <td>{l.label}</td>
                {(['qty', 'rate', 'gstPct'] as const).map((k) => (
                  <td key={k}>
                    <input
                      aria-label={`${k} ${l.label}`}
                      type="number"
                      value={l[k]}
                      onChange={(e) =>
                        setLines((ls) =>
                          ls.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)),
                        )
                      }
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

const todayIst = todayIso;

function InvoiceDetail({
  inv,
  actions,
  onClose,
  onChanged,
}: {
  inv: Doc;
  actions: ActionSet;
  onClose: () => void;
  onChanged: (d: Doc, msg: string) => void;
}) {
  const [tab, setTab] = useState<'match' | 'pay'>('match');
  const [msg, setMsg] = useState('');
  const [reason, setReason] = useState('');
  const lines = rowsOf(inv.lines);
  const exceptions = rowsOf(inv.exceptions);
  const ready = (inv.readiness ?? {}) as Row;
  async function run(fn: () => Promise<unknown>, text: string) {
    setMsg('');
    try {
      await fn();
      onChanged(await getDoc('/scm/purchaseinvoice', inv.id), text);
    } catch (e) {
      setMsg(toUiError(e).message);
    }
  }
  return (
    <Modal
      title={`Purchase invoice ${s(inv.number)}`}
      sub={`${s(inv.supplierName)} · ${s(inv.vendorInvoiceNo)}`}
      onClose={onClose}
      footer={
        <>
          {(inv.status === 'Draft' || inv.status === 'Rejected') && actions.submit ? (
            <button
              type="button"
              className="btn primary"
              onClick={() =>
                void run(
                  () => verb('/scm/purchaseinvoice', inv.id, 'submit', {}, inv.version),
                  'Submitted',
                )
              }
            >
              Submit
            </button>
          ) : null}
          {inv.status === 'Approved' && actions.post ? (
            <button
              type="button"
              className="btn primary"
              onClick={() => void run(() => verb('/scm/purchaseinvoice', inv.id, 'post'), 'Posted')}
            >
              Post
            </button>
          ) : null}
          {inv.status === 'Posted' && actions.cancel ? (
            <button
              type="button"
              className="btn danger"
              disabled={reason.trim().length < 5}
              title={reason.trim().length < 5 ? 'Type a reason first' : undefined}
              onClick={() =>
                void run(
                  () => verb('/scm/purchaseinvoice', inv.id, 'cancel', { reason }),
                  'Cancelled',
                )
              }
            >
              Cancel invoice
            </button>
          ) : null}
        </>
      }
    >
      <ErrorBox message={msg} />
      <div className="tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'match'}
          className={tab === 'match' ? 'tab active' : 'tab'}
          onClick={() => setTab('match')}
        >
          PO-GRN Matching
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'pay'}
          className={tab === 'pay' ? 'tab active' : 'tab'}
          onClick={() => setTab('pay')}
        >
          Payment Readiness
        </button>
      </div>
      {tab === 'match' ? (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Billed</th>
                  <th>Rate</th>
                  <th>Matched value</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => {
                  const ex = exceptions.filter((e) => e.lineId === l.id);
                  const tone =
                    l.matchStatus === 'OK'
                      ? 'approved'
                      : l.matchStatus === 'OVERRIDDEN'
                        ? 'pending-approval'
                        : 'rejected';
                  return (
                    <tr key={s(l.id)}>
                      <td>{s(l.lineNo)}</td>
                      <td>{s(l.qty)}</td>
                      <td>{s(l.rate)}</td>
                      <td>{inr(s(l.matchedValue))}</td>
                      <td>
                        <Pill tone={tone}>
                          {l.matchStatus === 'OK' ? 'Matched' : s(l.matchStatus)}
                        </Pill>
                        {ex.map((e) => (
                          <div key={s(e.id)}>
                            {s(e.message)}
                            {e.state === 'OPEN' && actions.approve ? (
                              <button
                                type="button"
                                className="btn sm"
                                disabled={reason.trim().length < 5}
                                title={reason.trim().length < 5 ? 'Type a reason first' : undefined}
                                onClick={() =>
                                  void run(
                                    () =>
                                      verb(
                                        '/scm/purchaseinvoice',
                                        inv.id,
                                        `exceptions/${s(e.id)}/override`,
                                        { reason },
                                      ),
                                    'Override saved',
                                  )
                                }
                              >
                                Override
                              </button>
                            ) : null}
                          </div>
                        ))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="field">
            <label htmlFor="rs">Reason (to override or cancel)</label>
            <input id="rs" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        </>
      ) : (
        <dl className="kv">
          <div>
            <dt>Due date</dt>
            <dd>{dmy(s(ready.dueDate))}</dd>
          </div>
          <div>
            <dt>MSME legal due date</dt>
            <dd>{dmy(s(ready.msmeDueDate))}</dd>
          </div>
          <div>
            <dt>TDS</dt>
            <dd>{inr(s(ready.tdsAmount))}</dd>
          </div>
          <div>
            <dt>Net payable</dt>
            <dd>{inr(s(ready.netPayable))}</dd>
          </div>
          <div>
            <dt>Outstanding</dt>
            <dd>{inr(s(ready.outstanding))}</dd>
          </div>
          <div>
            <dt>ITC-180 countdown</dt>
            <dd>{s(inv.itc180DaysLeft)} days left</dd>
          </div>
          <div>
            <dt>GSTR-2B</dt>
            <dd>{s(inv.gstr2bStatus)}</dd>
          </div>
        </dl>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ comparison
export function ComparisonPage({ actions }: { actions: ActionSet }) {
  const toast = useToast();
  const list = useLoad(() => listDocs('/scm/comparison', { size: 50 }), []);
  const rfqs = useLoad(() => listDocs('/scm/rfq', { size: 100 }), []);
  const [rfqId, setRfqId] = useState('');
  const [open, setOpen] = useState<Doc | null>(null);
  const [msg, setMsg] = useState('');
  async function run(fn: () => Promise<unknown>, text: string, id?: string) {
    setMsg('');
    try {
      await fn();
      if (id) setOpen(await getDoc('/scm/comparison', id));
      toast(text);
      list.reload();
    } catch (e) {
      setMsg(toUiError(e).message);
    }
  }
  return (
    <>
      <PageHead
        title="Vendor Comparison"
        sub="Compare the current quotes of an RFQ on price, delivery time and quality, then award one."
      />
      <ErrorBox message={msg || list.error} />
      {actions.add ? (
        <div className="toolbar">
          <select aria-label="RFQ" value={rfqId} onChange={(e) => setRfqId(e.target.value)}>
            <option value="">Choose an RFQ…</option>
            {(rfqs.data?.rows ?? []).map((r) => (
              <option key={r.id} value={r.id}>
                {s(r.number)}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn primary"
            disabled={!rfqId}
            onClick={() => void run(() => post('/scm/comparison', { rfqId }), 'Comparison created')}
          >
            ＋ Compare quotes
          </button>
        </div>
      ) : null}
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Number</th>
              <th>Created</th>
              <th>Awarded</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {(list.data?.rows ?? []).length === 0 && !list.loading ? (
              <Empty cols={4}>No comparisons yet.</Empty>
            ) : null}
            {(list.data?.rows ?? []).map((c) => (
              <tr key={c.id}>
                <td>
                  <button
                    type="button"
                    className="link"
                    onClick={() => void getDoc('/scm/comparison', c.id).then(setOpen)}
                  >
                    {s(c.number)}
                  </button>
                </td>
                <td>{dmy(s(c.createdAt))}</td>
                <td>{c.lockedAt ? 'Yes' : 'No'}</td>
                <td>
                  <Pill>{c.status}</Pill>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {open ? (
        <Modal
          title={`Comparison ${s(open.number)}`}
          onClose={() => setOpen(null)}
          footer={
            open.status === 'Draft' && actions.submit ? (
              <button
                type="button"
                className="btn primary"
                onClick={() =>
                  void run(
                    () => verb('/scm/comparison', open.id, 'submit', {}, open.version),
                    'Submitted',
                    open.id,
                  )
                }
              >
                Submit
              </button>
            ) : undefined
          }
        >
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Total landed</th>
                  <th>Price score</th>
                  <th>Lead score</th>
                  <th>Quality score</th>
                  <th>Total</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rowsOf(open.lines).map((e) => (
                  <tr key={s(e.id)}>
                    <td>{s(e.rank) || 'Not eligible'}</td>
                    <td>{inr(s(e.totalLanded))}</td>
                    <td>{s(e.priceScore)}</td>
                    <td>{s(e.leadScore)}</td>
                    <td>{s(e.qualityScore)}</td>
                    <td>{s(e.totalScore)}</td>
                    <td>
                      {open.status === 'Approved' && !open.lockedAt && actions.approve && e.rank ? (
                        <button
                          type="button"
                          className="btn sm primary"
                          onClick={() =>
                            void run(
                              () =>
                                verb('/scm/comparison', open.id, 'award', {
                                  quoteId: s(e.quoteId),
                                  ...(Number(e.rank) !== 1
                                    ? { reason: 'Chosen for delivery time or relationship' }
                                    : {}),
                                }),
                              'Awarded',
                              open.id,
                            )
                          }
                        >
                          Award
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {open.lockedAt ? (
            <button
              type="button"
              className="btn primary"
              onClick={() =>
                void run(
                  () => post(`/scm/po/from-comparison/${open.id}`, {}),
                  'Purchase order created',
                )
              }
            >
              Create purchase order
            </button>
          ) : null}
        </Modal>
      ) : null}
    </>
  );
}

// ------------------------------------------------------------------------------------------------ AP
export function ApPage({ actions }: { actions: ActionSet }) {
  const toast = useToast();
  const [tab, setTab] = useState<'pay' | 'age' | 'due' | 'prop'>('pay');
  const pay = useLoad(() => getJson<{ rows: Row[]; suppliers: Row[] }>('/fin/ap/payables'), []);
  const age = useLoad(
    () => getJson<{ totals: Row; total: string; suppliers: Row[] }>('/fin/ap/ageing'),
    [],
  );
  const due = useLoad(() => getJson<Row[]>('/fin/ap/due-schedule'), []);
  const props = useLoad(() => listDocs('/fin/ap/payments', { size: 50 }), []);
  const [till, setTill] = useState(todayIso());
  const [msg, setMsg] = useState('');
  return (
    <>
      <PageHead
        title="Accounts Payable"
        sub="What we owe suppliers: payables, ageing, due calendar and payment proposals."
      >
        {actions.add ? (
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              setMsg('');
              post('/fin/ap/proposals', { dueTill: till })
                .then(() => {
                  toast('Payment proposal created: submit it for approval');
                  props.reload();
                })
                .catch((e: unknown) => setMsg(toUiError(e).message));
            }}
          >
            ＋ Proposal for invoices due till
          </button>
        ) : null}
        <input
          aria-label="Due till"
          type="date"
          value={till}
          onChange={(e) => setTill(e.target.value)}
        />
      </PageHead>
      <ErrorBox message={msg} />
      <div className="tabs" role="tablist">
        {(
          [
            ['pay', 'Payables'],
            ['age', 'Ageing'],
            ['due', 'Due calendar'],
            ['prop', 'Payments'],
          ] as const
        ).map(([k, l]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            className={tab === k ? 'tab active' : 'tab'}
            onClick={() => setTab(k)}
          >
            {l}
          </button>
        ))}
      </div>
      {tab === 'pay' ? (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Supplier</th>
                <th>Invoice</th>
                <th>Due</th>
                <th>MSME due</th>
                <th>Outstanding</th>
              </tr>
            </thead>
            <tbody>
              {(pay.data?.rows ?? []).length === 0 && !pay.loading ? (
                <Empty cols={5}>Nothing is waiting to be paid.</Empty>
              ) : null}
              {(pay.data?.rows ?? []).map((r) => (
                <tr key={s(r.id)} className={r.msmeOverdue === true ? 'row-red' : undefined}>
                  <td>{s(r.supplierName)}</td>
                  <td>{s(r.number)}</td>
                  <td>{dmy(s(r.dueDate))}</td>
                  <td>{dmy(s(r.msmeDueDate))}</td>
                  <td>{inr(s(r.outstanding))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {tab === 'age' ? (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Supplier</th>
                {['NOT_DUE', '0-30', '31-60', '61-90', '90+'].map((b) => (
                  <th key={b}>{b === 'NOT_DUE' ? 'Not due' : b}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(age.data?.suppliers ?? []).map((r) => (
                <tr key={s(r.supplierId)}>
                  <td>{s(r.supplierName)}</td>
                  {['NOT_DUE', '0-30', '31-60', '61-90', '90+'].map((b) => (
                    <td key={b}>{inr(s((r.buckets as Row)[b]))}</td>
                  ))}
                </tr>
              ))}
              <tr>
                <td>
                  <b>Total</b>
                </td>
                {['NOT_DUE', '0-30', '31-60', '61-90', '90+'].map((b) => (
                  <td key={b}>
                    <b>{inr(s(age.data?.totals?.[b]))}</b>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      ) : null}
      {tab === 'due' ? (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Invoices</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {(due.data ?? []).map((d) => (
                <tr key={s(d.date)} className={d.msme === true ? 'row-red' : undefined}>
                  <td>{dmy(s(d.date))}</td>
                  <td>{rowsOf(d.invoices).length}</td>
                  <td>{inr(s(d.amount))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {tab === 'prop' ? (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Payment</th>
                <th>Supplier</th>
                <th>Amount</th>
                <th>UTR</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(props.data?.rows ?? []).length === 0 && !props.loading ? (
                <Empty cols={6}>No payments yet.</Empty>
              ) : null}
              {(props.data?.rows ?? []).map((p) => (
                <tr key={p.id}>
                  <td>{s(p.number)}</td>
                  <td>{s(p.supplierName)}</td>
                  <td>{inr(s(p.amount))}</td>
                  <td>{s(p.utr)}</td>
                  <td>
                    <Pill>{p.status}</Pill>
                  </td>
                  <td>
                    {p.status === 'Approved' && actions.post ? (
                      <PostPayment
                        id={p.id}
                        onDone={() => {
                          toast('Payment posted');
                          props.reload();
                          pay.reload();
                        }}
                      />
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}

function PostPayment({ id, onDone }: { id: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [utr, setUtr] = useState('');
  const [bank, setBank] = useState('');
  const [msg, setMsg] = useState('');
  const banks = useLoad(
    () => getJson<{ id: string; name: string }[]>('/finance/bank-accounts'),
    [],
  );
  if (!open)
    return (
      <button type="button" className="btn sm primary" onClick={() => setOpen(true)}>
        Pay
      </button>
    );
  return (
    <Modal
      title="Record the payment"
      sub="Type the bank reference (UTR) after you pay from the bank."
      size="sm"
      onClose={() => setOpen(false)}
      footer={
        <button
          type="button"
          className="btn primary"
          disabled={!bank}
          onClick={() => {
            setMsg('');
            verb('/fin/ap/payments', id, 'post', { bankAccountId: bank, paymentMode: 'NEFT', utr })
              .then(() => {
                setOpen(false);
                onDone();
              })
              .catch((e: unknown) => setMsg(toUiError(e).message));
          }}
        >
          Record payment
        </button>
      }
    >
      <ErrorBox message={msg} />
      <div className="field">
        <label htmlFor="bk">Paid from *</label>
        <select id="bk" value={bank} onChange={(e) => setBank(e.target.value)}>
          <option value="">Choose…</option>
          {(banks.data ?? []).map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="utr">UTR / reference</label>
        <input id="utr" value={utr} onChange={(e) => setUtr(e.target.value)} />
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ put-away (phone)
export function PutawayPage({ actions }: { actions: ActionSet }) {
  const toast = useToast();
  const list = useLoad(() => getJson<Row[]>('/wms/putaway/tasks?size=50'), []);
  const [msg, setMsg] = useState('');
  const [taking, setTaking] = useState<Row | null>(null);
  return (
    <>
      <PageHead
        title="Put Away"
        sub="Move received goods from the dock to a bin: Claim, scan the bin, Done."
      />
      <ErrorBox message={msg || list.error} />
      {(list.data ?? []).length === 0 && !list.loading ? (
        <p className="v8-sub">
          No put-away tasks. They appear after goods are received and cleared by inspection.
        </p>
      ) : null}
      {(list.data ?? []).map((t) => (
        <div key={s(t.id)} className="card">
          <b>
            {s(t.taskNo)} · {s(t.itemCode)}
          </b>{' '}
          <Pill>{s(t.status)}</Pill>
          <div>
            Qty {s(t.qty)} · Suggested bin: <b>{s(t.suggestedBinCode) || 'any'}</b> · GRN{' '}
            {s(t.grnNo)}
          </div>
          {actions.edit && t.status === 'Open' ? (
            <button
              type="button"
              className="btn primary"
              onClick={() => {
                setMsg('');
                verb('/wms/putaway', s(t.id), 'claim')
                  .then(() => {
                    toast('Task claimed');
                    list.reload();
                  })
                  .catch((e: unknown) => setMsg(toUiError(e).message));
              }}
            >
              Claim
            </button>
          ) : null}
          {actions.edit && t.status === 'Assigned' ? (
            <button type="button" className="btn primary" onClick={() => setTaking(t)}>
              Scan bin and finish
            </button>
          ) : null}
        </div>
      ))}
      {taking ? (
        <BinDialog
          task={taking}
          onClose={() => setTaking(null)}
          onDone={() => {
            setTaking(null);
            toast('Put-away done');
            list.reload();
          }}
        />
      ) : null}
    </>
  );
}

function BinDialog({
  task,
  onClose,
  onDone,
}: {
  task: Row;
  onClose: () => void;
  onDone: () => void;
}) {
  const bins = useLoad(() => listBins({ warehouseId: s(task.warehouseId), page: 1 }), []);
  const [bin, setBin] = useState('');
  const [msg, setMsg] = useState('');
  const chosen = bin || s(task.suggestedBinId);
  return (
    <Modal
      title={`Put away ${s(task.taskNo)}`}
      sub="The suggested bin is pre-selected."
      size="sm"
      onClose={onClose}
      footer={
        <button
          type="button"
          className="btn primary"
          disabled={!chosen}
          onClick={() => {
            setMsg('');
            verb('/wms/putaway', s(task.id), 'complete', { binId: chosen })
              .then(onDone)
              .catch((e: unknown) => setMsg(toUiError(e).message));
          }}
        >
          Done
        </button>
      }
    >
      <ErrorBox message={msg} />
      <div className="field">
        <label htmlFor="bin">Bin *</label>
        <select id="bin" value={chosen} onChange={(e) => setBin(e.target.value)}>
          <option value="">Choose…</option>
          {(bins.data?.rows ?? []).map((b) => (
            <option key={b.id} value={b.id}>
              {b.code}
            </option>
          ))}
        </select>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ evaluation
export function EvaluationPage({ actions }: { actions: ActionSet }) {
  const toast = useToast();
  const [period, setPeriod] = useState(todayIso().slice(0, 7));
  const list = useLoad(() => getJson<Row[]>(`/scm/evaluation?period=${period}`), [period]);
  const [msg, setMsg] = useState('');
  return (
    <>
      <PageHead
        title="Supplier Evaluation"
        sub="Monthly score: Quality 40, Delivery 30, Cost 20, Response 10. A supplier failing compliance is graded D."
      >
        <input
          aria-label="Month"
          type="month"
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
        />
        {actions.add ? (
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              setMsg('');
              post('/scm/evaluation/run', { period })
                .then(() => {
                  toast('Evaluation updated');
                  list.reload();
                })
                .catch((e: unknown) => setMsg(toUiError(e).message));
            }}
          >
            Run evaluation
          </button>
        ) : null}
      </PageHead>
      <ErrorBox message={msg || list.error} />
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Rank</th>
              <th>Supplier</th>
              <th>Quality</th>
              <th>Delivery</th>
              <th>Cost</th>
              <th>Response</th>
              <th>Overall</th>
              <th>Grade</th>
            </tr>
          </thead>
          <tbody>
            {(list.data ?? []).length === 0 && !list.loading ? (
              <Empty cols={8}>No evaluation for this month yet. Click Run evaluation.</Empty>
            ) : null}
            {(list.data ?? []).map((r) => (
              <tr key={s(r.id)} className={r.riskFlag === true ? 'row-red' : undefined}>
                <td>{s(r.rank)}</td>
                <td>{s(r.supplierName)}</td>
                <td>{s(r.quality)}</td>
                <td>{s(r.delivery)}</td>
                <td>{s(r.cost)}</td>
                <td>{s(r.response)}</td>
                <td>{s(r.overall)}</td>
                <td>
                  <Pill>{s(r.grade)}</Pill>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
