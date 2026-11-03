// apps/web/src/pages/generic/kit/sections/BarsSection.tsx
// Metric progress bars section (docs/plans/07-ENGINE-KIT.md §2.3)

import { formatValue } from '../formatValue';
import type { Format, Kpi } from '../panelTypes';

export function BarsSection({
  title,
  rows,
}: {
  title?: string;
  rows: {
    label: string;
    value: number;
    max?: number;
    format?: Format;
    tone?: Kpi['tone'];
  }[];
}) {
  const globalMax = rows.reduce((max, r) => Math.max(max, r.value), 0);

  return (
    <div className="v9-section bars-section">
      {title ? <h3>{title}</h3> : null}
      {rows.length === 0 ? (
        <p className="v9-muted">No metric data.</p>
      ) : (
        <div className="bars-list">
          {rows.map((r, idx) => {
            const rowMax = r.max ?? (globalMax > 0 ? globalMax : 1);
            const pct = rowMax > 0 ? Math.min(100, Math.max(0, Math.round((r.value / rowMax) * 100))) : 0;
            const barBg =
              r.tone === 'good'
                ? '#16a34a'
                : r.tone === 'warn'
                  ? '#ca8a04'
                  : r.tone === 'bad'
                    ? '#dc2626'
                    : '#2563eb';

            return (
              <div key={`${r.label}-${idx}`} className="v9-metric-row">
                <div style={{ flex: 1, paddingRight: '12px' }}>
                  <span>{r.label}</span>
                  <div className="v9-progress">
                    <span style={{ width: `${pct}%`, background: barBg }} />
                  </div>
                </div>
                <b>{formatValue(r.value, r.format ?? 'number')}</b>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
