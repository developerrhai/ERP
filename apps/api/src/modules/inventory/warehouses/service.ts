// Warehouse Master rules (docs/phase3-4 C1): a warehouse belongs to the unit of the request context
// (a concrete unit is needed to create one), the code is unique and fixed, delete is refused with
// 409 IN_USE once stock or vouchers reference it (deactivate instead). Audited; soft delete + undo.
import { Prisma } from '@prisma/client';
import { prisma } from '../../../core/db/prisma';
import { Errors } from '../../../core/http/errors';
import { validateRecordInput } from '../../../engine/record-input';
import type { PageSchema } from '../../../engine/field-schema';
import { TYPED_SCHEMAS } from '../definitions';
import { num } from '../money';
import {
  INVENTORY_DEPARTMENT,
  concreteUnit,
  masterStatusLabel,
  undoTokenOf,
  unitFilter,
  userNames,
  writeAudit,
} from '../typed';
import type { TypedHandler, TypedRecordDto } from '../typed';
import { warehouseRepository as repo } from './repository';
import type { WarehouseWithUnit } from './repository';

const PAGE = 'wms-warehouses';
const schema = TYPED_SCHEMAS['wms-warehouses'] as unknown as PageSchema;
const TX = { maxWait: 15_000, timeout: 15_000 };

const SORTS: Record<string, string> = {
  warehouseCode: 'code',
  code: 'code',
  warehouseName: 'name',
  address: 'address',
  manager: 'manager',
  totalCapacity: 'totalCapacity',
  dockDoors: 'dockDoors',
  temperatureZone: 'temperatureZone',
  status: 'status',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
};

const COLUMNS: Record<string, keyof Prisma.WarehouseUncheckedUpdateManyInput> = {
  warehouseName: 'name',
  address: 'address',
  manager: 'manager',
  totalCapacity: 'totalCapacity',
  dockDoors: 'dockDoors',
  operatingHours: 'operatingHours',
  temperatureZone: 'temperatureZone',
};

function toData(row: WarehouseWithUnit): Record<string, unknown> {
  return {
    warehouseCode: row.code,
    warehouseName: row.name,
    branch: row.unitId,
    address: row.address,
    manager: row.manager,
    totalCapacity: num(row.totalCapacity),
    dockDoors: row.dockDoors,
    operatingHours: row.operatingHours,
    temperatureZone: row.temperatureZone,
  };
}

async function toDtos(rows: WarehouseWithUnit[]): Promise<TypedRecordDto[]> {
  const names = await userNames(rows.map((r) => r.createdById));
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    status: masterStatusLabel(row.status),
    unitId: row.unitId,
    fyId: null,
    department: INVENTORY_DEPARTMENT,
    data: { ...toData(row), status: masterStatusLabel(row.status) },
    version: row.version,
    amount: null,
    createdAt: row.createdAt.toISOString(),
    createdBy: { id: row.createdById, name: names.get(row.createdById) ?? '' },
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
    refs: { branch: { id: row.unit.id, code: row.unit.code, name: row.unit.name } },
  }));
}

async function one(row: WarehouseWithUnit): Promise<TypedRecordDto> {
  const [dto] = await toDtos([row]);
  if (!dto) throw Errors.notFound('Warehouse not found.');
  return dto;
}

async function visible(caller: Parameters<typeof unitFilter>[0], id: string, deleted = false) {
  const row = await repo.find(id, deleted);
  const scope = unitFilter(caller);
  if (!row || scope.none || (scope.unitId !== null && row.unitId !== scope.unitId)) {
    throw Errors.notFound('Warehouse not found.');
  }
  return row;
}

function assertDockDoors(value: unknown): void {
  if (
    value !== undefined &&
    value !== null &&
    (!Number.isInteger(value) || (value as number) < 0)
  ) {
    throw Errors.validation({ dockDoors: 'Enter a whole number of dock doors.' });
  }
}

function mapDbError(err: unknown): unknown {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    return Errors.duplicate({ warehouseCode: 'This warehouse code is already in use.' });
  }
  if (
    err instanceof Prisma.PrismaClientUnknownRequestError &&
    /violates RESTRICT/.test(err.message)
  ) {
    return Errors.inUse('This warehouse is still in use. Deactivate it instead.');
  }
  return err;
}

function orderBy(sort: string): Prisma.WarehouseOrderByWithRelationInput[] {
  const desc = sort.startsWith('-');
  const column = SORTS[desc ? sort.slice(1) : sort];
  if (!column) {
    throw Errors.validation({
      sort: 'Sort by one of the warehouse fields, code, createdAt or updatedAt.',
    });
  }
  return [{ [column]: desc ? 'desc' : 'asc' }, { id: 'asc' }];
}

