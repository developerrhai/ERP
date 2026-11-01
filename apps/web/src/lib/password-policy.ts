// Client-side mirror of the password policy in CONTRACT §6 so users see live hints;
// the server remains the authority and re-validates every password.

export interface PolicyCheck {
  id: 'length' | 'classes' | 'identity';
  label: string;
  ok: boolean;
}

export function characterClasses(pw: string): number {
  let n = 0;
  if (/[a-z]/.test(pw)) n += 1;
  if (/[A-Z]/.test(pw)) n += 1;
  if (/[0-9]/.test(pw)) n += 1;
  if (/[^A-Za-z0-9]/.test(pw)) n += 1;
  return n;
}

export function checkPassword(
  pw: string,
  loginId: string | null | undefined,
  email: string | null | undefined,
): PolicyCheck[] {
  const lower = pw.toLowerCase();
  const sameAsIdentity =
    (!!loginId && lower === loginId.toLowerCase()) || (!!email && lower === email.toLowerCase());
  return [
    { id: 'length', label: 'At least 10 characters', ok: pw.length >= 10 },
    {
      id: 'classes',
      label: '3 of 4: lowercase, uppercase, digit, symbol',
      ok: characterClasses(pw) >= 3,
    },
    {
      id: 'identity',
      label: 'Not the same as your login ID or email',
      ok: pw.length > 0 && !sameAsIdentity,
    },
  ];
}

export function passwordOk(pw: string, loginId?: string | null, email?: string | null): boolean {
  return checkPassword(pw, loginId, email).every((c) => c.ok);
}
