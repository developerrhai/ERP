// Phase 21 §5.6: Pinned Broadcast Banner + Blocking Acknowledgement Modal + SW Update Toast
import { useCallback, useEffect, useState } from 'react';
import { phase21Api, type ActiveBroadcastBanner } from '../lib/phase21Api';
import { RT_EVENT_BROADCAST } from '../lib/realtime';

function hasDirtyForm(): boolean {
  const dirty = document.querySelector('form[data-dirty="true"], input[data-dirty="true"]');
  return Boolean(dirty);
}

export function BroadcastBannerHost() {
  const [banners, setBanners] = useState<ActiveBroadcastBanner[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [swWaiting, setSwWaiting] = useState<ServiceWorker | null>(null);

  const loadBanners = useCallback(() => {
    phase21Api
      .listActiveBroadcasts()
      .then((rows) => setBanners(Array.isArray(rows) ? rows : []))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    loadBanners();
    const onBroadcast = (): void => loadBanners();
    window.addEventListener(RT_EVENT_BROADCAST, onBroadcast);

    // Register SW prompt listener for "New version available — Reload" (§5.5)
    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker
        .getRegistration()
        .then((reg) => {
          if (!reg) return;
          if (reg.waiting) setSwWaiting(reg.waiting);
          reg.addEventListener('updatefound', () => {
            const installing = reg.installing;
            if (!installing) return;
            installing.addEventListener('statechange', () => {
              if (installing.state === 'installed' && navigator.serviceWorker.controller) {
                setSwWaiting(installing);
              }
            });
          });
        })
        .catch(() => undefined);
    }

    return () => window.removeEventListener(RT_EVENT_BROADCAST, onBroadcast);
  }, [loadBanners]);

  // A new version is applied silently when no form holds unsaved edits. If a form is dirty the
  // banner stays, and the update is applied as soon as the form is clean (checked every 5 s) or
  // when the user clicks Reload (§5.5: never discard unsaved edits).
  useEffect(() => {
    if (!swWaiting) return undefined;
    let reloaded = false;
    const apply = (): void => {
      if (reloaded) return;
      reloaded = true;
      navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), {
        once: true,
      });
      swWaiting.postMessage({ type: 'SKIP_WAITING' });
    };
    if (!hasDirtyForm()) {
      apply();
      return undefined;
    }
    const timer = window.setInterval(() => {
      if (!hasDirtyForm()) {
        window.clearInterval(timer);
        apply();
      }
    }, 5000);
    return () => window.clearInterval(timer);
  }, [swWaiting]);

  const acknowledge = async (id: string) => {
    setBusyId(id);
    try {
      await phase21Api.acknowledgeBroadcast(id);
      setBanners((cur) =>
        cur.map((b) => (b.id === id ? { ...b, acked_at: new Date().toISOString() } : b)),
      );
    } finally {
      setBusyId(null);
    }
  };

  const blockingAck = banners.find((b) => b.require_ack && !b.acked_at);
  const pinned = banners.filter((b) => b.pin_banner);

  return (
    <>
      {swWaiting ? (
        <div
          className="notice"
          role="status"
          style={{
            margin: '8px 16px 0',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <span>New version available — reload when ready.</span>
          <button
            type="button"
            className="btn primary sm"
            onClick={() => {
              if (hasDirtyForm()) {
                // Never discard unsaved form edits silently (§5.5)
                if (!window.confirm('You have unsaved form changes. Reload anyway?')) return;
              }
              swWaiting.postMessage({ type: 'SKIP_WAITING' });
              window.location.reload();
            }}
          >
            Reload
          </button>
        </div>
      ) : null}

      {pinned.map((b) => (
        <div
          key={b.id}
          role="region"
          aria-label={`Announcement: ${b.title}`}
          className="notice"
          style={{
            margin: '8px 16px 0',
            borderLeft: `4px solid ${b.severity === 'CRITICAL' ? '#dc2626' : b.severity === 'WARNING' ? '#d97706' : '#0f766e'}`,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <div>
            <strong>[{b.severity}] {b.title}</strong>
            <div style={{ fontSize: 13 }}>{b.body_md}</div>
          </div>
          {!b.acked_at ? (
            <button
              type="button"
              className="btn sm"
              disabled={busyId === b.id}
              onClick={() => void acknowledge(b.id)}
            >
              Acknowledge
            </button>
          ) : (
            <span className="tag">Acknowledged</span>
          )}
        </div>
      ))}

      {blockingAck ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="brc-ack-title"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.65)',
            display: 'grid',
            placeItems: 'center',
            zIndex: 9999,
            padding: 16,
          }}
        >
          <div className="card" style={{ maxWidth: 520, width: '100%', padding: 24 }}>
            <span className="tag">{blockingAck.severity}</span>
            <h2 id="brc-ack-title" style={{ marginTop: 8 }}>{blockingAck.title}</h2>
            <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{blockingAck.body_md}</p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
              <button
                type="button"
                className="btn primary"
                disabled={busyId === blockingAck.id}
                onClick={() => void acknowledge(blockingAck.id)}
              >
                {busyId === blockingAck.id ? 'Recording…' : 'I have read this'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

