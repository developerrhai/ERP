// V40 my-approvals: the five views, the V40 columns, and the Received / Accepted actions on real movements.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Movement } from '../../lib/workApi';

const inbox = vi.fn();
const act = vi.fn();
const audit = vi.fn();
vi.mock('../../lib/workApi', async (orig) => {
  const real = await orig<typeof import('../../lib/workApi')>();
  return {
    ...real,
    workApi: {
      ...real.workApi,
      departments: () => Promise.resolve([{ id: 'd-prod', name: 'Production' }]),
      inbox: (p: unknown) => inbox(p) as Promise<unknown>,
      act: (...a: unknown[]) => act(...a) as Promise<unknown>,
      audit: (d?: string) => audit(d) as Promise<unknown>,
    },
  };
});

import { MyApprovalsPage } from './MyApprovalsPage';

function movement(over: Partial<Movement> = {}): Movement {
  return {
    id: 'm1',
    number: 'MOV/TAL/0001',
    unit_id: 'u1',
    to_unit_id: null,
    doc_type: 'sales-orders',
    doc_id: 'doc1',
    doc_no: 'SO-0001',
    from_department_id: 'd-sales',
    from_department: 'Sales',
    to_department_id: 'd-prod',
    to_department: 'Production',
    assigned_manager_id: null,
    assigned_manager: 'Head Production',
    route_type: 'Department Work Handover',
    priority: 'High',
    required_by: null,
    work_status: 'Work Required',
    handover_note: 'please start',
    state: 'SENT',
    sent_at: '2026-11-14T08:00:00Z',
    received_at: null,
    accepted_at: null,
    return_reason: null,
    sla_due_at: null,
    is_late: false,
    is_physical: false,
    version: 1,
    sent_by: 'Sales User',
    received_by: null,
    accepted_by: null,
    ...over,
  };
}

const view = () =>
  render(
    <MemoryRouter>
      <MyApprovalsPage />
    </MemoryRouter>,
  );

describe('My Department Approvals (my-approvals)', () => {
  beforeEach(() => {
    inbox.mockReset();
    act.mockReset();
    audit.mockReset();
    inbox.mockResolvedValue({ rows: [movement()], hasMore: false, nextCursor: null });
    act.mockResolvedValue({});
    audit.mockResolvedValue([]);
  });

  it('shows the V40 title, the five views, the V40 columns and one real row', async () => {
    view();
    expect(screen.getByRole('heading', { name: 'My Department Approvals' })).toBeInTheDocument();
    for (const t of ['Pending for Acceptance', 'Received', 'Sent by My Department', 'Completed / History', 'Audit']) {
      expect(screen.getByRole('tab', { name: t })).toBeInTheDocument();
    }
    for (const c of ['Request / Priority', 'Source → Target', 'Module / Record', 'Requested', 'Manager / Due', 'Type / Remarks', 'Status', 'Actions']) {
      expect(screen.getByRole('columnheader', { name: c })).toBeInTheDocument();
    }
    expect(await screen.findByText('MOV/TAL/0001')).toBeInTheDocument();
    expect(screen.getByText('Sales → Production')).toBeInTheDocument();
    expect(inbox).toHaveBeenCalledWith(expect.objectContaining({ tab: 'pending' }));
  });

  it('each view reads its own server tab', async () => {
    const user = userEvent.setup();
    view();
    await screen.findByText('MOV/TAL/0001');
    await user.click(screen.getByRole('tab', { name: 'Received' }));
    await waitFor(() => expect(inbox).toHaveBeenLastCalledWith(expect.objectContaining({ tab: 'accept' })));
    await user.click(screen.getByRole('tab', { name: 'Sent by My Department' }));
    await waitFor(() => expect(inbox).toHaveBeenLastCalledWith(expect.objectContaining({ tab: 'sent' })));
    await user.click(screen.getByRole('tab', { name: 'Completed / History' }));
    await waitFor(() => expect(inbox).toHaveBeenLastCalledWith(expect.objectContaining({ tab: 'completed' })));
    await user.click(screen.getByRole('tab', { name: 'Audit' }));
    await waitFor(() => expect(audit).toHaveBeenCalled());
  });

  it('a SENT movement offers Received (not Accepted); Received then calls the receive action', async () => {
    const user = userEvent.setup();
    view();
    await screen.findByText('MOV/TAL/0001');
    expect(screen.queryByRole('button', { name: 'Accepted' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Received' }));
    await waitFor(() => expect(act).toHaveBeenCalledWith('m1', 'receive'));
  });

  it('a RECEIVED movement offers Accepted and Return', async () => {
    inbox.mockResolvedValue({ rows: [movement({ state: 'RECEIVED' })], hasMore: false, nextCursor: null });
    view();
    await screen.findByText('MOV/TAL/0001');
    expect(screen.getByRole('button', { name: 'Accepted' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Return' })).toBeInTheDocument();
  });

  it('an empty view says so, with the department name', async () => {
    inbox.mockResolvedValue({ rows: [], hasMore: false, nextCursor: null });
    view();
    expect(await screen.findByText(/No approvals in this view for All Departments/)).toBeInTheDocument();
  });
});
