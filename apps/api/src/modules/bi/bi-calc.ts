/**
 * Pure calculation engine for Phase 19 BI, Forecasting, Anomaly Detection,
 * Automation AST, Webhooks Security & Communication Compliance
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

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

export function movingAverageForecast(series: number[], n = 3, horizon = 3): ForecastResult {
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
    points.push({ periodIndex: series.length + h, estimate: round2(est), lo: round2(est - band), hi: round2(est + band) });
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

export function sesForecast(series: number[], alpha = 0.5, horizon = 3): ForecastResult {
  assertMinHistory(series);
  let level = series[0]!;
  const errors: number[] = [];
  const pctErrors: number[] = [];
  for (let t = 1; t < series.length; t++) {
    const actual = series[t]!;
    errors.push(actual - level);
    if (actual !== 0) pctErrors.push(Math.abs((actual - level) / actual) * 100);
    level = alpha * actual + (1 - alpha) * level;
  }
  const rmse = errors.length > 0 ? Math.sqrt(errors.reduce((s, e) => s + e * e, 0) / errors.length) : 0;
  const mape = pctErrors.length > 0 ? pctErrors.reduce((s, e) => s + e, 0) / pctErrors.length : 0;
  const band = 1.96 * rmse;
  const points: ForecastPoint[] = [];
  for (let h = 1; h <= horizon; h++) {
    points.push({ periodIndex: series.length + h, estimate: round2(level), lo: round2(level - band), hi: round2(level + band) });
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

export function holtForecast(series: number[], alpha = 0.5, beta = 0.3, horizon = 3): ForecastResult {
  assertMinHistory(series);
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
    points.push({ periodIndex: series.length + h, estimate: round2(est), lo: round2(est - band), hi: round2(est + band) });
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

export function detectZScoreAnomaly(trailingPoints: number[], currentValue: number, threshold = 3) {
  if (trailingPoints.length < 2) {
    return { mean: currentValue, sd: 0, zScore: 0, anomaly: false };
  }
  const n = trailingPoints.length;
  const mean = trailingPoints.reduce((s, x) => s + x, 0) / n;
  const variance = trailingPoints.reduce((s, x) => s + Math.pow(x - mean, 2), 0) / (n - 1);
  const sd = Math.sqrt(variance);
  if (sd === 0) return { mean: round2(mean), sd: 0, zScore: 0, anomaly: false };
  const z = (currentValue - mean) / sd;
  return { mean: round2(mean), sd: round2(sd), zScore: round2(z), anomaly: Math.abs(z) >= threshold };
}

export function safeRatio(numerator: number, denominator: number, scale = 1): number | null {
  if (denominator === 0 || !Number.isFinite(denominator)) return null;
  return round2((numerator / denominator) * scale);
}

export type ConditionOp = 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'contains' | 'is_null';
export interface LeafCondition {
  field: string;
  op: ConditionOp;
  value?: unknown;
}
export interface GroupCondition {
  all?: ConditionAst[];
  any?: ConditionAst[];
}
export type ConditionAst = LeafCondition | GroupCondition;

function getFieldPath(obj: Record<string, unknown>, path: string): unknown {
  let curr: unknown = obj;
  for (const p of path.split('.')) {
    if (curr === null || curr === undefined || typeof curr !== 'object') return undefined;
    curr = (curr as Record<string, unknown>)[p];
  }
  return curr;
}

export function validateConditionAst(ast: ConditionAst, depth = 1, counter = { count: 0 }): void {
  if (depth > 5) throw new Error('Condition tree too deep (max 5).');
  counter.count += 1;
  if (counter.count > 20) throw new Error('Condition tree too large (max 20 nodes).');
  if ('all' in ast && Array.isArray(ast.all)) {
    for (const child of ast.all) validateConditionAst(child, depth + 1, counter);
  } else if ('any' in ast && Array.isArray(ast.any)) {
    for (const child of ast.any) validateConditionAst(child, depth + 1, counter);
  }
}

export function evaluateConditionAst(ast: ConditionAst, context: Record<string, unknown>): boolean {
  validateConditionAst(ast);
  if ('all' in ast && Array.isArray(ast.all)) {
    return ast.all.every((c) => evaluateConditionAst(c, context));
  }
  if ('any' in ast && Array.isArray(ast.any)) {
    return ast.any.some((c) => evaluateConditionAst(c, context));
  }
  const leaf = ast as LeafCondition;
  const actual = getFieldPath(context, leaf.field);
  const expected = leaf.value;
  switch (leaf.op) {
    case 'is_null':
      return expected === false ? actual !== null && actual !== undefined : actual === null || actual === undefined;
    case 'eq':
      return actual === expected || String(actual) === String(expected);
    case 'ne':
      return actual !== expected && String(actual) !== String(expected);
    case 'gt':
      return Number(actual) > Number(expected);
    case 'gte':
      return Number(actual) >= Number(expected);
    case 'lt':
      return Number(actual) < Number(expected);
    case 'lte':
      return Number(actual) <= Number(expected);
    case 'in':
      return Array.isArray(expected) && expected.includes(actual);
    case 'contains':
      return typeof actual === 'string' && typeof expected === 'string' && actual.toLowerCase().includes(expected.toLowerCase());
    default:
      return false;
  }
}

export function signStandardWebhook(params: { webhookId: string; timestampSec: number; body: string; secret: string }): string {
  const rawKey = params.secret.startsWith('whsec_')
    ? Buffer.from(params.secret.slice(6), 'base64')
    : Buffer.from(params.secret, 'utf8');
  const sig = createHmac('sha256', rawKey).update(`${params.webhookId}.${params.timestampSec}.${params.body}`).digest('base64');
  return `v1,${sig}`;
}

export function verifyStandardWebhook(params: {
  webhookId: string;
  timestampSec: number;
  signatureHeader: string;
  body: string;
  secret: string;
  nowSec?: number;
  toleranceSec?: number;
}) {
  const now = params.nowSec ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - params.timestampSec) > (params.toleranceSec ?? 300)) {
    return { ok: false, reason: 'Webhook timestamp outside 5-minute tolerance.' };
  }
  const expected = signStandardWebhook(params);
  for (const part of params.signatureHeader.split(' ')) {
    const [ver, sig] = part.split(',');
    if (ver !== 'v1' || !sig) continue;
    const expectedSig = expected.split(',')[1]!;
    const a = Buffer.from(sig, 'utf8');
    const b = Buffer.from(expectedSig, 'utf8');
    if (a.length === b.length && timingSafeEqual(a, b)) return { ok: true };
  }
  return { ok: false, reason: 'Invalid webhook signature.' };
}

export function verifyMetaSignature(rawBody: string, headerSig: string, appSecret: string): boolean {
  if (!headerSig.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const a = Buffer.from(headerSig.slice(7), 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function verifyRazorpaySignature(rawBody: string, headerSig: string, secret: string): boolean {
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(headerSig, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function isPrivateIp(ip: string): boolean {
  const clean = ip.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (clean === '::1' || clean === 'localhost' || clean.startsWith('fc') || clean.startsWith('fd') || clean.startsWith('fe80:')) {
    return true;
  }
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(clean);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

export function validateWebhookUrl(rawUrl: string, allowLocalhostInDev = false): { valid: boolean; reason?: string } {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return { valid: false, reason: 'Endpoint must be a public HTTPS URL.' };
  }
  const host = u.hostname.toLowerCase();
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (u.protocol !== 'https:' && !(allowLocalhostInDev && isLocal && u.protocol === 'http:')) {
    return { valid: false, reason: 'Endpoint must be a public HTTPS URL.' };
  }
  if (isPrivateIp(host) && !(allowLocalhostInDev && isLocal)) {
    return { valid: false, reason: 'Endpoint must be a public HTTPS URL.' };
  }
  return { valid: true };
}

export function validateDltSms(input: {
  dltTemplateId?: string | null;
  dltHeader?: string | null;
  templateBody: string;
  renderedBody: string;
  variables: string[];
  whitelistedUrls?: string[];
  category: string;
  istHour?: number;
}) {
  if (!input.dltTemplateId || input.dltTemplateId.trim().length === 0) {
    return { status: 'BLOCKED' as const, reason: 'DLT template ID is required.' };
  }
  const header = (input.dltHeader ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9]{6}-(S|P|T|G)$/.test(header)) {
    return { status: 'BLOCKED' as const, reason: 'Invalid DLT header (must be 6 alphanumeric chars with -S/-P/-T/-G suffix).' };
  }
  for (let i = 0; i < input.variables.length; i++) {
    if ((input.variables[i] ?? '').length > 30) {
      return { status: 'BLOCKED' as const, reason: `Variable ${i + 1} exceeds 30 characters.` };
    }
  }
  let expected = input.templateBody;
  for (const v of input.variables) expected = expected.replace('{#var#}', v);
  if (expected.trim() !== input.renderedBody.trim()) {
    return { status: 'BLOCKED' as const, reason: `Message does not match DLT template ${input.dltTemplateId}.` };
  }
  const urlsInBody = input.renderedBody.match(/https?:\/\/[^\s]+/gi) ?? [];
  const whitelist = (input.whitelistedUrls ?? []).map((u) => u.toLowerCase());
  for (const url of urlsInBody) {
    if (!whitelist.some((w) => url.toLowerCase().startsWith(w))) {
      return { status: 'BLOCKED' as const, reason: 'URL not whitelisted in template.' };
    }
  }
  if (input.category === 'PROMOTIONAL') {
    const hr = input.istHour ?? 12;
    if (hr < 10 || hr >= 21) {
      return { status: 'QUEUED_WINDOW' as const, reason: 'Queued for 10:00 IST (TRAI promotional window).' };
    }
  }
  return { status: 'ALLOWED' as const };
}

export function validateWhatsAppPreSend(input: {
  optedIn: boolean;
  within24hWindow?: boolean;
  waStatus?: string | null;
}) {
  if (!input.optedIn) {
    return { allowed: false, reason: 'Contact has not opted in to WhatsApp.' };
  }
  if (!input.within24hWindow) {
    const st = (input.waStatus ?? 'PENDING').toUpperCase();
    if (st !== 'APPROVED') {
      return { allowed: false, reason: `Template not approved by Meta (status ${st}).` };
    }
  }
  return { allowed: true };
}

