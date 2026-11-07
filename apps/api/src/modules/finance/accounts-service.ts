// Chart of accounts, account defaults, cost centres and profit centres (05b §5.2, §5.4, §5.5; 05c T-FIN-01/02).
// One tree of group and ledger accounts. System accounts (the seeded ones) cannot be deleted; the type and
// code of an account cannot change once it has ledger rows (history never changes meaning).
import type { Prisma } from '@prisma/client';
import { recordAudit } from '../../core/audit/audit-service';
import type { RequestMeta } from '../../core/auth/auth-context';
import type { Db } from '../../core/db/prisma';
import { prisma } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { FinErrors } from './errors';

export interface Actor {
  userId: string;
  meta?: RequestMeta;
}

export type RootType = 'Asset' | 'Liability' | 'Equity' | 'Income' | 'Expense';

export interface AccountInput {
  code: string;
  name: string;
  parentId?: string | null;
  isGroup?: boolean;
  rootType?: RootType;
  subType?: string;
  postingAllowed?: boolean;
  costCenterRequired?: boolean;
  partyRequired?: boolean;
  controlSide?: 'RECEIVABLE' | 'PAYABLE' | null;
  cfClass?: string;
}

const normalBalanceOf = (root: string): 'Debit' | 'Credit' =>
  root === 'Asset' || root === 'Expense' ? 'Debit' : 'Credit';

async function hasLedger(db: Db, accountId: string): Promise<boolean> {
  const n = await db.glEntry.count({ where: { accountId }, take: 1 });
  return n > 0;
}

/** Walks up from `start`; true when `target` is met (the update would make a cycle). */
async function isAncestor(db: Db, start: string | null, target: string): Promise<boolean> {
  let cur = start;
  for (let i = 0; i < 50 && cur; i++) {
    if (cur === target) return true;
    cur =
      (await db.account.findUnique({ where: { id: cur }, select: { parentId: true } }))?.parentId ??
      null;
  }
  return false;
}

