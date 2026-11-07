// Phase 06 pure rules (docs/phases/PHASE-06.md §10): GSTIN / PAN worked examples, formats, name
// normalisation, place of supply, payment schedule and the price-slab picker. No database needed.
import { describe, expect, it } from 'vitest';
import { gstinCheckChar } from '../src/engine/validators';
import {
  MESSAGES,
  checkPartyIdentity,
  checkTermsSum,
  isHsn,
  isIfsc,
  isUdyam,
  netRate,
  normaliseGstin,
  normaliseName,
  paymentSchedule,
  pickPriceRow,
  placeOfSupply,
  validateGstin,
  validatePan,
} from '../src/modules/masters/party-rules';

// State codes known to the GST system in the starter list: 01-24, 26, 27, 29-38 (25 retired, 28 not used), 96, 97, 99.
const STATES = new Set<string>([
  ...Array.from({ length: 24 }, (_, i) => String(i + 1).padStart(2, '0')),
  '26',
  '27',
  ...Array.from({ length: 10 }, (_, i) => String(i + 29)),
  '96',
  '97',
  '99',
]);
const NAMES = new Map([['27', 'Maharashtra']]);

describe('GSTIN', () => {
  it('27AAPFU0939F1ZV is valid and decodes to state 27 and PAN AAPFU0939F', () => {
    const r = validateGstin('27AAPFU0939F1ZV', STATES);
    expect(r).toEqual({ ok: true, gstin: '27AAPFU0939F1ZV', stateCode: '27', pan: 'AAPFU0939F' });
  });

  it('the check character is computed step by step: terms 2,14,10,20,25,30,30,0,9,6,9,30,1,35 sum to 221 -> V', () => {
    const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const first14 = '27AAPFU0939F1Z';
    const terms = [...first14].map((c, i) => {
      const p = chars.indexOf(c) * (i % 2 === 0 ? 1 : 2);
      return Math.floor(p / 36) + (p % 36);
    });
    expect(terms).toEqual([2, 14, 10, 20, 25, 30, 30, 0, 9, 6, 9, 30, 1, 35]);
    const sum = terms.reduce((a, b) => a + b, 0);
    expect(sum).toBe(221);
    expect(sum % 36).toBe(5);
    expect((36 - 5) % 36).toBe(31);
    expect(chars[31]).toBe('V');
    expect(gstinCheckChar(first14)).toBe('V');
  });

  it('a wrong last character is a typing mistake', () => {
    const r = validateGstin('27AAPFU0939F1ZO', STATES);
    expect(r).toMatchObject({
      ok: false,
      code: 'GSTIN_CHECKSUM',
      message: MESSAGES.GSTIN_CHECKSUM,
    });
  });

  it('the 14th character must be Z', () => {
    const r = validateGstin('27AAPFU0939F1XV', STATES);
    expect(r).toMatchObject({ ok: false, code: 'GSTIN_FORMAT' });
  });

  it('length 14 is refused with the length message', () => {
    const r = validateGstin('27AAPFU0939F1Z', STATES);
    expect(r).toMatchObject({
      ok: false,
      code: 'GSTIN_LENGTH',
      message: 'GSTIN must be exactly 15 characters.',
    });
  });

  it('the retired state code 25 is not a valid state', () => {
    const first14 = '25AAPFU0939F1Z';
    const r = validateGstin(first14 + gstinCheckChar(first14), STATES);
    expect(r).toMatchObject({ ok: false, code: 'GSTIN_STATE', message: MESSAGES.GSTIN_STATE });
  });

  it('lower case with spaces is normalised', () => {
    expect(normaliseGstin(' 27 aapfu0939f1zv ')).toBe('27AAPFU0939F1ZV');
    expect(validateGstin(' 27 aapfu0939f1zv ', STATES).ok).toBe(true);
  });
});

