// The ONLY code of Phase 6B that touches Prisma / SQL. Formats and rule sets share one lifecycle, so
// each table is wrapped in an adapter that returns the same normalized VersionRow.
import { Prisma } from '@prisma/client';
import type { FormatDefinition, RuleSet } from '@prisma/client';
import { prisma } from '../../core/db/prisma';
import type { Db } from '../../core/db/prisma';
import { OPEN_DOCUMENT_STATUSES } from '../../core/settings/constants';

export type Target = 'FORMAT' | 'RULE_SET';

export interface VersionRow {
  target: Target;
  id: string;
  pageId: string;
  version: number;
  status: string;
  name: string;
  rowVersion: number;
  reason: string | null;
  /** schema (formats) or definition (rule sets) */
  content: Prisma.JsonValue;
  sourceFileId: string | null;
  createdAt: Date;
  createdById: string;
  updatedAt: Date;
  updatedById: string | null;
  publishedAt: Date | null;
  publishedById: string | null;
  retiredAt: Date | null;
  // formats
  kind: string | null;
  customerId: string | null;
  unitId: string | null;
  // rule sets
  code: string | null;
  moneyAffecting: boolean | null;
}

/** The identity a version series shares. */
export type SeriesKey =
  | {
      target: 'FORMAT';
      pageId: string;
      kind: string;
      customerId: string | null;
      unitId: string | null;
    }
  | { target: 'RULE_SET'; pageId: string; code: string };

export interface DraftInput {
  name: string;
  content: Prisma.InputJsonValue;
  reason: string | null;
  moneyAffecting: boolean;
  sourceFileId: string | null;
}

function fromFormat(r: FormatDefinition): VersionRow {
  return {
    target: 'FORMAT',
    id: r.id,
    pageId: r.pageId,
    version: r.version,
    status: r.status,
    name: r.name,
    rowVersion: r.rowVersion,
    reason: r.reason,
    content: r.schema,
    sourceFileId: r.sourceFileId,
    createdAt: r.createdAt,
    createdById: r.createdById,
    updatedAt: r.updatedAt,
    updatedById: r.updatedById,
    publishedAt: r.publishedAt,
    publishedById: r.publishedById,
    retiredAt: r.retiredAt,
    kind: r.kind,
    customerId: r.customerId,
    unitId: r.unitId,
    code: null,
    moneyAffecting: null,
  };
}

function fromRule(r: RuleSet): VersionRow {
  return {
    target: 'RULE_SET',
    id: r.id,
    pageId: r.pageId,
    version: r.version,
    status: r.status,
    name: r.name,
    rowVersion: r.rowVersion,
    reason: r.reason,
    content: r.definition,
    sourceFileId: r.sourceFileId,
    createdAt: r.createdAt,
    createdById: r.createdById,
    updatedAt: r.updatedAt,
    updatedById: r.updatedById,
    publishedAt: r.publishedAt,
    publishedById: r.publishedById,
    retiredAt: r.retiredAt,
    kind: null,
    customerId: null,
    unitId: null,
    code: r.code,
    moneyAffecting: r.moneyAffecting,
  };
}

function formatWhere(
  k: Extract<SeriesKey, { target: 'FORMAT' }>,
): Prisma.FormatDefinitionWhereInput {
  return { pageId: k.pageId, kind: k.kind, customerId: k.customerId, unitId: k.unitId };
}

export const keyOf = (row: VersionRow): SeriesKey =>
  row.target === 'FORMAT'
    ? {
        target: 'FORMAT',
        pageId: row.pageId,
        kind: row.kind as string,
        customerId: row.customerId,
        unitId: row.unitId,
      }
    : { target: 'RULE_SET', pageId: row.pageId, code: row.code as string };

