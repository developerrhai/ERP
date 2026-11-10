// apps/api/src/modules/hr/hr-calc.ts
// Pure HR calculations for Attendance and Leave inside the CommonJS API module.

export interface ShiftConfig {
  code: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  graceInMinutes: number;
  graceOutMinutes?: number;
  fullDayMinutes: number;
  halfDayMinutes: number;
  absentBelowMinutes: number;
  otBlockMinutes?: number;
  otMinMinutes?: number;
  isNight?: boolean;
  restAfterMinutes?: number;
  maxDailyMinutes?: number;
}

export interface DayComputeInput {
  date: string;
  punches: Array<{ punchAt: Date | string }>;
  shift: ShiftConfig;
  isWeeklyOff?: boolean;
  isHoliday?: boolean;
}

export type DayStatus = 'P' | 'HD' | 'A' | 'WO' | 'H' | 'L' | 'LHD' | 'MIS' | 'WOP' | 'HP';

export interface DayComputeResult {
  date: string;
  firstIn: string | null;
  lastOut: string | null;
  workedMinutes: number;
  lateMinutes: number;
  earlyMinutes: number;
  otCandidateMinutes: number;
  status: DayStatus;
  flags: string[];
  isNightShift: boolean;
  punchesCount: number;
}

export function timeToMinutes(timeStr: string): number {
  const parts = timeStr.split(':');
  const h = parseInt(parts[0] ?? '0', 10);
  const m = parseInt(parts[1] ?? '0', 10);
  return h * 60 + m;
}

export function diffInMinutes(d1: Date, d2: Date): number {
  return Math.round((d2.getTime() - d1.getTime()) / (60 * 1000));
}

export function computeAttendanceDay(input: DayComputeInput): DayComputeResult {
  const flags: string[] = [];
  const shift = input.shift;
  const isNightShift = !!shift.isNight;
  const restAfter = shift.restAfterMinutes ?? 300;
  const maxDaily = shift.maxDailyMinutes ?? 540;

  const sortedPunches = input.punches
    .map((p) => (typeof p.punchAt === 'string' ? new Date(p.punchAt) : p.punchAt))
    .filter((d) => !isNaN(d.getTime()))
    .sort((a, b) => a.getTime() - b.getTime());

  const count = sortedPunches.length;

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

  const firstIn = sortedPunches[0]!;
  const lastOut = sortedPunches[count - 1]!;

  const spanMinutes = diffInMinutes(firstIn, lastOut);
  const breakDeduction = spanMinutes > restAfter ? shift.breakMinutes : 0;
  const workedMinutes = Math.max(0, spanMinutes - breakDeduction);

  const inHours = (firstIn.getUTCHours() + 5 + Math.floor((firstIn.getUTCMinutes() + 30) / 60)) % 24;
  const inMins = (firstIn.getUTCMinutes() + 30) % 60;
  const inMinuteOfDay = inHours * 60 + inMins;
  const shiftStartMin = timeToMinutes(shift.startTime);

  let lateMinutes = 0;
  if (!input.isWeeklyOff && !input.isHoliday) {
    const rawLate = inMinuteOfDay - shiftStartMin;
    if (rawLate > shift.graceInMinutes) {
      lateMinutes = rawLate;
    }
  }

  let earlyMinutes = 0;
  if (!input.isWeeklyOff && !input.isHoliday) {
    const outHours = (lastOut.getUTCHours() + 5 + Math.floor((lastOut.getUTCMinutes() + 30) / 60)) % 24;
    const outMins = (lastOut.getUTCMinutes() + 30) % 60;
    let outMinuteOfDay = outHours * 60 + outMins;
    let shiftEndMin = timeToMinutes(shift.endTime);
    if (shiftEndMin < shiftStartMin) {
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

  let sEnd = timeToMinutes(shift.endTime);
  const sStart = timeToMinutes(shift.startTime);
  if (sEnd < sStart) sEnd += 1440;
  const shiftNetMin = sEnd - sStart - shift.breakMinutes;

  let otCandidateMinutes = 0;
  const otBlock = shift.otBlockMinutes ?? 15;
  const otMin = shift.otMinMinutes ?? 30;

  if (input.isWeeklyOff || input.isHoliday) {
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

export function computePeriodSummary(input: {
  days: DayComputeResult[];
  unresolvedMisIsLop?: boolean;
}): {
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
} {
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
        weeklyOffDays++;
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

export function computeLeaveDays(input: {
  spanDays: Array<{ date: string; isWeeklyOff?: boolean; isHoliday?: boolean }>;
  sandwichRuleActive: boolean;
  isHalfDayFirst?: boolean;
  isHalfDayLast?: boolean;
}): {
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
        sandwichedDays += 1.0;
      }
    }
  }

  return {
    daysComputed: workingDays + sandwichedDays,
    sandwichedDays,
    workingDays,
  };
}

