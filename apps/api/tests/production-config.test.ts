// Builds the app with a real NODE_ENV=production configuration (fresh module graph) to prove the
// refresh cookie carries `Secure` there, and that production env rules are enforced.
import request from 'supertest';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { hashPassword } from '../src/core/auth/password';
import { TEST_ENV } from './test-env';

const PROD_SECRET = 'prod-test-secret-0123456789abcdefghijklmnopqrstuvwxyz-ABCDEFGHIJ';
const saved = { ...process.env };

afterAll(() => {
  process.env = saved;
  vi.resetModules();
});

describe('NODE_ENV=production', () => {
  it('sets Secure on the rt cookie', async () => {
    Object.assign(process.env, TEST_ENV, {
      NODE_ENV: 'production',
      RATE_LIMIT_DISABLED: 'false',
      JWT_ACCESS_SECRET: PROD_SECRET,
    });
    vi.resetModules();
    const { createApp } = await import('../src/app.js');
    const { prisma } = await import('../src/core/db/prisma.js');
    const { env } = await import('../src/config/env.js');
    expect(env.isProduction).toBe(true);

    const loginId = `prod-${Date.now().toString(36)}`;
    const empRole = await prisma.role.findUniqueOrThrow({ where: { code: 'EMPLOYEE' } });
    await prisma.user.create({
      data: {
        loginId,
        name: 'Prod Probe',
        roleId: empRole.id,
        department: 'Sales',
        mustChangePassword: false,
        passwordHash: await hashPassword('Prod-Passw0rd!'),
      },
    });
    const res = await request(createApp())
      .post('/api/v1/auth/login')
      .send({ identifier: loginId, password: 'Prod-Passw0rd!' });
    expect(res.status).toBe(200);
    const raw = res.headers['set-cookie'] as unknown;
    const cookies = Array.isArray(raw) ? (raw as string[]) : [];
    const rt = cookies.find((c) => c.startsWith('rt='));
    expect(rt).toContain('Secure');
    expect(rt).toContain('HttpOnly');
    expect(rt).toContain('SameSite=Strict');
    await prisma.$disconnect();
  });

  it('requires a 48+ character secret without the placeholder', async () => {
    const { loadEnv } = await import('../src/config/env.js');
    const prod = { ...TEST_ENV, NODE_ENV: 'production', RATE_LIMIT_DISABLED: 'false' };
    expect(() => loadEnv({ ...prod, JWT_ACCESS_SECRET: 'x'.repeat(40) })).toThrow(/48/);
    expect(loadEnv({ ...prod, JWT_ACCESS_SECRET: PROD_SECRET }).isProduction).toBe(true);
  });
});
