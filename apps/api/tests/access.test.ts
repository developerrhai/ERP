// The §2.5 access decision. Part 1 is table-driven over the pure `decide` function (roles x
// department gate x family/page overrides x disabled modules x allow flags x Super Admin). Part 2
// goes through the API: /me/menu, /me/permissions, the 60 s cache and its invalidation on writes.
import request from 'supertest';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  ACCESS_CACHE_TTL_MS,
  accessCacheSize,
  decide,
  decideScope,
  invalidateAccessCache,
} from '../src/core/rbac/access';
import type { AccessData, AccessUser, ControlFlags, PermissionRow } from '../src/core/rbac/access';
import { DEFAULT_ROLE_ROWS, noActions } from '../src/core/rbac/permission-model';
import type { Action } from '../src/core/rbac/permission-model';
import type { RoleCode } from '../src/core/rbac/role-rules';
import { registry } from '../src/core/registry';
import { API, makeUser, newApp, signIn, signInOwner } from './helpers';
import type { Signed } from './helpers';
import {
  controlVersion,
  makeDepartment,
  menuOf,
  permissionsOf,
  restoreGlobal,
  roleVersion,
  snapshotGlobal,
} from './phase2-helpers';
import type { GlobalSnapshot } from './phase2-helpers';

// ------------------------------------------------------------------------------------------------
// Part 1: pure decision table
// ------------------------------------------------------------------------------------------------
const SALES_PAGE = 'sales-orders'; // family "Sales"
const ADMIN_PAGE = 'admin-departments'; // family "Administration"

const enabledControl: ControlFlags = {
  enabled: true,
  allowAdd: true,
  allowEdit: true,
  allowDelete: true,
  allowExport: true,
};

function data(
  opts: {
    rows?: Record<string, PermissionRow>;
    families?: string[];
    control?: Partial<ControlFlags>;
    controlPage?: string;
  } = {},
): AccessData {
  const controls = new Map<string, ControlFlags>();
  for (const id of registry.pages.keys()) controls.set(id, enabledControl);
  if (opts.control) {
    const page = opts.controlPage ?? SALES_PAGE;
    controls.set(page, { ...enabledControl, ...opts.control });
  }
  return {
    controls,
    rows: new Map(Object.entries(opts.rows ?? {})),
    departmentFamilies: new Set(opts.families ?? []),
  };
}

const user = (role: RoleCode): AccessUser => ({ id: `u-${role}`, role, department: 'Sales' });
const row = (flags: Partial<PermissionRow>): PermissionRow => ({
  ...noActions(),
  scope: 'OWN',
  ...flags,
});
const nulls = (): PermissionRow => ({
  view: null,
  add: null,
  edit: null,
  delete: null,
  approve: null,
  export: null,
  controls: null,
  scope: null,
});
const defaults = (
  role: 'ADMIN' | 'MANAGER' | 'LEAD' | 'MEMBER',
  extra: Record<string, PermissionRow> = {},
) => ({
  '*': { ...DEFAULT_ROLE_ROWS[role] },
  ...(role === 'ADMIN' ? {} : { 'family:Administration': row({}) }),
  ...extra,
});

interface Case {
  name: string;
  role: RoleCode;
  page: string;
  action: Action;
  data: AccessData;
  expected: boolean;
}

