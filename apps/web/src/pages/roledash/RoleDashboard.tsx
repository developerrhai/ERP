// The first screen after login: a dashboard built for the signed-in user's role (see roleDashConfig.ts). It shows who
// is signed in and what that role may see, the role's own counters, the role's page groups, the live pages the user
// really has in the menu (their access, from GET /me/menu-v2) and - for the roles that manage others - recent activity
// and active projects. Every number comes from the API; a number that cannot be read shows "—".
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { homeApi, type HomeDto, type MenuFamilyDto } from '../../lib/homeApi';
import { biApi } from '../../lib/biApi';
import { dashApi, type MyDashboard, type OwnerDashboard } from '../../lib/dashApi';
import { projectsApi, type Project } from '../../lib/projectsApi';
import { workApi, type AuditRow, type InboxCounts } from '../../lib/workApi';
import type { User } from '../../types';
import { fmt, type Analytics } from '../bi/analyticsModel';
import { Donut, HBars, PALETTE, Trend, compactNum, type Slice } from './DashCharts';
import { dashboardFor, type ChartSpec, type Kpi, type RoleDash } from './roleDashConfig';
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

const STATUS_COLOR: Record<string, string> = { DRAFT: '#94a3b8', SUBMITTED: '#2563eb', APPROVED: '#16a34a', POSTED: '#06b6d4', REJECTED: '#ef4444', RETURNED: '#f59e0b', CANCELLED: '#64748b' };
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);
const short = (p: unknown): string => String(p ?? '').slice(0, 7);

interface ChartData {
  home: HomeDto | null;
  counts: InboxCounts | null;
  mine: MyDashboard | null;
  owner: OwnerDashboard | null;
  analytics: Partial<Record<string, Analytics | null>>;
}
type Rendered = { body: JSX.Element; to?: string };

/** Builds the card body of one chart spec, or null when its data is not available to this user. */
function renderChart(c: ChartSpec, d: ChartData): Rendered | null {
  switch (c.type) {
    case 'work': {
      const w = d.home?.work;
      if (!w) return null;
      const s: Slice[] = [
        { label: 'To receive', value: num(w.toReceive), to: '/m/document-movement-center', color: '#2563eb' },
        { label: 'To accept', value: num(w.toAccept), to: '/m/document-movement-center', color: '#06b6d4' },
        { label: 'In work', value: num(w.inWork), to: '/m/document-movement-center', color: '#16a34a' },
        { label: 'Approvals', value: num(w.myApprovals), to: '/approvals', color: '#9333ea' },
        { label: 'Tasks', value: num(w.myTasks), to: '/m/ops-tasks', color: '#f59e0b' },
        { label: 'Returned', value: num(w.returnedToMe), to: '/approvals', color: '#ec4899' },
        { label: 'Overdue', value: num(w.overdue), to: '/approvals', color: '#ef4444' },
      ];
      return { body: <Donut slices={s} centre={String(s.reduce((a, x) => a + x.value, 0))} label={c.title} /> };
    }
    case 'inbox': {
      const k = d.counts;
      if (!k) return null;
      return {
        to: '/m/dept-inbox',
        body: (
          <HBars
            label={c.title}
            items={[
              { label: 'Awaiting receipt', value: k.pendingReceipt, to: '/m/dept-inbox', color: '#2563eb' },
              { label: 'Awaiting acceptance', value: k.pendingAcceptance, to: '/m/dept-inbox', color: '#06b6d4' },
              { label: 'In work', value: k.work, to: '/m/dept-work', color: '#16a34a' },
              { label: 'Waiting approval', value: k.approval, to: '/approvals', color: '#9333ea' },
              { label: 'Ready to send', value: k.ready, to: '/m/dept-inbox', color: '#f59e0b' },
              { label: 'Waiting on others', value: k.sentWaiting, to: '/m/document-movement-center', color: '#64748b' },
              { label: 'Returned', value: k.returned, to: '/m/dept-inbox', color: '#ef4444' },
            ]}
          />
        ),
      };
    }
    case 'docs': {
      const rows = d.mine?.myDocumentsByStatus;
      if (!rows) return null;
      const s = rows.map((r, i) => ({ label: r.status, value: num(r.count), color: STATUS_COLOR[r.status.toUpperCase()] ?? PALETTE[i % PALETTE.length], to: '/m/business-documents' }));
      return { body: <Donut slices={s} centre={String(s.reduce((a, x) => a + x.value, 0))} label={c.title} /> };
    }
    case 'age': {
      const rows = d.owner?.approvalsByAge;
      if (!rows) return null;
      const tone = ['#16a34a', '#f59e0b', '#f97316', '#ef4444'];
      return { to: '/approvals', body: <HBars label={c.title} items={rows.map((r, i) => ({ label: r.label, value: num(r.count), to: '/approvals', color: tone[Math.min(i, tone.length - 1)] }))} /> };
    }
    case 'trend': {
      const ds = d.analytics[c.kind]?.datasets[c.dataset];
      if (!ds || ds.rows.length === 0) return null;
      const labels = ds.rows.map((r) => short(r.period));
      const series = c.series.map((s) => ({ name: s.name, color: s.color, values: ds.rows.map((r) => (r[s.key] === null || r[s.key] === undefined ? null : num(r[s.key]))) }));
      return { to: c.to, body: <Trend labels={labels} series={series} label={c.title} to={c.to} /> };
    }
    case 'top': {
      const ds = d.analytics[c.kind]?.datasets[c.dataset];
      if (!ds || ds.rows.length === 0) return null;
      const type = ds.columns.find((x) => x.key === c.valueKey)?.type ?? 'num';
      const items = ds.rows
        .map((r) => ({ label: String(r[c.labelKey] ?? '—'), value: num(r[c.valueKey]), to: c.to }))
        .sort((x, y) => y.value - x.value)
        .slice(0, c.limit);
      return { to: c.to, body: <HBars label={c.title} items={items} format={(n) => (type === 'inr' ? `₹${compactNum(n)}` : fmt(n, type))} /> };
    }
    case 'group': {
      const ds = d.analytics[c.kind]?.datasets[c.dataset];
      if (!ds || ds.rows.length === 0) return null;
      const m = new Map<string, number>();
      for (const r of ds.rows) {
        const g = String(r[c.groupKey] ?? '—');
        m.set(g, (m.get(g) ?? 0) + 1);
      }
      const col: Record<string, string> = { Shortage: '#ef4444', Overstock: '#f59e0b' };
      const s = [...m].map(([label, value], i) => ({ label, value, to: c.to, color: col[label] ?? PALETTE[i % PALETTE.length] }));
      return { body: <Donut slices={s} centre={String(ds.rows.length)} label={c.title} /> };
    }
  }
}

