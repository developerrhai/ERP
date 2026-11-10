/**
 * Freight Rate Calculation & Variance Check
 * Supports PER_KG_SLAB, PER_KM, PER_TRIP, PER_CBM with minimum charge, fuel surcharge, toll, loading, and GTA RCM 5%.
 */

export type FreightBasis = 'PER_KG_SLAB' | 'PER_KM' | 'PER_TRIP' | 'PER_CBM';

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
      // Fallback to highest slab if above max toQty, or lowest if below
      matched = w > slabs[slabs.length - 1]!.toQty ? slabs[slabs.length - 1] : slabs[0];
    }
    if (matched) {
      appliedRate = matched.rate;
    }
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
  const fuelSurchargePct = input.fuelSurchargePct ?? 0;
  const fuelSurcharge = round2((baseAmount * fuelSurchargePct) / 100);
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

