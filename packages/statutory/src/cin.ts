// packages/statutory/src/cin.ts
// Corporate Identity Number (CIN) validation and metadata per Ministry of Corporate Affairs (MCA)

export const CIN_REGEX = /^[LU][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$/;

export interface CinValidationResult {
  valid: boolean;
  cin: string;
  isListed?: boolean;
  industryCode?: string;
  stateCode?: string;
  incorporationYear?: number;
  companyClassification?: string;
  rocRegistrationNumber?: string;
  error?: string;
}

export function validateCin(value: string | null | undefined): CinValidationResult {
  if (!value || typeof value !== 'string') {
    return { valid: false, cin: '', error: 'CIN is required.' };
  }
  const clean = value.trim().toUpperCase();
  if (clean.length !== 21) {
    return { valid: false, cin: clean, error: 'CIN must be exactly 21 characters long.' };
  }
  if (!CIN_REGEX.test(clean)) {
    return {
      valid: false,
      cin: clean,
      error: 'CIN format is invalid (expected L/U + 5 digits + 2 letters state + 4 digits year + 3 letters type + 6 digits ROC).',
    };
  }

  const isListed = clean.startsWith('L');
  const industryCode = clean.slice(1, 6);
  const stateCode = clean.slice(6, 8);
  const incorporationYear = parseInt(clean.slice(8, 12), 10);
  const companyClassification = clean.slice(12, 15);
  const rocRegistrationNumber = clean.slice(15, 21);

  return {
    valid: true,
    cin: clean,
    isListed,
    industryCode,
    stateCode,
    incorporationYear,
    companyClassification,
    rocRegistrationNumber,
  };
}

export function isValidCin(value: string | null | undefined): boolean {
  return validateCin(value).valid;
}
