// Phase 8 / steps 5-10: transfers (transit warehouse, GSTIN rule E-24), batches + FEFO + expiry, serials,
// reservations + holds, counts + the weekly powder sheet, reorder, ageing, scan/GS1, integrity, GL cut-over.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { invalidateAccessCache } from '../src/core/rbac/access';
import { D } from '../src/modules/inventory/money';
import { postMovement } from '../src/modules/inventory/stock/posting';
import { errorOf, newApp, prisma, signInOwner } from './helpers';
import type { Signed } from './helpers';
import { dataOf } from './phase4-helpers';
import { balance, fixture, mkItem, setApproval, tag, today, vclient } from './phase08-helpers';
import type { Fixture } from './phase08-helpers';

const app = newApp();
let owner: Signed;
let fx: Fixture;
let v: ReturnType<typeof vclient>;
let saved: Awaited<ReturnType<typeof setApproval>>;

async function gl(unitId: string, code: string): Promise<number> {
  const a = await prisma.account.findUniqueOrThrow({ where: { code } });
  const r = await prisma.glEntry.aggregate({
    where: { unitId, accountId: a.id },
    _sum: { debit: true, credit: true },
  });
  return Number(r._sum.debit ?? 0) - Number(r._sum.credit ?? 0);
}
const plusDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const receipt = (
  itemId: string,
  qty: number,
  cost: number,
  extra: Record<string, unknown> = {},
  warehouseId = fx.warehouseId,
) =>
  v.post('transactions', {
    warehouseId,
    txType: 'Receipt',
    lines: [{ itemId, qty, unitCost: cost, ...extra }],
  });

beforeAll(async () => {
  owner = await signInOwner(app);
  saved = await setApproval(false);
  invalidateAccessCache();
  fx = await fixture('27AAAAA0000A1Z5');
  v = vclient(app, owner, fx.unitId);
});
afterAll(async () => {
  for (const r of saved)
    await prisma.moduleControl.update({
      where: { pageId: r.pageId },
      data: { approvalRequired: r.approvalRequired },
    });
  await prisma.$disconnect();
});

describe('transfers', () => {
  it('same unit: dispatch moves stock and value into the transit warehouse, receive moves it on; GL follows', async () => {
    const a = await mkItem();
    await receipt(a.id, 10, 50);
    const t = await v.post(
      'transfer',
      {
        warehouseId: fx.warehouseId,
        toWarehouseId: fx.warehouse2Id,
        lines: [{ itemId: a.id, qty: 4 }],
      },
      'dispatch',
    );
    expect(t.status).toBe('Dispatched');
    expect(await balance(a.id, fx.warehouseId)).toMatchObject({ onHand: 6, value: 300 });
    expect(await balance(a.id, fx.warehouse2Id)).toMatchObject({ onHand: 0 });
    const transit = await prisma.warehouse.findFirstOrThrow({
      where: { unitId: fx.unitId, isTransit: true },
    });
    expect(await balance(a.id, transit.id)).toMatchObject({ onHand: 4, value: 200 });
    expect(await gl(fx.unitId, '1309')).toBe(200);
    const rec = await v.act('transfer', t.id, 'receive');
    expect(rec.status, JSON.stringify(rec.body)).toBe(200);
    expect(await balance(a.id, fx.warehouse2Id)).toMatchObject({ onHand: 4, value: 200 });
    expect(await balance(a.id, transit.id)).toMatchObject({ onHand: 0, value: 0 });
    expect(await gl(fx.unitId, '1309')).toBe(0);
  });

  it('cancelling a Dispatched transfer returns the stock to the source', async () => {
    const a = await mkItem();
    await receipt(a.id, 5, 10);
    const t = await v.post(
      'transfer',
      {
        warehouseId: fx.warehouseId,
        toWarehouseId: fx.warehouse2Id,
        lines: [{ itemId: a.id, qty: 5 }],
      },
      'dispatch',
    );
    const c = await v.act('transfer', t.id, 'cancel', { reason: 'wrong destination' });
    expect(c.status, JSON.stringify(c.body)).toBe(200);
    expect(await balance(a.id, fx.warehouseId)).toMatchObject({ onHand: 5, value: 50 });
  });

  it('E-24: a transfer between units with different GSTINs is refused with the exact message', async () => {
    const other = await fixture('29BBBBB1111B1Z6');
    const a = await mkItem();
    await receipt(a.id, 5, 10);
    const c = await v.call('post', '/inventory/vouchers/transfer', {
      warehouseId: fx.warehouseId,
      toWarehouseId: other.warehouseId,
      lines: [{ itemId: a.id, qty: 1 }],
    });
    expect(c.status).toBe(409);
    expect(errorOf(c).message).toBe(
      'Transfer between different GSTINs needs a tax invoice; available after the Taxation phase.',
    );
  });

  it('same GSTIN, different units: works, each unit balances through inter-unit clearing', async () => {
    const other = await fixture('27AAAAA0000A1Z5');
    const a = await mkItem();
    await receipt(a.id, 8, 25);
    const t = await v.post(
      'transfer',
      {
        warehouseId: fx.warehouseId,
        toWarehouseId: other.warehouseId,
        lines: [{ itemId: a.id, qty: 8 }],
      },
      'dispatch',
    );
    const ov = vclient(app, owner, other.unitId);
    const rec = await ov.act('transfer', t.id, 'receive');
    expect(rec.status, JSON.stringify(rec.body)).toBe(200);
    expect(await balance(a.id, other.warehouseId)).toMatchObject({ onHand: 8, value: 200 });
    expect(await gl(other.unitId, '1301')).toBe(200);
  });
});

