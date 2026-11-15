// V40 ops-order-360 and project-global-history: real data from the API, V40 sections and buttons.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const order360 = vi.fn();
const summary = vi.fn();
const history = vi.fn();
vi.mock('../../lib/spineApi', async (orig) => {
  const real = await orig<typeof import('../../lib/spineApi')>();
  return {
    ...real,
    spineApi: {
      ...real.spineApi,
      orders: () => Promise.resolve([{ id: 'so1', number: 'SO-1', status: 'Approved' }]),
      order360: (id: string) => order360(id) as Promise<unknown>,
      options: (q: string) => Promise.resolve(q.toLowerCase() === 'prj-1' ? [{ id: 'p1', code: 'PRJ-1', name: 'Valve cell', status: 'ACTIVE' }] : []),
      summary: (id: string) => summary(id) as Promise<unknown>,
      history: (id: string, p: unknown) => history(id, p) as Promise<unknown>,
    },
  };
});

import { Order360Page } from './Order360Page';
import { ProjectHistoryPage } from './ProjectHistoryPage';

const wrap = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

beforeEach(() => {
  order360.mockReset().mockResolvedValue({
    order: { id: 'so1', number: 'SO-1', status: 'Approved', customer: 'Falcon', customerPo: 'PO-9', value: '1000', project: 'PRJ-1', plant: 'TAL' },
    progressPct: 5,
    identity: { customerPo: 'PO-9', salesOrder: 'SO-1', project: 'PRJ-1', purchaseOrder: null, manufacturingOrder: null, dcInvoice: null },
    journey: [{ number: 'MOV/1', state: 'ACCEPTED', from: 'Sales', to: 'Purchase', sentAt: '2026-11-14T08:00:00Z', receivedAt: null, acceptedAt: null }],
    approvalsPending: 0,
    financial: { orderValue: 1000, invoiced: 0, received: 0 },
    mrp: [{ line: 1, code: 'M1', material: 'Copper', required: 82, initial: 60, reserved: 0, purchased: 0, shortage: 22, pr: null, status: 'Short' }],
    lines: [{ lineNo: 1, item: 'Valve', itemCode: 'V1', partNo: null, uom: 'Nos', rate: 100, discountPct: 0, gstPct: 18, lineTotal: 118, ordered: 1, dispatched: 0, invoiced: 0, progressPct: 0 }],
    stages: [{ key: 'po', label: 'Purchase order', docs: [], done: 0, total: null, state: 'NOT_STARTED' }],
    heldBy: [],
  });
  summary.mockReset().mockResolvedValue({
    project: { id: 'p1', code: 'PRJ-1', name: 'Valve cell', customer: 'Axis', manager: 'Pia Manager', startDate: '2026-08-05', endDate: '2026-12-20', status: 'ACTIVE', phase: 'Manufacturing', progressPct: 58 },
    departments: [{ id: 'd1', department: 'Production', documents: 2, events: 3, open: 1, latestAt: '2026-11-14T09:00:00Z', latestText: 'Document created' }],
  });
  history.mockReset().mockResolvedValue([{ id: 'e1', at: '2026-11-14T09:00:00Z', kind: 'DOC_CREATED', department: 'Production', actor: 'Pia', doc_no: 'MO-1', doc_type: 'mfg-orders', text: 'Document created', masked: false }]);
});

describe('360° Order Tracking', () => {
  it('loads the first order and shows identity, lines, MRP shortage, journey and the V40 buttons', async () => {
    wrap(<Order360Page />);
    expect(await screen.findByText('SO-1 • Falcon')).toBeInTheDocument();
    for (const b of ['Load', 'Recalculate', 'Run Next Controlled Step', 'Send Email', 'Word', 'Excel', 'PDF']) expect(screen.getByRole('button', { name: b })).toBeInTheDocument();
    expect(screen.getByText('PO-9', { selector: 'b' })).toBeInTheDocument();
    expect(screen.getByText('Copper')).toBeInTheDocument();
    expect(screen.getByText('Short')).toBeInTheDocument();
    expect(screen.getByText('Sales → Purchase')).toBeInTheDocument();
    expect(order360).toHaveBeenCalledWith('so1');
  });
});

describe('Global Project History', () => {
  it('refuses an unknown number, then shows master details, the department roll-up and the activity log', async () => {
    const user = userEvent.setup();
    wrap(<ProjectHistoryPage />);
    await user.type(screen.getByLabelText('Project Number'), 'nope');
    await user.click(screen.getByRole('button', { name: 'Load Project History' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('no project with the number');
    await user.clear(screen.getByLabelText('Project Number'));
    await user.type(screen.getByLabelText('Project Number'), 'PRJ-1');
    await user.click(screen.getByRole('button', { name: 'Load Project History' }));
    expect(await screen.findByText('Pia Manager')).toBeInTheDocument();
    expect(screen.getByText('58%')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Department History' })).toBeInTheDocument();
    await waitFor(() => expect(history).toHaveBeenCalledWith('p1', expect.anything()));
    expect(screen.getAllByText('MO-1').length).toBeGreaterThan(0);
  });
});
