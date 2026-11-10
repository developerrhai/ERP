// Phase 10 screens that are more than a header + lines form: the pipeline board, lead sources, the quotation page
// (customer RFQs + quotations), dispatch with the delivery challan, sales invoices from a dispatch, sales returns,
// collections (receipts against invoices) and delivery scheduling (open order balance by month).
import { useState } from 'react';
import { EmailDocButton } from '../../components/EmailDocDialog';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { toUiError } from '../../lib/errors';
import { lookupWarehouses, type Ref } from '../../lib/inventoryApi';
import { download } from '../../lib/api';
import {
  createDoc,
  getDoc,
  getJson,
  listDocs,
  post,
  verb,
  type Doc,
  type Row,
} from '../../lib/scmApi';
import { useLoad } from '../../lib/useLoad';
import type { ActionSet } from '../../types';
import { dmy, Empty, ErrorBox, inr, PageHead, Pill, todayIso } from '../finance/shared';
import { DocPage } from './DocPage';
import { CRFQ_CFG, SQ_CFG } from './salesConfigs';

const s = (v: unknown): string =>
  v === null || v === undefined
    ? ''
    : typeof v === 'object'
      ? JSON.stringify(v)
      : String(v as string | number | boolean);
const rowsOf = (v: unknown): Row[] => (Array.isArray(v) ? (v as Row[]) : []);

// ------------------------------------------------------------------------------------------------ pipeline
const STAGES = ['Prospecting', 'Qualification', 'Proposal', 'Negotiation', 'Won', 'Lost'];
export function PipelinePage({ actions }: { actions: ActionSet }) {
  const toast = useToast();
  const board = useLoad(() => getJson<{ stages: Row[] }>('/crm/pipeline'), []);
  const [msg, setMsg] = useState('');
  const [moving, setMoving] = useState<{ id: string; title: string; to: string } | null>(null);
  const [reason, setReason] = useState('');
  async function move(id: string, stage: string, lostReason?: string) {
    setMsg('');
    try {
      await verb('/crm/opportunities', id, 'move-stage', {
        stage,
        ...(lostReason ? { lostReason } : {}),
      });
      toast(`Moved to ${stage}`);
      board.reload();
    } catch (e) {
      setMsg(toUiError(e).message);
    }
  }
  return (
    <>
      <PageHead
        title="Sales Pipeline"
        sub="Every open opportunity by stage. Move a card with its menu; Lost needs a reason."
      />
      <ErrorBox message={msg || board.error} />
      <div
        className="kanban"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
          gap: 12,
        }}
      >
        {(board.data?.stages ?? []).map((col) => (
          <section key={s(col.stage)} className="card" aria-label={s(col.stage)}>
            <h3>
              {s(col.stage)} <small>({s(col.count)})</small>
            </h3>
            <p>
              {inr(s(col.amount))} · weighted {inr(s(col.weighted))}
            </p>
            {rowsOf(col.items).map((o) => (
              <div key={s(o.id)} className="card">
                <b>{s(o.title)}</b>
                <div>{s(o.customerName) || '—'}</div>
                <div>{inr(s(o.amount))}</div>
                {actions.edit && !['Won', 'Lost'].includes(s(col.stage)) ? (
                  <select
                    aria-label={`Move ${s(o.title)}`}
                    value=""
                    onChange={(e) => {
                      const to = e.target.value;
                      if (!to) return;
                      if (to === 'Lost') {
                        setReason('');
                        setMoving({ id: s(o.id), title: s(o.title), to });
                      } else void move(s(o.id), to);
                    }}
                  >
                    <option value="">Move to…</option>
                    {STAGES.filter((x) => x !== s(col.stage)).map((x) => (
                      <option key={x}>{x}</option>
                    ))}
                  </select>
                ) : null}
              </div>
            ))}
          </section>
        ))}
      </div>
      {moving ? (
        <Modal
          title={`Lost: ${moving.title}`}
          size="sm"
          onClose={() => setMoving(null)}
          footer={
            <button
              type="button"
              className="btn danger"
              disabled={reason.trim().length < 3}
              onClick={() => {
                const m = moving;
                setMoving(null);
                void move(m.id, 'Lost', reason);
              }}
            >
              Mark lost
            </button>
          }
        >
          <div className="field">
            <label htmlFor="lost">Why was it lost? *</label>
            <input id="lost" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        </Modal>
      ) : null}
    </>
  );
}

