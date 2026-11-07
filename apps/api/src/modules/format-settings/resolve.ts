// FormatService.resolve and the document-side helpers (docs/phases/PHASE-06B.md §5). Everything a
// screen, a print or a document needs to READ from Settings goes through this file:
//   * resolve(): the ACTIVE format for (page, kind, customer, unit) - customer beats unit beats default;
//   * documentSettings.stamp(): the versions a NEW document is created with (kept for ever);
//   * documentSettings.calculate(): the rule sets' results for a document's data, with the PINNED
//     versions (an old document keeps the rates it was created with).
import { Prisma } from '@prisma/client';
import { prisma } from '../../core/db/prisma';
import type { Db } from '../../core/db/prisma';
import { RuleEngine, ruleDefinitionSchema } from '../../core/settings/rule-engine';
import type { RuleDefinition } from '../../core/settings/rule-engine';
import { validateFormatSchema } from '../../core/settings/format-schema';
import type { FormatSchema } from '../../core/settings/format-schema';
import { settingsRepository as repo } from './repository';
import type { VersionRow } from './repository';

export interface ResolvedFormat {
  id: string;
  versionNo: number;
  kind: string;
  name: string;
  /** 'customer' | 'unit' | 'customer+unit' | 'default' */
  matchedBy: string;
  customerId: string | null;
  unitId: string | null;
  schema: FormatSchema;
}

function score(row: VersionRow, customerId: string | null, unitId: string | null): number {
  return (
    (row.customerId && row.customerId === customerId ? 2 : 0) +
    (row.unitId && row.unitId === unitId ? 1 : 0)
  );
}

export const FormatService = {
  async resolve(
    pageId: string,
    kind: string,
    ctx: { customerId?: string | null | undefined; unitId?: string | null | undefined } = {},
    db: Db = prisma,
  ): Promise<ResolvedFormat | null> {
    const customerId = ctx.customerId ?? null;
    const unitId = ctx.unitId ?? null;
    const rows = await repo.candidates(pageId, kind, customerId, unitId, db);
    if (rows.length === 0) return null;
    const best = [...rows].sort(
      (a, b) => score(b, customerId, unitId) - score(a, customerId, unitId),
    )[0] as VersionRow;
    return FormatService.shape(best);
  },

  async byId(id: string, db: Db = prisma): Promise<ResolvedFormat | null> {
    const row = await repo.byId('FORMAT', id, db);
    return row ? FormatService.shape(row) : null;
  },

  shape(row: VersionRow): ResolvedFormat {
    const matchedBy =
      row.customerId && row.unitId
        ? 'customer+unit'
        : row.customerId
          ? 'customer'
          : row.unitId
            ? 'unit'
            : 'default';
    return {
      id: row.id,
      versionNo: row.version,
      kind: row.kind as string,
      name: row.name,
      matchedBy,
      customerId: row.customerId,
      unitId: row.unitId,
      schema: validateFormatSchema(row.content),
    };
  },
};

export interface DocumentStamp {
  formatVersionId: string | null;
  ruleSets: { id: string; code: string; definition: RuleDefinition }[];
}

export interface Calculation {
  /** New amount column value, when a rule set binds one. */
  amount: number | null;
  /** Values written into the document's fields. */
  fields: Record<string, number>;
}

function toRule(row: VersionRow): { id: string; code: string; definition: RuleDefinition } {
  return {
    id: row.id,
    code: row.code as string,
    definition: ruleDefinitionSchema.parse(row.content),
  };
}

export const documentSettings = {
  /** The versions a NEW document is created with. Nothing configured -> nothing pinned. */
  async stamp(
    db: Db,
    p: { pageId: string; unitId: string; customerId?: string | null | undefined },
  ): Promise<DocumentStamp> {
    const [format, rules] = await Promise.all([
      FormatService.resolve(p.pageId, 'FORM', { customerId: p.customerId, unitId: p.unitId }, db),
      repo.activeRuleSets(p.pageId, db),
    ]);
    return { formatVersionId: format?.id ?? null, ruleSets: rules.map(toRule) };
  },

  /** The pinned versions of an existing document (any status: old versions stay readable). */
  async pinned(db: Db, ids: Record<string, string> | null): Promise<DocumentStamp['ruleSets']> {
    if (!ids) return [];
    const rows = await repo.ruleSetsByIds(Object.values(ids), db);
    return rows.map(toRule);
  },

  pinMap(rules: DocumentStamp['ruleSets']): Prisma.InputJsonObject | null {
    return rules.length === 0 ? null : Object.fromEntries(rules.map((r) => [r.code, r.id]));
  },

  /** Runs every pinned rule set that is bound to this page's fields. Pure given its arguments. */
  calculate(rules: DocumentStamp['ruleSets'], data: Record<string, unknown>): Calculation {
    const out: Calculation = { amount: null, fields: {} };
    for (const rule of rules) {
      const b = rule.definition.bindings;
      if (!b) continue;
      const inputs: Record<string, string | number> = {};
      for (const [name, field] of Object.entries(b.inputs)) {
        const v = data[field];
        if (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '')) inputs[name] = v;
      }
      const result = RuleEngine.evaluate(rule.definition, inputs).outputs;
      if (b.amountOutput && result[b.amountOutput] !== undefined) {
        out.amount = Number(new Prisma.Decimal(result[b.amountOutput] as string).toFixed(2));
      }
      for (const [name, field] of Object.entries(b.fieldOutputs)) {
        if (result[name] !== undefined) out.fields[field] = Number(result[name]);
      }
    }
    return out;
  },
};

const CUSTOMER_KEYS = ['customerId', 'customer_id', 'customer', 'customerName'] as const;

/**
 * Which customer a document is for: the page's customer field, holding a customer id or (on the
 * generic pages, where a customer is typed) the exact customer name. null when there is none.
 */
export async function customerIdFor(db: Db, data: Record<string, unknown>): Promise<string | null> {
  for (const key of CUSTOMER_KEYS) {
    const v = data[key];
    if (typeof v !== 'string' || v.trim() === '') continue;
    const text = v.trim();
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)) {
      const hit = await db.customer.findUnique({ where: { id: text }, select: { id: true } });
      if (hit) return hit.id;
      continue;
    }
    const byName = await db.customer.findFirst({
      where: { name: { equals: text, mode: 'insensitive' }, deletedAt: null },
      select: { id: true },
    });
    if (byName) return byName.id;
  }
  return null;
}
