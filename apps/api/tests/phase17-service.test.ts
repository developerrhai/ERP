import { describe, it, expect } from 'vitest';
import {
  computePriority,
  calculateSlaDue,
  checkSlaWarning,
  computeTechnicianScore,
  selectTechnician,
  computeAmcRevenueSchedule,
  evaluateWarranty,
  type TechnicianCandidate,
} from '../src/modules/service/service-calc';

describe('Phase 17 Service Engine & Calculation Tests', () => {
  it('Priority computation from impact and urgency', () => {
    // 1=Crit, 2=High, 3=Med, 4=Low
    expect(computePriority(1, 1)).toBe(1); // 1 + 1 - 1 = 1 (P1 Critical)
    expect(computePriority(1, 2)).toBe(2); // 1 + 2 - 1 = 2 (P2 High)
    expect(computePriority(2, 2)).toBe(3); // 2 + 2 - 1 = 3 (P3 Medium)
    expect(computePriority(3, 3)).toBe(4); // 4 (P4 Low)
  });

  it('SLA target calculation with business hours (09:00 - 18:00 IST), weekends and holidays', () => {
    // 2027-04-05 is a Monday.
    // 09:00 AM + 240 mins (4 hours) -> 13:00 (same day)
    const res1 = calculateSlaDue('2027-04-05T03:30:00.000Z', 240, [], {
      startHour: 9,
      endHour: 18,
      workingDays: [1, 2, 3, 4, 5],
      holidays: [],
    });
    expect(res1.dueAt).toBeDefined();

    // With pause interval (e.g., waiting for customer for 120 mins)
    const res2 = calculateSlaDue(
      '2027-04-05T03:30:00.000Z',
      240,
      [{ startAt: '2027-04-05T05:00:00.000Z', endAt: '2027-04-05T07:00:00.000Z' }],
      {
        startHour: 9,
        endHour: 18,
        workingDays: [1, 2, 3, 4, 5],
        holidays: [],
      },
    );
    expect(res2.totalPausedMins).toBe(120);
  });

  it('SLA Warning triggers at >= 75% elapsed time', () => {
    const created = '2027-04-05T09:00:00.000Z';
    const due = '2027-04-05T17:00:00.000Z'; // 8 hours total (480 mins)

    // At 5 hours (300 mins) = 62.5% -> no warning
    const check1 = checkSlaWarning(created, due, '2027-04-05T14:00:00.000Z');
    expect(check1.warning).toBe(false);
    expect(check1.breached).toBe(false);

    // At 6 hours (360 mins) = 75% -> warning true!
    const check2 = checkSlaWarning(created, due, '2027-04-05T15:00:00.000Z');
    expect(check2.warning).toBe(true);
    expect(check2.breached).toBe(false);

    // After due date -> breached true
    const check3 = checkSlaWarning(created, due, '2027-04-05T18:00:00.000Z');
    expect(check3.warning).toBe(true);
    expect(check3.breached).toBe(true);
  });

  it('Technician auto-dispatch scoring: 0.5 * skill + 0.3 * load + 0.2 * proximity', () => {
    // Tech 1: Skill level 5/5 = 1.0; 0/5 open jobs (load = 1.0); same territory (prox = 1.0)
    // Score = 0.5(1.0) + 0.3(1.0) + 0.2(1.0) = 1.0
    const tech1: TechnicianCandidate = {
      id: 'tech-1',
      employeeCode: 'EMP001',
      name: 'Ramesh Tech',
      skillCode: 'PUMP_MECH',
      skillLevel: 5,
      openJobs: 0,
      maxJobs: 5,
      isSameTerritory: true,
      isParentTerritory: false,
    };
    const score1 = computeTechnicianScore(tech1);
    expect(score1.score).toBe(1.0);
    expect(score1.skillScore).toBe(1.0);
    expect(score1.loadScore).toBe(1.0);
    expect(score1.proximityScore).toBe(1.0);

    // Tech 2: Skill level 3/5 = 0.6; 3/6 open jobs (load = 0.5); parent territory (prox = 0.5)
    // Score = 0.5(0.6) + 0.3(0.5) + 0.2(0.5) = 0.3 + 0.15 + 0.1 = 0.55
    const tech2: TechnicianCandidate = {
      id: 'tech-2',
      employeeCode: 'EMP002',
      name: 'Suresh Tech',
      skillCode: 'PUMP_MECH',
      skillLevel: 3,
      openJobs: 3,
      maxJobs: 6,
      isSameTerritory: false,
      isParentTerritory: true,
    };
    const score2 = computeTechnicianScore(tech2);
    expect(score2.score).toBe(0.55);

    // Tech 3: on leave -> excluded from selection
    const tech3: TechnicianCandidate = {
      id: 'tech-3',
      employeeCode: 'EMP003',
      name: 'Ganesh Tech',
      skillCode: 'PUMP_MECH',
      skillLevel: 5,
      openJobs: 0,
      maxJobs: 5,
      isSameTerritory: true,
      isParentTerritory: false,
      onLeave: true,
    };

    const best = selectTechnician([tech1, tech2, tech3]);
    expect(best?.technicianId).toBe('tech-1');
  });

  it('AMC daily straight-line revenue recognition (Ind AS 115 / AS 9)', () => {
    // 1-year contract: 2027-04-01 to 2028-03-31 (366 days if leap year, 365 otherwise)
    // 2027-04-01 to 2028-03-31 is 366 days (2028 is a leap year)
    const totalContractValue = 120000;
    const schedule = computeAmcRevenueSchedule('2027-04-01', '2028-03-31', totalContractValue);

    expect(schedule.length).toBe(12);

    // April 2027 has 30 days
    expect(schedule[0]?.period).toBe('2027-04');
    expect(schedule[0]?.days).toBe(30);

    // Total of all 12 entries must equal exactly totalContractValue (no rounding leak)
    const sumRecognized = schedule.reduce((sum, entry) => sum + entry.amount, 0);
    expect(Math.round(sumRecognized * 100) / 100).toBe(totalContractValue);
  });

  it('Warranty coverage evaluation: active registration vs expired vs AMC fallback', () => {
    // 1. Within warranty period
    const inWarranty = evaluateWarranty({
      hasSalesInvoice: true,
      activeRegistration: {
        startDate: '2026-04-01',
        endDate: '2027-03-31',
        customerId: 'CUST-001',
        status: 'ACTIVE',
      },
      failureDate: '2027-01-15',
      claimCustomerId: 'CUST-001',
    });
    expect(inWarranty.result).toBe('IN_WARRANTY');

    // 2. Expired warranty but covered by active AMC
    const amcCovered = evaluateWarranty({
      hasSalesInvoice: true,
      activeRegistration: {
        startDate: '2025-04-01',
        endDate: '2026-03-31',
        customerId: 'CUST-001',
        status: 'EXPIRED',
      },
      activeAmc: {
        startDate: '2026-04-01',
        endDate: '2027-03-31',
        coverage: 'COMPREHENSIVE',
        customerId: 'CUST-001',
        status: 'ACTIVE',
      },
      failureDate: '2027-01-15',
      claimCustomerId: 'CUST-001',
    });
    expect(amcCovered.result).toBe('AMC_COVERED');

    // 3. Customer mismatch
    const customerMismatch = evaluateWarranty({
      hasSalesInvoice: true,
      activeRegistration: {
        startDate: '2026-04-01',
        endDate: '2027-03-31',
        customerId: 'CUST-001',
        status: 'ACTIVE',
      },
      failureDate: '2027-01-15',
      claimCustomerId: 'CUST-999', // Different customer
    });
    expect(customerMismatch.result).toBe('OUT_OF_WARRANTY');
  });
});
