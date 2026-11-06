// Regression tests for the Phase 2 independent review (README-PHASE2.md "Review fixes") and the
// exact CORS allow-list: seed without SUPERADMIN env, the Administration hard rule, PUT protections,
// page-permission binding of admin endpoints, FK -> 422 mapping, no-op writes, audit actions/search,
// LIKE escaping and the paging offset cap.
import request from 'supertest';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { loadEnv, parseOrigins } from '../src/config/env';
import { AUDIT_ACTIONS } from '../src/core/audit/audit-service';
import { AppError } from '../src/core/http/errors';
import { escapeLike } from '../src/core/http/query-safety';
import { accessUserOf, decide, invalidateAccessCache } from '../src/core/rbac/access';
import type { AccessData, ControlFlags, PermissionRow } from '../src/core/rbac/access';
import { DEFAULT_ROLE_ROWS, noActions } from '../src/core/rbac/permission-model';
import type { ActionFlags, Scope } from '../src/core/rbac/permission-model';
import { registry } from '../src/core/registry';
import { runSeed, superAdminConfigFromEnv } from '../src/core/seed/run-seed';
import { mapOwnerFkError } from '../src/modules/module-controls/service';
import { toDuplicateError } from '../src/modules/users/service';
import {
  API,
  auditRows,
  errorOf,
  makeUser,
  newApp,
  prisma,
  signInAs,
  signInOwner,
} from './helpers';
import type { Signed } from './helpers';
import {
  controlVersion,
  makeDepartment,
  restoreGlobal,
  roleVersion,
  snapshotGlobal,
} from './phase2-helpers';
import type { GlobalSnapshot } from './phase2-helpers';
import { TEST_ENV } from './test-env';

const app = newApp();
let owner: Signed;
let admin: Signed;
let snap: GlobalSnapshot;

beforeAll(async () => {
  owner = await signInOwner(app);
  admin = await signInAs(app, 'ADMIN');
  snap = await snapshotGlobal();
});

afterEach(async () => {
  await restoreGlobal(snap);
});

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
}
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

async function rowsFor(role: string): Promise<Row[]> {
  const res = await request(app).get(`${API}/permissions`).set(owner.bearer);
  const roles = (
    res.body as { data: { roles: { role: string; rows: (Row & { version: number })[] }[] } }
  ).data.roles;
  return (roles.find((r) => r.role === role)?.rows ?? []).map(({ version: _v, ...rest }) => rest);
}

const put = async (s: Signed, role: string, rows: Row[]) =>
  request(app)
    .put(`${API}/permissions/${role}`)
    .set(s.bearer)
    .set('If-Match', String(await roleVersion(app, owner, role)))
    .send({ rows });

