// Bins, Put-away, Cycle Count and Physical Verification inside the Warehouse register. They use the pop-ups of the
// pages themselves (add a bin, scan a bin, count sheet).
import { useState } from 'react';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { api, request } from '../../lib/api';
import { countStep, deleteBin, listBins, updateBin, type BinRow } from '../../lib/inventoryApi';
import { getJson, post, verb } from '../../lib/scmApi';
import { useLoad } from '../../lib/useLoad';
import type { ActionSet } from '../../types';
import { BinForm } from '../inventory/MastersPages';
import { ErrorBox, todayIso } from '../inventory/shared';
import { CountDialog, CountForm } from '../inventory/StockPages';
import { BinDialog } from '../procurement/SpecialPages';
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
  askReason?: boolean;
  yes: (reason: string) => void;
}

function AskBox({ ask, onClose }: { ask: Ask; onClose: () => void }) {
  return (
    <Confirm
      title={ask.title}
      text={ask.text}
      action={ask.action}
      askReason={ask.askReason ?? false}
      onClose={onClose}
      onConfirm={(reason) => {
        onClose();
        ask.yes(reason);
      }}
    />
  );
}

// ------------------------------------------------------------------------------------------------ bins

function BinEdit({ id, code, onClose, onSaved }: { id: string; code: string; onClose: () => void; onSaved: () => void }) {
  const found = useLoad(async () => (await listBins({ q: code, page: 1 })).rows.find((b) => b.id === id) ?? null, [id, code]);
  const [patch, setPatch] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState('');
  const bin: BinRow | null = found.data ?? null;
  const value = (key: 'name' | 'zone' | 'binType' | 'capacity'): string => patch[key] ?? String(bin?.[key] ?? '');
  const set = (key: string, v: string): void => setPatch((p) => ({ ...p, [key]: v }));
  const save = (): void => {
    if (!bin) return;
    const capacity = value('capacity').trim();
    if (capacity !== '' && !(Number(capacity) >= 0)) return setMsg('Capacity must be a number, 0 or more.');
    setMsg('');
    updateBin(bin.id, bin.version, {
      name: value('name').trim() || null,
      zone: value('zone').trim() || null,
      binType: value('binType'),
      capacity: capacity === '' ? null : Number(capacity),
    })
      .then(onSaved)
      .catch((e: unknown) => setMsg(message(e)));
  };
  return (
    <Modal
      title={`Edit bin ${code}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          <button type="button" className="btn primary" disabled={!bin} onClick={save}>
            Save
          </button>
        </>
      }
    >
      <ErrorBox message={msg || found.error || (!found.loading && !bin ? 'This bin was not found in the selected plant.' : '')} />
      <div className="field">
        <label>
          Bin name
          <input value={value('name')} maxLength={100} onChange={(e) => set('name', e.target.value)} />
        </label>
      </div>
      <div className="field">
        <label>
          Zone
          <input value={value('zone')} maxLength={30} onChange={(e) => set('zone', e.target.value)} />
        </label>
      </div>
      <div className="field">
        <label>
          Bin type
          <select value={value('binType')} onChange={(e) => set('binType', e.target.value)}>
            {['Storage', 'Staging', 'Quarantine', 'Pick Face'].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="field">
        <label>
          Capacity
          <input inputMode="decimal" value={value('capacity')} onChange={(e) => set('capacity', e.target.value)} />
        </label>
      </div>
    </Modal>
  );
}

export function BinDesk({ pageId, title, sub, actions }: Props) {
  const toast = useToast();
  const act = useWmsActions();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<{ id: string; code: string } | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  const toggle = (r: V40Row): Promise<unknown> => updateBin(r.id, Number(r.version), { status: r.status === 'Active' ? 'Inactive' : 'Active' });
  const rowExtra = (r: V40Row) => (
    <>
      {actions.edit ? (
        <>
          <button type="button" className="btn sm" onClick={() => setEditing({ id: r.id, code: r.number })}>
            Edit
          </button>
          <button type="button" className="btn sm" onClick={() => void act.run(() => toggle(r), `${r.number} ${r.status === 'Active' ? 'deactivated' : 'activated'}.`)}>
            {r.status === 'Active' ? 'Deactivate' : 'Activate'}
          </button>
        </>
      ) : null}
      {actions.delete ? (
        <button
          type="button"
          className="btn sm danger"
          onClick={() =>
            setAsk({
              title: `Delete bin ${r.number}?`,
              text: 'A bin that holds stock or has been used is kept: deactivate it instead.',
              action: 'Delete',
              yes: () => void act.run(() => deleteBin(r.id), `${r.number} deleted.`),
            })
          }
        >
          Delete
        </button>
      ) : null}
    </>
  );
  const bulkExtra = (selected: V40Row[], done: () => void) => {
    const button = (label: string, rows: V40Row[], work: (r: V40Row) => Promise<unknown>, verbDone: string) => (
      <button
        type="button"
        className="btn sm"
        disabled={rows.length === 0}
        title={rows.length === 0 ? 'Tick the bins first.' : undefined}
        onClick={() => void act.each(rows, work, verbDone).then(done)}
      >
        {label}
      </button>
    );
    return (
      <>
        {actions.edit ? button('Activate Selected', selected.filter((r) => r.status !== 'Active'), toggle, 'activated') : null}
        {actions.edit ? button('Deactivate Selected', selected.filter((r) => r.status === 'Active'), toggle, 'deactivated') : null}
        {actions.delete ? (
          <button
            type="button"
            className="btn sm danger"
            disabled={selected.length === 0}
            title={selected.length === 0 ? 'Tick the bins first.' : undefined}
            onClick={() =>
              setAsk({
                title: `Delete ${selected.length} bins?`,
                text: 'Bins that hold stock or have been used are kept and named with the reason.',
                action: 'Delete',
                yes: () => void act.each(selected, (r) => deleteBin(r.id), 'deleted').then(done),
              })
            }
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
      actions={actions}
      add={[{ label: '＋ Add Bin', onClick: () => setAdding(true) }]}
      error={act.error}
      reloadKey={act.reloadKey}
      reload={act.reload}
      rowExtra={rowExtra}
      bulkExtra={bulkExtra}
    >
      {adding ? (
        <BinForm
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            toast('Bin added.');
            act.reload();
          }}
        />
      ) : null}
      {editing ? (
        <BinEdit
          id={editing.id}
          code={editing.code}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            toast('Bin saved.');
            act.reload();
          }}
        />
      ) : null}
      {ask ? <AskBox ask={ask} onClose={() => setAsk(null)} /> : null}
    </WmsRegister>
  );
}

// ------------------------------------------------------------------------------------------------ put-away

type Task = Record<string, unknown>;
interface Eligible {
  grnLineId: string;
  batchId: string | null;
  grnNo: string;
  warehouseId: string;
  warehouseCode: string;
  itemCode: string;
  itemName: string;
  serialTracked: boolean;
  batchNo: string | null;
  free: string;
}
const text = (v: unknown): string => (typeof v === 'string' || typeof v === 'number' ? String(v) : '');

function BinSelect({ warehouseId, value, onChange }: { warehouseId: string; value: string; onChange: (v: string) => void }) {
  const bins = useLoad(() => (warehouseId ? listBins({ warehouseId, page: 1 }) : Promise.resolve(null)), [warehouseId]);
  return (
    <div className="field">
      <label>
        Suggested bin
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">{warehouseId ? 'Any bin (let the system suggest)' : 'Choose the receipt first'}</option>
          {(bins.data?.rows ?? [])
            .filter((b) => b.status === 'Active')
            .map((b) => (
              <option key={b.id} value={b.id}>
                {b.code}
              </option>
            ))}
        </select>
      </label>
    </div>
  );
}

function AddTask({ onClose, onSaved }: { onClose: () => void; onSaved: (no: string) => void }) {
  const list = useLoad(() => getJson<Eligible[]>('/wms/putaway/eligible'), []);
  const [pick, setPick] = useState('');
  const [qty, setQty] = useState('');
  const [bin, setBin] = useState('');
  const [priority, setPriority] = useState('');
  const [msg, setMsg] = useState('');
  const rows = Array.isArray(list.data) ? list.data : [];
  const key = (e: Eligible): string => `${e.grnLineId}|${e.batchId ?? ''}`;
  const chosen = rows.find((e) => key(e) === pick) ?? null;
  const save = (): void => {
    if (!chosen) return setMsg('Choose the goods receipt line to put away.');
    if (!(Number(qty) > 0)) return setMsg('Enter a quantity greater than 0.');
    if (priority && !(Number.isInteger(Number(priority)) && Number(priority) >= 1 && Number(priority) <= 999)) return setMsg('Priority is a whole number from 1 to 999.');
    setMsg('');
    post<{ taskNo: string }>('/wms/putaway/tasks', {
      grnLineId: chosen.grnLineId,
      batchId: chosen.batchId,
      qty,
      suggestedBinId: bin || null,
      ...(priority ? { priority: Number(priority) } : {}),
    })
      .then((t) => onSaved(t.taskNo))
      .catch((e: unknown) => setMsg(message(e)));
  };
  return (
    <Modal
      title="Add put-away task"
      sub="Tasks are made by goods receipts. Add one here for received quantity that has no task (for example after a task was deleted)."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          <button type="button" className="btn primary" disabled={rows.length === 0} title={rows.length === 0 ? 'No received quantity is waiting for a task.' : undefined} onClick={save}>
            Save task
          </button>
        </>
      }
    >
      <ErrorBox message={msg || list.error} />
      {!list.loading && rows.length === 0 ? (
        <p className="notice" role="note">
          Every received quantity already has a put-away task. A new goods receipt creates its tasks by itself.
        </p>
      ) : null}
      <div className="field">
        <label>
          Goods receipt line *
          <select
            value={pick}
            onChange={(e) => {
              setPick(e.target.value);
              setBin('');
              setQty(rows.find((x) => key(x) === e.target.value)?.free ?? '');
            }}
          >
            <option value="">Choose…</option>
            {rows.map((e) => (
              <option key={key(e)} value={key(e)}>
                {`${e.grnNo} · ${e.itemCode} ${e.itemName}${e.batchNo ? ` · batch ${e.batchNo}` : ''} · ${Number(e.free)} in ${e.warehouseCode}`}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="field">
        <label>
          Quantity *
          <input inputMode="decimal" value={qty} readOnly={chosen?.serialTracked === true} onChange={(e) => setQty(e.target.value)} />
        </label>
      </div>
      <BinSelect warehouseId={chosen?.warehouseId ?? ''} value={bin} onChange={setBin} />
      <div className="field">
        <label>
          Priority (1 is first)
          <input inputMode="numeric" value={priority} onChange={(e) => setPriority(e.target.value)} />
        </label>
      </div>
    </Modal>
  );
}

function EditTask({ task, onClose, onSaved }: { task: Task; onClose: () => void; onSaved: () => void }) {
  const [bin, setBin] = useState(text(task.suggestedBinId));
  const [priority, setPriority] = useState(text(task.priority));
  const [msg, setMsg] = useState('');
  const save = (): void => {
    if (priority && !(Number.isInteger(Number(priority)) && Number(priority) >= 1 && Number(priority) <= 999)) return setMsg('Priority is a whole number from 1 to 999.');
    setMsg('');
    verb('/wms/putaway', text(task.id), 'update', { suggestedBinId: bin || null, ...(priority ? { priority: Number(priority) } : {}) })
      .then(onSaved)
      .catch((e: unknown) => setMsg(message(e)));
  };
  return (
    <Modal
      title={`Edit ${text(task.taskNo)}`}
      sub={`${text(task.itemCode)} · quantity ${Number(text(task.qty))}`}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          <button type="button" className="btn primary" onClick={save}>
            Save
          </button>
        </>
      }
    >
      <ErrorBox message={msg} />
      <BinSelect warehouseId={text(task.warehouseId)} value={bin} onChange={setBin} />
      <div className="field">
        <label>
          Priority (1 is first)
          <input inputMode="numeric" value={priority} onChange={(e) => setPriority(e.target.value)} />
        </label>
      </div>
    </Modal>
  );
}

const LIVE = ['Open', 'Assigned', 'Exception'];

export function PutawayDesk({ pageId, title, sub, actions }: Props) {
  const toast = useToast();
  const act = useWmsActions();
  const tasks = useLoad(() => getJson<Task[]>('/wms/putaway/tasks?size=100'), [act.reloadKey]);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [scanning, setScanning] = useState<Task | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  const taskOf = async (id: string): Promise<Task> => {
    const found =
      (Array.isArray(tasks.data) ? tasks.data : []).find((t) => t.id === id) ??
      (await getJson<Task[]>('/wms/putaway/tasks?size=500')).find((t) => t.id === id);
    if (!found) throw new Error('This task was not found in the selected plant.');
    return found;
  };
  const open = (id: string, then: (t: Task) => void): void => {
    taskOf(id)
      .then(then)
      .catch((e: unknown) => act.setError(message(e)));
  };
  const claim = (r: V40Row): Promise<unknown> => verb('/wms/putaway', r.id, 'claim');
  const cancel = (r: V40Row, reason: string): Promise<unknown> => verb('/wms/putaway', r.id, 'cancel', { reason });

  const rowExtra = (r: V40Row) => (
    <>
      {actions.edit && r.status === 'Open' ? (
        <button type="button" className="btn sm primary" title="Take this task yourself" onClick={() => void act.run(() => claim(r), `${r.number} claimed.`)}>
          Claim
        </button>
      ) : null}
      {actions.edit && r.status === 'Assigned' ? (
        <button type="button" className="btn sm primary" onClick={() => open(r.id, setScanning)}>
          Scan bin and finish
        </button>
      ) : null}
      {actions.edit && (r.status === 'Open' || r.status === 'Assigned') ? (
        <button
          type="button"
          className="btn sm"
          onClick={() =>
            setAsk({
              title: `Report a problem on ${r.number}`,
              text: 'The supervisors are told, and the task waits until someone edits or deletes it.',
              action: 'Report',
              askReason: true,
              yes: (reason) => void act.run(() => verb('/wms/putaway', r.id, 'exception', { reason }), `Problem reported on ${r.number}.`),
            })
          }
        >
          Report problem
        </button>
      ) : null}
      {actions.delete && LIVE.includes(r.status) ? (
        <button
          type="button"
          className="btn sm danger"
          onClick={() =>
            setAsk({
              title: `Delete ${r.number}?`,
              text: 'No stock moves. The task is kept as Cancelled, and its quantity can be added again.',
              action: 'Delete',
              askReason: true,
              yes: (reason) => void act.run(() => cancel(r, reason), `${r.number} cancelled.`),
            })
          }
        >
          Delete
        </button>
      ) : null}
    </>
  );
  const bulkExtra = (selected: V40Row[], done: () => void) => {
    const waiting = selected.filter((r) => r.status === 'Open');
    const live = selected.filter((r) => LIVE.includes(r.status));
    return (
      <>
        {actions.edit ? (
          <button
            type="button"
            className="btn sm"
            disabled={waiting.length === 0}
            title={waiting.length === 0 ? 'Tick Open tasks first.' : undefined}
            onClick={() => void act.each(waiting, claim, 'claimed').then(done)}
          >
            Claim Selected
          </button>
        ) : null}
        {actions.delete ? (
          <button
            type="button"
            className="btn sm danger"
            disabled={live.length === 0}
            title={live.length === 0 ? 'Tick unfinished tasks first.' : undefined}
            onClick={() =>
              setAsk({
                title: `Delete ${live.length} tasks?`,
                text: 'No stock moves. The tasks are kept as Cancelled.',
                action: 'Delete',
                askReason: true,
                yes: (reason) => void act.each(live, (r) => cancel(r, reason), 'cancelled').then(done),
              })
            }
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
      actions={actions}
      add={[{ label: '＋ Add Task', onClick: () => setAdding(true) }]}
      error={act.error || tasks.error}
      reloadKey={act.reloadKey}
      reload={act.reload}
      onEdit={actions.edit ? (id) => open(id, setEditing) : undefined}
      canEditRow={(status) => LIVE.includes(status)}
      rowExtra={rowExtra}
      bulkExtra={bulkExtra}
      onAllocate={(id) => open(id, setEditing)}
    >
      {adding ? (
        <AddTask
          onClose={() => setAdding(false)}
          onSaved={(no) => {
            setAdding(false);
            toast(`Added ${no}.`);
            act.reload();
          }}
        />
      ) : null}
      {editing ? (
        <EditTask
          task={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            toast('Task saved.');
            act.reload();
          }}
        />
      ) : null}
      {scanning ? (
        <BinDialog
          task={scanning}
          onClose={() => setScanning(null)}
          onDone={() => {
            setScanning(null);
            toast('Put-away done.');
            act.reload();
          }}
        />
      ) : null}
      {ask ? <AskBox ask={ask} onClose={() => setAsk(null)} /> : null}
    </WmsRegister>
  );
}

// ------------------------------------------------------------------------------------------------ counts

const OPEN_COUNT = ['Planned', 'Counting', 'Under Review', 'Approved'];

function Reschedule({ id, onClose, onSaved }: { id: string; onClose: () => void; onSaved: () => void }) {
  const found = useLoad(() => api<{ code: string; plannedDate: string; version: number }>(`/inventory/counts/${id}`), [id]);
  const [date, setDate] = useState('');
  const [msg, setMsg] = useState('');
  const value = date || (found.data?.plannedDate ?? '').slice(0, 10) || todayIso();
  const save = (): void => {
    if (!found.data) return;
    setMsg('');
    request(`/inventory/counts/${id}`, { method: 'PATCH', body: { plannedDate: value }, headers: { 'If-Match': `"${found.data.version}"` } })
      .then(onSaved)
      .catch((e: unknown) => setMsg(message(e)));
  };
  return (
    <Modal
      title={`Edit ${found.data?.code ?? 'count'}`}
      sub="The planned date of a count that has not started."
      size="sm"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          <button type="button" className="btn primary" disabled={!found.data} onClick={save}>
            Save
          </button>
        </>
      }
    >
      <ErrorBox message={msg || found.error} />
      <div className="field">
        <label>
          Planned date
          <input type="date" value={value} onChange={(e) => setDate(e.target.value)} />
        </label>
      </div>
    </Modal>
  );
}

export function CountDesk({ pageId, title, sub, actions }: Props) {
  const physical = pageId === 'wms-physical';
  const act = useWmsActions();
  const [adding, setAdding] = useState<'CYCLE' | 'PHYSICAL' | 'POWDER_WEEKLY' | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  const step = (r: V40Row, s: 'start' | 'review' | 'approve' | 'post' | 'cancel'): Promise<unknown> => countStep(recordOf(r), Number(r.version), s);
  const button = (r: V40Row, label: string, s: 'start' | 'review' | 'approve' | 'post', done: string) => (
    <button type="button" className="btn sm primary" onClick={() => void act.run(() => step(r, s), `${r.number} ${done}.`)}>
      {label}
    </button>
  );
  const rowExtra = (r: V40Row) => (
    <>
      {actions.edit && r.status === 'Planned' ? button(r, 'Activate (start counting)', 'start', 'started') : null}
      {actions.edit && r.status === 'Counting' ? button(r, 'Submit for review', 'review', 'sent for review') : null}
      {actions.approve && r.status === 'Under Review' ? button(r, 'Approve', 'approve', 'approved') : null}
      {actions.post && r.status === 'Approved' ? button(r, 'Post differences', 'post', 'posted') : null}
      {actions.edit && OPEN_COUNT.includes(r.status) ? (
        <button
          type="button"
          className="btn sm danger"
          onClick={() =>
            setAsk({
              title: `Delete ${r.number}?`,
              text: 'The count is cancelled: nothing is posted to stock, and a frozen warehouse is released.',
              action: 'Delete',
              yes: () => void act.run(() => step(r, 'cancel'), `${r.number} cancelled.`),
            })
          }
        >
          Delete
        </button>
      ) : null}
    </>
  );
  const bulkExtra = (selected: V40Row[], done: () => void) => {
    const of = (statuses: string[]): V40Row[] => selected.filter((r) => statuses.includes(r.status));
    const many = (label: string, rows: V40Row[], s: 'start' | 'review', verbDone: string) => (
      <button
        type="button"
        className="btn sm"
        disabled={rows.length === 0}
        title={rows.length === 0 ? `Tick ${s === 'start' ? 'Planned' : 'Counting'} counts first.` : undefined}
        onClick={() => void act.each(rows, (r) => step(r, s), verbDone).then(done)}
      >
        {label}
      </button>
    );
    const cancellable = of(OPEN_COUNT);
    return actions.edit ? (
      <>
        {many('Activate Selected', of(['Planned']), 'start', 'started')}
        {many('Submit Selected', of(['Counting']), 'review', 'sent for review')}
        <button
          type="button"
          className="btn sm danger"
          disabled={cancellable.length === 0}
          title={cancellable.length === 0 ? 'Tick counts that are not posted first.' : undefined}
          onClick={() =>
            setAsk({
              title: `Delete ${cancellable.length} counts?`,
              text: 'They are cancelled: nothing is posted to stock.',
              action: 'Delete',
              yes: () => void act.each(cancellable, (r) => step(r, 'cancel'), 'cancelled').then(done),
            })
          }
        >
          Delete Selected
        </button>
      </>
    ) : null;
  };
  const saved = (): void => {
    setAdding(null);
    act.reload();
  };
  return (
    <WmsRegister
      pageId={pageId}
      title={title}
      sub={sub}
      actions={actions}
      add={
        physical
          ? [{ label: '＋ New Count', onClick: () => setAdding('PHYSICAL') }]
          : [
              { label: '＋ New Count', onClick: () => setAdding('CYCLE') },
              { label: '＋ New Powder Sheet', onClick: () => setAdding('POWDER_WEEKLY') },
            ]
      }
      error={act.error}
      reloadKey={act.reloadKey}
      reload={act.reload}
      onOpen={setOpen}
      onEdit={actions.edit ? setEditing : undefined}
      canEditRow={(status) => status === 'Planned'}
      rowExtra={rowExtra}
      bulkExtra={bulkExtra}
    >
      {adding ? <CountForm type={adding} onClose={() => setAdding(null)} onSaved={saved} /> : null}
      {open ? (
        <CountDialog
          id={open}
          actions={actions}
          onClose={() => {
            setOpen(null);
            act.reload();
          }}
        />
      ) : null}
      {editing ? (
        <Reschedule
          id={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            act.reload();
          }}
        />
      ) : null}
      {ask ? <AskBox ask={ask} onClose={() => setAsk(null)} /> : null}
    </WmsRegister>
  );
}
