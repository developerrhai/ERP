// The graphs of the Quality dashboard, drawn as plain SVG: ring, trend line, columns, stacked columns, half gauge and
// progress bars. Every mark answers hover and keyboard focus with its value; the numbers are also on screen or in a table.
import { useState, type FocusEvent, type PointerEvent, type ReactNode } from 'react';

/** The reference palette of the chart method: status colours mean a state, the series colours name a series. */
export const STATUS = { good: '#0aac23', warning: '#fbb315', serious: '#f18a59', critical: '#dc3c3d' } as const;
export const SERIES = { blue: '#257de0', orange: '#f47230', aqua: '#00b894', yellow: '#f2a600' } as const;

interface Tip {
  x: number;
  y: number;
  text: string;
}
function useTip() {
  const [tip, setTip] = useState<Tip | null>(null);
  const on = (text: string) => ({
    tabIndex: 0,
    'aria-label': text,
    onPointerMove: (e: PointerEvent<Element>) => {
      const box = e.currentTarget.closest('.qv-chart')?.getBoundingClientRect();
      if (box) setTip({ x: e.clientX - box.left, y: e.clientY - box.top, text });
    },
    onPointerLeave: () => setTip(null),
    onFocus: (e: FocusEvent<Element>) => {
      const box = e.currentTarget.closest('.qv-chart')?.getBoundingClientRect();
      const mine = e.currentTarget.getBoundingClientRect();
      if (box) setTip({ x: mine.left - box.left + mine.width / 2, y: mine.top - box.top, text });
    },
    onBlur: () => setTip(null),
  });
  const view: ReactNode = tip ? (
    <div className="qv-tip" style={{ left: tip.x, top: tip.y }} role="presentation">
      {tip.text}
    </div>
  ) : null;
  return { on, view };
}

const polar = (cx: number, cy: number, r: number, deg: number): [number, number] => {
  const a = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
};
const arc = (cx: number, cy: number, r: number, from: number, to: number): string => {
  const [x1, y1] = polar(cx, cy, r, from);
  const [x2, y2] = polar(cx, cy, r, to);
  return `M ${x1} ${y1} A ${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x2} ${y2}`;
};

export interface Slice {
  label: string;
  value: number;
  color: string;
}
export function Donut({ slices, center, caption }: { slices: Slice[]; center: string; caption: string }) {
  const { on, view } = useTip();
  const total = slices.reduce((a, s) => a + s.value, 0);
  const shown = slices.filter((s) => s.value > 0);
  const gap = shown.length > 1 ? 2 : 0;
  let at = 0;
  return (
    <div className="qv-chart qv-donut">
      <svg viewBox="0 0 160 160" role="img" aria-label={`${caption}: ${center}`}>
        {total === 0 ? <circle cx="80" cy="80" r="60" className="qv-track" fill="none" strokeWidth="22" /> : null}
        {shown.map((s) => {
          const size = (s.value / total) * 360;
          const from = at;
          at += size;
          const share = `${s.label}: ${s.value} (${Math.round((s.value / total) * 1000) / 10}%)`;
          return shown.length === 1 ? (
            <circle key={s.label} cx="80" cy="80" r="60" fill="none" stroke={s.color} strokeWidth="22" {...on(share)} />
          ) : (
            <path
              key={s.label}
              d={arc(80, 80, 60, from + gap / 2, from + Math.max(size - gap / 2, gap / 2 + 0.5))}
              fill="none"
              stroke={s.color}
              strokeWidth="22"
              {...on(share)}
            />
          );
        })}
        <text x="80" y="86" textAnchor="middle" className="qv-center">
          {center}
        </text>
      </svg>
      <ul className="qv-legend">
        {slices.map((s) => (
          <li key={s.label}>
            <i style={{ background: s.color }} aria-hidden="true" />
            <span>{s.label}</span>
            <b>
              {s.value}
              {total ? ` · ${Math.round((s.value / total) * 1000) / 10}%` : ''}
            </b>
          </li>
        ))}
      </ul>
      {view}
    </div>
  );
}

/** A round number at or above the largest value, for the top gridline. */
const niceMax = (v: number): number => {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.2, 1.6, 2, 2.4, 3, 4, 5, 6, 8, 10]) if (v <= m * p) return m * p;
  return 10 * p;
};
const short = (v: number): string =>
  v >= 1e7 ? `${Math.round(v / 1e6) / 10} Cr` : v >= 1e5 ? `${Math.round(v / 1e4) / 10} L` : v >= 1000 ? `${Math.round(v / 100) / 10}k` : `${Math.round(v * 100) / 100}`;