// ------------------------------------------------------------------------------------------------
describe('A. CORS is an exact allow-list', () => {
  const corsApp = newApp({ corsOrigins: ['https://erp.example.com', 'http://localhost:5173'] });
  const preflight = (origin: string) =>
    request(corsApp)
      .options(`${API}/auth/login`)
      .set('Origin', origin)
      .set('Access-Control-Request-Method', 'POST');

  it('echoes an allowed origin with credentials', async () => {
    const res = await preflight('https://erp.example.com');
    expect(res.headers['access-control-allow-origin']).toBe('https://erp.example.com');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it.each([
    'https://evil-localhost.com',
    'https://x.vercel.app',
    'http://localhost:3000',
    'https://erp.example.com.evil.io',
    'null',
  ])('rejects %s', async (origin) => {
    const res = await preflight(origin);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('requests without an Origin header still work (same-origin / server-to-server)', async () => {
    const res = await request(corsApp).get(`${API}/health`);
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('parses WEB_ORIGINS, the CORS_ORIGINS and WEB_ORIGIN aliases, and rejects non-origins', () => {
    const base = { ...TEST_ENV, WEB_ORIGIN: undefined };
    expect(
      loadEnv({
        ...base,
        WEB_ORIGINS: 'https://a.example.com, https://b.example.com',
        CORS_ORIGINS: 'https://c.example.com',
      }).corsOrigins,
    ).toEqual(['https://a.example.com', 'https://b.example.com', 'https://c.example.com']);
    expect(loadEnv({ ...base, CORS_ORIGINS: 'https://live.example.com' }).corsOrigins).toEqual([
      'https://live.example.com',
    ]);
    expect(loadEnv({ ...base, WEB_ORIGIN: 'https://single.example.com' }).corsOrigins).toEqual([
      'https://single.example.com',
    ]);
    expect(loadEnv(base).corsOrigins).toEqual(['http://localhost:5173']);
    for (const bad of [
      'https://a.example.com/app',
      '*',
      'https://*.vercel.app',
      'ftp://a.example.com',
      'a.example.com',
      'https://a.example.com/',
    ]) {
      expect(() => loadEnv({ ...base, WEB_ORIGINS: bad }), bad).toThrow(/WEB_ORIGINS/);
    }
    expect(parseOrigins('http://localhost:5173,http://localhost:5173').origins).toEqual([
      'http://localhost:5173',
    ]);
  });
});

// ------------------------------------------------------------------------------------------------
describe('2. seed is fail-closed and independent of SUPERADMIN_* env', () => {
  it('fills an empty Phase 2 DB with no SUPERADMIN env when a Super Admin exists', async () => {
    await prisma.$transaction([
      prisma.moduleControl.deleteMany(),
      prisma.rolePermission.deleteMany(),
      prisma.departmentFamily.deleteMany(),
      prisma.setting.deleteMany(),
    ]);
    invalidateAccessCache();
    const result = await runSeed(prisma, {});
    expect(result.superAdmin.status).toBe('existing');
    expect(await prisma.moduleControl.count()).toBe(248);
    expect(await prisma.rolePermission.count()).toBe(7);
    expect(
      await prisma.departmentFamily.count({ where: { departmentName: 'Administration' } }),
    ).toBe(22);
    expect(await prisma.setting.findUnique({ where: { key: 'letterhead' } })).not.toBeNull();
    const again = await runSeed(prisma, {});
    expect(Object.values(again.phase2).every((n) => n === 0)).toBe(true);
  });

  it('requires SUPERADMIN_* only to create a Super Admin, and never echoes the password', () => {
    expect(() => superAdminConfigFromEnv({})).toThrow(/SUPERADMIN_LOGIN_ID/);
    let message = '';
    try {
      superAdminConfigFromEnv({
        SUPERADMIN_LOGIN_ID: 'boss',
        SUPERADMIN_EMAIL: '',
        SUPERADMIN_NAME: 'Boss Person',
        SUPERADMIN_PASSWORD: 'weakpasswordsecretvalue',
      });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/SUPERADMIN_PASSWORD rejected/);
    expect(message).not.toContain('secretvalue');
    expect(
      superAdminConfigFromEnv({
        SUPERADMIN_LOGIN_ID: 'boss',
        SUPERADMIN_EMAIL: '',
        SUPERADMIN_NAME: 'Boss Person',
        SUPERADMIN_PASSWORD: 'Str0ng-Boss-Passw0rd!',
      }).SUPERADMIN_LOGIN_ID,
    ).toBe('boss');
  });
});

// ------------------------------------------------------------------------------------------------
describe('3/4. Administration is ADMIN+ only, enforced in code and on PUT', () => {
  it('decide(): a non-admin is denied on Administration pages even if the table grants everything', () => {
    const controls = new Map<string, ControlFlags>();
    for (const id of registry.pages.keys()) {
      controls.set(id, {
        enabled: true,
        allowAdd: true,
        allowEdit: true,
        allowDelete: true,
        allowExport: true,
      });
    }
    const grantAll: PermissionRow = {
      ...noActions(),
      view: true,
      add: true,
      edit: true,
      controls: true,
      scope: 'ALL',
    };
    const data: AccessData = {
      controls,
      rows: new Map<string, PermissionRow>([
        ['*', { ...(DEFAULT_ROLE_ROWS.DEPT_MANAGER as ActionFlags & { scope: Scope }) }],
        ['family:Administration', grantAll],
        ['page:admin-departments', grantAll],
      ]),
      departmentFamilies: new Set(['Administration', 'CRM']),
      roleVersion: 1,
      unitIds: 'tal',
    };
    for (const role of ['MANAGER', 'LEAD', 'MEMBER'] as const) {
      expect(
        decide(
          accessUserOf({ id: 'x', role, department: 'Administration' }),
          'admin-departments',
          'view',
          data,
        ),
      ).toBe(false);
    }
    expect(
      decide(
        accessUserOf({ id: 'x', role: 'MANAGER', department: 'Administration' }),
        'crm-leads',
        'view',
        data,
      ),
    ).toBe(true);
  });

  it('PUT refuses any true action on Administration resources for MANAGER/LEAD/MEMBER (409)', async () => {
    const base = await rowsFor('MEMBER');
    for (const resource of ['family:Administration', 'page:admin-audit']) {
      const rows = [
        ...base.filter((r) => r.resource !== resource),
        { resource, ...inherit, view: true },
      ];
      const res = await put(admin, 'MEMBER', rows);
      expect(res.status, resource).toBe(409);
      expect(errorOf(res).code).toBe('PROTECTED');
    }
  });

  it('PUT keeps (re-inserts) the explicit deny row when omitted or left as inherit', async () => {
    const leadRole = await prisma.role.findUniqueOrThrow({ where: { code: 'SUPERVISOR' } });
    const base = (await rowsFor('LEAD')).filter((r) => r.resource !== 'family:Administration');
    const omitted = await put(admin, 'LEAD', base);
    expect(omitted.status).toBe(200);
    const stored = await prisma.rolePermission.findUniqueOrThrow({
      where: { roleId_resource: { roleId: leadRole.id, resource: 'family:Administration' } },
    });
    expect([stored.view, stored.add, stored.edit, stored.controls]).toEqual([
      false,
      false,
      false,
      false,
    ]);

    const inherited = await put(admin, 'LEAD', [
      ...base,
      { resource: 'family:Administration', ...inherit },
    ]);
    expect(inherited.status).toBe(200);
    const again = await prisma.rolePermission.findUniqueOrThrow({
      where: { roleId_resource: { roleId: leadRole.id, resource: 'family:Administration' } },
    });
    expect(again.view).toBe(false);
  });

  it("ADMIN's controls cannot be turned off on family:Administration or Administration pages (409)", async () => {
    const base = await rowsFor('ADMIN');
    for (const resource of ['family:Administration', 'page:admin-settings']) {
      const res = await put(owner, 'ADMIN', [...base, { resource, ...inherit, controls: false }]);
      expect(res.status, resource).toBe(409);
      expect(errorOf(res).code).toBe('PROTECTED');
    }
    const ok = await put(owner, 'ADMIN', [
      ...base,
      { resource: 'page:admin-settings', ...inherit, export: false },
    ]);
    expect(ok.status).toBe(200);
  });
});

// ------------------------------------------------------------------------------------------------
describe('5. ADMIN+ endpoints also need the page permission', () => {
  const endpoints: [string, string][] = [
    ['admin-permissions', '/permissions'],
    ['admin-permissions', '/department-access'],
    ['admin-settings', '/module-controls'],
    ['admin-roles', '/roles'],
    ['admin-audit', '/audit-logs'],
    ['admin-audit', '/audit-logs/actions'],
    ['admin-users', '/users'],
  ];

  it.each(endpoints)('%s view=false blocks GET %s for an ADMIN', async (pageId, path) => {
    const base = await rowsFor('ADMIN');
    const res = await put(owner, 'ADMIN', [
      ...base,
      { resource: `page:${pageId}`, ...inherit, view: false },
    ]);
    expect(res.status).toBe(200);
    expect((await request(app).get(`${API}${path}`).set(admin.bearer)).status).toBe(403);
    expect((await request(app).get(`${API}${path}`).set(owner.bearer)).status).toBe(200);
  });

  it('admin-users allow_add / allow_edit switches block create / edit / reset, for the owner too', async () => {
    const target = await makeUser();
    // Phase 3: PATCH refuses this (409 PROTECTED, see phase3-context.test.ts); the access decision
    // must still honour such a row, so it is written straight to the DB here.
    await prisma.moduleControl.update({
      where: { pageId: 'admin-users' },
      data: { allowAdd: false, allowEdit: false },
    });
    invalidateAccessCache();
    const create = await request(app)
      .post(`${API}/users`)
      .set(owner.bearer)
      .send({
        loginId: `blocked-${Date.now().toString(36)}`,
        name: 'Blocked User',
        role: 'MEMBER',
        department: 'Sales',
        temporaryPassword: 'Temp-Passw0rd!',
      });
    expect(create.status).toBe(403);
    const patch = await request(app)
      .patch(`${API}/users/${target.id}`)
      .set(admin.bearer)
      .set('If-Match', String(target.version))
      .send({ name: 'Blocked Rename' });
    expect(patch.status).toBe(403);
    const reset = await request(app)
      .post(`${API}/users/${target.id}/reset-password`)
      .set(admin.bearer)
      .send({ temporaryPassword: 'Reset-Passw0rd!' });
    expect(reset.status).toBe(403);
    expect((await request(app).get(`${API}/users`).set(admin.bearer)).status).toBe(200);
  });
});

// ------------------------------------------------------------------------------------------------
describe('7. FK violations map to 422 field errors', () => {
  it('users.department', async () => {
    let caught: unknown;
    try {
      await makeUser({ department: 'Department That Does Not Exist' });
    } catch (err) {
      caught = err;
    }
    const mapped = await toDuplicateError(caught, {});
    expect(mapped).toBeInstanceOf(AppError);
    expect((mapped as AppError).status).toBe(422);
    expect((mapped as AppError).fields?.department).toBeDefined();
  });

  it('module_controls.owner_department', async () => {
    let caught: unknown;
    try {
      await prisma.moduleControl.update({
        where: { pageId: 'crm-leads' },
        data: { ownerDepartment: 'Department That Does Not Exist' },
      });
    } catch (err) {
      caught = err;
    }
    const mapped = mapOwnerFkError(caught);
    expect(mapped).toBeInstanceOf(AppError);
    expect((mapped as AppError).status).toBe(422);
    expect((mapped as AppError).fields?.ownerDepartment).toBeDefined();
  });
});

// ------------------------------------------------------------------------------------------------
describe('9. no-op writes return the current DTO without a version bump or an audit row', () => {
  it('PATCH /departments/:id with unchanged values', async () => {
    const dept = await makeDepartment();
    const res = await request(app)
      .patch(`${API}/departments/${dept.id}`)
      .set(admin.bearer)
      .set('If-Match', String(dept.version))
      .send({ head: dept.head, code: dept.code });
    expect(res.status).toBe(200);
    expect((res.body as { data: { version: number } }).data.version).toBe(dept.version);
    expect(await auditRows('DEPARTMENT_UPDATED', { targetId: dept.id })).toHaveLength(0);
  });

  it('PATCH /module-controls/:pageId with unchanged values', async () => {
    const version = await controlVersion('crm-meetings');
    const res = await request(app)
      .patch(`${API}/module-controls/crm-meetings`)
      .set(admin.bearer)
      .set('If-Match', String(version))
      .send({ enabled: true, allowAdd: true });
    expect(res.status).toBe(200);
    expect((res.body as { data: { version: number } }).data.version).toBe(version);
    expect(await auditRows('MODULE_CONTROL_UPDATED', { targetId: 'crm-meetings' })).toHaveLength(0);
  });

  it('PUT /department-access/:department with the same families', async () => {
    const dept = await makeDepartment(['CRM', 'Sales']);
    const res = await request(app)
      .put(`${API}/department-access/${encodeURIComponent(dept.name)}`)
      .set(admin.bearer)
      .send({ families: ['Sales', 'CRM'] });
    expect(res.status).toBe(200);
    expect(await auditRows('DEPARTMENT_ACCESS_UPDATED', { targetId: dept.id })).toHaveLength(0);
  });

  it('PUT /settings/letterhead with the same value', async () => {
    const before = (await request(app).get(`${API}/settings/letterhead`).set(admin.bearer))
      .body as {
      data: { value: Record<string, string>; version: number };
    };
    const audits = (await auditRows('SETTINGS_UPDATED', { targetId: 'letterhead' })).length;
    const res = await request(app)
      .put(`${API}/settings/letterhead`)
      .set(admin.bearer)
      .set('If-Match', String(before.data.version))
      .send(before.data.value);
    expect(res.status).toBe(200);
    expect((res.body as { data: { version: number } }).data.version).toBe(before.data.version);
    expect(await auditRows('SETTINGS_UPDATED', { targetId: 'letterhead' })).toHaveLength(audits);
  });
});

// ------------------------------------------------------------------------------------------------
describe('10/12. audit actions, detail search, wildcard escaping, offset cap', () => {
  it('GET /audit-logs/actions lists every known action; managers get 403', async () => {
    const res = await request(app).get(`${API}/audit-logs/actions`).set(admin.bearer);
    expect(res.status).toBe(200);
    expect((res.body as { data: string[] }).data).toEqual([...AUDIT_ACTIONS]);
    const manager = await signInAs(app, 'MANAGER');
    expect((await request(app).get(`${API}/audit-logs/actions`).set(manager.bearer)).status).toBe(
      403,
    );
  });

  it('q also searches inside detail', async () => {
    const marker = `Marker${Date.now().toString(36)}`;
    const res = await request(app)
      .post(`${API}/departments`)
      .set(admin.bearer)
      .send({
        code: `M${Date.now().toString(36).slice(-6).toUpperCase()}`,
        name: `Dept ${marker}`,
        head: `Head ${marker}`,
      });
    expect(res.status).toBe(201);
    const found = await request(app)
      .get(`${API}/audit-logs`)
      .query({ q: `Head ${marker}` })
      .set(admin.bearer);
    const rows = (found.body as { data: { action: string }[] }).data;
    expect(rows.map((r) => r.action)).toContain('DEPARTMENT_CREATED');
  });

  it('%, _ and \\ match literally in users and audit search', async () => {
    expect(escapeLike('50%_off\\')).toBe('50\\%\\_off\\\\');
    const pct = await makeUser({ name: 'Pct 100% Done' });
    const users = await request(app)
      .get(`${API}/users`)
      .query({ q: '%', size: 100 })
      .set(admin.bearer);
    const list = (
      users.body as { data: { id: string; name: string; loginId: string; email: string | null }[] }
    ).data;
    expect(list.map((u) => u.id)).toContain(pct.id);
    expect(list.every((u) => `${u.name}${u.loginId}${u.email ?? ''}`.includes('%'))).toBe(true);
    const under = await request(app)
      .get(`${API}/users`)
      .query({ q: '_', size: 100 })
      .set(admin.bearer);
    const underList = (
      under.body as { data: { name: string; loginId: string; email: string | null }[] }
    ).data;
    expect(underList.every((u) => `${u.name}${u.loginId}${u.email ?? ''}`.includes('_'))).toBe(
      true,
    );

    const audit = await request(app)
      .get(`${API}/audit-logs`)
      .query({ q: '%', size: 100 })
      .set(admin.bearer);
    const auditList = (audit.body as { data: unknown[] }).data;
    expect(auditList.every((r) => JSON.stringify(r).includes('%'))).toBe(true);
  });

  it('paging offset is capped at 10,000 rows (422 beyond)', async () => {
    expect(
      (await request(app).get(`${API}/users`).query({ page: 501, size: 20 }).set(admin.bearer))
        .status,
    ).toBe(200);
    expect(
      (await request(app).get(`${API}/users`).query({ page: 502, size: 20 }).set(admin.bearer))
        .status,
    ).toBe(422);
    expect(
      (
        await request(app)
          .get(`${API}/audit-logs`)
          .query({ page: 101, size: 100 })
          .set(admin.bearer)
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .get(`${API}/audit-logs`)
          .query({ page: 102, size: 100 })
          .set(admin.bearer)
      ).status,
    ).toBe(422);
  });
});
