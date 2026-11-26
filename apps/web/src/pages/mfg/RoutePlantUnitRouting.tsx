// V40 plant-unit-routing ("Plant / Unit Routing"): the route builder. Templates and steps are real rows
// (plant_routes / plant_route_steps); a step is plant, process, department, work centre, standard hours and QC.
// The V40 button row (Return, Import, Export, Duplicates, Project History) comes from the shell ActionBar.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useToast } from '../../components/Toast';
import { RecordActions } from '../../components/workspace/RecordActions';
import { Modal } from '../../components/Modal';
import { ApiError } from '../../lib/api';
import { routingApi } from '../../lib/routingApi';
import type { Dept, RouteCards, RouteRow, RouteSave, RouteStep, Unit } from '../../lib/routingApi';
import { ReasonButton } from './RouteShared';
import './routing.css';

interface Draft {
  id: string | null;
  code: string;
  name: string;
  itemOrFamily: string;
  active: boolean;
  steps: RouteStep[];
}
const blank = (): Draft => ({ id: null, code: '', name: '', itemOrFamily: '', active: true, steps: [] });
const err = (e: unknown, fallback: string): string => (e instanceof ApiError ? e.message : fallback);

export function PlantUnitRoutingPage() {
  const toast = useToast();
  const [units, setUnits] = useState<Unit[]>([]);
  const [depts, setDepts] = useState<Dept[]>([]);
  const [routes, setRoutes] = useState<RouteRow[]>([]);
  const [cards, setCards] = useState<RouteCards | null>(null);
  const [draft, setDraft] = useState<Draft>(blank());
  const [centres, setCentres] = useState<Record<string, { id: string; code: string; name: string }[]>>({});
  const [filter, setFilter] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const r = await routingApi.routes();
      setRoutes(r.routes);
      setCards(r.cards);
      setError('');
    } catch (e) {
      setError(err(e, 'Could not load the routes.'));
    }
  }, []);

  useEffect(() => {
    void routingApi.lookups().then((l) => {
      setUnits(l.units);
      setDepts(l.departments);
    }, () => setError('Could not load plants and departments.'));
    void reload();
  }, [reload]);

  const loadCentres = useCallback(
    async (unitId: string) => {
      if (!unitId || centres[unitId]) return;
      const rows = await routingApi.workCentres(unitId).catch(() => []);
      setCentres((c) => ({ ...c, [unitId]: rows }));
    },
    [centres],
  );

  async function open(id: string): Promise<void> {
    try {
      const r = await routingApi.route(id);
      setDraft({ id: r.id, code: r.code, name: r.name, itemOrFamily: r.itemOrFamily ?? '', active: r.active, steps: r.steps });
      for (const s of r.steps) void loadCentres(s.unitId);
    } catch (e) {
      toast(err(e, 'Could not open the route.'));
    }
  }

  const setStep = (i: number, patch: Partial<RouteStep>): void =>
    setDraft((d) => ({ ...d, steps: d.steps.map((s, k) => (k === i ? { ...s, ...patch } : s)) }));

  function addStep(): void {
    const unit = units[0]?.id ?? '';
    setDraft((d) => ({ ...d, steps: [...d.steps, { unitId: d.steps[d.steps.length - 1]?.unitId ?? unit, processName: '', departmentId: null, workCentreId: null, stdHours: null, qcRequired: false, approvalRequired: false }] }));
    if (unit) void loadCentres(unit);
  }

  const payload = (): RouteSave => ({
    ...(draft.code ? { code: draft.code } : {}),
    name: draft.name.trim(),
    itemOrFamily: draft.itemOrFamily.trim() || null,
    active: draft.active,
    steps: draft.steps.map((s) => ({
      unitId: s.unitId,
      processName: s.processName,
      departmentId: s.departmentId || null,
      workCentreId: s.workCentreId || null,
      stdHours: s.stdHours === null || s.stdHours === '' ? null : Number(s.stdHours),
      qcRequired: s.qcRequired,
      approvalRequired: s.approvalRequired,
    })),
  });

  async function run(label: string, fn: () => Promise<void>): Promise<void> {
    setBusy(true);
    try {
      await fn();
      toast(label);
      await reload();
    } catch (e) {
      toast(err(e, 'That did not work.'));
    } finally {
      setBusy(false);
    }
  }

  const save = (): Promise<void> =>
    run('Route saved.', async () => {
      const r = draft.id ? await routingApi.updateRoute(draft.id, payload()) : await routingApi.createRoute(payload());
      setDraft({ id: r.id, code: r.code, name: r.name, itemOrFamily: r.itemOrFamily ?? '', active: r.active, steps: r.steps });
    });

  const [askDelete, setAskDelete] = useState<RouteRow | null>(null);
  const saveReason = !draft.name.trim() ? 'Enter the route name first.' : draft.steps.length === 0 ? 'Add at least one step first.' : draft.steps.some((s) => !s.processName.trim()) ? 'Every step needs a process.' : null;
  const visibleSteps = draft.steps.map((s, i) => ({ s, i })).filter(({ s }) => !filter || s.departmentId === filter);

  return (
    <div className="dash-page rt-page">
      <div className="page-head">
        <div>
          <h1>Plant / Unit Routing</h1>
          <p className="muted">Flexible route builder for product, material and process movement. Every step names the plant, process, department and work centre.</p>
        </div>
        <div className="actions">
          <Link className="btn" to="/m/maint-part-movement">Process Movements</Link>
          <Link className="btn" to="/m/plant-interplant-movement">Plant-to-Plant</Link>
          <button type="button" className="btn primary" onClick={() => { setDraft(blank()); document.querySelector<HTMLInputElement>('.rt-form input[data-route-name]')?.focus(); }}>＋ Add Route</button>
        </div>
      </div>

      {error ? <p role="alert">{error}</p> : null}

      <div className="rt-cards">
        <div className="card rt-card"><span className="muted">Route Templates</span><div className="rt-num">{cards?.templates ?? '-'}</div></div>
        <div className="card rt-card"><span className="muted">Route Steps</span><div className="rt-num">{cards?.steps ?? '-'}</div></div>
        <div className="card rt-card"><span className="muted">Active Dept Handover</span><div className="rt-num">{cards?.activeDeptHandover ?? '-'}</div></div>
        <div className="card rt-card"><span className="muted">Physical Process Moves</span><div className="rt-num">{cards?.physicalMoves ?? '-'}</div></div>
      </div>

      <div className="card">
        <div className="rt-toolbar">
          <select aria-label="Route template" value={draft.id ?? ''} onChange={(e) => (e.target.value ? void open(e.target.value) : setDraft(blank()))}>
            <option value="">New route (not saved)</option>
            {routes.map((r) => (
              <option key={r.id} value={r.id}>{`${r.name}${r.active ? '' : ' (off)'} - ${r.stepCount} steps`}</option>
            ))}
          </select>
          <button type="button" className="btn" disabled={busy} onClick={() => setDraft(blank())}>New Route</button>
          <ReasonButton label="Duplicate" reason={draft.id ? null : 'Open a saved route to duplicate it.'} onClick={() => void run('Route duplicated.', async () => { const r = await routingApi.duplicateRoute(draft.id!); await open(r.id); })} />
          <button type="button" className="btn" disabled={busy} onClick={() => void run('Sketch template rebuilt.', async () => { const r = await routingApi.resetSketch(); await open(r.id); })}>Reset Sketch Template</button>
        </div>
        {draft.steps.length > 0 ? (
          <div className="rt-steps" aria-label="Route sketch">
            {draft.steps.map((s, i) => (
              <div key={`${s.id ?? 'n'}-${i}`} className="rt-sketch">
                <b>{`${i + 1}. ${s.processName || '(process)'}`}</b>
                <div className="muted">{units.find((u) => u.id === s.unitId)?.name ?? ''}</div>
                <div className="muted">{depts.find((d) => d.id === s.departmentId)?.name ?? ''}</div>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div className="card">
        <h2>Route Builder</h2>
        <div className="rt-form">
          <label>Route ID<input value={draft.code} placeholder="Assigned on save" maxLength={30} onChange={(e) => setDraft({ ...draft, code: e.target.value })} /></label>
          <label>Route Name<input data-route-name value={draft.name} maxLength={120} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
          <label>Product / Family<input value={draft.itemOrFamily} maxLength={120} onChange={(e) => setDraft({ ...draft, itemOrFamily: e.target.value })} /></label>
          <label>Status
            <select value={draft.active ? 'on' : 'off'} onChange={(e) => setDraft({ ...draft, active: e.target.value === 'on' })}>
              <option value="on">Active</option>
              <option value="off">Switched off</option>
            </select>
          </label>
        </div>
        <div className="rt-toolbar">
          <label>Department Filter{' '}
            <select value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="">All Departments</option>
              {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </label>
        </div>
        <div className="table-wrap">
          <table className="register-table">
            <thead>
              <tr><th>#</th><th>Plant</th><th>Process</th><th>Department</th><th>Work Centre</th><th>Std Hours</th><th>Movement Type</th><th>QC</th><th>Approval</th><th>Action</th></tr>
            </thead>
            <tbody>
              {visibleSteps.map(({ s, i }) => (
                <tr key={`${s.id ?? 'n'}-${i}`}>
                  <td>{i + 1}</td>
                  <td>
                    <select className="rt-step-input" aria-label={`Plant of step ${i + 1}`} value={s.unitId} onChange={(e) => { setStep(i, { unitId: e.target.value, workCentreId: null }); void loadCentres(e.target.value); }}>
                      {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                  </td>
                  <td><input className="rt-step-input" aria-label={`Process of step ${i + 1}`} value={s.processName} maxLength={120} onChange={(e) => setStep(i, { processName: e.target.value })} /></td>
                  <td>
                    <select className="rt-step-input" aria-label={`Department of step ${i + 1}`} value={s.departmentId ?? ''} onChange={(e) => setStep(i, { departmentId: e.target.value || null })}>
                      <option value="">-</option>
                      {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                  </td>
                  <td>
                    <select className="rt-step-input" aria-label={`Work centre of step ${i + 1}`} value={s.workCentreId ?? ''} onFocus={() => void loadCentres(s.unitId)} onChange={(e) => setStep(i, { workCentreId: e.target.value || null })}>
                      <option value="">-</option>
                      {(centres[s.unitId] ?? []).map((w) => <option key={w.id} value={w.id}>{`${w.code} - ${w.name}`}</option>)}
                    </select>
                  </td>
                  <td><input className="rt-step-input" type="number" min={0} step="0.01" aria-label={`Standard hours of step ${i + 1}`} value={s.stdHours ?? ''} onChange={(e) => setStep(i, { stdHours: e.target.value === '' ? null : e.target.value })} /></td>
                  <td>{draft.steps[i + 1] ? (draft.steps[i + 1]!.unitId !== s.unitId ? 'Plant Transfer' : 'Process Transfer') : 'Final'}</td>
                  <td><input type="checkbox" aria-label={`QC required at step ${i + 1}`} checked={s.qcRequired} onChange={(e) => setStep(i, { qcRequired: e.target.checked })} /></td>
                  <td><input type="checkbox" aria-label={`Approval required at step ${i + 1}`} checked={s.approvalRequired} onChange={(e) => setStep(i, { approvalRequired: e.target.checked })} /></td>
                  <td><button type="button" className="btn danger" onClick={() => setDraft((d) => ({ ...d, steps: d.steps.filter((_, k) => k !== i) }))}>Delete</button></td>
                </tr>
              ))}
              {draft.steps.length === 0 ? <tr><td colSpan={10}>No steps yet. Use + Add Step, or open a saved route.</td></tr> : null}
            </tbody>
          </table>
        </div>
        <div className="rt-toolbar">
          <ReasonButton label="+ Add Step" reason={units.length === 0 ? 'No active plant exists yet.' : null} onClick={addStep} />
          <ReasonButton label="Save Route" primary reason={busy ? 'Saving...' : saveReason} onClick={() => void save()} />
          <ReasonButton label="Delete Route" danger reason={draft.id ? null : 'Only a saved route can be deleted.'} onClick={() => void run('Route removed.', async () => { const r = await routingApi.deleteRoute(draft.id!); toast(r.deactivated ? 'The route is used by job cards, so it was switched off.' : 'Route deleted.'); setDraft(blank()); })} />
        </div>
        {saveReason ? <p className="muted rt-hint">{`Save Route is waiting: ${saveReason}`}</p> : null}
      </div>

      {askDelete ? (
        <Modal
          title="Delete this route?"
          sub={`${askDelete.code} · ${askDelete.name}`}
          size="sm"
          onClose={() => setAskDelete(null)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setAskDelete(null)}>Cancel</button>
              <button
                type="button"
                className="btn danger"
                onClick={() => {
                  const r = askDelete;
                  setAskDelete(null);
                  void run('Route removed.', async () => { const res = await routingApi.deleteRoute(r.id); toast(res.deactivated ? 'The route is used by job cards, so it was switched off.' : 'Route deleted.'); if (draft.id === r.id) setDraft(blank()); });
                }}
              >
                Delete route
              </button>
            </>
          }
        >
          <p>A route used by job cards is switched off instead, so their history stays readable.</p>
        </Modal>
      ) : null}

      <div className="card">
        <h2>Saved Routes</h2>
        <div className="table-wrap">
          <table className="register-table">
            <thead>
              <tr><th>Route ID</th><th>Route Name</th><th>Product / Family</th><th>Steps</th><th>Job Cards</th><th>Status</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {routes.map((r) => (
                <tr key={r.id}>
                  <td><b>{r.code}</b></td>
                  <td>{r.name}</td>
                  <td>{r.itemOrFamily || '-'}</td>
                  <td className="rt-num-cell">{r.stepCount}</td>
                  <td className="rt-num-cell">{r.jobCount}</td>
                  <td>{r.active ? 'Active' : 'Switched off'}</td>
                  <td className="row-actions">
                    <RecordActions docType="plant-unit-routing" id={r.id} number={r.code} status={r.active ? 'Active' : 'Switched off'}>
                      <button type="button" className="btn sm" onClick={() => { void open(r.id); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>View / Edit</button>
                      <button
                        type="button"
                        className="btn sm danger"
                        disabled={busy}
                        onClick={() => setAskDelete(r)}
                      >
                        Delete
                      </button>
                    </RecordActions>
                  </td>
                </tr>
              ))}
              {routes.length === 0 ? <tr><td colSpan={7}>No saved route yet. Add steps above and press Save Route.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
