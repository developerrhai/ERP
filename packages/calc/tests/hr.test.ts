import { describe, expect, it } from 'vitest';
import {
  computeAttendanceDay,
  computePeriodSummary,
  type ShiftConfig,
} from '../src/hr/attendance';
import {
  accrueEarnedLeave,
  computeLeaveDays,
  computeYearEndCarryForward,
  isCompOffExpired,
} from '../src/hr/leave';

describe('HR Calculations — §5 Official Examples', () => {
  const standardShift: ShiftConfig = {
    code: 'GEN',
    startTime: '07:00',
    endTime: '15:30',
    breakMinutes: 30,
    graceInMinutes: 10,
    graceOutMinutes: 0,
    fullDayMinutes: 450,
    halfDayMinutes: 240,
    absentBelowMinutes: 240,
    otBlockMinutes: 15,
    otMinMinutes: 30,
    restAfterMinutes: 300,
    maxDailyMinutes: 540,
  };

  it('computes Day example from §5 A (07:14 to 18:05)', () => {
    // 07:14 and 18:05 IST (+05:30)
    // 07:14 IST = 01:44 UTC
    // 18:05 IST = 12:35 UTC
    const date = '2027-02-15';
    const punches = [
      { punchAt: new Date('2027-02-15T01:44:00Z') }, // 07:14 IST
      { punchAt: new Date('2027-02-15T12:35:00Z') }, // 18:05 IST
    ];

    const res = computeAttendanceDay({
      date,
      punches,
      shift: standardShift,
    });

    expect(res.workedMinutes).toBe(621);
    expect(res.lateMinutes).toBe(14);
    expect(res.otCandidateMinutes).toBe(135);
    expect(res.status).toBe('P');
    expect(res.flags).toContain('EXCEEDS_DAILY');
  });

  it('computes Night shift example from §5 A (22:52 to 07:20 next day)', () => {
    const nightShift: ShiftConfig = {
      code: 'NIGHT',
      startTime: '23:00',
      endTime: '07:00',
      breakMinutes: 30,
      graceInMinutes: 10,
      graceOutMinutes: 0,
      fullDayMinutes: 450,
      halfDayMinutes: 240,
      absentBelowMinutes: 240,
      otBlockMinutes: 15,
      otMinMinutes: 30,
      restAfterMinutes: 300,
      maxDailyMinutes: 540,
      isNight: true,
    };

    // 22:52 IST = 17:22 UTC
    // 07:20 IST next day = 01:50 UTC next day
    const punches = [
      { punchAt: new Date('2027-02-15T17:22:00Z') }, // 22:52 IST
      { punchAt: new Date('2027-02-16T01:50:00Z') }, // 07:20 IST next day
    ];

    const res = computeAttendanceDay({
      date: '2027-02-15',
      punches,
      shift: nightShift,
    });

    expect(res.workedMinutes).toBe(478);
    expect(res.status).toBe('P');
    expect(res.isNightShift).toBe(true);
  });

  it('computes Single punch as MIS (§5 A)', () => {
    const res = computeAttendanceDay({
      date: '2027-02-15',
      punches: [{ punchAt: new Date('2027-02-15T01:30:00Z') }],
      shift: standardShift,
    });
    expect(res.status).toBe('MIS');
    expect(res.flags).toContain('SINGLE_PUNCH');
  });

  it('computes Leave accrual §5 C: 250 -> 13, 175 -> 0', () => {
    const rule = {
      daysPerWorked: 20,
      eligibilityDays: 180,
      roundingThreshold: 0.5,
    };

    expect(accrueEarnedLeave(250, rule)).toBe(13); // 250 / 20 = 12.5 -> 13
    expect(accrueEarnedLeave(175, rule)).toBe(0); // below 180 eligibility
    expect(accrueEarnedLeave(200, rule)).toBe(10); // 200 / 20 = 10
    expect(accrueEarnedLeave(248, rule)).toBe(12); // 248 / 20 = 12.4 -> 12
  });

  it('computes Year-end carry forward §5 C', () => {
    // 35 days closing, cap 30, not encashable -> carry 30, lapse 5
    const res1 = computeYearEndCarryForward({
      closingBalance: 35,
      carryForwardCap: 30,
      encashable: false,
    });
    expect(res1.carryForward).toBe(30);
    expect(res1.lapseDays).toBe(5);
    expect(res1.encashDays).toBe(0);

    // with encashment allowed
    const res2 = computeYearEndCarryForward({
      closingBalance: 35,
      carryForwardCap: 30,
      encashable: true,
    });
    expect(res2.carryForward).toBe(30);
    expect(res2.lapseDays).toBe(0);
    expect(res2.encashDays).toBe(5);
  });

  it('computes Sandwich leave §5 D (Friday + Weekend + Monday)', () => {
    const spanDays = [
      { date: '2027-02-12', isWeeklyOff: false }, // Friday
      { date: '2027-02-13', isWeeklyOff: true }, // Saturday
      { date: '2027-02-14', isWeeklyOff: true }, // Sunday
      { date: '2027-02-15', isWeeklyOff: false }, // Monday
    ];

    // Sandwich OFF -> 2 days
    const offRes = computeLeaveDays({
      spanDays,
      sandwichRuleActive: false,
    });
    expect(offRes.daysComputed).toBe(2);
    expect(offRes.sandwichedDays).toBe(0);

    // Sandwich ON -> 4 days
    const onRes = computeLeaveDays({
      spanDays,
      sandwichRuleActive: true,
    });
    expect(onRes.daysComputed).toBe(4);
    expect(onRes.sandwichedDays).toBe(2);
  });

  it('computes Comp-off expiry §5 E (90 days)', () => {
    expect(isCompOffExpired('2027-01-01', '2027-03-01', 90)).toBe(false); // 59 days
    expect(isCompOffExpired('2027-01-01', '2027-04-10', 90)).toBe(true); // > 90 days
  });

  it('computes Period summary §5 B payable & LOP days', () => {
    const summary = computePeriodSummary({
      days: [
        { date: '2027-02-01', workedMinutes: 480, status: 'P', otCandidateMinutes: 0, lateMinutes: 0, earlyMinutes: 0, flags: [], isNightShift: false, punchesCount: 2, firstIn: null, lastOut: null },
        { date: '2027-02-02', workedMinutes: 240, status: 'HD', otCandidateMinutes: 0, lateMinutes: 0, earlyMinutes: 0, flags: [], isNightShift: false, punchesCount: 2, firstIn: null, lastOut: null },
        { date: '2027-02-03', workedMinutes: 0, status: 'A', otCandidateMinutes: 0, lateMinutes: 0, earlyMinutes: 0, flags: [], isNightShift: false, punchesCount: 0, firstIn: null, lastOut: null },
        { date: '2027-02-04', workedMinutes: 0, status: 'WO', otCandidateMinutes: 0, lateMinutes: 0, earlyMinutes: 0, flags: [], isNightShift: false, punchesCount: 0, firstIn: null, lastOut: null },
        { date: '2027-02-05', workedMinutes: 0, status: 'L', otCandidateMinutes: 0, lateMinutes: 0, earlyMinutes: 0, flags: [], isNightShift: false, punchesCount: 0, firstIn: null, lastOut: null },
      ],
      unresolvedMisIsLop: true,
    });

    // 1 P + 0.5 HD + 1 WO + 1 L = 3.5 payable
    expect(summary.payableDays).toBe(3.5);
    // 0.5 HD + 1 A = 1.5 LOP
    expect(summary.lopDays).toBe(1.5);
    expect(summary.presentDays).toBe(1);
    expect(summary.halfDays).toBe(1);
  });
});

