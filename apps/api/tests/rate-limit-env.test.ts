// Rate limits (CONTRACT §6 Rate limit) on an app built with limits ON, plus the env rule that
// RATE_LIMIT_DISABLED is only honoured in the test environment, and env fail-fast validation.
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { loadEnv, parseDurationSeconds } from '../src/config/env';
import { API, errorOf, newApp } from './helpers';
import { TEST_ENV } from './test-env';

describe('login rate limit', () => {
  it('allows 5 attempts per minute per IP+identifier, then 429 with Retry-After', async () => {
    const app = newApp({ rateLimit: true });
    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post(`${API}/auth/login`)
        .send({ identifier: 'limited-user', password: 'Wrong-Passw0rd!' });
      expect(res.status).toBe(401);
    }
    const blocked = await request(app)
      .post(`${API}/auth/login`)
      .send({ identifier: 'LIMITED-USER', password: 'Wrong-Passw0rd!' });
    expect(blocked.status).toBe(429);
    expect(errorOf(blocked).code).toBe('RATE_LIMITED');
    const retryAfter = Number(blocked.headers['retry-after']);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(60);

    // A different identifier from the same IP has its own budget.
    const other = await request(app)
      .post(`${API}/auth/login`)
      .send({ identifier: 'another-user', password: 'Wrong-Passw0rd!' });
    expect(other.status).toBe(401);
  });

  it('limits everything else to 300 requests per minute per IP', async () => {
    const app = newApp({ rateLimit: true });
    for (let i = 0; i < 300; i++) {
      const res = await request(app).get(`${API}/does-not-exist`);
      expect(res.status).toBe(404);
    }
    const blocked = await request(app).get(`${API}/does-not-exist`);
    expect(blocked.status).toBe(429);
    expect(blocked.headers['retry-after']).toBeDefined();
  });

  it('is off in tests only because RATE_LIMIT_DISABLED=true is set explicitly', async () => {
    const app = newApp();
    for (let i = 0; i < 7; i++) {
      const res = await request(app)
        .post(`${API}/auth/login`)
        .send({ identifier: 'unlimited-user', password: 'Wrong-Passw0rd!' });
      expect(res.status).toBe(401);
    }
  });
});

describe('env validation', () => {
  it('refuses RATE_LIMIT_DISABLED=true outside NODE_ENV=test', () => {
    // MFA_ENCRYPTION_KEY is required in production; supply it so only RATE_LIMIT_DISABLED errors.
    const MFA = { MFA_ENCRYPTION_KEY: 'a'.repeat(44) };
    expect(() => loadEnv({ ...TEST_ENV, ...MFA, NODE_ENV: 'development' })).toThrow(/RATE_LIMIT_DISABLED/);
    expect(() => loadEnv({ ...TEST_ENV, ...MFA, NODE_ENV: 'production' })).toThrow(/RATE_LIMIT_DISABLED/);
    expect(
      loadEnv({ ...TEST_ENV, ...MFA, NODE_ENV: 'production', RATE_LIMIT_DISABLED: 'false' }).isProduction,
    ).toBe(true);
  });

  it('fails fast on a short secret, a missing DATABASE_URL or a bad TTL', () => {
    expect(() => loadEnv({ ...TEST_ENV, JWT_ACCESS_SECRET: 'short' })).toThrow(/JWT_ACCESS_SECRET/);
    const { DATABASE_URL: _omit, ...withoutDb } = TEST_ENV;
    expect(() => loadEnv(withoutDb)).toThrow(/DATABASE_URL/);
    expect(() => loadEnv({ ...TEST_ENV, ACCESS_TOKEN_TTL: '15 minutes' })).toThrow(
      /ACCESS_TOKEN_TTL/,
    );
  });

  it('validates REFRESH_REUSE_GRACE_SECONDS (default 10, 0-60)', () => {
    const { REFRESH_REUSE_GRACE_SECONDS: _g, ...withoutGrace } = TEST_ENV;
    expect(loadEnv(withoutGrace).REFRESH_REUSE_GRACE_SECONDS).toBe(10);
    expect(
      loadEnv({ ...TEST_ENV, REFRESH_REUSE_GRACE_SECONDS: '0' }).REFRESH_REUSE_GRACE_SECONDS,
    ).toBe(0);
    expect(() => loadEnv({ ...TEST_ENV, REFRESH_REUSE_GRACE_SECONDS: '-1' })).toThrow(
      /REFRESH_REUSE_GRACE_SECONDS/,
    );
    expect(() => loadEnv({ ...TEST_ENV, REFRESH_REUSE_GRACE_SECONDS: 'abc' })).toThrow(
      /REFRESH_REUSE_GRACE_SECONDS/,
    );
  });



  it('parses TRUST_PROXY into an Express trust proxy value', () => {
    expect(loadEnv(TEST_ENV).trustProxy).toBe('loopback');
    expect(loadEnv({ ...TEST_ENV, TRUST_PROXY: 'false' }).trustProxy).toBe(false);
    expect(loadEnv({ ...TEST_ENV, TRUST_PROXY: '1' }).trustProxy).toBe(1);
    expect(loadEnv({ ...TEST_ENV, TRUST_PROXY: '10.0.0.0/8, 127.0.0.1' }).trustProxy).toBe(
      '10.0.0.0/8, 127.0.0.1',
    );
  });

  it('parses durations', () => {
    expect(parseDurationSeconds('15m')).toBe(900);
    expect(parseDurationSeconds('30s')).toBe(30);
    expect(parseDurationSeconds('1h')).toBe(3600);
  });
});
