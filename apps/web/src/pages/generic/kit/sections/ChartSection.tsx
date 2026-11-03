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
              className="chart-legend"
              style={{ display: 'flex', gap: '14px', marginBottom: '10px', fontSize: '10px' }}
            >
              {series.map((s, sIdx) => (
                <span key={s.name} style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
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
            className="v9-funnel"
            role="region"
            aria-label={title ?? `${chartType} chart`}
            style={{ height: '180px', alignItems: 'flex-end', padding: '8px 0' }}
          >
            {labels.map((label, lIdx) => (
              <div key={`${label}-${lIdx}`} className="v9-funnel-col">
                <div
                  style={{
                    display: 'flex',
                    gap: '3px',
                    alignItems: 'flex-end',
                    height: '100%',
                    justifyContent: 'center',
                  }}
                >
                  {series.map((s, sIdx) => {
                    const val = s.data[lIdx] ?? 0;
                    const pct = maxVal > 0 ? Math.min(100, Math.max(0, Math.round((val / maxVal) * 100))) : 0;
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
                <small style={{ marginTop: '6px', fontSize: '9px' }}>{label}</small>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
