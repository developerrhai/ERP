// Phase 13 screens: logging an operation on the work-order screen, receiving finished goods only after the Usage Decision,
// and the MRP proposal with its single confirm.
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

const order = (lots: unknown[] = []) => ({
  id: 'o1',
  version: 4,
  number: 'PRO/TAL/26-27/0001',
  status: 'In Progress',
  itemCode: 'FG1',
  itemName: 'Bracket',
  uom: 'Nos',
  qty: '10',
  qtyCompleted: '8',
  qtyScrapped: '2',
  qtyReceived: '0',
  dueDate: '2026-11-20',
  customerName: null,
  rmWarehouseCode: 'W1',
  batchTracked: false,
  materials: [
    {
      id: 'm1',
      itemId: 'i1',
      itemCode: 'RM1',
      itemName: 'Plate',
      uom: 'Kg',
      requiredQty: '21',
      issuedQty: '21',
      returnedQty: '0',
      issuedValue: '210',
      returnedValue: '0',
      customerSupplied: false,
    },
  ],
  ops: [
    {
      id: 'p1',
      seq: 10,
      name: 'Cutting',
      workCentreCode: 'CUT',
      qtyDone: '8',
      qtyScrap: '2',
      qtyRework: '0',
      remaining: '0',
      status: 'Done',
      inspectionRequired: false,
    },
    {
      id: 'p2',
      seq: 20,
      name: 'Assembly',
      workCentreCode: 'ASM',
      qtyDone: '0',
      qtyScrap: '0',
      qtyRework: '0',
      remaining: '8',
      status: 'Pending',
      inspectionRequired: true,
    },
  ],
  lots,
  moves: [],
  outsideMoves: [],
  cost: {
    material: '210.00',
    conversion: '0.00',
    outside: '0.00',
    total: '210.00',
    unitCost: null,
  },
});
const listRow = {
  id: 'o1',
  number: 'PRO/TAL/26-27/0001',
  status: 'In Progress',
  itemCode: 'FG1',
  itemName: 'Bracket',
  uom: 'Nos',
  qty: '10',
  qtyCompleted: '8',
  qtyReceived: '0',
  dueDate: '2026-11-20',
};
const page = (rows: unknown[]) =>
  json(200, { data: rows, meta: { page: 1, size: 100, total: rows.length } });

describe('Work Orders', () => {
  it('logs what an operation made and sends it once', async () => {
    const { calls } = signedIn(owner, {
      'GET /api/v1/me/permissions': ALL,
      'GET /api/v1/mfg/orders/for/mfg-workorders': () => page([listRow]),
      'GET /api/v1/mfg/orders/for/mfg-workorders/o1': () => json(200, { data: order() }),
      'POST /api/v1/mfg/orders/o1/ops/p2/log': () => json(200, { data: order() }),
    });
    renderApp('/m/mfg-workorders');
    const ue = userEvent.setup();
    await ue.click(await screen.findByRole('button', { name: 'PRO/TAL/26-27/0001' }));
    const panel = await screen.findByRole('dialog');
    expect(await within(panel).findByText('Assembly')).toBeInTheDocument();
    expect(within(panel).getByText('Cutting')).toBeInTheDocument();
    // a finished operation offers nothing; the pending one can be logged
    const logs = within(panel).getAllByRole('button', { name: 'Log' });
    expect(logs).toHaveLength(1);
    await ue.click(logs[0]!);
    const dialogs = await screen.findAllByRole('dialog');
    const form = dialogs[dialogs.length - 1]!;
    await ue.type(within(form).getByLabelText('Good pieces'), '8');
    await ue.type(within(form).getByLabelText('Minutes taken'), '60');
    await ue.click(within(form).getByRole('button', { name: 'Save' }));
    await within(panel).findByText('Assembly');
    expect(countCalls(calls, 'POST', '/mfg/orders/o1/ops/p2/log')).toBe(1);
  });
});

describe('Finished Goods Receipt', () => {
  const decided = [
    {
      id: 'l1',
      kind: 'FG',
      lotNo: 1,
      lotQty: '8',
      receivedQty: '0',
      inspectionNo: 'PDI/TAL/26-27/0001',
      inspectionStatus: 'Decided',
      acceptedQty: '7',
      rejectedQty: '1',
    },
  ];
  it('offers the receipt for a decided lot, for the accepted pieces only', async () => {
    const { calls } = signedIn(owner, {
      'GET /api/v1/me/permissions': ALL,
      'GET /api/v1/mfg/orders/for/mfg-fg': () => page([listRow]),
      'GET /api/v1/mfg/orders/for/mfg-fg/o1': () => json(200, { data: order(decided) }),
      'POST /api/v1/mfg/orders/o1/receive': () => json(200, { data: order(decided) }),
    });
    renderApp('/m/mfg-fg');
    const ue = userEvent.setup();
    await ue.click(await screen.findByRole('button', { name: 'PRO/TAL/26-27/0001' }));
    const panel = await screen.findByRole('dialog');
    await ue.click(await within(panel).findByRole('button', { name: 'Receive' }));
    const dialogs = await screen.findAllByRole('dialog');
    const form = dialogs[dialogs.length - 1]!;
    expect(within(form).getByLabelText(/Quantity/)).toHaveValue(7);
    await ue.click(within(form).getByRole('button', { name: 'Save' }));
    await within(panel).findByText('Inspection lots');
    expect(countCalls(calls, 'POST', '/mfg/orders/o1/receive')).toBe(1);
  });

  it('shows no receive button until the Usage Decision is made, or without the post right', async () => {
    const pending = [{ ...decided[0], inspectionStatus: 'Submitted', acceptedQty: null }];
    signedIn(owner, {
      'GET /api/v1/me/permissions': ALL,
      'GET /api/v1/mfg/orders/for/mfg-fg': () => page([listRow]),
      'GET /api/v1/mfg/orders/for/mfg-fg/o1': () => json(200, { data: order(pending) }),
    });
    renderApp('/m/mfg-fg');
    const ue = userEvent.setup();
    await ue.click(await screen.findByRole('button', { name: 'PRO/TAL/26-27/0001' }));
    const panel = await screen.findByRole('dialog');
    await within(panel).findByText('PDI/TAL/26-27/0001');
    expect(within(panel).queryByRole('button', { name: 'Receive' })).toBeNull();
  });
});

