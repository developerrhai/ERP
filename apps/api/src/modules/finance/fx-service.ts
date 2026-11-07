// Foreign currency (BR-FIN-09): a rate master (INR per 1 unit of the currency, 6 decimals) and a month-end
// revaluation PREVIEW of open foreign bills. A foreign line is posted with its amount and rate; the INR value is
// round-half-up(amount x rate) and both are stored on the ledger row. The revaluation is a report, not a journal:
// the party control accounts cannot take a party-less adjustment, so the accountant posts the difference as a
// journal against the bills if the auditor wants it booked.
import { recordAudit } from '../../core/audit/audit-service';
import { prisma } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import type { Actor } from './accounts-service';
import { FinErrors } from './errors';
import { D, ZERO, isoDate, money, round2 } from './money';

export const fxService = {
  async listRates(q: { currency?: string; page: number; size: number }) {
    const rows = await prisma.$queryRaw<
      {
        id: string;
        currency_code: string;
        rate_date: Date;
        rate: string;
        source: string | null;
        total: bigint;
      }[]
    >`
      SELECT id, currency_code, rate_date, rate::text, source, COUNT(*) OVER()::bigint AS total FROM fx_rates
       WHERE (${q.currency ?? null}::text IS NULL OR currency_code = ${q.currency ?? null})
       ORDER BY rate_date DESC, currency_code LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size}`;
    return {
      total: Number(rows[0]?.total ?? 0),
      rows: rows.map((r) => ({
        id: r.id,
        currencyCode: r.currency_code,
        rateDate: isoDate(r.rate_date),
        rate: r.rate,
        source: r.source,
      })),
    };
  },

  async setRate(
    p: { currencyCode: string; rateDate: string; rate: string; source?: string },
    actor: Actor,
  ) {
    const cur = p.currencyCode.toUpperCase();
    if (!/^[A-Z]{3}$/.test(cur) || cur === 'INR')
      throw Errors.validation({ currencyCode: 'Use a 3-letter currency code other than INR.' });
    const rate = D(p.rate);
    if (!rate.greaterThan(0) || rate.decimalPlaces() > 6)
      throw Errors.validation({
        rate: 'Enter a rate above 0 with at most 6 decimals, INR per 1 unit.',
      });
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO fx_rates (currency_code, rate_date, rate, source, created_by_id)
      VALUES (${cur}, ${p.rateDate}::date, ${rate.toFixed(6)}::numeric, ${p.source ?? null}, ${actor.userId}::uuid)
      ON CONFLICT (currency_code, rate_date) DO UPDATE SET rate = EXCLUDED.rate, source = EXCLUDED.source RETURNING id`;
    await recordAudit({
      action: 'FX_RATE_SET',
      actorId: actor.userId,
      targetType: 'FxRate',
      targetId: rows[0]?.id ?? null,
      ...(actor.meta ? { meta: actor.meta } : {}),
      detail: { currency: cur, date: p.rateDate, rate: rate.toFixed(6) },
    });
    return { id: rows[0]?.id, currencyCode: cur, rateDate: p.rateDate, rate: rate.toFixed(6) };
  },

  /** The latest rate on or before `date`. */
  async rateOn(currency: string, date: string): Promise<{ rate: string; rateDate: string } | null> {
    const rows = await prisma.$queryRaw<{ rate: string; rate_date: Date }[]>`
      SELECT rate::text, rate_date FROM fx_rates WHERE currency_code = ${currency.toUpperCase()} AND rate_date <= ${date}::date ORDER BY rate_date DESC LIMIT 1`;
    return rows[0] ? { rate: rows[0].rate, rateDate: isoDate(rows[0].rate_date) } : null;
  },

  /** Unrealised gain / loss on open foreign bills at the closing rate of `asOf`. */
  async revaluationPreview(asOf: string, unitId: string | null) {
    const items = await prisma.$queryRaw<
      {
        id: string;
        side: string;
        currency_code: string;
        doc_no: string;
        party_id: string;
        amount: string;
        amount_fc: string;
        outstanding: string;
      }[]
    >`
      SELECT id, side, currency_code, doc_no, party_id, amount::text, amount_fc::text, outstanding::text FROM open_items
       WHERE amount_fc IS NOT NULL AND currency_code <> 'INR' AND status <> 'Cancelled' AND outstanding <> 0 AND doc_date <= ${asOf}::date
         AND (${unitId}::uuid IS NULL OR unit_id = ${unitId}::uuid) ORDER BY currency_code, doc_no`;
    const lines = [];
    let gain = ZERO;
    let loss = ZERO;
    const missing = new Set<string>();
    for (const it of items) {
      const r = await fxService.rateOn(it.currency_code, asOf);
      if (!r) {
        missing.add(it.currency_code);
        continue;
      }
      const fcOut = D(it.amount_fc).times(D(it.outstanding)).dividedBy(D(it.amount)); // foreign amount still open (signed like the bill)
      const carrying = D(it.outstanding);
      const revalued = round2(fcOut.times(r.rate));
      const diff = revalued.minus(carrying);
      // receivable worth more = gain; payable worth more = loss
      const isGain = it.side === 'RECEIVABLE' ? diff.greaterThan(0) : diff.lessThan(0);
      if (!diff.isZero()) {
        if (isGain) gain = gain.plus(diff.abs());
        else loss = loss.plus(diff.abs());
      }
      lines.push({
        itemId: it.id,
        side: it.side,
        currency: it.currency_code,
        docNo: it.doc_no,
        partyId: it.party_id,
        foreignOutstanding: money(fcOut),
        rate: r.rate,
        rateDate: r.rateDate,
        carrying: money(carrying),
        revalued: money(revalued),
        difference: money(diff),
        result: diff.isZero() ? 'None' : isGain ? 'Gain' : 'Loss',
      });
    }
    if (missing.size) {
      throw FinErrors.noFxRate(
        `No rate on or before ${asOf} for ${[...missing].join(', ')}. Add the rate first.`,
        { rates: [...missing].join(', ') },
      );
    }
    return {
      asOf,
      unrealisedGain: money(gain),
      unrealisedLoss: money(loss),
      net: money(gain.minus(loss)),
      lines,
    };
  },
};
