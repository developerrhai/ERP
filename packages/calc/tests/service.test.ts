import { describe, it, expect } from 'vitest';
import {
  computeTicketPriority,
  addBusinessMinutes,
  computeSlaDueDates,
  scoreAndSelectTechnician,
  computeAmcRevenueSchedule,
  computeWarrantyEndDate,
  evaluateWarrantyEligibility,
  type BusinessCalendarConfig,
} from '../src/service/index.js';

describe('Phase 17 Service Unit Tests', () => {
  it('Priority Matrix: clamps impact + urgency - 1 to P1-P4', () => {
    expect(computeTicketPriority(3, 3)).toBe(4); // Impact 3 + Urgency 3 - 1 = 5 -> clamp 4 (P4)
    expect(computeTicketPriority(2, 2)).toBe(3); // P3
    expect(computeTicketPriority(2, 1)).toBe(2); // P2
    expect(computeTicketPriority(1, 1)).toBe(1); // P1
  });

  it('SLA Timer §5: P2 created Friday 16:30, 2h response / 8h resolution + 2h pause', () => {
    // Friday 2027-02-05 16:30 IST
    // IST is UTC + 5:30 -> 16:30 IST is 11:00 UTC
    const createdUtc = new Date(Date.UTC(2027, 1, 5, 11, 0, 0)); // 2027-02-05 16:30 IST

    const calendar: BusinessCalendarConfig = {
      startHour: 9,
      startMinute: 0,
      endHour: 18,
      endMinute: 0,
      workingDays: [1, 2, 3, 4, 5], // Mon to Fri
      holidays: new Set<string>(),
    };

    const due = computeSlaDueDates({
      createdAt: createdUtc,
      responseMinutes: 120, // 2 hours
      resolutionMinutes: 480, // 8 hours
      pausedMinutes: 120, // 2 hours paused (Awaiting Customer)
      calendar,
    });

    // Response due: Friday 16:30 to 18:00 is 90 min. Sat/Sun off. Monday 09:00 + 30 min = 09:30 IST (04:00 UTC)
    const respIstHours = (due.responseDueAt.getUTCHours() + 5.5) % 24;
    const respIstMinutes = (due.responseDueAt.getUTCMinutes() + 30) % 60;
    expect(due.responseDueAt.getUTCDay()).toBe(1); // Monday
    expect(Math.floor(respIstHours)).toBe(9);
    expect(respIstMinutes).toBe(30);

    // Resolution due: Friday 90 min. Monday 09:00 + (480-90 = 390 min = 6.5h) -> 15:30 IST.
    // + 120 min paused -> 17:30 IST (12:00 UTC)
    const resIstHours = (due.resolutionDueAt.getUTCHours() + 5.5) % 24;
    const resIstMinutes = (due.resolutionDueAt.getUTCMinutes() + 30) % 60;
    expect(due.resolutionDueAt.getUTCDay()).toBe(1); // Monday
    expect(Math.floor(resIstHours)).toBe(17);
    expect(resIstMinutes).toBe(30);

    // Resolved at 17:10 IST (11:40 UTC) -> Met
    const resolvedUtc = new Date(Date.UTC(2027, 1, 8, 11, 40, 0));
    expect(resolvedUtc.getTime()).toBeLessThan(due.resolutionDueAt.getTime());
  });

  it('Technician Auto-Assignment §5: Weights skill 0.5, load 0.3, proximity 0.2', () => {
    const candidates = [
      {
        id: 'tech-1',
        employeeCode: 'E001',
        name: 'T1',
        skillLevel: 4,
        openJobs: 2,
        maxJobs: 5,
        territoryMatch: 'EXACT' as const,
      },
      {
        id: 'tech-2',
        employeeCode: 'E002',
        name: 'T2',
        skillLevel: 3,
        openJobs: 1,
        maxJobs: 5,
        territoryMatch: 'PARENT' as const,
      },
      {
        id: 'tech-3',
        employeeCode: 'E003',
        name: 'T3',
        skillLevel: 5,
        openJobs: 4,
        maxJobs: 5,
        territoryMatch: 'NONE' as const, // Excluded
      },
    ];

    const chosen = scoreAndSelectTechnician(candidates, 3);
    expect(chosen).not.toBeNull();
    expect(chosen?.technicianId).toBe('tech-1');
  });

  it('AMC Revenue Recognition §5: Daily straight-line 365 days and mid-month start', () => {
    // 1-Apr-2026 to 31-Mar-2027 (365 days), contract value ₹1,20,000
    const sched = computeAmcRevenueSchedule('2026-04-01', '2027-03-31', 120000);
    expect(sched.totalContractDays).toBe(365);
    expect(sched.months.length).toBe(12);

    // April (30 days): 30 * 1,20,000 / 365 = 9863.01
    expect(sched.months[0]?.periodMonth).toBe('2026-04');
    expect(sched.months[0]?.daysCount).toBe(30);
    expect(sched.months[0]?.amount).toBe(9863.01);

    // Sum of all 12 months equals exactly 1,20,000.00
    const totalRec = sched.months.reduce((acc, m) => acc + m.amount, 0);
    expect(Math.round(totalRec * 100) / 100).toBe(120000);

    // Mid-month start: 15-Apr-2026 to 14-Apr-2027
    const midSched = computeAmcRevenueSchedule('2026-04-15', '2027-04-14', 120000);
    // April has 16 days (Apr 15 to Apr 30 inclusive): 16 * 120000 / 365 = 5260.27
    expect(midSched.months[0]?.daysCount).toBe(16);
    expect(midSched.months[0]?.amount).toBe(5260.27);
  });

  it('Warranty calculation §5: End date calculation and eligibility evaluation', () => {
    // 2026-01-10 + 18 months -> 2027-07-09
    expect(computeWarrantyEndDate('2026-01-10', 18)).toBe('2027-07-09');

    // Leap year handling: 2028-02-29 + 12 months -> 2029-02-28
    expect(computeWarrantyEndDate('2028-02-29', 12)).toBe('2029-02-28');

    // Eligibility check
    const valid = evaluateWarrantyEligibility({
      hasSalesInvoice: true,
      isRegistrationActive: true,
      warrantyStartDate: '2026-01-10',
      warrantyEndDate: '2027-07-09',
      failureDate: '2026-08-15',
      isCustomerMatchOrTransferred: true,
    });
    expect(valid.status).toBe('IN_WARRANTY');
    expect(valid.isEligible).toBe(true);

    // Out of warranty
    const expired = evaluateWarrantyEligibility({
      hasSalesInvoice: true,
      isRegistrationActive: true,
      warrantyStartDate: '2026-01-10',
      warrantyEndDate: '2027-07-09',
      failureDate: '2027-08-10',
      isCustomerMatchOrTransferred: true,
      isAmcActive: false,
    });
    expect(expired.status).toBe('OUT_OF_WARRANTY');
    expect(expired.isEligible).toBe(false);

    // Covered under AMC when out of standard warranty
    const amcCovered = evaluateWarrantyEligibility({
      hasSalesInvoice: true,
      isRegistrationActive: true,
      warrantyStartDate: '2026-01-10',
      warrantyEndDate: '2027-07-09',
      failureDate: '2027-08-10',
      isCustomerMatchOrTransferred: true,
      isAmcActive: true,
    });
    expect(amcCovered.status).toBe('AMC_COVERED');
    expect(amcCovered.isEligible).toBe(true);
  });
});

