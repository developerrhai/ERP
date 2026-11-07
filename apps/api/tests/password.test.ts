// Password policy, Argon2id hashing, the must-change-password gate and POST /auth/change-password
// (CONTRACT §6 Passwords and Must change password).
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { checkPasswordPolicy, hashPassword, verifyPassword } from '../src/core/auth/password';
import {
  API,
  PASSWORD,
  XRW,
  auditRows,
  cookiePair,
  errorOf,
  login,
  makeUser,
  newApp,
  prisma,
  refreshCookieOf,
  signIn,
} from './helpers';

const app = newApp();
const identity = { loginId: 'john.doe', email: 'john@example.com' };

describe('password policy', () => {
  it.each([
    ['Ab1!short', 'at least 12'],
    ['password12345', 'too common'],
    ['qwerty12345678', 'too common'],
    ['baseball12345', 'too common'],
  ])('rejects %s', (password, message) => {
    expect(checkPasswordPolicy(password, identity)).toContain(message);
  });

  it.each([
    'correct horse battery',
    'my-uncommon-passphrase-here',
    'brand-new-secret-phrase',
    'pass word 9X extra length',
  ])('accepts %s', (password) => {
    expect(checkPasswordPolicy(password, identity)).toBeNull();
  });

  it('rejects a password equal to or containing login ID or email or company context', () => {
    expect(checkPasswordPolicy('john.doe.12345', { loginId: 'john.doe' })).toContain(
      'login ID',
    );
    expect(
      checkPasswordPolicy('john@example.com-extra', { loginId: 'someone', email: 'john@example.com' }),
    ).toContain('email');
    expect(checkPasswordPolicy('sawant-group-123', identity)).toContain('company');
    expect(checkPasswordPolicy('readyhand-security', identity)).toContain('company');
  });

  it('rejects a password longer than 128 characters', () => {
    expect(checkPasswordPolicy(`Aa1!${'x'.repeat(130)}`, identity)).toContain('at most 128');
  });
});

describe('hashing', () => {
  it('uses Argon2id and verifies only the right password', async () => {
    const hash = await hashPassword('Correct-Horse-1');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(hash).toContain('m=65536,t=3,p=1');
    expect(await verifyPassword(hash, 'Correct-Horse-1')).toBe(true);
    expect(await verifyPassword(hash, 'correct-horse-1')).toBe(false);
    expect(await verifyPassword('not-a-hash', 'x')).toBe(false);
  });
});

describe('must change password gate', () => {
  it('blocks everything except /auth/me, /auth/change-password, /auth/logout and /meta/*', async () => {
    const s = await signIn(app, await makeUser({ role: 'ADMIN', mustChangePassword: true }));
    const blocked = [
      request(app).get(`${API}/users`).set(s.bearer),
      request(app).post(`${API}/auth/logout-all`).set(s.bearer),
      request(app).post(`${API}/users`).set(s.bearer).send({}),
    ];
    for (const res of await Promise.all(blocked)) {
      expect(res.status).toBe(403);
      expect(errorOf(res).code).toBe('PASSWORD_CHANGE_REQUIRED');
    }
    const target = await makeUser();
    const gatedWrites = [
      request(app)
        .patch(`${API}/users/${target.id}`)
        .set(s.bearer)
        .set('If-Match', String(target.version))
        .send({ name: 'Gate Probe' }),
      request(app)
        .post(`${API}/users/${target.id}/reset-password`)
        .set(s.bearer)
        .send({ temporaryPassword: 'Gate-Passw0rd!' }),
    ];
    for (const res of await Promise.all(gatedWrites)) {
      expect(res.status).toBe(403);
      expect(errorOf(res).code).toBe('PASSWORD_CHANGE_REQUIRED');
    }
    expect((await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).name).toBe(
      target.name,
    );
    expect((await request(app).get(`${API}/auth/me`).set(s.bearer)).status).toBe(200);
    expect((await request(app).get(`${API}/meta/roles`).set(s.bearer)).status).toBe(200);
    expect((await request(app).get(`${API}/meta/departments`).set(s.bearer)).status).toBe(200);
    expect(
      (await request(app).post(`${API}/auth/logout`).set(XRW).set('Cookie', s.cookie)).status,
    ).toBe(204);
  });
});

describe('POST /auth/change-password', () => {
  const change = (bearer: { Authorization: string }, body: Record<string, unknown>) =>
    request(app).post(`${API}/auth/change-password`).set(bearer).send(body);

  it('requires a Bearer token', async () => {
    const res = await request(app)
      .post(`${API}/auth/change-password`)
      .send({ currentPassword: PASSWORD, newPassword: 'New-Passw0rd!' });
    expect(res.status).toBe(401);
  });

  it('rejects a wrong current password with 422', async () => {
    const s = await signIn(app, await makeUser({ mustChangePassword: true }));
    const res = await change(s.bearer, {
      currentPassword: 'Not-The-Passw0rd',
      newPassword: 'New-Passw0rd!',
    });
    expect(res.status).toBe(422);
    expect(errorOf(res).fields?.currentPassword).toBeDefined();
  });

  it('applies the policy to the new password', async () => {
    const user = await makeUser({ mustChangePassword: true });
    const s = await signIn(app, user);
    const weak = await change(s.bearer, { currentPassword: PASSWORD, newPassword: 'short' });
    expect(weak.status).toBe(422);
    expect(errorOf(weak).fields?.newPassword).toContain('at least 12');
    const same = await change(s.bearer, { currentPassword: PASSWORD, newPassword: PASSWORD });
    expect(same.status).toBe(422);
    const asLogin = await change(s.bearer, {
      currentPassword: PASSWORD,
      newPassword: `${user.loginId.toUpperCase()}`,
    });
    expect(asLogin.status).toBe(422);
    const extra = await change(s.bearer, {
      currentPassword: PASSWORD,
      newPassword: 'New-Passw0rd!',
      confirm: 'x',
    });
    expect(extra.status).toBe(422);
  });


});
