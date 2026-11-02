// Inventory slice, masters (docs/phase3-4 C1/C3): the typed schemas of the seven pages, Item Master
// and Warehouse Master rules (codes, barcode, alternate UOM, base UOM freeze, IN_USE delete, undo,
// deactivate), the lookups behind the item / warehouse fields, and permissions.
import request from 'supertest';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { invalidateAccessCache } from '../src/core/rbac/access';
import {
  API,
  auditRows,
  errorOf,
  makeUser,
  newApp,
  prisma,
  signIn,
  signInAs,
  signInOwner,
} from './helpers';
import type { Signed } from './helpers';
import { restoreGlobal, snapshotGlobal } from './phase2-helpers';
import type { GlobalSnapshot } from './phase2-helpers';
import { makeUnit, unitByCode } from './phase3-helpers';
import { dataOf } from './phase4-helpers';
import { inventory, tag } from './phase5-helpers';
import type { TypedBody } from './phase5-helpers';

const app = newApp();
const inv = inventory(app);
const { client } = inv;
let owner: Signed;
let admin: Signed;
let keeper: Signed;
let snap: GlobalSnapshot;

interface Schema {
  pageId: string;
  kind: string;
  readOnly: boolean;
  fields: {
    key: string;
    label: string;
    type: string;
    required: boolean;
    readOnly: boolean;
    options?: string[];
    lookup?: string;
    refPage?: string;
  }[];
  actions: {
    key: string;
    label: string;
    variant: string;
    confirm: string | null;
    allowedFrom: string[];
    requires: string;
    requiresFrom?: string[];
  }[];
  views: {
    key: string;
    label: string;
    columns?: { key: string; label: string; format?: string }[];
  }[];
  filters: {
    key: string;
    label: string;
    type: string;
    param: string;
    options?: string[];
    lookup?: string;
  }[];
  totals: { key: string; label: string; format: string }[];
  statuses: string[];
  editableStatuses: string[];
  listColumns: string[];
  ownerDepartment: string | null;
  approvalRequired: boolean;
}

beforeAll(async () => {
  owner = await signInOwner(app);
  admin = await signInAs(app, 'ADMIN');
  keeper = await signInAs(app, 'MEMBER', { department: 'Warehouse' });
  snap = await snapshotGlobal();
});

afterEach(async () => {
  await restoreGlobal(snap);
});

const TYPED = [
  'inv-items',
  'wms-warehouses',
  'inv-opening',
  'inv-transactions',
  'inv-adjustment',
  'inv-transfer',
  'inv-stock',
];

