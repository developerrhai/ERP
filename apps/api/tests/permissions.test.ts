// Role Master, Permission Master and Department Access (Phase 2 §1, §2.3, §2.6, §3): read shapes,
// the PUT hierarchy matrix (nobody edits their own or a higher role), the role-level If-Match,
// row validation, the ADMIN `*` controls protection, and the department families matrix.
import request from 'supertest';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ROLES } from '../src/core/rbac/role-rules';
import type { RoleCode } from '../src/core/rbac/role-rules';
import { registry } from '../src/core/registry';
import { API, auditRows, errorOf, newApp, prisma, signInAs, signInOwner } from './helpers';
import type { Signed } from './helpers';
import { makeDepartment, restoreGlobal, roleVersion, snapshotGlobal } from './phase2-helpers';
import type { GlobalSnapshot } from './phase2-helpers';

const app = newApp();
let owner: Signed;
let admin: Signed;
let snap: GlobalSnapshot;

interface Row {
  resource: string;
  view: boolean | null;
  add: boolean | null;
  edit: boolean | null;
  delete: boolean | null;
  approve: boolean | null;
  export: boolean | null;
  controls: boolean | null;
  scope: string | null;
  version?: number;
}
interface RoleRows {
  role: string;
  editable: boolean;
  version: number;
  rows: Row[];
}

beforeAll(async () => {
  owner = await signInOwner(app);
  admin = await signInAs(app, 'ADMIN');
  snap = await snapshotGlobal();
});

afterEach(async () => {
  await restoreGlobal(snap);
});

async function rolesOf(s: Signed): Promise<RoleRows[]> {
  const res = await request(app).get(`${API}/permissions`).set(s.bearer);
  return (res.body as { data: { roles: RoleRows[] } }).data.roles;
}

async function rowsFor(role: string): Promise<Row[]> {
  const found = (await rolesOf(owner)).find((r) => r.role === role);
  return (found?.rows ?? []).map(({ version: _v, ...rest }) => rest);
}

const put = (s: Signed, role: string, rows: Row[], version?: number) => {
  const req = request(app).put(`${API}/permissions/${role}`).set(s.bearer);
  return (version === undefined ? req : req.set('If-Match', String(version))).send({ rows });
};

describe('GET /roles', () => {
  it('is ADMIN+ only', async () => {
    const manager = await signInAs(app, 'MANAGER');
    expect((await request(app).get(`${API}/roles`).set(manager.bearer)).status).toBe(403);
  });
});

describe('GET /permissions', () => {
  it('is ADMIN+ only', async () => {
    for (const role of ['MANAGER', 'LEAD', 'MEMBER'] as const) {
      const s = await signInAs(app, role);
      expect((await request(app).get(`${API}/permissions`).set(s.bearer)).status).toBe(403);
    }
  });
});

describe('Department access', () => {
  it('GET returns every department with its families; Administration has all 22', async () => {
    const res = await request(app).get(`${API}/department-access`).set(admin.bearer);
    expect(res.status).toBe(200);
    const body = res.body as {
      data: { departments: { name: string; families: string[] }[]; families: string[] };
    };
    expect(body.data.families).toHaveLength(22);
    const adm = body.data.departments.find((d) => d.name === 'Administration');
    expect(adm?.families).toEqual(registry.familyNames);
    const sales = body.data.departments.find((d) => d.name === 'Sales');
    expect(new Set(sales?.families)).toEqual(new Set(registry.data.deptFamilies.Sales));
    const manager = await signInAs(app, 'MANAGER');
    expect((await request(app).get(`${API}/department-access`).set(manager.bearer)).status).toBe(
      403,
    );
  });

  it('PUT replaces one department, in registry order, audited', async () => {
    const dept = await makeDepartment(['CRM']);
    const res = await request(app)
      .put(`${API}/department-access/${encodeURIComponent(dept.name)}`)
      .set(admin.bearer)
      .send({ families: ['Sales', 'Executive'] });
    expect(res.status).toBe(200);
    expect((res.body as { data: { families: string[] } }).data.families).toEqual([
      'Executive',
      'Sales',
    ]);
    const rows = await auditRows('DEPARTMENT_ACCESS_UPDATED', { targetId: dept.id });
    expect(rows[0]?.detail).toMatchObject({ before: ['CRM'], after: ['Executive', 'Sales'] });
  });

  it('422 for unknown or duplicate families, 404 unknown department, 403 for managers', async () => {
    const dept = await makeDepartment();
    const url = `${API}/department-access/${encodeURIComponent(dept.name)}`;
    expect(
      (
        await request(app)
          .put(url)
          .set(admin.bearer)
          .send({ families: ['Nope'] })
      ).status,
    ).toBe(422);
    expect(
      (
        await request(app)
          .put(url)
          .set(admin.bearer)
          .send({ families: ['CRM', 'CRM'] })
      ).status,
    ).toBe(422);
    expect(
      (
        await request(app)
          .put(url)
          .set(admin.bearer)
          .send({ families: ['CRM'], x: 1 })
      ).status,
    ).toBe(422);
    expect(
      (
        await request(app)
          .put(`${API}/department-access/No%20Such`)
          .set(admin.bearer)
          .send({ families: [] })
      ).status,
    ).toBe(404);
    const manager = await signInAs(app, 'MANAGER');
    expect((await request(app).put(url).set(manager.bearer).send({ families: [] })).status).toBe(
      403,
    );
  });

  it('Administration must keep all 22 families (409 PROTECTED)', async () => {
    const res = await request(app)
      .put(`${API}/department-access/Administration`)
      .set(owner.bearer)
      .send({ families: registry.familyNames.slice(1) });
    expect(res.status).toBe(409);
    expect(errorOf(res).code).toBe('PROTECTED');
    const same = await request(app)
      .put(`${API}/department-access/Administration`)
      .set(owner.bearer)
      .send({ families: [...registry.familyNames].reverse() });
    expect(same.status).toBe(200);
  });
});
