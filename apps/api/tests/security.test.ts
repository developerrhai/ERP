// Regression tests for the security review (README-PHASE1.md "Security review fixes"): atomic
// lockout, change-password brute force, trust proxy + IP keys, one-time refresh grace, Argon2
// concurrency cap, unknown-identifier lockout, PATCH guards, DB namespace trigger, audit hygiene.
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { AppError } from '../src/core/http/errors';
import { configureArgon2Concurrency, withArgon2Slot } from '../src/core/auth/argon2-gate';
import { FailureTracker } from '../src/core/auth/unknown-identifier-lockout';
import { userRepository } from '../src/modules/users/repository';
import { toDuplicateError } from '../src/modules/users/service';
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
  uniqueLoginId,
} from './helpers';
import { TEST_ENV } from './test-env';

const app = newApp();

afterAll(() => {
  configureArgon2Concurrency(Number(TEST_ENV.ARGON2_MAX_CONCURRENCY));
});

async function lockState(id: string) {
  return prisma.user.findUniqueOrThrow({
    where: { id },
    select: { failedLoginCount: true, lockedUntil: true },
  });
}

describe('1. lockout is atomic under concurrency', () => {
  it('30 parallel wrong logins: at most 9 plain 401s, one lock, then the right password gets 423', async () => {
    const user = await makeUser();
    const results = await Promise.all(
      Array.from({ length: 30 }, (_, i) => login(app, user.loginId, `Wrong-Passw0rd-${i}`)),
    );
    const statuses = results.map((r) => r.status);
    expect(statuses.every((s) => s === 401 || s === 423)).toBe(true);
    expect(statuses.filter((s) => s === 401).length).toBeLessThanOrEqual(9);
    expect(statuses.filter((s) => s === 423).length).toBeGreaterThanOrEqual(21);
    expect(await auditRows('ACCOUNT_LOCKED', { targetId: user.id })).toHaveLength(1);

    const correct = await login(app, user.loginId, PASSWORD);
    expect(correct.status).toBe(423);
    const state = await lockState(user.id);
    expect(state.lockedUntil?.getTime()).toBeGreaterThan(Date.now());
  });

  it('a correct password racing 30 wrong ones never leaves the account unlocked', async () => {
    const user = await makeUser();
    await Promise.all([
      ...Array.from({ length: 30 }, (_, i) => login(app, user.loginId, `Wrong-Passw0rd-${i}`)),
      login(app, user.loginId, PASSWORD),
    ]);
    expect((await lockState(user.id)).lockedUntil?.getTime()).toBeGreaterThan(Date.now());
    expect((await login(app, user.loginId, PASSWORD)).status).toBe(423);
  });

  it('a correct password never clears an active lock', async () => {
    const user = await makeUser();
    const until = new Date(Date.now() + 10 * 60_000);
    await prisma.user.update({ where: { id: user.id }, data: { lockedUntil: until } });
    expect((await login(app, user.loginId, PASSWORD)).status).toBe(423);
    expect((await lockState(user.id)).lockedUntil?.getTime()).toBe(until.getTime());
  });
});

describe('2. change-password brute force', () => {
  const change = (a: typeof app, bearer: { Authorization: string }, currentPassword: string) =>
    request(a)
      .post(`${API}/auth/change-password`)
      .set(bearer)
      .send({ currentPassword, newPassword: 'Brand-New-Passw0rd' });

  it('refuses with 423 while the account is locked, even with the right password', async () => {
    const user = await makeUser();
    const s = await signIn(app, user);
    await prisma.user.update({
      where: { id: user.id },
      data: { lockedUntil: new Date(Date.now() + 5 * 60_000) },
    });
    const res = await change(app, s.bearer, PASSWORD);
    expect(res.status).toBe(423);
    expect(errorOf(res).code).toBe('ACCOUNT_LOCKED');
  });

  it('wrong current passwords use the same counter and lock at 10', async () => {
    const user = await makeUser();
    const s = await signIn(app, user);
    for (let i = 0; i < 9; i++) {
      expect((await change(app, s.bearer, `Wrong-Passw0rd-${i}`)).status).toBe(422);
    }
    expect((await change(app, s.bearer, 'Wrong-Passw0rd-9')).status).toBe(423);
    expect((await lockState(user.id)).lockedUntil?.getTime()).toBeGreaterThan(Date.now());
    expect((await login(app, user.loginId, PASSWORD)).status).toBe(423);
  });

  it('is rate limited to 5 per minute per user', async () => {
    const limited = newApp({ rateLimit: true });
    const s = await signIn(limited, await makeUser());
    for (let i = 0; i < 5; i++) {
      expect((await change(limited, s.bearer, `Wrong-Passw0rd-${i}`)).status).toBe(422);
    }
    const blocked = await change(limited, s.bearer, 'Wrong-Passw0rd-5');
    expect(blocked.status).toBe(429);
    expect(blocked.headers['retry-after']).toBeDefined();
  });
});

