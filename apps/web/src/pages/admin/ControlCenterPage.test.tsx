// System Control Center: prototype columns, family filter / search sent to the API, Administration
// "Enabled" locked, PATCH of changed fields with If-Match, 409 PROTECTED shown, sidebar refreshed.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  apiError,
  countCalls,
  DEPARTMENTS,
  json,
  makeUser,
  permissionsRoute,
  renderApp,
  signedIn,
  type Handler,
} from '../../test/helpers';
import type { ModuleControl } from '../../types';

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

const rows = [
  ctrl({}),
  ctrl({
    pageId: 'admin-users',
    title: 'Users',
    family: 'Administration',
    ownerDepartment: 'Administration',
    approvalRequired: false,
    version: 1,
  }),
];

function setup(routes: Record<string, Handler> = {}) {
  return signedIn(owner, {
    'GET /api/v1/module-controls': () => json(200, { data: rows }),
    'GET /api/v1/meta/departments': () => json(200, { data: DEPARTMENTS }),
    ...routes,
  });
}

async function open() {
  renderApp('/m/admin-settings/controls');
  await screen.findByRole('heading', { name: 'System Control Center' });
  await screen.findByLabelText('Lead Management Enabled');
}

describe('ControlCenterPage', () => {
  it('renders the control columns and locks Administration "Enabled"', async () => {
    setup();
    await open();
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Family',
      'Module',
      'Owner Department',
      'Enabled',
      'Approval',
      'Add',
      'Edit',
      'Delete',
      'Export',
      'Save',
    ]);
    expect(screen.getByLabelText('Users Enabled')).toBeDisabled();
    expect(screen.getByLabelText('Users Approval')).toBeEnabled();
    expect(screen.getByLabelText('Lead Management Enabled')).toBeEnabled();
    expect(
      within(screen.getByLabelText('Lead Management owner department')).getAllByRole('option'),
    ).toHaveLength(11);
  });

  it('PATCHes only changed fields with If-Match, then refreshes the sidebar', async () => {
    const { calls } = setup({
      'PATCH /api/v1/module-controls/crm-leads': () =>
        json(200, { data: ctrl({ enabled: false, ownerDepartment: 'Service', version: 6 }) }),
    });
    await open();
    const ue = userEvent.setup();
    const save = screen.getByRole('button', { name: 'Save Lead Management' });
    expect(save).toBeDisabled();
    await ue.click(screen.getByLabelText('Lead Management Enabled'));
    await ue.selectOptions(screen.getByLabelText('Lead Management owner department'), 'Service');
    const menuBefore = countCalls(calls, 'GET', '/me/menu');
    await ue.click(save);
    await screen.findByText('Lead Management saved.');
    const patch = calls.find((c) => c.method === 'PATCH');
    expect(patch?.headers['If-Match']).toBe('5');
    expect(patch?.body).toEqual({ enabled: false, ownerDepartment: 'Service' });
    await waitFor(() => expect(countCalls(calls, 'GET', '/me/menu')).toBeGreaterThan(menuBefore));
    expect(screen.getByRole('button', { name: 'Save Lead Management' })).toBeDisabled();
  });

  it('shows 409 PROTECTED from the server', async () => {
    setup({
      'PATCH /api/v1/module-controls/admin-users': () =>
        apiError(409, 'PROTECTED', 'Administration modules cannot be disabled.'),
    });
    await open();
    const ue = userEvent.setup();
    await ue.click(screen.getByLabelText('Users Export'));
    await ue.click(screen.getByRole('button', { name: 'Save Users' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Users: Administration modules cannot be disabled.',
    );
  });

  it('sends the family filter and search to the API', async () => {
    const { calls } = setup();
    await open();
    const ue = userEvent.setup();
    await ue.selectOptions(screen.getByLabelText('Filter by family'), 'CRM');
    await ue.type(screen.getByLabelText('Search modules'), 'lead');
    await waitFor(() => {
      const last = calls.filter((c) => c.path.endsWith('/module-controls')).at(-1);
      expect(last?.url).toContain('family=CRM');
      expect(last?.url).toContain('q=lead');
    });
  });

  it('is read-only without the controls permission', async () => {
    setup({ 'GET /api/v1/me/permissions': permissionsRoute({ view: true }) });
    await open();
    expect(screen.getByLabelText('Lead Management Enabled')).toBeDisabled();
    expect(screen.getByLabelText('Lead Management owner department')).toBeDisabled();
  });
});
