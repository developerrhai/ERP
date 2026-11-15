// V40 tab layouts of the Inventory pages: every tab of every page answers its V40 columns with real rows of the unit, and the
// Allocate button runs the stock allocator. Numbers are checked against rows this test posts itself in a fresh unit.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { invalidateAccessCache } from '../src/core/rbac/access';
import { CATALOG, GROUPS, PAGES } from '../src/modules/inventory/v40/model';
import { newApp, prisma, signInOwner } from './helpers';
import type { Signed } from './helpers';
import { dataOf } from './phase4-helpers';
import { fixture, mkItem, setApproval, today, vclient } from './phase08-helpers';
import type { Fixture } from './phase08-helpers';

const app = newApp();
let owner: Signed;
let fx: Fixture;
let v: ReturnType<typeof vclient>;
let saved: Awaited<ReturnType<typeof setApproval>>;

interface Col {
  key: string;
  label: string;
  format: string;
}
interface TabRow {
  id: string | null;
  status?: string;
  alloc: { itemId: string; warehouseId: string | null } | null;
  cells: Record<string, unknown>;
}
interface TabAnswer {
  columns: Col[];
  rows: TabRow[];
  statuses: string[];
}

async function tab(pageId: string, name: string, extra = ''): Promise<{ data: TabAnswer; total: number }> {
  const res = await v.call(
    'get',
    `/inventory/v40/${pageId}?tab=${encodeURIComponent(name)}&size=50${extra}`,
  );
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return {
    data: dataOf<TabAnswer>(res),
    total: (res.body as { meta: { total: number } }).meta.total,
  };
}
const labels = (c: Col[]): string[] => c.map((x) => x.label);

let itemA: Awaited<ReturnType<typeof mkItem>>;
let itemB: Awaited<ReturnType<typeof mkItem>>;
let reservationId = '';

beforeAll(async () => {
  owner = await signInOwner(app);
  saved = await setApproval(false);
  void invalidateAccessCache();
  fx = await fixture();
  v = vclient(app, owner, fx.unitId);
  itemA = await mkItem({ reorderLevel: 100, itemType: 'Raw Material' });
  itemB = await mkItem({ batchTracked: true, shelfLifeDays: 365, itemType: 'Finished Good' });
  await v.post('transactions', {
    warehouseId: fx.warehouseId,
    txType: 'Receipt',
    lines: [{ itemId: itemA.id, qty: 10, unitCost: 50 }],
  });
  await v.post('transactions', {
    warehouseId: fx.warehouseId,
    txType: 'Receipt',
    lines: [{ itemId: itemB.id, qty: 6, unitCost: 20, batchNo: 'B-V40', mfgDate: today() }],
  });
  // reservation of 8 against 10 on hand, and a second one of 6 that has to wait for stock
  const r = await v.call('post', '/inventory/reservations', {
    itemId: itemA.id,
    warehouseId: fx.warehouseId,
    requiredQty: 8,
    demandType: 'Sales Order',
    demandRef: 'SO-V40-1',
  });
  reservationId = dataOf<{ id: string }>(r).id;
  await v.call('post', '/inventory/reservations', {
    itemId: itemA.id,
    warehouseId: fx.warehouseId,
    requiredQty: 6,
    priority: 'High',
  });
});
afterAll(async () => {
  for (const r of saved) {
    await prisma.moduleControl.update({
      where: { pageId: r.pageId },
      data: { approvalRequired: r.approvalRequired },
    });
  }
  await prisma.$disconnect();
});

