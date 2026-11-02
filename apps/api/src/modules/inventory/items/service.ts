// Item / SKU Master rules (docs/phase3-4 C1): user-entered or auto code ITM/00001, unique code and
// barcode, an alternate UOM needs a factor > 0, the base UOM is frozen once stock exists, delete is
// refused (409 IN_USE) when the item has ledger rows or vouchers (deactivate it instead). Every write
// is audited; soft delete returns an undo token like the generic engine.
import { Prisma } from '@prisma/client';
import type { Item } from '@prisma/client';
import { prisma } from '../../../core/db/prisma';
import { Errors } from '../../../core/http/errors';
import type { FieldErrors } from '../../../core/http/errors';
import { validateRecordInput } from '../../../engine/record-input';
import type { PageSchema } from '../../../engine/field-schema';
import type { Caller } from '../../records/service';
import { TYPED_SCHEMAS } from '../definitions';
import { num } from '../money';
import { countLedgerRows } from '../stock/posting';
import {
  INVENTORY_DEPARTMENT,
  masterStatusLabel,
  undoTokenOf,
  userNames,
  writeAudit,
} from '../typed';
import type { ListResult, TypedHandler, TypedListQuery, TypedRecordDto } from '../typed';
import { itemRepository as repo } from './repository';

const PAGE = 'inv-items';
const schema = TYPED_SCHEMAS['inv-items'] as unknown as PageSchema;
const TX = { maxWait: 15_000, timeout: 15_000 };

const SORTS: Record<string, string> = {
  itemCode: 'code',
  code: 'code',
  itemName: 'name',
  itemType: 'itemType',
  category: 'category',
  brand: 'brand',
  baseUom: 'baseUom',
  standardCost: 'standardCost',
  sellingPrice: 'sellingPrice',
  reorderLevel: 'reorderLevel',
  status: 'status',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
};

/** Field key -> column for the plain copy-over fields. */
const COLUMNS: Record<string, keyof Prisma.ItemUncheckedUpdateManyInput> = {
  itemName: 'name',
  itemType: 'itemType',
  category: 'category',
  brand: 'brand',
  hsnSac: 'hsnSac',
  baseUom: 'baseUom',
  altUom: 'altUom',
  altUomFactor: 'altUomFactor',
  barcode: 'barcode',
  batchTracked: 'batchTracked',
  serialTracked: 'serialTracked',
  shelfLifeDays: 'shelfLifeDays',
  standardCost: 'standardCost',
  sellingPrice: 'sellingPrice',
  reorderLevel: 'reorderLevel',
};

function toData(row: Item): Record<string, unknown> {
  return {
    itemCode: row.code,
    itemName: row.name,
    itemType: row.itemType,
    category: row.category,
    brand: row.brand,
    hsnSac: row.hsnSac,
    baseUom: row.baseUom,
    altUom: row.altUom,
    altUomFactor: num(row.altUomFactor),
    barcode: row.barcode,
    batchTracked: row.batchTracked,
    serialTracked: row.serialTracked,
    shelfLifeDays: row.shelfLifeDays,
    standardCost: num(row.standardCost),
    sellingPrice: num(row.sellingPrice),
    reorderLevel: num(row.reorderLevel),
  };
}

async function toDtos(rows: Item[]): Promise<TypedRecordDto[]> {
  const names = await userNames(rows.map((r) => r.createdById));
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    status: masterStatusLabel(row.status),
    unitId: null,
    fyId: null,
    department: INVENTORY_DEPARTMENT,
    data: { ...toData(row), status: masterStatusLabel(row.status) },
    version: row.version,
    amount: num(row.standardCost),
    createdAt: row.createdAt.toISOString(),
    createdBy: { id: row.createdById, name: names.get(row.createdById) ?? '' },
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
    refs: {},
  }));
}

async function one(row: Item): Promise<TypedRecordDto> {
  const [dto] = await toDtos([row]);
  if (!dto) throw Errors.notFound('Item not found.');
  return dto;
}

/** Cross-field rules on the values an item will have after the write. */
function assertItemRules(v: {
  altUom: string | null;
  altUomFactor: number | null;
  shelfLifeDays: number | null;
}): void {
  const fields: FieldErrors = {};
  if (v.altUom && !(v.altUomFactor !== null && v.altUomFactor > 0)) {
    fields.altUomFactor = 'Enter a factor greater than 0 for the alternate UOM.';
  }
  if (!v.altUom && v.altUomFactor !== null) {
    fields.altUom = 'Choose the alternate UOM this factor belongs to.';
  }
  if (v.shelfLifeDays !== null && (!Number.isInteger(v.shelfLifeDays) || v.shelfLifeDays < 1)) {
    fields.shelfLifeDays = 'Enter a whole number of days, at least 1.';
  }
  if (Object.keys(fields).length > 0) throw Errors.validation(fields);
}

