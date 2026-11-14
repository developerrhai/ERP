// The daily board and the capacity view kept from the first build (they sit under Production Planning as two tabs).
import { useState } from 'react';
import { useToast } from '../../components/Toast';
import { toUiError } from '../../lib/errors';
import { mdelete, mget, mlist, mpatch, mpost } from '../../lib/mfgApi';
import type { Row } from '../../lib/mfgApi';
import { useLoad } from '../../lib/useLoad';
import type { ActionSet } from '../../types';
import { dmy, Empty, ErrorBox, Pill, todayIso } from '../finance/shared';
import { FileButton, FormModal, s } from './Kit';
import { addDays } from './Ui';
import { DateField } from '../../ui/components';

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
export function CapacityTab() {
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
        <DateField id="cap-from" value={from} onChange={(e) => setFrom(e.target.value)} />
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

export function DailyBoard({ actions }: { actions: ActionSet }) {
  const toast = useToast();
  const [from, setFrom] = useState(todayIso());
  const [to, setTo] = useState(addDays(todayIso(), 7));
  const [edit, setEdit] = useState<Row | 'new' | null>(null);
  const [msg, setMsg] = useState('');
  const list = useLoad(() => mlist('/day-board', { from, to }), [from, to]);
  const totals = (list.data?.meta.totals ?? {}) as Record<string, string>;
  const cur = edit && edit !== 'new' ? edit : null;
  return (
    <>
      <div className="toolbar">
        <label htmlFor="pl-from">From</label>
        <DateField id="pl-from" value={from} onChange={(e) => setFrom(e.target.value)} />
        <label htmlFor="pl-to">To</label>
        <DateField id="pl-to" value={to} onChange={(e) => setTo(e.target.value)} />
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
                        mdelete(`/day-board/${s(r.id)}`)
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
            if (cur) await mpatch(`/day-board/${s(cur.id)}`, Number(cur.version), v);
            else await mpost('/day-board', v);
            toast('Saved');
            setEdit(null);
            list.reload();
          }}
        />
      ) : null}
    </>
  );
}