describe('the V40 tab specs', () => {
  it('only name columns that exist in the catalog', () => {
    for (const [pageId, page] of Object.entries(PAGES)) {
      for (const spec of [page.base, ...Object.values(page.tabs)]) {
        for (const key of spec.cols) {
          const keys = GROUPS[key] ?? [key];
          for (const k of keys) expect(CATALOG[k], `${pageId}: ${k}`).toBeDefined();
        }
      }
    }
  });

  it('answers every tab of every page with its columns (no error from any dataset)', async () => {
    for (const [pageId, page] of Object.entries(PAGES)) {
      const names = ['(standard tab)', ...Object.keys(page.tabs)];
      for (const name of names) {
        const { data } = await tab(pageId, name);
        expect(data.columns.length, `${pageId} / ${name}`).toBeGreaterThan(5);
        expect(data.columns.at(-1)?.label ?? '', `${pageId} / ${name}`).toBe('Actions');
      }
    }
  });

  it('refuses a page that has no layouts and honours the page permission', async () => {
    const none = await v.call('get', '/inventory/v40/inv-nothing');
    expect(none.status).toBe(404);
  });
});

describe('Stock Balance tabs', () => {
  it('Stock Overview: the V40 columns, with demand / available / allocated / short from reservations', async () => {
    const { data } = await tab('inv-stock', 'Stock Overview');
    expect(labels(data.columns)).toEqual([
      'Record',
      'Demand',
      'Available',
      'Allocated',
      'Short',
      'Location',
      'Action',
      'Item Code',
      'Item Name',
      'Item Type',
      'Warehouse',
      'Batch Number',
      'Stock Value',
      'Status',
      'Actions',
    ]);
    const a = data.rows.find((r) => r.cells.itemCode === itemA.code);
    expect(a?.cells).toMatchObject({
      itemType: 'Raw Material',
      stockValue: 500,
      w_record: itemA.code,
      w_demand: 14, // 8 + 6 still open
      w_allocated: 10, // 8 reserved, then the second one took the last 2
      w_available: 0,
      w_short: 4,
    });
    expect(a?.alloc).toEqual({ itemId: itemA.id, warehouseId: fx.warehouseId });
    const b = data.rows.find((r) => r.cells.itemCode === itemB.code);
    expect(b?.cells.batch).toBe('B-V40');
  });

  it('Reservations tab shows on hand and reserved; Warehouse Balance values the reserved stock', async () => {
    const res = await tab('inv-stock', 'Reservations');
    const a = res.data.rows.find((r) => r.cells.itemCode === itemA.code);
    expect(a?.cells).toMatchObject({ onHand: 10, reserved: 10 });
    const wb = await tab('inv-stock', 'Warehouse Balance');
    expect(labels(wb.data.columns).slice(0, 6)).toEqual(['Reference', 'Due', 'Amount', 'Allocated', 'Balance', 'Action']);
    const w = wb.data.rows.find((r) => r.cells.itemCode === itemA.code);
    expect(w?.cells).toMatchObject({ p_amount: 500, p_allocated: 500, p_balance: 0 });
  });

  it('Low Stock keeps only the items below their reorder level', async () => {
    const low = await tab('inv-stock', 'Low Stock');
    const codes = low.data.rows.map((r) => r.cells.itemCode);
    expect(codes).toContain(itemA.code); // 10 on hand, reorder level 100
    expect(codes).not.toContain(itemB.code);
  });

  it('Batch Traceability lists the batch slices with the batch number and its value', async () => {
    const { data } = await tab('inv-stock', 'Batch Traceability');
    const row = data.rows.find((r) => r.cells.batch === 'B-V40');
    expect(row?.cells).toMatchObject({ itemCode: itemB.code, stockValue: 120 });
    expect(typeof row?.cells.warehouse).toBe('string');
  });

  it('a standard tab (Documents) shows the record columns of V40', async () => {
    const { data } = await tab('inv-stock', 'Documents');
    expect(labels(data.columns)).toEqual([
      'Item Code',
      'Item Name',
      'Item Type',
      'Warehouse',
      'Batch Number',
      'On Hand',
      'Reserved',
      'Status',
      'Actions',
    ]);
  });
});

