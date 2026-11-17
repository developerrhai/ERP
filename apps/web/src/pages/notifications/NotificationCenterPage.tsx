// Notification Center (page `notifications`): chips All / Unread / Approvals / System, "Mark all
// read", the real list, and the Preferences tab (type × In-app, Email Off / Instant / Daily digest).
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ErrorMessage } from '../../components/ErrorMessage';
import { Pager } from '../../components/Pager';
import { useToast } from '../../components/Toast';
import {
  BELL_REFRESH_EVENT,
  getNotificationPreferences,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  markNotificationUnread,
  saveNotificationPreferences,
  type NotificationItem,
  type NotificationPreference,
} from '../../lib/approvalsApi';
import { toUiError } from '../../lib/errors';
import { formatDateTime } from '../../lib/format';
import { useLoad } from '../../lib/useLoad';

export function NotificationCenterPage() {
  const [tab, setTab] = useState<'list' | 'prefs'>('list');
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Notification Center</h1>
          <p>Live ERP alerts with search, filters, read state and direct record links.</p>
        </div>
        <div className="actions">
          <button className="btn" type="button" onClick={() => window.history.back()} title="Return">← Return</button>
          <button className="btn" type="button" onClick={() => void markAllNotificationsRead().then(() => { window.dispatchEvent(new Event(BELL_REFRESH_EVENT)); })}>Mark All Read</button>
          <button className="btn" type="button" onClick={() => alert('Import records')} title="Import">⇧ Import</button>
          <button className="btn" type="button" onClick={() => alert('Export records')} title="Export">⇩ Export</button>
          <button className="btn" type="button" onClick={() => alert('Check duplicates')}>Duplicates</button>
          <a className="btn" href="/m/project-global-history">Project History</a>
        </div>
      </div>
      <div className="tabs" role="tablist" aria-label="Notification views">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'list'}
          className={tab === 'list' ? 'tab active' : 'tab'}
          onClick={() => setTab('list')}
        >
          Notifications
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'prefs'}
          className={tab === 'prefs' ? 'tab active' : 'tab'}
          onClick={() => setTab('prefs')}
        >
          Preferences
        </button>
      </div>
      {tab === 'list' ? <NotificationList /> : <Preferences />}
    </>
  );
}

const SEV_LABEL: Record<NotificationItem['severity'], string> = { INFO: 'Info', ACTION: 'Action', WARN: 'Warning' };
const SEV_ICON: Record<NotificationItem['severity'], string> = { INFO: 'ℹ️', ACTION: '✅', WARN: '⚠️' };

