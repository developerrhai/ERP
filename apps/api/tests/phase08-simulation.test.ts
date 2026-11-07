// Phase 8 seeded simulation (02e §11.5): ~150 random operations (batch receipts, issues, adjustments, transfers,
// cancels, reservations) across two warehouses of one unit, including requests that must fail. After every 25
// operations GET /inventory/integrity must be clean, and at the end stock value = GL in that unit.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { invalidateAccessCache } from '../src/core/rbac/access';
import { newApp, prisma, signInOwner } from './helpers';
import type { Signed } from './helpers';
import { dataOf } from './phase4-helpers';
import { fixture, mkItem, setApproval, vclient } from './phase08-helpers';
import type { Fixture } from './phase08-helpers';

const SEED = 20261107;
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const app = newApp();
let owner: Signed;
let fx: Fixture;
let saved: Awaited<ReturnType<typeof setApproval>>;

beforeAll(async () => {
  owner = await signInOwner(app);
  saved = await setApproval(false);
  invalidateAccessCache();
  fx = await fixture();
});
afterAll(async () => {
  for (const r of saved)
    await prisma.moduleControl.update({
      where: { pageId: r.pageId },
      data: { approvalRequired: r.approvalRequired },
    });
  await prisma.$disconnect();
});

describe('simulation', () => {
  it('keeps ledger = balance = slices, reservations valid and stock value = GL through 150 random operations', async () => {
    const v = vclient(app, owner, fx.unitId);
    const r = rng(SEED);
    const pick = <T>(xs: T[]): T => xs[Math.floor(r() * xs.length)]!;
    const items = [
      await mkItem(),
      await mkItem(),
      await mkItem({ batchTracked: true, shelfLifeDays: 365 }),
      await mkItem({ itemType: 'Finished Good' }),
    ];
    const whs = [fx.warehouseId, fx.warehouse2Id];
    const posted: { id: string; kind: string; status: string }[] = [];
    let batchSeq = 0;
    const expected = new Set([200, 201, 409, 422]);

    const integrity = async () => {
      const res = await v.call('get', '/inventory/integrity');
      const data = dataOf<{ checks: { id: string; mismatches: unknown[] }[] }>(res);
      for (const c of data.checks.filter((x) =>
        ['INV-1', 'INV-2', 'INV-3', 'INV-4'].includes(x.id),
      )) {
        expect(c.mismatches, `${c.id} after the operations so far`).toEqual([]);
      }
    };

    for (let i = 1; i <= 150; i++) {
      const it = pick(items);
      const wh = pick(whs);
      const roll = r();
      const batchy = it.batchTracked
        ? { batchNo: `S${(batchSeq += roll < 0.5 ? 1 : 0) || 1}`, mfgDate: '2026-10-01' }
        : {};
      if (roll < 0.32) {
        const c = await v.call('post', '/inventory/vouchers/transactions', {
          warehouseId: wh,
          txType: 'Receipt',
          lines: [
            {
              itemId: it.id,
              qty: 1 + Math.floor(r() * 20),
              unitCost: 5 + Math.floor(r() * 40),
              ...batchy,
            },
          ],
        });
        expect(expected.has(c.status), JSON.stringify(c.body)).toBe(true);
        if (c.status === 201) {
          const d = dataOf<{ id: string; version: number }>(c);
          await v.call('post', `/inventory/vouchers/transactions/${d.id}/submit`, undefined, {
            'If-Match': `"${d.version}"`,
          });
          const p = await v.act('transactions', d.id, 'post');
          expect(expected.has(p.status), JSON.stringify(p.body)).toBe(true);
          if (p.status === 200) posted.push({ id: d.id, kind: 'transactions', status: 'Posted' });
        }
      } else if (roll < 0.6) {
        const c = await v.call('post', '/inventory/vouchers/transactions', {
          warehouseId: wh,
          txType: 'Issue',
          lines: [{ itemId: it.id, qty: 1 + Math.floor(r() * 12) }],
        });
        if (c.status === 201) {
          const d = dataOf<{ id: string; version: number }>(c);
          await v.call('post', `/inventory/vouchers/transactions/${d.id}/submit`, undefined, {
            'If-Match': `"${d.version}"`,
          });
          const p = await v.act('transactions', d.id, 'post');
          expect([200, 409, 422]).toContain(p.status);
          if (p.status === 200) posted.push({ id: d.id, kind: 'transactions', status: 'Posted' });
        }
      } else if (roll < 0.7) {
        const c = await v.call('post', '/inventory/vouchers/adjustment', {
          warehouseId: wh,
          lines: [
            {
              itemId: it.id,
              countedQty: Math.floor(r() * 25),
              reasonCode: 'Count Correction',
              ...(it.batchTracked ? { batchNo: 'S1' } : {}),
            },
          ],
        });
        if (c.status === 201) {
          const d = dataOf<{ id: string; version: number }>(c);
          await v.call('post', `/inventory/vouchers/adjustment/${d.id}/submit`, undefined, {
            'If-Match': `"${d.version}"`,
          });
          const p = await v.act('adjustment', d.id, 'post');
          expect([200, 409, 422]).toContain(p.status);
          if (p.status === 200) posted.push({ id: d.id, kind: 'adjustment', status: 'Posted' });
        }
      } else if (roll < 0.82) {
        const from = wh;
        const to = from === whs[0] ? whs[1]! : whs[0]!;
        const c = await v.call('post', '/inventory/vouchers/transfer', {
          warehouseId: from,
          toWarehouseId: to,
          lines: [
            {
              itemId: it.id,
              qty: 1 + Math.floor(r() * 6),
              ...(it.batchTracked ? { batchNo: 'S1' } : {}),
            },
          ],
        });
        if (c.status === 201) {
          const d = dataOf<{ id: string; version: number }>(c);
          await v.call('post', `/inventory/vouchers/transfer/${d.id}/submit`, undefined, {
            'If-Match': `"${d.version}"`,
          });
          const p = await v.act('transfer', d.id, 'dispatch');
          expect([200, 409, 422]).toContain(p.status);
          if (p.status === 200) {
            if (r() < 0.6) {
              const rc = await v.act('transfer', d.id, 'receive');
              expect([200, 409]).toContain(rc.status);
            } else {
              posted.push({ id: d.id, kind: 'transfer', status: 'Dispatched' });
            }
          }
        }
      } else if (roll < 0.9 && posted.length > 0) {
        const t = posted.splice(Math.floor(r() * posted.length), 1)[0]!;
        const res = await v.act(t.kind, t.id, 'cancel', { reason: 'simulation cancel' });
        expect([200, 409]).toContain(res.status);
      } else {
        const res = await v.call('post', '/inventory/reservations', {
          itemId: it.id,
          warehouseId: wh,
          requiredQty: 1 + Math.floor(r() * 5),
          priority: pick(['Critical', 'High', 'Medium', 'Low']),
        });
        expect([201, 409, 422]).toContain(res.status);
      }
      if (i % 25 === 0) await integrity();
    }
    await integrity();

    // A cancelled voucher nets to zero on the books too: stock value = GL in this unit, per inventory account.
    const cmp = dataOf<{
      rows: { unit: string; key: string; stockValue: number; variance: number | null }[];
    }>(await v.call('get', '/inventory/reports/gl-compare'));
    const unit = await prisma.unit.findUniqueOrThrow({ where: { id: fx.unitId } });
    const mine = cmp.rows.filter((x) => x.unit === unit.code);
    expect(mine.length).toBeGreaterThan(0);
    for (const row of mine) expect(row.variance, `${row.key}`).toBe(0);
    const ops = await prisma.stockLedger.count({ where: { unitId: fx.unitId } });
    expect(ops).toBeGreaterThan(40);
  }, 280_000);
});