export const settingsRepository = {
  async byId(target: Target, id: string, db: Db = prisma): Promise<VersionRow | null> {
    if (target === 'FORMAT') {
      const r = await db.formatDefinition.findUnique({ where: { id } });
      return r ? fromFormat(r) : null;
    }
    const r = await db.ruleSet.findUnique({ where: { id } });
    return r ? fromRule(r) : null;
  },

  /** Row lock for the lifecycle verbs (publish, retire, discard): serializes double clicks. */
  async lock(target: Target, id: string, db: Db): Promise<VersionRow | null> {
    const table = Prisma.raw(target === 'FORMAT' ? 'format_definitions' : 'rule_sets');
    const rows = await db.$queryRaw<
      { id: string }[]
    >`SELECT id FROM ${table} WHERE id = ${id}::uuid FOR UPDATE`;
    if (!rows[0]) return null;
    return settingsRepository.byId(target, id, db);
  },

  async series(key: SeriesKey, db: Db = prisma): Promise<VersionRow[]> {
    if (key.target === 'FORMAT') {
      const rows = await db.formatDefinition.findMany({
        where: formatWhere(key),
        orderBy: { version: 'desc' },
      });
      return rows.map(fromFormat);
    }
    const rows = await db.ruleSet.findMany({
      where: { pageId: key.pageId, code: key.code },
      orderBy: { version: 'desc' },
    });
    return rows.map(fromRule);
  },

  /** Live rows (not retired) of a page: the ACTIVE version and any open draft of every series. */
  async liveOfPage(
    target: Target,
    pageId: string,
    filter: { kind?: string | undefined } = {},
    db: Db = prisma,
  ): Promise<VersionRow[]> {
    if (target === 'FORMAT') {
      const rows = await db.formatDefinition.findMany({
        where: {
          pageId,
          status: { not: 'RETIRED' },
          ...(filter.kind ? { kind: filter.kind } : {}),
        },
        orderBy: [{ kind: 'asc' }, { createdAt: 'asc' }],
      });
      return rows.map(fromFormat);
    }
    const rows = await db.ruleSet.findMany({
      where: { pageId, status: { not: 'RETIRED' } },
      orderBy: [{ code: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map(fromRule);
  },

  async activeOfSeries(key: SeriesKey, db: Db = prisma): Promise<VersionRow | null> {
    const rows = await settingsRepository.series(key, db);
    return rows.find((r) => r.status === 'ACTIVE') ?? null;
  },

  async openDraft(key: SeriesKey, db: Db = prisma): Promise<VersionRow | null> {
    const rows = await settingsRepository.series(key, db);
    return rows.find((r) => r.status === 'DRAFT' || r.status === 'PENDING_APPROVAL') ?? null;
  },

  async nextVersion(key: SeriesKey, db: Db): Promise<number> {
    if (key.target === 'FORMAT') {
      const agg = await db.formatDefinition.aggregate({
        where: formatWhere(key),
        _max: { version: true },
      });
      return (agg._max.version ?? 0) + 1;
    }
    const agg = await db.ruleSet.aggregate({
      where: { pageId: key.pageId, code: key.code },
      _max: { version: true },
    });
    return (agg._max.version ?? 0) + 1;
  },

  async createDraft(
    key: SeriesKey,
    version: number,
    input: DraftInput,
    userId: string,
    db: Db,
  ): Promise<VersionRow> {
    if (key.target === 'FORMAT') {
      const r = await db.formatDefinition.create({
        data: {
          pageId: key.pageId,
          kind: key.kind,
          customerId: key.customerId,
          unitId: key.unitId,
          version,
          status: 'DRAFT',
          name: input.name,
          schema: input.content,
          sourceFileId: input.sourceFileId,
          reason: input.reason,
          createdById: userId,
          updatedById: userId,
        },
      });
      return fromFormat(r);
    }
    const r = await db.ruleSet.create({
      data: {
        pageId: key.pageId,
        code: key.code,
        version,
        status: 'DRAFT',
        name: input.name,
        moneyAffecting: input.moneyAffecting,
        definition: input.content,
        sourceFileId: input.sourceFileId,
        reason: input.reason,
        createdById: userId,
        updatedById: userId,
      },
    });
    return fromRule(r);
  },

  /** Optimistic update of a DRAFT: false when someone else changed it first. */
  async updateDraft(
    target: Target,
    id: string,
    expectedRowVersion: number,
    input: DraftInput,
    userId: string,
    db: Db,
  ): Promise<boolean> {
    const common = {
      name: input.name,
      reason: input.reason,
      updatedById: userId,
      updatedAt: new Date(),
      rowVersion: { increment: 1 },
      ...(input.sourceFileId ? { sourceFileId: input.sourceFileId } : {}),
    };
    if (target === 'FORMAT') {
      const n = await db.formatDefinition.updateMany({
        where: { id, status: 'DRAFT', rowVersion: expectedRowVersion },
        data: { ...common, schema: input.content },
      });
      return n.count === 1;
    }
    const n = await db.ruleSet.updateMany({
      where: { id, status: 'DRAFT', rowVersion: expectedRowVersion },
      data: { ...common, definition: input.content, moneyAffecting: input.moneyAffecting },
    });
    return n.count === 1;
  },

  async setStatus(
    target: Target,
    id: string,
    status: string,
    userId: string | null,
    extra: { reason?: string | null; published?: boolean; retired?: boolean },
    db: Db,
  ): Promise<void> {
    const now = new Date();
    const data = {
      status,
      updatedAt: now,
      updatedById: userId,
      rowVersion: { increment: 1 },
      ...(extra.reason !== undefined ? { reason: extra.reason } : {}),
      ...(extra.published ? { publishedAt: now, publishedById: userId } : {}),
      ...(extra.retired ? { retiredAt: now } : {}),
    };
    if (target === 'FORMAT') await db.formatDefinition.update({ where: { id }, data });
    else await db.ruleSet.update({ where: { id }, data });
  },

  async setReason(
    target: Target,
    id: string,
    reason: string,
    userId: string,
    db: Db,
  ): Promise<void> {
    const data = {
      reason,
      updatedById: userId,
      updatedAt: new Date(),
      rowVersion: { increment: 1 },
    };
    if (target === 'FORMAT') await db.formatDefinition.update({ where: { id }, data });
    else await db.ruleSet.update({ where: { id }, data });
  },

  async deleteDraft(target: Target, id: string, db: Db): Promise<void> {
    if (target === 'FORMAT') await db.formatDefinition.delete({ where: { id } });
    else await db.ruleSet.delete({ where: { id } });
  },

  /** Number of open (Draft / Pending / Rejected) documents that were created with this version. */
  async openDocumentsUsing(target: Target, id: string, db: Db = prisma): Promise<number> {
    const open = Prisma.join([...OPEN_DOCUMENT_STATUSES]);
    if (target === 'FORMAT') {
      const rows = await db.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM generic_records
         WHERE format_version_id = ${id}::uuid AND deleted_at IS NULL AND status IN (${open})`;
      return rows[0]?.n ?? 0;
    }
    const rows = await db.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM generic_records g
       WHERE g.deleted_at IS NULL AND g.status IN (${open}) AND g.rule_set_version_ids IS NOT NULL
         AND EXISTS (SELECT 1 FROM jsonb_each_text(g.rule_set_version_ids) e WHERE e.value = ${id})`;
    return rows[0]?.n ?? 0;
  },

  async addChange(
    c: {
      target: Target;
      targetId: string;
      pageId: string;
      version: number;
      action: 'DRAFTED' | 'PUBLISHED' | 'RETIRED' | 'IMPORTED' | 'RESTORED' | 'DISCARDED';
      userId: string | null;
      reason: string | null;
      before?: Prisma.InputJsonValue | undefined;
      after?: Prisma.InputJsonValue | undefined;
    },
    db: Db,
  ): Promise<void> {
    await db.settingsChange.create({
      data: {
        targetType: c.target,
        targetId: c.targetId,
        pageId: c.pageId,
        version: c.version,
        action: c.action,
        changedById: c.userId,
        reason: c.reason,
        ...(c.before !== undefined ? { before: c.before } : {}),
        ...(c.after !== undefined ? { after: c.after } : {}),
      },
    });
  },

  // ---- lookups for the DTOs and the global lists -------------------------------------------------
  async userNames(ids: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = await prisma.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, name: true },
    });
    return new Map(rows.map((r) => [r.id, r.name]));
  },
  async customerNames(ids: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = await prisma.customer.findMany({
      where: { id: { in: unique } },
      select: { id: true, name: true },
    });
    return new Map(rows.map((r) => [r.id, r.name]));
  },
  async unitNames(ids: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = await prisma.unit.findMany({
      where: { id: { in: unique } },
      select: { id: true, name: true },
    });
    return new Map(rows.map((r) => [r.id, r.name]));
  },
  customerExists: async (id: string, db: Db = prisma): Promise<boolean> =>
    (await db.customer.count({ where: { id } })) > 0,
  unitExists: async (id: string, db: Db = prisma): Promise<boolean> =>
    (await db.unit.count({ where: { id } })) > 0,
  controlOf: (pageId: string, db: Db = prisma) =>
    db.moduleControl.findUnique({
      where: { pageId },
      select: { ownerDepartment: true, approvalRequired: true },
    }),
  anyUnitId: async (db: Db): Promise<string | null> =>
    (await db.unit.findFirst({ orderBy: { code: 'asc' }, select: { id: true } }))?.id ?? null,

  async listAll(q: {
    q?: string | undefined;
    pageId?: string | undefined;
    type?: 'format' | 'rule' | undefined;
    status?: string | undefined;
    offset: number;
    limit: number;
  }): Promise<{ rows: VersionRow[]; total: number }> {
    const like = q.q ? `%${q.q.replace(/[%_\\]/g, (m) => `\\${m}`)}%` : null;
    const fWhere: Prisma.FormatDefinitionWhereInput = {
      ...(q.pageId ? { pageId: q.pageId } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(like
        ? {
            OR: [
              { name: { contains: q.q as string, mode: 'insensitive' } },
              { pageId: { contains: q.q as string, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const rWhere: Prisma.RuleSetWhereInput = {
      ...(q.pageId ? { pageId: q.pageId } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(like
        ? {
            OR: [
              { name: { contains: q.q as string, mode: 'insensitive' } },
              { code: { contains: q.q as string, mode: 'insensitive' } },
              { pageId: { contains: q.q as string, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    // Formats first, then rule sets (stable), paged over the concatenation.
    const fCount = q.type === 'rule' ? 0 : await prisma.formatDefinition.count({ where: fWhere });
    const rCount = q.type === 'format' ? 0 : await prisma.ruleSet.count({ where: rWhere });
    const rows: VersionRow[] = [];
    if (q.offset < fCount) {
      const f = await prisma.formatDefinition.findMany({
        where: fWhere,
        orderBy: [{ pageId: 'asc' }, { kind: 'asc' }, { version: 'desc' }, { id: 'asc' }],
        skip: q.offset,
        take: q.limit,
      });
      rows.push(...f.map(fromFormat));
    }
    if (rows.length < q.limit && rCount > 0) {
      const skip = Math.max(0, q.offset - fCount);
      const r = await prisma.ruleSet.findMany({
        where: rWhere,
        orderBy: [{ pageId: 'asc' }, { code: 'asc' }, { version: 'desc' }, { id: 'asc' }],
        skip,
        take: q.limit - rows.length,
      });
      rows.push(...r.map(fromRule));
    }
    return { rows, total: fCount + rCount };
  },

  async changes(q: { pageId?: string | undefined; offset: number; limit: number }) {
    const where: Prisma.SettingsChangeWhereInput = q.pageId ? { pageId: q.pageId } : {};
    const [rows, total] = await Promise.all([
      prisma.settingsChange.findMany({
        where,
        orderBy: [{ at: 'desc' }, { id: 'desc' }],
        skip: q.offset,
        take: q.limit,
      }),
      prisma.settingsChange.count({ where }),
    ]);
    return { rows, total };
  },

  /** All ACTIVE formats of a page + kind that could apply to (customer, unit). */
  async candidates(
    pageId: string,
    kind: string,
    customerId: string | null,
    unitId: string | null,
    db: Db = prisma,
  ) {
    const rows = await db.formatDefinition.findMany({
      where: {
        pageId,
        kind,
        status: 'ACTIVE',
        AND: [
          { OR: [{ customerId: null }, ...(customerId ? [{ customerId }] : [])] },
          { OR: [{ unitId: null }, ...(unitId ? [{ unitId }] : [])] },
        ],
      },
    });
    return rows.map(fromFormat);
  },

  activeRuleSets: async (pageId: string, db: Db = prisma): Promise<VersionRow[]> =>
    (
      await db.ruleSet.findMany({ where: { pageId, status: 'ACTIVE' }, orderBy: { code: 'asc' } })
    ).map(fromRule),

  ruleSetsByIds: async (ids: string[], db: Db = prisma): Promise<VersionRow[]> =>
    ids.length === 0
      ? []
      : (await db.ruleSet.findMany({ where: { id: { in: ids } } })).map(fromRule),
};
