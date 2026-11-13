// Phase 24 TV mode: /tv/:key?token=... is read-only, needs no sign-in, shows large figures and refreshes itself every 60 s.
// With several plants it cycles from one plant to the next every 20 s.
import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { formatKpi } from '../../components/DashParts';
import { dashApi, type TvView } from '../../lib/dashApi';

export function TvPage() {
  const { key = '' } = useParams();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [view, setView] = useState<TvView | null>(null);
  const [error, setError] = useState('');
  const [page, setPage] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = () => {
      dashApi.tv(key, token).then(
        (v) => {
          if (alive) {
            setView(v);
            setError('');
          }
        },
        () => {
          if (alive) setError('This screen link expired. Ask Admin for a new link.');
        },
      );
    };
    load();
    const t = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [key, token]);

  const plantCount = view?.plants.length ?? 0;
  useEffect(() => {
    if (plantCount < 2) return;
    const t = setInterval(() => setPage((p) => (p + 1) % plantCount), 20_000);
    return () => clearInterval(t);
  }, [plantCount]);

  if (error) return <div className="tv-page"><h1>{error}</h1></div>;
  if (!view) return <div className="tv-page"><h1>Loading…</h1></div>;
  const plant = view.plants[page % Math.max(1, plantCount)];
  return (
    <div className="tv-page">
      <h1>
        {view.title}
        {plant ? ` · ${plant.name}` : ''}
      </h1>
      <div className="tv-grid">
        {view.rows.map((row) => {
          const cell = row.cells[page % Math.max(1, row.cells.length)];
          if (!cell) return null;
          return (
            <div key={row.code} className={`tv-tile rag-border-${cell.rag.toLowerCase()}`}>
              <span className="tv-name">{row.name}</span>
              <span className="tv-value">{cell.noData ? '—' : formatKpi(cell.value, cell.format)}</span>
            </div>
          );
        })}
      </div>
      <p className="tv-foot">Updated {new Date().toLocaleTimeString('en-IN')} · refreshes every minute</p>
    </div>
  );
}
