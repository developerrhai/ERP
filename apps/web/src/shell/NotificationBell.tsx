// The bell in the top bar (Phase 5 + Phase 21 §7): unread badge (99+ max) updated in real time
// via SSE (`realtime.ts`) with polling fallback, drawer with All / Approvals / Alerts / Announcements
// tabs, "Mark all read", and "View all" -> /m/notif-center.
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
import { phase21Api, type NotifyCategory } from '../lib/phase21Api';
import { RT_EVENT_BADGE } from '../lib/realtime';

export const BELL_POLL_MS = 60_000;

export function badgeText(count: number): string {
  return count > 99 ? '99+' : String(count);
}

type BellTab = 'ALL' | 'APPROVAL' | 'ALERT' | 'ANNOUNCEMENT';

export function NotificationBell() {
  const navigate = useNavigate();
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<BellTab>('ALL');
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
    if (tab === 'ALL') {
      listNotifications({ page: 1, size: 20 })
        .then((r) => {
          if (!alive.current) return;
          setItems(r.rows);
          setCount(r.unread);
        })
        .catch(() => alive.current && setError('Could not load notifications.'));
      return;
    }

    phase21Api
      .listNotificationsCursor({ category: tab as NotifyCategory, limit: 20 })
      .then((rows) => {
        if (!alive.current) return;
        setItems(rows as unknown as NotificationItem[]);
      })
      .catch(() => alive.current && setError('Could not load notifications.'));
  }, [tab]);

  useEffect(() => {
    alive.current = true;
    refreshCount();
    const timer = setInterval(refreshCount, BELL_POLL_MS);
    const onFocus = (): void => refreshCount();
    const onAction = (): void => {
      refreshCount();
      if (open) loadItems();
    };
    const onBadge = (ev: Event): void => {
      const detail = (ev as CustomEvent<{ unread?: number }>).detail;
      if (typeof detail?.unread === 'number') setCount(detail.unread);
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener(BELL_REFRESH_EVENT, onAction);
    window.addEventListener(RT_EVENT_BADGE, onBadge);
    return () => {
      alive.current = false;
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener(BELL_REFRESH_EVENT, onAction);
      window.removeEventListener(RT_EVENT_BADGE, onBadge);
    };
  }, [refreshCount, open, loadItems]);

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
          <div className="bell-actions" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            <button type="button" className="btn sm" onClick={markAll} disabled={count === 0}>
              Mark all read
            </button>
            <button
              type="button"
              className="btn sm"
              onClick={() => {
                setOpen(false);
                navigate('/m/notif-center');
              }}
            >
              View all
            </button>
            <button
              type="button"
              className="btn sm"
              onClick={() => {
                setOpen(false);
                navigate('/m/notif-preferences');
              }}
            >
              Settings
            </button>
          </div>
          <div className="chips" role="tablist" aria-label="Notification categories" style={{ marginBottom: 10 }}>
            {(
              [
                ['ALL', 'All'],
                ['APPROVAL', 'Approvals'],
                ['ALERT', 'Alerts'],
                ['ANNOUNCEMENT', 'Announcements'],
              ] as [BellTab, string][]
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={tab === k}
                className={tab === k ? 'chip active' : 'chip'}
                onClick={() => setTab(k)}
              >
                {label}
              </button>
            ))}
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
