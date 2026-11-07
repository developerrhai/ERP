// Inventory-slice test helpers: make items and warehouses through the API, create and act on stock
// vouchers, and read the balance / ledger straight from the database. Every call returns the raw
// supertest response unless the name says otherwise.
import request from 'supertest';
import { expect } from 'vitest';
import type { Express } from 'express';
import { invalidateAccessCache } from '../src/core/rbac/access';
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
      hsnSac: '847130',
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
    // Phase 8: vouchers have header + lines and go through approval. These helpers keep the old one-item call
    // shapes and switch approval off for the four voucher pages (the tests that need it switch it back on).
    await noApproval();
    const body =
      pageId === 'inv-opening'
        ? {
            warehouseId: data.warehouse,
            lines: [{ itemId: data.item, qty: data.openingQty, unitCost: data.unitCost }],
          }
        : {
            warehouseId: data.warehouse,
            txType: data.transactionType,
            lines: [{ itemId: data.item, qty: data.qty, unitCost: data.unitCost }],
          };
    const res = await vreq(s, 'post', `/inventory/vouchers/${KIND[pageId] ?? ''}`, h, body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    // Re-read it through the legacy typed API so callers get the old record shape (code, refs, data, version).
    const created = dataOf<{ id: string }>(res);
    const again = await client.get(s, pageId, created.id, h);
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    return dataOf<TypedBody>(again);
  }

  async function noApproval(): Promise<void> {
    await prisma.moduleControl.updateMany({
      where: { pageId: { in: Object.keys(KIND) } },
      data: { approvalRequired: false },
    });
    invalidateAccessCache();
  }
  const KIND: Record<string, string> = {
    'inv-opening': 'opening',
    'inv-transactions': 'transactions',
    'inv-adjustment': 'adjustment',
    'inv-transfer': 'transfer',
  };
  const vreq = (
    s: Signed,
    method: 'post' | 'get',
    path: string,
    h: Hdr | undefined,
    body?: unknown,
  ) => {
    let r = request(app)[method](`/api/v1${path}`).set(s.bearer);
    if (h?.unit) r = r.set('X-Unit-Id', h.unit);
    return body === undefined ? r : r.send(body as object);
  };

  /** Submit (auto-approved) and post a Draft voucher. */
  async function act(
    s: Signed,
    pageId: string,
    id: string,
    name: string,
    h?: Hdr,
    version = 1,
  ): Promise<TypedBody> {
    const kind = KIND[pageId] ?? '';
    const sub = await vreq(s, 'post', `/inventory/vouchers/${kind}/${id}/submit`, h).set(
      'If-Match',
      `"${version}"`,
    );
    expect(sub.status, JSON.stringify(sub.body)).toBe(200);
    const res = await vreq(s, 'post', `/inventory/vouchers/${kind}/${id}/${name}`, h, {});
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
    return act(s, 'inv-opening', v.id, 'post', h, v.version);
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
    return act(s, 'inv-transactions', v.id, 'post', h, v.version);
  }

  async function issue(s: Signed, itemId: string, warehouseId: string, qty: number, h?: Hdr) {
    const v = await voucher(
      s,
      'inv-transactions',
      { transactionType: 'Issue', item: itemId, warehouse: warehouseId, qty },
      h,
    );
    return act(s, 'inv-transactions', v.id, 'post', h, v.version);
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
