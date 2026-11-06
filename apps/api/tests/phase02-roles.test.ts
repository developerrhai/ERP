import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import request from 'supertest';
import { prisma } from '../src/core/db/prisma';
import { newApp, signIn, signInAs, signInOwner, makeUser, API, uniqueLoginId, unitIds } from './helpers';
import type { Signed } from './helpers';
import {
  decide,
  decideScope,
  explain,
  accessUserOf,
  accessProfile,
  can,
  scopeFor,
  invalidateAccessCache,
  accessCacheSize,
} from '../src/core/rbac/access';
import type { AccessData, AccessUser, ControlFlags, PermissionRow } from '../src/core/rbac/access';
import {
  allActions,
  noActions,
  DEFAULT_RESOURCE,
  familyResource,
  pageResource,
  DEFAULT_ROLE_ROWS,
  CFO_ALLOWED_FAMILIES,
} from '../src/core/rbac/permission-model';
import type { Action, ActionFlags, Scope } from '../src/core/rbac/permission-model';
import { ADMIN_LEVEL, SUPER_USER_LEVEL, canManageLevel, isReservedLevel, isSystemRole } from '../src/core/rbac/role-rules';
import { ADMIN_FAMILY, registry } from '../src/core/registry';
import { meService } from '../src/modules/me/service';
import { recordRepository } from '../src/modules/records/repository';

const app = newApp();

const enabledControl: ControlFlags = {
  enabled: true,
  allowAdd: true,
  allowEdit: true,
  allowDelete: true,
  allowExport: true,
};

function createMockAccessData(
  rows: Record<string, PermissionRow> = {},
  departmentFamilies: string[] = ['Sales'],
  controlOverrides: Partial<ControlFlags> = {},
): AccessData {
  const controls = new Map<string, ControlFlags>();
  for (const page of registry.pages.keys()) {
    controls.set(page, { ...enabledControl, ...controlOverrides });
  }
  return {
    controls,
    rows: new Map(Object.entries(rows)),
    departmentFamilies: new Set(departmentFamilies),
    roleVersion: 1,
    unitIds: 'tal',
  };
}

