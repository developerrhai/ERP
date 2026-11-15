// V40 pages maint-part-movement, plant-process-movement, plant-department-movement and plant-interplant-movement:
// one register template, four scopes. Every row is a real department movement (GET /work/movements?kind=...); the
// quantities come from its movement lines. Receive / Accept / Return / Move Forward are the Phase 25 actions, a
// plant-to-plant Receive sends the received quantity and short reason per line. Nothing moves by itself.
// The V40 button row (Return, Import, Export, Duplicates, Project History) comes from the shell ActionBar.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { HistoryDrawer, MoveForwardDialog, ReturnDialog } from '../../components/MoveForward';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { api, ApiError } from '../../lib/api';
import { docsMailApi, type CatalogEntry, type CatalogRecord } from '../../lib/docsMailApi';
import { movementApi, type MovementCounts, type MovementKind, type MovementLine, type MovementRow, type MovementView } from '../../lib/movementApi';
import { workApi, type AuditRow, type Dept } from '../../lib/workApi';
import './movements.css';

export type MovementPageId = 'maint-part-movement' | 'plant-process-movement' | 'plant-department-movement' | 'plant-interplant-movement';

interface Tab {
  label: string;
  view: MovementView | 'audit';
}

interface PageConfig {
  kind: MovementKind;
  title: string;
  intro: string;
  rule: string;
  tabs: Tab[];
  columns: string[];
  routeType: string;
}

const CONFIG: Record<MovementPageId, PageConfig> = {
  'maint-part-movement': {
    kind: 'maintenance',
    title: 'Maintenance Part Movement',
    intro: 'Spare store → maintenance → machine / repair → return. Custody of every part is recorded with its work order.',
    rule: 'Controlled movement: the receiving department marks the part Received, then Accepted. Every action is linked to the audit trail.',
    tabs: [
      { label: 'Movement Register', view: 'all' },
      { label: 'Pending Receipt', view: 'sent' },
      { label: 'In Custody', view: 'custody' },
      { label: 'Returned', view: 'returned' },
      { label: 'Completed', view: 'completed' },
      { label: 'Audit', view: 'audit' },
    ],
    columns: ['Movement / Work Order', 'Machine / Part', 'Custody Route', 'Type / Condition', 'Quantity', 'Approval / Receipt', 'Dates', 'Actions'],
    routeType: 'Material Action',
  },
  'plant-process-movement': {
    kind: 'process',
    title: 'Process Movement',
    intro: 'Laser → drilling → tapping → bending → welding → quality. Each handover keeps the quantity reconciled.',
    rule: 'Controlled movement: the next process department must receive and accept the job before it works on it.',
    tabs: [
      { label: 'Process Movement', view: 'all' },
      { label: 'Pending Approval', view: 'waiting' },
      { label: 'Pending Receipt', view: 'sent' },
      { label: 'Received', view: 'custody' },
      { label: 'Variance', view: 'variance' },
      { label: 'Audit', view: 'audit' },
    ],
    columns: ['Movement / Job', 'Part / Batch', 'Process Route', 'Machine / Operator', 'Quantity Reconciliation', 'Approval / Receipt', 'Actions'],
    routeType: 'Manufacturing Action',
  },
  'plant-department-movement': {
    kind: 'department',
    title: 'Department Movement',
    intro: 'Source manager → destination manager acceptance → destination custody.',
    rule: 'Controlled movement: the destination department accepts the handover before it takes custody. Only the department holding a record can send it on.',
    tabs: [
      { label: 'Department Handover', view: 'all' },
      { label: 'My Department Queue', view: 'mine' },
      { label: 'Pending Acceptance', view: 'pending' },
      { label: 'Accepted', view: 'accepted' },
      { label: 'Returned', view: 'returned' },
      { label: 'SLA & Escalation', view: 'late' },
      { label: 'Audit', view: 'audit' },
    ],
    columns: ['Movement / Reference', 'Part / Quantity', 'Department Route', 'Handover / Priority', 'Manager Approval', 'Custody / Receipt', 'Actions'],
    routeType: 'Department Work Handover',
  },
  'plant-interplant-movement': {
    kind: 'interplant',
    title: 'Plant-to-Plant Movement',
    intro: 'Gate out → transit → destination receipt → variance closure.',
    rule: 'Controlled movement: source dispatch creates destination approval. Only after acceptance can the destination record quantity received, rejected, damaged or short. Every action is linked to audit.',
    tabs: [
      { label: 'Transfer Orders', view: 'all' },
      { label: 'In Transit', view: 'sent' },
      { label: 'Destination Receipt', view: 'custody' },
      { label: 'Variance / Dispute', view: 'variance' },
      { label: 'Audit', view: 'audit' },
    ],
    columns: ['Transfer / Part', 'Plant Route', 'Warehouse / Department', 'Transport Documents', 'Quantity Reconciliation', 'Transit / Receipt', 'Actions'],
    routeType: 'Department Work Handover',
  },
};

