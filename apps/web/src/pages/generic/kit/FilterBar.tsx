// apps/web/src/pages/generic/kit/FilterBar.tsx
// Filter controls for bool, select, text, date, month, and lookup types (docs/plans/07-ENGINE-KIT.md §2.8, §12 T-KIT-10)

import type { PageFilter } from '../engineApi';
import { LookupCombobox } from '../LookupCombobox';
import { DateField } from '../../../ui/components';

export interface FilterBarProps {
  filters: PageFilter[];
  activeFilters: Record<string, string>;
  onFilterChange: (param: string, value: string) => void;
}

export function FilterControl({
  filter,
  value,
  onChange,
}: {
  filter: PageFilter;
  value: string;
  onChange: (val: string) => void;
}) {
  switch (filter.type) {
    case 'bool':
      return (
        <label
          className="filter-check x-d-inline-flex x-ai-center x-gap-4px"
        >
          <input
            type="checkbox"
            className="v8-checkbox"
            checked={value === 'true'}
            onChange={(e) => onChange(e.target.checked ? 'true' : '')}
          />
          {filter.label}
        </label>
      );

    case 'select':
      return (
        <select aria-label={filter.label} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">{`All ${filter.label}`}</option>
          {(filter.options ?? []).map((o) => {
            const optVal = typeof o === 'string' ? o : o.value;
            const optLabel = typeof o === 'string' ? o : o.label;
            return (
              <option key={optVal} value={optVal}>
                {optLabel}
              </option>
            );
          })}
        </select>
      );

    case 'date':
      return (
        <DateField
          aria-label={filter.label}
          title={filter.label}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{ minWidth: '120px' }}
        />
      );

    case 'month':
      return (
        <input
          type="month"
          aria-label={filter.label}
          title={filter.label}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="x-minw-120px"
        />
      );

    case 'lookup':
      return (
        <div className="x-d-inline-block x-minw-140px">
          <LookupCombobox
            label=""
            kind={filter.lookup ?? 'items'}
            value={value}
            onChange={(id) => onChange(id)}
          />
        </div>
      );

    case 'text':
    default:
      return (
        <input
          type="text"
          aria-label={filter.label}
          placeholder={`Filter ${filter.label}…`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="x-minw-110px"
        />
      );
  }
}

export function FilterBar({ filters, activeFilters, onFilterChange }: FilterBarProps) {
  if (!filters || filters.length === 0) return null;

  return (
    <div
      className="filter-bar x-d-inline-flex x-gap-8px x-ai-center x-wrap-wrap"
    >
      {filters.map((f) => (
        <FilterControl
          key={f.param}
          filter={f}
          value={activeFilters[f.param] ?? ''}
          onChange={(val) => onFilterChange(f.param, val)}
        />
      ))}
    </div>
  );
}
