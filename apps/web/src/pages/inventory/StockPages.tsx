// Reservations + holds, counts (cycle / physical / weekly Powder Stock Monitoring Sheet) and Smart Reorder.
import { useState } from 'react';
import { Modal } from '../../components/Modal';
import { Pager } from '../../components/Pager';
import { useToast } from '../../components/Toast';
import { toUiError } from '../../lib/errors';
import {
  closeCount,
  countStep,
  createCount,
  createReservation,
  enterCount,
  getCount,
  listCounts,
  listHolds,
  listPolicies,
  listReservations,
  listSuggestions,
  placeHold,
  recalcReorder,
  releaseHold,
  releaseReservation,
  resolveSuggestion,
  savePolicy,
  extendReservation,
  type CountHead,
  type Ref,
} from '../../lib/inventoryApi';
import { useLoad } from '../../lib/useLoad';
import type { ActionSet } from '../../types';
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

function useAct(reload: () => void) {
  const toast = useToast();
  const [err, setErr] = useState('');
  const act = async (fn: () => Promise<unknown>, msg: string) => {
    setErr('');
    try {
      await fn();
      toast(msg);
      reload();
    } catch (e) {
      setErr(toUiError(e).message);
    }
  };
  return { err, act, setErr };
}

// ---------------------------------------------------------------------------------------------
export function ReservationsPage({ actions }: { actions: ActionSet }) {
  const [tab, setTab] = useState<'res' | 'hold'>('res');
  const [page, setPage] = useState(1);
  const res = useLoad(() => listReservations({ page }), [page]);
  const holds = useLoad(() => listHolds(page), [page]);
  const [adding, setAdding] = useState<'res' | 'hold' | null>(null);
  const { err, act } = useAct(() => {
    res.reload();
    holds.reload();
  });
  return (
    <>
      <PageHead
        title="Stock Reservation"
        sub="Earmark stock for an order, or put a quantity on hold. Reserved and held stock cannot be issued to anyone else."
      >
        {actions.add ? (
          <button type="button" className="btn primary" onClick={() => setAdding(tab)}>
            {tab === 'res' ? '＋ New Reservation' : '＋ Put on Hold'}
          </button>
        ) : null}
      </PageHead>
      <div className="tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'res'}
          className={`tab${tab === 'res' ? ' active' : ''}`}
          onClick={() => setTab('res')}
        >
          Reservations
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'hold'}
          className={`tab${tab === 'hold' ? ' active' : ''}`}
          onClick={() => setTab('hold')}
        >
          Holds
        </button>
      </div>
      <ErrorBox message={res.error || holds.error || err} />
      {tab === 'res' ? (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Number</th>
                <th scope="col">Item</th>
                <th scope="col">Warehouse</th>
                <th scope="col">Priority</th>
                <th scope="col" style={{ textAlign: 'right' }}>
                  Needed
                </th>
                <th scope="col" style={{ textAlign: 'right' }}>
                  Reserved
                </th>
                <th scope="col">Until</th>
                <th scope="col">Status</th>
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              {(res.data?.rows.length ?? 0) === 0 && !res.loading ? (
                <Empty cols={9}>No reservations yet. Click + New Reservation.</Empty>
              ) : null}
              {(res.data?.rows ?? []).map((r) => (
                <tr key={r.id}>
                  <td>
                    <strong>{r.code}</strong>
                  </td>
                  <td>
                    {r.itemCode} · {r.itemName}
                  </td>
                  <td>{r.warehouseCode}</td>
                  <td>{r.priority}</td>
                  <td style={{ textAlign: 'right' }}>{qty(r.requiredQty)}</td>
                  <td style={{ textAlign: 'right' }}>{qty(r.reservedQty)}</td>
                  <td>{dmy(r.reservedUntil)}</td>
                  <td>
                    <Pill>{r.status}</Pill>
                  </td>
                  <td>
                    {['Waiting', 'Partial', 'Reserved'].includes(r.status) && actions.edit ? (
                      <div className="actions">
                        <button
                          type="button"
                          className="btn sm"
                          onClick={() =>
                            void act(
                              () => extendReservation(r.id, r.version, 7),
                              'Extended by 7 days.',
                            )
                          }
                        >
                          +7 days
                        </button>
                        <button
                          type="button"
                          className="btn sm danger"
                          onClick={() =>
                            void act(
                              () => releaseReservation(r.id, r.version, 'Released by user'),
                              'Reservation released.',
                            )
                          }
                        >
                          Release
                        </button>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Number</th>
                <th scope="col" style={{ textAlign: 'right' }}>
                  Qty
                </th>
                <th scope="col">Reason</th>
                <th scope="col">Status</th>
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              {(holds.data?.rows.length ?? 0) === 0 && !holds.loading ? (
                <Empty cols={5}>No holds. Click + Put on Hold.</Empty>
              ) : null}
              {(holds.data?.rows ?? []).map((h) => (
                <tr key={h.id}>
                  <td>
                    <strong>{h.code}</strong>
                  </td>
                  <td style={{ textAlign: 'right' }}>{qty(h.qty)}</td>
                  <td>{h.reason}</td>
                  <td>
                    <Pill>{h.status}</Pill>
                  </td>
                  <td>
                    {h.status === 'Active' && actions.edit ? (
                      <button
                        type="button"
                        className="btn sm"
                        onClick={() =>
                          void act(() => releaseHold(h.id, h.version), 'Hold released.')
                        }
                      >
                        Release
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager
        page={page}
        size={20}
        total={(tab === 'res' ? res.data?.meta.total : holds.data?.meta.total) ?? 0}
        onPage={setPage}
      />
      {adding ? (
        <ReserveForm
          mode={adding}
          onClose={() => setAdding(null)}
          onSaved={() => {
            setAdding(null);
            res.reload();
            holds.reload();
          }}
        />
      ) : null}
    </>
  );
}

function ReserveForm({
  mode,
  onClose,
  onSaved,
}: {
  mode: 'res' | 'hold';
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [item, setItem] = useState<Ref | null>(null);
  const [warehouseId, setW] = useState('');
  const [amount, setAmount] = useState('');
  const [priority, setPriority] = useState('Medium');
  const [text, setText] = useState('');
  const [msg, setMsg] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  return (
    <Modal
      title={mode === 'res' ? 'New Reservation' : 'Put Stock on Hold'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              void (async () => {
                try {
                  if (mode === 'res')
                    await createReservation({
                      itemId: item?.id ?? '',
                      warehouseId,
                      requiredQty: Number(amount),
                      priority,
                      demandRef: text || null,
                    });
                  else
                    await placeHold({
                      itemId: item?.id ?? '',
                      warehouseId,
                      qty: Number(amount),
                      reason: text,
                    });
                  toast('Saved.');
                  onSaved();
                } catch (e) {
                  const u = toUiError(e);
                  setMsg(u.message);
                  setFields(u.fields);
                }
              })();
            }}
          >
            Save
          </button>
        </>
      }
    >
      <ErrorBox message={msg} />
      <ItemPicker value={item} onPick={setItem} error={fields.itemId} />
      <WarehouseSelect value={warehouseId} onChange={setW} error={fields.warehouseId} />
      <div className="field">
        <label>
          {mode === 'res' ? 'Quantity needed' : 'Quantity to hold'} *
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        {fields.requiredQty || fields.qty ? (
          <span className="field-error">{fields.requiredQty ?? fields.qty}</span>
        ) : null}
      </div>
      {mode === 'res' ? (
        <div className="field">
          <label>
            Priority
            <select value={priority} onChange={(e) => setPriority(e.target.value)}>
              {['Critical', 'High', 'Medium', 'Low'].map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
        </div>
      ) : null}
      <div className="field">
        <label>
          {mode === 'res' ? 'For (order or job number)' : 'Reason *'}
          <input value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        {fields.reason ? <span className="field-error">{fields.reason}</span> : null}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------------------------
export function CountsPage({
  type,
  actions,
}: {
  type?: 'CYCLE' | 'PHYSICAL' | 'POWDER_WEEKLY';
  actions: ActionSet;
}) {
  const titles = {
    ALL: {
      t: 'Stock Reconciliation',
      s: 'Every count and its differences in one place. Approve a count to post its differences to stock and the books.',
    },
    CYCLE: {
      t: 'Cycle Count',
      s: 'Count a few items at a time. Differences outside the tolerance need a second count by another person.',
    },
    PHYSICAL: {
      t: 'Physical Verification',
      s: 'Count a whole warehouse. The warehouse is frozen while you count.',
    },
    POWDER_WEEKLY: {
      t: 'Powder Stock Monitoring Sheet',
      s: 'Weekly check of each powder item (Week 1 to 5). A confirmed difference is posted as a stock adjustment.',
    },
  } as const;
  const [page, setPage] = useState(1);
  const list = useLoad(
    () => listCounts({ ...(type ? { countType: type } : {}), page }),
    [type, page],
  );
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      <PageHead title={titles[type ?? 'ALL'].t} sub={titles[type ?? 'ALL'].s}>
        {actions.add && type ? (
          <button type="button" className="btn primary" onClick={() => setAdding(true)}>
            ＋ New {type === 'POWDER_WEEKLY' ? 'Sheet' : 'Count'}
          </button>
        ) : null}
      </PageHead>
      <ErrorBox message={list.error} />
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Number</th>
              <th scope="col">Date</th>
              {type === 'POWDER_WEEKLY' ? <th scope="col">Month</th> : null}
              <th scope="col">Accuracy</th>
              <th scope="col">Status</th>
              <th scope="col">Action</th>
            </tr>
          </thead>
          <tbody>
            {(list.data?.rows.length ?? 0) === 0 && !list.loading ? (
              <Empty
                cols={type === 'POWDER_WEEKLY' ? 6 : 5}
              >{`Nothing here yet. Click + New ${type === 'POWDER_WEEKLY' ? 'Sheet' : 'Count'}.`}</Empty>
            ) : null}
            {(list.data?.rows ?? []).map((c: CountHead) => (
              <tr key={c.id}>
                <td>
                  <strong>{c.code}</strong>
                </td>
                <td>{dmy(c.plannedDate)}</td>
                {type === 'POWDER_WEEKLY' ? <td>{c.monthLabel}</td> : null}
                <td>{c.accuracyPct === null ? '—' : `${c.accuracyPct}%`}</td>
                <td>
                  <Pill>{c.status}</Pill>
                </td>
                <td>
                  <button type="button" className="btn sm" onClick={() => setOpen(c.id)}>
                    Open
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager page={page} size={20} total={list.data?.meta.total ?? 0} onPage={setPage} />
      {adding && type ? (
        <CountForm
          type={type}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            list.reload();
          }}
        />
      ) : null}
      {open ? (
        <CountDialog
          id={open}
          actions={actions}
          onClose={() => {
            setOpen(null);
            list.reload();
          }}
        />
      ) : null}
    </>
  );
}

function CountForm({
  type,
  onClose,
  onSaved,
}: {
  type: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [warehouseId, setW] = useState('');
  const [items, setItems] = useState<Ref[]>([]);
  const [picker, setPicker] = useState<Ref | null>(null);
  const [month, setMonth] = useState(todayIso().slice(0, 7));
  const [msg, setMsg] = useState('');
  return (
    <Modal
      title="New Count"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              void (async () => {
                try {
                  const c = await createCount({
                    countType: type,
                    warehouseId,
                    ...(items.length ? { itemIds: items.map((i) => i.id) } : {}),
                    ...(type === 'POWDER_WEEKLY' ? { monthLabel: month } : {}),
                  });
                  toast(`Created ${c.code}.`);
                  onSaved();
                } catch (e) {
                  setMsg(toUiError(e).message);
                }
              })();
            }}
          >
            Create
          </button>
        </>
      }
    >
      <ErrorBox message={msg} />
      <WarehouseSelect value={warehouseId} onChange={setW} />
      {type === 'POWDER_WEEKLY' ? (
        <div className="field">
          <label>
            Month
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          </label>
        </div>
      ) : null}
      {type !== 'PHYSICAL' ? (
        <>
          <ItemPicker
            label={
              type === 'POWDER_WEEKLY'
                ? 'Add a powder item (or leave empty for every item in category Powder)'
                : 'Add an item to count'
            }
            value={picker}
            onPick={(it) => {
              if (it && !items.some((x) => x.id === it.id)) setItems([...items, it]);
              setPicker(null);
            }}
          />
          <ul>
            {items.map((i) => (
              <li key={i.id}>
                {i.code} · {i.name}{' '}
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => setItems(items.filter((x) => x.id !== i.id))}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p>Every item that has stock in the warehouse will be counted.</p>
      )}
    </Modal>
  );
}

function CountDialog({
  id,
  actions,
  onClose,
}: {
  id: string;
  actions: ActionSet;
  onClose: () => void;
}) {
  const d = useLoad(() => getCount(id), [id]);
  const { err, act } = useAct(d.reload);
  const [vals, setVals] = useState<Record<string, string>>({});
  const c = d.data;
  const step = (s: 'start' | 'review' | 'approve' | 'post' | 'cancel', label: string) =>
    c ? (
      <button
        type="button"
        className="btn sm primary"
        onClick={() => void act(() => countStep(c.id, c.version, s), label)}
      >
        {label}
      </button>
    ) : null;
  return (
    <Modal
      title={c ? `${c.code}` : 'Count'}
      sub={
        c
          ? `${c.status}${c.blind && c.status === 'Counting' ? ' · blind count (system quantities hidden)' : ''}`
          : ''
      }
      onClose={onClose}
      footer={
        <button type="button" className="btn" onClick={onClose}>
          Close
        </button>
      }
    >
      <ErrorBox message={d.error || err} />
      {c ? (
        <>
          <div className="actions">
            {c.status === 'Planned' && actions.edit ? step('start', 'Start counting') : null}
            {c.status === 'Counting' && actions.edit ? step('review', 'Send for review') : null}
            {c.status === 'Under Review' && actions.approve ? step('approve', 'Approve') : null}
            {c.status === 'Approved' && actions.post ? step('post', 'Post differences') : null}
            {c.status === 'Posted' && actions.edit ? (
              <button
                type="button"
                className="btn sm"
                onClick={() =>
                  void act(() => closeCount(c.id, c.version, 'Verified and closed'), 'Closed.')
                }
              >
                Close count
              </button>
            ) : null}
            {['Planned', 'Counting', 'Under Review', 'Approved'].includes(c.status) &&
            actions.edit ? (
              <button
                type="button"
                className="btn sm danger"
                onClick={() =>
                  void act(() => countStep(c.id, c.version, 'cancel'), 'Count cancelled.')
                }
              >
                Cancel
              </button>
            ) : null}
          </div>
          {c.review?.classes.some((x) => x.caroFlag) ? (
            <div className="notice" role="note">
              Net variance is 10% or more of book value for:{' '}
              {c.review.classes
                .filter((x) => x.caroFlag)
                .map((x) => x.itemType)
                .join(', ')}
              . Tell the auditor.
            </div>
          ) : null}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Item</th>
                  {c.countType === 'POWDER_WEEKLY' ? <th scope="col">Week</th> : null}
                  <th scope="col" style={{ textAlign: 'right' }}>
                    System
                  </th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    Counted
                  </th>
                  <th scope="col">Status</th>
                  <th scope="col">Enter</th>
                </tr>
              </thead>
              <tbody>
                {c.lines.map((l) => (
                  <tr key={l.id}>
                    <td>
                      {l.item?.code} · {l.item?.name}
                    </td>
                    {c.countType === 'POWDER_WEEKLY' ? <td>{l.weekNo}</td> : null}
                    <td style={{ textAlign: 'right' }}>
                      {l.systemQty === null ? '••' : qty(l.systemQty)}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {qty(l.finalQty ?? l.count1Qty)}
                      {l.variance ? (
                        <small>
                          {' '}
                          ({l.variance > 0 ? '+' : ''}
                          {qty(l.variance)})
                        </small>
                      ) : null}
                    </td>
                    <td>
                      <Pill>{l.status}</Pill>
                    </td>
                    <td>
                      {c.status === 'Counting' && actions.edit ? (
                        <div className="row-gap">
                          <input
                            aria-label={`Count for ${l.item?.code ?? 'item'} line ${l.lineNo}`}
                            inputMode="decimal"
                            style={{ width: 90 }}
                            value={vals[l.id] ?? ''}
                            onChange={(e) => setVals({ ...vals, [l.id]: e.target.value })}
                          />
                          <button
                            type="button"
                            className="btn sm"
                            onClick={() =>
                              void act(
                                () => enterCount(c.id, l.id, Number(vals[l.id] ?? '')),
                                'Saved.',
                              )
                            }
                          >
                            Save
                          </button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </Modal>
  );
}

// ---------------------------------------------------------------------------------------------
export function ReorderPage({ actions }: { actions: ActionSet }) {
  const [tab, setTab] = useState<'sug' | 'pol'>('sug');
  const [page, setPage] = useState(1);
  const sug = useLoad(() => listSuggestions('Open', page), [page]);
  const pol = useLoad(() => listPolicies(page), [page]);
  const { err, act } = useAct(() => {
    sug.reload();
    pol.reload();
  });
  const [adding, setAdding] = useState(false);
  const [asking, setAsking] = useState<{ id: string; action: 'convert' | 'dismiss' } | null>(null);
  const [answer, setAnswer] = useState('');
  return (
    <>
      <PageHead
        title="Smart Reorder"
        sub="Tells you what to buy and how much, from the minimum, the maximum or the usage of each item."
      >
        {actions.edit ? (
          <button
            type="button"
            className="btn"
            onClick={() => void act(() => recalcReorder(), 'Recalculated.')}
          >
            Recalculate now
          </button>
        ) : null}
        {actions.add ? (
          <button type="button" className="btn primary" onClick={() => setAdding(true)}>
            ＋ Add Policy
          </button>
        ) : null}
      </PageHead>
      <div className="tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'sug'}
          className={`tab${tab === 'sug' ? ' active' : ''}`}
          onClick={() => setTab('sug')}
        >
          Suggested orders
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'pol'}
          className={`tab${tab === 'pol' ? ' active' : ''}`}
          onClick={() => setTab('pol')}
        >
          Policies
        </button>
      </div>
      <ErrorBox message={sug.error || pol.error || err} />
      {tab === 'sug' ? (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col">Warehouse</th>
                <th scope="col" style={{ textAlign: 'right' }}>
                  You have
                </th>
                <th scope="col" style={{ textAlign: 'right' }}>
                  Order level
                </th>
                <th scope="col" style={{ textAlign: 'right' }}>
                  Suggested order
                </th>
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              {(sug.data?.rows.length ?? 0) === 0 && !sug.loading ? (
                <Empty cols={6}>Nothing to order right now.</Empty>
              ) : null}
              {(sug.data?.rows ?? []).map((s) => (
                <tr key={s.id}>
                  <td>
                    {s.itemCode} · {s.itemName}
                  </td>
                  <td>{s.warehouse}</td>
                  <td style={{ textAlign: 'right' }}>{qty(s.positionQty)}</td>
                  <td style={{ textAlign: 'right' }}>{qty(s.triggerQty)}</td>
                  <td style={{ textAlign: 'right' }}>
                    <strong>{qty(s.suggestedQty)}</strong>
                  </td>
                  <td>
                    {actions.edit ? (
                      <div className="actions">
                        <button
                          type="button"
                          className="btn sm"
                          onClick={() => setAsking({ id: s.id, action: 'convert' })}
                        >
                          Mark ordered
                        </button>
                        <button
                          type="button"
                          className="btn sm"
                          onClick={() => setAsking({ id: s.id, action: 'dismiss' })}
                        >
                          Dismiss
                        </button>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col">Warehouse</th>
                <th scope="col">Method</th>
                <th scope="col" style={{ textAlign: 'right' }}>
                  Min / Max
                </th>
                <th scope="col" style={{ textAlign: 'right' }}>
                  Order level
                </th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {(pol.data?.rows.length ?? 0) === 0 && !pol.loading ? (
                <Empty cols={6}>No policies yet. Click + Add Policy.</Empty>
              ) : null}
              {(pol.data?.rows ?? []).map((p) => (
                <tr key={p.id}>
                  <td>
                    {p.itemCode} · {p.itemName}
                  </td>
                  <td>{p.warehouse}</td>
                  <td>{p.method === 'MIN_MAX' ? 'Min / Max' : 'Reorder point + EOQ'}</td>
                  <td style={{ textAlign: 'right' }}>
                    {qty(p.minQty)} / {qty(p.maxQty)}
                  </td>
                  <td style={{ textAlign: 'right' }}>{qty(p.calc?.trigger)}</td>
                  <td>
                    <Pill>{p.calc?.status ?? p.status}</Pill>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager
        page={page}
        size={20}
        total={(tab === 'sug' ? sug.data?.meta.total : pol.data?.meta.total) ?? 0}
        onPage={setPage}
      />
      {asking ? (
        <Modal
          title={asking.action === 'convert' ? 'Mark as ordered' : 'Dismiss this suggestion'}
          size="sm"
          onClose={() => setAsking(null)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setAsking(null)}>
                Close
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={answer.trim().length < 2}
                onClick={() => {
                  void act(
                    () => resolveSuggestion(asking.id, asking.action, answer.trim()),
                    asking.action === 'convert' ? 'Marked as ordered.' : 'Dismissed.',
                  );
                  setAsking(null);
                  setAnswer('');
                }}
              >
                Save
              </button>
            </>
          }
        >
          <div className="field">
            <label>
              {asking.action === 'convert' ? 'Purchase request number' : 'Reason'}
              <input value={answer} onChange={(e) => setAnswer(e.target.value)} />
            </label>
          </div>
        </Modal>
      ) : null}
      {adding ? (
        <PolicyForm
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            pol.reload();
            sug.reload();
          }}
        />
      ) : null}
    </>
  );
}

function PolicyForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [item, setItem] = useState<Ref | null>(null);
  const [warehouseId, setW] = useState('');
  const [method, setMethod] = useState<'MIN_MAX' | 'ROP_EOQ'>('MIN_MAX');
  const [min, setMin] = useState('0');
  const [max, setMax] = useState('0');
  const [lead, setLead] = useState('7');
  const [multiple, setMultiple] = useState('1');
  const [msg, setMsg] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  return (
    <Modal
      title="Add Reorder Policy"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              void (async () => {
                try {
                  await savePolicy(null, null, {
                    itemId: item?.id ?? '',
                    warehouseId,
                    method,
                    minQty: Number(min),
                    maxQty: Number(max),
                    leadTimeDays: Number(lead),
                    orderMultiple: Number(multiple),
                  });
                  toast('Policy saved.');
                  onSaved();
                } catch (e) {
                  const u = toUiError(e);
                  setMsg(u.message);
                  setFields(u.fields);
                }
              })();
            }}
          >
            Save
          </button>
        </>
      }
    >
      <ErrorBox message={msg} />
      <ItemPicker value={item} onPick={setItem} error={fields.itemId} />
      <WarehouseSelect value={warehouseId} onChange={setW} error={fields.warehouseId} />
      <div className="field">
        <label>
          Method
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value as 'MIN_MAX' | 'ROP_EOQ')}
          >
            <option value="MIN_MAX">Min / Max</option>
            <option value="ROP_EOQ">Reorder point + EOQ (from usage)</option>
          </select>
        </label>
      </div>
      <div className="field">
        <label>
          Minimum
          <input inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} />
        </label>
      </div>
      <div className="field">
        <label>
          Maximum
          <input inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value)} />
        </label>
        {fields.maxQty ? <span className="field-error">{fields.maxQty}</span> : null}
      </div>
      <div className="field">
        <label>
          Lead time (days)
          <input inputMode="numeric" value={lead} onChange={(e) => setLead(e.target.value)} />
        </label>
      </div>
      <div className="field">
        <label>
          Order in multiples of
          <input
            inputMode="decimal"
            value={multiple}
            onChange={(e) => setMultiple(e.target.value)}
          />
        </label>
      </div>
    </Modal>
  );
}

/** Cycle Count page: the ordinary cycle counts and the weekly Powder Stock Monitoring Sheet side by side. */
export function CycleCountsPage({ actions }: { actions: ActionSet }) {
  const [tab, setTab] = useState<'CYCLE' | 'POWDER_WEEKLY'>('CYCLE');
  return (
    <>
      <div className="tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'CYCLE'}
          className={`tab${tab === 'CYCLE' ? ' active' : ''}`}
          onClick={() => setTab('CYCLE')}
        >
          Cycle counts
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'POWDER_WEEKLY'}
          className={`tab${tab === 'POWDER_WEEKLY' ? ' active' : ''}`}
          onClick={() => setTab('POWDER_WEEKLY')}
        >
          Powder stock sheet (weekly)
        </button>
      </div>
      <CountsPage key={tab} type={tab} actions={actions} />
    </>
  );
}
