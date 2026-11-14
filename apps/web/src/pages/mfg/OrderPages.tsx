// Phase 13 production orders, job cards (work orders) and finished-goods receipts. The server holds every rule: approval above
// the limit, material issue limits, WIP posting, the quality hold on finished goods. The screens collect and show.
import { useState } from 'react';
import { useToast } from '../../components/Toast';
import { toUiError } from '../../lib/errors';
import { mget, mlist, mpost } from '../../lib/mfgApi';
import type { Row } from '../../lib/mfgApi';
import { useLoad } from '../../lib/useLoad';
import type { ActionSet } from '../../types';
import { dmy, ErrorBox, inr, PageHead, Pill, todayIso } from '../finance/shared';
import { RefPicker, Tabs } from '../qms/Shared';
import { JobWorkTab } from './JobWork';
import { JobCardPanel } from './JobCard';
import { FileButton, ORDER_TONE, OptionSelect, s, useWarehouses, useWorkCentres } from './Kit';
import { Act, Dialog, Grid, ReasonAct, num } from './Ui';
import { DateField } from '../../ui/components';

const STATUSES = [
  'Planned',
  'Pending Approval',
  'Released',
  'In Progress',
  'Completed',
  'Closed',
  'Cancelled',
];

export function OrdersPage({ actions }: { actions: ActionSet }) {
  const [tab, setTab] = useState<'orders' | 'jobwork'>('orders');
  return (
    <>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          ['orders', 'Production orders'],
          ['jobwork', 'Job work (customer PO lines)'],
        ]}
      />
      {tab === 'orders' ? <OrderList actions={actions} /> : <JobWorkTab actions={actions} />}
    </>
  );
}

