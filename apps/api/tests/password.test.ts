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
    ['Ab1!', 'at least 10'],
    ['abcdefghijk', '3 of'],
    ['abcdefghij1', '3 of'],
    ['ABCDEFGHIJ!', '3 of'],
  ])('rejects %s', (password, message) => {
    expect(checkPasswordPolicy(password, identity)).toContain(message);
  });

  it.each(['abcdefgh1!', 'Abcdefghij1', 'ABCDEFGH1!', 'Abcdefghi!', 'pass word 9X'])(
    'accepts %s',
    (password) => {
      expect(checkPasswordPolicy(password, identity)).toBeNull();
    },
  );

  it('rejects a password equal to the login ID or email', () => {
    expect(checkPasswordPolicy('John.Doe.1A', { loginId: 'john.doe.1a' })).toContain('login ID');
    expect(
      checkPasswordPolicy('Me@Example.com1', { loginId: 'someone', email: 'me@example.com1' }),
    ).toContain('email');
  });

  it('rejects a password longer than 128 characters', () => {
    expect(checkPasswordPolicy(`Aa1!${'x'.repeat(130)}`, identity)).toContain('at most');
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
    expect(errorOf(weak).fields?.newPassword).toContain('at least 10');
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

  it('clears the flag, revokes other sessions, returns fresh tokens and is audited', async () => {
    const user = await makeUser({ mustChangePassword: true });
    const current = await signIn(app, user);
    const other = await signIn(app, user);
    const res = await change(current.bearer, {
      currentPassword: PASSWORD,
      newPassword: 'Brand-New-Passw0rd',
    });
    expect(res.status).toBe(200);
    const body = res.body as {
      data: { accessToken: string; expiresIn: number; user: { mustChangePassword: boolean } };
    };
    expect(body.data.user.mustChangePassword).toBe(false);
    expect(body.data.expiresIn).toBe(900);
    const fresh = { Authorization: `Bearer ${body.data.accessToken}` };
    const freshCookie = cookiePair(refreshCookieOf(res));

    // The new session works and is no longer gated.
    expect((await request(app).get(`${API}/meta/roles`).set(fresh)).status).toBe(200);
    expect((await request(app).post(`${API}/auth/logout-all`).set(other.bearer)).status).toBe(401);
    // Other devices are signed out, including their refresh cookies.
    expect((await request(app).get(`${API}/auth/me`).set(other.bearer)).status).toBe(401);
    expect(
      (await request(app).post(`${API}/auth/refresh`).set(XRW).set('Cookie', other.cookie)).status,
    ).toBe(401);
    expect(
      (await request(app).post(`${API}/auth/refresh`).set(XRW).set('Cookie', freshCookie)).status,
    ).toBe(200);

    // Old password no longer works, new one does.
    expect((await login(app, user.loginId, PASSWORD)).status).toBe(401);
    expect((await login(app, user.loginId, 'Brand-New-Passw0rd')).status).toBe(200);

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.mustChangePassword).toBe(false);
    const rows = await auditRows('PASSWORD_CHANGED', { actorId: user.id });
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain('Brand-New-Passw0rd');
  });
});
