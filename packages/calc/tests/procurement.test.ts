import { describe, expect, it } from 'vitest';
import * as p from '../src/procurement/index.js';

const C194 = { mode: 'ON_ALL' as const, thresholdSingle: '30000', thresholdAnnual: '100000', ratePct: '2' };
const Q194 = { mode: 'ON_EXCESS' as const, thresholdSingle: null, thresholdAnnual: '5000000', ratePct: '0.1' };

describe('tax (spec §5 example)', () => {
  it('10 @ 62.50, 2 % discount, 18 % intra -> 612.50 / 55.13 / 55.13 / 722.76', () => {
    const l = p.lineTax({ qty: '10', rate: '62.50', discountPct: '2', gstPct: '18', intraState: true });
    expect(l.taxable).toBe('612.50');
    expect(l.cgst).toBe('55.13');
    expect(l.sgst).toBe('55.13');
    expect(l.total).toBe('722.76');
  });
  it('inter-state gives IGST only; header rounds to the rupee', () => {
    const l = p.lineTax({ qty: '10', rate: '62.50', discountPct: '2', gstPct: '18', intraState: false });
    expect(l.igst).toBe('110.25');
    const h = p.headerTotals([p.lineTax({ qty: '10', rate: '62.50', discountPct: '2', gstPct: '18', intraState: true })]);
    expect(h.grandTotal).toBe('723.00');
    expect(h.roundOff).toBe('0.24');
  });
});

describe('over-receipt', () => {
  it('ordered 100, 5 %, 100 received, new 6 -> refused; 5 -> allowed', () => {
    const base = { ordered: '100', closed: '0', receivedBefore: '100', tolerancePct: '5' };
    expect(p.checkOverReceipt({ ...base, newQty: '6' }).ok).toBe(false);
    expect(p.checkOverReceipt({ ...base, newQty: '5' }).ok).toBe(true);
    expect(p.maxReceivable('100', '0', '5')).toBe('105.000');
  });
});

describe('landed cost', () => {
  it('100 over 3 equal lines -> 33.33 / 33.33 / 33.34', () => {
    const lines = ['a', 'b', 'c'].map((key) => ({ key, value: '100', qty: '1' }));
    expect(p.allocateLandedCost('100', lines, 'VALUE').map((x) => x.share)).toEqual(['33.33', '33.33', '33.34']);
  });
  it('by qty and by weight', () => {
    const lines = [
      { key: 'a', value: '1', qty: '1', weight: '3' },
      { key: 'b', value: '1', qty: '3', weight: '1' },
    ];
    expect(p.allocateLandedCost('100', lines, 'QTY').map((x) => x.share)).toEqual(['25.00', '75.00']);
    expect(p.allocateLandedCost('100', lines, 'WEIGHT').map((x) => x.share)).toEqual(['75.00', '25.00']);
  });
});

describe('3-way match (PO 100 @ 50, GRN accepted 98, invoice 100 @ 50.50)', () => {
  const tol = { qtyPct: '2', pricePct: '2', taxAmount: '1' };
  it('flags QTY_OVER_RECEIPT only; matched 4,900.00, variance 150.00', () => {
    const r = p.matchLine(
      { invoiceQty: '100', invoiceRate: '50.50', grnAcceptedQty: '98', alreadyBilledQty: '0', poNetRate: '50' },
      tol,
    );
    expect(r.codes).toEqual(['QTY_OVER_RECEIPT']);
    expect(r.matchedValue).toBe('4900.00');
    expect(r.variance).toBe('150.00');
  });
  it('invoice 98 @ 50.50 passes (1 % price is inside 2 %)', () => {
    const r = p.matchLine(
      { invoiceQty: '98', invoiceRate: '50.50', grnAcceptedQty: '98', alreadyBilledQty: '0', poNetRate: '50' },
      tol,
    );
    expect(r.ok).toBe(true);
    expect(r.variance).toBe('49.00');
  });
  it('3 % price difference is flagged; tax difference above 1 rupee is flagged', () => {
    const r = p.matchLine(
      { invoiceQty: '98', invoiceRate: '51.50', grnAcceptedQty: '98', alreadyBilledQty: '0', poNetRate: '50', invoiceTax: '10', expectedTax: '8' },
      tol,
    );
    expect(r.codes).toEqual(['PRICE_VARIANCE', 'TAX_VARIANCE']);
  });
});