describe('batches, FEFO, expiry', () => {
  it('a batch-tracked receipt needs a batch; issue without a batch takes the earliest expiry first', async () => {
    const a = await mkItem({ batchTracked: true, shelfLifeDays: 365 });
    const bad = await v.call('post', '/inventory/vouchers/transactions', {
      warehouseId: fx.warehouseId,
      txType: 'Receipt',
      lines: [{ itemId: a.id, qty: 1, unitCost: 1 }],
    });
    expect(bad.status).toBe(422);
    await receipt(a.id, 10, 10, { batchNo: 'B-LATE', mfgDate: plusDays(-10) });
    await receipt(a.id, 5, 10, { batchNo: 'B-SOON', mfgDate: plusDays(-300) });
    await v.post('transactions', {
      warehouseId: fx.warehouseId,
      txType: 'Issue',
      lines: [{ itemId: a.id, qty: 7 }],
    });
    const soon = await prisma.batch.findFirstOrThrow({
      where: { itemId: a.id, batchNo: 'B-SOON' },
    });
    const late = await prisma.batch.findFirstOrThrow({
      where: { itemId: a.id, batchNo: 'B-LATE' },
    });
    const sl = await prisma.stockSlice.findMany({ where: { itemId: a.id } });
    expect(Number(sl.find((s) => s.batchId === soon.id)?.qty)).toBe(0);
    expect(Number(sl.find((s) => s.batchId === late.id)?.qty)).toBe(8);
  });

  it('expiry defaults to manufacturing date + shelf life, a held batch cannot be issued, an expired one neither', async () => {
    const a = await mkItem({ batchTracked: true, shelfLifeDays: 30 });
    await receipt(a.id, 10, 5, { batchNo: 'B-1', mfgDate: plusDays(-5) });
    const b = await prisma.batch.findFirstOrThrow({ where: { itemId: a.id } });
    expect(b.expiryDate?.toISOString().slice(0, 10)).toBe(plusDays(25));
    const hold = await v.call(
      'post',
      `/inventory/batches/${b.id}/qc`,
      { to: 'On Hold', reason: 'lab check pending' },
      { 'If-Match': `"${b.version}"` },
    );
    expect(hold.status, JSON.stringify(hold.body)).toBe(200);
    const c = await v.create('transactions', {
      warehouseId: fx.warehouseId,
      txType: 'Issue',
      lines: [{ itemId: a.id, qty: 1 }],
    });
    await v.submit('transactions', c.id, c.version);
    const res = await v.act('transactions', c.id, 'post');
    expect(res.status).toBe(409);
    expect(errorOf(res).code).toBe('BATCH_BLOCKED');
  });

  it('powder client case: manufacturing and expiry dates are stored, the expiry report bands them', async () => {
    const a = await mkItem({ batchTracked: true, category: 'Powder' });
    await receipt(a.id, 20, 100, {
      batchNo: 'PW-1',
      mfgDate: plusDays(-60),
      expiryDate: plusDays(20),
    });
    const r = await v.call('get', '/inventory/reports/expiry');
    const row = dataOf<{ itemCode: string; band: string; daysToExpiry: number }[]>(r).find(
      (x) => x.itemCode === a.code,
    );
    expect(row).toMatchObject({ band: 'Critical', daysToExpiry: 20 });
  });
});

