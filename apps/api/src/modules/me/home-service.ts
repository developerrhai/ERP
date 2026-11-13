// Phase 23: the personal Menu page and Home. Everything is built from what the user may open
// (registry x permissions), never from made-up numbers: a counter whose module is not built yet is null
// and the screen shows a dash.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { AuthContext } from '../../core/auth/auth-context';
import { prisma } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { accessProfile, accessUserOf } from '../../core/rbac/access';
import { pageInfo, registry } from '../../core/registry';
import { approvalQueries } from '../approvals/queries';
import { broadcastService } from '../notifications/broadcast-service';

export interface MenuPage {
  id: string;
  title: string;
  favourite: boolean;
}
export interface MenuFamilyV2 {
  name: string;
  icon: string;
  pages: MenuPage[];
  /** pending items in this family; null = not tracked yet */
  badge: number | null;
}
export interface HomePrefs {
  pinnedPages: string[];
  hiddenFamilies: string[];
  familyOrder: string[];
  favourites: string[];
  landing: string;
  theme: 'light' | 'dark';
  density: 'comfortable' | 'compact';
}

const DEFAULT_PREFS: HomePrefs = {
  pinnedPages: [],
  hiddenFamilies: [],
  familyOrder: [],
  favourites: [],
  landing: 'home',
  theme: 'light',
  density: 'comfortable',
};

/** Quick-create tiles: shown only when the user may add on that page. */
const QUICK_CREATE: { pageId: string; label: string }[] = [
  { pageId: 'crm-leads', label: 'Lead' },
  { pageId: 'sales-quotations', label: 'Quotation' },
  { pageId: 'sales-orders', label: 'Sales Order' },
  { pageId: 'scm-pr', label: 'Purchase Request' },
  { pageId: 'proj-tasks', label: 'Task' },
  { pageId: 'hr-leave', label: 'Leave' },
  { pageId: 'hr-expense', label: 'Expense' },
  { pageId: 'hr-employees', label: 'Employee' },
];

async function loadPrefs(userId: string): Promise<HomePrefs> {
  const rows = await prisma.$queryRaw<
    {
      pinned_pages: string[];
      hidden_families: string[];
      family_order: string[];
      favourites: string[];
      landing: string;
      theme: 'light' | 'dark';
      density: 'comfortable' | 'compact';
    }[]
  >`SELECT pinned_pages, hidden_families, family_order, favourites, landing, theme, density
      FROM user_home_prefs WHERE user_id = ${userId}::uuid`;
  const r = rows[0];
  if (!r) return { ...DEFAULT_PREFS };
  return {
    pinnedPages: r.pinned_pages,
    hiddenFamilies: r.hidden_families,
    familyOrder: r.family_order,
    favourites: r.favourites,
    landing: r.landing,
    theme: r.theme,
    density: r.density,
  };
}

