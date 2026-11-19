import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '../../types';
import { RoleDashboard } from './RoleDashboard';
import { dashboardFor, ROLE_DASHBOARDS, type RoleKey } from './roleDashConfig';

vi.mock('../../lib/homeApi', () => ({
  homeApi: { menu: vi.fn(() => Promise.resolve({ families: [{ name: 'Sales', icon: 's', pages: [{ id: 'a', title: 'A', favourite: false }], badge: null }], prefs: {} })) },
}));
vi.mock('../../lib/workApi', () => ({
  workApi: {
    counts: vi.fn(() => Promise.resolve(({ open: 7, approval: 0, ready: 0, returned: 2, sentWaiting: 1, pendingReceipt: 3, pendingAcceptance: 4, work: 5 }))),
    audit: vi.fn(() => Promise.resolve([{ number: 'SO-1', event: 'FORWARDED', at: '2026-11-20T10:00:00Z', actor: 'Asha', department: 'Sales' }])),
  },
}));
vi.mock('../../lib/projectsApi', () => ({
  projectsApi: { list: vi.fn(() => Promise.resolve({ rows: [{ id: 'p1', project_no: 'PRJ-1', name: 'Line 4', customer_name: 'Acme' }] })) },
}));

const user = (roleCode: string, roleLevel: number): User =>
  ({ id: 'u', loginId: 'x', email: null, name: 'Test User', roleId: 'r', roleCode, roleName: roleCode, roleLevel, role: roleCode, roleLabel: roleCode, department: 'Sales', status: 'ACTIVE', mustChangePassword: false, lastLoginAt: null, createdAt: '', updatedAt: '', version: 1 }) as User;

const home = { user: { name: 'Test User', role: null, department: null }, work: { toReceive: 1, toAccept: 2, inWork: 3, myApprovals: 9, myTasks: 6, returnedToMe: 0, myDrafts: 8, overdue: 0 }, quickCreate: [], shortcuts: [], recent: [], announcements: [], whatsNew: null, landing: 'home', landingPage: 'home' };

describe('role dashboards', () => {
  beforeEach(() => vi.clearAllMocks());

  it('maps every system role, legacy code and role level to a dashboard', () => {
    const codes: [string, number][] = [['SUPER_USER', 99], ['ADMINISTRATOR', 95], ['DIRECTOR', 90], ['CFO', 80], ['GENERAL_MANAGER', 70], ['DEPT_HEAD', 60], ['DEPT_MANAGER', 50], ['SUPERVISOR', 30], ['EMPLOYEE', 10]];
    for (const [c, n] of codes) expect(dashboardFor(c, n).key).toBe(c);
    expect(dashboardFor('SUPER_ADMIN', 100).key).toBe('SUPER_USER');
    expect(dashboardFor('MEMBER', 10).key).toBe('EMPLOYEE');
    expect(dashboardFor('CUSTOM_ROLE', 65).key).toBe('DEPT_HEAD');
    expect(new Set(Object.values(ROLE_DASHBOARDS).map((d) => d.title)).size).toBe(9);
  });

  it.each(Object.keys(ROLE_DASHBOARDS) as RoleKey[])('%s sees its own dashboard', async (key) => {
    const level = { SUPER_USER: 99, ADMINISTRATOR: 95, DIRECTOR: 90, CFO: 80, GENERAL_MANAGER: 70, DEPT_HEAD: 60, DEPT_MANAGER: 50, SUPERVISOR: 30, EMPLOYEE: 10 }[key];
    render(
      <MemoryRouter>
        <RoleDashboard user={user(key, level)} home={home} />
      </MemoryRouter>,
    );
    expect(screen.getAllByText(ROLE_DASHBOARDS[key].title).length).toBeGreaterThan(0);
    expect(screen.getByTestId('role-dashboard').getAttribute('data-role')).toBe(key);
    expect(screen.getByRole('heading', { name: /Test User/ })).toBeTruthy();
    await waitFor(() => expect(screen.getByText(/Open to you now/)).toBeTruthy());
  });

  it('shows real counters and "—" where a number is unavailable', async () => {
    render(
      <MemoryRouter>
        <RoleDashboard user={user('DEPT_HEAD', 60)} home={null} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('To receive').previousSibling?.textContent).toBe('3'));
    expect(screen.getByText('Awaiting my approval').previousSibling?.textContent).toBe('—');
  });
});
