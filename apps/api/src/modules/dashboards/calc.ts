// Phase 24: pure rules for targets and colours (no database). Kept apart so they can be unit-tested on their own.

export type Rag = 'GREEN' | 'AMBER' | 'RED' | 'NONE';
export type Direction = 'HIGHER_GOOD' | 'LOWER_GOOD';

/**
 * Achievement against the target, in percent.
 * HIGHER_GOOD (sales): value / target. LOWER_GOOD (rejection %, overdue): target / value, and a value of 0 is 100 %.
 * Returns null when there is no usable target ("No target set").
 */
export function achievementPct(
  value: number | null,
  target: number | null,
  direction: Direction,
): number | null {
  if (value === null || target === null || !Number.isFinite(value) || !Number.isFinite(target)) return null;
  if (direction === 'LOWER_GOOD') {
    if (value <= 0) return 100;
    if (target < 0) return null;
    return round2((target / value) * 100);
  }
  if (target <= 0) return null;
  return round2((value / target) * 100);
}

/**
 * Green at or above `amberPct` (default 90), amber at or above `redPct` (default 75), otherwise red.
 * So exactly 90 % is green and exactly 75 % is amber.
 */
export function ragOf(pct: number | null, amberPct = 90, redPct = 75): Rag {
  if (pct === null) return 'NONE';
  if (pct >= amberPct) return 'GREEN';
  if (pct >= redPct) return 'AMBER';
  return 'RED';
}

/** Period-over-period change in percent; null when the earlier value is 0 or missing (never a made-up number). */
export function changePct(now: number | null, before: number | null): number | null {
  if (now === null || before === null || before === 0) return null;
  return round2(((now - before) / Math.abs(before)) * 100);
}

/** Whether a KPI can be added across plants into a total. Ratios, percentages and days cannot. */
export function isAdditive(format: string): boolean {
  return format === 'inr' || format === 'count' || format === 'hours';
}

/** Alert condition check. BELOW_TARGET / ABOVE_TARGET need the target; GT / LT need the threshold. */
export function alertCrossed(
  condition: 'GT' | 'LT' | 'BELOW_TARGET' | 'ABOVE_TARGET',
  value: number | null,
  threshold: number | null,
  target: number | null,
): boolean {
  if (value === null) return false;
  switch (condition) {
    case 'GT':
      return threshold !== null && value > threshold;
    case 'LT':
      return threshold !== null && value < threshold;
    case 'BELOW_TARGET':
      return target !== null && value < target;
    case 'ABOVE_TARGET':
      return target !== null && value > target;
  }
}

/** "m h * * *" (daily at hour:minute) is the one cron shape dashboard emails support. */
export function parseDailyCron(expr: string): { minute: number; hour: number } | null {
  const m = /^(\d{1,2}) (\d{1,2}) \* \* \*$/.exec(expr.trim());
  if (!m) return null;
  const minute = Number(m[1]);
  const hour = Number(m[2]);
  return minute <= 59 && hour <= 23 ? { minute, hour } : null;
}

/** True when a daily schedule is due now (this hour:minute passed today and it has not run since). */
export function dailyDue(
  cron: { minute: number; hour: number },
  now: Date,
  lastRunAt: Date | null,
  tzOffsetMinutes = 330,
): boolean {
  const local = new Date(now.getTime() + tzOffsetMinutes * 60_000);
  const dueToday = new Date(
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), cron.hour, cron.minute),
  );
  const dueAtUtc = new Date(dueToday.getTime() - tzOffsetMinutes * 60_000);
  if (now < dueAtUtc) return false;
  return !lastRunAt || lastRunAt < dueAtUtc;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
