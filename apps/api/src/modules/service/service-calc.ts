/**
 * Pure calculation engine for Service (SLA, Dispatch, AMC Revenue, Warranty)
 * CommonJS compatible for apps/api
 */

export interface SlaPolicyConfig {
  priority: number;
  responseMins: number;
  resolutionMins: number;
  startHour?: number;
  endHour?: number;
  workingDays?: number[]; // 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri
}

export interface PauseInterval {
  startAt: string;
  endAt?: string;
}

export function computePriority(impact: number, urgency: number): number {
  const p = impact + urgency - 1;
  return Math.max(1, Math.min(4, p));
}

function parseIst(dtStr: string): Date {
  const d = new Date(dtStr);
  return d;
}

function isWorkingDay(d: Date, holidays: Set<string>, workingDays: number[]): boolean {
  const day = d.getDay();
  if (!workingDays.includes(day)) return false;
  const iso = d.toISOString().slice(0, 10);
  if (holidays.has(iso)) return false;
  return true;
}

export function addBusinessMinutes(
  startDt: string,
  targetMins: number,
  options?: {
    startHour?: number;
    endHour?: number;
    workingDays?: number[];
    holidays?: string[];
  },
): string {
  const startHour = options?.startHour ?? 9;
  const endHour = options?.endHour ?? 18;
  const workingDays = options?.workingDays ?? [1, 2, 3, 4, 5];
  const holidays = new Set(options?.holidays ?? []);

  let curr = parseIst(startDt);
  let remainingMins = targetMins;

  // Align start to business hours if needed
  while (true) {
    if (!isWorkingDay(curr, holidays, workingDays)) {
      curr.setHours(startHour, 0, 0, 0);
      curr.setDate(curr.getDate() + 1);
      continue;
    }
    const h = curr.getHours();
    const m = curr.getMinutes();
    const curTotalMins = h * 60 + m;
    const startTotalMins = startHour * 60;
    const endTotalMins = endHour * 60;

    if (curTotalMins < startTotalMins) {
      curr.setHours(startHour, 0, 0, 0);
      break;
    } else if (curTotalMins >= endTotalMins) {
      curr.setHours(startHour, 0, 0, 0);
      curr.setDate(curr.getDate() + 1);
      continue;
    } else {
      break;
    }
  }

  while (remainingMins > 0) {
    if (!isWorkingDay(curr, holidays, workingDays)) {
      curr.setHours(startHour, 0, 0, 0);
      curr.setDate(curr.getDate() + 1);
      continue;
    }

    const curTotalMins = curr.getHours() * 60 + curr.getMinutes();
    const endTotalMins = endHour * 60;
    const availableToday = endTotalMins - curTotalMins;

    if (remainingMins <= availableToday) {
      curr.setMinutes(curr.getMinutes() + remainingMins);
      remainingMins = 0;
      break;
    } else {
      remainingMins -= availableToday;
      curr.setHours(startHour, 0, 0, 0);
      curr.setDate(curr.getDate() + 1);
    }
  }

  return curr.toISOString();
}

export function calculateSlaDue(
  createdDt: string,
  targetMins: number,
  pauses: PauseInterval[],
  options?: {
    startHour?: number;
    endHour?: number;
    workingDays?: number[];
    holidays?: string[];
  },
): { dueAt: string; totalPausedMins: number } {
  let totalPausedMins = 0;
  for (const p of pauses) {
    if (p.endAt) {
      const s = new Date(p.startAt).getTime();
      const e = new Date(p.endAt).getTime();
      const diffMins = Math.max(0, Math.round((e - s) / (1000 * 60)));
      totalPausedMins += diffMins;
    }
  }

  const effectiveMins = targetMins + totalPausedMins;
  const dueAt = addBusinessMinutes(createdDt, effectiveMins, options);
  return { dueAt, totalPausedMins };
}

