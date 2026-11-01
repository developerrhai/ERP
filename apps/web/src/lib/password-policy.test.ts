// Password policy hints mirror CONTRACT §6: >= 10 chars, 3 of 4 classes, not loginId/email.
import { describe, expect, it } from 'vitest';
import { checkPassword, passwordOk } from './password-policy';
import { safeNext } from './next-path';

describe('password policy', () => {
  it('requires 10+ characters', () => {
    expect(checkPassword('Ab1!', 'u', null).find((c) => c.id === 'length')?.ok).toBe(false);
    expect(checkPassword('Abcdefgh1!', 'u', null).find((c) => c.id === 'length')?.ok).toBe(true);
  });

  it('requires 3 of 4 character classes', () => {
    expect(passwordOk('abcdefghij', 'u')).toBe(false);
    expect(passwordOk('abcdefghi1', 'u')).toBe(false);
    expect(passwordOk('abcdefgh1A', 'u')).toBe(true);
    expect(passwordOk('abcdefgh1!', 'u')).toBe(true);
  });

  it('rejects the login ID or email (case-insensitive)', () => {
    expect(passwordOk('Asha.Patil1', 'asha.patil1')).toBe(false);
    expect(passwordOk('Asha@Rhai.local1', 'asha', 'asha@rhai.local1')).toBe(false);
    expect(passwordOk('Different#Pass1', 'asha', 'asha@rhai.local')).toBe(true);
  });
});

describe('safeNext', () => {
  it('only allows in-app paths', () => {
    expect(safeNext('/m/admin-users')).toBe('/m/admin-users');
    expect(safeNext('//evil.example')).toBe('/');
    expect(safeNext('https://evil.example')).toBe('/');
    expect(safeNext('/\\evil')).toBe('/');
    expect(safeNext(null)).toBe('/');
    expect(safeNext('/login?next=/x')).toBe('/');
  });
});
