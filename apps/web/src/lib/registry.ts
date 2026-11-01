// Menu access rules in one place: which registry families a user may see (CONTRACT §2)
// and page lookups for /m/:pageId. Pure functions so they are unit-tested per role/department.
import registry from '@registry';
import type { RegistryFamily, RegistryItem } from '@registry';
import type { RoleCode } from '../types';

export { registry };

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
