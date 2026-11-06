// Idle warning modal per Phase 01 §3 & §7:
// Displays 2 minutes before idle timeout: "You will be signed out in 2:00 because nothing happened for a while."
// Button: "Stay signed in".
import { useEffect, useState, useRef, useCallback } from 'react';
import { useSession } from '../auth/AuthProvider';
import { logout, request } from '../lib/api';

const DEFAULT_IDLE_MINUTES = 30;

export function IdleWarningModal({ idleMinutes = DEFAULT_IDLE_MINUTES }: { idleMinutes?: number }) {
  const session = useSession();
  const [warningShown, setWarningShown] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(120);
  const lastActiveRef = useRef<number>(Date.now());

  const onUserActivity = useCallback(() => {
    lastActiveRef.current = Date.now();
  }, []);

  useEffect(() => {
    if (session.status !== 'authenticated') return;

    const events = ['mousedown', 'keydown', 'touchstart', 'scroll'];
    events.forEach((ev) => window.addEventListener(ev, onUserActivity, { passive: true }));

    const warningThresholdMs = (idleMinutes - 2) * 60_000;

    const interval = setInterval(() => {
      const elapsed = Date.now() - lastActiveRef.current;
      if (elapsed >= warningThresholdMs && !warningShown) {
        setWarningShown(true);
        const left = Math.max(0, Math.ceil((idleMinutes * 60_000 - elapsed) / 1000));
        setRemainingSeconds(left > 0 ? left : 120);
      }
    }, 5000);

    return () => {
      events.forEach((ev) => window.removeEventListener(ev, onUserActivity));
      clearInterval(interval);
    };
  }, [session.status, idleMinutes, warningShown, onUserActivity]);

  useEffect(() => {
    if (!warningShown) return;

    const timer = setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          void logout();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [warningShown]);

  const staySignedIn = async () => {
    lastActiveRef.current = Date.now();
    setWarningShown(false);
    // Touch session on server
    try {
      await request('/auth/me');
    } catch {
      // Ignore
    }
  };

  if (!warningShown || session.status !== 'authenticated') return null;

  const mins = Math.floor(remainingSeconds / 60);
  const secs = remainingSeconds % 60;
  const timeFormatted = `${mins}:${secs < 10 ? '0' : ''}${secs}`;

  return (
    <div
      className="modal-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
      }}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="idle-warning-title"
    >
      <div
        className="card"
        style={{
          maxWidth: '420px',
          width: '90%',
          padding: '1.5rem',
          textAlign: 'center',
          backgroundColor: 'var(--color-bg-surface, #ffffff)',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
          borderRadius: '8px',
        }}
      >
        <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>⏱️</div>
        <h2 id="idle-warning-title" style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>
          Session Idle Warning
        </h2>
        <p style={{ color: 'var(--color-muted, #64748b)', marginBottom: '1.5rem', fontSize: '0.9375rem' }}>
          You will be signed out in {timeFormatted} because nothing happened for a while.
        </p>
        <button
          type="button"
          className="btn primary"
          style={{ width: '100%', padding: '0.625rem 1rem' }}
          onClick={() => void staySignedIn()}
        >
          Stay signed in
        </button>
      </div>
    </div>
  );
}
