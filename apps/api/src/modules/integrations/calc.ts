// Phase 34 pure rules: webhook backoff, secret masking, the sandbox IRN, inbound signature check.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const PROVIDERS = ['GST_IRP', 'GST_EWAY', 'WHATSAPP', 'BANK_FEED', 'SMTP_RELAY'] as const;
export type Provider = (typeof PROVIDERS)[number];
export const MODES = ['DISABLED', 'SANDBOX', 'LIVE'] as const;
export type Mode = (typeof MODES)[number];

export const PROVIDER_LABEL: Record<Provider, string> = {
  GST_IRP: 'GST e-Invoice (IRP)', GST_EWAY: 'E-Way Bill', WHATSAPP: 'WhatsApp Cloud', BANK_FEED: 'Bank feed', SMTP_RELAY: 'Email relay',
};

/** 1, 2, 4, 8, 16 minutes between attempts. */
export function backoffMinutes(attempt: number): number {
  return 2 ** Math.max(0, attempt - 1);
}
/** After the 5th failed attempt a delivery goes to the dead-letter queue. */
export const MAX_ATTEMPTS = 5;
export function nextStep(attemptsDone: number, maxAttempts = MAX_ATTEMPTS): 'RETRY' | 'DEAD_LETTER' {
  return attemptsDone >= maxAttempts ? 'DEAD_LETTER' : 'RETRY';
}

/** Only the last 4 characters of a secret are ever shown. */
export function maskSecret(value: string): string {
  return value.length <= 4 ? '••••' : `••••${value.slice(-4)}`;
}

/** The sandbox "IRP": a deterministic IRN (64 hex), an acknowledgement number and a signed QR payload. */
export function sandboxIrn(i: { sellerGstin: string; docNo: string; docDate: string; docType?: string }): { irn: string; ackNo: string; ackDate: string; signedQr: string } {
  const irn = createHash('sha256').update(`${i.sellerGstin}|${i.docNo}|${i.docDate.slice(0, 4)}|${i.docType ?? 'INV'}`).digest('hex');
  const ackNo = String(BigInt(`0x${irn.slice(0, 12)}`) % 1_000_000_000_000_000n).padStart(15, '1');
  const ackDate = new Date().toISOString();
  const signedQr = Buffer.from(JSON.stringify({ SellerGstin: i.sellerGstin, DocNo: i.docNo, DocDt: i.docDate, Irn: irn, sandbox: true })).toString('base64');
  return { irn, ackNo, ackDate, signedQr };
}

/** Hex HMAC-SHA256 of the raw body. `sha256=` prefixed values (Meta style) are accepted too. */
export function verifyHexSignature(rawBody: string, header: string, secret: string): boolean {
  const h = header.startsWith('sha256=') ? header.slice(7) : header;
  if (!/^[0-9a-f]{64}$/i.test(h)) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  const given = Buffer.from(h, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}
