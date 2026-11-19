// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { clearDuplicateMarks, duplicateMessage, scanDuplicates } from './dupScan';

function table(rows: string[][], head: string[]): HTMLElement {
  document.body.innerHTML = `<div class="main"><table><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`)
    .join('')}</tbody></table></div>`;
  return document.body;
}

describe('scanDuplicates', () => {
  it('marks rows that share a JV number', () => {
    const b = table(
      [
        ['JOU-26-0001', '2026-04-01', 'Cash', '100'],
        ['JOU-26-0002', '2026-04-02', 'Bank', '200'],
        ['JOU-26-0002', '2026-04-03', 'Sales', '300'],
      ],
      ['JV No', 'Date', 'Account', 'Amount'],
    );
    const r = scanDuplicates(b);
    expect(r.rows).toBe(2);
    expect(b.querySelectorAll('tr[data-dup="1"]').length).toBe(2);
    expect(duplicateMessage(r)).toContain('2 row(s)');
  });

  it('marks rows with the same date, party and amount', () => {
    const b = table(
      [
        ['A-1', '2026-04-01', 'Acme', '500'],
        ['A-2', '2026-04-01', 'Acme', '500'],
        ['A-3', '2026-04-02', 'Acme', '500'],
      ],
      ['Ref No', 'Date', 'Customer', 'Amount'],
    );
    expect(scanDuplicates(b).byFields).toBe(2);
  });

  it('reports none and clears old marks', () => {
    const b = table(
      [
        ['X-1', '2026-04-01', 'A', '1'],
        ['X-2', '2026-04-02', 'B', '2'],
      ],
      ['Doc No', 'Date', 'Party', 'Amount'],
    );
    b.querySelector('tbody tr')!.setAttribute('data-dup', '1');
    expect(scanDuplicates(b).rows).toBe(0);
    clearDuplicateMarks(b);
    expect(b.querySelectorAll('tr[data-dup]').length).toBe(0);
    expect(duplicateMessage({ rows: 0, groups: 0, byNumber: 0, byFields: 0 })).toContain('no duplicates');
  });
});