const cases: Case[] = [
  // 1. Unknown page
  {
    name: 'unknown page, super admin',
    role: 'SUPER_ADMIN',
    page: 'no-such-page',
    action: 'view',
    data: data(),
    expected: false,
  },
  {
    name: 'unknown page, admin',
    role: 'ADMIN',
    page: 'no-such-page',
    action: 'view',
    data: data({ rows: defaults('ADMIN') }),
    expected: false,
  },
  // 2. Disabled module
  {
    name: 'disabled: super admin cannot view',
    role: 'SUPER_ADMIN',
    page: SALES_PAGE,
    action: 'view',
    data: data({ control: { enabled: false } }),
    expected: false,
  },
  {
    name: 'disabled: super admin keeps controls',
    role: 'SUPER_ADMIN',
    page: SALES_PAGE,
    action: 'controls',
    data: data({ control: { enabled: false } }),
    expected: true,
  },
  {
    name: 'disabled: admin loses controls',
    role: 'ADMIN',
    page: SALES_PAGE,
    action: 'controls',
    data: data({ rows: defaults('ADMIN'), control: { enabled: false } }),
    expected: false,
  },
  {
    name: 'disabled: member cannot view',
    role: 'MEMBER',
    page: SALES_PAGE,
    action: 'view',
    data: data({ rows: defaults('MEMBER'), families: ['Sales'], control: { enabled: false } }),
    expected: false,
  },
  {
    name: 'no control row: fail closed',
    role: 'ADMIN',
    page: SALES_PAGE,
    action: 'view',
    data: { ...data({ rows: defaults('ADMIN') }), controls: new Map() },
    expected: false,
  },
  // 3. allow_* flags bind everyone
  {
    name: 'allowAdd off: super admin',
    role: 'SUPER_ADMIN',
    page: SALES_PAGE,
    action: 'add',
    data: data({ control: { allowAdd: false } }),
    expected: false,
  },
  {
    name: 'allowEdit off: admin',
    role: 'ADMIN',
    page: SALES_PAGE,
    action: 'edit',
    data: data({ rows: defaults('ADMIN'), control: { allowEdit: false } }),
    expected: false,
  },
  {
    name: 'allowDelete off: manager',
    role: 'MANAGER',
    page: SALES_PAGE,
    action: 'delete',
    data: data({ rows: defaults('MANAGER'), families: ['Sales'], control: { allowDelete: false } }),
    expected: false,
  },
  {
    name: 'allowExport off: lead',
    role: 'LEAD',
    page: SALES_PAGE,
    action: 'export',
    data: data({ rows: defaults('LEAD'), families: ['Sales'], control: { allowExport: false } }),
    expected: false,
  },
  {
    name: 'allowAdd off does not block view',
    role: 'MEMBER',
    page: SALES_PAGE,
    action: 'view',
    data: data({ rows: defaults('MEMBER'), families: ['Sales'], control: { allowAdd: false } }),
    expected: true,
  },
  {
    name: 'approve is not an allow flag',
    role: 'MANAGER',
    page: SALES_PAGE,
    action: 'approve',
    data: data({
      rows: defaults('MANAGER'),
      families: ['Sales'],
      control: { allowAdd: false, allowEdit: false },
    }),
    expected: true,
  },
  // 4. Super admin
  {
    name: 'super admin: everything, no rows, no families',
    role: 'SUPER_ADMIN',
    page: ADMIN_PAGE,
    action: 'controls',
    data: data(),
    expected: true,
  },
  {
    name: 'super admin: delete on sales',
    role: 'SUPER_ADMIN',
    page: SALES_PAGE,
    action: 'delete',
    data: data(),
    expected: true,
  },
  // 5. Department gate
  {
    name: 'member in Sales sees Sales',
    role: 'MEMBER',
    page: SALES_PAGE,
    action: 'view',
    data: data({ rows: defaults('MEMBER'), families: ['Sales'] }),
    expected: true,
  },
  {
    name: 'member without the family is gated',
    role: 'MEMBER',
    page: SALES_PAGE,
    action: 'view',
    data: data({ rows: defaults('MEMBER'), families: ['CRM'] }),
    expected: false,
  },
  {
    name: 'manager (DEPARTMENT) gated',
    role: 'MANAGER',
    page: SALES_PAGE,
    action: 'view',
    data: data({ rows: defaults('MANAGER'), families: [] }),
    expected: false,
  },
  {
    name: 'admin (scope ALL) skips the gate',
    role: 'ADMIN',
    page: SALES_PAGE,
    action: 'view',
    data: data({ rows: defaults('ADMIN'), families: [] }),
    expected: true,
  },
  {
    name: 'family override with scope ALL skips the gate',
    role: 'LEAD',
    page: SALES_PAGE,
    action: 'view',
    data: data({
      rows: defaults('LEAD', { 'family:Sales': row({ view: true, scope: 'ALL' }) }),
      families: [],
    }),
    expected: true,
  },
  // 6. Role gate + most specific row wins
  {
    name: 'member default: delete denied',
    role: 'MEMBER',
    page: SALES_PAGE,
    action: 'delete',
    data: data({ rows: defaults('MEMBER'), families: ['Sales'] }),
    expected: false,
  },
  {
    name: 'lead default: export allowed',
    role: 'LEAD',
    page: SALES_PAGE,
    action: 'export',
    data: data({ rows: defaults('LEAD'), families: ['Sales'] }),
    expected: true,
  },
  {
    name: 'family override denies view',
    role: 'MEMBER',
    page: SALES_PAGE,
    action: 'view',
    data: data({ rows: defaults('MEMBER', { 'family:Sales': row({}) }), families: ['Sales'] }),
    expected: false,
  },
  {
    name: 'page override beats family override',
    role: 'MEMBER',
    page: SALES_PAGE,
    action: 'view',
    data: data({
      rows: defaults('MEMBER', {
        'family:Sales': row({}),
        [`page:${SALES_PAGE}`]: row({ view: true }),
      }),
      families: ['Sales'],
    }),
    expected: true,
  },
  {
    name: 'family override grants delete',
    role: 'MEMBER',
    page: SALES_PAGE,
    action: 'delete',
    data: data({
      rows: defaults('MEMBER', { 'family:Sales': row({ view: true, delete: true }) }),
      families: ['Sales'],
    }),
    expected: true,
  },
  {
    name: 'no rows at all: denied',
    role: 'MANAGER',
    page: SALES_PAGE,
    action: 'view',
    data: data({ families: ['Sales'] }),
    expected: false,
  },
  {
    name: 'non-admin denied on Administration by default',
    role: 'MANAGER',
    page: ADMIN_PAGE,
    action: 'view',
    data: data({ rows: defaults('MANAGER'), families: ['Administration'] }),
    expected: false,
  },
  {
    name: 'admin views Administration',
    role: 'ADMIN',
    page: ADMIN_PAGE,
    action: 'view',
    data: data({ rows: defaults('ADMIN') }),
    expected: true,
  },
  // Per-cell inheritance (null = inherit page -> family -> "*")
  {
    name: 'family row with null view inherits "*" view',
    role: 'MEMBER',
    page: SALES_PAGE,
    action: 'view',
    data: data({
      rows: defaults('MEMBER', { 'family:Sales': { ...nulls(), delete: true } }),
      families: ['Sales'],
    }),
    expected: true,
  },
  {
    name: 'family row grants delete while other cells inherit',
    role: 'MEMBER',
    page: SALES_PAGE,
    action: 'delete',
    data: data({
      rows: defaults('MEMBER', { 'family:Sales': { ...nulls(), delete: true } }),
      families: ['Sales'],
    }),
    expected: true,
  },
  {
    name: 'page row overrides one cell, view still comes from the family row',
    role: 'MEMBER',
    page: SALES_PAGE,
    action: 'view',
    data: data({
      rows: defaults('MEMBER', {
        'family:Sales': row({}),
        [`page:${SALES_PAGE}`]: { ...nulls(), delete: true },
      }),
      families: ['Sales'],
    }),
    expected: false,
  },
  {
    name: 'scope inherits from the family row (ALL skips the gate) through a page row with null scope',
    role: 'LEAD',
    page: SALES_PAGE,
    action: 'view',
    data: data({
      rows: defaults('LEAD', {
        'family:Sales': { ...nulls(), scope: 'ALL' },
        [`page:${SALES_PAGE}`]: { ...nulls(), export: false },
      }),
      families: [],
    }),
    expected: true,
  },
  {
    name: 'a cell null on every row resolves to false',
    role: 'MEMBER',
    page: SALES_PAGE,
    action: 'view',
    data: data({ rows: { '*': { ...nulls() } }, families: ['Sales'] }),
    expected: false,
  },
  // 7. Hierarchy guard on controls
  {
    name: 'manager with controls in the table is still denied',
    role: 'MANAGER',
    page: SALES_PAGE,
    action: 'controls',
    data: data({
      rows: defaults('MANAGER', {
        'family:Sales': row({ view: true, controls: true, scope: 'ALL' }),
      }),
      families: ['Sales'],
    }),
    expected: false,
  },
  {
    name: 'admin has controls',
    role: 'ADMIN',
    page: ADMIN_PAGE,
    action: 'controls',
    data: data({ rows: defaults('ADMIN') }),
    expected: true,
  },
  // admin-users keeps its Phase 1 rule
  {
    name: 'admin-users: lead denied even if the table allows',
    role: 'LEAD',
    page: 'admin-users',
    action: 'view',
    data: data({
      rows: defaults('LEAD', { 'page:admin-users': row({ view: true, scope: 'ALL' }) }),
      families: ['Administration'],
    }),
    expected: false,
  },
  {
    name: 'admin-users: admin allowed without department families',
    role: 'ADMIN',
    page: 'admin-users',
    action: 'view',
    data: data({ rows: { '*': row({ view: true, scope: 'OWN' }) }, families: [] }),
    expected: true,
  },
];

