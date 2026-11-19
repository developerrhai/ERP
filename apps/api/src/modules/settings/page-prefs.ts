// Per-page settings tab: (1) the company's pick-lists (item, category, vendor, manufacturer) that a user with the
// admin-settings "controls" right manages, and (2) each user's own hidden-column choice per page.
// Both live in the key/value `settings` table (no schema change): key "master.lists" and "cols.<userId>".
import type { Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../core/auth/auth-context';
import { prisma } from '../../core/db/prisma';
import { validated } from '../../core/http/validate';

export const LIST_KINDS = ['item', 'category', 'vendor', 'manufacturer'] as const;
export type ListKind = (typeof LIST_KINDS)[number];
type Lists = Record<ListKind, string[]>;

const LISTS_KEY = 'master.lists';
const empty = (): Lists => ({ item: [], category: [], vendor: [], manufacturer: [] });

export const listKindParam = z.object({ kind: z.enum(LIST_KINDS) });
export const listValuesBody = z.object({
  values: z.array(z.string().trim().min(1).max(120)).max(1000),
});
export const columnsBody = z.object({
  hidden: z.record(z.string().max(80), z.array(z.string().max(80)).max(200)),
});

function readLists(value: unknown): Lists {
  const out = empty();
  if (value && typeof value === 'object') {
    for (const k of LIST_KINDS) {
      const v = (value as Record<string, unknown>)[k];
      if (Array.isArray(v)) out[k] = v.filter((x): x is string => typeof x === 'string');
    }
  }
  return out;
}

/** Trim, drop blanks, drop case-insensitive duplicates, keep the first spelling. */
export function cleanValues(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const v = raw.trim().replace(/\s+/g, ' ');
    const k = v.toLowerCase();
    if (!v || seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

export const pagePrefsController = {
  getLists: async (_req: Request, res: Response): Promise<void> => {
    const row = await prisma.setting.findUnique({ where: { key: LISTS_KEY } });
    res.json({ data: readLists(row?.value) });
  },

  putList: async (req: Request, res: Response): Promise<void> => {
    const { kind } = validated(res, 'params', listKindParam);
    const { values } = validated(res, 'body', listValuesBody);
    const auth = requireAuth(req);
    const row = await prisma.setting.findUnique({ where: { key: LISTS_KEY } });
    const lists = readLists(row?.value);
    lists[kind] = cleanValues(values);
    await prisma.setting.upsert({
      where: { key: LISTS_KEY },
      create: { key: LISTS_KEY, value: lists, updatedById: auth.userId },
      update: { value: lists, updatedById: auth.userId, version: { increment: 1 } },
    });
    res.json({ data: lists });
  },

  getColumns: async (req: Request, res: Response): Promise<void> => {
    const auth = requireAuth(req);
    const row = await prisma.setting.findUnique({ where: { key: `cols.${auth.userId}` } });
    const v = row?.value as { hidden?: Record<string, string[]> } | null | undefined;
    res.json({ data: { hidden: v?.hidden ?? {} } });
  },

  putColumns: async (req: Request, res: Response): Promise<void> => {
    const auth = requireAuth(req);
    const { hidden } = validated(res, 'body', columnsBody);
    const key = `cols.${auth.userId}`;
    const value = { hidden };
    await prisma.setting.upsert({
      where: { key },
      create: { key, value, updatedById: auth.userId },
      update: { value, updatedById: auth.userId, version: { increment: 1 } },
    });
    res.json({ data: { hidden } });
  },
};
