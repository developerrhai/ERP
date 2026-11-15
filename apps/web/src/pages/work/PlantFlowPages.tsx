// V40 Integrated Plant Flow pages: plant-flow-command and plant-project-forward. Both show one project's journey
// through its stage gates and departments. Everything is read from the database (/work/plant-flow/:id). Nothing moves by
// itself: Move Forward opens the same dialog as everywhere else and is offered only while a department holds an accepted
// movement of the project.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { MoveForwardDialog } from '../../components/MoveForward';
import { ApiError } from '../../lib/api';
import { plantFlowApi, type FlowGate, type PlantFlow } from '../../lib/plantFlowApi';
import { spineApi, type ProjectOption } from '../../lib/spineApi';
import { workApi, type Dept } from '../../lib/workApi';
import './plantflow.css';

const CYCLE = ['Move Forward', 'Select Department', 'Received + Accepted', 'Department Work', 'Select Approval Dept', 'Approved', 'Move Forward Again'];
const OTHER = [
  { to: '/m/plant-department-movement', label: 'Department Movement' },
  { to: '/m/plant-process-movement', label: 'Process Movement' },
  { to: '/m/plant-interplant-movement', label: 'Plant-to-Plant' },
  { to: '/m/maint-part-movement', label: 'Maintenance Part' },
];
const pretty = (s: string): string => s.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
const slug = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const ACCEPTED = ['ACCEPTED', 'IN_WORK', 'WAITING_APPROVAL'];

