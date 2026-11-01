// Department Master: columns incl. Users, Administration protected, Add/Edit/Delete modals with
// If-Match, 409 DUPLICATE / IN_USE / VERSION_CONFLICT and 422 messages, buttons follow /me/permissions.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  apiError,
  countCalls,
  json,
  makeUser,
  permissionsRoute,
  renderApp,
  signedIn,
  type Handler,
} from '../../test/helpers';
import type { Department } from '../../types';

const admin = makeUser({ role: 'SUPER_ADMIN', roleLabel: 'Super Admin', department: null });

const depts: Department[] = [
  {
    id: 'd1',
    code: 'ADMI',
    name: 'Administration',
    head: 'Administration Head',
    status: 'ACTIVE',
    userCount: 2,
    version: 1,
  },
  {
    id: 'd2',
    code: 'SALE',
    name: 'Sales',
    head: 'Sales Head',
    status: 'ACTIVE',
    userCount: 5,
    version: 4,
  },
  {
    id: 'd3',
    code: 'QUAL',
    name: 'Quality',
    head: null,
    status: 'INACTIVE',
    userCount: 0,
    version: 2,
  },
];

function setup(routes: Record<string, Handler> = {}) {
  return signedIn(admin, {
    'GET /api/v1/departments': () => json(200, { data: depts }),
    ...routes,
  });
}

async function open() {
  renderApp('/m/admin-departments');
  await screen.findByRole('heading', { name: 'Department Master' });
  await screen.findByText('SALE');
}

const rowOf = (name: string): HTMLElement => {
  const cell = within(screen.getByRole('table')).getByText(name, { selector: 'td' });
  const tr = cell.closest('tr');
  if (!tr) throw new Error('no row');
  return tr;
};

