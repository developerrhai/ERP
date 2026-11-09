// Phase 13 screens: completing a job card, releasing a production order, BOM approval rights, the MRP suggestions with their
// pegging, and the "No data yet" state of the shop-floor dashboard.
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  countCalls,
  json,
  makeUser,
  permissionsRoute,
  renderApp,
  signedIn,
} from '../../test/helpers';

const owner = makeUser({ role: 'SUPER_ADMIN', roleLabel: 'Super Admin', name: 'Owner Person' });
const ALL = permissionsRoute({
  view: true,
  add: true,
  edit: true,
  delete: true,
  approve: true,
  submit: true,
  post: true,
  cancel: true,
  controls: true,
});
const VIEW_ONLY = permissionsRoute({ view: true });
const page = (rows: unknown[]) =>
  json(200, { data: rows, meta: { page: 1, size: 100, total: rows.length } });

const card = {
  id: 'p2',
  orderNumber: 'PRO/TAL/26-27/0001',
  itemName: 'Bracket',
  seq: 20,
  name: 'Assembly',
  workCentreCode: 'ASM',
  status: 'In Progress',
  qtyIn: '8',
  qtyDone: '0',
  qtyRejected: '0',
  qtyScrap: '0',
  qtyRework: '0',
  remaining: '8',
  timeLogs: [],
  downtime: [],
  dueDate: '2026-11-20',
};

describe('Work Orders (job cards)', () => {
  it('completes a card with the counts and sends it once', async () => {
    const { calls } = signedIn(owner, {
      'GET /api/v1/me/permissions': ALL,
      'GET /api/v1/mfg/work-centers': () => page([]),
      'GET /api/v1/mfg/job-cards': () => page([card]),
      'GET /api/v1/mfg/job-cards/p2': () => json(200, { data: card }),
      'GET /api/v1/mfg/downtime-reasons': () => json(200, { data: [] }),
      'GET /api/v1/mfg/scrap-reasons': () => json(200, { data: [] }),
      'POST /api/v1/mfg/job-cards/p2/complete': () =>
        json(200, { data: { ...card, status: 'Done' } }),
    });
    renderApp('/m/mfg-workorders');
    const ue = userEvent.setup();
    await ue.click(await screen.findByRole('button', { name: 'Open' }));
    const panel = await screen.findByRole('dialog');
    await ue.type(await within(panel).findByLabelText('Good pieces'), '8');
    await ue.click(within(panel).getByRole('button', { name: 'Complete this card' }));
    await screen.findAllByText('Done');
    expect(countCalls(calls, 'POST', '/mfg/job-cards/p2/complete')).toBe(1);
    expect(calls.find((c) => c.path.endsWith('/complete'))?.body).toMatchObject({ good: '8' });
  });
});

describe('Production Orders', () => {
  const order = {
    id: 'o1',
    version: 2,
    number: 'PRO/TAL/26-27/0001',
    status: 'Planned',
    itemCode: 'FG1',
    itemName: 'Bracket',
    uom: 'Nos',
    qty: '10',
    qtyCompleted: '0',
    qtyReceived: '0',
    dueDate: '2026-11-20',
    materials: [],
    ops: [],
    receipts: [],
    cost: { material: '0', labour: '0', overhead: '0', abnormalScrap: '0', fgValue: '0', wip: '0' },
  };
  it('releases a planned order once', async () => {
    const { calls } = signedIn(owner, {
      'GET /api/v1/me/permissions': ALL,
      'GET /api/v1/mfg/production-orders': () => page([order]),
      'GET /api/v1/mfg/production-orders/o1': () => json(200, { data: order }),
      'POST /api/v1/mfg/production-orders/o1/release': () =>
        json(200, { data: { ...order, status: 'Released' } }),
    });
    renderApp('/m/mfg-orders');
    const ue = userEvent.setup();
    await ue.click(await screen.findByRole('button', { name: 'Open' }));
    const panel = await screen.findByRole('dialog');
    await ue.click(await within(panel).findByRole('button', { name: 'Release' }));
    await screen.findAllByText('Released');
    expect(countCalls(calls, 'POST', '/mfg/production-orders/o1/release')).toBe(1);
    expect(calls.find((c) => c.path.endsWith('/release'))?.headers['If-Match']).toBe('"2"');
  });
  it('shows nothing to approve for a viewer, and approval for a big order to an approver', async () => {
    const pending = { ...order, status: 'Pending Approval' };
    signedIn(owner, {
      'GET /api/v1/me/permissions': VIEW_ONLY,
      'GET /api/v1/mfg/production-orders': () => page([pending]),
      'GET /api/v1/mfg/production-orders/o1': () => json(200, { data: pending }),
    });
    renderApp('/m/mfg-orders');
    const ue = userEvent.setup();
    await ue.click(await screen.findByRole('button', { name: 'Open' }));
    const panel = await screen.findByRole('dialog');
    await within(panel).findByText(/Pending Approval/);
    expect(within(panel).queryByRole('button', { name: /Approve/ })).toBeNull();
    expect(within(panel).queryByRole('button', { name: 'Release' })).toBeNull();
  });
});

