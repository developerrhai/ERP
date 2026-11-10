import { describe, expect, it } from 'vitest';
import { hardening } from '../src/index.js';

describe('Phase 20 hardening pure calculators', () => {
  it('validates balanced GL trial balance opening dataset at zero difference', () => {
    const res = hardening.validateOpeningDataset({
      dataset: 'GL_TRIAL',
      legacyTotal: 150000,
      rows: [
        { accountCode: '1101', debit: 150000, credit: 0 },
        { accountCode: '3009', debit: 0, credit: 150000 },
      ],
    });
    expect(res.balanced).toBe(true);
    expect(res.difference).toBe('0.00');
    expect(res.validRows).toBe(2);
    expect(res.errorRows).toBe(0);
  });

  it('rejects unbalanced GL trial balance or subledger vs GL control mismatch', () => {
    const unbalanced = hardening.validateOpeningDataset({
      dataset: 'GL_TRIAL',
      legacyTotal: 1000,
      rows: [
        { accountCode: '1101', debit: 1000, credit: 0 },
        { accountCode: '3009', debit: 0, credit: 900 },
      ],
    });
    expect(unbalanced.balanced).toBe(false);
    expect(unbalanced.errors.some((e) => e.field === 'trialBalance')).toBe(true);

    const stockMismatch = hardening.validateOpeningDataset({
      dataset: 'STOCK',
      legacyTotal: 5000,
      glControlBalance: 4500,
      rows: [{ itemCode: 'RM-1', warehouseCode: 'WH-TAL', qty: 50, rate: 100 }],
    });
    expect(stockMismatch.balanced).toBe(false);
    expect(stockMismatch.errors.some((e) => e.field === 'glControlBalance')).toBe(true);
  });

  it('computes 30-day DPDP SLA deadline cleanly', () => {
    const start = new Date('2026-11-10T00:00:00.000Z');
    const due = hardening.computeDpdpSlaDueDate(start, 30);
    expect(due.toISOString()).toBe('2026-12-10T00:00:00.000Z');
  });
});

