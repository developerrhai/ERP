/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/require-await */
// Phase 22: GET /meta/registry, GET /admin/page-health and the registry snapshot history.
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API, XRW, newApp, prisma, signInOwner, signIn, makeUser } from './helpers';
import {
  loadRegistryV2,
  registryHash,
  syncRegistrySnapshot,
} from '../src/modules/page-health/registry-v2';

describe('registry v2 + page health', () => {
  const app = newApp();
  const runId = randomUUID();
  let token = '';

  beforeAll(async () => {
    token = (await signInOwner(app)).token;
    await prisma.$executeRaw`DELETE FROM page_health`;
    await prisma.$executeRaw`
      INSERT INTO page_health (page_id, role_code, unit_combo, run_id, status, error_kind, error_text, p95_ms)
      VALUES ('wms-racks', 'SUPER_USER', 'default', ${runId}::uuid, 'OK', NULL, NULL, 640),
             ('pay-loan', 'SUPER_USER', 'default', ${runId}::uuid, 'ERROR', 'CONSOLE', 'boom', 3100),
             ('pay-loan', 'EMPLOYEE', 'default', ${runId}::uuid, 'OK', NULL, NULL, 800)`;
  });
  afterAll(async () => {
    await prisma.$executeRaw`DELETE FROM page_health WHERE run_id = ${runId}::uuid`;
  });

  it('serves registry v2 to any signed-in user and refuses anonymous callers', async () => {
    expect((await request(app).get(`${API}/meta/registry`)).status).toBe(401);
    const user = await makeUser({});
    const { token: t } = await signIn(app, user);
    const res = await request(app)
      .get(`${API}/meta/registry`)
      .set('Authorization', `Bearer ${t}`)
      .set(XRW);
    expect(res.status).toBe(200);
    const pages = res.body.data.pages as { id: string; status: string }[];
    expect(pages.length).toBeGreaterThan(300);
    expect(pages.find((p) => p.id === 'wms-racks')?.status).toBe('built');
    expect(pages.find((p) => p.id === 'cl-contractors')?.status).toBe('planned');
    expect(pages.some((p) => p.id === 'admin-page-health')).toBe(true);
  });

  it('lists the latest crawler run, errors first, with filters', async () => {
    const res = await request(app)
      .get(`${API}/admin/page-health`)
      .set('Authorization', `Bearer ${token}`)
      .set(XRW);
    expect(res.status).toBe(200);
    expect(res.body.meta.runId).toBe(runId);
    expect(res.body.meta.errors).toBe(1);
    expect(res.body.data[0]).toMatchObject({
      pageId: 'pay-loan',
      status: 'ERROR',
      errorKind: 'CONSOLE',
      overBudget: true,
    });
    const only = await request(app)
      .get(`${API}/admin/page-health?status=ERROR`)
      .set('Authorization', `Bearer ${token}`)
      .set(XRW);
    expect(only.body.data).toHaveLength(1);
    const big = await request(app)
      .get(`${API}/admin/page-health?limit=1000`)
      .set('Authorization', `Bearer ${token}`)
      .set(XRW);
    expect(big.status).toBe(400);
  });

  it('refuses a user without view on admin-page-health', async () => {
    const user = await makeUser({});
    const { token: t } = await signIn(app, user);
    const res = await request(app)
      .get(`${API}/admin/page-health`)
      .set('Authorization', `Bearer ${t}`)
      .set(XRW);
    expect([403, 404]).toContain(res.status);
  });

  it('stores one snapshot per registry content and audits the version change', async () => {
    const v1 = await syncRegistrySnapshot();
    const v2 = await syncRegistrySnapshot();
    expect(v2).toBe(v1);
    const rows = await prisma.$queryRaw<{ sha256: string; pages_count: number }[]>`
      SELECT sha256, pages_count FROM registry_snapshots WHERE version = ${v1}`;
    expect(rows[0]?.sha256).toBe(registryHash(loadRegistryV2()));
    const audit = await prisma.auditLog.count({ where: { action: 'registry.version_changed' } });
    expect(audit).toBeGreaterThanOrEqual(1);
  });
});
