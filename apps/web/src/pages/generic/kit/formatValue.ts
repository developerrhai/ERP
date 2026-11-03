// apps/web/src/pages/generic/kit/formatValue.ts
// Format helper for panel values, KPIs, and columns using lib/format (docs/plans/07-ENGINE-KIT.md §2.3, §6 KR-15)

import { formatDate, formatDateTime } from '../../../lib/format';
import { formatMoney, formatQty } from '../fieldModel';
import type { Format } from './panelTypes';

export function formatValue(val: unknown, format: Format): string {
  if (val === null || val === undefined || val === '') return '—';

  switch (format) {
    case 'money':
      return typeof val === 'number' ? formatMoney(val) : `₹ ${val}`;
    case 'qty':
      return typeof val === 'number' ? formatQty(val) : String(val);
    case 'number':
      return typeof val === 'number' ? new Intl.NumberFormat('en-IN').format(val) : String(val);
    case 'pct':
      return typeof val === 'number' ? `${val}%` : `${val}%`;
    case 'date':
      return formatDate(String(val));
    case 'datetime':
      return formatDateTime(String(val));
    case 'bool':
      return val === true || val === 'true' ? 'Yes' : 'No';
    case 'text':
    case 'status':
    default:
      return String(val);
  }
}
