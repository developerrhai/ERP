/**
 * Standard Webhooks Signing / Verification + SSRF URL Guard + Meta & Razorpay Signatures
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export function signStandardWebhook(params: {
  webhookId: string;
  timestampSec: number;
  body: string;
  secret: string;
}): string {
  const rawKey = params.secret.startsWith('whsec_')
    ? Buffer.from(params.secret.slice(6), 'base64')
    : Buffer.from(params.secret, 'utf8');
  const toSign = `${params.webhookId}.${params.timestampSec}.${params.body}`;
  const sig = createHmac('sha256', rawKey).update(toSign).digest('base64');
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
}): { ok: boolean; reason?: string } {
  const now = params.nowSec ?? Math.floor(Date.now() / 1000);
  const tol = params.toleranceSec ?? 300; // 5 minutes
  if (Math.abs(now - params.timestampSec) > tol) {
    return { ok: false, reason: 'Webhook timestamp outside 5-minute tolerance.' };
  }

  const expected = signStandardWebhook({
    webhookId: params.webhookId,
    timestampSec: params.timestampSec,
    body: params.body,
    secret: params.secret,
  });

  const parts = params.signatureHeader.split(' ');
  for (const part of parts) {
    const [ver, sig] = part.split(',');
    if (ver !== 'v1' || !sig) continue;
    const expectedSig = expected.split(',')[1]!;
    const a = Buffer.from(sig, 'utf8');
    const b = Buffer.from(expectedSig, 'utf8');
    if (a.length === b.length && timingSafeEqual(a, b)) {
      return { ok: true };
    }
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
  if (a === 10) return true; // RFC1918 10.0.0.0/8
  if (a === 127) return true; // loopback 127.0.0.0/8
  if (a === 169 && b === 254) return true; // link-local 169.254.0.0/16
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918 172.16.0.0/12
  if (a === 192 && b === 168) return true; // RFC1918 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
  if (a === 0) return true;
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

