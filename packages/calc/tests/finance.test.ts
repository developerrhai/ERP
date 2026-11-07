import { describe, expect, it } from 'vitest';
import {
  ageBucket,
  budgetCheck,
  checkBalance,
  daysPastDue,
  fifoAllocate,
  fromPaise,
  lineIsOneSided,
  mulberry32,
  naturalBalance,
  reconciliationDifference,
  reverseLines,
  roundOff,
  toPaise,
} from '../src/finance/index.js';

/** The seed of the property tests below. Change it only on purpose: it is written in PHASE-07-REPORT.md. */
export const PROPERTY_SEED = 20261113;

describe('money in paise', () => {
  it('parses and prints exactly', () => {
    expect(toPaise('1234.5')).toBe(123450n);
    expect(toPaise('0.07')).toBe(7n);
    expect(toPaise('-12.30')).toBe(-1230n);
    expect(fromPaise(123450n)).toBe('1234.50');
    expect(fromPaise(-5n)).toBe('-0.05');
  });
  it('0.1 + 0.2 is exactly 0.30', () => {
    expect(fromPaise(toPaise('0.10') + toPaise('0.20'))).toBe('0.30');
  });
  it('refuses more than 2 decimals and junk (AMOUNT_PRECISION)', () => {
    expect(() => toPaise('1.234')).toThrow(RangeError);
    expect(() => toPaise('abc')).toThrow(RangeError);
    expect(() => toPaise('')).toThrow(RangeError);
  });
});

describe('BR-FIN-01 balanced journal', () => {
  const U = 'unit-1';
  it('plan example: Dr 5,000.00 / Cr 2,000.00 / Cr 3,000.00 balances', () => {
    const r = checkBalance([
      { unitId: U, debit: '5000.00', credit: '0.00' },
      { unitId: U, debit: '0.00', credit: '2000.00' },
      { unitId: U, debit: '0.00', credit: '3000.00' },
    ]);
    expect(r.balanced).toBe(true);
    expect(r.difference).toBe('0.00');
  });
  it('plan example: Dr 5,000.00 / Cr 4,999.99 is out by 0.01', () => {
    const r = checkBalance([
      { unitId: U, debit: '5000.00', credit: '0.00' },
      { unitId: U, debit: '0.00', credit: '4999.99' },
    ]);
    expect(r.balanced).toBe(false);
    expect(r.difference).toBe('0.01');
  });
  it('one line is never a journal', () => {
    expect(checkBalance([{ unitId: U, debit: '10.00', credit: '0.00' }]).balanced).toBe(false);
  });
  it('a journal that balances overall but not inside a unit does not post (owner rule)', () => {
    const r = checkBalance([
      { unitId: 'A', debit: '100.00', credit: '0.00' },
      { unitId: 'B', debit: '0.00', credit: '100.00' },
    ]);
    expect(r.totalDebit).toBe(r.totalCredit);
    expect(r.byUnit).toEqual({ A: '100.00', B: '-100.00' });
    expect(r.balanced).toBe(false);
  });
  it('an inter-unit journal balances once each unit carries a due-to / due-from line', () => {
    const r = checkBalance([
      { unitId: 'A', debit: '100.00', credit: '0.00' }, // expense in A
      { unitId: 'A', debit: '0.00', credit: '100.00' }, // due to B in A
      { unitId: 'B', debit: '100.00', credit: '0.00' }, // due from A in B
      { unitId: 'B', debit: '0.00', credit: '100.00' }, // bank in B
    ]);
    expect(r.balanced).toBe(true);
  });
  it('a line has exactly one side', () => {
    expect(lineIsOneSided({ debit: '5.00', credit: '0.00' })).toBe(true);
    expect(lineIsOneSided({ debit: '5.00', credit: '5.00' })).toBe(false);
    expect(lineIsOneSided({ debit: '0.00', credit: '0.00' })).toBe(false);
    expect(lineIsOneSided({ debit: '-1.00', credit: '0.00' })).toBe(false);
  });
});

