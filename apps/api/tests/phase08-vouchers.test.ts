// Phase 8 / steps 2-4: StockService + vouchers with lines + GL in the same transaction.
// Money in a fresh unit is exact: stock value per account key must equal the GL balance of the unit.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { invalidateAccessCache } from '../src/core/rbac/access';
import { errorOf, newApp, prisma, signInOwner } from './helpers';
import type { Signed } from './helpers';
import { dataOf } from './phase4-helpers';
import { balance, fixture, mkItem, setApproval, vclient } from './phase08-helpers';
import type { Fixture } from './phase08-helpers';

const app = newApp();
let owner: Signed;
let fx: Fixture;
let v: ReturnType<typeof vclient>;
let saved: Awaited<ReturnType<typeof setApproval>>;

/** GL balance (debit - credit) of an account code in a unit. */
async function gl(unitId: string, code: string): Promise<number> {
  const a = await prisma.account.findUniqueOrThrow({ where: { code } });
  const r = await prisma.glEntry.aggregate({
    where: { unitId, accountId: a.id },
    _sum: { debit: true, credit: true },
  });
  return Number(r._sum.debit ?? 0) - Number(r._sum.credit ?? 0);
}

beforeAll(async () => {
  owner = await signInOwner(app);
  saved = await setApproval(false);
  invalidateAccessCache();
  fx = await fixture();
  v = vclient(app, owner, fx.unitId);
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

describe('receipt / issue with lines, moving average and GL', () => {
  it('posts a two-line receipt, issues at the average, and the GL equals the stock value', async () => {
    const a = await mkItem();
    const b = await mkItem({ itemType: 'Finished Good' });
    const rcpt = await v.post('transactions', {
      warehouseId: fx.warehouseId,
      txType: 'Receipt',
      lines: [
        { itemId: a.id, qty: 10, unitCost: 100 },
        { itemId: b.id, qty: 4, unitCost: 250 },
      ],
    });
    expect(rcpt.status).toBe('Posted');
    expect(await balance(a.id, fx.warehouseId)).toMatchObject({
      onHand: 10,
      value: 1000,
      avg: 100,
    });
    expect(await gl(fx.unitId, '1301')).toBe(1000); // INVENTORY_RM
    expect(await gl(fx.unitId, '1303')).toBe(1000); // INVENTORY_FG
    expect(await gl(fx.unitId, '2150')).toBe(-2000); // GRIR credit

    await v.post('transactions', {
      warehouseId: fx.warehouseId,
      txType: 'Receipt',
      lines: [{ itemId: a.id, qty: 10, unitCost: 120 }],
    });
    expect(await balance(a.id, fx.warehouseId)).toMatchObject({
      onHand: 20,
      value: 2200,
      avg: 110,
    });
    await v.post('transactions', {
      warehouseId: fx.warehouseId,
      txType: 'Issue',
      lines: [{ itemId: a.id, qty: 15 }],
    });
    expect(await balance(a.id, fx.warehouseId)).toMatchObject({ onHand: 5, value: 550 });
    expect(await gl(fx.unitId, '5110')).toBe(1650); // consumption
    expect(await gl(fx.unitId, '1301')).toBe(550 + 0);
  });

  it('refuses to issue more than is on hand and writes nothing', async () => {
    const a = await mkItem();
    await v.post('transactions', {
      warehouseId: fx.warehouseId,
      txType: 'Receipt',
      lines: [{ itemId: a.id, qty: 3, unitCost: 10 }],
    });
    const c = await v.create('transactions', {
      warehouseId: fx.warehouseId,
      txType: 'Issue',
      lines: [{ itemId: a.id, qty: 9 }],
    });
    await v.submit('transactions', c.id, c.version);
    const res = await v.act('transactions', c.id, 'post');
    expect(res.status).toBe(409);
    expect(errorOf(res).code).toBe('INSUFFICIENT_STOCK');
    expect(await balance(a.id, fx.warehouseId)).toMatchObject({ onHand: 3 });
  });

  it('cancel reverses stock and GL dated the cancel date, and a second cancel is refused', async () => {
    const a = await mkItem();
    const before = await gl(fx.unitId, '1301');
    const r = await v.post('transactions', {
      warehouseId: fx.warehouseId,
      txType: 'Receipt',
      lines: [{ itemId: a.id, qty: 5, unitCost: 20 }],
    });
    expect(await gl(fx.unitId, '1301')).toBe(before + 100);
    const res = await v.act('transactions', r.id, 'cancel', { reason: 'entered by mistake' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(dataOf<{ status: string }>(res).status).toBe('Cancelled');
    expect(await balance(a.id, fx.warehouseId)).toMatchObject({ onHand: 0, value: 0 });
    expect(await gl(fx.unitId, '1301')).toBe(before);
    const again = await v.act('transactions', r.id, 'cancel', { reason: 'entered by mistake' });
    expect(again.status).toBe(409);
    const rows = await prisma.stockLedger.findMany({
      where: { itemId: a.id },
      orderBy: { postedAt: 'asc' },
    });
    expect(rows.map((x) => x.voucherType)).toEqual(['RECEIPT', 'REVERSAL']);
  });

  it('a Draft cannot be posted before approval; a posted voucher cannot be edited', async () => {
    const a = await mkItem();
    const c = await v.create('transactions', {
      warehouseId: fx.warehouseId,
      txType: 'Receipt',
      lines: [{ itemId: a.id, qty: 1, unitCost: 1 }],
    });
    const early = await v.act('transactions', c.id, 'post');
    expect(early.status).toBe(409);
    const s = await v.submit('transactions', c.id, c.version);
    const p = await v.act('transactions', c.id, 'post');
    expect(p.status).toBe(200);
    const put = await v.call(
      'put',
      `/inventory/vouchers/transactions/${c.id}`,
      {
        warehouseId: fx.warehouseId,
        txType: 'Receipt',
        lines: [{ itemId: a.id, qty: 2, unitCost: 1 }],
      },
      { 'If-Match': `"${s.version + 1}"` },
    );
    expect(put.status).toBe(409);
  });

  it('three parallel posts of one voucher: exactly one wins', async () => {
    const a = await mkItem();
    const c = await v.create('transactions', {
      warehouseId: fx.warehouseId,
      txType: 'Receipt',
      lines: [{ itemId: a.id, qty: 7, unitCost: 3 }],
    });
    await v.submit('transactions', c.id, c.version);
    const rs = await Promise.all([1, 2, 3].map(() => v.act('transactions', c.id, 'post')));
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await balance(a.id, fx.warehouseId)).toMatchObject({ onHand: 7, value: 21 });
  });
});

describe('opening, adjustment', () => {
  it('opening stock is allowed once; the adjustment posts only the variance with a reason', async () => {
    const a = await mkItem();
    await v.post('opening', {
      warehouseId: fx.warehouseId,
      lines: [{ itemId: a.id, qty: 50, unitCost: 10 }],
    });
    expect(await gl(fx.unitId, '3009')).toBeLessThan(0);
    const c2 = await v.create('opening', {
      warehouseId: fx.warehouseId,
      lines: [{ itemId: a.id, qty: 5, unitCost: 10 }],
    });
    await v.submit('opening', c2.id, c2.version);
    expect((await v.act('opening', c2.id, 'post')).status).toBe(409);

    const adj = await v.post('adjustment', {
      warehouseId: fx.warehouseId,
      lines: [{ itemId: a.id, countedQty: 47, reasonCode: 'Count Correction' }],
    });
    expect(adj.status).toBe('Posted');
    expect(await balance(a.id, fx.warehouseId)).toMatchObject({ onHand: 47, value: 470 });
    const line = (
      adj as unknown as { lines: { systemQty: number; varianceQty: number; value: number }[] }
    ).lines[0]!;
    expect(line).toMatchObject({ systemQty: 50, varianceQty: -3, value: -30 });
  });
});

describe('Quality Inspection stock (client requirement 2)', () => {
  it('a qc_required item is received into QUALITY_INSPECTION and cannot be issued', async () => {
    const a = await mkItem({ qcRequired: true });
    await v.post('transactions', {
      warehouseId: fx.warehouseId,
      txType: 'Receipt',
      lines: [{ itemId: a.id, qty: 10, unitCost: 5 }],
    });
    expect(await balance(a.id, fx.warehouseId)).toMatchObject({ onHand: 10 });
    const sl = await prisma.stockSlice.findMany({ where: { itemId: a.id } });
    expect(sl.map((s) => s.stockStatus)).toEqual(['QUALITY_INSPECTION']);
    const c = await v.create('transactions', {
      warehouseId: fx.warehouseId,
      txType: 'Issue',
      lines: [{ itemId: a.id, qty: 1 }],
    });
    await v.submit('transactions', c.id, c.version);
    const res = await v.act('transactions', c.id, 'post');
    expect(res.status).toBe(409);
    expect(errorOf(res).message).toMatch(/Quality Inspection/);
  });
});
