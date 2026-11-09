// Stock -> GL (Phase 8, R-07): every stock posting writes its journal through Phase 7 PostingService in the
// SAME transaction, and a cancel reverses stock AND GL dated the cancel date. Account keys are the E-10 keys;
// the item type -> inventory key map is data (item_type_accounts), never code.
//
// How the lines are built (one rule for every voucher):
//   * one INVENTORY leg per ledger row: debit for an inflow, credit for an outflow, at the row's value,
//     on the key of the item type (INVENTORY_RM / _WIP / _FG) - or STOCK_IN_TRANSIT for a transit warehouse;
//   * one COUNTER leg per unit that balances that unit (a journal must balance per unit):
//       opening -> OPENING_BALANCE_EQUITY, receipt -> GRIR, issue -> CONSUMPTION_EXPENSE,
//       adjustment / reconciliation -> STOCK_ADJUSTMENT, transfer -> INTER_UNIT_CLEARING.
// After posting, the journal totals are compared with the ledger rows read back from the database; a
// difference throws, so the whole transaction (stock included) rolls back.
import { PostingService } from '../../finance/posting-service';
import type { PostedJournal, EventLine } from '../../finance/posting-service';
import type { Db } from '../../../core/db/prisma';
import { Errors } from '../../../core/http/errors';
import { D, ZERO, round2, str } from '../money';
import type { Dec } from '../money';

export type CounterKey =
  | 'OPENING_BALANCE_EQUITY'
  | 'GRIR'
  | 'CONSUMPTION_EXPENSE'
  | 'STOCK_ADJUSTMENT'
  | 'INTER_UNIT_CLEARING'
  | 'INVENTORY_WIP'
  | 'MAINT_EXPENSE';

interface Leg {
  unitId: string;
  key: string;
  debit: Dec;
  credit: Dec;
}

interface LedgerLeg {
  unit_id: string;
  qty_in: string;
  value: string;
  item_type: string;
  is_transit: boolean;
}

async function ledgerLegs(tx: Db, ledgerIds: string[]): Promise<LedgerLeg[]> {
  if (ledgerIds.length === 0) return [];
  return tx.$queryRaw<LedgerLeg[]>`
    SELECT l.unit_id::text, l.qty_in::text, l.value::text, i.item_type, w.is_transit
    FROM stock_ledger l
    JOIN items i ON i.id = l.item_id
    JOIN warehouses w ON w.id = l.warehouse_id
    WHERE l.id = ANY(${ledgerIds}::uuid[])`;
}

/** Expense counters need a cost centre: the unit's Stores centre, else its first leaf centre. */
async function storesCostCenter(tx: Db, unitId: string): Promise<string> {
  const rows = await tx.$queryRaw<{ code: string }[]>`
    SELECT code FROM cost_centers WHERE unit_id = ${unitId}::uuid AND NOT is_group AND status = 'Active'
    ORDER BY (code LIKE '%-STORE') DESC, code ASC LIMIT 1`;
  if (!rows[0]) {
    throw Errors.validation({
      costCenter:
        'This unit has no cost centre. Add one under Finance > Cost Centres before posting stock.',
    });
  }
  return rows[0].code;
}

async function keyMap(tx: Db): Promise<Map<string, string>> {
  const rows = await tx.itemTypeAccount.findMany();
  return new Map(rows.map((r) => [r.itemType, r.inventoryKey]));
}

/** Pure: the journal legs of a set of ledger rows (see the header comment). Exported for tests. */
export function buildLegs(
  rows: { unitId: string; inflow: boolean; value: Dec; itemType: string; isTransit: boolean }[],
  inventoryKeyOf: (itemType: string) => string,
  counter: CounterKey,
): Leg[] {
  const legs: Leg[] = [];
  for (const r of rows) {
    const v = round2(r.value.abs());
    if (v.isZero()) continue;
    const key = r.isTransit ? 'STOCK_IN_TRANSIT' : inventoryKeyOf(r.itemType);
    legs.push({
      unitId: r.unitId,
      key,
      debit: r.inflow ? v : ZERO,
      credit: r.inflow ? ZERO : v,
    });
  }
  // Counter legs: per unit, the amount that balances it.
  const net = new Map<string, Dec>();
  for (const l of legs)
    net.set(l.unitId, (net.get(l.unitId) ?? ZERO).plus(l.debit).minus(l.credit));
  for (const [unitId, n] of net) {
    if (n.isZero()) continue;
    legs.push({
      unitId,
      key: counter,
      debit: n.lessThan(0) ? n.abs() : ZERO,
      credit: n.greaterThan(0) ? n : ZERO,
    });
  }
  return legs;
}

