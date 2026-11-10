/**
 * ISO 6346 Shipping Container Number Check Digit Validator
 */

const LETTER_MAP: Record<string, number> = {
  A: 10, B: 12, C: 13, D: 14, E: 15, F: 16, G: 17, H: 18, I: 19,
  J: 20, K: 21, L: 23, M: 24, N: 25, O: 26, P: 27, Q: 28, R: 29,
  S: 30, T: 31, U: 32, V: 34, W: 35, X: 36, Y: 37, Z: 38,
};

export function computeIso6346CheckDigit(prefix10: string): number {
  const s = prefix10.toUpperCase();
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const ch = s[i]!;
    const val = i < 4 ? LETTER_MAP[ch] : Number(ch);
    if (val === undefined || Number.isNaN(val)) {
      throw new Error(`Invalid character '${ch}' at position ${i} in container code.`);
    }
    sum += val * Math.pow(2, i);
  }
  const rem = sum % 11;
  return rem % 10;
}

export function validateIso6346Container(containerNo: string): {
  valid: boolean;
  expectedCheckDigit?: number;
  reason?: string;
} {
  const normalized = containerNo.trim().toUpperCase();
  if (!/^[A-Z]{3}[UJZ][0-9]{7}$/.test(normalized)) {
    return {
      valid: false,
      reason: 'Container number must be 3 letters + U/J/Z + 7 digits (e.g. CSQU3054383).',
    };
  }
  const prefix10 = normalized.slice(0, 10);
  const actualDigit = Number(normalized[10]!);
  const expectedCheckDigit = computeIso6346CheckDigit(prefix10);
  if (actualDigit !== expectedCheckDigit) {
    return {
      valid: false,
      expectedCheckDigit,
      reason: 'Container number check digit invalid.',
    };
  }
  return { valid: true, expectedCheckDigit };
}

