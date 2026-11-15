// Inventory V40 tabs: the page draws the columns V40 shows on the open tab from /inventory/v40, a column without a source
// prints a dash, Allocate runs the allocator, and the register shapes of Item Master / Stock Balance pick the V40 columns.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { json, makeUser, permissionsRoute, renderApp, signedIn } from '../../../test/helpers';
import type { PageSchema } from '../../generic/engineApi';
import { forcedTabFilters, tabShape } from './itemShapes';
import { cellText } from './V40Cell';

const owner = makeUser({ role: 'SUPER_ADMIN', roleLabel: 'Super Admin', name: 'Owner Person' });
const ALL = permissionsRoute({ view: true, add: true, edit: true, delete: true, approve: true, submit: true, export: true });

const col = (key: string, label: string, format = 'text') => ({ key, label, format });
const page = (rows: unknown[], columns: unknown[], total = rows.length) =>
  json(200, { data: { columns, statuses: [], rows }, meta: { page: 1, size: 10, total, tab: 'x', totals: [] } });

describe('Reservation Register tab', () => {
  const columns = [
    col('w_record', 'Record'),
    col('w_demand', 'Demand', 'qty'),
    col('w_short', 'Short', 'qty'),
    col('w_action', 'Action', 'allocate'),
    col('requiredQty', 'Required Qty', 'qty'),
    col('batchSerial', 'Batch Serial'),
    col('status', 'Status', 'status'),
    col('actions', 'Actions', 'open'),
  ];
  const row = {
    id: 'a1b2c3d4-0000-4000-8000-000000000001',
    version: 3,
    status: 'Partial',
    alloc: { itemId: 'i1', warehouseId: 'w1' },
    cells: { w_record: 'RES/TAL/0001', w_demand: 14, w_short: 4, requiredQty: 8, batchSerial: null, status: 'Partial' },
  };

  it('shows the V40 columns, a dash where there is no value, and runs Allocate on the item', async () => {
    const { calls } = signedIn(owner, {
      'GET /api/v1/me/permissions': ALL,
      'GET /api/v1/inventory/v40/inv-reservation': () => page([row], columns),
      'GET /api/v1/inventory/reservations': () => json(200, { data: [], meta: { page: 1, size: 20, total: 0 } }),
      'GET /api/v1/inventory/holds': () => json(200, { data: [], meta: { page: 1, size: 20, total: 0 } }),
      'POST /api/v1/inventory/v40/allocate': () =>
        json(200, { data: { warehouses: 1, reservedBefore: 8, reservedAfter: 10, allocated: 2, waiting: 1 } }),
    });
    const user = userEvent.setup();
    renderApp('/m/inv-reservation');
    await screen.findByText('RES/TAL/0001');
    const table = screen.getByTestId('inv-v40').querySelector('table') as HTMLElement;
    for (const h of ['Record', 'Demand', 'Short', 'Action', 'Required Qty', 'Batch Serial', 'Status', 'Actions']) {
      expect(within(table).getByRole('columnheader', { name: h })).toBeInTheDocument();
    }
    const tr = screen.getByText('RES/TAL/0001').closest('tr') as HTMLElement;
    expect(within(tr).getByText('14')).toBeInTheDocument();
    expect(within(tr).getAllByText('—').length).toBeGreaterThanOrEqual(1); // Batch Serial has no value
    // the page's own buttons stay on the row, and Move Forward is on the row
    expect(within(tr).getByRole('button', { name: '+7 days' })).toBeInTheDocument();
    expect(within(tr).getByRole('button', { name: 'Move Forward' })).toBeInTheDocument();
    await user.click(within(tr).getByRole('button', { name: 'Allocate' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path.endsWith('/inventory/v40/allocate'))).toBe(true));
    const post = calls.find((c) => c.method === 'POST' && c.path.endsWith('/inventory/v40/allocate'));
    expect(post?.body).toEqual({ itemId: 'i1', warehouseId: 'w1' });
    expect(await screen.findByText(/Allocate: 2 reserved for waiting demand/)).toBeInTheDocument();
  });
});