describe('decide (§2.5) — decision table', () => {
  it.each(cases)('$name', ({ role, page, action, data: d, expected }) => {
    expect(decide(user(role), page, action, d)).toBe(expected);
  });

  it('scopeFor: super admin ALL, otherwise the most specific row', () => {
    expect(decideScope(user('SUPER_ADMIN'), SALES_PAGE, data())).toBe('ALL');
    const d = data({
      rows: defaults('LEAD', { 'family:Sales': row({ view: true, scope: 'ALL' }) }),
    });
    expect(decideScope(user('LEAD'), SALES_PAGE, d)).toBe('ALL');
    expect(decideScope(user('LEAD'), 'crm-leads', d)).toBe('DEPARTMENT');
    expect(decideScope(user('MEMBER'), SALES_PAGE, data({ rows: defaults('MEMBER') }))).toBe('OWN');
    expect(decideScope(user('MEMBER'), 'no-such-page', data())).toBe('OWN');
  });
});

// ------------------------------------------------------------------------------------------------
// Part 2: through the API
// ------------------------------------------------------------------------------------------------
const app = newApp();
let owner: Signed;
let snap: GlobalSnapshot;

beforeAll(async () => {
  owner = await signInOwner(app);
  snap = await snapshotGlobal();
});

afterEach(async () => {
  await restoreGlobal(snap);
});

