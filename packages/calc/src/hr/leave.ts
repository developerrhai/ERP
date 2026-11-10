// packages/calc/src/hr/leave.ts
// Pure leave calculations (PHASE-15.md §5 Algorithms C, D, E)
// No database imports. All rules, limits and thresholds are passed in.

export interface EarnedLeaveAccrualRule {
  daysPerWorked: number; // e.g. 20 (1 day per 20 days worked)
  eligibilityDays: number; // e.g. 180 (Codes) or 240 (old)
  roundingThreshold?: number; // e.g. 0.5 (>= 0.5 rounds up)
}

/**
 * Accrue factory Earned Leave (EL) based on worked days (Section 5 C)
 * worked = P + 0.5 * HD + paid leave + lay-off / maternity days.
 * If worked >= eligibilityDays -> round_half_up(worked / daysPerWorked)
 * Examples: 250 -> 13 (250/20 = 12.5 -> 13); 175 with eligibility 180 -> 0.
 */
export function accrueEarnedLeave(
  workedDays: number,
  rule: EarnedLeaveAccrualRule,
): number {
  if (workedDays < rule.eligibilityDays) {
    return 0;
  }
  const raw = workedDays / rule.daysPerWorked;
  // Round half up: 12.5 -> 13, 12.4 -> 12
  const floorVal = Math.floor(raw);
  const frac = raw - floorVal;
  const threshold = rule.roundingThreshold ?? 0.5;
  return frac >= threshold ? floorVal + 1 : floorVal;
}

export interface YearEndCarryForwardInput {
  closingBalance: number;
  carryForwardCap: number; // e.g. 30 (Factories/OSH) or 45 (MH S&E)
  accumulationCap?: number;
  encashable?: boolean;
}

export interface YearEndCarryForwardResult {
  carryForward: number;
  encashDays: number;
  lapseDays: number;
}

/**
 * Calculates year-end carry forward, encashment or lapse (Section 5 C)
 * Carry = min(closing, cap).
 * The excess is ENCASH (if allowed) or LAPSE.
 */
export function computeYearEndCarryForward(
  input: YearEndCarryForwardInput,
): YearEndCarryForwardResult {
  const carry = Math.min(Math.max(0, input.closingBalance), input.carryForwardCap);
  const excess = Math.max(0, input.closingBalance - carry);

  if (input.encashable) {
    return {
      carryForward: carry,
      encashDays: excess,
      lapseDays: 0,
    };
  }

  return {
    carryForward: carry,
    encashDays: 0,
    lapseDays: excess,
  };
}

export interface LeaveDayItem {
  date: string; // YYYY-MM-DD
  isWeeklyOff?: boolean;
  isHoliday?: boolean;
}

export interface SandwichLeaveInput {
  spanDays: LeaveDayItem[];
  sandwichRuleActive: boolean; // default false
  isHalfDayFirst?: boolean;
  isHalfDayLast?: boolean;
}

/**
 * Computes leave days applying the sandwich rule and half-day constraints (Section 5 D)
 * Sandwich is a per-type flag, default OFF (EL never, CL may be ON).
 * Example: Friday CL + Monday CL -> 4 days with sandwich ON, 2 days with it OFF.
 */
export function computeLeaveDays(input: SandwichLeaveInput): {
  daysComputed: number;
  sandwichedDays: number;
  workingDays: number;
} {
  let workingDays = 0;
  let sandwichedDays = 0;

  const totalItems = input.spanDays.length;
  if (totalItems === 0) {
    return { daysComputed: 0, sandwichedDays: 0, workingDays: 0 };
  }

  for (let i = 0; i < totalItems; i++) {
    const item = input.spanDays[i]!;
    const isOff = !!item.isWeeklyOff || !!item.isHoliday;

    if (!isOff) {
      let dayVal = 1.0;
      if (i === 0 && input.isHalfDayFirst) dayVal = 0.5;
      if (i === totalItems - 1 && input.isHalfDayLast) dayVal = 0.5;
      workingDays += dayVal;
    } else {
      if (input.sandwichRuleActive) {
        // Between leave days
        sandwichedDays += 1.0;
      }
    }
  }

  const daysComputed = workingDays + sandwichedDays;
  return {
    daysComputed,
    sandwichedDays,
    workingDays,
  };
}

/**
 * Check if a comp-off credit has expired (Section 5 E)
 * Valid for 90 days (or configured validity days)
 */
export function isCompOffExpired(
  earnedDate: Date | string,
  asOfDate: Date | string,
  validityDays = 90,
): boolean {
  const earned = typeof earnedDate === 'string' ? new Date(earnedDate) : earnedDate;
  const asOf = typeof asOfDate === 'string' ? new Date(asOfDate) : asOfDate;
  const diffDays = Math.floor((asOf.getTime() - earned.getTime()) / (1000 * 60 * 60 * 24));
  return diffDays > validityDays;
}

