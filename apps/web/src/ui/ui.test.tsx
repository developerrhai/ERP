import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ActionRow, Button, ConfirmDialog, DataTable, EmptyState, StatusBadge } from './components';
import { formatDMY, formatINR, parseDMY, statusInfo } from './format';

describe('format helpers', () => {
  it('uses Indian commas', () => {
    expect(formatINR(1250000)).toBe('12,50,000.00');
    expect(formatINR(NaN)).toBe('—');
  });
  it('dates are dd-mm-yyyy and invalid ones are rejected', () => {
    expect(formatDMY('2026-11-13T00:00:00Z')).toBe('13-11-2026');
    expect(formatDMY('garbage')).toBe('—');
    expect(parseDMY('13-11-2026')).toBe('2026-11-13');
    expect(parseDMY('31-02-2026')).toBeNull();
  });
  it('one status word per code, never a raw code', () => {
    expect(statusInfo('PENDING_APPROVAL').label).toBe('Pending approval');
    expect(statusInfo('WEIRD_CODE').label).toBe('Weird code');
  });
});

describe('components', () => {
  it('a greyed button shows the reason and cannot be clicked', () => {
    const fn = vi.fn();
    render(
      <Button reason="no backend" onClick={fn}>
        Move Forward
      </Button>,
    );
    const b = screen.getByRole('button', { name: 'Move Forward' });
    expect(b).toBeDisabled();
    expect(b.getAttribute('title')).toBe('Not available yet: no backend');
    fireEvent.click(b);
    expect(fn).not.toHaveBeenCalled();
  });
  it('the action row folds extra buttons into More, in order', () => {
    const acts = ['A', 'B', 'C', 'D', 'E'].map((l) => ({ key: l, label: l }));
    render(<ActionRow actions={acts} max={3} />);
    expect(screen.queryByText('E')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /More/ }));
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['C', 'D', 'E']);
  });
  it('empty state uses the V40 wording', () => {
    render(<EmptyState things="orders" />);
    expect(screen.getByText('No orders yet. Press ＋ Add to create the first one.')).toBeTruthy();
  });
  it('table shows the pager range and a badge word', () => {
    render(
      <DataTable
        things="rows"
        rows={[{ id: '1', s: 'APPROVED' }]}
        rowKey={(r) => r.id}
        columns={[{ key: 's', header: 'Status', render: (r) => <StatusBadge status={r.s} /> }]}
      />,
    );
    expect(screen.getByText('1–1 of 1')).toBeTruthy();
    expect(screen.getByText('Approved')).toBeTruthy();
  });
  it('delete needs the typed document number', () => {
    const ok = vi.fn();
    render(
      <ConfirmDialog
        open
        title="Delete"
        docNumber="SO-1"
        onConfirm={ok}
        onCancel={() => undefined}
      />,
    );
    const del = screen.getByRole('button', { name: 'Delete' });
    expect(del).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Document number'), { target: { value: 'SO-1' } });
    expect(del).not.toBeDisabled();
  });
});
