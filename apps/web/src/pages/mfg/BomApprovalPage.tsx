// V40 flow-bom-approval ("BOM & Material Approval"). Tabs in V40 order: BOM Selection, Sales Approval, Stock Verification
// (required vs available in the plant), Purchase Shortage (Raise PR), Manufacturing Release, Traceability.
// A flow is a released BOM built in a quantity; every number is read from the BOM lines and the plant's stock balances.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useToast } from '../../components/Toast';
import { ApiError } from '../../lib/api';
import { routingApi } from '../../lib/routingApi';
import type { Flow, FlowTrace } from '../../lib/routingApi';
import { FlowTabs, PlantStrip, ReasonButton, dash } from './RouteShared';
import './routing.css';

const TABS = ['BOM Selection', 'Sales Approval', 'Stock Verification', 'Purchase Shortage', 'Manufacturing Release', 'Traceability'] as const;
type TabName = (typeof TABS)[number];
const LIST_TAB: Record<TabName, string> = {
  'BOM Selection': 'selection',
  'Sales Approval': 'sales',
  'Stock Verification': 'selection',
  'Purchase Shortage': 'shortage',
  'Manufacturing Release': 'release',
  Traceability: 'selection',
};
const when = (iso: string | null): string => (iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-');

export function BomApprovalPage() {
  const toast = useToast();
  const [tab, setTab] = useState<TabName>('BOM Selection');
  const [flows, setFlows] = useState<Flow[]>([]);
  const [selected, setSelected] = useState<Flow | null>(null);
  const [trace, setTrace] = useState<FlowTrace | null>(null);
  const [opts, setOpts] = useState<Awaited<ReturnType<typeof routingApi.flowOptions>> | null>(null);
  const [form, setForm] = useState({ bomId: '', qty: '', salesOrderId: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    void routingApi.flowOptions().then(setOpts, () => setOpts(null));
  }, []);

  useEffect(() => {
    let alive = true;
    routingApi.flows({ tab: LIST_TAB[tab] }).then(
      (r) => {
        if (!alive) return;
        setFlows(r);
        setError('');
      },
      (e: unknown) => alive && setError(e instanceof ApiError ? e.message : 'Could not load the flows.'),
    );
    return () => {
      alive = false;
    };
  }, [tab, tick]);

  const choose = useCallback(async (id: string): Promise<void> => {
    try {
      setSelected(await routingApi.flow(id));
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not open the flow.');
    }
  }, [toast]);

  useEffect(() => {
    if (tab === 'Traceability' && selected) void routingApi.trace(selected.id).then(setTrace, () => setTrace(null));
  }, [tab, selected]);

  async function act(label: string, fn: () => Promise<Flow>): Promise<void> {
    setBusy(true);
    try {
      const f = await fn();
      setSelected(await routingApi.flow(f.id));
      toast(label);
      setTick((t) => t + 1);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  }

  const released = selected?.status === 'RELEASED';
  const shortLines = (selected?.lines ?? []).filter((l) => Number(l.shortageQty) > 0);
  const needSelect = selected ? null : 'Choose a flow from the list first.';

  return (
    <div className="dash-page rt-page">
      <div className="page-head">
        <div>
          <h1>BOM &amp; Material Approval</h1>
          <p className="muted">Controlled BOM release: sales approval, stock verification in the plant, purchase shortage and manufacturing release.</p>
        </div>
      </div>
      <PlantStrip />
      <FlowTabs current="BOM & Material Approval" />
      <div className="card rt-note">
        <b>Routing control:</b> A job moves only after the BOM is released to manufacturing. Shortage is raised as a Draft purchase requisition.
      </div>
      <div role="tablist" className="tabs-row">
        {TABS.map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={`btn${tab === t ? ' primary' : ''}`} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>
      {error ? <p role="alert">{error}</p> : null}

      {tab === 'BOM Selection' ? (
        <div className="card rt-dialog">
          <div className="rt-form">
            <label>Released BOM
              <select value={form.bomId} onChange={(e) => setForm({ ...form, bomId: e.target.value })}>
                <option value="">Choose a BOM</option>
                {(opts?.boms ?? []).map((b) => <option key={b.id} value={b.id}>{`${dash(b.number)} - ${b.itemName} (v${b.versionNo})`}</option>)}
              </select>
            </label>
            <label>Quantity to build<input type="number" min={0} step="0.001" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} /></label>
            <label>Sales order
              <select value={form.salesOrderId} onChange={(e) => setForm({ ...form, salesOrderId: e.target.value })}>
                <option value="">None</option>
                {(opts?.salesOrders ?? []).map((s) => <option key={s.id} value={s.id}>{s.number}</option>)}
              </select>
            </label>
          </div>
          <div className="rt-actions">
            <ReasonButton label="Start BOM Flow" primary reason={busy ? 'Saving...' : !form.bomId ? 'Choose a released BOM.' : !(Number(form.qty) > 0) ? 'Enter a quantity greater than 0.' : null}
              onClick={() => void act('BOM flow started and stock verified.', async () => { const f = await routingApi.createFlow({ bomId: form.bomId, qty: form.qty, salesOrderId: form.salesOrderId || null }); setForm({ bomId: '', qty: '', salesOrderId: '' }); return f; })} />
            <Link className="btn" to="/m/mfg-bom">Open BOM master</Link>
          </div>
        </div>
      ) : null}

      <div className="table-wrap">
        <table className="register-table">
          <thead>
            <tr><th>Flow</th><th>Sales Order</th><th>Part / BOM</th><th>Quantity</th><th>Stock</th><th>Shortage</th><th>Sales Approval</th><th>Purchase</th><th>Production Release</th><th>Status</th></tr>
          </thead>
          <tbody>
            {flows.map((f) => (
              <tr key={f.id} aria-selected={selected?.id === f.id}>
                <td><button type="button" className="btn" onClick={() => void choose(f.id)}>{f.flowNo}</button></td>
                <td>{dash(f.salesOrderNo)}</td>
                <td>{f.partName}<div className="muted">{`${dash(f.bomNumber)} ${dash(f.bomRevision)}`}</div></td>
                <td className="rt-num-cell">{dash(f.qty)}</td>
                <td>{`${f.lineCount} material line(s)`}</td>
                <td className={f.shortLines > 0 ? 'rt-short' : 'rt-ok'}>{f.shortLines > 0 ? `${f.shortLines} short` : 'Covered'}</td>
                <td>{f.salesApproval}</td>
                <td>{f.prNumber ?? f.purchaseStatus}</td>
                <td>{f.manufacturingRelease ? 'Released' : 'Not released'}</td>
                <td>{f.status}</td>
              </tr>
            ))}
            {flows.length === 0 ? <tr><td colSpan={10}>No BOM flows in this view.</td></tr> : null}
          </tbody>
        </table>
      </div>

      {tab !== 'BOM Selection' ? (
        <div className="card rt-dialog">
          <b>{selected ? `${selected.flowNo} - ${selected.partName ?? ''}` : 'No flow chosen'}</b>
          {!selected ? <span className="muted">Click a flow number in the list above.</span> : null}

          {tab === 'Sales Approval' ? (
            <div className="rt-actions">
              <span>{selected ? `Sales approval: ${selected.salesApproval}${selected.salesApprovedBy ? ` by ${selected.salesApprovedBy} on ${when(selected.salesApprovedAt)}` : ''}` : ''}</span>
              <ReasonButton label="Approve" primary reason={busy ? 'Saving...' : needSelect ?? (released ? 'Already released to manufacturing.' : selected?.salesApproval === 'APPROVED' ? 'Already approved.' : null)} onClick={() => void act('Sales approved.', () => routingApi.salesDecision(selected!.id, true))} />
              <ReasonButton label="Reject" danger reason={busy ? 'Saving...' : needSelect ?? (released ? 'Already released to manufacturing.' : null)} onClick={() => void act('Sales rejected.', () => routingApi.salesDecision(selected!.id, false))} />
            </div>
          ) : null}

          {tab === 'Stock Verification' || tab === 'Purchase Shortage' ? (
            <>
              <div className="table-wrap">
                <table className="register-table">
                  <thead><tr><th>Material</th><th>Required</th><th>Available in plant</th><th>Shortage</th></tr></thead>
                  <tbody>
                    {(tab === 'Purchase Shortage' ? shortLines : selected?.lines ?? []).map((l) => (
                      <tr key={l.id}>
                        <td>{l.itemName}<div className="muted">{l.itemCode}</div></td>
                        <td className="rt-num-cell">{`${l.requiredQty} ${l.uom}`}</td>
                        <td className="rt-num-cell">{`${l.availableQty} ${l.uom}`}</td>
                        <td className={`rt-num-cell ${Number(l.shortageQty) > 0 ? 'rt-short' : 'rt-ok'}`}>{`${l.shortageQty} ${l.uom}`}</td>
                      </tr>
                    ))}
                    {selected && (tab === 'Purchase Shortage' ? shortLines : selected.lines ?? []).length === 0 ? <tr><td colSpan={4}>{tab === 'Purchase Shortage' ? 'Nothing is short.' : 'This BOM has no material lines.'}</td></tr> : null}
                  </tbody>
                </table>
              </div>
              <div className="rt-actions">
                {tab === 'Stock Verification' ? (
                  <ReasonButton label="Verify Stock Again" reason={busy ? 'Saving...' : needSelect ?? (released ? 'Already released to manufacturing.' : null)} onClick={() => void act('Stock verified.', () => routingApi.verify(selected!.id))} />
                ) : (
                  <>
                    <ReasonButton label="Raise PR" primary reason={busy ? 'Saving...' : needSelect ?? (selected?.prId ? `Requisition ${dash(selected.prNumber)} was already raised.` : shortLines.length === 0 ? 'Nothing is short, so no requisition is needed.' : released ? 'Already released to manufacturing.' : null)} onClick={() => void act('Draft requisition raised.', () => routingApi.raisePr(selected!.id))} />
                    {selected?.prNumber ? <span>{`Draft requisition: ${selected.prNumber}`}</span> : null}
                  </>
                )}
              </div>
            </>
          ) : null}

          {tab === 'Manufacturing Release' ? (
            <div className="rt-actions">
              <span>{selected ? (released ? `Released by ${dash(selected.releasedBy)} on ${when(selected.releasedAt)}` : 'Not released yet.') : ''}</span>
              <ReasonButton label="Release to Manufacturing" primary reason={busy ? 'Saving...' : needSelect ?? (released ? 'Already released.' : selected?.salesApproval !== 'APPROVED' ? 'Sales must approve first.' : shortLines.length > 0 ? `Stock is short for ${shortLines.length} material(s). Raise a PR first.` : null)} onClick={() => void act('Released to manufacturing.', () => routingApi.release(selected!.id))} />
            </div>
          ) : null}

          {tab === 'Traceability' && trace ? (
            <div>
              <div className="table-wrap">
                <table className="register-table">
                  <thead><tr><th>When</th><th>Step</th><th>By</th></tr></thead>
                  <tbody>
                    {trace.events.map((e, i) => <tr key={`${e.at}-${i}`}><td>{when(e.at)}</td><td>{e.action}</td><td>{dash(e.actor)}</td></tr>)}
                  </tbody>
                </table>
              </div>
              <b>Production orders on this BOM</b>
              <ul>
                {trace.orders.map((o) => <li key={o.id}>{`${o.number} - ${o.status} - ${o.qty}`}</li>)}
                {trace.orders.length === 0 ? <li>No production order uses this BOM in this plant yet.</li> : null}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
