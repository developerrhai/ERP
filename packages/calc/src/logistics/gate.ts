/**
 * Gate, Job Work Statutory Dates (CGST s.143 / Rule 45), Returnable Overdue, E-Way Bill & Document Expiry Rules
 */

export type JobWorkCategory = 'INPUT' | 'CAPITAL_GOOD' | 'TOOL_EXEMPT' | 'NONE';

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

  // Check days in target month (handles Feb 29 -> Feb 28 in non-leap year)
  const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const safeDay = Math.min(day, daysInMonth);
  return formatDateUtc(new Date(Date.UTC(y, m, safeDay)));
}

export function diffDays(fromIso: string, toIso: string): number {
  const a = parseDateUtc(fromIso).getTime();
  const b = parseDateUtc(toIso).getTime();
  return Math.round((b - a) / MS_PER_DAY);
}

/**
 * CGST s.143 Rule 45:
 * - INPUT: 1 year from dispatch
 * - CAPITAL_GOOD: 3 years from dispatch
 * - TOOL_EXEMPT: no time limit (null)
 */
export function computeStatutoryDueDate(
  dispatchDate: string,
  category: JobWorkCategory,
): string | null {
  if (category === 'INPUT') {
    return addYearsSafe(dispatchDate, 1);
  }
  if (category === 'CAPITAL_GOOD') {
    return addYearsSafe(dispatchDate, 3);
  }
  return null;
}

export function evaluateStatutoryStatus(
  statutoryDueDate: string | null,
  currentDate: string,
): {
  daysRemaining: number | null;
  alertThreshold: 60 | 30 | 7 | null;
  deemedSupplyRisk: boolean;
} {
  if (!statutoryDueDate) {
    return { daysRemaining: null, alertThreshold: null, deemedSupplyRisk: false };
  }
  const daysRemaining = diffDays(currentDate, statutoryDueDate);
  if (daysRemaining < 0) {
    return { daysRemaining, alertThreshold: null, deemedSupplyRisk: true };
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
): { overdueDays: number; alertThreshold: 1 | 7 | 30 | null } {
  if (!expectedReturnDate || balanceQty <= 0) {
    return { overdueDays: 0, alertThreshold: null };
  }
  const overdueDays = diffDays(expectedReturnDate, currentDate);
  if (overdueDays <= 0) {
    return { overdueDays: 0, alertThreshold: null };
  }
  let alertThreshold: 1 | 7 | 30 | null = null;
  if (overdueDays >= 30) alertThreshold = 30;
  else if (overdueDays >= 7) alertThreshold = 7;
  else if (overdueDays >= 1) alertThreshold = 1;

  return { overdueDays, alertThreshold };
}

export function evaluateDocumentExpiry(
  expiryDate: string,
  currentDate: string,
): {
  daysRemaining: number;
  status: 'VALID' | 'EXPIRING' | 'EXPIRED';
  alertThreshold: 30 | 15 | 7 | 0 | null;
} {
  const daysRemaining = diffDays(currentDate, expiryDate);
  if (daysRemaining < 0) {
    return { daysRemaining, status: 'EXPIRED', alertThreshold: 0 };
  }
  if (daysRemaining === 0) {
    return { daysRemaining: 0, status: 'EXPIRING', alertThreshold: 0 };
  }
  let alertThreshold: 30 | 15 | 7 | 0 | null = null;
  if (daysRemaining === 30) alertThreshold = 30;
  else if (daysRemaining === 15) alertThreshold = 15;
  else if (daysRemaining === 7) alertThreshold = 7;

  return {
    daysRemaining,
    status: daysRemaining <= 30 ? 'EXPIRING' : 'VALID',
    alertThreshold,
  };
}

export function validateChallanNumber(challanNo: string): { valid: boolean; reason?: string } {
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
}): { valid: boolean; reason?: string } {
  const required = params.totalValueInr > 50000 || params.isInterStateJobWork;
  if (!required) {
    return { valid: true };
  }
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

