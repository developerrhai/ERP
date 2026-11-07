// A seeded-random simulation of 500 stock vouchers (receipts, issues, adjustments, transfers and
// cancellations, across three warehouses in two units, including requests that must fail with
// INSUFFICIENT_STOCK): afterwards the ledger adds up to the balance of every item x warehouse, no
// balance is negative, a failed request left nothing behind, and a cancelled voucher nets to zero.
import { afterAll, beforeAll, describe as baseDescribe, expect, it } from 'vitest';
// SUPERSEDED by Phase 8 (single-item vouchers are gone): replaced by tests/phase08-simulation.test.ts. Kept (skipped).
const describe = baseDescribe.skip;
import { errorOf, newApp, prisma, signInOwner } from './helpers';
import type { Signed } from './helpers';
import { unitByCode } from './phase3-helpers';
import { dataOf } from './phase4-helpers';
import type { Hdr } from './phase4-helpers';
import { assertLedgerMatchesBalances, inventory } from './phase5-helpers';
import type { TypedBody } from './phase5-helpers';

const app = newApp();
const inv = inventory(app);
const { client } = inv;
let owner: Signed;

/** mulberry32: a small seeded generator, so a failure can be replayed. */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

beforeAll(async () => {
  owner = await signInOwner(app);
});

afterAll(async () => {
  // nothing: the simulation only adds rows with unique codes
});

