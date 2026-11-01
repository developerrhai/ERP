// Permission Master: locked Super Admin row, non-editable rows disabled with a tooltip, protected
// Admin Controls, per-row Save (PUT + If-Match = max row version), family overrides, 409 messages,
// and the Department Access matrix (Administration locked, Save per department).
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  apiError,
  countCalls,
  json,
  makeUser,
  renderApp,
  signedIn,
  type Handler,
} from '../../test/helpers';
import { ACTIONS, type PermissionRow, type RolePermissions } from '../../types';
import { ADMIN_CONTROLS_TITLE, NOT_EDITABLE_TITLE } from './PermissionMasterPage';

const admin = makeUser({ role: 'ADMIN', roleLabel: 'Admin' });

function row(
  resource: string,
  on: string[],
  scope: PermissionRow['scope'],
  version: number,
): PermissionRow {
  const r = { resource, scope, version } as PermissionRow;
  for (const a of ACTIONS) r[a] = on.includes(a);
  return r;
}

/** A family row as the API sends it: only the listed cells are set, the rest are null (inherit). */
function partialRow(
  resource: string,
  cells: Partial<Record<(typeof ACTIONS)[number], boolean>>,
  version: number,
): PermissionRow {
  const r = { resource, scope: null, version } as PermissionRow;
  for (const a of ACTIONS) r[a] = cells[a] ?? null;
  return r;
}

const FAMILIES = ['Executive', 'CRM', 'Sales', 'Administration'];

const roles: RolePermissions[] = [
  { role: 'ADMIN', editable: false, rows: [row('*', [...ACTIONS], 'ALL', 1)] },
  {
    role: 'MANAGER',
    editable: true,
    rows: [
      row('*', ['view', 'add', 'edit', 'delete', 'approve', 'export'], 'DEPARTMENT', 3),
      row('family:Administration', [], 'DEPARTMENT', 7),
    ],
  },
  {
    role: 'LEAD',
    editable: true,
    rows: [
      row('*', ['view', 'add', 'edit', 'export'], 'DEPARTMENT', 2),
      partialRow('family:CRM', { approve: true }, 4),
    ],
  },
  { role: 'MEMBER', editable: true, rows: [row('*', ['view', 'add', 'edit'], 'OWN', 1)] },
];

function setup(routes: Record<string, Handler> = {}) {
  return signedIn(admin, {
    'GET /api/v1/permissions': () => json(200, { data: { roles, families: FAMILIES } }),
    ...routes,
  });
}

const rowFor = (label: string): HTMLElement => {
  const table = screen.getAllByRole('table')[0] as HTMLElement;
  const tr = within(table).getByText(label, { selector: 'td' }).closest('tr');
  if (!tr) throw new Error('no row');
  return tr;
};

async function open(path = '/m/admin-permissions') {
  renderApp(path);
  await screen.findByRole('heading', { name: 'Permission Master' });
  await screen.findByText('Manager', { selector: 'td' });
}

