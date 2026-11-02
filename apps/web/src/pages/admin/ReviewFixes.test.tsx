// Phase 2 review fixes: unsaved edits survive other saves and filter changes, the row Save says
// when it includes family overrides, VERSION_CONFLICT offers a Reload of just that record, and the
// audit viewer loads actions from the API and filters users with a typeahead.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  apiError,
  countCalls,
  DEPARTMENTS,
  json,
  makeUser,
  renderApp,
  signedIn,
} from '../../test/helpers';
import { ACTIONS, type Department, type ModuleControl, type PermissionRow } from '../../types';

const owner = makeUser({ role: 'SUPER_ADMIN', roleLabel: 'Super Admin', department: null });

const ctrl = (o: Partial<ModuleControl>): ModuleControl => ({
  pageId: 'crm-leads',
  title: 'Lead Management',
  family: 'CRM',
  enabled: true,
  ownerDepartment: 'Sales',
  approvalRequired: true,
  allowAdd: true,
  allowEdit: true,
  allowDelete: true,
  allowExport: true,
  version: 5,
  ...o,
});

describe('System Control Center keeps unsaved edits', () => {
  const rows = [
    ctrl({}),
    ctrl({ pageId: 'sales-orders', title: 'Sales Orders', family: 'Sales', version: 2 }),
  ];
  const routes = (patch: () => Response) => ({
    'GET /api/v1/module-controls': (c: { url: string }) => {
      const fam = new URL(c.url, 'http://t').searchParams.get('family');
      const q = new URL(c.url, 'http://t').searchParams.get('q');
      let list = fam ? rows.filter((r) => r.family === fam) : rows;
      if (q) list = list.filter((r) => r.title.includes(q));
      return json(200, { data: list });
    },
    'GET /api/v1/meta/departments': () => json(200, { data: DEPARTMENTS }),
    'PATCH /api/v1/module-controls/crm-leads': patch,
  });

  it('saving one row keeps the other row dirty', async () => {
    signedIn(
      owner,
      routes(() => json(200, { data: ctrl({ allowExport: false, version: 6 }) })),
    );
    renderApp('/m/admin-settings/controls');
    const ue = userEvent.setup();
    await ue.click(await screen.findByLabelText('Lead Management Export'));
    await ue.click(screen.getByLabelText('Sales Orders Approval'));
    expect(screen.getByText(/2 unsaved changes/)).toBeInTheDocument();
    await ue.click(screen.getByRole('button', { name: 'Save Lead Management' }));
    await screen.findByText('Lead Management saved.');
    expect(screen.getByLabelText('Sales Orders Approval')).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Save Sales Orders' })).toBeEnabled();
    expect(screen.getByText(/1 unsaved change\b/)).toBeInTheDocument();
  });

  it('keeps drafts across filter changes and says how many are hidden', async () => {
    signedIn(
      owner,
      routes(() => json(200, { data: ctrl({}) })),
    );
    renderApp('/m/admin-settings/controls');
    const ue = userEvent.setup();
    await ue.click(await screen.findByLabelText('Sales Orders Approval'));
    await ue.selectOptions(screen.getByLabelText('Filter by family'), 'CRM');
    await waitFor(() => expect(screen.queryByLabelText('Sales Orders Approval')).toBeNull());
    expect(
      screen.getByText(/1 unsaved change \(1 hidden by the current filter\)/),
    ).toBeInTheDocument();
    await ue.selectOptions(screen.getByLabelText('Filter by family'), '');
    expect(await screen.findByLabelText('Sales Orders Approval')).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Save Sales Orders' })).toBeEnabled();
  });

  it('VERSION_CONFLICT offers Reload, which refetches only that row and keeps other drafts', async () => {
    const { calls } = signedIn(
      owner,
      routes(() => apiError(409, 'VERSION_CONFLICT', 'stale')),
    );
    renderApp('/m/admin-settings/controls');
    const ue = userEvent.setup();
    await ue.click(await screen.findByLabelText('Lead Management Export'));
    await ue.click(screen.getByLabelText('Sales Orders Approval'));
    await ue.click(screen.getByRole('button', { name: 'Save Lead Management' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'Lead Management: This record was changed by someone else. Reload and try again.',
    );
    await ue.click(within(alert).getByRole('button', { name: 'Reload' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    const last = calls.filter((c) => c.path.endsWith('/module-controls')).at(-1);
    expect(last?.url).toContain('q=Lead+Management');
    expect(screen.getByLabelText('Lead Management Export')).toBeChecked();
    expect(screen.getByLabelText('Sales Orders Approval')).not.toBeChecked();
  });
});

function row(resource: string, on: string[], scope: PermissionRow['scope'], version: number) {
  const r = { resource, scope, version } as PermissionRow;
  for (const a of ACTIONS) r[a] = on.includes(a);
  return r;
}

describe('Permission Master keeps unsaved edits', () => {
  const roles = [
    { role: 'MANAGER', editable: true, rows: [row('*', ['view', 'add'], 'DEPARTMENT', 3)] },
    { role: 'LEAD', editable: true, rows: [row('*', ['view'], 'DEPARTMENT', 2)] },
  ];
  const families = ['CRM', 'Sales'];

  it('saving one role keeps the other role draft; row Save mentions pending overrides', async () => {
    signedIn(owner, {
      'GET /api/v1/permissions': () => json(200, { data: { roles, families } }),
      'PUT /api/v1/permissions/MANAGER': () => json(200, { data: {} }),
    });
    renderApp('/m/admin-permissions?role=MANAGER');
    const ue = userEvent.setup();
    await ue.click(await screen.findByLabelText('Lead Export'));
    await ue.click(screen.getByRole('button', { name: /Manager CRM Delete: inherited/ }));
    expect(screen.getByText('includes 1 unsaved family override')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Manager' })).toHaveAccessibleDescription(
      'includes 1 unsaved family override',
    );
    await ue.click(screen.getByRole('button', { name: 'Save Manager' }));
    await screen.findByText('Manager permissions saved.');
    expect(screen.getByLabelText('Lead Export')).toBeChecked();
    expect(screen.getByRole('button', { name: 'Save Lead' })).toBeEnabled();
  });

  it('VERSION_CONFLICT Reload replaces only that role and keeps the other draft', async () => {
    let n = 0;
    signedIn(owner, {
      'GET /api/v1/permissions': () => {
        n += 1;
        const fresh =
          n > 1
            ? [roles[0], { ...roles[1], rows: [row('*', ['view', 'approve'], 'OWN', 9)] }]
            : roles;
        return json(200, { data: { roles: fresh, families } });
      },
      'PUT /api/v1/permissions/LEAD': () => apiError(409, 'VERSION_CONFLICT', 'stale'),
    });
    renderApp('/m/admin-permissions');
    const ue = userEvent.setup();
    await ue.click(await screen.findByLabelText('Manager Delete'));
    await ue.click(screen.getByLabelText('Lead Export'));
    await ue.click(screen.getByRole('button', { name: 'Save Lead' }));
    const alert = await screen.findByRole('alert');
    await ue.click(within(alert).getByRole('button', { name: 'Reload Lead' }));
    await waitFor(() => expect(screen.getByLabelText('Lead Approve')).toBeChecked());
    expect(screen.getByLabelText('Lead Export')).not.toBeChecked();
    expect(screen.getByLabelText('Lead scope')).toHaveValue('OWN');
    expect(screen.getByLabelText('Manager Delete')).toBeChecked();
    expect(screen.getByRole('button', { name: 'Save Manager' })).toBeEnabled();
  });
});

describe('Department Access keeps other unsaved departments', () => {
  it('saving Sales keeps the Purchase edit', async () => {
    signedIn(owner, {
      'GET /api/v1/department-access': () =>
        json(200, {
          data: {
            families: ['Executive', 'CRM'],
            departments: [
              { name: 'Sales', families: ['Executive'] },
              { name: 'Purchase', families: ['Executive'] },
            ],
          },
        }),
      'PUT /api/v1/department-access/Sales': () => json(200, { data: {} }),
    });
    renderApp('/m/admin-permissions?tab=access');
    const ue = userEvent.setup();
    await ue.click(await screen.findByLabelText('Sales — CRM'));
    await ue.click(screen.getByLabelText('Purchase — CRM'));
    await ue.click(screen.getByRole('button', { name: 'Save Sales' }));
    await screen.findByText('Menu access for Sales saved.');
    expect(screen.getByLabelText('Sales — CRM')).toBeChecked();
    expect(screen.getByLabelText('Purchase — CRM')).toBeChecked();
    expect(screen.getByRole('button', { name: 'Save Purchase' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Save Sales' })).toBeDisabled();
  });
});

describe('Department Master conflict reload', () => {
  it('Reload refetches and reopens the edit form on the fresh record', async () => {
    let n = 0;
    const dept = (head: string, version: number): Department => ({
      id: 'd2',
      code: 'SALE',
      name: 'Sales',
      head,
      status: 'ACTIVE',
      userCount: 5,
      version,
    });
    signedIn(owner, {
      'GET /api/v1/departments': () => {
        n += 1;
        return json(200, { data: [n > 1 ? dept('New Head', 8) : dept('Sales Head', 4)] });
      },
      'PATCH /api/v1/departments/d2': () => apiError(409, 'VERSION_CONFLICT', 'stale'),
    });
    renderApp('/m/admin-departments');
    const ue = userEvent.setup();
    await ue.click(await screen.findByRole('button', { name: 'Edit Sales' }));
    const dialog = screen.getByRole('dialog');
    await ue.clear(within(dialog).getByLabelText('Head'));
    await ue.type(within(dialog).getByLabelText('Head'), 'Mine');
    await ue.click(within(dialog).getByRole('button', { name: 'Save Changes' }));
    const alert = await within(dialog).findByRole('alert');
    await ue.click(within(alert).getByRole('button', { name: 'Reload' }));
    await waitFor(() =>
      expect(within(screen.getByRole('dialog')).getByLabelText('Head')).toHaveValue('New Head'),
    );
    expect(within(screen.getByRole('dialog')).queryByRole('alert')).toBeNull();
  });
});

describe('Letterhead conflict reload', () => {
  it('Reload takes the server letterhead and version', async () => {
    let n = 0;
    const value = (companyName: string) => ({
      companyName,
      legalName: '',
      address: '',
      phone: '',
      email: '',
      website: '',
      gstin: '',
      pan: '',
      cin: '',
      footer: '',
      signatory: '',
    });
    const { calls } = signedIn(owner, {
      'GET /api/v1/settings/letterhead': () => {
        n += 1;
        return json(200, { data: { value: value(n > 1 ? 'Server Co' : 'Old Co'), version: n } });
      },
      'PUT /api/v1/settings/letterhead': () => apiError(409, 'VERSION_CONFLICT', 'stale'),
    });
    renderApp('/m/admin-settings/letterhead');
    const ue = userEvent.setup();
    const company = await screen.findByLabelText('Company Name');
    await ue.clear(company);
    await ue.type(company, 'Mine');
    await ue.click(screen.getByRole('button', { name: 'Save Letterhead' }));
    const alert = await screen.findByRole('alert');
    await ue.click(within(alert).getByRole('button', { name: 'Reload' }));
    await waitFor(() => expect(screen.getByLabelText('Company Name')).toHaveValue('Server Co'));
    expect(countCalls(calls, 'GET', '/settings/letterhead')).toBe(2);
  });
});

describe('Audit viewer', () => {
  const routesWith = (actions: () => Response) => ({
    'GET /api/v1/audit-logs': () => json(200, { data: [], meta: { page: 1, size: 25, total: 0 } }),
    'GET /api/v1/audit-logs/actions': actions,
    'GET /api/v1/users': () =>
      json(200, {
        data: [makeUser({ id: 'u7', name: 'Priya Shah', loginId: 'priya' })],
        meta: { page: 1, size: 10, total: 1 },
      }),
  });

  it('loads the action list from GET /audit-logs/actions', async () => {
    signedIn(
      owner,
      routesWith(() => json(200, { data: ['LOGIN_SUCCESS', 'CUSTOM_EVENT'] })),
    );
    renderApp('/m/admin-audit');
    const select = await screen.findByLabelText('Filter by action');
    await waitFor(() =>
      expect(
        within(select)
          .getAllByRole('option')
          .map((o) => o.textContent),
      ).toEqual(['All Actions', 'Login Success', 'Custom Event']),
    );
  });

  it('falls back to the built-in action list on 404', async () => {
    signedIn(
      owner,
      routesWith(() => apiError(404, 'NOT_FOUND', 'x')),
    );
    renderApp('/m/admin-audit');
    const select = await screen.findByLabelText('Filter by action');
    expect(
      within(select).getByRole('option', { name: 'Module Control Updated' }),
    ).toBeInTheDocument();
  });

  it('user typeahead searches GET /users?q= and filters by the picked user', async () => {
    const { calls } = signedIn(
      owner,
      routesWith(() => json(200, { data: [] })),
    );
    renderApp('/m/admin-audit');
    const ue = userEvent.setup();
    await ue.type(await screen.findByRole('combobox', { name: 'Filter by user' }), 'pri');
    await screen.findByRole('option', { name: 'Priya Shah (priya)' });
    await ue.keyboard('{ArrowDown}{Enter}');
    expect(
      await screen.findByRole('button', { name: 'Clear user filter (Priya Shah (priya))' }),
    ).toBeInTheDocument();
    const userCall = calls.filter((c) => c.path.endsWith('/users')).at(-1);
    expect(new URL(userCall?.url ?? '', 'http://t').searchParams.get('q')).toBe('pri');
    await waitFor(() =>
      expect(calls.filter((c) => c.path.endsWith('/audit-logs')).at(-1)?.url).toContain(
        'actorId=u7',
      ),
    );
    await ue.click(screen.getByRole('button', { name: 'Clear user filter (Priya Shah (priya))' }));
    expect(screen.getByRole('combobox', { name: 'Filter by user' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search action, target or details…')).toBeInTheDocument();
  });
});
