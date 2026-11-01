// The environment every test process runs with. Points only at rhai_erp_test, silences logs and
// disables rate limits (the dedicated rate-limit test re-enables them per app instance).
import { TEST_DATABASE_URL } from '../scripts/reset-test-db';

export const TEST_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  DATABASE_URL: TEST_DATABASE_URL,
  JWT_ACCESS_SECRET: 'test-only-secret-0123456789abcdefghijklmnopqrstuvwxyz',
  ACCESS_TOKEN_TTL: '15m',
  REFRESH_TOKEN_TTL_DAYS: '7',
  SESSION_IDLE_MINUTES: '30',
  REFRESH_REUSE_GRACE_SECONDS: '10',
  WEB_ORIGIN: 'http://localhost:5173',
  LOG_LEVEL: 'silent',
  RATE_LIMIT_DISABLED: 'true',
  TRUST_PROXY: 'loopback',
  // High so the parallel lockout test is not cut short by 503s; the gate test lowers it per app.
  ARGON2_MAX_CONCURRENCY: '64',
};

/** The Super Admin the global setup creates (only one can exist). */
export const TEST_OWNER = {
  loginId: 'owner',
  email: 'owner@test.local',
  name: 'Test Owner',
  password: 'Owner-Passw0rd!',
};
