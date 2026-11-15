// V40 mfg-transfer-note ("Material Transfer Note"): plant-to-plant material transfer with a two-step receipt.
// Send moves stock to the sending plant's transit warehouse; Receive moves the quantity that arrived into the receiving
// warehouse; a short receipt keeps the rest in transit with a dispute until Reconcile sends it back.
// Word / Excel / PDF / "+ Job Card" come from the shell ActionBar.
import { useCallback, useEffect, useState } from 'react';
import { useToast } from '../../components/Toast';
import { ApiError } from '../../lib/api';
import { routingApi } from '../../lib/routingApi';
import type { AuditEvent, Dispute, Note, NoteCards, NoteOptions } from '../../lib/routingApi';
import { FlowTabs, PlantStrip, ReasonButton, dash } from './RouteShared';
import './routing.css';

const TABS = [
  { key: 'register', label: 'Transfer Register' },
  { key: 'in_transit', label: 'In Transit' },
  { key: 'pending', label: 'Pending Receipt' },
  { key: 'received', label: 'Received' },
  { key: 'disputes', label: 'Variance & Disputes' },
  { key: 'audit', label: 'Audit' },
] as const;
const when = (iso: string): string => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const blank = { toUnitId: '', quantity: '', itemId: '', fromWarehouseId: '', toWarehouseId: '', jobCardNo: '', vehiclePerson: '', remarks: '' };