function PlantFlowView() {
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [depts, setDepts] = useState<Dept[]>([]);
  const [projectId, setProjectId] = useState('');
  const [deptId, setDeptId] = useState('all');
  const [flow, setFlow] = useState<PlantFlow | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const [moving, setMoving] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    void spineApi.options('').then(
      (r) => {
        setProjects(r);
        setProjectId((cur) => cur || r[0]?.id || '');
        if (r.length === 0) setBusy(false);
      },
      () => {
        setProjects([]);
        setBusy(false);
      },
    );
    void workApi.departments().then(setDepts, () => setDepts([]));
  }, []);

  useEffect(() => {
    if (!projectId) {
      setFlow(null);
      return;
    }
    let alive = true;
    setBusy(true);
    plantFlowApi.overview(projectId).then(
      (r) => {
        if (!alive) return;
        setFlow(r);
        setError('');
        setBusy(false);
      },
      (e: unknown) => {
        if (!alive) return;
        setFlow(null);
        setError(e instanceof ApiError ? e.message : 'Could not load the project flow.');
        setBusy(false);
      },
    );
    return () => {
      alive = false;
    };
  }, [projectId, tick]);

  const gates = useMemo(() => (flow?.gates ?? []).filter((g) => deptId === 'all' || g.ownerDepartmentId === deptId), [flow, deptId]);
  const holder = flow?.movements.find((m) => m.open && ['ACCEPTED', 'IN_WORK'].includes(m.state)) ?? null;
  const latest = flow?.movements.find((m) => m.open) ?? null;
  const cur = flow?.currentDepartment ?? null;
  const gate = flow?.currentGate ?? null;
  const received = latest !== null && latest.state !== 'SENT';
  const accepted = latest !== null && ACCEPTED.includes(latest.state);

  const moveReason = !flow
    ? 'Choose a project first.'
    : !gate
      ? 'This project has no open gate to move forward.'
      : !holder
        ? 'Move Forward opens after a department has Received and Accepted the project work.'
        : '';

  const stat = (label: string, value: string | number) => (
    <div className="pf-stat">
      <small>{label}</small>
      <b>{value}</b>
    </div>
  );
  const card = (tone: string, label: string, value: string, note: string) => (
    <div className={`card pf-card ${tone}`}>
      <small>{label}</small>
      <b>{value}</b>
      <small>{note}</small>
    </div>
  );
  const gateState = (g: FlowGate): string => (g.state === 'APPROVED' ? 'Completed' : pretty(g.state));

  return (
    <div className="dash-page">
      <div className="card pf-hero">
        <h1>Integrated Plant Flow • Project Department Forward</h1>
        <p>Project gates use the same controlled cycle: Move Forward with department selection, Received, Accepted, department work, selected approval department, approval, then Move Forward again.</p>
        <div className="pf-stats">
          {stat('Project Progress', flow?.progress.progressPct == null ? '—' : `${flow.progress.progressPct}%`)}
          {stat('Completed Gates', flow ? `${flow.progress.gatesDone} / ${flow.progress.gatesTotal}` : '—')}
          {stat('Pending Receipt', flow ? flow.pendingReceipt : '—')}
          {stat('Pending Acceptance', flow ? flow.pendingAcceptance : '—')}
          {stat('Current Department', cur?.name ?? '—')}
        </div>
      </div>

      <div className="card pf-cycle">
        <b>Correct project cycle:</b> nothing is auto-forwarded after approval. The current department selects the next department with Move Forward. The next department works only after Received + Accepted, then selects where to send the work for approval. Approved work unlocks the next Move Forward step.
      </div>
      <ol className="pf-steps" aria-label="Project cycle">
        {CYCLE.map((s, i) => (
          <li key={s} className={`pf-step${i === 0 ? ' pf-step-first' : ''}${i === CYCLE.length - 1 ? ' pf-step-last' : ''}`}>
            <small>{i + 1}</small>
            {s}
          </li>
        ))}
      </ol>

      <div className="card pf-picker">
        <label>
          Project
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="Project">
            {projects.length === 0 ? <option value="">No projects in your plants</option> : null}
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{`${p.code} • ${p.name}`}</option>
            ))}
          </select>
        </label>
        <label>
          Department Filter
          <select value={deptId} onChange={(e) => setDeptId(e.target.value)} aria-label="Department Filter">
            <option value="all">All Departments</option>
            {depts.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </label>
        {cur ? (
          <Link className="btn primary" to={`/m/dept-inbox-${slug(cur.name)}`}>
            Open Current Dept Inbox
          </Link>
        ) : (
          <button type="button" className="btn primary" disabled title="No department holds this project yet.">
            Open Current Dept Inbox
          </button>
        )}
        <Link className="btn" to="/m/proj-stage-gates">
          Detailed Project Control
        </Link>
      </div>
      {cur ? null : <p className="pf-reason">Open Current Dept Inbox is off: no department holds this project yet.</p>}
      {error ? <p role="alert">{error}</p> : null}
      {!busy && projects.length === 0 ? <p className="muted">There are no projects in your selected plants yet.</p> : null}

      {flow ? (
        <>
          <div className="pf-ident">
            <div className="card">
              <small>Project code</small>
              <b>{flow.project.code}</b>
            </div>
            <div className="card">
              <small>PO / Sales order</small>
              <b>{`${flow.project.purchaseOrder ?? '—'} / ${flow.project.salesOrder ?? '—'}`}</b>
            </div>
            <div className="card">
              <small>Manufacturing / Machine order</small>
              <b>{flow.project.manufacturingOrder ?? '—'}</b>
            </div>
          </div>

          <div className="pf-cards">
            {card(gate ? 'pf-card-now' : 'pf-card-done', gate ? 'Current gate' : 'Ready / Done', 'Project Gate', gate ? `${gate.code} • ${gate.ownerDepartment ?? 'No department'}` : 'All gates approved')}
            {card('pf-card-now', latest ? 'In progress' : 'Pending', 'Department Handover', latest ? `${latest.from_department} → ${latest.to_department}` : 'No open handover')}
            {card(received ? 'pf-card-done' : 'pf-card-wait', received ? 'Done' : 'Pending', 'Received', received && latest ? `By ${latest.to_department}` : 'Pending')}
            {card(accepted ? 'pf-card-done' : 'pf-card-wait', accepted ? 'Done' : 'Pending', 'Accepted', accepted && latest ? `By ${latest.to_department}` : 'Pending')}
            {card('pf-card-wait', 'Pending', 'Next Gate Released', gate?.nextGateCode ? `${gate.nextGateCode} after ${gate.code} is approved` : 'Auto after gate completion')}
          </div>

          <div role="tablist" className="pf-depts" aria-label="Departments">
            <button type="button" role="tab" aria-selected={deptId === 'all'} className={`btn${deptId === 'all' ? ' primary' : ''}`} onClick={() => setDeptId('all')}>
              All Departments
            </button>
            {depts.map((d) => (
              <button key={d.id} type="button" role="tab" aria-selected={deptId === d.id} className={`btn${deptId === d.id ? ' primary' : ''}`} onClick={() => setDeptId(d.id)}>
                {d.name}
              </button>
            ))}
          </div>

          {gates.length === 0 ? (
            <p className="muted">{flow.gates.length === 0 ? 'This project has no stage gates yet. Apply a gate template in Detailed Project Control.' : 'No gates belong to this department.'}</p>
          ) : null}
          {gates.map((g) => (
            <div key={g.id} className={`card pf-gate${g.state === 'APPROVED' ? ' pf-gate-done' : g.id === gate?.id ? ' pf-gate-now' : ''}`}>
              <div>
                <b>{`${flow.project.code}-${g.code} • ${g.name}`}</b>
                <div className="muted">{g.exitCriteria ?? g.deliverableName ?? 'No exit criteria set.'}</div>
                <div className="muted">{`Dependency: ${g.dependsOn.length > 0 ? g.dependsOn.join(', ') : 'None'}${g.dueDate ? ` • Due ${g.dueDate}` : ''}`}</div>
              </div>
              <div>
                <b>{g.ownerDepartment ?? 'No department'}</b>
              </div>
              <div className="pf-gate-actions">
                <b>{gateState(g)}</b>
                <small className="muted">{g.nextGateCode ? `Next gate: ${flow.project.code}-${g.nextGateCode}${g.nextGateDepartment ? ` • ${g.nextGateDepartment}` : ''}` : 'Last gate'}</small>
                {g.state === 'LOCKED' ? (
                  <>
                    <button type="button" className="btn" disabled>
                      Open Work
                    </button>
                    <span className="pf-reason">Locked until its earlier gates are approved.</span>
                  </>
                ) : (
                  <Link className="btn" to={`/m/${g.linkedPage ?? 'proj-stage-gates'}`}>
                    Open Work
                  </Link>
                )}
              </div>
            </div>
          ))}

          <div className="card pf-other">
            <button type="button" className="btn primary" disabled={moveReason !== ''} title={moveReason} onClick={() => setMoving(true)}>
              Move Forward → Next Gate
            </button>
            {moveReason ? <span className="pf-reason">{moveReason}</span> : null}
          </div>
        </>
      ) : null}

      <div className="card pf-other">
        <b>Other Integrated Plant Movements</b>
        {OTHER.map((o) => (
          <Link key={o.to} className="btn" to={o.to}>
            {o.label}
          </Link>
        ))}
      </div>

      {moving && holder ? (
        <MoveForwardDialog
          docType={holder.doc_type}
          docId={holder.doc_id}
          docNo={holder.doc_no ?? undefined}
          fromDepartment={holder.to_department}
          onClose={() => setMoving(false)}
          onMoved={() => {
            setMoving(false);
            setTick((t) => t + 1);
          }}
        />
      ) : null}
    </div>
  );
}

/** plant-flow-command */
export function PlantFlowCommandPage() {
  return <PlantFlowView />;
}

/** plant-project-forward */
export function PlantProjectForwardPage() {
  return <PlantFlowView />;
}
