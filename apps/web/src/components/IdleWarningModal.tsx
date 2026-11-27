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
      className="modal-overlay x-pos-fixed x-inset-0 x-bgc-rgba-0-0-0-0_5 x-d-flex x-ai-center x-jc-center x-z-index-9999"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="idle-warning-title"
    >
      <div
        className="card x-maxw-420px x-w-90pct x-p-1_5rem x-ta-center x-bgc-var-color-bg-surface-hffffff x-box-shadow-0-20px-25px-n5px-rgba-0-0-0-0_1-0-10px-10px-n5px x-r-8px"
      >
        <div className="x-fs-32px x-mb-0_75rem">⏱️</div>
        <h2 id="idle-warning-title" className="x-fs-20px x-mb-0_5rem">
          Session Idle Warning
        </h2>
        <p className="x-c-var-color-muted-h64748b x-mb-1_5rem x-fs-14px">
          You will be signed out in {timeFormatted} because nothing happened for a while.
        </p>
        <button
          type="button"
          className="btn primary x-w-100pct x-p-0_625rem-1rem"
          onClick={() => void staySignedIn()}
        >
          Stay signed in
        </button>
      </div>
    </div>
  );
}
