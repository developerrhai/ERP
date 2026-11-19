import { describe, expect, it } from 'vitest';
import { columnsBody, cleanValues, listKindParam, listValuesBody } from './page-prefs';

describe('settings tab lists', () => {
  it('trims, collapses spaces and drops case-insensitive duplicates, keeping the first spelling', () => {
    expect(cleanValues([' Acme  Steel ', 'acme steel', '', 'Bolt'])).toEqual(['Acme Steel', 'Bolt']);
  });
  it('accepts only the four list kinds', () => {
    for (const kind of ['item', 'category', 'vendor', 'manufacturer']) expect(listKindParam.safeParse({ kind }).success).toBe(true);
    expect(listKindParam.safeParse({ kind: 'customer' }).success).toBe(false);
  });
  it('rejects blank or oversize entries and bad column payloads', () => {
    expect(listValuesBody.safeParse({ values: ['ok'] }).success).toBe(true);
    expect(listValuesBody.safeParse({ values: ['  '] }).success).toBe(false);
    expect(listValuesBody.safeParse({ values: ['x'.repeat(121)] }).success).toBe(false);
    expect(columnsBody.safeParse({ hidden: { 'scm-po': ['status'] } }).success).toBe(true);
    expect(columnsBody.safeParse({ hidden: { 'scm-po': 'status' } }).success).toBe(false);
  });
});