describe('DepartmentMasterPage', () => {
  it('renders Code, Name, Head, Status, Users, Action', async () => {
    setup();
    await open();
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Code',
      'Name',
      'Head',
      'Status',
      'Users',
      'Action',
    ]);
    expect(within(rowOf('Sales')).getByText('5')).toBeInTheDocument();
    expect(within(rowOf('Quality')).getByText('Inactive')).toBeInTheDocument();
  });

  it('Administration has Edit but no Delete', async () => {
    setup();
    await open();
    const r = within(rowOf('Administration'));
    expect(r.getByRole('button', { name: 'Edit Administration' })).toBeInTheDocument();
    expect(r.queryByRole('button', { name: /Delete/ })).toBeNull();
    expect(
      within(rowOf('Sales')).getByRole('button', { name: 'Delete Sales' }),
    ).toBeInTheDocument();
  });

  it('hides Add/Edit/Delete without the controls permission', async () => {
    setup({ 'GET /api/v1/me/permissions': permissionsRoute({ view: true }) });
    await open();
    expect(screen.queryByRole('button', { name: '＋ Add Department' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Edit / })).toBeNull();
  });

  it('Add posts the form, uppercases the code, refreshes the menu, and shows 409 DUPLICATE', async () => {
    let n = 0;
    const { calls } = setup({
      'POST /api/v1/departments': () =>
        ++n === 1
          ? apiError(409, 'DUPLICATE', 'A department with this code already exists.')
          : json(201, { data: { ...depts[1], id: 'd9', code: 'LOGI', name: 'Logistics' } }),
    });
    await open();
    const ue = userEvent.setup();
    await ue.click(screen.getByRole('button', { name: '＋ Add Department' }));
    const d = within(screen.getByRole('dialog', { name: 'Add Department' }));
    await ue.type(d.getByLabelText('Code'), 'logi');
    await ue.type(d.getByLabelText('Name'), 'Logistics');
    await ue.click(d.getByRole('button', { name: 'Create Department' }));
    expect(await d.findByRole('alert')).toHaveTextContent(
      'A department with this code already exists.',
    );
    const menuCallsBefore = countCalls(calls, 'GET', '/me/menu');
    await ue.click(d.getByRole('button', { name: 'Create Department' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls.find((c) => c.method === 'POST' && c.path.endsWith('/departments'))?.body).toEqual(
      {
        code: 'LOGI',
        name: 'Logistics',
        head: null,
      },
    );
    await waitFor(() =>
      expect(countCalls(calls, 'GET', '/me/menu')).toBeGreaterThan(menuCallsBefore),
    );
    expect(await screen.findByText('Department Logistics created.')).toBeInTheDocument();
  });

  it('validates locally and shows 422 field errors from the server', async () => {
    const { calls } = setup({
      'POST /api/v1/departments': () =>
        apiError(422, 'VALIDATION_ERROR', 'Some fields are invalid.', { name: 'Name is taken.' }),
    });
    await open();
    const ue = userEvent.setup();
    await ue.click(screen.getByRole('button', { name: '＋ Add Department' }));
    const d = within(screen.getByRole('dialog'));
    await ue.type(d.getByLabelText('Code'), 'X');
    await ue.click(d.getByRole('button', { name: 'Create Department' }));
    expect(d.getByText('Code: 2–10 capital letters or digits.')).toBeInTheDocument();
    expect(countCalls(calls, 'POST', '/departments')).toBe(0);
    await ue.type(d.getByLabelText('Code'), 'Y');
    await ue.type(d.getByLabelText('Name'), 'Xy dept');
    await ue.click(d.getByRole('button', { name: 'Create Department' }));
    expect(await d.findByText('Name is taken.')).toBeInTheDocument();
    expect(d.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true');
  });

  it('Edit PATCHes changed fields with If-Match and shows VERSION_CONFLICT text', async () => {
    const { calls } = setup({
      'PATCH /api/v1/departments/d2': () => apiError(409, 'VERSION_CONFLICT', 'stale'),
    });
    await open();
    const ue = userEvent.setup();
    await ue.click(screen.getByRole('button', { name: 'Edit Sales' }));
    const d = within(screen.getByRole('dialog'));
    await ue.selectOptions(d.getByLabelText('Status'), 'INACTIVE');
    await ue.click(d.getByRole('button', { name: 'Save Changes' }));
    expect(await d.findByRole('alert')).toHaveTextContent(
      'This record was changed by someone else. Reload and try again.',
    );
    const patch = calls.find((c) => c.method === 'PATCH');
    expect(patch?.headers['If-Match']).toBe('4');
    expect(patch?.body).toEqual({ status: 'INACTIVE' });
  });

  it('Administration edit locks Name and Status', async () => {
    setup();
    await open();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Edit Administration' }));
    const d = within(screen.getByRole('dialog'));
    expect(d.getByLabelText('Name')).toBeDisabled();
    expect(d.getByLabelText('Status')).toBeDisabled();
  });

  it('Delete confirms in a modal and explains 409 IN_USE', async () => {
    setup({
      'DELETE /api/v1/departments/d2': () => apiError(409, 'IN_USE', 'Department is in use.'),
    });
    await open();
    const ue = userEvent.setup();
    await ue.click(screen.getByRole('button', { name: 'Delete Sales' }));
    const d = within(screen.getByRole('dialog', { name: 'Delete Department' }));
    await ue.click(d.getByRole('button', { name: 'Delete' }));
    expect(await d.findByRole('alert')).toHaveTextContent(
      'This department has 5 users. Move them first or deactivate the department.',
    );
  });

  it('Delete succeeds with If-Match and closes', async () => {
    const { calls } = setup({ 'DELETE /api/v1/departments/d3': () => json(204) });
    await open();
    const ue = userEvent.setup();
    await ue.click(screen.getByRole('button', { name: 'Delete Quality' }));
    await ue.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls.find((c) => c.method === 'DELETE')?.headers['If-Match']).toBe('2');
  });
});
