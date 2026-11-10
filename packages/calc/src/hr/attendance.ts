// packages/calc/src/hr/attendance.ts
// Pure attendance calculations (PHASE-15.md §5 Algorithms A & B)
// No database imports. All rules, limits and thresholds are passed in.

export interface ShiftConfig {
  code: string;
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  breakMinutes: number;
  graceInMinutes: number;
  graceOutMinutes?: number;
  fullDayMinutes: number;
  halfDayMinutes: number;
  absentBelowMinutes: number;
  otStartAfterMinutes?: number;
  otBlockMinutes?: number;
  otMinMinutes?: number;
  isNight?: boolean;
  restAfterMinutes?: number; // e.g. 300 minutes (5 hours)
  maxDailyMinutes?: number; // e.g. 540 minutes (9 hours)
}

export interface DayComputeInput {
  date: string; // YYYY-MM-DD
  punches: Array<{ punchAt: Date | string }>; // Sorted or unsorted
  shift: ShiftConfig;
  isWeeklyOff?: boolean;
  isHoliday?: boolean;
  approvedLeave?: {
    typeCode: string;
    isHalfDay: boolean;
    isPaid: boolean;
  };
  manualRegularization?: {
    status: string;
    workedMinutes?: number;
    otApprovedMinutes?: number;
  };
}

export type DayStatus =
  | 'P'
  | 'HD'
  | 'A'
  | 'WO'
  | 'H'
  | 'L'
  | 'LHD'
  | 'MIS'
  | 'WOP'
  | 'HP';

export interface DayComputeResult {
  date: string;
  firstIn: string | null; // ISO string
  lastOut: string | null; // ISO string
  workedMinutes: number;
  lateMinutes: number;
  earlyMinutes: number;
  otCandidateMinutes: number;
  status: DayStatus;
  flags: string[];
  isNightShift: boolean;
  punchesCount: number;
}

/** Parses "HH:mm" into minutes from 00:00. */
export function timeToMinutes(timeStr: string): number {
  const parts = timeStr.split(':');
  const h = parseInt(parts[0] ?? '0', 10);
  const m = parseInt(parts[1] ?? '0', 10);
  return h * 60 + m;
}

/** Compute elapsed minutes between two dates. */
export function diffInMinutes(d1: Date, d2: Date): number {
  return Math.round((d2.getTime() - d1.getTime()) / (60 * 1000));
}

/**
 * Given punch times in chronological order, computes daily attendance according to §5 Algorithm A.
 * Rule: First punch is IN, last is OUT. Direction is not trusted from machine.
 */
