import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DynamicEntityForm } from './DynamicEntityForm';
import { SubTabInsights, weeklyCounts } from './SubTabInsights';
import type { V40Column } from '../sales/salesV40Api';

const cols: V40Column[] = [
  { key: 'Asset', label: 'Asset', type: 'text', source: true },
  { key: 'Asset Name', label: 'Asset Name', type: 'text', source: true },
  { key: 'Purchase Date', label: 'Purchase Date', type: 'date', source: true },
  { key: 'Cost', label: 'Cost', type: 'inr', source: true },
  { key: 'Status', label: 'Status', type: 'pill', source: true },
];

describe('Add form (ERP-VAL-01 / VAL-02 / DOC-01)', () => {
  it('does not save a blank form and marks the missing fields red', () => {
    const onSave = vi.fn();
    render(
      <DynamicEntityForm
        title="Assets"
        pageId="asset-master"
        columns={cols}
        onSave={onSave}
        onCancel={() => undefined}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save Record' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
    expect(screen.getByLabelText(/Asset Name/)).toHaveAttribute('aria-invalid', 'true');
  });
  it('uses a dropdown for status, a calendar input for dates and the attach-documents field', () => {
    render(
      <DynamicEntityForm
        title="Assets"
        pageId="asset-master"
        columns={cols}
        onSave={() => undefined}
        onCancel={() => undefined}
      />,
    );
    expect(screen.getByLabelText(/^Status/).tagName).toBe('SELECT');
    expect(screen.getByLabelText(/Purchase Date/)).toHaveAttribute('type', 'date');
    expect(screen.getByLabelText(/^Cost/)).toHaveAttribute('type', 'number');
    expect(screen.getByRole('button', { name: '+ Upload File' })).toBeTruthy();
  });
  it('saves once the mandatory fields are valid', () => {
    const onSave = vi.fn();
    render(
      <DynamicEntityForm
        title="Assets"
        pageId="asset-master"
        columns={cols}
        onSave={onSave}
        onCancel={() => undefined}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Asset Name/), { target: { value: 'Lathe' } });
    fireEvent.change(screen.getByLabelText(/Purchase Date/), { target: { value: '2026-11-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Record' }));
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});

describe('sub-tab front view (ERP-FEAT-01)', () => {
  const rows = [
    { id: '1', number: 'A-1', status: 'Active', 'Service Date': '2026-11-02' },
    { id: '2', number: 'A-2', status: 'Completed', 'Service Date': '2026-11-03' },
  ] as never;
  it('counts rows per weekday from a date column', () => {
    const w = weeklyCounts(rows, 'Directory', 'log-transporters');
    expect(w.reduce((a, b) => a + b, 0)).toBe(2);
    expect(w[0]).toBe(1); // 2026-11-02 is a Monday
  });
  it('draws stage badges, a Mon-Sun chart and the queue', () => {
    render(
      <SubTabInsights
        pageId="log-transporters"
        noun="Transporters"
        tabName="Transporter Directory"
        rows={rows}
        total={2}
        activeId=""
        onOpen={() => undefined}
      />,
    );
    expect(screen.getByText('Dispatch / Delivery Queue')).toBeTruthy();
    expect(screen.getByRole('img', { name: /Mon 1/ })).toBeTruthy();
  });
});
