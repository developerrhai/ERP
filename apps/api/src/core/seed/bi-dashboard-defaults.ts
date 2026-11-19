// Default department dashboards for the BI > Custom Dashboards library (QA report: the list was empty on a fresh DB).
// Insert-if-missing by (scope, department, name); never updates or re-creates a dashboard an admin changed or deleted
// after the first run, because a row with the same name is simply left alone.
import type { PrismaClient } from '@prisma/client';

const WIDGETS = (...keys: string[]) => keys.map((k, i) => ({ key: k, x: (i % 2) * 6, y: Math.floor(i / 2) * 4, w: 6, h: 4 }));

export const DEFAULT_DASHBOARDS: { department: string; name: string; layout: unknown[]; isDefault: boolean }[] = [
  { department: 'Sales', name: 'Sales Performance', layout: WIDGETS('kpi-revenue', 'orders-trend', 'top-customers', 'pipeline'), isDefault: true },
  { department: 'Purchase', name: 'Procurement Overview', layout: WIDGETS('kpi-spend', 'po-status', 'top-vendors'), isDefault: true },
  { department: 'Inventory', name: 'Stock Health', layout: WIDGETS('kpi-stock-value', 'low-stock', 'movement-trend'), isDefault: true },
  { department: 'Finance', name: 'Finance Snapshot', layout: WIDGETS('kpi-receivables', 'kpi-payables', 'cash-trend', 'ageing'), isDefault: true },
  { department: 'Quality', name: 'Quality Scorecard', layout: WIDGETS('kpi-rejection', 'ncr-status', 'inspection-trend'), isDefault: true },
  { department: 'Production', name: 'Production Throughput', layout: WIDGETS('kpi-output', 'oee-trend', 'downtime'), isDefault: true },
];

export async function seedBiDashboards(db: PrismaClient): Promise<number> {
  let inserted = 0;
  for (const d of DEFAULT_DASHBOARDS) {
    const n = await db.$executeRawUnsafe(
      `INSERT INTO dashboards (scope, department, name, layout, is_default)
       SELECT 'DEPARTMENT', $1, $2, $3::jsonb, $4
        WHERE NOT EXISTS (SELECT 1 FROM dashboards WHERE scope = 'DEPARTMENT' AND department = $1 AND name = $2)`,
      d.department,
      d.name,
      JSON.stringify(d.layout),
      d.isDefault,
    );
    inserted += Number(n);
  }
  return inserted;
}
