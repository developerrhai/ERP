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

/**
 * Pages that a later phase file adds to the frozen prototype registry (packages/registry stays the
 * extract of index.html). Phase 6B: admin-formats, placed right after the Approval Matrix.
 */
export const PHASE_ADDED_PAGES: readonly {
  id: string;
  title: string;
  family: string;
  after: string;
  purpose: string;
  /** Seed value of the module control (Administration pages are normally 'no approval'). */
  approvalRequired?: boolean;
}[] = [
  {
    id: 'admin-formats',
    title: 'Formats & Rules',
    family: 'Administration',
    after: 'admin-approval',
    purpose:
      'All document formats and calculation rule sets, their versions, and who changed what.',
    // Turns the Phase 5 approval engine on for publishing money-affecting rule sets (PHASE-06B §3.6).
    approvalRequired: true,
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
  {
    id: 'admin-page-health',
    title: 'Page Health',
    family: 'Administration',
    after: 'admin-email-suppressions',
    purpose: 'Crawler results: every page, role and plant combination, errors and load time.',
  },
  {
    id: 'admin-registry',
    title: 'Page Registry',
    family: 'Administration',
    after: 'admin-page-health',
    purpose: 'Registry v2: every V40 page with its tabs, fields, buttons, status and owner phase.',
  },
  {
    id: 'my-dashboard',
    title: 'My Dashboard',
    family: 'Executive',
    after: 'dashboard',
    purpose: 'Your own numbers, queues and targets.',
  },
  {
    id: 'plant-dashboard',
    title: 'Plant Dashboard',
    family: 'Executive',
    after: 'my-dashboard',
    purpose: 'One plant, or a comparison of the plants you chose.',
  },
  {
    id: 'owner-console',
    title: 'Owner Console',
    family: 'Executive',
    after: 'plant-dashboard',
    purpose: 'KPIs per plant and in total, approvals by age and statutory rows to review.',
  },
  {
    id: 'kpi-targets',
    title: 'KPI Targets',
    family: 'Business Intelligence',
    after: 'bi-profit',
    purpose: 'Targets with green / amber / red limits per KPI, plant, department or person.',
  },
  {
    id: 'kpi-alerts',
    title: 'KPI Alerts',
    family: 'Business Intelligence',
    after: 'kpi-targets',
    purpose: 'Alert rules that notify people when a KPI crosses a limit.',
  },
  {
    id: 'bi-production',
    title: 'Production Analytics',
    family: 'Business Intelligence',
    after: 'kpi-alerts',
    purpose: 'Production KPIs for the chosen plants.',
  },
  {
    id: 'bi-quality',
    title: 'Quality Analytics',
    family: 'Business Intelligence',
    after: 'bi-production',
    purpose: 'Quality KPIs for the chosen plants.',
  },
  {
    id: 'bi-hr',
    title: 'HR Analytics',
    family: 'Business Intelligence',
    after: 'bi-quality',
    purpose: 'HR KPIs for the chosen plants.',
  },
  {
    id: 'bi-maintenance',
    title: 'Maintenance Analytics',
    family: 'Business Intelligence',
    after: 'bi-hr',
    purpose: 'Maintenance KPIs for the chosen plants.',
  },
  {
    id: 'bi-projects',
    title: 'Project Analytics',
    family: 'Business Intelligence',
    after: 'bi-maintenance',
    purpose: 'Project KPIs for the chosen plants.',
  },
  {
    id: 'bi-service',
    title: 'Service Analytics',
    family: 'Business Intelligence',
    after: 'bi-projects',
    purpose: 'Service KPIs for the chosen plants.',
  },
  {
    id: 'bi-logistics',
    title: 'Logistics Analytics',
    family: 'Business Intelligence',
    after: 'bi-service',
    purpose: 'Logistics KPIs for the chosen plants.',
  },
  {
    id: 'dept-inbox',
    title: 'Department Inbox',
    family: 'Executive',
    after: 'owner-console',
    purpose: 'Work sent to your department: Received, Accepted, Return, History.',
  },
  {
    id: 'dept-work',
    title: 'Department Work Center',
    family: 'Executive',
    after: 'dept-inbox',
    purpose: 'Accepted work of your department, grouped by document type.',
  },
  {
    id: 'dept-movement-inbox',
    title: 'All Department Movements',
    family: 'Executive',
    after: 'dept-work',
    purpose: 'Every department movement; Director, Admin and Owner.',
  },
];

function addPhasePages(data: RegistryData): void {
  for (const extra of PHASE_ADDED_PAGES) {
    const family = data.families.find((f) => f.name === extra.family);
    if (!family || family.items.some((i) => i.id === extra.id)) continue;
    const at = family.items.findIndex((i) => i.id === extra.after);
    family.items.splice(at >= 0 ? at + 1 : family.items.length, 0, {
      id: extra.id,
      title: extra.title,
    });
    data.profiles[extra.id] = {
      title: extra.title,
      family: extra.family,
      purpose: extra.purpose,
      tabs: ['Formats', 'Rule Sets', 'Changes'],
      fields: [],
    };
  }
}

export function loadRegistry(file: string = process.env.REGISTRY_PATH ?? DEFAULT_REGISTRY_PATH) {
  const parsed = registrySchema.safeParse(JSON.parse(readFileSync(file, 'utf8')));
  if (!parsed.success) {
    throw new Error(`Invalid registry at ${file}: ${parsed.error.issues[0]?.message ?? 'unknown'}`);
  }
  const data = parsed.data;
  addPhasePages(data);
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
