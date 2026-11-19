import { describe, expect, it } from 'vitest';
import { fieldRuleError, inferFieldKind, isIsoDate } from './validators';

describe('shared form rules (ERP-VAL-02)', () => {
  it('infers the kind of a field from its label', () => {
    expect(inferFieldKind('Purchase Date')).toBe('date');
    expect(inferFieldKind('Transit Status')).toBe('status');
    expect(inferFieldKind('GSTIN')).toBe('gstin');
    expect(inferFieldKind('Mobile No')).toBe('mobile');
    expect(inferFieldKind('Quantity')).toBe('quantity');
    expect(inferFieldKind('Service Cost')).toBe('number');
    expect(inferFieldKind('City')).toBe('place');
  });
  it('blocks blank mandatory fields', () => {
    expect(fieldRuleError({ label: 'Name', kind: 'name', required: true }, '  ')).toBe(
      'Name is required.',
    );
    expect(fieldRuleError({ label: 'Name', kind: 'name', required: false }, '')).toBeUndefined();
  });
  it('checks dates, statuses, numbers, GSTIN, PAN and mobile', () => {
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(
      fieldRuleError({ label: 'Date', kind: 'date', required: true }, 'tomorrow'),
    ).toBeDefined();
    expect(
      fieldRuleError({ label: 'Date', kind: 'date', required: true }, '2026-11-19'),
    ).toBeUndefined();
    expect(
      fieldRuleError({ label: 'Status', kind: 'status', required: true }, 'whatever'),
    ).toBeDefined();
    expect(
      fieldRuleError({ label: 'Status', kind: 'status', required: true }, 'In Transit'),
    ).toBeUndefined();
    expect(fieldRuleError({ label: 'Qty', kind: 'quantity', required: true }, '-3')).toMatch(
      /negative/,
    );
    expect(fieldRuleError({ label: 'Qty', kind: 'quantity', required: true }, 'abc')).toMatch(
      /number/,
    );
    expect(
      fieldRuleError({ label: 'GSTIN', kind: 'gstin', required: true }, '22AAAAA0000A1Z5'),
    ).toBeUndefined();
    expect(
      fieldRuleError({ label: 'GSTIN', kind: 'gstin', required: true }, '22AAAAA'),
    ).toBeDefined();
    expect(
      fieldRuleError({ label: 'PAN', kind: 'pan', required: true }, 'ABCDE1234F'),
    ).toBeUndefined();
    expect(
      fieldRuleError({ label: 'Mobile', kind: 'mobile', required: true }, '98765'),
    ).toBeDefined();
    expect(
      fieldRuleError({ label: 'Mobile', kind: 'mobile', required: true }, '9876543210'),
    ).toBeUndefined();
  });
});
