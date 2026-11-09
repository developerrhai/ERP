// Phase 13 spec section 5 worked examples, checked to the paisa with the pure calculators (no database).
import { describe, expect, it } from 'vitest';
import {
  absorbed,
  detectCycle,
  explode,
  fgCost,
  lineRequirement,
  lotSize,
  lowLevelCodes,
  mrpNet,
  oee,
  variances,
  wipShare,
} from '../src/modules/mfg/calc';
import type { BomIn, BomLineIn, Planning } from '../src/modules/mfg/calc';

const line = (itemId: string, qty: string, extra: Partial<BomLineIn> = {}): BomLineIn => ({
  itemId,
  qtyPerBase: qty,
  conversionFactor: '1',
  scrapPct: '0',
  isPhantom: false,
  effectiveFrom: null,
  effectiveTo: null,
  issueMethod: 'MANUAL',
  operationSeq: null,
  ...extra,
});
const motorBoms = (): Map<string, BomIn> =>
  new Map([
    ['MOTOR', { itemId: 'MOTOR', baseQty: '1', lines: [line('STATOR', '1', { isPhantom: true })] }],
    [
      'STATOR',
      {
        itemId: 'STATOR',
        baseQty: '1',
        lines: [line('WIRE', '0.800', { scrapPct: '2.5' }), line('STACK', '1')],
      },
    ],
  ]);

describe('BOM explosion (spec: 100 motors, copper wire 82.000 kg)', () => {
  it('explodes a phantom stator straight through to its components', () => {
    const r = explode('MOTOR', 100, '2026-11-10', motorBoms());
    const by = Object.fromEntries(r.map((x) => [x.itemId, x.qty]));
    expect(by).toEqual({ WIRE: '82.000', STACK: '100.000' });
  });
  it('rounds half-up to 3 decimals and applies unit conversion and base quantity', () => {
    expect(lineRequirement(1, 3, { qtyPerBase: '1', conversionFactor: '1', scrapPct: '0' }).toFixed(3)).toBe('0.333');
    expect(lineRequirement(2, 3, { qtyPerBase: '1', conversionFactor: '1', scrapPct: '0' }).toFixed(3)).toBe('0.667');
    expect(lineRequirement(10, 4, { qtyPerBase: '2', conversionFactor: '0.5', scrapPct: '10' }).toFixed(3)).toBe('2.750');
  });
  it('keeps only the lines valid on the date', () => {
    const boms = new Map<string, BomIn>([
      [
        'A',
        {
          itemId: 'A',
          baseQty: '1',
          lines: [
            line('OLD', '1', { effectiveTo: '2026-06-30' }),
            line('NEW', '1', { effectiveFrom: '2026-07-01' }),
          ],
        },
      ],
    ]);
    expect(explode('A', 1, '2026-08-01', boms).map((x) => x.itemId)).toEqual(['NEW']);
    expect(explode('A', 1, '2026-05-01', boms).map((x) => x.itemId)).toEqual(['OLD']);
  });
  it('a real (non-phantom) sub-assembly stays a requirement of its own', () => {
    const boms = motorBoms();
    boms.set('MOTOR', { itemId: 'MOTOR', baseQty: '1', lines: [line('STATOR', '1')] });
    expect(explode('MOTOR', 5, '2026-11-10', boms).map((x) => [x.itemId, x.qty])).toEqual([['STATOR', '5.000']]);
  });
  it('rejects a loop and names the path', () => {
    const boms = new Map<string, BomIn>([
      ['A', { itemId: 'A', baseQty: '1', lines: [line('B', '1')] }],
      ['B', { itemId: 'B', baseQty: '1', lines: [line('A', '1')] }],
    ]);
    expect(detectCycle(boms)).toEqual(['A', 'B', 'A']);
    // through phantom lines the explosion itself meets the loop
    const ph = new Map<string, BomIn>([
      ['A', { itemId: 'A', baseQty: '1', lines: [line('B', '1', { isPhantom: true })] }],
      ['B', { itemId: 'B', baseQty: '1', lines: [line('A', '1', { isPhantom: true })] }],
    ]);
    expect(() => explode('A', 1, '2026-11-10', ph)).toThrow(/BOM_CYCLE:A > B > A/);
    expect(() => lowLevelCodes(boms)).toThrow(/BOM_CYCLE/);
  });
  it('low-level codes: the deepest level at which an item appears', () => {
    const boms = motorBoms();
    boms.set('MOTOR', {
      itemId: 'MOTOR',
      baseQty: '1',
      lines: [line('STATOR', '1', { isPhantom: true }), line('WIRE', '2')],
    });
    const llc = lowLevelCodes(boms);
    expect(llc.get('MOTOR')).toBe(0);
    expect(llc.get('STATOR')).toBe(1);
    expect(llc.get('WIRE')).toBe(2); // under the stator it is level 2, even though the motor uses it directly too
    expect(llc.get('STACK')).toBe(2);
  });
});