const KIND_BUTTONS: { id: MovementPageId; kind: MovementKind; label: string }[] = [
  { id: 'maint-part-movement', kind: 'maintenance', label: 'Maintenance Parts' },
  { id: 'plant-process-movement', kind: 'process', label: 'Process Movement' },
  { id: 'plant-department-movement', kind: 'department', label: 'Department Movement' },
  { id: 'plant-interplant-movement', kind: 'interplant', label: 'Plant-to-Plant' },
];

const MAINTENANCE_PAGE_IDS = ['maint-spares', 'maint-workorders', 'maint-breakdown', 'maint-preventive', 'maint-equipment', 'maint-machines', 'maint-schedule', 'asset-maintenance', 'service-spares'];

const NO_APPROVAL = 'Send for Approval is not available on this page yet: the approval step cannot be started from the register.';
const NO_WORD = 'Word export of this register is not available yet. Use PDF or the Export button above.';

const when = (iso: string | null): string => (iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const num = (n: number | null): string => (n === null || n === undefined ? '—' : String(n));

export function receiptText(m: MovementRow): string {
  switch (m.state) {
    case 'SENT': return m.is_physical || m.to_unit_id ? 'In transit, pending receipt' : 'Pending receipt';
    case 'RECEIVED': return 'Received, pending acceptance';
    case 'ACCEPTED': return 'Accepted';
    case 'IN_WORK': return 'In work';
    case 'WAITING_APPROVAL': return 'Waiting for approval';
    case 'COMPLETED': return 'Completed';
    case 'FORWARDED': return 'Moved forward';
    case 'RETURNED': return 'Returned';
    case 'RECALLED': return 'Recalled';
    default: return 'Cancelled';
  }
}

function Reconcile({ m }: { m: MovementRow }) {
  if (m.sent_qty === null) return <span className="muted">No quantity lines</span>;
  const u = m.uom ? ` ${m.uom}` : '';
  return (
    <div className="mv-recon">
      <span>Sent {num(m.sent_qty)}{u}</span>
      <span>Received {num(m.received_qty)}</span>
      <span className={m.short_qty ? 'rag rag-red' : ''}>Short {num(m.short_qty)}</span>
    </div>
  );
}

const Route = ({ m }: { m: MovementRow }) => (
  <>
    {m.from_department} → {m.to_department}
    {m.from_location || m.to_location ? <div className="muted">{`${m.from_location ?? '—'} → ${m.to_location ?? '—'}`}</div> : null}
  </>
);

function Cells({ page, m }: { page: MovementPageId; m: MovementRow }) {
  const head = (
    <td>
      <b>{m.number}</b>
      <div className="muted">{m.doc_no ?? m.doc_type}</div>
    </td>
  );
  const part = (
    <td>
      {m.part ?? m.doc_no ?? m.doc_type}
      {m.batch ? <div className="muted">{m.batch}</div> : null}
    </td>
  );
  const receipt = (
    <td>
      {receiptText(m)}
      <div className="muted">{m.received_by ? `Received by ${m.received_by}` : m.sent_by ? `Sent by ${m.sent_by}` : ''}</div>
      {m.return_reason ? <div className="muted">Returned: {m.return_reason}</div> : null}
    </td>
  );
  if (page === 'maint-part-movement') {
    return (
      <>
        {head}
        {part}
        <td><Route m={m} /></td>
        <td>{m.route_type}<div className="muted">{m.work_status}</div></td>
        <td>{m.sent_qty === null ? '—' : `${num(m.sent_qty)}${m.uom ? ` ${m.uom}` : ''}`}</td>
        {receipt}
        <td>
          Sent {when(m.sent_at)}
          <div className="muted">{m.required_by ? `Required by ${m.required_by}` : ''}</div>
          <div className="muted">{m.received_at ? `Received ${when(m.received_at)}` : ''}</div>
        </td>
      </>
    );
  }
  if (page === 'plant-process-movement') {
    return (
      <>
        {head}
        {part}
        <td><Route m={m} /></td>
        <td>{m.assigned_manager ?? '—'}</td>
        <td><Reconcile m={m} /></td>
        {receipt}
      </>
    );
  }
  if (page === 'plant-department-movement') {
    return (
      <>
        {head}
        <td>
          {m.part ?? m.doc_no ?? m.doc_type}
          <div className="muted">{m.sent_qty === null ? '' : `${num(m.sent_qty)}${m.uom ? ` ${m.uom}` : ''}`}</div>
        </td>
        <td><Route m={m} /></td>
        <td>
          {m.route_type}
          <div className={m.priority === 'Normal' ? 'muted' : 'rag rag-amber'}>{m.priority}</div>
          <div className={m.is_late ? 'rag rag-red' : 'muted'}>{m.sla_due_at ? `${m.is_late ? 'Late · ' : 'Due '}${when(m.sla_due_at)}` : ''}</div>
        </td>
        <td>
          {m.assigned_manager ?? '—'}
          <div className="muted">{m.accepted_by ? `Accepted by ${m.accepted_by}` : 'Not accepted yet'}</div>
        </td>
        {receipt}
      </>
    );
  }
  return (
    <>
      <td>
        <b>{m.number}</b>
        <div className="muted">{m.part ?? m.doc_no ?? m.doc_type}</div>
        {m.batch ? <div className="muted">{m.batch}</div> : null}
      </td>
      <td>{`${m.from_plant} → ${m.to_plant ?? m.from_plant}`}<div className="muted">{m.from_plant_name}{m.to_plant_name ? ` → ${m.to_plant_name}` : ''}</div></td>
      <td>
        {m.from_department} → {m.to_department}
        <div className="muted">{`${m.from_location ?? '—'} → ${m.to_location ?? '—'}`}</div>
      </td>
      <td>
        {m.transfer_note_no ?? '—'}
        <div className="muted">{m.vehicle_person ?? ''}</div>
      </td>
      <td><Reconcile m={m} /></td>
      <td>
        {receiptText(m)}
        <div className="muted">{m.transfer_receipt_status ? `Transfer note: ${m.transfer_receipt_status}` : ''}</div>
        <div className="muted">{m.received_at ? `Received ${when(m.received_at)}` : `Sent ${when(m.sent_at)}`}</div>
      </td>
    </>
  );
}

/** Receive dialog: a plant-to-plant movement needs the received quantity per line and a reason for any short quantity. */
function ReceiveDialog({ m, onClose, onDone }: { m: MovementRow; onClose: () => void; onDone: () => void }) {
  const [lines, setLines] = useState<MovementLine[] | null>(null);
  const [qty, setQty] = useState<Record<number, string>>({});
  const [reason, setReason] = useState<Record<number, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void movementApi.lines(m.id).then(
      (l) => {
        setLines(l);
        setQty(Object.fromEntries(l.map((x) => [x.line_no, String(x.qty)])));
      },
      () => setError('Could not load the lines.'),
    );
  }, [m.id]);

  async function submit(): Promise<void> {
    if (!lines) return;
    setError('');
    const body = lines.map((l) => ({
      lineNo: l.line_no,
      receivedQty: Number(qty[l.line_no] ?? l.qty),
      ...((reason[l.line_no] ?? '').trim() ? { shortReason: (reason[l.line_no] ?? '').trim() } : {}),
    }));
    for (const [i, b] of body.entries()) {
      const sent = lines[i]?.qty ?? 0;
      if (Number.isNaN(b.receivedQty) || b.receivedQty < 0 || b.receivedQty > sent) return setError(`Line ${b.lineNo}: received quantity must be between 0 and ${sent}.`);
      if (b.receivedQty < sent && !b.shortReason) return setError(`Line ${b.lineNo}: enter a reason for the short quantity (${sent - b.receivedQty}).`);
    }
    setBusy(true);
    try {
      await workApi.act(m.id, 'receive', { lines: body });
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not receive it.');
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Receive goods"
      sub={m.number}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn primary" disabled={busy || !lines} onClick={() => void submit()}>Receive</button>
        </>
      }
    >
      {error ? <p role="alert" className="error-text">{error}</p> : null}
      {lines && lines.length === 0 ? <p className="muted">This movement has no quantity lines. Receive without quantities.</p> : null}
      {(lines ?? []).map((l) => (
        <div key={l.line_no} className="mv-line">
          <b>{l.description ?? `Line ${l.line_no}`}</b>
          <span className="muted">Sent {l.qty}{l.uom ? ` ${l.uom}` : ''}</span>
          <label htmlFor={`rq-${l.line_no}`}>{`Received quantity, line ${l.line_no}`}</label>
          <input id={`rq-${l.line_no}`} inputMode="decimal" value={qty[l.line_no] ?? ''} onChange={(e) => setQty((c) => ({ ...c, [l.line_no]: e.target.value }))} />
          <label htmlFor={`rr-${l.line_no}`}>{`Short reason, line ${l.line_no}`}</label>
          <input id={`rr-${l.line_no}`} maxLength={300} value={reason[l.line_no] ?? ''} onChange={(e) => setReason((c) => ({ ...c, [l.line_no]: e.target.value }))} />
        </div>
      ))}
      <p className="hint">A short quantity stays in transit with the reason recorded; it is not added to the destination stock.</p>
    </Modal>
  );
}

