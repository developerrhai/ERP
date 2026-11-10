// Phase 21 §5.3: Real-time SSE subscriber using @microsoft/fetch-event-source (Bearer + cookie auth),
// single Web Locks leader per browser shared over BroadcastChannel, Last-Event-ID replay, and polling fallback.
import { fetchEventSource } from '@microsoft/fetch-event-source';
import { getAccessToken } from '../auth/session';
import { API_BASE } from './api';
import { BELL_REFRESH_EVENT } from './approvalsApi';

export const RT_EVENT_NEW = 'rhai:rt:new';
export const RT_EVENT_BADGE = 'rhai:rt:badge';
export const RT_EVENT_BROADCAST = 'rhai:rt:broadcast';
export const RT_EVENT_APPROVAL = 'rhai:rt:approval';
export const RT_EVENT_RESYNC = 'rhai:rt:resync';

export interface RealtimeMessage {
  event: string;
  data: any;
  id?: string;
}

const CHANNEL_NAME = 'sawant-erp-rt';
let stopController: AbortController | null = null;
let started = false;
let lastSeqId: string | undefined;
let consecutiveErrors = 0;

function updateAppBadge(count: number): void {
  const nav = navigator as Navigator & {
    setAppBadge?: (c: number) => Promise<void>;
    clearAppBadge?: () => Promise<void>;
  };
  if (typeof nav.setAppBadge === 'function') {
    if (count > 0) void nav.setAppBadge(count).catch(() => undefined);
    else void nav.clearAppBadge?.().catch(() => undefined);
  }
}

export function dispatchRealtimeMessage(msg: RealtimeMessage): void {
  if (msg.id) lastSeqId = msg.id;

  if (msg.event === 'badge') {
    const unread = Number(msg.data?.unread ?? 0);
    updateAppBadge(unread);
    window.dispatchEvent(new CustomEvent(RT_EVENT_BADGE, { detail: { unread } }));
  } else if (msg.event === 'notification.new') {
    window.dispatchEvent(new CustomEvent(RT_EVENT_NEW, { detail: msg.data }));
    window.dispatchEvent(new Event(BELL_REFRESH_EVENT));
  } else if (msg.event === 'notification.read') {
    window.dispatchEvent(new Event(BELL_REFRESH_EVENT));
  } else if (msg.event === 'broadcast.banner') {
    window.dispatchEvent(new CustomEvent(RT_EVENT_BROADCAST, { detail: msg.data }));
  } else if (msg.event === 'approval.changed') {
    window.dispatchEvent(new CustomEvent(RT_EVENT_APPROVAL, { detail: msg.data }));
    window.dispatchEvent(new Event(BELL_REFRESH_EVENT));
  } else if (msg.event === 'resync') {
    window.dispatchEvent(new CustomEvent(RT_EVENT_RESYNC));
    window.dispatchEvent(new Event(BELL_REFRESH_EVENT));
  } else if (msg.event === 'session.revoked') {
    window.location.assign('/login');
  }
}

async function runLeaderStream(signal: AbortSignal, bc: BroadcastChannel | null): Promise<void> {
  while (!signal.aborted) {
    const token = getAccessToken();
    if (!token) {
      await new Promise((r) => setTimeout(r, 1500));
      continue;
    }

    if (consecutiveErrors >= 3) {
      // Fallback polling mode every 30s until connection recovers (§5.3)
      window.dispatchEvent(new Event(BELL_REFRESH_EVENT));
      await new Promise((r) => setTimeout(r, 30_000));
      consecutiveErrors = 0;
    }

    try {
      await fetchEventSource(`${API_BASE}/realtime/stream`, {
        method: 'GET',
        credentials: 'include',
        headers: {
          Authorization: `Bearer ${token}`,
          ...(lastSeqId ? { 'Last-Event-ID': lastSeqId } : {}),
        },
        signal,
        openWhenHidden: false,
        onopen: async (resp) => {
          if (resp.ok) {
            consecutiveErrors = 0;
            return;
          }
          if (resp.status === 401 || resp.status === 403) {
            consecutiveErrors = 3;
            throw new Error(`SSE unauthorized (${resp.status})`);
          }
          throw new Error(`SSE HTTP ${resp.status}`);
        },
        onmessage: (ev) => {
          consecutiveErrors = 0;
          if (!ev.event || ev.event === 'ping') return;
          let parsed: any = {};
          try {
            parsed = ev.data ? JSON.parse(ev.data) : {};
          } catch {
            parsed = { raw: ev.data };
          }
          const msg: RealtimeMessage = { event: ev.event, data: parsed, id: ev.id || undefined };
          dispatchRealtimeMessage(msg);
          bc?.postMessage(msg);
        },
        onerror: (err) => {
          consecutiveErrors += 1;
          if (consecutiveErrors >= 3) {
            throw err;
          }
          return Math.min(30_000, 1000 * 2 ** consecutiveErrors);
        },
      });
    } catch {
      consecutiveErrors += 1;
      await new Promise((r) => setTimeout(r, Math.min(30_000, 1000 * 2 ** Math.min(consecutiveErrors, 5))));
    }
  }
}

export function startRealtimeClient(): () => void {
  if (started) return stopRealtimeClient;
  started = true;
  const ctrl = new AbortController();
  stopController = ctrl;

  const bc = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL_NAME) : null;
  if (bc) {
    bc.onmessage = (ev) => {
      if (ev.data && typeof ev.data.event === 'string') {
        dispatchRealtimeMessage(ev.data as RealtimeMessage);
      }
    };
  }

  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  if (locks && typeof locks.request === 'function') {
    void locks.request(
      'sawant-erp-sse-leader',
      { signal: ctrl.signal },
      async () => runLeaderStream(ctrl.signal, bc),
    ).catch(() => undefined);
  } else {
    void runLeaderStream(ctrl.signal, bc);
  }

  return () => {
    stopRealtimeClient();
    bc?.close();
  };
}

export function stopRealtimeClient(): void {
  started = false;
  if (stopController) {
    stopController.abort();
    stopController = null;
  }
}

