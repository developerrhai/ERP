// Phase 22-C: no permission -> hidden; the record blocks it -> greyed with the reason; Word and
// Move Forward are greyed with the phase that brings them.
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ACTIONS, type ActionSet } from '../types';
import { formatCell, totalLabel } from '../pages/screens/ScreenPage';
import { ActionBar } from './ActionBar';

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
    expect((screen.getByRole('button', { name: 'Delete' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('greys Word and Move Forward with the phase that brings them', () => {
    render(<ActionBar actions={can('view', 'print')} />);
    const word = screen.getByRole('button', { name: 'Word' }) as HTMLButtonElement;
    expect(word.disabled).toBe(true);
    expect(word.parentElement?.getAttribute('title')).toBe('Arrives in Phase 27.');
    const move = screen.getByRole('button', { name: 'Move Forward' }) as HTMLButtonElement;
    expect(move.parentElement?.getAttribute('title')).toBe('Arrives in Phase 25.');
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