describe('3. trust proxy', () => {
  const whoami = (trustProxy?: string | boolean) =>
    newApp({
      ...(trustProxy === undefined ? {} : { trustProxy }),
      extraRoutes: (a) => a.get('/whoami', (req, res) => void res.json({ ip: req.ip })),
    });

  it('uses X-Forwarded-For from a loopback proxy (default TRUST_PROXY=loopback)', async () => {
    const res = await request(whoami()).get('/whoami').set('X-Forwarded-For', '203.0.113.7');
    expect((res.body as { ip: string }).ip).toBe('203.0.113.7');
  });

  it('ignores X-Forwarded-For from a peer that is not a trusted proxy', async () => {
    const res = await request(whoami('10.0.0.0/8'))
      .get('/whoami')
      .set('X-Forwarded-For', '203.0.113.7');
    expect((res.body as { ip: string }).ip).not.toBe('203.0.113.7');
    expect((res.body as { ip: string }).ip).toMatch(/127\.0\.0\.1|::1/);
  });

  it('keys the per-IP login limit on the forwarded client IP, grouping IPv6 by /64', async () => {
    const limited = newApp({ rateLimit: true });
    const attempt = (ip: string) =>
      request(limited)
        .post(`${API}/auth/login`)
        .set('X-Forwarded-For', ip)
        .send({ identifier: uniqueLoginId('ip'), password: 'Wrong-Passw0rd!' });
    for (let i = 0; i < 20; i++) expect((await attempt('2001:db8:1:2::1')).status).toBe(401);
    expect((await attempt('2001:db8:1:2::ffff')).status).toBe(429);
    expect((await attempt('198.51.100.9')).status).toBe(401);
  });
});

describe('4. the refresh race grace is granted once per rotated token', () => {
  it('a second replay inside the window is reuse: 401, family revoked, audited', async () => {
    const s = await signIn(app, await makeUser());
    const refresh = (cookie: string) =>
      request(app).post(`${API}/auth/refresh`).set(XRW).set('Cookie', cookie);
    const first = await refresh(s.cookie);
    expect(first.status).toBe(200);
    const newest = cookiePair(refreshCookieOf(first));

    expect((await refresh(s.cookie)).status).toBe(409);
    const second = await refresh(s.cookie);
    expect(second.status).toBe(401);

    const session = await prisma.session.findFirstOrThrow({ where: { userId: s.user.id } });
    const family = await prisma.session.findMany({ where: { familyId: session.familyId } });
    expect(family.every((x) => x.revokedAt !== null)).toBe(true);
    expect((await refresh(newest)).status).toBe(401);
    expect(await auditRows('TOKEN_REUSE_DETECTED', { targetId: session.familyId })).toHaveLength(1);
    expect(await auditRows('REFRESH_RACE', { targetId: session.familyId })).toHaveLength(1);
  });
});

describe('6. Argon2 DoS protection', () => {
  it('limits login to 20 per minute per IP regardless of identifier', async () => {
    const limited = newApp({ rateLimit: true });
    for (let i = 0; i < 20; i++) {
      const res = await request(limited)
        .post(`${API}/auth/login`)
        .send({ identifier: uniqueLoginId('flood'), password: 'Wrong-Passw0rd!' });
      expect(res.status).toBe(401);
    }
    const blocked = await request(limited)
      .post(`${API}/auth/login`)
      .send({ identifier: uniqueLoginId('flood'), password: 'Wrong-Passw0rd!' });
    expect(blocked.status).toBe(429);
  });

  it('returns 503 SERVER_BUSY with Retry-After: 1 when the Argon2 cap is reached', async () => {
    const busy = newApp({ argon2Concurrency: 1 });
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        request(busy)
          .post(`${API}/auth/login`)
          .send({ identifier: uniqueLoginId('busy'), password: 'Wrong-Passw0rd!' }),
      ),
    );
    const busyReplies = results.filter((r) => r.status === 503);
    expect(busyReplies.length).toBeGreaterThan(0);
    expect(results.some((r) => r.status === 401)).toBe(true);
    for (const r of busyReplies) {
      expect(errorOf(r).code).toBe('SERVER_BUSY');
      expect(r.headers['retry-after']).toBe('1');
    }
    configureArgon2Concurrency(Number(TEST_ENV.ARGON2_MAX_CONCURRENCY));
  });

  it('the gate releases its slot when the work fails', async () => {
    configureArgon2Concurrency(1);
    await expect(withArgon2Slot(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await expect(withArgon2Slot(() => Promise.resolve(42))).resolves.toBe(42);
    let inner: unknown;
    await withArgon2Slot(async () => {
      inner = await withArgon2Slot(() => Promise.resolve(1)).catch((e: unknown) => e);
    });
    expect(inner).toBeInstanceOf(AppError);
    expect((inner as AppError).code).toBe('SERVER_BUSY');
    configureArgon2Concurrency(Number(TEST_ENV.ARGON2_MAX_CONCURRENCY));
  });
});