describe('typed schemas', () => {
  it('all seven pages answer kind "typed" with fields, actions, editableStatuses and the module control', async () => {
    for (const pageId of TYPED) {
      const res = await client.schema(owner, pageId);
      expect(res.status, pageId).toBe(200);
      const s = dataOf<Schema>(res);
      expect(s.kind).toBe('typed');
      expect(s.pageId).toBe(pageId);
      expect(s.fields.length).toBeGreaterThan(5);
      expect(s.fields.every((f) => typeof f.readOnly === 'boolean')).toBe(true);
      expect(s.listColumns.length).toBeLessThanOrEqual(12);
      expect(Array.isArray(s.actions)).toBe(true);
      expect(Array.isArray(s.editableStatuses)).toBe(true);
      expect(s.ownerDepartment).toBe('Warehouse');
      expect(typeof s.approvalRequired).toBe('boolean');
      expect(s.readOnly).toBe(pageId === 'inv-stock');
    }
  });

  it('actions carry label, variant, a confirm message with {code}, and the statuses they apply to', async () => {
    const opening = dataOf<Schema>(await client.schema(owner, 'inv-opening'));
    expect(opening.actions.map((a) => a.key)).toEqual(['post', 'cancel']);
    expect(opening.actions[0]).toEqual({
      key: 'post',
      label: 'Post',
      variant: 'primary',
      confirm: 'Post {code}? Stock will change and the voucher will be locked.',
      allowedFrom: ['Draft'],
      requires: 'edit',
    });
    expect(opening.actions[1]).toMatchObject({
      key: 'cancel',
      allowedFrom: ['Posted'],
      requires: 'delete',
    });
    expect(opening.editableStatuses).toEqual(['Draft']);
    const transfer = dataOf<Schema>(await client.schema(owner, 'inv-transfer'));
    expect(transfer.actions.map((a) => [a.key, a.allowedFrom])).toEqual([
      ['dispatch', ['Draft']],
      ['receive', ['Dispatched']],
      ['cancel', ['Draft', 'Dispatched']],
    ]);
    // Undoing stock that moved needs `delete`; cancelling a Draft only `edit`.
    expect(transfer.actions.map((a) => [a.key, a.requires, a.requiresFrom ?? null])).toEqual([
      ['dispatch', 'edit', null],
      ['receive', 'edit', null],
      ['cancel', 'delete', ['Dispatched']],
    ]);
    for (const pageId of ['inv-transactions', 'inv-adjustment']) {
      const page = dataOf<Schema>(await client.schema(owner, pageId));
      expect(page.actions.map((a) => [a.key, a.requires])).toEqual([
        ['post', 'edit'],
        ['cancel', 'delete'],
      ]);
    }
    expect(transfer.statuses).toEqual(['Draft', 'Dispatched', 'Received', 'Cancelled']);
    const items = dataOf<Schema>(await client.schema(owner, 'inv-items'));
    expect(items.actions.map((a) => [a.key, a.requires])).toEqual([
      ['deactivate', 'edit'],
      ['activate', 'edit'],
    ]);
    expect(dataOf<Schema>(await client.schema(owner, 'inv-stock')).actions).toEqual([]);
  });

  it('item / warehouse fields are lookups; computed fields are read-only; the stock page has filters and totals', async () => {
    const adj = dataOf<Schema>(await client.schema(owner, 'inv-adjustment'));
    const f = (key: string) => adj.fields.find((x) => x.key === key);
    expect(f('item')).toMatchObject({
      type: 'ref',
      required: true,
      lookup: 'items',
      refPage: 'inv-items',
    });
    expect(f('warehouse')).toMatchObject({
      type: 'ref',
      lookup: 'warehouses',
      refPage: 'wms-warehouses',
    });
    for (const key of [
      'systemQty',
      'varianceQty',
      'unitCost',
      'valueImpact',
      'adjustmentNo',
      'status',
    ]) {
      expect(f(key)?.readOnly, key).toBe(true);
    }
    expect(f('reasonCode')?.options).toEqual([
      'Damage',
      'Expiry',
      'Count Correction',
      'Theft/Loss',
      'Other',
    ]);
    const opening = dataOf<Schema>(await client.schema(owner, 'inv-opening'));
    expect(opening.fields.find((x) => x.key === 'openingValue')?.readOnly).toBe(true);
    expect(opening.fields.find((x) => x.key === 'valuationMethod')?.readOnly).toBe(true);
    const stock = dataOf<Schema>(await client.schema(owner, 'inv-stock'));
    expect(stock.fields.map((x) => x.label)).toEqual([
      'Item Code',
      'Item Name',
      'Unit',
      'Warehouse',
      'UOM',
      'On Hand',
      'Avg Rate',
      'Stock Value',
      'Reorder Level',
      'Status',
    ]);
    expect(stock.filters).toEqual([
      {
        key: 'warehouse',
        label: 'Warehouse',
        type: 'select',
        param: 'warehouseId',
        lookup: 'warehouses',
      },
      { key: 'belowReorder', label: 'Below reorder only', type: 'bool', param: 'belowReorder' },
    ]);
    expect(stock.totals.map((t) => t.key)).toEqual(['onHand', 'stockValue']);
    const transactions = dataOf<Schema>(await client.schema(owner, 'inv-transactions'));
    expect(transactions.views.find((v) => v.key === 'ledger')?.columns).toEqual([
      { key: 'postingDate', label: 'Date', format: 'date' },
      { key: 'voucherNo', label: 'Voucher No', format: 'text' },
      { key: 'voucherType', label: 'Type', format: 'text' },
      { key: 'item', label: 'Item', format: 'text' },
      { key: 'warehouse', label: 'Warehouse', format: 'text' },
      { key: 'qtyIn', label: 'In', format: 'qty' },
      { key: 'qtyOut', label: 'Out', format: 'qty' },
      { key: 'rate', label: 'Rate', format: 'money' },
      { key: 'value', label: 'Value', format: 'money' },
      { key: 'balanceQty', label: 'Balance Qty', format: 'qty' },
      { key: 'postedBy', label: 'Posted By', format: 'text' },
    ]);
    expect(transactions.views.find((v) => v.key === 'vouchers')?.columns).toBeUndefined();
    expect(transactions.filters[0]).toMatchObject({
      param: 'view',
      options: ['ledger', 'vouchers'],
    });
    const items = dataOf<Schema>(await client.schema(owner, 'inv-items'));
    expect(items.fields.find((x) => x.key === 'itemCode')).toMatchObject({
      type: 'code',
      required: false,
      readOnly: false,
    });
    expect(items.fields.find((x) => x.key === 'itemType')?.options).toContain('Packing Material');
    expect(items.fields.find((x) => x.key === 'baseUom')?.options).toEqual([
      'Nos',
      'Set',
      'Kg',
      'Meter',
      'Box',
      'Litre',
      'Pair',
      'Sheet',
      'Roll',
    ]);
  });

  it('needs `view`; a department without the Inventory family gets 403; unknown pages 404', async () => {
    const sales = await signInAs(app, 'MEMBER', { department: 'Sales' });
    for (const pageId of TYPED) {
      expect((await client.schema(sales, pageId)).status, pageId).toBe(403);
      expect((await client.list(sales, pageId)).status, pageId).toBe(403);
    }
    expect((await client.schema(owner, 'no-such-page')).status).toBe(404);
  });
});