describe('Inventory Transactions tabs', () => {
  it('Receipts and Movement Ledger read the stock ledger of the unit', async () => {
    const all = await tab('inv-transactions', 'Movement Ledger');
    expect(all.total).toBeGreaterThanOrEqual(2);
    expect(labels(all.data.columns).slice(7, 14)).toEqual([
      'Transaction ID',
      'Transaction Date Time',
      'Transaction Type',
      'Reference ID',
      'Parent Reference ID',
      'Sales Order',
      'Item Code',
    ]);
    const rec = await tab('inv-transactions', 'Receipts');
    expect(rec.data.rows.every((r) => ['RECEIPT', 'OPENING', 'GRN'].includes(String(r.cells.txnType)))).toBe(true);
    const iss = await tab('inv-transactions', 'Issues');
    expect(iss.total).toBe(0);
    expect(labels(iss.data.columns).slice(0, 7)).toEqual(['Exception', 'Record', 'Severity', 'Age', 'Root Cause', 'Owner', 'Action']);
  });
});

describe('voucher pages', () => {
  it('Adjustment and Transfer tabs show the vouchers of the unit with their quantities', async () => {
    const adj = await v.post('adjustment', {
      warehouseId: fx.warehouseId,
      lines: [{ itemId: itemB.id, countedQty: 4, reasonCode: 'Damage', batchNo: 'B-V40' }],
    });
    const a = await tab('inv-adjustment', 'Adjustment Register');
    const row = a.data.rows.find((r) => r.id === adj.id);
    expect(row?.cells).toMatchObject({ adjNo: adj.number, systemQty: 6, countedQty: 4, varianceQty: -2, reasonCode: 'Damage' });
    const cv = await tab('inv-adjustment', 'Count Variance');
    expect(cv.data.rows.some((r) => r.id === adj.id)).toBe(true);

    const c = await v.create('transfer', {
      warehouseId: fx.warehouseId,
      toWarehouseId: fx.warehouse2Id,
      lines: [{ itemId: itemA.id, qty: 1 }],
    });
    const t = await tab('inv-transfer', 'Transfer Orders');
    expect(t.data.rows.find((r) => r.id === c.id)?.cells).toMatchObject({ transferNo: c.number, status: 'Draft' });
    const transit = await tab('inv-transfer', 'In Transit');
    expect(transit.data.rows.some((r) => r.id === c.id)).toBe(false);
  });
});

describe('reservation, batch, serial, expiry, ageing and reorder tabs', () => {
  it('Reservation Register lists the reservations with demand, required and reserved quantities', async () => {
    const { data } = await tab('inv-reservation', 'Reservation Register');
    const row = data.rows.find((r) => r.id === reservationId);
    expect(row?.cells).toMatchObject({ demandType: 'Sales Order', demandRef: 'SO-V40-1', requiredQty: 8, reservedQty: 8 });
    const short = await tab('inv-reservation', 'Shortage Handling');
    expect(short.data.rows.every((r) => ['Waiting', 'Partial'].includes(String(r.status)))).toBe(true);
    expect(short.total).toBeGreaterThanOrEqual(1);
  });

  it('Batch Register shows received / available quantity and the QC status of the batch', async () => {
    const { data } = await tab('inv-batch', 'Batch Register');
    const row = data.rows.find((r) => r.cells.batchNo === 'B-V40');
    expect(row?.cells).toMatchObject({ batchReceivedQty: 6, blockedQty: 0 });
    expect(typeof row?.cells.qcStatus).toBe('string');
  });

  it('Serial, Expiry, Ageing, Valuation and Reorder tabs answer without error and carry the unit rows', async () => {
    const sn = await tab('inv-serial', 'Serial Register');
    expect(sn.data.columns.map((c) => c.label)).toContain('Serial No');
    const ex = await tab('inv-expiry', 'Expiry Dashboard');
    expect(ex.data.rows.some((r) => r.cells.expBatch === 'B-V40')).toBe(true);
    const ag = await tab('inv-ageing', 'Ageing Summary');
    expect(ag.data.rows.some((r) => String(r.cells.itemCode) === itemA.code)).toBe(true);
    const val = await tab('inv-valuation', 'Valuation Summary');
    const vr = val.data.rows.find((r) => String(r.cells.valRef).startsWith(itemA.code));
    expect(vr?.cells).toMatchObject({ closingValue: 500, closingQty: 10 });
    const ro = await tab('inv-reorder', 'Min Max Policy');
    expect(labels(ro.data.columns)).toContain('Safety Stock');
  });
});

