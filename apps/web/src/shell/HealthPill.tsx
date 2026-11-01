// Top-bar health pill bound to GET /api/v1/health (replaces the prototype's hard-coded
// "V8 SYSTEM GREEN"), re-checked every minute; a 503 "db down" shows DATABASE ISSUE.
import { useEffect, useState } from 'react';
import { getHealth, type HealthState } from '../lib/api';

type Health = 'checking' | HealthState;

const LABEL: Record<Health, string> = {
  checking: 'CHECKING…',
  ok: 'SYSTEM GREEN',
  degraded: 'DATABASE ISSUE',
  down: 'API OFFLINE',
};

const CLASS: Record<Health, string> = {
  checking: 'health checking',
  ok: 'health',
  degraded: 'health warn',
  down: 'health bad',
};

export function HealthPill({ intervalMs = 60_000 }: { intervalMs?: number }) {
  const [health, setHealth] = useState<Health>('checking');
  useEffect(() => {
    let alive = true;
    const check = async (): Promise<void> => {
      const next = await getHealth();
      if (alive) setHealth(next);
    };
    void check();
    const id = setInterval(() => void check(), intervalMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [intervalMs]);
  return (
    <span className={CLASS[health]} role="status" aria-label={`System health: ${LABEL[health]}`}>
      <i aria-hidden="true" /> {LABEL[health]}
    </span>
  );
}
