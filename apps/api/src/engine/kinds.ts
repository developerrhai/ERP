// Which engine serves a page (docs/phase3-4 B3): `generic` pages get the metadata CRUD, `typed`
// pages get their own tables (Stage C, listed here already so the generic API refuses them),
// `custom` pages are the 21 hand-built prototype screens plus the Administration family (Phase 2/3),
// except the four plain Administration masters in GENERIC_ADMIN_PAGES.
import { ADMIN_FAMILY, pageInfo } from '../core/registry';

export type PageKind = 'generic' | 'typed' | 'custom';

/** Pages with their own storage (Inventory slice, Stage C). */
export const TYPED_PAGES: ReadonlySet<string> = new Set([
  'inv-items',
  'wms-warehouses',
  'inv-stock',
  'inv-opening',
  'inv-transactions',
  'inv-adjustment',
  'inv-transfer',
]);

/** The 21 menu pages the prototype draws with a page-specific renderer (docs/REGISTRY.csv). */
export const CUSTOM_PAGES: ReadonlySet<string> = new Set([
  'dashboard',
  'command-center',
  'ai-insights',
  'notifications',
  'global-search',
  'crm-pipeline',
  'mfg-shopfloor',
  'proj-kanban',
  'ai-copilot',
  'ai-demand',
  'ai-inventory',
  'ai-sales',
  'ai-vendor',
  'ai-finance',
  'ai-executive',
  'admin-departments',
  'admin-users',
  'admin-roles',
  'admin-permissions',
  'admin-approval',
  'admin-settings',
]);

/**
 * Administration pages with plain master fields that the generic engine serves (ADMIN+ only, the
 * Administration hard rule still applies). Every other Administration page is `custom`.
 */
export const GENERIC_ADMIN_PAGES: ReadonlySet<string> = new Set([
  'admin-designations',
  'admin-currency',
  'admin-uom',
  'admin-taxes',
]);

export function kindOf(pageId: string): PageKind | null {
  const page = pageInfo(pageId);
  if (!page) return null;
  if (TYPED_PAGES.has(pageId)) return 'typed';
  if (CUSTOM_PAGES.has(pageId)) return 'custom';
  if (page.family === ADMIN_FAMILY && !GENERIC_ADMIN_PAGES.has(pageId)) return 'custom';
  return 'generic';
}
