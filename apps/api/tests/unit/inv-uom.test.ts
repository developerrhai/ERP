// apps/api/tests/unit/inv-uom.test.ts
// Unit and integration tests for UOM conversion and precision assertions (BR-INV-06).
// Follows docs/plans/02f-INVENTORY-TICKETS.md §12 T-INV-02.

import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma, unitIds } from '../helpers';
import { dec } from '../../src/modules/inventory/money';
import { UomService } from '../../src/modules/inventory/uom/uom-service';
import { DEFAULT_POLICY } from '../../src/modules/inventory/policy/policy-service';

describe('T-INV-02 — UomService (BR-INV-06)', () => {
  let userId: string;
  let companyId: string;
  let testItemId: string;
  let itemWithSpecificConversionId: string;
  let itemWithGlobalConversionId: string;
  let rollUomId: string;
  let nosUomId: string;

  beforeAll(async () => {
    const user = await prisma.user.findFirstOrThrow({
      where: { role: { code: 'SUPER_USER' } },
    });
    userId = user.id;

    const company = await prisma.company.findFirstOrThrow();
    companyId = company.id;

    // Ensure Nos and Roll exist in uoms
    const nos = await prisma.uom.upsert({
      where: { code: 'Nos' },
      update: {},
      create: {
        companyId,
        code: 'Nos',
        name: 'Numbers',
        uomClass: 'Count',
        decimals: 0,
        status: 'Active',
        createdById: userId,
      },
    });
    nosUomId = nos.id;

    const roll = await prisma.uom.upsert({
      where: { code: 'Roll' },
      update: {},
      create: {
        companyId,
        code: 'Roll',
        name: 'Roll',
        uomClass: 'Count',
        decimals: 0,
        status: 'Active',
        createdById: userId,
      },
    });
    rollUomId = roll.id;

    await prisma.uom.upsert({
      where: { code: 'Box' },
      update: {},
      create: {
        companyId,
        code: 'Box',
        name: 'Box',
        uomClass: 'Count',
        decimals: 0,
        status: 'Active',
        createdById: userId,
      },
    });

    await prisma.uom.upsert({
      where: { code: 'Kg' },
      update: {},
      create: {
        companyId,
        code: 'Kg',
        name: 'Kilogram',
        uomClass: 'Weight',
        decimals: 3,
        status: 'Active',
        createdById: userId,
      },
    });

    // Item 1: Base Nos, Alt Box with factor 12
    const item1 = await prisma.item.create({
      data: {
        code: `ITM-UOM1-${randomUUID().slice(0, 6).toUpperCase()}`,
        name: 'UOM Test Item 1',
        baseUom: 'Nos',
        altUom: 'Box',
        altUomFactor: 12,
        itemType: 'Raw Material',
        createdById: userId,
      },
    });
    testItemId = item1.id;

    // Item 2: Base Nos, will have item-specific Roll -> Nos conversion factor 100
    const item2 = await prisma.item.create({
      data: {
        code: `ITM-UOM2-${randomUUID().slice(0, 6).toUpperCase()}`,
        name: 'UOM Test Item 2',
        baseUom: 'Nos',
        itemType: 'Raw Material',
        createdById: userId,
      },
    });
    itemWithSpecificConversionId = item2.id;

    // Item 3: Base Nos, will use global Roll -> Nos conversion factor 50
    const item3 = await prisma.item.create({
      data: {
        code: `ITM-UOM3-${randomUUID().slice(0, 6).toUpperCase()}`,
        name: 'UOM Test Item 3',
        baseUom: 'Nos',
        itemType: 'Raw Material',
        createdById: userId,
      },
    });
    itemWithGlobalConversionId = item3.id;

    // Global conversion: Roll -> Nos factor = 50
    await prisma.uomConversion.create({
      data: {
        companyId,
        fromUomId: rollUomId,
        toUomId: nosUomId,
        itemId: null,
        factor: 50,
        createdById: userId,
      },
    });

    // Item-specific conversion: Roll -> Nos factor = 100 for Item 2
    await prisma.uomConversion.create({
      data: {
        companyId,
        fromUomId: rollUomId,
        toUomId: nosUomId,
        itemId: itemWithSpecificConversionId,
        factor: 100,
        createdById: userId,
      },
    });
  });

  it('same uom -> 1', async () => {
    const res = await UomService.toBase(prisma, {
      itemId: testItemId,
      uom: 'Nos',
      qty: 5,
    });

    expect(res.baseQty.toNumber()).toBe(5);
    expect(res.factor.toNumber()).toBe(1);
    expect(res.enteredQty.toNumber()).toBe(5);
    expect(res.uom).toBe('Nos');
  });

  it('alt uom uses item factor', async () => {
    const res = await UomService.toBase(prisma, {
      itemId: testItemId,
      uom: 'Box',
      qty: 2,
    });

    expect(res.baseQty.toNumber()).toBe(24); // 2 * 12
    expect(res.factor.toNumber()).toBe(12);
    expect(res.enteredQty.toNumber()).toBe(2);
    expect(res.uom).toBe('Box');
  });

  it('item-specific row beats global', async () => {
    // Item 2 has specific conversion 100
    const specific = await UomService.toBase(prisma, {
      itemId: itemWithSpecificConversionId,
      uom: 'Roll',
      qty: 2,
    });
    expect(specific.factor.toNumber()).toBe(100);
    expect(specific.baseQty.toNumber()).toBe(200);

    // Item 3 falls back to global conversion 50
    const globalConv = await UomService.toBase(prisma, {
      itemId: itemWithGlobalConversionId,
      uom: 'Roll',
      qty: 2,
    });
    expect(globalConv.factor.toNumber()).toBe(50);
    expect(globalConv.baseQty.toNumber()).toBe(100);
  });

  it('missing -> UOM_NOT_CONVERTIBLE', async () => {
    await expect(
      UomService.toBase(prisma, {
        itemId: testItemId,
        uom: 'Litre',
        qty: 1,
      }),
    ).rejects.toMatchObject({
      status: 422,
      code: 'UOM_NOT_CONVERTIBLE',
    });
  });

  it('2.5 Box x12 = 30.000', async () => {
    const res = await UomService.toBase(prisma, {
      itemId: testItemId,
      uom: 'Box',
      qty: '2.5',
    });

    expect(res.baseQty.toString()).toBe('30');
    expect(res.baseQty.toFixed(3)).toBe('30.000');
    expect(res.factor.toNumber()).toBe(12);
    expect(res.enteredQty.toNumber()).toBe(2.5);
  });

  it('precision error only when enforce on', async () => {
    // When enforceUomPrecision is false, 2.5 Box passes even though Box has decimals 0
    await expect(
      UomService.assertPrecision(prisma, 'Box', '2.5', {
        ...DEFAULT_POLICY,
        enforceUomPrecision: false,
      }),
    ).resolves.toBeUndefined();

    // When enforceUomPrecision is true, 2.5 Box must throw 422 UOM_PRECISION
    await expect(
      UomService.assertPrecision(prisma, 'Box', '2.5', {
        ...DEFAULT_POLICY,
        enforceUomPrecision: true,
      }),
    ).rejects.toMatchObject({
      status: 422,
      code: 'UOM_PRECISION',
    });

    // 2.555 Kg passes when enforce is true (Kg decimals = 3)
    await expect(
      UomService.assertPrecision(prisma, 'Kg', '2.555', {
        ...DEFAULT_POLICY,
        enforceUomPrecision: true,
      }),
    ).resolves.toBeUndefined();

    // 2.5555 Kg fails when enforce is true (4 decimals > 3)
    await expect(
      UomService.assertPrecision(prisma, 'Kg', '2.5555', {
        ...DEFAULT_POLICY,
        enforceUomPrecision: true,
      }),
    ).rejects.toMatchObject({
      status: 422,
      code: 'UOM_PRECISION',
    });
  });
});
