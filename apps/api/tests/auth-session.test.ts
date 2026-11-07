// Session rules (CONTRACT §6 Tokens, Rotation, Idle/absolute timeout, CSRF): refresh rotation, reuse
// detection, timeouts, logout/logout-all, and the per-request DB re-check in authenticate.
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import {
  API,
  XRW,
  auditRows,
  cookiePair,
  errorOf,
  makeUser,
  newApp,
  prisma,
  refreshCookieOf,
  signIn,
  signInOwner,
} from './helpers';
import type { Signed } from './helpers';
import { TEST_ENV } from './test-env';

const app = newApp();
const GRACE_SECONDS = Number(TEST_ENV.REFRESH_REUSE_GRACE_SECONDS);

function refresh(cookie?: string, headers: Record<string, string> = XRW) {
  const req = request(app).post(`${API}/auth/refresh`).set(headers);
  return cookie ? req.set('Cookie', cookie) : req;
}

async function me(signed: Pick<Signed, 'bearer'>) {
  return request(app).get(`${API}/auth/me`).set(signed.bearer);
}

async function sessionOf(token: string) {
  const { sid } = jwt.decode(token) as { sid: string };
  return prisma.session.findUniqueOrThrow({ where: { id: sid } });
}

describe('POST /auth/refresh', () => {
  it('requires X-Requested-With: rhai-web', async () => {
    const s = await signIn(app, await makeUser());
    const none = await refresh(s.cookie, {});
    expect(none.status).toBe(403);
    const wrong = await refresh(s.cookie, { 'X-Requested-With': 'XMLHttpRequest' });
    expect(wrong.status).toBe(403);
  });

  it('returns 401 without a cookie or with an unknown token', async () => {
    expect((await refresh()).status).toBe(401);
    const res = await refresh('rt=not-a-real-token');
    expect(res.status).toBe(401);
    expect(errorOf(res).code).toBe('SESSION_EXPIRED');
  });

  it('rotates: new cookie and token, old session revoked as "rotated", same family', async () => {
    const s = await signIn(app, await makeUser());
    const oldSession = await sessionOf(s.token);
    const res = await refresh(s.cookie);
    expect(res.status).toBe(200);
    const body = res.body as { data: { accessToken: string; user: { id: string } } };
    expect(body.data.user.id).toBe(s.user.id);
    const newCookie = cookiePair(refreshCookieOf(res));
    expect(newCookie).not.toBe(s.cookie);

    const revoked = await prisma.session.findUniqueOrThrow({ where: { id: oldSession.id } });
    expect(revoked.revokedReason).toBe('rotated');
    const fresh = await sessionOf(body.data.accessToken);
    expect(fresh.familyId).toBe(oldSession.familyId);
    expect(fresh.expiresAt.getTime()).toBe(oldSession.expiresAt.getTime());
    expect(
      (await me({ bearer: { Authorization: `Bearer ${body.data.accessToken}` } })).status,
    ).toBe(200);
  });

  it('detects reuse of a rotated token after the grace window and revokes the whole family', async () => {
    const s = await signIn(app, await makeUser());
    const original = await sessionOf(s.token);
    const first = await refresh(s.cookie);
    const second = await refresh(cookiePair(refreshCookieOf(first)));
    expect(second.status).toBe(200);
    const latestCookie = cookiePair(refreshCookieOf(second));
    const latestToken = (second.body as { data: { accessToken: string } }).data.accessToken;

    // Move the original token's rotation outside the grace window.
    await prisma.$executeRaw`UPDATE sessions SET revoked_at = now() - (${GRACE_SECONDS + 1} * interval '1 second') WHERE id = ${original.id}::uuid`;
    const replay = await refresh(s.cookie);
    expect(replay.status).toBe(401);
    expect(errorOf(replay).code).toBe('SESSION_EXPIRED');

    const family = (await sessionOf(latestToken)).familyId;
    const sessions = await prisma.session.findMany({ where: { familyId: family } });
    expect(sessions.every((x) => x.revokedAt !== null)).toBe(true);
    expect(sessions.some((x) => x.revokedReason === 'reuse_detected')).toBe(true);
    expect((await refresh(latestCookie)).status).toBe(401);
    expect((await me({ bearer: { Authorization: `Bearer ${latestToken}` } })).status).toBe(401);
    expect(await auditRows('TOKEN_REUSE_DETECTED', { targetId: family })).toHaveLength(1);
  });

  it('treats a rotated token replayed within the grace window as a tab race (409, family kept)', async () => {
    const s = await signIn(app, await makeUser());
    const first = await refresh(s.cookie);
    expect(first.status).toBe(200);
    const newestCookie = cookiePair(refreshCookieOf(first));
    const newestToken = (first.body as { data: { accessToken: string } }).data.accessToken;

    const race = await refresh(s.cookie);
    expect(race.status).toBe(409);
    expect(errorOf(race)).toMatchObject({
      code: 'REFRESH_RACE',
      message: 'Session was refreshed in another tab. Retry.',
      status: 409,
    });
    expect(race.headers['set-cookie']).toBeUndefined();

    const family = (await sessionOf(newestToken)).familyId;
    const live = await prisma.session.findMany({ where: { familyId: family, revokedAt: null } });
    expect(live).toHaveLength(1);
    expect(
      await prisma.session.count({ where: { familyId: family, revokedReason: 'reuse_detected' } }),
    ).toBe(0);
    expect(await auditRows('REFRESH_RACE', { targetId: family })).toHaveLength(1);
    expect(await auditRows('TOKEN_REUSE_DETECTED', { targetId: family })).toHaveLength(0);

    // The newest session of the family still works.
    expect((await me({ bearer: { Authorization: `Bearer ${newestToken}` } })).status).toBe(200);
    expect((await refresh(newestCookie)).status).toBe(200);
  });

  it('two simultaneous refreshes with one cookie: one rotates, the other gets REFRESH_RACE', async () => {
    const s = await signIn(app, await makeUser());
    const results = await Promise.all([refresh(s.cookie), refresh(s.cookie)]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409]);
    const winner = results.find((r) => r.status === 200);
    const loser = results.find((r) => r.status === 409);
    expect(loser && errorOf(loser).code).toBe('REFRESH_RACE');
    const token = (winner?.body as { data: { accessToken: string } }).data.accessToken;
    expect((await me({ bearer: { Authorization: `Bearer ${token}` } })).status).toBe(200);
    expect(
      await prisma.session.count({ where: { userId: s.user.id, revokedReason: 'reuse_detected' } }),
    ).toBe(0);
  });

  it('expires a session that was idle for SESSION_IDLE_MINUTES', async () => {
    const s = await signIn(app, await makeUser());
    const session = await sessionOf(s.token);
    const idleMs = Number(TEST_ENV.SESSION_IDLE_MINUTES) * 60_000;
    await prisma.session.update({
      where: { id: session.id },
      data: { lastUsedAt: new Date(Date.now() - idleMs - 1000) },
    });
    expect((await me(s)).status).toBe(401);
    const res = await refresh(s.cookie);
    expect(res.status).toBe(401);
    expect(errorOf(res).code).toBe('SESSION_EXPIRED');
  });

  it('keeps a session that is within the idle window', async () => {
    const s = await signIn(app, await makeUser());
    const session = await sessionOf(s.token);
    await prisma.session.update({
      where: { id: session.id },
      data: { lastUsedAt: new Date(Date.now() - 10 * 60_000) },
    });
    expect((await refresh(s.cookie)).status).toBe(200);
  });

  it('enforces the absolute expiry', async () => {
    const s = await signIn(app, await makeUser());
    const session = await sessionOf(s.token);
    await prisma.session.update({
      where: { id: session.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await refresh(s.cookie)).status).toBe(401);
    expect((await me(s)).status).toBe(401);
  });

  it('refuses refresh for a deactivated user', async () => {
    const user = await makeUser();
    const s = await signIn(app, user);
    await prisma.user.update({ where: { id: user.id }, data: { status: 'INACTIVE' } });
    expect((await refresh(s.cookie)).status).toBe(401);
  });

  it('clears the cookie when refresh fails', async () => {
    const res = await refresh('rt=bogus');
    expect(refreshCookieOf(res)).toMatch(/^rt=;/);
  });
});