export const accountsService = {
  async list(q: {
    q?: string;
    status?: string;
    rootType?: string;
    postable?: boolean;
    page: number;
    size: number;
  }) {
    const where: Prisma.AccountWhereInput = { deletedAt: null };
    if (q.status) where.status = q.status;
    if (q.rootType) where.rootType = q.rootType;
    if (q.postable)
      Object.assign(where, { postingAllowed: true, isGroup: false, status: 'Active' });
    if (q.q)
      where.OR = [{ code: { startsWith: q.q } }, { name: { contains: q.q, mode: 'insensitive' } }];
    const [rows, total] = await Promise.all([
      prisma.account.findMany({
        where,
        orderBy: { code: 'asc' },
        skip: (q.page - 1) * q.size,
        take: q.size,
      }),
      prisma.account.count({ where }),
    ]);
    return { rows, total };
  },

  async get(id: string) {
    const a = await prisma.account.findFirst({ where: { id, deletedAt: null } });
    if (!a) throw Errors.notFound('Account not found.');
    return a;
  },

  async create(input: AccountInput, actor: Actor) {
    return prisma.$transaction(async (tx) => {
      const exists = await tx.account.findUnique({ where: { code: input.code } });
      if (exists) throw Errors.duplicate({ code: 'This account code is already used.' });
      let rootType = input.rootType;
      if (input.parentId) {
        const parent = await tx.account.findFirst({
          where: { id: input.parentId, deletedAt: null },
        });
        if (!parent) throw Errors.validation({ parentId: 'Choose an existing parent account.' });
        if (!parent.isGroup)
          throw Errors.validation({ parentId: 'The parent must be a group account.' });
        if (rootType && rootType !== parent.rootType) {
          throw FinErrors.parentTypeMismatch(
            `A ${rootType} account cannot sit under a ${parent.rootType} group.`,
            {
              rootType: 'Must match the parent group.',
            },
          );
        }
        rootType = parent.rootType as RootType;
      }
      if (!rootType) throw Errors.validation({ rootType: 'Choose the account type.' });
      const isGroup = input.isGroup ?? false;
      const postingAllowed = isGroup ? false : (input.postingAllowed ?? true);
      if (input.partyRequired && !input.controlSide) {
        throw Errors.validation({
          controlSide: 'Choose Receivable or Payable for a party account.',
        });
      }
      const created = await tx.account.create({
        data: {
          code: input.code,
          name: input.name,
          parentId: input.parentId ?? null,
          isGroup,
          rootType,
          normalBalance: normalBalanceOf(rootType),
          subType: input.subType ?? 'Other',
          postingAllowed,
          costCenterRequired: input.costCenterRequired ?? false,
          partyRequired: isGroup ? false : (input.partyRequired ?? false),
          controlSide: input.controlSide ?? null,
          cfClass: input.cfClass ?? 'NA',
          createdById: actor.userId,
        },
      });
      await recordAudit(
        {
          action: 'ACCOUNT_CREATED',
          actorId: actor.userId,
          targetType: 'Account',
          targetId: created.id,
          ...(actor.meta ? { meta: actor.meta } : {}),
          detail: { code: created.code, name: created.name },
        },
        tx,
      );
      return created;
    });
  },

  async update(
    id: string,
    version: number,
    patch: Partial<AccountInput> & { status?: 'Active' | 'Inactive' },
    actor: Actor,
  ) {
    return prisma.$transaction(async (tx) => {
      const cur = await tx.account.findFirst({ where: { id, deletedAt: null } });
      if (!cur) throw Errors.notFound('Account not found.');
      if (cur.version !== version) throw Errors.versionConflict();
      const ledger = await hasLedger(tx, id);
      const data: Prisma.AccountUncheckedUpdateInput = {};
      if (patch.name !== undefined) data.name = patch.name;
      if (patch.costCenterRequired !== undefined)
        data.costCenterRequired = patch.costCenterRequired;
      if (patch.cfClass !== undefined) data.cfClass = patch.cfClass;
      if (patch.code !== undefined && patch.code !== cur.code) {
        if (ledger)
          throw FinErrors.accountHasBalance(
            'This account has ledger entries; its code cannot change.',
            { code: 'Locked.' },
          );
        if (cur.isSystem) throw Errors.protectedResource('A system account code cannot change.');
        if (await tx.account.findUnique({ where: { code: patch.code } }))
          throw Errors.duplicate({ code: 'This account code is already used.' });
        data.code = patch.code;
      }
      if (patch.subType !== undefined && patch.subType !== cur.subType) {
        if (ledger)
          throw FinErrors.accountHasBalance(
            'This account has ledger entries; its type cannot change.',
          );
        data.subType = patch.subType;
      }
      if (patch.partyRequired !== undefined || patch.controlSide !== undefined) {
        if (ledger)
          throw FinErrors.accountHasBalance(
            'This account has ledger entries; its party rule cannot change.',
          );
        const pr = patch.partyRequired ?? cur.partyRequired;
        const side = patch.controlSide === undefined ? cur.controlSide : patch.controlSide;
        if (pr && !side)
          throw Errors.validation({
            controlSide: 'Choose Receivable or Payable for a party account.',
          });
        data.partyRequired = cur.isGroup ? false : pr;
        data.controlSide = side;
      }
      if (patch.postingAllowed !== undefined && !cur.isGroup)
        data.postingAllowed = patch.postingAllowed;
      if (patch.parentId !== undefined && patch.parentId !== cur.parentId) {
        if (patch.parentId) {
          const parent = await tx.account.findFirst({
            where: { id: patch.parentId, deletedAt: null },
          });
          if (!parent || !parent.isGroup)
            throw Errors.validation({ parentId: 'The parent must be a group account.' });
          if (parent.rootType !== cur.rootType)
            throw FinErrors.parentTypeMismatch(
              `A ${cur.rootType} account cannot sit under a ${parent.rootType} group.`,
            );
          if (await isAncestor(tx, patch.parentId, id))
            throw FinErrors.cycle('An account cannot be moved under itself.');
        }
        data.parentId = patch.parentId;
      }
      let statusChanged = false;
      if (patch.status !== undefined && patch.status !== cur.status) {
        if (patch.status === 'Inactive' && cur.isSystem)
          throw Errors.protectedResource('A system account cannot be made inactive.');
        data.status = patch.status;
        statusChanged = true;
      }
      const res = await tx.account.updateMany({
        where: { id, version },
        data: {
          ...data,
          version: { increment: 1 },
          updatedById: actor.userId,
          updatedAt: new Date(),
        },
      });
      if (res.count !== 1) throw Errors.versionConflict();
      await recordAudit(
        {
          action: statusChanged ? 'ACCOUNT_STATUS_CHANGED' : 'ACCOUNT_UPDATED',
          actorId: actor.userId,
          targetType: 'Account',
          targetId: id,
          ...(actor.meta ? { meta: actor.meta } : {}),
          detail: { code: cur.code, changed: Object.keys(data) },
        },
        tx,
      );
      return tx.account.findUniqueOrThrow({ where: { id } });
    });
  },

  async remove(id: string, actor: Actor) {
    await prisma.$transaction(async (tx) => {
      const cur = await tx.account.findFirst({ where: { id, deletedAt: null } });
      if (!cur) throw Errors.notFound('Account not found.');
      if (cur.isSystem)
        throw Errors.protectedResource(
          'A system account cannot be deleted. Make it inactive instead.',
        );
      if (await tx.account.count({ where: { parentId: id, deletedAt: null } }))
        throw Errors.inUse('This account has child accounts.');
      if (await hasLedger(tx, id))
        throw FinErrors.accountHasBalance(
          'This account has ledger entries and cannot be deleted. Make it inactive instead.',
        );
      if (await tx.accountDefault.count({ where: { accountId: id } }))
        throw Errors.inUse('This account is a default account for postings.');
      if (await tx.bankAccount.count({ where: { accountId: id, deletedAt: null } }))
        throw Errors.inUse('A bank or cash book uses this account.');
      await tx.account.update({
        where: { id },
        data: { deletedAt: new Date(), deletedById: actor.userId, version: { increment: 1 } },
      });
      await recordAudit(
        {
          action: 'ACCOUNT_DELETED',
          actorId: actor.userId,
          targetType: 'Account',
          targetId: id,
          ...(actor.meta ? { meta: actor.meta } : {}),
          detail: { code: cur.code },
        },
        tx,
      );
    });
  },

  async defaults() {
    const rows = await prisma.accountDefault.findMany({ orderBy: { key: 'asc' } });
    const accounts = await prisma.account.findMany({
      where: { id: { in: rows.map((r) => r.accountId) } },
      select: { id: true, code: true, name: true },
    });
    const byId = new Map(accounts.map((a) => [a.id, a]));
    return rows.map((r) => ({
      key: r.key,
      accountId: r.accountId,
      code: byId.get(r.accountId)?.code ?? null,
      name: byId.get(r.accountId)?.name ?? null,
    }));
  },

  async setDefault(key: string, accountId: string, actor: Actor) {
    return prisma.$transaction(async (tx) => {
      const a = await tx.account.findFirst({
        where: { id: accountId, deletedAt: null, status: 'Active', isGroup: false },
      });
      if (!a) throw Errors.validation({ accountId: 'Choose an active ledger account.' });
      const row = await tx.accountDefault.upsert({
        where: { key },
        create: { key, accountId },
        update: { accountId },
      });
      await recordAudit(
        {
          action: 'ACCOUNT_DEFAULT_CHANGED',
          actorId: actor.userId,
          targetType: 'Account',
          targetId: accountId,
          ...(actor.meta ? { meta: actor.meta } : {}),
          detail: { key, code: a.code },
        },
        tx,
      );
      return row;
    });
  },
};