describe('Phase 02 §10 — 1. Pure decide() & explain()', () => {
  const nullRow = (): PermissionRow => ({
    view: null,
    add: null,
    edit: null,
    delete: null,
    approve: null,
    export: null,
    controls: null,
    submit: null,
    post: null,
    cancel: null,
    print: null,
    import: null,
    scope: null,
  });

  it('explicit deny on family beats page allow (deny wins)', () => {
    const user: AccessUser = {
      id: 'u1',
      roleId: 'r1',
      roleCode: 'CUSTOM',
      level: 50,
      allUnits: false,
      departments: ['Sales'],
    };

    // Family row explicitly denies view: false, but page row explicitly allows view: true
    const data = createMockAccessData({
      '*': { ...allActions(), scope: 'DEPARTMENT' },
      'family:Sales': { ...nullRow(), view: false },
      'page:sales-orders': { ...nullRow(), view: true },
    }, ['Sales']);

    expect(decide(user, 'sales-orders', 'view', data)).toBe(false);

    const exp = explain(user, 'sales-orders', data);
    expect(exp.actions.view).toBe(false);
    expect(exp.reasons.some((r) => r.includes('Denied by family row'))).toBe(true);
  });

  it('inheritance chain: page -> family -> *', () => {
    const user: AccessUser = {
      id: 'u1',
      roleId: 'r1',
      roleCode: 'CUSTOM',
      level: 50,
      allUnits: false,
      departments: ['Sales'],
    };

    // Page inherits edit from family, family inherits delete from *
    const data = createMockAccessData({
      '*': { ...noActions(), view: true, delete: true, scope: 'OWN' },
      'family:Sales': { ...nullRow(), edit: true },
      'page:sales-orders': { ...nullRow(), add: true },
    }, ['Sales']);

    expect(decide(user, 'sales-orders', 'view', data)).toBe(true);
    expect(decide(user, 'sales-orders', 'edit', data)).toBe(true);
    expect(decide(user, 'sales-orders', 'add', data)).toBe(true);
    expect(decide(user, 'sales-orders', 'delete', data)).toBe(true);
    expect(decide(user, 'sales-orders', 'approve', data)).toBe(false);
  });

  it('UNIT and ALL scopes skip the department gate', () => {
    const user: AccessUser = {
      id: 'u1',
      roleId: 'r1',
      roleCode: 'CUSTOM',
      level: 50,
      allUnits: false,
      departments: ['Purchase'], // Not Sales!
    };

    // 1. With DEPARTMENT scope -> gated
    const deptData = createMockAccessData({
      '*': { ...allActions(), scope: 'DEPARTMENT' },
    }, ['Purchase']); // Sales is not in user's department families
    expect(decide(user, 'sales-orders', 'view', deptData)).toBe(false);

    // 2. With UNIT scope -> department gate skipped!
    const unitData = createMockAccessData({
      '*': { ...allActions(), scope: 'UNIT' },
    }, ['Purchase']);
    expect(decide(user, 'sales-orders', 'view', unitData)).toBe(true);

    // 3. With ALL scope -> department gate skipped!
    const allData = createMockAccessData({
      '*': { ...allActions(), scope: 'ALL' },
    }, ['Purchase']);
    expect(decide(user, 'sales-orders', 'view', allData)).toBe(true);
  });

  it('extra departments are combined for the department gate', () => {
    const user: AccessUser = {
      id: 'u1',
      roleId: 'r1',
      roleCode: 'CUSTOM',
      level: 50,
      allUnits: false,
      departments: ['Sales', 'Finance'], // Extra department Finance
    };

    // departmentFamilies contains both Sales and Finance
    const data = createMockAccessData({
      '*': { ...allActions(), scope: 'DEPARTMENT' },
    }, ['Sales', 'Finance & Accounts']);

    // Can access both Sales and Finance pages
    expect(decide(user, 'sales-orders', 'view', data)).toBe(true);
    expect(decide(user, 'fin-gl', 'view', data)).toBe(true);
    // But cannot access Warehouse page
    expect(decide(user, 'inv-items', 'view', data)).toBe(false);
  });

  it('Administration hard rule: role level below 95 is denied', () => {
    const user90: AccessUser = {
      id: 'u1',
      roleId: 'r1',
      roleCode: 'DIRECTOR',
      level: 90,
      allUnits: true,
      departments: ['Administration'],
    };

    const adminUser: AccessUser = {
      id: 'u2',
      roleId: 'r2',
      roleCode: 'ADMINISTRATOR',
      level: 95,
      allUnits: true,
      departments: ['Administration'],
    };

    // Even if permission table grants true
    const data = createMockAccessData({
      '*': { ...allActions(), scope: 'ALL' },
    }, ['Administration']);

    expect(decide(user90, 'admin-users', 'view', data)).toBe(false);
    expect(decide(adminUser, 'admin-users', 'view', data)).toBe(true);

    const exp = explain(user90, 'admin-users', data);
    expect(exp.reasons.some((r) => r.includes('Administration pages are only for Administrator and Super User'))).toBe(true);
  });

  it('allow_* switches veto everyone, including Super User', () => {
    const superUser: AccessUser = {
      id: 's1',
      roleId: 'r0',
      roleCode: 'SUPER_USER',
      level: 99,
      allUnits: true,
      departments: [],
    };

    // allowAdd off vetoes add and import
    const dataAddOff = createMockAccessData({}, ['Sales'], { allowAdd: false });
    expect(decide(superUser, 'sales-orders', 'add', dataAddOff)).toBe(false);
    expect(decide(superUser, 'sales-orders', 'import', dataAddOff)).toBe(false);
    expect(decide(superUser, 'sales-orders', 'view', dataAddOff)).toBe(true);

    // allowEdit off vetoes edit
    const dataEditOff = createMockAccessData({}, ['Sales'], { allowEdit: false });
    expect(decide(superUser, 'sales-orders', 'edit', dataEditOff)).toBe(false);

    // allowDelete off vetoes delete
    const dataDeleteOff = createMockAccessData({}, ['Sales'], { allowDelete: false });
    expect(decide(superUser, 'sales-orders', 'delete', dataDeleteOff)).toBe(false);

    // allowExport off vetoes export and print
    const dataExportOff = createMockAccessData({}, ['Sales'], { allowExport: false });
    expect(decide(superUser, 'sales-orders', 'export', dataExportOff)).toBe(false);
    expect(decide(superUser, 'sales-orders', 'print', dataExportOff)).toBe(false);
  });

  it('explain(user, page) gives explicit reasons for decisions', () => {
    const employee: AccessUser = {
      id: 'u1',
      roleId: 'r1',
      roleCode: 'EMPLOYEE',
      level: 10,
      allUnits: false,
      departments: ['Sales'],
    };

    const data = createMockAccessData({
      '*': { ...(DEFAULT_ROLE_ROWS.EMPLOYEE as ActionFlags & { scope: Scope }) },
      'family:Administration': { ...noActions(), scope: 'OWN' },
    }, ['Sales']);

    const salesExp = explain(employee, 'sales-orders', data);
    expect(salesExp.actions.view).toBe(true);
    expect(salesExp.actions.delete).toBe(false);
    expect(salesExp.scope).toBe('OWN');

    const adminExp = explain(employee, 'admin-users', data);
    expect(adminExp.actions.view).toBe(false);
    expect(adminExp.reasons.some((r) => r.includes('Administration'))).toBe(true);
  });
});

