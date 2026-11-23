// V40 mfg-unit-route ("Multi-Unit Part Routing"): tabs Live Routing, Unit 1-4 (our plants by name), WIP, Transfers, Quality, Dispatch.
// Every row is a job card (production order) that follows a plant route; quantities come from job_card_routes.
// "+ Job Card", Word / Excel / PDF and the other V40 buttons come from the shell ActionBar.
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useToast } from '../../components/Toast';
import { ApiError } from '../../lib/api';
import { routingApi } from '../../lib/routingApi';
import type { LiveRow, PlantCard } from '../../lib/routingApi';
import { FlowTabs, PlantStrip, ReasonButton, dash } from './RouteShared';
import './routing.css';

type Tab = { key: string; label: string; view: string; unitId?: string };

export function MfgUnitRoutePage() {
  const toast = useToast();
  const [params] = useSearchParams();
  const [plants, setPlants] = useState<PlantCard[]>([]);
  const [tab, setTab] = useState(params.get('view') ?? 'live');
  const [rows, setRows] = useState<LiveRow[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const [tick, setTick] = useState(0);
  const [assign, setAssign] = useState<{ orders: { id: string; number: string; partName: string; qty: string }[]; routes: { id: string; code: string; name: string }[] } | null>(null);
  const [pick, setPick] = useState({ orderId: '', routeId: '' });
  const [qty, setQty] = useState<Record<string, { good: string; scrap: string }>>({});

  useEffect(() => {
    void routingApi.plants().then(setPlants, () => setPlants([]));
  }, []);

  const tabs: Tab[] = [
    { key: 'live', label: 'Live Routing', view: 'live' },
    ...plants.map((p, i): Tab => ({ key: `unit-${p.id}`, label: `Unit ${i + 1}: ${p.name}`, view: 'live', unitId: p.id })),
    { key: 'wip', label: 'WIP', view: 'wip' },
    { key: 'transfers', label: 'Transfers', view: 'transfers' },
    { key: 'quality', label: 'Quality', view: 'quality' },
    { key: 'dispatch', label: 'Dispatch', view: 'dispatch' },
  ];
  const current = tabs.find((t) => t.key === tab) ?? tabs[0]!;

  useEffect(() => {
    let alive = true;
    setBusy(true);
    routingApi.live({ view: current.view, unitId: current.unitId }).then(
      (r) => {
        if (!alive) return;
        setRows(r);
        setError('');
        setBusy(false);
      },
      (e: unknown) => {
        if (!alive) return;
        setError(e instanceof ApiError ? e.message : 'Could not load the routing.');
        setBusy(false);
      },
    );
    return () => {
      alive = false;
    };
  }, [current.view, current.unitId, tick]);

  const act = useCallback(
    async (fn: () => Promise<string>): Promise<void> => {
      try {
        toast(await fn());
        setTick((t) => t + 1);
      } catch (e) {
        toast(e instanceof ApiError ? e.message : 'That did not work.');
      }
    },
    [toast],
  );

  async function openAssign(): Promise<void> {
    try {
      setAssign(await routingApi.assignable());
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not load orders.');
    }
  }

  // The top bar's "＋ Add New" is this page's "+ Job Card": it starts a route for a production order (V40 case TC-21)
  useEffect(() => {
    const onAdd = (e: Event) => {
      const ce = e as CustomEvent<{ pageId?: string; handled?: boolean }>;
      if (ce.detail?.pageId !== 'mfg-unit-route' || ce.detail.handled) return;
      ce.detail.handled = true;
      void openAssign();
    };
    window.addEventListener('v40-add-record', onAdd);
    return () => window.removeEventListener('v40-add-record', onAdd);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="dash-page rt-page">
      <div className="page-head">
        <div>
          <h1>Multi-Unit Part Routing</h1>
          <p className="muted">Controlled BOM release, plant routing, two-step transfer receipt, quantity reconciliation, quality release and dispatch.</p>
        </div>
      </div>
      <PlantStrip />
      <FlowTabs current={tab === 'wip' ? 'WIP by Plant' : tab === 'quality' ? 'Quality Release' : tab === 'dispatch' ? 'Dispatch Readiness' : 'Live Routing'} />
      <div className="card rt-note">
        <b>Routing control:</b> A job moves only after the receiving plant has received the pending transfer note. Every move to another plant creates a transfer note.
      </div>
      <div role="tablist" className="tabs-row">
        {tabs.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={`btn${tab === t.key ? ' primary' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
        <button type="button" className="btn" onClick={() => void openAssign()}>Assign Route to Job Card</button>
      </div>

      {assign ? (
        <div className="card rt-dialog" role="group" aria-label="Assign route">
          <label>Job card
            <select value={pick.orderId} onChange={(e) => setPick({ ...pick, orderId: e.target.value })}>
              <option value="">Choose a production order</option>
              {assign.orders.map((o) => <option key={o.id} value={o.id}>{`${o.number} - ${o.partName} (${o.qty})`}</option>)}
            </select>
          </label>
          <label>Route
            <select value={pick.routeId} onChange={(e) => setPick({ ...pick, routeId: e.target.value })}>
              <option value="">Choose a route</option>
              {assign.routes.map((r) => <option key={r.id} value={r.id}>{`${r.code} - ${r.name}`}</option>)}
            </select>
          </label>
          <div className="rt-actions">
            <ReasonButton label="Start Route" primary reason={!pick.orderId ? 'Choose a job card.' : !pick.routeId ? 'Choose a route.' : null} onClick={() => void act(async () => { await routingApi.assign(pick.orderId, pick.routeId); setAssign(null); setPick({ orderId: '', routeId: '' }); return 'Route started.'; })} />
            <button type="button" className="btn" onClick={() => setAssign(null)}>Cancel</button>
          </div>
        </div>
      ) : null}

      {error ? <p role="alert">{error}</p> : null}
      <div className="table-wrap">
        <table className="register-table">
          <thead>
            <tr>
              <th>Job / Batch</th><th>Part</th><th>Current Operation</th><th>Next Operation</th><th>Good / Plan</th><th>Loss / Balance</th><th>Yield</th><th>Transfer Receipt</th><th>Quality / DC</th><th>Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const q = qty[r.id] ?? { good: '', scrap: '' };
              const last = r.nextProcess === null;
              const reason = r.routeStatus !== 'IN_PROGRESS' ? `This route is ${r.routeStatus.toLowerCase()}.` : r.transferStatus === 'PENDING' ? `Transfer note ${dash(r.transferNo)} is not received yet.` : null;
              return (
                <tr key={r.id}>
                  <td><b>{r.jobNo}</b><div className="muted">{r.routeCode}</div></td>
                  <td>{r.partName}<div className="muted">{r.partCode}</div></td>
                  <td>{r.currentProcess}<div className="muted">{r.currentUnitName}</div></td>
                  <td>{r.nextProcess ?? 'End of route'}<div className="muted">{dash(r.nextUnitName)}</div></td>
                  <td className="rt-num-cell">{`${r.good} / ${r.planned}`}</td>
                  <td className="rt-num-cell">{`${r.scrap} / ${r.balance}`}</td>
                  <td>{r.yield === null ? '-' : `${r.yield}%`}</td>
                  <td>{r.transferNo ? `${r.transferNo} (${dash(r.transferStatus)})` : '-'}</td>
                  <td>{`${dash(r.qualityApproval)} / ${dash(r.dcStatus)}`}</td>
                  <td>
                    <div className="rt-actions">
                      <input className="rt-step-input" type="number" min={0} aria-label={`Good quantity for ${r.jobNo}`} placeholder="Good" value={q.good} onChange={(e) => setQty({ ...qty, [r.id]: { ...q, good: e.target.value } })} />
                      <input className="rt-step-input" type="number" min={0} aria-label={`Scrap quantity for ${r.jobNo}`} placeholder="Scrap" value={q.scrap} onChange={(e) => setQty({ ...qty, [r.id]: { ...q, scrap: e.target.value } })} />
                      <ReasonButton label="Record" reason={reason ?? (!q.good && !q.scrap ? 'Enter a good or scrap quantity.' : null)} onClick={() => void act(async () => { const b = await routingApi.record(r.id, { good: Number(q.good || 0), scrap: Number(q.scrap || 0) }); setQty({ ...qty, [r.id]: { good: '', scrap: '' } }); return `Recorded. Balance ${b.balance}.`; })} />
                      <ReasonButton label={last ? 'Complete Route' : 'Move Next Controlled Step'} primary reason={reason} onClick={() => void act(async () => { const b = await routingApi.advance(r.id); return b.transferNo ? `Moved. Transfer note ${b.transferNo} created.` : b.routeStatus === 'COMPLETED' ? 'Route completed.' : 'Moved to the next step.'; })} />
                    </div>
                  </td>
                </tr>
              );
            })}
            {!busy && rows.length === 0 ? <tr><td colSpan={10}>No job cards in this view. Use Assign Route to Job Card to start one.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