export function computeAttendanceDay(input: DayComputeInput): DayComputeResult {
  const flags: string[] = [];
  const shift = input.shift;
  const isNightShift = !!shift.isNight;
  const restAfter = shift.restAfterMinutes ?? 300;
  const maxDaily = shift.maxDailyMinutes ?? 540;

  // Convert and sort punches
  const sortedPunches = input.punches
    .map((p) => (typeof p.punchAt === 'string' ? new Date(p.punchAt) : p.punchAt))
    .filter((d) => !isNaN(d.getTime()))
    .sort((a, b) => a.getTime() - b.getTime());

  const count = sortedPunches.length;

  if (input.manualRegularization) {
    return {
      date: input.date,
      firstIn: sortedPunches[0]?.toISOString() ?? null,
      lastOut: sortedPunches[count - 1]?.toISOString() ?? null,
      workedMinutes: input.manualRegularization.workedMinutes ?? 0,
      lateMinutes: 0,
      earlyMinutes: 0,
      otCandidateMinutes: input.manualRegularization.otApprovedMinutes ?? 0,
      status: input.manualRegularization.status as DayStatus,
      flags: ['MANUAL_REGULARIZATION'],
      isNightShift,
      punchesCount: count,
    };
  }

  // If approved leave overrides
  if (input.approvedLeave) {
    const status: DayStatus = input.approvedLeave.isHalfDay ? 'LHD' : 'L';
    return {
      date: input.date,
      firstIn: sortedPunches[0]?.toISOString() ?? null,
      lastOut: sortedPunches[count - 1]?.toISOString() ?? null,
      workedMinutes: 0,
      lateMinutes: 0,
      earlyMinutes: 0,
      otCandidateMinutes: 0,
      status,
      flags: ['APPROVED_LEAVE'],
      isNightShift,
      punchesCount: count,
    };
  }

  // Scheduled Weekly Off or Holiday without punches
  if (count === 0) {
    if (input.isWeeklyOff) {
      return {
        date: input.date,
        firstIn: null,
        lastOut: null,
        workedMinutes: 0,
        lateMinutes: 0,
        earlyMinutes: 0,
        otCandidateMinutes: 0,
        status: 'WO',
        flags: [],
        isNightShift,
        punchesCount: 0,
      };
    }
    if (input.isHoliday) {
      return {
        date: input.date,
        firstIn: null,
        lastOut: null,
        workedMinutes: 0,
        lateMinutes: 0,
        earlyMinutes: 0,
        otCandidateMinutes: 0,
        status: 'H',
        flags: [],
        isNightShift,
        punchesCount: 0,
      };
    }
    // Zero punches on a working day -> Absent
    return {
      date: input.date,
      firstIn: null,
      lastOut: null,
      workedMinutes: 0,
      lateMinutes: 0,
      earlyMinutes: 0,
      otCandidateMinutes: 0,
      status: 'A',
      flags: [],
      isNightShift,
      punchesCount: 0,
    };
  }

  // Single punch -> MIS (Missing punch)
  if (count === 1) {
    const single = sortedPunches[0]!;
    return {
      date: input.date,
      firstIn: single.toISOString(),
      lastOut: null,
      workedMinutes: 0,
      lateMinutes: 0,
      earlyMinutes: 0,
      otCandidateMinutes: 0,
      status: 'MIS',
      flags: ['SINGLE_PUNCH'],
      isNightShift,
      punchesCount: 1,
    };
  }

  // 2 or more punches: first = IN, last = OUT
  const firstIn = sortedPunches[0]!;
  const lastOut = sortedPunches[count - 1]!;

  const spanMinutes = diffInMinutes(firstIn, lastOut);

  // break deducted only when span > restAfter
  const breakDeduction = spanMinutes > restAfter ? shift.breakMinutes : 0;
  const workedMinutes = Math.max(0, spanMinutes - breakDeduction);

  // Late calculation:
  // Punch in vs scheduled shift start
  // In Asia/Kolkata (+05:30), extract hours and minutes
  const inHours = (firstIn.getUTCHours() + 5 + Math.floor((firstIn.getUTCMinutes() + 30) / 60)) % 24;
  const inMins = (firstIn.getUTCMinutes() + 30) % 60;
  const inMinuteOfDay = inHours * 60 + inMins;
  const shiftStartMin = timeToMinutes(shift.startTime);

  let lateMinutes = 0;
  if (!input.isWeeklyOff && !input.isHoliday) {
    const rawLate = inMinuteOfDay - shiftStartMin;
    if (rawLate > shift.graceInMinutes) {
      // Once grace is exceeded, full minutes count
      lateMinutes = rawLate;
    }
  }

  // Early calculation:
  let earlyMinutes = 0;
  if (!input.isWeeklyOff && !input.isHoliday) {
    const outHours = (lastOut.getUTCHours() + 5 + Math.floor((lastOut.getUTCMinutes() + 30) / 60)) % 24;
    const outMins = (lastOut.getUTCMinutes() + 30) % 60;
    let outMinuteOfDay = outHours * 60 + outMins;
    let shiftEndMin = timeToMinutes(shift.endTime);
    if (shiftEndMin < shiftStartMin) {
      // Crosses midnight
      shiftEndMin += 1440;
      if (outMinuteOfDay < shiftStartMin) {
        outMinuteOfDay += 1440;
      }
    }
    const rawEarly = shiftEndMin - outMinuteOfDay;
    const graceOut = shift.graceOutMinutes ?? 0;
    if (rawEarly > graceOut) {
      earlyMinutes = rawEarly;
    }
  }

  // Overtime candidate:
  // shift net minutes = (shift end - shift start) - break
  let shiftNetMin: number;
  let sEnd = timeToMinutes(shift.endTime);
  const sStart = timeToMinutes(shift.startTime);
  if (sEnd < sStart) sEnd += 1440;
  shiftNetMin = sEnd - sStart - shift.breakMinutes;

  let otCandidateMinutes = 0;
  const otBlock = shift.otBlockMinutes ?? 15;
  const otMin = shift.otMinMinutes ?? 30;

  if (input.isWeeklyOff || input.isHoliday) {
    // Work on WO / H can qualify directly as OT candidate or Comp-off
    if (workedMinutes >= otMin) {
      otCandidateMinutes = Math.floor(workedMinutes / otBlock) * otBlock;
    }
  } else {
    if (workedMinutes > shiftNetMin) {
      const excess = workedMinutes - shiftNetMin;
      if (excess >= otMin) {
        otCandidateMinutes = Math.floor(excess / otBlock) * otBlock;
      }
    }
  }

  if (workedMinutes > maxDaily) {
    flags.push('EXCEEDS_DAILY');
  }

  // Status assignment:
  let status: DayStatus;
  if (input.isWeeklyOff) {
    status = workedMinutes >= shift.halfDayMinutes ? 'WOP' : 'WO';
  } else if (input.isHoliday) {
    status = workedMinutes >= shift.halfDayMinutes ? 'HP' : 'H';
  } else {
    if (workedMinutes >= shift.fullDayMinutes) {
      status = 'P';
    } else if (workedMinutes >= shift.halfDayMinutes) {
      status = 'HD';
    } else {
      status = 'A';
    }
  }

  return {
    date: input.date,
    firstIn: firstIn.toISOString(),
    lastOut: lastOut.toISOString(),
    workedMinutes,
    lateMinutes: Math.max(0, lateMinutes),
    earlyMinutes: Math.max(0, earlyMinutes),
    otCandidateMinutes,
    status,
    flags,
    isNightShift,
    punchesCount: count,
  };
}