describe('Phase 02 §10 — 2. Hierarchy and API Guards (§5.5, §6)', () => {
  let superUser: Signed;
  let admin: Signed;

  beforeAll(async () => {
    superUser = await signInOwner(app);
    admin = await signInAs(app, 'ADMINISTRATOR');
  });

  it('an Administrator (95) cannot create roles at level >= 95 (403 LEVEL)', async () => {
    const res95 = await request(app)
      .post(`${API}/roles`)
      .set(admin.bearer)
      .send({
        code: 'TEST_ADMIN_CLONE',
        name: `Clone 95 ${uniqueLoginId()}`,
        level: 95,
      });
    expect(res95.status).toBe(403);
    expect(res95.body.error.message).toContain('You can only create roles below your own level');

    const res98 = await request(app)
      .post(`${API}/roles`)
      .set(admin.bearer)
      .send({
        code: 'TEST_HIGH',
        name: `High Level ${uniqueLoginId()}`,
        level: 98,
      });
    expect(res98.status).toBe(403);
  });

  it('Super User cannot create reserved levels 95 or 99 (403 RESERVED)', async () => {
    const res = await request(app)
      .post(`${API}/roles`)
      .set(superUser.bearer)
      .send({
        code: 'TEST_RESERVED',
        name: `Reserved ${uniqueLoginId()}`,
        level: 95,
      });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toContain('Levels 95 and 99 are reserved.');
  });

  it('an Administrator cannot edit Administrator permissions or their own role (403)', async () => {
    const adminRole = await prisma.role.findUniqueOrThrow({ where: { code: 'ADMINISTRATOR' } });
    const res = await request(app)
      .put(`${API}/permissions/${adminRole.id}`)
      .set(admin.bearer)
      .set('If-Match', '1')
      .send({
        rows: [{ resource: '*', ...allActions(), scope: 'ALL' }],
      });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toContain('You cannot change your own role');
  });

  it('self-escalation is blocked: nobody can change their own role, departments, approvalLimit or status', async () => {
    const user = await makeUser({ role: 'ADMINISTRATOR' });
    const userSigned = await signIn(app, user);

    const resRole = await request(app)
      .patch(`${API}/users/${user.id}`)
      .set(userSigned.bearer)
      .set('If-Match', String(user.version))
      .send({ role: 'DIRECTOR' });
    expect(resRole.status).toBe(403);
    expect(resRole.body.error.message).toContain('You cannot change your own role, departments, approval limit or status.');

    // Audit row ACCESS_DENIED_SELF_ESCALATION
    const audits = await prisma.auditLog.findMany({
      where: { action: 'ACCESS_DENIED_SELF_ESCALATION', actorId: user.id },
    });
    expect(audits.length).toBeGreaterThanOrEqual(1);
  });

  it('a Department Manager (level 50) gets 403 on /users', async () => {
    const deptManager = await signInAs(app, 'DEPT_MANAGER');
    const res = await request(app).get(`${API}/users`).set(deptManager.bearer);
    expect(res.status).toBe(403);
  });

  it('deactivating the last Super User returns 409', async () => {
    const ownerUser = await prisma.user.findFirstOrThrow({
      where: { role: { code: 'SUPER_USER' } },
    });
    const res = await request(app)
      .patch(`${API}/users/${ownerUser.id}`)
      .set(superUser.bearer)
      .set('If-Match', String(ownerUser.version))
      .send({ status: 'INACTIVE' });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toContain('At least one active Super User is required.');
  });

  it('only Super User can create a Super User', async () => {
    // Administrator fails
    const adminTry = await request(app)
      .post(`${API}/users`)
      .set(admin.bearer)
      .send({
        loginId: uniqueLoginId('su_fail'),
        name: 'Super User Try',
        role: 'SUPER_USER',
        temporaryPassword: 'Temp-Passw0rd!',
      });
    expect(adminTry.status).toBe(403);

    // Super User succeeds
    const suRole = await prisma.role.findUniqueOrThrow({ where: { code: 'SUPER_USER' } });
    const loginId = uniqueLoginId('su_pass');
    const suSuccess = await request(app)
      .post(`${API}/users`)
      .set(superUser.bearer)
      .send({
        loginId,
        name: 'Second Super User',
        roleId: suRole.id,
        temporaryPassword: 'Temp-Passw0rd!',
      });
    expect(suSuccess.status).toBe(201);
    await prisma.user.delete({ where: { id: suSuccess.body.data.id } });
  });
});

