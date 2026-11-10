/**
 * Statistical Z-Score Anomaly Detection & Department KPI Ratio Formulas
 */

export interface AnomalyCheckResult {
  mean: number;
  sd: number;
  zScore: number;
  anomaly: boolean;
  skippedReason?: string;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function detectZScoreAnomaly(
  trailingPoints: number[],
  currentValue: number,
  threshold = 3,
): AnomalyCheckResult {
  if (trailingPoints.length < 2) {
    return { mean: currentValue, sd: 0, zScore: 0, anomaly: false, skippedReason: 'Too few points' };
  }
  const n = trailingPoints.length;
  const mean = trailingPoints.reduce((s, x) => s + x, 0) / n;
  const variance = trailingPoints.reduce((s, x) => s + Math.pow(x - mean, 2), 0) / (n - 1);
  const sd = Math.sqrt(variance);

  if (sd === 0) {
    return { mean: round2(mean), sd: 0, zScore: 0, anomaly: false, skippedReason: 'Zero variance' };
  }

  const z = (currentValue - mean) / sd;
  return {
    mean: round2(mean),
    sd: round2(sd),
    zScore: round2(z),
    anomaly: Math.abs(z) >= threshold,
  };
}

/** Zero denominator -> null (displays "—" / "No data in period", never 0% or guess). */
export function safeRatio(numerator: number, denominator: number, scale = 1): number | null {
  if (denominator === 0 || !Number.isFinite(denominator)) return null;
  return round2((numerator / denominator) * scale);
}

export function computeOee(availability: number | null, performance: number | null, quality: number | null): number | null {
  if (availability === null || performance === null || quality === null) return null;
  return round2((availability * performance * quality) / 10000);
}

export function computeOtif(onTimeCompleteLines: number, dueLines: number): number | null {
  return safeRatio(onTimeCompleteLines, dueLines, 100);
}

export function computeDso(arBalance: number, creditSales: number, days = 90): number | null {
  return safeRatio(arBalance * days, creditSales, 1);
}

export function computeDpo(apBalance: number, purchases: number, days = 90): number | null {
  return safeRatio(apBalance * days, purchases, 1);
}

export function computeInventoryTurns(cogs12m: number, avgInventory: number): number | null {
  return safeRatio(cogs12m, avgInventory, 1);
}

export function computeFpy(firstPassQty: number, inspectedQty: number): number | null {
  return safeRatio(firstPassQty, inspectedQty, 100);
}

export function computeAttrition(separations: number, avgHeadcount: number): number | null {
  return safeRatio(separations, avgHeadcount, 100);
}

