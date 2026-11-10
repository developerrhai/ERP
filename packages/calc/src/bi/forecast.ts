/**
 * Statistical Time-Series Forecasting Engine (MA, SES, Holt)
 * No LLM ever touches these numbers.
 */

export type ForecastMethod = 'MA' | 'SES' | 'HOLT';

export interface ForecastPoint {
  periodIndex: number;
  estimate: number;
  lo: number;
  hi: number;
}

export interface ForecastResult {
  method: ForecastMethod;
  params: Record<string, number>;
  windowSize: number;
  mape: number;
  rmse: number;
  band: number;
  label: string;
  points: ForecastPoint[];
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function round1(n: number): number {
  return Math.round((n + Number.EPSILON) * 10) / 10;
}

function assertMinHistory(series: number[], minPoints = 6): void {
  if (series.length < minPoints) {
    throw new Error(`Not enough history (needs ${minPoints} periods, found ${series.length}).`);
  }
}

export function movingAverageForecast(
  series: number[],
  n = 3,
  horizon = 3,
): ForecastResult {
  assertMinHistory(series);
  const window = Math.max(1, Math.min(n, series.length));
  const errors: number[] = [];
  const pctErrors: number[] = [];

  for (let t = window; t < series.length; t++) {
    let sum = 0;
    for (let j = t - window; j < t; j++) sum += series[j]!;
    const pred = sum / window;
    const actual = series[t]!;
    errors.push(actual - pred);
    if (actual !== 0) pctErrors.push(Math.abs((actual - pred) / actual) * 100);
  }

  const rmse = errors.length > 0 ? Math.sqrt(errors.reduce((s, e) => s + e * e, 0) / errors.length) : 0;
  const mape = pctErrors.length > 0 ? pctErrors.reduce((s, e) => s + e, 0) / pctErrors.length : 0;
  const band = 1.96 * rmse;

  let lastSum = 0;
  for (let j = series.length - window; j < series.length; j++) lastSum += series[j]!;
  const est = lastSum / window;

  const points: ForecastPoint[] = [];
  for (let h = 1; h <= horizon; h++) {
    points.push({
      periodIndex: series.length + h,
      estimate: round2(est),
      lo: round2(est - band),
      hi: round2(est + band),
    });
  }

  return {
    method: 'MA',
    params: { n: window },
    windowSize: series.length,
    mape: round2(mape),
    rmse: round2(rmse),
    band: round2(band),
    label: `Estimate · MA (${window}) · ${horizon} periods · ±${round1(band)}`,
    points,
  };
}

export function sesForecast(
  series: number[],
  alpha = 0.5,
  horizon = 3,
): ForecastResult {
  assertMinHistory(series);
  let level = series[0]!;
  const errors: number[] = [];
  const pctErrors: number[] = [];

  for (let t = 1; t < series.length; t++) {
    const pred = level;
    const actual = series[t]!;
    errors.push(actual - pred);
    if (actual !== 0) pctErrors.push(Math.abs((actual - pred) / actual) * 100);
    level = alpha * actual + (1 - alpha) * level;
  }

  const rmse = errors.length > 0 ? Math.sqrt(errors.reduce((s, e) => s + e * e, 0) / errors.length) : 0;
  const mape = pctErrors.length > 0 ? pctErrors.reduce((s, e) => s + e, 0) / pctErrors.length : 0;
  const band = 1.96 * rmse;

  const points: ForecastPoint[] = [];
  for (let h = 1; h <= horizon; h++) {
    points.push({
      periodIndex: series.length + h,
      estimate: round2(level),
      lo: round2(level - band),
      hi: round2(level + band),
    });
  }

  return {
    method: 'SES',
    params: { alpha },
    windowSize: series.length,
    mape: round2(mape),
    rmse: round2(rmse),
    band: round2(band),
    label: `Estimate · SES (α ${alpha}) · ${horizon} periods · ±${round1(band)}`,
    points,
  };
}

export function holtForecast(
  series: number[],
  alpha = 0.5,
  beta = 0.3,
  horizon = 3,
): ForecastResult {
  assertMinHistory(series);
  // Initialize L1 = y[1], T1 = y[1] - y[0]
  let level = series[1]!;
  let trend = series[1]! - series[0]!;
  const errors: number[] = [];
  const pctErrors: number[] = [];

  for (let t = 2; t < series.length; t++) {
    const pred = level + trend;
    const actual = series[t]!;
    errors.push(actual - pred);
    if (actual !== 0) pctErrors.push(Math.abs((actual - pred) / actual) * 100);
    const prevLevel = level;
    level = alpha * actual + (1 - alpha) * (level + trend);
    trend = beta * (level - prevLevel) + (1 - beta) * trend;
  }

  const rmse = errors.length > 0 ? Math.sqrt(errors.reduce((s, e) => s + e * e, 0) / errors.length) : 0;
  const mape = pctErrors.length > 0 ? pctErrors.reduce((s, e) => s + e, 0) / pctErrors.length : 0;
  const band = 1.96 * rmse;

  const points: ForecastPoint[] = [];
  for (let h = 1; h <= horizon; h++) {
    const est = level + h * trend;
    points.push({
      periodIndex: series.length + h,
      estimate: round2(est),
      lo: round2(est - band),
      hi: round2(est + band),
    });
  }

  return {
    method: 'HOLT',
    params: { alpha, beta },
    windowSize: series.length,
    mape: round2(mape),
    rmse: round2(rmse),
    band: round2(band),
    label: `Estimate · Holt (α ${alpha}, β ${beta}) · ${horizon} periods · ±${round1(band)}`,
    points,
  };
}

export function autoSelectHolt(series: number[], horizon = 3): ForecastResult {
  assertMinHistory(series);
  const tail = series.slice(-12);
  let best: ForecastResult | null = null;
  for (let a = 1; a <= 9; a++) {
    for (let b = 1; b <= 9; b++) {
      const candidate = holtForecast(tail, a / 10, b / 10, horizon);
      if (!best || candidate.mape < best.mape) {
        best = candidate;
      }
    }
  }
  return holtForecast(series, best!.params.alpha!, best!.params.beta!, horizon);
}