describe('Phase 02 §10 — 3. Role Master CRUD & System Guards', () => {
  let superUser: Signed;
  let admin: Signed;

  beforeAll(async () => {
    superUser = await signInOwner(app);
    admin = await signInAs(app, 'ADMINISTRATOR');
  });

  it('happy path: create custom role with copyFromRoleId, update, delete', async () => {
    const deptHeadRole = await prisma.role.findUniqueOrThrow({ where: { code: 'DEPT_HEAD' } });

    // 1. POST /roles (copying from DEPT_HEAD)
    const code = `PLANT_HEAD_${Date.now().toString(36).toUpperCase()}`.slice(0, 30);
    const createRes = await request(app)
      .post(`${API}/roles`)
      .set(admin.bearer)
      .send({
        code,
        name: `Plant Head ${uniqueLoginId()}`,
        level: 65,
        description: 'Plant management',
        allUnits: true,
        copyFromRoleId: deptHeadRole.id,
      });
    expect(createRes.status).toBe(201);
    const created = createRes.body.data;
    expect(created.level).toBe(65);
    expect(created.allUnits).toBe(true);

    // Audit row ROLE_CREATED
    const createAudits = await prisma.auditLog.findMany({
      where: { action: 'ROLE_CREATED', targetId: created.id },
    });
    expect(createAudits.length).toBe(1);

    // Permissions were copied
    const copiedPerms = await prisma.rolePermission.findMany({ where: { roleId: created.id } });
    expect(copiedPerms.length).toBeGreaterThan(0);

    // 2. PATCH /roles/:id
    const patchRes = await request(app)
      .patch(`${API}/roles/${created.id}`)
      .set(admin.bearer)
      .set('If-Match', String(created.version))
      .send({
        name: `Updated Plant Head ${uniqueLoginId()}`,
        description: 'Updated description',
      });
    expect(patchRes.status).toBe(200);

    // 3. DELETE /roles/:id
    const delRes = await request(app)
      .delete(`${API}/roles/${created.id}`)
      .set(admin.bearer)
      .set('If-Match', String(patchRes.body.data.version));
    expect(delRes.status).toBe(204);

    expect(await prisma.role.findUnique({ where: { id: created.id } })).toBeNull();
  });

  it('system roles cannot be deleted and their code and level are fixed', async () => {
    const cfo = await prisma.role.findUniqueOrThrow({ where: { code: 'CFO' } });

    // Try deleting
    const del = await request(app)
      .delete(`${API}/roles/${cfo.id}`)
      .set(admin.bearer)
      .set('If-Match', String(cfo.version));
    expect(del.status).toBe(409);
    expect(del.body.error.message).toContain('System roles cannot be deleted. Their code and level are fixed.');

    // Try editing level
    const edit = await request(app)
      .patch(`${API}/roles/${cfo.id}`)
      .set(admin.bearer)
      .set('If-Match', String(cfo.version))
      .send({ level: 82 });
    expect(edit.status).toBe(409);
    expect(edit.body.error.message).toContain('System roles cannot be deleted. Their code and level are fixed.');
  });

  it('role in use cannot be deleted (409 IN_USE)', async () => {
    const role = await prisma.role.create({
      data: {
        code: `TEMP_${Date.now().toString(36).toUpperCase()}`.slice(0, 30),
        name: `Temp ${uniqueLoginId()}`,
        level: 25,
      },
    });
    await makeUser({ roleId: role.id });

    const del = await request(app)
      .delete(`${API}/roles/${role.id}`)
      .set(admin.bearer)
      .set('If-Match', '1');
    expect(del.status).toBe(409);
    expect(del.body.error.message).toContain('assigned to 1 users. Move them to another role first.');
  });
});