describe('7. unknown identifiers lock out like real accounts', () => {
  it('returns 423 after 10 failures for an identifier that matches no user', async () => {
    const ghost = uniqueLoginId('ghost');
    for (let i = 0; i < 9; i++)
      expect((await login(app, ghost, 'Wrong-Passw0rd!')).status).toBe(401);
    const tenth = await login(app, ghost.toUpperCase(), 'Wrong-Passw0rd!');
    expect(tenth.status).toBe(423);
    expect(errorOf(tenth).message).toBe('Too many failed attempts. Try again in 15 minutes.');
    expect((await login(app, ghost, 'Wrong-Passw0rd!')).status).toBe(423);
  });

  it('expires entries after the TTL and stays bounded in size', () => {
    const tracker = new FailureTracker(3, 1000, 1000, 5);
    const t0 = 1_000_000;
    tracker.registerFailure('a', t0);
    tracker.registerFailure('a', t0);
    expect(tracker.registerFailure('a', t0).locked).toBe(true);
    expect(tracker.registerFailure('a', t0 + 500).locked).toBe(true);
    expect(tracker.registerFailure('a', t0 + 1001).locked).toBe(false);
    for (let i = 0; i < 50; i++) tracker.registerFailure(`k${i}`, t0);
    expect(tracker.size).toBeLessThanOrEqual(5);
  });
});

describe('8. PATCH guards', () => {
  it('the conditional update also requires the role the permission check used', async () => {
    const member = await makeUser({ role: 'MEMBER', name: 'Original Name' });
    const applied = await userRepository.updateIfVersion(member.id, member.version, 'LEAD', {
      name: 'Should Not Apply',
    });
    expect(applied).toBe(false);
    const fresh = await prisma.user.findUniqueOrThrow({ where: { id: member.id } });
    expect(fresh.name).toBe('Original Name');
    expect(fresh.version).toBe(member.version);
  });
});

describe('9. loginId/email namespace is enforced in the database', () => {
  it('rejects a loginId equal to another email and an email equal to another loginId', async () => {
    const existing = await makeUser();
    await expect(makeUser({ loginId: existing.email ?? '' })).rejects.toThrow();
    const other = await makeUser();
    await expect(
      prisma.user.update({ where: { id: other.id }, data: { email: existing.loginId } }),
    ).rejects.toThrow();
  });

  it('maps the trigger violation to 409 DUPLICATE with the right field', async () => {
    const existing = await makeUser();
    let caught: unknown;
    try {
      await makeUser({ loginId: existing.email ?? '' });
    } catch (err) {
      caught = err;
    }
    const mapped = await toDuplicateError(caught, { loginId: existing.email ?? '' });
    expect(mapped).toBeInstanceOf(AppError);
    expect((mapped as AppError).status).toBe(409);
    expect((mapped as AppError).code).toBe('DUPLICATE');
    expect((mapped as AppError).fields?.loginId).toBeDefined();
  });
});

describe('15. LOGIN_FAILED never stores a malformed identifier', () => {
  it('stores <invalid-format> for values that are neither a login ID nor an email', async () => {
    const typedPassword = 'My Secret P4ss!';
    expect((await login(app, typedPassword, 'whatever')).status).toBe(401);
    const rows = await auditRows('LOGIN_FAILED');
    expect(JSON.stringify(rows)).not.toContain('My Secret P4ss!');
    expect(JSON.stringify(rows).toLowerCase()).not.toContain('my secret p4ss!');
    expect(rows.some((r) => JSON.stringify(r.detail).includes('<invalid-format>'))).toBe(true);

    const valid = uniqueLoginId('valid');
    await login(app, valid, 'whatever');
    const again = await auditRows('LOGIN_FAILED');
    expect(again.some((r) => JSON.stringify(r.detail).includes(valid))).toBe(true);
  });
});
