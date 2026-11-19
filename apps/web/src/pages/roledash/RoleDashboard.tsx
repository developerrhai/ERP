// The first screen after login: a dashboard built for the signed-in user's role (see roleDashConfig.ts). It shows who
// is signed in and what that role may see, the role's own counters, the role's page groups, the live pages the user
// really has in the menu (their access, from GET /me/menu-v2) and - for the roles that manage others - recent activity
// and active projects. Every number comes from the API; a number that cannot be read shows "—".
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { homeApi, type HomeDto, type MenuFamilyDto } from '../../lib/homeApi';
import { projectsApi, type Project } from '../../lib/projectsApi';
import { workApi, type AuditRow, type InboxCounts } from '../../lib/workApi';
import type { User } from '../../types';
import { dashboardFor, type Kpi } from './roleDashConfig';
import './roledash.css';

const ADMIN_LEVEL = 95;

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch {
    return null;
  }
}

const show = (n: number | null | undefined): string => (n === null || n === undefined ? '—' : String(n));

function kpiValue(k: Kpi, home: HomeDto | null, counts: InboxCounts | null): number | null {
  const [kind, key] = k.source.split(':') as ['w' | 'c', string];
  const src = (kind === 'w' ? home?.work : counts) as Record<string, number | null> | null | undefined;
  const v = src?.[key];
  return typeof v === 'number' ? v : null;
}

function greeting(d = new Date()): string {
  const h = d.getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

const when = (iso: string): string =>
  new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

export function RoleDashboard({ user, home, plants = [] }: { user: User; home: HomeDto | null; plants?: string[] }) {
  const dash = useMemo(() => dashboardFor(user.roleCode ?? user.role, user.roleLevel), [user.roleCode, user.role, user.roleLevel]);
  const elevated = (user.roleLevel ?? 0) >= ADMIN_LEVEL;
  const [counts, setCounts] = useState<InboxCounts | null>(null);
  const [families, setFamilies] = useState<MenuFamilyDto[] | null>(null);
  const [activity, setActivity] = useState<AuditRow[] | null>(null);
  const [projects, setProjects] = useState<Project[] | null>(null);

  const wantsActivity = dash.panels.includes('activity');
  const wantsProjects = dash.panels.includes('projects');

  useEffect(() => {
    let alive = true;
    const scope = elevated && dash.companyWide ? 'all' : undefined;
    void (async () => {
      const [c, menu, audit, proj] = await Promise.all([
        safe(workApi.counts(scope)),
        safe(homeApi.menu()),
        wantsActivity ? safe(workApi.audit(scope)) : Promise.resolve(null),
        wantsProjects ? safe(projectsApi.list({ status: 'ACTIVE', size: 5 })) : Promise.resolve(null),
      ]);
      if (!alive) return;
      setCounts(c);
      setFamilies(menu ? menu.families : null);
      setActivity(audit ? audit.slice(0, 6) : audit);
      setProjects(proj ? proj.rows.slice(0, 5) : proj);
    })();
    return () => {
      alive = false;
    };
  }, [dash.key, dash.companyWide, elevated, wantsActivity, wantsProjects]);

  const pageCount = families ? families.reduce((n, f) => n + f.pages.length, 0) : null;
  const depts = [user.department, ...(user.extraDepartments ?? [])].filter((x): x is string => !!x);

  return (
    <div className="role-dash" data-testid="role-dashboard" data-role={dash.key}>
      <section className="rd-hero" aria-labelledby="rd-title">
        <div className="rd-hero-top">
          <span className="rd-badge">{dash.title}</span>
          <span className="rd-date">
            {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </span>
        </div>
        <h1 id="rd-title">
          {greeting()}, {user.name}
        </h1>
        <p className="rd-tagline">{dash.tagline}</p>
        <div className="rd-chips">
          <span className="chip">{user.roleName || user.roleLabel || dash.title}</span>
          {depts.length > 0 ? depts.map((d) => <span key={d} className="chip">{d}</span>) : <span className="chip">All departments</span>}
          {plants.map((n) => (
            <span key={n} className="chip">
              {n}
            </span>
          ))}
          {user.approvalLimit ? <span className="chip">Approval limit ₹ {Number(user.approvalLimit).toLocaleString('en-IN')}</span> : null}
          {user.previousLoginAt ? <span className="chip">Last login {when(user.previousLoginAt)}</span> : null}
        </div>
      </section>

      <section aria-label="Key numbers" className="rd-kpis">
        {dash.kpis.map((k) => {
          const v = kpiValue(k, home, counts);
          return (
            <Link key={k.label} to={k.to} className={`rd-kpi${k.red && (v ?? 0) > 0 ? ' red' : ''}`}>
              <span className="rd-kpi-num">{show(v)}</span>
              <span className="rd-kpi-label">{k.label}</span>
            </Link>
          );
        })}
      </section>

      <div className="rd-grid">
        <section className="rd-card" aria-label="Your access">
          <h2>What you can see</h2>
          <ul className="rd-list">
            {dash.scope.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
          <p className="rd-note">
            Open to you now: <b>{show(families ? families.length : null)}</b> modules, <b>{show(pageCount)}</b> pages.
          </p>
          {families && families.length > 0 ? (
            <div className="rd-fams">
              {families.slice(0, 14).map((f) => (
                <span key={f.name} className="rd-fam" title={`${f.pages.length} pages`}>
                  {f.name} <b>{f.pages.length}</b>
                </span>
              ))}
              {families.length > 14 ? <Link to="/menu" className="rd-fam">+{families.length - 14} more</Link> : null}
            </div>
          ) : null}
        </section>

        {dash.groups.map((g) => (
          <section key={g.title} className="rd-card" aria-label={g.title}>
            <h2>{g.title}</h2>
            <div className="rd-links">
              {g.links.map((x) => (
                <Link key={x.to} to={x.to} className="rd-link">
                  {x.label}
                </Link>
              ))}
            </div>
          </section>
        ))}

        {wantsProjects ? (
          <section className="rd-card rd-wide" aria-label="Active projects">
            <h2>Active projects</h2>
            {projects === null ? (
              <p className="muted">Could not load projects.</p>
            ) : projects.length === 0 ? (
              <p className="muted">No active projects.</p>
            ) : (
              <ul className="rd-rows">
                {projects.map((p) => (
                  <li key={p.id}>
                    <b>{p.project_no}</b> <span>{p.name}</span>
                    {p.customer_name ? <span className="muted"> · {p.customer_name}</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}

        {wantsActivity ? (
          <section className="rd-card rd-wide" aria-label="Recent activity">
            <h2>Recent activity</h2>
            {activity === null ? (
              <p className="muted">Could not load activity.</p>
            ) : activity.length === 0 ? (
              <p className="muted">No recent activity.</p>
            ) : (
              <ul className="rd-rows">
                {activity.map((a, i) => (
                  <li key={`${a.number}-${a.at}-${i}`}>
                    <b>{a.number}</b> <span>{a.event}</span>
                    {a.department ? <span className="muted"> · {a.department}</span> : null}
                    <span className="muted"> · {a.actor ?? 'system'} · {when(a.at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}
      </div>
    </div>
  );
}
