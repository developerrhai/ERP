// apps/api/src/modules/hr/hr-crypto.ts
// Secure AES-256-GCM encryption for Employee Aadhaar (Identity Vault) and Bank Account details.
// Full Aadhaar is NEVER stored in clear, and lives only in employee_identity_vault.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { env } from '../../config/env';

function baseSecret(): string {
  return env.MFA_ENCRYPTION_KEY ?? `hr-seed:${env.JWT_ACCESS_SECRET}`;
}

function deriveKey(purpose: 'aadhaar' | 'bank'): Buffer {
  return createHash('sha256').update(`hr-${purpose}:${baseSecret()}`).digest();
}

/** Verhoeff algorithm table for Aadhaar validation */
const d = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];

const p = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

export function validateVerhoeff(numStr: string): boolean {
  if (!/^\d{12}$/.test(numStr)) return false;
  let c = 0;
  const digits = numStr.split('').map(Number).reverse();
  for (let i = 0; i < digits.length; i++) {
    c = d[c]![p[i % 8]![digits[i]!]!]!;
  }
  return c === 0;
}

export function encryptAadhaar(aadhaar: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey('aadhaar'), iv);
  const ct = Buffer.concat([cipher.update(aadhaar.trim(), 'utf8'), cipher.final()]);
  return `v1:${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${ct.toString('hex')}`;
}

export function decryptAadhaar(payload: string): string {
  const [version, ivHex, tagHex, ctHex] = payload.split(':');
  if (version !== 'v1' || !ivHex || !tagHex || !ctHex) throw new Error('Invalid Aadhaar payload.');
  const decipher = createDecipheriv('aes-256-gcm', deriveKey('aadhaar'), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(ctHex, 'hex')), decipher.final()]).toString('utf8');
}

export function encryptBank(account: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey('bank'), iv);
  const ct = Buffer.concat([cipher.update(account.trim(), 'utf8'), cipher.final()]);
  return `v1:${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${ct.toString('hex')}`;
}

export function decryptBank(payload: string): string {
  const [version, ivHex, tagHex, ctHex] = payload.split(':');
  if (version !== 'v1' || !ivHex || !tagHex || !ctHex) throw new Error('Invalid Bank payload.');
  const decipher = createDecipheriv('aes-256-gcm', deriveKey('bank'), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(ctHex, 'hex')), decipher.final()]).toString('utf8');
}

export function maskAadhaar(aadhaar: string): string {
  const clean = aadhaar.replace(/\D/g, '');
  if (clean.length < 4) return 'XXXX-XXXX-XXXX';
  return `XXXX-XXXX-${clean.slice(-4)}`;
}

export function maskAccount(account: string): string {
  const clean = account.replace(/\s/g, '');
  if (clean.length <= 4) return clean;
  return `${'X'.repeat(Math.max(0, clean.length - 4))}${clean.slice(-4)}`;
}

export function validateIfsc(ifsc: string): boolean {
  return /^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc.trim().toUpperCase());
}

export const HrCrypto = {
  encryptAadhaar,
  decryptAadhaar,
  encryptBank,
  decryptBank,
  validateVerhoeff,
  maskAadhaar,
  maskAccount,
  validateIfsc,
};

