// Client of GET /mfg|qms|maint/v40/:pageId - the V40 tab views of the Manufacturing, Quality and Maintenance pages
// (apps/api/src/modules/{mfg,qms,assets}/v40-views.ts). Same answer shape as the Sales views.
import { request } from '../../lib/api';
import type { V40Page, V40Params, V40Row } from '../sales/salesV40Api';

export const MFG_V40_IDS: readonly string[] = [
  'mfg-orders',
  'mfg-plan',
  'mfg-mrp',
  'mfg-material-issue',
  'mfg-wip',
  'mfg-fg',
  'mfg-scrap',
  'mfg-rework',
  'mfg-costing',
  'mfg-workorders',
];
export const QMS_V40_IDS: readonly string[] = [
  'qms-incoming',
  'qms-process',
  'qms-final',
  'qms-inspections',
  'qms-supplier',
  'qms-ncr',
  'qms-capa',
  'qms-5why',
  'qms-calibration',
  'qms-plans',
];
export const MAINT_V40_IDS: readonly string[] = [
  'maint-machines',
  'maint-equipment',
  'maint-preventive',
  'maint-schedule',
  'maint-breakdown',
  'maint-workorders',
  'maint-downtime',
  'maint-mtbf',
  'maint-spares',
  'maint-alerts',
];
export const PLANT_V40_IDS: ReadonlySet<string> = new Set([
  ...MFG_V40_IDS,
  ...QMS_V40_IDS,
  ...MAINT_V40_IDS,
]);

const baseOf = (pageId: string): string =>
  pageId.startsWith('mfg-') ? '/mfg' : pageId.startsWith('qms-') ? '/qms' : '/maint';

export async function getPlantV40(pageId: string, p: V40Params): Promise<V40Page> {
  const qs = new URLSearchParams({
    tab: p.tab,
    first: p.first ? '1' : '0',
    page: String(p.page),
    size: String(p.size),
  });
  if (p.q) qs.set('q', p.q);
  if (p.status) qs.set('status', p.status);
  const r = await request<V40Row[]>(`${baseOf(pageId)}/v40/${pageId}?${qs.toString()}`);
  const meta = (r.meta ?? {}) as unknown as Partial<V40Page> & { total?: number };
  return {
    rows: r.data,
    columns: meta.columns ?? [],
    total: meta.total ?? r.data.length,
    panel: meta.panel ?? null,
    audit: Boolean(meta.audit),
    noSource: meta.noSource ?? [],
  };
}
