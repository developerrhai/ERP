// Phase 22: the value cleaning of the generic screen forms (pure; no database).
import { describe, expect, it } from 'vitest';
import { AppError } from '../src/core/http/errors';
import type { FormField } from '../src/modules/screens/configs';
import { cleanValues } from '../src/modules/screens/forms';

const F: FormField[] = [
  { key: 'code', label: 'Rack Code', column: 'code', type: 'text', required: true, maxLength: 5, editable: false },
  { key: 'levels', label: 'Levels', column: 'levels', type: 'int', min: 1, default: 1 },
  { key: 'load', label: 'Max Load', column: 'max_load_kg', type: 'number', min: 0 },
  { key: 'type', label: 'Rack Type', column: 'rack_type', type: 'select', options: ['Selective', 'Mezzanine'], default: 'Selective' },
  { key: 'on', label: 'Active', column: 'active', type: 'bool', default: false },
  { key: 'day', label: 'Planned Date', column: 'planned_date', type: 'date' },
  { key: 'zone', label: 'Zone', column: 'zone_id', type: 'lookup', lookup: 'zones' },
];

function fieldsOf(fn: () => unknown): Record<string, string> {
  try {
    fn();
  } catch (e) {
    return (e as AppError).fields ?? {};
  }
  return {};
}

describe('cleanValues', () => {
  it('applies defaults, trims text and keeps numbers as exact strings', () => {
    const v = cleanValues(F, { code: '  R-01 ', load: 1250.5 }, 'create');
    expect(v).toEqual({ code: 'R-01', levels: '1', load: '1250.5', type: 'Selective', on: false });
  });

  it('says what is wrong, field by field, in plain English', () => {
    const e = fieldsOf(() =>
      cleanValues(F, { levels: '0', load: 'abc', type: 'Pallet', day: '31-12-2026', zone: 'x', code: 'TOOLONG' }, 'create'),
    );
    expect(e.levels).toBe('Enter 1 or more.');
    expect(e.load).toBe('Enter a number like 12.5.');
    expect(e.type).toBe('Choose one of the listed values.');
    expect(e.day).toBe('Use a date like 2026-11-30.');
    expect(e.zone).toBe('Pick one from the list.');
    expect(e.code).toBe('That is too long.');
  });

  it('requires the required fields on create but not on a partial edit', () => {
    expect(fieldsOf(() => cleanValues(F, {}, 'create')).code).toBe('Rack Code is required.');
    expect(cleanValues(F, { levels: 2 }, 'edit')).toEqual({ levels: '2' });
  });

  it('never lets an edit change a fixed field (the code)', () => {
    expect(cleanValues(F, { code: 'NEW', levels: 3 }, 'edit')).toEqual({ levels: '3' });
  });

  it('treats an empty string as "not given"', () => {
    expect(cleanValues(F, { code: 'A', load: '', day: '  ' }, 'create')).not.toHaveProperty('load');
  });
});
