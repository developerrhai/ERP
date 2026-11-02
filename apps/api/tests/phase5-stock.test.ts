// Inventory slice, stock (docs/phase3-4 C1/C2): moving-average worked examples, opening stock, receipt /
// issue, adjustment, the two-step transfer (also across units), reversals, no negative stock (also
// under parallel requests), period locks, unit rules, Idempotency-Key, the append-only ledger, the
// ledger and Stock Balance views, previews, audit entries and permissions.
import ExcelJS from 'exceljs';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { invalidateAccessCache } from '../src/core/rbac/access';
import { API, auditRows, errorOf, newApp, prisma, signInAs, signInOwner } from './helpers';
import type { Signed } from './helpers';
import { restoreGlobal, snapshotGlobal } from './phase2-helpers';
import type { GlobalSnapshot } from './phase2-helpers';
import { fyByCode, restorePhase3, snapshotPhase3, unitByCode } from './phase3-helpers';
import type { Phase3Snapshot } from './phase3-helpers';
import { dataOf } from './phase4-helpers';
import { assertLedgerMatchesBalances, balanceOf, inventory, ledgerOf, tag } from './phase5-helpers';
import type { TypedBody } from './phase5-helpers';

const app = newApp();
const inv = inventory(app);
const { client } = inv;
let owner: Signed;
let admin: Signed;
let keeper: Signed;
let SAW: { unit: string };
let TAL: string;
let snapGlobal: GlobalSnapshot;
let snap3: Phase3Snapshot;

beforeAll(async () => {
  owner = await signInOwner(app);
  admin = await signInAs(app, 'ADMIN');
  keeper = await signInAs(app, 'MEMBER', { department: 'Warehouse' });
  SAW = { unit: (await unitByCode('SAW')).id };
  TAL = (await unitByCode('TAL')).id;
  snapGlobal = await snapshotGlobal();
  snap3 = await snapshotPhase3();
});

afterEach(async () => {
  await restoreGlobal(snapGlobal);
  await restorePhase3(snap3);
});

afterAll(async () => {
  await restorePhase3(snap3);
});

/** A fresh item and warehouse in TAL. */
async function pair(extraItem: Record<string, unknown> = {}) {
  const item = await inv.newItem(owner, extraItem);
  const wh = await inv.newWarehouse(owner);
  return { item, wh };
}

const nums = (rows: { qtyIn: number; qtyOut: number; value: number }[]) =>
  rows.map((r) => [r.qtyIn, r.qtyOut, r.value]);

// ---------------------------------------------------------------------------------------------
describe('moving average valuation (worked examples)', () => {
  it('example 1: opening 100 @ 50, receipt 100 @ 60, issue 30, issue the rest', async () => {
    const { item, wh } = await pair();
    await inv.open(owner, item.id, wh.id, 100, 50);
    expect(await balanceOf(item.id, wh.id)).toMatchObject({
      onHand: 100,
      value: 5000,
      avgRate: 50,
    });
    await inv.receipt(owner, item.id, wh.id, 100, 60);
    expect(await balanceOf(item.id, wh.id)).toMatchObject({
      onHand: 200,
      value: 11000,
      avgRate: 55,
    });
    const issued = await inv.issue(owner, item.id, wh.id, 30);
    expect(issued.data).toMatchObject({ unitCost: 55, value: 1650 });
    expect(await balanceOf(item.id, wh.id)).toMatchObject({
      onHand: 170,
      value: 9350,
      avgRate: 55,
    });
    await inv.issue(owner, item.id, wh.id, 170);
    expect(await balanceOf(item.id, wh.id)).toMatchObject({ onHand: 0, value: 0, avgRate: 0 });
    const rows = await ledgerOf(item.id, wh.id);
    expect(rows.map((r) => r.type)).toEqual(['OPENING', 'RECEIPT', 'ISSUE', 'ISSUE']);
    expect(nums(rows)).toEqual([
      [100, 0, 5000],
      [100, 0, 6000],
      [0, 30, -1650],
      [0, 170, -9350],
    ]);
    expect(rows.map((r) => [r.balanceQty, r.balanceValue])).toEqual([
      [100, 5000],
      [200, 11000],
      [170, 9350],
      [0, 0],
    ]);
    await assertLedgerMatchesBalances([item.id]);
  });

  it('example 2: rates are rounded to 6 decimals and values to 2; the last unit takes the whole value', async () => {
    const { item, wh } = await pair();
    await inv.receipt(owner, item.id, wh.id, 3, 10);
    await inv.receipt(owner, item.id, wh.id, 4, 11);
    // 74 / 7 = 10.571428571... -> 10.571429
    expect(await balanceOf(item.id, wh.id)).toMatchObject({
      onHand: 7,
      value: 74,
      avgRate: 10.571429,
    });
    const two = await inv.issue(owner, item.id, wh.id, 2);
    expect(two.data).toMatchObject({ unitCost: 10.571429, value: 21.14 });
    // 74 - 21.14 = 52.86 left on 5 units -> 10.572
    expect(await balanceOf(item.id, wh.id)).toMatchObject({
      onHand: 5,
      value: 52.86,
      avgRate: 10.572,
    });
    const rest = await inv.issue(owner, item.id, wh.id, 5);
    expect(rest.data.value).toBe(52.86);
    expect(await balanceOf(item.id, wh.id)).toMatchObject({ onHand: 0, value: 0 });
    await assertLedgerMatchesBalances([item.id]);
  });

  it('quantities keep 3 decimals; a receipt after stock hit zero starts a new average', async () => {
    const { item, wh } = await pair();
    await inv.receipt(owner, item.id, wh.id, 2.5, 40);
    await inv.issue(owner, item.id, wh.id, 2.5);
    await inv.receipt(owner, item.id, wh.id, 1.125, 80);
    expect(await balanceOf(item.id, wh.id)).toMatchObject({
      onHand: 1.125,
      value: 90,
      avgRate: 80,
    });
    const tooFine = await client.create(owner, 'inv-transactions', {
      transactionType: 'Receipt',
      item: item.id,
      warehouse: wh.id,
      qty: 1.00049,
      unitCost: 1,
    });
    expect(dataOf<TypedBody>(tooFine).data.qty).toBe(1);
  });

  it('every number is a stored decimal: values never drift from the ledger', async () => {
    const { item, wh } = await pair();
    for (const [q, c] of [
      [7, 13.37],
      [3, 9.99],
      [11, 0.01],
      [5, 100],
    ] as const) {
      await inv.receipt(owner, item.id, wh.id, q, c);
    }
    for (const q of [4, 6, 9]) await inv.issue(owner, item.id, wh.id, q);
    await assertLedgerMatchesBalances([item.id]);
  });
});

