// Supplier bank account numbers (docs/phases/PHASE-06.md §4): AES-256-GCM ciphertext, the last 4 digits
// for display, and an HMAC-SHA256 for duplicate detection ("this account belongs to supplier X") without
// ever storing or comparing the number in clear. The keys are derived (separately) from the same secret
// the MFA secrets use, so no new environment variable is needed on the server.
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import { env } from '../../config/env';

function baseSecret(): string {
  return env.MFA_ENCRYPTION_KEY ?? `bank-seed:${env.JWT_ACCESS_SECRET}`;
}

function derive(purpose: 'enc' | 'hmac'): Buffer {
  return createHash('sha256').update(`bank-${purpose}:${baseSecret()}`).digest();
}

/** Digits only, no spaces or dashes. */
export function normaliseAccountNo(value: string): string {
  return value.replace(/[\s-]+/g, '');
}

export const ACCOUNT_NO_RE = /^[0-9]{6,20}$/;

export function encryptAccountNo(accountNo: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', derive('enc'), iv);
  const ct = Buffer.concat([cipher.update(accountNo, 'utf8'), cipher.final()]);
  return `v1:${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${ct.toString('hex')}`;
}

export function decryptAccountNo(payload: string): string {
  const [version, ivHex, tagHex, ctHex] = payload.split(':');
  if (version !== 'v1' || !ivHex || !tagHex || !ctHex) throw new Error('Invalid bank payload.');
  const decipher = createDecipheriv('aes-256-gcm', derive('enc'), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(ctHex, 'hex')), decipher.final()]).toString(
    'utf8',
  );
}

/** Stable 64-hex fingerprint of an account number (case and spacing independent). */
export function accountHash(accountNo: string): string {
  return createHmac('sha256', derive('hmac')).update(normaliseAccountNo(accountNo)).digest('hex');
}

/** "XXXXXX1234" for screens, audit rows and logs. */
export function maskAccountNo(accountNo: string): string {
  const digits = normaliseAccountNo(accountNo);
  return `${'X'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}
