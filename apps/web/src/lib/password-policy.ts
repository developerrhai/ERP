// The screen's copy of the server's password rules (apps/api/src/core/auth/password-policy.ts), so that what turns
// green here is what the server accepts. The server remains the authority and re-checks every password; the list of
// common passwords is checked only there.

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

/** The server's company words of four letters or more. */
const COMPANY_WORDS = ['sawant', 'readyhand', 'talwade', 'sawardari', 'varale', 'password'];

export interface PolicyCheck {
  id: 'length' | 'identity' | 'company';
  label: string;
  ok: boolean;
}

/** The parts of a person's identity that a password must not contain (only those of four characters or more). */
export function identityWords(loginId?: string | null, email?: string | null, name?: string | null): string[] {
  const words: string[] = [];
  if (loginId) words.push(loginId.trim().toLowerCase());
  if (email) {
    const lower = email.trim().toLowerCase();
    words.push(lower, lower.split('@')[0] ?? '');
  }
  if (name) words.push(...name.toLowerCase().split(/[\s,._-]+/));
  return words.filter((w) => w.length >= 4);
}

/**
 * The rules with a tick for each one met. The "does not contain" rules turn green only once the password is long
 * enough: a tick on one typed letter would mean nothing.
 */
export function checkPassword(
  pw: string,
  loginId?: string | null,
  email?: string | null,
  name?: string | null,
  minLength: number = PASSWORD_MIN_LENGTH,
): PolicyCheck[] {
  const lower = pw.toLowerCase();
  const longEnough = pw.length >= minLength && pw.length <= PASSWORD_MAX_LENGTH;
  const clear = (words: string[]): boolean => longEnough && !words.some((w) => lower.includes(w));
  const checks: PolicyCheck[] = [
    { id: 'length', label: `${minLength} to ${PASSWORD_MAX_LENGTH} characters`, ok: longEnough },
  ];
  // the email-reset screen passes nothing, as it does not know who the person is: the server checks this rule there.
  // An empty text (a new user whose login ID is not typed yet) still shows the rule.
  if ([loginId, email, name].some((v) => v !== null && v !== undefined))
    checks.push({
      id: 'identity',
      label: name ? 'Does not contain your name, login ID or email' : 'Does not contain the login ID or email',
      ok: clear(identityWords(loginId, email, name)),
    });
  checks.push({
    id: 'company',
    label: 'No company or plant name, and not the word "password"',
    ok: clear(COMPANY_WORDS),
  });
  return checks;
}

export function passwordOk(
  pw: string,
  loginId?: string | null,
  email?: string | null,
  name?: string | null,
  minLength: number = PASSWORD_MIN_LENGTH,
): boolean {
  return checkPassword(pw, loginId, email, name, minLength).every((c) => c.ok);
}
