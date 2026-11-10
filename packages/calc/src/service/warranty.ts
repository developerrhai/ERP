export type WarrantyEligibilityStatus =
  | 'IN_WARRANTY'
  | 'AMC_COVERED'
  | 'OUT_OF_WARRANTY'
  | 'CONDITIONAL';

export interface WarrantyEvaluationInput {
  hasSalesInvoice: boolean;
  isRegistrationActive: boolean;
  warrantyStartDate: string;
  warrantyEndDate: string;
  failureDate: string;
  hasExclusionsFlagged?: boolean;
  isCustomerMatchOrTransferred: boolean;
  isAmcActive?: boolean;
}

export interface WarrantyEvaluationResult {
  status: WarrantyEligibilityStatus;
  isEligible: boolean;
  reasons: string[];
}

export function computeWarrantyEndDate(startDateStr: string, durationMonths: number): string {
  const [y, m, d] = startDateStr.split('-').map((v) => parseInt(v, 10));
  const start = new Date(Date.UTC(y!, m! - 1, d!));

  // Target year and month
  const totalMonths = start.getUTCMonth() + durationMonths;
  const targetYear = start.getUTCFullYear() + Math.floor(totalMonths / 12);
  const targetMonth = totalMonths % 12;

  const daysInTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const startDay = start.getUTCDate();

  let end: Date;
  if (startDay >= daysInTargetMonth) {
    // If starting on or beyond the last day of target month (e.g. 29 Feb -> 28 Feb non-leap, or 31 Jan -> 28 Feb),
    // the warranty runs through the end of that target month.
    end = new Date(Date.UTC(targetYear, targetMonth, daysInTargetMonth));
  } else {
    // Standard rule: anniversary date minus 1 day (e.g. 10th -> 9th)
    const advanced = new Date(Date.UTC(targetYear, targetMonth, startDay));
    end = new Date(advanced.getTime() - 24 * 60 * 60 * 1000);
  }

  const endY = end.getUTCFullYear();
  const endM = String(end.getUTCMonth() + 1).padStart(2, '0');
  const endD = String(end.getUTCDate()).padStart(2, '0');
  return `${endY}-${endM}-${endD}`;
}

export function evaluateWarrantyEligibility(input: WarrantyEvaluationInput): WarrantyEvaluationResult {
  const reasons: string[] = [];

  if (!input.hasSalesInvoice) {
    return {
      status: 'OUT_OF_WARRANTY',
      isEligible: false,
      reasons: ['NOT_SOLD: Equipment serial has no recorded sales invoice reference.'],
    };
  }

  if (input.hasExclusionsFlagged) {
    return {
      status: 'CONDITIONAL',
      isEligible: false,
      reasons: ['Exclusions flagged (e.g. physical damage, liquid ingress or unauthorized tampering).'],
    };
  }

  if (!input.isCustomerMatchOrTransferred) {
    return {
      status: 'CONDITIONAL',
      isEligible: false,
      reasons: ['Equipment ownership discrepancy: customer does not match original sale and no transfer recorded.'],
    };
  }

  const isDateWithinWarranty =
    input.isRegistrationActive &&
    input.failureDate >= input.warrantyStartDate &&
    input.failureDate <= input.warrantyEndDate;

  if (isDateWithinWarranty) {
    return {
      status: 'IN_WARRANTY',
      isEligible: true,
      reasons: [`Equipment covered under standard warranty until ${input.warrantyEndDate}.`],
    };
  }

  if (input.isAmcActive) {
    return {
      status: 'AMC_COVERED',
      isEligible: true,
      reasons: ['Equipment is out of standard warranty but covered under active AMC contract.'],
    };
  }

  return {
    status: 'OUT_OF_WARRANTY',
    isEligible: false,
    reasons: [`Out of warranty since ${input.warrantyEndDate}.`],
  };
}
