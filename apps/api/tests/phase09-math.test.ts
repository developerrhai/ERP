// The API runtime math (modules/procurement/math.ts, Decimal) must agree with the calc package
// (packages/calc/src/procurement, the unit-tested reference) on every worked example of PHASE-09.
import { describe, expect, it } from 'vitest';
import * as calc from '../../../packages/calc/src/procurement/index';
import { D } from '../src/modules/inventory/money';
import * as m from '../src/modules/procurement/math';

describe('API math == calc package', () => {
  it('tax, header total, over-receipt, landed cost', () => {
    const t = m.lineTax({
      qty: D(10),
      rate: D('62.50'),
      discountPct: D(2),
      gstPct: D(18),
      intra: true,
    });
    const c = calc.lineTax({
      qty: '10',
      rate: '62.50',
      discountPct: '2',
      gstPct: '18',
      intraState: true,
    });
    expect([t.taxable.toFixed(2), t.cgst.toFixed(2), t.total.toFixed(2)]).toEqual([
      c.taxable,
      c.cgst,
      c.total,
    ]);
    expect(t.total.toFixed(2)).toBe('722.76');
    expect(m.maxReceivable(D(100), D(0), D(5)).toFixed(3)).toBe(
      calc.maxReceivable('100', '0', '5'),
    );
    const split = m.splitAmount(D(100), [D(1), D(1), D(1)]).map((x) => x.toFixed(2));
    expect(split).toEqual(['33.33', '33.33', '33.34']);
  });
  it('3-way match', () => {
    const tol = { qtyPct: D(2), pricePct: D(2), taxAmount: D(1) };
    const r = m.matchLine(
      {
        invoiceQty: D(100),
        invoiceRate: D('50.50'),
        grnAcceptedQty: D(98),
        alreadyBilledQty: D(0),
        poNetRate: D(50),
      },
      tol,
    );
    expect(r.codes).toEqual(['QTY_OVER_RECEIPT']);
    expect(r.matchedValue.toFixed(2)).toBe('4900.00');
    expect(r.variance.toFixed(2)).toBe('150.00');
  });
  it('TDS 194C and 194Q', () => {
    const c194 = {
      mode: 'ON_ALL' as const,
      thresholdSingle: D(30000),
      thresholdAnnual: D(100000),
      ratePct: D(2),
      rounding: 'RUPEE' as const,
    };
    let st = { cumBase: D(0), cumTdsBase: D(0) };
    const out: string[] = [];
    for (const a of [60000, 25000, 20000]) {
      const r = m.computeTds(D(a), c194, st);
      out.push(r.tds.toFixed(0));
      st = { cumBase: r.cumBaseAfter, cumTdsBase: r.cumTdsBaseAfter };
    }
    expect(out).toEqual(['1200', '0', '900']);
    const q = {
      mode: 'ON_EXCESS' as const,
      thresholdSingle: null,
      thresholdAnnual: D(5000000),
      ratePct: D('0.1'),
      rounding: 'RUPEE' as const,
    };
    st = { cumBase: D(0), cumTdsBase: D(0) };
    const o2: string[] = [];
    for (const a of [3000000, 4000000, 1000000]) {
      const r = m.computeTds(D(a), q, st);
      o2.push(r.tds.toFixed(0));
      st = { cumBase: r.cumBaseAfter, cumTdsBase: r.cumTdsBaseAfter };
    }
    expect(o2).toEqual(['0', '2000', '1000']);
  });
  it('MSME, ITC-180 and evaluation', () => {
    expect(m.msmeDueDate('2026-11-10', 45)).toBe(calc.msmeDueDate('2026-11-10', 45));
    expect(m.msmeDueDate('2026-11-10', null)).toBe('2026-11-25');
    expect(m.msmeInterest(D(100000), D('5.75'), 60).toFixed(2)).toBe('2895.66');
    const r = m.itc180Reverse(
      { cgst: D('445.41'), sgst: D('445.41'), igst: D(0) },
      D(5840),
      D(5840),
    );
    expect([r.cgst.toFixed(2), r.sgst.toFixed(2)]).toEqual(['445.41', '445.41']);
    const o = m.overall(
      { q: D(60), d: D(70), c: D('95.24'), r: D(80) },
      { q: D(40), d: D(30), c: D(20), r: D(10) },
    );
    expect(o.toFixed(4)).toBe('72.0480');
    expect(m.gradeFor(o, D(85), D(70), D(50))).toBe('B');
  });
});
