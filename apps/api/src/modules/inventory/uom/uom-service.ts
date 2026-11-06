// apps/api/src/modules/inventory/uom/uom-service.ts
// Handles UOM factor conversions and decimal precision verification (BR-INV-06).

import type { Db } from '../../../core/db/prisma';
import { dec, round3, type Dec } from '../money';
import { Errors } from '../../../core/http/errors';
import type { InventoryPolicy } from '../policy/policy-service';

export interface UomConversionResult {
  baseQty: Dec;
  factor: Dec;
  enteredQty: Dec;
  uom: string | null;
}

export const UomService = {
  async toBase(
    db: Db,
    params: { itemId: string; uom?: string | null; qty: Dec | number | string },
  ): Promise<UomConversionResult> {
    const enteredQty = dec(params.qty);
    const uom = params.uom?.trim() || null;

    const item = await db.item.findUniqueOrThrow({
      where: { id: params.itemId },
      select: { code: true, baseUom: true, altUom: true, altUomFactor: true },
    });

    // 1. Same UOM or no UOM specified -> factor = 1
    if (!uom || uom === item.baseUom) {
      return {
        baseQty: round3(enteredQty),
        factor: dec(1),
        enteredQty,
        uom: uom ?? item.baseUom,
      };
    }

    // 2. Alt UOM on item matches -> use item.altUomFactor (1 alt = factor base)
    if (item.altUom && uom === item.altUom && item.altUomFactor) {
      const factor = dec(item.altUomFactor);
      return {
        baseQty: round3(enteredQty.mul(factor)),
        factor,
        enteredQty,
        uom,
      };
    }

    // 3 & 4. Lookup from/to UOM IDs in uoms table
    const [fromUom, toUom] = await Promise.all([
      db.uom.findFirst({ where: { code: uom, deletedAt: null } }),
      db.uom.findFirst({ where: { code: item.baseUom, deletedAt: null } }),
    ]);

    if (fromUom && toUom) {
      // 3. Item-specific conversion row
      const itemConversion = await db.uomConversion.findFirst({
        where: {
          fromUomId: fromUom.id,
          toUomId: toUom.id,
          itemId: params.itemId,
          deletedAt: null,
        },
      });

      if (itemConversion) {
        const factor = dec(itemConversion.factor);
        return {
          baseQty: round3(enteredQty.mul(factor)),
          factor,
          enteredQty,
          uom,
        };
      }

      // 4. Global conversion row (itemId is null)
      const globalConversion = await db.uomConversion.findFirst({
        where: {
          fromUomId: fromUom.id,
          toUomId: toUom.id,
          itemId: null,
          deletedAt: null,
        },
      });

      if (globalConversion) {
        const factor = dec(globalConversion.factor);
        return {
          baseQty: round3(enteredQty.mul(factor)),
          factor,
          enteredQty,
          uom,
        };
      }
    }

    throw Errors.uomNotConvertible(
      `No conversion from ${uom} to ${item.baseUom} for item ${item.code}`,
    );
  },

  async assertPrecision(
    db: Db,
    uomCode: string,
    qty: Dec | number | string,
    policy: InventoryPolicy,
  ): Promise<void> {
    if (!policy.enforceUomPrecision) {
      return;
    }

    const uom = await db.uom.findFirst({
      where: { code: uomCode, deletedAt: null },
      select: { decimals: true },
    });

    const maxDecimals = uom?.decimals ?? 3;
    const qtyStr = dec(qty).toString();
    const parts = qtyStr.split('.');
    const decimalPlaces = parts.length > 1 ? parts[1]!.replace(/0+$/, '').length : 0;

    if (decimalPlaces > maxDecimals) {
      throw Errors.uomPrecision(
        `Quantity ${qtyStr} exceeds maximum ${maxDecimals} decimal places for UOM ${uomCode}`,
      );
    }
  },
};