function ChartCards({ dash, data }: { dash: RoleDash; data: ChartData }) {
  const cards: { c: ChartSpec; r: Rendered }[] = [];
  for (const c of dash.charts) {
    const r = renderChart(c, data);
    if (r) cards.push({ c, r });
  }
  if (cards.length === 0) return null;
  return (
    <section aria-label="Charts" className="rd-charts">
      {cards.map(({ c, r }) => (
        <article key={c.title} className={`rd-card rd-chart${c.type === 'trend' ? ' rd-chart-wide' : ''}`}>
          <header>
            <h2>{c.title}</h2>
            {r.to ? (
              <Link to={r.to} className="rd-open">
                Open →
              </Link>
            ) : null}
          </header>
          {r.body}
        </article>
      ))}
    </section>
  );
}

export function RoleDashboard({ user, home, plants = [] }: { user: User; home: HomeDto | null; plants?: string[] }) {
  const dash = useMemo(() => dashboardFor(user.roleCode ?? user.role, user.roleLevel), [user.roleCode, user.role, user.roleLevel]);
  const elevated = (user.roleLevel ?? 0) >= ADMIN_LEVEL;
  const [counts, setCounts] = useState<InboxCounts | null>(null);
  const [families, setFamilies] = useState<MenuFamilyDto[] | null>(null);
  const [activity, setActivity] = useState<AuditRow[] | null>(null);
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [mine, setMine] = useState<MyDashboard | null>(null);
  const [owner, setOwner] = useState<OwnerDashboard | null>(null);
  const [analytics, setAnalytics] = useState<Partial<Record<string, Analytics | null>>>({});

  const wantsActivity = dash.panels.includes('activity');
  const wantsProjects = dash.panels.includes('projects');

  useEffect(() => {
    let alive = true;
    const scope = elevated && dash.companyWide ? 'all' : undefined;
    void (async () => {
      const kinds = [...new Set(dash.charts.flatMap((c) => ('kind' in c ? [c.kind] : [])))];
      const wantsMine = dash.charts.some((c) => c.type === 'docs');
      const wantsOwner = dash.charts.some((c) => c.type === 'age');
      const [c, menu, audit, proj, my, own, an] = await Promise.all([
        safe(workApi.counts(scope)),
        safe(homeApi.menu()),
        wantsActivity ? safe(workApi.audit(scope)) : Promise.resolve(null),
        wantsProjects ? safe(projectsApi.list({ status: 'ACTIVE', size: 5 })) : Promise.resolve(null),
        wantsMine ? safe(dashApi.my()) : Promise.resolve(null),
        wantsOwner ? safe(dashApi.owner()) : Promise.resolve(null),
        Promise.all(kinds.map(async (k) => [k, await safe(biApi.getAnalytics(k))] as const)),
      ]);
      if (!alive) return;
      setCounts(c);
      setFamilies(menu ? menu.families : null);
      setActivity(audit ? audit.slice(0, 6) : audit);
      setProjects(proj ? proj.rows.slice(0, 5) : proj);
      setMine(my);
      setOwner(own);
      setAnalytics(Object.fromEntries(an));
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

      <ChartCards dash={dash} data={{ home, counts, mine, owner, analytics }} />

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
