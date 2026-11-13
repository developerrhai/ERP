// Phase 24: shared dashboard building blocks - KPI tile (value, target, colour, the "i" explanation, drill-down),
// plant comparison grid, a plain SVG bar chart. No made-up numbers: a missing value shows "—" and "No data in period".
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Grid, KpiCard, Rag } from '../lib/dashApi';

const IN = 'en-IN';

/** Indian format: rupees in lakh / crore, counts with lakh grouping, percentages and days with one decimal. */
export function formatKpi(value: number | null, format: string): string {
  if (value === null || !Number.isFinite(value)) return '—';
  switch (format) {
    case 'inr': {
      const a = Math.abs(value);
      if (a >= 1e7) return `₹${(value / 1e7).toLocaleString(IN, { maximumFractionDigits: 2 })} Cr`;
      if (a >= 1e5) return `₹${(value / 1e5).toLocaleString(IN, { maximumFractionDigits: 2 })} L`;
      return `₹${value.toLocaleString(IN, { maximumFractionDigits: 0 })}`;
    }
    case 'pct':
      return `${value.toLocaleString(IN, { maximumFractionDigits: 1 })} %`;
    case 'days':
      return `${value.toLocaleString(IN, { maximumFractionDigits: 1 })} days`;
    case 'hours':
      return `${value.toLocaleString(IN, { maximumFractionDigits: 1 })} h`;
    default:
      return value.toLocaleString(IN, { maximumFractionDigits: 2 });
  }
}

const RAG_LABEL: Record<Rag, string> = { GREEN: 'On target', AMBER: 'Watch', RED: 'Off target', NONE: 'No target set' };

export function RagChip({ rag }: { rag: Rag }) {
  return (
    <span className={`rag rag-${rag.toLowerCase()}`}>
      {rag === 'NONE' ? 'No target set — ask your manager.' : RAG_LABEL[rag]}
    </span>
  );
}

export function drillLink(c: KpiCard): string | null {
  if (!c.drill.page) return null;
  const q = new URLSearchParams({ from: c.code, ...c.drill.filters });
  return `/m/${c.drill.page}?${q.toString()}`;
}

export function KpiTile({ card }: { card: KpiCard }) {
  const [info, setInfo] = useState(false);
  const link = drillLink(card);
  return (
    <div className={`kpi-tile rag-border-${card.rag.toLowerCase()}`}>
      <div className="kpi-top">
        <span className="kpi-name">{card.name}</span>
        <button type="button" className="kpi-i" aria-label={`How ${card.name} is calculated`} onClick={() => setInfo((v) => !v)}>
          i
        </button>
      </div>
      {link ? (
        <Link className="kpi-value" to={link} aria-label={`${card.name}: open the records`}>
          {formatKpi(card.value, card.format)}
        </Link>
      ) : (
        <span className="kpi-value">{formatKpi(card.value, card.format)}</span>
      )}
      {card.noData ? <span className="muted">No data in period.</span> : null}
      <div className="kpi-foot">
        <span className="muted">
          {card.target === null ? '' : `Target ${formatKpi(card.target, card.format)}`}
          {card.pct === null ? '' : ` · ${card.pct.toLocaleString(IN, { maximumFractionDigits: 1 })} %`}
        </span>
        <RagChip rag={card.rag} />
      </div>
      {info ? (
        <div className="kpi-info" role="note">
          <p>
            <strong>Formula:</strong> {card.formulaText}
          </p>
          {card.sourceText ? (
            <p>
              <strong>Source:</strong> {card.sourceText}
            </p>
          ) : null}
          <p className="muted">
            {card.rowCount} records · refreshed {new Date(card.refreshedAt).toLocaleTimeString(IN)}
          </p>
        </div>
      ) : null}
    </div>
  );
}

/** Rows = KPIs, columns = plants + total. A cell links to the records behind it. */
export function CompareGrid({ grid, empty }: { grid: Grid; empty?: string | null }) {
  if (grid.rows.length === 0) return <p className="muted">{empty ?? 'No KPIs to show yet.'}</p>;
  const multi = grid.plants.length > 1;
  return (
    <div className="table-wrap">
      <table className="register-table compare-grid">
        <thead>
          <tr>
            <th scope="col">KPI</th>
            {grid.plants.map((p) => (
              <th key={p.id} scope="col">
                {p.name}
              </th>
            ))}
            {multi ? <th scope="col">Total</th> : null}
          </tr>
        </thead>
        <tbody>
          {grid.rows.map((row) => (
            <tr key={row.code}>
              <th scope="row">{row.name}</th>
              {row.cells.map((c) => {
                const link = drillLink(c);
                const body = c.noData ? '—' : formatKpi(c.value, c.format);
                return (
                  <td key={c.unitId ?? 'x'} className={`cell-${c.rag.toLowerCase()}`} title={RAG_LABEL[c.rag]}>
                    {link ? <Link to={link}>{body}</Link> : body}
                  </td>
                );
              })}
              {multi ? (
                <td title={row.totalNote ?? undefined}>{row.total === null ? '—' : formatKpi(row.total, row.format)}</td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A small horizontal bar chart in plain SVG (one colour from the tokens, a label and a value on every bar). */
export function BarChart({ data, ariaLabel }: { data: { label: string; count: number }[]; ariaLabel: string }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  const rowH = 28;
  return (
    <svg role="img" aria-label={ariaLabel} width="100%" viewBox={`0 0 420 ${data.length * rowH + 8}`}>
      {data.map((d, i) => (
        <g key={d.label} transform={`translate(0 ${i * rowH + 4})`}>
          <text x="0" y="16" fontSize="12" fill="currentColor">
            {d.label}
          </text>
          <rect x="120" y="4" width={Math.max(2, (d.count / max) * 240)} height="16" rx="4" fill="var(--primary)">
            <title>{`${d.label}: ${d.count}`}</title>
          </rect>
          <text x={128 + (d.count / max) * 240} y="16" fontSize="12" fill="currentColor">
            {d.count}
          </text>
        </g>
      ))}
    </svg>
  );
}
