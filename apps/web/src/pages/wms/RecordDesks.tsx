// Warehouse Master, Warehouse Transfers and Barcode / QR inside the Warehouse register. They use the forms of the
// records themselves (warehouse form and record view, stock transfer voucher, item barcode).
import { useState } from 'react';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { useAppContext } from '../../lib/context';
import { deleteVoucher, getVoucher, submitVoucher, voucherAction, type Voucher } from '../../lib/inventoryApi';
import { useLoad } from '../../lib/useLoad';
import { usePagePermissions } from '../../lib/usePagePermissions';
import type { ActionSet, User } from '../../types';
import { deleteRecord, getRecord, getSchema, newIdempotencyKey, runAction, updateRecord, type RecordRow } from '../generic/engineApi';
import { RecordDrawer } from '../generic/RecordDrawer';
import { RecordFormModal } from '../generic/RecordFormModal';
import { ScanPage } from '../inventory/ReportsPages';
import { ErrorBox, ItemPicker, dmy } from '../inventory/shared';
import { CancelDialog, LinesTable, VoucherForm } from '../inventory/VouchersPage';
import { useFrame } from '../frame/V40TabFrame';
import type { V40Row } from '../sales/salesV40Api';
import { Confirm, WmsRegister, message, recordOf, useWmsActions } from './WmsRegister';

interface Props {
  pageId: string;
  title: string;
  sub: string;
  actions: ActionSet;
}
interface Ask {
  title: string;
  text: string;
  action: string;
  yes: () => void;
}
function AskBox({ ask, onClose }: { ask: Ask; onClose: () => void }) {
  return (
    <Confirm
      title={ask.title}
      text={ask.text}
      action={ask.action}
      onClose={onClose}
      onConfirm={() => {
        onClose();
        ask.yes();
      }}
    />
  );
}

// ------------------------------------------------------------------------------------------------ warehouses

export function WarehouseDesk({ pageId, title, sub, actions }: Props & { user?: User }) {
  const toast = useToast();
  const act = useWmsActions();
  const unitId = useAppContext().data?.current.unitId ?? null;
  const schema = useLoad(() => getSchema(pageId), [pageId]);
  const [form, setForm] = useState<{ row?: RecordRow } | null>(null);
  const [viewing, setViewing] = useState<RecordRow | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  const withRow = (id: string, then: (row: RecordRow) => void): void => {
    getRecord(pageId, id)
      .then(then)
      .catch((e: unknown) => act.setError(message(e)));
  };
  const toggle = (id: string, status: string): Promise<unknown> => runAction(pageId, id, status === 'Active' ? 'deactivate' : 'activate', newIdempotencyKey());
  const remove = async (id: string): Promise<unknown> => deleteRecord(pageId, await getRecord(pageId, id));
  const askDelete = (rows: V40Row[], done?: () => void): void =>
    setAsk({
      title: rows.length === 1 ? `Delete ${rows[0]?.number}?` : `Delete ${rows.length} warehouses?`,
      text: 'A warehouse with stock or stock movements is kept: deactivate it instead.',
      action: 'Delete',
      yes: () => void act.each(rows, (r) => remove(r.id), 'deleted').then(() => done?.()),
    });
  const rowExtra = (r: V40Row) => (
    <>
      {actions.edit ? (
        <button
          type="button"
          className="btn sm"
          onClick={() => void act.run(() => toggle(r.id, r.status), `${r.number} ${r.status === 'Active' ? 'deactivated' : 'activated'}.`)}
        >
          {r.status === 'Active' ? 'Deactivate' : 'Activate'}
        </button>
      ) : null}
      {actions.delete ? (
        <button type="button" className="btn sm danger" onClick={() => askDelete([r])}>
          Delete
        </button>
      ) : null}
    </>
  );
  const bulkExtra = (selected: V40Row[], done: () => void) => {
    const many = (label: string, rows: V40Row[], verbDone: string) => (
      <button
        type="button"
        className="btn sm"
        disabled={rows.length === 0}
        title={rows.length === 0 ? 'Tick the warehouses first.' : undefined}
        onClick={() => void act.each(rows, (r) => toggle(r.id, r.status), verbDone).then(done)}
      >
        {label}
      </button>
    );
    return (
      <>
        {actions.edit ? many('Activate Selected', selected.filter((r) => r.status !== 'Active'), 'activated') : null}
        {actions.edit ? many('Deactivate Selected', selected.filter((r) => r.status === 'Active'), 'deactivated') : null}
        {actions.delete ? (
          <button
            type="button"
            className="btn sm danger"
            disabled={selected.length === 0}
            title={selected.length === 0 ? 'Tick the warehouses first.' : undefined}
            onClick={() => askDelete(selected, done)}
          >
            Delete Selected
          </button>
        ) : null}
      </>
    );
  };
  const closeView = (): void => {
    setViewing(null);
    act.reload();
  };
  return (
    <WmsRegister
      pageId={pageId}
      title={title}
      sub={sub}
      actions={actions}
      add={schema.data ? [{ label: '＋ Add Warehouse', onClick: () => setForm({}) }] : []}
      error={act.error || schema.error}
      reloadKey={act.reloadKey}
      reload={act.reload}
      onOpen={(id) => withRow(id, setViewing)}
      onEdit={actions.edit ? (id) => withRow(id, (row) => setForm({ row })) : undefined}
      canEditRow={() => true}
      rowExtra={rowExtra}
      bulkExtra={bulkExtra}
    >
      {form && schema.data ? (
        <RecordFormModal
          schema={schema.data}
          unitId={unitId}
          {...(form.row ? { row: form.row } : {})}
          onClose={() => setForm(null)}
          onSaved={(row) => {
            setForm(null);
            toast(`${row.code} saved.`);
            act.reload();
          }}
        />
      ) : null}
      {viewing && schema.data ? (
        <RecordDrawer
          schema={schema.data}
          row={viewing}
          perms={actions}
          canEdit={actions.edit}
          canDelete={actions.delete}
          onEdit={(row) => {
            setViewing(null);
            setForm({ row });
          }}
          onDelete={(row) => {
            setViewing(null);
            askDelete([{ id: row.id, number: row.code, status: row.status }]);
          }}
          onAction={(row, action) => {
            setViewing(null);
            void act.run(() => runAction(pageId, row.id, action.key, newIdempotencyKey()), `${action.label}: ${row.code} done.`);
          }}
          onClose={closeView}
        />
      ) : null}
      {ask ? <AskBox ask={ask} onClose={() => setAsk(null)} /> : null}
    </WmsRegister>
  );
}

