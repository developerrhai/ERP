// Finance settings are rows of the Phase 3 `settings` table (key -> JSON). A missing row means "not configured":
// the caller supplies the default. Nothing here ever WRITES fin.journal_approval_threshold - that value belongs
// to the owner (errata E-31) and stays unset until the owner decides.
import type { Db } from '../../core/db/prisma';

export const FIN_SETTING_KEYS = [
  'fin.go_live_date',
  'fin.allow_future_dates',
  'fin.allow_negative_cash',
  'fin.cash_payment_limit_per_day',
  'fin.cash_receipt_limit_per_day',
  'fin.max_round_off',
  'fin.require_bank_reco_at_close',
  'fin.journal_approval_threshold',
] as const;

export async function getSetting<T>(db: Db, key: string, fallback: T): Promise<T> {
  const row = await db.setting.findUnique({ where: { key }, select: { value: true } });
  if (!row || row.value === null) return fallback;
  return row.value as unknown as T;
}