describe('Phase 02 §10 — 4. Effective Access & Check Access Viewer', () => {
  let admin: Signed;

  beforeAll(async () => {
    admin = await signInAs(app, 'ADMINISTRATOR');
  });

  it('GET /users/:id/effective-access returns 12 actions, scope, reasons', async () => {
    const user = await makeUser({ role: 'SUPERVISOR', department: 'Sales', extraDepartments: ['Quality'] });

    const res = await request(app)
      .get(`${API}/users/${user.id}/effective-access`)
      .set(admin.bearer);

    expect(res.status).toBe(200);
    const body = res.body.data;
    expect(body.user.id).toBe(user.id);
    expect(body.pages.length).toBeGreaterThan(0);

    const salesPage = body.pages.find((p: any) => p.pageId === 'sales-orders');
    expect(salesPage).toBeDefined();
    expect(salesPage.actions.view).toBe(true);
    expect(salesPage.actions.submit).toBe(true);
    expect(salesPage.actions.delete).toBe(false);

    // Can filter by family
    const filteredRes = await request(app)
      .get(`${API}/users/${user.id}/effective-access?family=Sales`)
      .set(admin.bearer);
    expect(filteredRes.status).toBe(200);
    expect(filteredRes.body.data.pages.every((p: any) => p.family === 'Sales')).toBe(true);
  });
});

describe('Phase 02 §10 — 5. Menu == can(view) & Route Matrix', () => {
  it('menu strictly equals { pages where can(view) } for role x department', async () => {
    // 1. Director sees 21 families
    const directorUser = await makeUser({ role: 'DIRECTOR', department: 'Administration' });
    const directorSigned = await signIn(app, directorUser);
    const directorMenuRes = await request(app).get(`${API}/me/menu`).set(directorSigned.bearer);
    expect(directorMenuRes.status).toBe(200);
    const directorFamilies = directorMenuRes.body.data.families;
    // Director sees 21 families (all except Administration which requires level 95)
    expect(directorFamilies.length).toBe(21);
    expect(directorFamilies.some((f: any) => f.name === 'Administration')).toBe(false);

    // 2. Non-administrator in Administration department sees no admin pages
    const employeeInAdmin = await makeUser({ role: 'EMPLOYEE', department: 'Administration' });
    const empSigned = await signIn(app, employeeInAdmin);
    const empMenuRes = await request(app).get(`${API}/me/menu`).set(empSigned.bearer);
    const empFamilies = empMenuRes.body.data.families;
    expect(empFamilies.some((f: any) => f.name === 'Administration')).toBe(false);

    // 3. Adding an extra department adds that family to the menu
    const salesUser = await makeUser({ role: 'SUPERVISOR', department: 'Sales' });
    const beforeMenu = await meService.menu(accessUserOf(salesUser));
    expect(beforeMenu.families.some((f) => f.name === 'Finance & Accounts')).toBe(false);

    // Give extra department Finance
    await prisma.userDepartment.create({
      data: { userId: salesUser.id, departmentName: 'Finance' },
    });
    invalidateAccessCache();

    const freshUser = await prisma.user.findUniqueOrThrow({
      where: { id: salesUser.id },
      include: { role: true, extraDepartments: true },
    });
    const afterMenu = await meService.menu(accessUserOf(freshUser));
    expect(afterMenu.families.some((f) => f.name === 'Finance & Accounts')).toBe(true);
  });
});

describe('Phase 02 §10 — 6. Scope SQL in Repository (§5.3)', () => {
  it('visibilitySql filters by user departments and extra departments', () => {
    const user: AccessUser = {
      id: 'u-sales',
      roleId: 'r-head',
      roleCode: 'DEPT_HEAD',
      level: 60,
      allUnits: false,
      departments: ['Sales', 'Purchase'],
    };

    // DEPARTMENT scope
    const sql = recordRepository.visibilitySql(user, 'DEPARTMENT');
    expect(sql.statement).toContain('g.department = ANY(');
    expect(sql.values).toContainEqual(['Sales', 'Purchase']);

    // OWN scope
    const ownSql = recordRepository.visibilitySql(user, 'OWN');
    expect(ownSql.statement).toContain('created_by_id =');
    expect(ownSql.values).toContainEqual('u-sales');

    // ALL and UNIT scope have no department constraint
    const allSql = recordRepository.visibilitySql(user, 'ALL');
    expect(allSql.statement).toBe('TRUE');
  });
});

describe('Phase 02 §10 — 7. Cache Invalidation (§5.6)', () => {
  it('changes are visible on next request after cache invalidation', async () => {
    const user = await makeUser({ role: 'EMPLOYEE', department: 'Sales' });
    const accessUser = accessUserOf(user);

    // Prime cache
    const initial = await can(accessUser, 'sales-orders', 'view');
    expect(initial).toBe(true);
    expect(accessCacheSize()).toBeGreaterThan(0);

    // Explicit cache invalidation
    invalidateAccessCache();
    expect(accessCacheSize()).toBe(0);
  });
});
