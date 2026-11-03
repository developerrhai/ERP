// apps/web/src/pages/generic/kit/sections/FunnelSection.tsx
// Conversion / sales funnel section (docs/plans/07-ENGINE-KIT.md §2.3)

export function FunnelSection({
  title,
  stages,
}: {
  title?: string;
  stages: { label: string; count: number; valueText?: string }[];
}) {
  const maxCount = stages.reduce((max, s) => Math.max(max, s.count), 0);

  return (
    <div className="v9-section funnel-section">
      {title ? <h3>{title}</h3> : null}
      {stages.length === 0 ? (
        <p className="v9-muted">No funnel data.</p>
      ) : (
        <div className="v9-funnel" role="region" aria-label={title ?? 'Funnel'}>
          {stages.map((stage, idx) => {
            const pct = maxCount > 0 ? Math.round((stage.count / maxCount) * 100) : 0;
            return (
              <div key={`${stage.label}-${idx}`} className="v9-funnel-col">
                {stage.valueText ? <small>{stage.valueText}</small> : null}
                <div
                  className="v9-funnel-bar"
                  style={{ height: `${Math.max(pct, 12)}%` }}
                  title={`${stage.label}: ${stage.count}`}
                />
                <b>{stage.count}</b>
                <small>{stage.label}</small>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
