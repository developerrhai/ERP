// Phase 13 planning screens: MRP (net requirements from sales orders and forecasts, then a requisition and planned orders)
// and the daily board / line planning. The netting and the balances are calculated on the server.
import { useState } from 'react';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { toUiError } from '../../lib/errors';
import { mdelete, mget, mlist, mpatch, mpost } from '../../lib/mfgApi';
import type { Row } from '../../lib/mfgApi';
import { useLoad } from '../../lib/useLoad';
import type { ActionSet } from '../../types';
import { dmy, Empty, ErrorBox, PageHead, Pill, todayIso } from '../finance/shared';
import { Tabs } from '../qms/Shared';
import { FileButton, FormModal, ORDER_TONE, OptionSelect, s, useWarehouses } from './Kit';

const ACTION_TEXT: Record<string, string> = {
  PRODUCE: 'Make',
  BUY: 'Buy',
  NONE: 'Covered',
  CUSTOMER: "Customer's material",
};
const SOURCE_TEXT: Record<string, string> = {
  SALES_ORDER: 'Sales order',
  FORECAST: 'Forecast',
  BOM: 'Needed by',
  ORDER: 'Open order',
};
const addDays = (iso: string, d: number): string => {
  const x = new Date(`${iso}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + d);
  return x.toISOString().slice(0, 10);
};

// ------------------------------------------------------------------------------------------------ MRP
function RunPanel({
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
  const doc = useLoad(() => mget(`/mrp/${id}`), [id]);
  const wh = useWarehouses();
  const [fg, setFg] = useState('');
  const [rm, setRm] = useState('');
  const [msg, setMsg] = useState('');
  const run = doc.data;
  const lines = (run?.lines as Row[] | undefined) ?? [];
  const needsWarehouses = lines.some((l) => s(l.action) === 'PRODUCE' && !l.orderId);
  const act = (fn: () => Promise<unknown>, ok: string) => {
    setMsg('');
    fn()
      .then(() => {
        toast(ok);
        doc.reload();
        onChanged();
      })
      .catch((e: unknown) => setMsg(toUiError(e).message));
  };
  return (
    <Modal
      title={
        run ? `${s(run.number)} · ${dmy(s(run.fromDate))} to ${dmy(s(run.toDate))}` : 'MRP run'
      }
      sub={run ? `${s(run.status)}${run.prNumber ? ` · requisition ${s(run.prNumber)}` : ''}` : ''}
      onClose={onClose}
      footer={
        run ? (
          <>
            {actions.print ? (
              <>
                <FileButton path={`/mrp/${id}/print`} name="mrp.pdf" label="Print" />
                <FileButton path={`/mrp/${id}/export`} name="mfg-mrp.xlsx" label="Export Excel" />
              </>
            ) : null}
            {s(run.status) === 'Draft' ? (
              <>
                {actions.approve ? (
                  <button
                    type="button"
                    className="btn primary"
                    onClick={() =>
                      act(
                        () =>
                          mpost(
                            `/mrp/${id}/apply`,
                            {
                              ...(fg ? { warehouseId: fg } : {}),
                              ...(rm ? { rmWarehouseId: rm } : {}),
                            },
                            Number(run.version),
                          ),
                        'Requisition and planned orders created',
                      )
                    }
                  >
                    Create requisition and planned orders
                  </button>
                ) : null}
                {actions.cancel ? (
                  <button
                    type="button"
                    className="btn"
                    onClick={() =>
                      act(
                        () => mpost(`/mrp/${id}/cancel`, {}, Number(run.version)),
                        'Run cancelled',
                      )
                    }
                  >
                    Cancel run
                  </button>
                ) : null}
              </>
            ) : null}
          </>
        ) : undefined
      }
    >
      <ErrorBox message={msg || doc.error} />
      {run && s(run.status) === 'Draft' && needsWarehouses && actions.approve ? (
        <div className="form-grid">
          <div className="field">
            <label htmlFor="mrp-fg">Finished goods warehouse (new orders)</label>
            <OptionSelect id="mrp-fg" value={fg} options={wh.data ?? []} onChange={setFg} />
          </div>
          <div className="field">
            <label htmlFor="mrp-rm">Raw material warehouse (new orders)</label>
            <OptionSelect id="mrp-rm" value={rm} options={wh.data ?? []} onChange={setRm} />
          </div>
        </div>
      ) : null}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Level</th>
              <th>Item</th>
              <th>Period from</th>
              <th>Action</th>
              <th>Gross need</th>
              <th>In stock</th>
              <th>Coming</th>
              <th>To arrange</th>
              <th>Needed by</th>
              <th>Why</th>
            </tr>
          </thead>
          <tbody>
            {run && lines.length === 0 ? <Empty cols={10}>Nothing to plan.</Empty> : null}
            {lines.map((l) => (
              <tr key={s(l.id)}>
                <td>{s(l.level)}</td>
                <td>
                  {s(l.itemCode)} · {s(l.itemName)}
                </td>
                <td>{l.bucketStart ? dmy(s(l.bucketStart)) : '—'}</td>
                <td>
                  <Pill
                    tone={
                      s(l.action) === 'NONE'
                        ? 'approved'
                        : s(l.action) === 'BUY'
                          ? 'rejected'
                          : 'pending'
                    }
                  >
                    {ACTION_TEXT[s(l.action)] ?? s(l.action)}
                  </Pill>
                  {l.orderNumber ? <div className="hint">{s(l.orderNumber)}</div> : null}
                </td>
                <td>{s(l.grossQty)}</td>
                <td>{s(l.onHandQty)}</td>
                <td>{s(l.scheduledQty)}</td>
                <td>
                  <b>{s(l.netQty)}</b> {s(l.uom)}
                </td>
                <td>{l.needDate ? dmy(s(l.needDate)) : '—'}</td>
                <td className="hint">
                  {((l.sources as Row[]) ?? []).slice(0, 3).map((x, i) => (
                    <div key={i}>
                      {SOURCE_TEXT[s(x.type)] ?? s(x.type)} {s(x.ref)}: {s(x.qty)}
                    </div>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

export function MrpPage({ actions }: { actions: ActionSet }) {
  const toast = useToast();
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const list = useLoad(() => mlist('/mrp'), []);
  const today = todayIso();
  return (
    <>
      <PageHead
        title="Material Requirement Planning"
        sub="Demand is the approved sales orders still to dispatch plus the forecasts. The BOM explodes level by level, and stock and open orders are netted off. Nothing is created until you confirm."
      />
      <div className="toolbar">
        {actions.add ? (
          <button type="button" className="btn primary" onClick={() => setAdding(true)}>
            + New MRP run
          </button>
        ) : null}
      </div>
      <ErrorBox message={list.error} />
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Run</th>
              <th>Range</th>
              <th>To make</th>
              <th>To buy</th>
              <th>Requisition</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {list.data && list.data.rows.length === 0 && !list.loading ? (
              <Empty cols={6}>No MRP runs yet.</Empty>
            ) : null}
            {(list.data?.rows ?? []).map((r) => (
              <tr key={s(r.id)}>
                <td>
                  <button type="button" className="link" onClick={() => setOpen(s(r.id))}>
                    {s(r.number)}
                  </button>
                </td>
                <td>
                  {dmy(s(r.fromDate))} – {dmy(s(r.toDate))}
                </td>
                <td>{s(r.produceLines)}</td>
                <td>{s(r.buyLines)}</td>
                <td>{s(r.prNumber) || '—'}</td>
                <td>
                  <Pill tone={ORDER_TONE[s(r.status)]}>{s(r.status)}</Pill>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {open ? (
        <RunPanel
          id={open}
          actions={actions}
          onClose={() => setOpen(null)}
          onChanged={list.reload}
        />
      ) : null}
      {adding ? (
        <FormModal
          title="New MRP run"
          sub="Sales orders due up to the end date are included (late ones too). Forecast months inside the range are added."
          fields={[
            { key: 'fromDate', label: 'From', type: 'date', required: true },
            { key: 'toDate', label: 'To', type: 'date', required: true },
            { key: 'includeForecast', label: 'Include forecasts', type: 'check' },
            {
              key: 'bucket',
              label: 'Plan by',
              type: 'select',
              options: [
                { id: 'DAY', label: 'Day' },
                { id: 'WEEK', label: 'Week (Monday to Sunday)' },
                { id: 'MONTH', label: 'Month' },
                { id: 'RANGE', label: 'The whole range at once' },
              ],
            },
            { key: 'notes', label: 'Notes' },
          ]}
          initial={{
            fromDate: today,
            toDate: addDays(today, 30),
            includeForecast: true,
            bucket: 'WEEK',
          }}
          onClose={() => setAdding(false)}
          onSubmit={async (v) => {
            const { includeForecast, ...rest } = v;
            const r = await mpost('/mrp', { ...rest, includeForecast: includeForecast === 'true' });
            toast(`Created ${s(r.number)}`);
            setAdding(false);
            list.reload();
            setOpen(s(r.id));
          }}
        />
      ) : null}
    </>
  );
}

// ------------------------------------------------------------------------------------------------ daily board
const QTY_COLS: [string, string][] = [
  ['lineQty', 'Line qty'],
  ['unit2Qty', 'Unit 2 qty'],
  ['coatingQty', 'Coating qty'],
  ['dispatchQty', 'Dispatch qty'],
];

const WEEKDAYS: [string, string][] = [
  ['1', 'Mon'],
  ['2', 'Tue'],
  ['3', 'Wed'],
  ['4', 'Thu'],
  ['5', 'Fri'],
  ['6', 'Sat'],
  ['0', 'Sun'],
];

/** Where released orders land on the work centers: forward loading by free minutes per day, no holiday calendar. */
function CapacityTab() {
  const [from, setFrom] = useState(todayIso());
  const [days, setDays] = useState<string[]>(['0', '1', '2', '3', '4', '5', '6']);
  const key = days.join(',');
  const data = useLoad(
    () => (days.length ? mget('/capacity', { from, workDays: key }) : Promise.resolve(null)),
    [from, key],
  );
  const orders = (data.data?.orders as Row[] | undefined) ?? [];
  const load = (data.data?.days as Row[] | undefined) ?? [];
  return (
    <>
      <div className="toolbar">
        <label htmlFor="cap-from">From</label>
        <input id="cap-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <span>Working days:</span>
        {WEEKDAYS.map(([k, label]) => (
          <label key={k}>
            <input
              type="checkbox"
              checked={days.includes(k)}
              onChange={(e) =>
                setDays((d) => (e.target.checked ? [...d, k] : d.filter((x) => x !== k)))
              }
            />{' '}
            {label}
          </label>
        ))}
      </div>
      <p className="hint">
        Each operation takes the free minutes of its work center day by day, and an order&apos;s
        operations follow one another. Holidays are not known yet (the calendars come later): untick
        the days that are not worked.
      </p>
      {days.length === 0 ? <ErrorBox message="Choose at least one working day." /> : null}
      <ErrorBox message={data.error} />
      <h4>Orders</h4>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Order</th>
              <th>Due</th>
              <th>Planned to finish</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.data && orders.length === 0 ? (
              <Empty cols={4}>No released order with work left.</Empty>
            ) : null}
            {orders.map((o) => (
              <tr key={s(o.orderId)}>
                <td>{s(o.orderNo)}</td>
                <td>{dmy(s(o.due))}</td>
                <td>{o.finish ? dmy(s(o.finish)) : 'Not within the horizon'}</td>
                <td>
                  {o.late === true ? (
                    <Pill tone="rejected">Late</Pill>
                  ) : (
                    <Pill tone="approved">On time</Pill>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h4>Load per work center</h4>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Day</th>
              <th>Work center</th>
              <th>Minutes planned</th>
              <th>Minutes available</th>
              <th>Load</th>
            </tr>
          </thead>
          <tbody>
            {data.data && load.length === 0 ? <Empty cols={5}>Nothing is planned.</Empty> : null}
            {load.map((d) => (
              <tr key={`${s(d.day)}-${s(d.workCentreId)}`}>
                <td>{dmy(s(d.day))}</td>
                <td>{s(d.workCentre)}</td>
                <td>{s(d.load)}</td>
                <td>{s(d.capacity)}</td>
                <td>
                  {Number(d.capacity) > 0
                    ? `${Math.round((Number(d.load) / Number(d.capacity)) * 100)} %`
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function BoardPage({ actions }: { actions: ActionSet }) {
  const [tab, setTab] = useState<'board' | 'capacity'>('board');
  return (
    <>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          ['board', 'Daily board'],
          ['capacity', 'Capacity'],
        ]}
      />
      {tab === 'board' ? <DailyBoard actions={actions} /> : <CapacityTab />}
    </>
  );
}

function DailyBoard({ actions }: { actions: ActionSet }) {
  const toast = useToast();
  const [from, setFrom] = useState(todayIso());
  const [to, setTo] = useState(addDays(todayIso(), 7));
  const [edit, setEdit] = useState<Row | 'new' | null>(null);
  const [msg, setMsg] = useState('');
  const list = useLoad(() => mlist('/plan', { from, to }), [from, to]);
  const totals = (list.data?.meta.totals ?? {}) as Record<string, string>;
  const cur = edit && edit !== 'new' ? edit : null;
  return (
    <>
      <PageHead
        title="Production Planning"
        sub="The daily board: per day, the customer PO, delivery date and what each stage is to make, with the owner of every stage."
      />
      <div className="toolbar">
        <label htmlFor="pl-from">From</label>
        <input id="pl-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <label htmlFor="pl-to">To</label>
        <input id="pl-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        {actions.add ? (
          <button type="button" className="btn primary" onClick={() => setEdit('new')}>
            + Add to the board
          </button>
        ) : null}
        {actions.print ? (
          <FileButton
            path={`/export/plan?from=${from}&to=${to}`}
            name="mfg-plan.xlsx"
            label="Export Excel"
          />
        ) : null}
      </div>
      <ErrorBox message={msg || list.error} />
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Customer PO</th>
              <th>Item</th>
              <th>Delivery</th>
              {QTY_COLS.map(([, l]) => (
                <th key={l}>{l}</th>
              ))}
              <th>Owners (line / unit 2 / coating / dispatch)</th>
              <th>Remark</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.data && list.data.rows.length === 0 && !list.loading ? (
              <Empty cols={11}>Nothing planned in this range.</Empty>
            ) : null}
            {(list.data?.rows ?? []).map((r) => (
              <tr key={s(r.id)}>
                <td>{dmy(s(r.planDate))}</td>
                <td>{s(r.customerPoNo)}</td>
                <td>{r.itemName ? `${s(r.itemCode)} · ${s(r.itemName)}` : '—'}</td>
                <td>{r.deliveryDate ? dmy(s(r.deliveryDate)) : '—'}</td>
                {QTY_COLS.map(([k]) => (
                  <td key={k}>{s(r[k])}</td>
                ))}
                <td>
                  {[r.ownerLine, r.ownerUnit2, r.ownerCoating, r.ownerDispatch]
                    .map((x) => s(x) || '–')
                    .join(' / ')}
                </td>
                <td>{s(r.remark)}</td>
                <td>
                  {actions.edit ? (
                    <button type="button" className="btn" onClick={() => setEdit(r)}>
                      Edit
                    </button>
                  ) : null}
                  {actions.delete ? (
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        setMsg('');
                        mdelete(`/plan/${s(r.id)}`)
                          .then(() => {
                            toast('Removed');
                            list.reload();
                          })
                          .catch((e: unknown) => setMsg(toUiError(e).message));
                      }}
                    >
                      Remove
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
            {list.data && list.data.rows.length ? (
              <tr>
                <td colSpan={4}>
                  <b>Total</b>
                </td>
                {QTY_COLS.map(([k]) => (
                  <td key={k}>
                    <b>{s(totals[k])}</b>
                  </td>
                ))}
                <td colSpan={3} />
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {edit ? (
        <FormModal
          title={cur ? 'Edit the board row' : 'Add to the board'}
          fields={[
            { key: 'planDate', label: 'Date', type: 'date', required: true },
            { key: 'customerPoNo', label: 'Customer PO' },
            ...(cur ? [] : [{ key: 'itemId', label: 'Item', type: 'item' as const }]),
            { key: 'deliveryDate', label: 'Delivery date', type: 'date' },
            { key: 'lineQty', label: 'Line qty', type: 'number' },
            { key: 'unit2Qty', label: 'Unit 2 qty', type: 'number' },
            { key: 'coatingQty', label: 'Coating qty', type: 'number' },
            { key: 'dispatchQty', label: 'Dispatch qty', type: 'number' },
            { key: 'ownerLine', label: 'Line owner' },
            { key: 'ownerUnit2', label: 'Unit 2 owner' },
            { key: 'ownerCoating', label: 'Coating owner' },
            { key: 'ownerDispatch', label: 'Dispatch owner' },
            { key: 'remark', label: 'Remark', type: 'textarea' },
          ]}
          initial={
            cur
              ? Object.fromEntries(
                  [
                    'planDate',
                    'customerPoNo',
                    'deliveryDate',
                    'lineQty',
                    'unit2Qty',
                    'coatingQty',
                    'dispatchQty',
                    'ownerLine',
                    'ownerUnit2',
                    'ownerCoating',
                    'ownerDispatch',
                    'remark',
                  ].map((k) => [k, k.endsWith('Date') ? s(cur[k]).slice(0, 10) : s(cur[k])]),
                )
              : { planDate: from }
          }
          onClose={() => setEdit(null)}
          onSubmit={async (v) => {
            if (cur) await mpatch(`/plan/${s(cur.id)}`, Number(cur.version), v);
            else await mpost('/plan', v);
            toast('Saved');
            setEdit(null);
            list.reload();
          }}
        />
      ) : null}
    </>
  );
}