// ---------------------------------------------------------------------------------------------
describe('numbering and opening stock', () => {
  it('numbers are <PFX>/<UNIT>/<FY>/<0001>, gap-free per type and unit; a deleted draft keeps its number', async () => {
    const { item, wh } = await pair();
    const mk = () =>
      inv.voucher(owner, 'inv-opening', {
        item: item.id,
        warehouse: wh.id,
        openingQty: 1,
        unitCost: 1,
      });
    const a = await mk();
    const b = await mk();
    const c = await mk();
    expect(a.code).toMatch(/^OPN\/TAL\/26-27\/\d{4}$/);
    const n = (v: TypedBody) => Number(v.code.split('/').at(-1));
    expect([n(b), n(c)]).toEqual([n(a) + 1, n(a) + 2]);
    await client.remove(owner, 'inv-opening', b.id).then((r) => expect(r.status).toBe(200));
    const d = await mk();
    expect(n(d)).toBe(n(c) + 1);
    const types = await Promise.all([
      inv.voucher(owner, 'inv-transactions', {
        transactionType: 'Receipt',
        item: item.id,
        warehouse: wh.id,
        qty: 1,
        unitCost: 1,
      }),
      inv.voucher(owner, 'inv-adjustment', {
        item: item.id,
        warehouse: wh.id,
        countedQty: 1,
        reasonCode: 'Other',
      }),
    ]);
    expect(types[0].code).toMatch(/^TXN\/TAL\/26-27\/\d{4}$/);
    expect(types[1].code).toMatch(/^ADJ\/TAL\/26-27\/\d{4}$/);
    const wSaw = await inv.newWarehouse(owner, 'SAW');
    const inSaw = await inv.voucher(
      owner,
      'inv-opening',
      { item: item.id, warehouse: wSaw.id, openingQty: 1, unitCost: 1 },
      SAW,
    );
    expect(inSaw.code).toMatch(/^OPN\/SAW\/26-27\/0001$/);
    const other = await inv.newWarehouse(owner, 'TAL');
    const dest = await inv.voucher(owner, 'inv-transfer', {
      sourceWarehouse: other.id,
      destinationWarehouse: wSaw.id,
      item: item.id,
      requestedQty: 1,
    });
    expect(dest.code).toMatch(/^TRF\/TAL\/26-27\/\d{4}$/);
  });

  it('20 parallel creates give 20 distinct consecutive numbers', async () => {
    const { item, wh } = await pair();
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        client.create(owner, 'inv-opening', {
          item: item.id,
          warehouse: wh.id,
          openingQty: 1,
          unitCost: 1,
        }),
      ),
    );
    expect(results.map((r) => r.status)).toEqual(Array(20).fill(201));
    const nos = results
      .map((r) => Number(dataOf<TypedBody>(r).code.split('/').at(-1)))
      .sort((x, y) => x - y);
    expect(nos).toEqual(Array.from({ length: 20 }, (_, i) => (nos[0] ?? 0) + i));
  });

  it('shows the computed value; posts qty at cost; only before any other movement of the item in the warehouse', async () => {
    const { item, wh } = await pair();
    const v = await inv.voucher(owner, 'inv-opening', {
      item: item.id,
      warehouse: wh.id,
      openingQty: 4,
      unitCost: 12.5,
      batchSerial: 'B-1',
    });
    expect(v.data).toMatchObject({
      openingValue: 50,
      valuationMethod: 'Moving Average',
      openingQty: 4,
      unitCost: 12.5,
      batchSerial: 'B-1',
      status: 'Draft',
    });
    expect(v.data.financialYear).toBe('FY 2026-27');
    const posted = await inv.act(owner, 'inv-opening', v.id, 'post');
    expect(posted).toMatchObject({ status: 'Posted', amount: 50 });
    // Another movement now exists, so a second opening cannot be posted.
    const again = await inv.voucher(owner, 'inv-opening', {
      item: item.id,
      warehouse: wh.id,
      openingQty: 1,
      unitCost: 1,
    });
    const res = await client.action(owner, 'inv-opening', again.id, 'post');
    expect(res.status).toBe(409);
    expect(errorOf(res).code).toBe('CONFLICT');
    // A draft opening loses to a receipt posted first.
    const { item: i2, wh: w2 } = await pair();
    const draft = await inv.voucher(owner, 'inv-opening', {
      item: i2.id,
      warehouse: w2.id,
      openingQty: 1,
      unitCost: 1,
    });
    await inv.receipt(owner, i2.id, w2.id, 5, 5);
    expect((await client.action(owner, 'inv-opening', draft.id, 'post')).status).toBe(409);
    // Another warehouse of the same item is still free.
    const w3 = await inv.newWarehouse(owner);
    await inv.open(owner, item.id, w3.id, 1, 1);
  });

  it('validates the draft: quantity > 0, cost >= 0, active item and warehouse, warehouse in the context unit', async () => {
    const { item, wh } = await pair();
    const base = { item: item.id, warehouse: wh.id, openingQty: 1, unitCost: 1 };
    const bad: [Record<string, unknown>, string][] = [
      [{ openingQty: 0 }, 'openingQty'],
      [{ openingQty: -3 }, 'openingQty'],
      [{ unitCost: -1 }, 'unitCost'],
      [{ unitCost: undefined }, 'unitCost'],
      [{ openingQty: undefined }, 'openingQty'],
      [{ item: undefined }, 'item'],
      [{ warehouse: undefined }, 'warehouse'],
      [{ postingDate: '2025-01-01' }, 'postingDate'],
      [{ postingDate: '2027-04-01' }, 'postingDate'],
      [{ postingDate: '2026-02-30' }, 'postingDate'],
      [{ openingValue: 5 }, 'openingValue'],
      [{ extra: 1 }, 'extra'],
    ];
    for (const [extra, field] of bad) {
      const res = await client.create(owner, 'inv-opening', { ...base, ...extra });
      if (field === 'openingValue') {
        // Read-only fields are ignored, not errors.
        expect(res.status).toBe(201);
        continue;
      }
      expect(res.status, JSON.stringify(extra)).toBe(422);
      expect(errorOf(res).fields?.[field], JSON.stringify(extra)).toBeDefined();
    }
    const sawWh = await inv.newWarehouse(owner, 'SAW');
    const wrongUnit = await client.create(owner, 'inv-opening', { ...base, warehouse: sawWh.id });
    expect(wrongUnit.status).toBe(422);
    expect(errorOf(wrongUnit).fields?.warehouse).toContain('another unit');
    const allUnits = await client.create(admin, 'inv-opening', base, { unit: 'all' });
    expect(allUnits.status).toBe(422);
    expect(errorOf(allUnits).code).toBe('CONTEXT_INVALID');
    const ok = await client.create(owner, 'inv-opening', { ...base, postingDate: '2026-06-15' });
    expect(dataOf<TypedBody>(ok).data.postingDate).toBe('2026-06-15');
  });
});

