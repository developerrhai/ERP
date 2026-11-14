// Batch / Lot, Serial Number and Bin masters (Phase 8). Batches and serials are created by stock postings; here they are
// found, quality-controlled (Pending QC / Released / On Hold / Rejected), extended, recalled and traced.
import { useState } from 'react';
import { Modal } from '../../components/Modal';
import { Pager } from '../../components/Pager';
import { useToast } from '../../components/Toast';
import { toUiError } from '../../lib/errors';
import {
  batchExtend,
  batchPatch,
  batchQc,
  batchRecall,
  createBin,
  deleteBin,
  getBatch,
  listBatches,
  listBins,
  listSerials,
  serialHistory,
  updateBin,
  type BatchDetail,
  type BinRow,
} from '../../lib/inventoryApi';
import { useLoad } from '../../lib/useLoad';
import type { ActionSet } from '../../types';
import { dmy, Empty, ErrorBox, PageHead, Pill, qty, WarehouseSelect } from './shared';
import { DateField } from '../../ui/components';

const DISPOSITIONS = [
  'Use First',
  'Discount Sale',
  'Return to Supplier',
  'Rework',
  'Scrap',
  'Donate',
];

export function BatchesPage({ actions }: { actions: ActionSet }) {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [qc, setQc] = useState('');
  const [stockOnly, setStockOnly] = useState(true);
  const list = useLoad(
    () => listBatches({ page, q, qcStatus: qc, withStockOnly: stockOnly }),
    [page, q, qc, stockOnly],
  );
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      <PageHead
        title="Batch / Lot Tracking"
        sub="Every batch with its dates, quality status and stock. Batches are created when stock is received."
      />
      <div className="filters">
        <input
          aria-label="Search"
          placeholder="Search batch or item"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
        <select
          aria-label="Quality status"
          value={qc}
          onChange={(e) => {
            setQc(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All quality statuses</option>
          {['Pending QC', 'Released', 'On Hold', 'Rejected'].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <label className="check">
          <input
            type="checkbox"
            checked={stockOnly}
            onChange={(e) => {
              setStockOnly(e.target.checked);
              setPage(1);
            }}
          />{' '}
          Only batches in stock
        </label>
      </div>
      <ErrorBox message={list.error} />
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Batch</th>
              <th scope="col">Item</th>
              <th scope="col">Made</th>
              <th scope="col">Expiry</th>
              <th scope="col" style={{ textAlign: 'right' }}>
                In stock
              </th>
              <th scope="col">Quality</th>
              <th scope="col">Action</th>
            </tr>
          </thead>
          <tbody>
            {(list.data?.rows.length ?? 0) === 0 && !list.loading ? (
              <Empty cols={7}>
                No batches yet. They appear when batch-tracked stock is received.
              </Empty>
            ) : null}
            {(list.data?.rows ?? []).map((b) => (
              <tr key={b.id}>
                <td>
                  <strong>{b.batchNo}</strong>
                  {b.recalled ? <span className="status cancelled"> Recalled</span> : null}
                </td>
                <td>
                  {b.itemCode} · {b.itemName}
                </td>
                <td>{dmy(b.mfgDate)}</td>
                <td>
                  {dmy(b.expiryDate)}
                  {b.daysToExpiry !== null ? (
                    <small> ({b.daysToExpiry <= 0 ? 'expired' : `${b.daysToExpiry} days`})</small>
                  ) : null}
                </td>
                <td style={{ textAlign: 'right' }}>
                  {qty(b.onHand)}
                  {b.qualityInspection > 0 ? (
                    <small> ({qty(b.qualityInspection)} in inspection)</small>
                  ) : null}
                </td>
                <td>
                  <Pill>{b.qcStatus}</Pill>
                </td>
                <td>
                  <button type="button" className="btn sm" onClick={() => setOpen(b.id)}>
                    Open
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager page={page} size={20} total={list.data?.meta.total ?? 0} onPage={setPage} />
      {open ? (
        <BatchDialog
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

function BatchDialog({
  id,
  actions,
  onClose,
}: {
  id: string;
  actions: ActionSet;
  onClose: () => void;
}) {
  const toast = useToast();
  const d = useLoad(() => getBatch(id), [id]);
  const [reason, setReason] = useState('');
  const [newExpiry, setNewExpiry] = useState('');
  const [err, setErr] = useState('');
  const b: BatchDetail | null = d.data;
  const run = async (fn: (v: number) => Promise<BatchDetail>, msg: string) => {
    if (!b) return;
    setErr('');
    try {
      const out = await fn(b.version);
      d.setData(out);
      toast(msg);
      setReason('');
    } catch (e) {
      setErr(toUiError(e).message);
    }
  };
  return (
    <Modal
      title={b ? `Batch ${b.batchNo}` : 'Batch'}
      sub={b ? `${b.qcStatus}${b.recalled ? ' · recalled' : ''}` : ''}
      onClose={onClose}
      footer={
        <button type="button" className="btn" onClick={onClose}>
          Close
        </button>
      }
    >
      <ErrorBox message={d.error || err} />
      {b ? (
        <>
          <p>
            Made {dmy(b.mfgDate)} · Expires {dmy(b.expiryDate)} · Supplier {b.supplierName ?? '—'} ·
            GRN {b.grnRef ?? '—'}
          </p>
          <h4>Stock</h4>
          <ul>
            {b.stock.map((s, i) => (
              <li key={i}>
                {s.warehouse}: {qty(s.qty)} ({s.stockStatus.toLowerCase().replace('_', ' ')})
              </li>
            ))}
            {b.stock.length === 0 ? <li>No stock.</li> : null}
          </ul>
          {actions.approve || actions.edit ? (
            <div className="field">
              <label>
                Reason (needed for every change)
                <input value={reason} onChange={(e) => setReason(e.target.value)} />
              </label>
            </div>
          ) : null}
          <div className="actions">
            {actions.approve
              ? (['Released', 'On Hold', 'Rejected'] as const)
                  .filter((s) => s !== b.qcStatus)
                  .map((s) => (
                    <button
                      key={s}
                      type="button"
                      className="btn sm"
                      onClick={() =>
                        void run((v) => batchQc(id, v, s, reason), `Batch ${s.toLowerCase()}.`)
                      }
                    >
                      {s === 'Released' ? 'Release' : s === 'On Hold' ? 'Put on hold' : 'Reject'}
                    </button>
                  ))
              : null}
            {actions.approve && !b.recalled ? (
              <button
                type="button"
                className="btn sm danger"
                onClick={() =>
                  void run((v) => batchRecall(id, v, 'start', reason), 'Recall started.')
                }
              >
                Start recall
              </button>
            ) : null}
            {actions.approve && b.recalled ? (
              <button
                type="button"
                className="btn sm"
                onClick={() =>
                  void run((v) => batchRecall(id, v, 'close', reason, 'Released'), 'Recall closed.')
                }
              >
                Close recall (release)
              </button>
            ) : null}
          </div>
          {actions.edit ? (
            <>
              <div className="field">
                <label>
                  Extend expiry to
                  <DateField
                    value={newExpiry}
                    onChange={(e) => setNewExpiry(e.target.value)}
                  />
                </label>
              </div>
              <button
                type="button"
                className="btn sm"
                disabled={!newExpiry}
                onClick={() =>
                  void run((v) => batchExtend(id, v, newExpiry, reason), 'Expiry extended.')
                }
              >
                Extend expiry
              </button>
              <div className="field">
                <label>
                  What to do with it
                  <select
                    value={b.disposition ?? ''}
                    onChange={(e) =>
                      void run(
                        (v) => batchPatch(id, v, { disposition: e.target.value || null }),
                        'Saved.',
                      )
                    }
                  >
                    <option value="">—</option>
                    {DISPOSITIONS.map((x) => (
                      <option key={x}>{x}</option>
                    ))}
                  </select>
                </label>
              </div>
            </>
          ) : null}
          <h4>History</h4>
          <ul>
            {b.events.map((e, i) => (
              <li key={i}>
                {dmy(e.at)} · {e.event}
                {e.to ? ` → ${e.to}` : ''}
                {e.reason ? ` · ${e.reason}` : ''}
              </li>
            ))}
          </ul>
          <h4>Movements</h4>
          <ul>
            {b.movements.slice(0, 20).map((m, i) => (
              <li key={i}>
                {dmy(m.date)} · {m.voucherNo} · {m.type} ·{' '}
                {m.qtyIn ? `+${qty(m.qtyIn)}` : `-${qty(m.qtyOut)}`}
              </li>
            ))}
          </ul>
          {b.affected ? (
            <>
              <h4>Affected documents</h4>
              <ul>
                {b.affected.map((a, i) => (
                  <li key={i}>
                    {a.voucherNo} · {qty(a.qty)}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </>
      ) : null}
    </Modal>
  );
}

export function SerialsPage() {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const list = useLoad(() => listSerials({ page, q, status }), [page, q, status]);
  const [open, setOpen] = useState<string | null>(null);
  const hist = useLoad(() => (open ? serialHistory(open) : Promise.resolve(null)), [open]);
  return (
    <>
      <PageHead
        title="Serial Number Tracking"
        sub="Where every serial-numbered unit is, and everything that happened to it."
      />
      <div className="filters">
        <input
          aria-label="Search"
          placeholder="Search serial or item"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
        <select
          aria-label="Status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All statuses</option>
          {['In Stock', 'Reserved', 'In Transit', 'Issued', 'Returned', 'Scrapped'].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </div>
      <ErrorBox message={list.error} />
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Serial</th>
              <th scope="col">Item</th>
              <th scope="col">Warehouse</th>
              <th scope="col">Status</th>
              <th scope="col">Action</th>
            </tr>
          </thead>
          <tbody>
            {(list.data?.rows.length ?? 0) === 0 && !list.loading ? (
              <Empty cols={5}>
                No serial numbers yet. They appear when serial-tracked stock is received.
              </Empty>
            ) : null}
            {(list.data?.rows ?? []).map((s) => (
              <tr key={s.id}>
                <td>
                  <strong>{s.serialNo}</strong>
                </td>
                <td>
                  {s.itemCode} · {s.itemName}
                </td>
                <td>{s.warehouse ?? '—'}</td>
                <td>
                  <Pill>{s.status}</Pill>
                </td>
                <td>
                  <button type="button" className="btn sm" onClick={() => setOpen(s.id)}>
                    History
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager page={page} size={20} total={list.data?.meta.total ?? 0} onPage={setPage} />
      {open ? (
        <Modal
          title={hist.data ? `Serial ${hist.data.serialNo}` : 'Serial'}
          sub={hist.data?.status}
          onClose={() => setOpen(null)}
          footer={
            <button type="button" className="btn" onClick={() => setOpen(null)}>
              Close
            </button>
          }
        >
          <ul>
            {(hist.data?.events ?? []).map((e, i) => (
              <li key={i}>
                {dmy(e.at)} · {e.event}
                {e.voucherNo ? ` · ${e.voucherNo}` : ''}
              </li>
            ))}
          </ul>
        </Modal>
      ) : null}
    </>
  );
}

export function BinsPage({ actions }: { actions: ActionSet }) {
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [wh, setWh] = useState('');
  const list = useLoad(() => listBins({ page, warehouseId: wh }), [page, wh]);
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState('');
  const act = async (fn: () => Promise<unknown>, msg: string) => {
    setErr('');
    try {
      await fn();
      toast(msg);
      list.reload();
    } catch (e) {
      setErr(toUiError(e).message);
    }
  };
  return (
    <>
      <PageHead
        title="Bin Management"
        sub="The shelves and positions inside a warehouse. Put a bin on a voucher line to know exactly where stock sits."
      >
        {actions.add ? (
          <button type="button" className="btn primary" onClick={() => setAdding(true)}>
            ＋ Add Bin
          </button>
        ) : null}
      </PageHead>
      <div className="filters">
        <WarehouseSelect
          value={wh}
          onChange={(v) => {
            setWh(v);
            setPage(1);
          }}
          label="Warehouse"
        />
      </div>
      <ErrorBox message={list.error || err} />
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Bin</th>
              <th scope="col">Zone</th>
              <th scope="col">Type</th>
              <th scope="col" style={{ textAlign: 'right' }}>
                Capacity
              </th>
              <th scope="col" style={{ textAlign: 'right' }}>
                Stock
              </th>
              <th scope="col">Status</th>
              <th scope="col">Action</th>
            </tr>
          </thead>
          <tbody>
            {(list.data?.rows.length ?? 0) === 0 && !list.loading ? (
              <Empty cols={7}>No bins yet. Click + Add Bin.</Empty>
            ) : null}
            {(list.data?.rows ?? []).map((b: BinRow) => (
              <tr key={b.id}>
                <td>
                  <strong>{b.code}</strong>
                  {b.name ? ` · ${b.name}` : ''}
                </td>
                <td>{b.zone ?? '—'}</td>
                <td>{b.binType}</td>
                <td style={{ textAlign: 'right' }}>{qty(b.capacity)}</td>
                <td style={{ textAlign: 'right' }}>{qty(b.onHand)}</td>
                <td>
                  <Pill>{b.status}</Pill>
                </td>
                <td>
                  <div className="actions">
                    {actions.edit ? (
                      <button
                        type="button"
                        className="btn sm"
                        onClick={() =>
                          void act(
                            () =>
                              updateBin(b.id, b.version, {
                                status: b.status === 'Active' ? 'Inactive' : 'Active',
                              }),
                            'Saved.',
                          )
                        }
                      >
                        {b.status === 'Active' ? 'Deactivate' : 'Activate'}
                      </button>
                    ) : null}
                    {actions.delete ? (
                      <button
                        type="button"
                        className="btn sm danger"
                        onClick={() => void act(() => deleteBin(b.id), 'Bin deleted.')}
                      >
                        Delete
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager page={page} size={20} total={list.data?.meta.total ?? 0} onPage={setPage} />
      {adding ? (
        <BinForm
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            toast('Bin added.');
            list.reload();
          }}
        />
      ) : null}
    </>
  );
}

function BinForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [warehouseId, setW] = useState('');
  const [code, setCode] = useState('');
  const [zone, setZone] = useState('');
  const [capacity, setCap] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState('');
  return (
    <Modal
      title="Add Bin"
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
                  await createBin({
                    warehouseId,
                    code,
                    zone: zone || undefined,
                    capacity: capacity === '' ? null : Number(capacity),
                  });
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
      <WarehouseSelect value={warehouseId} onChange={setW} error={fields.warehouseId} />
      <div className="field">
        <label>
          Bin code *<input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
        </label>
        {fields.code ? <span className="field-error">{fields.code}</span> : null}
      </div>
      <div className="field">
        <label>
          Zone
          <input value={zone} onChange={(e) => setZone(e.target.value)} />
        </label>
      </div>
      <div className="field">
        <label>
          Capacity
          <input inputMode="decimal" value={capacity} onChange={(e) => setCap(e.target.value)} />
        </label>
      </div>
    </Modal>
  );
}