describe('MRP netting (spec: stator, lead time 2 weeks, safety stock 50, on hand 300)', () => {
  const planning = (extra: Partial<Planning> = {}): Planning => ({
    leadTimeDays: 14,
    safetyStock: '50',
    lotSizing: 'LFL',
    fixedLotQty: null,
    minOrderQty: null,
    orderMultiple: null,
    eoq: null,
    ...extra,
  });
  const weeks = [
    { bucket: '2026-12-07', gross: '150', receipts: '0' },
    { bucket: '2026-12-14', gross: '250', receipts: '200' },
    { bucket: '2026-12-21', gross: '300', receipts: '0' },
    { bucket: '2026-12-28', gross: '200', receipts: '0' },
  ];
  it('lot-for-lot reproduces the table', () => {
    const r = mrpNet('300', weeks, planning(), '2026-12-01');
    expect(r.map((x) => x.pohBefore)).toEqual(['150.000', '100.000', '-200.000', '-150.000']);
    expect(r.map((x) => x.net)).toEqual(['0.000', '0.000', '250.000', '200.000']);
    expect(r.map((x) => x.plannedReceipt)).toEqual(['0.000', '0.000', '250.000', '200.000']);
    expect(r.map((x) => x.pohAfter)).toEqual(['150.000', '100.000', '50.000', '50.000']);
    // released two weeks before the receipt
    expect(r[2]!.releaseDate).toBe('2026-12-07');
    expect(r[3]!.releaseDate).toBe('2026-12-14');
    expect(r.some((x) => x.pastDueRelease)).toBe(false);
  });
  it('fixed lots of 500: week 3 receives 500 and week 4 needs no order', () => {
    const r = mrpNet('300', weeks, planning({ lotSizing: 'FIXED', fixedLotQty: '500' }), '2026-12-01');
    expect(r[2]!.plannedReceipt).toBe('500.000');
    expect(r[2]!.pohAfter).toBe('300.000');
    expect(r[3]!.pohBefore).toBe('100.000');
    expect(r[3]!.plannedReceipt).toBe('0.000');
  });
  it('a release date in the past is flagged', () => {
    const r = mrpNet('300', weeks, planning(), '2026-12-10');
    expect(r[2]!.pastDueRelease).toBe(true);
  });
  it('lot sizing: lot-for-lot, fixed, EOQ, minimum order quantity, order multiple', () => {
    const p = (extra: Partial<Planning>) => planning(extra);
    expect(lotSize('250', p({})).toFixed(3)).toBe('250.000');
    expect(lotSize('250', p({ lotSizing: 'FIXED', fixedLotQty: '100' })).toFixed(3)).toBe('300.000');
    expect(lotSize('250', p({ lotSizing: 'EOQ', eoq: '400' })).toFixed(3)).toBe('400.000');
    expect(lotSize('250', p({ lotSizing: 'EOQ', eoq: '100' })).toFixed(3)).toBe('250.000');
    expect(lotSize('30', p({ minOrderQty: '100' })).toFixed(3)).toBe('100.000');
    expect(lotSize('101', p({ orderMultiple: '25' })).toFixed(3)).toBe('125.000');
    expect(lotSize('0', p({})).toFixed(3)).toBe('0.000');
  });
});

describe('OEE (spec: 480 min shift, 30 break, 45 breakdown, ideal 0.5, 720 pcs, 700 good)', () => {
  it('A x P x Q = 0.7778', () => {
    const r = oee({
      shiftMinutes: 480,
      plannedDowntimeMinutes: 30,
      unplannedDowntimeMinutes: 45,
      idealCycleMinutes: '0.5',
      totalPieces: 720,
      goodPieces: 700,
    });
    expect(r).toMatchObject({ availability: '0.9000', performance: '0.8889', quality: '0.9722', oee: '0.7778', cycleTimeSuspect: false });
  });
  it('performance is capped at 1 and the cycle time is flagged', () => {
    const r = oee({
      shiftMinutes: 480,
      plannedDowntimeMinutes: 0,
      unplannedDowntimeMinutes: 0,
      idealCycleMinutes: '1',
      totalPieces: 600,
      goodPieces: 600,
    });
    expect(r.performance).toBe('1.0000');
    expect(r.cycleTimeSuspect).toBe(true);
  });
});

describe('cost of the worked order of 100 motors', () => {
  it('abnormal scrap 2 x (4,87,000 / 100) = 9,740 and FG 98 pcs = 4,76,760 (4,864.90 each)', () => {
    const material = 450000 - 5000 + 2000; // issue, return of copper, back-flushed consumables
    const labour = absorbed(40, 300); // 40 h x 300
    const overhead = absorbed(40, 700);
    expect(labour.toFixed(2)).toBe('12000.00');
    expect(overhead.toFixed(2)).toBe('28000.00');
    const wipBeforeScrap = material + 12000 + 28000;
    expect(wipBeforeScrap).toBe(487000);
    const abnormal = (2 * wipBeforeScrap) / 100;
    expect(abnormal).toBe(9740);
    const r = fgCost({ material, labour: '12000', overhead: '28000', abnormalScrap: abnormal, recovery: 500, goodQty: 98 });
    expect(r.total).toBe('476760.00');
    expect(r.unitCost).toBe('4864.90');
  });
  it('a partial receipt takes its share of the WIP and the last piece takes the exact balance', () => {
    expect(wipShare('476760', 49, 98).toFixed(2)).toBe('238380.00');
    expect(wipShare('238380', 49, 49).toFixed(2)).toBe('238380.00');
    expect(wipShare('100', 3, 3).toFixed(2)).toBe('100.00');
    expect(wipShare('100', 1, 3).toFixed(2)).toBe('33.33');
  });
  it('variances', () => {
    const v = variances({
      actualQty: 105,
      standardQty: 100,
      standardRate: 10,
      actualRate: 11,
      actualHours: 42,
      standardHours: 40,
      hourRate: 300,
      standardInput: 100,
      actualOutput: 98,
    });
    expect(v.materialUsage).toBe('50.00');
    expect(v.materialPrice).toBe('105.00');
    expect(v.efficiency).toBe('600.00');
    expect(v.yield).toBe('1.0204');
  });
});