describe('PermissionMasterPage — Role Permissions', () => {
  it('shows Super Admin as a locked "All permissions (owner)" row', async () => {
    setup();
    await open();
    const sa = within(rowFor('Super Admin'));
    expect(sa.getByText('All permissions (owner)')).toBeInTheDocument();
    for (const cb of sa.getAllByRole('checkbox')) {
      expect(cb).toBeChecked();
      expect(cb).toBeDisabled();
    }
  });

  it('disables rows the actor may not edit, with a tooltip', async () => {
    setup();
    await open();
    const adminRow = rowFor('Admin');
    expect(adminRow).toHaveAttribute('title', NOT_EDITABLE_TITLE);
    expect(within(adminRow).getByLabelText('Admin scope')).toBeDisabled();
    expect(within(adminRow).getByRole('button', { name: 'Save Admin' })).toBeDisabled();
    expect(within(rowFor('Manager')).getByLabelText('Manager View')).toBeEnabled();
  });

  it("keeps an Admin's Controls checkbox on and locked", async () => {
    setup();
    await open();
    const cb = screen.getByLabelText('Admin Controls');
    expect(cb).toBeChecked();
    expect(cb).toBeDisabled();
    expect(cb).toHaveAttribute('title', ADMIN_CONTROLS_TITLE);
  });

  it('Save sends the role rows with If-Match = highest row version and refreshes the menu', async () => {
    const { calls } = setup({ 'PUT /api/v1/permissions/MANAGER': () => json(200, { data: {} }) });
    await open();
    const ue = userEvent.setup();
    const save = within(rowFor('Manager')).getByRole('button', { name: 'Save Manager' });
    expect(save).toBeDisabled();
    await ue.click(screen.getByLabelText('Manager Delete'));
    await ue.selectOptions(screen.getByLabelText('Manager scope'), 'OWN');
    const menuBefore = countCalls(calls, 'GET', '/me/menu');
    await ue.click(save);
    await screen.findByText('Manager permissions saved.');
    const put = calls.find((c) => c.method === 'PUT');
    expect(put?.headers['If-Match']).toBe('7');
    expect(put?.body).toEqual({
      rows: [
        {
          resource: '*',
          scope: 'OWN',
          view: true,
          add: true,
          edit: true,
          delete: false,
          approve: true,
          export: true,
          controls: false,
        },
        {
          resource: 'family:Administration',
          scope: 'DEPARTMENT',
          view: false,
          add: false,
          edit: false,
          delete: false,
          approve: false,
          export: false,
          controls: false,
        },
      ],
    });
    await waitFor(() => expect(countCalls(calls, 'GET', '/me/menu')).toBeGreaterThan(menuBefore));
  });

  it('shows 409 VERSION_CONFLICT and 409 PROTECTED messages for the role', async () => {
    let n = 0;
    setup({
      'PUT /api/v1/permissions/LEAD': () =>
        ++n === 1
          ? apiError(409, 'VERSION_CONFLICT', 'stale')
          : apiError(409, 'PROTECTED', 'This permission is protected.'),
    });
    await open();
    const ue = userEvent.setup();
    await ue.click(screen.getByLabelText('Lead Approve'));
    await ue.click(screen.getByRole('button', { name: 'Save Lead' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Lead: This record was changed by someone else. Reload and try again.',
    );
    await ue.click(screen.getByRole('button', { name: 'Save Lead' }));
    expect(await screen.findByText('Lead: This permission is protected.')).toBeInTheDocument();
  });

  it('family overrides cycle inherit → allow → deny and are saved as family rows', async () => {
    const { calls } = setup({ 'PUT /api/v1/permissions/MEMBER': () => json(200, { data: {} }) });
    await open();
    const ue = userEvent.setup();
    await ue.click(screen.getByRole('button', { name: /Member — 0 overrides/ }));
    const cell = screen.getByRole('button', { name: /Member CRM Delete: inherited \(denied\)/ });
    expect(cell).toHaveClass('perm-cell', 'inherit');
    await ue.click(cell);
    expect(screen.getByRole('button', { name: 'Member CRM Delete: allowed' })).toHaveClass('allow');
    await ue.click(screen.getByRole('button', { name: 'Member CRM Delete: allowed' }));
    await ue.click(screen.getByRole('button', { name: 'Member CRM Delete: denied' }));
    expect(screen.getByRole('button', { name: /Member CRM Delete: inherited/ })).toHaveClass(
      'inherit',
    );
    await ue.click(screen.getByRole('button', { name: /Member Sales View: inherited/ }));
    await ue.click(screen.getByRole('button', { name: 'Member Sales View: allowed' }));
    expect(screen.getByRole('button', { name: /Member — 1 override$/ })).toBeInTheDocument();
    await ue.click(screen.getByRole('button', { name: 'Save Member' }));
    await screen.findByText('Member permissions saved.');
    const body = calls.find((c) => c.method === 'PUT')?.body as {
      rows: { resource: string; view: boolean | null; add: boolean | null }[];
    };
    expect(body.rows.map((r) => r.resource)).toEqual(['*', 'family:Sales']);
    // Inherited cells are sent as null; only the explicit deny on Sales/view is set.
    expect(body.rows[1]).toMatchObject({ view: false, add: null, controls: null });
  });

  it('null cells from the API show as inherited and are sent back as null', async () => {
    const { calls } = setup({ 'PUT /api/v1/permissions/LEAD': () => json(200, { data: {} }) });
    await open('/m/admin-permissions?role=LEAD');
    expect(screen.getByRole('button', { name: 'Lead CRM Approve: allowed' })).toHaveClass('allow');
    expect(screen.getByRole('button', { name: 'Lead CRM View: inherited (allowed)' })).toHaveClass(
      'inherit',
    );
    const ue = userEvent.setup();
    await ue.click(screen.getByLabelText('Lead Export'));
    await ue.click(screen.getByRole('button', { name: 'Save Lead' }));
    await screen.findByText('Lead permissions saved.');
    const put = calls.find((c) => c.method === 'PUT');
    expect(put?.headers['If-Match']).toBe('4');
    expect(put?.body).toEqual({
      rows: [
        {
          resource: '*',
          scope: 'DEPARTMENT',
          view: true,
          add: true,
          edit: true,
          delete: false,
          approve: false,
          export: false,
          controls: false,
        },
        {
          resource: 'family:CRM',
          scope: null,
          view: null,
          add: null,
          edit: null,
          delete: null,
          approve: true,
          export: null,
          controls: null,
        },
      ],
    });
  });

  it('?role= opens that role overrides and highlights its row', async () => {
    setup();
    await open('/m/admin-permissions?role=LEAD');
    expect(rowFor('Lead')).toHaveClass('perm-focus');
    expect(screen.getByRole('button', { name: /Lead — 1 override$/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('non-editable roles cannot change override cells', async () => {
    setup();
    await open();
    await userEvent.setup().click(screen.getByRole('button', { name: /Admin — 0 overrides/ }));
    expect(screen.getByRole('button', { name: /Admin CRM View: inherited/ })).toBeDisabled();
  });
});

describe('PermissionMasterPage — Department Access', () => {
  const access = {
    departments: [
      { name: 'Administration', families: FAMILIES },
      { name: 'Sales', families: ['Executive', 'Sales'] },
    ],
    families: FAMILIES,
  };

  it('locks Administration to all families and saves per department', async () => {
    const { calls } = setup({
      'GET /api/v1/department-access': () => json(200, { data: access }),
      'PUT /api/v1/department-access/Sales': () => json(200, { data: {} }),
    });
    renderApp('/m/admin-permissions?tab=access');
    const adminCrm = await screen.findByLabelText('Administration — CRM');
    expect(adminCrm).toBeChecked();
    expect(adminCrm).toBeDisabled();
    const ue = userEvent.setup();
    const save = screen.getByRole('button', { name: 'Save Sales' });
    expect(save).toBeDisabled();
    await ue.click(screen.getByLabelText('Sales — CRM'));
    await ue.click(save);
    await screen.findByText('Menu access for Sales saved.');
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({
      families: ['Executive', 'CRM', 'Sales'],
    });
  });

  it('shows the server error for a department', async () => {
    setup({
      'GET /api/v1/department-access': () => json(200, { data: access }),
      'PUT /api/v1/department-access/Sales': () =>
        apiError(422, 'VALIDATION_ERROR', 'Unknown family.'),
    });
    renderApp('/m/admin-permissions?tab=access');
    const ue = userEvent.setup();
    await ue.click(await screen.findByLabelText('Sales — Executive'));
    await ue.click(screen.getByRole('button', { name: 'Save Sales' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Sales: Unknown family.');
  });

  it('is read-only without the controls permission', async () => {
    setup({
      'GET /api/v1/department-access': () => json(200, { data: access }),
      'GET /api/v1/me/permissions': (c) =>
        json(200, {
          data: {
            pageId: new URL(c.url, 'http://t').searchParams.get('pageId'),
            actions: {
              view: true,
              add: false,
              edit: false,
              delete: false,
              approve: false,
              export: false,
              controls: false,
            },
            scope: 'ALL',
          },
        }),
    });
    renderApp('/m/admin-permissions?tab=access');
    expect(await screen.findByLabelText('Sales — CRM')).toBeDisabled();
  });
});
