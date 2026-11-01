// Login rules (CONTRACT §6 Login, Lockout, Tokens): loginId or email, case-insensitive, generic 401
// for every failure, lockout at 10 failures, counter reset, cookie attributes and audit rows.
import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import {
  API,
  PASSWORD,
  auditRows,
  errorOf,
  login,
  makeUser,
  newApp,
  prisma,
  refreshCookieOf,
} from './helpers';
import request from 'supertest';

const app = newApp();
const GENERIC = { code: 'INVALID_CREDENTIALS', message: 'Invalid login ID or password.' };

interface LoginBody {
  data: { accessToken: string; expiresIn: number; user: Record<string, unknown> };
}

describe('POST /auth/login', () => {
  it('accepts the login ID, case-insensitively', async () => {
    const user = await makeUser();
    const res = await login(app, user.loginId.toUpperCase());
    expect(res.status).toBe(200);
    const body = res.body as LoginBody;
    expect(body.data.expiresIn).toBe(900);
    expect(body.data.user.id).toBe(user.id);
  });

  it('accepts the email, case-insensitively, with surrounding spaces', async () => {
    const user = await makeUser();
    const res = await login(app, `  ${(user.email ?? '').toUpperCase()}  `);
    expect(res.status).toBe(200);
  });

  it('issues an HS256 access token with sub, sid, role and a 15 min TTL', async () => {
    const user = await makeUser({ role: 'LEAD' });
    const res = await login(app, user.loginId);
    const token = (res.body as LoginBody).data.accessToken;
    const decoded = jwt.decode(token, { complete: true });
    expect(decoded?.header.alg).toBe('HS256');
    const payload = decoded?.payload as Record<string, unknown>;
    expect(payload.sub).toBe(user.id);
    expect(typeof payload.sid).toBe('string');
    expect(payload.role).toBe('LEAD');
    expect(Number(payload.exp) - Number(payload.iat)).toBe(900);
  });

  it('returns a user DTO without secrets', async () => {
    const user = await makeUser();
    const res = await login(app, user.loginId);
    const dto = (res.body as LoginBody).data.user;
    expect(Object.keys(dto).sort()).toEqual(
      [
        'id',
        'loginId',
        'email',
        'name',
        'role',
        'roleLabel',
        'roleLevel',
        'department',
        'status',
        'mustChangePassword',
        'lastLoginAt',
        'createdAt',
        'updatedAt',
        'version',
      ].sort(),
    );
    expect(JSON.stringify(res.body)).not.toContain('argon2');
  });

  it('sets the rt cookie: httpOnly, SameSite=Strict, Path=/api/v1/auth, Max-Age 7 days, no Secure in dev', async () => {
    const user = await makeUser();
    const cookie = refreshCookieOf(await login(app, user.loginId)) ?? '';
    expect(cookie).toMatch(/^rt=[A-Za-z0-9_-]{43};/);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Path=/api/v1/auth');
    expect(cookie).toMatch(/Max-Age=(604800|604799)/);
    expect(cookie).not.toContain('Secure');
  });

  it('stores only the sha256 of the refresh token', async () => {
    const user = await makeUser();
    const cookie = refreshCookieOf(await login(app, user.loginId)) ?? '';
    const raw = cookie.split(';')[0]?.slice(3) ?? '';
    const session = await prisma.session.findFirstOrThrow({ where: { userId: user.id } });
    expect(session.refreshTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(session.refreshTokenHash).not.toBe(raw);
  });

  it('gives the same generic 401 for wrong password, unknown user and inactive user', async () => {
    const user = await makeUser();
    const inactive = await makeUser({ status: 'INACTIVE' });
    const wrong = await login(app, user.loginId, 'Wrong-Passw0rd!');
    const unknown = await login(app, 'nobody-here', PASSWORD);
    const disabled = await login(app, inactive.loginId, PASSWORD);
    for (const res of [wrong, unknown, disabled]) {
      expect(res.status).toBe(401);
      expect(errorOf(res)).toMatchObject(GENERIC);
      expect(refreshCookieOf(res)).toBeUndefined();
    }
  });

  it('rejects unknown keys and missing fields with 422', async () => {
    const extra = await request(app)
      .post(`${API}/auth/login`)
      .send({ identifier: 'a', password: 'b', companyCode: 'X' });
    expect(extra.status).toBe(422);
    expect(errorOf(extra).fields).toMatchObject({ companyCode: 'Unknown field.' });
    const missing = await request(app).post(`${API}/auth/login`).send({ identifier: 'a' });
    expect(missing.status).toBe(422);
    expect(errorOf(missing).fields?.password).toBeDefined();
  });

  it('records LOGIN_SUCCESS and lastLoginAt', async () => {
    const user = await makeUser();
    await login(app, user.loginId);
    const rows = await auditRows('LOGIN_SUCCESS', { actorId: user.id });
    expect(rows).toHaveLength(1);
    const fresh = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(fresh.lastLoginAt).not.toBeNull();
  });

  it('records LOGIN_FAILED with the identifier and never the password', async () => {
    const res = await login(app, 'ghost-user-xyz', 'Sup3r-Secret-Value!');
    expect(res.status).toBe(401);
    const rows = await auditRows('LOGIN_FAILED');
    const row = rows.find((r) => JSON.stringify(r.detail).includes('ghost-user-xyz'));
    expect(row).toBeDefined();
    expect(JSON.stringify(row)).not.toContain('Sup3r-Secret-Value!');
  });
});

describe('timing', () => {
  it('spends Argon2 time on unknown users too (dummy verify)', async () => {
    const user = await makeUser();
    const time = async (identifier: string): Promise<number> => {
      const start = performance.now();
      await login(app, identifier, 'Wrong-Passw0rd!');
      return performance.now() - start;
    };
    await time('warm-up-unknown');
    let known = 0;
    let unknown = 0;
    for (let i = 0; i < 3; i++) {
      known += await time(user.loginId);
      unknown += await time(`missing-${i}-user`);
    }
    // Without the dummy verify an unknown user answers in a few ms instead of ~Argon2 time.
    expect(unknown).toBeGreaterThan(known * 0.5);
  });
});

describe('lockout', () => {
  it('locks after 10 consecutive failures, refuses even the right password, then unlocks', async () => {
    const user = await makeUser();
    for (let i = 1; i <= 9; i++) {
      const res = await login(app, user.loginId, `Wrong-Passw0rd-${i}`);
      expect(res.status).toBe(401);
    }
    const tenth = await login(app, user.loginId, 'Wrong-Passw0rd-10');
    expect(tenth.status).toBe(423);
    expect(errorOf(tenth).code).toBe('ACCOUNT_LOCKED');
    expect(errorOf(tenth).message).toBe('Too many failed attempts. Try again in 15 minutes.');

    const correctWhileLocked = await login(app, user.loginId, PASSWORD);
    expect(correctWhileLocked.status).toBe(423);
    expect(errorOf(correctWhileLocked).message).toMatch(/Try again in 1[45] minutes\./);

    expect(await auditRows('ACCOUNT_LOCKED', { targetId: user.id })).toHaveLength(1);

    // Simulate the 15 minutes passing.
    await prisma.user.update({
      where: { id: user.id },
      data: { lockedUntil: new Date(Date.now() - 1000) },
    });
    const after = await login(app, user.loginId, PASSWORD);
    expect(after.status).toBe(200);
  });

  it('a successful login resets the failure counter', async () => {
    const user = await makeUser();
    for (let i = 0; i < 9; i++) await login(app, user.loginId, 'Wrong-Passw0rd!');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).failedLoginCount).toBe(
      9,
    );
    expect((await login(app, user.loginId)).status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).failedLoginCount).toBe(
      0,
    );
    // 9 more failures do not lock, because the counter restarted.
    for (let i = 0; i < 9; i++) {
      expect((await login(app, user.loginId, 'Wrong-Passw0rd!')).status).toBe(401);
    }
  });
});