// ---------------------------------------------------------------------------------------------------------
export interface CostCenterInput {
  code: string;
  name: string;
  parentId?: string | null;
  unitId?: string | null;
  department?: string | null;
  managerId?: string | null;
  isGroup?: boolean;
}

export const costCentersService = {
  async list(q: {
    q?: string;
    status?: string;
    unitId?: string | null;
    page: number;
    size: number;
  }) {
    const where: Prisma.CostCenterWhereInput = { deletedAt: null };
    if (q.status) where.status = q.status;
    if (q.unitId) where.OR = [{ unitId: q.unitId }, { unitId: null }];
    if (q.q)
      where.AND = [
        {
          OR: [
            { code: { contains: q.q.toUpperCase() } },
            { name: { contains: q.q, mode: 'insensitive' } },
          ],
        },
      ];
    const [rows, total] = await Promise.all([
      prisma.costCenter.findMany({
        where,
        orderBy: { code: 'asc' },
        skip: (q.page - 1) * q.size,
        take: q.size,
      }),
      prisma.costCenter.count({ where }),
    ]);
    return { rows, total };
  },

  async create(input: CostCenterInput, actor: Actor) {
    return prisma.$transaction(async (tx) => {
      if (await tx.costCenter.findUnique({ where: { code: input.code } }))
        throw Errors.duplicate({ code: 'This cost centre code is already used.' });
      if (input.parentId) {
        const p = await tx.costCenter.findFirst({ where: { id: input.parentId, deletedAt: null } });
        if (!p || !p.isGroup)
          throw Errors.validation({ parentId: 'The parent must be a group cost centre.' });
      }
      const created = await tx.costCenter.create({
        data: {
          code: input.code,
          name: input.name,
          parentId: input.parentId ?? null,
          unitId: input.unitId ?? null,
          department: input.department ?? null,
          managerId: input.managerId ?? null,
          isGroup: input.isGroup ?? false,
          createdById: actor.userId,
        },
      });
      await recordAudit(
        {
          action: 'COST_CENTER_CREATED',
          actorId: actor.userId,
          targetType: 'CostCenter',
          targetId: created.id,
          ...(actor.meta ? { meta: actor.meta } : {}),
          detail: { code: created.code },
        },
        tx,
      );
      return created;
    });
  },

  async update(
    id: string,
    version: number,
    patch: Partial<CostCenterInput> & { status?: 'Active' | 'Inactive' },
    actor: Actor,
  ) {
    return prisma.$transaction(async (tx) => {
      const cur = await tx.costCenter.findFirst({ where: { id, deletedAt: null } });
      if (!cur) throw Errors.notFound('Cost centre not found.');
      if (cur.version !== version) throw Errors.versionConflict();
      const data: Prisma.CostCenterUncheckedUpdateInput = {};
      if (patch.name !== undefined) data.name = patch.name;
      if (patch.department !== undefined) data.department = patch.department;
      if (patch.managerId !== undefined) data.managerId = patch.managerId;
      if (patch.status !== undefined) data.status = patch.status;
      if (patch.parentId !== undefined && patch.parentId !== cur.parentId) {
        if (patch.parentId) {
          const p = await tx.costCenter.findFirst({
            where: { id: patch.parentId, deletedAt: null },
          });
          if (!p || !p.isGroup)
            throw Errors.validation({ parentId: 'The parent must be a group cost centre.' });
          let walk: string | null = patch.parentId;
          for (let i = 0; i < 50 && walk; i++) {
            if (walk === id) throw FinErrors.cycle('A cost centre cannot be moved under itself.');
            walk =
              (await tx.costCenter.findUnique({ where: { id: walk }, select: { parentId: true } }))
                ?.parentId ?? null;
          }
        }
        data.parentId = patch.parentId;
      }
      const res = await tx.costCenter.updateMany({
        where: { id, version },
        data: {
          ...data,
          version: { increment: 1 },
          updatedById: actor.userId,
          updatedAt: new Date(),
        },
      });
      if (res.count !== 1) throw Errors.versionConflict();
      await recordAudit(
        {
          action: 'COST_CENTER_UPDATED',
          actorId: actor.userId,
          targetType: 'CostCenter',
          targetId: id,
          ...(actor.meta ? { meta: actor.meta } : {}),
          detail: { code: cur.code, changed: Object.keys(data) },
        },
        tx,
      );
      return tx.costCenter.findUniqueOrThrow({ where: { id } });
    });
  },

  async remove(id: string, actor: Actor) {
    await prisma.$transaction(async (tx) => {
      const cur = await tx.costCenter.findFirst({ where: { id, deletedAt: null } });
      if (!cur) throw Errors.notFound('Cost centre not found.');
      if (await tx.costCenter.count({ where: { parentId: id, deletedAt: null } }))
        throw Errors.inUse('This cost centre has child cost centres.');
      if ((await tx.glEntry.count({ where: { costCenterId: id }, take: 1 })) > 0)
        throw Errors.inUse('Ledger entries use this cost centre. Make it inactive instead.');
      if ((await tx.budget.count({ where: { costCenterId: id, deletedAt: null } })) > 0)
        throw Errors.inUse('A budget uses this cost centre.');
      await tx.costCenter.update({
        where: { id },
        data: { deletedAt: new Date(), deletedById: actor.userId, version: { increment: 1 } },
      });
      await recordAudit(
        {
          action: 'COST_CENTER_DELETED',
          actorId: actor.userId,
          targetType: 'CostCenter',
          targetId: id,
          ...(actor.meta ? { meta: actor.meta } : {}),
          detail: { code: cur.code },
        },
        tx,
      );
    });
  },
};

