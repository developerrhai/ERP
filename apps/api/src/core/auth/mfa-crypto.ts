// AES-256-GCM encryption for MFA TOTP secrets.
// Stored as "v1:<iv_hex>:<tag_hex>:<ciphertext_hex>".
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { env } from '../../config/env';

function getEncryptionKey(): Buffer {
  const keyString = env.MFA_ENCRYPTION_KEY;
  if (keyString) {
    if (/^[0-9a-fA-F]{64}$/.test(keyString)) {
      return Buffer.from(keyString, 'hex');
    }
    const buf = Buffer.from(keyString, 'base64');
    if (buf.length === 32) return buf;
    return createHash('sha256').update(keyString).digest();
  }
  // In dev / test fallback to derived key from JWT_ACCESS_SECRET
  return createHash('sha256').update(`mfa-key-seed:${env.JWT_ACCESS_SECRET}`).digest();
}

export function encryptMfaSecret(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('hex')}:${tag.toString('hex')}:${ciphertext.toString('hex')}`;
}

export function decryptMfaSecret(payload: string): string {
  const parts = payload.split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('Invalid MFA encrypted payload format.');
  }
  const [_, ivHex, tagHex, ctHex] = parts as [string, string, string, string];
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const ciphertext = Buffer.from(ctHex, 'hex');

  const key = getEncryptionKey();
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}

export const encryptSecret = encryptMfaSecret;
export const decryptSecret = decryptMfaSecret;