function mapDbError(err: unknown): unknown {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    const target = JSON.stringify(err.meta?.target ?? '');
    if (/barcode/i.test(target))
      return Errors.duplicate({ barcode: 'This barcode is already in use.' });
    return Errors.duplicate({ itemCode: 'This item code is already in use.' });
  }
  if (
    err instanceof Prisma.PrismaClientUnknownRequestError &&
    /violates RESTRICT/.test(err.message)
  ) {
    return Errors.inUse('This item is still in use. Deactivate it instead.');
  }
  return err;
}

async function load(id: string, deleted = false): Promise<Item> {
  const item = await repo.find(id, deleted);
  if (!item) throw Errors.notFound('Item not found.');
  return item;
}

function orderBy(sort: string): Prisma.ItemOrderByWithRelationInput[] {
  const desc = sort.startsWith('-');
  const column = SORTS[desc ? sort.slice(1) : sort];
  if (!column) {
    throw Errors.validation({
      sort: 'Sort by one of the item fields, code, createdAt or updatedAt.',
    });
  }
  return [{ [column]: desc ? 'desc' : 'asc' }, { id: 'asc' }];
}

function statusFilter(status: string | undefined): 'ACTIVE' | 'INACTIVE' | undefined {
  if (!status) return undefined;
  if (status === 'Active') return 'ACTIVE';
  if (status === 'Inactive') return 'INACTIVE';
  throw Errors.validation({ status: 'Use Active or Inactive.' });
}

function createData(values: Record<string, unknown>) {
  const data: Record<string, unknown> = {};
  for (const [key, column] of Object.entries(COLUMNS)) {
    if (values[key] !== undefined) data[column] = values[key];
  }
  return data;
}