/** V40 Notification Center: four KPI cards, search + severity + read-state filters, one row per alert with Open and Read / Unread. */
function NotificationList() {
  const navigate = useNavigate();
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [sev, setSev] = useState('');
  const [mode, setMode] = useState('');
  const load = useLoad(() => listNotifications({ page, size: 50 }), [page]);
  const all = load.data?.rows ?? [];
  const rows = all.filter(
    (n) =>
      (!q || `${n.title} ${n.body}`.toLowerCase().includes(q.toLowerCase())) &&
      (!sev || n.severity === sev) &&
      (!mode || (mode === 'Unread' ? !n.readAt : !!n.readAt)),
  );
  const total = load.data?.meta.total ?? 0;
  const unread = load.data?.unread ?? 0;
  const critical = all.filter((n) => !n.readAt && n.severity === 'WARN').length;
  const linked = all.filter((n) => !!n.link).length;

  const open = async (n: NotificationItem): Promise<void> => {
    if (!n.readAt) {
      await markNotificationRead(n.id).catch(() => undefined);
      window.dispatchEvent(new Event(BELL_REFRESH_EVENT));
    }
    if (n.link) navigate(n.link);
    else load.reload();
  };
  const toggle = async (n: NotificationItem): Promise<void> => {
    try {
      if (n.readAt) await markNotificationUnread(n.id);
      else await markNotificationRead(n.id);
      window.dispatchEvent(new Event(BELL_REFRESH_EVENT));
      load.reload();
    } catch {
      toast('Could not change the read state.');
    }
  };
  const markAll = async (): Promise<void> => {
    try {
      await markAllNotificationsRead();
      window.dispatchEvent(new Event(BELL_REFRESH_EVENT));
      toast('All notifications marked as read.');
      load.reload();
    } catch {
      toast('Could not mark all as read.');
    }
  };

  return (
    <>
      <div className="actions" style={{ marginBottom: 10 }}>
        <button type="button" className="btn" disabled={!load.data || unread === 0} onClick={() => void markAll()}>
          Mark All Read
        </button>
      </div>
      <div className="kpis">
        <div className="card kpi"><small>Total</small><b>{total}</b><small>Generated alerts</small></div>
        <div className="card kpi"><small>Unread</small><b>{unread}</b><small>Needs review</small></div>
        <div className="card kpi"><small>Critical</small><b>{critical}</b><small>Immediate</small></div>
        <div className="card kpi"><small>Linked Records</small><b>{linked}</b><small>Direct navigation</small></div>
      </div>
      {load.error ? <ErrorMessage onReload={load.reload}>{load.error}</ErrorMessage> : null}
      <div className="card panel">
        <div className="toolbar" style={{ padding: 0, border: 0, marginBottom: 10 }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search notifications..." aria-label="Search notifications" />
          <select value={sev} onChange={(e) => setSev(e.target.value)} aria-label="Severity">
            <option value="">All Severity</option>
            <option value="WARN">Warning</option>
            <option value="ACTION">Action</option>
            <option value="INFO">Info</option>
          </select>
          <select value={mode} onChange={(e) => setMode(e.target.value)} aria-label="Read state">
            <option value="">Read + Unread</option>
            <option>Unread</option>
            <option>Read</option>
          </select>
        </div>
        <ul className="notif-list page">
          {rows.map((n) => (
            <li key={n.id} className={n.readAt ? 'notif read' : 'notif unread'}>
              <span aria-hidden="true" style={{ fontSize: 20 }}>{SEV_ICON[n.severity]}</span>
              <div className="notif-item" style={{ flex: 1 }}>
                <b>{n.title}</b>
                {n.body ? <span className="v8-sub">{n.body}</span> : null}
                <span className="v8-sub">{formatDateTime(n.createdAt)}</span>
              </div>
              <span className={`status ${n.severity === 'WARN' ? 'overdue' : n.severity === 'ACTION' ? 'pending' : 'active'}`}>{SEV_LABEL[n.severity]}</span>
              <button type="button" className="btn sm" onClick={() => void open(n)}>
                Open
              </button>
              <button type="button" className="btn sm" onClick={() => void toggle(n)}>
                {n.readAt ? 'Unread' : 'Read'}
              </button>
            </li>
          ))}
          {load.loading && !load.data ? <li className="v8-sub">Loading…</li> : null}
          {load.data && rows.length === 0 ? <li className="v8-sub">No notifications match the current filters.</li> : null}
        </ul>
      </div>
      {load.data ? <Pager page={load.data.meta.page} size={load.data.meta.size} total={load.data.meta.total} onPage={setPage} /> : null}
    </>
  );
}

type Draft = Pick<NotificationPreference, 'type' | 'inApp' | 'email'>;

function Preferences() {
  const toast = useToast();
  const load = useLoad(getNotificationPreferences, []);
  const [draft, setDraft] = useState<Draft[]>([]);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (load.data)
      setDraft(load.data.map((p) => ({ type: p.type, inApp: p.inApp, email: p.email })));
  }, [load.data]);

  const set = (type: string, patch: Partial<Draft>): void =>
    setDraft((d) => d.map((x) => (x.type === type ? { ...x, ...patch } : x)));

  const save = async (): Promise<void> => {
    setPending(true);
    setError('');
    try {
      load.setData(await saveNotificationPreferences(draft));
      toast('Notification preferences saved.');
    } catch (err) {
      setError(toUiError(err).message);
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      {error ? <ErrorMessage>{error}</ErrorMessage> : null}
      {load.error ? <ErrorMessage onReload={load.reload}>{load.error}</ErrorMessage> : null}
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Notification</th>
              <th scope="col">In-app</th>
              <th scope="col">Email</th>
            </tr>
          </thead>
          <tbody>
            {(load.data ?? []).map((p) => {
              const d = draft.find((x) => x.type === p.type) ?? p;
              return (
                <tr key={p.type}>
                  <td>
                    <strong>{p.label}</strong>
                    <div className="v8-sub">{p.description}</div>
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      className="v8-checkbox"
                      aria-label={`In-app: ${p.label}`}
                      checked={p.inAppLocked ? true : d.inApp}
                      disabled={p.inAppLocked}
                      title={
                        p.inAppLocked
                          ? 'Always on: you must see requests waiting for you.'
                          : undefined
                      }
                      onChange={(e) => set(p.type, { inApp: e.target.checked })}
                    />
                  </td>
                  <td>
                    <select
                      aria-label={`Email: ${p.label}`}
                      value={d.email}
                      onChange={(e) => set(p.type, { email: e.target.value as Draft['email'] })}
                    >
                      <option value="OFF">Off</option>
                      <option value="INSTANT">Instant</option>
                      <option value="DIGEST">Daily digest</option>
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="actions" style={{ marginTop: 12 }}>
        <button
          type="button"
          className="btn primary"
          disabled={pending}
          onClick={() => void save()}
        >
          {pending ? 'Saving…' : 'Save preferences'}
        </button>
      </div>
    </>
  );
}
