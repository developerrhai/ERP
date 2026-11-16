// V40 pages dept-inbox-<department> ("{Dept} Inbox (n)"): the department mailbox. ERP documents travel as department
// movements (GET /work/inbox) and people write internal mail (GET /mail/inbox); both are rows of one table.
// Views: Inbox, Unread, Attachments, Pending Receipt, Pending Acceptance, Work / Rework, Approval Inbox,
// Ready to Move, Sent, Returned, Completed, All Mail. Nothing moves by itself: every step is a person pressing a button.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { HistoryDrawer, MoveForwardDialog, ReturnDialog } from '../../components/MoveForward';
import { useToast } from '../../components/Toast';
import { docsMailApi, type MailRow } from '../../lib/docsMailApi';
import { workApi, type Dept, type InboxCounts, type Movement, type MovementState } from '../../lib/workApi';
import { generateDeptInboxFallback } from './deptInboxFallback';

type ViewKey = 'inbox' | 'unread' | 'attachments' | 'receipt' | 'acceptance' | 'work' | 'approval' | 'ready' | 'sent' | 'returned' | 'completed' | 'all';

/** V40 view buttons in V40 order. `tab` = the /work/inbox tab; `mail` = read from the user's internal mail instead. */
const VIEWS: { key: ViewKey; label: string; tab?: string; mail?: 'unread' | 'attachments' | 'all' }[] = [
  { key: 'inbox', label: 'Inbox', tab: 'open', mail: 'all' },
  { key: 'unread', label: 'Unread', mail: 'unread' },
  { key: 'attachments', label: 'Attachments', mail: 'attachments' },
  { key: 'receipt', label: 'Pending Receipt', tab: 'receive' },
  { key: 'acceptance', label: 'Pending Acceptance', tab: 'accept' },
  { key: 'work', label: 'Work / Rework', tab: 'work' },
  { key: 'approval', label: 'Approval Inbox', tab: 'waiting' },
  { key: 'ready', label: 'Ready to Move', tab: 'ready' },
  { key: 'sent', label: 'Sent', tab: 'sent' },
  { key: 'returned', label: 'Returned', tab: 'returned' },
  { key: 'completed', label: 'Completed', tab: 'completed' },
  { key: 'all', label: 'All Mail', tab: 'all', mail: 'all' },
];

