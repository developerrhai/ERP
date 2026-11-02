// Phase 3 User Master: Units column, unit filter, and the Units checkbox list + Default unit in
// the Add/Edit modal (at least one unit for Manager/Lead/Member; Admins have all units).
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  DEPARTMENTS,
  json,
  makeUser,
  ROLES_FOR_ADMIN,
  renderApp,
  signedIn,
  type Handler,
} from '../../test/helpers';
import type { User } from '../../types';

const owner = makeUser({ id: 'sa', role: 'SUPER_ADMIN', roleLabel: 'Super Admin', name: 'Owner' });
const admin = makeUser({ id: 'a2', name: 'Asha Patil', role: 'ADMIN', roleLabel: 'Admin' });
const lead = makeUser({
  id: 'l1',
  name: 'Lata Shinde',
  loginId: 'lata',
  role: 'LEAD',
  roleLabel: 'Lead',
  department: 'Production',
  version: 3,
  unitIds: ['unit-tal', 'unit-saw'],
  defaultUnitId: 'unit-saw',
});

const ownerRoles = ROLES_FOR_ADMIN.map((r) => ({ ...r, canManage: r.code !== 'SUPER_ADMIN' }));

function setup(extra: Record<string, Handler> = {}) {
  return signedIn(owner, {
    'GET /api/v1/meta/roles': () => json(200, { data: ownerRoles }),
    'GET /api/v1/meta/departments': () => json(200, { data: DEPARTMENTS }),
    'GET /api/v1/users': () =>
      json(200, { data: [admin, lead], meta: { page: 1, size: 20, total: 2 } }),
    ...extra,
  });
}

async function openPage() {
  renderApp('/m/admin-users');
  await screen.findByText('Lata Shinde');
  // The unit names come from the working context.
  await waitFor(() => expect(screen.getByText('Talwade, Sawardari')).toBeInTheDocument());
}

const rowOf = (name: string): HTMLElement => {
  const row = within(screen.getByRole('table')).getByText(name).closest('tr');
  if (!row) throw new Error(`no row for ${name}`);
  return row;
};

const usersPost = (calls: { method: string; path: string; body: unknown }[]) =>
  calls.find((c) => c.method === 'POST' && c.path.endsWith('/users'));

describe('User Master units', () => {
  it('shows a Units column (All units for admins) and filters by unit', async () => {
    const { calls } = setup();
    await openPage();
    expect(within(rowOf('Asha Patil')).getByText('All units')).toBeInTheDocument();
    const filter = screen.getByLabelText('Filter by unit');
    expect(
      within(filter)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['All Units', 'Talwade', 'Sawardari', 'Varale']);
    await userEvent.setup().selectOptions(filter, 'unit-var');
    await waitFor(() =>
      expect(calls.filter((c) => c.path.endsWith('/users')).at(-1)?.url).toContain(
        'unitId=unit-var',
      ),
    );
  });

  it('a Member needs at least one unit; the default must be one of them', async () => {
    const created: User = { ...lead, id: 'n1', loginId: 'neha', name: 'Neha More' };
    const { calls } = setup({ 'POST /api/v1/users': () => json(201, { data: created }) });
    await openPage();
    const ue = userEvent.setup();
    await ue.click(screen.getByRole('button', { name: '＋ Add User' }));
    const d = within(screen.getByRole('dialog', { name: 'Add User' }));
    await ue.type(d.getByLabelText('Login ID'), 'neha');
    await ue.type(d.getByLabelText('Full Name'), 'Neha More');
    await ue.selectOptions(d.getByLabelText('Role'), 'MEMBER');
    await ue.selectOptions(d.getByLabelText('Department'), 'Sales');
    await ue.type(d.getByLabelText('Temporary Password'), 'Temp#Pass2026');
    expect(d.getByLabelText('Default unit')).toBeDisabled();
    await ue.click(d.getByRole('button', { name: 'Create User' }));
    expect(d.getByText('Choose at least one unit.')).toBeInTheDocument();
    expect(usersPost(calls)).toBeUndefined();

    await ue.click(d.getByRole('checkbox', { name: 'Talwade' }));
    await ue.click(d.getByRole('checkbox', { name: 'Varale' }));
    const def = d.getByLabelText('Default unit');
    expect(
      within(def)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Select default unit', 'Talwade', 'Varale']);
    await ue.click(d.getByRole('button', { name: 'Create User' }));
    expect(d.getByText('Choose the default unit.')).toBeInTheDocument();
    await ue.selectOptions(def, 'unit-var');
    await ue.click(d.getByRole('button', { name: 'Create User' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(usersPost(calls)?.body).toMatchObject({
      role: 'MEMBER',
      unitIds: ['unit-tal', 'unit-var'],
      defaultUnitId: 'unit-var',
    });
  });

  it('an Admin gets all units implicitly: no unit list and no unitIds sent', async () => {
    const { calls } = setup({ 'POST /api/v1/users': () => json(201, { data: admin }) });
    await openPage();
    const ue = userEvent.setup();
    await ue.click(screen.getByRole('button', { name: '＋ Add User' }));
    const d = within(screen.getByRole('dialog', { name: 'Add User' }));
    await ue.type(d.getByLabelText('Login ID'), 'adm2');
    await ue.type(d.getByLabelText('Full Name'), 'Second Admin');
    await ue.selectOptions(d.getByLabelText('Role'), 'ADMIN');
    await ue.selectOptions(d.getByLabelText('Department'), 'Administration');
    await ue.type(d.getByLabelText('Temporary Password'), 'Temp#Pass2026');
    expect(d.queryByRole('checkbox', { name: 'Talwade' })).toBeNull();
    expect(d.getByText('Admins work in all units.')).toBeInTheDocument();
    await ue.click(d.getByRole('button', { name: 'Create User' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const body = usersPost(calls)?.body;
    expect(body).not.toHaveProperty('unitIds');
    expect(body).not.toHaveProperty('defaultUnitId');
  });

  it('Edit pre-fills the units and PATCHes only unit changes', async () => {
    const { calls } = setup({
      'PATCH /api/v1/users/l1': () => json(200, { data: { ...lead, version: 4 } }),
    });
    await openPage();
    const ue = userEvent.setup();
    await ue.click(screen.getByRole('button', { name: 'Edit Lata Shinde' }));
    const d = within(screen.getByRole('dialog'));
    expect(d.getByRole('checkbox', { name: 'Talwade' })).toBeChecked();
    expect(d.getByRole('checkbox', { name: 'Sawardari' })).toBeChecked();
    expect(d.getByRole('checkbox', { name: 'Varale' })).not.toBeChecked();
    expect(d.getByLabelText('Default unit')).toHaveValue('unit-saw');
    // Unticking the default unit leaves Talwade as the only (and so default) unit.
    await ue.click(d.getByRole('checkbox', { name: 'Sawardari' }));
    expect(d.getByLabelText('Default unit')).toHaveValue('unit-tal');
    await ue.click(d.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const patch = calls.find((c) => c.method === 'PATCH');
    expect(patch?.headers['If-Match']).toBe('3');
    expect(patch?.body).toEqual({ unitIds: ['unit-tal'], defaultUnitId: 'unit-tal' });
  });
});
