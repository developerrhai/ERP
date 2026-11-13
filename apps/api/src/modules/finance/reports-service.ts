// Financial reports (05c §6.5, §7.4): general ledger, trial balance, profit & loss, balance sheet, AR / AP
// ageing. They read ONLY gl_entries (and open_items for ageing). Year-end closing entries (is_closing) are left
// out of the year they close, so a pre-closing trial balance and the year's P&L stay readable after the close.
import { prisma } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { D, ZERO, isoDate, money } from './money';
import type { Dec } from './money';

export interface ReportFilter {
  unitId?: string | null;
  profitCenterId?: string | null;
  costCenterId?: string | null;
}

interface AcctRow {
  id: string;
  code: string;
  name: string;
  root_type: string;
  parent_code: string | null;
  parent_name: string | null;
  debit: string;
  credit: string;
}

/** The General Ledger shows a running balance, so it cannot be paged; this caps one account's range. */
const GL_MAX_ROWS = 20_000;

const natural = (root: string, d: Dec, c: Dec): Dec =>
  root === 'Asset' || root === 'Expense' ? d.minus(c) : c.minus(d);

async function fyOf(asOf: string) {
  const d = new Date(`${asOf}T00:00:00Z`);
  return prisma.financialYear.findFirst({ where: { startDate: { lte: d }, endDate: { gte: d } } });
}

/**
 * Account totals up to `asOf`. Balance-sheet accounts are cumulative (opening balances and prior years included);
 * P&L accounts cover the financial year of `asOf` from its start, plus prior years that were never closed.
 */
async function balances(
  asOf: string,
  f: ReportFilter,
  opts: { from?: string; plOnly?: boolean } = {},
): Promise<AcctRow[]> {
  const fy = await fyOf(asOf);
  const fyId = fy?.id ?? null;
  const fromDate = opts.from ?? null;
  // unpaginated: report/register over the requested date range; exported whole, filters bound it
  return prisma.$queryRaw<AcctRow[]>`
    SELECT a.id, a.code, a.name, a.root_type, p.code AS parent_code, p.name AS parent_name,
           COALESCE(SUM(g.debit), 0)::text AS debit, COALESCE(SUM(g.credit), 0)::text AS credit
      FROM accounts a
      LEFT JOIN accounts p ON p.id = a.parent_id
      JOIN gl_entries g ON g.account_id = a.id
     WHERE a.deleted_at IS NULL AND a.is_group = false
       AND g.posting_date <= ${asOf}::date
       AND (${fromDate}::date IS NULL OR g.posting_date >= ${fromDate}::date)
       AND (${f.unitId ?? null}::uuid IS NULL OR g.unit_id = ${f.unitId ?? null}::uuid)
       AND (${f.profitCenterId ?? null}::uuid IS NULL OR g.profit_center_id = ${f.profitCenterId ?? null}::uuid)
       AND (${f.costCenterId ?? null}::uuid IS NULL OR g.cost_center_id = ${f.costCenterId ?? null}::uuid)
       AND (
         (a.root_type IN ('Asset','Liability','Equity') AND NOT (g.is_closing AND g.fy_id = ${fyId}::uuid) AND ${opts.plOnly ?? false} = false)
         OR
         (a.root_type IN ('Income','Expense') AND NOT g.is_closing
            AND (${fromDate}::date IS NOT NULL OR g.fy_id = ${fyId}::uuid OR g.fy_id NOT IN (SELECT fy_id FROM fy_closings)))
       )
     GROUP BY a.id, a.code, a.name, a.root_type, p.code, p.name
     ORDER BY a.code`;
}

