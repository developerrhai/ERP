// Colourful, clickable SVG charts for the role dashboards (no chart library). Every mark links to the page that holds
// the records behind it, and every chart has a text summary for screen readers. Numbers are passed in already computed
// from the API - nothing here invents a value.
import { Link } from 'react-router-dom';

export const PALETTE = ['#2563eb', '#16a34a', '#f59e0b', '#9333ea', '#06b6d4', '#ef4444', '#ec4899', '#64748b'];

export interface Slice {
  label: string;
  value: number;
  to?: string;
  color?: string;
}

const nf = (n: number): string => n.toLocaleString('en-IN', { maximumFractionDigits: 2 });

export function compactNum(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e7) return `${+(n / 1e7).toFixed(1)}Cr`;
  if (a >= 1e5) return `${+(n / 1e5).toFixed(1)}L`;
  if (a >= 1e3) return `${+(n / 1e3).toFixed(1)}K`;
  return `${+n.toFixed(1)}`;
}

/** Donut with a centre total and a clickable legend. Slices with value 0 are dropped. */
export function Donut({ slices, centre, label }: { slices: Slice[]; centre: string; label: string }) {
  const used = slices.filter((s) => s.value > 0).map((s, i) => ({ ...s, color: s.color ?? PALETTE[i % PALETTE.length]! }));
  const total = used.reduce((a, s) => a + s.value, 0);
  if (total <= 0) return <p className="muted rd-empty">Nothing here right now.</p>;
  const R = 52;
  const C = 2 * Math.PI * R;
  let acc = 0;
  return (
    <div className="rd-donut">
      <svg viewBox="0 0 140 140" role="img" aria-label={`${label}. ${used.map((s) => `${s.label} ${nf(s.value)}`).join('; ')}.`}>
        <circle cx="70" cy="70" r={R} fill="none" stroke="var(--soft, #eef2f7)" strokeWidth="20" />
        {used.map((s) => {
          const len = (s.value / total) * C;
          const el = (
            <circle
              key={s.label}
              cx="70"
              cy="70"
              r={R}
              fill="none"
              stroke={s.color}
              strokeWidth="20"
              strokeDasharray={`${Math.max(len - 1.5, 0.5)} ${C}`}
              strokeDashoffset={-acc}
              transform="rotate(-90 70 70)"
            >
              <title>{`${s.label}: ${nf(s.value)} (${Math.round((s.value / total) * 100)}%)`}</title>
            </circle>
          );
          acc += len;
          return s.to ? (
            <Link key={s.label} to={s.to} aria-label={`${s.label}: ${nf(s.value)}`}>
              {el}
            </Link>
          ) : (
            el
          );
        })}
        <text x="70" y="68" textAnchor="middle" className="rd-donut-num">
          {centre}
        </text>
        <text x="70" y="84" textAnchor="middle" className="rd-donut-sub">
          total
        </text>
      </svg>
      <ul className="rd-legend">
        {used.map((s) => (
          <li key={s.label}>
            <i style={{ background: s.color }} aria-hidden="true" />
            {s.to ? <Link to={s.to}>{s.label}</Link> : <span>{s.label}</span>}
            <b>{nf(s.value)}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Horizontal bars, one clickable row each, sorted as given. `format` renders the value text. */
export function HBars({ items, format = nf, label }: { items: Slice[]; format?: (n: number) => string; label: string }) {
  if (items.length === 0 || items.every((i) => i.value === 0)) return <p className="muted rd-empty">Nothing here right now.</p>;
  const max = Math.max(...items.map((i) => Math.abs(i.value)), 1);
  return (
    <ul className="rd-hbars" aria-label={label}>
      {items.map((it, i) => {
        const color = it.color ?? PALETTE[i % PALETTE.length]!;
        const body = (
          <>
            <span className="rd-hb-label" title={it.label}>
              {it.label}
            </span>
            <span className="rd-hb-track">
              <span className="rd-hb-fill" style={{ width: `${Math.max(2, (Math.abs(it.value) / max) * 100)}%`, background: it.value < 0 ? '#ef4444' : color }} />
            </span>
            <b className="rd-hb-val">{format(it.value)}</b>
          </>
        );
        return <li key={`${it.label}-${i}`}>{it.to ? <Link to={it.to}>{body}</Link> : <div>{body}</div>}</li>;
      })}
    </ul>
  );
}

export interface TrendSeries {
  name: string;
  values: (number | null)[];
  color: string;
}

/** Multi-series trend: filled area + line with dots; whole chart links to `to`. */
export function Trend({ labels, series, label, to }: { labels: string[]; series: TrendSeries[]; label: string; to?: string }) {
  const all = series.flatMap((s) => s.values).filter((v): v is number => v !== null);
  if (all.length === 0) return <p className="muted rd-empty">No data in this period.</p>;
  const W = 520;
  const H = 210;
  const P = { l: 44, r: 10, t: 10, b: 28 };
  let min = Math.min(0, ...all);
  let max = Math.max(0, ...all);
  if (max === min) max = min + 1;
  const n = Math.max(labels.length, 2);
  const x = (i: number): number => P.l + ((W - P.l - P.r) * i) / (n - 1);
  const y = (v: number): number => P.t + (H - P.t - P.b) * (1 - (v - min) / (max - min));
  const every = Math.max(1, Math.ceil(labels.length / 6));
  const grid = [0, 1, 2, 3].map((i) => min + ((max - min) * i) / 3);
  const svg = (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label}. ${series.map((s) => s.name).join(', ')}. Range ${compactNum(min)} to ${compactNum(max)}.`}>
      <defs>
        {series.map((s, i) => (
          <linearGradient key={s.name} id={`rdg-${label.replace(/\W/g, '')}-${i}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={s.color} stopOpacity="0.35" />
            <stop offset="1" stopColor={s.color} stopOpacity="0" />
          </linearGradient>
        ))}
      </defs>
      {grid.map((t) => (
        <g key={t}>
          <line x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} stroke="var(--line, #e2e8f0)" strokeDasharray="3 3" />
          <text x={P.l - 6} y={y(t) + 3} textAnchor="end" className="rd-axis">
            {compactNum(t)}
          </text>
        </g>
      ))}
      {labels.map((l, i) =>
        i % every === 0 ? (
          <text key={`${l}-${i}`} x={x(i)} y={H - 8} textAnchor="middle" className="rd-axis">
            {l}
          </text>
        ) : null,
      )}
      {series.map((s, si) => {
        const pts = s.values.map((v, i) => (v === null ? null : ([x(i), y(v)] as const)));
        const line = pts.filter((p): p is readonly [number, number] => p !== null).map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
        const real = pts.filter((p): p is readonly [number, number] => p !== null);
        const area = real.length > 1 ? `${line} L${real[real.length - 1]![0].toFixed(1)} ${y(0).toFixed(1)} L${real[0]![0].toFixed(1)} ${y(0).toFixed(1)} Z` : '';
        return (
          <g key={s.name}>
            {area ? <path d={area} fill={`url(#rdg-${label.replace(/\W/g, '')}-${si})`} /> : null}
            <path d={line} fill="none" stroke={s.color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
            {s.values.map((v, i) =>
              v === null ? null : (
                <circle key={i} cx={x(i)} cy={y(v)} r="3.5" fill="#fff" stroke={s.color} strokeWidth="2">
                  <title>{`${s.name} · ${labels[i] ?? i + 1}: ${nf(v)}`}</title>
                </circle>
              ),
            )}
          </g>
        );
      })}
    </svg>
  );
  return (
    <figure className="rd-trend">
      {to ? (
        <Link to={to} aria-label={`${label}: open the full report`}>
          {svg}
        </Link>
      ) : (
        svg
      )}
      <figcaption className="rd-legend-inline">
        {series.map((s) => (
          <span key={s.name}>
            <i style={{ background: s.color }} aria-hidden="true" />
            {s.name}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