// ------------------------------------------------------------------------------------------------ transfers

const EDITABLE_TRANSFER = ['Draft', 'Rejected'];
const CANCELLABLE_TRANSFER = ['Posted', 'Dispatched', 'Approved', 'Draft', 'Rejected'];

function TransferView({ id, onClose }: { id: string; onClose: () => void }) {
  const v = useLoad(() => getVoucher('transfer', id), [id]);
  return (
    <Modal
      title={v.data?.number ?? 'Transfer'}
      sub={v.data ? `${v.data.status} · ${dmy(v.data.postingDate)} · ${v.data.warehouse?.code ?? ''} → ${v.data.toWarehouse?.code ?? ''}` : ''}
      onClose={onClose}
      footer={
        <button type="button" className="btn" onClick={onClose}>
          Close
        </button>
      }
    >
      <ErrorBox message={v.error} />
      {v.data ? <LinesTable v={v.data} kind="transfer" /> : null}
    </Modal>
  );
}

export function TransferDesk({ pageId, title, sub, actions }: Props) {
  const toast = useToast();
  const act = useWmsActions();
  // a transfer is a stock voucher: what a person may do with it follows the Stock Transfer rights the server checks
  const voucher = usePagePermissions('inv-transfer').actions;
  const [editing, setEditing] = useState<{ voucher: Voucher | null } | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<Voucher | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  const withVoucher = (id: string, then: (v: Voucher) => void): void => {
    getVoucher('transfer', id)
      .then(then)
      .catch((e: unknown) => act.setError(message(e)));
  };
  const submit = (r: V40Row): Promise<unknown> => submitVoucher('transfer', r.id, Number(r.version));
  const remove = (r: V40Row): Promise<unknown> => deleteVoucher('transfer', r.id, Number(r.version));
  const askDelete = (rows: V40Row[], done?: () => void): void =>
    setAsk({
      title: rows.length === 1 ? `Delete ${rows[0]?.number}?` : `Delete ${rows.length} drafts?`,
      text: 'Only a draft that never moved stock can be deleted.',
      action: 'Delete',
      yes: () => void act.each(rows, remove, 'deleted').then(() => done?.()),
    });
  const step = (r: V40Row, label: string, name: 'dispatch' | 'receive', done: string) => (
    <button type="button" className="btn sm primary" onClick={() => void act.run(() => voucherAction('transfer', r.id, name), `${r.number} ${done}.`)}>
      {label}
    </button>
  );
  const rowExtra = (r: V40Row) => (
    <>
      {voucher.submit && EDITABLE_TRANSFER.includes(r.status) ? (
        <button type="button" className="btn sm primary" title="Send for approval" onClick={() => void act.run(() => submit(r), `${r.number} sent for approval.`)}>
          Submit
        </button>
      ) : null}
      {voucher.post && r.status === 'Approved' ? step(r, 'Dispatch', 'dispatch', 'dispatched') : null}
      {voucher.post && r.status === 'Dispatched' ? step(r, 'Receive', 'receive', 'received') : null}
      {(voucher.edit || voucher.cancel) && CANCELLABLE_TRANSFER.includes(r.status) ? (
        <button type="button" className="btn sm danger" onClick={() => withVoucher(r.id, setCancelling)}>
          Cancel
        </button>
      ) : null}
      {voucher.delete && r.status === 'Draft' ? (
        <button type="button" className="btn sm danger" onClick={() => askDelete([r])}>
          Delete
        </button>
      ) : null}
    </>
  );
  const bulkExtra = (selected: V40Row[], done: () => void) => {
    const toSubmit = selected.filter((r) => EDITABLE_TRANSFER.includes(r.status));
    const drafts = selected.filter((r) => r.status === 'Draft');
    return (
      <>
        {voucher.submit ? (
          <button
            type="button"
            className="btn sm"
            disabled={toSubmit.length === 0}
            title={toSubmit.length === 0 ? 'Tick draft transfers first.' : undefined}
            onClick={() => void act.each(toSubmit, submit, 'sent for approval').then(done)}
          >
            Submit Selected
          </button>
        ) : null}
        {voucher.delete ? (
          <button
            type="button"
            className="btn sm danger"
            disabled={drafts.length === 0}
            title={drafts.length === 0 ? 'Tick draft transfers first.' : undefined}
            onClick={() => askDelete(drafts, done)}
          >
            Delete Selected
          </button>
        ) : null}
      </>
    );
  };
  return (
    <WmsRegister
      pageId={pageId}
      title={title}
      sub={sub}
      actions={{ ...actions, add: voucher.add }}
      add={[{ label: '＋ Add Transfer', onClick: () => setEditing({ voucher: null }) }]}
      error={act.error}
      reloadKey={act.reloadKey}
      reload={act.reload}
      onOpen={setViewing}
      onEdit={voucher.edit ? (id) => withVoucher(id, (v) => setEditing({ voucher: v })) : undefined}
      canEditRow={(status) => EDITABLE_TRANSFER.includes(status)}
      rowExtra={rowExtra}
      bulkExtra={bulkExtra}
    >
      {editing ? (
        <VoucherForm
          kind="transfer"
          voucher={editing.voucher}
          prefill={null}
          onClose={() => setEditing(null)}
          onSaved={(n) => {
            setEditing(null);
            toast(`Saved ${n}.`);
            act.reload();
          }}
        />
      ) : null}
      {viewing ? <TransferView id={viewing} onClose={() => setViewing(null)} /> : null}
      {cancelling ? (
        <CancelDialog
          voucher={cancelling}
          onClose={() => setCancelling(null)}
          onDone={async (reason, date) => {
            await voucherAction('transfer', cancelling.id, 'cancel', { reason, cancelDate: date });
            toast(`${cancelling.number} cancelled.`);
            setCancelling(null);
            act.reload();
          }}
        />
      ) : null}
      {ask ? <AskBox ask={ask} onClose={() => setAsk(null)} /> : null}
    </WmsRegister>
  );
}

