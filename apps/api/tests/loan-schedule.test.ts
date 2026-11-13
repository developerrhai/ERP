// Phase 22 pay-loan: worked examples - the schedule always adds up to the principal exactly.
import { describe, expect, it } from 'vitest';
import { addMonths, loanSchedule, regularEmi } from '../src/modules/screens/loan';

describe('loan schedule (interest-free)', () => {
  it('Rs 20,000 over 10 EMIs is 10 rows of Rs 2,000', () => {
    const s = loanSchedule('20000', 10, '2026-12-05');
    expect(s).toHaveLength(10);
    expect(s.every((r) => r.amount === '2000.00')).toBe(true);
    expect(s[0]?.dueDate).toBe('2026-12-05');
    expect(s[9]?.dueDate).toBe('2027-09-05');
    expect(regularEmi('20000', 10)).toBe('2000.00');
  });

  it('puts the rounding on the last instalment so the total is exact', () => {
    const s = loanSchedule('10000', 3, '2026-11-30');
    expect(s.map((r) => r.amount)).toEqual(['3333.33', '3333.33', '3333.34']);
    const sum = s.reduce((a, r) => a + BigInt(r.amount.replace('.', '')), 0n);
    expect(sum).toBe(1000000n);
  });

  it('clamps the due day to the month end', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-12-15', 2)).toBe('2027-02-15');
  });

  it('refuses nonsense', () => {
    expect(() => loanSchedule('0', 5, '2026-11-01')).toThrow();
    expect(() => loanSchedule('1000', 0, '2026-11-01')).toThrow();
    expect(() => loanSchedule('1000.123', 5, '2026-11-01')).toThrow();
  });
});