describe('another V40 tab of a custom page', () => {
  it('asks for the tab by its V40 name and draws that tab columns', async () => {
    const { calls } = signedIn(owner, {
      'GET /api/v1/me/permissions': ALL,
      'GET /api/v1/inventory/serials': () => json(200, { data: [], meta: { page: 1, size: 20, total: 0 } }),
      'GET /api/v1/inventory/v40/inv-serial': () =>
        page([], [col('serialNo', 'Serial No'), col('warrantyEnd', 'Warranty End', 'date'), col('actions', 'Actions', 'open')]),
    });
    renderApp('/m/inv-serial?tab=1');
    expect(await screen.findByRole('columnheader', { name: 'Warranty End' })).toBeInTheDocument();
    const call = calls.find((c) => c.path.endsWith('/inventory/v40/inv-serial'));
    expect(new URL(call?.url ?? '', 'http://test').searchParams.get('tab')).toBe('Ownership History');
    expect(screen.getByText('No records yet.')).toBeInTheDocument();
  });
});

describe('cell text', () => {
  it('prints Indian numbers and dates, and null for no value', () => {
    expect(cellText({ key: 'a', label: 'A', format: 'money' }, 123456.5)).toBe('₹ 1,23,456.5');
    expect(cellText({ key: 'a', label: 'A', format: 'qty' }, 1250.25)).toBe('1,250.25');
    expect(cellText({ key: 'a', label: 'A', format: 'date' }, '2026-11-03')).toBe('03 Nov 2026');
    expect(cellText({ key: 'a', label: 'A', format: 'text' }, null)).toBeNull();
    expect(cellText({ key: 'a', label: 'A', format: 'qty' }, '')).toBeNull();
  });
});

describe('register shapes of Item Master and Stock Balance', () => {
  const field = (key: string, label: string) => ({ key, label, type: 'text', required: false, readOnly: true });
  const itemSchema = {
    pageId: 'inv-items',
    fields: ['itemCode', 'itemName', 'itemType', 'category', 'brand', 'hsnSac', 'baseUom', 'altUom', 'status'].map((k) => field(k, k)),
    listColumns: ['itemCode'],
  } as unknown as PageSchema;
  const stockSchema = {
    pageId: 'inv-stock',
    fields: ['itemCode', 'itemName', 'warehouse', 'onHand', 'stockValue', 'status'].map((k) => field(k, k)),
    listColumns: ['itemCode'],
  } as unknown as PageSchema;

  it('Planning Parameters starts with the allocation columns and Cost & Price has the simulator', () => {
    const planning = tabShape(itemSchema, 'Planning Parameters', 3, true, () => undefined);
    expect(planning?.schema.listColumns.slice(0, 7)).toEqual(['stockRecord', 'stockDemand', 'stockAvailable', 'stockAllocated', 'stockShort', 'stockLocation', 'stockAction']);
    expect(planning?.schema.fields.find((f) => f.key === 'stockDemand')?.label).toBe('Demand');
    expect(planning?.header).toBeNull();
    expect(tabShape(itemSchema, 'Cost & Price', 5, true, () => undefined)?.header).not.toBeNull();
    expect(tabShape(itemSchema, 'Documents', 7, true, () => undefined)).toBeNull();
  });

  it('Warehouse Balance values the reserved stock and Low Stock forces the below-reorder filter', () => {
    const wb = tabShape(stockSchema, 'Warehouse Balance', 1, true, () => undefined);
    expect(wb?.schema.listColumns.slice(0, 6)).toEqual(['payReference', 'payDue', 'payAmount', 'payAllocated', 'payBalance', 'payAction']);
    const row = { id: 'i1_w1', code: 'ITM/1', status: 'OK', data: { itemCode: 'ITM/1', warehouse: 'MAIN', stockValue: 500, reserved: 4, avgRate: 50 } } as never;
    const render = (key: string) => wb?.cellRender(row, { key } as never);
    expect(render('payAmount')).toBe('₹ 500');
    expect(render('payAllocated')).toBe('₹ 200');
    expect(render('payBalance')).toBe('₹ 300');
    expect(render('payReference')).toBe('ITM/1 / MAIN');
    expect(forcedTabFilters('inv-stock', 'Low Stock', 3)).toEqual({ belowReorder: 'true' });
    expect(forcedTabFilters('inv-stock', 'Stock Overview', 0)).toBeUndefined();
  });
});
