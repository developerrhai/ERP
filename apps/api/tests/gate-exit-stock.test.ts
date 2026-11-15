import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '../src/core/db/prisma';
import { gateService } from '../src/modules/logistics/gate-service';
import { StockService } from '../src/modules/inventory/stock/stock-service';
import { D } from '../src/modules/inventory/money';
import { istDate } from '../src/modules/approvals/errors';
import type { Caller } from '../src/modules/records/service';
import { mkItem, tag } from './phase08-helpers';

let caller: Caller;
let unitId: string;
let userId: string;

async function wh(suffix: string) {
  return prisma.warehouse.create({
    data: { code: `GW${tag()}${suffix}`.slice(0, 28), name: `GateStore ${tag()}`, unitId, createdById: userId },
  });
}

async function seedStock(itemId: string, warehouseId: string, qty: number) {
  await prisma.$transaction(async (tx) => {
    await StockService.postMovement(tx, {
      warehouseId,
      itemId,
      direction: 'IN',
      qty: D(qty),
      rate: D(10),
      postingDate: istDate(),
      voucherType: 'OPENING',
      voucherId: '11111111-1111-4111-8111-' + String(Date.now()).padStart(12, '0').slice(-12),
      voucherNo: `OPN-${tag()}`,
      createdById: userId,
    });
  });
}

beforeAll(async () => {
  const admin = await prisma.user.findFirstOrThrow({ include: { role: true }, orderBy: { createdAt: 'asc' } });
  const unit = (await prisma.unit.findFirst({ where: { code: 'SAW' } })) ?? (await prisma.unit.findFirstOrThrow());
  const fy = await prisma.financialYear.findFirstOrThrow({ where: { status: 'OPEN' } });
  unitId = unit.id;
  userId = admin.id;
  caller = {
    auth: {
      userId: admin.id, sessionId: 's', roleId: admin.roleId, roleCode: admin.role.code, level: admin.role.level,
      allUnits: true, departments: [], role: admin.role.code, user: admin as any,
    },
    ctx: { unitId, fyId: fy.id, unit, fy } as any,
    meta: { ip: '127.0.0.1', userAgent: 'vitest' },
  };
});

describe('gate pass exit posts stock', () => {
  for (const passType of ['RETURNABLE', 'NON_RETURNABLE'] as const) {
    it(`${passType} exit moves stock (no 500)`, async () => {
      const item = await mkItem();
      const src = await wh('S');
      const out = await wh('O');
      await seedStock(item.id, src.id, 20);
      const pass = await gateService.createPass(caller, {
        direction: 'OUT',
        passType,
        vehicleNo: 'MH12AB1111',
        expectedReturnDate: '2026-12-31',
        lines: [{
          itemId: item.id, description: 'Stock line', uom: 'Kg', qty: 5, unitRate: 10,
          sourceWarehouseId: src.id, ...(passType === 'RETURNABLE' ? { outWarehouseId: out.id } : {}),
        }],
      });
      await gateService.approvePass(caller, String(pass.id));
      const done = await gateService.exitPass(caller, String(pass.id));
      expect(done.status).toBe('EXITED');
      const b = await prisma.stockBalance.findUnique({ where: { itemId_warehouseId: { itemId: item.id, warehouseId: src.id } } });
      expect(Number(b!.onHand)).toBe(15);
    });
  }
});