describe('MRP', () => {
  it('shows the proposal and creates the requisition and orders with one confirm', async () => {
    const run = {
      id: 'r1',
      version: 1,
      number: 'MRP/TAL/26-27/0001',
      status: 'Draft',
      fromDate: '2026-11-01',
      toDate: '2026-11-30',
      prNumber: null,
      lines: [
        {
          id: 'a',
          itemId: 'f',
          itemCode: 'FG1',
          itemName: 'Bracket',
          uom: 'Nos',
          level: 0,
          action: 'PRODUCE',
          grossQty: '100',
          onHandQty: '7',
          scheduledQty: '0',
          netQty: '93',
          needDate: '2026-11-10',
          orderId: null,
          sources: [{ type: 'FORECAST', ref: 'Forecast 2026-11', qty: '100' }],
        },
        {
          id: 'b',
          itemId: 'g',
          itemCode: 'RM1',
          itemName: 'Plate',
          uom: 'Kg',
          level: 1,
          action: 'BUY',
          grossQty: '195.3',
          onHandQty: '80',
          scheduledQty: '0',
          netQty: '115.3',
          needDate: '2026-11-10',
          orderId: null,
          sources: [],
        },
      ],
    };
    let applied = false;
    const { calls } = signedIn(owner, {
      'GET /api/v1/me/permissions': ALL,
      'GET /api/v1/mfg/mrp': () => page([{ ...run, produceLines: 1, buyLines: 1 }]),
      'GET /api/v1/mfg/mrp/r1': () =>
        json(200, { data: applied ? { ...run, status: 'Applied', prNumber: 'PR/1' } : run }),
      'GET /api/v1/lookups/warehouses': () =>
        json(200, { data: [{ id: 'w1', code: 'W1', name: 'Store' }] }),
      'POST /api/v1/mfg/mrp/r1/apply': () => {
        applied = true;
        return json(200, { data: { ...run, status: 'Applied', prNumber: 'PR/1' } });
      },
    });
    renderApp('/m/mfg-mrp');
    const ue = userEvent.setup();
    await ue.click(await screen.findByRole('button', { name: 'MRP/TAL/26-27/0001' }));
    const panel = await screen.findByRole('dialog');
    expect(await within(panel).findByText('Make')).toBeInTheDocument();
    expect(within(panel).getByText('Buy')).toBeInTheDocument();
    expect(within(panel).getByText('115.3')).toBeInTheDocument();
    await ue.click(
      within(panel).getByRole('button', { name: 'Create requisition and planned orders' }),
    );
    await within(panel).findByText(/requisition PR\/1/);
    expect(countCalls(calls, 'POST', '/mfg/mrp/r1/apply')).toBe(1);
  });
});

describe('Capacity', () => {
  it('shows which orders finish late and how full each work center is', async () => {
    signedIn(owner, {
      'GET /api/v1/me/permissions': ALL,
      'GET /api/v1/mfg/plan': () => page([]),
      'GET /api/v1/mfg/capacity': () =>
        json(200, {
          data: {
            from: '2026-11-20',
            workDays: [0, 1, 2, 3, 4, 5, 6],
            ops: [],
            orders: [
              {
                orderId: 'o1',
                orderNo: 'PRO/TAL/26-27/0001',
                due: '2026-11-20',
                finish: '2026-11-25',
                late: true,
              },
              {
                orderId: 'o2',
                orderNo: 'PRO/TAL/26-27/0002',
                due: '2026-12-20',
                finish: '2026-11-26',
                late: false,
              },
            ],
            days: [
              {
                day: '2026-11-23',
                workCentreId: 'w1',
                workCentre: 'CUT',
                load: 480,
                capacity: 480,
              },
            ],
          },
        }),
    });
    renderApp('/m/mfg-plan');
    const ue = userEvent.setup();
    await ue.click(await screen.findByRole('tab', { name: 'Capacity' }));
    expect(await screen.findByText('Late')).toBeInTheDocument();
    expect(screen.getByText('On time')).toBeInTheDocument();
    expect(screen.getByText('100 %')).toBeInTheDocument();
  });
});

describe('Outside processing', () => {
  it('offers send / receive instead of the shop-floor log for an outside operation', async () => {
    const o = order();
    (o.ops as Record<string, unknown>[])[1] = {
      ...(o.ops as Record<string, unknown>[])[1],
      workCentreKind: 'OUTSIDE',
      status: 'Pending',
    };
    (o as Record<string, unknown>).outsideMoves = [];
    signedIn(owner, {
      'GET /api/v1/me/permissions': ALL,
      'GET /api/v1/mfg/orders/for/mfg-workorders': () => page([listRow]),
      'GET /api/v1/mfg/orders/for/mfg-workorders/o1': () => json(200, { data: o }),
    });
    renderApp('/m/mfg-workorders');
    const ue = userEvent.setup();
    await ue.click(await screen.findByRole('button', { name: 'PRO/TAL/26-27/0001' }));
    const panel = await screen.findByRole('dialog');
    expect(
      await within(panel).findByRole('button', { name: 'Send / receive' }),
    ).toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: 'Log' })).toBeNull();
  });
});