async function savePrefs(userId: string, p: HomePrefs): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO user_home_prefs (user_id, pinned_pages, hidden_families, family_order, favourites, landing, theme, density, updated_at)
    VALUES (${userId}::uuid, ${p.pinnedPages}::text[], ${p.hiddenFamilies}::text[], ${p.familyOrder}::text[],
            ${p.favourites}::text[], ${p.landing}, ${p.theme}, ${p.density}, now())
    ON CONFLICT (user_id) DO UPDATE SET pinned_pages = EXCLUDED.pinned_pages, hidden_families = EXCLUDED.hidden_families,
      family_order = EXCLUDED.family_order, favourites = EXCLUDED.favourites, landing = EXCLUDED.landing,
      theme = EXCLUDED.theme, density = EXCLUDED.density, updated_at = now()`;
}

function assertPage(pageId: string): void {
  if (!pageInfo(pageId)) throw Errors.notFound('Unknown page.');
}

/** The newest section of docs/clicntmassage.md ("What's new"), or null when the file is not there. */
function whatsNew(): { title: string; lines: string[] } | null {
  try {
    const text = readFileSync(path.resolve(__dirname, '../../../../../docs/clicntmassage.md'), 'utf8');
    const parts = text.split(/\n(?=#{1,3} )/);
    const section = parts.find((p, i) => i > 0 && /^#{1,3} /.test(p)) ?? parts[0];
    if (!section) return null;
    const [head = '', ...rest] = section.split('\n');
    const lines = rest.map((l) => l.replace(/^[-*]\s*/, '').trim()).filter((l) => l !== '').slice(0, 6);
    return { title: head.replace(/^#+\s*/, ''), lines };
  } catch {
    return null;
  }
}

export const homeService = {
  /** GET /me/menu-v2: families and pages the user may open, with favourites and the user's own order. */
  async menu(auth: AuthContext): Promise<{ families: MenuFamilyV2[]; prefs: HomePrefs }> {
    const [profile, prefs] = await Promise.all([accessProfile(accessUserOf(auth.user)), loadPrefs(auth.userId)]);
    const fav = new Set(prefs.favourites);
    let families: MenuFamilyV2[] = [];
    for (const family of registry.data.families) {
      const pages = family.items
        .filter((item) => profile.get(item.id)?.actions.view === true)
        .map((item) => ({ id: item.id, title: item.title, favourite: fav.has(item.id) }));
      if (pages.length > 0) families.push({ name: family.name, icon: family.icon, pages, badge: null });
    }
    families = families.filter((f) => !prefs.hiddenFamilies.includes(f.name));
    if (prefs.familyOrder.length > 0) {
      const rank = (n: string) => {
        const i = prefs.familyOrder.indexOf(n);
        return i === -1 ? 9999 : i;
      };
      families.sort((a, b) => rank(a.name) - rank(b.name));
    }
    return { families, prefs };
  },

  /** GET /me/search?q= : pages (2+ letters), "Create ..." actions and recent pages. */
  async search(auth: AuthContext, q: string) {
    const needle = q.trim().toLowerCase();
    if (needle.length < 2) return { pages: [], create: [], recent: [] };
    const profile = await accessProfile(accessUserOf(auth.user));
    const pages: { id: string; title: string; family: string }[] = [];
    for (const family of registry.data.families) {
      for (const item of family.items) {
        if (profile.get(item.id)?.actions.view !== true) continue;
        if (item.title.toLowerCase().includes(needle) || item.id.toLowerCase().includes(needle)) {
          pages.push({ id: item.id, title: item.title, family: family.name });
        }
      }
    }
    const create = pages
      .filter((p) => profile.get(p.id)?.actions.add === true)
      .slice(0, 5)
      .map((p) => ({ id: p.id, label: `Create ${p.title}` }));
    const recentRows = await prisma.$queryRaw<{ page_id: string }[]>`
      SELECT page_id FROM recent_pages WHERE user_id = ${auth.userId}::uuid ORDER BY opened_at DESC LIMIT 20`;
    const recent = recentRows
      .map((r) => pageInfo(r.page_id))
      .filter((p): p is NonNullable<typeof p> => !!p && p.title.toLowerCase().includes(needle))
      .slice(0, 5)
      .map((p) => ({ id: p.id, title: p.title }));
    return { pages: pages.slice(0, 12), create, recent };
  },

  /** GET /home: everything the landing page needs in one call. */
  async home(auth: AuthContext, unitIds: string[] = []) {
    const depNames = accessUserOf(auth.user).departments;
    const [profile, prefs, counts, recentRows, broadcasts, moves] = await Promise.all([
      accessProfile(accessUserOf(auth.user)),
      loadPrefs(auth.userId),
      approvalQueries.counts(auth),
      prisma.$queryRaw<{ page_id: string }[]>`
        SELECT page_id FROM recent_pages WHERE user_id = ${auth.userId}::uuid ORDER BY opened_at DESC LIMIT 8`,
      broadcastService.listActiveForUser(auth.userId).catch(() => []),
      // Phase 25: the department's movement queues in the chosen plants (real counts: the module is built)
      prisma.$queryRaw<{ r: number; a: number; w: number; ret: number }[]>`
        SELECT count(*) FILTER (WHERE m.state = 'SENT' AND td.name = ANY(${depNames}::text[]))::int AS r,
               count(*) FILTER (WHERE m.state = 'RECEIVED' AND td.name = ANY(${depNames}::text[]))::int AS a,
               count(*) FILTER (WHERE m.state IN ('ACCEPTED','IN_WORK','WAITING_APPROVAL') AND td.name = ANY(${depNames}::text[]))::int AS w,
               count(*) FILTER (WHERE m.state = 'RETURNED' AND m.sent_by_id = ${auth.userId}::uuid)::int AS ret
          FROM work_movements m JOIN departments td ON td.id = m.to_department_id
         WHERE m.unit_id = ANY(${unitIds}::uuid[]) OR m.to_unit_id = ANY(${unitIds}::uuid[])`,
    ]);
    const mv = moves[0];
    const tile = (id: string) => {
      const info = pageInfo(id);
      return info && profile.get(id)?.actions.view === true ? { id: info.id, title: info.title } : null;
    };
    const tiles = (ids: string[]) => ids.map(tile).filter((t): t is { id: string; title: string } => t !== null);
    return {
      user: {
        name: auth.user.name,
        role: (auth.user as { role?: { name?: string } }).role?.name ?? null,
        department: auth.user.department ?? null,
      },
      // null = the module that fills this counter is not built yet: the screen shows a dash, never 0
      work: {
        toReceive: mv?.r ?? 0,
        toAccept: mv?.a ?? 0,
        inWork: mv?.w ?? 0,
        myApprovals: counts.waitingForMe,
        myTasks: null,
        returnedToMe: mv?.ret ?? 0,
        myDrafts: null,
        overdue: counts.overdue,
      },
      quickCreate: QUICK_CREATE.filter((q) => profile.get(q.pageId)?.actions.add === true && pageInfo(q.pageId)),
      shortcuts: tiles([...prefs.pinnedPages, ...prefs.favourites.filter((f) => !prefs.pinnedPages.includes(f))]),
      recent: tiles(recentRows.map((r) => r.page_id)),
      announcements: broadcasts,
      whatsNew: whatsNew(),
      landing: prefs.landing,
    };
  },

  async getPrefs(userId: string): Promise<HomePrefs> {
    return loadPrefs(userId);
  },

  async putPrefs(userId: string, patch: Partial<HomePrefs>): Promise<HomePrefs> {
    const cur = await loadPrefs(userId);
    const next: HomePrefs = { ...cur, ...patch };
    for (const id of [...next.pinnedPages, ...next.favourites]) assertPage(id);
    if (next.landing !== 'home' && next.landing !== 'my-dashboard') assertPage(next.landing);
    await savePrefs(userId, next);
    return next;
  },

  async addFavourite(userId: string, pageId: string): Promise<HomePrefs> {
    assertPage(pageId);
    const cur = await loadPrefs(userId);
    if (cur.favourites.includes(pageId)) return cur;
    return this.putPrefs(userId, { favourites: [...cur.favourites, pageId].slice(-60) });
  },

  async removeFavourite(userId: string, pageId: string): Promise<HomePrefs> {
    const cur = await loadPrefs(userId);
    return this.putPrefs(userId, { favourites: cur.favourites.filter((f) => f !== pageId) });
  },

  async touchRecent(userId: string, pageId: string): Promise<void> {
    assertPage(pageId);
    await prisma.$executeRaw`
      INSERT INTO recent_pages (user_id, page_id, opened_at) VALUES (${userId}::uuid, ${pageId}, now())
      ON CONFLICT (user_id, page_id) DO UPDATE SET opened_at = now()`;
  },

  /** The landing page for a user: own choice, else the role's, else Home. */
  async landingFor(auth: AuthContext): Promise<string> {
    const prefs = await loadPrefs(auth.userId);
    if (prefs.landing !== 'home') return prefs.landing;
    const rows = await prisma.$queryRaw<{ landing: string }[]>`
      SELECT landing FROM role_landing WHERE role_id = ${auth.user.roleId}::uuid`;
    return rows[0]?.landing ?? 'home';
  },

  async setRoleLanding(roleId: string, landing: string, actorId: string): Promise<void> {
    if (landing !== 'home' && landing !== 'my-dashboard') assertPage(landing);
    await prisma.$executeRaw`
      INSERT INTO role_landing (role_id, landing, updated_by_id, updated_at) VALUES (${roleId}::uuid, ${landing}, ${actorId}::uuid, now())
      ON CONFLICT (role_id) DO UPDATE SET landing = EXCLUDED.landing, updated_by_id = EXCLUDED.updated_by_id, updated_at = now()`;
  },
};
