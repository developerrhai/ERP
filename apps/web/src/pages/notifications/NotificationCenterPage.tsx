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
  saveNotificationPreferences,
  type NotificationItem,
  type NotificationPreference,
} from '../../lib/approvalsApi';
import { toUiError } from '../../lib/errors';
import { formatDateTime } from '../../lib/format';
import { useLoad } from '../../lib/useLoad';

type Chip = 'all' | 'unread' | 'approvals' | 'system';
const CHIPS: { key: Chip; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'unread', label: 'Unread' },
  { key: 'approvals', label: 'Approvals' },
  { key: 'system', label: 'System' },
];

export function NotificationCenterPage() {
  const [tab, setTab] = useState<'list' | 'prefs'>('list');
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Notification Center</h1>
          <p>Approvals and system alerts addressed to you.</p>
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

function NotificationList() {
  const navigate = useNavigate();
  const toast = useToast();
  const [chip, setChip] = useState<Chip>('all');
  const [page, setPage] = useState(1);
  const load = useLoad(
    () =>
      listNotifications({
        page,
        ...(chip === 'unread' ? { unread: true } : {}),
        ...(chip === 'approvals' ? { group: 'Approvals' as const } : {}),
        ...(chip === 'system' ? { group: 'System' as const } : {}),
      }),
    [chip, page],
  );
  const rows = load.data?.rows ?? [];

  const open = async (n: NotificationItem): Promise<void> => {
    if (!n.readAt) {
      await markNotificationRead(n.id).catch(() => undefined);
      window.dispatchEvent(new Event(BELL_REFRESH_EVENT));
    }
    if (n.link) navigate(n.link);
    else load.reload();
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
      <div className="recordbar">
        {CHIPS.map((c) => (
          <button
            key={c.key}
            type="button"
            className={c.key === chip ? 'chip active' : 'chip'}
            aria-pressed={c.key === chip}
            onClick={() => {
              setChip(c.key);
              setPage(1);
            }}
          >
            {c.label}
            {c.key === 'unread' && load.data ? ` (${load.data.unread})` : ''}
          </button>
        ))}
        <button
          type="button"
          className="btn sm"
          style={{ marginLeft: 'auto' }}
          disabled={!load.data || load.data.unread === 0}
          onClick={() => void markAll()}
        >
          Mark all read
        </button>
      </div>
      {load.error ? <ErrorMessage onReload={load.reload}>{load.error}</ErrorMessage> : null}
      <div className="card">
        <ul className="notif-list page">
          {rows.map((n) => (
            <li key={n.id} className={n.readAt ? 'notif read' : 'notif unread'}>
              <button type="button" className="notif-item" onClick={() => void open(n)}>
                <b>{n.title}</b>
                {n.body ? <span className="v8-sub">{n.body}</span> : null}
                <span className="v8-sub">{formatDateTime(n.createdAt)}</span>
              </button>
              <span
                className={`status ${n.severity === 'WARN' ? 'overdue' : n.severity === 'ACTION' ? 'pending' : 'active'}`}
              >
                {n.severity === 'ACTION' ? 'Action' : n.severity === 'WARN' ? 'Warning' : 'Info'}
              </span>
            </li>
          ))}
          {load.loading && !load.data ? <li className="v8-sub">Loading…</li> : null}
          {load.data && rows.length === 0 ? (
            <li className="v8-sub">
              {chip === 'unread'
                ? 'Nothing unread. You are all caught up.'
                : 'No notifications yet. Approval requests and alerts will appear here.'}
            </li>
          ) : null}
        </ul>
      </div>
      {load.data ? (
        <Pager
          page={load.data.meta.page}
          size={load.data.meta.size}
          total={load.data.meta.total}
          onPage={setPage}
        />
      ) : null}
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