export interface Point {
  label: string;
  value: number;
  tip: string;
}
const W = 320;
const H = 150;
const LEFT = 34;
const BOTTOM = 22;
function Grid({ max, unit }: { max: number; unit: string }) {
  return (
    <>
      {[0, 0.5, 1].map((f) => {
        const y = H - BOTTOM - f * (H - BOTTOM - 14);
        return (
          <g key={f}>
            <line x1={LEFT} x2={W - 4} y1={y} y2={y} className="qv-gridline" />
            <text x={LEFT - 4} y={y + 3} textAnchor="end" className="qv-axis">
              {short(max * f)}
              {unit}
            </text>
          </g>
        );
      })}
    </>
  );
}
/** About six labels along the bottom, however many points there are. */
const labelled = (i: number, n: number): boolean => i % Math.max(1, Math.ceil(n / 6)) === 0;

export function TrendLine({ points, unit = '', caption }: { points: Point[]; unit?: string; caption: string }) {
  const { on, view } = useTip();
  const max = niceMax(Math.max(0, ...points.map((p) => p.value)));
  const span = W - LEFT - 12;
  const x = (i: number): number => LEFT + 6 + (points.length === 1 ? span / 2 : (i / (points.length - 1)) * span);
  const y = (v: number): number => H - BOTTOM - (v / max) * (H - BOTTOM - 14);
  const path = points.map((p, i) => `${i ? 'L' : 'M'} ${x(i)} ${y(p.value)}`).join(' ');
  const band = points.length > 1 ? span / (points.length - 1) : span;
  return (
    <div className="qv-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={caption}>
        <Grid max={max} unit={unit} />
        {points.length > 1 ? (
          <>
            <path d={`${path} L ${x(points.length - 1)} ${H - BOTTOM} L ${x(0)} ${H - BOTTOM} Z`} fill={SERIES.blue} opacity="0.1" />
            <path d={path} fill="none" stroke={SERIES.blue} strokeWidth="2" />
          </>
        ) : null}
        {points.map((p, i) => (
          <g key={`${p.label}-${i}`} className="qv-hit" {...on(p.tip)}>
            <rect x={x(i) - band / 2} y={6} width={band} height={H - BOTTOM - 6} fill="transparent" />
            <circle cx={x(i)} cy={y(p.value)} r={4} fill={SERIES.blue} stroke="#fff" strokeWidth="2" />
            {labelled(i, points.length) ? (
              <text x={x(i)} y={H - 7} textAnchor="middle" className="qv-axis">
                {p.label.length > 11 ? `${p.label.slice(0, 10)}…` : p.label}
              </text>
            ) : null}
          </g>
        ))}
      </svg>
      {view}
    </div>
  );
}

export function Columns({ bars, caption }: { bars: Point[]; caption: string }) {
  const { on, view } = useTip();
  const max = niceMax(Math.max(0, ...bars.map((b) => b.value)));
  const slot = (W - LEFT - 8) / Math.max(bars.length, 1);
  const width = Math.min(26, slot - 6);
  return (
    <div className="qv-chart">
      <svg viewBox={`0 0 ${W} ${H + 6}`} role="img" aria-label={caption}>
        <Grid max={max} unit="" />
        {bars.map((b, i) => {
          const h = (b.value / max) * (H - BOTTOM - 14);
          const bx = LEFT + 4 + i * slot + (slot - width) / 2;
          const top = H - BOTTOM - h;
          const r = Math.min(4, h);
          return (
            <g key={`${b.label}-${i}`} className="qv-hit" {...on(b.tip)}>
              <rect x={LEFT + 4 + i * slot} y={6} width={slot} height={H - BOTTOM - 6} fill="transparent" />
              <path
                d={`M ${bx} ${H - BOTTOM} V ${top + r} Q ${bx} ${top} ${bx + r} ${top} H ${bx + width - r} Q ${bx + width} ${top} ${bx + width} ${top + r} V ${H - BOTTOM} Z`}
                fill={SERIES.blue}
              />
              <text x={bx + width / 2} y={top - 3} textAnchor="middle" className="qv-value">
                {short(b.value)}
              </text>
              <text x={bx + width / 2} y={H - 8} textAnchor="middle" className="qv-axis">
                {b.label.length > Math.max(6, Math.floor(slot / 5)) ? `${b.label.slice(0, Math.max(5, Math.floor(slot / 5) - 1))}…` : b.label}
              </text>
            </g>
          );
        })}
      </svg>
      {view}
    </div>
  );
}

