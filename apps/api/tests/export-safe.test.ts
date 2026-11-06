// Export safety: spreadsheet formula injection is neutralised in every text cell (xlsx + CSV).
import { describe, expect, it } from 'vitest';
import { buildCsv, safeCell } from '../src/modules/records/export';
import { buildPageSchema } from '../src/engine/field-schema';
import type { RecordRow } from '../src/modules/records/repository';

describe('safeCell', () => {
  it.each(['=1+1', '+SUM(A1)', '-2+3', '@cmd', '\t=1', '\r=1'])('prefixes %j', (v) => {
    expect(safeCell(v)).toBe(`'${v}`);
  });
  it.each(['Acme', '1+1', 'a=b', ' =x'])('leaves %j alone', (v) => {
    expect(safeCell(v)).toBe(v);
  });
});

describe('buildCsv', () => {
  const schema = buildPageSchema('crm-leads');
  if (!schema) throw new Error('crm-leads schema missing');
  const row = (data: Record<string, unknown>): RecordRow =>
    ({
      id: 'x',
      pageId: 'crm-leads',
      code: 'LEA/TAL/26-27/00001',
      status: 'Draft',
      unitId: 'u',
      unitCode: 'TAL',
      fyId: 'f',
      fyCode: '2026-27',
      fyStatus: 'OPEN',
      department: 'Sales',
      data,
      version: 1,
      amount: null,
      createdById: 'c',
      createdByName: 'C',
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    }) as RecordRow;

  it('starts with a BOM, quotes commas / quotes / newlines and keeps Hindi text', () => {
    const csv = buildCsv(schema, [row({ leadName: 'रेडी, "हँड"\nline2', company: '=cmd' })]);
    expect([...csv.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = csv.toString('utf8');
    expect(text).toContain('"रेडी, ""हँड""\nline2"');
    expect(text).toContain("'=cmd");
    expect(text.endsWith('\r\n')).toBe(true);
  });
});
