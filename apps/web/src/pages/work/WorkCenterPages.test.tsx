// V40 dept-work-<dept> (Work Center) and document-movement-center: real rows, counters and the send flow.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Movement } from '../../lib/workApi';

const inbox = vi.fn();
const counts = vi.fn();
const forward = vi.fn();
const sendInternal = vi.fn();
vi.mock('../../lib/workApi', async (orig) => {
  const real = await orig<typeof import('../../lib/workApi')>();
  return {
    ...real,
    workApi: {
      ...real.workApi,
      departments: () => Promise.resolve([{ id: 'd-sales', name: 'Sales' }, { id: 'd-prod', name: 'Production' }]),
      managers: () => Promise.resolve([{ id: 'u-1', name: 'Head Production' }]),
      inbox: (p: unknown) => inbox(p) as Promise<unknown>,
      counts: (d?: string) => counts(d) as Promise<unknown>,
      forward: (b: unknown) => forward(b) as Promise<unknown>,
      rules: () => Promise.resolve([{ module_id: 'sales-orders', owner_department_id: 'd-sales', owner_department: 'Sales', next_department_id: null, next_department: null, approval_department_id: null, approval_department: null, route_mode: 'MANUAL', sla_days: 2, routed_edit: true, active: true, required_attachment_types: [], required_fields: [] }]),
    },
  };
});
vi.mock('../../lib/docsMailApi', async (orig) => {
  const real = await orig<typeof import('../../lib/docsMailApi')>();
  return {
    ...real,
    docsMailApi: {
      ...real.docsMailApi,
      catalog: () => Promise.resolve([{ pageId: 'sales-orders', title: 'Sales Order', group: 'Sales', count: 1 }]),
      records: () => Promise.resolve([{ id: 'r1', number: 'SO-1', status: 'Draft', date: null }]),
      sent: () => Promise.resolve([]),
      sendInternal: (b: unknown) => sendInternal(b) as Promise<unknown>,
    },
  };
});

import { DeptWorkCenterPage } from './DeptWorkCenterPage';
import { DocumentMovementCenterPage } from './DocumentMovementCenterPage';

const move = { id: 'm1', number: 'MOV/1', doc_type: 'sales-orders', doc_id: 'd1', doc_no: 'SO-1', from_department: 'Production', to_department: 'Sales', priority: 'High', state: 'ACCEPTED', work_status: 'Work Required', sla_due_at: null, is_late: false } as unknown as Movement;
const wrap = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

beforeEach(() => {
  inbox.mockReset().mockResolvedValue({ rows: [move], hasMore: false, nextCursor: null });
  counts.mockReset().mockResolvedValue({ pendingReceipt: 0, pendingAcceptance: 0, work: 1, approval: 0, ready: 1, open: 1, returned: 0, sentWaiting: 2, needsAction: 0 });
  forward.mockReset().mockResolvedValue({});
  sendInternal.mockReset().mockResolvedValue({});
});

describe('Work Center (dept-work-<dept>)', () => {
  it('shows the V40 title, the six counters, the buttons, a real row and the rules naming the department', async () => {
    wrap(<DeptWorkCenterPage pageId="dept-work-sales" />);
    expect(await screen.findByRole('heading', { name: 'Sales • Flexible Work Center' })).toBeInTheDocument();
    expect(await screen.findByText('SO-1')).toBeInTheDocument();
    for (const t of ['Open Sales Inbox', 'New Message / Attach Document', 'Approvals', 'Plant Flow', 'Workflow Matrix']) expect(screen.getByRole('link', { name: t })).toBeInTheDocument();
    for (const c of ['Movement', 'Document / Record', 'Route', 'Status', 'Approval', 'Actions']) expect(screen.getByRole('columnheader', { name: c })).toBeInTheDocument();
    expect(inbox).toHaveBeenCalledWith(expect.objectContaining({ dept: 'd-sales', tab: 'work' }));
    expect(await screen.findByText('Workflow Rules Affecting Sales')).toBeInTheDocument();
    expect(await screen.findByText(/SLA 2 day/)).toBeInTheDocument();
  });
});

describe('Document Movement Center', () => {
  it('refuses to send with no attachment, then moves every attached document and mails the department', async () => {
    const user = userEvent.setup();
    wrap(<DocumentMovementCenterPage department="Sales" />);
    await screen.findByRole('option', { name: 'SO-1 • Draft' });
    await user.click(screen.getByRole('button', { name: 'Send to Department Inbox' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Add at least one ERP document');
    expect(forward).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '+ Add Attachment' }));
    await user.click(screen.getByRole('button', { name: 'Send to Department Inbox' }));
    await waitFor(() => expect(forward).toHaveBeenCalledWith(expect.objectContaining({ docType: 'sales-orders', docId: 'r1', toDepartmentId: 'd-prod' })));
    await waitFor(() => expect(sendInternal).toHaveBeenCalledWith(expect.objectContaining({ toDepartmentIds: ['d-prod'] })));
  });
});
