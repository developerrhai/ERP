// apps/web/src/pages/generic/kit/sections/FactsSection.tsx
// Key-value facts section using .v9-section and .v9-metric-row (docs/plans/07-ENGINE-KIT.md §2.3)

export function FactsSection({
  title,
  items,
}: {
  title?: string;
  items: { label: string; value: string }[];
}) {
  return (
    <div className="v9-section facts-section">
      {title ? <h3>{title}</h3> : null}
      <div className="facts-list">
        {items.map((item, idx) => (
          <div key={`${item.label}-${idx}`} className="v9-metric-row">
            <span>{item.label}</span>
            <b>{item.value}</b>
          </div>
        ))}
      </div>
    </div>
  );
}
