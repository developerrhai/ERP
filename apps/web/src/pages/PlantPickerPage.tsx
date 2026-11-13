// Phase 23: shown after sign-in to a user with 2+ plants who has not ticked "Remember my choice".
// A full-screen card on the brand background; Continue stays disabled until at least one plant is ticked.
import { useState } from 'react';
import { ApiError } from '../lib/api';
import { choosePlants, type MyPlants } from '../lib/plants';

export function PlantPickerPage({ plants, userName }: { plants: MyPlants; userName: string }) {
  const [ticked, setTicked] = useState<string[]>(plants.selected);
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const def = plants.allowed.find((p) => p.id === plants.default) ?? plants.allowed[0];

  const toggle = (id: string) =>
    setTicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  async function go(selected: string[]) {
    setBusy(true);
    setError('');
    try {
      await choosePlants(selected, remember);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save your choice.');
      setBusy(false);
    }
  }

  return (
    <div className="plant-picker-bg">
      <div className="plant-picker" role="dialog" aria-modal="true" aria-labelledby="pp-title">
        <h1 id="pp-title">Choose the plants you want to see</h1>
        <p className="muted">Hello {userName}. You can change this any time from the top bar.</p>
        <div className="plant-cards">
          {plants.allowed.map((p) => {
            const on = ticked.includes(p.id);
            const pending = plants.pending[p.id];
            return (
              <label key={p.id} className={`plant-card${on ? ' on' : ''}`}>
                <input type="checkbox" checked={on} onChange={() => toggle(p.id)} aria-label={p.name} />
                <span className="plant-name">{p.name}</span>
                <span className="plant-meta">
                  {p.code}
                  {p.city ? ` · ${p.city}` : ''}
                </span>
                <span className="plant-count">
                  Pending approvals: {pending === null || pending === undefined ? '—' : pending}
                </span>
              </label>
            );
          })}
        </div>
        <div className="plant-quick">
          {def ? (
            <button type="button" className="btn" disabled={busy} onClick={() => setTicked([def.id])}>
              Only {def.name}
            </button>
          ) : null}
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => setTicked(plants.allowed.map((p) => p.id))}
          >
            All my plants
          </button>
        </div>
        <label className="plant-remember">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Remember my choice and don&apos;t ask again
        </label>
        {ticked.length === 0 ? <p className="muted">Choose at least one plant to continue.</p> : null}
        {error ? (
          <p role="alert" className="error-text">
            {error}
          </p>
        ) : null}
        <button
          type="button"
          className="btn primary"
          disabled={busy || ticked.length === 0}
          onClick={() => void go(ticked)}
        >
          Continue
        </button>
      </div>
    </div>
  );
}
