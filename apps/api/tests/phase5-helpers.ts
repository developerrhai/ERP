// Inventory-slice test helpers: make items and warehouses through the API, create and act on stock
// vouchers, and read the balance / ledger straight from the database. Every call returns the raw
// supertest response unless the name says otherwise.
import { expect } from 'vitest';
import type { Express } from 'express';
import { prisma } from './helpers';
import type { Signed } from './helpers';
import { api, dataOf } from './phase4-helpers';
import type { Hdr, RecordBody } from './phase4-helpers';
import { unitByCode } from './phase3-helpers';

export interface TypedBody extends RecordBody {
  refs: Record<string, { id: string; code: string; name: string }>;
  amount: number | null;
}

let counter = 0;
export const tag = () => `${Date.now().toString(36)}${(counter += 1).toString(36)}`.toUpperCase();

export function inventory(app: Express) {
  const client = api(app);

  async function newItem(s: Signed, extra: Record<string, unknown> = {}): Promise<TypedBody> {
    const res = await client.create(s, 'inv-items', {
      itemName: `Item ${tag()}`,
      itemType: 'Raw Material',
      baseUom: 'Kg',
      ...extra,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return dataOf<TypedBody>(res);
  }

  async function newWarehouse(
    s: Signed,
    unitCode = 'TAL',
    extra: Record<string, unknown> = {},
  ): Promise<TypedBody> {
    const unit = await unitByCode(unitCode);
    const code = `W${tag()}`.slice(0, 20);
    const res = await client.create(
      s,
      'wms-warehouses',
      { warehouseCode: code, warehouseName: `Store ${code}`, ...extra },
      { unit: unit.id },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return dataOf<TypedBody>(res);
  }

  async function voucher(
    s: Signed,
    pageId: string,
    data: Record<string, unknown>,
    h?: Hdr,
  ): Promise<TypedBody> {
    const res = await client.create(s, pageId, data, h);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return dataOf<TypedBody>(res);
  }

  async function act(
    s: Signed,
    pageId: string,
    id: string,
    name: string,
    h?: Hdr,
    body: Record<string, unknown> = {},
  ): Promise<TypedBody> {
    const res = await client.action(s, pageId, id, name, body, undefined, h);
    expect(res.status, `${name}: ${JSON.stringify(res.body)}`).toBe(200);
    return dataOf<TypedBody>(res);
  }

  /** Opening stock posted in one go. */
  async function open(
    s: Signed,
    itemId: string,
    warehouseId: string,
    qty: number,
    cost: number,
    h?: Hdr,
  ) {
    const v = await voucher(
      s,
      'inv-opening',
      { item: itemId, warehouse: warehouseId, openingQty: qty, unitCost: cost },
      h,
    );
    return act(s, 'inv-opening', v.id, 'post', h);
  }

  async function receipt(
    s: Signed,
    itemId: string,
    warehouseId: string,
    qty: number,
    cost: number,
    h?: Hdr,
  ) {
    const v = await voucher(
      s,
      'inv-transactions',
      { transactionType: 'Receipt', item: itemId, warehouse: warehouseId, qty, unitCost: cost },
      h,
    );
    return act(s, 'inv-transactions', v.id, 'post', h);
  }

  async function issue(s: Signed, itemId: string, warehouseId: string, qty: number, h?: Hdr) {
    const v = await voucher(
      s,
      'inv-transactions',
      { transactionType: 'Issue', item: itemId, warehouse: warehouseId, qty },
      h,
    );
    return act(s, 'inv-transactions', v.id, 'post', h);
  }

  return { client, newItem, newWarehouse, voucher, act, open, receipt, issue };
}

export async function balanceOf(itemId: string, warehouseId: string) {
  const row = await prisma.stockBalance.findUnique({
    where: { itemId_warehouseId: { itemId, warehouseId } },
  });
  return {
    onHand: row ? Number(row.onHand) : 0,
    value: row ? Number(row.value) : 0,
    avgRate: row ? Number(row.avgRate) : 0,
    exists: row !== null,
  };
}

export async function ledgerOf(itemId: string, warehouseId?: string) {
  const rows = await prisma.stockLedger.findMany({
    where: { itemId, ...(warehouseId ? { warehouseId } : {}) },
    orderBy: [{ postedAt: 'asc' }, { id: 'asc' }],
  });
  return rows.map((r) => ({
    type: r.voucherType,
    no: r.voucherNo,
    qtyIn: Number(r.qtyIn),
    qtyOut: Number(r.qtyOut),
    rate: Number(r.rate),
    value: Number(r.value),
    balanceQty: Number(r.balanceQty),
    balanceValue: Number(r.balanceValue),
    warehouseId: r.warehouseId,
    unitId: r.unitId,
    reversesId: r.reversesId,
    id: r.id,
  }));
}

/** Σ ledger = balance for the item in every warehouse (qty and value), and no negative balance. */
export async function assertLedgerMatchesBalances(itemIds: string[]): Promise<void> {
  const sums = await prisma.$queryRaw<
    { item_id: string; warehouse_id: string; qty: string; value: string }[]
  >`SELECT item_id, warehouse_id, sum(qty_in - qty_out)::text AS qty, sum(value)::text AS value
    FROM stock_ledger WHERE item_id = ANY(${itemIds}::uuid[]) GROUP BY item_id, warehouse_id`;
  const balances = await prisma.stockBalance.findMany({ where: { itemId: { in: itemIds } } });
  const key = (i: string, w: string) => `${i}|${w}`;
  const bal = new Map(balances.map((b) => [key(b.itemId, b.warehouseId), b]));
  for (const s of sums) {
    const b = bal.get(key(s.item_id, s.warehouse_id));
    expect(b, `balance row for ${s.item_id}/${s.warehouse_id}`).toBeDefined();
    expect(Number(b?.onHand)).toBeCloseTo(Number(s.qty), 6);
    expect(Number(b?.value)).toBeCloseTo(Number(s.value), 6);
    expect(Number(b?.onHand)).toBeGreaterThanOrEqual(0);
    // The running balance of the last entry equals the balance row.
    const last = await prisma.stockLedger.findFirst({
      where: { itemId: s.item_id, warehouseId: s.warehouse_id },
      orderBy: [{ postedAt: 'desc' }, { id: 'desc' }],
    });
    expect(Number(last?.balanceQty)).toBeCloseTo(Number(b?.onHand), 6);
    expect(Number(last?.balanceValue)).toBeCloseTo(Number(b?.value), 6);
  }
  for (const b of balances) {
    if (!sums.some((s) => s.item_id === b.itemId && s.warehouse_id === b.warehouseId)) {
      expect(Number(b.onHand)).toBe(0);
      expect(Number(b.value)).toBe(0);
    }
  }
}
