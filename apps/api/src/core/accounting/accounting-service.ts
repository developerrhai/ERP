// apps/api/src/core/accounting/accounting-service.ts
// Posts balanced financial events to accounting_event_queue for downstream GL processing.
// Enforces sum(DR) == sum(CR) to 2 decimal places and provides idempotent enqueueing.

import { Prisma } from '@prisma/client';
import type { Db } from '../db/prisma';
import { dec, round2 } from '../../modules/inventory/money';
import type { AccountingEventInput, ReverseEventInput } from '../../modules/inventory/contracts';

export const AccountingService = {
  async post(tx: Db, e: AccountingEventInput): Promise<void> {
    let sumDr = dec(0);
    let sumCr = dec(0);

    for (const line of e.lines) {
      sumDr = sumDr.plus(dec(line.debit));
      sumCr = sumCr.plus(dec(line.credit));
    }

    if (!round2(sumDr).equals(round2(sumCr))) {
      throw new Error(
        `Unbalanced accounting event: total debit ${round2(sumDr).toFixed(2)} != total credit ${round2(sumCr).toFixed(2)}`,
      );
    }

    const payload = {
      lines: e.lines.map((l) => ({
        accountCode: l.accountCode,
        debit: round2(dec(l.debit)).toFixed(2),
        credit: round2(dec(l.credit)).toFixed(2),
        narrative: l.narrative ?? null,
      })),
      gstItcReversal: e.gstItcReversal ?? false,
      reasonCode: e.reasonCode ?? null,
    };

    const docDate = e.docDate instanceof Date ? e.docDate : new Date(e.docDate);

    await tx.$executeRaw`
      INSERT INTO accounting_event_queue (company_id, event, doc_type, doc_id, doc_date, unit_id, payload, status)
      VALUES (
        ${e.companyId}::uuid,
        ${e.event},
        ${e.docType},
        ${e.docId}::uuid,
        ${docDate}::date,
        ${e.unitId ? Prisma.sql`${e.unitId}::uuid` : Prisma.sql`NULL`},
        ${JSON.stringify(payload)}::jsonb,
        'PENDING'
      )
      ON CONFLICT (event, doc_type, doc_id) DO NOTHING
    `;
  },

  async reverse(tx: Db, e: ReverseEventInput): Promise<void> {
    const reverseEvent = e.event.endsWith('_REVERSED') ? e.event : `${e.event}_REVERSED`;
    const payload = {
      reason: e.reason ?? null,
    };
    const docDate = e.docDate instanceof Date ? e.docDate : new Date(e.docDate);

    await tx.$executeRaw`
      INSERT INTO accounting_event_queue (company_id, event, doc_type, doc_id, doc_date, unit_id, payload, status)
      VALUES (
        ${e.companyId}::uuid,
        ${reverseEvent},
        ${e.docType},
        ${e.docId}::uuid,
        ${docDate}::date,
        ${e.unitId ? Prisma.sql`${e.unitId}::uuid` : Prisma.sql`NULL`},
        ${JSON.stringify(payload)}::jsonb,
        'PENDING'
      )
      ON CONFLICT (event, doc_type, doc_id) DO NOTHING
    `;
  },
};