// ------------------------------------------------------------------------------------------------ barcode / QR

/** Writes (or clears) the barcode of an item, with the item's own rules (a barcode is used once). */
async function saveBarcode(itemId: string, barcode: string): Promise<void> {
  const item = await getRecord('inv-items', itemId);
  await updateRecord('inv-items', item, { barcode });
}

function BarcodeForm({ item, onClose, onSaved }: { item: { id: string; label: string; barcode: string } | null; onClose: () => void; onSaved: () => void }) {
  const [picked, setPicked] = useState<{ id: string; code: string; name: string } | null>(null);
  const [code, setCode] = useState(item?.barcode ?? '');
  const [msg, setMsg] = useState('');
  const save = (): void => {
    const id = item?.id ?? picked?.id;
    if (!id) return setMsg('Pick the item first.');
    if (!code.trim()) return setMsg('Type or scan the barcode.');
    setMsg('');
    saveBarcode(id, code.trim())
      .then(onSaved)
      .catch((e: unknown) => setMsg(message(e)));
  };
  return (
    <Modal
      title={item ? (item.barcode ? 'Edit barcode' : 'Add barcode') : 'Add barcode'}
      sub={item?.label ?? 'Give an item its barcode. One barcode belongs to one item.'}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          <button type="button" className="btn primary" onClick={save}>
            Save barcode
          </button>
        </>
      }
    >
      <ErrorBox message={msg} />
      {item ? null : <ItemPicker label="Item *" value={picked} onPick={setPicked} />}
      <div className="field">
        <label>
          Barcode *
          <input autoFocus maxLength={60} value={code} onChange={(e) => setCode(e.target.value)} />
        </label>
      </div>
    </Modal>
  );
}