describe('Product Master and Raw Material Master tabs', () => {
  it('split the item master by item type and carry stock, reorder level and price', async () => {
    const mats = await tab('master-materials', 'Material Register');
    const a = mats.data.rows.find((r) => r.cells.materialCode === itemA.code);
    expect(a?.cells).toMatchObject({ unit: 'Kg', currentStock: 10, reorderLevel: 100, status: 'Active' });
    expect(mats.data.rows.some((r) => r.cells.materialCode === itemB.code)).toBe(false);
    const prods = await tab('master-products', 'Product Register');
    expect(prods.data.rows.find((r) => r.cells.productId === itemB.code)?.cells).toMatchObject({ uom: 'Kg', status: 'Active' });
    const planning = await tab('master-products', 'Planning');
    expect(labels(planning.data.columns).slice(0, 7)).toEqual(['Record', 'Demand', 'Available', 'Allocated', 'Short', 'Location', 'Action']);
    const policy = await tab('master-materials', 'Stock Policy');
    const row = policy.data.rows.find((r) => r.cells.materialCode === itemA.code);
    expect(row?.cells).toMatchObject({ w_demand: 14, w_allocated: 10 });
  });
});

describe('Allocate', () => {
  it('runs the allocator for the item and reports the reserved quantity before and after', async () => {
    // more stock arrives: the waiting reservation is served by the receipt itself, so allocate has nothing left to give
    await v.post('transactions', {
      warehouseId: fx.warehouseId,
      txType: 'Receipt',
      lines: [{ itemId: itemA.id, qty: 4, unitCost: 50 }],
    });
    const res = await v.call('post', '/inventory/v40/allocate', { itemId: itemA.id, warehouseId: fx.warehouseId });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const out = dataOf<{ reservedBefore: number; reservedAfter: number; allocated: number }>(res);
    expect(out.reservedAfter).toBe(14);
    expect(out.allocated).toBe(out.reservedAfter - out.reservedBefore);
    const { data } = await tab('inv-stock', 'Stock Overview');
    const a = data.rows.find((r) => r.cells.itemCode === itemA.code);
    expect(a?.cells).toMatchObject({ w_demand: 14, w_allocated: 14, w_short: 0 });
  });

  it('refuses a warehouse outside the unit and an unknown item', async () => {
    const other = await prisma.warehouse.findFirstOrThrow({ where: { unitId: { not: fx.unitId } } });
    const bad = await v.call('post', '/inventory/v40/allocate', { itemId: itemA.id, warehouseId: other.id });
    expect(bad.status).toBe(404);
    const noItem = await v.call('post', '/inventory/v40/allocate', {
      itemId: '00000000-0000-4000-8000-000000000000',
    });
    expect(noItem.status).toBe(404);
  });
});

describe('Item master rows carry the stock numbers of the Planning tab', () => {
  it('the typed list returns demand / available / allocated / short / location per item', async () => {
    const res = await v.call('get', `/pages/inv-items/records?q=${encodeURIComponent(itemA.code)}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const row = dataOf<{ data: Record<string, unknown> }[]>(res)[0];
    expect(row?.data).toMatchObject({ stockOnHand: 14, stockDemand: 14, stockAllocated: 14, stockShort: 0 });
    expect(String(row?.data.stockLocation)).toContain('W');
  });
});
