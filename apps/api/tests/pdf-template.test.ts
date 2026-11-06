// Phase 4 PDF templates (run only after the T-PDF-01 gate passes): amount in words, Indian grouping,
// a multi-page document with Hindi text, and the list table.
import { describe, expect, it } from 'vitest';
import { formatInr, groupIndian, rupeesInWords } from '../src/core/pdf/amount-words';
import { renderDocumentPdf, renderTablePdf } from '../src/core/pdf/template';
import type { PdfLetterhead } from '../src/core/pdf/template';
import type { PrintDto } from '../src/kit/print';

const LH: PdfLetterhead = {
  companyName: 'Sawant Group',
  address: 'Talwade, Pune',
  gstin: '27AAPFU0939F1ZV',
  primaryColor: '#0f172a',
  showGstin: true,
  showPan: false,
  footer: 'Computer generated document',
};

function dto(rowCount: number): PrintDto {
  return {
    templateKey: 'doc',
    title: 'Purchase Order — खरेदी आदेश',
    docNo: 'PO/TAL/26-27/00001',
    docDate: '06-Nov-2026',
    unit: { code: 'TAL', name: 'Unit 1 Talwade', address: 'तळवडे, पुणे' },
    letterhead: {},
    parties: [{ role: 'Supplier', name: 'रेडी हँड प्रायव्हेट लिमिटेड', gstin: '27AAPFU0939F1ZV' }],
    facts: [{ label: 'Terms', value: 'Net 30' }],
    lines: {
      columns: [
        { key: 'item', label: 'Item', format: 'text' },
        { key: 'amount', label: 'Amount (₹)', format: 'money', align: 'right' },
      ],
      rows: Array.from({ length: rowCount }, (_, i) => ({
        item: `वस्तू ${i + 1}`,
        amount: 1234.5 * (i + 1),
      })),
    },
    sections: [],
    totals: [{ label: 'Total', value: formatInr(123456.5), bold: true }],
    amountInWords: rupeesInWords(123456.5),
    signatures: [{ label: 'Prepared by' }, { label: 'Authorised signatory' }],
  };
}

describe('amount words / Indian grouping', () => {
  it('groups in lakh / crore', () => {
    expect(groupIndian(123456.5)).toBe('1,23,456.50');
    expect(groupIndian(12345678)).toBe('1,23,45,678.00');
    expect(groupIndian(999)).toBe('999.00');
    expect(groupIndian(-1500)).toBe('-1,500.00');
    expect(formatInr(1000)).toBe('₹ 1,000.00');
  });
  it('writes rupees and paise', () => {
    expect(rupeesInWords(123456.5)).toBe(
      'Rupees One Lakh Twenty Three Thousand Four Hundred Fifty Six and Fifty Paise Only',
    );
    expect(rupeesInWords(0)).toBe('Rupees Zero Only');
    expect(rupeesInWords(10_000_000)).toBe('Rupees One Crore Only');
    expect(rupeesInWords(21)).toBe('Rupees Twenty One Only');
  });
});

describe('PDF templates', () => {
  it('renders a one-page document with Hindi text', async () => {
    const pdf = await renderDocumentPdf(dto(3), LH);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.toString('latin1')).toMatch(/\/Count 1\b/);
  });
  it('paginates long tables and numbers the pages', async () => {
    const pdf = await renderDocumentPdf(dto(120), LH);
    const m = /\/Type \/Pages[\s\S]*?\/Count (\d+)/.exec(pdf.toString('latin1'));
    expect(Number(m?.[1])).toBeGreaterThan(2);
  });
  it('renders a register table (landscape) and an empty one', async () => {
    const rows = Array.from({ length: 60 }, (_, i) => ({
      code: `C${i}`,
      name: `नाव ${i}`,
      amount: '1,000.00',
    }));
    const input = {
      title: 'Leads',
      columns: [
        { key: 'code', label: 'Code' },
        { key: 'name', label: 'Name' },
        { key: 'amount', label: 'Amount', align: 'right' as const },
      ],
    };
    expect((await renderTablePdf({ ...input, rows }, LH)).length).toBeGreaterThan(5000);
    expect((await renderTablePdf({ ...input, rows: [] }, LH)).length).toBeGreaterThan(3000);
  });
});
