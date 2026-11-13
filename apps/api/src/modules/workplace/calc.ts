// Phase 29 pure rules: canteen money, workload colour, task dependency cycles, recurrence, visitor overstay, handover timer, vendor variance.

const r2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

export interface MealMoney { rate: number; gst: number; total: number; employee: number; company: number }

/** Rate 60 + GST 5 % = 63.00; employee share 40 % = 25.20; company 37.80. */
export function mealMoney(rate: number, gstPct: number, employeeSharePct: number, qty = 1): MealMoney {
  const base = r2(rate * qty);
  const gst = r2((base * gstPct) / 100);
  const total = r2(base + gst);
  const employee = r2((total * employeeSharePct) / 100);
  return { rate: base, gst, total, employee, company: r2(total - employee) };
}

export type WorkloadColour = 'GREEN' | 'AMBER' | 'RED';

/** Red above 10 open or 3 overdue; amber from 7 open or 1 overdue. */
export function workloadColour(open: number, overdue: number): WorkloadColour {
  if (open > 10 || overdue > 3) return 'RED';
  if (open >= 7 || overdue >= 1) return 'AMBER';
  return 'GREEN';
}

/** Adding pred -> succ makes a cycle when succ can already reach pred. */
export function wouldCycle(edges: { pred: string; succ: string }[], pred: string, succ: string): boolean {
  if (pred === succ) return true;
  const next = new Map<string, string[]>();
  for (const e of edges) next.set(e.pred, [...(next.get(e.pred) ?? []), e.succ]);
  const seen = new Set<string>();
  const stack = [succ];
  while (stack.length > 0) {
    const n = stack.pop()!;
    if (n === pred) return true;
    if (seen.has(n)) continue;
    seen.add(n);
    stack.push(...(next.get(n) ?? []));
  }
  return false;
}

export interface Recurrence {
  kind: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'EVERY_N';
  /** weekdays 1 = Monday ... 6 = Saturday (daily and weekly) */
  days?: number[];
  n?: number;
}

const iso = (d: Date): string => d.toISOString().slice(0, 10);
const weekday = (d: Date): number => ((d.getUTCDay() + 6) % 7) + 1; // 1 = Monday ... 7 = Sunday

/** The next due date strictly after `from` (YYYY-MM-DD). Sundays are skipped for DAILY unless listed. */
export function nextDue(rec: Recurrence, from: string): string {
  const d = new Date(`${from}T00:00:00Z`);
  if (rec.kind === 'EVERY_N') {
    d.setUTCDate(d.getUTCDate() + Math.max(1, rec.n ?? 1));
    return iso(d);
  }
  if (rec.kind === 'MONTHLY') {
    const day = d.getUTCDate();
    const y = d.getUTCMonth() === 11 ? d.getUTCFullYear() + 1 : d.getUTCFullYear();
    const m = (d.getUTCMonth() + 1) % 12;
    const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return iso(new Date(Date.UTC(y, m, Math.min(day, last))));
  }
  const days = rec.days && rec.days.length > 0 ? rec.days : rec.kind === 'DAILY' ? [1, 2, 3, 4, 5, 6] : [weekday(d)];
  for (let i = 0; i < 8; i++) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (days.includes(weekday(d))) return iso(d);
  }
  return iso(d);
}

/** Does a recurring template produce a task on this date? */
export function dueOn(rec: Recurrence, date: string, start: string): boolean {
  if (date < start) return false;
  const d = new Date(`${date}T00:00:00Z`);
  if (rec.kind === 'EVERY_N') {
    const diff = Math.round((d.getTime() - new Date(`${start}T00:00:00Z`).getTime()) / 86_400_000);
    return diff % Math.max(1, rec.n ?? 1) === 0;
  }
  if (rec.kind === 'MONTHLY') return d.getUTCDate() === new Date(`${start}T00:00:00Z`).getUTCDate();
  const days = rec.days && rec.days.length > 0 ? rec.days : rec.kind === 'DAILY' ? [1, 2, 3, 4, 5, 6] : [weekday(new Date(`${start}T00:00:00Z`))];
  return days.includes(weekday(d));
}

export function isOverdue(due: string | null, today: string, status: string): boolean {
  return Boolean(due) && (due as string) < today && !['Done', 'Approved', 'Cancelled'].includes(status);
}

/** Overstay = still inside more than 30 minutes after the planned out time. */
export function overstayed(plannedOut: Date | null, now: Date, graceMin = 30): boolean {
  return plannedOut !== null && now.getTime() > plannedOut.getTime() + graceMin * 60_000;
}

/** The incoming in-charge must accept within 30 minutes of the next shift's start. */
export function handoverLate(acceptBy: Date | null, now: Date): boolean {
  return acceptBy !== null && now.getTime() > acceptBy.getTime();
}

/** Vendor meals billed against meals served: more than 2 % over needs approval. */
export function vendorVariance(billed: number, served: number): { pct: number; needsApproval: boolean } {
  if (served <= 0) return { pct: billed > 0 ? 100 : 0, needsApproval: billed > 0 };
  const pct = r2(((billed - served) / served) * 100);
  return { pct, needsApproval: pct > 2 };
}

/** Visitor data is anonymised one year after the visit. */
export function anonymiseDue(outOrVisit: Date, now: Date): boolean {
  return now.getTime() - outOrVisit.getTime() > 365 * 86_400_000;
}

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const monthName = (ym: string): string => MONTH_NAMES[Number(ym.slice(5, 7)) - 1] ?? ym;
