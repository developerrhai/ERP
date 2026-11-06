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
  it('lists the 5 fixed roles with user counts, canManage and who can create them', async () => {
    const res = await request(app).get(`${API}/roles`).set(admin.bearer);
    expect(res.status).toBe(200);
    const roles = (
      res.body as {
        data: {
          code: string;
          level: number;
          userCount: number;
          canManage: boolean;
          creatableBy: string[];
        }[];
      }
    ).data;
    expect(roles.map((r) => r.code)).toEqual([...ROLES]);
    expect(roles.map((r) => r.canManage)).toEqual([false, false, true, true, true]);
    expect(roles.find((r) => r.code === 'ADMIN')?.creatableBy).toEqual(['SUPER_ADMIN']);
    expect(roles.find((r) => r.code === 'SUPER_ADMIN')?.creatableBy).toEqual([]);
    expect(roles.find((r) => r.code === 'SUPER_ADMIN')?.userCount).toBe(1);
    expect(roles.find((r) => r.code === 'MEMBER' || r.code === 'EMPLOYEE')?.userCount).toBe(
      await prisma.user.count({ where: { role: { code: 'EMPLOYEE' } } }),
    );
  });

  it('is ADMIN+ only', async () => {
    const manager = await signInAs(app, 'MANAGER');
    expect((await request(app).get(`${API}/roles`).set(manager.bearer)).status).toBe(403);
  });
});

describe('GET /permissions', () => {
  it('returns the 4 editable-capable roles with seeded rows, editable flags and the 22 families', async () => {
    const res = await request(app).get(`${API}/permissions`).set(admin.bearer);
    expect(res.status).toBe(200);
    const body = res.body as { data: { roles: RoleRows[]; families: string[] } };
    expect(body.data.families).toEqual(registry.familyNames);
    expect(body.data.families).toHaveLength(22);
    expect(body.data.roles.map((r) => r.role)).toEqual(['ADMIN', 'MANAGER', 'LEAD', 'MEMBER']);
    expect(body.data.roles.map((r) => r.editable)).toEqual([false, true, true, true]);
    const member = body.data.roles.find((r) => r.role === 'MEMBER');
    expect(member?.rows[0]).toMatchObject({
      resource: '*',
      view: true,
      add: true,
      edit: true,
      delete: false,
      scope: 'OWN',
    });
    expect(member?.rows.map((r) => r.resource)).toContain('family:Administration');
    const ownerView = await rolesOf(owner);
    expect(ownerView.find((r) => r.role === 'ADMIN')?.editable).toBe(true);
  });

  it('is ADMIN+ only', async () => {
    for (const role of ['MANAGER', 'LEAD', 'MEMBER'] as const) {
      const s = await signInAs(app, role);
      expect((await request(app).get(`${API}/permissions`).set(s.bearer)).status).toBe(403);
    }
  });
});

describe('PUT /permissions/:role — hierarchy matrix (§2.6)', () => {
  const actors: RoleCode[] = ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'LEAD', 'MEMBER'];
  const allowed: Record<RoleCode, RoleCode[]> = {
    SUPER_ADMIN: ['ADMIN', 'MANAGER', 'LEAD', 'MEMBER'],
    ADMIN: ['MANAGER', 'LEAD', 'MEMBER'],
    MANAGER: [],
    LEAD: [],
    MEMBER: [],
  };
  const cases = actors.flatMap((actor) => ROLES.map((target) => [actor, target] as const));

  it.each(cases)('%s editing %s', async (actor, target) => {
    const s =
      actor === 'SUPER_ADMIN' ? owner : actor === 'ADMIN' ? admin : await signInAs(app, actor);
    const rows = target === 'SUPER_ADMIN' ? await rowsFor('MEMBER') : await rowsFor(target);
    const version = target === 'SUPER_ADMIN' ? 1 : await roleVersion(app, owner, target);
    const res = await put(s, target, rows, version);
    expect(res.status).toBe((allowed[actor] ?? []).includes(target) ? 200 : 403);
  });
});

