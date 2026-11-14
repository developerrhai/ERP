import { describe, expect, it } from 'vitest';
import { docTotals } from './DocPage';

describe('document totals panel (display sums)', () => {
  it('adds taxable value and GST across lines, with discount', () => {
    const t = docTotals([
      { qty: '10', rate: '100', discountPct: '10', gstPct: '18' },
      { qty: '5', rate: '200', discountPct: '', gstPct: '18' },
    ]);
    expect(t?.taxable).toBeCloseTo(1900);
    expect(t?.gst).toBeCloseTo(342);
    expect(t?.total).toBeCloseTo(2242);
  });
  it('skips lines with no rate (price list) and returns null when nothing is priced', () => {
    expect(docTotals([{ qty: '10', rate: '', gstPct: '18' }])).toBeNull();
    expect(
      docTotals([
        { qty: '10', rate: '50', gstPct: '' },
        { qty: '2', rate: '' },
      ])?.priced,
    ).toBe(1);
  });
});
