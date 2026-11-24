// Phase 25: the Move Forward popup (V40 field order), the Return dialog and the History drawer.
// Nothing moves by itself: every handover is a person pressing a button (R-31).
import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../lib/api';
import { ROUTE_TYPES, WORK_STATUSES, workApi, type DocMovement, type Dept } from '../lib/workApi';
import { Drawer } from './Drawer';
import { Modal } from './Modal';
import { getSession } from '../auth/session';
import { isIsoDate } from '../lib/validators';

/** The department a user of this page normally works in (used to pre-fill From Department when the session has none). */
function ownerDeptOf(docType: string): string {
  if (docType.startsWith('asset-') || docType.startsWith('maint-')) return 'Maintenance';
  if (/^(log-|fleet-|gate-|wms-|inv-|container-|customer-receipts)/.test(docType))
    return 'Warehouse';
  if (/^(fin-|tax-)/.test(docType)) return 'Finance';
  if (/^(sales-|crm-)/.test(docType)) return 'Sales';
  if (docType.startsWith('scm-')) return 'Purchase';
  if (docType.startsWith('qms-')) return 'Quality';
  if (/^(pay-|hr-)/.test(docType)) return 'HR';
  if (docType.startsWith('mfg-')) return 'Production';
  if (docType.startsWith('proj-')) return 'Projects';
  if (docType.startsWith('service-')) return 'Service';
  return 'Administration';
}

const todayIso = (): string => new Date().toISOString().slice(0, 10);
const RED = { borderColor: '#dc2626', background: '#fef2f2' } as const;

const CYCLE_TEXT =
  'Move Forward → next department marks Received → Accepted → works on the record → Send for Approval to a selected department → approval Accepted → Move Forward becomes available again.';