function OrderList({ actions }: { actions: ActionSet }) {
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [view, setView] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const list = useLoad(() => mlist('/production-orders', { status, q }), [status, q]);
  return (
    <>
      <PageHead
        title="Production Orders"
        sub="Plan an order from a released BOM, release it (a big order waits for approval), issue material, run the job cards, receive finished goods and close."
      />
      <div className="toolbar">
        <input
          aria-label="Search orders"
          placeholder="Search order or item"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {STATUSES.map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
        {actions.add ? (
          <button type="button" className="btn primary" onClick={() => setAdding(true)}>
            + New production order
          </button>
        ) : null}
        {actions.print ? (
          <FileButton path="/export/orders" name="mfg-orders.xlsx" label="Export Excel" />
        ) : null}
      </div>
      <ErrorBox message={list.error} />
      <Grid
        rows={list.data?.rows ?? []}
        loading={list.loading}
        empty="No production orders yet."
        rowKey={(r) => s(r.id)}
        cols={[
          { h: 'Order', r: (r) => s(r.number) },
          { h: 'Item', r: (r) => `${s(r.itemCode)} · ${s(r.itemName)}` },
          { h: 'Quantity', r: (r) => num(r.qty) },
          { h: 'Made', r: (r) => num(r.qtyCompleted) },
          { h: 'In stock', r: (r) => num(r.qtyReceived) },
          { h: 'Due', r: (r) => dmy(s(r.dueDate).slice(0, 10)) },
          { h: 'Status', r: (r) => <Pill tone={ORDER_TONE[s(r.status)]}>{s(r.status)}</Pill> },
          {
            h: '',
            r: (r) => (
              <button type="button" className="btn" onClick={() => setView(s(r.id))}>
                Open
              </button>
            ),
          },
        ]}
      />
      {view ? (
        <OrderView
          id={view}
          actions={actions}
          onClose={() => setView(null)}
          onChanged={() => list.reload()}
        />
      ) : null}
      {adding ? (
        <OrderForm
          onClose={() => setAdding(false)}
          onSaved={(id) => {
            setAdding(false);
            list.reload();
            setView(id);
          }}
        />
      ) : null}
    </>
  );
}

function OrderForm({ onClose, onSaved }: { onClose: () => void; onSaved: (id: string) => void }) {
  const whs = useWarehouses();
  const [f, setF] = useState({
    itemId: '',
    itemLabel: '',
    qty: '',
    dueDate: todayIso(),
    warehouseId: '',
    rmWarehouseId: '',
    customerPoNo: '',
  });
  const [msg, setMsg] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (p: Partial<typeof f>) => setF((o) => ({ ...o, ...p }));
  const err = (k: string) =>
    errors[k] ? (
      <div className="field-error" role="alert">
        {errors[k]}
      </div>
    ) : null;
  return (
    <Dialog
      title="New production order"
      onClose={onClose}
      error={msg}
      footer={
        <button
          type="button"
          className="btn primary"
          onClick={() => {
            setMsg('');
            setErrors({});
            mpost('/production-orders', {
              itemId: f.itemId,
              qty: f.qty,
              dueDate: f.dueDate,
              warehouseId: f.warehouseId,
              rmWarehouseId: f.rmWarehouseId,
              ...(f.customerPoNo ? { customerPoNo: f.customerPoNo } : {}),
            })
              .then((r) => onSaved(s(r.id)))
              .catch((e: unknown) => {
                const u = toUiError(e);
                setMsg(u.message);
                setErrors(u.fields);
              });
          }}
        >
          Create
        </button>
      }
    >
      <div className="form-grid">
        <div className="field">
          <label htmlFor="po-item">Item to make *</label>
          <RefPicker
            id="po-item"
            kind="item"
            value={f.itemId}
            label={f.itemLabel}
            onChange={(i, l) => set({ itemId: i, itemLabel: l })}
          />
          {err('itemId')}
        </div>
        <div className="field">
          <label htmlFor="po-qty">Quantity *</label>
          <input
            id="po-qty"
            type="number"
            min={0}
            step="any"
            value={f.qty}
            onChange={(e) => set({ qty: e.target.value })}
          />
          {err('qty')}
        </div>
        <div className="field">
          <label htmlFor="po-due">Due date *</label>
          <DateField
            id="po-due"
            value={f.dueDate}
            onChange={(e) => set({ dueDate: e.target.value })}
          />
          {err('dueDate')}
        </div>
        <div className="field">
          <label htmlFor="po-fg">Finished goods store *</label>
          <OptionSelect
            id="po-fg"
            value={f.warehouseId}
            options={whs.data ?? []}
            onChange={(v) => set({ warehouseId: v })}
          />
          {err('warehouseId')}
        </div>
        <div className="field">
          <label htmlFor="po-rm">Raw material store *</label>
          <OptionSelect
            id="po-rm"
            value={f.rmWarehouseId}
            options={whs.data ?? []}
            onChange={(v) => set({ rmWarehouseId: v })}
          />
          {err('rmWarehouseId')}
        </div>
        <div className="field">
          <label htmlFor="po-cpo">Customer PO</label>
          <input
            id="po-cpo"
            value={f.customerPoNo}
            onChange={(e) => set({ customerPoNo: e.target.value })}
          />
        </div>
      </div>
    </Dialog>
  );
}

function OrderView({
  id,
  actions,
  onClose,
  onChanged,
}: {
  id: string;
  actions: ActionSet;
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const doc = useLoad(() => mget(`/production-orders/${id}`), [id]);
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const [openCard, setOpenCard] = useState<string | null>(null);
  const msg = '';
  const o = doc.data;
  const st = s(o?.status);
  const ver = Number(o?.version ?? 0);
  const after = () => {
    doc.reload();
    onChanged();
  };
  const lines = () =>
    Object.entries(qtys)
      .filter(([, v]) => v !== '' && Number(v) > 0)
      .map(([materialId, qty]) => ({ materialId, qty }));
  const live = ['Released', 'In Progress'].includes(st);
  const cost = (o?.cost ?? {}) as Row;
  return (
    <Dialog
      title={o ? `${s(o.number)} · ${s(o.itemName)}` : 'Production order'}
      sub={o ? `${st} · ${num(o.qty)} ${s(o.uom)} · due ${dmy(s(o.dueDate).slice(0, 10))}` : ''}
      onClose={onClose}
      error={msg || doc.error}
      footer={
        o ? (
          <>
            {st === 'Planned' && actions.post ? (
              <Act
                label="Release"
                primary
                run={() => mpost(`/production-orders/${id}/release`, {}, ver)}
                done={after}
              />
            ) : null}
            {st === 'Pending Approval' && actions.approve ? (
              <Act
                label="Approve and release"
                primary
                run={() => mpost(`/production-orders/${id}/approve`, {}, ver)}
                done={after}
              />
            ) : null}
            {live && actions.post ? (
              <Act
                label="Work is finished"
                run={() => mpost(`/production-orders/${id}/start-complete`, {})}
                sure="All operations are done? The order will move to Completed."
                done={after}
              />
            ) : null}
            {st === 'Completed' && actions.approve ? (
              <Act
                label="Close order"
                primary
                sure="Close the order? Leftover WIP is cleared to scrap loss."
                run={() => mpost(`/production-orders/${id}/close`, {}, ver)}
                done={after}
              />
            ) : null}
            {['Planned', 'Pending Approval', 'Released'].includes(st) && actions.cancel ? (
              <ReasonAct
                label="Cancel order"
                question="Why is it cancelled?"
                run={(reason) => mpost(`/production-orders/${id}/cancel`, { reason }, ver)}
                done={after}
              />
            ) : null}
            {actions.print ? (
              <>
                <FileButton
                  path={`/production-orders/${id}/print`}
                  name="production-order.pdf"
                  label="Print"
                />
                <FileButton
                  path={`/production-orders/${id}/traveller`}
                  name="traveller.pdf"
                  label="Traveller"
                />
              </>
            ) : null}
          </>
        ) : null
      }
    >
      {o ? (
        <>
          <h4>Material</h4>
          <Grid
            rows={(o.materials as Row[] | undefined) ?? []}
            rowKey={(r) => s(r.id)}
            cols={[
              { h: 'Item', r: (r) => `${s(r.itemCode)} · ${s(r.itemName)}` },
              { h: 'Needed', r: (r) => num(r.requiredQty) },
              { h: 'Issued', r: (r) => num(r.issuedQty) },
              { h: 'Returned', r: (r) => num(r.returnedQty) },
              { h: 'How', r: (r) => (s(r.issueMethod) === 'BACKFLUSH' ? 'Backflush' : 'Manual') },
              {
                h: live && actions.post ? 'Issue / return now' : '',
                r: (r) =>
                  live && actions.post && s(r.issueMethod) !== 'BACKFLUSH' ? (
                    <input
                      aria-label={`Quantity ${s(r.itemCode)}`}
                      type="number"
                      min={0}
                      step="any"
                      value={qtys[s(r.id)] ?? ''}
                      onChange={(e) => setQtys((x) => ({ ...x, [s(r.id)]: e.target.value }))}
                    />
                  ) : null,
              },
            ]}
          />
          {live && actions.post ? (
            <div className="toolbar">
              <Act
                label="Issue material"
                primary
                run={() => {
                  const l = lines();
                  if (!l.length) return Promise.reject(new Error('Enter a quantity to issue.'));
                  return mpost(`/production-orders/${id}/issue`, { lines: l });
                }}
                done={() => {
                  setQtys({});
                  after();
                }}
              />
              <Act
                label="Return to store"
                run={() => {
                  const l = lines();
                  if (!l.length) return Promise.reject(new Error('Enter a quantity to return.'));
                  return mpost(`/production-orders/${id}/return`, { lines: l });
                }}
                done={() => {
                  setQtys({});
                  after();
                }}
              />
            </div>
          ) : null}
          <h4>Job cards</h4>
          <Grid
            rows={(o.ops as Row[] | undefined) ?? []}
            rowKey={(r) => s(r.id)}
            empty="Job cards are made when the order is released."
            cols={[
              { h: 'No.', r: (r) => s(r.seq) },
              { h: 'Operation', r: (r) => s(r.name) },
              { h: 'Work center', r: (r) => s(r.workCentreCode) },
              { h: 'Qty in', r: (r) => num(r.qtyIn) },
              { h: 'Good', r: (r) => num(r.qtyDone) },
              { h: 'Scrap', r: (r) => num(r.qtyScrap) },
              { h: 'Status', r: (r) => <Pill tone={ORDER_TONE[s(r.status)]}>{s(r.status)}</Pill> },
              {
                h: '',
                r: (r) => (
                  <button type="button" className="btn" onClick={() => setOpenCard(s(r.id))}>
                    Open card
                  </button>
                ),
              },
            ]}
          />
          <h4>Cost so far</h4>
          <p>
            Material <b>{inr(s(cost.material))}</b> · labour <b>{inr(s(cost.labour))}</b> · overhead{' '}
            <b>{inr(s(cost.overhead))}</b> · abnormal scrap <b>{inr(s(cost.abnormalScrap))}</b> ·
            finished goods <b>{inr(s(cost.fgValue))}</b> · still in WIP <b>{inr(s(cost.wip))}</b>
          </p>
          {((o.receipts as Row[]) ?? []).length ? (
            <>
              <h4>Finished goods received</h4>
              <Grid
                rows={(o.receipts as Row[]) ?? []}
                rowKey={(r) => s(r.id)}
                cols={[
                  { h: 'Receipt', r: (r) => s(r.number) },
                  { h: 'Qty', r: (r) => num(r.qty) },
                  { h: 'Quality', r: (r) => s(r.qcStatus) },
                  { h: 'Unit cost', r: (r) => inr(s(r.unitCost)) },
                  { h: 'Status', r: (r) => s(r.status) },
                ]}
              />
            </>
          ) : null}
          {openCard ? (
            <Dialog title="Job card" onClose={() => setOpenCard(null)} error={msg}>
              <JobCardPanel
                id={openCard}
                actions={actions}
                onChanged={() => {
                  after();
                  toast('Updated');
                }}
              />
            </Dialog>
          ) : null}
        </>
      ) : (
        <p>Loading…</p>
      )}
    </Dialog>
  );
}

// ------------------------------------------------------------------------------------------------ job cards
export function WorkOrdersPage({ actions }: { actions: ActionSet }) {
  const [status, setStatus] = useState('');
  const [wc, setWc] = useState('');
  const [view, setView] = useState<string | null>(null);
  const wcs = useWorkCentres();
  const list = useLoad(() => mlist('/job-cards', { status, workCentreId: wc }), [status, wc]);
  return (
    <>
      <PageHead
        title="Work Orders (Job Cards)"
        sub="One card per operation. Start setup or run, pause with a reason, and complete with the good, rejected, scrap and rework counts. The next card opens when the previous one has pieces."
      />
      <div className="toolbar">
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All cards</option>
          {['Pending', 'In Progress', 'Paused', 'Done'].map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
        <OptionSelect
          id="jc-wc"
          value={wc}
          options={wcs.data ?? []}
          onChange={setWc}
          blank="All work centers"
        />
      </div>
      <ErrorBox message={list.error} />
      <Grid
        rows={list.data?.rows ?? []}
        loading={list.loading}
        empty="No job cards yet. Release a production order to create them."
        rowKey={(r) => s(r.id)}
        cols={[
          { h: 'Order', r: (r) => s(r.orderNumber) },
          { h: 'Item', r: (r) => s(r.itemName) },
          { h: 'Operation', r: (r) => `${s(r.seq)} ${s(r.name)}` },
          { h: 'Work center', r: (r) => s(r.workCentreCode) },
          { h: 'Good', r: (r) => num(r.qtyDone) },
          { h: 'Due', r: (r) => (r.dueDate ? dmy(s(r.dueDate).slice(0, 10)) : '—') },
          { h: 'Status', r: (r) => <Pill tone={ORDER_TONE[s(r.status)]}>{s(r.status)}</Pill> },
          {
            h: '',
            r: (r) => (
              <button type="button" className="btn" onClick={() => setView(s(r.id))}>
                Open
              </button>
            ),
          },
        ]}
      />
      {view ? (
        <Dialog title="Job card" onClose={() => setView(null)}>
          <JobCardPanel id={view} actions={actions} onChanged={() => list.reload()} />
        </Dialog>
      ) : null}
    </>
  );
}

// ------------------------------------------------------------------------------------------------ finished goods
export function FgPage({ actions }: { actions: ActionSet }) {
  const list = useLoad(() => mlist('/production-orders'), []);
  const [view, setView] = useState<string | null>(null);
  const rows = (list.data?.rows ?? []).filter((r) =>
    ['Released', 'In Progress', 'Completed', 'Closed'].includes(s(r.status)),
  );
  return (
    <>
      <PageHead
        title="Finished Goods Receipt"
        sub="Receive good pieces into stock at their WIP cost. If the item needs inspection, the stock waits in quality hold until the Usage Decision."
      />
      <ErrorBox message={list.error} />
      <Grid
        rows={rows}
        loading={list.loading}
        empty="Nothing to receive yet."
        rowKey={(r) => s(r.id)}
        cols={[
          { h: 'Order', r: (r) => s(r.number) },
          { h: 'Item', r: (r) => `${s(r.itemCode)} · ${s(r.itemName)}` },
          { h: 'Made (good)', r: (r) => num(r.qtyCompleted) },
          { h: 'Received', r: (r) => num(r.qtyReceived) },
          { h: 'Status', r: (r) => <Pill tone={ORDER_TONE[s(r.status)]}>{s(r.status)}</Pill> },
          {
            h: '',
            r: (r) => (
              <button type="button" className="btn" onClick={() => setView(s(r.id))}>
                Open
              </button>
            ),
          },
        ]}
      />
      {view ? (
        <ReceiptView
          id={view}
          actions={actions}
          onClose={() => setView(null)}
          onChanged={() => list.reload()}
        />
      ) : null}
    </>
  );
}

function ReceiptView({
  id,
  actions,
  onClose,
  onChanged,
}: {
  id: string;
  actions: ActionSet;
  onClose: () => void;
  onChanged: () => void;
}) {
  const doc = useLoad(() => mget(`/production-orders/${id}`), [id]);
  const [qty, setQty] = useState('');
  const [batch, setBatch] = useState('');
  const o = doc.data;
  const after = () => {
    doc.reload();
    onChanged();
  };
  const receipts = (o?.receipts as Row[] | undefined) ?? [];
  return (
    <Dialog
      title={o ? `${s(o.number)} · ${s(o.itemName)}` : 'Receipt'}
      sub={o ? `Made ${num(o.qtyCompleted)} · received ${num(o.qtyReceived)}` : ''}
      onClose={onClose}
      error={doc.error}
    >
      {actions.post && o && ['Released', 'In Progress', 'Completed'].includes(s(o.status)) ? (
        <div className="toolbar">
          <input
            aria-label="Receive quantity"
            type="number"
            min={0}
            step="any"
            placeholder="Quantity"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
          />
          {o.batchTracked === true ? (
            <input
              aria-label="Batch number"
              placeholder="Batch no."
              value={batch}
              onChange={(e) => setBatch(e.target.value)}
            />
          ) : null}
          <Act
            label="Receive into stock"
            primary
            run={() =>
              mpost('/production-receipts', {
                orderId: id,
                qty,
                ...(batch ? { batchNo: batch } : {}),
              })
            }
            done={() => {
              setQty('');
              after();
            }}
          />
        </div>
      ) : null}
      <Grid
        rows={receipts}
        rowKey={(r) => s(r.id)}
        empty="No receipts yet."
        cols={[
          { h: 'Receipt', r: (r) => s(r.number) },
          { h: 'Date', r: (r) => dmy(s(r.receiptDate).slice(0, 10)) },
          { h: 'Qty', r: (r) => num(r.qty) },
          { h: 'Quality', r: (r) => s(r.qcStatus) },
          { h: 'Value', r: (r) => inr(s(r.amount)) },
          { h: 'Status', r: (r) => s(r.status) },
          {
            h: '',
            r: (r) =>
              actions.cancel && s(r.status) !== 'Cancelled' ? (
                <ReasonAct
                  label="Cancel"
                  question="Why is it cancelled? The stock and the value go back to WIP."
                  run={(reason) => mpost(`/production-receipts/${s(r.id)}/cancel`, { reason })}
                  done={after}
                />
              ) : null,
          },
        ]}
      />
    </Dialog>
  );
}
