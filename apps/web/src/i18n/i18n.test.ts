// Phase 20-H gate test: ensures Hindi translation bundle (`hi.json`) contains every key in `en.json`
// with non-empty values, and Indian numbering / DD-MM-YYYY helpers behave deterministically.
import { describe, expect, it } from 'vitest';
import en from './en.json';
import hi from './hi.json';
import { formatDmy, formatInr } from './index';

function flattenKeys(obj: Record<string, unknown>, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      Object.assign(out, flattenKeys(v as Record<string, unknown>, key));
    } else {
      out[key] = String(v ?? '');
    }
  }
  return out;
}

describe('Hindi i18n parity & Indian formatting', () => {
  it('hi.json translates every key defined in en.json cleanly', () => {
    const enFlat = flattenKeys(en);
    const hiFlat = flattenKeys(hi);
    for (const key of Object.keys(enFlat)) {
      expect(hiFlat[key], `Missing Hindi key: ${key}`).toBeDefined();
      expect(hiFlat[key]?.trim().length, `Empty Hindi value for: ${key}`).toBeGreaterThan(0);
    }
  });

  it('formats INR with Indian grouping and dates as DD-MM-YYYY', () => {
    expect(formatInr(125000)).toBe('₹ 1,25,000.00');
    expect(formatDmy('2027-04-01T05:30:00.000Z')).toBe('01-04-2027');
  });
});

