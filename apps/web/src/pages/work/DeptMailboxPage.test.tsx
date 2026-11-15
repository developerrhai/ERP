// V40 dept-inbox-<department>: title with the Needs Action count, 12 views, 8 columns, movement + mail rows.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Movement } from '../../lib/workApi';

const inbox = vi.fn();
const act = vi.fn();
const counts = vi.fn();
const mail = vi.fn();
vi.mock('../../lib/workApi', async (orig) => {
  const real = await orig<typeof import('../../lib/workApi')>();
  return {
    ...real,
    workApi: {
      ...real.workApi,
      departments: () => Promise.resolve([{ id: 'd-sales', name: 'Sales' }, { id: 'd-hr', name: 'HR' }]),
      inbox: (p: unknown) => inbox(p) as Promise<unknown>,
      act: (...a: unknown[]) => act(...a) as Promise<unknown>,
      counts: (d?: string) => counts(d) as Promise<unknown>,
    },
  };
});
vi.mock('../../lib/docsMailApi', async (orig) => {
  const real = await orig<typeof import('../../lib/docsMailApi')>();
  return { ...real, docsMailApi: { ...real.docsMailApi, inbox: () => mail() as Promise<unknown> } };
});

import { DeptMailboxPage, deptFromPage } from './DeptMailboxPage';

const move = (over: Partial<Movement> = {}): Movement =>
  ({
    id: 'm1', number: 'MOV/1', unit_id: 'u', to_unit_id: null, doc_type: 'sales-orders', doc_id: 'd1', doc_no: 'SO-1',
    from_department_id: 'd-prod', from_department: 'Production', to_department_id: 'd-sales', to_department: 'Sales',
    assigned_manager_id: null, assigned_manager: null, route_type: 'Technical Work', priority: 'Normal', required_by: null,
    work_status: 'Work Required', handover_note: 'check drawing', state: 'SENT', sent_at: '2026-11-14T08:00:00Z',
    received_at: null, accepted_at: null, return_reason: null, sla_due_at: null, is_late: false, is_physical: false,
    version: 1, sent_by: 'P', received_by: null, accepted_by: null, ...over,
  }) as Movement;

const view = (id = 'dept-inbox-sales') =>
  render(
    <MemoryRouter>
      <DeptMailboxPage pageId={id} />
    </MemoryRouter>,
  );

describe('Department mailbox (dept-inbox-<dept>)', () => {
  beforeEach(() => {
    inbox.mockReset().mockResolvedValue({ rows: [move()], hasMore: false, nextCursor: null });
    act.mockReset().mockResolvedValue({});
    counts.mockReset().mockResolvedValue({ pendingReceipt: 1, pendingAcceptance: 0, work: 0, approval: 0, ready: 0, open: 1, returned: 0, needsAction: 1 });
    mail.mockReset().mockResolvedValue([{ id: 'x1', subject: 'Drawing rev B', from_department: 'Projects', from_name: 'Pia', created_at: '2026-11-14T09:00:00Z', read: false, attachments: 1 }]);
  });

  it('maps the page id to a department', () => {
    const d = [{ id: '1', name: 'HR' }, { id: '2', name: 'Sales' }];
    expect(deptFromPage('dept-inbox-hr', d)?.id).toBe('1');
    expect(deptFromPage('dept-inbox-nope', d)).toBeUndefined();
  });

  it('shows "{Dept} Inbox (n)", the cards, the 12 views and the 8 V40 columns', async () => {
    view();
    expect(await screen.findByRole('heading', { name: 'Sales Inbox (1)' })).toBeInTheDocument();
    for (const t of ['Inbox', 'Unread', 'Attachments', 'Pending Receipt', 'Pending Acceptance', 'Work / Rework', 'Approval Inbox', 'Ready to Move', 'Sent', 'Returned', 'Completed', 'All Mail']) {
      expect(screen.getByRole('tab', { name: t })).toBeInTheDocument();
    }
    for (const c of ['From / Sent', 'Subject / Message', 'Attachments', 'To / Workflow', 'Received / Accepted', 'Work / Approval', 'Status', 'Actions']) {
      expect(screen.getByRole('columnheader', { name: c })).toBeInTheDocument();
    }
    expect(counts).toHaveBeenCalledWith('d-sales');
  });

  it('the Inbox view lists the movement and the mail; Received calls the receive action', async () => {
    const user = userEvent.setup();
    view();
    expect(await screen.findByText('SO-1')).toBeInTheDocument();
    expect(await screen.findByText('Drawing rev B')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Received' }));
    await waitFor(() => expect(act).toHaveBeenCalledWith('m1', 'receive'));
  });

  it('Pending Acceptance reads the accept tab; Unread shows only mail', async () => {
    const user = userEvent.setup();
    view();
    await screen.findByText('SO-1');
    await user.click(screen.getByRole('tab', { name: 'Pending Acceptance' }));
    await waitFor(() => expect(inbox).toHaveBeenLastCalledWith(expect.objectContaining({ dept: 'd-sales', tab: 'accept' })));
    inbox.mockClear();
    await user.click(screen.getByRole('tab', { name: 'Unread' }));
    expect(await screen.findByText('Drawing rev B')).toBeInTheDocument();
    expect(inbox).not.toHaveBeenCalled();
  });

  it('an unknown department says so', async () => {
    view('dept-inbox-nothing');
    expect(await screen.findByText(/There is no department called/)).toBeInTheDocument();
  });
});
