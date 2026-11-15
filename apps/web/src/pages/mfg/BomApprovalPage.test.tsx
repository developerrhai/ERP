// flow-bom-approval: V40 tab order, required vs available, Raise PR, and the reasons behind disabled buttons.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ plants: vi.fn(), flowOptions: vi.fn(), flows: vi.fn(), flow: vi.fn(), raisePr: vi.fn(), trace: vi.fn() }));
vi.mock('../../lib/routingApi', async (orig) => {
  const real = await orig<typeof import('../../lib/routingApi')>();
  return { ...real, routingApi: { ...real.routingApi, ...api } };
});
import { BomApprovalPage } from './BomApprovalPage';

const flow = {
  id: 'f1', flowNo: 'BMA/TAL/0001', unitCode: 'TAL', salesOrderNo: 'SO/TAL/0007', bomNumber: 'BOM/TAL/0001', partCode: 'FG1', partName: 'Busbar', bomRevision: 'Rev 1',
  qty: '1.000', salesApproval: 'APPROVED', purchaseStatus: 'NONE', manufacturingRelease: false, status: 'OPEN', prId: null, prNumber: null, salesApprovedBy: 'Sales Head',
  salesApprovedAt: '2026-11-14T08:00:00Z', releasedBy: null, releasedAt: null, lineCount: 1, shortLines: 1,
  lines: [{ id: 'l1', lineNo: 1, itemId: 'i1', itemCode: 'CU-01', itemName: 'Copper', uom: 'Kg', requiredQty: '82.000', availableQty: '60.000', shortageQty: '22.000' }],
};

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  api.plants.mockResolvedValue([]);
  api.flowOptions.mockResolvedValue({ boms: [], salesOrders: [] });
  api.flows.mockResolvedValue([flow]);
  api.flow.mockResolvedValue(flow);
  api.trace.mockResolvedValue({ flow, events: [], orders: [] });
});

describe('BOM & Material Approval', () => {
  it('has the six V40 tabs in order', async () => {
    render(<MemoryRouter><BomApprovalPage /></MemoryRouter>);
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['BOM Selection', 'Sales Approval', 'Stock Verification', 'Purchase Shortage', 'Manufacturing Release', 'Traceability']);
    expect(await screen.findByText('BMA/TAL/0001')).toBeInTheDocument();
  });

  it('Stock Verification shows 82.000 required vs 60.000 available; Raise PR calls the API for the flow', async () => {
    const user = userEvent.setup();
    api.raisePr.mockResolvedValue({ ...flow, prId: 'p1', prNumber: 'PR/TAL/0001', pr: { id: 'p1', number: 'PR/TAL/0001' } });
    render(<MemoryRouter><BomApprovalPage /></MemoryRouter>);
    await user.click(await screen.findByRole('button', { name: 'BMA/TAL/0001' }));
    await user.click(screen.getByRole('tab', { name: 'Stock Verification' }));
    expect(await screen.findByText('82.000 Kg')).toBeInTheDocument();
    expect(screen.getByText('60.000 Kg')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Purchase Shortage' }));
    expect((await screen.findAllByText('22.000 Kg')).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: 'Raise PR' }));
    await waitFor(() => expect(api.raisePr).toHaveBeenCalledWith('f1'));
  });

  it('Release is disabled with the reason while stock is short', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><BomApprovalPage /></MemoryRouter>);
    await user.click(await screen.findByRole('button', { name: 'BMA/TAL/0001' }));
    await user.click(screen.getByRole('tab', { name: 'Manufacturing Release' }));
    const btn = await screen.findByRole('button', { name: /Release to Manufacturing/ });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('title', 'Stock is short for 1 material(s). Raise a PR first.');
  });
});
