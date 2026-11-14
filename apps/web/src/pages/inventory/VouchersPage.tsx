// Stock vouchers with lines: Opening Stock, Receipt / Issue, Stock Adjustment, Stock Transfer. One screen, four kinds.
// Draft -> Submit -> (Approve) -> Post (or Dispatch / Receive for transfers) -> Cancel. A cancel needs a reason and a date.
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Modal } from '../../components/Modal';
import { Pager } from '../../components/Pager';
import { useToast } from '../../components/Toast';
import { toUiError } from '../../lib/errors';
import {
  listLedger,
  createVoucher,
  deleteVoucher,
  listVouchers,
  submitVoucher,
  updateVoucher,
  voucherAction,
  type LineInput,
  type Ref,
  type StockStatus,
  type Voucher,
  type VoucherInput,
  type VoucherKind,
} from '../../lib/inventoryApi';
import { useLoad } from '../../lib/useLoad';
import type { ActionSet } from '../../types';
import { CustomerMaterialPage } from './CustomerMaterialPage';
import {
  dmy,
  Empty,
  ErrorBox,
  inr,
  ItemPicker,
  PageHead,
  Pill,
  qty,
  STATUS_LABEL,
  todayIso,
  WarehouseSelect,
} from './shared';
import { DateField } from '../../ui/components';

const TITLES: Record<VoucherKind, { title: string; sub: string; add: string }> = {
  opening: {
    title: 'Opening Stock',
    sub: 'The first stock of an item in a warehouse, before any other movement.',
    add: '＋ New Opening Stock',
  },
  transactions: {
    title: 'Inventory Transactions',
    sub: 'Receive material into a store or issue it out. Every line moves stock and the books together.',
    add: '＋ New Receipt / Issue',
  },
  adjustment: {
    title: 'Stock Adjustment',
    sub: 'Correct the stock of items to the quantity you counted.',
    add: '＋ New Adjustment',
  },
  transfer: {
    title: 'Stock Transfer',
    sub: 'Move stock to another warehouse or unit in two steps: Dispatch, then Receive.',
    add: '＋ New Transfer',
  },
};
const REASONS = ['Damage', 'Expiry', 'Count Correction', 'Theft/Loss', 'Other'];

interface DraftLine {
  item: Ref | null;
  qty: string;
  unitCost: string;
  countedQty: string;
  batchNo: string;
  mfgDate: string;
  expiryDate: string;
  serials: string;
  stockStatus: StockStatus;
  reasonCode: string;
}
const blankLine = (): DraftLine => ({
  item: null,
  qty: '',
  unitCost: '',
  countedQty: '',
  batchNo: '',
  mfgDate: '',
  expiryDate: '',
  serials: '',
  stockStatus: 'UNRESTRICTED',
  reasonCode: 'Count Correction',
});

