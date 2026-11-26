// The GST % a form shows before a document is made (REQ-05 / REQ-06): the item's own override, else the unconditional
// rate of its HSN valid today. A code whose rate depends on a condition has no single answer, so none is given.
// Documents still take their tax from taxService.rateFor on their own date.
import { prisma } from '../../core/db/prisma';
import type { Db } from '../../core/db/prisma';

/** "18.0000" -> "18", "0.2500" -> "0.25". */
export const plainPct = (v: string | null | undefined): string | null =>
  v === null || v === undefined ? null : String(Number(v));

export interface ItemTax {
  hsnSac: string | null;
  gstPct: string | null;
}

export async function itemTaxToday(itemIds: readonly string[], db: Db = prisma): Promise<Map<string, ItemTax>> {
  const out = new Map<string, ItemTax>();
  if (itemIds.length === 0) return out;
  // unpaginated: bounded by the ids the caller passes in (one page of items)
  const rows = await db.$queryRaw<{ id: string; hsn: string | null; pct: string | null }[]>`
    SELECT i.id::text AS id, COALESCE(i.hsn_sac, h.code) AS hsn,
      COALESCE(o.igst_pct, (SELECT g.igst_pct FROM hsn_sac_rates r JOIN gst_rates g ON g.id = r.gst_rate_id
        WHERE r.hsn_id = i.hsn_id AND r.condition_note IS NULL AND r.effective_from <= CURRENT_DATE
          AND (r.effective_to IS NULL OR r.effective_to >= CURRENT_DATE)
        ORDER BY r.effective_from DESC LIMIT 1))::text AS pct
    FROM items i
    LEFT JOIN hsn_sac_codes h ON h.id = i.hsn_id
    LEFT JOIN gst_rates o ON o.id = i.gst_rate_override_id
    WHERE i.id = ANY(${[...itemIds]}::uuid[])`;
  for (const r of rows) out.set(r.id, { hsnSac: r.hsn, gstPct: plainPct(r.pct) });
  return out;
}

export interface HsnChoice {
  code: string;
  description: string;
  gstPct: string | null;
}

/** Active HSN / SAC codes whose number or description holds `q`, each with its rate valid today. */
export async function searchHsn(q: string, limit: number, db: Db = prisma): Promise<HsnChoice[]> {
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const rows = await db.$queryRaw<{ code: string; description: string; pct: string | null }[]>`
    SELECT h.code, h.description,
      (SELECT g.igst_pct FROM hsn_sac_rates r JOIN gst_rates g ON g.id = r.gst_rate_id
        WHERE r.hsn_id = h.id AND r.condition_note IS NULL AND r.effective_from <= CURRENT_DATE
          AND (r.effective_to IS NULL OR r.effective_to >= CURRENT_DATE)
        ORDER BY r.effective_from DESC LIMIT 1)::text AS pct
    FROM hsn_sac_codes h
    WHERE h.deleted_at IS NULL AND h.status = 'ACTIVE' AND (h.code LIKE ${like} OR h.description ILIKE ${like})
    ORDER BY (h.code = ${q}) DESC, h.code
    LIMIT ${limit}`;
  return rows.map((r) => ({ code: r.code, description: r.description, gstPct: plainPct(r.pct) }));
}
