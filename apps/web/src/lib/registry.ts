// Menu access rules in one place: which registry families a user may see (CONTRACT §2)
// and page lookups for /m/:pageId. Pure functions so they are unit-tested per role/department.
import rawRegistry from '@registry';
import type { RegistryFamily, RegistryItem } from '@registry';
import type { RoleCode } from '../types';

/**
 * Titles that differ from the prototype because of owner decisions. The extracted registry stays an
 * exact copy of index.html (it has a staleness test); the web app relabels here, in one place.
 */
const TITLE_OVERRIDES: Readonly<Record<string, string>> = {
  'admin-company': 'Company Master',
  'admin-branches': 'Unit Master',
};

/**
 * Pages a later phase adds to the frozen prototype registry (the API does the same in
 * apps/api/src/core/registry.ts). Phase 6B: admin-formats, right after the Approval Matrix.
 */
const PHASE_ADDED_PAGES = [
  {
    id: 'admin-formats',
    title: 'Formats & Rules',
    family: 'Administration',
    after: 'admin-approval',
    purpose: 'All document formats and calculation rule sets, their versions, and who changed what.',
  },
  {
    id: 'notif-center',
    title: 'Notification Center',
    family: 'Executive',
    after: 'notifications',
    purpose: 'Full real-time notification history, category filters and read/archive state.',
  },
  {
    id: 'notif-preferences',
    title: 'Notification Preferences',
    family: 'Executive',
    after: 'notif-center',
    purpose: 'Per-type channel switches (in-app, push, email, SMS), quiet hours and registered devices.',
  },
  {
    id: 'admin-notif-types',
    title: 'Notification Types',
    family: 'Administration',
    after: 'admin-settings',
    purpose: 'Catalogue of notification events, allowed/mandatory channels and test sends.',
  },
  {
    id: 'admin-notif-broadcast',
    title: 'Broadcast Announcements',
    family: 'Administration',
    after: 'admin-notif-types',
    purpose: 'Scheduled announcements targeted to units, departments or roles with acknowledgement tracking.',
  },
  {
    id: 'admin-notif-health',
    title: 'Notification & Email Health',
    family: 'Administration',
    after: 'admin-notif-broadcast',
    purpose: '24h delivery telemetry, push devices, SES quota, DKIM/SPF/DMARC status and channel kill switches.',
  },
  {
    id: 'admin-email-rules',
    title: 'Email Automation Rules',
    family: 'Administration',
    after: 'admin-notif-health',
    purpose: 'Event-triggered transactional email rules, PDF attachments and send windows.',
  },
  {
    id: 'admin-email-suppressions',
    title: 'Email Suppressions',
    family: 'Administration',
    after: 'admin-email-rules',
    purpose: 'Blocked hard-bounced/complained addresses with audited unblock workflow.',
  },
] as const;

export const registry: typeof rawRegistry = {
  ...rawRegistry,
  families: rawRegistry.families.map((f) => {
    const items = f.items.map((i) => ({ ...i, title: TITLE_OVERRIDES[i.id] ?? i.title }));
    for (const extra of PHASE_ADDED_PAGES) {
      if (extra.family !== f.name || items.some((i) => i.id === extra.id)) continue;
      const at = items.findIndex((i) => i.id === extra.after);
      items.splice(at >= 0 ? at + 1 : items.length, 0, { id: extra.id, title: extra.title });
    }
    return { ...f, items };
  }),
  profiles: {
    ...rawRegistry.profiles,
    ...Object.fromEntries(
      PHASE_ADDED_PAGES.map((p) => [
        p.id,
        { title: p.title, family: p.family, purpose: p.purpose, tabs: [], fields: [] },
      ]),
    ),
  },
};

const ALL_FAMILIES_ROLES: readonly RoleCode[] = ['SUPER_ADMIN', 'ADMIN'];

/** Families visible to a user: SUPER_ADMIN/ADMIN see all; others see deptFamilies[department]. */
export function familiesFor(
  role: RoleCode,
  department: string | null,
  families: RegistryFamily[] = registry.families,
  deptFamilies: Record<string, string[] | undefined> = registry.deptFamilies,
): RegistryFamily[] {
  if (ALL_FAMILIES_ROLES.includes(role)) return families;
  if (!department) return [];
  const allowed = deptFamilies[department];
  if (!allowed) return [];
  if (allowed.includes('*')) return families;
  return families.filter((f) => allowed.includes(f.name));
}

/** Pages only SUPER_ADMIN/ADMIN may open; hidden from the menu for everyone else. */
export const ADMIN_ONLY_PAGES: readonly string[] = ['admin-users'];

/**
 * The sidebar menu: familiesFor() minus admin-only items for roles below ADMIN (even in the
 * Administration department, whose "*" grants every family). The route still guards itself.
 */
export function menuFor(role: RoleCode, department: string | null): RegistryFamily[] {
  const families = familiesFor(role, department);
  if (ALL_FAMILIES_ROLES.includes(role)) return families;
  return families
    .map((f) => ({ ...f, items: f.items.filter((i) => !ADMIN_ONLY_PAGES.includes(i.id)) }))
    .filter((f) => f.items.length > 0);
}

/** Prototype renderMenu(filter): a family matches by its name, otherwise items match by title. */
export function filterMenu(families: RegistryFamily[], filter: string): RegistryFamily[] {
  const q = filter.trim().toLowerCase();
  if (!q) return families;
  const out: RegistryFamily[] = [];
  for (const fam of families) {
    const famHit = fam.name.toLowerCase().includes(q);
    const items = famHit ? fam.items : fam.items.filter((i) => i.title.toLowerCase().includes(q));
    if (items.length) out.push({ ...fam, items });
  }
  return out;
}

export interface PageLookup {
  item: RegistryItem;
  family: RegistryFamily;
  purpose: string | null;
}

export function findPage(pageId: string, families: RegistryFamily[]): PageLookup | null {
  for (const family of families) {
    const item = family.items.find((i) => i.id === pageId);
    if (item) return { item, family, purpose: registry.profiles[pageId]?.purpose ?? null };
  }
  return null;
}

export function isAdminRole(role: RoleCode): boolean {
  return ALL_FAMILIES_ROLES.includes(role);
}

const ITEM_INDEX = new Map<string, { item: RegistryItem; family: RegistryFamily }>();
for (const family of registry.families) {
  for (const item of family.items) ITEM_INDEX.set(item.id, { item, family });
}

/** The registry stays the source of titles and icons; the server decides which items appear. */
export function withRegistryLabels(families: RegistryFamily[]): RegistryFamily[] {
  return families.map((f) => {
    const regFamily = registry.families.find((r) => r.name === f.name);
    return {
      name: f.name,
      icon: regFamily?.icon ?? f.icon,
      items: f.items.map((i) => ({ id: i.id, title: ITEM_INDEX.get(i.id)?.item.title ?? i.title })),
    };
  });
}

/** Any registry page, regardless of access (access is decided by GET /me/permissions). */
export function lookupPage(pageId: string): PageLookup | null {
  return findPage(pageId, registry.families);
}