describe('PUT /permissions/:role — behaviour', () => {
  it('replaces the rows, bumps the role version, and audits before/after', async () => {
    const before = await rowsFor('LEAD');
    const version = await roleVersion(app, owner, 'LEAD');
    const rows = [
      ...before,
      {
        resource: 'family:Sales',
        view: true,
        add: true,
        edit: true,
        delete: true,
        approve: false,
        export: true,
        controls: false,
        scope: 'ALL',
      },
      {
        resource: 'page:crm-leads',
        view: false,
        add: false,
        edit: false,
        delete: false,
        approve: false,
        export: false,
        controls: false,
        scope: 'OWN',
      },
    ];
    const res = await put(admin, 'LEAD', rows, version);
    expect(res.status).toBe(200);
    const body = (res.body as { data: RoleRows }).data;
    expect(body.version).toBe(version + 1);
    expect(res.headers.etag).toBe(`"${version + 1}"`);
    expect(body.rows.map((r) => r.resource)).toEqual([
      '*',
      'family:Sales',
      'family:Administration',
      'page:crm-leads',
    ]);
    expect(body.rows.every((r) => r.version === version + 1)).toBe(true);
    const audit = await auditRows('PERMISSIONS_UPDATED', { targetId: 'LEAD' });
    const last = audit.at(-1)?.detail as unknown as { before: Row[]; after: Row[] };
    expect(last.before).toHaveLength(before.length);
    expect(last.after).toHaveLength(rows.length);
  });

  it('400 without If-Match, 409 on a stale version', async () => {
    const rows = await rowsFor('MEMBER');
    expect((await put(admin, 'MEMBER', rows)).status).toBe(400);
    const version = await roleVersion(app, owner, 'MEMBER');
    const stale = await put(admin, 'MEMBER', rows, version + 7);
    expect(stale.status).toBe(409);
    expect(errorOf(stale).code).toBe('VERSION_CONFLICT');
  });

  it('validates rows: a "*" row, real families/pages, no duplicates, strict keys', async () => {
    const version = await roleVersion(app, owner, 'MEMBER');
    const base = await rowsFor('MEMBER');
    const star = base.find((r) => r.resource === '*');
    if (!star) throw new Error('seed missing *');
    const bad: Row[][] = [
      base.filter((r) => r.resource !== '*'),
      [...base, { ...star, resource: 'family:Nope' }],
      [...base, { ...star, resource: 'page:nope' }],
      [...base, { ...star, resource: 'role:x' }],
      [...base, { ...star }],
      [...base, { ...star, resource: 'family:Sales', scope: 'GLOBAL' }],
    ];
    for (const rows of bad) {
      const res = await put(admin, 'MEMBER', rows, version);
      expect(res.status, JSON.stringify(rows.at(-1))).toBe(422);
    }
    const extraKey = await request(app)
      .put(`${API}/permissions/MEMBER`)
      .set(admin.bearer)
      .set('If-Match', String(version))
      .send({ rows: base, note: 'x' });
    expect(extraKey.status).toBe(422);
    const unknownRole = await put(admin, 'GOD', base, version);
    expect(unknownRole.status).toBe(422);
  });

  it('null cells mean inherit: stored and returned as null; all-null overrides are dropped; "*" cannot be null', async () => {
    const base = await rowsFor('MANAGER');
    const inherit = {
      view: null,
      add: null,
      edit: null,
      delete: null,
      approve: null,
      export: null,
      controls: null,
      scope: null,
    };
    const rows: Row[] = [
      ...base,
      { resource: 'family:CRM', ...inherit, delete: false, scope: 'OWN' },
      { resource: 'family:Sales', ...inherit },
    ];
    const res = await put(admin, 'MANAGER', rows, await roleVersion(app, owner, 'MANAGER'));
    expect(res.status).toBe(200);
    const saved = (res.body as { data: RoleRows }).data.rows;
    expect(saved.map((r) => r.resource)).not.toContain('family:Sales');
    expect(saved.find((r) => r.resource === 'family:CRM')).toMatchObject({
      view: null,
      delete: false,
      approve: null,
      scope: 'OWN',
    });
    const fromGet = (await rolesOf(admin)).find((r) => r.role === 'MANAGER');
    expect(fromGet?.rows.find((r) => r.resource === 'family:CRM')?.view).toBeNull();

    const starNull = base.map((r) => (r.resource === '*' ? { ...r, view: null } : r));
    const bad = await put(admin, 'MANAGER', starNull, await roleVersion(app, owner, 'MANAGER'));
    expect(bad.status).toBe(422);
    expect(Object.keys(errorOf(bad).fields ?? {}).some((k) => k.endsWith('.view'))).toBe(true);
  });

  it("an Admin's controls on * cannot be turned off (409 PROTECTED)", async () => {
    const rows = (await rowsFor('ADMIN')).map((r) =>
      r.resource === '*' ? { ...r, controls: false } : r,
    );
    const res = await put(owner, 'ADMIN', rows, await roleVersion(app, owner, 'ADMIN'));
    expect(res.status).toBe(409);
    expect(errorOf(res).code).toBe('PROTECTED');
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
