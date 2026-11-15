// The four movement registers: V40 title / columns / counters, real rows, and the Received dialog with short quantity.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MovementRow } from '../../lib/movementApi';

const list = vi.fn();
const counts = vi.fn();
const lines = vi.fn();
const audit = vi.fn();
const act = vi.fn();
vi.mock('../../lib/movementApi', () => ({
  movementApi: {
    list: (p: unknown) => list(p) as Promise<unknown>,
    counts: (p: unknown) => counts(p) as Promise<unknown>,
    lines: (id: string) => lines(id) as Promise<unknown>,
    audit: (k: string, d?: string) => audit(k, d) as Promise<unknown>,
  },
}));
vi.mock('../../lib/workApi', async (orig) => {
  const real = await orig<typeof import('../../lib/workApi')>();
  return {
    ...real,
    workApi: {
      ...real.workApi,
      departments: () => Promise.resolve([{ id: 'd-prod', name: 'Production' }]),
      act: (...a: unknown[]) => act(...a) as Promise<unknown>,
    },
  };
});

import { MovementRegisterPage, type MovementPageId } from './MovementRegisterPage';

function row(over: Partial<MovementRow> = {}): MovementRow {
  return {
    id: 'm1', number: 'MOV/TAL/0001', unit_id: 'u1', to_unit_id: 'u2', doc_type: 'sales-orders', doc_id: 'doc1', doc_no: 'SO-0001',
    from_department_id: 'd-w', from_department: 'Warehouse', to_department_id: 'd-prod', to_department: 'Production',
    assigned_manager_id: null, assigned_manager: 'Head Production', route_type: 'Department Work Handover', priority: 'Normal',
    required_by: null, work_status: 'Work Required', handover_note: null, state: 'SENT', sent_at: '2026-11-14T08:00:00Z',
    received_at: null, accepted_at: null, return_reason: null, sla_due_at: null, is_late: false, is_physical: true, version: 1,
    sent_by: 'Store User', received_by: null, accepted_by: null,
    from_plant: 'TAL', from_plant_name: 'Talegaon', to_plant: 'SAW', to_plant_name: 'Sawantwadi', completed_at: null, returned_at: null,
    line_count: 1, sent_qty: 100, received_qty: null, short_qty: null, part: 'Shafts', uom: 'Nos', batch: 'B-7',
    from_location: 'Store A', to_location: 'Store B', transfer_note_no: 'TN-1', vehicle_person: 'MH12 AB 1234', transfer_receipt_status: 'PENDING',
    ...over,
  };
}

const view = (pageId: MovementPageId) =>
  render(
    <MemoryRouter>
      <MovementRegisterPage pageId={pageId} />
    </MemoryRouter>,
  );

describe('movement registers', () => {
  beforeEach(() => {
    for (const f of [list, counts, lines, audit, act]) f.mockReset();
    list.mockResolvedValue({ rows: [row()], hasMore: false, nextCursor: null });
    counts.mockResolvedValue({ maintenance: 3, process: 4, department: 5, interplant: 6 });
    lines.mockResolvedValue([{ line_no: 1, description: 'Shafts', qty: 100, uom: 'Nos', received_qty: null, short_qty: null, short_reason: null }]);
    audit.mockResolvedValue([]);
    act.mockResolvedValue({});
  });

  it.each([
    ['maint-part-movement', 'maintenance', 'Maintenance Part Movement', ['Movement / Work Order', 'Machine / Part', 'Custody Route', 'Type / Condition', 'Quantity', 'Approval / Receipt', 'Dates', 'Actions']],
    ['plant-process-movement', 'process', 'Process Movement', ['Movement / Job', 'Part / Batch', 'Process Route', 'Machine / Operator', 'Quantity Reconciliation', 'Approval / Receipt', 'Actions']],
    ['plant-department-movement', 'department', 'Department Movement', ['Movement / Reference', 'Part / Quantity', 'Department Route', 'Handover / Priority', 'Manager Approval', 'Custody / Receipt', 'Actions']],
    ['plant-interplant-movement', 'interplant', 'Plant-to-Plant Movement', ['Transfer / Part', 'Plant Route', 'Warehouse / Department', 'Transport Documents', 'Quantity Reconciliation', 'Transit / Receipt', 'Actions']],
  ] as const)('%s reads kind %s and shows the V40 columns, counters and a real row', async (pageId, kind, title, columns) => {
    view(pageId);
    expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    for (const c of columns) expect(screen.getByRole('columnheader', { name: c })).toBeInTheDocument();
    expect(await screen.findByText('MOV/TAL/0001')).toBeInTheDocument();
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ kind }));
    expect(await screen.findByRole('link', { name: 'Maintenance Parts (3)' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Process Movement (4)' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Department Movement (5)' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Plant-to-Plant (6)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Add Movement' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'My Approvals' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Import' })).not.toBeInTheDocument();
  });

  it('Send for Approval is disabled with a visible reason', async () => {
    view('plant-interplant-movement');
    const b = await screen.findByRole('button', { name: 'Send for Approval' });
    expect(b).toBeDisabled();
    expect(b.getAttribute('title')).toMatch(/not available/);
  });

  it('a tab reads its own view, Audit reads the audit endpoint', async () => {
    const user = userEvent.setup();
    view('plant-interplant-movement');
    await screen.findByText('MOV/TAL/0001');
    await user.click(screen.getByRole('tab', { name: 'In Transit' }));
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'interplant', view: 'sent' })));
    await user.click(screen.getByRole('tab', { name: 'Variance / Dispute' }));
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ view: 'variance' })));
    await user.click(screen.getByRole('tab', { name: 'Audit' }));
    await waitFor(() => expect(audit).toHaveBeenCalledWith('interplant', undefined));
  });

  it('plant-to-plant Received needs a reason for a short quantity, then sends lines to receive', async () => {
    const user = userEvent.setup();
    view('plant-interplant-movement');
    await screen.findByText('MOV/TAL/0001');
    await user.click(screen.getByRole('button', { name: 'Received' }));
    const qty = await screen.findByLabelText('Received quantity, line 1');
    await user.clear(qty);
    await user.type(qty, '96');
    await user.click(screen.getByRole('button', { name: 'Receive' }));
    expect(await screen.findByText(/enter a reason for the short quantity \(4\)/)).toBeInTheDocument();
    expect(act).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText('Short reason, line 1'), '4 damaged in transit');
    await user.click(screen.getByRole('button', { name: 'Receive' }));
    await waitFor(() => expect(act).toHaveBeenCalledWith('m1', 'receive', { lines: [{ lineNo: 1, receivedQty: 96, shortReason: '4 damaged in transit' }] }));
  });

  it('a department-only SENT movement is received in one click', async () => {
    const user = userEvent.setup();
    list.mockResolvedValue({ rows: [row({ is_physical: false, to_unit_id: null })], hasMore: false, nextCursor: null });
    view('plant-department-movement');
    await screen.findByText('MOV/TAL/0001');
    await user.click(screen.getByRole('button', { name: 'Received' }));
    await waitFor(() => expect(act).toHaveBeenCalledWith('m1', 'receive'));
  });

  it('an empty view says so', async () => {
    list.mockResolvedValue({ rows: [], hasMore: false, nextCursor: null });
    view('maint-part-movement');
    expect(await screen.findByText('No movements in this view.')).toBeInTheDocument();
  });
});
