import { describe, it, expect } from 'vitest';
import {
  calculateFreight,
  checkFreightVariance,
  analyzeFuelLog,
  computeStatutoryDueDate,
  evaluateStatutoryStatus,
  computeReturnableOverdue,
  evaluateDocumentExpiry,
  validateChallanNumber,
  validateEwayBill,
  validateIso6346Container,
  addYearsSafe,
} from '../src/logistics/index.js';

describe('Phase 18 Logistics, Fleet, Gate Pure Calculation Tests', () => {
  it('Freight Slab Worked Example: 2,350 kg -> ₹18,447.00 (RCM 5% = 922.35)', () => {
    const res = calculateFreight({
      basis: 'PER_KG_SLAB',
      weightKg: 2350,
      minCharge: 5000,
      fuelSurchargePct: 8,
      tollAmount: 1450,
      loadingAmount: 500,
      gtaRcmApplicable: true,
      slabs: [
        { fromQty: 0, toQty: 1000, rate: 8.0 },
        { fromQty: 1001, toQty: 5000, rate: 6.5 },
      ],
    });
    expect(res.baseAmount).toBe(15275);
    expect(res.fuelSurcharge).toBe(1222);
    expect(res.totalAmount).toBe(18447);
    expect(res.gtaRcmAmount).toBe(922.35);
  });

  it('Freight Minimum Charge & Per-KM Rule', () => {
    const minApplied = calculateFreight({
      basis: 'PER_KG_SLAB',
      weightKg: 300,
      minCharge: 5000,
      slabs: [{ fromQty: 0, toQty: 1000, rate: 8.0 }],
    });
    expect(minApplied.baseAmount).toBe(5000);

    const perKm = calculateFreight({
      basis: 'PER_KM',
      distanceKm: 410,
      flatRate: 48,
      minKm: 250,
    });
    expect(perKm.baseAmount).toBe(19680);

    const perKmMinApplied = calculateFreight({
      basis: 'PER_KM',
      distanceKm: 150,
      flatRate: 48,
      minKm: 250,
    });
    expect(perKmMinApplied.baseAmount).toBe(12000); // 250 * 48
  });

  it('Freight Variance > 2% flags approval required', () => {
    const ok = checkFreightVariance(10000, 10200); // exact 2.00%
    expect(ok.variancePct).toBe(2);
    expect(ok.requiresApproval).toBe(false);

    const over = checkFreightVariance(10000, 10250); // 2.50%
    expect(over.variancePct).toBe(2.5);
    expect(over.requiresApproval).toBe(true);
  });

  it('Fuel Full-Tank Worked Example: 4.00 km/l (-11.11% variance)', () => {
    const res = analyzeFuelLog({
      odometer: 120400,
      litres: 60,
      filledAt: '2026-11-10T10:00:00Z',
      isFullTank: true,
      tankCapacity: 220,
      stdKmpl: 4.5,
      prevLogs: [
        { odometer: 120000, litres: 120, filledAt: '2026-11-05T10:00:00Z', isFullTank: true },
        { odometer: 120180, litres: 40, filledAt: '2026-11-08T10:00:00Z', isFullTank: false },
      ],
    });
    expect(res.blocked).toBe(false);
    expect(res.kmpl).toBe(4.0);
    expect(res.variancePct).toBe(-11.11);
    expect(res.anomalies).toEqual([]);
  });

  it('Fuel Anomalies: ODO_BACKWARD, OVER_TANK, RAPID_REFILL, LOW_EFFICIENCY, HIGH_KM', () => {
    // ODO_BACKWARD + OVER_TANK
    const blockedRes = analyzeFuelLog({
      odometer: 119950,
      litres: 260,
      filledAt: '2026-11-10T10:00:00Z',
      isFullTank: true,
      tankCapacity: 220,
      stdKmpl: 4.5,
      prevLogs: [
        { odometer: 120400, litres: 60, filledAt: '2026-11-09T10:00:00Z', isFullTank: true },
      ],
    });
    expect(blockedRes.blocked).toBe(true);
    expect(blockedRes.anomalies).toContain('ODO_BACKWARD');
    expect(blockedRes.anomalies).toContain('OVER_TANK');

    // RAPID_REFILL (< 2h), HIGH_KM (> 1200 km/day), LOW_EFFICIENCY (< -15%)
    const warningRes = analyzeFuelLog({
      odometer: 121700, // +1300 km in 1 hour
      litres: 400,
      filledAt: '2026-11-09T11:00:00Z',
      isFullTank: true,
      tankCapacity: 500,
      stdKmpl: 4.5,
      prevLogs: [
        { odometer: 120400, litres: 100, filledAt: '2026-11-09T10:00:00Z', isFullTank: true },
      ],
    });
    expect(warningRes.blocked).toBe(false);
    expect(warningRes.anomalies).toContain('RAPID_REFILL');
    expect(warningRes.anomalies).toContain('HIGH_KM');
    expect(warningRes.anomalies).toContain('LOW_EFFICIENCY'); // 1300/400 = 3.25 km/l vs 4.5 = -27.78%
  });

  it('Job Work Statutory Dates & Overdue Alerts (including 29-Feb-2028)', () => {
    // Worked example: 2025-11-10 -> due 2026-11-10 -> on 2026-11-04 daysRemaining = 6 -> 7-day alert
    const due = computeStatutoryDueDate('2025-11-10', 'INPUT');
    expect(due).toBe('2026-11-10');
    const st = evaluateStatutoryStatus(due, '2026-11-04');
    expect(st.daysRemaining).toBe(6);
    expect(st.alertThreshold).toBe(7);
    expect(st.deemedSupplyRisk).toBe(false);

    // After due date -> deemedSupplyRisk = true
    const past = evaluateStatutoryStatus(due, '2026-11-11');
    expect(past.deemedSupplyRisk).toBe(true);

    // Capital goods: 3 years; tools: null
    expect(computeStatutoryDueDate('2025-02-28', 'CAPITAL_GOOD')).toBe('2028-02-28');
    expect(computeStatutoryDueDate('2025-11-10', 'TOOL_EXEMPT')).toBeNull();

    // Leap year boundary: 29-Feb-2024 + 4 years -> 29-Feb-2028; 29-Feb-2028 + 1 year -> 28-Feb-2029
    expect(addYearsSafe('2024-02-29', 4)).toBe('2028-02-29');
    expect(addYearsSafe('2028-02-29', 1)).toBe('2029-02-28');

    // Returnable overdue
    const ov = computeReturnableOverdue('2026-11-01', '2026-11-09', 4);
    expect(ov.overdueDays).toBe(8);
    expect(ov.alertThreshold).toBe(7);
  });

  it('Document Expiry Thresholds (30, 15, 7, 0)', () => {
    expect(evaluateDocumentExpiry('2026-12-10', '2026-11-10').alertThreshold).toBe(30);
    expect(evaluateDocumentExpiry('2026-11-25', '2026-11-10').alertThreshold).toBe(15);
    expect(evaluateDocumentExpiry('2026-11-17', '2026-11-10').alertThreshold).toBe(7);
    expect(evaluateDocumentExpiry('2026-11-10', '2026-11-10').alertThreshold).toBe(0);
    expect(evaluateDocumentExpiry('2026-11-03', '2026-11-10').status).toBe('EXPIRED');
  });

  it('ISO 6346 Container Check Digit Validator', () => {
    expect(validateIso6346Container('CSQU3054383').valid).toBe(true);
    expect(validateIso6346Container('CSQU3054384').valid).toBe(false);
    expect(validateIso6346Container('INVALID123').valid).toBe(false);
  });

  it('Challan Length <= 16 & E-Way Bill Vehicle Match', () => {
    expect(validateChallanNumber('RGP/SAW/26/00012').valid).toBe(true); // 16 chars
    expect(validateChallanNumber('RGP/SAW/26-27/0001').valid).toBe(false); // 18 chars

    expect(
      validateEwayBill({
        totalValueInr: 124500,
        isInterStateJobWork: false,
        ewayBillNo: '123456789012',
        ewayVehicleNo: 'MH12AB1234',
        gateVehicleNo: 'MH12AB1243',
      }).valid,
    ).toBe(false);

    expect(
      validateEwayBill({
        totalValueInr: 124500,
        isInterStateJobWork: false,
        ewayBillNo: '123456789012',
        ewayVehicleNo: 'MH12AB1234',
        gateVehicleNo: 'mh12ab1234',
      }).valid,
    ).toBe(true);
  });
});