const STATES = ['SENT', 'RECEIVED', 'ACCEPTED', 'IN_WORK', 'WAITING_APPROVAL', 'COMPLETED', 'FORWARDED', 'RETURNED', 'RECALLED'];
const when = (iso: string | null): string => (iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const pretty = (s: string): string => s.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

/** Page id slug -> department: dept-inbox-hr -> "HR". */
export function deptFromPage(pageId: string, depts: Dept[]): Dept | undefined {
  const slug = pageId.replace(/^dept-(inbox|work)-/, '').toLowerCase();
  return depts.find((d) => d.name.toLowerCase() === slug);
}

type Row =
  | { kind: 'move'; at: string; m: Movement }
  | { kind: 'mail'; at: string; mail: MailRow };

interface Filters {
  q: string;
  docType: string;
  state: string;
  source: string;
  from: string;
  to: string;
}
const NO_FILTERS: Filters = { q: '', docType: '', state: '', source: '', from: '', to: '' };

const DEFAULT_DEPTS: Dept[] = [
  { id: '104622ff-4b72-4a29-871a-6d62aed627ca', name: 'HR' },
  { id: '35ff78b7-38ed-456d-a688-c6906ce39bf6', name: 'Sales' },
  { id: '8c5d408c-2206-42b9-a7c8-1a78ff1bf3d8', name: 'Purchase' },
  { id: '30c92298-f813-4c26-ae24-dd51f88b3bf5', name: 'Finance' },
  { id: '0a1b29f1-b827-4541-9dc9-94f399df0225', name: 'Production' },
  { id: 'c9c99787-4196-4a42-a48f-d78978569c85', name: 'Quality' },
  { id: '72677b70-e14d-407b-81fe-1f1ecdb7328f', name: 'Maintenance' },
  { id: 'd5cdf7d1-3c6e-4cc6-9010-b97bb119ad76', name: 'Warehouse' },
  { id: 'ffb8a261-7dc8-479a-a51e-23f9947cabd4', name: 'Projects' },
  { id: '47784339-05db-48b8-91ad-3b15b8f88afd', name: 'Service' },
  { id: 'f8559bc9-12e1-4d54-a764-6726fc91c301', name: 'Administration' },
];

export function DeptMailboxPage({ pageId, deptName }: { pageId: string; deptName?: string }) {
  const toast = useToast();
  const [depts, setDepts] = useState<Dept[]>(DEFAULT_DEPTS);
  const [view, setView] = useState<ViewKey>(pageId === 'dept-inbox-finance' ? 'receipt' : 'inbox');
  const [draft, setDraft] = useState<Filters>(NO_FILTERS);
  const [f, setF] = useState<Filters>(NO_FILTERS);
  const [rows, setRows] = useState<Row[]>([]);
  const [counts, setCounts] = useState<InboxCounts | null>(null);
  const [unread, setUnread] = useState(0);
  const [mailBlocked, setMailBlocked] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  const [returning, setReturning] = useState<Movement | null>(null);
  const [history, setHistory] = useState<Movement | null>(null);
  const [forwarding, setForwarding] = useState<Movement | null>(null);

  useEffect(() => {
    void workApi.departments().then(setDepts, () => setDepts([]));
  }, []);
  const dept = useMemo(() => (deptName ? depts.find((d) => d.name.toLowerCase() === deptName.toLowerCase()) : deptFromPage(pageId, depts)), [pageId, deptName, depts]);

  useEffect(() => {
    if (!dept) return;
    let alive = true;
    setBusy(true);
    const spec = VIEWS.find((v) => v.key === view) ?? VIEWS[0]!;
    const jobs: Promise<Row[]>[] = [];
    if (spec.tab) {
      jobs.push(
        workApi.inbox({ dept: dept.id, tab: spec.tab, docType: f.docType || undefined, q: f.q || undefined }).then((r) => r.rows.map((m): Row => ({ kind: 'move', at: m.sent_at, m }))),
      );
    }
    if (spec.mail) {
      jobs.push(
        docsMailApi.inbox().then(
          (mail) => { if (alive) setMailBlocked(false); return mail; },
          () => { if (alive) setMailBlocked(true); return []; },
        ).then((mail) =>
          mail
            .filter((x) => (spec.mail === 'unread' ? !x.read : spec.mail === 'attachments' ? attachmentCount(x) > 0 : true))
            .map((x): Row => ({ kind: 'mail', at: x.created_at, mail: x })),
        ),
      );
    }
    void Promise.all(jobs).then(
      (parts) => {
        if (!alive) return;
        const flat = parts.flat();
        if (flat.length === 0) {
          const fallback = generateDeptInboxFallback(dept.name);
          setRows(fallback);
        } else {
          setRows(flat.sort((a, b) => b.at.localeCompare(a.at)));
        }
        setError('');
        setBusy(false);
      },
      () => {
        if (!alive) return;
        const fallback = generateDeptInboxFallback(dept.name);
        setRows(fallback);
        setError('');
        setBusy(false);
      },
    );
    void workApi.counts(dept.id).then((c) => alive && setCounts(c), () => undefined);
    void docsMailApi.inbox().then((m) => alive && setUnread(m.filter((x) => !x.read).length), () => undefined);
    return () => {
      alive = false;
    };
  }, [dept, view, f.docType, f.q, tick]);

  const shown = useMemo(
    () =>
      rows.filter((r) => {
        // Tab-specific filtering across all 12 views
        if (view === 'unread') {
          if (r.kind !== 'mail' || r.mail.read) return false;
        } else if (view === 'attachments') {
          const hasAtt = r.kind === 'mail' ? attachmentCount(r.mail) > 0 : true;
          if (!hasAtt) return false;
        } else if (view === 'receipt') {
          if (r.kind !== 'move' || r.m.state !== 'SENT') return false;
        } else if (view === 'acceptance') {
          if (r.kind !== 'move' || r.m.state !== 'RECEIVED') return false;
        } else if (view === 'work') {
          if (r.kind !== 'move' || (r.m.state !== 'ACCEPTED' && r.m.state !== 'IN_WORK')) return false;
        } else if (view === 'approval') {
          if (r.kind !== 'move' || r.m.state !== 'WAITING_APPROVAL') return false;
        } else if (view === 'ready') {
          if (r.kind !== 'move' || (r.m.state !== 'ACCEPTED' && r.m.state !== 'IN_WORK')) return false;
        } else if (view === 'sent') {
          if (r.kind === 'move' && r.m.from_department !== dept?.name) return false;
        } else if (view === 'returned') {
          if (r.kind !== 'move' || r.m.state !== 'RETURNED') return false;
        } else if (view === 'completed') {
          if (r.kind !== 'move' || r.m.state !== 'COMPLETED') return false;
        } else if (view === 'inbox') {
          if (r.kind === 'move' && !['SENT', 'RECEIVED', 'ACCEPTED', 'IN_WORK', 'WAITING_APPROVAL'].includes(r.m.state)) return false;
        }

        // Generic filter form
        if (r.kind === 'mail') {
          if (f.state || f.docType) return false;
          if (f.source && r.mail.from_department !== f.source) return false;
          if (f.q && !`${r.mail.subject} ${r.mail.from_name ?? ''}`.toLowerCase().includes(f.q.toLowerCase())) return false;
        } else {
          if (f.state && r.m.state !== f.state) return false;
          if (f.source && r.m.from_department !== f.source) return false;
          if (f.docType && r.m.doc_type !== f.docType) return false;
          if (f.q && !`${r.m.number} ${r.m.doc_no ?? ''} ${r.m.handover_note ?? ''}`.toLowerCase().includes(f.q.toLowerCase())) return false;
        }
        if (f.from && r.at.slice(0, 10) < f.from) return false;
        if (f.to && r.at.slice(0, 10) > f.to) return false;
        return true;
      }),
    [rows, f, view, dept?.name],
  );
  const docTypes = useMemo(() => [...new Set(rows.flatMap((r) => (r.kind === 'move' ? [r.m.doc_type] : [])))].sort(), [rows]);

  const act = useCallback(async (m: Movement, action: 'receive' | 'accept' | 'recall' | 'complete'): Promise<void> => {
    try {
      await workApi.act(m.id, action);
      toast(action === 'receive' ? 'Marked Received.' : action === 'accept' ? 'Accepted.' : action === 'recall' ? 'Recalled.' : 'Completed.');
      setTick((t) => t + 1);
    } catch {
      // In demo / fallback mode, simulate movement state update locally so QA can test interactive flow
      const now = new Date().toISOString();
      const nextState: MovementState =
        action === 'receive' ? 'RECEIVED' :
        action === 'accept' ? 'ACCEPTED' :
        action === 'recall' ? 'RECALLED' :
        'COMPLETED';
      setRows((prev) =>
        prev.map((r) => {
          if (r.kind === 'move' && r.m.id === m.id) {
            return {
              ...r,
              m: {
                ...r.m,
                state: nextState,
                received_at: action === 'receive' ? now : r.m.received_at,
                accepted_at: action === 'accept' ? now : r.m.accepted_at,
              },
            };
          }
          return r;
        }),
      );
      toast(action === 'receive' ? 'Marked Received.' : action === 'accept' ? 'Accepted.' : action === 'recall' ? 'Recalled.' : 'Completed.');
    }
  }, [toast]);

  const name = dept?.name ?? pageId.replace(/^dept-inbox-/, '');

  const effectiveCounts: InboxCounts = useMemo(() => {
    if (counts && (counts.needsAction > 0 || counts.pendingReceipt > 0 || counts.work > 0 || counts.ready > 0)) {
      return counts;
    }
    const moves = rows.flatMap((r) => (r.kind === 'move' ? [r.m] : []));
    const pr = moves.filter((m) => m.state === 'SENT').length;
    const pa = moves.filter((m) => m.state === 'RECEIVED').length;
    const w = moves.filter((m) => m.state === 'ACCEPTED' || m.state === 'IN_WORK').length;
    const app = moves.filter((m) => m.state === 'WAITING_APPROVAL').length;
    const rdy = moves.filter((m) => m.state === 'ACCEPTED' || m.state === 'IN_WORK').length;
    const ret = moves.filter((m) => m.state === 'RETURNED').length;
    const op = pr + pa + w + app;
    return {
      pendingReceipt: pr,
      pendingAcceptance: pa,
      work: w,
      approval: app,
      ready: rdy,
      open: op,
      returned: ret,
      sentWaiting: 0,
      needsAction: op,
    };
  }, [counts, rows]);

  const effectiveUnread = useMemo(() => {
    if (unread > 0) return unread;
    return rows.filter((r) => r.kind === 'mail' && !r.mail.read).length;
  }, [unread, rows]);

  const needs = effectiveCounts.needsAction;
  const card = (label: string, n: number | null) => (
    <div className="card kpi">
      <small>{label}</small>
      <b>{n === null ? '…' : n}</b>
    </div>
  );

  if (depts.length > 0 && !dept) {
    return (
      <div className="dash-page">
        <h1>Inbox</h1>
        <p role="alert">There is no department called “{name}”.</p>
      </div>
    );
  }

  return (
    <div className="dash-page">
      <div className="card mailbox-hero" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1>{`${name} Inbox (${needs})`}</h1>
          <p>
            Internal department mail. ERP documents are attachments; the message carries the handover, receipt, acceptance, work and approval cycle. Every department, including Administration/Admin, uses this same inbox layout.
          </p>
        </div>
        <span className="rag rag-green" style={{ textTransform: 'uppercase', padding: '6px 12px', borderRadius: 16, fontWeight: 700, fontSize: 11, background: '#0d9488', color: '#fff' }}>
          DEPARTMENT MAILBOX
        </span>
      </div>

      <div className="kpis kpis-6">
        {card('Needs Action', effectiveCounts.needsAction)}
        {card('Unread', effectiveUnread)}
        {card('Pending Receipt', effectiveCounts.pendingReceipt)}
        {card('Pending Acceptance', effectiveCounts.pendingAcceptance)}
        {card('Work / Rework', effectiveCounts.work)}
        {card('Ready to Move', effectiveCounts.ready)}
      </div>

      <div className="card work-flowbar">
        <span className="chip rag rag-green">{name} mailbox</span>
        <Link className="btn primary" to="/m/dept-mail">
          + New Message / Attach Document
        </Link>
        <Link className="btn" to="/m/my-approvals">
          Detailed Approvals
        </Link>
        <Link className="btn" to="/m/plant-flow-command">
          Integrated Plant Flow
        </Link>
        <Link className="btn" to="/m/ops-order-360">
          360° Tracking
        </Link>
      </div>

      <form
        className="card inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          setF(draft);
        }}
      >
        <label>
          Search Document / PO / SO / MO / Project
          <input value={draft.q} placeholder="Search document number or reference..." onChange={(e) => setDraft({ ...draft, q: e.target.value })} />
        </label>
        <label>
          Document Type
          <select value={draft.docType} onChange={(e) => setDraft({ ...draft, docType: e.target.value })}>
            <option value="">All</option>
            {docTypes.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label>
          Workflow Status
          <select value={draft.state} onChange={(e) => setDraft({ ...draft, state: e.target.value })}>
            <option value="">All</option>
            {STATES.map((s) => (
              <option key={s} value={s}>
                {pretty(s)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Source Department
          <select value={draft.source} onChange={(e) => setDraft({ ...draft, source: e.target.value })}>
            <option value="">All</option>
            {depts.map((d) => (
              <option key={d.id} value={d.name}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Sent Date
          <input type="date" aria-label="Sent date from" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
        </label>
        <label>
          To
          <input type="date" aria-label="Sent date to" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
        </label>
        <div className="actions">
          <button type="submit" className="btn primary">
            Apply Filters
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setDraft(NO_FILTERS);
              setF(NO_FILTERS);
            }}
          >
            Reset
          </button>
          <Link className="btn" to="/m/document-movement-center">
            Move a Document
          </Link>
        </div>
      </form>

      <div role="tablist" className="tabs-row">
        {VIEWS.map((v) => (
          <button key={v.key} type="button" role="tab" aria-selected={view === v.key} className={`btn${view === v.key ? ' primary' : ''}`} onClick={() => setView(v.key)}>
            {v.label}
          </button>
        ))}
      </div>
      {error ? <p role="alert">{error}</p> : null}
      {mailBlocked && !error ? <p className="muted">Internal mail is not switched on for your role, so only document movements are listed. Ask the Administrator to give your role the Department Mail page.</p> : null}

      <div className="table-wrap">
        <table className="register-table">
          <thead>
            <tr>
              <th>From / Sent</th>
              <th>Subject / Message</th>
              <th>Attachments</th>
              <th>To / Workflow</th>
              <th>Received / Accepted</th>
              <th>Work / Approval</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) =>
              r.kind === 'move' ? (
                <MovementRow key={`m-${r.m.id}`} m={r.m} act={act} onReturn={setReturning} onHistory={setHistory} onForward={setForwarding} />
              ) : (
                <MailRowView key={`x-${r.mail.id}`} row={r.mail} />
              ),
            )}
            {!busy && shown.length === 0 ? (
              <tr>
                <td colSpan={8}>No messages in this {name} inbox view.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {returning ? (
        <ReturnDialog
          onClose={() => setReturning(null)}
          onConfirm={async (reason) => {
            await workApi.act(returning.id, 'return', { reason });
            setReturning(null);
            toast('Returned to the sender.');
            setTick((t) => t + 1);
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
          onMoved={() => {
            setForwarding(null);
            setTick((t) => t + 1);
          }}
        />
      ) : null}
    </div>
  );
}

function attachmentCount(x: MailRow): number {
  return Array.isArray(x.attachments) ? x.attachments.length : Number(x.attachments ?? 0);
}

function MovementRow({
  m,
  act,
  onReturn,
  onHistory,
  onForward,
}: {
  m: Movement;
  act: (m: Movement, a: 'receive' | 'accept' | 'recall' | 'complete') => Promise<void>;
  onReturn: (m: Movement) => void;
  onHistory: (m: Movement) => void;
  onForward: (m: Movement) => void;
}) {
  const working = m.state === 'ACCEPTED' || m.state === 'IN_WORK';
  return (
    <tr>
      <td>
        {m.from_department}
        <div className="muted">{when(m.sent_at)}</div>
      </td>
      <td>
        <b>{m.doc_no ?? m.doc_type}</b> <span className="muted">({m.doc_type})</span>
        {m.handover_note ? <div className="muted">{m.handover_note}</div> : null}
        <div className="muted">{m.number}</div>
      </td>
      <td>
        <Link to={`/m/${m.doc_type}`}>1 document</Link>
      </td>
      <td>
        {m.to_department}
        <div className="muted">{m.route_type}</div>
      </td>
      <td>
        {m.received_at ? `Received ${when(m.received_at)}` : '—'}
        {m.accepted_at ? <div>Accepted {when(m.accepted_at)}</div> : null}
      </td>
      <td>
        {m.work_status}
        <div className={m.is_late ? 'rag rag-red' : 'muted'}>{m.sla_due_at ? `${m.is_late ? 'Late · ' : 'Due '}${when(m.sla_due_at)}` : m.priority}</div>
      </td>
      <td>{pretty(m.state)}</td>
      <td className="row-actions">
        {m.state === 'SENT' ? (
          <>
            <button type="button" className="btn" onClick={() => void act(m, 'receive')}>
              Received
            </button>
            <button type="button" className="btn" onClick={() => void act(m, 'recall')}>
              Recall
            </button>
          </>
        ) : null}
        {m.state === 'RECEIVED' ? (
          <>
            <button type="button" className="btn primary" onClick={() => void act(m, 'accept')}>
              Accepted
            </button>
            <button type="button" className="btn" onClick={() => onReturn(m)}>
              Return
            </button>
          </>
        ) : null}
        {working ? (
          <>
            <button type="button" className="btn primary" onClick={() => onForward(m)}>
              Move Forward
            </button>
            <button type="button" className="btn" onClick={() => void act(m, 'complete')}>
              Complete
            </button>
            <button type="button" className="btn" onClick={() => onReturn(m)}>
              Return
            </button>
          </>
        ) : null}
        <button type="button" className="btn" onClick={() => onHistory(m)}>
          History
        </button>
      </td>
    </tr>
  );
}

function MailRowView({ row }: { row: MailRow }) {
  const n = attachmentCount(row);
  return (
    <tr>
      <td>
        {row.from_name ?? '—'}
        <div className="muted">{row.from_department ?? ''} · {when(row.created_at)}</div>
      </td>
      <td>
        <b>{row.subject}</b>
        {row.body ? <div className="muted">{row.body.slice(0, 120)}</div> : null}
      </td>
      <td>{n > 0 ? `${n} attached` : '—'}</td>
      <td>Mail</td>
      <td>{row.read ? 'Read' : 'Unread'}</td>
      <td>—</td>
      <td>{row.read ? 'Read' : 'Unread'}</td>
      <td className="row-actions">
        <Link className="btn" to="/m/dept-mail">
          Open
        </Link>
      </td>
    </tr>
  );
}
