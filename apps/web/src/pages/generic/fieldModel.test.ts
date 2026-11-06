// Unit tests for the pure schema helpers: tab list, register pick, phases, validation, payloads.
import { describe, expect, it } from 'vitest';
import { LEAD_SCHEMA, leadRow } from '../../test/engine-fixtures';
import type { FieldMeta } from './engineApi';
import {
  canChangeRecord,
  changedPayload,
  confirmText,
  displayValue,
  moduleTabs,
  phaseForTab,
  registerTabName,
  toPayload,
  validateField,
} from './fieldModel';

const f = (over: Partial<FieldMeta>): FieldMeta => ({
  key: 'x',
  label: 'X',
  type: 'text',
  required: false,
  readOnly: false,
  ...over,
});

describe('tabs', () => {
  it('has 16 tabs in the prototype order', () => {
    const tabs = moduleTabs(LEAD_SCHEMA);
    expect(tabs).toHaveLength(16);
    expect(tabs[0]).toBe('Module Dashboard');
    expect(tabs.slice(7)).toEqual([
      'Analytics & Graphs',
      'AI Decision Center',
      'Automation Studio',
      'Data Quality',
      'Activity Timeline',
      'Documents',
      'Approvals',
      'Reports',
      'Audit Trail',
    ]);
  });

  it('picks the register tab by label, else the first profile tab', () => {
    expect(registerTabName({ tabs: ['Overview', 'Item Master', 'Rates'] })).toBe('Item Master');
    expect(registerTabName({ tabs: ['Overview', 'Rates'] })).toBe('Overview');
    expect(registerTabName({ tabs: ['A', 'Open Queue'] })).toBe('Open Queue');
  });

  it('maps tabs to roadmap phases', () => {
    expect(phaseForTab('Approvals', 'CRM')).toBe(5);
    expect(phaseForTab('Documents', 'CRM')).toBe(8);
    expect(phaseForTab('AI Decision Center', 'CRM')).toBe(19);
    expect(phaseForTab('Lead Scoring', 'CRM')).toBe(10);
    expect(phaseForTab('Costing', 'Finance & Accounts')).toBe(7);
    expect(phaseForTab('Shifts', 'Payroll')).toBe(16);
  });
});

describe('validateField', () => {
  it('checks required, GSTIN, PAN, IFSC, email, HSN and numbers', () => {
    expect(validateField(f({ required: true, label: 'Name' }), '  ')).toBe('Name is required.');
    expect(validateField(f({ type: 'gstin' }), '27ABCDE1234F1Z5')).toBeUndefined();
    expect(validateField(f({ type: 'gstin' }), '27ABC')).toMatch(/GSTIN must be/);
    expect(validateField(f({ type: 'pan' }), 'ABCDE1234F')).toBeUndefined();
    expect(validateField(f({ type: 'pan' }), 'abc')).toMatch(/PAN must/);
    expect(validateField(f({ type: 'ifsc' }), 'HDFC0001234')).toBeUndefined();
    expect(validateField(f({ type: 'ifsc' }), 'HDFC1')).toMatch(/IFSC/);
    expect(validateField(f({ type: 'email' }), 'a@b')).toMatch(/valid email/);
    expect(validateField(f({ type: 'hsn' }), '7208')).toBeUndefined();
    expect(validateField(f({ type: 'hsn' }), '72')).toMatch(/4, 6 or 8/);
    expect(validateField(f({ type: 'money', min: 0 }), '-1')).toBe('Must be at least 0.');
    expect(validateField(f({ type: 'pct' }), '120')).toMatch(/0 and 100/);
    expect(validateField(f({ type: 'qty' }), 'abc')).toBe('Enter a number.');
    expect(validateField(f({ type: 'enum', options: ['A'] }), 'B')).toMatch(/Choose one/);
    expect(validateField(f({ maxLength: 3 }), 'abcd')).toBe('At most 3 characters.');
    expect(validateField(f({ readOnly: true, required: true }), '')).toBeUndefined();
  });
});

describe('payloads and display', () => {
  it('converts numbers, drops empties and keeps booleans', () => {
    const fields = LEAD_SCHEMA.fields;
    expect(
      toPayload(fields, { leadName: ' Neha ', expectedValue: '10.5', company: '', consent: false }),
    ).toEqual({ leadName: 'Neha', expectedValue: 10.5, consent: false });
  });

  it('PATCH carries only changes, nulling cleared fields and ignoring an untouched checkbox', () => {
    const row = leadRow(1);
    const values = {
      leadName: 'Lead 1',
      company: '',
      stage: 'New',
      expectedValue: '1000.5',
      nextFollowUp: '2026-12-05',
      consent: false,
    };
    expect(changedPayload(LEAD_SCHEMA.fields, values, row)).toEqual({ company: null });
  });

  it('formats money, percent, dates, booleans and empties', () => {
    const row = leadRow(1, { data: { expectedValue: 1234567.5, discount: 12, consent: true } });
    const field = (k: string): FieldMeta =>
      LEAD_SCHEMA.fields.find((x) => x.key === k) as FieldMeta;
    expect(displayValue(row, field('expectedValue'))).toBe('₹ 12,34,567.5');
    expect(displayValue(row, field('discount'))).toBe('12%');
    expect(displayValue(row, field('consent'))).toBe('Yes');
    expect(displayValue(row, field('company'))).toBe('—');
    expect(displayValue(row, field('leadNo'))).toBe(row.code);
  });

  it('locks typed vouchers once they leave Draft', () => {
    const typed = {
      ...LEAD_SCHEMA,
      kind: 'typed' as const,
      actions: [{ key: 'post', label: 'Post' }],
    };
    expect(canChangeRecord(typed, leadRow(1, { status: 'Draft' }))).toBe(true);
    expect(canChangeRecord(typed, leadRow(1, { status: 'Posted' }))).toBe(false);
    expect(canChangeRecord(LEAD_SCHEMA, leadRow(1, { status: 'Posted' }))).toBe(true);
    expect(canChangeRecord({ ...LEAD_SCHEMA, readOnly: true }, leadRow(1))).toBe(false);
  });

  it('confirmText fills {code} or builds a generic question', () => {
    expect(confirmText({ label: 'Post', confirm: 'Post {code}?' }, 'A/1')).toBe('Post A/1?');
    expect(confirmText({ label: 'Cancel', confirm: true }, 'A/1')).toBe('Cancel A/1?');
    expect(confirmText({ label: 'Cancel' }, 'A/1')).toBeNull();
  });
});