export const itemHandler: TypedHandler = {
  pageId: PAGE,

  async list(_caller: Caller, query: TypedListQuery): Promise<ListResult> {
    const { rows, total } = await repo.list(
      { q: query.q, status: statusFilter(query.status), deleted: query.deleted === true },
      orderBy(query.sort),
      { skip: (query.page - 1) * query.size, take: query.size },
    );
    return { rows: await toDtos(rows), total };
  },

  async get(_caller, id) {
    return one(await load(id));
  },

  async create(caller, input) {
    const v = validateRecordInput(schema, input, 'create');
    const values = v.values;
    const get = <T>(k: string): T | null => (values[k] as T | undefined) ?? null;
    assertItemRules({
      altUom: get('altUom'),
      altUomFactor: get('altUomFactor'),
      shelfLifeDays: get('shelfLifeDays'),
    });
    const explicit = typeof values.itemCode === 'string' ? values.itemCode.toUpperCase() : null;
    if (explicit !== null && !/^[A-Z0-9/_-]{2,30}$/.test(explicit)) {
      throw Errors.validation({ itemCode: 'Use 2-30 letters, digits, "/", "_" or "-".' });
    }
    if (explicit && (await repo.findByCode(explicit))) {
      throw Errors.duplicate({ itemCode: 'This item code is already in use.' });
    }
    const barcode = get<string>('barcode');
    if (barcode && (await repo.findByBarcode(barcode))) {
      throw Errors.duplicate({ barcode: 'This barcode is already in use.' });
    }
    try {
      const created = await prisma.$transaction(async (tx) => {
        const code = explicit ?? (await repo.nextCode(tx));
        const row = await repo.create(
          {
            ...(createData(values) as Prisma.ItemUncheckedCreateInput),
            code,
            createdById: caller.auth.userId,
          } as Prisma.ItemUncheckedCreateInput,
          tx,
        );
        await writeAudit(tx, caller, 'ITEM_CREATED', 'Item', row, PAGE, {
          after: { ...toData(row) } as Prisma.InputJsonObject,
        });
        return row;
      }, TX);
      return one(created);
    } catch (err) {
      throw mapDbError(err);
    }
  },

  async update(caller, id, version, input) {
    const current = await load(id);
    if (version !== current.version) throw Errors.versionConflict();
    const v = validateRecordInput(schema, input, 'patch');
    if (typeof v.values.itemCode === 'string' && v.values.itemCode.toUpperCase() !== current.code) {
      throw Errors.validation({ itemCode: 'The item code cannot be changed.' });
    }
    const data: Prisma.ItemUncheckedUpdateManyInput = {};
    for (const [key, column] of Object.entries(COLUMNS)) {
      if (v.values[key] !== undefined) Object.assign(data, { [column]: v.values[key] });
      if (v.cleared.includes(key)) Object.assign(data, { [column]: null });
    }
    // The values the item will have after this write, for the cross-field rules.
    const after = { ...toData(current) };
    for (const [key, column] of Object.entries(COLUMNS)) {
      if (column in data) after[key] = (data as Record<string, unknown>)[column];
    }
    assertItemRules({
      altUom: (after.altUom as string | null) ?? null,
      altUomFactor: (after.altUomFactor as number | null) ?? null,
      shelfLifeDays: (after.shelfLifeDays as number | null) ?? null,
    });
    if (data.baseUom !== undefined && data.baseUom !== current.baseUom) {
      if ((await countLedgerRows(prisma, id)) > 0) {
        throw Errors.conflict('The base UOM cannot change once the item has stock movements.');
      }
    }
    const barcode = after.barcode as string | null;
    if (barcode && barcode !== current.barcode && (await repo.findByBarcode(barcode, id))) {
      throw Errors.duplicate({ barcode: 'This barcode is already in use.' });
    }
    const before = toData(current);
    const changed = Object.keys(after).filter(
      (k) => JSON.stringify(after[k]) !== JSON.stringify(before[k]),
    );
    // Nothing changes: return the current row without a version bump or an audit row.
    if (changed.length === 0) return one(current);
    try {
      const updated = await prisma.$transaction(async (tx) => {
        if (
          !(await repo.updateIfVersion(
            id,
            version,
            { ...data, updatedById: caller.auth.userId },
            tx,
          ))
        ) {
          throw Errors.versionConflict();
        }
        const fresh = await tx.item.findUniqueOrThrow({ where: { id } });
        const freshData = toData(fresh);
        await writeAudit(tx, caller, 'ITEM_UPDATED', 'Item', fresh, PAGE, {
          before: Object.fromEntries(
            changed.map((k) => [k, before[k] ?? null]),
          ) as Prisma.InputJsonObject,
          after: Object.fromEntries(
            changed.map((k) => [k, freshData[k] ?? null]),
          ) as Prisma.InputJsonObject,
        });
        return fresh;
      }, TX);
      return one(updated);
    } catch (err) {
      throw mapDbError(err);
    }
  },

  async remove(caller, id, version) {
    const current = await load(id);
    if (version !== undefined && version !== current.version) throw Errors.versionConflict();
    if ((await countLedgerRows(prisma, id)) > 0) {
      throw Errors.inUse('This item has stock movements. Deactivate it instead.');
    }
    const vouchers = await repo.countVouchers(id);
    if (vouchers > 0) {
      throw Errors.inUse(
        `This item is used by ${vouchers} voucher${vouchers === 1 ? '' : 's'}. Deactivate it instead.`,
      );
    }
    const at = new Date();
    await prisma.$transaction(async (tx) => {
      if (!(await repo.softDelete(id, caller.auth.userId, at, tx)))
        throw Errors.notFound('Item not found.');
      await writeAudit(tx, caller, 'ITEM_DELETED', 'Item', current, PAGE, {
        before: toData(current) as Prisma.InputJsonObject,
      });
    }, TX);
    return { undoToken: undoTokenOf(id, at) };
  },

  async restore(caller, id, token) {
    const current = await load(id, true);
    if (token !== undefined && current.deletedAt && token !== undoTokenOf(id, current.deletedAt)) {
      throw Errors.validation({ undoToken: 'This undo token does not match the deleted item.' });
    }
    if (current.barcode && (await repo.findByBarcode(current.barcode, id))) {
      throw Errors.duplicate({ barcode: 'This barcode is now used by another item.' });
    }
    const restored = await prisma.$transaction(async (tx) => {
      if (!(await repo.restore(id, caller.auth.userId, tx)))
        throw Errors.notFound('Item not found.');
      await writeAudit(tx, caller, 'ITEM_RESTORED', 'Item', current, PAGE);
      return tx.item.findUniqueOrThrow({ where: { id } });
    }, TX);
    return one(restored);
  },

  async action(caller, id, actionKey) {
    if (actionKey !== 'activate' && actionKey !== 'deactivate') {
      throw Errors.notFound('Unknown action.');
    }
    const current = await load(id);
    const target = actionKey === 'activate' ? 'ACTIVE' : 'INACTIVE';
    if (current.status === target) {
      throw Errors.conflict(`The item is already ${masterStatusLabel(target).toLowerCase()}.`);
    }
    const updated = await prisma.$transaction(async (tx) => {
      if (
        !(await repo.updateIfVersion(
          id,
          current.version,
          { status: target, updatedById: caller.auth.userId },
          tx,
        ))
      ) {
        throw Errors.versionConflict();
      }
      await writeAudit(tx, caller, 'ITEM_STATUS_CHANGED', 'Item', current, PAGE, {
        from: masterStatusLabel(current.status),
        to: masterStatusLabel(target),
      });
      return tx.item.findUniqueOrThrow({ where: { id } });
    }, TX);
    return { record: await one(updated), replay: false };
  },

  async exportRows(caller, query) {
    return this.list(caller, { ...query, page: 1, size: 10_000 });
  },
};
