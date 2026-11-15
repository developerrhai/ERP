// Minimal bar chart (pure CSS). Heights come from the numbers passed in; no data means an empty state.
export interface Bar {
  label: string;
  value: number;
}

export function BarChart({ bars, empty }: { bars: Bar[]; empty: string }) {
  if (bars.length === 0) return <div className="ex-empty">{empty}</div>;
  const max = Math.max(...bars.map((b) => b.value), 1);
  return (
    <div className="ex-chart" role="img" aria-label="Bar chart">
      {bars.map((b) => (
        <div className="ex-bar" key={b.label} title={`${b.label}: ${b.value}`}>
          <span>{b.value}</span>
          <i style={{ height: `${Math.max(1, Math.round((b.value / max) * 150))}px` }} />
          <em>{b.label}</em>
        </div>
      ))}
    </div>
  );
}
