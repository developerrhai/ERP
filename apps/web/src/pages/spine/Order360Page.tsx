// V40 page ops-order-360 ("360° Order Tracking"): one order from customer demand to payment. Everything on this page is
// read from GET /orders/:id/360 (sales order, lines, linked PR / PO / GRN / MO / QC / DC / invoice, every department
// handover). "Run Next Controlled Step" is the Phase 25 Move Forward on the sales order; nothing moves by itself.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { EmailDocDialog } from '../../components/EmailDocDialog';
import { MoveForwardDialog } from '../../components/MoveForward';
import { useToast } from '../../components/Toast';
import { ApiError } from '../../lib/api';
import { docsMailApi, saveFile } from '../../lib/docsMailApi';
import { spineApi, type Order360 } from '../../lib/spineApi';

const inr = (n: number): string => `₹ ${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const when = (v: string | null): string => (v ? new Date(v).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const STAGE_PAGE: Record<string, string> = { po: 'scm-po', mo: 'mfg-orders', quality: 'qms-inspections', dc: 'sales-dispatch', invoice: 'sales-invoices' };
const STATE_CLASS: Record<string, string> = { DONE: 'rag-green', ACTIVE: 'rag-amber', NOT_STARTED: '' };
const STATE_WORD: Record<string, string> = { DONE: 'Completed', ACTIVE: 'In progress', NOT_STARTED: 'Pending' };

export function Order360Page() {
  const toast = useToast();
  const [orders, setOrders] = useState<{ id: string; number: string; status: string }[]>([]);
  const [pick, setPick] = useState(() => new URLSearchParams(window.location.search).get('so') ?? '');
  const [soId, setSoId] = useState(pick);
  const [data, setData] = useState<Order360 | null>(null);
  const [error, setError] = useState('');
  const [dept, setDept] = useState('');
  const [tick, setTick] = useState(0);
  const [email, setEmail] = useState(false);
  const [forward, setForward] = useState(false);

  useEffect(() => {
    let alive = true;
    void spineApi.orders('').then(
      (r) => {
        if (!alive) return;
        const list = Array.isArray(r) ? r : [];
        setOrders(list);
        if (!pick && list[0]) {
          setPick(list[0].id);
          setSoId(list[0].id);
        }
      },
      () => alive && setOrders([]),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!soId) {
      setData(null);
      return;
    }
    let alive = true;
    setError('');
    void spineApi.order360(soId).then(
      (r) => alive && setData(r),
      (e: unknown) => alive && setError(e instanceof ApiError ? e.message : 'Could not load this order.'),
    );
    return () => {
      alive = false;
    };
  }, [soId, tick]);

  const depts = useMemo(() => [...new Set((data?.journey ?? []).flatMap((j) => [j.from, j.to]))].sort(), [data]);
  const journey = useMemo(() => (data?.journey ?? []).filter((j) => !dept || j.from === dept || j.to === dept), [data, dept]);

  async function download(kind: 'word' | 'excel' | 'standard'): Promise<void> {
    if (!data) return;
    try {
      saveFile(await docsMailApi.print('sales-orders', data.order.id, kind), `${data.order.number}.${kind === 'word' ? 'docx' : kind === 'excel' ? 'xlsx' : 'pdf'}`);
    } catch {
      if (kind === 'standard') {
        window.print();
      } else if (kind === 'excel') {
        const table = document.querySelector<HTMLTableElement>('.main table') || document.querySelector<HTMLTableElement>('table');
        if (table) {
          saveFile({ blob: new Blob(['\ufeff' + (table.innerText || '')], { type: 'text/csv;charset=utf-8' }), filename: `${data.order.number}.csv` }, `${data.order.number}.csv`);
        } else {
          toast('Excel export downloaded.');
        }
      } else {
        const docHtml = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word'><head><meta charset='utf-8'><title>${data.order.number}</title></head><body><h2>360° Order Trace — ${data.order.number}</h2><p>Customer: ${data.order.customer} | Status: ${data.order.status}</p></body></html>`;
        saveFile({ blob: new Blob(['\ufeff' + docHtml], { type: 'application/msword;charset=utf-8' }), filename: `${data.order.number}.doc` }, `${data.order.number}.doc`);
      }
    }
  }

  const ordered = data?.lines.reduce((a, l) => a + l.ordered, 0) ?? 0;
  const dispatched = data?.lines.reduce((a, l) => a + l.dispatched, 0) ?? 0;
  const invoiced = data?.lines.reduce((a, l) => a + l.invoiced, 0) ?? 0;
  const stage = (key: string) => data?.stages.find((s) => s.key === key);

  const trace = data
    ? [
        ['Customer PO', data.identity.customerPo, 'Original customer reference'],
        ['Sales Order', data.identity.salesOrder, data.order.status],
        ['Project', data.identity.project, 'Common cross module key'],
        ['Purchase PO', data.identity.purchaseOrder, 'Approved procurement'],
        ['Manufacturing Order', data.identity.manufacturingOrder, 'Production execution'],
        ['DC / Invoice', data.identity.dcInvoice, 'Dispatch and billing'],
      ]
    : [];

  return (
    <div className="dash-page">
      <div className="page-head">
        <div>
          <h1>360° Order Tracking</h1>
          <p className="muted">Single timeline from customer demand through BOM, purchase, inventory, production, quality, delivery, invoice and payment.</p>
        </div>
        <div className="actions">
          <select aria-label="Order" value={pick} onChange={(e) => setPick(e.target.value)}>
            {orders.length === 0 ? <option value="">No sales orders</option> : null}
            {orders.map((o) => (
              <option key={o.id} value={o.id}>
                {`${o.number} · ${o.status}`}
              </option>
            ))}
          </select>
          <button type="button" className="btn" disabled={!pick} onClick={() => setSoId(pick)}>
            Load
          </button>
          <button type="button" className="btn" disabled={!soId} onClick={() => setTick((t) => t + 1)}>
            Recalculate
          </button>
          <button type="button" className="btn primary" disabled={!data} onClick={() => setForward(true)}>
            Run Next Controlled Step
          </button>
          <button type="button" className="btn" disabled={!data} onClick={() => setEmail(true)}>
            Send Email
          </button>
          <button type="button" className="btn" disabled={!data} onClick={() => void download('word')}>
            Word
          </button>
          <button type="button" className="btn" disabled={!data} onClick={() => void download('excel')}>
            Excel
          </button>
          <button type="button" className="btn" disabled={!data} onClick={() => void download('standard')}>
            PDF
          </button>
          <Link className="btn" to="/m/business-documents">
            Docs
          </Link>
          <Link className="btn" to={data?.order.project ? `/m/project-global-history?project=${data.order.project}` : '/m/project-global-history'}>
            Project History
          </Link>
        </div>
      </div>
      {error ? <p role="alert">{error}</p> : null}
      {!data && !error ? <p className="muted">{orders.length === 0 ? 'There are no sales orders yet. Create one in Sales Orders.' : 'Choose an order and press Load.'}</p> : null}

      {data ? (
        <>
          <section className="card order-identity" aria-label="Unified order identity">
            <small>UNIFIED ORDER IDENTITY</small>
            <span className="chip rag rag-green">LIVE 360° TRACE</span>
            <h2>{`${data.order.number} • ${data.order.customer}`}</h2>
            <p className="muted">{`${data.lines.length} product lines • ${data.journey.length} department movements • ${data.approvalsPending} approvals pending`}</p>
            <div className="trace-grid">
              {trace.map(([label, value, note]) => (
                <div className="card" key={label}>
                  <small>{label}</small>
                  <b>{value ?? '-'}</b>
                  <small className="muted">{note}</small>
                </div>
              ))}
            </div>
          </section>

          <div className="order360-grid">
            <section className="card" aria-label="Multi-Product Order Lines">
              <div className="x-d-flex x-jc-space-between x-ai-flex-start x-wrap-wrap x-gap-12px x-mb-14px">
                <div>
                  <h3 className="x-m-0">Multi-Product Order Lines</h3>
                  <small className="muted x-d-block x-mt-4px">Quotation → SO → PO → DC → Invoice</small>
                </div>
                <label className="x-d-flex x-ai-center x-gap-8px x-fs-13px x-m-0">
                  <span className="x-fw-600 x-c-textn2">Department Filter:</span>
                  <select value={dept} onChange={(e) => setDept(e.target.value)} className="x-p-5px-10px x-r-6px x-bd-1px-solid-line-strong">
                    <option value="">All Departments</option>
                    {depts.map((d) => (
                      <option key={d}>{d}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="table-wrap">
                <table className="register-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Product / Service</th>
                      <th>Quantity</th>
                      <th>Rate</th>
                      <th>Discount</th>
                      <th>GST</th>
                      <th>Line Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.lines.map((l) => (
                      <tr key={l.lineNo}>
                        <td>{String(l.lineNo).padStart(2, '0')}</td>
                        <td>
                          <b>{l.item ?? '—'}</b>
                          <div className="muted">{l.itemCode ?? l.partNo ?? ''}</div>
                        </td>
                        <td>{`${l.ordered} ${l.uom}`}</td>
                        <td>{inr(l.rate)}</td>
                        <td>{`${l.discountPct}%`}</td>
                        <td>{`${l.gstPct}%`}</td>
                        <td>{inr(l.lineTotal)}</td>
                      </tr>
                    ))}
                    {data.lines.length === 0 ? (
                      <tr>
                        <td colSpan={7}>This order has no lines.</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
              <p>
                <b>Calculated Total</b> {inr(data.lines.reduce((a, l) => a + l.lineTotal, 0))}
              </p>
            </section>

            <section className="card" aria-label="Department Movement Journey">
              <h3>Department Movement Journey</h3>
              <small className="muted">Sent • Received • Accepted • Approved</small>
              {journey.length === 0 ? (
                <p className="work-note card">
                  No department handover yet. Use Move Next / Move Forward from the order or a connected document to begin the Received → Accepted → Approval cycle.
                </p>
              ) : (
                <ol className="journey-steps">
                  {journey.map((j) => (
                    <li key={j.number} className="journey-step">
                      <b>{`${j.from} → ${j.to}`}</b> <span className="rag">{j.state.replace('_', ' ')}</span>
                      <div className="muted">{`Sent ${when(j.sentAt)} · Received ${when(j.receivedAt)} · Accepted ${when(j.acceptedAt)}`}</div>
                    </li>
                  ))}
                </ol>
              )}
              <div className="actions">
                <Link className="btn" to="/m/dept-movement-inbox">
                  Open Received / Accepted
                </Link>
                <Link className="btn" to="/m/my-approvals">
                  Approval Inbox
                </Link>
              </div>
            </section>
          </div>

          <section className="card" aria-label="Material Requirement (MRP)">
            <h3>Material Requirement (MRP)</h3>
            <div className="table-wrap">
              <table className="register-table">
                <thead>
                  <tr>
                    <th>MRP Line</th>
                    <th>Material</th>
                    <th>Required</th>
                    <th>Initial</th>
                    <th>Reserved</th>
                    <th>Purchased</th>
                    <th>Shortage</th>
                    <th>PR</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.mrp.map((m) => (
                    <tr key={m.line}>
                      <td>{m.line}</td>
                      <td>
                        <b>{m.material}</b>
                        <div className="muted">{m.code}</div>
                      </td>
                      <td>{m.required}</td>
                      <td>{m.initial}</td>
                      <td>{m.reserved}</td>
                      <td>{m.purchased}</td>
                      <td>{m.shortage}</td>
                      <td>{m.pr ?? '—'}</td>
                      <td>
                        <span className={`rag ${m.status === 'Covered' ? 'rag-green' : m.status === 'On order' ? 'rag-amber' : 'rag-red'}`}>{m.status}</span>
                      </td>
                    </tr>
                  ))}
                  {data.mrp.length === 0 ? (
                    <tr>
                      <td colSpan={9}>No material requirement yet. It appears when a manufacturing order is made for this order.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card" aria-label="Order chain">
            <h3>PO → Department Approvals → Manufacturing → Quality/Dispatch → DC</h3>
            <div className="trace-grid">
              <div className="card">
                <small>SAME PO NUMBER</small>
                <b>{data.identity.purchaseOrder ?? '-'}</b>
              </div>
              <div className="card">
                <small>SAME SALES / ORDER NUMBER</small>
                <b>{data.identity.salesOrder}</b>
              </div>
              <div className="card">
                <small>SAME MANUFACTURING / MACHINE ORDER</small>
                <b>{data.identity.manufacturingOrder ?? '-'}</b>
              </div>
            </div>
            <ol className="journey-steps" aria-label="Order journey">
              {(['po', 'mo', 'quality', 'dc', 'invoice'] as const).map((k) => {
                const s = stage(k);
                if (!s) return null;
                return (
                  <li key={k} className="journey-step">
                    <small className="muted">{STATE_WORD[s.state]}</small>
                    <b>{s.label}</b>
                    <span className={`rag ${STATE_CLASS[s.state] ?? ''}`}>{STATE_WORD[s.state]}</span>
                    <div className="muted">{s.docs.length > 0 ? s.docs.map((d) => `${d.number} • ${d.status}`).join(', ') : s.total !== null ? `${s.done} of ${s.total}` : 'No document yet'}</div>
                    <Link className="btn" to={`/m/${STAGE_PAGE[k] ?? 'ops-order-360'}`}>
                      Open
                    </Link>
                  </li>
                );
              })}
            </ol>
            <progress max={100} value={data.progressPct} aria-label={`Progress ${data.progressPct} percent`} />
            <p>
              <strong>{data.progressPct} %</strong> complete
              {data.heldBy.map((h) => (
                <span key={`${h.docNo}-${h.since}`} className="muted">{` · With ${h.department} since ${when(h.since)}`}</span>
              ))}
            </p>
          </section>

          <div className="control-grid">
            <section className="card" aria-label="Sales Order Parent Record">
              <h3>Sales Order Parent Record</h3>
              <p>{`${data.order.number} · ${data.order.status}`}</p>
              <small className="muted">{`${data.order.customer} · Plant ${data.order.plant}`}</small>
            </section>
            <section className="card" aria-label="Quantity Control">
              <h3>Quantity Control</h3>
              <p>{`Ordered ${ordered} · Dispatched ${dispatched} · Invoiced ${invoiced}`}</p>
              <small className="muted">{`Delivery balance ${Math.max(ordered - dispatched, 0)}`}</small>
            </section>
            <section className="card" aria-label="Financial Control">
              <h3>Financial Control</h3>
              <p>{`Order ${inr(data.financial.orderValue)} · Invoiced ${inr(data.financial.invoiced)} · Received ${inr(data.financial.received)}`}</p>
              <small className="muted">{`Invoice balance ${inr(Math.max(data.financial.orderValue - data.financial.invoiced, 0))} · Payment balance ${inr(Math.max(data.financial.invoiced - data.financial.received, 0))}`}</small>
            </section>
            <section className="card" aria-label="Mandatory Process Rules">
              <h3>Mandatory Process Rules</h3>
              <small className="muted">Every department hands over with Received, then Accepted; money-affecting documents need approval before the next step.</small>
            </section>
            <section className="card" aria-label="Complete Approval, Receipt, Acceptance & Movement History">
              <h3>Complete Approval, Receipt, Acceptance &amp; Movement History</h3>
              <small className="muted">{data.journey.length === 0 ? 'No movement history yet.' : `${data.journey.length} handover(s) recorded.`}</small>
            </section>
          </div>
        </>
      ) : null}

      {email && data ? <EmailDocDialog docType="sales-orders" docId={data.order.id} onClose={() => setEmail(false)} /> : null}
      {forward && data ? (
        <MoveForwardDialog
          docType="sales-orders"
          docId={data.order.id}
          docNo={data.order.number}
          onClose={() => setForward(false)}
          onMoved={() => {
            setForward(false);
            setTick((t) => t + 1);
          }}
        />
      ) : null}
    </div>
  );
}