describe('PAN, Udyam, IFSC, HSN', () => {
  it('AAPFU0939F is valid (holder type F = Firm / LLP)', () => {
    expect(validatePan('AAPFU0939F')).toEqual({
      ok: true,
      pan: 'AAPFU0939F',
      holder: 'Firm / LLP',
    });
  });
  it.each(['AAPXU0939F', 'AAPF0939F1'])('%s is refused', (pan) => {
    expect(validatePan(pan)).toMatchObject({
      ok: false,
      code: 'PAN_FORMAT',
      message: MESSAGES.PAN_FORMAT,
    });
  });
  it('Udyam, IFSC and HSN formats', () => {
    expect(isUdyam('UDYAM-MH-26-0012345')).toBe(true);
    expect(isUdyam('UDYAM-MH-26-12345')).toBe(false);
    expect(isIfsc('HDFC0001234')).toBe(true);
    expect(isIfsc('HDFC1001234')).toBe(false);
    expect(isHsn('8480')).toBe(true);
    expect(isHsn('848')).toBe(false);
    expect(isHsn('84801234')).toBe(true);
  });
});

describe('party identity consistency', () => {
  it('fills the PAN and the state from a valid GSTIN', () => {
    const r = checkPartyIdentity(
      { gstRegistrationType: 'REGULAR', gstin: '27AAPFU0939F1ZV' },
      STATES,
      NAMES,
    );
    expect(r.errors).toEqual({});
    expect(r.derived).toEqual({ pan: 'AAPFU0939F', stateCode: '27' });
  });
  it('PAN must match characters 3-12 of the GSTIN; state must match the first two digits', () => {
    const r = checkPartyIdentity(
      {
        gstRegistrationType: 'REGULAR',
        gstin: '27AAPFU0939F1ZV',
        pan: 'ABCPE1234F',
        stateCode: '24',
      },
      STATES,
      NAMES,
    );
    expect(r.errors.pan?.message).toBe('PAN must match characters 3–12 of the GSTIN (AAPFU0939F).');
    expect(r.errors.stateCode?.message).toBe(
      'State must be Maharashtra because the GSTIN starts with 27.',
    );
  });
  it('Regular needs a GSTIN; Unregistered / Overseas must not have one', () => {
    expect(
      checkPartyIdentity({ gstRegistrationType: 'REGULAR' }, STATES, NAMES).errors.gstin?.code,
    ).toBe('GSTIN_REQUIRED');
    expect(
      checkPartyIdentity(
        { gstRegistrationType: 'UNREGISTERED', gstin: '27AAPFU0939F1ZV' },
        STATES,
        NAMES,
      ).errors.gstin?.code,
    ).toBe('GSTIN_NOT_ALLOWED');
    expect(checkPartyIdentity({ gstRegistrationType: 'OVERSEAS' }, STATES, NAMES).errors).toEqual(
      {},
    );
  });
});

describe('normaliseName', () => {
  it('"M/s. Sawant Engg. Pvt. Ltd." -> "sawant engg"', () => {
    expect(normaliseName('M/s. Sawant Engg. Pvt. Ltd.')).toBe('sawant engg');
  });
  it('drops &, and, co and repeated spaces', () => {
    expect(normaliseName('Rao  &  Sons Co. Private Limited')).toBe('rao sons');
  });
});