const SCAN_TAB = /^(scan transactions|invalid scans|scan productivity)$/i;

export function BarcodeDesk({ pageId, title, sub, actions }: Props) {
  const toast = useToast();
  const act = useWmsActions();
  const frame = useFrame();
  const item = usePagePermissions('inv-items').actions;
  const scanning = SCAN_TAB.test(frame?.tabName ?? '');
  const [form, setForm] = useState<{ item: { id: string; label: string; barcode: string } | null } | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  // the first two columns of the item tabs are the barcode and "code - name"
  const asItem = (r: V40Row) => ({ id: recordOf(r), label: r.c1 ?? r.number, barcode: r.c0 ?? '' });
  const rowExtra = (r: V40Row) =>
    scanning || !item.edit ? null : r.c0 ? (
      <>
        <button type="button" className="btn sm" onClick={() => setForm({ item: asItem(r) })}>
          Edit barcode
        </button>
        <button
          type="button"
          className="btn sm danger"
          onClick={() =>
            setAsk({
              title: `Delete the barcode of ${r.c1 ?? r.number}?`,
              text: 'The item stays. Scanning this code will no longer find it.',
              action: 'Delete',
              yes: () => void act.run(() => saveBarcode(r.id, ''), 'Barcode deleted.'),
            })
          }
        >
          Delete barcode
        </button>
      </>
    ) : (
      <button type="button" className="btn sm primary" onClick={() => setForm({ item: asItem(r) })}>
        Add barcode
      </button>
    );
  const bulkExtra = (selected: V40Row[], done: () => void) => {
    const coded = selected.filter((r) => r.c0);
    return scanning || !item.edit ? null : (
      <button
        type="button"
        className="btn sm danger"
        disabled={coded.length === 0}
        title={coded.length === 0 ? 'Tick items that have a barcode first.' : undefined}
        onClick={() =>
          setAsk({
            title: `Delete ${coded.length} barcodes?`,
            text: 'The items stay.',
            action: 'Delete',
            yes: () => void act.each(coded, (r) => saveBarcode(r.id, ''), 'deleted').then(done),
          })
        }
      >
        Delete Selected
      </button>
    );
  };
  return (
    <WmsRegister
      pageId={pageId}
      title={title}
      sub={sub}
      actions={{ ...actions, add: item.edit }}
      add={[{ label: '＋ Add Barcode', onClick: () => setForm({ item: null }) }]}
      error={act.error}
      reloadKey={act.reloadKey}
      reload={act.reload}
      above={frame?.tabName.toLowerCase() === 'scan transactions' ? <ScanPage embedded onScanned={act.reload} /> : null}
      rowExtra={rowExtra}
      bulkExtra={bulkExtra}
    >
      {form ? (
        <BarcodeForm
          item={form.item}
          onClose={() => setForm(null)}
          onSaved={() => {
            setForm(null);
            toast('Barcode saved.');
            act.reload();
          }}
        />
      ) : null}
      {ask ? <AskBox ask={ask} onClose={() => setAsk(null)} /> : null}
    </WmsRegister>
  );
}
