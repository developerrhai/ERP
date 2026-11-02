// Stock Balance (list only, with totals), the ledger view of Inventory Transactions, and the two
// previews that fill computed fields live (docs/phase3-4 C2/C3). Everything is filtered by the unit
// of the request context.
import { prisma } from '../../../core/db/prisma';
import { Errors } from '../../../core/http/errors';
import { hasMinRole } from '../../../core/rbac/role-rules';
import type { Caller } from '../../records/service';
import { D, num, round2 } from '../money';
import { unitFilter } from '../typed';
import type { ListResult, TypedHandler, TypedListQuery, TypedRecordDto } from '../typed';
import { readBalance } from './posting';
import { balanceOrder, ledgerOrder, stockRepository } from './repository';
import type { BalanceRow, LedgerRow } from './repository';

const ZERO_ID = '00000000-0000-0000-0000-000000000000';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const rowId = (b: Pick<BalanceRow, 'itemId' | 'warehouseId'>) => `${b.itemId}_${b.warehouseId}`;

function balanceDto(b: BalanceRow): TypedRecordDto {
  const status = b.belowReorder ? 'Below Reorder' : 'OK';
  return {
    id: rowId(b),
    code: b.itemCode,
    status,
    unitId: b.unitId,
    fyId: null,
    department: 'Warehouse',
    data: {
      itemCode: b.itemCode,
      itemName: b.itemName,
      unit: b.unitCode,
      warehouse: b.warehouseName,
      uom: b.uom,
      onHand: num(D(b.onHand)),
      avgRate: num(D(b.avgRate)),
      stockValue: num(D(b.stockValue)),
      reorderLevel: b.reorderLevel === null ? null : num(D(b.reorderLevel)),
      status,
    },
    version: 1,
    amount: num(D(b.stockValue)),
    createdAt: b.updatedAt.toISOString(),
    createdBy: { id: ZERO_ID, name: '' },
    updatedAt: b.updatedAt.toISOString(),
    deletedAt: null,
    refs: {
      itemCode: { id: b.itemId, code: b.itemCode, name: b.itemName },
      warehouse: { id: b.warehouseId, code: b.warehouseCode, name: b.warehouseName },
    },
  };
}

function ledgerDto(l: LedgerRow): TypedRecordDto {
  return {
    id: l.id,
    code: l.voucherNo,
    status: l.voucherType === 'REVERSAL' ? 'Reversal' : 'Posted',
    unitId: l.unitId,
    fyId: null,
    department: 'Warehouse',
    data: {
      postingDate: l.postingDate.toISOString().slice(0, 10),
      voucherNo: l.voucherNo,
      voucherType: l.voucherType,
      item: l.itemId,
      warehouse: l.warehouseId,
      qtyIn: num(D(l.qtyIn)),
      qtyOut: num(D(l.qtyOut)),
      rate: num(D(l.rate)),
      value: num(D(l.value)),
      balanceQty: num(D(l.balanceQty)),
      postedBy: l.postedBy,
    },
    version: 1,
    amount: num(D(l.value)),
    createdAt: l.postedAt.toISOString(),
    createdBy: { id: l.createdById, name: l.postedBy },
    updatedAt: l.postedAt.toISOString(),
    deletedAt: null,
    refs: {
      item: { id: l.itemId, code: l.itemCode, name: l.itemName },
      warehouse: { id: l.warehouseId, code: l.warehouseCode, name: l.warehouseName },
    },
  };
}

function uuidOrUndefined(value: string | undefined, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (!UUID.test(value)) throw Errors.validation({ [field]: 'Invalid id.' });
  return value;
}