describe('authenticate (Bearer)', () => {
  it('rejects a missing, malformed or tampered token', async () => {
    expect((await request(app).get(`${API}/auth/me`)).status).toBe(401);
    expect(
      (await request(app).get(`${API}/auth/me`).set('Authorization', 'Basic abc')).status,
    ).toBe(401);
    const s = await signIn(app, await makeUser());
    const tampered = `${s.token.slice(0, -2)}xx`;
    const res = await request(app).get(`${API}/auth/me`).set('Authorization', `Bearer ${tampered}`);
    expect(res.status).toBe(401);
    expect(errorOf(res).code).toBe('UNAUTHENTICATED');
  });

  it('rejects an alg=none token and a token signed with another secret', async () => {
    const s = await signIn(app, await makeUser());
    const claims = jwt.decode(s.token) as Record<string, unknown>;
    const none = jwt.sign(claims, '', { algorithm: 'none' });
    const other = jwt.sign(claims, 'another-secret-another-secret-another-secret');
    for (const token of [none, other]) {
      const res = await request(app).get(`${API}/auth/me`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(401);
    }
  });

  it('rejects an expired access token with SESSION_EXPIRED', async () => {
    const s = await signIn(app, await makeUser());
    const { sub, sid, role } = jwt.decode(s.token) as Record<string, string>;
    const expired = jwt.sign(
      { sub, sid, role, exp: Math.floor(Date.now() / 1000) - 10 },
      TEST_ENV.JWT_ACCESS_SECRET ?? '',
      { algorithm: 'HS256', issuer: 'rhai-erp-api', audience: 'rhai-erp-web' },
    );
    const res = await request(app).get(`${API}/auth/me`).set('Authorization', `Bearer ${expired}`);
    expect(res.status).toBe(401);
    expect(errorOf(res).code).toBe('SESSION_EXPIRED');
  });

  it('takes the role from the DB, not the token: a role change applies immediately', async () => {
    const owner = await signInOwner(app);
    // Phase 3: a MEMBER needs a unit, so the admin keeps one row to be demoted with.
    const user = await makeUser({ role: 'ADMIN', unitCodes: ['TAL'] });
    const s = await signIn(app, user);
    expect((await request(app).get(`${API}/users`).set(s.bearer)).status).toBe(200);
    const patch = await request(app)
      .patch(`${API}/users/${user.id}`)
      .set(owner.bearer)
      .set('If-Match', String(user.version))
      .send({ role: 'MEMBER' });
    expect(patch.status).toBe(200);
    // Same token (still claims ADMIN) is now treated as MEMBER.
    expect((await request(app).get(`${API}/users`).set(s.bearer)).status).toBe(403);
    expect(((await me(s)).body as { data: { role: string } }).data.role).toBe('MEMBER');
  });

  it('a deactivated user is locked out immediately', async () => {
    const user = await makeUser();
    const s = await signIn(app, user);
    await prisma.user.update({ where: { id: user.id }, data: { status: 'INACTIVE' } });
    expect((await me(s)).status).toBe(401);
  });

  it('a revoked session is refused immediately', async () => {
    const s = await signIn(app, await makeUser());
    const session = await sessionOf(s.token);
    await prisma.session.update({
      where: { id: session.id },
      data: { revokedAt: new Date(), revokedReason: 'logout' },
    });
    expect((await me(s)).status).toBe(401);
  });
});

describe('POST /auth/logout', () => {
  it('requires X-Requested-With', async () => {
    const s = await signIn(app, await makeUser());
    const res = await request(app).post(`${API}/auth/logout`).set('Cookie', s.cookie);
    expect(res.status).toBe(403);
  });

  it('revokes the cookie session, clears the cookie and is audited', async () => {
    const s = await signIn(app, await makeUser());
    const res = await request(app).post(`${API}/auth/logout`).set(XRW).set('Cookie', s.cookie);
    expect(res.status).toBe(204);
    expect(refreshCookieOf(res)).toMatch(/^rt=;.*Path=\/api\/v1\/auth/);
    expect((await refresh(s.cookie)).status).toBe(401);
    expect((await me(s)).status).toBe(401);
    expect((await sessionOf(s.token)).revokedReason).toBe('logout');
    expect(await auditRows('LOGOUT', { actorId: s.user.id })).toHaveLength(1);
  });

  it('works with only a Bearer token, and is a no-op 204 with nothing', async () => {
    const s = await signIn(app, await makeUser());
    const res = await request(app).post(`${API}/auth/logout`).set(XRW).set(s.bearer);
    expect(res.status).toBe(204);
    expect((await me(s)).status).toBe(401);
    expect((await request(app).post(`${API}/auth/logout`).set(XRW)).status).toBe(204);
  });
});

describe('POST /auth/logout-all', () => {
  it('requires a Bearer token', async () => {
    expect((await request(app).post(`${API}/auth/logout-all`)).status).toBe(401);
  });

  it('revokes every session of the caller only', async () => {
    const user = await makeUser();
    const a = await signIn(app, user);
    const b = await signIn(app, user);
    const bystander = await signIn(app, await makeUser());
    const res = await request(app).post(`${API}/auth/logout-all`).set(a.bearer);
    expect(res.status).toBe(204);
    expect((await me(a)).status).toBe(401);
    expect((await me(b)).status).toBe(401);
    expect((await refresh(b.cookie)).status).toBe(401);
    expect((await me(bystander)).status).toBe(200);
    expect(await auditRows('LOGOUT_ALL', { actorId: user.id })).toHaveLength(1);
  });
});
