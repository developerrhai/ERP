// apps/web/src/pages/generic/kit/sections/KpiRow.tsx
// KPI banner row using .v9-workspace and .v9-stat (docs/plans/07-ENGINE-KIT.md §2.3)

import type { Kpi } from '../panelTypes';
import { formatValue } from '../formatValue';

export function KpiRow({ kpis }: { kpis?: Kpi[] }) {
  if (!kpis || kpis.length === 0) return null;

  return (
    <div className="v9-workspace" role="region" aria-label="Key performance indicators">
      {kpis.map((kpi, idx) => (
        <div key={kpi.key ?? `${kpi.label}-${idx}`} className="v9-stat">
          <small>{kpi.label}</small>
          <b>{formatValue(kpi.value, kpi.format)}</b>
          {kpi.hint ? <span>{kpi.hint}</span> : null}
        </div>
      ))}
    </div>
  );
}
