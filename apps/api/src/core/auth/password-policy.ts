// NIST SP 800-63B password policy enforcement:
// - Length check (12 to 128 characters by default, configurable via SecurityPolicy)
// - SecLists 10k most common passwords blocklist (including trailing digits/symbols stripped)
// - Context words check (company, units, user identity)
import fs from 'node:fs';
import path from 'node:path';

export interface PasswordPolicyConfig {
  passwordMinLength?: number;
}

export interface UserIdentityContext {
  loginId?: string | null;
  email?: string | null;
  name?: string | null;
}

const DEFAULT_MIN_LENGTH = 12;
const MAX_LENGTH = 128;

const CONTEXT_WORDS = new Set([
  'sawant',
  'readyhand',
  'talwade',
  'sawardari',
  'varale',
  'erp',
  'password',
]);

let blocklistSet: Set<string> | null = null;

function loadBlocklist(): Set<string> {
  if (blocklistSet) return blocklistSet;
  const set = new Set<string>();
  const filePath = path.join(__dirname, 'seclists-10k.txt');
  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim().toLowerCase();
      if (trimmed.length > 0) {
        set.add(trimmed);
      }
    }
  }
  blocklistSet = set;
  return set;
}

/** Preload blocklist into memory at boot */
export function warmUpPasswordBlocklist(): void {
  loadBlocklist();
}

/** Strip trailing digits and special symbols to check base word (e.g. "password123!" -> "password") */
export function stripTrailingDigitsAndSymbols(str: string): string {
  return str.replace(/[0-9!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]+$/, '');
}

/**
 * Validates password against NIST SP 800-63B standards and returns exact error message from §8, or null if valid.
 */
export function checkPasswordPolicy(
  password: string,
  identity?: UserIdentityContext | null,
  policy?: PasswordPolicyConfig | null,
): string | null {
  const minLength = policy?.passwordMinLength ?? DEFAULT_MIN_LENGTH;

  if (password.length < minLength) {
    return `Password must be at least ${minLength} characters.`;
  }

  if (password.length > MAX_LENGTH) {
    return `Password must be at most ${MAX_LENGTH} characters.`;
  }

  const blocklist = loadBlocklist();
  const lowerPassword = password.toLowerCase();

  // Check full password against blocklist
  if (blocklist.has(lowerPassword)) {
    return 'This password is too common. Choose a longer phrase, e.g. three unrelated words.';
  }

  // Check with trailing digits and symbols stripped
  const stripped = stripTrailingDigitsAndSymbols(lowerPassword);
  if (stripped.length >= 3 && blocklist.has(stripped)) {
    return 'This password is too common. Choose a longer phrase, e.g. three unrelated words.';
  }

  // Check context words (company / units / ERP)
  for (const word of CONTEXT_WORDS) {
    if (word.length >= 4 && lowerPassword.includes(word)) {
      return 'Do not use your name, login ID, email or the company name in your password.';
    }
  }

  // Check user-specific identity context words
  if (identity) {
    const candidateWords: string[] = [];
    if (identity.loginId) {
      candidateWords.push(identity.loginId.toLowerCase());
    }
    if (identity.email) {
      const emailLower = identity.email.toLowerCase();
      candidateWords.push(emailLower);
      const emailUser = emailLower.split('@')[0];
      if (emailUser && emailUser.length >= 4) {
        candidateWords.push(emailUser);
      }
    }
    if (identity.name) {
      const nameParts = identity.name.toLowerCase().split(/[\s,._-]+/);
      for (const part of nameParts) {
        if (part.length >= 4) {
          candidateWords.push(part);
        }
      }
    }

    for (const word of candidateWords) {
      if (word.length >= 4 && lowerPassword.includes(word)) {
        return 'Do not use your name, login ID, email or the company name in your password.';
      }
    }
  }

  return null;
}
