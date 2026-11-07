// Phase 8 pure functions with the worked examples of the plan (02d BR-INV-40..44, 59) and the GL leg builder.
import { describe, expect, it } from 'vitest';
import { D } from '../../src/modules/inventory/money';
import { buildLegs } from '../../src/modules/inventory/stock/gl';
import {
  decide,
  eoq,
  reorderLevel,
  roundUp,
  safetyStock,
  sampleSigma,
  zFor,
} from '../../src/modules/inventory/reorder-calc';
import { checkDigitOk, gs1Date, parseGs1 } from '../../src/modules/inventory/scan-service';
import { withinTolerance } from '../../src/modules/inventory/count-service';

describe('reorder maths (BR-INV-40..44)', () => {
  it('sample sigma of [4,6,5,5,5] is 0.707107', () => {
    expect(sampleSigma([4, 6, 5, 5, 5].map(D)).toDecimalPlaces(6).toString()).toBe('0.707107');
  });
  it('z table with interpolation', () => {
    expect(zFor(95).toString()).toBe('1.6449');
    expect(zFor(99.9).toString()).toBe('3.0902');
    expect(zFor(10).toString()).toBe('0');
    expect(zFor(87.5).toDecimalPlaces(4).toString()).toBe('1.159'); // halfway between 85 (1.0364) and 90 (1.2816)
  });
  it('safety stock 3.489 and with lead-time variability 16.815', () => {
    const z = zFor(95);
    const sigma = D('0.707107');
    expect(safetyStock(z, sigma, 9, D(5)).toString()).toBe('3.489');
    expect(safetyStock(z, sigma, 9, D(5), 2).toString()).toBe('16.815');
  });
  it('reorder level 48.489 and EOQ 382.099', () => {
    expect(reorderLevel(D(5), 9, D('3.489')).toString()).toBe('48.489');
    expect(eoq(D(5), D(400), D(20), D(50)).toString()).toBe('382.099');
    expect(eoq(D(5), D(0), D(20), D(50)).toString()).toBe('0');
  });
  it('suggested quantity: ROP/EOQ -> 390, Min/Max -> 175', () => {
    const a = decide({
      method: 'ROP_EOQ',
      minQty: D(0),
      maxQty: D(0),
      multiple: D(10),
      rop: D('48.489'),
      eoq: D('382.099'),
      position: D(20),
      available: D(20),
    });
    expect(a).toMatchObject({ triggered: true, status: 'Reorder Now' });
    expect(a.suggested.toString()).toBe('390');
    const b = decide({
      method: 'MIN_MAX',
      minQty: D(50),
      maxQty: D(200),
      multiple: D(25),
      rop: D(0),
      eoq: D(0),
      position: D(30),
      available: D(30),
    });
    expect(b.suggested.toString()).toBe('175');
    expect(
      decide({
        method: 'MIN_MAX',
        minQty: D(50),
        maxQty: D(200),
        multiple: D(25),
        rop: D(0),
        eoq: D(0),
        position: D(60),
        available: D(60),
      }).status,
    ).toBe('Reorder Soon');
    expect(
      decide({
        method: 'MIN_MAX',
        minQty: D(50),
        maxQty: D(200),
        multiple: D(25),
        rop: D(0),
        eoq: D(0),
        position: D(0),
        available: D(0),
      }).status,
    ).toBe('Stock-out');
    expect(roundUp(D(171), D(10)).toString()).toBe('180');
  });
});

describe('count tolerance (BR-INV-32)', () => {
  it('200 system, 2% = 4 units: a difference of 5 needs a recount even though 5 x 100 = 500 <= 500', () => {
    expect(withinTolerance(D(200), D(205), D(2), D(500), D(100))).toBe(false);
    expect(withinTolerance(D(200), D(204), D(2), D(500), D(100))).toBe(true);
    expect(withinTolerance(D(0), D(1), D(2), D(500), D(1))).toBe(false);
    expect(withinTolerance(D(0), D(0), D(2), D(500), D(1))).toBe(true);
  });
});

describe('barcodes (BR-INV-59)', () => {
  it('check digits: EAN-13, UPC-A, GTIN-14 vectors', () => {
    expect(checkDigitOk('4006381333931')).toBe(true);
    expect(checkDigitOk('614141123452')).toBe(true);
    expect(checkDigitOk('09506000134352')).toBe(true);
    expect(checkDigitOk('4006381333932')).toBe(false);
    expect(checkDigitOk('12')).toBe(false);
  });
  it('GS1 dates: YY pivot at 50, DD 00 = last day, bad month invalid', () => {
    expect(gs1Date('261231')).toBe('2026-12-31');
    expect(gs1Date('510101')).toBe('1951-01-01');
    expect(gs1Date('260200')).toBe('2026-02-28');
    expect(gs1Date('241300')).toBeNull();
    expect(gs1Date('260231')).toBeNull();
  });
  it('human and machine GS1 element strings', () => {
    const human = parseGs1('(01)09506000134352(17)261231(10)LOT123');
    expect(human).toEqual({ gtin: '09506000134352', expiry: '2026-12-31', batch: 'LOT123' });
    const machine = parseGs1('01095060001343521726123110LOT123');
    expect(machine).toEqual({ gtin: '09506000134352', expiry: '2026-12-31', batch: 'LOT123' });
    const withGs = parseGs1(
      '1012345\u001d21SN99'
        .replace(/^/, '01095060001343521726123110')
        .replace('10' + '12345', '12345'),
    );
    expect(withGs?.gtin).toBe('09506000134352');
    expect(parseGs1('hello')).toBeNull();
    expect(() => parseGs1('(91)ABC')).toThrow(/Unsupported AI 91/);
  });
});

describe('GL legs (stock -> journal)', () => {
  const key = (t: string) => (t === 'Finished Good' ? 'INVENTORY_FG' : 'INVENTORY_RM');
  it('a receipt debits each inventory account and credits GRIR with the balance; every unit balances', () => {
    const legs = buildLegs(
      [
        { unitId: 'u1', inflow: true, value: D(1000), itemType: 'Raw Material', isTransit: false },
        { unitId: 'u1', inflow: true, value: D(1000), itemType: 'Finished Good', isTransit: false },
      ],
      key,
      'GRIR',
    );
    expect(legs.map((l) => [l.key, l.debit.toString(), l.credit.toString()])).toEqual([
      ['INVENTORY_RM', '1000', '0'],
      ['INVENTORY_FG', '1000', '0'],
      ['GRIR', '0', '2000'],
    ]);
  });
  it('a cross-unit transfer receipt balances each unit through inter-unit clearing', () => {
    const legs = buildLegs(
      [
        { unitId: 'A', inflow: false, value: D(-200), itemType: 'Raw Material', isTransit: true },
        { unitId: 'B', inflow: true, value: D(200), itemType: 'Raw Material', isTransit: false },
      ],
      key,
      'INTER_UNIT_CLEARING',
    );
    const net = (u: string) =>
      legs.filter((l) => l.unitId === u).reduce((a, l) => a.plus(l.debit).minus(l.credit), D(0));
    expect(net('A').toString()).toBe('0');
    expect(net('B').toString()).toBe('0');
    expect(legs.find((l) => l.unitId === 'A' && l.key === 'STOCK_IN_TRANSIT')).toBeDefined();
  });
});
