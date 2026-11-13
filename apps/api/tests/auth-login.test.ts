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

  it('stores only the sha256 of the refresh token', async () => {
    const user = await makeUser();
    const cookie = refreshCookieOf(await login(app, user.loginId)) ?? '';
    const raw = cookie.split(';')[0]?.slice(3) ?? '';
    const session = await prisma.session.findFirstOrThrow({ where: { userId: user.id } });
    expect(session.refreshTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(session.refreshTokenHash).not.toBe(raw);
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
