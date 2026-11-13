// Phase 23: the personal Menu page - every module the user may open as a card, with search (Ctrl+K),
// favourites and recent pages. Families and pages come from the server (registry x permissions).
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { homeApi, type MenuFamilyDto, type SearchDto } from '../lib/homeApi';
import { useLoad } from '../lib/useLoad';

export function MenuPage() {
  const navigate = useNavigate();
  const menu = useLoad(() => homeApi.menu(), []);
  const [q, setQ] = useState('');
  const [found, setFound] = useState<SearchDto | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [favs, setFavs] = useState<string[] | null>(null);
  const search = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        search.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (q.trim().length < 2) {
      setFound(null);
      return;
    }
    const t = setTimeout(() => {
      homeApi.search(q).then(setFound, () => setFound(null));
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  const families: MenuFamilyDto[] = menu.data?.families ?? [];
  const favourites = favs ?? menu.data?.prefs.favourites ?? [];
  const titleOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of families) for (const p of f.pages) m.set(p.id, p.title);
    return m;
  }, [families]);

  async function toggleFav(id: string) {
    const next = favourites.includes(id)
      ? await homeApi.unfavourite(id)
      : await homeApi.favourite(id);
    setFavs(next.favourites);
  }

  const go = (id: string) => {
    void homeApi.touchRecent(id);
    navigate(`/m/${id}`);
  };

  if (menu.error) return <p role="alert">{menu.error}</p>;

  return (
    <div className="menu-page">
      <div className="page-head">
        <div>
          <h1>Menu</h1>
          <p className="muted">All the modules you can open. Press Ctrl+K to search from anywhere.</p>
        </div>
      </div>
      <input
        ref={search}
        className="menu-search"
        type="search"
        placeholder="Search pages, or type “create …”"
        aria-label="Search the menu"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {found ? (
        <div className="menu-results" role="listbox" aria-label="Search results">
          {found.create.map((c) => (
            <button key={`c-${c.id}`} type="button" className="menu-result" onClick={() => go(c.id)}>
              ＋ {c.label}
            </button>
          ))}
          {found.pages.map((p) => (
            <button key={p.id} type="button" className="menu-result" onClick={() => go(p.id)}>
              {p.title} <span className="muted">· {p.family}</span>
            </button>
          ))}
          {found.recent.map((p) => (
            <button key={`r-${p.id}`} type="button" className="menu-result" onClick={() => go(p.id)}>
              🕘 {p.title}
            </button>
          ))}
          {found.pages.length + found.create.length + found.recent.length === 0 ? (
            <p className="muted">No pages match your search.</p>
          ) : null}
        </div>
      ) : null}

      <section aria-label="Favourites">
        <h2>⭐ Favourites</h2>
        {favourites.length === 0 ? (
          <p className="muted">Press ☆ next to a page to keep it here.</p>
        ) : (
          <div className="tile-row">
            {favourites.map((id) => (
              <Link key={id} className="tile" to={`/m/${id}`} onClick={() => void homeApi.touchRecent(id)}>
                {titleOf.get(id) ?? id}
              </Link>
            ))}
          </div>
        )}
      </section>

      <section aria-label="All modules">
        <h2>All modules</h2>
        {menu.loading && !menu.data ? <p className="muted">Loading…</p> : null}
        {!menu.loading && families.length === 0 ? (
          <p className="muted">No modules are open to you yet. Ask your administrator.</p>
        ) : null}
        <div className="family-grid">
          {families.map((f) => (
            <div key={f.name} className={`family-card${open === f.name ? ' open' : ''}`}>
              <button
                type="button"
                className="family-head"
                aria-expanded={open === f.name}
                onClick={() => setOpen(open === f.name ? null : f.name)}
              >
                <span className="family-icon" aria-hidden="true">
                  {f.icon}
                </span>
                <span className="family-name">{f.name}</span>
                <span className="family-count">{f.pages.length} pages</span>
                {f.badge ? <span className="badge">{f.badge}</span> : null}
              </button>
              {open === f.name ? (
                <ul className="family-pages">
                  {f.pages.map((p) => (
                    <li key={p.id}>
                      <Link to={`/m/${p.id}`} onClick={() => void homeApi.touchRecent(p.id)}>
                        {p.title}
                      </Link>
                      <button
                        type="button"
                        className="star"
                        aria-label={`${favourites.includes(p.id) ? 'Remove' : 'Add'} ${p.title} ${favourites.includes(p.id) ? 'from' : 'to'} favourites`}
                        aria-pressed={favourites.includes(p.id)}
                        onClick={() => void toggleFav(p.id)}
                      >
                        {favourites.includes(p.id) ? '⭐' : '☆'}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