// ---------------------------------------------------------------------------------------------
describe('receipt and issue', () => {
  it('a receipt needs a unit cost; an issue ignores it and leaves at the average rate', async () => {
    const { item, wh } = await pair();
    const noCost = await client.create(owner, 'inv-transactions', {
      transactionType: 'Receipt',
      item: item.id,
      warehouse: wh.id,
      qty: 1,
    });
    expect(errorOf(noCost).fields?.unitCost).toBeDefined();
    await inv.receipt(owner, item.id, wh.id, 10, 20);
    const draft = await inv.voucher(owner, 'inv-transactions', {
      transactionType: 'Issue',
      item: item.id,
      warehouse: wh.id,
      qty: 4,
      unitCost: 999,
    });
    expect(draft.data.unitCost).toBeNull();
    const posted = await inv.act(owner, 'inv-transactions', draft.id, 'post');
    expect(posted.data).toMatchObject({ unitCost: 20, value: 80, transactionType: 'Issue' });
    const bad = await client.create(owner, 'inv-transactions', {
      transactionType: 'Transfer',
      item: item.id,
      warehouse: wh.id,
      qty: 1,
    });
    expect(errorOf(bad).fields?.transactionType).toBeDefined();
    expect(
      errorOf(
        await client.create(owner, 'inv-transactions', {
          transactionType: 'Issue',
          item: item.id,
          warehouse: wh.id,
          qty: 0,
        }),
      ).fields?.qty,
    ).toBeDefined();
  });

  it('never goes negative: 409 INSUFFICIENT_STOCK, nothing written, the voucher stays Draft', async () => {
    const { item, wh } = await pair();
    await inv.receipt(owner, item.id, wh.id, 5, 10);
    const draft = await inv.voucher(owner, 'inv-transactions', {
      transactionType: 'Issue',
      item: item.id,
      warehouse: wh.id,
      qty: 5.001,
    });
    const res = await client.action(owner, 'inv-transactions', draft.id, 'post');
    expect(res.status).toBe(409);
    expect(errorOf(res).code).toBe('INSUFFICIENT_STOCK');
    expect(await balanceOf(item.id, wh.id)).toMatchObject({ onHand: 5, value: 50 });
    expect(await ledgerOf(item.id, wh.id)).toHaveLength(1);
    expect(dataOf<TypedBody>(await client.get(owner, 'inv-transactions', draft.id)).status).toBe(
      'Draft',
    );
    const empty = await pair();
    const none = await inv.voucher(owner, 'inv-transactions', {
      transactionType: 'Issue',
      item: empty.item.id,
      warehouse: empty.wh.id,
      qty: 1,
    });
    expect(errorOf(await client.action(owner, 'inv-transactions', none.id, 'post')).code).toBe(
      'INSUFFICIENT_STOCK',
    );
    expect((await balanceOf(empty.item.id, empty.wh.id)).exists).toBe(false);
  });

  it('two simultaneous issues of the last unit: exactly one succeeds', async () => {
    const { item, wh } = await pair();
    await inv.open(owner, item.id, wh.id, 1, 100);
    const a = await inv.voucher(owner, 'inv-transactions', {
      transactionType: 'Issue',
      item: item.id,
      warehouse: wh.id,
      qty: 1,
    });
    const b = await inv.voucher(owner, 'inv-transactions', {
      transactionType: 'Issue',
      item: item.id,
      warehouse: wh.id,
      qty: 1,
    });
    const [ra, rb] = await Promise.all([
      client.action(owner, 'inv-transactions', a.id, 'post'),
      client.action(owner, 'inv-transactions', b.id, 'post'),
    ]);
    expect([ra.status, rb.status].sort()).toEqual([200, 409]);
    const loser = ra.status === 409 ? ra : rb;
    expect(errorOf(loser).code).toBe('INSUFFICIENT_STOCK');
    expect(await balanceOf(item.id, wh.id)).toMatchObject({ onHand: 0, value: 0 });
    expect((await ledgerOf(item.id, wh.id)).filter((r) => r.type === 'ISSUE')).toHaveLength(1);
    await assertLedgerMatchesBalances([item.id]);
  });

  it('6 parallel issues of 1 on stock of 4: exactly 4 succeed; the same voucher posted twice at once posts once', async () => {
    const { item, wh } = await pair();
    await inv.open(owner, item.id, wh.id, 4, 25);
    const vouchers = await Promise.all(
      Array.from({ length: 6 }, () =>
        inv.voucher(owner, 'inv-transactions', {
          transactionType: 'Issue',
          item: item.id,
          warehouse: wh.id,
          qty: 1,
        }),
      ),
    );
    const results = await Promise.all(
      vouchers.map((v) => client.action(owner, 'inv-transactions', v.id, 'post')),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(4);
    expect(
      results
        .filter((r) => r.status === 409)
        .every((r) => errorOf(r).code === 'INSUFFICIENT_STOCK'),
    ).toBe(true);
    expect(await balanceOf(item.id, wh.id)).toMatchObject({ onHand: 0, value: 0 });
    await assertLedgerMatchesBalances([item.id]);

    const { item: i2, wh: w2 } = await pair();
    await inv.receipt(owner, i2.id, w2.id, 10, 3);
    const one = await inv.voucher(owner, 'inv-transactions', {
      transactionType: 'Issue',
      item: i2.id,
      warehouse: w2.id,
      qty: 2,
    });
    const twice = await Promise.all([
      client.action(owner, 'inv-transactions', one.id, 'post'),
      client.action(owner, 'inv-transactions', one.id, 'post'),
    ]);
    expect(twice.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await balanceOf(i2.id, w2.id)).toMatchObject({ onHand: 8, value: 24 });
  });
});

// ---------------------------------------------------------------------------------------------
describe('adjustment', () => {
  it('previews the system quantity and rate; counted above or below books the variance at the average', async () => {
    const { item, wh } = await pair({ standardCost: 7 });
    const empty = await client.preview(owner, 'inv-adjustment', {
      itemId: item.id,
      warehouseId: wh.id,
    });
    expect(dataOf<Record<string, number>>(empty)).toMatchObject({
      systemQty: 0,
      avgRate: 0,
      unitCost: 7,
    });
    await inv.open(owner, item.id, wh.id, 10, 20);
    expect(
      dataOf<Record<string, number>>(
        await client.preview(owner, 'inv-adjustment', { itemId: item.id, warehouseId: wh.id }),
      ),
    ).toMatchObject({
      systemQty: 10,
      avgRate: 20,
      unitCost: 20,
      stockValue: 200,
    });
    // Counted 12: +2 at 20.
    const up = await inv.voucher(owner, 'inv-adjustment', {
      item: item.id,
      warehouse: wh.id,
      countedQty: 12,
      reasonCode: 'Count Correction',
    });
    expect(up.data).toMatchObject({ systemQty: 10, varianceQty: 2, unitCost: 20, valueImpact: 40 });
    const posted = await inv.act(owner, 'inv-adjustment', up.id, 'post');
    expect(posted.data).toMatchObject({
      systemQty: 10,
      varianceQty: 2,
      unitCost: 20,
      valueImpact: 40,
      status: 'Posted',
    });
    expect(await balanceOf(item.id, wh.id)).toMatchObject({ onHand: 12, value: 240, avgRate: 20 });
    // Counted 9: -3 at 20.
    const down = await inv.voucher(owner, 'inv-adjustment', {
      item: item.id,
      warehouse: wh.id,
      countedQty: 9,
      reasonCode: 'Damage',
    });
    const d = await inv.act(owner, 'inv-adjustment', down.id, 'post');
    expect(d.data).toMatchObject({ systemQty: 12, varianceQty: -3, valueImpact: -60 });
    expect(await balanceOf(item.id, wh.id)).toMatchObject({ onHand: 9, value: 180 });
    // Counted equal: posted, no ledger entry.
    const same = await inv.voucher(owner, 'inv-adjustment', {
      item: item.id,
      warehouse: wh.id,
      countedQty: 9,
      reasonCode: 'Other',
    });
    const s = await inv.act(owner, 'inv-adjustment', same.id, 'post');
    expect(s.data).toMatchObject({ varianceQty: 0, valueImpact: 0, status: 'Posted' });
    expect((await ledgerOf(item.id, wh.id)).filter((r) => r.type === 'ADJUSTMENT')).toHaveLength(2);
    await assertLedgerMatchesBalances([item.id]);
  });

  it('the system quantity is a snapshot taken at post; with no average the standard cost values the gain', async () => {
    const { item, wh } = await pair({ standardCost: 8 });
    const draft = await inv.voucher(owner, 'inv-adjustment', {
      item: item.id,
      warehouse: wh.id,
      countedQty: 5,
      reasonCode: 'Count Correction',
    });
    // Stock arrives between creating and posting the count.
    await inv.receipt(owner, item.id, wh.id, 3, 10);
    const posted = await inv.act(owner, 'inv-adjustment', draft.id, 'post');
    expect(posted.data).toMatchObject({
      systemQty: 3,
      varianceQty: 2,
      unitCost: 10,
      valueImpact: 20,
    });
    const { item: i2, wh: w2 } = await pair({ standardCost: 8 });
    const first = await inv.voucher(owner, 'inv-adjustment', {
      item: i2.id,
      warehouse: w2.id,
      countedQty: 5,
      reasonCode: 'Other',
    });
    const p = await inv.act(owner, 'inv-adjustment', first.id, 'post');
    expect(p.data).toMatchObject({ systemQty: 0, varianceQty: 5, unitCost: 8, valueImpact: 40 });
    expect(await balanceOf(i2.id, w2.id)).toMatchObject({ onHand: 5, value: 40, avgRate: 8 });
  });

  it('a reason code from the list is required; counted quantity may be 0 but not negative', async () => {
    const { item, wh } = await pair();
    const base = { item: item.id, warehouse: wh.id, countedQty: 1, reasonCode: 'Damage' };
    for (const reason of ['Damage', 'Expiry', 'Count Correction', 'Theft/Loss', 'Other']) {
      expect(
        (await client.create(owner, 'inv-adjustment', { ...base, reasonCode: reason })).status,
      ).toBe(201);
    }
    expect(
      errorOf(await client.create(owner, 'inv-adjustment', { ...base, reasonCode: 'Whim' })).fields
        ?.reasonCode,
    ).toBeDefined();
    expect(
      errorOf(await client.create(owner, 'inv-adjustment', { ...base, reasonCode: undefined }))
        .fields?.reasonCode,
    ).toBe('This field is required.');
    expect((await client.create(owner, 'inv-adjustment', { ...base, countedQty: 0 })).status).toBe(
      201,
    );
    expect(
      errorOf(await client.create(owner, 'inv-adjustment', { ...base, countedQty: -1 })).fields
        ?.countedQty,
    ).toBeDefined();
    expect(
      errorOf(await client.create(owner, 'inv-adjustment', { ...base, countedQty: undefined }))
        .fields?.countedQty,
    ).toBeDefined();
  });

  it('previews validate their input; other pages have none (404)', async () => {
    const { item, wh } = await pair();
    expect(
      (await client.preview(owner, 'inv-adjustment', { itemId: 'x', warehouseId: wh.id })).status,
    ).toBe(422);
    expect((await client.preview(owner, 'inv-adjustment', {})).status).toBe(422);
    expect(
      (
        await client.preview(owner, 'inv-adjustment', {
          itemId: item.id,
          warehouseId: '00000000-0000-4000-8000-000000000000',
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await client.preview(owner, 'inv-adjustment', {
          itemId: item.id,
          warehouseId: wh.id,
          bogus: 1,
        })
      ).status,
    ).toBe(422);
    for (const pageId of ['crm-leads', 'inv-items', 'inv-opening', 'inv-stock', 'no-such-page']) {
      expect(
        (await client.preview(owner, pageId, { itemId: item.id, warehouseId: wh.id })).status,
        pageId,
      ).toBe(404);
    }
    const sawWh = await inv.newWarehouse(owner, 'SAW');
    expect(
      (await client.preview(keeper, 'inv-adjustment', { itemId: item.id, warehouseId: sawWh.id }))
        .status,
    ).toBe(404);
    const sales = await signInAs(app, 'MEMBER', { department: 'Sales' });
    expect(
      (await client.preview(sales, 'inv-adjustment', { itemId: item.id, warehouseId: wh.id }))
        .status,
    ).toBe(403);
  });
});

// ---------------------------------------------------------------------------------------------
describe('transfer', () => {
  it('dispatch takes stock out at the average rate; receive adds it at that rate and value; Received Qty must equal Dispatched Qty', async () => {
    const { item, wh } = await pair();
    const dest = await inv.newWarehouse(owner, 'TAL');
    await inv.open(owner, item.id, wh.id, 10, 30);
    await inv.open(owner, item.id, dest.id, 10, 50);
    expect(
      dataOf<Record<string, number>>(
        await client.preview(owner, 'inv-transfer', { itemId: item.id, warehouseId: wh.id }),
      ),
    ).toEqual({ available: 10, avgRate: 30 });
    const t = await inv.voucher(owner, 'inv-transfer', {
      sourceWarehouse: wh.id,
      destinationWarehouse: dest.id,
      item: item.id,
      requestedQty: 4,
      vehicleRef: 'MH12-1',
      expectedReceipt: '2026-12-01',
    });
    expect(t.data).toMatchObject({
      requestedQty: 4,
      dispatchedQty: null,
      receivedQty: null,
      inTransit: null,
      vehicleRef: 'MH12-1',
    });
    const sent = await inv.act(owner, 'inv-transfer', t.id, 'dispatch');
    expect(sent).toMatchObject({ status: 'Dispatched', amount: 120 });
    expect(sent.data).toMatchObject({ dispatchedQty: 4, inTransit: 4, receivedQty: null });
    expect(await balanceOf(item.id, wh.id)).toMatchObject({ onHand: 6, value: 180 });
    expect(await balanceOf(item.id, dest.id)).toMatchObject({ onHand: 10, value: 500 });
    const wrong = await client.action(owner, 'inv-transfer', t.id, 'receive', { receivedQty: 3 });
    expect(wrong.status).toBe(422);
    expect(errorOf(wrong).fields?.receivedQty).toContain('equal');
    const got = await inv.act(owner, 'inv-transfer', t.id, 'receive');
    expect(got.status).toBe('Received');
    expect(got.data).toMatchObject({ receivedQty: 4, inTransit: 0, dispatchedQty: 4 });
    // 4 units at 30 join 10 units at 50: 620 over 14 units.
    expect(await balanceOf(item.id, dest.id)).toMatchObject({
      onHand: 14,
      value: 620,
      avgRate: 44.285714,
    });
    const rows = await ledgerOf(item.id);
    expect(
      rows
        .filter((r) => r.type.startsWith('TRANSFER'))
        .map((r) => [r.type, r.qtyIn, r.qtyOut, r.value]),
    ).toEqual([
      ['TRANSFER_OUT', 0, 4, -120],
      ['TRANSFER_IN', 4, 0, 120],
    ]);
    await assertLedgerMatchesBalances([item.id]);
    // No second receive, no cancel after receipt.
    expect((await client.action(owner, 'inv-transfer', t.id, 'receive')).status).toBe(409);
    expect((await client.action(owner, 'inv-transfer', t.id, 'cancel')).status).toBe(409);
  });

  it('across units: the source is in the context unit, the destination in any active unit; receive from either end', async () => {
    const item = await inv.newItem(owner);
    const src = await inv.newWarehouse(owner, 'TAL');
    const dst = await inv.newWarehouse(owner, 'SAW');
    await inv.open(owner, item.id, src.id, 20, 10);
    const t = await inv.voucher(owner, 'inv-transfer', {
      sourceWarehouse: src.id,
      destinationWarehouse: dst.id,
      item: item.id,
      requestedQty: 8,
    });
    expect(t.unitId).toBe(TAL);
    expect(t.refs.destinationWarehouse?.id).toBe(dst.id);
    // The destination is in SAW, so the voucher is visible there too; the source side is not usable from SAW.
    expect(dataOf<TypedBody>(await client.get(owner, 'inv-transfer', t.id, SAW)).id).toBe(t.id);
    const wrongSide = await client.action(
      owner,
      'inv-transfer',
      t.id,
      'dispatch',
      {},
      undefined,
      SAW,
    );
    expect(wrongSide.status).toBe(422);
    expect(errorOf(wrongSide).code).toBe('CONTEXT_INVALID');
    await inv.act(owner, 'inv-transfer', t.id, 'dispatch');
    await inv.act(owner, 'inv-transfer', t.id, 'receive', SAW);
    const rows = await ledgerOf(item.id);
    const unitOf = Object.fromEntries(rows.map((r) => [r.type, r.unitId]));
    expect(unitOf.TRANSFER_OUT).toBe(TAL);
    expect(unitOf.TRANSFER_IN).toBe(SAW.unit);
    expect(await balanceOf(item.id, dst.id)).toMatchObject({ onHand: 8, value: 80, avgRate: 10 });
    expect(await balanceOf(item.id, src.id)).toMatchObject({ onHand: 12, value: 120 });
    // Stock Balance shows each end in its own unit.
    const inTal = (await client.list(owner, 'inv-stock', { q: item.code })).body as {
      data: TypedBody[];
    };
    const inSaw = (await client.list(owner, 'inv-stock', { q: item.code }, SAW)).body as {
      data: TypedBody[];
    };
    expect(inTal.data.map((r) => r.data.onHand)).toEqual([12]);
    expect(inSaw.data.map((r) => r.data.onHand)).toEqual([8]);
    // A user who works only in a third unit does not see the voucher.
    const varale = await signInAs(app, 'MEMBER', { department: 'Warehouse', unitCodes: ['VAR'] });
    expect((await client.get(varale, 'inv-transfer', t.id)).status).toBe(404);
  });

  it('create rules: source in the context unit, destination active and different; dispatch needs the stock', async () => {
    const { item, wh } = await pair();
    const dest = await inv.newWarehouse(owner, 'TAL');
    const sawWh = await inv.newWarehouse(owner, 'SAW');
    const base = {
      sourceWarehouse: wh.id,
      destinationWarehouse: dest.id,
      item: item.id,
      requestedQty: 2,
    };
    expect(
      errorOf(await client.create(owner, 'inv-transfer', { ...base, destinationWarehouse: wh.id }))
        .fields?.destinationWarehouse,
    ).toBeDefined();
    expect(
      errorOf(await client.create(owner, 'inv-transfer', { ...base, sourceWarehouse: sawWh.id }))
        .fields?.sourceWarehouse,
    ).toContain('another unit');
    expect(
      errorOf(await client.create(owner, 'inv-transfer', { ...base, requestedQty: 0 })).fields
        ?.requestedQty,
    ).toBeDefined();
    expect(
      errorOf(
        await client.create(owner, 'inv-transfer', { ...base, destinationWarehouse: undefined }),
      ).fields?.destinationWarehouse,
    ).toBeDefined();
    expect(
      errorOf(await client.create(owner, 'inv-transfer', { ...base, expectedReceipt: 'soon' }))
        .fields?.expectedReceipt,
    ).toBeDefined();
    await client.action(owner, 'wms-warehouses', dest.id, 'deactivate').expect(200);
    expect(
      errorOf(await client.create(owner, 'inv-transfer', base)).fields?.destinationWarehouse,
    ).toBeDefined();
    await client.action(owner, 'wms-warehouses', dest.id, 'activate').expect(200);
    const t = await inv.voucher(owner, 'inv-transfer', base);
    const res = await client.action(owner, 'inv-transfer', t.id, 'dispatch');
    expect(res.status).toBe(409);
    expect(errorOf(res).code).toBe('INSUFFICIENT_STOCK');
    expect(dataOf<TypedBody>(await client.get(owner, 'inv-transfer', t.id)).status).toBe('Draft');
    const tooMuch = await client.action(owner, 'inv-transfer', t.id, 'dispatch', {
      dispatchedQty: 5,
    });
    expect(tooMuch.status).toBe(422);
    expect(errorOf(tooMuch).fields?.dispatchedQty).toBeDefined();
  });

  it('cancel: a Draft just closes; a Dispatched transfer is reversed; a destination turned inactive blocks receive', async () => {
    const { item, wh } = await pair();
    const dest = await inv.newWarehouse(owner, 'TAL');
    await inv.open(owner, item.id, wh.id, 10, 6);
    const draft = await inv.voucher(owner, 'inv-transfer', {
      sourceWarehouse: wh.id,
      destinationWarehouse: dest.id,
      item: item.id,
      requestedQty: 3,
    });
    expect((await inv.act(owner, 'inv-transfer', draft.id, 'cancel')).status).toBe('Cancelled');
    expect(await ledgerOf(item.id)).toHaveLength(1);

    const t = await inv.voucher(owner, 'inv-transfer', {
      sourceWarehouse: wh.id,
      destinationWarehouse: dest.id,
      item: item.id,
      requestedQty: 3,
    });
    await inv.act(owner, 'inv-transfer', t.id, 'dispatch');
    expect(await balanceOf(item.id, wh.id)).toMatchObject({ onHand: 7, value: 42 });
    await client.action(owner, 'wms-warehouses', dest.id, 'deactivate').expect(200);
    const blocked = await client.action(owner, 'inv-transfer', t.id, 'receive');
    expect(blocked.status).toBe(422);
    expect(errorOf(blocked).fields?.destinationWarehouse).toBeDefined();
    await client.action(owner, 'wms-warehouses', dest.id, 'activate').expect(200);
    await inv.act(owner, 'inv-transfer', t.id, 'cancel');
    expect(await balanceOf(item.id, wh.id)).toMatchObject({ onHand: 10, value: 60, avgRate: 6 });
    const rows = await ledgerOf(item.id, wh.id);
    expect(rows.map((r) => r.type)).toEqual(['OPENING', 'TRANSFER_OUT', 'REVERSAL']);
    expect(rows[2]?.reversesId).toBe(rows[1]?.id);
    expect((await client.action(owner, 'inv-transfer', t.id, 'receive')).status).toBe(409);
    expect(dataOf<TypedBody>(await client.get(owner, 'inv-transfer', t.id)).status).toBe(
      'Cancelled',
    );
    await assertLedgerMatchesBalances([item.id]);
  });
});

// ---------------------------------------------------------------------------------------------
describe('reversal (cancelling a posted voucher)', () => {
  it('cancelling a receipt takes the same quantity and value back out and restores the balance', async () => {
    const { item, wh } = await pair();
    await inv.open(owner, item.id, wh.id, 10, 10);
    const r = await inv.receipt(owner, item.id, wh.id, 5, 40);
    expect(await balanceOf(item.id, wh.id)).toMatchObject({ onHand: 15, value: 300, avgRate: 20 });
    const c = await inv.act(owner, 'inv-transactions', r.id, 'cancel');
    expect(c.status).toBe('Cancelled');
    expect(await balanceOf(item.id, wh.id)).toMatchObject({ onHand: 10, value: 100, avgRate: 10 });
    const rows = await ledgerOf(item.id, wh.id);
    expect(rows.map((x) => x.type)).toEqual(['OPENING', 'RECEIPT', 'REVERSAL']);
    expect(rows[2]).toMatchObject({ qtyIn: 0, qtyOut: 5, value: -200, reversesId: rows[1]?.id });
    expect((await client.action(owner, 'inv-transactions', r.id, 'cancel')).status).toBe(409);
    await assertLedgerMatchesBalances([item.id]);
  });

  it('cancelling an issue puts the stock back at its original rate and value', async () => {
    const { item, wh } = await pair();
    await inv.open(owner, item.id, wh.id, 7, 3);
    await inv.receipt(owner, item.id, wh.id, 3, 7);
    const i = await inv.issue(owner, item.id, wh.id, 4);
    const before = await balanceOf(item.id, wh.id);
    await inv.act(owner, 'inv-transactions', i.id, 'cancel');
    const after = await balanceOf(item.id, wh.id);
    expect(after.onHand).toBe(before.onHand + 4);
    expect(after.value).toBeCloseTo(before.value + Number(i.data.value), 2);
    expect(after).toMatchObject({ onHand: 10, value: 42, avgRate: 4.2 });
    const rev = (await ledgerOf(item.id, wh.id)).at(-1);
    expect(rev).toMatchObject({
      type: 'REVERSAL',
      qtyIn: 4,
      qtyOut: 0,
      value: Number(i.data.value),
    });
    await assertLedgerMatchesBalances([item.id]);
  });

  it('cancelling a receipt whose stock is gone -> 409 INSUFFICIENT_STOCK and the voucher stays Posted', async () => {
    const { item, wh } = await pair();
    const r = await inv.receipt(owner, item.id, wh.id, 5, 10);
    await inv.issue(owner, item.id, wh.id, 3);
    const res = await client.action(owner, 'inv-transactions', r.id, 'cancel');
    expect(res.status).toBe(409);
    expect(errorOf(res).code).toBe('INSUFFICIENT_STOCK');
    expect(dataOf<TypedBody>(await client.get(owner, 'inv-transactions', r.id)).status).toBe(
      'Posted',
    );
    expect(await balanceOf(item.id, wh.id)).toMatchObject({ onHand: 2, value: 20 });
    expect((await ledgerOf(item.id, wh.id)).map((x) => x.type)).toEqual(['RECEIPT', 'ISSUE']);
  });

  it('opening and adjustments reverse too; a Draft (non-transfer) cannot be cancelled', async () => {
    const { item, wh } = await pair();
    const o = await inv.open(owner, item.id, wh.id, 5, 10);
    const a = await inv.voucher(owner, 'inv-adjustment', {
      item: item.id,
      warehouse: wh.id,
      countedQty: 8,
      reasonCode: 'Other',
    });
    await inv.act(owner, 'inv-adjustment', a.id, 'post');
    // The opening cannot be undone while the adjusted quantity depends on it ... it can: 8 units, 5 leave.
    await inv.act(owner, 'inv-adjustment', a.id, 'cancel');
    expect(await balanceOf(item.id, wh.id)).toMatchObject({ onHand: 5, value: 50 });
    await inv.act(owner, 'inv-opening', o.id, 'cancel');
    expect(await balanceOf(item.id, wh.id)).toMatchObject({ onHand: 0, value: 0, avgRate: 0 });
    const draft = await inv.voucher(owner, 'inv-opening', {
      item: item.id,
      warehouse: wh.id,
      openingQty: 1,
      unitCost: 1,
    });
    expect((await client.action(owner, 'inv-opening', draft.id, 'cancel')).status).toBe(409);
    await assertLedgerMatchesBalances([item.id]);
  });
});

// ---------------------------------------------------------------------------------------------
describe('drafts: only a Draft is editable or deletable', () => {
  it('edit with If-Match, re-validated; locked after posting; delete + undo only while Draft', async () => {
    const { item, wh } = await pair();
    const v = await inv.voucher(owner, 'inv-opening', {
      item: item.id,
      warehouse: wh.id,
      openingQty: 2,
      unitCost: 5,
    });
    const noHeader = await request(app)
      .patch(`${API}/pages/inv-opening/records/${v.id}`)
      .set(owner.bearer)
      .send({ data: { openingQty: 3 } });
    expect(noHeader.status).toBe(400);
    expect((await client.patch(owner, 'inv-opening', v.id, 9, { openingQty: 3 })).status).toBe(409);
    const edited = await client.patch(owner, 'inv-opening', v.id, 1, {
      openingQty: 3,
      unitCost: 6,
    });
    expect(dataOf<TypedBody>(edited)).toMatchObject({
      version: 2,
      data: { openingQty: 3, unitCost: 6, openingValue: 18 },
    });
    expect((await client.patch(owner, 'inv-opening', v.id, 2, { openingQty: 0 })).status).toBe(422);
    expect(
      dataOf<TypedBody>(await client.patch(owner, 'inv-opening', v.id, 2, { openingQty: 3 }))
        .version,
    ).toBe(2);
    await client
      .patch(owner, 'inv-opening', v.id, 2, { batchSerial: null })
      .then((r) => expect(r.status).toBe(200));
    expect(await auditRows('VOUCHER_UPDATED', { targetId: v.id })).toHaveLength(1);

    const del = await client.remove(owner, 'inv-opening', v.id);
    expect(del.status).toBe(200);
    expect((await client.get(owner, 'inv-opening', v.id)).status).toBe(404);
    expect((await client.action(owner, 'inv-opening', v.id, 'post')).status).toBe(404);
    const back = await client.restore(owner, 'inv-opening', v.id, {
      undoToken: dataOf<{ undoToken: string }>(del).undoToken,
    });
    expect(back.status).toBe(200);
    expect(dataOf<TypedBody>(back).code).toBe(v.code);
    await inv.act(owner, 'inv-opening', v.id, 'post');
    const locked = await client.patch(owner, 'inv-opening', v.id, 5, { openingQty: 9 });
    expect(locked.status).toBe(409);
    expect(errorOf(locked).code).toBe('RECORD_LOCKED');
    expect(errorOf(await client.remove(owner, 'inv-opening', v.id)).code).toBe('RECORD_LOCKED');
    expect((await client.action(owner, 'inv-opening', v.id, 'post')).status).toBe(409);
    expect(await auditRows('VOUCHER_DELETED', { targetId: v.id })).toHaveLength(1);
    expect(await auditRows('VOUCHER_RESTORED', { targetId: v.id })).toHaveLength(1);
  });

  it('edits keep the unit rules (warehouse of another unit, inactive item) and a transfer cannot be edited after dispatch', async () => {
    const { item, wh } = await pair();
    const sawWh = await inv.newWarehouse(owner, 'SAW');
    const v = await inv.voucher(owner, 'inv-opening', {
      item: item.id,
      warehouse: wh.id,
      openingQty: 2,
      unitCost: 5,
    });
    expect(
      errorOf(await client.patch(owner, 'inv-opening', v.id, 1, { warehouse: sawWh.id })).fields
        ?.warehouse,
    ).toContain('another unit');
    const dest = await inv.newWarehouse(owner, 'TAL');
    await inv.open(owner, item.id, dest.id, 5, 1);
    const t = await inv.voucher(owner, 'inv-transfer', {
      sourceWarehouse: dest.id,
      destinationWarehouse: wh.id,
      item: item.id,
      requestedQty: 1,
    });
    expect(
      dataOf<TypedBody>(await client.patch(owner, 'inv-transfer', t.id, 1, { requestedQty: 2 }))
        .data.requestedQty,
    ).toBe(2);
    await inv.act(owner, 'inv-transfer', t.id, 'dispatch');
    expect(
      errorOf(await client.patch(owner, 'inv-transfer', t.id, 2, { requestedQty: 1 })).code,
    ).toBe('RECORD_LOCKED');
    await client.action(owner, 'inv-items', item.id, 'deactivate').expect(200);
    const posting = await client.action(owner, 'inv-opening', v.id, 'post');
    expect(posting.status).toBe(422);
    expect(errorOf(posting).fields?.item).toBeDefined();
  });

  it('the list shows only live vouchers (deleted=true for the deleted ones); search and status filter work', async () => {
    const { item, wh } = await pair();
    const marker = tag();
    const a = await inv.voucher(owner, 'inv-transactions', {
      transactionType: 'Receipt',
      item: item.id,
      warehouse: wh.id,
      qty: 1,
      unitCost: 1,
      reference: `REF-${marker}`,
    });
    const b = await inv.voucher(owner, 'inv-transactions', {
      transactionType: 'Receipt',
      item: item.id,
      warehouse: wh.id,
      qty: 2,
      unitCost: 1,
      reference: `REF-${marker}`,
    });
    await inv.act(owner, 'inv-transactions', b.id, 'post');
    await client.remove(owner, 'inv-transactions', a.id).then((r) => expect(r.status).toBe(200));
    const q = async (query: Record<string, unknown>) =>
      (await client.list(owner, 'inv-transactions', { view: 'vouchers', ...query })).body as {
        data: TypedBody[];
        meta: { total: number };
      };
    expect((await q({ q: marker })).data.map((r) => r.id)).toEqual([b.id]);
    expect((await q({ q: marker, status: 'Draft' })).data).toEqual([]);
    expect((await q({ q: marker, deleted: 'true' })).data.map((r) => r.id)).toEqual([a.id]);
    expect((await q({ q: b.code })).data.map((r) => r.id)).toEqual([b.id]);
    expect((await q({ q: item.code, sort: 'transactionNo' })).data.length).toBeGreaterThan(0);
    expect(
      (await client.list(owner, 'inv-transactions', { view: 'vouchers', sort: 'nope' })).status,
    ).toBe(422);
  });
});

// ---------------------------------------------------------------------------------------------
describe('financial year and unit rules', () => {
  it('a closed FY blocks create, post, dispatch and cancel (409 PERIOD_CLOSED); posting dates stay inside the FY', async () => {
    const { item, wh } = await pair();
    const old = await fyByCode('2025-26');
    const h = { fy: old.id };
    const open = await inv.voucher(
      owner,
      'inv-opening',
      { item: item.id, warehouse: wh.id, openingQty: 5, unitCost: 2 },
      h,
    );
    expect(open.fyId).toBe(old.id);
    expect(open.code).toMatch(/^OPN\/TAL\/25-26\/\d{4}$/);
    expect(open.data.postingDate).toBe('2026-03-31');
    const posted = await inv.act(owner, 'inv-opening', open.id, 'post', h);
    expect(posted.status).toBe('Posted');
    const draft = await inv.voucher(
      owner,
      'inv-transactions',
      { transactionType: 'Receipt', item: item.id, warehouse: wh.id, qty: 1, unitCost: 1 },
      h,
    );
    const dest = await inv.newWarehouse(owner, 'TAL');
    const transfer = await inv.voucher(
      owner,
      'inv-transfer',
      { sourceWarehouse: wh.id, destinationWarehouse: dest.id, item: item.id, requestedQty: 1 },
      h,
    );
    await inv.act(owner, 'inv-transfer', transfer.id, 'dispatch', h);
    const draftTransfer = await inv.voucher(
      owner,
      'inv-transfer',
      { sourceWarehouse: wh.id, destinationWarehouse: dest.id, item: item.id, requestedQty: 1 },
      h,
    );
    await prisma.financialYear.update({ where: { id: old.id }, data: { status: 'CLOSED' } });
    const checks = [
      await client.create(
        owner,
        'inv-opening',
        { item: item.id, warehouse: wh.id, openingQty: 1, unitCost: 1 },
        h,
      ),
      await client.action(owner, 'inv-transactions', draft.id, 'post', {}, undefined, h),
      await client.action(owner, 'inv-transfer', draftTransfer.id, 'dispatch', {}, undefined, h),
      await client.action(owner, 'inv-transfer', transfer.id, 'receive', {}, undefined, h),
      await client.action(owner, 'inv-transfer', transfer.id, 'cancel', {}, undefined, h),
      await client.action(owner, 'inv-opening', open.id, 'cancel', {}, undefined, h),
    ];
    for (const res of checks) {
      expect(res.status, JSON.stringify(res.body)).toBe(409);
      expect(errorOf(res).code).toBe('PERIOD_CLOSED');
    }
    expect(await balanceOf(item.id, wh.id)).toMatchObject({ onHand: 4 });
    // Reading is fine, and so is the current year.
    expect((await client.get(owner, 'inv-opening', open.id, h)).status).toBe(200);
    const current = await inv.voucher(owner, 'inv-opening', {
      item: item.id,
      warehouse: dest.id,
      openingQty: 1,
      unitCost: 1,
    });
    expect(current.code).toMatch(/\/26-27\//);
  });

  it('actions need a concrete unit that matches the voucher, and a visible voucher', async () => {
    const { item, wh } = await pair();
    const v = await inv.voucher(owner, 'inv-opening', {
      item: item.id,
      warehouse: wh.id,
      openingQty: 1,
      unitCost: 1,
    });
    const all = await client.action(admin, 'inv-opening', v.id, 'post', {}, undefined, {
      unit: 'all',
    });
    expect(all.status).toBe(422);
    expect(errorOf(all).code).toBe('CONTEXT_INVALID');
    const other = await client.action(owner, 'inv-opening', v.id, 'post', {}, undefined, SAW);
    expect(other.status).toBe(404);
    expect(
      (await client.action(owner, 'inv-opening', '00000000-0000-4000-8000-000000000000', 'post'))
        .status,
    ).toBe(404);
    expect(dataOf<TypedBody>(await client.get(owner, 'inv-opening', v.id)).status).toBe('Draft');
  });
});

// ---------------------------------------------------------------------------------------------
describe('Idempotency-Key on actions', () => {
  it('a repeated key returns the first result and writes nothing twice', async () => {
    const { item, wh } = await pair();
    const v = await inv.voucher(owner, 'inv-opening', {
      item: item.id,
      warehouse: wh.id,
      openingQty: 3,
      unitCost: 4,
    });
    const key = `post-${tag()}`;
    const first = await client.action(owner, 'inv-opening', v.id, 'post', {}, key);
    const second = await client.action(owner, 'inv-opening', v.id, 'post', {}, key);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.headers['idempotent-replay']).toBe('true');
    expect(first.headers['idempotent-replay']).toBeUndefined();
    expect(dataOf<TypedBody>(second).status).toBe('Posted');
    expect(await ledgerOf(item.id, wh.id)).toHaveLength(1);
    expect(await auditRows('VOUCHER_POSTED', { targetId: v.id })).toHaveLength(1);
    // Without a key a repeat is refused (already posted).
    expect((await client.action(owner, 'inv-opening', v.id, 'post')).status).toBe(409);
  });

  it('the same key for another request is 409 CONFLICT; keys are per user; bad keys 400; parallel repeats act once', async () => {
    const { item, wh } = await pair();
    await inv.open(owner, item.id, wh.id, 10, 1);
    const a = await inv.voucher(owner, 'inv-transactions', {
      transactionType: 'Issue',
      item: item.id,
      warehouse: wh.id,
      qty: 1,
    });
    const b = await inv.voucher(owner, 'inv-transactions', {
      transactionType: 'Issue',
      item: item.id,
      warehouse: wh.id,
      qty: 1,
    });
    const key = `k-${tag()}`;
    await client
      .action(owner, 'inv-transactions', a.id, 'post', {}, key)
      .then((r) => expect(r.status).toBe(200));
    const reuse = await client.action(owner, 'inv-transactions', b.id, 'post', {}, key);
    expect(reuse.status).toBe(409);
    expect(errorOf(reuse).code).toBe('CONFLICT');
    expect(
      (await client.action(owner, 'inv-transactions', b.id, 'post', {}, 'has space')).status,
    ).toBe(400);
    const par = `par-${tag()}`;
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        client.action(owner, 'inv-transactions', b.id, 'post', {}, par),
      ),
    );
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    expect(await balanceOf(item.id, wh.id)).toMatchObject({ onHand: 8 });
    expect((await ledgerOf(item.id, wh.id)).filter((r) => r.type === 'ISSUE')).toHaveLength(2);
  });

  it('transfer steps are idempotent as well; a failed action does not burn the key', async () => {
    const { item, wh } = await pair();
    const dest = await inv.newWarehouse(owner, 'TAL');
    const t = await inv.voucher(owner, 'inv-transfer', {
      sourceWarehouse: wh.id,
      destinationWarehouse: dest.id,
      item: item.id,
      requestedQty: 2,
    });
    const key = `d-${tag()}`;
    expect((await client.action(owner, 'inv-transfer', t.id, 'dispatch', {}, key)).status).toBe(
      409,
    );
    await inv.open(owner, item.id, wh.id, 5, 10);
    expect((await client.action(owner, 'inv-transfer', t.id, 'dispatch', {}, key)).status).toBe(
      200,
    );
    expect(
      (await client.action(owner, 'inv-transfer', t.id, 'dispatch', {}, key)).headers[
        'idempotent-replay'
      ],
    ).toBe('true');
    const rkey = `r-${tag()}`;
    await client
      .action(owner, 'inv-transfer', t.id, 'receive', {}, rkey)
      .then((r) => expect(r.status).toBe(200));
    await client
      .action(owner, 'inv-transfer', t.id, 'receive', {}, rkey)
      .then((r) => expect(r.headers['idempotent-replay']).toBe('true'));
    expect(await balanceOf(item.id, dest.id)).toMatchObject({ onHand: 2, value: 20 });
  });
});

// ---------------------------------------------------------------------------------------------
describe('the ledger is append-only', () => {
  it('UPDATE, DELETE and TRUNCATE are refused by the database; so are impossible rows', async () => {
    const { item, wh } = await pair();
    await inv.open(owner, item.id, wh.id, 2, 2);
    await expect(
      prisma.$executeRaw`UPDATE stock_ledger SET rate = 1 WHERE item_id = ${item.id}::uuid`,
    ).rejects.toThrow(/append-only/);
    await expect(
      prisma.$executeRaw`DELETE FROM stock_ledger WHERE item_id = ${item.id}::uuid`,
    ).rejects.toThrow(/append-only/);
    await expect(prisma.$executeRaw`TRUNCATE stock_ledger`).rejects.toThrow(/append-only/);
    expect(await ledgerOf(item.id, wh.id)).toHaveLength(1);
    const row = (await ledgerOf(item.id, wh.id))[0];
    const insert = (qIn: number, qOut: number, bal: number) =>
      prisma.$executeRaw`INSERT INTO stock_ledger (id, posting_date, unit_id, warehouse_id, item_id, qty_in, qty_out, rate, value, balance_qty, balance_value, voucher_type, voucher_id, voucher_no, created_by_id)
        VALUES (gen_random_uuid(), '2026-06-01', ${TAL}::uuid, ${wh.id}::uuid, ${item.id}::uuid, ${qIn}, ${qOut}, 1, 1, ${bal}, 1, 'RECEIPT', gen_random_uuid(), 'X', ${owner.user.id}::uuid)`;
    await expect(insert(1, 1, 1)).rejects.toThrow();
    await expect(insert(0, 0, 1)).rejects.toThrow();
    await expect(insert(1, 0, -1)).rejects.toThrow();
    expect(row?.type).toBe('OPENING');
    await expect(
      prisma.$executeRaw`UPDATE stock_balances SET on_hand = -1 WHERE item_id = ${item.id}::uuid`,
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------------------------
describe('Inventory Transactions (ledger view) and Stock Balance', () => {
  it('lists the ledger by default, newest first, with the columns of the contract; ?view=vouchers lists vouchers', async () => {
    const { item, wh } = await pair();
    await inv.open(owner, item.id, wh.id, 10, 5);
    const rec = await inv.receipt(owner, item.id, wh.id, 5, 8);
    await inv.act(owner, 'inv-transactions', rec.id, 'cancel');
    const res = await client.list(owner, 'inv-transactions', { q: item.code, size: 50 });
    expect(res.status).toBe(200);
    const body = res.body as { data: TypedBody[]; meta: { total: number } };
    expect(body.meta.total).toBe(3);
    expect(body.data.map((r) => r.data.voucherType)).toEqual(['REVERSAL', 'RECEIPT', 'OPENING']);
  });

  it('ledger rows: date, voucher no, type, item, warehouse, in, out, rate, value, balance qty, posted by', async () => {
    const { item, wh } = await pair();
    await inv.open(owner, item.id, wh.id, 10, 5);
    const issue = await inv.issue(owner, item.id, wh.id, 4);
    const rows = (
      (await client.list(owner, 'inv-transactions', { q: item.code, sort: 'postedAt' })).body as {
        data: TypedBody[];
      }
    ).data;
    expect(rows).toHaveLength(2);
    const last = rows[1];
    expect(last).toMatchObject({
      code: issue.code,
      status: 'Posted',
      unitId: TAL,
      data: {
        voucherNo: issue.code,
        voucherType: 'ISSUE',
        qtyIn: 0,
        qtyOut: 4,
        rate: 5,
        value: -20,
        balanceQty: 6,
        postedBy: owner.user.name,
      },
      refs: { item: { id: item.id, code: item.code }, warehouse: { id: wh.id, code: wh.code } },
    });
    expect(last?.data.postingDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(
      (
        (await client.list(owner, 'inv-transactions', { q: issue.code })).body as {
          data: TypedBody[];
        }
      ).data,
    ).toHaveLength(1);
    const asc = (await client.list(owner, 'inv-transactions', { q: item.code, sort: 'value' }))
      .body as { data: TypedBody[] };
    expect(asc.data.map((r) => r.data.value)).toEqual([-20, 50]);
    const vouchers = (
      await client.list(owner, 'inv-transactions', { view: 'vouchers', q: issue.code })
    ).body as { data: TypedBody[] };
    expect(vouchers.data[0]).toMatchObject({ id: issue.id, data: { transactionNo: issue.code } });
    for (const query of [{ view: 'other' }, { sort: 'nope' }, { warehouseId: 'x' }]) {
      expect(
        (await client.list(owner, 'inv-transactions', query)).status,
        JSON.stringify(query),
      ).toBe(422);
    }
    const other = await inv.newWarehouse(owner, 'SAW');
    await inv.open(owner, item.id, other.id, 1, 1, SAW);
    expect(
      (
        (await client.list(owner, 'inv-transactions', { q: item.code })).body as {
          data: TypedBody[];
        }
      ).data,
    ).toHaveLength(2);
    const all = (await client.list(admin, 'inv-transactions', { q: item.code }, { unit: 'all' }))
      .body as { data: TypedBody[] };
    expect(all.data).toHaveLength(3);
    expect(
      (
        (await client.list(owner, 'inv-transactions', { q: item.code, warehouseId: other.id }, SAW))
          .body as { data: TypedBody[] }
      ).data,
    ).toHaveLength(1);
  });

  it('Stock Balance: one row per item x warehouse with the contract columns, status OK / Below Reorder, totals for the filtered set', async () => {
    const marker = tag();
    const a = await inv.newItem(owner, {
      itemName: `Bal A ${marker}`,
      reorderLevel: 20,
      baseUom: 'Box',
    });
    const b = await inv.newItem(owner, { itemName: `Bal B ${marker}`, reorderLevel: 5 });
    const c = await inv.newItem(owner, { itemName: `Bal C ${marker}` });
    const w1 = await inv.newWarehouse(owner, 'TAL');
    const w2 = await inv.newWarehouse(owner, 'TAL');
    await inv.open(owner, a.id, w1.id, 10, 10);
    await inv.open(owner, b.id, w1.id, 10, 3);
    await inv.open(owner, a.id, w2.id, 30, 4);
    await inv.open(owner, c.id, w2.id, 1, 100);
    await inv.issue(owner, c.id, w2.id, 1);
    const list = async (query: Record<string, unknown> = {}, h = {}) =>
      (await client.list(owner, 'inv-stock', { q: marker, size: 100, ...query }, h)).body as {
        data: TypedBody[];
        meta: { total: number; totals: { onHand: number; stockValue: number } };
      };
    const all = await list({ sort: 'itemName' });
    expect(all.meta.total).toBe(4);
    expect(all.meta.totals).toEqual({ onHand: 50, stockValue: 100 + 30 + 120 });
    const row = all.data.find(
      (r) => r.refs.itemCode?.id === a.id && r.refs.warehouse?.id === w1.id,
    );
    expect(row).toMatchObject({
      code: a.code,
      status: 'Below Reorder',
      unitId: TAL,
      data: {
        itemCode: a.code,
        itemName: `Bal A ${marker}`,
        unit: 'TAL',
        uom: 'Box',
        onHand: 10,
        avgRate: 10,
        stockValue: 100,
        reorderLevel: 20,
        status: 'Below Reorder',
      },
    });
    expect(row?.data.warehouse).toBe(w1.data.warehouseName);
    // A fully issued item keeps its (zero) row, as it has ledger rows.
    expect(all.data.find((r) => r.refs.itemCode?.id === c.id)?.data).toMatchObject({
      onHand: 0,
      stockValue: 0,
      status: 'OK',
    });
    const below = await list({ belowReorder: 'true' });
    expect(below.data.map((r) => r.status)).toEqual(['Below Reorder']);
    expect(below.meta).toMatchObject({ total: 1, totals: { onHand: 10, stockValue: 100 } });
    const inW2 = await list({ warehouseId: w2.id });
    expect(inW2.meta).toMatchObject({ total: 2, totals: { onHand: 30, stockValue: 120 } });
    expect((await list({ status: 'OK' })).data.every((r) => r.status === 'OK')).toBe(true);
    expect((await list({ q: `Bal B ${marker}` })).data).toHaveLength(1);
    expect((await list({ sort: '-stockValue' })).data.map((r) => r.data.stockValue)).toEqual([
      120, 100, 30, 0,
    ]);
    expect((await list({ sort: 'onHand', size: 2, page: 2 })).data).toHaveLength(2);
    for (const query of [
      { sort: 'nope' },
      { status: 'Bogus' },
      { warehouseId: 'x' },
      { belowReorder: 'maybe' },
      { size: 101 },
    ]) {
      expect((await client.list(owner, 'inv-stock', query)).status, JSON.stringify(query)).toBe(
        422,
      );
    }
    // Unit context: another unit has none of it; ADMIN+ sees all units; a user without a unit sees nothing.
    expect((await list({}, SAW)).meta.total).toBe(0);
    expect((await list({}, { unit: 'all' })).meta.total).toBe(4);
    const adminAll = (
      await client.list(admin, 'inv-stock', { q: marker, size: 100 }, { unit: 'all' })
    ).body as { meta: { total: number } };
    expect(adminAll.meta.total).toBe(4);
    const noUnit = await signInAs(app, 'MEMBER', { department: 'Warehouse', unitCodes: [] });
    expect(
      ((await client.list(noUnit, 'inv-stock', { q: marker })).body as { meta: { total: number } })
        .meta.total,
    ).toBe(0);
    expect((await client.list(keeper, 'inv-stock', { q: marker })).status).toBe(200);
    // One row by its composite id.
    const one = await client.get(owner, 'inv-stock', `${a.id}_${w1.id}`);
    expect(dataOf<TypedBody>(one).data.onHand).toBe(10);
    expect((await client.get(owner, 'inv-stock', `${a.id}_${w1.id}`, SAW)).status).toBe(404);
    expect((await client.get(owner, 'inv-stock', 'bogus')).status).toBe(422);
  });

  it('exports the Stock Balance as .xlsx with a totals row; Export Selected honours ids; formula text is escaped', async () => {
    const marker = tag();
    const item = await inv.newItem(owner, { itemName: `=SUM(1+1) ${marker}`, reorderLevel: 100 });
    const wh = await inv.newWarehouse(owner);
    await inv.open(owner, item.id, wh.id, 5, 12.5);
    const res = await client.export(owner, 'inv-stock', { q: marker });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml.sheet');
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(res.body as unknown as ExcelJS.Buffer);
    const sheet = book.worksheets[0];
    expect(sheet?.getRow(1).font?.bold).toBe(true);
    expect((sheet?.getRow(1).values as unknown[]).slice(1)).toEqual([
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
    expect(sheet?.getRow(2).getCell(2).value).toBe(`'=SUM(1+1) ${marker}`);
    expect(sheet?.getRow(2).getCell(6).value).toBe(5);
    expect(sheet?.getRow(2).getCell(8).value).toBe(62.5);
    const total = sheet?.getRow(3);
    expect(total?.getCell(1).value).toBe('Total');
    expect(total?.getCell(6).value).toBe(5);
    expect(total?.getCell(8).value).toBe(62.5);
    expect(total?.font?.bold).toBe(true);
    const audit = (await auditRows('RECORDS_EXPORTED')).filter(
      (r) => (r.detail as { pageId?: string }).pageId === 'inv-stock',
    );
    expect(audit.at(-1)?.detail).toMatchObject({ count: 1, filters: { q: marker } });
    const selected = await client.export(owner, 'inv-items', { q: marker, ids: item.id });
    expect(selected.status).toBe(200);
    expect((await client.export(keeper, 'inv-stock', { q: marker })).status).toBe(403);
    expect((await client.export(owner, 'inv-stock', { sort: 'nope' })).status).toBe(422);
  });
});

// ---------------------------------------------------------------------------------------------
describe('audit', () => {
  it('posting, dispatch, receive and cancel are audited; page audit lists them, scoped to what the caller can see', async () => {
    const { item, wh } = await pair();
    const dest = await inv.newWarehouse(owner, 'SAW');
    const o = await inv.open(owner, item.id, wh.id, 10, 10);
    expect((await auditRows('VOUCHER_POSTED', { targetId: o.id }))[0]?.detail).toMatchObject({
      pageId: 'inv-opening',
      code: o.code,
      ledgerEntries: 1,
      value: 100,
    });
    const t = await inv.voucher(owner, 'inv-transfer', {
      sourceWarehouse: wh.id,
      destinationWarehouse: dest.id,
      item: item.id,
      requestedQty: 3,
    });
    await inv.act(owner, 'inv-transfer', t.id, 'dispatch');
    await inv.act(owner, 'inv-transfer', t.id, 'receive', SAW);
    expect((await auditRows('TRANSFER_DISPATCHED', { targetId: t.id }))[0]?.detail).toMatchObject({
      dispatchedQty: 3,
      value: 30,
    });
    expect((await auditRows('TRANSFER_RECEIVED', { targetId: t.id }))[0]?.detail).toMatchObject({
      receivedQty: 3,
      value: 30,
    });
    const c = await inv.voucher(owner, 'inv-transactions', {
      transactionType: 'Receipt',
      item: item.id,
      warehouse: wh.id,
      qty: 1,
      unitCost: 1,
    });
    await inv.act(owner, 'inv-transactions', c.id, 'post');
    await inv.act(owner, 'inv-transactions', c.id, 'cancel');
    expect((await auditRows('VOUCHER_CANCELLED', { targetId: c.id }))[0]?.detail).toMatchObject({
      from: 'Posted',
      reversedEntries: 1,
    });
    expect((await auditRows('VOUCHER_CREATED', { targetId: t.id })).length).toBe(1);

    const page = (await client.pageAudit(owner, 'inv-transfer', { size: 100 })).body as {
      data: { targetId: string; action: string; targetType: string }[];
    };
    expect(
      page.data
        .filter((r) => r.targetId === t.id)
        .map((r) => r.action)
        .sort(),
    ).toEqual(['TRANSFER_DISPATCHED', 'TRANSFER_RECEIVED', 'VOUCHER_CREATED']);
    const rec = (await client.recordAudit(owner, 'inv-transfer', t.id)).body as {
      data: { action: string }[];
    };
    expect(rec.data.map((r) => r.action)).toEqual([
      'TRANSFER_RECEIVED',
      'TRANSFER_DISPATCHED',
      'VOUCHER_CREATED',
    ]);
    const items = (await client.pageAudit(keeper, 'inv-items', { size: 100 })).body as {
      data: { targetId: string; targetType: string; ip: string | null }[];
    };
    expect(items.data.some((r) => r.targetId === item.id && r.targetType === 'Item')).toBe(true);
    expect(items.data.every((r) => r.ip === null)).toBe(true);
    expect((await client.pageAudit(owner, 'inv-stock')).status).toBe(200);
    expect(
      (await client.recordAudit(owner, 'inv-transfer', '00000000-0000-4000-8000-000000000000'))
        .status,
    ).toBe(404);
  });

  it('with OWN scope a user sees the audit of their own vouchers only', async () => {
    const { item, wh } = await pair();
    const mine = await inv.voucher(keeper, 'inv-opening', {
      item: item.id,
      warehouse: wh.id,
      openingQty: 1,
      unitCost: 1,
    });
    const other = await signInAs(app, 'MEMBER', { department: 'Warehouse' });
    const theirs = await inv.voucher(other, 'inv-opening', {
      item: item.id,
      warehouse: wh.id,
      openingQty: 2,
      unitCost: 1,
    });
    const seen = (await client.pageAudit(keeper, 'inv-opening', { size: 100 })).body as {
      data: { targetId: string }[];
    };
    expect(seen.data.some((r) => r.targetId === mine.id)).toBe(true);
    expect(seen.data.some((r) => r.targetId === theirs.id)).toBe(false);
    expect((await client.recordAudit(keeper, 'inv-opening', theirs.id)).status).toBe(404);
    expect((await client.recordAudit(keeper, 'inv-opening', mine.id)).status).toBe(200);
  });
});

// ---------------------------------------------------------------------------------------------
describe('cancelling stock that moved needs `delete`', () => {
  it('a member (edit, no delete) can post and cancel a Draft but gets 403 cancelling a Posted voucher; a manager can', async () => {
    const { item, wh } = await pair();
    const v = await inv.voucher(keeper, 'inv-opening', {
      item: item.id,
      warehouse: wh.id,
      openingQty: 4,
      unitCost: 5,
    });
    await inv.act(keeper, 'inv-opening', v.id, 'post');
    const denied = await client.action(keeper, 'inv-opening', v.id, 'cancel');
    expect(denied.status).toBe(403);
    expect(errorOf(denied).code).toBe('FORBIDDEN');
    expect(await balanceOf(item.id, wh.id)).toMatchObject({ onHand: 4, value: 20 });
    expect(dataOf<TypedBody>(await client.get(keeper, 'inv-opening', v.id)).status).toBe('Posted');
    const manager = await signInAs(app, 'MANAGER', { department: 'Warehouse' });
    expect(
      dataOf<TypedBody>(await client.action(manager, 'inv-opening', v.id, 'cancel')).status,
    ).toBe('Cancelled');
    expect(await balanceOf(item.id, wh.id)).toMatchObject({ onHand: 0, value: 0 });
    // The same for receipts / issues and adjustments.
    for (const page of ['inv-transactions', 'inv-adjustment'] as const) {
      const data =
        page === 'inv-transactions'
          ? { transactionType: 'Receipt', item: item.id, warehouse: wh.id, qty: 1, unitCost: 1 }
          : { item: item.id, warehouse: wh.id, countedQty: 2, reasonCode: 'Other' };
      const posted = await inv.voucher(keeper, page, data);
      await inv.act(keeper, page, posted.id, 'post');
      expect((await client.action(keeper, page, posted.id, 'cancel')).status, page).toBe(403);
    }
  });

  it('a transfer: cancelling a Draft needs only `edit`; cancelling a Dispatched one needs `delete`', async () => {
    const { item, wh } = await pair();
    const dest = await inv.newWarehouse(owner, 'TAL');
    await inv.open(owner, item.id, wh.id, 10, 2);
    const draft = await inv.voucher(keeper, 'inv-transfer', {
      sourceWarehouse: wh.id,
      destinationWarehouse: dest.id,
      item: item.id,
      requestedQty: 2,
    });
    expect(
      dataOf<TypedBody>(await client.action(keeper, 'inv-transfer', draft.id, 'cancel')).status,
    ).toBe('Cancelled');
    const sent = await inv.voucher(keeper, 'inv-transfer', {
      sourceWarehouse: wh.id,
      destinationWarehouse: dest.id,
      item: item.id,
      requestedQty: 3,
    });
    await inv.act(keeper, 'inv-transfer', sent.id, 'dispatch');
    const denied = await client.action(keeper, 'inv-transfer', sent.id, 'cancel');
    expect(denied.status).toBe(403);
    expect(await balanceOf(item.id, wh.id)).toMatchObject({ onHand: 7 });
    const manager = await signInAs(app, 'MANAGER', { department: 'Warehouse' });
    await inv.act(manager, 'inv-transfer', sent.id, 'cancel');
    expect(await balanceOf(item.id, wh.id)).toMatchObject({ onHand: 10, value: 20 });
  });

  it('the allow_delete module switch binds everyone, the owner too; a visibility 404 still comes first', async () => {
    const { item, wh } = await pair();
    const v = await inv.open(owner, item.id, wh.id, 2, 2);
    await prisma.moduleControl.update({
      where: { pageId: 'inv-opening' },
      data: { allowDelete: false },
    });
    invalidateAccessCache();
    expect((await client.action(owner, 'inv-opening', v.id, 'cancel')).status).toBe(403);
    await prisma.moduleControl.update({
      where: { pageId: 'inv-opening' },
      data: { allowDelete: true },
    });
    invalidateAccessCache();
    const other = await signInAs(app, 'MEMBER', { department: 'Warehouse' });
    expect((await client.action(other, 'inv-opening', v.id, 'cancel')).status).toBe(404);
    expect(
      dataOf<TypedBody>(await client.action(owner, 'inv-opening', v.id, 'cancel')).status,
    ).toBe('Cancelled');
  });
});

describe('permissions and scope', () => {
  it('a Warehouse MEMBER can create and post (edit) but not delete; other departments are refused; module switches bind everyone', async () => {
    const { item, wh } = await pair();
    const v = await inv.voucher(keeper, 'inv-opening', {
      item: item.id,
      warehouse: wh.id,
      openingQty: 2,
      unitCost: 3,
    });
    expect(v.department).toBe('Warehouse');
    await inv.act(keeper, 'inv-opening', v.id, 'post');
    expect((await client.remove(keeper, 'inv-opening', v.id)).status).toBe(403);
    const sales = await signInAs(app, 'MEMBER', { department: 'Sales' });
    expect(
      (
        await client.create(sales, 'inv-opening', {
          item: item.id,
          warehouse: wh.id,
          openingQty: 1,
          unitCost: 1,
        })
      ).status,
    ).toBe(403);
    expect((await client.action(sales, 'inv-opening', v.id, 'cancel')).status).toBe(403);
    const d = await inv.voucher(keeper, 'inv-opening', {
      item: item.id,
      warehouse: wh.id,
      openingQty: 1,
      unitCost: 1,
    });
    await prisma.moduleControl.update({
      where: { pageId: 'inv-opening' },
      data: { allowEdit: false },
    });
    invalidateAccessCache();
    expect((await client.action(owner, 'inv-opening', d.id, 'post')).status).toBe(403);
    expect((await client.patch(owner, 'inv-opening', d.id, 1, { openingQty: 5 })).status).toBe(403);
    await prisma.moduleControl.update({
      where: { pageId: 'inv-opening' },
      data: { allowEdit: true, allowAdd: false },
    });
    invalidateAccessCache();
    expect(
      (
        await client.create(owner, 'inv-opening', {
          item: item.id,
          warehouse: wh.id,
          openingQty: 1,
          unitCost: 1,
        })
      ).status,
    ).toBe(403);
    expect(
      (await request(app).post(`${API}/pages/inv-opening/records/${d.id}/actions/post`)).status,
    ).toBe(401);
  });

  it("OWN scope: a member does not see, edit or act on another member's vouchers (404); DEPARTMENT managers and ADMIN do", async () => {
    const { item, wh } = await pair();
    const v = await inv.voucher(keeper, 'inv-opening', {
      item: item.id,
      warehouse: wh.id,
      openingQty: 2,
      unitCost: 3,
    });
    const other = await signInAs(app, 'MEMBER', { department: 'Warehouse' });
    expect((await client.get(other, 'inv-opening', v.id)).status).toBe(404);
    expect((await client.patch(other, 'inv-opening', v.id, 1, { openingQty: 4 })).status).toBe(404);
    expect((await client.action(other, 'inv-opening', v.id, 'post')).status).toBe(404);
    expect(
      ((await client.list(other, 'inv-opening', { q: v.code })).body as { data: unknown[] }).data,
    ).toEqual([]);
    const manager = await signInAs(app, 'MANAGER', { department: 'Warehouse' });
    expect((await client.get(manager, 'inv-opening', v.id)).status).toBe(200);
    expect((await client.get(admin, 'inv-opening', v.id)).status).toBe(200);
    // Masters and stock are visible to everyone with `view`, whoever created them.
    expect((await client.get(other, 'inv-items', item.id)).status).toBe(200);
    expect((await client.get(other, 'wms-warehouses', wh.id)).status).toBe(200);
  });
});
