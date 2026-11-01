// Role Master (read-only list with "can be created by" and a Permissions shortcut), System Setup
// (9 prototype tiles, unbuilt ones disabled with their phase) and the Access denied guard.
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { json, makeUser, permissionsRoute, renderApp, signedIn } from '../../test/helpers';
import type { RoleInfo } from '../../types';

const owner = makeUser({ role: 'SUPER_ADMIN', roleLabel: 'Super Admin', department: null });
const roles: RoleInfo[] = [
  { code: 'MEMBER', label: 'Member', level: 20, userCount: 12, canManage: true },
  { code: 'SUPER_ADMIN', label: 'Super Admin', level: 100, userCount: 1, canManage: false },
  { code: 'ADMIN', label: 'Admin', level: 80, userCount: 2, canManage: true },
  { code: 'MANAGER', label: 'Manager', level: 60, userCount: 4, canManage: true },
  { code: 'LEAD', label: 'Lead', level: 40, userCount: 6, canManage: true },
];

describe('RoleMasterPage', () => {
  it('lists the 5 roles by level with users and who can create them', async () => {
    signedIn(owner, { 'GET /api/v1/roles': () => json(200, { data: roles }) });
    renderApp('/m/admin-roles');
    await screen.findByText('Manager');
    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
    expect(rows.map((r) => r.firstElementChild?.textContent)).toEqual([
      'Super Admin',
      'Admin',
      'Manager',
      'Lead',
      'Member',
    ]);
    expect(
      within(rows[0] as HTMLElement).getByText('Nobody (the owner, created by setup)'),
    ).toBeInTheDocument();
    expect(
      within(rows[1] as HTMLElement).getByText('Super Admin', { selector: 'td:nth-child(4)' }),
    ).toBeInTheDocument();
    expect(within(rows[4] as HTMLElement).getByText('12')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add/ })).toBeNull();
  });

  it('Permissions opens Permission Master for that role', async () => {
    signedIn(owner, {
      'GET /api/v1/roles': () => json(200, { data: roles }),
      'GET /api/v1/permissions': () => json(200, { data: { roles: [], families: [] } }),
    });
    renderApp('/m/admin-roles');
    await userEvent
      .setup()
      .click(await screen.findByRole('button', { name: 'Permissions for Manager' }));
    expect(await screen.findByRole('heading', { name: 'Permission Master' })).toBeInTheDocument();
  });
});

describe('SystemSetupPage', () => {
  it('shows the 9 prototype tiles; unbuilt ones are disabled with a phase badge', async () => {
    signedIn(owner);
    renderApp('/m/admin-settings');
    await screen.findByRole('heading', { name: 'System Setup & Controls' });
    const tiles = screen.getAllByRole('button').filter((b) => b.classList.contains('master'));
    expect(tiles.map((t) => t.querySelector('b')?.textContent)).toEqual([
      'System Controls',
      'Company Master',
      'Branch Master',
      'Department Master',
      'User Master',
      'Role Master',
      'Permission Master',
      'Approval Matrix',
      'Letterhead & PDF',
    ]);
    const company = tiles[1] as HTMLElement;
    expect(company).toBeDisabled();
    expect(within(company).getByText('Phase 3')).toBeInTheDocument();
    expect(within(tiles[7] as HTMLElement).getByText('Phase 6')).toBeInTheDocument();
    expect(tiles[0]).toBeEnabled();
    expect(
      within(tiles[0] as HTMLElement).getByText(
        'Enable modules, owner department, approvals, edit/delete/export.',
      ),
    ).toBeInTheDocument();
  });

  it('System Controls tile opens the System Control Center', async () => {
    signedIn(owner, { 'GET /api/v1/module-controls': () => json(200, { data: [] }) });
    renderApp('/m/admin-settings');
    await userEvent.setup().click(await screen.findByRole('button', { name: /System Controls/ }));
    expect(
      await screen.findByRole('heading', { name: 'System Control Center' }),
    ).toBeInTheDocument();
  });

  it('unknown sub-pages are 404', async () => {
    signedIn(owner);
    renderApp('/m/admin-settings/nope');
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });
});

describe('navigation guard', () => {
  it('shows Access denied when /me/permissions has no view', async () => {
    signedIn(owner, { 'GET /api/v1/me/permissions': permissionsRoute({ view: false }) });
    renderApp('/m/admin-audit');
    expect(await screen.findByRole('heading', { name: 'Access denied' })).toBeInTheDocument();
  });
});