describe('GET /me/menu', () => {
  it('super admin sees all 22 families and 248 pages, in registry order', async () => {
    const menu = await menuOf(app, owner);
    expect(menu.status).toBe(200);
    expect(menu.families).toEqual(registry.familyNames);
    expect(menu.pages).toHaveLength(248);
    expect(menu.pages).toEqual([...registry.pages.keys()]);
  });

  it('a Sales member sees only Sales families, never Administration', async () => {
    const member = await signIn(app, await makeUser({ role: 'MEMBER', department: 'Sales' }));
    const menu = await menuOf(app, member);
    expect(menu.families).toEqual(
      registry.familyNames.filter((f) => registry.data.deptFamilies.Sales?.includes(f)),
    );
    expect(menu.families).not.toContain('Administration');
    expect(menu.pages).not.toContain('admin-users');
  });

  it('an admin sees every family, including Administration and admin-users', async () => {
    const admin = await signIn(app, await makeUser({ role: 'ADMIN', department: 'Sales' }));
    const menu = await menuOf(app, admin);
    expect(menu.families).toEqual(registry.familyNames);
    expect(menu.pages).toContain('admin-users');
  });

  it('omits families with no visible items and needs a Bearer token', async () => {
    const dept = await makeDepartment(['CRM']);
    const lead = await signIn(app, await makeUser({ role: 'LEAD', department: dept.name }));
    expect((await menuOf(app, lead)).families).toEqual(['CRM']);
    expect((await request(app).get(`${API}/me/menu`)).status).toBe(401);
  });
});