export function MoveForwardDialog({
  docType,
  docId,
  docNo,
  fromDepartment,
  onClose,
  onMoved,
}: {
  docType: string;
  docId: string;
  docNo?: string;
  /** shown locked; the server decides the real holder */
  fromDepartment?: string;
  onClose: () => void;
  onMoved: () => void;
}) {
  const [depts, setDepts] = useState<Dept[]>([]);
  const [managers, setManagers] = useState<{ id: string; name: string }[]>([]);
  const [to, setTo] = useState('');
  const [manager, setManager] = useState('');
  const [routeType, setRouteType] = useState<string>(ROUTE_TYPES[0]);
  const [priority, setPriority] = useState('Normal');
  const [requiredBy, setRequiredBy] = useState('');
  const [workStatus, setWorkStatus] = useState<string>(WORK_STATUSES[0]);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  // WF-01: what the server refused, field by field (the generic "fix the highlighted fields" alone told nobody what to fix)
  const [serverFields, setServerFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [suggested, setSuggested] = useState<string | null>(null);
  const [fromDept, setFromDept] = useState<string>(
    fromDepartment ?? getSession().user?.department ?? ownerDeptOf(docType),
  );
  const [submitted, setSubmitted] = useState(false);
  const fromDeptRef = useRef(fromDept);
  fromDeptRef.current = fromDept;
  // QA ERP-MF-01: what is wrong with the form, field by field (shown in red under the field)
  const problems: Record<string, string> = {};
  if (!fromDept.trim()) problems.from = 'From Department is required.';
  if (!to) problems.to = 'Choose the next working department.';
  if (requiredBy) {
    if (!isIsoDate(requiredBy)) problems.by = 'Pick a valid date from the calendar.';
    else if (requiredBy < todayIso()) problems.by = 'Required By cannot be in the past.';
  }
  const serverKey: Record<string, string> = {
    fromDepartment: 'from',
    toDepartmentId: 'to',
    assignedManagerId: 'mgr',
    requiredBy: 'by',
  };
  const fromServer: Record<string, string> = {};
  for (const [k, v] of Object.entries(serverFields)) fromServer[serverKey[k] ?? '_'] = v;
  const shown = { ...(submitted ? problems : {}), ...fromServer };
  const fieldProps = (key: string) => ({
    'aria-invalid': shown[key] ? true : undefined,
    style: shown[key] ? RED : undefined,
  });

  useEffect(() => {
    void workApi.departments().then(setDepts, () => setDepts([]));
    void workApi.suggest(docType).then(
      (s) => {
        if (s.departmentId && s.department !== fromDeptRef.current) {
          setTo((cur) => cur || (s.departmentId as string));
          setSuggested(s.department);
        }
      },
      () => undefined,
    );
  }, [docType]);

  // a refused field is cleared as soon as the person changes the form
  useEffect(() => setServerFields({}), [to, manager, requiredBy, fromDept]);

  // choosing the holding department as the sender again must not leave it selected as the target
  useEffect(() => {
    const picked = depts.find((d) => d.id === to);
    if (picked && picked.name === fromDept) setTo('');
  }, [fromDept, depts, to]);

  useEffect(() => {
    setManager('');
    if (!to) {
      setManagers([]);
      return;
    }
    void workApi.managers(to).then(setManagers, () => setManagers([]));
  }, [to]);

  async function submit() {
    setSubmitted(true);
    if (Object.keys(problems).length > 0) return;
    setBusy(true);
    setError('');
    setServerFields({});
    try {
      await workApi.forward({
        docType,
        docId,
        ...(docNo ? { docNo } : {}),
        toDepartmentId: to,
        assignedManagerId: manager || null,
        routeType,
        priority,
        requiredBy: requiredBy || null,
        workStatus,
        handoverNote: note.trim() || null,
      });
      onMoved();
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length > 0) {
        setServerFields(e.fields);
        // a field the form has no input for is shown as the message itself
        const known = new Set(Object.keys(serverKey));
        const rest = Object.entries(e.fields)
          .filter(([k]) => !known.has(k))
          .map(([, v]) => v);
        setError(rest.join(' '));
      } else {
        setError(e instanceof ApiError ? e.message : 'Could not move the record.');
      }
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Move Forward"
      sub={docNo ?? docType}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={busy}
            onClick={() => void submit()}
          >
            Move Forward
          </button>
        </>
      }
    >
      {error ? (
        <p role="alert" className="error-text">
          {error}
        </p>
      ) : null}
      {submitted && Object.keys(problems).length > 0 && Object.keys(serverFields).length === 0 ? (
        <p
          role="alert"
          className="error-text"
          style={{
            background: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: 8,
            padding: '8px 12px',
          }}
        >
          Please fix the highlighted fields
        </p>
      ) : null}
      <div
        className="mf-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: '12px 18px',
        }}
      >
        <div className="field">
          <label htmlFor="mf-from">From Department *</label>
          <select
            id="mf-from"
            value={fromDept}
            onChange={(e) => setFromDept(e.target.value)}
            {...fieldProps('from')}
          >
            {[...new Set([fromDept, ...depts.map((d) => d.name)].filter(Boolean))].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <span className="hint">
            Filled in from your department; the server records the department that really holds the
            document.
          </span>
          {shown.from ? <span className="field-error">{shown.from}</span> : null}
        </div>
        <div className="field">
          <label htmlFor="mf-to">Next Working Department *</label>
          <select
            id="mf-to"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            {...fieldProps('to')}
          >
            <option value="">Choose a department</option>
            {depts
              .filter((d) => d.name !== fromDept)
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
          </select>
          <span className="hint">
            {fromDept} already holds this record. To get your own manager&apos;s approval use Submit
            / Send for Approval; Move Forward hands the work to another department.
          </span>
          {suggested ? (
            <span className="hint">Suggested by the Workflow Matrix: {suggested}</span>
          ) : null}
          {shown.to ? <span className="field-error">{shown.to}</span> : null}
        </div>
        <div className="field">
          <label htmlFor="mf-mgr">Responsible Manager</label>
          <select
            id="mf-mgr"
            value={manager}
            onChange={(e) => setManager(e.target.value)}
            disabled={!to}
          >
            <option value="">Anyone in the department</option>
            {managers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          {shown.mgr ? <span className="field-error">{shown.mgr}</span> : null}
        </div>
        <div className="field">
          <label htmlFor="mf-type">Work Type</label>
          <select id="mf-type" value={routeType} onChange={(e) => setRouteType(e.target.value)}>
            {ROUTE_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="mf-prio">Priority</label>
          <select id="mf-prio" value={priority} onChange={(e) => setPriority(e.target.value)}>
            {['Normal', 'High', 'Critical'].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="mf-by">Required By</label>
          <input
            id="mf-by"
            type="date"
            min={todayIso()}
            value={requiredBy}
            onChange={(e) => setRequiredBy(e.target.value)}
            {...fieldProps('by')}
          />
          {shown.by ? <span className="field-error">{shown.by}</span> : null}
        </div>
        <div className="field">
          <label htmlFor="mf-ws">Work Status</label>
          <select id="mf-ws" value={workStatus} onChange={(e) => setWorkStatus(e.target.value)}>
            {WORK_STATUSES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="field">
        <label htmlFor="mf-note">Short Handover Note</label>
        <textarea
          id="mf-note"
          rows={3}
          maxLength={500}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      <p className="hint">{CYCLE_TEXT}</p>
    </Modal>
  );
}

export function ReturnDialog({
  onClose,
  onConfirm,
}: {
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function go() {
    if (reason.trim().length < 10) {
      setError('Write at least 10 characters for the reason.');
      return;
    }
    setBusy(true);
    try {
      await onConfirm(reason.trim());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not return it.');
      setBusy(false);
    }
  }
  return (
    <Modal
      size="sm"
      title="Return to sender"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn danger" disabled={busy} onClick={() => void go()}>
            Return
          </button>
        </>
      }
    >
      {error ? (
        <p role="alert" className="error-text">
          {error}
        </p>
      ) : null}
      <label htmlFor="ret-reason">Reason *</label>
      <textarea
        id="ret-reason"
        maxLength={500}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
    </Modal>
  );
}

export function HistoryDrawer({
  docType,
  docId,
  title,
  onClose,
}: {
  docType: string;
  docId: string;
  title: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<DocMovement | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    void workApi.doc(docType, docId).then(setData, () => setError('Could not load the history.'));
  }, [docType, docId]);
  return (
    <Drawer title={`History · ${title}`} onClose={onClose}>
      {error ? <p role="alert">{error}</p> : null}
      {!data && !error ? <p className="muted">Loading…</p> : null}
      {data?.holder ? (
        <p>
          <strong>
            Currently with {data.holder.department} (
            {data.holder.state.replace('_', ' ').toLowerCase()})
          </strong>{' '}
          since {new Date(data.holder.sent_at).toLocaleString('en-IN')}
          <br />
          <span className="muted">
            This is the department step only. A record's own status (for example Pending Approval)
            changes when its approver decides.
          </span>
        </p>
      ) : null}
      {data && data.events.length === 0 ? (
        <p className="muted">This record has not moved between departments yet.</p>
      ) : null}
      <ol className="history-list">
        {(data?.events ?? []).map((e, i) => (
          <li key={`${e.number}-${i}`}>
            <strong>{e.event.replace('_', ' ')}</strong> · {e.department ?? '—'} · {e.actor ?? '—'}
            <br />
            <span className="muted">
              {new Date(e.at).toLocaleString('en-IN')} · {e.number}
              {e.note ? ` · ${e.note}` : ''}
            </span>
          </li>
        ))}
      </ol>
    </Drawer>
  );
}
