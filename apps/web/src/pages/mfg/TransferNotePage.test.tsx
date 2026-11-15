// mfg-transfer-note: registry tabs, a short receipt needs a reason, Receive sends the received quantity.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ plants: vi.fn(), noteOptions: vi.fn(), noteCards: vi.fn(), notes: vi.fn(), disputes: vi.fn(), noteAudit: vi.fn(), receiveNote: vi.fn() }));
vi.mock('../../lib/routingApi', async (orig) => {
  const real = await orig<typeof import('../../lib/routingApi')>();
  return { ...real, routingApi: { ...real.routingApi, ...api } };
});
import { TransferNotePage } from './TransferNotePage';

const note = {
  id: 'n1', noteNo: 'MTN/TAL/0001', jobCardNo: 'MO/TAL/0001', partCode: 'SH', partName: 'Shaft', fromUnitCode: 'TAL', fromUnitName: 'Talegaon', fromProcess: 'Turning',
  toUnitCode: 'SAW', toUnitName: 'Sawantwadi', toProcess: 'Grinding', transferDate: '2026-11-14', sentQty: '100.000', receivedQty: null, shortQty: '0.000', shortReason: null,
  receiptStatus: 'PENDING', stockState: 'IN_TRANSIT', vehiclePerson: null, sentBy: 'A', receivedBy: null, reconciledAt: null, openDisputes: 0, fromWarehouseId: 'w1', toWarehouseId: 'w2', itemId: 'i1',
};

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  api.plants.mockResolvedValue([]);
  api.noteOptions.mockResolvedValue({ units: [], warehouses: [], items: [], defaultUnitId: 'u1' });
  api.noteCards.mockResolvedValue({ pendingReceipt: 1, inTransit: 1, received: 0, openDisputes: 0 });
  api.notes.mockResolvedValue([note]);
  api.disputes.mockResolvedValue([]);
  api.noteAudit.mockResolvedValue([]);
  api.receiveNote.mockResolvedValue({ ...note, receiptStatus: 'SHORT' });
});

describe('Material Transfer Note', () => {
  it('shows the six tabs and the V40 columns with a real row', async () => {
    render(<MemoryRouter><TransferNotePage /></MemoryRouter>);
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Transfer Register', 'In Transit', 'Pending Receipt', 'Received', 'Variance & Disputes', 'Audit']);
    for (const c of ['Transfer', 'Parent Job', 'Sent', 'Accepted', 'Shortage', 'Actions']) expect(screen.getByRole('columnheader', { name: c })).toBeInTheDocument();
    expect(await screen.findByText('MTN/TAL/0001')).toBeInTheDocument();
    expect(screen.getByText('100.000')).toBeInTheDocument();
  });

  it('100 sent, 96 received: Confirm needs the reason, then posts 96 with the reason', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><TransferNotePage /></MemoryRouter>);
    await user.click(await screen.findByRole('button', { name: 'Receive' }));
    const qty = screen.getByLabelText('Quantity received');
    await user.clear(qty);
    await user.type(qty, '96');
    const confirm = screen.getByRole('button', { name: /Confirm Receipt/ });
    expect(confirm).toBeDisabled();
    expect(confirm).toHaveAttribute('title', 'Enter the reason for the short quantity.');
    await user.type(screen.getByLabelText('Reason for the short quantity'), '4 damaged in transit');
    await user.click(screen.getByRole('button', { name: 'Confirm Receipt' }));
    await waitFor(() => expect(api.receiveNote).toHaveBeenCalledWith('n1', { receivedQty: '96', shortReason: '4 damaged in transit' }));
  });

  it('Reconcile is disabled with a reason unless the receipt was short', async () => {
    render(<MemoryRouter><TransferNotePage /></MemoryRouter>);
    const rec = await screen.findByRole('button', { name: /Reconcile/ });
    expect(rec).toBeDisabled();
    expect(rec).toHaveAttribute('title', 'Only a short receipt needs reconciling.');
  });
});
