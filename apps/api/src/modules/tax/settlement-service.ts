// 11-A9 GST settlement journal: output tax set off against the input-credit accounts (ITC), the rest paid from the
// bank (challan PMT-06), plus interest and late fee, in one `Tax Settlement` journal through PostingService. The
// amounts come from the prepared GSTR-3B; this service computes no rate of its own.
import { recordAudit } from '../../core/audit/audit-service';
import { prisma } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { PostingService } from '../finance/posting-service';
import { D, S, ZERO, costCenterOf, iso, money, parseMonth, unitGst } from './common';
import type { Dec, Row } from './common';
import { returnsService } from './returns-service';

const OUT = { igst: '2303', cgst: '2301', sgst: '2302' } as const;
const RCM = { igst: '2307', cgst: '2305', sgst: '2306' } as const;
const INP = { igst: '1403', cgst: '1401', sgst: '1402' } as const;

export const settlementService = {
  async preview(unitId: string | null, month: string, paidOn: string) {
    const r = await returnsService.gstr3b(unitId, month, paidOn);
    const p = r.plan;
    const used = {
      igst: D(p.off.igstToIgst).plus(p.off.igstToCgst).plus(p.off.igstToSgst),
      cgst: D(p.off.cgstToCgst).plus(p.off.cgstToIgst),
      sgst: D(p.off.sgstToSgst).plus(p.off.sgstToIgst),
    };
    const cash = D(p.cash.igst)
      .plus(p.cash.cgst)
      .plus(p.cash.sgst)
      .plus(p.rcm.igst)
      .plus(p.rcm.cgst)
      .plus(p.rcm.sgst);
    return {
      month,
      plan: p,
      creditUsed: { igst: money(used.igst), cgst: money(used.cgst), sgst: money(used.sgst) },
      cashTax: money(cash),
      bankTotal: money(cash.plus(p.interest).plus(p.lateFee)),
      status: await this.status(unitId, month),
    };
  },

  async status(unitId: string | null, month: string) {
    if (!unitId) return null;
    const ug = await unitGst(unitId);
    const per = parseMonth(month);
    const r = (
      // unpaginated: whole-period return build: GST/TDS returns must include every document of the period
      await prisma.$queryRawUnsafe<Row[]>(
        `SELECT id::text, challan_no, cash_paid::text, interest::text, late_fee::text, journal_id::text FROM gst_settlements
          WHERE gstin=$1 AND period_month=$2::date AND status='Posted'`,
        ug.gstin,
        per.start,
      )
    )[0];
    return r
      ? {
          id: S(r.id),
          challanNo: r.challan_no ? S(r.challan_no) : null,
          cashPaid: money(S(r.cash_paid)),
          interest: money(S(r.interest)),
          lateFee: money(S(r.late_fee)),
          journalId: S(r.journal_id),
        }
      : null;
  },

  async post(
    unitId: string | null,
    b: { month: string; paidOn: string; bankAccountId: string; challanNo: string },
    actor: { userId: string },
  ) {
    const ug = await unitGst(unitId);
    const per = parseMonth(b.month);
    if (b.challanNo.trim().length < 3)
      throw Errors.validation({ challanNo: 'Enter the PMT-06 challan (CPIN) number.' });
    const prev = await this.preview(ug.unitId, b.month, b.paidOn);
    const p = prev.plan;
    const interest = D(p.interest);
    const fee = D(p.lateFee);
    return prisma.$transaction(
      async (tx) => {
        const bank = (
          // unpaginated: rows of one parent (id)
          await tx.$queryRawUnsafe<Row[]>(
            `SELECT account_id::text FROM bank_accounts WHERE id=$1::uuid AND deleted_at IS NULL`,
            b.bankAccountId,
          )
        )[0];
        if (!bank) throw Errors.validation({ bankAccountId: 'Choose a bank account.' });
        const taken = (
          await tx.$queryRawUnsafe<Row[]>(
            `SELECT 1 FROM gst_settlements WHERE gstin=$1 AND period_month=$2::date AND status='Posted' FOR UPDATE`,
            ug.gstin,
            per.start,
          )
        )[0];
        if (taken)
          throw Errors.conflict('This month is already settled. Cancel that settlement first.');
        const again = await this.preview(ug.unitId, b.month, b.paidOn);
        if (again.bankTotal !== prev.bankTotal || again.cashTax !== prev.cashTax)
          throw Errors.conflict(
            'The figures changed while you were settling. Open the Settlement tab again and check them.',
          );
        const lines: {
          accountCode?: string;
          accountId?: string;
          debit: string;
          credit: string;
          unitId: string;
          costCenterId?: string;
        }[] = [];
        const dr = (code: string, v: Dec) => {
          if (v.greaterThan(0))
            lines.push({
              accountCode: code,
              debit: v.toFixed(2),
              credit: '0.00',
              unitId: ug.unitId,
            });
        };
        const cr = (code: string, v: Dec) => {
          if (v.greaterThan(0))
            lines.push({
              accountCode: code,
              debit: '0.00',
              credit: v.toFixed(2),
              unitId: ug.unitId,
            });
        };
        for (const h of ['igst', 'cgst', 'sgst'] as const) {
          dr(OUT[h], D(p.output[h]).isNegative() ? ZERO : D(p.output[h]));
          dr(RCM[h], D(p.rcm[h]));
          cr(INP[h], D(prev.creditUsed[h]));
        }
        const cashTax = D(prev.cashTax);
        const bankTotal = cashTax.plus(interest).plus(fee);
        if (interest.plus(fee).greaterThan(0)) {
          const cc = await costCenterOf(tx, ug.unitId);
          lines.push({
            accountCode: '6254',
            debit: interest.plus(fee).toFixed(2),
            credit: '0.00',
            unitId: ug.unitId,
            ...(cc ? { costCenterId: cc } : {}),
          });
        }
        if (bankTotal.greaterThan(0))
          lines.push({
            accountId: S(bank.account_id),
            debit: '0.00',
            credit: bankTotal.toFixed(2),
            unitId: ug.unitId,
          });
        if (!lines.length) throw Errors.conflict('Nothing to settle for this month.');
        const j = await PostingService.postJournal(
          tx,
          {
            unitId: ug.unitId,
            docDate: b.paidOn,
            voucherType: 'Tax Settlement',
            source: 'TAX',
            narration: `GST settlement ${b.month} (challan ${b.challanNo.trim()})`,
            referenceNo: b.challanNo.trim(),
            lines,
          },
          actor,
        );
        const rows = await tx.$queryRawUnsafe<Row[]>(
          `INSERT INTO gst_settlements (unit_id, gstin, period_month, set_off, cash_paid, interest, late_fee, challan_no, bank_account_id, journal_id, created_by_id)
         VALUES ($1::uuid,$2,$3::date,$4::jsonb,$5::numeric,$6::numeric,$7::numeric,$8,$9::uuid,$10::uuid,$11::uuid) RETURNING id::text`,
          ug.unitId,
          ug.gstin,
          per.start,
          JSON.stringify(p.off),
          cashTax.toFixed(2),
          interest.toFixed(2),
          fee.toFixed(2),
          b.challanNo.trim(),
          b.bankAccountId,
          j.id,
          actor.userId,
        );
        await recordAudit(
          {
            action: 'GST_SETTLEMENT_POSTED',
            actorId: actor.userId,
            targetType: 'GstSettlement',
            targetId: S(rows[0]?.id),
            detail: {
              month: b.month,
              cash: money(cashTax),
              interest: money(interest),
              lateFee: money(fee),
            },
          },
          tx,
        );
        return {
          id: S(rows[0]?.id),
          journalId: j.id,
          bankTotal: money(bankTotal),
          paidOn: iso(b.paidOn),
        };
      },
      { maxWait: 15_000, timeout: 30_000 },
    );
  },

  async cancel(unitId: string | null, month: string, reason: string, actor: { userId: string }) {
    const ug = await unitGst(unitId);
    const per = parseMonth(month);
    return prisma.$transaction(async (tx) => {
      const s = (
        await tx.$queryRawUnsafe<Row[]>(
          `SELECT id::text, journal_id::text FROM gst_settlements WHERE gstin=$1 AND period_month=$2::date AND status='Posted' FOR UPDATE`,
          ug.gstin,
          per.start,
        )
      )[0];
      if (!s) throw Errors.notFound('No settlement for this month.');
      const filed = (
        // unpaginated: whole-period return build: GST/TDS returns must include every document of the period
        await tx.$queryRawUnsafe<Row[]>(
          `SELECT 1 FROM gst_returns WHERE gstin=$1 AND return_type='GSTR3B' AND period_month=$2::date AND status='Filed'`,
          ug.gstin,
          per.start,
        )
      )[0];
      if (filed)
        throw Errors.conflict(
          'The GSTR-3B of this month is filed, so its settlement cannot be cancelled.',
        );
      await PostingService.reverse(tx, S(s.journal_id), reason, actor);
      await tx.$executeRawUnsafe(
        `UPDATE gst_settlements SET status='Cancelled' WHERE id=$1::uuid`,
        S(s.id),
      );
      return { id: S(s.id), status: 'Cancelled' };
    });
  },
};
