// Tax masters services (docs/phases/PHASE-06.md §5): the state table cache, GstRateService.rateFor and
// the dated HSN rate rows (adding a rate ends the open one the day before; overlaps are refused).
// Statutory numbers are DATA (R-11); nothing here is checked against a government portal (R-12).
import { Prisma } from '@prisma/client';
import type { Db } from '../../core/db/prisma';
import { prisma } from '../../core/db/prisma';
import { AppError, Errors } from '../../core/http/errors';
import { noGstRate, rateOverlap } from './party-rules';

const STATE_TTL_MS = 5 * 60_000;
let stateCache: { at: number; codes: Set<string>; names: Map<string, string> } | null = null;

/** The GST state codes and names (cached for 5 minutes). */
export async function knownStates(
  db: Db = prisma,
): Promise<{ codes: Set<string>; names: Map<string, string> }> {
  if (stateCache && Date.now() - stateCache.at < STATE_TTL_MS && db === prisma) return stateCache;
  // unpaginated: internal policy/config lookup inside a transaction, small admin-defined table
  const rows = await db.gstState.findMany({ select: { code: true, name: true } });
  const fresh = {
    at: Date.now(),
    codes: new Set(rows.map((r) => r.code)),
    names: new Map(rows.map((r) => [r.code, r.name])),
  };
  if (db === prisma) stateCache = fresh;
  return fresh;
}

export function clearStateCache(): void {
  stateCache = null;
}

const iso = (d: Date): string => d.toISOString().slice(0, 10);
const day = (s: string): Date => new Date(`${s}T00:00:00Z`);

export interface RateChoice {
  source: 'ITEM_OVERRIDE' | 'HSN';
  gstRateId: string;
  code: string;
  igstPct: string;
  cgstPct: string;
  sgstPct: string;
  cessPct: string;
  conditionNote: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  needsReview: boolean;
}

export const taxService = {
  /**
   * The GST rate(s) of an item on a date: the item's own override first, otherwise the HSN rate rows valid
   * that day. Several rows can match by condition; the caller chooses. None -> 422 NO_GST_RATE.
   */
  async rateFor(itemId: string, date: string, db: Db = prisma): Promise<RateChoice[]> {
    const item = await db.item.findUnique({
      where: { id: itemId },
      select: { gstRateOverrideId: true, hsnId: true },
    });
    if (!item) throw Errors.notFound('Item not found.');
    if (item.gstRateOverrideId) {
      const r = await db.gstRate.findUniqueOrThrow({ where: { id: item.gstRateOverrideId } });
      return [toChoice('ITEM_OVERRIDE', r, null, null)];
    }
    if (!item.hsnId) throw hsnMissing();
    const hsn = await db.hsnSacCode.findUniqueOrThrow({ where: { id: item.hsnId } });
    const when = day(date);
    // unpaginated: internal policy/config lookup inside a transaction, small admin-defined table
    const rows = await db.hsnSacRate.findMany({
      where: {
        hsnId: item.hsnId,
        effectiveFrom: { lte: when },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: when } }],
      },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (rows.length === 0) throw noRate(hsn.code, date);
    const rates = await db.gstRate.findMany({
      where: { id: { in: rows.map((r) => r.gstRateId) } },
    });
    const byId = new Map(rates.map((r) => [r.id, r]));
    return rows.map((row) =>
      toChoice('HSN', byId.get(row.gstRateId) as (typeof rates)[number], row.cessPct, row),
    );
  },

  /**
   * Adds a dated rate to an HSN code. The open row (no end date) that started before is ended the day
   * before; any other overlap is refused with RATE_OVERLAP.
   */
  async addHsnRate(
    hsnId: string,
    input: {
      gstRateId: string;
      cessPct?: number | string;
      conditionNote?: string | null;
      effectiveFrom: string;
      effectiveTo?: string | null;
    },
    actorId: string,
    db: Db = prisma,
  ) {
    const from = day(input.effectiveFrom);
    const to = input.effectiveTo ? day(input.effectiveTo) : null;
    if (to && to < from) {
      throw Errors.validation({ effectiveTo: 'The end date cannot be before the start date.' });
    }
    const note = input.conditionNote ?? null;
    // unpaginated: internal policy/config lookup inside a transaction, small admin-defined table
    const existing = await db.hsnSacRate.findMany({
      where: { hsnId, conditionNote: note },
      orderBy: { effectiveFrom: 'asc' },
    });
    const open = existing.find((r) => r.effectiveTo === null && r.effectiveFrom < from);
    const clash = existing.find((r) => {
      if (open && r.id === open.id) return false;
      const rEnd = r.effectiveTo ?? new Date('9999-12-31T00:00:00Z');
      const nEnd = to ?? new Date('9999-12-31T00:00:00Z');
      return r.effectiveFrom <= nEnd && from <= rEnd;
    });
    if (clash) {
      throw new AppError(
        409,
        'RATE_OVERLAP',
        rateOverlap(iso(clash.effectiveFrom), clash.effectiveTo ? iso(clash.effectiveTo) : 'open'),
        { effectiveFrom: 'This date overlaps another rate.' },
      );
    }
    if (open) {
      const before = new Date(from.getTime() - 24 * 3600 * 1000);
      await db.hsnSacRate.update({ where: { id: open.id }, data: { effectiveTo: before } });
    }
    return db.hsnSacRate.create({
      data: {
        hsnId,
        gstRateId: input.gstRateId,
        cessPct: new Prisma.Decimal(input.cessPct ?? 0),
        conditionNote: note,
        effectiveFrom: from,
        effectiveTo: to,
        createdById: actorId,
      },
    });
  },
};

function toChoice(
  source: RateChoice['source'],
  r: {
    id: string;
    code: string;
    igstPct: Prisma.Decimal;
    cgstPct: Prisma.Decimal | null;
    sgstPct: Prisma.Decimal | null;
    effectiveFrom: Date;
    effectiveTo: Date | null;
    needsReview: boolean;
  },
  cess: Prisma.Decimal | null,
  row: { conditionNote: string | null; effectiveFrom: Date; effectiveTo: Date | null } | null,
): RateChoice {
  const half = r.igstPct.div(2);
  return {
    source,
    gstRateId: r.id,
    code: r.code,
    igstPct: r.igstPct.toString(),
    cgstPct: (r.cgstPct ?? half).toString(),
    sgstPct: (r.sgstPct ?? half).toString(),
    cessPct: (cess ?? new Prisma.Decimal(0)).toString(),
    conditionNote: row?.conditionNote ?? null,
    effectiveFrom: iso(row?.effectiveFrom ?? r.effectiveFrom),
    effectiveTo:
      (row?.effectiveTo ?? r.effectiveTo) ? iso((row?.effectiveTo ?? r.effectiveTo) as Date) : null,
    needsReview: r.needsReview,
  };
}

function noRate(code: string, date: string): AppError {
  return new AppError(422, 'NO_GST_RATE', noGstRate(code, date), { hsn: noGstRate(code, date) });
}

function hsnMissing(): AppError {
  return new AppError(422, 'HSN_REQUIRED', 'Choose the HSN/SAC code for this item.', {
    hsn: 'Choose the HSN/SAC code for this item.',
  });
}
