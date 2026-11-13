// Phase 25: the Move Forward popup (V40 field order), the Return dialog and the History drawer.
// Nothing moves by itself: every handover is a person pressing a button (R-31).
import { useEffect, useState } from 'react';
import { ApiError } from '../lib/api';
import { ROUTE_TYPES, WORK_STATUSES, workApi, type DocMovement, type Dept } from '../lib/workApi';
import { Drawer } from './Drawer';
import { Modal } from './Modal';

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
  const [busy, setBusy] = useState(false);
  const [suggested, setSuggested] = useState<string | null>(null);

  useEffect(() => {
    void workApi.departments().then(setDepts, () => setDepts([]));
    void workApi.suggest(docType).then(
      (s) => {
        if (s.departmentId) {
          setTo((cur) => cur || (s.departmentId as string));
          setSuggested(s.department);
        }
      },
      () => undefined,
    );
  }, [docType]);

  useEffect(() => {
    setManager('');
    if (!to) {
      setManagers([]);
      return;
    }
    void workApi.managers(to).then(setManagers, () => setManagers([]));
  }, [to]);

  async function submit() {
    setBusy(true);
    setError('');
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
      setError(e instanceof ApiError ? e.message : 'Could not move the record.');
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
          <button type="button" className="btn primary" disabled={busy || !to} onClick={() => void submit()}>
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
      <div className="field">
        <label htmlFor="mf-from">From Department</label>
        <input id="mf-from" value={fromDepartment ?? 'Your department'} readOnly disabled />
      </div>
      <div className="field">
        <label htmlFor="mf-to">Next Working Department *</label>
        <select id="mf-to" value={to} onChange={(e) => setTo(e.target.value)}>
          <option value="">Choose a department</option>
          {depts.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        {suggested ? <span className="hint">Suggested by the Workflow Matrix: {suggested}</span> : null}
      </div>
      <div className="field">
        <label htmlFor="mf-mgr">Responsible Manager</label>
        <select id="mf-mgr" value={manager} onChange={(e) => setManager(e.target.value)} disabled={!to}>
          <option value="">Anyone in the department</option>
          {managers.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
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
        <input id="mf-by" type="date" value={requiredBy} onChange={(e) => setRequiredBy(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="mf-ws">Work Status</label>
        <select id="mf-ws" value={workStatus} onChange={(e) => setWorkStatus(e.target.value)}>
          {WORK_STATUSES.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="mf-note">Short Handover Note</label>
        <textarea id="mf-note" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
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
      <textarea id="ret-reason" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
    </Modal>
  );
}

export function HistoryDrawer({ docType, docId, title, onClose }: { docType: string; docId: string; title: string; onClose: () => void }) {
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
          <strong>Currently with {data.holder.department}</strong> since {new Date(data.holder.sent_at).toLocaleString('en-IN')}
        </p>
      ) : null}
      {data && data.events.length === 0 ? <p className="muted">This record has not moved between departments yet.</p> : null}
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
