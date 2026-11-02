// User Master tests: role options limited to canManage, row actions only for manageable users,
// If-Match on PATCH, 422 field errors under fields, 409 conflict text, confirm modal, filters.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  apiError,
  authOk,
  DEPARTMENTS,
  json,
  makeUser,
  mockFetch,
  renderApp,
  ROLES_FOR_ADMIN,
  type Handler,
} from '../../test/helpers';
import type { RoleMeta, User } from '../../types';
import { manageableRoles } from './usersApi';

const admin = makeUser({ id: 'me', name: 'Asha Patil', role: 'ADMIN', roleLabel: 'Admin' });
const owner = makeUser({
  id: 'sa',
  name: 'Owner Person',
  loginId: 'owner',
  email: 'owner@rhai.local',
  role: 'SUPER_ADMIN',
  roleLabel: 'Super Admin',
  department: null,
});
const member = makeUser({
  id: 'm1',
  name: 'Ravi Kumar',
  loginId: 'ravi',
  email: 'ravi@rhai.local',
  role: 'MEMBER',
  roleLabel: 'Member',
  department: 'Sales',
  version: 7,
  units: [{ id: 'unit-tal', code: 'TAL', name: 'Talwade' }],
  defaultUnitId: 'unit-tal',
});

function setup(extra: Record<string, Handler> = {}, roles: RoleMeta[] = ROLES_FOR_ADMIN) {
  return mockFetch({
    'POST /api/v1/auth/refresh': () => authOk(admin),
    'GET /api/v1/health': () => json(200, { data: { status: 'ok', db: 'ok' } }),
    'GET /api/v1/meta/roles': () => json(200, { data: roles }),
    'GET /api/v1/meta/departments': () => json(200, { data: DEPARTMENTS }),
    'GET /api/v1/users': () =>
      json(200, { data: [admin, owner, member], meta: { page: 1, size: 20, total: 3 } }),
    ...extra,
  });
}

async function openPage() {
  renderApp('/m/admin-users');
  await screen.findByRole('heading', { name: 'User Master' });
  await screen.findByText('Ravi Kumar');
}

function rowOf(name: string): HTMLElement {
  const row = within(screen.getByRole('table')).getByText(name).closest('tr');
  if (!row) throw new Error(`no row for ${name}`);
  return row;
}

describe('manageableRoles', () => {
  it('keeps only canManage roles, highest first', () => {
    expect(manageableRoles(ROLES_FOR_ADMIN).map((r) => r.code)).toEqual([
      'MANAGER',
      'LEAD',
      'MEMBER',
    ]);
  });
});

