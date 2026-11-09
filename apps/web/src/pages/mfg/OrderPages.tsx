// Phase 13 production orders: the order list, and one order panel that serves three screens. Production Orders (plan, release,
// issue material, close), Work Orders (log each operation, close it, start the inspection checkpoint) and Finished Goods
// (final-inspection lot, receipt after the Usage Decision). All quantities and money are server figures.
import { useState } from 'react';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { toUiError } from '../../lib/errors';
import { cmLots } from '../../lib/inventoryApi';
import { mget, mlist, mpatch, mpost } from '../../lib/mfgApi';
import type { Row } from '../../lib/mfgApi';
import { useLoad } from '../../lib/useLoad';
import type { ActionSet } from '../../types';
import { dmy, Empty, ErrorBox, inr, PageHead, Pill, todayIso } from '../finance/shared';
import { Tabs } from '../qms/Shared';
import { JobWorkTab } from './JobWork';
import { FileButton, FormModal, ORDER_TONE, s, useWarehouses } from './Kit';

export type Mode = 'orders' | 'work' | 'fg';
const SCOPE: Record<Mode, string> = { orders: 'mfg-orders', work: 'mfg-workorders', fg: 'mfg-fg' };
const base = (m: Mode): string => (m === 'orders' ? '/orders' : `/orders/for/${SCOPE[m]}`);
const STATUSES = ['Planned', 'Released', 'In Progress', 'Completed', 'Closed', 'Cancelled'];
const n3 = (v: unknown): number => Number(s(v) || 0);
/** Left to arrange on a material line / accepted but not received, rounded to the 3 decimals the server uses. */ const left =
  (m: Row): number =>
    Number((n3(m.requiredQty) - (n3(m.issuedQty) - n3(m.returnedQty))).toFixed(3));
const receivable = (l: Row): number => Number((n3(l.acceptedQty) - n3(l.receivedQty)).toFixed(3));