describe('BR-FIN-04 reversal swaps the sides', () => {
  it('Dr Rent 10,000 / Cr Bank 10,000 becomes Dr Bank / Cr Rent and nets to zero', () => {
    const orig = [
      { unitId: 'A', account: 'RENT', debit: '10000.00', credit: '0.00' },
      { unitId: 'A', account: 'BANK', debit: '0.00', credit: '10000.00' },
    ];
    const rev = reverseLines(orig);
    expect(rev[0]).toMatchObject({ account: 'RENT', debit: '0.00', credit: '10000.00' });
    expect(rev[1]).toMatchObject({ account: 'BANK', debit: '10000.00', credit: '0.00' });
    expect(checkBalance(rev).balanced).toBe(true);
  });
});

describe('BR-FIN-06 round-off', () => {
  it('plan example: 14,567.89 rounds to 14,568.00 with +0.11', () => {
    expect(roundOff('14567.89')).toBe('0.11');
  });
  it('rounds half up and down', () => {
    expect(roundOff('100.50')).toBe('0.50');
    expect(roundOff('100.49')).toBe('-0.49');
    expect(roundOff('100.00')).toBe('0.00');
  });
  it('is never more than 0.50 in size', () => {
    const rnd = mulberry32(PROPERTY_SEED);
    for (let i = 0; i < 500; i++) {
      const total = fromPaise(BigInt(Math.floor(rnd() * 10_000_000)));
      const ro = toPaise(roundOff(total));
      expect(ro >= -49n && ro <= 50n).toBe(true);
      expect((toPaise(total) + ro) % 100n).toBe(0n);
    }
  });
});

describe('BR-FIN-10 FIFO allocation', () => {
  const items = [
    { id: 'INV-2', outstanding: '60000.00', dueDate: '2026-10-20', docDate: '2026-09-20', docNo: 'INV-2' },
    { id: 'INV-1', outstanding: '40000.00', dueDate: '2026-10-10', docDate: '2026-09-10', docNo: 'INV-1' },
  ];
  it('plan example: a receipt of 70,000 pays INV-1 40,000 then INV-2 30,000', () => {
    const r = fifoAllocate(items, '70000.00');
    expect(r.parts).toEqual([
      { itemId: 'INV-1', amount: '40000.00' },
      { itemId: 'INV-2', amount: '30000.00' },
    ]);
    expect(r.unallocated).toBe('0.00');
  });
  it('the rest becomes an advance', () => {
    const r = fifoAllocate(items, '120000.00');
    expect(r.unallocated).toBe('20000.00');
  });
  it('items without a due date go last', () => {
    const r = fifoAllocate(
      [
        { id: 'X', outstanding: '10.00', dueDate: null, docDate: '2026-01-01', docNo: 'X' },
        { id: 'Y', outstanding: '10.00', dueDate: '2026-12-01', docDate: '2026-11-01', docNo: 'Y' },
      ],
      '10.00',
    );
    expect(r.parts).toEqual([{ itemId: 'Y', amount: '10.00' }]);
  });
  it('property: allocated + unallocated always equals the amount, no part exceeds its item', () => {
    const rnd = mulberry32(PROPERTY_SEED + 1);
    for (let n = 0; n < 300; n++) {
      const list = Array.from({ length: 1 + Math.floor(rnd() * 8) }, (_, i) => ({
        id: `I${i}`,
        outstanding: fromPaise(BigInt(1 + Math.floor(rnd() * 500_000))),
        dueDate: rnd() < 0.2 ? null : `2026-${String(1 + Math.floor(rnd() * 12)).padStart(2, '0')}-15`,
        docDate: '2026-01-01',
        docNo: `D${i}`,
      }));
      const amt = BigInt(Math.floor(rnd() * 3_000_000));
      const r = fifoAllocate(list, fromPaise(amt));
      const used = r.parts.reduce<bigint>((a, p) => a + toPaise(p.amount), 0n);
      expect(used + toPaise(r.unallocated)).toBe(amt);
      for (const p of r.parts) {
        expect(toPaise(p.amount) <= toPaise(list.find((x) => x.id === p.itemId)!.outstanding)).toBe(true);
      }
    }
  });
});