describe('UserMasterPage', () => {
  it('renders the contract columns and the users', async () => {
    setup();
    await openPage();
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual([
      'Name',
      'Login ID',
      'Email',
      'Department',
      'Role',
      'Units',
      'Status',
      'Last Login',
      'Action',
    ]);
    expect(within(rowOf('Ravi Kumar')).getByText('Active')).toHaveClass('status', 'active');
  });

  it('offers only canManage roles (Admin view) and the 11 departments in Add', async () => {
    setup();
    await openPage();
    await userEvent.setup().click(screen.getByRole('button', { name: '＋ Add User' }));
    const dialog = screen.getByRole('dialog', { name: 'Add User' });
    const role = within(dialog).getByLabelText('Role');
    const opts = within(role)
      .getAllByRole('option')
      .map((o) => (o as HTMLOptionElement).value)
      .filter(Boolean);
    expect(opts).toEqual(['MANAGER', 'LEAD', 'MEMBER']);
    const dept = within(dialog).getByLabelText('Department');
    expect(
      within(dept)
        .getAllByRole('option')
        .map((o) => (o as HTMLOptionElement).value)
        .filter(Boolean),
    ).toEqual(DEPARTMENTS);
  });

  it('a Super Admin view offers Admin too, never Super Admin', async () => {
    const roles = ROLES_FOR_ADMIN.map((r) => ({ ...r, canManage: r.code !== 'SUPER_ADMIN' }));
    setup({}, roles);
    await openPage();
    await userEvent.setup().click(screen.getByRole('button', { name: '＋ Add User' }));
    const role = within(screen.getByRole('dialog')).getByLabelText('Role');
    const opts = within(role)
      .getAllByRole('option')
      .map((o) => (o as HTMLOptionElement).value);
    expect(opts).toContain('ADMIN');
    expect(opts).not.toContain('SUPER_ADMIN');
  });

  it('shows actions only for users the actor can manage (not self, not Super Admin)', async () => {
    setup();
    await openPage();
    expect(within(rowOf('Owner Person')).queryByRole('button')).toBeNull();
    expect(within(rowOf('Asha Patil')).queryByRole('button')).toBeNull();
    const r = within(rowOf('Ravi Kumar'));
    expect(r.getByRole('button', { name: 'Edit Ravi Kumar' })).toBeInTheDocument();
    expect(r.getByRole('button', { name: 'Reset password for Ravi Kumar' })).toBeInTheDocument();
    expect(r.getByRole('button', { name: 'Deactivate Ravi Kumar' })).toBeInTheDocument();
  });

  it('shows 422 field errors under the fields on create', async () => {
    const { calls } = setup({
      'POST /api/v1/users': () =>
        apiError(422, 'VALIDATION_ERROR', 'Some fields are invalid.', {
          loginId: 'Login ID is already taken.',
        }),
    });
    await openPage();
    const ue = userEvent.setup();
    await ue.click(screen.getByRole('button', { name: '＋ Add User' }));
    const d = within(screen.getByRole('dialog'));
    await ue.type(d.getByLabelText('Login ID'), 'new.user');
    await ue.type(d.getByLabelText('Full Name'), 'New User');
    await ue.selectOptions(d.getByLabelText('Role'), 'LEAD');
    await ue.selectOptions(d.getByLabelText('Department'), 'Sales');
    await ue.click(d.getByRole('checkbox', { name: 'Sawardari' }));
    await ue.type(d.getByLabelText('Temporary Password'), 'Temp#Pass2026');
    await ue.click(d.getByRole('button', { name: 'Create User' }));
    expect(await d.findByText('Login ID is already taken.')).toBeInTheDocument();
    expect(d.getByLabelText('Login ID')).toHaveAttribute('aria-invalid', 'true');
    expect(calls.find((c) => c.method === 'POST' && c.path.endsWith('/users'))?.body).toEqual({
      loginId: 'new.user',
      name: 'New User',
      role: 'LEAD',
      department: 'Sales',
      temporaryPassword: 'Temp#Pass2026',
      unitIds: ['unit-saw'],
      defaultUnitId: 'unit-saw',
    });
  });

  it('PATCH sends If-Match with the version and shows the 409 conflict text', async () => {
    const { calls } = setup({
      'PATCH /api/v1/users/m1': () => apiError(409, 'VERSION_CONFLICT', 'Version mismatch'),
    });
    await openPage();
    const ue = userEvent.setup();
    await ue.click(screen.getByRole('button', { name: 'Edit Ravi Kumar' }));
    const d = within(screen.getByRole('dialog'));
    const nameInput = d.getByLabelText('Full Name');
    await ue.clear(nameInput);
    await ue.type(nameInput, 'Ravi K');
    await ue.click(d.getByRole('button', { name: 'Save Changes' }));
    expect(
      await d.findByText('This user was changed by someone else. Reload and try again.'),
    ).toBeInTheDocument();
    const patch = calls.find((c) => c.method === 'PATCH');
    expect(patch?.headers['If-Match']).toBe('7');
    expect(patch?.body).toEqual({ name: 'Ravi K' });
  });

  it('Deactivate uses a confirm modal (Escape cancels) and PATCHes status', async () => {
    const saved: User = { ...member, status: 'INACTIVE', version: 8 };
    const { calls } = setup({ 'PATCH /api/v1/users/m1': () => json(200, { data: saved }) });
    await openPage();
    const ue = userEvent.setup();
    await ue.click(screen.getByRole('button', { name: 'Deactivate Ravi Kumar' }));
    expect(screen.getByRole('dialog', { name: 'Deactivate User' })).toBeInTheDocument();
    await ue.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    await ue.click(screen.getByRole('button', { name: 'Deactivate Ravi Kumar' }));
    await ue.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Deactivate' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const patch = calls.find((c) => c.method === 'PATCH');
    expect(patch?.body).toEqual({ status: 'INACTIVE' });
    expect(patch?.headers['If-Match']).toBe('7');
    expect(await screen.findByText('ravi is now inactive.')).toBeInTheDocument();
  });

  it('Reset Password requires a policy-compliant password', async () => {
    const { calls } = setup({ 'POST /api/v1/users/m1/reset-password': () => json(204) });
    await openPage();
    const ue = userEvent.setup();
    await ue.click(screen.getByRole('button', { name: 'Reset password for Ravi Kumar' }));
    const d = within(screen.getByRole('dialog', { name: 'Reset Password' }));
    const submit = d.getByRole('button', { name: 'Reset Password' });
    await ue.type(d.getByLabelText('Temporary Password'), 'short');
    expect(submit).toBeDisabled();
    await ue.clear(d.getByLabelText('Temporary Password'));
    await ue.type(d.getByLabelText('Temporary Password'), 'Temp#Pass2026');
    await ue.click(submit);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls.find((c) => c.path.endsWith('/reset-password'))?.body).toEqual({
      temporaryPassword: 'Temp#Pass2026',
    });
  });

  it('filters and search are sent as query parameters', async () => {
    const { calls } = setup();
    await openPage();
    const ue = userEvent.setup();
    await ue.selectOptions(screen.getByLabelText('Filter by role'), 'LEAD');
    await ue.selectOptions(screen.getByLabelText('Filter by status'), 'INACTIVE');
    await ue.type(screen.getByLabelText('Search users'), 'ravi');
    await waitFor(() => {
      const last = calls.filter((c) => c.path.endsWith('/users')).at(-1);
      expect(last?.url).toContain('q=ravi');
      expect(last?.url).toContain('role=LEAD');
      expect(last?.url).toContain('status=INACTIVE');
      expect(last?.url).toContain('page=1');
    });
  });
});