// ------------------------------------------------------------------------------------------------ dialogs
function IssueDialog({
  order,
  onClose,
  onDone,
}: {
  order: Row;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const materials = (order.materials as Row[]).filter((m) => left(m) > 0);
  const lots = useLoad(
    () =>
      order.customerId
        ? cmLots({ customerId: s(order.customerId), withBalanceOnly: true })
        : Promise.resolve(null),
    [order.customerId],
  );
  const [qty, setQty] = useState<Record<string, string>>(() =>
    Object.fromEntries(materials.map((m) => [s(m.id), String(left(m))])),
  );
  const [lot, setLot] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState('');
  return (
    <Modal
      title="Issue material"
      sub={`To ${s(order.number)} from warehouse ${s(order.rmWarehouseCode)}. Only what the order still needs can be issued.`}
      onClose={onClose}
      footer={
        <button
          type="button"
          className="btn primary"
          onClick={() => {
            setMsg('');
            const lines = materials
              .filter((m) => Number(qty[s(m.id)] || 0) > 0)
              .map((m) => ({
                materialId: s(m.id),
                qty: qty[s(m.id)],
                ...(m.customerSupplied === true && lot[s(m.id)]
                  ? { customerLotId: lot[s(m.id)] }
                  : {}),
              }));
            mpost(`/orders/${s(order.id)}/issue`, { lines })
              .then(() => {
                toast('Material issued');
                onDone();
              })
              .catch((e: unknown) => setMsg(toUiError(e).message));
          }}
        >
          Issue
        </button>
      }
    >
      <ErrorBox message={msg} />
      {materials.length === 0 ? <p>Everything the order needs is already issued.</p> : null}
      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th>Still needed</th>
            <th>Issue now</th>
          </tr>
        </thead>
        <tbody>
          {materials.map((m) => (
            <tr key={s(m.id)}>
              <td>
                {s(m.itemCode)} · {s(m.itemName)}
                {m.customerSupplied === true ? <div className="hint">Customer material</div> : null}
              </td>
              <td>
                {left(m)} {s(m.uom)}
              </td>
              <td>
                <input
                  aria-label={`Issue ${s(m.itemCode)}`}
                  type="number"
                  step="any"
                  min={0}
                  value={qty[s(m.id)] ?? ''}
                  onChange={(e) => setQty((o) => ({ ...o, [s(m.id)]: e.target.value }))}
                />
                {m.customerSupplied === true ? (
                  <select
                    aria-label={`Customer lot ${s(m.itemCode)}`}
                    value={lot[s(m.id)] ?? ''}
                    onChange={(e) => setLot((o) => ({ ...o, [s(m.id)]: e.target.value }))}
                  >
                    <option value="">— customer lot —</option>
                    {(lots.data?.rows ?? [])
                      .filter((l) => l.itemId === s(m.itemId))
                      .map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.challanNo} · balance {l.balanceQty}
                        </option>
                      ))}
                  </select>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}

function ReturnDialog({
  order,
  onClose,
  onDone,
}: {
  order: Row;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const materials = (order.materials as Row[]).filter(
    (m) => m.customerSupplied !== true && n3(m.issuedQty) - n3(m.returnedQty) > 0,
  );
  const [qty, setQty] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState('');
  return (
    <Modal
      title="Return material to the store"
      sub="Unused components go back at the rate they were issued at."
      onClose={onClose}
      footer={
        <button
          type="button"
          className="btn primary"
          onClick={() => {
            setMsg('');
            const lines = materials
              .filter((m) => Number(qty[s(m.id)] || 0) > 0)
              .map((m) => ({ materialId: s(m.id), qty: qty[s(m.id)] }));
            mpost(`/orders/${s(order.id)}/return`, { lines })
              .then(() => {
                toast('Material returned');
                onDone();
              })
              .catch((e: unknown) => setMsg(toUiError(e).message));
          }}
        >
          Return
        </button>
      }
    >
      <ErrorBox message={msg} />
      {materials.length === 0 ? <p>No material is with this order.</p> : null}
      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th>With the order</th>
            <th>Return</th>
          </tr>
        </thead>
        <tbody>
          {materials.map((m) => (
            <tr key={s(m.id)}>
              <td>
                {s(m.itemCode)} · {s(m.itemName)}
              </td>
              <td>{n3(m.issuedQty) - n3(m.returnedQty)}</td>
              <td>
                <input
                  aria-label={`Return ${s(m.itemCode)}`}
                  type="number"
                  step="any"
                  min={0}
                  value={qty[s(m.id)] ?? ''}
                  onChange={(e) => setQty((o) => ({ ...o, [s(m.id)]: e.target.value }))}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ the order panel
function OrderPanel({
  id,
  mode,
  actions,
  onClose,
  onChanged,
}: {
  id: string;
  mode: Mode;
  actions: ActionSet;
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const doc = useLoad(() => mget(`${base(mode)}/${id}`), [id, mode]);
  const [dlg, setDlg] = useState<
    | { t: 'issue' | 'return' | 'edit' | 'cancel' | 'close' }
    | { t: 'log'; op: Row }
    | { t: 'lot'; op: Row | null }
    | { t: 'outside'; op: Row }
    | { t: 'receive'; lot: Row }
    | null
  >(null);
  const [msg, setMsg] = useState('');
  const o = doc.data;
  const done = () => {
    setDlg(null);
    doc.reload();
    onChanged();
  };
  const act = (fn: () => Promise<unknown>, ok: string) => {
    setMsg('');
    fn()
      .then(() => {
        toast(ok);
        done();
      })
      .catch((e: unknown) => setMsg(toUiError(e).message));
  };
  if (!o)
    return (
      <Modal
        title="Production order"
        onClose={onClose}
        footer={
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        }
      >
        <ErrorBox message={doc.error} />
        {doc.loading ? <p>Loading…</p> : null}
      </Modal>
    );
  const status = s(o.status);
  const live = status === 'Released' || status === 'In Progress';
  const ops = o.ops as Row[];
  const cost = o.cost as Row;
  const lots = o.lots as Row[];
  return (
    <Modal
      title={`${s(o.number)} · ${s(o.itemCode)} ${s(o.itemName)}`}
      sub={`${s(o.qty)} ${s(o.uom)} due ${dmy(s(o.dueDate))}${o.customerName ? ` · ${s(o.customerName)}` : ''}`}
      onClose={onClose}
      footer={
        <>
          {mode === 'orders' && actions.print ? (
            <FileButton path={`/orders/${id}/print`} name="production-order.pdf" label="Print" />
          ) : null}
          {mode === 'orders' && status === 'Planned' && actions.edit ? (
            <button type="button" className="btn" onClick={() => setDlg({ t: 'edit' })}>
              Edit
            </button>
          ) : null}
          {mode === 'orders' && status === 'Planned' && actions.approve ? (
            <button
              type="button"
              className="btn primary"
              onClick={() =>
                act(() => mpost(`/orders/${id}/release`, {}, n3(o.version)), 'Order released')
              }
            >
              Release
            </button>
          ) : null}
          {mode === 'orders' && live && actions.post ? (
            <>
              <button type="button" className="btn primary" onClick={() => setDlg({ t: 'issue' })}>
                Issue material
              </button>
              <button type="button" className="btn" onClick={() => setDlg({ t: 'return' })}>
                Return material
              </button>
            </>
          ) : null}
          {mode === 'orders' && status === 'Completed' && actions.post ? (
            <button type="button" className="btn" onClick={() => setDlg({ t: 'close' })}>
              Close order
            </button>
          ) : null}
          {mode === 'orders' &&
          (status === 'Planned' || status === 'Released') &&
          actions.cancel ? (
            <button type="button" className="btn" onClick={() => setDlg({ t: 'cancel' })}>
              Cancel order
            </button>
          ) : null}
          {mode === 'fg' && (live || status === 'Completed') && actions.add ? (
            <button
              type="button"
              className="btn primary"
              onClick={() => setDlg({ t: 'lot', op: null })}
            >
              Send finished pieces for final inspection
            </button>
          ) : null}
        </>
      }
    >
      <ErrorBox message={msg || doc.error} />
      <p>
        <Pill tone={ORDER_TONE[status]}>{status}</Pill> Made (good) <b>{s(o.qtyCompleted)}</b> ·
        scrapped <b>{s(o.qtyScrapped)}</b> · in stock <b>{s(o.qtyReceived)}</b>
      </p>

      <h4>Material</h4>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th>Needed</th>
              <th>Issued</th>
              <th>Returned</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            {(o.materials as Row[]).map((m) => (
              <tr key={s(m.id)}>
                <td>
                  {s(m.itemCode)} · {s(m.itemName)}
                  {m.customerSupplied === true ? ' (customer material)' : ''}
                </td>
                <td>{s(m.requiredQty)}</td>
                <td>{s(m.issuedQty)}</td>
                <td>{s(m.returnedQty)}</td>
                <td>
                  {m.customerSupplied === true ? '—' : inr(n3(m.issuedValue) - n3(m.returnedValue))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h4>Operations</h4>
      {ops.length === 0 ? (
        <p>The operations are copied from the routing when the order is released.</p>
      ) : null}
      {ops.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>No.</th>
                <th>Operation</th>
                <th>Work center</th>
                <th>Good</th>
                <th>Scrap</th>
                <th>Rework</th>
                <th>Left</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {ops.map((p) => (
                <tr key={s(p.id)}>
                  <td>{s(p.seq)}</td>
                  <td>
                    {s(p.name)}
                    {p.inspectionRequired === true ? (
                      <span className="hint"> · inspection</span>
                    ) : null}
                  </td>
                  <td>{s(p.workCentreCode)}</td>
                  <td>{s(p.qtyDone)}</td>
                  <td>{s(p.qtyScrap)}</td>
                  <td>{s(p.qtyRework)}</td>
                  <td>{s(p.remaining)}</td>
                  <td>
                    <Pill tone={ORDER_TONE[s(p.status)]}>{s(p.status)}</Pill>
                  </td>
                  <td>
                    {mode === 'work' && live && s(p.status) !== 'Done' && actions.edit ? (
                      <>
                        {s(p.workCentreKind) === 'OUTSIDE' ? (
                          <button
                            type="button"
                            className="btn"
                            onClick={() => setDlg({ t: 'outside', op: p })}
                          >
                            Send / receive
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn"
                            onClick={() => setDlg({ t: 'log', op: p })}
                          >
                            Log
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn"
                          onClick={() =>
                            act(
                              () => mpost(`/orders/${id}/ops/${s(p.id)}/complete`, {}),
                              'Operation complete',
                            )
                          }
                        >
                          Complete
                        </button>
                      </>
                    ) : null}
                    {mode === 'work' &&
                    live &&
                    p.inspectionRequired === true &&
                    s(p.status) !== 'Pending' &&
                    actions.edit ? (
                      <button
                        type="button"
                        className="btn"
                        onClick={() => setDlg({ t: 'lot', op: p })}
                      >
                        Send for inspection
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {lots.length ? (
        <>
          <h4>Inspection lots</h4>
          <p className="hint">
            The readings and the Usage Decision are entered on the quality screens (In-Process
            Quality, Final Quality).
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Lot</th>
                  <th>For</th>
                  <th>Sheet</th>
                  <th>Pieces</th>
                  <th>Sheet status</th>
                  <th>Accepted</th>
                  <th>Received</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {lots.map((l) => {
                  const room = n3(l.acceptedQty) - n3(l.receivedQty);
                  return (
                    <tr key={s(l.id)}>
                      <td>{s(l.lotNo)}</td>
                      <td>{s(l.kind) === 'FG' ? 'Final inspection' : 'In-process'}</td>
                      <td>{s(l.inspectionNo)}</td>
                      <td>{s(l.lotQty)}</td>
                      <td>
                        <Pill tone={ORDER_TONE[s(l.inspectionStatus)]}>
                          {s(l.inspectionStatus)}
                        </Pill>
                      </td>
                      <td>
                        {l.acceptedQty === null || l.acceptedQty === undefined
                          ? '—'
                          : s(l.acceptedQty)}
                      </td>
                      <td>{s(s(l.kind) === 'FG' ? l.receivedQty : '—')}</td>
                      <td>
                        {mode === 'fg' &&
                        s(l.kind) === 'FG' &&
                        s(l.inspectionStatus) === 'Decided' &&
                        room > 0 &&
                        actions.post ? (
                          <button
                            type="button"
                            className="btn primary"
                            onClick={() => setDlg({ t: 'receive', lot: l })}
                          >
                            Receive
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      <h4>Cost (figures only)</h4>
      <p>
        Material {inr(s(cost.material))} · conversion {inr(s(cost.conversion))} · outside processing{' '}
        {inr(s(cost.outside))} · total <b>{inr(s(cost.total))}</b>
        {cost.unitCost ? ` · ${s(cost.unitCost)} per good piece` : ''}
      </p>

      {(o.outsideMoves as Row[]).length ? (
        <>
          <h4>Outside processing</h4>
          <ul>
            {(o.outsideMoves as Row[]).map((m) => (
              <li key={s(m.id)}>
                {dmy(s(m.moveDate))} · {s(m.docNo)} · {s(m.supplierName)} ·{' '}
                {s(m.direction) === 'SENT'
                  ? `sent ${s(m.qty)}`
                  : `received ${s(m.qty)} good, ${s(m.qtyScrap)} scrap at ${s(m.rate)} = ${inr(s(m.cost))}`}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {(o.moves as Row[]).length ? (
        <>
          <h4>Stock documents</h4>
          <ul>
            {(o.moves as Row[]).map((m) => (
              <li key={s(m.id)}>
                {s(m.number)} ·{' '}
                {s(m.kind) === 'ISSUE'
                  ? 'material issued'
                  : s(m.kind) === 'RETURN'
                    ? 'material returned'
                    : 'finished goods received'}{' '}
                · {s(m.totalQty)} · {inr(s(m.totalValue))} · {dmy(s(m.moveDate))}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {dlg?.t === 'issue' ? (
        <IssueDialog order={o} onClose={() => setDlg(null)} onDone={done} />
      ) : null}
      {dlg?.t === 'return' ? (
        <ReturnDialog order={o} onClose={() => setDlg(null)} onDone={done} />
      ) : null}
      {dlg?.t === 'edit' ? (
        <FormModal
          title="Edit the planned order"
          fields={[
            { key: 'qty', label: 'Quantity', type: 'number' },
            { key: 'dueDate', label: 'Due date', type: 'date' },
            { key: 'startDate', label: 'Start date', type: 'date' },
            { key: 'notes', label: 'Notes' },
          ]}
          initial={{
            qty: s(o.qty),
            dueDate: s(o.dueDate).slice(0, 10),
            startDate: s(o.startDate).slice(0, 10),
            notes: s(o.notes),
          }}
          onClose={() => setDlg(null)}
          onSubmit={async (v) => {
            await mpatch(`/orders/${id}`, n3(o.version), v);
            toast('Saved');
            done();
          }}
        />
      ) : null}
      {dlg?.t === 'cancel' ? (
        <FormModal
          title="Cancel the order"
          size="sm"
          fields={[{ key: 'reason', label: 'Reason', required: true }]}
          submitLabel="Cancel order"
          onClose={() => setDlg(null)}
          onSubmit={async (v) => {
            await mpost(`/orders/${id}/cancel`, v, n3(o.version));
            toast('Order cancelled');
            done();
          }}
        />
      ) : null}
      {dlg?.t === 'close' ? (
        <FormModal
          title="Close the order"
          size="sm"
          fields={[{ key: 'note', label: 'Note' }]}
          submitLabel="Close order"
          onClose={() => setDlg(null)}
          onSubmit={async (v) => {
            await mpost(`/orders/${id}/close`, v, n3(o.version));
            toast('Order closed');
            done();
          }}
        />
      ) : null}
      {dlg?.t === 'outside' ? (
        <FormModal
          title={`Outside processing: ${s(dlg.op.name)}`}
          sub="Pieces sent to a supplier on a challan, and what comes back. The cost is pieces processed times the rate."
          fields={[
            {
              key: 'direction',
              label: 'Entry',
              type: 'select',
              options: ['SENT', 'RECEIVED'],
              required: true,
            },
            {
              key: 'qty',
              label: 'Pieces (sent, or good pieces received)',
              type: 'number',
              required: true,
            },
            { key: 'qtyScrap', label: 'Scrap pieces (on receipt)', type: 'number' },
            { key: 'docNo', label: 'Challan / document no.', required: true },
            { key: 'supplierId', label: 'Supplier', type: 'supplier', required: true },
            { key: 'rate', label: 'Rate per piece (on receipt)', type: 'number' },
            { key: 'moveDate', label: 'Date', type: 'date' },
            { key: 'reason', label: 'Reason (needed for scrap)' },
          ]}
          initial={{ direction: 'SENT', moveDate: todayIso() }}
          onClose={() => setDlg(null)}
          onSubmit={async (v) => {
            await mpost(`/orders/${id}/ops/${s((dlg as { op: Row }).op.id)}/outside`, v);
            toast('Recorded');
            done();
          }}
        />
      ) : null}
      {dlg?.t === 'log' ? (
        <FormModal
          title={`Log ${s(dlg.op.name)}`}
          sub={`Pieces still unaccounted at this operation: ${s(dlg.op.remaining)}`}
          fields={[
            { key: 'good', label: 'Good pieces', type: 'number' },
            { key: 'scrap', label: 'Scrap pieces', type: 'number' },
            { key: 'rework', label: 'Pieces for rework', type: 'number' },
            { key: 'minutes', label: 'Minutes taken', type: 'number' },
            { key: 'operator', label: 'Operator' },
            { key: 'reason', label: 'Reason (needed for scrap or rework)' },
            {
              key: 'fromGood',
              label: 'Move pieces that were logged good (failed inspection)',
              type: 'check',
            },
          ]}
          onClose={() => setDlg(null)}
          onSubmit={async (v) => {
            const { fromGood, ...rest } = v;
            await mpost(`/orders/${id}/ops/${s((dlg as { op: Row }).op.id)}/log`, {
              ...rest,
              ...(fromGood === 'true' ? { fromGood: true } : {}),
            });
            toast('Logged');
            done();
          }}
        />
      ) : null}
      {dlg?.t === 'lot' ? (
        <FormModal
          title={dlg.op ? `Inspection of ${s(dlg.op.name)}` : 'Final inspection lot'}
          sub="Creates the inspection sheet. Leave the quantity empty to send everything that is waiting."
          fields={[{ key: 'lotQty', label: 'Pieces in the lot', type: 'number' }]}
          onClose={() => setDlg(null)}
          onSubmit={async (v) => {
            const l = dlg as { op: Row | null };
            await mpost(
              l.op ? `/orders/${id}/ops/${s(l.op.id)}/inspection` : `/orders/${id}/fg-lots`,
              v,
            );
            toast('Inspection sheet created');
            done();
          }}
        />
      ) : null}
      {dlg?.t === 'receive' ? (
        <FormModal
          title={`Receive lot ${s(dlg.lot.lotNo)}`}
          sub={`${receivable(dlg.lot)} accepted pieces can go into stock.`}
          fields={[
            { key: 'qty', label: 'Quantity', type: 'number', required: true },
            ...(o.batchTracked === true
              ? [{ key: 'batchNo', label: 'Batch number', hint: `Default: ${s(o.number)}` }]
              : []),
          ]}
          initial={{ qty: String(receivable(dlg.lot)) }}
          onClose={() => setDlg(null)}
          onSubmit={async (v) => {
            await mpost(`/orders/${id}/receive`, { lotId: s((dlg as { lot: Row }).lot.id), ...v });
            toast('Finished goods received');
            done();
          }}
        />
      ) : null}
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ lists
function OrderList({
  mode,
  actions,
  title,
  sub,
}: {
  mode: Mode;
  actions: ActionSet;
  title: string;
  sub: string;
}) {
  const toast = useToast();
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const wh = useWarehouses();
  const list = useLoad(() => mlist(base(mode), { status, q }), [mode, status, q]);
  return (
    <>
      <PageHead title={title} sub={sub} />
      <div className="toolbar">
        <label htmlFor="po-status">Status</label>
        <select id="po-status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All</option>
          {STATUSES.map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
        <input
          aria-label="Search orders"
          placeholder="Search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {mode === 'orders' && actions.add ? (
          <button type="button" className="btn primary" onClick={() => setAdding(true)}>
            + New production order
          </button>
        ) : null}
        {mode === 'orders' && actions.print ? (
          <FileButton path="/export/orders" name="mfg-orders.xlsx" label="Export Excel" />
        ) : null}
      </div>
      <ErrorBox message={list.error} />
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Order</th>
              <th>Item</th>
              <th>Customer</th>
              <th>Quantity</th>
              <th>Made</th>
              <th>In stock</th>
              <th>Due</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {list.data && list.data.rows.length === 0 && !list.loading ? (
              <Empty cols={8}>No production orders.</Empty>
            ) : null}
            {(list.data?.rows ?? []).map((r) => (
              <tr key={s(r.id)}>
                <td>
                  <button type="button" className="link" onClick={() => setOpen(s(r.id))}>
                    {s(r.number)}
                  </button>
                </td>
                <td>
                  {s(r.itemCode)} · {s(r.itemName)}
                </td>
                <td>{s(r.customerName)}</td>
                <td>
                  {s(r.qty)} {s(r.uom)}
                </td>
                <td>{s(r.qtyCompleted)}</td>
                <td>{s(r.qtyReceived)}</td>
                <td>{dmy(s(r.dueDate))}</td>
                <td>
                  <Pill tone={ORDER_TONE[s(r.status)]}>{s(r.status)}</Pill>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {open ? (
        <OrderPanel
          id={open}
          mode={mode}
          actions={actions}
          onClose={() => setOpen(null)}
          onChanged={list.reload}
        />
      ) : null}
      {adding ? (
        <FormModal
          title="New production order"
          sub="Needs an active bill of materials for the item. Material and operations come from it."
          fields={[
            { key: 'itemId', label: 'Item', type: 'item', required: true },
            { key: 'qty', label: 'Quantity', type: 'number', required: true },
            { key: 'dueDate', label: 'Due date', type: 'date', required: true },
            { key: 'startDate', label: 'Start date', type: 'date' },
            {
              key: 'warehouseId',
              label: 'Finished goods warehouse',
              type: 'select',
              options: wh.data ?? [],
              required: true,
            },
            {
              key: 'rmWarehouseId',
              label: 'Raw material warehouse',
              type: 'select',
              options: wh.data ?? [],
              required: true,
            },
            { key: 'customerId', label: 'Customer', type: 'customer' },
            { key: 'customerPoNo', label: 'Customer PO no.' },
            { key: 'notes', label: 'Notes' },
          ]}
          initial={{ dueDate: todayIso() }}
          onClose={() => setAdding(false)}
          onSubmit={async (v) => {
            const r = await mpost('/orders', v);
            toast(`Created ${s(r.number)}`);
            setAdding(false);
            list.reload();
          }}
        />
      ) : null}
    </>
  );
}

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
      {tab === 'orders' ? (
        <OrderList
          mode="orders"
          actions={actions}
          title="Production Orders"
          sub="Plan an order from an active BOM, release it to copy the routing, issue material, and close it when everything is in stock."
        />
      ) : (
        <JobWorkTab actions={actions} />
      )}
    </>
  );
}

export function WorkOrdersPage({ actions }: { actions: ActionSet }) {
  return (
    <OrderList
      mode="work"
      actions={actions}
      title="Work Orders"
      sub="Log what each operation made. The next operation starts when this one is complete; an inspection checkpoint holds the order until the Usage Decision."
    />
  );
}

export function FgPage({ actions }: { actions: ActionSet }) {
  return (
    <OrderList
      mode="fg"
      actions={actions}
      title="Finished Goods Receipt"
      sub="Send finished pieces for final inspection. Only the pieces a Usage Decision accepted can be received into stock."
    />
  );
}
