// Phase 22 §7: registry v2 viewer. Search, family tree, and a page card with tabs, fields, buttons,
// status (Built / Planned / Changed on purpose) and the owner phase.
import { useEffect, useMemo, useState } from 'react';
import { ApiError } from '../../lib/api';
import { getRegistryV2, type RegistryPage, type RegistryV2 } from '../../lib/screensApi';
import { ErrorBox, PageHead, Pill } from '../finance/shared';

export function statusOf(p: RegistryPage): 'Built' | 'Planned' | 'Changed on purpose' {
  if (p.changedOnPurpose) return 'Changed on purpose';
  return p.status === 'built' ? 'Built' : 'Planned';
}

export function AdminRegistryPage() {
  const [reg, setReg] = useState<RegistryV2 | null>(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getRegistryV2()
      .then((r) => alive && setReg(r))
      .catch((e: unknown) => alive && setError(e instanceof ApiError ? e.message : 'Something went wrong.'));
    return () => {
      alive = false;
    };
  }, []);

  const needle = q.trim().toLowerCase();
  const shown = useMemo(
    () =>
      (reg?.pages ?? []).filter(
        (p) => needle === '' || p.id.includes(needle) || p.title.toLowerCase().includes(needle),
      ),
    [reg, needle],
  );
  const byFamily = useMemo(() => {
    const m = new Map<string, RegistryPage[]>();
    for (const p of shown) m.set(p.family, [...(m.get(p.family) ?? []), p]);
    return m;
  }, [shown]);
  const card = reg?.pages.find((p) => p.id === selected) ?? null;

  return (
    <>
      <PageHead
        title="Page Registry"
        sub="Every V40 page with its tabs, fields and buttons, and whether it is built, planned or changed on purpose."
      />
      <ErrorBox message={error} />
      <label>
        <span className="sr-only">Search pages</span>
        <input type="search" placeholder="Search page or id…" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      {reg ? (
        <p className="v8-sub" role="status">
          {reg.pages.length} pages · {reg.pages.filter((p) => p.status === 'built').length} built ·{' '}
          {reg.pages.filter((p) => p.status === 'planned').length} planned
        </p>
      ) : null}
      <div className="registry-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 1fr) 2fr', gap: 16 }}>
        <div className="card" aria-label="Families">
          {[...byFamily.entries()].map(([family, pages]) => (
            <details key={family} open={needle !== ''}>
              <summary>
                {family} <span className="v8-sub">({pages.length})</span>
              </summary>
              <ul>
                {pages.map((p) => (
                  <li key={p.id}>
                    <button type="button" className="link" onClick={() => setSelected(p.id)}>
                      {p.title}
                    </button>{' '}
                    <Pill tone={p.status === 'built' ? 'active' : 'draft'}>{statusOf(p)}</Pill>
                  </li>
                ))}
              </ul>
            </details>
          ))}
          {reg && shown.length === 0 ? <p>No pages match your search.</p> : null}
        </div>
        <div className="card" aria-live="polite">
          {card ? (
            <>
              <h2>{card.title}</h2>
              <p className="v8-sub">
                <code>{card.id}</code> · {card.family} · <b>{statusOf(card)}</b>
                {card.ownerPhase ? ` · Phase ${card.ownerPhase}` : ''}
              </p>
              {card.changedOnPurpose ? <p>{card.changedOnPurpose}</p> : null}
              <h3>Tabs</h3>
              <ul>{card.tabs.length ? card.tabs.map((t) => <li key={t}>{t}</li>) : <li>—</li>}</ul>
              <h3>Fields</h3>
              <p>{card.fields.length ? card.fields.join(' · ') : '—'}</p>
              <h3>Buttons</h3>
              <p>{card.buttons.length ? card.buttons.join(' · ') : '—'}</p>
            </>
          ) : (
            <p>Pick a page on the left to see its tabs, fields and buttons.</p>
          )}
        </div>
      </div>
    </>
  );
}
