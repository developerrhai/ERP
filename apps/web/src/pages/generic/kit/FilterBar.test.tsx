// apps/web/src/pages/generic/kit/FilterBar.test.tsx
// Unit tests for FilterBar and FilterControl components (docs/plans/07-ENGINE-KIT.md §12 T-KIT-10)

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PageFilter } from '../engineApi';
import { FilterBar } from './FilterBar';

describe('T-KIT-10: FilterBar', () => {
  const filters: PageFilter[] = [
    { key: 'active', label: 'Only Active', param: 'active', type: 'bool' },
    { key: 'category', label: 'Category', param: 'cat', type: 'select', options: ['Raw', 'FG'] },
    { key: 'searchCode', label: 'Code', param: 'code', type: 'text' },
    { key: 'inspectionDate', label: 'Date', param: 'date', type: 'date' },
    { key: 'reportingMonth', label: 'Month', param: 'month', type: 'month' },
    { key: 'vendor', label: 'Supplier', param: 'vendorId', type: 'lookup', lookup: 'items' },
  ];

  it('renders all filter control types', () => {
    render(<FilterBar filters={filters} activeFilters={{}} onFilterChange={vi.fn()} />);

    expect(screen.getByLabelText('Only Active')).toBeInTheDocument();
    expect(screen.getByLabelText('Category')).toBeInTheDocument();
    expect(screen.getByLabelText('Code')).toBeInTheDocument();
    expect(screen.getByLabelText('Date')).toBeInTheDocument();
    expect(screen.getByLabelText('Month')).toBeInTheDocument();
  });

  it('triggers onFilterChange when bool checkbox is toggled', () => {
    const onFilterChange = vi.fn();
    render(
      <FilterBar
        filters={filters}
        activeFilters={{ active: '' }}
        onFilterChange={onFilterChange}
      />,
    );

    fireEvent.click(screen.getByLabelText('Only Active'));
    expect(onFilterChange).toHaveBeenCalledWith('active', 'true');
  });

  it('triggers onFilterChange when select option is chosen', () => {
    const onFilterChange = vi.fn();
    render(
      <FilterBar filters={filters} activeFilters={{ cat: '' }} onFilterChange={onFilterChange} />,
    );

    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'Raw' } });
    expect(onFilterChange).toHaveBeenCalledWith('cat', 'Raw');
  });

  it('triggers onFilterChange when date or month input is changed', () => {
    const onFilterChange = vi.fn();
    render(<FilterBar filters={filters} activeFilters={{}} onFilterChange={onFilterChange} />);

    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-11-04' } });
    expect(onFilterChange).toHaveBeenCalledWith('date', '2026-11-04');

    fireEvent.change(screen.getByLabelText('Month'), { target: { value: '2026-11' } });
    expect(onFilterChange).toHaveBeenCalledWith('month', '2026-11');
  });

  it('triggers onFilterChange when text input is typed', () => {
    const onFilterChange = vi.fn();
    render(<FilterBar filters={filters} activeFilters={{}} onFilterChange={onFilterChange} />);

    fireEvent.change(screen.getByLabelText('Code'), { target: { value: 'QC-100' } });
    expect(onFilterChange).toHaveBeenCalledWith('code', 'QC-100');
  });
});
