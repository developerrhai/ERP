// packages/statutory/src/gstin.ts
// Goods and Services Tax Identification Number (GSTIN) validation & Mod-36 Checksum (ERRATA E-05)

import { isValidStateCode, getStateByCode, type StateInfo } from './states.js';
import { validatePan, type PanValidationResult } from './pan.js';

export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * Computes the 15th character checksum for a 14-character GSTIN prefix using Modulo 36 algorithm.
 */
export function computeGstinChecksum(input14: string): string {
  if (!input14 || input14.length < 14) {
    throw new Error('Input must be at least 14 characters to compute GSTIN checksum.');
  }
  const clean = input14.slice(0, 14).toUpperCase();
  let sum = 0;

  for (let i = 0; i < 14; i++) {
    const char = clean[i];
    const codePoint = CHARS.indexOf(char!);
    if (codePoint === -1) {
      throw new Error(`Invalid character '${char}' in GSTIN input.`);
    }
    // Mod 36 weighting: alternate factors 1 and 2
    const factor = i % 2 === 0 ? 1 : 2;
    const product = codePoint * factor;
    const quotient = Math.floor(product / 36);
    const remainder = product % 36;
    sum += quotient + remainder;
  }

  const remainder = sum % 36;
  const checkCodePoint = (36 - remainder) % 36;
  return CHARS[checkCodePoint]!;
}

export interface GstinValidationResult {
  valid: boolean;
  gstin: string;
  stateCode?: string;
  state?: StateInfo;
  pan?: string;
  panDetails?: PanValidationResult;
  entityNumber?: string;
  checksum?: string;
  expectedChecksum?: string;
  error?: string;
}

export function validateGstin(
  value: string | null | undefined,
  options: { verifyChecksum?: boolean } = { verifyChecksum: true },
): GstinValidationResult {
  if (!value || typeof value !== 'string') {
    return { valid: false, gstin: '', error: 'GSTIN is required.' };
  }
  const clean = value.trim().toUpperCase();
  if (clean.length !== 15) {
    return { valid: false, gstin: clean, error: 'GSTIN must be exactly 15 characters long.' };
  }
  if (!GSTIN_REGEX.test(clean)) {
    return {
      valid: false,
      gstin: clean,
      error: 'GSTIN format is invalid (expected 2 digits state + 10 chars PAN + 1 entity num + Z + checksum).',
    };
  }

  const stateCode = clean.slice(0, 2);
  const state = getStateByCode(stateCode);
  if (!state) {
    return { valid: false, gstin: clean, error: `Invalid GST state code '${stateCode}'.` };
  }

  const panStr = clean.slice(2, 12);
  const panDetails = validatePan(panStr);
  if (!panDetails.valid) {
    return { valid: false, gstin: clean, error: `Invalid PAN embedded in GSTIN: ${panDetails.error}` };
  }

  const entityNumber = clean.charAt(12);
  const actualChecksum = clean.charAt(14);
  const expectedChecksum = computeGstinChecksum(clean.slice(0, 14));

  if (options.verifyChecksum && actualChecksum !== expectedChecksum) {
    return {
      valid: false,
      gstin: clean,
      stateCode,
      state,
      pan: panStr,
      panDetails,
      entityNumber,
      checksum: actualChecksum,
      expectedChecksum,
      error: `GSTIN checksum mismatch (expected '${expectedChecksum}', got '${actualChecksum}').`,
    };
  }

  return {
    valid: true,
    gstin: clean,
    stateCode,
    state,
    pan: panStr,
    panDetails,
    entityNumber,
    checksum: actualChecksum,
    expectedChecksum,
  };
}

export function isValidGstin(value: string | null | undefined, verifyChecksum = true): boolean {
  return validateGstin(value, { verifyChecksum }).valid;
}
