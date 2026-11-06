// apps/api/tests/inv-migration-m1.test.ts
// Verifies Migration M1 inv_foundation: helper functions, ALTERs, CHECK constraints, seeds, and Prisma models.
// Follows docs/plans/02f-INVENTORY-TICKETS.md §12 T-INV-01.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma, unitIds } from './helpers';

describe('T-INV-01 — Migration M1 inv_foundation', () => {
  let unitId: string;
  let userId: string;
  let testItemId: string;
  let testWarehouseId: string;

  beforeAll(async () => {
    const ids = await unitIds(['TAL']);
    unitId = ids[0]!;

    const user = await prisma.user.findFirstOrThrow({
      where: { role: 'SUPER_ADMIN' },
    });
    userId = user.id;

    const company = await prisma.company.findFirstOrThrow();

    // Populate default UOMs if empty (mirrors migration 5.4.3 once company and user exist)
    await prisma.$executeRawUnsafe(`
      INSERT INTO "uoms" ("company_id","code","name","uom_class","decimals","status","created_by_id")
      SELECT (SELECT "id" FROM "companies" ORDER BY "created_at" LIMIT 1), v.code, v.name, v.cls, v.dec, 'Active',
             (SELECT "id" FROM "users" ORDER BY "created_at" LIMIT 1)
      FROM (VALUES ('Nos','Numbers','Count',0),('Set','Set','Count',0),('Pair','Pair','Count',0),('Box','Box','Count',0),
                   ('Roll','Roll','Count',0),('Sheet','Sheet','Count',0),('Kg','Kilogram','Weight',3),
                   ('Meter','Meter','Length',3),('Litre','Litre','Volume',3)) AS v(code,name,cls,dec)
      WHERE EXISTS (SELECT 1 FROM "companies") AND EXISTS (SELECT 1 FROM "users")
      ON CONFLICT DO NOTHING;
    `);

    // Create a dedicated warehouse for M1 test
    const wh = await prisma.warehouse.create({
      data: {
        code: `WH-M1-${randomUUID().slice(0, 6).toUpperCase()}`,
        name: 'M1 Test Warehouse',
        unitId,
        createdById: userId,
      },
    });
    testWarehouseId = wh.id;

    // Create a dedicated item for M1 test
    const item = await prisma.item.create({
      data: {
        code: `ITM-M1-${randomUUID().slice(0, 6).toUpperCase()}`,
        name: 'M1 Test Item',
        baseUom: 'Nos',
        itemType: 'Raw Material',
        createdById: userId,
      },
    });
    testItemId = item.id;
  });

  afterAll(async () => {
    // Clean up test rows
    if (testItemId && testWarehouseId) {
      await prisma.$executeRawUnsafe(
        `DELETE FROM stock_balances WHERE item_id = '${testItemId}' AND warehouse_id = '${testWarehouseId}'`,
      ).catch(() => {});
      await prisma.$executeRawUnsafe(
        `DELETE FROM stock_ledger WHERE item_id = '${testItemId}' AND warehouse_id = '${testWarehouseId}'`,
      ).catch(() => {});
    }
    if (testItemId) {
      await prisma.item.delete({ where: { id: testItemId } }).catch(() => {});
    }
    if (testWarehouseId) {
      await prisma.warehouse.delete({ where: { id: testWarehouseId } }).catch(() => {});
    }
  });

  it('1. new columns have defaults', async () => {
    const item = await prisma.item.findUniqueOrThrow({
      where: { id: testItemId },
    });
    expect(item.valuationMethod).toBe('MOVING_AVG');
    expect(item.qcRequired).toBe(false);
    expect(Number(item.storageUnits)).toBe(1);

    const wh = await prisma.warehouse.findUniqueOrThrow({
      where: { id: testWarehouseId },
    });
    expect(wh.binManaged).toBe(false);
    expect(wh.putawayRequired).toBe(false);
    expect(wh.pickMethod).toBe('FEFO');

    // Create a stock balance and check defaults
    const balance = await prisma.stockBalance.create({
      data: {
        itemId: testItemId,
        warehouseId: testWarehouseId,
        onHand: 10,
        value: 100,
        avgRate: 10,
      },
    });
    expect(Number(balance.reservedQty)).toBe(0);
    expect(balance.negativeAllowed).toBe(false);

    // Verify settings row inventory.policy exists
    const policySetting = await prisma.setting.findUnique({
      where: { key: 'inventory.policy' },
    });
    expect(policySetting).toBeDefined();
    const policyJson = policySetting?.value as Record<string, unknown>;
    expect(policyJson.allowNegativeStock).toBe(false);

    // Verify UOM rows exist
    const uoms = await prisma.uom.findMany();
    expect(uoms.length).toBeGreaterThanOrEqual(9);
    expect(uoms.some((u) => u.code === 'Nos')).toBe(true);
    expect(uoms.some((u) => u.code === 'Kg')).toBe(true);
  });

  it('2. negative on_hand still refused by SQL', async () => {
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE stock_balances SET on_hand = -5, negative_allowed = false WHERE item_id = '${testItemId}' AND warehouse_id = '${testWarehouseId}'`,
      ),
    ).rejects.toThrow();
  });

  it('3. negative allowed with flag', async () => {
    // Update balance to negative with negative_allowed = true
    const result = await prisma.$executeRawUnsafe(
      `UPDATE stock_balances SET on_hand = -5, negative_allowed = true WHERE item_id = '${testItemId}' AND warehouse_id = '${testWarehouseId}'`,
    );
    expect(result).toBe(1);

    const updated = await prisma.stockBalance.findUniqueOrThrow({
      where: {
        itemId_warehouseId: { itemId: testItemId, warehouseId: testWarehouseId },
      },
    });
    expect(Number(updated.onHand)).toBe(-5);
    expect(updated.negativeAllowed).toBe(true);

    // Restore to positive
    await prisma.$executeRawUnsafe(
      `UPDATE stock_balances SET on_hand = 10, negative_allowed = false WHERE item_id = '${testItemId}' AND warehouse_id = '${testWarehouseId}'`,
    );
  });

  it('4. revaluation row shape', async () => {
    const voucherId = randomUUID();
    // REVALUATION with qty_in = 0 and qty_out = 0 succeeds
    await prisma.$executeRawUnsafe(`
      INSERT INTO stock_ledger (
        id, posting_date, posted_at, unit_id, warehouse_id, item_id,
        qty_in, qty_out, rate, value, balance_qty, balance_value,
        voucher_type, voucher_id, voucher_no, created_by_id
      ) VALUES (
        '${randomUUID()}', CURRENT_DATE, CURRENT_TIMESTAMP, '${unitId}', '${testWarehouseId}', '${testItemId}',
        0, 0, 15.000000, 50.00, 10, 150.00,
        'REVALUATION', '${voucherId}', 'REV-TEST-01', '${userId}'
      )
    `);

    // ISSUE with qty_in = 0 and qty_out = 0 fails one_direction check
    await expect(
      prisma.$executeRawUnsafe(`
        INSERT INTO stock_ledger (
          id, posting_date, posted_at, unit_id, warehouse_id, item_id,
          qty_in, qty_out, rate, value, balance_qty, balance_value,
          voucher_type, voucher_id, voucher_no, created_by_id
        ) VALUES (
          '${randomUUID()}', CURRENT_DATE, CURRENT_TIMESTAMP, '${unitId}', '${testWarehouseId}', '${testItemId}',
          0, 0, 15.000000, 0, 10, 150.00,
          'ISSUE', '${randomUUID()}', 'ISS-TEST-01', '${userId}'
        )
      `),
    ).rejects.toThrow();
  });

  it('5. ledger remains append-only', async () => {
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE stock_ledger SET rate = 99 WHERE item_id = '${testItemId}' AND warehouse_id = '${testWarehouseId}'`,
      ),
    ).rejects.toThrow(/append-only/i);

    await expect(
      prisma.$executeRawUnsafe(
        `DELETE FROM stock_ledger WHERE item_id = '${testItemId}' AND warehouse_id = '${testWarehouseId}'`,
      ),
    ).rejects.toThrow(/append-only/i);
  });

  it('6. inv_make_append_only creates triggers', async () => {
    await prisma.$executeRawUnsafe(`
      CREATE TEMP TABLE test_append_tbl (
        id serial PRIMARY KEY,
        val text
      )
    `);

    await prisma.$executeRawUnsafe(`
      SELECT inv_make_append_only('test_append_tbl')
    `);

    await prisma.$executeRawUnsafe(`
      INSERT INTO test_append_tbl (val) VALUES ('initial')
    `);

    await expect(
      prisma.$executeRawUnsafe(`
        UPDATE test_append_tbl SET val = 'modified'
      `),
    ).rejects.toThrow(/append-only/i);

    await prisma.$executeRawUnsafe(`
      DROP TABLE test_append_tbl
    `);
  });
});
