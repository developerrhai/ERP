export interface SlaPolicyConfig {
  responseMinutes: number;
  resolutionMinutes: number;
  pauseStatuses?: string[];
}

export function computeTicketPriority(impact: number, urgency: number): number {
  const p = impact + urgency - 1;
  return Math.max(1, Math.min(4, p));
}

export interface BusinessCalendarConfig {
  startHour: number; // e.g. 9
  startMinute: number; // e.g. 0
  endHour: number; // e.g. 18
  endMinute: number; // e.g. 0
  workingDays: number[]; // e.g. [1, 2, 3, 4, 5] for Mon-Fri (0=Sun, 6=Sat)
  holidays?: Set<string>; // 'YYYY-MM-DD'
}

export const DEFAULT_BUSINESS_CALENDAR: BusinessCalendarConfig = {
  startHour: 9,
  startMinute: 0,
  endHour: 18,
  endMinute: 0,
  workingDays: [1, 2, 3, 4, 5], // Mon to Fri
  holidays: new Set<string>(),
};

function formatIsoDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function isWorkingDay(d: Date, cal: BusinessCalendarConfig): boolean {
  // IST offset is UTC + 5:30
  const istDate = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
  const dayOfWeek = istDate.getUTCDay();
  if (!cal.workingDays.includes(dayOfWeek)) {
    return false;
  }
  const dateStr = formatIsoDate(istDate);
  if (cal.holidays && cal.holidays.has(dateStr)) {
    return false;
  }
  return true;
}

export function addBusinessMinutes(
  startDate: Date,
  minutesToAdd: number,
  cal: BusinessCalendarConfig = DEFAULT_BUSINESS_CALENDAR,
): Date {
  if (minutesToAdd <= 0) return new Date(startDate);

  // Work with IST timestamps
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  let currentMs = startDate.getTime() + istOffsetMs;
  let remainingMinutes = minutesToAdd;

  const dayStartMinutes = cal.startHour * 60 + cal.startMinute; // 9 * 60 = 540
  const dayEndMinutes = cal.endHour * 60 + cal.endMinute; // 18 * 60 = 1080
  const minutesPerDay = dayEndMinutes - dayStartMinutes; // 540

  while (remainingMinutes > 0) {
    const d = new Date(currentMs);
    const dayOfWeek = d.getUTCDay();
    const dateStr = formatIsoDate(d);
    const isWork = cal.workingDays.includes(dayOfWeek) && !(cal.holidays && cal.holidays.has(dateStr));

    const currentMinuteOfDay = d.getUTCHours() * 60 + d.getUTCMinutes();

    if (!isWork || currentMinuteOfDay >= dayEndMinutes) {
      // Advance to next day's 09:00
      d.setUTCDate(d.getUTCDate() + 1);
      d.setUTCHours(cal.startHour, cal.startMinute, 0, 0);
      currentMs = d.getTime();
      continue;
    }

    if (currentMinuteOfDay < dayStartMinutes) {
      // Move to today's 09:00
      d.setUTCHours(cal.startHour, cal.startMinute, 0, 0);
      currentMs = d.getTime();
      continue;
    }

    // Currently within business hours
    const availableToday = dayEndMinutes - currentMinuteOfDay;
    if (remainingMinutes <= availableToday) {
      currentMs += remainingMinutes * 60 * 1000;
      remainingMinutes = 0;
    } else {
      remainingMinutes -= availableToday;
      // Advance to next day's start
      d.setUTCDate(d.getUTCDate() + 1);
      d.setUTCHours(cal.startHour, cal.startMinute, 0, 0);
      currentMs = d.getTime();
    }
  }

  return new Date(currentMs - istOffsetMs);
}

export function computeSlaDueDates(params: {
  createdAt: Date;
  responseMinutes: number;
  resolutionMinutes: number;
  pausedMinutes?: number;
  calendar?: BusinessCalendarConfig;
}): {
  responseDueAt: Date;
  resolutionDueAt: Date;
  warningAt: Date;
} {
  const cal = params.calendar ?? DEFAULT_BUSINESS_CALENDAR;
  const paused = params.pausedMinutes ?? 0;

  const responseDueAt = addBusinessMinutes(params.createdAt, params.responseMinutes, cal);
  const totalResolutionMins = params.resolutionMinutes + paused;
  const resolutionDueAt = addBusinessMinutes(params.createdAt, totalResolutionMins, cal);

  const warningMins = Math.round(params.resolutionMinutes * 0.75) + paused;
  const warningAt = addBusinessMinutes(params.createdAt, warningMins, cal);

  return {
    responseDueAt,
    resolutionDueAt,
    warningAt,
  };
}

