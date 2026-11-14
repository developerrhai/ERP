// Phase 22-C: no permission -> hidden; the record blocks it -> greyed with the reason; Word and
// Move Forward are greyed with the phase that brings them.
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ACTIONS, type ActionSet } from '../types';
import { formatCell, totalLabel } from '../pages/screens/ScreenPage';
import { ActionBar, tableToCsv } from './ActionBar';

const none = Object.fromEntries(ACTIONS.map((a) => [a, false])) as ActionSet;
const can = (...on: (keyof ActionSet)[]): ActionSet => {
  const a = { ...none };
  for (const k of on) a[k] = true;
  return a;
};

describe('ActionBar', () => {
  it('hides what the role may not do', () => {
    render(<ActionBar actions={can('view')} />);
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Excel' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Documents' })).toBeTruthy();
  });

  it('greys record buttons until a record is selected, and says why', () => {
    render(<ActionBar actions={can('view', 'edit')} />);
    const edit = screen.getByRole('button', { name: 'Edit' }) as HTMLButtonElement;
    expect(edit.disabled).toBe(true);
    expect(edit.parentElement?.getAttribute('title')).toBe('Select a record first.');
  });

  it("shows the server's reason for a blocked action and enables allowed ones", () => {
    render(
      <ActionBar
        actions={can('view', 'edit', 'delete')}
        record={{
          allowed: ['open', 'documents', 'delete'],
          blocked: { edit: "Posted documents can't be edited — use Cancel/Reverse." },
        }}
      />,
    );
    const edit = screen.getByRole('button', { name: 'Edit' }) as HTMLButtonElement;
    expect(edit.disabled).toBe(true);
    expect(edit.parentElement?.getAttribute('title')).toBe(
      "Posted documents can't be edited — use Cancel/Reverse.",
    );
    expect((screen.getByRole('button', { name: 'Delete' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('greys Word and Move Forward until a record is selected, with a reason and no "Arrives in Phase"', () => {
    render(<ActionBar actions={can('view', 'print')} pageId="sales-orders" />);
    const word = screen.getByRole('button', { name: 'Word' }) as HTMLButtonElement;
    expect(word.disabled).toBe(true);
    expect(word.parentElement?.getAttribute('title')).toBe('Select a record first.');
    expect(document.body.textContent).not.toMatch(/Arrives in Phase/);
  });

  it('with a record selected Word, Industry PDF, Move Forward and Approval Queue are live', () => {
    render(
      <ActionBar actions={can('view', 'print')} pageId="sales-orders" recordId="r1" docNo="SO-1" />,
    );
    for (const n of ['Word', 'Industry PDF', 'Move Forward', 'Approval Queue']) {
      expect((screen.getByRole('button', { name: n }) as HTMLButtonElement).disabled, n).toBe(
        false,
      );
    }
  });

  it('Excel exports the visible table as CSV', () => {
    const t = document.createElement('table');
    t.innerHTML = '<tr><th>No</th><th>Name</th></tr><tr><td>1</td><td>A "x"</td></tr>';
    expect(tableToCsv(t)).toBe('"No","Name"\r\n"1","A ""x"""');
  });

  it('page mode carries the V40 head row; none is hidden, record ones are greyed with a reason', () => {
    render(
      <ActionBar
        actions={can('view', 'add', 'export', 'print', 'submit')}
        mode="page"
        pageId="sales-orders"
      />,
    );
    for (const n of [
      '← Return',
      'Email',
      'Industry PDF',
      'Word',
      '⇧ Import',
      '⇩ Export',
      'Duplicates',
      'Documents',
      'Submit Approval',
      'Approval Queue',
      'Move Forward',
      'Project History',
    ]) {
      expect(screen.getByRole('button', { name: n }), n).toBeTruthy();
    }
    expect((screen.getByRole('button', { name: 'Email' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByRole('button', { name: '⇧ Import' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect((screen.getByRole('button', { name: '← Return' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('page mode shows only the cross-cutting buttons', () => {
    render(<ActionBar actions={can('view', 'add', 'edit', 'print', 'export')} mode="page" />);
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: '＋ Add' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Excel' })).toBeNull(); // older pages draw their own
    expect(screen.getByRole('button', { name: 'Word' })).toBeTruthy();
    expect(screen.getByTestId('actionbar')).toBeTruthy();
  });

  it("lets a screen block a button with its own reason (an entry form that isn't built yet)", () => {
    render(<ActionBar actions={can('view', 'add')} blocked={{ '＋ Add': 'Not built yet.' }} />);
    const add = screen.getByRole('button', { name: '＋ Add' }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    expect(add.parentElement?.getAttribute('title')).toBe('Not built yet.');
  });
});

describe('screen formatting', () => {
  it('formats Indian money, DD-MM-YYYY dates, percentages and never invents a value', () => {
    expect(formatCell('125000.5', 'money')).toBe('₹ 1,25,000.50');
    expect(formatCell('2026-11-09', 'date')).toBe('09-11-2026');
    expect(formatCell('12.5', 'pct')).toBe('12.5 %');
    expect(formatCell(null, 'money')).toBe('—');
    expect(formatCell({ a: 1 }, 'text')).toBe('—');
    expect(formatCell(true, 'bool')).toBe('Yes');
  });

  it('shows 10,000+ when the total is an estimate', () => {
    expect(totalLabel(48211, true)).toBe('10,000+');
    expect(totalLabel(48, false)).toBe('48');
  });
});