export const stockHandler: TypedHandler = {
  pageId: 'inv-stock',

  async list(caller: Caller, query: TypedListQuery): Promise<ListResult> {
    const order = balanceOrder(query.sort === '-createdAt' ? 'itemCode' : query.sort);
    if (!order) {
      throw Errors.validation({
        sort: 'Sort by itemCode, itemName, unit, warehouse, onHand, avgRate, stockValue, reorderLevel or status.',
      });
    }
    if (query.status && !['OK', 'Below Reorder'].includes(query.status)) {
      throw Errors.validation({ status: 'Use OK or Below Reorder.' });
    }
    const { rows, total, onHand, stockValue } = await stockRepository.balances(
      unitFilter(caller),
      {
        ...(query.q ? { q: query.q } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.belowReorder ? { belowReorder: true } : {}),
        ...(query.warehouseId
          ? { warehouseId: uuidOrUndefined(query.warehouseId, 'warehouseId') }
          : {}),
      },
      order,
      { offset: (query.page - 1) * query.size, limit: query.size },
    );
    return {
      rows: rows.map(balanceDto),
      total,
      totals: { onHand: num(D(onHand)) ?? 0, stockValue: num(D(stockValue)) ?? 0 },
    };
  },

  async get(caller, id) {
    const [itemId, warehouseId] = id.split('_');
    if (!itemId || !warehouseId || !UUID.test(itemId) || !UUID.test(warehouseId)) {
      throw Errors.notFound('Record not found.');
    }
    const row = await stockRepository.balance(unitFilter(caller), itemId, warehouseId);
    if (!row) throw Errors.notFound('Record not found.');
    return balanceDto(row);
  },

  async exportRows(caller, query) {
    return this.list(caller, { ...query, page: 1, size: 10_000 });
  },
};

/** Ledger rows for the "Ledger" view of Inventory Transactions (newest first by default). */
export async function ledgerList(caller: Caller, query: TypedListQuery): Promise<ListResult> {
  const order = ledgerOrder(query.sort === '-createdAt' ? '-postedAt' : query.sort);
  if (!order) {
    throw Errors.validation({
      sort: 'Sort by postingDate, postedAt, voucherNo, voucherType, item, warehouse, qtyIn, qtyOut, value or balanceQty.',
    });
  }
  const { rows, total } = await stockRepository.ledger(
    unitFilter(caller),
    {
      ...(query.q ? { q: query.q } : {}),
      ...(query.warehouseId
        ? { warehouseId: uuidOrUndefined(query.warehouseId, 'warehouseId') }
        : {}),
    },
    order,
    { offset: (query.page - 1) * query.size, limit: query.size },
  );
  return { rows: rows.map(ledgerDto), total };
}

// ---------------------------------------------------------------------------------------------
// Previews
// ---------------------------------------------------------------------------------------------
async function previewTarget(
  caller: Caller,
  itemId: string | undefined,
  warehouseId: string | undefined,
) {
  const errors: Record<string, string> = {};
  if (!itemId || !UUID.test(itemId)) errors.itemId = 'Choose an item.';
  if (!warehouseId || !UUID.test(warehouseId)) errors.warehouseId = 'Choose a warehouse.';
  if (Object.keys(errors).length > 0) throw Errors.validation(errors);
  const [item, warehouse] = await Promise.all([
    prisma.item.findFirst({ where: { id: itemId, deletedAt: null } }),
    prisma.warehouse.findFirst({ where: { id: warehouseId, deletedAt: null } }),
  ]);
  if (!item || !warehouse) throw Errors.notFound('Item or warehouse not found.');
  // A warehouse outside the context unit is not visible (ADMIN+ may look anywhere).
  const scope = unitFilter(caller);
  if (!hasMinRole(caller.auth.role, 'ADMIN') && (scope.none || warehouse.unitId !== scope.unitId)) {
    throw Errors.notFound('Item or warehouse not found.');
  }
  return { item, warehouse, balance: await readBalance(prisma, item.id, warehouse.id) };
}

/** inv-adjustment: what the system holds now and at which rate a variance would be valued. */
export async function previewAdjustment(caller: Caller, itemId?: string, warehouseId?: string) {
  const { item, balance } = await previewTarget(caller, itemId, warehouseId);
  const unitCost = balance.avgRate.greaterThan(0) ? balance.avgRate : (item.standardCost ?? D(0));
  return {
    systemQty: num(balance.onHand) ?? 0,
    avgRate: num(balance.avgRate) ?? 0,
    unitCost: num(unitCost) ?? 0,
    stockValue: num(round2(balance.value)) ?? 0,
  };
}

/** inv-transfer: the quantity available in the source warehouse and its average rate. */
export async function previewTransfer(caller: Caller, itemId?: string, warehouseId?: string) {
  const { balance } = await previewTarget(caller, itemId, warehouseId);
  return { available: num(balance.onHand) ?? 0, avgRate: num(balance.avgRate) ?? 0 };
}
