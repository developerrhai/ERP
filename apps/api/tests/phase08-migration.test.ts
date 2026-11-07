// Phase 8 migrations A-C on legacy data: the lines backfill (R-08), the voucher-type lookup (D-11), the slice
// backfill and the guards (append-only ledger, frozen lines of a posted voucher). Runs the SQL of migration C's
// backfill against a hand-made legacy voucher, twice (it must be idempotent).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from './helpers';
import { fixture, mkItem, ownerId } from './phase08-helpers';
import { preflight } from '../src/modules/inventory/ops-service';

afterAll(() => prisma.$disconnect());

function backfillStatements(): string[] {
  const sql = readFileSync(
    join(
      __dirname,
      '..',
      'prisma',
      'migrations',
      '20261116020000_phase08_c_counts_reorder',
      'migration.sql',
    ),
    'utf8',
  );
  const start = sql.indexOf('ALTER TABLE "stock_voucher_lines" DISABLE TRIGGER');
  const tail = sql.slice(start);
  return tail
    .split(/;\s*\n/)
    .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
    .filter((s) => s.length > 0);
}

describe('migration C backfill', () => {
  it('gives every legacy single-item voucher exactly one line with its figures, and is idempotent', async () => {
    const fx = await fixture();
    const item = await mkItem();
    const fy = await prisma.financialYear.findFirstOrThrow({ where: { isCurrent: true } });
    const by = await ownerId();
    const v = await prisma.stockVoucher.create({
      data: {
        kind: 'TRANSACTION',
        number: `LEG-${Date.now()}`,
        status: 'Posted',
        unitId: fx.unitId,
        fyId: fy.id,
        postingDate: new Date(),
        itemId: item.id,
        warehouseId: fx.warehouseId,
        txType: 'Receipt',
        batchSerial: 'LEG-B1',
        qty: '12',
        unitCost: '5',
        value: '60',
        reasonCode: null,
        department: 'Warehouse',
        createdById: by,
        hasLines: false,
      },
    });
    expect(await prisma.stockVoucherLine.count({ where: { voucherId: v.id } })).toBe(0);
    const pre = await preflight();
    expect(pre.checks.find((c) => c.id === 'P-01')?.sample).toContain(v.number);

    for (let pass = 0; pass < 2; pass++) {
      for (const stmt of backfillStatements()) await prisma.$executeRawUnsafe(stmt);
    }
    const lines = await prisma.stockVoucherLine.findMany({ where: { voucherId: v.id } });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ lineNo: 1, itemId: item.id, batchNo: 'LEG-B1' });
    expect(Number(lines[0]!.qty)).toBe(12);
    expect(Number(lines[0]!.value)).toBe(60);
    const head = await prisma.stockVoucher.findUniqueOrThrow({ where: { id: v.id } });
    expect(head.hasLines).toBe(true);
    expect(Number(head.totalQty)).toBe(12);
    expect((await preflight()).checks.find((c) => c.id === 'P-01')?.sample).not.toContain(v.number);
  });
});

describe('database guards', () => {
  it('lines of a posted voucher cannot be added or removed; an unknown ledger voucher type is refused; voucher types are a lookup', async () => {
    const fx = await fixture();
    const item = await mkItem();
    const fy = await prisma.financialYear.findFirstOrThrow({ where: { isCurrent: true } });
    const by = await ownerId();
    const v = await prisma.stockVoucher.create({
      data: {
        kind: 'TRANSACTION',
        number: `G-${Date.now()}`,
        status: 'Posted',
        unitId: fx.unitId,
        fyId: fy.id,
        postingDate: new Date(),
        warehouseId: fx.warehouseId,
        department: 'Warehouse',
        createdById: by,
        hasLines: true,
      },
    });
    await expect(
      prisma.stockVoucherLine.create({
        data: { voucherId: v.id, lineNo: 1, itemId: item.id, qty: '1' },
      }),
    ).rejects.toThrow(/cannot be/);
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO stock_ledger (posting_date, unit_id, warehouse_id, item_id, qty_in, rate, value, balance_qty, balance_value, voucher_type, voucher_id, voucher_no, created_by_id) VALUES (current_date, '${fx.unitId}', '${fx.warehouseId}', '${item.id}', 1, 1, 1, 1, 1, 'NOT_A_TYPE', gen_random_uuid(), 'X', '${by}')`,
      ),
    ).rejects.toThrow();
    const types = await prisma.stockVoucherType.findMany();
    expect(types.map((t) => t.code)).toEqual(
      expect.arrayContaining([
        'OPENING',
        'RECEIPT',
        'ISSUE',
        'TRANSFER_IN',
        'STATUS_CHANGE',
        'RECONCILIATION',
      ]),
    );
  });
});