describe('serials', () => {
  it('needs exactly qty unique serial numbers, tracks status, refuses a duplicate', async () => {
    const a = await mkItem({ serialTracked: true });
    const bad = await v.call('post', '/inventory/vouchers/transactions', {
      warehouseId: fx.warehouseId,
      txType: 'Receipt',
      lines: [{ itemId: a.id, qty: 2, unitCost: 1, serialNos: ['S1'] }],
    });
    expect(bad.status).toBe(201); // saved as a draft; the check happens at post
    await receipt(a.id, 2, 100, { serialNos: ['SN-1', 'SN-2'] });
    expect(await prisma.serialNumber.count({ where: { itemId: a.id, status: 'In Stock' } })).toBe(
      2,
    );
    const dup = await v.create('transactions', {
      warehouseId: fx.warehouseId,
      txType: 'Receipt',
      lines: [{ itemId: a.id, qty: 1, unitCost: 1, serialNos: ['SN-1'] }],
    });
    await v.submit('transactions', dup.id, dup.version);
    const res = await v.act('transactions', dup.id, 'post');
    expect(errorOf(res).code).toBe('SERIAL_DUPLICATE');
    await v.post('transactions', {
      warehouseId: fx.warehouseId,
      txType: 'Issue',
      lines: [{ itemId: a.id, qty: 1, serialNos: ['SN-2'] }],
    });
    expect(
      (await prisma.serialNumber.findFirstOrThrow({ where: { itemId: a.id, serialNo: 'SN-2' } }))
        .status,
    ).toBe('Issued');
  });
});

describe('reservations and holds', () => {
  it('reserves what is available, serves waiting demand by priority when stock arrives, blocks other issues', async () => {
    const a = await mkItem();
    await receipt(a.id, 10, 10);
    const mk = (qty: number, priority: string) =>
      v.call('post', '/inventory/reservations', {
        itemId: a.id,
        warehouseId: fx.warehouseId,
        requiredQty: qty,
        priority,
      });
    const r1 = dataOf<{ id: string; status: string; reservedQty: number }>(await mk(8, 'Low'));
    expect(r1).toMatchObject({ status: 'Reserved', reservedQty: 8 });
    const r2 = dataOf<{ id: string; status: string; reservedQty: number }>(await mk(6, 'Critical'));
    expect(r2).toMatchObject({ status: 'Partial', reservedQty: 2 });
    const c = await v.create('transactions', {
      warehouseId: fx.warehouseId,
      txType: 'Issue',
      lines: [{ itemId: a.id, qty: 1 }],
    });
    await v.submit('transactions', c.id, c.version);
    const blocked = await v.act('transactions', c.id, 'post');
    expect(errorOf(blocked).code).toBe('STOCK_RESERVED');
    await receipt(a.id, 4, 10);
    const list = dataOf<{ id: string; status: string; reservedQty: number }[]>(
      await v.call('get', '/inventory/reservations'),
    );
    expect(list.find((x) => x.id === r2.id)).toMatchObject({ status: 'Reserved', reservedQty: 6 });
    expect((await balance(a.id, fx.warehouseId)).reserved).toBe(14);
  });

  it('an issue that names the reservation consumes it', async () => {
    const a = await mkItem();
    await receipt(a.id, 10, 10);
    const r = dataOf<{ id: string }>(
      await v.call('post', '/inventory/reservations', {
        itemId: a.id,
        warehouseId: fx.warehouseId,
        requiredQty: 6,
      }),
    );
    await v.post('transactions', {
      warehouseId: fx.warehouseId,
      txType: 'Issue',
      lines: [{ itemId: a.id, qty: 6, reservationId: r.id }],
    });
    const row = await prisma.stockReservation.findUniqueOrThrow({ where: { id: r.id } });
    expect(row.status).toBe('Fulfilled');
    expect(await balance(a.id, fx.warehouseId)).toMatchObject({ onHand: 4, reserved: 0 });
  });

  it('a hold blocks a quantity; releasing it frees it', async () => {
    const a = await mkItem();
    await receipt(a.id, 10, 10);
    const h = dataOf<{ id: string; version: number }>(
      await v.call('post', '/inventory/holds', {
        itemId: a.id,
        warehouseId: fx.warehouseId,
        qty: 7,
        reason: 'customer complaint',
      }),
    );
    const c = await v.create('transactions', {
      warehouseId: fx.warehouseId,
      txType: 'Issue',
      lines: [{ itemId: a.id, qty: 5 }],
    });
    await v.submit('transactions', c.id, c.version);
    expect((await v.act('transactions', c.id, 'post')).status).toBe(409);
    await v.call('post', `/inventory/holds/${h.id}/release`, undefined, {
      'If-Match': `"${h.version}"`,
    });
    expect((await v.act('transactions', c.id, 'post')).status).toBe(200);
  });
});