export const warehouseHandler: TypedHandler = {
  pageId: PAGE,

  async list(caller, query) {
    const scope = unitFilter(caller);
    const status =
      query.status === 'Active' ? 'ACTIVE' : query.status === 'Inactive' ? 'INACTIVE' : undefined;
    if (query.status && !status) throw Errors.validation({ status: 'Use Active or Inactive.' });
    const { rows, total } = await repo.list(
      {
        q: query.q,
        status,
        deleted: query.deleted === true,
        unitId: scope.unitId,
        none: scope.none,
      },
      orderBy(query.sort),
      { skip: (query.page - 1) * query.size, take: query.size },
    );
    return { rows: await toDtos(rows), total };
  },

  async get(caller, id) {
    return one(await visible(caller, id));
  },

  async create(caller, input) {
    const unitId = concreteUnit(caller);
    const v = validateRecordInput(schema, input, 'create');
    assertDockDoors(v.values.dockDoors);
    const code = (
      typeof v.values.warehouseCode === 'string' ? v.values.warehouseCode : ''
    ).toUpperCase();
    if (!/^[A-Z0-9/_-]{2,30}$/.test(code)) {
      throw Errors.validation({ warehouseCode: 'Use 2-30 letters, digits, "/", "_" or "-".' });
    }
    if (await repo.findByCode(code)) {
      throw Errors.duplicate({ warehouseCode: 'This warehouse code is already in use.' });
    }
    const data: Record<string, unknown> = {};
    for (const [key, column] of Object.entries(COLUMNS)) {
      if (v.values[key] !== undefined) data[column] = v.values[key];
    }
    try {
      const created = await prisma.$transaction(async (tx) => {
        const row = await repo.create(
          {
            ...(data as Prisma.WarehouseUncheckedCreateInput),
            code,
            unitId,
            createdById: caller.auth.userId,
          } as Prisma.WarehouseUncheckedCreateInput,
          tx,
        );
        const full = await repo.find(row.id, false, tx);
        if (!full) throw Errors.notFound('Warehouse not found.');
        await writeAudit(tx, caller, 'WAREHOUSE_CREATED', 'Warehouse', row, PAGE, {
          unitId,
          after: toData(full) as Prisma.InputJsonObject,
        });
        return full;
      }, TX);
      return one(created);
    } catch (err) {
      throw mapDbError(err);
    }
  },

  async update(caller, id, version, input) {
    const current = await visible(caller, id);
    if (version !== current.version) throw Errors.versionConflict();
    const v = validateRecordInput(schema, input, 'patch');
    if (
      typeof v.values.warehouseCode === 'string' &&
      v.values.warehouseCode.toUpperCase() !== current.code
    ) {
      throw Errors.validation({ warehouseCode: 'The warehouse code cannot be changed.' });
    }
    assertDockDoors(v.values.dockDoors);
    const data: Prisma.WarehouseUncheckedUpdateManyInput = {};
    for (const [key, column] of Object.entries(COLUMNS)) {
      if (v.values[key] !== undefined) Object.assign(data, { [column]: v.values[key] });
      if (v.cleared.includes(key)) Object.assign(data, { [column]: null });
    }
    const before = toData(current);
    const after = { ...before };
    for (const [key, column] of Object.entries(COLUMNS)) {
      if (column in data) after[key] = (data as Record<string, unknown>)[column];
    }
    const changed = Object.keys(after).filter(
      (k) => JSON.stringify(after[k]) !== JSON.stringify(before[k]),
    );
    if (changed.length === 0) return one(current);
    const updated = await prisma.$transaction(async (tx) => {
      if (
        !(await repo.updateIfVersion(id, version, { ...data, updatedById: caller.auth.userId }, tx))
      ) {
        throw Errors.versionConflict();
      }
      const fresh = await repo.find(id, false, tx);
      if (!fresh) throw Errors.notFound('Warehouse not found.');
      const freshData = toData(fresh);
      await writeAudit(tx, caller, 'WAREHOUSE_UPDATED', 'Warehouse', fresh, PAGE, {
        unitId: fresh.unitId,
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
  },

  async remove(caller, id, version) {
    const current = await visible(caller, id);
    if (version !== undefined && version !== current.version) throw Errors.versionConflict();
    const refs = await repo.countReferences(id);
    if (refs > 0) {
      throw Errors.inUse('This warehouse has stock movements or vouchers. Deactivate it instead.');
    }
    const at = new Date();
    await prisma.$transaction(async (tx) => {
      if (!(await repo.softDelete(id, caller.auth.userId, at, tx))) {
        throw Errors.notFound('Warehouse not found.');
      }
      await writeAudit(tx, caller, 'WAREHOUSE_DELETED', 'Warehouse', current, PAGE, {
        unitId: current.unitId,
        before: toData(current) as Prisma.InputJsonObject,
      });
    }, TX);
    return { undoToken: undoTokenOf(id, at) };
  },

  async restore(caller, id, token) {
    const current = await visible(caller, id, true);
    if (token !== undefined && current.deletedAt && token !== undoTokenOf(id, current.deletedAt)) {
      throw Errors.validation({
        undoToken: 'This undo token does not match the deleted warehouse.',
      });
    }
    const restored = await prisma.$transaction(async (tx) => {
      if (!(await repo.restore(id, caller.auth.userId, tx)))
        throw Errors.notFound('Warehouse not found.');
      await writeAudit(tx, caller, 'WAREHOUSE_RESTORED', 'Warehouse', current, PAGE, {
        unitId: current.unitId,
      });
      const fresh = await repo.find(id, false, tx);
      if (!fresh) throw Errors.notFound('Warehouse not found.');
      return fresh;
    }, TX);
    return one(restored);
  },

  async action(caller, id, actionKey) {
    if (actionKey !== 'activate' && actionKey !== 'deactivate') {
      throw Errors.notFound('Unknown action.');
    }
    const current = await visible(caller, id);
    const target = actionKey === 'activate' ? 'ACTIVE' : 'INACTIVE';
    if (current.status === target) {
      throw Errors.conflict(`The warehouse is already ${masterStatusLabel(target).toLowerCase()}.`);
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
      await writeAudit(tx, caller, 'WAREHOUSE_STATUS_CHANGED', 'Warehouse', current, PAGE, {
        unitId: current.unitId,
        from: masterStatusLabel(current.status),
        to: masterStatusLabel(target),
      });
      const fresh = await repo.find(id, false, tx);
      if (!fresh) throw Errors.notFound('Warehouse not found.');
      return fresh;
    }, TX);
    return { record: await one(updated), replay: false };
  },

  async exportRows(caller, query) {
    return this.list(caller, { ...query, page: 1, size: 10_000 });
  },
};
