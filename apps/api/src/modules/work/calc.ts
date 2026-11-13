// Phase 25: pure rules of the Department Work Movement engine (no database): the state machine and the SLA clock.

export type MovementState =
  | 'SENT'
  | 'RECEIVED'
  | 'ACCEPTED'
  | 'IN_WORK'
  | 'WAITING_APPROVAL'
  | 'COMPLETED'
  | 'FORWARDED'
  | 'RETURNED'
  | 'RECALLED'
  | 'CANCELLED';

export type MovementAction = 'receive' | 'accept' | 'return' | 'recall' | 'complete' | 'forward';

/** Open = the record is still travelling; at most one open movement per document. */
export const OPEN_STATES: readonly MovementState[] = ['SENT', 'RECEIVED', 'ACCEPTED', 'IN_WORK', 'WAITING_APPROVAL'];

export function isOpen(state: string): boolean {
  return (OPEN_STATES as readonly string[]).includes(state);
}

/** state -> action -> next state. Anything not listed is illegal. */
const TRANSITIONS: Record<MovementAction, Partial<Record<MovementState, MovementState>>> = {
  receive: { SENT: 'RECEIVED' },
  accept: { RECEIVED: 'ACCEPTED' },
  return: { RECEIVED: 'RETURNED', ACCEPTED: 'RETURNED', IN_WORK: 'RETURNED' },
  recall: { SENT: 'RECALLED' },
  complete: { ACCEPTED: 'COMPLETED', IN_WORK: 'COMPLETED' },
  forward: { ACCEPTED: 'FORWARDED', IN_WORK: 'FORWARDED' },
};

export function nextState(state: string, action: MovementAction): MovementState | null {
  return TRANSITIONS[action][state as MovementState] ?? null;
}

/** Which side of the handover may do the action: the department the record is sent TO, or the one that SENT it. */
export const ACTOR_SIDE: Record<MovementAction, 'target' | 'sender'> = {
  receive: 'target',
  accept: 'target',
  return: 'target',
  recall: 'sender',
  complete: 'target',
  forward: 'target',
};

const IST_OFFSET_MIN = 330;

/**
 * Adds working days to a moment. The plant works Monday to Saturday (Sunday is off) and skips the dates in `holidays`
 * (YYYY-MM-DD). A fraction of a day is added as hours at the end. The time of day is kept:
 * sent Friday 16:00 with 2 days -> Saturday 16:00 is day 1, Monday 16:00 is day 2 (Sunday skipped).
 */
export function addWorkingDays(start: Date, days: number, holidays: ReadonlySet<string> = new Set()): Date {
  const whole = Math.floor(days);
  const frac = days - whole;
  let cursor = new Date(start.getTime());
  let left = whole;
  while (left > 0) {
    cursor = new Date(cursor.getTime() + 86_400_000);
    if (isWorkingDay(cursor, holidays)) left -= 1;
  }
  if (frac > 0) cursor = new Date(cursor.getTime() + Math.round(frac * 24 * 3_600_000));
  return cursor;
}

export function isWorkingDay(d: Date, holidays: ReadonlySet<string> = new Set()): boolean {
  const local = new Date(d.getTime() + IST_OFFSET_MIN * 60_000);
  if (local.getUTCDay() === 0) return false; // Sunday
  return !holidays.has(local.toISOString().slice(0, 10));
}

/** Default next department when the Workflow Matrix has no rule (the V18 map); null = use the chain order. */
export const V18_NEXT: Readonly<Record<string, string>> = {
  'sales-orders': 'Production',
  'scm-po': 'Warehouse',
  'scm-grn': 'Quality',
  'qms-incoming': 'Warehouse',
  'mfg-orders': 'Quality',
  'qms-final': 'Warehouse',
  'dispatch-dc': 'Finance',
  'ops-shift-roster': 'HR',
};

/** Escalation levels by lateness: 0 = on time, 1 = late (tell the manager), 2 = twice the SLA (tell the head). */
export function lateLevel(sentAt: Date, dueAt: Date | null, now: Date): 0 | 1 | 2 {
  if (!dueAt || now <= dueAt) return 0;
  const allowed = dueAt.getTime() - sentAt.getTime();
  return now.getTime() - sentAt.getTime() >= allowed * 2 ? 2 : 1;
}
