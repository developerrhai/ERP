// PriceService.lookup (docs/phases/PHASE-06.md §5): which price applies to a customer (or supplier), item,
// quantity, unit of measure and date, and WHY (source). Lists are tried in order: the customer's own list,
// the customer's chosen list, the customer group's default, the company default. The first list with rows
// for the item wins; inside it the largest min_qty <= qty is taken. Otherwise the item's own selling price.
import { Prisma } from '@prisma/client';
import { prisma } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { netRate, pickPriceRow } from './party-rules';
import type { PriceRow } from './party-rules';

export interface PriceLookupInput {
  kind?: 'SELLING' | 'BUYING';
  customerId?: string | undefined;
  supplierId?: string | undefined;
  itemId: string;
  qty: number | string;
  uomCode?: string | undefined;
  /** YYYY-MM-DD */
  date: string;
}

export type PriceSource =
  | 'CUSTOMER_LIST'
  | 'CUSTOMER_PRICE_LIST'
  | 'GROUP_DEFAULT'
  | 'COMPANY_DEFAULT'
  | 'SUPPLIER_LIST'
  | 'ITEM_DEFAULT';

export interface PriceResult {
  rate: string;
  discountPct: string;
  net: string;
  source: PriceSource;
  priceListId: string | null;
  rowId: string | null;
}

const day = (s: string): Date => new Date(`${s}T00:00:00Z`);
const iso = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);

export const pricingService = {
  async lookup(input: PriceLookupInput): Promise<PriceResult> {
    const kind = input.kind ?? 'SELLING';
    const item = await prisma.item.findUnique({
      where: { id: input.itemId },
      select: { id: true, baseUom: true, sellingPrice: true, standardCost: true },
    });
    if (!item) throw Errors.notFound('Item not found.');
    // unpaginated: rows of one parent (itemId)
    const conversions = await prisma.itemUomConversion.findMany({ where: { itemId: item.id } });
    const factorOf = (uom: string): Prisma.Decimal | null =>
      uom === item.baseUom
        ? new Prisma.Decimal(1)
        : (conversions.find((c) => c.uomCode === uom)?.factor ?? null);
    const asked = input.uomCode ?? item.baseUom;
    const askedFactor = factorOf(asked);
    if (!askedFactor) {
      throw Errors.validation({
        uom: `This item has no conversion from ${asked} to ${item.baseUom}.`,
      });
    }
    const baseQty = new Prisma.Decimal(input.qty).mul(askedFactor);
    const when = day(input.date);

    // Candidate lists, in priority order.
    const candidates: { id: string; source: PriceSource }[] = [];
    const push = (id: string | null | undefined, source: PriceSource): void => {
      if (id && !candidates.some((c) => c.id === id)) candidates.push({ id, source });
    };
    if (kind === 'SELLING' && input.customerId) {
      const customer = await prisma.customer.findUnique({
        where: { id: input.customerId },
        select: { priceListId: true, customerGroupId: true },
      });
      const specific = await prisma.priceList.findFirst({
        where: { kind, customerId: input.customerId, status: 'ACTIVE', deletedAt: null },
        select: { id: true },
        orderBy: { createdAt: 'desc' },
      });
      push(specific?.id, 'CUSTOMER_LIST');
      push(customer?.priceListId, 'CUSTOMER_PRICE_LIST');
      if (customer?.customerGroupId) {
        const group = await prisma.partyGroup.findUnique({
          where: { id: customer.customerGroupId },
          select: { defaultPriceListId: true },
        });
        push(group?.defaultPriceListId, 'GROUP_DEFAULT');
      }
    }
    if (kind === 'BUYING' && input.supplierId) {
      const specific = await prisma.priceList.findFirst({
        where: { kind, supplierId: input.supplierId, status: 'ACTIVE', deletedAt: null },
        select: { id: true },
        orderBy: { createdAt: 'desc' },
      });
      push(specific?.id, 'SUPPLIER_LIST');
    }
    const companyDefault = await prisma.priceList.findFirst({
      where: { kind, isDefault: true, status: 'ACTIVE', deletedAt: null },
      select: { id: true },
    });
    push(companyDefault?.id, 'COMPANY_DEFAULT');

    for (const c of candidates) {
      const list = await prisma.priceList.findFirst({
        where: {
          id: c.id,
          status: 'ACTIVE',
          deletedAt: null,
          AND: [
            { OR: [{ validFrom: null }, { validFrom: { lte: when } }] },
            { OR: [{ validTo: null }, { validTo: { gte: when } }] },
          ],
        },
      });
      if (!list) continue;
      // unpaginated: internal policy/config lookup inside a transaction, small admin-defined table
      const rows = await prisma.priceListItem.findMany({
        where: { priceListId: list.id, itemId: item.id },
      });
      if (rows.length === 0) continue;
      // Compare each row in its own unit: convert the base quantity into the row's unit.
      const usable: (PriceRow & { qtyInRowUom: Prisma.Decimal })[] = [];
      for (const r of rows) {
        const f = factorOf(r.uomCode);
        if (!f) continue;
        usable.push({
          id: r.id,
          itemId: r.itemId,
          uomCode: r.uomCode,
          minQty: r.minQty,
          rate: r.rate,
          discountPct: r.discountPct,
          validFrom: iso(r.validFrom),
          validTo: iso(r.validTo),
          qtyInRowUom: baseQty.div(f),
        });
      }
      // pickPriceRow takes one quantity; rows in different units are compared separately and the best slab wins.
      let best: PriceRow | null = null;
      let bestMin = new Prisma.Decimal(-1);
      for (const uom of new Set(usable.map((u) => u.uomCode))) {
        const group = usable.filter((u) => u.uomCode === uom);
        const first = group[0];
        if (!first) continue;
        const pick = pickPriceRow(group, first.qtyInRowUom, input.date);
        if (pick && new Prisma.Decimal(pick.minQty).gt(bestMin)) {
          best = pick;
          bestMin = new Prisma.Decimal(pick.minQty);
        }
      }
      if (!best) continue;
      return {
        rate: new Prisma.Decimal(best.rate).toString(),
        discountPct: new Prisma.Decimal(best.discountPct).toString(),
        net: netRate(best.rate, best.discountPct),
        source: c.source,
        priceListId: list.id,
        rowId: best.id,
      };
    }

    const fallback = kind === 'SELLING' ? item.sellingPrice : item.standardCost;
    const rate = fallback ?? new Prisma.Decimal(0);
    return {
      rate: rate.toString(),
      discountPct: '0',
      net: rate.toString(),
      source: 'ITEM_DEFAULT',
      priceListId: null,
      rowId: null,
    };
  },
};