export const reportsService = {
  async trialBalance(asOf: string, f: ReportFilter) {
    const rows = await balances(asOf, f);
    let td = ZERO;
    let tc = ZERO;
    let od = ZERO;
    let oc = ZERO;
    const lines = rows
      .map((r) => {
        const d = D(r.debit);
        const c = D(r.credit);
        const net = d.minus(c);
        const closingDebit = net.greaterThan(0) ? net : ZERO;
        const closingCredit = net.lessThan(0) ? net.negated() : ZERO;
        td = td.plus(d);
        tc = tc.plus(c);
        od = od.plus(closingDebit);
        oc = oc.plus(closingCredit);
        return {
          accountId: r.id,
          code: r.code,
          name: r.name,
          rootType: r.root_type,
          debit: money(d),
          credit: money(c),
          closingDebit: money(closingDebit),
          closingCredit: money(closingCredit),
        };
      })
      .filter((l) => l.debit !== '0.00' || l.credit !== '0.00');
    return {
      asOf,
      totalDebit: money(td),
      totalCredit: money(tc),
      closingDebit: money(od),
      closingCredit: money(oc),
      balanced: od.equals(oc) && td.equals(tc),
      lines,
    };
  },

  async generalLedger(accountId: string, from: string, to: string, f: ReportFilter) {
    const acct = await prisma.account.findFirst({ where: { id: accountId, deletedAt: null } });
    if (!acct) throw Errors.notFound('Account not found.');
    const unit = f.unitId ?? null;
    // unpaginated: rows of one parent (account_id)
    const opening = await prisma.$queryRaw<{ d: string; c: string }[]>`
      SELECT COALESCE(SUM(debit),0)::text AS d, COALESCE(SUM(credit),0)::text AS c FROM gl_entries
       WHERE account_id = ${accountId}::uuid AND posting_date < ${from}::date AND (${unit}::uuid IS NULL OR unit_id = ${unit}::uuid)`;
    // A running balance needs every row in order, so the range is capped instead of paged (Phase 22 review).
    const rows = await prisma.$queryRaw<
      {
        id: string;
        posting_date: Date;
        voucher_type: string;
        voucher_no: string;
        narration: string | null;
        debit: string;
        credit: string;
        party_id: string | null;
        journal_id: string;
        unit_id: string;
        is_reversal: boolean;
      }[]
    >`
      SELECT id, posting_date, voucher_type, voucher_no, narration, debit::text, credit::text, party_id, journal_id, unit_id, is_reversal FROM gl_entries
       WHERE account_id = ${accountId}::uuid AND posting_date BETWEEN ${from}::date AND ${to}::date AND (${unit}::uuid IS NULL OR unit_id = ${unit}::uuid)
       ORDER BY posting_date, seq
       LIMIT ${GL_MAX_ROWS + 1}`;
    if (rows.length > GL_MAX_ROWS) {
      throw Errors.validation({ to: `This account has more than ${GL_MAX_ROWS.toLocaleString('en-IN')} entries in the range. Choose a shorter date range.` });
    }
    const openDr = D(opening[0]?.d ?? 0);
    const openCr = D(opening[0]?.c ?? 0);
    let run = natural(acct.rootType, openDr, openCr);
    const openingBalance = run;
    let sumD = ZERO;
    let sumC = ZERO;
    const lines = rows.map((r) => {
      const d = D(r.debit);
      const c = D(r.credit);
      sumD = sumD.plus(d);
      sumC = sumC.plus(c);
      run = run.plus(natural(acct.rootType, d, c));
      return {
        id: r.id,
        date: isoDate(r.posting_date),
        voucherType: r.voucher_type,
        voucherNo: r.voucher_no,
        narration: r.narration,
        debit: money(d),
        credit: money(c),
        balance: money(run),
        partyId: r.party_id,
        journalId: r.journal_id,
        unitId: r.unit_id,
        isReversal: r.is_reversal,
      };
    });
    return {
      account: { id: acct.id, code: acct.code, name: acct.name, rootType: acct.rootType },
      from,
      to,
      opening: money(openingBalance),
      totalDebit: money(sumD),
      totalCredit: money(sumC),
      closing: money(run),
      lines,
    };
  },

  async profitAndLoss(from: string, to: string, f: ReportFilter) {
    const rows = await balances(to, f, { from, plOnly: true });
    const groups = new Map<
      string,
      {
        code: string;
        name: string;
        rootType: string;
        total: Dec;
        accounts: { code: string; name: string; amount: string }[];
      }
    >();
    const sum = (pred: (r: AcctRow) => boolean): Dec =>
      rows
        .filter(pred)
        .reduce((s, r) => s.plus(natural(r.root_type, D(r.debit), D(r.credit))), ZERO);
    for (const r of rows) {
      const amt = natural(r.root_type, D(r.debit), D(r.credit));
      const key = r.parent_code ?? r.code;
      const g = groups.get(key) ?? {
        code: key,
        name: r.parent_name ?? r.name,
        rootType: r.root_type,
        total: ZERO,
        accounts: [],
      };
      g.total = g.total.plus(amt);
      g.accounts.push({ code: r.code, name: r.name, amount: money(amt) });
      groups.set(key, g);
    }
    const num = (r: AcctRow) => Number(r.code);
    const revenue = sum((r) => r.root_type === 'Income' && num(r) < 4200);
    const otherIncome = sum((r) => r.root_type === 'Income' && num(r) >= 4200);
    const directCosts = sum((r) => r.root_type === 'Expense' && num(r) < 6000);
    const incomeTax = sum((r) => r.code === '6266' || r.code === '6267');
    const financeCosts = sum((r) => num(r) >= 6250 && num(r) < 6260);
    const depreciation = sum((r) => num(r) >= 6240 && num(r) < 6250);
    const operating = sum((r) => r.root_type === 'Expense' && num(r) >= 6000)
      .minus(incomeTax)
      .minus(financeCosts)
      .minus(depreciation);
    const grossProfit = revenue.minus(directCosts);
    const operatingProfit = grossProfit.minus(operating).minus(depreciation);
    const profitBeforeTax = operatingProfit.plus(otherIncome).minus(financeCosts);
    const netProfit = profitBeforeTax.minus(incomeTax);
    const sections = [...groups.values()]
      .sort((a, b) => a.code.localeCompare(b.code))
      .map((g) => ({ ...g, total: money(g.total) }));
    return {
      from,
      to,
      summary: {
        revenue: money(revenue),
        directCosts: money(directCosts),
        grossProfit: money(grossProfit),
        operatingExpenses: money(operating),
        depreciation: money(depreciation),
        operatingProfit: money(operatingProfit),
        otherIncome: money(otherIncome),
        financeCosts: money(financeCosts),
        profitBeforeTax: money(profitBeforeTax),
        incomeTax: money(incomeTax),
        netProfit: money(netProfit),
      },
      sections,
    };
  },

  async balanceSheet(asOf: string, f: ReportFilter) {
    const rows = await balances(asOf, f);
    const groups = new Map<
      string,
      {
        code: string;
        name: string;
        rootType: string;
        total: Dec;
        accounts: { code: string; name: string; amount: string }[];
      }
    >();
    let assets = ZERO;
    let liabilities = ZERO;
    let equity = ZERO;
    let profit = ZERO; // current-year (and unclosed) profit sits in equity until the year is closed
    for (const r of rows) {
      const amt = natural(r.root_type, D(r.debit), D(r.credit));
      if (r.root_type === 'Income') {
        profit = profit.plus(amt);
        continue;
      }
      if (r.root_type === 'Expense') {
        profit = profit.minus(amt);
        continue;
      }
      if (amt.isZero()) continue;
      const key = r.parent_code ?? r.code;
      const g = groups.get(key) ?? {
        code: key,
        name: r.parent_name ?? r.name,
        rootType: r.root_type,
        total: ZERO,
        accounts: [],
      };
      g.total = g.total.plus(amt);
      g.accounts.push({ code: r.code, name: r.name, amount: money(amt) });
      groups.set(key, g);
      if (r.root_type === 'Asset') assets = assets.plus(amt);
      else if (r.root_type === 'Liability') liabilities = liabilities.plus(amt);
      else equity = equity.plus(amt);
    }
    const totalEquity = equity.plus(profit);
    const sort = (t: string) =>
      [...groups.values()]
        .filter((g) => g.rootType === t)
        .sort((a, b) => a.code.localeCompare(b.code))
        .map((g) => ({ ...g, total: money(g.total) }));
    return {
      asOf,
      assets: sort('Asset'),
      liabilities: sort('Liability'),
      equity: sort('Equity'),
      currentYearProfit: money(profit),
      totals: {
        assets: money(assets),
        liabilities: money(liabilities),
        equity: money(totalEquity),
        liabilitiesAndEquity: money(liabilities.plus(totalEquity)),
      },
      balanced: assets.equals(liabilities.plus(totalEquity)),
    };
  },

  /** AR / AP ageing from the bill-wise sub-ledger: signed outstanding per party in days-past-due buckets. */
  async ageing(side: 'RECEIVABLE' | 'PAYABLE', asOf: string, f: ReportFilter) {
    const unit = f.unitId ?? null;
    // unpaginated: report/register over the requested date range; exported whole, filters bound it
    const rows = await prisma.$queryRaw<
      {
        party_type: string;
        party_id: string;
        doc_no: string;
        item_type: string;
        due: Date;
        outstanding: string;
      }[]
    >`
      SELECT party_type, party_id, doc_no, item_type, COALESCE(due_date, doc_date) AS due, outstanding::text
        FROM open_items
       WHERE side = ${side} AND status <> 'Cancelled' AND outstanding <> 0 AND doc_date <= ${asOf}::date AND (${unit}::uuid IS NULL OR unit_id = ${unit}::uuid)`;
    const ids = [...new Set(rows.map((r) => r.party_id))];
    const names = new Map<string, string>();
    if (ids.length) {
      for (const c of await prisma.customer.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true },
      }))
        names.set(c.id, c.name);
      for (const s of await prisma.supplier.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true },
      }))
        names.set(s.id, s.name);
    }
    const asOfDay = Math.floor(Date.parse(`${asOf}T00:00:00Z`) / 86_400_000);
    const buckets = ['notDue', 'd1_30', 'd31_60', 'd61_90', 'd90plus'] as const;
    type B = (typeof buckets)[number];
    const empty = (): Record<B, Dec> => ({
      notDue: ZERO,
      d1_30: ZERO,
      d31_60: ZERO,
      d61_90: ZERO,
      d90plus: ZERO,
    });
    const byParty = new Map<string, { partyId: string; name: string; b: Record<B, Dec> }>();
    const total = empty();
    for (const r of rows) {
      const past = asOfDay - Math.floor(r.due.getTime() / 86_400_000);
      const k: B =
        past <= 0
          ? 'notDue'
          : past <= 30
            ? 'd1_30'
            : past <= 60
              ? 'd31_60'
              : past <= 90
                ? 'd61_90'
                : 'd90plus';
      const p = byParty.get(r.party_id) ?? {
        partyId: r.party_id,
        name: names.get(r.party_id) ?? '(unknown)',
        b: empty(),
      };
      p.b[k] = p.b[k].plus(r.outstanding);
      total[k] = total[k].plus(r.outstanding);
      byParty.set(r.party_id, p);
    }
    const fmt = (b: Record<B, Dec>) => {
      const sum = buckets.reduce((s, k) => s.plus(b[k]), ZERO);
      return {
        notDue: money(b.notDue),
        d1_30: money(b.d1_30),
        d31_60: money(b.d31_60),
        d61_90: money(b.d61_90),
        d90plus: money(b.d90plus),
        total: money(sum),
      };
    };
    return {
      side,
      asOf,
      parties: [...byParty.values()]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((p) => ({ partyId: p.partyId, name: p.name, ...fmt(p.b) })),
      total: fmt(total),
    };
  },

  /**
   * Cash flow (indirect method). Every non-cash account's credit - debit in the period is the cash it produced,
   * so the three sections add up to the change in the cash and bank accounts (the report proves it).
   */
  async cashFlow(from: string, to: string, f: ReportFilter) {
    const unit = f.unitId ?? null;
    // unpaginated: report/register over the requested date range; exported whole, filters bound it
    const rows = await prisma.$queryRaw<
      { code: string; name: string; root_type: string; cf_class: string; flow: string }[]
    >`
      SELECT a.code, a.name, a.root_type, a.cf_class, COALESCE(SUM(g.credit - g.debit), 0)::text AS flow
        FROM gl_entries g JOIN accounts a ON a.id = g.account_id
       WHERE g.posting_date BETWEEN ${from}::date AND ${to}::date AND g.is_closing = false
         AND (${unit}::uuid IS NULL OR g.unit_id = ${unit}::uuid)
       GROUP BY a.code, a.name, a.root_type, a.cf_class HAVING SUM(g.credit - g.debit) <> 0 ORDER BY a.code`;
    const cashBalance = async (before: string | null, upTo: string | null) => {
      // unpaginated: report/register over the requested date range; exported whole, filters bound it
      const r = await prisma.$queryRaw<{ v: string }[]>`
        SELECT COALESCE(SUM(g.debit - g.credit), 0)::text AS v FROM gl_entries g JOIN accounts a ON a.id = g.account_id
         WHERE a.cf_class = 'CASH' AND (${before}::date IS NULL OR g.posting_date < ${before}::date) AND (${upTo}::date IS NULL OR g.posting_date <= ${upTo}::date)
           AND (${unit}::uuid IS NULL OR g.unit_id = ${unit}::uuid)`;
      return D(r[0]?.v ?? 0);
    };
    const opening = await cashBalance(from, null);
    const closing = await cashBalance(null, to);
    const isPl = (r: { root_type: string }) =>
      r.root_type === 'Income' || r.root_type === 'Expense';
    const item = (r: { code: string; name: string; flow: string }) => ({
      code: r.code,
      name: r.name,
      amount: money(r.flow),
    });
    const sum = (xs: { flow: string }[]) => xs.reduce((s, r) => s.plus(r.flow), ZERO);
    const netProfit = sum(rows.filter(isPl));
    const bs = rows.filter((r) => !isPl(r) && r.cf_class !== 'CASH');
    const operatingItems = bs.filter((r) => r.cf_class === 'WC' || r.cf_class === 'NONCASH');
    const investingItems = bs.filter((r) => r.cf_class === 'INVESTING');
    const financingItems = bs.filter((r) => r.cf_class === 'FINANCING' || r.cf_class === 'NA');
    const operating = netProfit.plus(sum(operatingItems));
    const investing = sum(investingItems);
    const financing = sum(financingItems);
    const net = operating.plus(investing).plus(financing);
    return {
      from,
      to,
      operating: {
        netProfit: money(netProfit),
        items: operatingItems.map(item),
        total: money(operating),
      },
      investing: { items: investingItems.map(item), total: money(investing) },
      financing: { items: financingItems.map(item), total: money(financing) },
      netChange: money(net),
      openingCash: money(opening),
      closingCash: money(closing),
      reconciles: opening.plus(net).equals(closing),
    };
  },
};