describe('Item Master', () => {
  it('creates with an auto code ITM/nnnnn, audited; the code is then fixed', async () => {
    const a = await inv.newItem(keeper);
    const b = await inv.newItem(keeper);
    expect(a.code).toMatch(/^ITM\/\d{5}$/);
    expect(Number(b.code.slice(4))).toBe(Number(a.code.slice(4)) + 1);
    expect(a).toMatchObject({ status: 'Active', unitId: null, version: 1 });
    expect(a.data).toMatchObject({
      itemCode: a.code,
      itemType: 'Raw Material',
      baseUom: 'Kg',
      batchTracked: false,
    });
    expect(await auditRows('ITEM_CREATED', { targetId: a.id })).toHaveLength(1);
    const change = await client.patch(keeper, 'inv-items', a.id, 1, { itemCode: 'OTHER-1' });
    expect(change.status).toBe(422);
    expect(errorOf(change).fields?.itemCode).toBeDefined();
    expect((await client.patch(keeper, 'inv-items', a.id, 1, { itemCode: a.code })).status).toBe(
      200,
    );
  });

  it('accepts a user-entered code (upper-cased), 409 DUPLICATE for a taken code or barcode', async () => {
    const code = `ZZ-${tag()}`.slice(0, 20);
    const a = await inv.newItem(keeper, { itemCode: code.toLowerCase(), barcode: `BC${code}` });
    expect(a.code).toBe(code);
    const dupCode = await client.create(keeper, 'inv-items', {
      itemName: 'Other',
      itemType: 'Consumable',
      baseUom: 'Nos',
      itemCode: code,
    });
    expect(dupCode.status).toBe(409);
    expect(errorOf(dupCode)).toMatchObject({
      code: 'DUPLICATE',
      fields: { itemCode: expect.any(String) as string },
    });
    const dupBarcode = await client.create(keeper, 'inv-items', {
      itemName: 'Other',
      itemType: 'Consumable',
      baseUom: 'Nos',
      barcode: `BC${code}`,
    });
    expect(dupBarcode.status).toBe(409);
    expect(errorOf(dupBarcode).fields?.barcode).toBeDefined();
    const other = await inv.newItem(keeper);
    const move = await client.patch(keeper, 'inv-items', other.id, 1, { barcode: `BC${code}` });
    expect(move.status).toBe(409);
    // A barcode is optional, and several items may have none.
    await inv.newItem(keeper);
    await inv.newItem(keeper);
  });

  it('validates fields: name, type, UOM, HSN, alternate UOM with a factor > 0, costs', async () => {
    const base = { itemName: 'Valid Name', itemType: 'Consumable', baseUom: 'Nos' };
    const bad: [Record<string, unknown>, string][] = [
      [{ itemName: 'A' }, 'itemName'],
      [{ itemName: 'x'.repeat(151) }, 'itemName'],
      [{ itemType: 'Gadget' }, 'itemType'],
      [{ baseUom: 'Parsec' }, 'baseUom'],
      [{ itemCode: 'a b' }, 'itemCode'],
      [{ hsnSac: '12345' }, 'hsnSac'],
      [{ altUom: 'Box' }, 'altUomFactor'],
      [{ altUom: 'Box', altUomFactor: 0 }, 'altUomFactor'],
      [{ altUomFactor: 2 }, 'altUom'],
      [{ standardCost: -1 }, 'standardCost'],
      [{ reorderLevel: -5 }, 'reorderLevel'],
      [{ shelfLifeDays: 0 }, 'shelfLifeDays'],
      [{ shelfLifeDays: 2.5 }, 'shelfLifeDays'],
      [{ nope: 1 }, 'nope'],
    ];
    for (const [extra, field] of bad) {
      const res = await client.create(keeper, 'inv-items', { ...base, ...extra });
      expect(res.status, JSON.stringify(extra)).toBe(422);
      expect(errorOf(res).fields?.[field], JSON.stringify(extra)).toBeDefined();
    }
    for (const missing of ['itemName', 'itemType', 'baseUom']) {
      const { [missing]: _drop, ...rest } = base as Record<string, unknown>;
      void _drop;
      const res = await client.create(keeper, 'inv-items', rest);
      expect(errorOf(res).fields?.[missing]).toBe('This field is required.');
    }
    const ok = await client.create(keeper, 'inv-items', {
      ...base,
      hsnSac: '8471 30',
      altUom: 'Box',
      altUomFactor: 12.5,
      standardCost: 10.555,
      sellingPrice: 20,
      reorderLevel: 5,
      shelfLifeDays: 30,
      batchTracked: true,
      serialTracked: false,
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(dataOf<TypedBody>(ok).data).toMatchObject({
      hsnSac: '847130',
      altUom: 'Box',
      altUomFactor: 12.5,
      standardCost: 10.56,
      reorderLevel: 5,
      batchTracked: true,
    });
  });

  it('PATCH needs If-Match, 409 when stale, no-op keeps the version, audits before / after', async () => {
    const item = await inv.newItem(keeper);
    const noHeader = await request(app)
      .patch(`${API}/pages/inv-items/records/${item.id}`)
      .set(keeper.bearer)
      .send({ data: { brand: 'X' } });
    expect(noHeader.status).toBe(400);
    const stale = await client.patch(keeper, 'inv-items', item.id, 7, { brand: 'X' });
    expect(stale.status).toBe(409);
    expect(errorOf(stale).code).toBe('VERSION_CONFLICT');
    const ok = await client.patch(keeper, 'inv-items', item.id, 1, {
      brand: 'Acme',
      reorderLevel: 4,
    });
    expect(dataOf<TypedBody>(ok)).toMatchObject({
      version: 2,
      data: { brand: 'Acme', reorderLevel: 4 },
    });
    expect(ok.headers.etag).toBe('"2"');
    const noop = await client.patch(keeper, 'inv-items', item.id, 2, { brand: 'Acme' });
    expect(dataOf<TypedBody>(noop).version).toBe(2);
    const rows = await auditRows('ITEM_UPDATED', { targetId: item.id });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.detail).toMatchObject({
      before: { brand: null },
      after: { brand: 'Acme', reorderLevel: 4 },
    });
    const cleared = await client.patch(keeper, 'inv-items', item.id, 2, { brand: null });
    expect(dataOf<TypedBody>(cleared).data.brand).toBeNull();
  });

  it('the base UOM is frozen once the item has stock movements', async () => {
    const item = await inv.newItem(owner);
    const wh = await inv.newWarehouse(owner);
    expect((await client.patch(owner, 'inv-items', item.id, 1, { baseUom: 'Box' })).status).toBe(
      200,
    );
    await inv.open(owner, item.id, wh.id, 5, 10);
    const res = await client.patch(owner, 'inv-items', item.id, 2, { baseUom: 'Kg' });
    expect(res.status).toBe(409);
    expect(errorOf(res).code).toBe('CONFLICT');
    expect((await client.patch(owner, 'inv-items', item.id, 2, { brand: 'ok' })).status).toBe(200);
  });

  it('delete: 204-style soft delete with undo; 409 IN_USE with ledger rows or vouchers; then deactivate / activate', async () => {
    const plain = await inv.newItem(owner);
    const del = await client.remove(owner, 'inv-items', plain.id);
    expect(del.status).toBe(200);
    const { undoToken } = dataOf<{ undoToken: string }>(del);
    expect((await client.get(owner, 'inv-items', plain.id)).status).toBe(404);
    expect(
      (await client.restore(owner, 'inv-items', plain.id, { undoToken: 'f'.repeat(32) })).status,
    ).toBe(422);
    expect((await client.restore(owner, 'inv-items', plain.id, { undoToken })).status).toBe(200);
    expect(await auditRows('ITEM_DELETED', { targetId: plain.id })).toHaveLength(1);
    expect(await auditRows('ITEM_RESTORED', { targetId: plain.id })).toHaveLength(1);

    const used = await inv.newItem(owner);
    const wh = await inv.newWarehouse(owner);
    await inv.open(owner, used.id, wh.id, 3, 5);
    const inUse = await client.remove(owner, 'inv-items', used.id);
    expect(inUse.status).toBe(409);
    expect(errorOf(inUse).code).toBe('IN_USE');
    const draftOnly = await inv.newItem(owner);
    await inv.voucher(owner, 'inv-opening', {
      item: draftOnly.id,
      warehouse: wh.id,
      openingQty: 1,
      unitCost: 1,
    });
    expect(errorOf(await client.remove(owner, 'inv-items', draftOnly.id)).code).toBe('IN_USE');

    const off = await client.action(owner, 'inv-items', used.id, 'deactivate');
    expect(off.status).toBe(200);
    expect(dataOf<TypedBody>(off).status).toBe('Inactive');
    expect((await client.action(owner, 'inv-items', used.id, 'deactivate')).status).toBe(409);
    // An inactive item is no longer offered by the lookup and cannot be used on a new voucher.
    const lookup = await client.lookup(owner, 'items', { q: used.code });
    expect((lookup.body as { data: unknown[] }).data).toEqual([]);
    const blocked = await client.create(owner, 'inv-opening', {
      item: used.id,
      warehouse: wh.id,
      openingQty: 1,
      unitCost: 1,
    });
    expect(blocked.status).toBe(422);
    expect(errorOf(blocked).fields?.item).toBeDefined();
    expect(
      dataOf<TypedBody>(await client.action(owner, 'inv-items', used.id, 'activate')).status,
    ).toBe('Active');
    expect((await client.action(owner, 'inv-items', used.id, 'explode')).status).toBe(404);
    expect(await auditRows('ITEM_STATUS_CHANGED', { targetId: used.id })).toHaveLength(2);
  });

  it('list: search, status filter, sort, paging; bad sort / paging -> 422', async () => {
    const marker = tag();
    const a = await inv.newItem(owner, { itemName: `Zeta ${marker}`, standardCost: 30 });
    const b = await inv.newItem(owner, { itemName: `Alpha ${marker}`, standardCost: 10 });
    await client.action(owner, 'inv-items', b.id, 'deactivate').expect(200);
    const list = async (query: Record<string, unknown>) =>
      (await client.list(owner, 'inv-items', { size: 100, ...query })).body as {
        data: TypedBody[];
        meta: { total: number; page: number; size: number };
      };
    expect((await list({ q: marker })).data.map((r) => r.id).sort()).toEqual([a.id, b.id].sort());
    expect((await list({ q: marker, status: 'Inactive' })).data.map((r) => r.id)).toEqual([b.id]);
    expect((await list({ q: marker, sort: 'itemName' })).data.map((r) => r.id)).toEqual([
      b.id,
      a.id,
    ]);
    expect((await list({ q: marker, sort: '-standardCost' })).data.map((r) => r.id)).toEqual([
      a.id,
      b.id,
    ]);
    expect((await list({ q: a.code.toLowerCase() })).data.map((r) => r.id)).toContain(a.id);
    const paged = await list({ q: marker, size: 1, page: 2, sort: 'itemName' });
    expect(paged.meta).toEqual({ page: 2, size: 1, total: 2 });
    for (const query of [{ sort: 'nope' }, { status: 'Bogus' }, { size: 101 }, { bogus: 1 }]) {
      expect((await client.list(owner, 'inv-items', query)).status, JSON.stringify(query)).toBe(
        422,
      );
    }
  });

  it('needs the page permissions: a MEMBER cannot delete; module switches bind everyone', async () => {
    const item = await inv.newItem(keeper);
    expect((await client.remove(keeper, 'inv-items', item.id)).status).toBe(403);
    await prisma.moduleControl.update({
      where: { pageId: 'inv-items' },
      data: { allowAdd: false },
    });
    invalidateAccessCache();
    expect(
      (
        await client.create(owner, 'inv-items', {
          itemName: 'Blocked',
          itemType: 'Consumable',
          baseUom: 'Nos',
        })
      ).status,
    ).toBe(403);
    await prisma.moduleControl.update({
      where: { pageId: 'inv-items' },
      data: { allowAdd: true, enabled: false },
    });
    invalidateAccessCache();
    expect((await client.list(owner, 'inv-items')).status).toBe(403);
  });
});

describe('Warehouse Master', () => {
  it('seeded Main Stores exist, one per unit', async () => {
    const rows = await prisma.warehouse.findMany({
      where: { code: { in: ['TAL-MAIN', 'SAW-MAIN', 'VAR-MAIN'] } },
      include: { unit: true },
      orderBy: { code: 'asc' },
    });
    expect(rows.map((r) => [r.code, r.name, r.unit.code])).toEqual([
      ['SAW-MAIN', 'Sawardari Main Store', 'SAW'],
      ['TAL-MAIN', 'Talwade Main Store', 'TAL'],
      ['VAR-MAIN', 'Varale Main Store', 'VAR'],
    ]);
    const list = await client.list(owner, 'wms-warehouses', { q: 'MAIN', size: 100 });
    expect((list.body as { data: TypedBody[] }).data.map((r) => r.code)).toEqual(['TAL-MAIN']);
    const all = await client.list(
      admin,
      'wms-warehouses',
      { q: 'MAIN', size: 100 },
      { unit: 'all' },
    );
    expect((all.body as { data: TypedBody[] }).data.map((r) => r.code).sort()).toEqual([
      'SAW-MAIN',
      'TAL-MAIN',
      'VAR-MAIN',
    ]);
  });

  it('creates in the context unit with refs.branch, audits; needs a concrete unit', async () => {
    const wh = await inv.newWarehouse(keeper, 'SAW', {
      address: 'Plot 5',
      temperatureZone: 'Cold',
      totalCapacity: 500.5,
      dockDoors: 3,
    });
    const saw = await unitByCode('SAW');
    expect(wh).toMatchObject({
      unitId: saw.id,
      status: 'Active',
      refs: { branch: { id: saw.id, code: 'SAW' } },
    });
    expect(wh.data).toMatchObject({
      branch: saw.id,
      temperatureZone: 'Cold',
      totalCapacity: 500.5,
      dockDoors: 3,
    });
    expect(await auditRows('WAREHOUSE_CREATED', { targetId: wh.id })).toHaveLength(1);
    const allUnits = await client.create(
      admin,
      'wms-warehouses',
      { warehouseCode: `A${tag()}`, warehouseName: 'No unit' },
      { unit: 'all' },
    );
    expect(allUnits.status).toBe(422);
    expect(errorOf(allUnits).code).toBe('CONTEXT_INVALID');
  });

  it('validates: code format and uniqueness, name, zone, dock doors; the code and unit are fixed', async () => {
    const code = `W${tag()}`.slice(0, 20);
    await client
      .create(keeper, 'wms-warehouses', { warehouseCode: code, warehouseName: 'First' })
      .then((r) => expect(r.status).toBe(201));
    const dup = await client.create(keeper, 'wms-warehouses', {
      warehouseCode: code.toLowerCase(),
      warehouseName: 'Second',
    });
    expect(dup.status).toBe(409);
    expect(errorOf(dup).fields?.warehouseCode).toBeDefined();
    const bad: [Record<string, unknown>, string][] = [
      [{ warehouseCode: 'a b' }, 'warehouseCode'],
      [{ warehouseCode: 'X' }, 'warehouseCode'],
      [{ warehouseName: 'X' }, 'warehouseName'],
      [{ temperatureZone: 'Tropical' }, 'temperatureZone'],
      [{ dockDoors: 1.5 }, 'dockDoors'],
      [{ totalCapacity: -1 }, 'totalCapacity'],
      [{ branch: 'x' }, 'branch'],
    ];
    for (const [extra, field] of bad) {
      const res = await client.create(keeper, 'wms-warehouses', {
        warehouseCode: `V${tag()}`.slice(0, 20),
        warehouseName: 'Valid',
        ...extra,
      });
      if (field === 'branch') expect(res.status).toBe(201);
      else expect(errorOf(res).fields?.[field], JSON.stringify(extra)).toBeDefined();
    }
    const wh = await inv.newWarehouse(keeper);
    const rename = await client.patch(keeper, 'wms-warehouses', wh.id, 1, {
      warehouseCode: 'CHANGED',
    });
    expect(rename.status).toBe(422);
    const ok = await client.patch(keeper, 'wms-warehouses', wh.id, 1, {
      manager: 'Ravi',
      warehouseName: 'Renamed Store',
    });
    expect(dataOf<TypedBody>(ok).data).toMatchObject({
      manager: 'Ravi',
      warehouseName: 'Renamed Store',
    });
    expect(
      (await client.patch(keeper, 'wms-warehouses', wh.id, 1, { manager: 'Late' })).status,
    ).toBe(409);
  });

  it('unit isolation: a warehouse of another unit is invisible (404) unless ADMIN+ looks at all units', async () => {
    const wh = await inv.newWarehouse(owner, 'SAW');
    expect((await client.get(owner, 'wms-warehouses', wh.id)).status).toBe(404);
    const saw = await unitByCode('SAW');
    expect((await client.get(owner, 'wms-warehouses', wh.id, { unit: saw.id })).status).toBe(200);
    expect((await client.get(admin, 'wms-warehouses', wh.id, { unit: 'all' })).status).toBe(200);
    const onlyTal = await signInAs(app, 'MEMBER', { department: 'Warehouse', unitCodes: ['TAL'] });
    const forbidden = await client.get(onlyTal, 'wms-warehouses', wh.id, { unit: saw.id });
    expect(forbidden.status).toBe(403);
    expect(errorOf(forbidden).code).toBe('CONTEXT_FORBIDDEN');
  });

  it('delete: 409 IN_USE once stock or a voucher references it; otherwise soft delete + undo; deactivate blocks new vouchers', async () => {
    const empty = await inv.newWarehouse(owner);
    const del = await client.remove(owner, 'wms-warehouses', empty.id);
    expect(del.status).toBe(200);
    await client
      .restore(owner, 'wms-warehouses', empty.id, {
        undoToken: dataOf<{ undoToken: string }>(del).undoToken,
      })
      .then((r) => expect(r.status).toBe(200));
    const used = await inv.newWarehouse(owner);
    const item = await inv.newItem(owner);
    await inv.open(owner, item.id, used.id, 2, 3);
    const inUse = await client.remove(owner, 'wms-warehouses', used.id);
    expect(inUse.status).toBe(409);
    expect(errorOf(inUse).code).toBe('IN_USE');
    expect((await client.action(owner, 'wms-warehouses', used.id, 'deactivate')).status).toBe(200);
    const blocked = await client.create(owner, 'inv-opening', {
      item: item.id,
      warehouse: used.id,
      openingQty: 1,
      unitCost: 1,
    });
    expect(blocked.status).toBe(422);
    expect(errorOf(blocked).fields?.warehouse).toBeDefined();
    expect((await client.lookup(owner, 'warehouses', { q: used.code })).body).toEqual({ data: [] });
    await client
      .action(owner, 'wms-warehouses', used.id, 'activate')
      .then((r) => expect(r.status).toBe(200));
    expect(await auditRows('WAREHOUSE_STATUS_CHANGED', { targetId: used.id })).toHaveLength(2);
  });
});

describe('Unit Master with warehouses', () => {
  it('a unit that has a warehouse cannot be deleted (409 IN_USE)', async () => {
    const unit = await makeUnit();
    try {
      const wh = await client.create(
        owner,
        'wms-warehouses',
        { warehouseCode: `U${tag()}`.slice(0, 20), warehouseName: 'Extra Store' },
        { unit: unit.id },
      );
      expect(wh.status, JSON.stringify(wh.body)).toBe(201);
      const del = await request(app).delete(`${API}/units/${unit.id}`).set(admin.bearer);
      expect(del.status).toBe(409);
      expect(errorOf(del).code).toBe('IN_USE');
    } finally {
      await prisma.warehouse.deleteMany({ where: { unitId: unit.id } });
    }
  });
});

describe('lookups', () => {
  it('items: active only, search by code / name / barcode, {id, code, name, uom}, limit', async () => {
    const marker = tag();
    const a = await inv.newItem(owner, {
      itemName: `Look ${marker}`,
      baseUom: 'Litre',
      barcode: `BAR${marker}`,
    });
    const off = await inv.newItem(owner, { itemName: `Look off ${marker}` });
    await client.action(owner, 'inv-items', off.id, 'deactivate').expect(200);
    const res = await client.lookup(keeper, 'items', { q: marker });
    expect(res.status).toBe(200);
    expect((res.body as { data: unknown[] }).data).toEqual([
      { id: a.id, code: a.code, name: `Look ${marker}`, uom: 'Litre' },
    ]);
    expect(
      ((await client.lookup(keeper, 'items', { q: `BAR${marker}` })).body as { data: unknown[] })
        .data,
    ).toHaveLength(1);
    expect(
      ((await client.lookup(keeper, 'items', { q: '%' })).body as { data: unknown[] }).data,
    ).toEqual([]);
    expect(
      ((await client.lookup(keeper, 'items', { limit: 2 })).body as { data: unknown[] }).data
        .length,
    ).toBeLessThanOrEqual(2);
    for (const query of [{ limit: 0 }, { limit: 51 }, { bogus: 1 }]) {
      expect((await client.lookup(keeper, 'items', query)).status).toBe(422);
    }
  });

  it('warehouses: the context unit by default; unitId needs access; any=true spans units; inactive hidden', async () => {
    const tal = await inv.newWarehouse(owner, 'TAL');
    const saw = await inv.newWarehouse(owner, 'SAW');
    const sawUnit = await unitByCode('SAW');
    const rows = async (s: Signed, query: Record<string, unknown>, h = {}) =>
      (
        (await client.lookup(s, 'warehouses', query, h)).body as {
          data: { id: string; code: string; name: string; unitId: string; unitCode: string }[];
        }
      ).data;
    expect((await rows(keeper, { q: tal.code })).map((r) => r.id)).toEqual([tal.id]);
    expect(await rows(keeper, { q: saw.code })).toEqual([]);
    const inSaw = await rows(keeper, { unitId: sawUnit.id, q: saw.code });
    expect(inSaw.find((r) => r.id === saw.id)).toMatchObject({
      code: saw.code,
      unitCode: 'SAW',
      unitId: sawUnit.id,
    });
    expect((await rows(keeper, { any: 'true', q: saw.code })).map((r) => r.id)).toEqual([saw.id]);
    expect((await rows(keeper, { any: 'true', q: tal.code })).map((r) => r.id)).toEqual([tal.id]);
    const onlyTal = await signInAs(app, 'MEMBER', { department: 'Warehouse', unitCodes: ['TAL'] });
    const forbidden = await client.lookup(onlyTal, 'warehouses', { unitId: sawUnit.id });
    expect(forbidden.status).toBe(403);
    expect(errorOf(forbidden).code).toBe('CONTEXT_FORBIDDEN');
    expect((await client.lookup(onlyTal, 'warehouses', { unitId: 'nope' })).status).toBe(422);
    expect(await rows(admin, { q: saw.code }, { unit: 'all' })).toHaveLength(1);
    const noUnit = await signIn(app, await makeUser({ department: 'Warehouse', unitCodes: [] }));
    expect(await rows(noUnit, {})).toEqual([]);
    await client.action(owner, 'wms-warehouses', tal.id, 'deactivate').expect(200);
    expect(await rows(owner, { q: tal.code })).toEqual([]);
  });

  it('needs view on the page; 401 without a token', async () => {
    const sales = await signInAs(app, 'MEMBER', { department: 'Sales' });
    expect((await client.lookup(sales, 'items')).status).toBe(403);
    expect((await client.lookup(sales, 'warehouses')).status).toBe(403);
    expect((await request(app).get(`${API}/lookups/items`)).status).toBe(401);
  });
});

describe('typed rows and negatives', () => {
  it('rows carry refs for lookup fields; missing ids are 404; ids are validated', async () => {
    const item = await inv.newItem(owner);
    const wh = await inv.newWarehouse(owner);
    const v = await inv.voucher(owner, 'inv-opening', {
      item: item.id,
      warehouse: wh.id,
      openingQty: 2,
      unitCost: 3,
    });
    expect(v.refs).toEqual({
      item: { id: item.id, code: item.code, name: item.data.itemName },
      warehouse: { id: wh.id, code: wh.code, name: wh.data.warehouseName },
    });
    const listed = (await client.list(owner, 'inv-opening', { q: v.code })).body as {
      data: TypedBody[];
    };
    expect(listed.data[0]?.refs.item?.code).toBe(item.code);
    expect(
      (await client.get(owner, 'inv-opening', '00000000-0000-4000-8000-000000000000')).status,
    ).toBe(404);
    expect((await client.get(owner, 'inv-opening', 'nope')).status).toBe(422);
    const badItem = await client.create(owner, 'inv-opening', {
      item: 'not-a-uuid',
      warehouse: wh.id,
      openingQty: 1,
      unitCost: 1,
    });
    expect(errorOf(badItem).fields?.item).toBeDefined();
    const ghost = await client.create(owner, 'inv-opening', {
      item: '00000000-0000-4000-8000-000000000000',
      warehouse: wh.id,
      openingQty: 1,
      unitCost: 1,
    });
    expect(errorOf(ghost).fields?.item).toBeDefined();
  });

  it('Stock Balance is list-only: create / patch / delete / actions answer 405 READ_ONLY or 404', async () => {
    const create = await client.create(owner, 'inv-stock', { itemCode: 'x' });
    expect(create.status).toBe(405);
    expect(errorOf(create).code).toBe('READ_ONLY');
    const zero = '00000000-0000-4000-8000-000000000000';
    const composite = `${zero}_${zero}`;
    expect((await client.patch(owner, 'inv-stock', composite, 1, {})).status).toBe(405);
    expect((await client.remove(owner, 'inv-stock', composite)).status).toBe(405);
    expect((await client.action(owner, 'inv-stock', composite, 'post')).status).toBe(404);
  });

  it('unknown actions are 404; actions need a concrete unit; status endpoint is generic-only', async () => {
    const item = await inv.newItem(owner);
    expect((await client.action(owner, 'inv-items', item.id, 'post')).status).toBe(404);
    const noUnit = await client.action(admin, 'inv-items', item.id, 'deactivate', {}, undefined, {
      unit: 'all',
    });
    expect(noUnit.status).toBe(422);
    expect((await client.status(owner, 'inv-items', item.id, 'Inactive')).status).toBe(404);
    expect((await client.action(owner, 'crm-leads', item.id, 'post')).status).toBe(404);
  });
});
