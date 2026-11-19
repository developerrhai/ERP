// Top "Duplicates" button (QA report ERP-DUP-01): scans the register on screen and marks every row that
//   (a) shares a Document / Reference number with another row, or
//   (b) repeats the same Date + Party/Account + Amount.
// Rows are marked with data-dup="1" (styled in overlays.css) so React re-renders never wipe the mark.

export interface DupResult {
  rows: number;
  groups: number;
  byNumber: number;
  byFields: number;
}

const BLANK = new Set(['', '-', '—', '–', 'n/a']);
const clean = (s: string): string => s.replace(/\s+/g, ' ').trim().toLowerCase();

export function clearDuplicateMarks(root: ParentNode = document): void {
  root.querySelectorAll('tr[data-dup]').forEach((r) => r.removeAttribute('data-dup'));
}

function headerCells(table: HTMLTableElement): string[] {
  const head = table.querySelector('thead tr');
  return head ? Array.from(head.children).map((c) => clean(c.textContent ?? '')) : [];
}

export function scanDuplicates(root: ParentNode = document): DupResult {
  clearDuplicateMarks(root);
  const result: DupResult = { rows: 0, groups: 0, byNumber: 0, byFields: 0 };
  const marked = new Set<HTMLTableRowElement>();
  const tables = Array.from(root.querySelectorAll<HTMLTableElement>('.main table')).filter(
    (t) => t.querySelectorAll('tbody tr').length > 1,
  );
  for (const table of tables) {
    const heads = headerCells(table);
    if (heads.length === 0) continue;
    const rows = Array.from(table.querySelectorAll<HTMLTableRowElement>('tbody tr')).filter(
      (r) => r.children.length === heads.length,
    );
    const find = (re: RegExp): number => heads.findIndex((h) => re.test(h));
    const refIdx = find(/(\bno\.?$|number$|\bcode$|\bref|\bid$|\bjv\b|voucher)/);
    const dateIdx = find(/date|period|month/);
    const partyIdx = find(/party|account|customer|vendor|supplier|employee|technician|name|narration|description/);
    const amountIdx = find(/amount|debit|credit|total|value|net pay|gross|cost|price|balance/);
    const text = (r: HTMLTableRowElement, i: number): string => clean(r.children[i]?.textContent ?? '');

    const group = (keyOf: (r: HTMLTableRowElement) => string | null, kind: 'number' | 'fields'): void => {
      const by = new Map<string, HTMLTableRowElement[]>();
      for (const r of rows) {
        const k = keyOf(r);
        if (!k) continue;
        by.set(k, [...(by.get(k) ?? []), r]);
      }
      for (const list of by.values()) {
        if (list.length < 2) continue;
        result.groups += 1;
        for (const r of list) {
          if (!marked.has(r)) {
            marked.add(r);
            if (kind === 'number') result.byNumber += 1;
            else result.byFields += 1;
          }
          r.setAttribute('data-dup', '1');
        }
      }
    };

    if (refIdx >= 0) {
      group((r) => {
        const v = text(r, refIdx);
        return BLANK.has(v) ? null : v;
      }, 'number');
    }
    if (dateIdx >= 0 && partyIdx >= 0 && amountIdx >= 0) {
      group((r) => {
        const d = text(r, dateIdx);
        const p = text(r, partyIdx);
        const a = text(r, amountIdx);
        return BLANK.has(d) || BLANK.has(p) || BLANK.has(a) ? null : `${d}|${p}|${a}`;
      }, 'fields');
    }
  }
  result.rows = marked.size;
  if (marked.size > 0) {
    const first = Array.from(marked)[0];
    first?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }
  return result;
}

export function duplicateMessage(r: DupResult): string {
  if (r.rows === 0) return 'Duplicate check: no duplicates found in the current register.';
  const parts: string[] = [];
  if (r.byNumber) parts.push(`${r.byNumber} with a repeated document number`);
  if (r.byFields) parts.push(`${r.byFields} with the same date, party and amount`);
  return `Duplicate check: ${r.rows} row(s) highlighted in red (${r.groups} group(s)): ${parts.join(', ')}.`;
}
