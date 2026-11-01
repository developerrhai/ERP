// Why: one place for the end-to-end ports, database and seeded credentials, shared by the Playwright config,
// the API launcher and the specs. Non-default ports (4100/5180) keep e2e independent of a developer's
// running dev servers on 4000/5173.
export const E2E = {
  apiPort: 4100,
  webPort: 5180,
  owner: { loginId: 'owner', email: 'owner@rhai.local', initialPassword: 'Owner#Init2026x', newPassword: 'Owner#New2026xy' },
  apiEnv: {
    NODE_ENV: 'test',
    PORT: '4100',
    DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/rhai_erp_e2e',
    JWT_ACCESS_SECRET: 'e2e-only-secret-0123456789abcdef0123456789abcdef',
    ACCESS_TOKEN_TTL: '15m',
    REFRESH_TOKEN_TTL_DAYS: '7',
    SESSION_IDLE_MINUTES: '30',
    WEB_ORIGIN: 'http://localhost:5180',
    LOG_LEVEL: 'warn',
    RATE_LIMIT_DISABLED: 'true',
    SUPERADMIN_LOGIN_ID: 'owner',
    SUPERADMIN_EMAIL: 'owner@rhai.local',
    SUPERADMIN_NAME: 'Owner',
    SUPERADMIN_PASSWORD: 'Owner#Init2026x',
  },
};