export interface Stack {
  key: string;
  label: string;
  color: string;
}
export function StackedColumns({ series, data, money, caption }: { series: Stack[]; data: { label: string; values: Record<string, number> }[]; money: (v: number) => string; caption: string }) {
  const { on, view } = useTip();
  const wide = 640;
  const tall = 230;
  const total = (d: { values: Record<string, number> }): number => series.reduce((a, s) => a + (d.values[s.key] ?? 0), 0);
  const max = niceMax(Math.max(0, ...data.map(total)));
  const slot = (wide - LEFT - 8) / Math.max(data.length, 1);
  const width = Math.min(34, slot - 8);
  const scale = (v: number): number => (v / max) * (tall - BOTTOM - 18);
  return (
    <div className="qv-chart">
      <svg viewBox={`0 0 ${wide} ${tall}`} role="img" aria-label={caption}>
        {[0, 0.25, 0.5, 0.75, 1].map((f) => {
          const y = tall - BOTTOM - scale(max * f);
          return (
            <g key={f}>
              <line x1={LEFT + 4} x2={wide - 4} y1={y} y2={y} className="qv-gridline" />
              <text x={LEFT} y={y + 3} textAnchor="end" className="qv-axis">
                {short(max * f)}
              </text>
            </g>
          );
        })}
        {data.map((d, i) => {
          const bx = LEFT + 6 + i * slot + (slot - width) / 2;
          let base = tall - BOTTOM;
          return (
            <g key={d.label}>
              {series.map((s) => {
                const v = d.values[s.key] ?? 0;
                if (v <= 0) return null;
                const h = Math.max(scale(v), 2);
                base -= h;
                // a 2px surface gap separates the stacked parts
                return <rect key={s.key} className="qv-hit" x={bx} y={base} width={width} height={Math.max(h - 2, 1)} rx="2" fill={s.color} {...on(`${d.label} · ${s.label}: ${money(v)}`)} />;
              })}
              <text x={bx + width / 2} y={tall - 8} textAnchor="middle" className="qv-axis">
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>
      <ul className="qv-legend row">
        {series.map((s) => (
          <li key={s.key}>
            <i style={{ background: s.color }} aria-hidden="true" />
            <span>{s.label}</span>
          </li>
        ))}
      </ul>
      {view}
    </div>
  );
}

/** Half-circle dial: the needle stands at `share` (0 to 1). */
export function Gauge({ share, color, value, caption }: { share: number; color: string; value: string; caption: string }) {
  const { on, view } = useTip();
  const s = Math.min(1, Math.max(0, share));
  const [nx, ny] = polar(90, 90, 52, -90 + s * 180);
  return (
    <div className="qv-chart qv-gauge">
      <svg viewBox="0 0 180 112" role="img" aria-label={`${caption}: ${value}`}>
        <g {...on(`${caption}: ${value}`)}>
          <path d={arc(90, 90, 66, -90, 90)} fill="none" className="qv-track" strokeWidth="18" />
          {s > 0 ? <path d={arc(90, 90, 66, -90, -90 + s * 180)} fill="none" stroke={color} strokeWidth="18" /> : null}
          <line x1="90" y1="90" x2={nx} y2={ny} className="qv-needle" />
          <circle cx="90" cy="90" r="5" className="qv-hub" />
        </g>
        <text x="90" y="110" textAnchor="middle" className="qv-center">
          {value}
        </text>
      </svg>
      <p className="qv-caption">{caption}</p>
      {view}
    </div>
  );
}

export function ProgressList({ rows }: { rows: { label: string; value: number; of: number; color?: string; text?: string; onClick?: () => void }[] }) {
  return (
    <ul className="qv-progress">
      {rows.map((r) => {
        const pct = r.of ? Math.round((r.value / r.of) * 100) : 0;
        const body = (
          <>
            <span className="qv-progress-label">{r.label}</span>
            <b>{r.text ?? `${r.value} of ${r.of} · ${pct}%`}</b>
            <span className="qv-bar" role="progressbar" aria-label={r.label} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
              <span style={{ width: `${pct}%`, background: r.color ?? SERIES.blue }} />
            </span>
          </>
        );
        return (
          <li key={r.label} title={`${r.label}: ${r.value} of ${r.of}`}>
            {r.onClick ? (
              <button type="button" className="qv-progress-button" onClick={r.onClick}>
                {body}
              </button>
            ) : (
              body
            )}
          </li>
        );
      })}
    </ul>
  );
}