describe('GET /me/permissions', () => {
  it('returns the action flags and scope for a page', async () => {
    const member = await signIn(app, await makeUser({ role: 'MEMBER', department: 'Sales' }));
    const body = await permissionsOf(app, member, SALES_PAGE);
    expect(body.data).toEqual({
      pageId: SALES_PAGE,
      actions: {
        view: true,
        add: true,
        edit: true,
        delete: false,
        approve: false,
        export: false,
        controls: false,
      },
      scope: 'OWN',
    });
  });

  it('404 for an unknown page, 422 without pageId or with extra keys', async () => {
    expect(
      (await request(app).get(`${API}/me/permissions`).query({ pageId: 'nope' }).set(owner.bearer))
        .status,
    ).toBe(404);
    expect((await request(app).get(`${API}/me/permissions`).set(owner.bearer)).status).toBe(422);
    expect(
      (
        await request(app)
          .get(`${API}/me/permissions`)
          .query({ pageId: SALES_PAGE, x: 1 })
          .set(owner.bearer)
      ).status,
    ).toBe(422);
  });
});

describe('cache invalidation (§2.5)', () => {
  it('a permission change is visible on the very next request', async () => {
    const member = await signIn(app, await makeUser({ role: 'MEMBER', department: 'Sales' }));
    expect((await menuOf(app, member)).families).toContain('Sales'); // fills the cache
    expect(accessCacheSize()).toBeGreaterThan(0);
    expect(ACCESS_CACHE_TTL_MS).toBe(60_000);

    const current = await request(app).get(`${API}/permissions`).set(owner.bearer);
    const memberRows =
      (
        current.body as { data: { roles: { role: string; rows: Record<string, unknown>[] }[] } }
      ).data.roles.find((r) => r.role === 'MEMBER')?.rows ?? [];
    const rows = memberRows
      .map(({ version: _v, ...rest }) => rest)
      .concat([
        {
          resource: 'family:Sales',
          view: false,
          add: false,
          edit: false,
          delete: false,
          approve: false,
          export: false,
          controls: false,
          scope: 'OWN',
        },
      ]);
    const put = await request(app)
      .put(`${API}/permissions/MEMBER`)
      .set(owner.bearer)
      .set('If-Match', String(await roleVersion(app, owner, 'MEMBER')))
      .send({ rows });
    expect(put.status).toBe(200);
    const after = await menuOf(app, member);
    expect(after.families).not.toContain('Sales');
    expect(after.families).toContain('CRM');
  });

  it('disabling a module hides it from every menu at once, the owner keeps controls', async () => {
    const member = await signIn(app, await makeUser({ role: 'MEMBER', department: 'Sales' }));
    expect((await menuOf(app, member)).pages).toContain(SALES_PAGE);
    const res = await request(app)
      .patch(`${API}/module-controls/${SALES_PAGE}`)
      .set(owner.bearer)
      .set('If-Match', String(await controlVersion(SALES_PAGE)))
      .send({ enabled: false });
    expect(res.status).toBe(200);
    expect((await menuOf(app, member)).pages).not.toContain(SALES_PAGE);
    expect((await menuOf(app, owner)).pages).not.toContain(SALES_PAGE);
    const ownerPerms = await permissionsOf(app, owner, SALES_PAGE);
    expect(ownerPerms.data.actions.view).toBe(false);
    expect(ownerPerms.data.actions.controls).toBe(true);
  });

  it('a department-access change and a user department change apply on the next request', async () => {
    const dept = await makeDepartment(['CRM']);
    const created = await makeUser({ role: 'MEMBER', department: dept.name });
    const member = await signIn(app, created);
    expect((await menuOf(app, member)).families).toEqual(['CRM']);

    const put = await request(app)
      .put(`${API}/department-access/${encodeURIComponent(dept.name)}`)
      .set(owner.bearer)
      .send({ families: ['CRM', 'Sales'] });
    expect(put.status).toBe(200);
    expect((await menuOf(app, member)).families).toEqual(['CRM', 'Sales']);

    const patch = await request(app)
      .patch(`${API}/users/${created.id}`)
      .set(owner.bearer)
      .set('If-Match', String(created.version))
      .send({ department: 'HR' });
    expect(patch.status).toBe(200);
    expect((await menuOf(app, member)).families).toContain('HRMS');
  });

  it('invalidateAccessCache clears every entry', async () => {
    await menuOf(app, owner);
    expect(accessCacheSize()).toBeGreaterThan(0);
    invalidateAccessCache();
    expect(accessCacheSize()).toBe(0);
  });
});