describe('place of supply', () => {
  const base = { supplierState: '27', billToState: '27', billToRegType: 'REGULAR' as const };
  it('goods to the same state are intra-state (CGST + SGST)', () => {
    expect(placeOfSupply({ ...base, kind: 'GOODS', shipToState: '27' })).toEqual({
      posState: '27',
      regime: 'INTRA',
    });
  });
  it('goods shipped to another state are inter-state (IGST), by the ship-to state', () => {
    expect(placeOfSupply({ ...base, kind: 'GOODS', shipToState: '24' })).toEqual({
      posState: '24',
      regime: 'INTER',
    });
  });
  it('bill-to / ship-to: the bill-to state applies', () => {
    expect(
      placeOfSupply({ ...base, kind: 'GOODS', shipToState: '24', billToShipTo: true }),
    ).toEqual({
      posState: '27',
      regime: 'INTRA',
    });
  });
  it('B2B services use the recipient location', () => {
    expect(placeOfSupply({ ...base, kind: 'SERVICES', billToState: '29' })).toEqual({
      posState: '29',
      regime: 'INTER',
    });
  });
  it('SEZ is always inter-state; overseas is export', () => {
    expect(
      placeOfSupply({ ...base, kind: 'GOODS', shipToState: '27', billToRegType: 'SEZ' }).regime,
    ).toBe('INTER');
    expect(
      placeOfSupply({ ...base, kind: 'GOODS', billToState: '96', billToRegType: 'OVERSEAS' })
        .regime,
    ).toBe('EXPORT');
  });
});

describe('payment terms', () => {
  it('percentages must add up to 100', () => {
    expect(
      checkTermsSum([
        { portionPct: 30, dueBasis: 'ADVANCE', days: 0 },
        { portionPct: 70, dueBasis: 'INVOICE_DATE', days: 30 },
      ]),
    ).toBeNull();
    expect(
      checkTermsSum([
        { portionPct: 30, dueBasis: 'ADVANCE', days: 0 },
        { portionPct: 60, dueBasis: 'INVOICE_DATE', days: 30 },
      ]),
    ).toBe('Instalment percentages must add up to 100 % (now 90 %).');
  });
  it('30 / 70 split of 1000.01: the rounding remainder goes to the last instalment', () => {
    const s = paymentSchedule(
      [
        { portionPct: 30, dueBasis: 'ADVANCE', days: 0 },
        { portionPct: 70, dueBasis: 'INVOICE_DATE', days: 30 },
      ],
      '1000.01',
      '2026-11-06',
    );
    expect(s.map((x) => x.amount)).toEqual(['300.00', '700.01']);
    expect(s.map((x) => x.dueDate)).toEqual(['2026-11-06', '2026-12-06']);
    expect(s.reduce((n, x) => n + Number(x.amount), 0).toFixed(2)).toBe('1000.01');
  });
  it('end of invoice month + days', () => {
    const s = paymentSchedule(
      [{ portionPct: 100, dueBasis: 'END_OF_INVOICE_MONTH', days: 15 }],
      100,
      '2026-02-10',
    );
    expect(s[0]?.dueDate).toBe('2026-03-15');
  });
});

describe('price slabs', () => {
  const row = (
    id: string,
    minQty: number,
    rate: number,
    validFrom: string | null = null,
    validTo: string | null = null,
  ) => ({
    id,
    itemId: 'i1',
    uomCode: 'NOS',
    minQty,
    rate,
    discountPct: 0,
    validFrom,
    validTo,
  });
  const rows = [row('a', 0, 100), row('b', 100, 90), row('c', 500, 80)];
  it.each([
    [99, 'a'],
    [100, 'b'],
    [1000, 'c'],
  ])('qty %i uses slab %s', (qty, id) => {
    expect(pickPriceRow(rows, qty, '2026-11-06')?.id).toBe(id);
  });
  it('an expired row is ignored', () => {
    expect(
      pickPriceRow([row('old', 0, 50, null, '2026-01-31'), row('a', 0, 100)], 1, '2026-11-06')?.id,
    ).toBe('a');
  });
  it('a tie on min_qty goes to the latest valid_from', () => {
    const r = pickPriceRow(
      [row('x', 0, 100, '2026-01-01'), row('y', 0, 95, '2026-06-01')],
      1,
      '2026-11-06',
    );
    expect(r?.id).toBe('y');
  });
  it('net = rate x (1 - discount / 100)', () => {
    expect(netRate(90, 10)).toBe('81');
    expect(netRate('123.456789', 0)).toBe('123.456789');
  });
});