// ------------------------------------------------------------------------------------------------ lead sources
export function SourcesPage({ actions }: { actions: ActionSet }) {
  const toast = useToast();
  const list = useLoad(() => getJson<Row[]>('/crm/sources'), []);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [msg, setMsg] = useState('');
  return (
    <>
      <PageHead title="Lead Sources" sub="Where enquiries come from." />
      <ErrorBox message={msg || list.error} />
      {actions.add ? (
        <div className="toolbar">
          <input
            aria-label="Code"
            placeholder="Code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <input
            aria-label="Name"
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button
            type="button"
            className="btn primary"
            disabled={!code || !name}
            onClick={() => {
              setMsg('');
              post('/crm/sources', { code, name })
                .then(() => {
                  setCode('');
                  setName('');
                  toast('Source added');
                  list.reload();
                })
                .catch((e: unknown) => setMsg(toUiError(e).message));
            }}
          >
            ＋ Add source
          </button>
        </div>
      ) : null}
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {(list.data ?? []).map((r) => (
              <tr key={s(r.id)}>
                <td>{s(r.code)}</td>
                <td>{s(r.name)}</td>
                <td>
                  <Pill>{s(r.status)}</Pill>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ------------------------------------------------------------------------------------------------ quotations page
export function SalesQuotationsPage({ actions }: { actions: ActionSet }) {
  const [tab, setTab] = useState<'rfq' | 'quote'>('quote');
  return (
    <>
      <div className="tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'quote'}
          className={tab === 'quote' ? 'tab active' : 'tab'}
          onClick={() => setTab('quote')}
        >
          Quotation Register
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'rfq'}
          className={tab === 'rfq' ? 'tab active' : 'tab'}
          onClick={() => setTab('rfq')}
        >
          Customer RFQs (internal review)
        </button>
      </div>
      {tab === 'quote' ? (
        <DocPage cfg={SQ_CFG} actions={actions} />
      ) : (
        <DocPage cfg={CRFQ_CFG} actions={actions} />
      )}
    </>
  );
}

// ------------------------------------------------------------------------------------------------ dispatch
export function DispatchPage({ actions }: { actions: ActionSet }) {
  const toast = useToast();
  const list = useLoad(() => listDocs('/sales/dispatch', { size: 50 }), []);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<Doc | null>(null);
  const [msg, setMsg] = useState('');
  const [reason, setReason] = useState('');
  async function run(fn: () => Promise<unknown>, text: string, id: string) {
    setMsg('');
    try {
      await fn();
      setOpen(await getDoc('/sales/dispatch', id));
      toast(text);
      list.reload();
    } catch (e) {
      setMsg(toUiError(e).message);
    }
  }
  async function challan(id: string) {
    try {
      const { blob } = await download(`/sales/dispatch/${id}/challan.pdf`);
      window.open(URL.createObjectURL(blob), '_blank');
    } catch (e) {
      setMsg(toUiError(e).message);
    }
  }
  return (
    <>
      <PageHead
        title="Dispatch"
        sub="Send goods against a sales order. Posting takes the stock out and books the cost; print the delivery challan."
      >
        {actions.add ? (
          <button type="button" className="btn primary" onClick={() => setCreating(true)}>
            ＋ New Dispatch
          </button>
        ) : null}
      </PageHead>
      <ErrorBox message={msg || list.error} />
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Challan</th>
              <th>Customer</th>
              <th>Date</th>
              <th>Vehicle</th>
              <th>Cost</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {(list.data?.rows ?? []).length === 0 && !list.loading ? (
              <Empty cols={6}>No dispatches yet. Click ＋ New Dispatch.</Empty>
            ) : null}
            {(list.data?.rows ?? []).map((d) => (
              <tr key={d.id}>
                <td>
                  <button
                    type="button"
                    className="link"
                    onClick={() => void getDoc('/sales/dispatch', d.id).then(setOpen)}
                  >
                    {s(d.number)}
                  </button>
                </td>
                <td>{s(d.customerName)}</td>
                <td>{dmy(s(d.dispatchDate))}</td>
                <td>{s(d.vehicleNo) || '—'}</td>
                <td>{inr(s(d.costTotal))}</td>
                <td>
                  <Pill>{d.status}</Pill>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {creating ? (
        <DispatchForm
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
        <Modal
          title={`Dispatch ${s(open.number)}`}
          sub={`${s(open.customerName)} · order ${s(open.orderNo)}`}
          onClose={() => setOpen(null)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => void challan(open.id)}>
                Print challan
              </button>
              {open.status === 'Draft' && actions.submit ? (
                <button
                  type="button"
                  className="btn primary"
                  onClick={() =>
                    void run(
                      () => verb('/sales/dispatch', open.id, 'submit', {}, open.version),
                      'Submitted',
                      open.id,
                    )
                  }
                >
                  Submit
                </button>
              ) : null}
              {open.status === 'Approved' && actions.post ? (
                <button
                  type="button"
                  className="btn primary"
                  onClick={() =>
                    void run(() => verb('/sales/dispatch', open.id, 'post'), 'Posted', open.id)
                  }
                >
                  Post
                </button>
              ) : null}
              {open.status === 'Posted' ? (
                <EmailDocButton docType="SALES_DISPATCH" docId={s(open.id)} />
              ) : null}
              {open.status === 'Posted' && actions.cancel ? (
                <button
                  type="button"
                  className="btn danger"
                  disabled={reason.trim().length < 5}
                  title={reason.trim().length < 5 ? 'Type a reason first' : undefined}
                  onClick={() =>
                    void run(
                      () => verb('/sales/dispatch', open.id, 'cancel', { reason }),
                      'Cancelled',
                      open.id,
                    )
                  }
                >
                  Cancel dispatch
                </button>
              ) : null}
            </>
          }
        >
          <ErrorBox message={msg} />
          <p>
            <Pill>{open.status}</Pill> Vehicle {s(open.vehicleNo) || '—'} · Transporter{' '}
            {s(open.transporter) || '—'}
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Item</th>
                  <th>Part no / colour</th>
                  <th>Qty</th>
                  <th>Inspection serial</th>
                  <th>Invoiced</th>
                </tr>
              </thead>
              <tbody>
                {rowsOf(open.lines).map((l) => (
                  <tr key={s(l.id)}>
                    <td>{s(l.lineNo)}</td>
                    <td>
                      {s(l.itemCode)} {s(l.itemName)}
                    </td>
                    <td>{`${s(l.partNo)} ${s(l.colour)}`.trim() || '—'}</td>
                    <td>{s(l.qty)}</td>
                    <td>{s(l.inspectionSerial) || '—'}</td>
                    <td>{s(l.invoicedQty)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {open.status === 'Posted' ? (
            <div className="field">
              <label htmlFor="dr">Reason (to cancel)</label>
              <input id="dr" value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
          ) : null}
        </Modal>
      ) : null}
    </>
  );
}

function DispatchForm({ onClose, onSaved }: { onClose: () => void; onSaved: (d: Doc) => void }) {
  const orders = useLoad(() => listDocs('/sales/orders', { status: 'Approved', size: 100 }), []);
  const whs = useLoad<Ref[]>(() => lookupWarehouses(), []);
  const [orderId, setOrderId] = useState('');
  const [wh, setWh] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [transporter, setTransporter] = useState('');
  const [lines, setLines] = useState<
    { orderLineId: string; label: string; open: string; qty: string; serial: string }[]
  >([]);
  const [msg, setMsg] = useState('');
  async function pick(id: string) {
    setOrderId(id);
    setLines([]);
    if (!id) return;
    try {
      const r = await getJson<{ lines: Row[] }>(`/sales/dispatch/from-order/${id}`);
      setLines(
        r.lines.map((l) => ({
          orderLineId: s(l.orderLineId),
          label: `${s(l.itemCode)} · ${s(l.itemName)}`,
          open: s(l.openQty),
          qty: s(l.openQty),
          serial: '',
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
        await createDoc('/sales/dispatch', {
          orderId,
          warehouseId: wh,
          vehicleNo: vehicle || undefined,
          transporter: transporter || undefined,
          lines: lines
            .filter((l) => Number(l.qty) > 0)
            .map((l) => ({
              orderLineId: l.orderLineId,
              qty: l.qty,
              ...(l.serial ? { inspectionSerial: l.serial } : {}),
            })),
        }),
      );
    } catch (e) {
      setMsg(toUiError(e).message);
    }
  }
  return (
    <Modal
      title="New Dispatch"
      sub="Pick the order; the lines come pre-filled with what is still to send."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={!orderId || !wh || lines.length === 0}
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
          <label htmlFor="so">Sales order *</label>
          <select id="so" value={orderId} onChange={(e) => void pick(e.target.value)}>
            <option value="">Choose…</option>
            {(orders.data?.rows ?? []).map((o) => (
              <option key={o.id} value={o.id}>
                {s(o.number)} · {s(o.customerName)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="dw">Send from warehouse *</label>
          <select id="dw" value={wh} onChange={(e) => setWh(e.target.value)}>
            <option value="">Choose…</option>
            {(whs.data ?? []).map((w) => (
              <option key={w.id} value={w.id}>
                {w.code} · {w.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="dv">Vehicle no.</label>
          <input id="dv" value={vehicle} onChange={(e) => setVehicle(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="dt">Transporter</label>
          <input id="dt" value={transporter} onChange={(e) => setTransporter(e.target.value)} />
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th>Still to send</th>
              <th>Send now</th>
              <th>Inspection serial</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={l.orderLineId}>
                <td>{l.label}</td>
                <td>{l.open}</td>
                <td>
                  <input
                    aria-label={`Send ${l.label}`}
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
                  <input
                    aria-label={`Serial ${l.label}`}
                    value={l.serial}
                    onChange={(e) =>
                      setLines((ls) =>
                        ls.map((x, j) => (j === i ? { ...x, serial: e.target.value } : x)),
                      )
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ invoices
export function SalesInvoicesPage({ actions }: { actions: ActionSet }) {
  const toast = useToast();
  const list = useLoad(() => listDocs('/sales/invoices', { size: 50 }), []);
  const disp = useLoad(() => listDocs('/sales/dispatch', { status: 'Posted', size: 100 }), []);
  const [dispatchId, setDispatchId] = useState('');
  const [open, setOpen] = useState<Doc | null>(null);
  const [msg, setMsg] = useState('');
  const [reason, setReason] = useState('');
  async function run(fn: () => Promise<unknown>, text: string, id: string) {
    setMsg('');
    try {
      await fn();
      setOpen(await getDoc('/sales/invoices', id));
      toast(text);
      list.reload();
    } catch (e) {
      setMsg(toUiError(e).message);
    }
  }
  return (
    <>
      <PageHead
        title="Sales Invoices"
        sub="Bill a dispatch. Posting books the receivable, the sale and the output GST."
      >
        {actions.add ? (
          <>
            <select
              aria-label="Dispatch to invoice"
              value={dispatchId}
              onChange={(e) => setDispatchId(e.target.value)}
            >
              <option value="">Choose a dispatch…</option>
              {(disp.data?.rows ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {s(d.number)} · {s(d.customerName)}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn primary"
              disabled={!dispatchId}
              onClick={() => {
                setMsg('');
                createDoc('/sales/invoices', { dispatchId })
                  .then((d) => {
                    toast(`Invoice ${s(d.number)} saved as draft`);
                    setOpen(d);
                    list.reload();
                  })
                  .catch((e: unknown) => setMsg(toUiError(e).message));
              }}
            >
              ＋ Invoice this dispatch
            </button>
          </>
        ) : null}
      </PageHead>
      <ErrorBox message={msg || list.error} />
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Invoice</th>
              <th>Customer</th>
              <th>Date</th>
              <th>Due</th>
              <th>Total</th>
              <th>Received</th>
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
                    onClick={() => void getDoc('/sales/invoices', i.id).then(setOpen)}
                  >
                    {s(i.number)}
                  </button>
                </td>
                <td>{s(i.customerName)}</td>
                <td>{dmy(s(i.invoiceDate))}</td>
                <td>{dmy(s(i.dueDate))}</td>
                <td>{inr(s(i.grandTotal))}</td>
                <td>{inr(s(i.receivedAmount))}</td>
                <td>
                  <Pill>{i.status}</Pill>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {open ? (
        <Modal
          title={`Invoice ${s(open.number)}`}
          sub={s(open.customerName)}
          onClose={() => setOpen(null)}
          footer={
            <>
              {open.status === 'Draft' && actions.submit ? (
                <button
                  type="button"
                  className="btn primary"
                  onClick={() =>
                    void run(
                      () => verb('/sales/invoices', open.id, 'submit', {}, open.version),
                      'Submitted',
                      open.id,
                    )
                  }
                >
                  Submit
                </button>
              ) : null}
              {open.status === 'Approved' && actions.post ? (
                <button
                  type="button"
                  className="btn primary"
                  onClick={() =>
                    void run(() => verb('/sales/invoices', open.id, 'post'), 'Posted', open.id)
                  }
                >
                  Post
                </button>
              ) : null}
              {open.status === 'Posted' ? (
                <EmailDocButton docType="SALES_INVOICE" docId={s(open.id)} />
              ) : null}
              {open.status === 'Posted' && actions.cancel ? (
                <button
                  type="button"
                  className="btn danger"
                  disabled={reason.trim().length < 5}
                  title={reason.trim().length < 5 ? 'Type a reason first' : undefined}
                  onClick={() =>
                    void run(
                      () => verb('/sales/invoices', open.id, 'cancel', { reason }),
                      'Cancelled',
                      open.id,
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
          <p>
            <Pill>{open.status}</Pill> Receipt: {s(open.receiptStatus)}
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Item</th>
                  <th>Qty</th>
                  <th>Rate</th>
                  <th>Taxable</th>
                  <th>GST</th>
                </tr>
              </thead>
              <tbody>
                {rowsOf(open.lines).map((l) => (
                  <tr key={s(l.id)}>
                    <td>{s(l.lineNo)}</td>
                    <td>{s(l.itemCode)}</td>
                    <td>{s(l.qty)}</td>
                    <td>{s(l.rate)}</td>
                    <td>{inr(s(l.taxable))}</td>
                    <td>
                      {inr(String(Number(s(l.cgst)) + Number(s(l.sgst)) + Number(s(l.igst))))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            <b>Total {inr(s(open.grandTotal))}</b> (round-off {s(open.roundOff)})
          </p>
          {open.status === 'Posted' ? (
            <div className="field">
              <label htmlFor="ir">Reason (to cancel)</label>
              <input id="ir" value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
          ) : null}
        </Modal>
      ) : null}
    </>
  );
}

// ------------------------------------------------------------------------------------------------ returns
export function SalesReturnsPage({ actions }: { actions: ActionSet }) {
  const toast = useToast();
  const list = useLoad(() => listDocs('/sales/returns', { size: 50 }), []);
  const invs = useLoad(() => listDocs('/sales/invoices', { status: 'Posted', size: 100 }), []);
  const whs = useLoad<Ref[]>(() => lookupWarehouses(), []);
  const [invoiceId, setInvoiceId] = useState('');
  const [wh, setWh] = useState('');
  const [lines, setLines] = useState<
    { invoiceLineId: string; label: string; qty: string; max: string }[]
  >([]);
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState('');
  async function pick(id: string) {
    setInvoiceId(id);
    setLines([]);
    if (!id) return;
    const inv = await getDoc('/sales/invoices', id);
    setLines(
      rowsOf(inv.lines).map((l) => ({
        invoiceLineId: s(l.id),
        label: `${s(l.itemCode)} (billed ${s(l.qty)})`,
        qty: '',
        max: s(l.qty),
      })),
    );
  }
  return (
    <>
      <PageHead
        title="Sales Returns"
        sub="Goods a customer sends back. Posting restocks them at the dispatch cost and makes the credit note."
      />
      <ErrorBox message={msg || list.error} />
      {actions.add ? (
        <div className="card">
          <div className="form-grid">
            <div className="field">
              <label htmlFor="ri">Invoice *</label>
              <select id="ri" value={invoiceId} onChange={(e) => void pick(e.target.value)}>
                <option value="">Choose…</option>
                {(invs.data?.rows ?? []).map((i) => (
                  <option key={i.id} value={i.id}>
                    {s(i.number)} · {s(i.customerName)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="rw">Receive into warehouse *</label>
              <select id="rw" value={wh} onChange={(e) => setWh(e.target.value)}>
                <option value="">Choose…</option>
                {(whs.data ?? []).map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.code} · {w.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="rr">Reason</label>
              <input id="rr" value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
          </div>
          {lines.map((l, i) => (
            <div className="field" key={l.invoiceLineId}>
              <label htmlFor={`rq-${i}`}>Return of {l.label}</label>
              <input
                id={`rq-${i}`}
                type="number"
                value={l.qty}
                onChange={(e) =>
                  setLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))
                }
              />
            </div>
          ))}
          <button
            type="button"
            className="btn primary"
            disabled={!invoiceId || !wh || !lines.some((l) => Number(l.qty) > 0)}
            onClick={() => {
              setMsg('');
              createDoc('/sales/returns', {
                invoiceId,
                warehouseId: wh,
                reason: reason || undefined,
                lines: lines
                  .filter((l) => Number(l.qty) > 0)
                  .map((l) => ({ invoiceLineId: l.invoiceLineId, qty: l.qty })),
              })
                .then((d) => {
                  toast(`Return ${s(d.number)} saved as draft`);
                  void d;
                  list.reload();
                })
                .catch((e: unknown) => setMsg(toUiError(e).message));
            }}
          >
            ＋ Save return
          </button>
        </div>
      ) : null}
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Return</th>
              <th>Customer</th>
              <th>Date</th>
              <th>Credit note</th>
              <th>Credit</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(list.data?.rows ?? []).length === 0 && !list.loading ? (
              <Empty cols={7}>No returns yet.</Empty>
            ) : null}
            {(list.data?.rows ?? []).map((r) => (
              <tr key={r.id}>
                <td>{s(r.number)}</td>
                <td>{s(r.customerName)}</td>
                <td>{dmy(s(r.returnDate))}</td>
                <td>{s(r.creditNoteNo)}</td>
                <td>{inr(s(r.grandTotal))}</td>
                <td>
                  <Pill>{r.status}</Pill>
                </td>
                <td>
                  {r.status === 'Draft' && actions.submit ? (
                    <button
                      type="button"
                      className="btn sm primary"
                      onClick={() => {
                        setMsg('');
                        verb('/sales/returns', r.id, 'submit', {}, r.version)
                          .then(() => {
                            toast('Return submitted');
                            list.reload();
                          })
                          .catch((e: unknown) => setMsg(toUiError(e).message));
                      }}
                    >
                      Submit
                    </button>
                  ) : null}
                  {r.status === 'Approved' && actions.post ? (
                    <button
                      type="button"
                      className="btn sm primary"
                      onClick={() => {
                        setMsg('');
                        verb('/sales/returns', r.id, 'post')
                          .then(() => {
                            toast('Return posted');
                            list.reload();
                          })
                          .catch((e: unknown) => setMsg(toUiError(e).message));
                      }}
                    >
                      Post
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ------------------------------------------------------------------------------------------------ collections
export function CollectionsPage({ actions }: { actions: ActionSet }) {
  const toast = useToast();
  const out = useLoad(
    () => getJson<{ rows: Row[]; customers: Row[] }>('/sales/collections/outstanding'),
    [],
  );
  const [paying, setPaying] = useState<Row | null>(null);
  return (
    <>
      <PageHead
        title="Collections"
        sub="Unpaid invoices by customer, oldest first. Record a receipt against an invoice."
      />
      <ErrorBox message={out.error} />
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Customer</th>
              <th>Invoice</th>
              <th>Due</th>
              <th>Days late</th>
              <th>Outstanding</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(out.data?.rows ?? []).length === 0 && !out.loading ? (
              <Empty cols={6}>Nothing is waiting to be collected.</Empty>
            ) : null}
            {(out.data?.rows ?? []).map((r) => (
              <tr key={s(r.id)} className={Number(r.daysOverdue) > 0 ? 'row-red' : undefined}>
                <td>{s(r.customerName)}</td>
                <td>{s(r.number)}</td>
                <td>{dmy(s(r.dueDate))}</td>
                <td>{s(r.daysOverdue)}</td>
                <td>{inr(s(r.outstanding))}</td>
                <td>
                  {actions.post ? (
                    <button type="button" className="btn sm primary" onClick={() => setPaying(r)}>
                      Receive payment
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {paying ? (
        <ReceiptDialog
          row={paying}
          onClose={() => setPaying(null)}
          onDone={() => {
            setPaying(null);
            toast('Receipt recorded');
            out.reload();
          }}
        />
      ) : null}
    </>
  );
}

function ReceiptDialog({
  row,
  onClose,
  onDone,
}: {
  row: Row;
  onClose: () => void;
  onDone: () => void;
}) {
  const banks = useLoad(
    () => getJson<{ id: string; name: string }[]>('/finance/bank-accounts'),
    [],
  );
  const [bank, setBank] = useState('');
  const [amount, setAmount] = useState(s(row.outstanding));
  const [ref, setRef] = useState('');
  const [mode, setMode] = useState('NEFT');
  const [msg, setMsg] = useState('');
  return (
    <Modal
      title={`Receipt for ${s(row.number)}`}
      sub={s(row.customerName)}
      size="sm"
      onClose={onClose}
      footer={
        <button
          type="button"
          className="btn primary"
          disabled={!bank || Number(amount) <= 0}
          onClick={() => {
            setMsg('');
            post('/sales/receipts', {
              customerId: s(row.customerId),
              bankAccountId: bank,
              amount,
              mode,
              receiptDate: todayIso(),
              reference: ref || undefined,
              allocations: [{ invoiceId: s(row.id), amount }],
            })
              .then(onDone)
              .catch((e: unknown) => setMsg(toUiError(e).message));
          }}
        >
          Record receipt
        </button>
      }
    >
      <ErrorBox message={msg} />
      <div className="field">
        <label htmlFor="rb">Received in *</label>
        <select id="rb" value={bank} onChange={(e) => setBank(e.target.value)}>
          <option value="">Choose…</option>
          {(banks.data ?? []).map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="rm">Mode *</label>
        <select id="rm" value={mode} onChange={(e) => setMode(e.target.value)}>
          {['NEFT', 'RTGS', 'IMPS', 'UPI', 'Cheque', 'Cash'].map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="ra">Amount *</label>
        <input id="ra" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="rf">UTR / cheque no.</label>
        <input id="rf" value={ref} onChange={(e) => setRef(e.target.value)} />
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ delivery scheduling
export function DeliveryPlanPage() {
  const plan = useLoad(() => getJson<Row[]>('/sales/demand-plan'), []);
  return (
    <>
      <PageHead
        title="Delivery Scheduling"
        sub="What still has to be delivered, by month: confirmed order balance plus forecasts. This feeds production planning."
      />
      <ErrorBox message={plan.error} />
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Month</th>
              <th>Item</th>
              <th>Confirmed orders</th>
              <th>Forecast</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {(plan.data ?? []).length === 0 && !plan.loading ? (
              <Empty cols={5}>No open orders or forecasts.</Empty>
            ) : null}
            {(plan.data ?? []).map((r) => (
              <tr key={`${s(r.itemId)}-${s(r.month)}`}>
                <td>{s(r.month)}</td>
                <td>
                  {s(r.itemCode)} {s(r.itemName)}
                </td>
                <td>{s(r.confirmed)}</td>
                <td>{s(r.forecast)}</td>
                <td>{s(r.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ------------------------------------------------------------------------------------------------ credit limits
export function CreditPage() {
  const list = useLoad(() => getJson<Row[]>('/sales/credit/overview'), []);
  return (
    <>
      <PageHead
        title="Credit Limits"
        sub="What each customer owes and has on order against their limit. A new order that goes over the limit needs a manager override."
      />
      <ErrorBox message={list.error} />
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Customer</th>
              <th>Limit</th>
              <th>Unpaid invoices</th>
              <th>On order</th>
              <th>Exposure</th>
              <th>Available</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {(list.data ?? []).length === 0 && !list.loading ? (
              <Empty cols={7}>No customer has a credit limit yet. Set one in Customer 360.</Empty>
            ) : null}
            {(list.data ?? []).map((r) => (
              <tr key={s(r.id)} className={r.onHold === true ? 'row-red' : undefined}>
                <td>{s(r.name)}</td>
                <td>{inr(s(r.creditLimit))}</td>
                <td>{inr(s(r.receivable))}</td>
                <td>{inr(s(r.openOrders))}</td>
                <td>{inr(s(r.exposure))}</td>
                <td>{inr(s(r.available))}</td>
                <td>
                  {r.onHold === true ? (
                    <Pill tone="rejected">Over limit</Pill>
                  ) : (
                    <Pill tone="approved">Within limit</Pill>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
