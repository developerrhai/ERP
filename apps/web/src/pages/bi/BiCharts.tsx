// Plain accessible SVG charts (no chart library): a line chart with optional second line, and a bar chart.
// Colours come from CSS variables (see bi-dashboards.css), every chart is role="img" with a text summary and per-mark <title>.
import { compact } from './analyticsModel';
import './bi-dashboards.css';

const W = 640;
const H = 280;
const PAD = { l: 46, r: 14, t: 14, b: 46 };

export interface LineSeries {
  name: string;
  values: Array<number | null>;
  tone: 'a' | 'b';
}

function ticks(min: number, max: number): number[] {
  if (max === min) return [min];
  return [0, 1, 2, 3].map((i) => min + ((max - min) * i) / 3);
}

export function LineChart({ labels, series, label }: { labels: string[]; series: LineSeries[]; label: string }) {
  const all = series.flatMap((s) => s.values).filter((v): v is number => v !== null);
  if (all.length === 0) return null;
  let min = Math.min(...all);
  let max = Math.max(...all);
  if (min > 0) min = 0;
  if (max === min) max = min + 1;
  const n = Math.max(labels.length, 2);
  const x = (i: number): number => PAD.l + ((W - PAD.l - PAD.r) * i) / (n - 1);
  const y = (v: number): number => PAD.t + (H - PAD.t - PAD.b) * (1 - (v - min) / (max - min));
  const every = Math.max(1, Math.ceil(labels.length / 6));
  const summary = `${label}. ${series.map((s) => `${s.name}: ${s.values.filter((v) => v !== null).length} points`).join(', ')}. Range ${compact(min)} to ${compact(max)}.`;
  return (
    <figure className="bi-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary} preserveAspectRatio="xMidYMid meet">
        {ticks(min, max).map((t) => (
          <g key={t}>
            <line className="bi-grid" x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} />
            <text className="bi-axis" x={PAD.l - 6} y={y(t) + 3} textAnchor="end">
              {compact(t)}
            </text>
          </g>
        ))}
        {labels.map((l, i) =>
          i % every === 0 ? (
            <text key={`${l}-${i}`} className="bi-axis" x={x(i)} y={H - 12} textAnchor="middle">
              {l}
            </text>
          ) : null,
        )}
        {series.map((s) => {
          let d = '';
          s.values.forEach((v, i) => {
            if (v === null) return;
            d += `${d && s.values[i - 1] !== null && s.values[i - 1] !== undefined ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)} `;
          });
          return (
            <g key={s.name}>
              <path className={`bi-line ${s.tone}`} d={d.trim()} fill="none" />
              {s.values.map((v, i) =>
                v === null ? null : (
                  <circle key={i} className={`bi-dot ${s.tone}`} cx={x(i)} cy={y(v)} r={3}>
                    <title>{`${s.name} · ${labels[i] ?? i + 1}: ${v.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`}</title>
                  </circle>
                ),
              )}
            </g>
          );
        })}
      </svg>
      <figcaption className="bi-legend">
        {series.map((s) => (
          <span key={s.name}>
            <i className={`bi-swatch ${s.tone}`} aria-hidden="true" />
            {s.name}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

export function BarChart({ items, label, unit }: { items: Array<{ label: string; value: number }>; label: string; unit?: string }) {
  if (items.length === 0) return null;
  const max = Math.max(...items.map((i) => i.value), 1);
  const min = Math.min(0, ...items.map((i) => i.value));
  const span = max - min || 1;
  const bw = (W - PAD.l - PAD.r) / items.length;
  const y = (v: number): number => PAD.t + (H - PAD.t - PAD.b) * (1 - (v - min) / span);
  const rotate = items.length > 6;
  const summary = `${label}. ${items.map((i) => `${i.label} ${i.value.toLocaleString('en-IN')}${unit ?? ''}`).join('; ')}.`;
  return (
    <figure className="bi-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary} preserveAspectRatio="xMidYMid meet">
        {ticks(min, max).map((t) => (
          <g key={t}>
            <line className="bi-grid" x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} />
            <text className="bi-axis" x={PAD.l - 6} y={y(t) + 3} textAnchor="end">
              {compact(t)}
            </text>
          </g>
        ))}
        {items.map((it, i) => {
          const bx = PAD.l + i * bw + bw * 0.15;
          const top = y(Math.max(it.value, 0));
          const base = y(0);
          const text = it.label.length > 10 ? `${it.label.slice(0, 9)}…` : it.label;
          const cx = PAD.l + i * bw + bw / 2;
          return (
            <g key={`${it.label}-${i}`}>
              <rect className="bi-bar" x={bx} y={top} width={bw * 0.7} height={Math.max(1, Math.abs(base - y(it.value)))} rx={3}>
                <title>{`${it.label}: ${it.value.toLocaleString('en-IN')}${unit ?? ''}`}</title>
              </rect>
              <text className="bi-axis" x={cx} y={H - 8} textAnchor={rotate ? 'end' : 'middle'} transform={rotate ? `rotate(-35 ${cx} ${H - 8})` : undefined}>
                {text}
              </text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}