export function checkSlaWarning(
  createdDt: string,
  dueDt: string,
  nowDt: string,
): { warning: boolean; breached: boolean } {
  const created = new Date(createdDt).getTime();
  const due = new Date(dueDt).getTime();
  const now = new Date(nowDt).getTime();

  if (now >= due) {
    return { warning: true, breached: true };
  }
  const totalDuration = due - created;
  const elapsed = now - created;
  if (totalDuration > 0 && elapsed / totalDuration >= 0.75) {
    return { warning: true, breached: false };
  }
  return { warning: false, breached: false };
}

export interface TechnicianCandidate {
  id: string;
  employeeCode: string;
  name: string;
  skillCode: string;
  skillLevel: number;
  openJobs: number;
  maxJobs: number;
  isSameTerritory: boolean;
  isParentTerritory: boolean;
  onLeave?: boolean;
}

export interface DispatchScoreResult {
  technicianId: string;
  employeeCode: string;
  score: number;
  skillScore: number;
  loadScore: number;
  proximityScore: number;
}

export function computeTechnicianScore(candidate: TechnicianCandidate): DispatchScoreResult {
  const skillScore = Math.max(1, Math.min(5, candidate.skillLevel)) / 5;
  const maxJ = Math.max(1, candidate.maxJobs);
  const openJ = Math.max(0, candidate.openJobs);
  const loadScore = Math.max(0, 1 - openJ / maxJ);

  let proximityScore = 0;
  if (candidate.isSameTerritory) {
    proximityScore = 1.0;
  } else if (candidate.isParentTerritory) {
    proximityScore = 0.5;
  }

  const rawScore = 0.5 * skillScore + 0.3 * loadScore + 0.2 * proximityScore;
  const score = Math.round(rawScore * 10000) / 10000;

  return {
    technicianId: candidate.id,
    employeeCode: candidate.employeeCode,
    score,
    skillScore: Math.round(skillScore * 10000) / 10000,
    loadScore: Math.round(loadScore * 10000) / 10000,
    proximityScore: Math.round(proximityScore * 10000) / 10000,
  };
}

export function selectTechnician(candidates: TechnicianCandidate[]): DispatchScoreResult | null {
  const eligible = candidates.filter((c) => !c.onLeave && (c.isSameTerritory || c.isParentTerritory));
  if (eligible.length === 0) return null;

  const scored = eligible.map(computeTechnicianScore);

  scored.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    const candA = eligible.find((c) => c.id === a.technicianId)!;
    const candB = eligible.find((c) => c.id === b.technicianId)!;
    if (candA.openJobs !== candB.openJobs) {
      return candA.openJobs - candB.openJobs;
    }
    return candA.employeeCode.localeCompare(candB.employeeCode);
  });

  return scored[0] ?? null;
}

export interface AmcRevenueScheduleEntry {
  period: string;
  days: number;
  amount: number;
}

export function computeAmcRevenueSchedule(
  startDateStr: string,
  endDateStr: string,
  totalContractValue: number,
): AmcRevenueScheduleEntry[] {
  const start = new Date(startDateStr);
  const end = new Date(endDateStr);

  const MS_PER_DAY = 1000 * 60 * 60 * 24;
  const totalDays = Math.round((end.getTime() - start.getTime()) / MS_PER_DAY) + 1;
  if (totalDays <= 0) return [];

  const periods: Array<{ period: string; days: number }> = [];
  let curr = new Date(start);

  while (curr <= end) {
    const y = curr.getFullYear();
    const m = curr.getMonth();
    const period = `${y}-${String(m + 1).padStart(2, '0')}`;

    const monthEnd = new Date(y, m + 1, 0);
    const effEnd = monthEnd < end ? monthEnd : end;

    const daysInPeriod = Math.round((effEnd.getTime() - curr.getTime()) / MS_PER_DAY) + 1;
    periods.push({ period, days: daysInPeriod });

    curr = new Date(y, m + 1, 1);
  }

  let accumulated = 0;
  const result: AmcRevenueScheduleEntry[] = [];

  for (let i = 0; i < periods.length; i++) {
    const p = periods[i]!;
    if (i === periods.length - 1) {
      const remainder = Math.round((totalContractValue - accumulated) * 100) / 100;
      result.push({
        period: p.period,
        days: p.days,
        amount: remainder,
      });
    } else {
      const rawAmt = (p.days * totalContractValue) / totalDays;
      const amt = Math.round(rawAmt * 100) / 100;
      accumulated = Math.round((accumulated + amt) * 100) / 100;
      result.push({
        period: p.period,
        days: p.days,
        amount: amt,
      });
    }
  }

  return result;
}