// ---------------------------------------------------------------------------------------------------------
export interface ProfitCenterInput {
  code: string;
  name: string;
  unitId: string;
  managerId?: string | null;
  isDefault?: boolean;
}

export const profitCentersService = {
  async list(q: {
    q?: string;
    status?: string;
    unitId?: string | null;
    page: number;
    size: number;
  }) {
    const where: Prisma.ProfitCenterWhereInput = { deletedAt: null };
    if (q.status) where.status = q.status;
    if (q.unitId) where.unitId = q.unitId;
    if (q.q)
      where.OR = [
        { code: { contains: q.q.toUpperCase() } },
        { name: { contains: q.q, mode: 'insensitive' } },
      ];
    const [rows, total] = await Promise.all([
      prisma.profitCenter.findMany({
        where,
        orderBy: { code: 'asc' },
        skip: (q.page - 1) * q.size,
        take: q.size,
      }),
      prisma.profitCenter.count({ where }),
    ]);
    return { rows, total };
  },

  async create(input: ProfitCenterInput, actor: Actor) {
    return prisma.$transaction(async (tx) => {
      if (await tx.profitCenter.findUnique({ where: { code: input.code } }))
        throw Errors.duplicate({ code: 'This profit centre code is already used.' });
      const unit = await tx.unit.findUnique({ where: { id: input.unitId } });
      if (!unit) throw Errors.validation({ unitId: 'Choose a unit.' });
      const hasDefault =
        (await tx.profitCenter.count({
          where: { unitId: input.unitId, isDefault: true, deletedAt: null },
        })) > 0;
      const makeDefault = input.isDefault === true || !hasDefault;
      if (makeDefault && hasDefault) {
        await tx.profitCenter.updateMany({
          where: { unitId: input.unitId, isDefault: true, deletedAt: null },
          data: { isDefault: false },
        });
      }
      const created = await tx.profitCenter.create({
        data: {
          code: input.code,
          name: input.name,
          unitId: input.unitId,
          managerId: input.managerId ?? null,
          isDefault: makeDefault,
          createdById: actor.userId,
        },
      });
      await recordAudit(
        {
          action: 'PROFIT_CENTER_CREATED',
          actorId: actor.userId,
          targetType: 'ProfitCenter',
          targetId: created.id,
          ...(actor.meta ? { meta: actor.meta } : {}),
          detail: { code: created.code },
        },
        tx,
      );
      return created;
    });
  },

  async update(
    id: string,
    version: number,
    patch: Partial<ProfitCenterInput> & { status?: 'Active' | 'Inactive' },
    actor: Actor,
  ) {
    return prisma.$transaction(async (tx) => {
      const cur = await tx.profitCenter.findFirst({ where: { id, deletedAt: null } });
      if (!cur) throw Errors.notFound('Profit centre not found.');
      if (cur.version !== version) throw Errors.versionConflict();
      const data: Prisma.ProfitCenterUncheckedUpdateInput = {};
      if (patch.name !== undefined) data.name = patch.name;
      if (patch.managerId !== undefined) data.managerId = patch.managerId;
      if (patch.status !== undefined) {
        if (patch.status === 'Inactive' && cur.isDefault)
          throw Errors.protectedResource(
            'The default profit centre of a unit cannot be made inactive.',
          );
        data.status = patch.status;
      }
      if (patch.isDefault === true && !cur.isDefault) {
        await tx.profitCenter.updateMany({
          where: { unitId: cur.unitId, isDefault: true, deletedAt: null },
          data: { isDefault: false },
        });
        data.isDefault = true;
      }
      const res = await tx.profitCenter.updateMany({
        where: { id, version },
        data: {
          ...data,
          version: { increment: 1 },
          updatedById: actor.userId,
          updatedAt: new Date(),
        },
      });
      if (res.count !== 1) throw Errors.versionConflict();
      await recordAudit(
        {
          action: 'PROFIT_CENTER_UPDATED',
          actorId: actor.userId,
          targetType: 'ProfitCenter',
          targetId: id,
          ...(actor.meta ? { meta: actor.meta } : {}),
          detail: { code: cur.code, changed: Object.keys(data) },
        },
        tx,
      );
      return tx.profitCenter.findUniqueOrThrow({ where: { id } });
    });
  },

  async remove(id: string, actor: Actor) {
    await prisma.$transaction(async (tx) => {
      const cur = await tx.profitCenter.findFirst({ where: { id, deletedAt: null } });
      if (!cur) throw Errors.notFound('Profit centre not found.');
      if (cur.isDefault)
        throw Errors.protectedResource('The default profit centre of a unit cannot be deleted.');
      if ((await tx.glEntry.count({ where: { profitCenterId: id }, take: 1 })) > 0)
        throw Errors.inUse('Ledger entries use this profit centre. Make it inactive instead.');
      await tx.profitCenter.update({
        where: { id },
        data: { deletedAt: new Date(), deletedById: actor.userId, version: { increment: 1 } },
      });
      await recordAudit(
        {
          action: 'PROFIT_CENTER_DELETED',
          actorId: actor.userId,
          targetType: 'ProfitCenter',
          targetId: id,
          ...(actor.meta ? { meta: actor.meta } : {}),
          detail: { code: cur.code },
        },
        tx,
      );
    });
  },
};
