import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '../../types';

const counts = vi.fn();
const inbox = vi.fn();
const listInsights = vi.fn();
vi.mock('../../lib/workApi', async (orig) => {
  const real = await orig<typeof import('../../lib/workApi')>();
  return {
    ...real,
    workApi: {
      ...real.workApi,
      departments: () => Promise.resolve([{ id: 'd1', name: 'Sales' }]),
      counts: (d?: string) => counts(d) as Promise<unknown>,
      inbox: (p: unknown) => inbox(p) as Promise<unknown>,
      audit: () => Promise.resolve([]),
    },
  };
});
vi.mock('../../lib/homeApi', () => ({ homeApi: { home: () => Promise.resolve({ work: { myTasks: 7 } }) } }));
vi.mock('../../lib/opsApi', () => ({
  opsApi: { handovers: () => Promise.resolve([]), inside: () => Promise.resolve([{}, {}]), today: () => Promise.resolve({ last: [], counts: [] }) },
}));
vi.mock('../../lib/projectsApi', () => ({
  projectsApi: { list: () => Promise.resolve({ rows: [{ id: 'p1', project_no: 'PRJ-001', name: 'Alpha', status: 'ACTIVE' }], total: 1 }) },
}));
vi.mock('../../lib/biApi', () => ({ biApi: { listInsights: () => listInsights() as Promise<unknown> } }));

import { ExecutiveDashboard } from './ExecutiveDashboard';
import { CommandCenterPage } from './CommandCenterPage';
import { AiInsightsPage } from './AiInsightsPage';

const user = { name: 'ERP Administrator', roleLabel: 'Super User', department: 'Administration', roleLevel: 100 } as unknown as User;
const plain = { ...user, roleLevel: 30 } as User;
const wrap = (el: React.ReactElement) => render(<MemoryRouter>{el}</MemoryRouter>);

beforeEach(() => {
  counts.mockReset();
  inbox.mockReset();
  listInsights.mockReset();
});

describe('ExecutiveDashboard', () => {
  it('renders V40 labels and real numbers, with the department filter for admins', async () => {
    counts.mockResolvedValue({ pendingReceipt: 4, pendingAcceptance: 3, work: 9, approval: 2, open: 12 });
    wrap(<ExecutiveDashboard user={user} />);
    expect(screen.getByText('Welcome, ERP Administrator')).toBeTruthy();
    for (const l of ['Pending Receipt', 'Pending Acceptance', 'Active Department Work', 'Approval Inbox', 'Quick Actions', 'Department Inbox', 'Approvals', 'Project History', '360° Tracking', 'Tasks', 'Shifts', 'Department Work Queue', 'Active Projects', 'Recent Department Activity'])
      expect(screen.getAllByText(l).length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getByText('PRJ-001')).toBeTruthy());
    expect(screen.getAllByText('9').length).toBeGreaterThan(0);
    expect(screen.getAllByText('7').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Department Filter')).toBeTruthy();
    expect(counts).toHaveBeenCalledWith('all');
  });

  it('hides the filter for non-admins and shows empty states', async () => {
    counts.mockResolvedValue({ pendingReceipt: 0, pendingAcceptance: 0, work: 0, approval: 0, open: 0 });
    wrap(<ExecutiveDashboard user={plain} />);
    expect(screen.queryByLabelText('Department Filter')).toBeNull();
    await waitFor(() => expect(screen.getByText('No recent department activity.')).toBeTruthy());
    expect(counts).toHaveBeenCalledWith(undefined);
  });
});

describe('CommandCenterPage', () => {
  it('shows real open items and an empty state', async () => {
    counts.mockResolvedValue({ open: 2 });
    inbox.mockResolvedValue({
      hasMore: false, nextCursor: null,
      rows: [{ id: 'm1', number: 'MOV-1', doc_no: 'SO-1', to_department: 'Sales', to_department_id: 'd1', route_type: 'Technical Work', work_status: 'Work Required', assigned_manager: 'Asha', priority: 'Critical', state: 'SENT', is_late: false, required_by: '2026-12-01', sla_due_at: null }],
    });
    wrap(<CommandCenterPage />);
    await waitFor(() => expect(screen.getByText('SO-1')).toBeTruthy());
    for (const l of ['Command Center', 'Open Items', 'Critical', 'Risk by Business Area', 'Add Command Item', 'Command Data • 1 items'])
      expect(screen.getAllByText(l).length).toBeGreaterThan(0);
    expect(screen.getByText('RED')).toBeTruthy();
  });

  it('empty state when nothing is open', async () => {
    counts.mockResolvedValue({ open: 0 });
    inbox.mockResolvedValue({ rows: [], hasMore: false, nextCursor: null });
    wrap(<CommandCenterPage />);
    await waitFor(() => expect(screen.getByText('No open command items.')).toBeTruthy());
    expect(screen.getByText('GREEN')).toBeTruthy();
  });
});

describe('AiInsightsPage', () => {
  it('lists real findings', async () => {
    listInsights.mockResolvedValue([{ id: 'i1', kpiCode: 'SALES_X', kind: 'ANOMALY', severity: 'WARN', message: 'Value deviates from baseline' }]);
    wrap(<AiInsightsPage />);
    await waitFor(() => expect(screen.getByText('Value deviates from baseline')).toBeTruthy());
    expect(screen.getByText('Advanced AI Business Analysis')).toBeTruthy();
    expect(screen.getByText('1 AI Findings')).toBeTruthy();
    expect(screen.getByText('Cross-Module Risk')).toBeTruthy();
  });

  it('empty state', async () => {
    listInsights.mockResolvedValue([]);
    wrap(<AiInsightsPage />);
    await waitFor(() => expect(screen.getByText('No AI findings yet.')).toBeTruthy());
  });
});
