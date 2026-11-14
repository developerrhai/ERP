import { describe, it, expect } from 'vitest';
import {
  computeAttendanceDay,
  computePeriodSummary,
  computeLeaveDays,
  type ShiftConfig,
  type DayComputeResult,
} from '../src/modules/hr/hr-calc';
import { HrCrypto } from '../src/modules/hr/hr-crypto';

describe('Phase 15 HRMS Unit Tests', () => {
  it('Verhoeff Aadhaar checksum validator works correctly', () => {
    expect(HrCrypto.validateVerhoeff('999999990019')).toBe(true);
    expect(HrCrypto.validateVerhoeff('999999990018')).toBe(false);
    expect(HrCrypto.validateVerhoeff('12345')).toBe(false);
  });

  it('AES-256-GCM Aadhaar and Bank vault encryption and decryption', () => {
    const rawAadhaar = '999999990019';
    const cipherAadhaar = HrCrypto.encryptAadhaar(rawAadhaar);
    expect(cipherAadhaar.startsWith('v1:')).toBe(true);
    expect(HrCrypto.decryptAadhaar(cipherAadhaar)).toBe(rawAadhaar);
    expect(HrCrypto.maskAadhaar(rawAadhaar)).toBe('XXXX-XXXX-0019');

    const rawBank = '50100123456789';
    const cipherBank = HrCrypto.encryptBank(rawBank);
    expect(cipherBank.startsWith('v1:')).toBe(true);
    expect(HrCrypto.decryptBank(cipherBank)).toBe(rawBank);
    expect(HrCrypto.maskAccount(rawBank)).toBe('XXXXXXXXXX6789');
  });

  it('IFSC validation works for standard RBI codes', () => {
    expect(HrCrypto.validateIfsc('HDFC0001234')).toBe(true);
    expect(HrCrypto.validateIfsc('SBIN0000300')).toBe(true);
    expect(HrCrypto.validateIfsc('INVALID123')).toBe(false);
  });

  it('Attendance Algorithm A: On-time full day detection', () => {
    const shift: ShiftConfig = {
      code: 'GEN',
      startTime: '09:00',
      endTime: '18:00',
      graceInMinutes: 15,
      graceOutMinutes: 15,
      halfDayMinutes: 240,
      fullDayMinutes: 480,
      breakMinutes: 60,
      absentBelowMinutes: 240,
    };

    const punches = [
      { punchAt: new Date('2027-02-01T03:28:00Z') }, // 08:58 IST
      { punchAt: new Date('2027-02-01T12:32:00Z') }, // 18:02 IST
    ];

    const res = computeAttendanceDay({
      date: '2027-02-01',
      shift,
      punches,
    });
    expect(res.status).toBe('P');
    expect(res.workedMinutes).toBeGreaterThanOrEqual(480);
    expect(res.lateMinutes).toBe(0);
    expect(res.earlyMinutes).toBe(0);
  });

  it('Attendance Algorithm B: Period attendance summary calculation', () => {
    const days: DayComputeResult[] = [
      {
        date: '2027-02-01',
        firstIn: '2027-02-01T09:00:00Z',
        lastOut: '2027-02-01T18:00:00Z',
        workedMinutes: 480,
        lateMinutes: 0,
        earlyMinutes: 0,
        otCandidateMinutes: 120,
        status: 'P',
        flags: [],
        isNightShift: false,
        punchesCount: 2,
      },
      {
        date: '2027-02-02',
        firstIn: '2027-02-02T09:00:00Z',
        lastOut: '2027-02-02T18:00:00Z',
        workedMinutes: 480,
        lateMinutes: 0,
        earlyMinutes: 0,
        otCandidateMinutes: 0,
        status: 'P',
        flags: [],
        isNightShift: false,
        punchesCount: 2,
      },
      {
        date: '2027-02-03',
        firstIn: null,
        lastOut: null,
        workedMinutes: 0,
        lateMinutes: 0,
        earlyMinutes: 0,
        otCandidateMinutes: 0,
        status: 'A',
        flags: [],
        isNightShift: false,
        punchesCount: 0,
      },
      {
        date: '2027-02-04',
        firstIn: null,
        lastOut: null,
        workedMinutes: 0,
        lateMinutes: 0,
        earlyMinutes: 0,
        otCandidateMinutes: 0,
        status: 'WO',
        flags: [],
        isNightShift: false,
        punchesCount: 0,
      },
    ];

    const summary = computePeriodSummary({ days });
    expect(summary.presentDays).toBe(2);
    expect(summary.lopDays).toBe(1);
    expect(summary.weeklyOffDays).toBe(1);
    expect(summary.payableDays).toBe(3); // 2 Present + 1 Weekly Off
    expect(summary.otMinutesTotal).toBe(120);
  });

  it('Leave Algorithm D: Sandwich rule application over weekly-off', () => {
    const res = computeLeaveDays({
      spanDays: [
        { date: '2027-02-05' }, // Friday
        { date: '2027-02-06' }, // Saturday
        { date: '2027-02-07', isWeeklyOff: true }, // Sunday
        { date: '2027-02-08' }, // Monday
      ],
      sandwichRuleActive: true,
    });

    expect(res.daysComputed).toBe(4);
    expect(res.sandwichedDays).toBe(1);
    expect(res.workingDays).toBe(3);
  });
});