describe('500-voucher simulation', () => {
  it('keeps sum(ledger) = balance for every item x warehouse', { timeout: 290_000 }, async () => {
    const random = rng(20261103);
    const int = (lo: number, hi: number) => lo + Math.floor(random() * (hi - lo + 1));
    const pick = <T>(xs: readonly T[]): T => xs[int(0, xs.length - 1)] as T;

    const sawUnit = (await unitByCode('SAW')).id;
    const items = [await inv.newItem(owner), await inv.newItem(owner), await inv.newItem(owner)];
    const w1 = await inv.newWarehouse(owner, 'TAL');
    const w2 = await inv.newWarehouse(owner, 'TAL');
    const w3 = await inv.newWarehouse(owner, 'SAW');
    const hdr = (w: TypedBody): Hdr | undefined => (w.id === w3.id ? { unit: sawUnit } : undefined);
    const warehouses = [w1, w2, w3];

    const created: { id: string; page: string; h?: Hdr }[] = [];
    const posted: { id: string; page: string; h?: Hdr }[] = [];
    let vouchers = 0;
    let rejected = 0;

    const make = async (page: string, data: Record<string, unknown>, h?: Hdr) => {
      const res = await client.create(owner, page, data, h);
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      vouchers += 1;
      const v = dataOf<TypedBody>(res);
      created.push({ id: v.id, page, ...(h ? { h } : {}) });
      return v;
    };
    const run = async (page: string, id: string, action: string, h?: Hdr) => {
      const res = await client.action(owner, page, id, action, {}, undefined, h);
      if (res.status === 200) return true;
      expect(res.status, JSON.stringify(res.body)).toBe(409);
      expect(errorOf(res).code).toBe('INSUFFICIENT_STOCK');
      rejected += 1;
      return false;
    };

    // Opening stock gives every pair something to move.
    for (const item of items) {
      for (const w of warehouses) {
        const v = await make(
          'inv-opening',
          { item: item.id, warehouse: w.id, openingQty: int(5, 30), unitCost: int(10, 90) },
          hdr(w),
        );
        expect(await run('inv-opening', v.id, 'post', hdr(w))).toBe(true);
        posted.push({ id: v.id, page: 'inv-opening', ...(hdr(w) ? { h: hdr(w) } : {}) });
      }
    }

    while (vouchers < 500) {
      const roll = random();
      const item = pick(items);
      const w = pick(warehouses);
      const h = hdr(w);
      if (roll < 0.3) {
        const qty = int(1, 40) + (random() < 0.3 ? 0.5 : 0);
        const cost = int(100, 12000) / 100;
        const v = await make(
          'inv-transactions',
          { transactionType: 'Receipt', item: item.id, warehouse: w.id, qty, unitCost: cost },
          h,
        );
        if (await run('inv-transactions', v.id, 'post', h))
          posted.push({ id: v.id, page: 'inv-transactions', ...(h ? { h } : {}) });
      } else if (roll < 0.6) {
        const v = await make(
          'inv-transactions',
          { transactionType: 'Issue', item: item.id, warehouse: w.id, qty: int(1, 35) },
          h,
        );
        if (await run('inv-transactions', v.id, 'post', h))
          posted.push({ id: v.id, page: 'inv-transactions', ...(h ? { h } : {}) });
      } else if (roll < 0.75) {
        const v = await make(
          'inv-adjustment',
          {
            item: item.id,
            warehouse: w.id,
            countedQty: int(0, 60),
            reasonCode: pick(['Damage', 'Expiry', 'Count Correction', 'Theft/Loss', 'Other']),
          },
          h,
        );
        if (await run('inv-adjustment', v.id, 'post', h))
          posted.push({ id: v.id, page: 'inv-adjustment', ...(h ? { h } : {}) });
      } else if (roll < 0.9) {
        const dest = pick(warehouses.filter((x) => x.id !== w.id));
        const v = await make(
          'inv-transfer',
          {
            sourceWarehouse: w.id,
            destinationWarehouse: dest.id,
            item: item.id,
            requestedQty: int(1, 20),
          },
          h,
        );
        if (await run('inv-transfer', v.id, 'dispatch', h)) {
          const end = random();
          if (end < 0.75) expect(await run('inv-transfer', v.id, 'receive', hdr(dest))).toBe(true);
          else if (end < 0.9) expect(await run('inv-transfer', v.id, 'cancel', h)).toBe(true);
        }
      } else if (posted.length > 0) {
        const target = pick(posted);
        if (await run(target.page, target.id, 'cancel', target.h))
          posted.splice(posted.indexOf(target), 1);
      }
    }
    expect(vouchers).toBe(500);
    expect(rejected).toBeGreaterThan(0);

    const ids = items.map((i) => i.id);
    await assertLedgerMatchesBalances(ids);

    // Drafts that failed to post (and Draft / cancelled transfers) left no ledger rows; a cancelled
    // voucher nets to zero in quantity and value.
    const states = await prisma.$queryRaw<
      { id: string; kind: string; status: string; rows: number; qty: string; value: string }[]
    >`
      SELECT v.id, v.kind, v.status, count(l.id)::int AS rows,
             COALESCE(sum(l.qty_in - l.qty_out), 0)::text AS qty, COALESCE(sum(l.value), 0)::text AS value
      FROM stock_vouchers v LEFT JOIN stock_ledger l ON l.voucher_id = v.id
      WHERE v.id = ANY(${created.map((c) => c.id)}::uuid[]) GROUP BY v.id, v.kind, v.status`;
    expect(states).toHaveLength(created.length);
    for (const s of states) {
      if (s.status === 'Draft') expect(s.rows, s.id).toBe(0);
      if (s.status === 'Cancelled') {
        expect(Number(s.qty), s.id).toBe(0);
        expect(Number(s.value), s.id).toBe(0);
      }
      if (s.status === 'Posted' || s.status === 'Dispatched' || s.status === 'Received') {
        expect(s.rows, s.id).toBeGreaterThanOrEqual(s.kind === 'ADJUSTMENT' ? 0 : 1);
      }
    }
    const transfers = states.filter((s) => s.kind === 'TRANSFER' && s.status === 'Received');
    expect(transfers.length).toBeGreaterThan(5);
    for (const t of transfers) {
      // A received transfer moved quantity and value from one warehouse to the other: net zero.
      expect(Number(t.qty), t.id).toBe(0);
      expect(Number(t.value), t.id).toBe(0);
    }
    // The summed value of every item adds up too: no stock was created or lost by rounding.
    const totals = await prisma.$queryRaw<{ bal: string; led: string }[]>`
      SELECT (SELECT COALESCE(sum(value), 0) FROM stock_balances WHERE item_id = ANY(${ids}::uuid[]))::text AS bal,
             (SELECT COALESCE(sum(value), 0) FROM stock_ledger WHERE item_id = ANY(${ids}::uuid[]))::text AS led`;
    expect(Number(totals[0]?.bal)).toBeCloseTo(Number(totals[0]?.led), 6);
  });
});