describe('TDS', () => {
  it('194C: 60,000 -> 1,200; 25,000 -> 0; 20,000 -> base 45,000, TDS 900', () => {
    const a = p.computeTds('60000', C194, { cumBaseBefore: '0', cumTdsBaseBefore: '0' });
    expect(a.tds).toBe('1200.00');
    const b = p.computeTds('25000', C194, { cumBaseBefore: a.cumBaseAfter, cumTdsBaseBefore: a.cumTdsBaseAfter });
    expect(b.tds).toBe('0.00');
    expect(b.cumBaseAfter).toBe('85000.00');
    const c = p.computeTds('20000', C194, { cumBaseBefore: b.cumBaseAfter, cumTdsBaseBefore: b.cumTdsBaseAfter });
    expect(c.cumBaseAfter).toBe('105000.00');
    expect(c.base).toBe('45000.00');
    expect(c.tds).toBe('900.00');
  });
  it('194Q: 30 L -> 0; 40 L -> 2,000; 10 L -> 1,000', () => {
    const a = p.computeTds('3000000', Q194, { cumBaseBefore: '0', cumTdsBaseBefore: '0' });
    expect(a.tds).toBe('0.00');
    const b = p.computeTds('4000000', Q194, { cumBaseBefore: a.cumBaseAfter, cumTdsBaseBefore: a.cumTdsBaseAfter });
    expect(b.tds).toBe('2000.00');
    const c = p.computeTds('1000000', Q194, { cumBaseBefore: b.cumBaseAfter, cumTdsBaseBefore: b.cumTdsBaseAfter });
    expect(c.tds).toBe('1000.00');
  });
  it('194Q already above the limit: 4,949.00 -> 5.00 (rupee rounding)', () => {
    const r = p.computeTds('4949', Q194, { cumBaseBefore: '6000000', cumTdsBaseBefore: '6000000' });
    expect(r.tds).toBe('5.00');
  });
  it('a debit note (negative base) lowers the cumulative; next invoice is net', () => {
    const a = p.computeTds('60000', C194, { cumBaseBefore: '0', cumTdsBaseBefore: '0' });
    const dn = p.computeTds('-10000', C194, { cumBaseBefore: a.cumBaseAfter, cumTdsBaseBefore: a.cumTdsBaseAfter });
    expect(dn.cumBaseAfter).toBe('50000.00');
    expect(dn.cumTdsBaseAfter).toBe('50000.00');
    const next = p.computeTds('40000', C194, { cumBaseBefore: dn.cumBaseAfter, cumTdsBaseBefore: dn.cumTdsBaseAfter });
    expect(next.base).toBe('40000.00');
    expect(next.tds).toBe('800.00');
  });
});

describe('MSME', () => {
  it('GRN 10-11-2026: agreed 45 -> 25-12-2026; none -> 25-11-2026; agreed 60 capped at 45', () => {
    expect(p.msmeDueDate('2026-11-10', 45)).toBe('2026-12-25');
    expect(p.msmeDueDate('2026-11-10', null)).toBe('2026-11-25');
    expect(p.msmeDueDate('2026-11-10', 60)).toBe('2026-12-25');
  });
  it('interest P 1,00,000, b 5.75 %, d 60 -> 2,895.66', () => {
    expect(p.msmeInterest('100000', '5.75', 60)).toBe('2895.66');
    expect(p.msmeInterest('100000', '5.75', 0)).toBe('0.00');
  });
});

describe('ITC 180', () => {
  it('ITC 890.82, 100 % unpaid -> 445.41 + 445.41', () => {
    const r = p.itc180Reverse({ cgst: '445.41', sgst: '445.41', igst: '0' }, '5840.00', '5840.00');
    expect(r).toEqual({ cgst: '445.41', sgst: '445.41', igst: '0.00' });
  });
  it('half unpaid reverses half; due date is invoice date + 180', () => {
    expect(p.itc180Reverse({ cgst: '100', sgst: '100', igst: '0' }, '1000', '500').cgst).toBe('50.00');
    expect(p.itc180DueDate('2026-01-01')).toBe('2026-06-30');
  });
});

describe('evaluation', () => {
  it('Q 60, D 70, C 95.24, R 80 -> 72.0480, grade B', () => {
    const o = p.overallScore({ q: '60', d: '70', c: '95.24', r: '80' });
    expect(o).toBe('72.0480');
    expect(p.gradeFor(o)).toBe('B');
  });
  it('component formulas', () => {
    expect(p.qualityScore('30000')).toBe('40.0000');
    expect(p.qualityScore('999999')).toBe('0.0000');
    expect(p.deliveryScore('40')).toBe('70.0000');
    expect(p.costScore('100', '105')).toBe('95.24');
  });
});

describe('PO delivery tracking', () => {
  it('Open / Partly received / Closed / Delayed', () => {
    const base = { poQty: '100', expectedDate: '2026-11-10' };
    expect(p.deliveryStatus({ ...base, receivedQty: '0', today: '2026-11-05' }).status).toBe('OPEN');
    expect(p.deliveryStatus({ ...base, receivedQty: '40', today: '2026-11-05' }).status).toBe('PARTLY_RECEIVED');
    expect(p.deliveryStatus({ ...base, receivedQty: '40', today: '2026-11-11' })).toEqual({ status: 'DELAYED', balance: '60.000' });
    expect(p.deliveryStatus({ ...base, receivedQty: '100', today: '2026-11-11' }).status).toBe('CLOSED');
  });
});