export function computeWarrantyEndDate(startDateStr: string, months: number): string {
  const parts = startDateStr.split('-').map(Number);
  const y = parts[0]!;
  const m = parts[1]!;
  const d = parts[2]!;

  const targetDate = new Date(Date.UTC(y, m - 1 + months, 1));
  const targetYear = targetDate.getUTCFullYear();
  const targetMonth = targetDate.getUTCMonth();

  const daysInTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();

  let finalYear = targetYear;
  let finalMonth = targetMonth;
  let finalDay = 0;

  if (d >= daysInTargetMonth) {
    finalDay = daysInTargetMonth;
  } else {
    finalDay = d - 1;
    if (finalDay === 0) {
      const prevMonthLast = new Date(Date.UTC(targetYear, targetMonth, 0));
      finalYear = prevMonthLast.getUTCFullYear();
      finalMonth = prevMonthLast.getUTCMonth();
      finalDay = prevMonthLast.getUTCDate();
    }
  }

  const resStr = `${finalYear}-${String(finalMonth + 1).padStart(2, '0')}-${String(finalDay).padStart(2, '0')}`;
  return resStr;
}

export type WarrantyCheckResult =
  | 'IN_WARRANTY'
  | 'AMC_COVERED'
  | 'OUT_OF_WARRANTY'
  | 'CONDITIONAL';

export interface WarrantyEvaluationInput {
  hasSalesInvoice: boolean;
  activeRegistration?: {
    startDate: string;
    endDate: string;
    customerId: string;
    status: string;
    exclusions?: string[];
  };
  activeAmc?: {
    startDate: string;
    endDate: string;
    coverage: string;
    customerId: string;
    status: string;
  };
  failureDate: string;
  claimCustomerId: string;
  reportedIssue?: string;
}

export function evaluateWarranty(input: WarrantyEvaluationInput): {
  result: WarrantyCheckResult;
  reasons: string[];
} {
  const reasons: string[] = [];

  if (!input.hasSalesInvoice) {
    return {
      result: 'OUT_OF_WARRANTY',
      reasons: ['NOT_SOLD: No sales record found for equipment serial'],
    };
  }

  const failure = input.failureDate;

  if (input.activeRegistration) {
    const reg = input.activeRegistration;
    if (reg.status === 'VOID') {
      reasons.push('Warranty is VOID');
    } else if (reg.customerId !== input.claimCustomerId) {
      reasons.push('Customer mismatch: No recorded ownership transfer');
    } else if (failure < reg.startDate) {
      reasons.push(`Failure date ${failure} before warranty start ${reg.startDate}`);
    } else if (failure > reg.endDate) {
      reasons.push(`Out of warranty since ${reg.endDate}`);
    } else {
      if (reg.exclusions && input.reportedIssue) {
        for (const ex of reg.exclusions) {
          if (input.reportedIssue.toLowerCase().includes(ex.toLowerCase())) {
            reasons.push(`Exclusion applies: ${ex}`);
            return {
              result: 'CONDITIONAL',
              reasons,
            };
          }
        }
      }
      return {
        result: 'IN_WARRANTY',
        reasons: ['Equipment is covered under standard warranty'],
      };
    }
  } else {
    reasons.push('No warranty registration found');
  }

  if (input.activeAmc) {
    const amc = input.activeAmc;
    if (
      amc.status === 'ACTIVE' &&
      amc.customerId === input.claimCustomerId &&
      failure >= amc.startDate &&
      failure <= amc.endDate
    ) {
      return {
        result: 'AMC_COVERED',
        reasons: [`Equipment is covered under AMC ${amc.coverage}`],
      };
    }
  }

  return {
    result: 'OUT_OF_WARRANTY',
    reasons: reasons.length > 0 ? reasons : ['Equipment is out of warranty and AMC coverage'],
  };
}

