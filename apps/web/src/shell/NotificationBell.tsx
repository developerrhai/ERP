// The bell in the top bar (docs/phases/PHASE-05.md §7.5): unread badge (99+ max) polled every 60 s and
// on window focus, a drawer with the latest 20 items, "Mark all read" and "View all". Clicking an
// item marks it read and opens its link. Any approval action refreshes the badge at once.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Drawer } from '../components/Drawer';
import {
  BELL_REFRESH_EVENT,
  getUnreadCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationItem,
} from '../lib/approvalsApi';
import { formatDateTime } from '../lib/format';

export const BELL_POLL_MS = 60_000;

export function badgeText(count: number): string {
  return count > 99 ? '99+' : String(count);
}

export function NotificationBell() {
  const navigate = useNavigate();
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [error, setError] = useState('');
  const alive = useRef(true);

  const refreshCount = useCallback(() => {
    getUnreadCount()
      .then((n) => alive.current && setCount(n))
      .catch(() => undefined);
  }, []);

  const loadItems = useCallback(() => {
    setError('');
    listNotifications({ page: 1, size: 20 })
      .then((r) => {
        if (!alive.current) return;
        setItems(r.rows);
        setCount(r.unread);
      })
      .catch(() => alive.current && setError('Could not load notifications.'));
  }, []);

  useEffect(() => {
    alive.current = true;
    refreshCount();
    const timer = setInterval(refreshCount, BELL_POLL_MS);
    const onFocus = (): void => refreshCount();
    const onAction = (): void => {
      refreshCount();
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener(BELL_REFRESH_EVENT, onAction);
    return () => {
      alive.current = false;
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener(BELL_REFRESH_EVENT, onAction);
    };
  }, [refreshCount]);

  useEffect(() => {
    if (open) loadItems();
  }, [open, loadItems]);

  const openItem = (item: NotificationItem): void => {
    setOpen(false);
    void markNotificationRead(item.id)
      .catch(() => undefined)
      .then(refreshCount);
    if (item.link) navigate(item.link);
  };

  const markAll = (): void => {
    void markAllNotificationsRead()
      .then(() => {
        setCount(0);
        setItems(
          (cur) => cur?.map((i) => ({ ...i, readAt: i.readAt ?? new Date().toISOString() })) ?? cur,
        );
      })
      .catch(() => setError('Could not mark all as read.'));
  };

  return (
    <>
      <button
        type="button"
        className="icon bell"
        aria-label={count > 0 ? `Notifications, ${badgeText(count)} unread` : 'Notifications'}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <span aria-hidden="true">🔔</span>
        {count > 0 ? (
          <span className="bell-badge" data-testid="bell-badge">
            {badgeText(count)}
          </span>
        ) : null}
      </button>
      {open ? (
        <Drawer title="Notifications" onClose={() => setOpen(false)}>
          <div className="bell-actions">
            <button type="button" className="btn sm" onClick={markAll} disabled={count === 0}>
              Mark all read
            </button>
            <button
              type="button"
              className="btn sm"
              onClick={() => {
                setOpen(false);
                navigate('/m/notifications');
              }}
            >
              View all
            </button>
          </div>
          {error ? (
            <p className="field-error" role="alert">
              {error}
            </p>
          ) : null}
          {items === null && !error ? <p className="v8-sub">Loading…</p> : null}
          {items && items.length === 0 ? (
            <p className="v8-sub">You are all caught up. New requests and updates appear here.</p>
          ) : null}
          <ul className="notif-list">
            {(items ?? []).map((n) => (
              <li key={n.id} className={n.readAt ? 'notif read' : 'notif unread'}>
                <button type="button" className="notif-item" onClick={() => openItem(n)}>
                  <b>{n.title}</b>
                  {n.body ? <span className="v8-sub">{n.body}</span> : null}
                  <span className="v8-sub">{formatDateTime(n.createdAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        </Drawer>
      ) : null}
    </>
  );
}