export interface PeriodSummaryInput {
  days: DayComputeResult[];
  unresolvedMisIsLop?: boolean; // default true
}

export interface PeriodSummaryResult {
  payableDays: number;
  presentDays: number;
  halfDays: number;
  weeklyOffDays: number;
  holidayDays: number;
  paidLeaveDays: number;
  lopDays: number;
  otMinutesTotal: number;
  nightShiftCount: number;
  lateMarksCount: number;
}

/**
 * Computes period summary for payroll handoff (Section 5 B)
 * payable = P + 0.5 * HD + WO + H + paid leave (+ WOP/HP counted as payable)
 * LOP = A + unresolved MIS + LOP leave + 0.5 * unpaid HD
 */
export function computePeriodSummary(input: PeriodSummaryInput): PeriodSummaryResult {
  let presentDays = 0;
  let halfDays = 0;
  let weeklyOffDays = 0;
  let holidayDays = 0;
  let paidLeaveDays = 0;
  let lopDays = 0;
  let otMinutesTotal = 0;
  let nightShiftCount = 0;
  let lateMarksCount = 0;

  const misIsLop = input.unresolvedMisIsLop ?? true;

  for (const d of input.days) {
    if (d.lateMinutes > 0) lateMarksCount++;
    if (d.isNightShift && d.workedMinutes > 0) nightShiftCount++;
    otMinutesTotal += d.otCandidateMinutes;

    switch (d.status) {
      case 'P':
        presentDays++;
        break;
      case 'HD':
        halfDays++;
        lopDays += 0.5;
        break;
      case 'WO':
        weeklyOffDays++;
        break;
      case 'WOP':
        weeklyOffDays++; // or counted in present
        presentDays++;
        break;
      case 'H':
        holidayDays++;
        break;
      case 'HP':
        holidayDays++;
        presentDays++;
        break;
      case 'L':
        paidLeaveDays++;
        break;
      case 'LHD':
        halfDays++;
        paidLeaveDays += 0.5;
        break;
      case 'A':
        lopDays++;
        break;
      case 'MIS':
        if (misIsLop) {
          lopDays++;
        }
        break;
    }
  }

  const payableDays =
    presentDays +
    0.5 * halfDays +
    weeklyOffDays +
    holidayDays +
    paidLeaveDays;

  return {
    payableDays,
    presentDays,
    halfDays,
    weeklyOffDays,
    holidayDays,
    paidLeaveDays,
    lopDays,
    otMinutesTotal,
    nightShiftCount,
    lateMarksCount,
  };
}