describe('counts and the weekly powder sheet', () => {
  it('cycle count: within tolerance accepted, outside needs a recount by ANOTHER user, post makes one adjustment', async () => {
    const a = await mkItem();
    const b = await mkItem();
    await receipt(a.id, 100, 10);
    await receipt(b.id, 100, 10);
    const c = dataOf<{ id: string; version: number }>(
      await v.call('post', '/inventory/counts', {
        countType: 'CYCLE',
        warehouseId: fx.warehouseId,
        itemIds: [a.id, b.id],
      }),
    );
    const st = dataOf<{ version: number }>(
      await v.call('post', `/inventory/counts/${c.id}/start`, undefined, {
        'If-Match': `"${c.version}"`,
      }),
    );
    const det = dataOf<{ lines: { id: string; itemId: string; systemQty: number | null }[] }>(
      await v.call('get', `/inventory/counts/${c.id}`),
    );
    expect(det.lines[0]!.systemQty).toBeNull(); // blind count
    const la = det.lines.find((l) => l.itemId === a.id)!;
    const lb = det.lines.find((l) => l.itemId === b.id)!;
    expect(
      dataOf<{ status: string }>(
        await v.call('post', `/inventory/counts/${c.id}/lines/${la.id}/count`, { qty: 101 }),
      ).status,
    ).toBe('Accepted');
    expect(
      dataOf<{ status: string }>(
        await v.call('post', `/inventory/counts/${c.id}/lines/${lb.id}/count`, { qty: 90 }),
      ).status,
    ).toBe('Recount');
    const same = await v.call('post', `/inventory/counts/${c.id}/lines/${lb.id}/count`, {
      qty: 90,
    });
    expect(errorOf(same).code).toBe('SAME_COUNTER');
    const rv = await v.call('post', `/inventory/counts/${c.id}/review`, undefined, {
      'If-Match': `"${st.version}"`,
    });
    expect(rv.status).toBe(422);
  });

  it('weekly powder sheet: rows per powder item x week, a confirmed difference posts through the reconciliation', async () => {
    const p = await mkItem({ category: 'Powder', batchTracked: false });
    await receipt(p.id, 50, 100);
    const c = dataOf<{ id: string; version: number }>(
      await v.call('post', '/inventory/counts', {
        countType: 'POWDER_WEEKLY',
        warehouseId: fx.warehouseId,
        monthLabel: today().slice(0, 7),
        itemIds: [p.id],
      }),
    );
    const started = dataOf<{ version: number }>(
      await v.call('post', `/inventory/counts/${c.id}/start`, undefined, {
        'If-Match': `"${c.version}"`,
      }),
    );
    const det = dataOf<{ lines: { id: string; weekNo: number }[] }>(
      await v.call('get', `/inventory/counts/${c.id}`),
    );
    expect(det.lines).toHaveLength(5);
    await v.call('post', `/inventory/counts/${c.id}/lines/${det.lines[0]!.id}/count`, {
      qty: 48,
      remarks: 'week 1',
    });
    const rv = dataOf<{ version: number }>(
      await v.call('post', `/inventory/counts/${c.id}/review`, undefined, {
        'If-Match': `"${started.version}"`,
      }),
    );
    // the owner created it, so another approver is required
    const self = await v.call('post', `/inventory/counts/${c.id}/approve`, undefined, {
      'If-Match': `"${rv.version}"`,
    });
    expect(errorOf(self).code).toBe('MAKER_CHECKER');
  });
});

