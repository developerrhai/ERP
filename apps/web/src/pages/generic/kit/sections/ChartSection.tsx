// apps/web/src/pages/generic/kit/sections/ChartSection.tsx
// Bar / line chart section rendered with accessible CSS bars (docs/plans/07-ENGINE-KIT.md §2.3)

const CHART_COLORS = ['#2563eb', '#16a34a', '#ca8a04', '#dc2626', '#9333ea', '#0891b2'];

export function ChartSection({
  title,
  chartType,
  labels,
  series,
}: {
  title?: string;
  chartType: 'bar' | 'line';
  labels: string[];
  series: { name: string; data: number[] }[];
}) {
  const allValues = series.flatMap((s) => s.data);
  const maxVal = allValues.reduce((max, v) => Math.max(max, v), 0);

  return (
    <div className="v9-section chart-section">
      {title ? <h3>{title}</h3> : null}
      {labels.length === 0 || series.length === 0 ? (
        <p className="v9-muted">No chart data.</p>
      ) : (
        <div>
          {series.length > 1 ? (
            <div
              className="chart-legend x-d-flex x-gap-14px x-mb-10px x-fs-11px"
            >
              {series.map((s, sIdx) => (
                <span
                  key={s.name}
                  className="x-d-inline-flex x-ai-center x-gap-5px"
                >
                  <span
                    style={{
                      display: 'inline-block',
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      background: CHART_COLORS[sIdx % CHART_COLORS.length],
                    }}
                  />
                  {s.name}
                </span>
              ))}
            </div>
          ) : null}

          <div
            className="v9-funnel x-h-180px x-ai-flex-end x-p-8px-0"
            role="region"
            aria-label={title ?? `${chartType} chart`}
          >
            {labels.map((label, lIdx) => (
              <div key={`${label}-${lIdx}`} className="v9-funnel-col">
                <div
                  className="x-d-flex x-gap-3px x-ai-flex-end x-h-100pct x-jc-center"
                >
                  {series.map((s, sIdx) => {
                    const val = s.data[lIdx] ?? 0;
                    const pct =
                      maxVal > 0 ? Math.min(100, Math.max(0, Math.round((val / maxVal) * 100))) : 0;
                    const color = CHART_COLORS[sIdx % CHART_COLORS.length];

                    return (
                      <div
                        key={s.name}
                        style={{
                          width: `${Math.max(12, Math.floor(48 / series.length))}px`,
                          height: `${Math.max(pct, 6)}%`,
                          background: color,
                          borderRadius: '4px 4px 1px 1px',
                        }}
                        title={`${s.name} (${label}): ${val}`}
                      />
                    );
                  })}
                </div>
                <small className="x-mt-6px x-fs-10px">{label}</small>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
