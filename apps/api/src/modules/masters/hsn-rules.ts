// HSN rules for items (docs/phases/PHASE-06.md §3.5, §4.6): an item must point at an HSN/SAC code of the
// master, with at least the digits the unit's GST registration requires (default 6).
import { prisma } from '../../core/db/prisma';
import type { Db } from '../../core/db/prisma';
import { AppError } from '../../core/http/errors';
import { hsnDigits, isHsn } from './party-rules';

export const HSN_REQUIRED_MESSAGE = 'Choose the HSN/SAC code for this item.';

/** The strictest minimum of the active GST registrations; 6 when no registration exists yet. */
export async function minHsnDigits(db: Db = prisma): Promise<number> {
  // unpaginated: internal policy/config lookup inside a transaction, small admin-defined table
  const rows = await db.gstRegistration.findMany({
    where: { status: 'ACTIVE', deletedAt: null },
    select: { minHsnDigits: true },
  });
  return rows.length > 0 ? Math.max(...rows.map((r) => r.minHsnDigits)) : 6;
}

function fail(code: 'HSN_REQUIRED' | 'HSN_DIGITS', message: string): AppError {
  return new AppError(422, code, message, { hsnSac: message });
}

/** Returns the hsn_sac_codes id for a code; refuses a missing, malformed, too short or unknown code. */
export async function resolveItemHsn(
  code: string | null | undefined,
  db: Db = prisma,
): Promise<string> {
  const value = (code ?? '').trim();
  if (!value) throw fail('HSN_REQUIRED', HSN_REQUIRED_MESSAGE);
  if (!isHsn(value)) throw fail('HSN_REQUIRED', HSN_REQUIRED_MESSAGE);
  const min = await minHsnDigits(db);
  if (value.length < min) throw fail('HSN_DIGITS', hsnDigits(min));
  const row = await db.hsnSacCode.findFirst({
    where: { code: value, deletedAt: null, status: 'ACTIVE' },
  });
  if (!row) throw fail('HSN_REQUIRED', HSN_REQUIRED_MESSAGE);
  return row.id;
}
