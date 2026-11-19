// Phase 23: Home - the landing page. One call (GET /me/home) gives the user's own work, quick-create tiles,
// shortcuts, recent pages, announcements and "What's new". A counter whose module is not built yet shows
// "—", never 0.
import { Link, Navigate } from 'react-router-dom';
import { useSession } from '../auth/AuthProvider';
import { homeApi } from '../lib/homeApi';
import { usePlants } from '../lib/plants';
import { useLoad } from '../lib/useLoad';
import { RoleDashboard } from './roledash/RoleDashboard';

const dash = (n: number | null): string => (n === null || n === undefined ? '—' : String(n));

export function HomePage() {
  const user = useSession().user;
  const home = useLoad(() => homeApi.home(), []);
  const plants = usePlants().data;
  const d = home.data;

  // the user's own (or role's) landing page, when it is a real page other than Home
  if (d && d.landingPage !== 'home' && d.landingPage !== 'my-dashboard') {
    return <Navigate to={`/m/${d.landingPage}`} replace />;
  }
  if (home.error) return <p role="alert">{home.error}</p>;
  if (!d) return <p className="muted">Loading your home…</p>;

  const chosen = plants?.allowed.filter((p) => plants.selected.includes(p.id)) ?? [];
  // V39 department workspace: the 8 queue cards, in V39 order. Counts come from GET /me/home; where the API has
  // no count yet (shift & handover, visitors, canteen) the card shows "—" - never an invented 0.
  const work: { key: string; label: string; value: number | null; to: string; red?: boolean }[] = [
    { key: 'receive', label: 'Receive Documents', value: d.work.toReceive, to: '/m/document-movement-center' },
    { key: 'accept', label: 'Accept Responsibility', value: d.work.toAccept, to: '/m/document-movement-center' },
    { key: 'work', label: 'Complete Department Work', value: d.work.inWork, to: '/m/document-movement-center' },
    { key: 'appr', label: 'Approval Required', value: d.work.myApprovals, to: '/approvals' },
    { key: 'tasks', label: 'Employee Tasks', value: d.work.myTasks, to: '/m/ops-tasks' },
    { key: 'shift', label: 'Shift & Handover', value: null, to: '/m/ops-shift-roster' },
    { key: 'visitor', label: 'Visitor / Gate', value: null, to: '/m/ops-visitors' },
    { key: 'canteen', label: 'Canteen / Meal', value: null, to: '/m/ops-canteen' },
  ];
  const more: { key: string; label: string; value: number | null; to: string; red?: boolean }[] = [
    { key: 'ret', label: 'Returned to me', value: d.work.returnedToMe, to: '/approvals' },
    { key: 'draft', label: 'My Drafts', value: d.work.myDrafts, to: '/menu' },
    { key: 'over', label: 'Overdue', value: d.work.overdue, to: '/approvals', red: true },
  ];

  return (
    <div className="home-page">
      {user ? <RoleDashboard user={user} home={d} plants={chosen.map((p) => p.name)} /> : null}

      <section aria-label="My work">
        <h2>Department workspace</h2>
        <div className="work-strip">
          {work.map((w) => (
            <Link key={w.key} to={w.to} className={`work-tile${w.red && (w.value ?? 0) > 0 ? ' red' : ''}`}>
              <span className="work-num">{dash(w.value)}</span>
              <span className="work-label">{w.label}</span>
            </Link>
          ))}
        </div>
        <div className="work-strip work-strip-more" aria-label="Also waiting">
          {more.map((w) => (
            <Link key={w.key} to={w.to} className={`work-tile${w.red && (w.value ?? 0) > 0 ? ' red' : ''}`}>
              <span className="work-num">{dash(w.value)}</span>
              <span className="work-label">{w.label}</span>
            </Link>
          ))}
        </div>
      </section>

      {d.quickCreate.length > 0 ? (
        <section aria-label="Quick create">
          <h2>Quick create</h2>
          <div className="tile-row">
            {d.quickCreate.map((q) => (
              <Link key={q.pageId} className="tile" to={`/m/${q.pageId}`}>
                ＋ {q.label}
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section aria-label="Shortcuts">
        <h2>Shortcuts</h2>
        {d.shortcuts.length === 0 ? (
          <p className="muted">Star a page in the Menu and it appears here.</p>
        ) : (
          <div className="tile-row">
            {d.shortcuts.map((s) => (
              <Link key={s.id} className="tile" to={`/m/${s.id}`}>
                ⭐ {s.title}
              </Link>
            ))}
          </div>
        )}
      </section>

      {d.recent.length > 0 ? (
        <section aria-label="Recent">
          <h2>Recent</h2>
          <div className="tile-row">
            {d.recent.map((s) => (
              <Link key={s.id} className="tile" to={`/m/${s.id}`}>
                🕘 {s.title}
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {d.announcements.length > 0 ? (
        <section aria-label="Announcements">
          <h2>Announcements</h2>
          <ul className="plain-list">
            {d.announcements.map((a) => (
              <li key={a.id}>{a.title}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {d.whatsNew && d.whatsNew.lines.length > 0 ? (
        <section aria-label="What's new">
          <h2>What&apos;s new</h2>
          <p className="muted">{d.whatsNew.title}</p>
          <ul className="plain-list">
            {d.whatsNew.lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