describe('ageing', () => {
  it('days past due and buckets', () => {
    expect(daysPastDue('2026-10-10', '2026-09-10', '2026-11-06')).toBe(27);
    expect(ageBucket(-3)).toBe('NOT_DUE');
    expect(ageBucket(0)).toBe('NOT_DUE');
    expect(ageBucket(1)).toBe('1-30');
    expect(ageBucket(30)).toBe('1-30');
    expect(ageBucket(31)).toBe('31-60');
    expect(ageBucket(90)).toBe('61-90');
    expect(ageBucket(91)).toBe('90+');
  });
  it('no due date means due on the document date', () => {
    expect(daysPastDue(null, '2026-10-07', '2026-11-06')).toBe(30);
  });
});

describe('natural balance', () => {
  it('assets and expenses are debit - credit; the rest credit - debit', () => {
    expect(naturalBalance('Asset', '500.00', '200.00')).toBe('300.00');
    expect(naturalBalance('Expense', '50.00', '80.00')).toBe('-30.00');
    expect(naturalBalance('Income', '10.00', '90.00')).toBe('80.00');
    expect(naturalBalance('Liability', '0.00', '75.50')).toBe('75.50');
  });
});

describe('bank reconciliation', () => {
  it('book 1,00,000; a cheque of 5,000 not cleared; bank charge 118 not booked; statement 94,882 reconciles', () => {
    // books: 100000.00. Uncleared issued cheque: -5000 (it reduced the book but not the bank).
    // bank has the charge (-118) that the books do not: unrecorded bank = -118.
    // adjusted book = 100000 - (-5000) = 105000;  adjusted bank = statement - (-118) = statement + 118
    // reconcile when statement = 105000 - 118 = 104882
    const diff = reconciliationDifference({
      bookBalance: '100000.00',
      statementClosing: '104882.00',
      unclearedBook: ['-5000.00'],
      unrecordedBank: ['-118.00'],
    });
    expect(diff).toBe('0.00');
  });
  it('a difference is reported, not hidden', () => {
    expect(
      reconciliationDifference({ bookBalance: '100.00', statementClosing: '90.00', unclearedBook: [], unrecordedBank: [] }),
    ).toBe('10.00');
  });
});

describe('budget check', () => {
  it('stays inside the budget', () => {
    expect(budgetCheck('100000.00', '60000.00', '30000.00')).toEqual({ exceeded: false, available: '40000.00', over: '0.00' });
  });
  it('flags the overshoot', () => {
    expect(budgetCheck('100000.00', '90000.00', '15000.50')).toEqual({ exceeded: true, available: '10000.00', over: '5000.50' });
  });
  it('spending exactly the budget is allowed', () => {
    expect(budgetCheck('100.00', '40.00', '60.00').exceeded).toBe(false);
  });
});

describe('property: any random multi-unit journal built by the rules balances', () => {
  it('lines built as pairs per unit always pass checkBalance; one tampered paisa never does', () => {
    const rnd = mulberry32(PROPERTY_SEED + 2);
    for (let n = 0; n < 400; n++) {
      const units = ['U1', 'U2', 'U3'];
      const lines: { unitId: string; debit: string; credit: string }[] = [];
      for (const u of units) {
        if (rnd() < 0.4) continue;
        const parts = 1 + Math.floor(rnd() * 4);
        let total = 0n;
        for (let i = 0; i < parts; i++) {
          const a = BigInt(1 + Math.floor(rnd() * 900_000));
          total += a;
          lines.push({ unitId: u, debit: fromPaise(a), credit: '0.00' });
        }
        lines.push({ unitId: u, debit: '0.00', credit: fromPaise(total) });
      }
      if (lines.length === 0) continue;
      expect(checkBalance(lines).balanced).toBe(true);
      const bad = lines.map((l) => ({ ...l }));
      const last = bad[bad.length - 1]!;
      last.credit = fromPaise(toPaise(last.credit) + 1n);
      expect(checkBalance(bad).balanced).toBe(false);
    }
  });
});