export function TransferNotePage() {
  const toast = useToast();
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('register');
  const [rows, setRows] = useState<Note[]>([]);
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [cards, setCards] = useState<NoteCards | null>(null);
  const [opts, setOpts] = useState<NoteOptions | null>(null);
  const [form, setForm] = useState(blank);
  const [open, setOpen] = useState(false);
  const [recv, setRecv] = useState<{ note: Note; qty: string; reason: string } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    void routingApi.noteOptions().then(setOpts, () => setOpts(null));
  }, []);

  useEffect(() => {
    let alive = true;
    const fail = (e: unknown): void => {
      if (alive) setError(e instanceof ApiError ? e.message : 'Could not load the transfer notes.');
    };
    void routingApi.noteCards().then((c) => alive && setCards(c), fail);
    if (tab === 'disputes') void routingApi.disputes().then((d) => alive && (setDisputes(d), setError('')), fail);
    else if (tab === 'audit') void routingApi.noteAudit().then((a) => alive && (setAudit(a), setError('')), fail);
    else void routingApi.notes({ tab }).then((r) => alive && (setRows(r), setError('')), fail);
    return () => {
      alive = false;
    };
  }, [tab, tick]);

  const run = useCallback(
    async (label: string, fn: () => Promise<unknown>): Promise<boolean> => {
      setBusy(true);
      try {
        await fn();
        toast(label);
        setTick((t) => t + 1);
        return true;
      } catch (e) {
        toast(e instanceof ApiError ? e.message : 'That did not work.');
        return false;
      } finally {
        setBusy(false);
      }
    },
    [toast],
  );

  const fromUnit = opts?.defaultUnitId ?? '';
  const sourceWh = (opts?.warehouses ?? []).filter((w) => w.unitId === fromUnit);
  const targetWh = (opts?.warehouses ?? []).filter((w) => w.unitId === form.toUnitId);
  const createReason = busy ? 'Saving...' : !fromUnit ? 'Choose one plant at the top to send from.' : !form.toUnitId ? 'Choose the receiving plant.' : !(Number(form.quantity) > 0) ? 'Enter a quantity greater than 0.' : form.itemId && (!form.fromWarehouseId || !form.toWarehouseId) ? 'Choose both warehouses to move the stock.' : null;

  const noteActions = (n: Note): JSX.Element => {
    return (
      <div className="rt-actions">
        <ReasonButton label="Send" reason={busy ? 'Saving...' : n.stockState !== 'NONE' ? 'Stock was already sent.' : n.receiptStatus !== 'PENDING' ? 'Already received.' : !n.itemId || !n.fromWarehouseId || !n.toWarehouseId ? 'Choose the item and both warehouses when creating the note.' : null} onClick={() => void run('Stock sent to transit.', () => routingApi.sendNote(n.id))} />
        <ReasonButton label="Receive" primary reason={busy ? 'Saving...' : n.receiptStatus !== 'PENDING' ? `Already ${n.receiptStatus.toLowerCase()}.` : null} onClick={() => setRecv({ note: n, qty: n.sentQty, reason: '' })} />
        <ReasonButton label="Reconcile" reason={busy ? 'Saving...' : n.receiptStatus !== 'SHORT' ? 'Only a short receipt needs reconciling.' : n.reconciledAt ? 'Already reconciled.' : null} onClick={() => void run('Short quantity reconciled.', () => routingApi.reconcileNote(n.id))} />
      </div>
    );
  };

  return (
    <div className="dash-page rt-page">
      <div className="page-head">
        <div>
          <h1>Material Transfer Note</h1>
          <p className="muted">Plant-to-plant material transfer: send to transit, receive in the other plant, reconcile any short quantity.</p>
        </div>
        <div className="actions">
          <button type="button" className="btn primary" onClick={() => setOpen((o) => !o)}>+ New Transfer Note</button>
        </div>
      </div>
      <PlantStrip />
      <FlowTabs current="Transfer Receipt" />
      <div className="rt-cards">
        <div className="card rt-card"><span className="muted">Pending Receipt</span><div className="rt-num">{cards?.pendingReceipt ?? '-'}</div></div>
        <div className="card rt-card"><span className="muted">In Transit</span><div className="rt-num">{cards?.inTransit ?? '-'}</div></div>
        <div className="card rt-card"><span className="muted">Received</span><div className="rt-num">{cards?.received ?? '-'}</div></div>
        <div className="card rt-card"><span className="muted">Open Disputes</span><div className="rt-num">{cards?.openDisputes ?? '-'}</div></div>
      </div>

      {open ? (
        <div className="card rt-dialog" role="group" aria-label="New transfer note">
          <div className="rt-form">
            <label>Receiving plant
              <select value={form.toUnitId} onChange={(e) => setForm({ ...form, toUnitId: e.target.value, toWarehouseId: '' })}>
                <option value="">Choose a plant</option>
                {(opts?.units ?? []).filter((u) => u.id !== fromUnit).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </label>
            <label>Item
              <select value={form.itemId} onChange={(e) => setForm({ ...form, itemId: e.target.value })}>
                <option value="">No stock movement (record only)</option>
                {(opts?.items ?? []).map((i) => <option key={i.id} value={i.id}>{`${i.code} - ${i.name}`}</option>)}
              </select>
            </label>
            <label>Quantity<input type="number" min={0} step="0.001" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} /></label>
            <label>From warehouse
              <select value={form.fromWarehouseId} onChange={(e) => setForm({ ...form, fromWarehouseId: e.target.value })}>
                <option value="">-</option>
                {sourceWh.map((w) => <option key={w.id} value={w.id}>{`${w.code} - ${w.name}`}</option>)}
              </select>
            </label>
            <label>To warehouse
              <select value={form.toWarehouseId} onChange={(e) => setForm({ ...form, toWarehouseId: e.target.value })}>
                <option value="">-</option>
                {targetWh.map((w) => <option key={w.id} value={w.id}>{`${w.code} - ${w.name}`}</option>)}
              </select>
            </label>
            <label>Job card no<input value={form.jobCardNo} maxLength={40} onChange={(e) => setForm({ ...form, jobCardNo: e.target.value })} /></label>
            <label>Vehicle / person<input value={form.vehiclePerson} maxLength={120} onChange={(e) => setForm({ ...form, vehiclePerson: e.target.value })} /></label>
            <label>Remarks<input value={form.remarks} maxLength={300} onChange={(e) => setForm({ ...form, remarks: e.target.value })} /></label>
          </div>
          <div className="rt-actions">
            <ReasonButton label="Create and Send" primary reason={createReason} onClick={() => void run('Transfer note created.', async () => { await routingApi.createNote({ toUnitId: form.toUnitId, quantity: form.quantity, itemId: form.itemId || null, fromWarehouseId: form.fromWarehouseId || null, toWarehouseId: form.toWarehouseId || null, jobCardNo: form.jobCardNo || null, vehiclePerson: form.vehiclePerson || null, remarks: form.remarks || null, dispatch: Boolean(form.itemId) }); setForm(blank); setOpen(false); })} />
            <button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </div>
      ) : null}

      {recv ? (
        <div className="card rt-dialog" role="group" aria-label="Receive transfer note">
          <b>{`Receive ${recv.note.noteNo}: ${recv.note.sentQty} sent`}</b>
          <label>Quantity received<input type="number" min={0} max={Number(recv.note.sentQty)} step="0.001" value={recv.qty} onChange={(e) => setRecv({ ...recv, qty: e.target.value })} /></label>
          {Number(recv.qty) < Number(recv.note.sentQty) ? <label>Reason for the short quantity<input value={recv.reason} maxLength={300} onChange={(e) => setRecv({ ...recv, reason: e.target.value })} /></label> : null}
          <div className="rt-actions">
            <ReasonButton label="Confirm Receipt" primary reason={busy ? 'Saving...' : recv.qty === '' || Number(recv.qty) < 0 || Number(recv.qty) > Number(recv.note.sentQty) ? `Enter a quantity between 0 and ${recv.note.sentQty}.` : Number(recv.qty) < Number(recv.note.sentQty) && recv.reason.trim().length < 3 ? 'Enter the reason for the short quantity.' : null}
              onClick={() => void run('Receipt saved.', async () => { await routingApi.receiveNote(recv.note.id, { receivedQty: recv.qty, shortReason: recv.reason || null }); setRecv(null); })} />
            <button type="button" className="btn" onClick={() => setRecv(null)}>Cancel</button>
          </div>
        </div>
      ) : null}

      <div role="tablist" className="tabs-row">
        {TABS.map((t) => <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={`btn${tab === t.key ? ' primary' : ''}`} onClick={() => setTab(t.key)}>{t.label}</button>)}
      </div>
      {error ? <p role="alert">{error}</p> : null}

      <div className="table-wrap">
        {tab === 'disputes' ? (
          <table className="register-table">
            <thead><tr><th>Dispute</th><th>Note</th><th>Quantity</th><th>Reason</th><th>Status</th><th>Raised</th></tr></thead>
            <tbody>
              {disputes.map((d) => <tr key={d.id}><td>{d.disputeNo}</td><td>{d.noteNo}</td><td className="rt-num-cell">{d.qty}</td><td>{d.reason}</td><td>{d.status}{d.resolutionNote ? <div className="muted">{d.resolutionNote}</div> : null}</td><td>{`${dash(d.createdBy)} ${when(d.createdAt)}`}</td></tr>)}
              {disputes.length === 0 ? <tr><td colSpan={6}>No short receipts.</td></tr> : null}
            </tbody>
          </table>
        ) : tab === 'audit' ? (
          <table className="register-table">
            <thead><tr><th>When</th><th>Note</th><th>Event</th><th>By</th></tr></thead>
            <tbody>
              {audit.map((a) => <tr key={a.id}><td>{when(a.at)}</td><td>{a.noteNo}</td><td>{a.action}</td><td>{dash(a.actor)}</td></tr>)}
              {audit.length === 0 ? <tr><td colSpan={4}>No events yet.</td></tr> : null}
            </tbody>
          </table>
        ) : (
          <table className="register-table">
            <thead><tr><th>Transfer</th><th>Parent Job</th><th>From &rarr; To</th><th>Sent</th><th>Accepted</th><th>Shortage</th><th>Stock</th><th>Receipt</th><th>Actions</th></tr></thead>
            <tbody>
              {rows.map((n) => (
                <tr key={n.id}>
                  <td><b>{n.noteNo}</b><div className="muted">{n.transferDate}</div></td>
                  <td>{dash(n.jobCardNo)}<div className="muted">{n.partName ?? ''}</div></td>
                  <td>{`${dash(n.fromUnitName)} / ${dash(n.fromProcess)}`}<div className="muted">{`-> ${dash(n.toUnitName)} / ${dash(n.toProcess)}`}</div></td>
                  <td className="rt-num-cell">{n.sentQty}</td>
                  <td className="rt-num-cell">{dash(n.receivedQty)}</td>
                  <td className={`rt-num-cell ${Number(n.shortQty) > 0 ? 'rt-short' : ''}`}>{n.shortQty}{n.shortReason ? <div className="rt-reason">{n.shortReason}</div> : null}</td>
                  <td>{n.stockState}</td>
                  <td>{n.receiptStatus}{n.receivedBy ? <div className="muted">{`Received by ${n.receivedBy}`}</div> : null}</td>
                  <td>{noteActions(n)}</td>
                </tr>
              ))}
              {rows.length === 0 ? <tr><td colSpan={9}>No transfer notes in this view.</td></tr> : null}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
