/**
 * Pure calculation engine for Logistics, Fleet, Gate & DMS (CommonJS compatible for apps/api)
 */

export type FreightBasis = 'PER_KG_SLAB' | 'PER_KM' | 'PER_TRIP' | 'PER_CBM';
export type FuelAnomalyCode =
  | 'ODO_BACKWARD'
  | 'OVER_TANK'
  | 'RAPID_REFILL'
  | 'LOW_EFFICIENCY'
  | 'HIGH_KM';
export type JobWorkCategory = 'INPUT' | 'CAPITAL_GOOD' | 'TOOL_EXEMPT' | 'NONE';

export interface FreightSlab {
  fromQty: number;
  toQty: number;
  rate: number;
}

export interface FreightInput {
  basis: FreightBasis;
  weightKg?: number;
  volumeCbm?: number;
  distanceKm?: number;
  flatRate?: number;
  minCharge?: number;
  minKm?: number;
  fuelSurchargePct?: number;
  tollAmount?: number;
  loadingAmount?: number;
  otherAmount?: number;
  gtaRcmApplicable?: boolean;
  slabs?: FreightSlab[];
}

export interface FreightCalculationResult {
  baseAmount: number;
  appliedRate: number;
  fuelSurcharge: number;
  tollAmount: number;
  loadingAmount: number;
  otherAmount: number;
  totalAmount: number;
  gtaRcmAmount: number;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function calculateFreight(input: FreightInput): FreightCalculationResult {
  const minCharge = input.minCharge ?? 0;
  let appliedRate = input.flatRate ?? 0;
  let rawBase = 0;

  if (input.basis === 'PER_KG_SLAB') {
    const w = Math.max(0, input.weightKg ?? 0);
    const slabs = [...(input.slabs ?? [])].sort((a, b) => a.fromQty - b.fromQty);
    let matched = slabs.find((s) => w >= s.fromQty && w <= s.toQty);
    if (!matched && slabs.length > 0) {
      matched = w > slabs[slabs.length - 1]!.toQty ? slabs[slabs.length - 1] : slabs[0];
    }
    if (matched) appliedRate = matched.rate;
    rawBase = w * appliedRate;
  } else if (input.basis === 'PER_KM') {
    const d = Math.max(input.minKm ?? 0, Math.max(0, input.distanceKm ?? 0));
    rawBase = d * appliedRate;
  } else if (input.basis === 'PER_CBM') {
    const v = Math.max(0, input.volumeCbm ?? 0);
    rawBase = v * appliedRate;
  } else if (input.basis === 'PER_TRIP') {
    rawBase = appliedRate;
  }

  const baseAmount = round2(Math.max(rawBase, minCharge));
  const fuelSurcharge = round2((baseAmount * (input.fuelSurchargePct ?? 0)) / 100);
  const tollAmount = round2(input.tollAmount ?? 0);
  const loadingAmount = round2(input.loadingAmount ?? 0);
  const otherAmount = round2(input.otherAmount ?? 0);
  const totalAmount = round2(baseAmount + fuelSurcharge + tollAmount + loadingAmount + otherAmount);
  const gtaRcmAmount = input.gtaRcmApplicable ? round2(totalAmount * 0.05) : 0;

  return {
    baseAmount,
    appliedRate,
    fuelSurcharge,
    tollAmount,
    loadingAmount,
    otherAmount,
    totalAmount,
    gtaRcmAmount,
  };
}

export function checkFreightVariance(
  calculatedTotal: number,
  billedAmount: number,
): { varianceAmount: number; variancePct: number; requiresApproval: boolean } {
  const varianceAmount = round2(billedAmount - calculatedTotal);
  const variancePct =
    calculatedTotal <= 0
      ? billedAmount > 0
        ? 100
        : 0
      : round2((varianceAmount / calculatedTotal) * 100);
  return {
    varianceAmount,
    variancePct,
    requiresApproval: variancePct > 2,
  };
}

export interface PrevFuelLog {
  odometer: number;
  litres: number;
  filledAt: string;
  isFullTank: boolean;
}

export interface FuelAnalysisInput {
  odometer: number;
  litres: number;
  filledAt: string;
  isFullTank: boolean;
  tankCapacity: number;
  stdKmpl: number;
  prevLogs: PrevFuelLog[];
}

export interface FuelAnalysisResult {
  kmpl: number | null;
  variancePct: number | null;
  anomalies: FuelAnomalyCode[];
  blocked: boolean;
  blockReason: string | null;
}

export function analyzeFuelLog(input: FuelAnalysisInput): FuelAnalysisResult {
  const anomalies: FuelAnomalyCode[] = [];
  let blocked = false;
  let blockReason: string | null = null;

  const sortedPrev = [...input.prevLogs].sort(
    (a, b) => new Date(a.filledAt).getTime() - new Date(b.filledAt).getTime(),
  );
  const lastLog = sortedPrev.length > 0 ? sortedPrev[sortedPrev.length - 1] : null;

  if (lastLog && input.odometer < lastLog.odometer) {
    anomalies.push('ODO_BACKWARD');
    blocked = true;
    blockReason = `Odometer ${input.odometer} is lower than last reading ${lastLog.odometer}.`;
  }

  if (input.tankCapacity > 0 && input.litres > input.tankCapacity * 1.05) {
    anomalies.push('OVER_TANK');
    blocked = true;
    if (!blockReason) {
      blockReason = `Fuel ${input.litres} L exceeds tank capacity ${input.tankCapacity} L.`;
    }
  }

  if (lastLog) {
    const currTs = new Date(input.filledAt).getTime();
    const lastTs = new Date(lastLog.filledAt).getTime();
    const diffHours = (currTs - lastTs) / (1000 * 60 * 60);
    if (diffHours >= 0 && diffHours < 2) anomalies.push('RAPID_REFILL');

    const dist = input.odometer - lastLog.odometer;
    const diffDays = Math.max(diffHours / 24, 1);
    if (dist > 0 && dist / diffDays > 1200) anomalies.push('HIGH_KM');
  }

  let kmpl: number | null = null;
  let variancePct: number | null = null;

  if (input.isFullTank && !blocked) {
    let lastFullIdx = -1;
    for (let i = sortedPrev.length - 1; i >= 0; i--) {
      if (sortedPrev[i]!.isFullTank) {
        lastFullIdx = i;
        break;
      }
    }
    if (lastFullIdx >= 0) {
      const baseFull = sortedPrev[lastFullIdx]!;
      const distance = input.odometer - baseFull.odometer;
      let totalLitres = input.litres;
      for (let i = lastFullIdx + 1; i < sortedPrev.length; i++) {
        totalLitres += sortedPrev[i]!.litres;
      }
      if (distance > 0 && totalLitres > 0) {
        kmpl = round2(distance / totalLitres);
        if (input.stdKmpl > 0) {
          variancePct = round2(((kmpl - input.stdKmpl) / input.stdKmpl) * 100);
          if (variancePct < -15) anomalies.push('LOW_EFFICIENCY');
        }
      }
    }
  }

  return { kmpl, variancePct, anomalies, blocked, blockReason };
}

const MS_PER_DAY = 1000 * 60 * 60 * 24;

function parseDateUtc(isoDate: string): Date {
  const [y, m, d] = isoDate.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
}

function formatDateUtc(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addYearsSafe(isoDate: string, years: number): string {
  const src = parseDateUtc(isoDate);
  const y = src.getUTCFullYear() + years;
  const m = src.getUTCMonth();
  const day = src.getUTCDate();
  const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return formatDateUtc(new Date(Date.UTC(y, m, Math.min(day, daysInMonth))));
}

export function diffDays(fromIso: string, toIso: string): number {
  return Math.round((parseDateUtc(toIso).getTime() - parseDateUtc(fromIso).getTime()) / MS_PER_DAY);
}

export function computeStatutoryDueDate(
  dispatchDate: string,
  category: JobWorkCategory,
): string | null {
  if (category === 'INPUT') return addYearsSafe(dispatchDate, 1);
  if (category === 'CAPITAL_GOOD') return addYearsSafe(dispatchDate, 3);
  return null;
}

export function evaluateStatutoryStatus(statutoryDueDate: string | null, currentDate: string) {
  if (!statutoryDueDate) {
    return { daysRemaining: null, alertThreshold: null as 60 | 30 | 7 | null, deemedSupplyRisk: false };
  }
  const daysRemaining = diffDays(currentDate, statutoryDueDate);
  if (daysRemaining < 0) {
    return { daysRemaining, alertThreshold: null as 60 | 30 | 7 | null, deemedSupplyRisk: true };
  }
  let alertThreshold: 60 | 30 | 7 | null = null;
  if (daysRemaining <= 7) alertThreshold = 7;
  else if (daysRemaining <= 30) alertThreshold = 30;
  else if (daysRemaining <= 60) alertThreshold = 60;
  return { daysRemaining, alertThreshold, deemedSupplyRisk: false };
}

export function computeReturnableOverdue(
  expectedReturnDate: string | null,
  currentDate: string,
  balanceQty: number,
) {
  if (!expectedReturnDate || balanceQty <= 0) {
    return { overdueDays: 0, alertThreshold: null as 1 | 7 | 30 | null };
  }
  const overdueDays = diffDays(expectedReturnDate, currentDate);
  if (overdueDays <= 0) return { overdueDays: 0, alertThreshold: null as 1 | 7 | 30 | null };
  let alertThreshold: 1 | 7 | 30 | null = null;
  if (overdueDays >= 30) alertThreshold = 30;
  else if (overdueDays >= 7) alertThreshold = 7;
  else if (overdueDays >= 1) alertThreshold = 1;
  return { overdueDays, alertThreshold };
}

export function evaluateDocumentExpiry(expiryDate: string, currentDate: string) {
  const daysRemaining = diffDays(currentDate, expiryDate);
  if (daysRemaining < 0) {
    return { daysRemaining, status: 'EXPIRED' as const, alertThreshold: 0 as 30 | 15 | 7 | 0 | null };
  }
  if (daysRemaining === 0) {
    return { daysRemaining: 0, status: 'EXPIRING' as const, alertThreshold: 0 as 30 | 15 | 7 | 0 | null };
  }
  let alertThreshold: 30 | 15 | 7 | 0 | null = null;
  if (daysRemaining === 30) alertThreshold = 30;
  else if (daysRemaining === 15) alertThreshold = 15;
  else if (daysRemaining === 7) alertThreshold = 7;
  return {
    daysRemaining,
    status: (daysRemaining <= 30 ? 'EXPIRING' : 'VALID') as 'VALID' | 'EXPIRING',
    alertThreshold,
  };
}

export function validateChallanNumber(challanNo: string) {
  if (!challanNo || challanNo.trim().length === 0) {
    return { valid: false, reason: 'Challan number cannot be empty.' };
  }
  if (challanNo.length > 16) {
    return {
      valid: false,
      reason: `Challan number "${challanNo}" (${challanNo.length} chars) exceeds CGST Rule 55 16-character limit.`,
    };
  }
  return { valid: true };
}

export function validateEwayBill(params: {
  totalValueInr: number;
  isInterStateJobWork: boolean;
  ewayBillNo?: string | null;
  ewayVehicleNo?: string | null;
  gateVehicleNo?: string | null;
}) {
  const required = params.totalValueInr > 50000 || params.isInterStateJobWork;
  if (!required) return { valid: true };
  const eway = (params.ewayBillNo ?? '').trim();
  if (!/^\d{12}$/.test(eway)) {
    return {
      valid: false,
      reason: `E-way bill required (value ₹${params.totalValueInr.toLocaleString('en-IN')}${params.totalValueInr > 50000 ? ' > ₹50,000' : ', inter-state job work'}).`,
    };
  }
  const ewVeh = (params.ewayVehicleNo ?? '').trim().toUpperCase();
  const gateVeh = (params.gateVehicleNo ?? '').trim().toUpperCase();
  if (ewVeh && gateVeh && ewVeh !== gateVeh) {
    return {
      valid: false,
      reason: `E-way bill vehicle ${ewVeh} does not match gate vehicle ${gateVeh}.`,
    };
  }
  return { valid: true };
}

const LETTER_MAP: Record<string, number> = {
  A: 10, B: 12, C: 13, D: 14, E: 15, F: 16, G: 17, H: 18, I: 19,
  J: 20, K: 21, L: 23, M: 24, N: 25, O: 26, P: 27, Q: 28, R: 29,
  S: 30, T: 31, U: 32, V: 34, W: 35, X: 36, Y: 37, Z: 38,
};

export function computeIso6346CheckDigit(prefix10: string): number {
  const s = prefix10.toUpperCase();
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const ch = s[i]!;
    const val = i < 4 ? LETTER_MAP[ch] : Number(ch);
    if (val === undefined || Number.isNaN(val)) {
      throw new Error(`Invalid character '${ch}' at position ${i} in container code.`);
    }
    sum += val * Math.pow(2, i);
  }
  return (sum % 11) % 10;
}

export function validateIso6346Container(containerNo: string) {
  const normalized = containerNo.trim().toUpperCase();
  if (!/^[A-Z]{3}[UJZ][0-9]{7}$/.test(normalized)) {
    return {
      valid: false,
      reason: 'Container number check digit invalid.',
    };
  }
  const expected = computeIso6346CheckDigit(normalized.slice(0, 10));
  if (Number(normalized[10]!) !== expected) {
    return {
      valid: false,
      expectedCheckDigit: expected,
      reason: 'Container number check digit invalid.',
    };
  }
  return { valid: true, expectedCheckDigit: expected };
}

