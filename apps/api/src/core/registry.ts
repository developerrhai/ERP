// Loads packages/registry/registry.json (the menu/page registry extracted from the prototype) at
// boot, validates its shape, and offers lookups (page -> family, family names, menu order). It is
// read from the registry package rather than copied, so a re-extract is picked up on restart.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

const registrySchema = z.object({
  families: z
    .array(
      z.object({
        name: z.string().min(1),
        icon: z.string(),
        items: z.array(z.object({ id: z.string().min(1), title: z.string().min(1) })),
      }),
    )
    .min(1),
  /** Per-page profile (tabs + field labels) of the 227 generic-engine pages, plus some custom ones. */
  profiles: z
    .record(
      z.object({
        title: z.string(),
        family: z.string(),
        purpose: z.string(),
        tabs: z.array(z.string()),
        fields: z.array(z.string()),
      }),
    )
    .default({}),
  deptFamilies: z.record(z.array(z.string())),
  departments: z.array(z.string()),
});

export type RegistryData = z.infer<typeof registrySchema>;
export type RegistryFamily = RegistryData['families'][number];
export type PageProfile = RegistryData['profiles'][string];

export interface PageInfo {
  id: string;
  title: string;
  family: string;
  /** Position in the menu (registry order). */
  order: number;
}

/** apps/api/{src|dist}/core -> repo root -> packages/registry/registry.json */
export const DEFAULT_REGISTRY_PATH = path.resolve(
  __dirname,
  '../../../../packages/registry/registry.json',
);

export function loadRegistry(file: string = process.env.REGISTRY_PATH ?? DEFAULT_REGISTRY_PATH) {
  const parsed = registrySchema.safeParse(JSON.parse(readFileSync(file, 'utf8')));
  if (!parsed.success) {
    throw new Error(`Invalid registry at ${file}: ${parsed.error.issues[0]?.message ?? 'unknown'}`);
  }
  const data = parsed.data;
  const pages = new Map<string, PageInfo>();
  let order = 0;
  for (const family of data.families) {
    for (const item of family.items) {
      if (pages.has(item.id)) throw new Error(`Duplicate page id in registry: ${item.id}`);
      pages.set(item.id, { id: item.id, title: item.title, family: family.name, order: order++ });
    }
  }
  const familyNames = data.families.map((f) => f.name);
  return { data, pages, familyNames, familySet: new Set(familyNames) };
}

export const registry = loadRegistry();

export const ADMIN_FAMILY = 'Administration';
export const ADMIN_DEPARTMENT = 'Administration';

export function pageInfo(pageId: string): PageInfo | undefined {
  const info = registry.pages.get(pageId);
  if (info) return info;
  if (process.env.KIT_ALLOW_TEST_PAGES === 'true' && pageId.startsWith('kit-')) {
    return { id: pageId, title: pageId, family: 'Quality / QMS', order: 9999 };
  }
  return undefined;
}

export function profileOf(pageId: string): PageProfile | undefined {
  return registry.data.profiles[pageId];
}

export function isFamily(name: string): boolean {
  return registry.familySet.has(name);
}

/** Department families from the registry, with the prototype's ["*"] expanded to every family. */
export function defaultDepartmentFamilies(department: string): string[] {
  const listed = registry.data.deptFamilies[department] ?? [];
  if (listed.includes('*')) return [...registry.familyNames];
  return listed.filter((f) => registry.familySet.has(f));
}
