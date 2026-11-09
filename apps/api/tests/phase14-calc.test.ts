// Phase 14 calculators with hand-worked examples (Schedule II SLM / WDV, extra shift, AS 10 cost, IT block, GST s.18(6)).
import { describe, expect, it } from 'vitest';
import {
  addMonths,
  blockDepreciation,
  bookDepreciation,
  capitalCost,
  gainLoss,
  isHalfRate,
  monthBounds,
  s18_6,
  shiftFactor,
} from '../src/modules/assets/calc';

describe('Schedule II book depreciation', () => {
  it('SLM: 12,00,000 plant, 5 % residual, 15 years, April 2026 (30 of 5,479 life days)', () => {
    // depreciable 11,40,000 x 30 / 5,479 = 6,242.01
    const r = bookDepreciation({
      cost: '1200000',
      residual: '60000',
      method: 'SLM',
      lifeMonths: 180,
      depStart: '2026-04-01',
      ...monthBounds('2026-04'),
      openingAccum: 0,
    });
    expect(r.days).toBe(30);
    expect(r.amount.toFixed(2)).toBe('6242.01');
  });
  it('SLM: a part month starts on the available-for-use date and never goes below the residual', () => {
    const part = bookDepreciation({
      cost: '100000',
      residual: '5000',
      method: 'SLM',
      lifeMonths: 36,
      depStart: '2026-04-16',
      ...monthBounds('2026-04'),
      openingAccum: 0,
    });
    expect(part.days).toBe(15);
    const last = bookDepreciation({
      cost: '100000',
      residual: '5000',
      method: 'SLM',
      lifeMonths: 36,
      depStart: '2026-04-16',
      ...monthBounds('2029-04'),
      openingAccum: '94990',
    });
    expect(last.amount.toFixed(2)).toBe('10.00');
  });
  it('nothing before the asset is available for use', () => {
    const r = bookDepreciation({
      cost: '100000',
      residual: '5000',
      method: 'SLM',
      lifeMonths: 36,
      depStart: '2026-06-01',
      ...monthBounds('2026-04'),
      openingAccum: 0,
    });
    expect(r.amount.toFixed(2)).toBe('0.00');
  });
  it('WDV: 1,00,000, 5 % residual, 10 years: yearly rate 25.8866 %, first full year 25,886.60', () => {
    const r = bookDepreciation({
      cost: '100000',
      residual: '5000',
      method: 'WDV',
      lifeMonths: 120,
      depStart: '2026-04-01',
      from: '2026-04-01',
      to: '2027-03-31',
      openingAccum: 0,
    });
    expect(r.rate.toFixed(4)).toBe('25.8866');
    expect(Number(r.amount.toFixed(2))).toBeCloseTo(25886.6, 0);
  });
  it('extra shift: plant and machinery, 10 double and 5 triple days of 30 give 1.3333; other classes and NESD stay 1', () => {
    expect(shiftFactor('PM', false, { single: 15, double: 10, triple: 5 }, 30).toFixed(4)).toBe(
      '1.3333',
    );
    expect(shiftFactor('PM', true, { single: 15, double: 10, triple: 5 }, 30).toFixed(4)).toBe(
      '1.0000',
    );
    expect(
      shiftFactor('FURNITURE', false, { single: 0, double: 30, triple: 0 }, 30).toFixed(4),
    ).toBe('1.0000');
  });
});

describe('AS 10 cost and GST', () => {
  it('claimed GST stays out of the cost; GST that is not claimed is capitalised', () => {
    const lines = [
      { component: 'BASE', amount: '100000', gst: '18000' },
      { component: 'FREIGHT', amount: '5000', gst: '900' },
    ];
    const ok = capitalCost(lines, true);
    expect(ok.cost.toFixed(2)).toBe('105000.00');
    expect(ok.itcClaim.toFixed(2)).toBe('18900.00');
    const blocked = capitalCost(lines, false);
    expect(blocked.cost.toFixed(2)).toBe('123900.00');
    expect(blocked.itcClaim.toFixed(2)).toBe('0.00');
    expect(
      capitalCost(
        [{ component: 'BASE', amount: '100', gst: '18', gstInCost: true }],
        true,
      ).cost.toFixed(2),
    ).toBe('118.00');
  });
  it('s.18(6): the higher of ITC less 5 points per quarter and the tax on the sale', () => {
    const r = s18_6({ itc: '180000', quarters: 6, taxOnSale: '90000' });
    expect(r.reversal.toFixed(2)).toBe('126000.00');
    expect(r.payable.toFixed(2)).toBe('126000.00');
    expect(r.extra.toFixed(2)).toBe('36000.00');
    const low = s18_6({ itc: '180000', quarters: 6, taxOnSale: '200000' });
    expect(low.payable.toFixed(2)).toBe('200000.00');
    expect(low.extra.toFixed(2)).toBe('0.00');
    expect(s18_6({ itc: '1000', quarters: 25, taxOnSale: '0' }).payable.toFixed(2)).toBe('0.00');
  });
  it('gain or loss on sale', () => {
    expect(gainLoss('120000', '100000').toFixed(2)).toBe('20000.00');
    expect(gainLoss('80000', '100000').toFixed(2)).toBe('-20000.00');
  });
});

describe('Income-tax block', () => {
  it('opening + additions - sale proceeds, half rate on additions put to use under 180 days', () => {
    const r = blockDepreciation({
      opening: '1000000',
      addGe180: '200000',
      addLt180: '100000',
      deletions: '50000',
      ratePct: '15',
    });
    // 11,50,000 x 15 % = 1,72,500; 1,00,000 x 7.5 % = 7,500
    expect(r.depreciation.toFixed(2)).toBe('180000.00');
    expect(r.closing.toFixed(2)).toBe('1070000.00');
  });
  it('a sale larger than the block leaves nothing to depreciate', () => {
    const r = blockDepreciation({
      opening: '100',
      addGe180: '0',
      addLt180: '0',
      deletions: '500',
      ratePct: '15',
    });
    expect(r.depreciation.toFixed(2)).toBe('0.00');
    expect(r.closing.toFixed(2)).toBe('0.00');
  });
  it('the 180-day rule counts from the put-to-use date to the year end', () => {
    expect(isHalfRate('2025-10-04', '2026-03-31')).toBe(true);
    expect(isHalfRate('2025-10-03', '2026-03-31')).toBe(false);
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
  });
});
