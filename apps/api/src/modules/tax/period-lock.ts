// 11-A10: a filed GST return locks the taxable documents of that GSTIN and month. The lock lives on the return
// (gst_returns.status = 'Filed'), not on the fiscal period. A GSTR-1 lock covers outward documents, a GSTR-3B lock
// covers every document of the month.
import type { Db } from '../../core/db/prisma';
import { FinErrors } from '../finance/errors';

/** first day of the month of an ISO date */
export const monthStart = (iso: string): string => `${iso.slice(0, 7)}-01`;

/** Throws GST_PERIOD_FILED when this GSTIN/month is locked for the given direction. */
export async function assertGstPeriodOpen(
  tx: Db,
  p: { gstin: string | null; docDate: string; direction: 'OUTWARD' | 'INWARD' },
): Promise<void> {
  if (!p.gstin) return;
  const rows = await tx.$queryRaw<{ return_type: string }[]>`
    SELECT return_type FROM gst_returns
     WHERE gstin = ${p.gstin} AND period_month = ${monthStart(p.docDate)}::date AND status = 'Filed'
       AND (return_type = 'GSTR3B' OR (return_type = 'GSTR1' AND ${p.direction} = 'OUTWARD'))
     LIMIT 1`;
  if (rows[0]) {
    throw FinErrors.gstPeriodFiled(
      `The ${rows[0].return_type === 'GSTR1' ? 'GSTR-1' : 'GSTR-3B'} for ${p.docDate.slice(0, 7)} of GSTIN ${p.gstin} is already filed, so this document is locked. Post a note in the current month instead.`,
    );
  }
}

/** Reversal / cancel of a journal: refuse when any of its tax documents sits in a filed period. */
export async function assertJournalNotFiled(tx: Db, journalId: string): Promise<void> {
  const docs = await tx.$queryRaw<{ gstin: string | null; doc_date: Date; direction: string }[]>`
    SELECT gstin, doc_date, direction FROM tax_documents WHERE journal_id = ${journalId}::uuid AND status = 'Active'`;
  for (const d of docs) {
    await assertGstPeriodOpen(tx, {
      gstin: d.gstin,
      docDate: d.doc_date.toISOString().slice(0, 10),
      direction: d.direction as 'OUTWARD' | 'INWARD',
    });
  }
}
