// Routing and shell tests: session restore, /login?next= redirect, forced password change,
// department menu filtering, module placeholder, 404, account drawer and cross-tab logout.
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { AUTH_CHANNEL } from './auth/channel';
import { apiError, authOk, json, makeUser, mockFetch, renderApp } from './test/helpers';
import type { User } from './types';

const HEALTH = 'GET /api/v1/health';

function signedInAs(user: User) {
  return mockFetch({
    'POST /api/v1/auth/refresh': () => authOk(user),
    [HEALTH]: () => json(200, { data: { status: 'ok', db: 'ok' } }),
  });
}

const salesMember = makeUser({
  role: 'MEMBER',
  roleLabel: 'Member',
  department: 'Sales',
  name: 'Ravi Kumar',
});

describe('App routing', () => {
  it('redirects a signed-out user to the login page', async () => {
    mockFetch({ 'POST /api/v1/auth/refresh': () => apiError(401, 'UNAUTHENTICATED', 'x') });
    renderApp('/m/crm-leads');
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
  });

  it('restores the session via /auth/refresh and shows the dashboard', async () => {
    const { calls } = signedInAs(salesMember);
    renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Sales Dashboard' })).toBeInTheDocument();
    expect(screen.getByText('Ravi Kumar • Member')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Modules are being enabled phase by phase. Your account and access are active.',
      ),
    ).toBeInTheDocument();
    expect(calls.filter((c) => c.path.endsWith('/auth/refresh'))).toHaveLength(1);
    expect(await screen.findByText(/SYSTEM GREEN/)).toBeInTheDocument();
  });

  it('shows only the department families in the sidebar', async () => {
    signedInAs(salesMember);
    renderApp('/');
    const menu = await screen.findByLabelText('Main menu');
    await screen.findByRole('heading', { name: 'Sales Dashboard' });
    const heads = within(menu)
      .getAllByRole('button', { expanded: true })
      .map((b) => b.textContent?.replace('⌄', '').trim());
    expect(heads).toEqual([
      '▦ Executive',
      '◎ CRM',
      '₹ Sales',
      '🎫 Service / Support',
      '▦ Business Intelligence',
      'AI AI & Automation',
      '✉ Communication',
    ]);
    expect(within(menu).queryByText('Users')).toBeNull();
  });

  it('admins see all 22 families and sections collapse', async () => {
    signedInAs(makeUser());
    renderApp('/');
    const menu = await screen.findByLabelText('Main menu');
    await screen.findByRole('heading', { name: 'Administration Dashboard' });
    expect(within(menu).getAllByRole('button', { expanded: true })).toHaveLength(22);
    const crm = within(menu).getByRole('button', { name: /CRM/ });
    await userEvent.setup().click(crm);
    expect(crm).toHaveAttribute('aria-expanded', 'false');
  });

  it('menu search filters families and items', async () => {
    signedInAs(makeUser());
    renderApp('/');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Search menu'), 'payslip');
    const menu = screen.getByLabelText('Main menu');
    expect(within(menu).getAllByRole('link').length).toBeGreaterThan(0);
    for (const link of within(menu).getAllByRole('link')) {
      expect(link.textContent?.toLowerCase()).toContain('payslip');
    }
  });

  it('other module pages show the later-phase notice; unknown ids show 404', async () => {
    signedInAs(salesMember);
    renderApp('/m/crm-leads');
    expect(await screen.findByRole('heading', { name: 'Lead Management' })).toBeInTheDocument();
    expect(screen.getByText('This module will be enabled in a later phase.')).toBeInTheDocument();
  });

  it('unknown page ids and routes show the 404 card', async () => {
    signedInAs(salesMember);
    renderApp('/m/does-not-exist');
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });

  it('a page the server denies (no view) shows Access denied, even by direct URL', async () => {
    signedInAs(salesMember);
    renderApp('/m/inv-items');
    expect(await screen.findByRole('heading', { name: 'Access denied' })).toBeInTheDocument();
  });

  it('a non-admin in Administration gets access denied on User Master', async () => {
    signedInAs(makeUser({ role: 'MANAGER', roleLabel: 'Manager' }));
    renderApp('/m/admin-users');
    expect(await screen.findByRole('heading', { name: 'Access denied' })).toBeInTheDocument();
    // Seed rules: family:Administration is all-false below ADMIN, so the server menu omits it.
    const menu = screen.getByLabelText('Main menu');
    await within(menu).findByRole('link', { name: 'Lead Management' });
    expect(within(menu).queryByRole('link', { name: 'Users' })).toBeNull();
    expect(within(menu).queryByRole('button', { name: /Administration/ })).toBeNull();
  });

  it('admins see the Users menu item under Administration', async () => {
    signedInAs(makeUser());
    renderApp('/');
    const menu = await screen.findByLabelText('Main menu');
    expect(within(menu).getByRole('link', { name: 'Users' })).toHaveAttribute(
      'href',
      '/m/admin-users',
    );
  });

  it('mustChangePassword shows only the Set a new password screen', async () => {
    const user = makeUser({ mustChangePassword: true, loginId: 'asha' });
    const { calls } = mockFetch({
      'POST /api/v1/auth/refresh': () => authOk(user),
      'POST /api/v1/auth/change-password': () =>
        authOk({ ...user, mustChangePassword: false }, 'tok-2'),
      [HEALTH]: () => json(200, { data: { status: 'ok', db: 'ok' } }),
    });
    renderApp('/m/admin-users');
    expect(await screen.findByRole('heading', { name: 'Set a new password' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Main menu')).toBeNull();
    const ue = userEvent.setup();
    const save = screen.getByRole('button', { name: 'Save New Password' });
    expect(save).toBeDisabled();
    await ue.type(screen.getByLabelText('Current password'), 'Temp#Pass123');
    await ue.type(screen.getByLabelText('New password'), 'asha');
    const hints = screen.getByRole('list', { name: 'Password rules' });
    expect(
      within(hints)
        .getAllByRole('listitem')
        .filter((li) => li.className === 'ok'),
    ).toHaveLength(0);
    await ue.clear(screen.getByLabelText('New password'));
    await ue.type(screen.getByLabelText('New password'), 'Brand#New2026');
    expect(
      within(hints)
        .getAllByRole('listitem')
        .filter((li) => li.className === 'ok'),
    ).toHaveLength(3);
    await ue.type(screen.getByLabelText('Confirm new password'), 'Brand#New202');
    expect(screen.getByText('Passwords do not match.')).toBeInTheDocument();
    expect(save).toBeDisabled();
    await ue.type(screen.getByLabelText('Confirm new password'), '6');
    await ue.click(save);
    expect(await screen.findByRole('heading', { name: 'User Master' })).toBeInTheDocument();
    const call = calls.find((c) => c.path.endsWith('/auth/change-password'));
    expect(call?.body).toEqual({ currentPassword: 'Temp#Pass123', newPassword: 'Brand#New2026' });
  });

  it('account drawer shows the user and signs out', async () => {
    const { calls } = signedInAs(salesMember);
    renderApp('/');
    const ue = userEvent.setup();
    await ue.click(await screen.findByRole('button', { name: 'Account: Ravi Kumar' }));
    const drawer = await screen.findByRole('dialog', { name: 'My Account' });
    expect(within(drawer).getAllByText('asha').length).toBeGreaterThan(0);
    expect(within(drawer).getByText('Sales')).toBeInTheDocument();
    expect(within(drawer).getByText('Member')).toBeInTheDocument();
    expect(
      within(drawer).getByRole('button', { name: 'Sign out of all devices' }),
    ).toBeInTheDocument();
    await ue.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await ue.click(screen.getByRole('button', { name: 'Account: Ravi Kumar' }));
    await ue.click(await screen.findByRole('button', { name: 'Sign Out' }));
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
    expect(calls.some((c) => c.path.endsWith('/auth/logout'))).toBe(true);
  });

  it('a logout broadcast from another tab signs this tab out', async () => {
    signedInAs(salesMember);
    renderApp('/');
    await screen.findByRole('heading', { name: 'Sales Dashboard' });
    const other = new BroadcastChannel(AUTH_CHANNEL);
    await act(async () => {
      other.postMessage({ type: 'logout' });
      await new Promise((r) => setTimeout(r, 20));
    });
    other.close();
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
  });
});