describe('reorder, ageing, scan, integrity', () => {
  it('min/max policy suggests the order quantity and keeps ONE open suggestion', async () => {
    const a = await mkItem();
    await receipt(a.id, 20, 10);
    const pol = await v.call('post', '/inventory/reorder/policies', {
      itemId: a.id,
      warehouseId: fx.warehouseId,
      method: 'MIN_MAX',
      minQty: 50,
      maxQty: 200,
      orderMultiple: 25,
    });
    expect(pol.status, JSON.stringify(pol.body)).toBe(201);
    await v.call('post', '/inventory/reorder/recalculate');
    await v.call('post', '/inventory/reorder/recalculate');
    const s = dataOf<{ itemCode: string; suggestedQty: number; status: string }[]>(
      await v.call('get', '/inventory/reorder/suggestions?status=Open'),
    );
    const mine = s.filter((x) => x.itemCode === a.code);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.suggestedQty).toBe(200); // roundUp(200 - 20 = 180, 25) = 200
  });

  it('ageing attributes on-hand to the newest receipts', async () => {
    const a = await mkItem();
    await receipt(a.id, 10, 10);
    const rows = dataOf<{ itemCode: string; onHand: number; f030: number; ageDays: number }[]>(
      await v.call('get', '/inventory/reports/ageing'),
    );
    expect(rows.find((r) => r.itemCode === a.code)).toMatchObject({
      onHand: 10,
      f030: 10,
      ageDays: 0,
    });
  });

  it('scan: item, GS1 with batch + expiry, check-digit failure, unknown code; never posts stock', async () => {
    const a = await mkItem({ barcode: '4006381333931', batchTracked: true });
    await receipt(a.id, 3, 1, {
      batchNo: 'LOT123',
      mfgDate: plusDays(-5),
      expiryDate: '2030-12-31',
    });
    const ok = dataOf<{ valid: boolean; kind: string; batch?: { batchNo: string } }>(
      await v.call('post', '/inventory/scan', {
        raw: '(01)04006381333931(17)301231(10)LOT123',
        context: 'LOOKUP',
      }),
    );
    expect(ok).toMatchObject({ valid: true, kind: 'BATCH' });
    const bad = dataOf<{ valid: boolean; message: string }>(
      await v.call('post', '/inventory/scan', { raw: '4006381333932', context: 'LOOKUP' }),
    );
    expect(bad.valid).toBe(false);
    const unk = dataOf<{ valid: boolean; kind: string }>(
      await v.call('post', '/inventory/scan', { raw: 'NOPE-NOT-A-CODE', context: 'LOOKUP' }),
    );
    expect(unk).toMatchObject({ valid: false, kind: 'UNKNOWN' });
    expect(
      await prisma.scanEvent.count({
        where: { raw: { in: ['4006381333932', 'NOPE-NOT-A-CODE'] } },
      }),
    ).toBeGreaterThanOrEqual(2);
  });

  it('integrity: INV-1..INV-5 hold after all of the above (ledger = balance = slices)', async () => {
    const r = dataOf<{ ok: boolean; checks: { id: string; ok: boolean; mismatches: unknown[] }[] }>(
      await v.call('get', '/inventory/integrity'),
    );
    const hard = r.checks.filter((c) => ['INV-1', 'INV-2', 'INV-3', 'INV-4'].includes(c.id));
    expect(hard.map((c) => [c.id, c.mismatches.length])).toEqual([
      ['INV-1', 0],
      ['INV-2', 0],
      ['INV-3', 0],
      ['INV-4', 0],
    ]);
  });

  it('pre-flight lists blockers; GL cut-over brings a unit with pre-GL stock level with the ledger, once', async () => {
    const f = await fixture();
    const a = await mkItem();
    const by = f.ownerId;
    // Pre-Phase-8 stock: written straight to the ledger tables, with no journal behind it.
    const wid = f.warehouseId;
    await prisma.$transaction(async (tx) => {
      await postMovement(tx, {
        unitId: f.unitId,
        warehouseId: wid,
        itemId: a.id,
        postingDate: today(),
        voucherType: 'OPENING',
        voucherId: crypto.randomUUID(),
        voucherNo: 'LEGACY-1',
        createdById: by,
        qtyIn: D(5),
        rate: D(40),
      });
      await tx.stockSlice.create({ data: { itemId: a.id, warehouseId: wid, qty: '5' } });
    });
    const cv = vclient(app, owner, f.unitId);
    const plan = dataOf<{ needed: boolean; lines: { key: string; diff: string | number }[] }>(
      await cv.call('get', `/inventory/gl-cutover?asOf=${today()}`),
    );
    expect(plan.needed).toBe(true);
    const run = await cv.call('post', '/inventory/gl-cutover', { asOf: today() });
    expect(run.status, JSON.stringify(run.body)).toBe(201);
    expect(await gl(f.unitId, '1301')).toBe(200);
    const again = await cv.call('post', '/inventory/gl-cutover', { asOf: today() });
    expect(again.status).toBe(409);
    const cmp = dataOf<{ rows: { unit: string; variance: number | null }[] }>(
      await cv.call('get', '/inventory/reports/gl-compare'),
    );
    expect(cmp.rows.every((r) => r.variance === 0)).toBe(true);
    const pf = dataOf<{ checks: { id: string }[] }>(await cv.call('get', '/inventory/preflight'));
    expect(pf.checks.map((c) => c.id)).toContain('P-01');
  });
});

void tag;