export interface GlPostInput {
  voucherId: string;
  voucherNo: string;
  unitId: string;
  postingDate: string;
  event: string;
  voucherType: 'Goods Receipt' | 'Delivery' | 'Stock Adjustment' | 'Opening' | 'Other';
  counter: CounterKey;
  ledgerIds: string[];
  narration: string;
  actorId: string;
}

export const StockGl = {
  /** Posts the stock journal for freshly written ledger rows. Returns null when the rows carry no value. */
  async post(tx: Db, p: GlPostInput): Promise<PostedJournal | null> {
    const [rows, map] = await Promise.all([ledgerLegs(tx, p.ledgerIds), keyMap(tx)]);
    const legs = buildLegs(
      rows.map((r) => ({
        unitId: r.unit_id,
        inflow: D(r.qty_in).greaterThan(0),
        value: D(r.value),
        itemType: r.item_type,
        isTransit: r.is_transit,
      })),
      (t) => map.get(t) ?? 'INVENTORY_RM',
      p.counter,
    );
    if (legs.length === 0) return null;
    const needsCc = new Set<string>();
    if (
      p.counter === 'CONSUMPTION_EXPENSE' ||
      p.counter === 'STOCK_ADJUSTMENT' ||
      p.counter === 'MAINT_EXPENSE'
    ) {
      for (const l of legs) if (l.key === p.counter) needsCc.add(l.unitId);
    }
    const cc = new Map<string, string>();
    for (const u of needsCc) cc.set(u, await storesCostCenter(tx, u));
    const lines: EventLine[] = legs.map((l) => ({
      account: l.key,
      debit: str(l.debit.toDecimalPlaces(2)),
      credit: str(l.credit.toDecimalPlaces(2)),
      unitId: l.unitId,
      ...(l.key === p.counter && cc.has(l.unitId) ? { costCenter: cc.get(l.unitId)! } : {}),
    }));
    const posted = await PostingService.postJournal(
      tx,
      {
        unitId: p.unitId,
        docDate: p.postingDate,
        voucherType: p.voucherType,
        source: 'EVENT',
        narration: p.narration.slice(0, 300),
        sourceDocType: 'stock_voucher',
        sourceDocId: p.voucherId,
        sourceDocNo: p.voucherNo,
        event: p.event,
        payload: { docNo: p.voucherNo, lines },
      },
      { userId: p.actorId },
    );
    // Equality assertion (in the transaction): GL totals == the stock ledger movement.
    const inflow = rows.reduce(
      (a, r) => (D(r.qty_in).greaterThan(0) ? a.plus(round2(D(r.value).abs())) : a),
      ZERO,
    );
    const outflow = rows.reduce(
      (a, r) => (D(r.qty_in).greaterThan(0) ? a : a.plus(round2(D(r.value).abs()))),
      ZERO,
    );
    const expectDebit = legs.reduce((a, l) => a.plus(l.debit), ZERO);
    const expectCredit = legs.reduce((a, l) => a.plus(l.credit), ZERO);
    if (
      !D(posted.totalDebit).equals(expectDebit) ||
      !D(posted.totalCredit).equals(expectCredit) ||
      !expectDebit.equals(expectCredit)
    ) {
      throw new Error(
        `Stock/GL mismatch on ${p.voucherNo}: journal ${posted.totalDebit}/${posted.totalCredit}, ledger in ${str(inflow)} out ${str(outflow)}`,
      );
    }
    return posted;
  },

  /** Cancel: reverse the journal dated the cancel date. */
  async reverse(
    tx: Db,
    journalId: string,
    p: { reason: string; date: string; actorId: string },
  ): Promise<PostedJournal> {
    return PostingService.reverse(
      tx,
      journalId,
      p.reason,
      { userId: p.actorId },
      { reversalDate: p.date },
    );
  },
};
