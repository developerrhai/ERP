// Phase 13 registers and monitors: scrap, rework, WIP, costing and the shop-floor dashboard. Every figure comes from the
// server (R-15); costing is figures only, nothing here posts to the ledger.
import { useState } from 'react';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { toUiError } from '../../lib/errors';
import { mget, mlist, mpost } from '../../lib/mfgApi';
import type { Row } from '../../lib/mfgApi';
import { useLoad } from '../../lib/useLoad';
import type { ActionSet } from '../../types';
import { dmy, Empty, ErrorBox, inr, PageHead, Pill } from '../finance/shared';
import { Tabs } from '../qms/Shared';
import { ChallanReworkTab } from './JobWork';
import { FileButton, FormModal, ORDER_TONE, OptionSelect, s } from './Kit';

// ------------------------------------------------------------------------------------------------ scrap
function ScrapDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [orderId, setOrderId] = useState('');
  const [opId, setOpId] = useState('');
  const [f, setF] = useState({ qty: '', reason: '', operator: '' });
  const [fromGood, setFromGood] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState('');
  const orders = useLoad(() => mlist('/orders/for/mfg-scrap'), []);
  const order = useLoad(
    () => (orderId ? mget(`/orders/for/mfg-scrap/${orderId}`) : Promise.resolve(null)),
    [orderId],
  );
  const live = (orders.data?.rows ?? []).filter((o) =>
    ['Released', 'In Progress'].includes(s(o.status)),
  );
  const ops = ((order.data?.ops as Row[] | undefined) ?? []).filter((o) => s(o.status) !== 'Done');
  return (
    <Modal
      title="Record scrap"
      sub="Pieces lost at an operation. They also enter the quality rejection register."
      onClose={onClose}
      footer={
        <button
          type="button"
          className="btn primary"
          onClick={() => {
            setMsg('');
            setErrors({});
            mpost('/scrap', {
              orderId,
              opId,
              qty: f.qty,
              reason: f.reason,
              ...(f.operator ? { operator: f.operator } : {}),
              ...(fromGood ? { fromGood: true } : {}),
            })
              .then(() => {
                toast('Scrap recorded');
                onDone();
              })
              .catch((e: unknown) => {
                const u = toUiError(e);
                setMsg(u.message);
                setErrors(u.fields);
              });
          }}
        >
          Save
        </button>
      }
    >
      <ErrorBox message={msg} />
      <div className="form-grid">
        <div className="field">
          <label htmlFor="sc-order">Production order *</label>
          <OptionSelect
            id="sc-order"
            value={orderId}
            options={live.map((o) => ({ id: s(o.id), label: `${s(o.number)} · ${s(o.itemName)}` }))}
            onChange={(v) => {
              setOrderId(v);
              setOpId('');
            }}
          />
        </div>
        <div className="field">
          <label htmlFor="sc-op">Operation *</label>
          <OptionSelect
            id="sc-op"
            value={opId}
            options={ops.map((o) => ({ id: s(o.id), label: `${s(o.seq)} · ${s(o.name)}` }))}
            onChange={setOpId}
          />
        </div>
        <div className="field">
          <label htmlFor="sc-qty">Scrap pieces *</label>
          <input
            id="sc-qty"
            type="number"
            step="any"
            min={0}
            value={f.qty}
            onChange={(e) => setF({ ...f, qty: e.target.value })}
          />
          {errors.qtyGood || errors.qty ? (
            <div className="field-error">{errors.qtyGood ?? errors.qty}</div>
          ) : null}
        </div>
        <div className="field">
          <label htmlFor="sc-reason">Reason *</label>
          <input
            id="sc-reason"
            value={f.reason}
            onChange={(e) => setF({ ...f, reason: e.target.value })}
          />
          {errors.reason ? <div className="field-error">{errors.reason}</div> : null}
        </div>
        <div className="field">
          <label htmlFor="sc-operator">Operator</label>
          <input
            id="sc-operator"
            value={f.operator}
            onChange={(e) => setF({ ...f, operator: e.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="sc-fg">
            <input
              id="sc-fg"
              type="checkbox"
              checked={fromGood}
              onChange={(e) => setFromGood(e.target.checked)}
            />{' '}
            Take from pieces already logged good
          </label>
        </div>
      </div>
    </Modal>
  );
}

export function ScrapPage({ actions }: { actions: ActionSet }) {
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState('');
  const list = useLoad(() => mlist('/scrap', { q }), [q]);
  return (
    <>
      <PageHead
        title="Scrap Management"
        sub="Every scrapped piece with its order, operation and reason."
      />
      <div className="toolbar">
        <input
          aria-label="Search scrap"
          placeholder="Search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {actions.add ? (
          <button type="button" className="btn primary" onClick={() => setAdding(true)}>
            + Record scrap
          </button>
        ) : null}
        {actions.print ? (
          <FileButton path="/export/scrap" name="mfg-scrap.xlsx" label="Export Excel" />
        ) : null}
      </div>
      <ErrorBox message={list.error} />
      <p>
        Total scrap in this list: <b>{s(list.data?.meta.totalQty ?? '0')}</b>
      </p>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>No.</th>
              <th>Date</th>
              <th>Order</th>
              <th>Operation</th>
              <th>Item</th>
              <th>Quantity</th>
              <th>Reason</th>
              <th>From</th>
            </tr>
          </thead>
          <tbody>
            {list.data && list.data.rows.length === 0 && !list.loading ? (
              <Empty cols={8}>No scrap recorded.</Empty>
            ) : null}
            {(list.data?.rows ?? []).map((r) => (
              <tr key={s(r.id)}>
                <td>{s(r.number)}</td>
                <td>{dmy(s(r.scrapDate))}</td>
                <td>{s(r.orderNumber)}</td>
                <td>{s(r.opName)}</td>
                <td>
                  {s(r.itemCode)} · {s(r.itemName)}
                </td>
                <td>{s(r.qty)}</td>
                <td>{s(r.reason)}</td>
                <td>{s(r.source) === 'REWORK' ? 'Failed rework' : 'Operation'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {adding ? (
        <ScrapDialog
          onClose={() => setAdding(false)}
          onDone={() => {
            setAdding(false);
            list.reload();
          }}
        />
      ) : null}
    </>
  );
}

// ------------------------------------------------------------------------------------------------ rework
function InHouseRework({ actions }: { actions: ActionSet }) {
  const toast = useToast();
  const [status, setStatus] = useState('Open');
  const [fin, setFin] = useState<Row | null>(null);
  const list = useLoad(() => mlist('/rework', { status }), [status]);
  return (
    <>
      <div className="toolbar">
        <label htmlFor="rw-status">Status</label>
        <select id="rw-status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All</option>
          <option>Open</option>
          <option>Done</option>
        </select>
        {actions.print ? (
          <FileButton path="/export/rework" name="mfg-rework.xlsx" label="Export Excel" />
        ) : null}
      </div>
      <ErrorBox message={list.error} />
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>No.</th>
              <th>Date</th>
              <th>Order</th>
              <th>Operation</th>
              <th>Item</th>
              <th>Pieces</th>
              <th>Reason</th>
              <th>Result</th>
              <th>Rework cost</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.data && list.data.rows.length === 0 && !list.loading ? (
              <Empty cols={11}>No rework entries.</Empty>
            ) : null}
            {(list.data?.rows ?? []).map((r) => (
              <tr key={s(r.id)}>
                <td>{s(r.number)}</td>
                <td>{dmy(s(r.reworkDate))}</td>
                <td>{s(r.orderNumber)}</td>
                <td>{s(r.opName)}</td>
                <td>{s(r.itemName)}</td>
                <td>{s(r.qty)}</td>
                <td>{s(r.reason)}</td>
                <td>
                  {s(r.status) === 'Done' ? `${s(r.qtyOk)} good · ${s(r.qtyScrap)} scrap` : '—'}
                </td>
                <td>{s(r.status) === 'Done' ? `${inr(s(r.cost))} (${s(r.minutes)} min)` : '—'}</td>
                <td>
                  <Pill tone={ORDER_TONE[s(r.status)]}>{s(r.status)}</Pill>
                </td>
                <td>
                  {s(r.status) === 'Open' && actions.edit ? (
                    <button type="button" className="btn" onClick={() => setFin(r)}>
                      Finish
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {fin ? (
        <FormModal
          title={`Finish ${s(fin.number)}`}
          sub={`${s(fin.qty)} pieces were sent for rework. Good plus scrap must equal that number.`}
          size="sm"
          fields={[
            { key: 'qtyOk', label: 'Good again', type: 'number', required: true },
            { key: 'qtyScrap', label: 'Scrap', type: 'number', required: true },
            {
              key: 'minutes',
              label: 'Minutes the rework took (charged at the work center rate)',
              type: 'number',
            },
            { key: 'note', label: 'Note (needed if any piece is scrapped)' },
          ]}
          initial={{ qtyOk: s(fin.qty), qtyScrap: '0' }}
          onClose={() => setFin(null)}
          onSubmit={async (v) => {
            await mpost(`/rework/${s(fin.id)}/finish`, v);
            toast('Rework finished');
            setFin(null);
            list.reload();
          }}
        />
      ) : null}
    </>
  );
}

export function ReworkPage({ actions }: { actions: ActionSet }) {
  const [tab, setTab] = useState<'house' | 'challan'>('house');
  return (
    <>
      <PageHead
        title="Rework Management"
        sub="Pieces sent for rework in production, and the rework register against the customer's delivery challan."
      />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          ['house', 'Rework in production'],
          ['challan', 'Customer challan rework'],
        ]}
      />
      {tab === 'house' ? (
        <InHouseRework actions={actions} />
      ) : (
        <ChallanReworkTab actions={actions} />
      )}
    </>
  );
}

// ------------------------------------------------------------------------------------------------ WIP and costing
export function WipPage({ actions }: { actions: ActionSet }) {
  const list = useLoad(() => mlist('/wip'), []);
  return (
    <>
      <PageHead
        title="WIP Tracking"
        sub="Orders in production: where they are, and the value of material that has not yet reached finished goods."
      />
      <div className="toolbar">
        {actions.print ? (
          <FileButton path="/export/wip" name="mfg-wip.xlsx" label="Export Excel" />
        ) : null}
      </div>
      <ErrorBox message={list.error} />
      <p>
        Material value in process: <b>{inr(s(list.data?.meta.totalValue ?? '0'))}</b>
      </p>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Order</th>
              <th>Item</th>
              <th>Quantity</th>
              <th>Made</th>
              <th>Scrapped</th>
              <th>In rework</th>
              <th>In stock</th>
              <th>Now at</th>
              <th>WIP value</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {list.data && list.data.rows.length === 0 && !list.loading ? (
              <Empty cols={10}>Nothing is in production.</Empty>
            ) : null}
            {(list.data?.rows ?? []).map((r) => (
              <tr key={s(r.id)}>
                <td>{s(r.number)}</td>
                <td>{s(r.itemName)}</td>
                <td>{s(r.qty)}</td>
                <td>{s(r.qtyCompleted)}</td>
                <td>{s(r.qtyScrapped)}</td>
                <td>{s(r.qtyRework)}</td>
                <td>{s(r.qtyReceived)}</td>
                <td>{s(r.currentOp) || '—'}</td>
                <td>{inr(s(r.wipValue))}</td>
                <td>
                  <Pill tone={ORDER_TONE[s(r.status)]}>{s(r.status)}</Pill>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function CostingPage({ actions }: { actions: ActionSet }) {
  const [q, setQ] = useState('');
  const list = useLoad(() => mlist('/costing', { q }), [q]);
  return (
    <>
      <PageHead
        title="Production Costing"
        sub="Material issued less returned, plus the logged minutes at each work center's rate. Figures only: nothing is posted to the ledger."
      />
      <div className="toolbar">
        <input
          aria-label="Search costing"
          placeholder="Search order or item"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {actions.print ? (
          <FileButton path="/export/costing" name="mfg-costing.xlsx" label="Export Excel" />
        ) : null}
      </div>
      <ErrorBox message={list.error} />
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Order</th>
              <th>Item</th>
              <th>Good pieces</th>
              <th>Material</th>
              <th>Conversion</th>
              <th>Outside processing</th>
              <th>Of which rework</th>
              <th>Total</th>
              <th>Cost per piece</th>
              <th>Standard cost</th>
              <th>Difference per piece</th>
            </tr>
          </thead>
          <tbody>
            {list.data && list.data.rows.length === 0 && !list.loading ? (
              <Empty cols={11}>No costed orders yet.</Empty>
            ) : null}
            {(list.data?.rows ?? []).map((r) => (
              <tr key={s(r.id)}>
                <td>{s(r.number)}</td>
                <td>
                  {s(r.itemCode)} · {s(r.itemName)}
                </td>
                <td>{s(r.qtyCompleted)}</td>
                <td>{inr(s(r.material))}</td>
                <td>{inr(s(r.conversion))}</td>
                <td>{inr(s(r.outside))}</td>
                <td>{inr(s(r.reworkCost))}</td>
                <td>{inr(s(r.total))}</td>
                <td>{r.unitCost ? s(r.unitCost) : '—'}</td>
                <td>
                  {r.standardCost === null || r.standardCost === undefined
                    ? '—'
                    : s(r.standardCost)}
                </td>
                <td>{r.variancePerUnit ? s(r.variancePerUnit) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ------------------------------------------------------------------------------------------------ shop-floor dashboard
export function ShopFloorPage() {
  const d = useLoad(() => mget('/shopfloor'), []);
  const data = d.data;
  const counts = (data?.orders ?? {}) as Record<string, number>;
  const today = (data?.today ?? {}) as Row;
  return (
    <>
      <PageHead
        title="Shop Floor Dashboard"
        sub="What is running now, what is late, and the work waiting at each work center."
      />
      <ErrorBox message={d.error} />
      {data ? (
        <>
          <div className="form-grid">
            {['Planned', 'Released', 'In Progress', 'Completed'].map((k) => (
              <div className="card" style={{ padding: 12 }} key={k}>
                <div className="hint">{k}</div>
                <b style={{ fontSize: 24 }}>{counts[k] ?? 0}</b>
              </div>
            ))}
            <div className="card" style={{ padding: 12 }}>
              <div className="hint">Today: good · scrap · rework</div>
              <b>
                {s(today.good)} · {s(today.scrap)} · {s(today.rework)}
              </b>{' '}
              <span className="hint">{s(today.minutes)} min</span>
            </div>
          </div>
          <h4>Running operations</h4>
          <div className="card table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Work center</th>
                  <th>Order</th>
                  <th>Item</th>
                  <th>Operation</th>
                  <th>Good</th>
                  <th>Scrap</th>
                  <th>Rework</th>
                </tr>
              </thead>
              <tbody>
                {(data.running as Row[]).length === 0 ? (
                  <Empty cols={7}>No operation is running.</Empty>
                ) : null}
                {(data.running as Row[]).map((r) => (
                  <tr key={s(r.opId)}>
                    <td>{s(r.workCentreCode)}</td>
                    <td>{s(r.number)}</td>
                    <td>{s(r.itemName)}</td>
                    <td>
                      {s(r.seq)} · {s(r.opName)}
                      {r.inspectionRequired === true ? (
                        <span className="hint"> · inspection</span>
                      ) : null}
                    </td>
                    <td>{s(r.qtyDone)}</td>
                    <td>{s(r.qtyScrap)}</td>
                    <td>{s(r.qtyRework)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h4>Late orders</h4>
          <div className="card table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Item</th>
                  <th>Due</th>
                  <th>Quantity</th>
                  <th>Made</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {(data.overdue as Row[]).length === 0 ? (
                  <Empty cols={6}>Nothing is late.</Empty>
                ) : null}
                {(data.overdue as Row[]).map((r) => (
                  <tr key={s(r.id)}>
                    <td>{s(r.number)}</td>
                    <td>{s(r.itemName)}</td>
                    <td>{dmy(s(r.dueDate))}</td>
                    <td>{s(r.qty)}</td>
                    <td>{s(r.qtyCompleted)}</td>
                    <td>
                      <Pill tone={ORDER_TONE[s(r.status)]}>{s(r.status)}</Pill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h4>Work center load</h4>
          <div className="card table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Work center</th>
                  <th>Hours per day</th>
                  <th>Minutes of work waiting</th>
                  <th>Days of work</th>
                </tr>
              </thead>
              <tbody>
                {(data.load as Row[]).map((r) => (
                  <tr key={s(r.code)}>
                    <td>
                      {s(r.code)} · {s(r.name)}
                    </td>
                    <td>{s(r.capacityHours)}</td>
                    <td>{s(r.minutesLeft)}</td>
                    <td>{s(r.daysOfWork)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </>
  );
}