describe('Bill of Materials', () => {
  const bom = {
    id: 'b1',
    version: 3,
    number: 'BOM/TAL/26-27/0001',
    itemCode: 'FG1',
    itemName: 'Bracket',
    status: 'PENDING_APPROVAL',
    revision: 1,
    baseQty: '1',
    uom: 'Nos',
    lineCount: 1,
    lines: [],
  };
  it('lets an approver release a BOM that is waiting for approval', async () => {
    const { calls } = signedIn(owner, {
      'GET /api/v1/me/permissions': ALL,
      'GET /api/v1/mfg/boms': () => page([bom]),
      'GET /api/v1/mfg/boms/b1': () => json(200, { data: bom }),
      'POST /api/v1/mfg/boms/b1/release': () => json(200, { data: { ...bom, status: 'RELEASED' } }),
    });
    renderApp('/m/mfg-bom');
    const ue = userEvent.setup();
    await ue.click(await screen.findByRole('button', { name: 'Open' }));
    const panel = await screen.findByRole('dialog');
    await ue.click(await within(panel).findByRole('button', { name: 'Release' }));
    await screen.findAllByText('RELEASED');
    expect(countCalls(calls, 'POST', '/mfg/boms/b1/release')).toBe(1);
  });
  it('hides Release from a person without the approve right', async () => {
    signedIn(owner, {
      'GET /api/v1/me/permissions': permissionsRoute({ view: true, edit: true }),
      'GET /api/v1/mfg/boms': () => page([bom]),
      'GET /api/v1/mfg/boms/b1': () => json(200, { data: bom }),
    });
    renderApp('/m/mfg-bom');
    const ue = userEvent.setup();
    await ue.click(await screen.findByRole('button', { name: 'Open' }));
    const panel = await screen.findByRole('dialog');
    await within(panel).findByText(/PENDING_APPROVAL/);
    expect(within(panel).queryByRole('button', { name: 'Release' })).toBeNull();
  });
});

describe('MRP', () => {
  it('shows the suggestions with their pegging and firms one', async () => {
    const run = {
      id: 'r1',
      number: 'MRP/TAL/26-27/0001',
      status: 'DONE',
      horizonDays: 30,
      makeCount: 1,
      buyCount: 1,
      exceptionCount: 0,
      createdAt: '2026-11-09T10:00:00Z',
    };
    const sug = [
      {
        id: 's1',
        itemCode: 'FG1',
        itemName: 'Bracket',
        type: 'MAKE',
        qty: '20',
        uom: 'Nos',
        dueDate: '2026-11-20',
        releaseDate: '2026-11-18',
        status: 'OPEN',
        pegging: [{ type: 'SALES_ORDER', ref: 'SO-1', qty: '20' }],
      },
      {
        id: 's2',
        itemCode: 'RM1',
        itemName: 'Plate',
        type: 'BUY',
        qty: '60',
        uom: 'Kg',
        dueDate: '2026-11-18',
        releaseDate: '2026-11-10',
        status: 'OPEN',
        pegging: [],
      },
    ];
    const { calls } = signedIn(owner, {
      'GET /api/v1/me/permissions': ALL,
      'GET /api/v1/lookups/warehouses': () => json(200, { data: [] }),
      'GET /api/v1/mfg/mrp-runs': () => page([run]),
      'GET /api/v1/mfg/mrp-runs/r1': () => json(200, { data: run }),
      'GET /api/v1/mfg/mrp-runs/r1/suggestions': () => json(200, { data: sug }),
      'GET /api/v1/mfg/mrp-runs/r1/buckets': () => json(200, { data: [] }),
      'GET /api/v1/mfg/mrp-runs/r1/exceptions': () => json(200, { data: [] }),
      'POST /api/v1/mfg/mrp-suggestions/s1/firm': () =>
        json(200, { data: { ...sug[0], status: 'FIRMED' } }),
    });
    renderApp('/m/mfg-mrp');
    const ue = userEvent.setup();
    await ue.click(await screen.findByRole('button', { name: 'Open' }));
    const panel = await screen.findByRole('dialog');
    expect(await within(panel).findByText('Make')).toBeInTheDocument();
    expect(within(panel).getByText('Buy')).toBeInTheDocument();
    expect(within(panel).getByText(/SALES_ORDER SO-1: 20/)).toBeInTheDocument();
    await ue.click(within(panel).getAllByRole('button', { name: 'Firm' })[0]!);
    await screen.findAllByText('Done');
    expect(countCalls(calls, 'POST', '/mfg/mrp-suggestions/s1/firm')).toBe(1);
  });
});

describe('Shop Floor', () => {
  it('says "No data yet" instead of zeros when nothing was logged', async () => {
    signedIn(owner, {
      'GET /api/v1/me/permissions': ALL,
      'GET /api/v1/mfg/work-centers': () => page([]),
      'GET /api/v1/mfg/downtime-reasons': () => json(200, { data: [] }),
      'GET /api/v1/mfg/shopfloor/summary': () =>
        json(200, {
          data: {
            date: '2026-11-09',
            empty: true,
            oee: [],
            rejectionPct: null,
            downtimeMinutes: '0',
            goodPieces: '0',
            hourly: [],
            orders: {},
            overdue: [],
          },
        }),
    });
    renderApp('/m/mfg-shopfloor');
    const ue = userEvent.setup();
    await ue.click(await screen.findByRole('tab', { name: 'Supervisor dashboard' }));
    expect((await screen.findAllByText(/No data yet/)).length).toBeGreaterThan(0);
  });
});