/** + Add Movement: pick a real record, the receiving department (and plant + one line for a plant-to-plant move). */
function AddDialog({ page, onClose, onDone }: { page: MovementPageId; onClose: () => void; onDone: () => void }) {
  const cfg = CONFIG[page];
  const interplant = cfg.kind === 'interplant';
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [docType, setDocType] = useState('');
  const [records, setRecords] = useState<CatalogRecord[]>([]);
  const [recordId, setRecordId] = useState('');
  const [depts, setDepts] = useState<Dept[]>([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [plants, setPlants] = useState<{ id: string; code: string; name: string }[]>([]);
  const [toUnit, setToUnit] = useState('');
  const [priority, setPriority] = useState('Normal');
  const [note, setNote] = useState('');
  const [desc, setDesc] = useState('');
  const [qty, setQty] = useState('');
  const [uom, setUom] = useState('Nos');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void workApi.departments().then(setDepts, () => setDepts([]));
    void docsMailApi.catalog().then((c) => {
      const list = cfg.kind === 'maintenance' ? c.filter((x) => MAINTENANCE_PAGE_IDS.includes(x.pageId)) : c;
      setCatalog(list);
      if (list[0]) setDocType(list[0].pageId);
    }, () => setCatalog([]));
    if (interplant) void api<{ allowed: { id: string; code: string; name: string }[] }>('/me/plants').then((p) => setPlants(p.allowed), () => setPlants([]));
  }, [cfg.kind, interplant]);

  useEffect(() => {
    if (!docType) return;
    setRecordId('');
    void docsMailApi.records(docType, '').then((r) => {
      setRecords(r);
      if (r[0]) setRecordId(r[0].id);
    }, () => setRecords([]));
  }, [docType]);

  async function submit(): Promise<void> {
    setError('');
    const rec = records.find((r) => r.id === recordId);
    if (!rec) return setError('Choose the record that moves.');
    if (!to) return setError('Choose the receiving department.');
    if (interplant) {
      if (!toUnit) return setError('Choose the destination plant.');
      if (!(Number(qty) > 0)) return setError('Enter the quantity you are sending.');
    }
    setBusy(true);
    try {
      await workApi.forward({
        docType,
        docId: recordId,
        docNo: rec.number,
        toDepartmentId: to,
        ...(from ? { fromDepartmentId: from } : {}),
        routeType: cfg.routeType,
        priority,
        handoverNote: note.trim() || null,
        ...(interplant ? { toUnitId: toUnit, isPhysical: true, lines: [{ description: desc.trim() || rec.number, qty: Number(qty), uom: uom.trim() || 'Nos' }] } : {}),
      } as Parameters<typeof workApi.forward>[0] & { fromDepartmentId?: string });
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not add the movement.');
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Add Movement"
      sub={cfg.title}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn primary" disabled={busy || !recordId || !to} onClick={() => void submit()}>Add Movement</button>
        </>
      }
    >
      {error ? <p role="alert" className="error-text">{error}</p> : null}
      <div className="field">
        <label htmlFor="am-type">Record type</label>
        <select id="am-type" value={docType} onChange={(e) => setDocType(e.target.value)}>
          {catalog.map((c) => <option key={c.pageId} value={c.pageId}>{c.title}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="am-rec">Record</label>
        <select id="am-rec" value={recordId} onChange={(e) => setRecordId(e.target.value)}>
          {records.length === 0 ? <option value="">No records of this type</option> : null}
          {records.map((r) => <option key={r.id} value={r.id}>{r.number}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="am-from">From department (Owner / Admin only)</label>
        <select id="am-from" value={from} onChange={(e) => setFrom(e.target.value)}>
          <option value="">My department</option>
          {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="am-to">To department *</label>
        <select id="am-to" value={to} onChange={(e) => setTo(e.target.value)}>
          <option value="">Choose a department</option>
          {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </div>
      {interplant ? (
        <>
          <div className="field">
            <label htmlFor="am-plant">To plant *</label>
            <select id="am-plant" value={toUnit} onChange={(e) => setToUnit(e.target.value)}>
              <option value="">Choose a plant</option>
              {plants.map((p) => <option key={p.id} value={p.id}>{`${p.code} · ${p.name}`}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="am-desc">Item description</label>
            <input id="am-desc" maxLength={200} value={desc} onChange={(e) => setDesc(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="am-qty">Quantity sent *</label>
            <input id="am-qty" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="am-uom">Unit</label>
            <input id="am-uom" maxLength={20} value={uom} onChange={(e) => setUom(e.target.value)} />
          </div>
        </>
      ) : null}
      <div className="field">
        <label htmlFor="am-prio">Priority</label>
        <select id="am-prio" value={priority} onChange={(e) => setPriority(e.target.value)}>
          {['Normal', 'High', 'Critical'].map((p) => <option key={p}>{p}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="am-note">Short handover note</label>
        <textarea id="am-note" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
    </Modal>
  );
}

export function MovementRegisterPage({ pageId }: { pageId: MovementPageId }) {
  const cfg = CONFIG[pageId];
  const toast = useToast();
  const [view, setView] = useState<Tab['view']>(cfg.tabs[0]?.view ?? 'all');
  const [dept, setDept] = useState('');
  const [q, setQ] = useState('');
  const [depts, setDepts] = useState<Dept[]>([]);
  const [rows, setRows] = useState<MovementRow[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [counts, setCounts] = useState<MovementCounts | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  const [adding, setAdding] = useState(false);
  const [receiving, setReceiving] = useState<MovementRow | null>(null);
  const [returning, setReturning] = useState<MovementRow | null>(null);
  const [history, setHistory] = useState<MovementRow | null>(null);
  const [forwarding, setForwarding] = useState<MovementRow | null>(null);

  useEffect(() => {
    setView(CONFIG[pageId].tabs[0]?.view ?? 'all');
  }, [pageId]);

  useEffect(() => {
    void workApi.departments().then(setDepts, () => setDepts([]));
  }, []);

  useEffect(() => {
    let alive = true;
    void movementApi.counts({ dept: dept || undefined }).then((c) => alive && setCounts(c), () => alive && setCounts(null));
    return () => {
      alive = false;
    };
  }, [dept, tick]);

  useEffect(() => {
    let alive = true;
    setBusy(true);
    const fail = (e: unknown): void => {
      if (!alive) return;
      setError(e instanceof ApiError ? e.message : 'Could not load the movements.');
      setBusy(false);
    };
    if (view === 'audit') {
      movementApi.audit(cfg.kind, dept || undefined).then((r) => {
        if (!alive) return;
        setAudit(r);
        setError('');
        setBusy(false);
      }, fail);
    } else {
      movementApi.list({ kind: cfg.kind, view, dept: dept || undefined, q: q.trim() || undefined }).then((r) => {
        if (!alive) return;
        setRows(r.rows);
        setCursor(r.nextCursor);
        setMore(r.hasMore);
        setError('');
        setBusy(false);
      }, fail);
    }
    return () => {
      alive = false;
    };
  }, [cfg.kind, view, dept, q, tick]);

  const loadMore = useCallback(async () => {
    if (!cursor || view === 'audit') return;
    const r = await movementApi.list({ kind: cfg.kind, view, dept: dept || undefined, q: q.trim() || undefined, cursor });
    setRows((cur) => [...cur, ...r.rows]);
    setCursor(r.nextCursor);
    setMore(r.hasMore);
  }, [cursor, cfg.kind, view, dept, q]);

  const refresh = (): void => setTick((t) => t + 1);

  async function act(m: MovementRow, action: 'receive' | 'accept' | 'recall' | 'complete'): Promise<void> {
    try {
      await workApi.act(m.id, action);
      toast(action === 'receive' ? 'Marked Received.' : action === 'accept' ? 'Accepted.' : action === 'recall' ? 'Recalled.' : 'Completed.');
      refresh();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'That did not work.');
    }
  }

  const physical = (m: MovementRow): boolean => m.is_physical || (m.to_unit_id !== null && m.to_unit_id !== m.unit_id);
  const colSpan = cfg.columns.length;

  return (
    <div className="dash-page mv-page">
      <div className="page-head">
        <div>
          <h1>{cfg.title}</h1>
          <p className="muted">{cfg.intro}</p>
        </div>
        <div className="actions">
          <button type="button" className="btn" disabled title="Email of this register is not available yet.">Send Email</button>
          <button type="button" className="btn" disabled title={NO_WORD}>Word</button>
          <button type="button" className="btn" onClick={() => window.print()}>PDF</button>
          <Link className="btn" to="/m/my-approvals">My Approvals</Link>
          <button type="button" className="btn primary" onClick={() => setAdding(true)}>+ Add Movement</button>
        </div>
      </div>

      <div className="mv-kinds" role="navigation" aria-label="Movement types">
        {KIND_BUTTONS.map((k) => (
          <Link key={k.id} to={`/m/${k.id}`} className={`btn${k.id === pageId ? ' primary' : ''}`} aria-current={k.id === pageId ? 'page' : undefined}>
            {`${k.label} (${counts ? counts[k.kind] : '…'})`}
          </Link>
        ))}
      </div>

      <div className="card work-note">{cfg.rule}</div>

      <div className="card mv-filter">
        <label htmlFor="mv-dept">Department Filter</label>
        <select id="mv-dept" value={dept} onChange={(e) => setDept(e.target.value)}>
          <option value="">All Departments</option>
          {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <label htmlFor="mv-q">Search movement or document number</label>
        <input id="mv-q" value={q} maxLength={60} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div role="tablist" className="tabs-row">
        {cfg.tabs.map((t) => (
          <button key={t.label} type="button" role="tab" aria-selected={view === t.view} className={`btn${view === t.view ? ' primary' : ''}`} onClick={() => setView(t.view)}>
            {t.label}
          </button>
        ))}
      </div>
      {error ? <p role="alert">{error}</p> : null}

      <div className="table-wrap">
        {view === 'audit' ? (
          <table className="register-table">
            <thead>
              <tr><th>When</th><th>Movement</th><th>Document</th><th>Event</th><th>Department</th><th>By</th><th>Note</th></tr>
            </thead>
            <tbody>
              {audit.map((a, i) => (
                <tr key={`${a.number}-${a.at}-${i}`}>
                  <td>{when(a.at)}</td>
                  <td>{a.number}</td>
                  <td>{a.doc_no ?? a.doc_type}</td>
                  <td>{a.event}{a.from_state || a.to_state ? <div className="muted">{`${a.from_state ?? '—'} → ${a.to_state ?? '—'}`}</div> : null}</td>
                  <td>{a.department ?? '—'}</td>
                  <td>{a.actor ?? '—'}</td>
                  <td>{a.note ?? ''}</td>
                </tr>
              ))}
              {!busy && audit.length === 0 ? <tr><td colSpan={7}>No audit events for these movements.</td></tr> : null}
            </tbody>
          </table>
        ) : (
          <table className="register-table">
            <thead>
              <tr>{cfg.columns.map((c) => <th key={c}>{c}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id}>
                  <Cells page={pageId} m={m} />
                  <td className="row-actions">
                    <button type="button" className="btn" disabled title={NO_APPROVAL}>Send for Approval</button>
                    <Link className="btn" to={`/m/${m.doc_type}`}>Edit</Link>
                    {m.state === 'SENT' ? (
                      <>
                        <button type="button" className="btn primary" onClick={() => (physical(m) ? setReceiving(m) : void act(m, 'receive'))}>Received</button>
                        <button type="button" className="btn" onClick={() => void act(m, 'recall')}>Recall</button>
                      </>
                    ) : null}
                    {m.state === 'RECEIVED' ? (
                      <>
                        <button type="button" className="btn primary" onClick={() => void act(m, 'accept')}>Accepted</button>
                        <button type="button" className="btn" onClick={() => setReturning(m)}>Return</button>
                      </>
                    ) : null}
                    <button type="button" className="btn" onClick={() => setHistory(m)}>360° Track</button>
                    {m.state === 'ACCEPTED' || m.state === 'IN_WORK' ? (
                      <>
                        <button type="button" className="btn primary" onClick={() => setForwarding(m)}>Move Forward</button>
                        <button type="button" className="btn" onClick={() => void act(m, 'complete')}>Complete</button>
                      </>
                    ) : null}
                  </td>
                </tr>
              ))}
              {!busy && rows.length === 0 ? <tr><td colSpan={colSpan}>No movements in this view.</td></tr> : null}
            </tbody>
          </table>
        )}
      </div>
      {more && view !== 'audit' ? <button type="button" className="btn" onClick={() => void loadMore()}>Load more</button> : null}

      {adding ? <AddDialog page={pageId} onClose={() => setAdding(false)} onDone={() => { setAdding(false); toast('Movement added.'); refresh(); }} /> : null}
      {receiving ? <ReceiveDialog m={receiving} onClose={() => setReceiving(null)} onDone={() => { setReceiving(null); toast('Marked Received.'); refresh(); }} /> : null}
      {returning ? (
        <ReturnDialog
          onClose={() => setReturning(null)}
          onConfirm={async (reason) => {
            await workApi.act(returning.id, 'return', { reason });
            setReturning(null);
            toast('Returned to the sender.');
            refresh();
          }}
        />
      ) : null}
      {history ? <HistoryDrawer docType={history.doc_type} docId={history.doc_id} title={history.doc_no ?? history.number} onClose={() => setHistory(null)} /> : null}
      {forwarding ? (
        <MoveForwardDialog
          docType={forwarding.doc_type}
          docId={forwarding.doc_id}
          docNo={forwarding.doc_no ?? undefined}
          fromDepartment={forwarding.to_department}
          onClose={() => setForwarding(null)}
          onMoved={() => { setForwarding(null); refresh(); }}
        />
      ) : null}
    </div>
  );
}

export const MaintPartMovementPage = () => <MovementRegisterPage pageId="maint-part-movement" />;
export const ProcessMovementPage = () => <MovementRegisterPage pageId="plant-process-movement" />;
export const DepartmentMovementPage = () => <MovementRegisterPage pageId="plant-department-movement" />;
export const InterplantMovementPage = () => <MovementRegisterPage pageId="plant-interplant-movement" />;