function VouchersList({
  kind,
  actions,
  toolbar,
}: {
  kind: VoucherKind;
  actions: ActionSet;
  toolbar?: ReactNode;
}) {
  const toast = useToast();
  const meta = TITLES[kind];
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const list = useLoad(() => listVouchers(kind, { page, status, q }), [kind, page, status, q]);
  const [editing, setEditing] = useState<Voucher | 'new' | null>(null);
  const [cancelling, setCancelling] = useState<Voucher | null>(null);
  const [viewing, setViewing] = useState<Voucher | null>(null);
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
      <PageHead title={meta.title} sub={meta.sub}>
        <Link className="btn" to="/approvals">
          My Approvals
        </Link>
        {actions.add ? (
          <button type="button" className="btn primary" onClick={() => setEditing('new')}>
            {meta.add}
          </button>
        ) : null}
      </PageHead>
      {toolbar}
      <div className="filters">
        <input
          aria-label="Search"
          placeholder="Search number, item or batch"
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
          {[
            'Draft',
            'Pending Approval',
            'Approved',
            'Rejected',
            'Posted',
            'Dispatched',
            'Received',
            'Cancelled',
          ].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </div>
      <ErrorBox message={list.error || err} />
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Number</th>
              <th scope="col">Date</th>
              <th scope="col">{kind === 'transfer' ? 'From → To' : 'Warehouse'}</th>
              {kind === 'transactions' ? <th scope="col">Type</th> : null}
              <th scope="col">Lines</th>
              <th scope="col" style={{ textAlign: 'right' }}>
                Value
              </th>
              <th scope="col">Status</th>
              <th scope="col">Action</th>
            </tr>
          </thead>
          <tbody>
            {!list.loading && (list.data?.rows.length ?? 0) === 0 ? (
              <Empty
                cols={kind === 'transactions' ? 8 : 7}
              >{`No ${meta.title.toLowerCase()} yet. Click ${meta.add.replace('＋ ', '+ ')}.`}</Empty>
            ) : null}
            {(list.data?.rows ?? []).map((v) => (
              <tr key={v.id}>
                <td>
                  <button type="button" className="link" onClick={() => setViewing(v)}>
                    <strong>{v.number}</strong>
                  </button>
                </td>
                <td>{dmy(v.postingDate)}</td>
                <td>
                  {kind === 'transfer'
                    ? `${v.warehouse?.code ?? ''} → ${v.toWarehouse?.code ?? ''}`
                    : (v.warehouse?.code ?? '—')}
                </td>
                {kind === 'transactions' ? <td>{v.txType}</td> : null}
                <td>{v.lines.length}</td>
                <td style={{ textAlign: 'right' }}>
                  {v.totalValue === null ? '—' : inr(v.totalValue)}
                </td>
                <td>
                  <Pill>{v.status}</Pill>
                </td>
                <td>
                  <div className="actions">
                    {(v.status === 'Draft' || v.status === 'Rejected') && actions.edit ? (
                      <button type="button" className="btn sm" onClick={() => setEditing(v)}>
                        Edit
                      </button>
                    ) : null}
                    {(v.status === 'Draft' || v.status === 'Rejected') && actions.submit ? (
                      <button
                        type="button"
                        className="btn sm primary"
                        title="Send for approval"
                        onClick={() =>
                          void act(
                            () => submitVoucher(kind, v.id, v.version),
                            `${v.number} sent for approval.`,
                          )
                        }
                      >
                        Submit
                      </button>
                    ) : null}
                    {v.status === 'Approved' && actions.post && kind !== 'transfer' ? (
                      <button
                        type="button"
                        className="btn sm primary"
                        onClick={() =>
                          void act(() => voucherAction(kind, v.id, 'post'), `${v.number} posted.`)
                        }
                      >
                        Post
                      </button>
                    ) : null}
                    {v.status === 'Approved' && actions.post && kind === 'transfer' ? (
                      <button
                        type="button"
                        className="btn sm primary"
                        onClick={() =>
                          void act(
                            () => voucherAction(kind, v.id, 'dispatch'),
                            `${v.number} dispatched.`,
                          )
                        }
                      >
                        Dispatch
                      </button>
                    ) : null}
                    {v.status === 'Dispatched' && actions.post ? (
                      <button
                        type="button"
                        className="btn sm primary"
                        onClick={() =>
                          void act(
                            () => voucherAction(kind, v.id, 'receive'),
                            `${v.number} received.`,
                          )
                        }
                      >
                        Receive
                      </button>
                    ) : null}
                    {['Posted', 'Dispatched', 'Approved', 'Draft', 'Rejected'].includes(v.status) &&
                    (actions.edit || actions.cancel) ? (
                      <button
                        type="button"
                        className="btn sm danger"
                        onClick={() => setCancelling(v)}
                      >
                        Cancel
                      </button>
                    ) : null}
                    {v.status === 'Draft' && actions.delete ? (
                      <button
                        type="button"
                        className="btn sm"
                        onClick={() =>
                          void act(
                            () => deleteVoucher(kind, v.id, v.version),
                            `${v.number} deleted.`,
                          )
                        }
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
      {editing ? (
        <VoucherForm
          kind={kind}
          voucher={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(n) => {
            setEditing(null);
            toast(`Saved ${n}.`);
            list.reload();
          }}
        />
      ) : null}
      {cancelling ? (
        <CancelDialog
          voucher={cancelling}
          onClose={() => setCancelling(null)}
          onDone={async (reason, date) => {
            await voucherAction(kind, cancelling.id, 'cancel', { reason, cancelDate: date });
            toast(`${cancelling.number} cancelled.`);
            setCancelling(null);
            list.reload();
          }}
        />
      ) : null}
      {viewing ? (
        <Modal
          title={viewing.number}
          sub={`${viewing.status} · ${dmy(viewing.postingDate)}`}
          onClose={() => setViewing(null)}
          footer={
            <button type="button" className="btn" onClick={() => setViewing(null)}>
              Close
            </button>
          }
        >
          <LinesTable v={viewing} kind={kind} />
        </Modal>
      ) : null}
    </>
  );
}

function LinesTable({ v, kind }: { v: Voucher; kind: VoucherKind }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Item</th>
            <th scope="col">Batch</th>
            <th scope="col" style={{ textAlign: 'right' }}>
              {kind === 'adjustment' ? 'System → Counted' : 'Qty'}
            </th>
            <th scope="col" style={{ textAlign: 'right' }}>
              Value
            </th>
            <th scope="col">Stock</th>
          </tr>
        </thead>
        <tbody>
          {v.lines.map((l) => (
            <tr key={l.id}>
              <td>{l.lineNo}</td>
              <td>
                {l.item.code} · {l.item.name}
              </td>
              <td>
                {l.batchNo ?? '—'}
                {l.expiryDate ? ` (exp ${dmy(l.expiryDate)})` : ''}
              </td>
              <td style={{ textAlign: 'right' }}>
                {kind === 'adjustment' ? `${qty(l.systemQty)} → ${qty(l.countedQty)}` : qty(l.qty)}
              </td>
              <td style={{ textAlign: 'right' }}>{l.value === null ? '—' : inr(l.value)}</td>
              <td>{STATUS_LABEL[l.stockStatus] ?? l.stockStatus}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CancelDialog({
  voucher,
  onClose,
  onDone,
}: {
  voucher: Voucher;
  onClose: () => void;
  onDone: (reason: string, date: string) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [date, setDate] = useState(todayIso());
  const [err, setErr] = useState('');
  const posted = voucher.status === 'Posted' || voucher.status === 'Dispatched';
  return (
    <Modal
      title={`Cancel ${voucher.number}?`}
      sub={
        posted
          ? 'Stock and the books are reversed on the cancel date. The original entries stay.'
          : 'This voucher has not moved stock yet.'
      }
      size="sm"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Keep it
          </button>
          <button
            type="button"
            className="btn danger"
            onClick={() => {
              void (async () => {
                try {
                  await onDone(reason, date);
                } catch (e) {
                  setErr(toUiError(e).message);
                }
              })();
            }}
          >
            Cancel voucher
          </button>
        </>
      }
    >
      <ErrorBox message={err} />
      {posted ? (
        <>
          <div className="field">
            <label>
              Cancel date
              <DateField value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
          </div>
          <div className="field">
            <label>
              Reason (5 to 300 characters)
              <input value={reason} onChange={(e) => setReason(e.target.value)} />
            </label>
          </div>
        </>
      ) : null}
    </Modal>
  );
}

function VoucherForm({
  kind,
  voucher,
  onClose,
  onSaved,
}: {
  kind: VoucherKind;
  voucher: Voucher | null;
  onClose: () => void;
  onSaved: (n: string) => void;
}) {
  const [date, setDate] = useState(voucher?.postingDate ?? todayIso());
  const [warehouseId, setWarehouseId] = useState(voucher?.warehouse?.id ?? '');
  const [toWarehouseId, setTo] = useState(voucher?.toWarehouse?.id ?? '');
  const [txType, setTxType] = useState<'Receipt' | 'Issue'>(voucher?.txType ?? 'Receipt');
  const [reference, setReference] = useState(voucher?.reference ?? '');
  const [vehicle, setVehicle] = useState(voucher?.vehicleRef ?? '');
  const [lines, setLines] = useState<DraftLine[]>(
    voucher
      ? voucher.lines.map((l) => ({
          item: { id: l.item.id, code: l.item.code, name: l.item.name, uom: l.item.baseUom },
          qty: String(l.qty ?? ''),
          unitCost: l.unitCost === null ? '' : String(l.unitCost),
          countedQty: l.countedQty === null ? '' : String(l.countedQty),
          batchNo: l.batchNo ?? '',
          mfgDate: l.mfgDate ?? '',
          expiryDate: l.expiryDate ?? '',
          serials: l.serialNos.join(', '),
          stockStatus: l.stockStatus,
          reasonCode: l.reasonCode ?? 'Count Correction',
        }))
      : [blankLine()],
  );
  const [fields, setFields] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const costed = kind === 'opening' || (kind === 'transactions' && txType === 'Receipt');
  const showBatch =
    kind !== 'adjustment'
      ? kind !== 'transfer' && !(kind === 'transactions' && txType === 'Issue')
      : true;

  const set = (i: number, patch: Partial<DraftLine>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const save = async () => {
    setBusy(true);
    setMsg('');
    setFields({});
    const payload: VoucherInput = {
      postingDate: date,
      warehouseId,
      ...(kind === 'transfer' ? { toWarehouseId } : {}),
      ...(kind === 'transactions' ? { txType } : {}),
      reference: reference || null,
      vehicleRef: kind === 'transfer' ? vehicle || null : null,
      lines: lines
        .filter((l) => l.item)
        .map((l): LineInput => {
          const serials = l.serials
            .split(/[,\n]/)
            .map((s) => s.trim())
            .filter(Boolean);
          return {
            itemId: l.item!.id,
            ...(kind === 'adjustment'
              ? {
                  countedQty: l.countedQty === '' ? null : Number(l.countedQty),
                  reasonCode: l.reasonCode,
                }
              : { qty: Number(l.qty) }),
            ...(costed ? { unitCost: l.unitCost === '' ? null : Number(l.unitCost) } : {}),
            ...(l.batchNo
              ? { batchNo: l.batchNo, mfgDate: l.mfgDate || null, expiryDate: l.expiryDate || null }
              : {}),
            ...(serials.length ? { serialNos: serials } : {}),
            ...(l.stockStatus !== 'UNRESTRICTED' ? { stockStatus: l.stockStatus } : {}),
          };
        }),
    };
    try {
      const saved = voucher
        ? await updateVoucher(kind, voucher.id, voucher.version, payload)
        : await createVoucher(kind, payload);
      onSaved(saved.number);
    } catch (e) {
      const u = toUiError(e);
      setMsg(u.message);
      setFields(u.fields);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={voucher ? `Edit ${voucher.number}` : TITLES[kind].add.replace('＋ ', '')}
      sub="Save keeps it as a Draft. Submit it for approval from the list."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          <button type="button" className="btn primary" disabled={busy} onClick={() => void save()}>
            Save draft
          </button>
        </>
      }
    >
      <ErrorBox message={msg} />
      <div className="form-grid">
        <div className="field">
          <label>
            Date
            <DateField value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          {fields.postingDate ? <span className="field-error">{fields.postingDate}</span> : null}
        </div>
        <WarehouseSelect
          value={warehouseId}
          onChange={setWarehouseId}
          label={kind === 'transfer' ? 'From warehouse' : 'Warehouse'}
          error={fields.warehouseId}
        />
        {kind === 'transfer' ? (
          <WarehouseSelect
            value={toWarehouseId}
            onChange={setTo}
            label="To warehouse"
            any
            exclude={warehouseId}
            error={fields.toWarehouseId}
          />
        ) : null}
        {kind === 'transactions' ? (
          <div className="field">
            <label>
              Type
              <select
                value={txType}
                onChange={(e) => setTxType(e.target.value as 'Receipt' | 'Issue')}
              >
                <option>Receipt</option>
                <option>Issue</option>
              </select>
            </label>
          </div>
        ) : null}
        <div className="field">
          <label>
            Reference
            <input
              value={reference}
              maxLength={100}
              onChange={(e) => setReference(e.target.value)}
            />
          </label>
        </div>
        {kind === 'transfer' ? (
          <div className="field">
            <label>
              Vehicle
              <input value={vehicle} maxLength={60} onChange={(e) => setVehicle(e.target.value)} />
            </label>
          </div>
        ) : null}
      </div>
      {fields.lines ? <span className="field-error">{fields.lines}</span> : null}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col">{kind === 'adjustment' ? 'Counted qty' : 'Qty'}</th>
              {costed ? <th scope="col">Unit cost</th> : null}
              {showBatch ? <th scope="col">Batch / dates / serials</th> : null}
              {kind === 'adjustment' ? <th scope="col">Reason</th> : null}
              {costed ? <th scope="col">Stock status</th> : null}
              <th scope="col">
                <span className="sr-only">Remove</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td style={{ minWidth: 220 }}>
                  <ItemPicker
                    label={`Item ${i + 1}`}
                    value={l.item}
                    onPick={(it) => set(i, { item: it })}
                    error={fields[`lines.${i}.itemId`]}
                  />
                </td>
                <td>
                  <div className="field">
                    <input
                      aria-label={`Quantity ${i + 1}`}
                      inputMode="decimal"
                      value={kind === 'adjustment' ? l.countedQty : l.qty}
                      onChange={(e) =>
                        set(
                          i,
                          kind === 'adjustment'
                            ? { countedQty: e.target.value }
                            : { qty: e.target.value },
                        )
                      }
                    />
                    {fields[`lines.${i}.qty`] || fields[`lines.${i}.countedQty`] ? (
                      <span className="field-error">
                        {fields[`lines.${i}.qty`] ?? fields[`lines.${i}.countedQty`]}
                      </span>
                    ) : null}
                  </div>
                </td>
                {costed ? (
                  <td>
                    <div className="field">
                      <input
                        aria-label={`Unit cost ${i + 1}`}
                        inputMode="decimal"
                        value={l.unitCost}
                        onChange={(e) => set(i, { unitCost: e.target.value })}
                      />
                      {fields[`lines.${i}.unitCost`] ? (
                        <span className="field-error">{fields[`lines.${i}.unitCost`]}</span>
                      ) : null}
                    </div>
                  </td>
                ) : null}
                {showBatch ? (
                  <td style={{ minWidth: 200 }}>
                    <input
                      aria-label={`Batch ${i + 1}`}
                      placeholder="Batch no."
                      value={l.batchNo}
                      onChange={(e) => set(i, { batchNo: e.target.value })}
                    />
                    {fields[`lines.${i}.batchNo`] ? (
                      <span className="field-error">{fields[`lines.${i}.batchNo`]}</span>
                    ) : null}
                    <div className="row-gap">
                      <DateField
                        aria-label={`Manufactured ${i + 1}`}
                        title="Manufacturing date"
                        value={l.mfgDate}
                        onChange={(e) => set(i, { mfgDate: e.target.value })}
                      />
                      <DateField
                        aria-label={`Expiry ${i + 1}`}
                        title="Expiry date"
                        value={l.expiryDate}
                        onChange={(e) => set(i, { expiryDate: e.target.value })}
                      />
                    </div>
                    <input
                      aria-label={`Serial numbers ${i + 1}`}
                      placeholder="Serial numbers, comma separated"
                      value={l.serials}
                      onChange={(e) => set(i, { serials: e.target.value })}
                    />
                  </td>
                ) : null}
                {kind === 'adjustment' ? (
                  <td>
                    <select
                      aria-label={`Reason ${i + 1}`}
                      value={l.reasonCode}
                      onChange={(e) => set(i, { reasonCode: e.target.value })}
                    >
                      {REASONS.map((r) => (
                        <option key={r}>{r}</option>
                      ))}
                    </select>
                  </td>
                ) : null}
                {costed ? (
                  <td>
                    <select
                      aria-label={`Stock status ${i + 1}`}
                      value={l.stockStatus}
                      onChange={(e) => set(i, { stockStatus: e.target.value as StockStatus })}
                    >
                      {(['UNRESTRICTED', 'QUALITY_INSPECTION', 'BLOCKED'] as const).map((s) => (
                        <option key={s} value={s}>
                          {STATUS_LABEL[s]}
                        </option>
                      ))}
                    </select>
                  </td>
                ) : null}
                <td>
                  {lines.length > 1 ? (
                    <button
                      type="button"
                      className="btn sm"
                      aria-label={`Remove line ${i + 1}`}
                      onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                    >
                      ✕
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        className="btn sm"
        onClick={() => setLines((ls) => [...ls, blankLine()])}
      >
        ＋ Add line
      </button>
    </Modal>
  );
}

/** Inventory Transactions opens on the stock ledger (every movement, newest first); Vouchers is the document list. */
export function VouchersPage({ kind, actions }: { kind: VoucherKind; actions: ActionSet }) {
  const [view, setView] = useState<'ledger' | 'vouchers' | 'customer'>('ledger');
  if (kind !== 'transactions') return <VouchersList kind={kind} actions={actions} />;
  const toolbar = (
    <div className="tabs" role="tablist">
      {(['ledger', 'vouchers', 'customer'] as const).map((v) => (
        <button
          key={v}
          type="button"
          role="tab"
          aria-selected={view === v}
          className={`tab${view === v ? ' active' : ''}`}
          onClick={() => setView(v)}
        >
          {v === 'ledger' ? 'Ledger' : v === 'vouchers' ? 'Vouchers' : 'Customer Material'}
        </button>
      ))}
    </div>
  );
  if (view === 'customer') return <CustomerMaterialPage actions={actions} toolbar={toolbar} />;
  return view === 'vouchers' ? (
    <VouchersList kind={kind} actions={actions} toolbar={toolbar} />
  ) : (
    <LedgerView toolbar={toolbar} />
  );
}

const txt = (v: unknown): string => (typeof v === 'string' ? v : '');

function LedgerView({ toolbar }: { toolbar: ReactNode }) {
  const [page, setPage] = useState(1);
  const list = useLoad(() => listLedger(page), [page]);
  return (
    <>
      <PageHead
        title="Inventory Transactions"
        sub="Every stock movement, newest first. Nothing here can be edited: a mistake is corrected by cancelling its voucher."
      />
      {toolbar}
      <ErrorBox message={list.error} />
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Voucher</th>
              <th scope="col">Type</th>
              <th scope="col">Item</th>
              <th scope="col">Warehouse</th>
              <th scope="col" style={{ textAlign: 'right' }}>
                In
              </th>
              <th scope="col" style={{ textAlign: 'right' }}>
                Out
              </th>
              <th scope="col" style={{ textAlign: 'right' }}>
                Value
              </th>
              <th scope="col" style={{ textAlign: 'right' }}>
                Balance
              </th>
            </tr>
          </thead>
          <tbody>
            {!list.loading && (list.data?.rows.length ?? 0) === 0 ? (
              <Empty cols={9}>No stock movements yet. Post a receipt or opening stock.</Empty>
            ) : null}
            {(list.data?.rows ?? []).map((r) => (
              <tr key={r.id}>
                <td>{dmy(txt(r.data.postingDate))}</td>
                <td>{txt(r.data.voucherNo) || r.code}</td>
                <td>{txt(r.data.voucherType)}</td>
                <td>{txt(r.data.item)}</td>
                <td>{txt(r.data.warehouse)}</td>
                <td style={{ textAlign: 'right' }}>{qty(Number(r.data.qtyIn ?? 0) || null)}</td>
                <td style={{ textAlign: 'right' }}>{qty(Number(r.data.qtyOut ?? 0) || null)}</td>
                <td style={{ textAlign: 'right' }}>{inr(Number(r.data.value ?? 0))}</td>
                <td style={{ textAlign: 'right' }}>{qty(Number(r.data.balanceQty ?? 0))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager page={page} size={20} total={list.data?.meta.total ?? 0} onPage={setPage} />
    </>
  );
}
