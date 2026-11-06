// packages/statutory/src/pan.ts
// Permanent Account Number (PAN) validation and metadata extraction per Income Tax Act, 1961

export const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

export type PanEntityType =
  | 'Individual'
  | 'Company'
  | 'HUF'
  | 'Firm'
  | 'AOP'
  | 'Trust'
  | 'BOI'
  | 'Local Authority'
  | 'Artificial Juridical Person'
  | 'Government'
  | 'Unknown';

const PAN_STATUS_MAP: Record<string, PanEntityType> = {
  P: 'Individual',
  C: 'Company',
  H: 'HUF',
  F: 'Firm',
  A: 'AOP',
  T: 'Trust',
  B: 'BOI',
  L: 'Local Authority',
  J: 'Artificial Juridical Person',
  G: 'Government',
};

export interface PanValidationResult {
  valid: boolean;
  pan: string;
  entityType?: PanEntityType;
  error?: string;
}

export function validatePan(value: string | null | undefined): PanValidationResult {
  if (!value || typeof value !== 'string') {
    return { valid: false, pan: '', error: 'PAN is required.' };
  }
  const clean = value.trim().toUpperCase();
  if (clean.length !== 10) {
    return { valid: false, pan: clean, error: 'PAN must be exactly 10 characters long.' };
  }
  if (!PAN_REGEX.test(clean)) {
    return { valid: false, pan: clean, error: 'PAN format is invalid (expected 5 letters, 4 digits, 1 letter).' };
  }
  const statusChar = clean.charAt(3);
  const entityType = PAN_STATUS_MAP[statusChar] ?? 'Unknown';
  return {
    valid: true,
    pan: clean,
    entityType,
  };
}

export function isValidPan(value: string | null | undefined): boolean {
  return validatePan(value).valid;
}
