import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '../src/core/db/prisma';
import { query } from '../src/modules/procurement/core';
import { ANALYTICS_KINDS, getAiOverview, getAnalytics, getLibrary } from '../src/modules/bi/analytics-service';
import type { Caller } from '../src/modules/records/service';

let owner: Caller;

beforeAll(async () => {
  const admin = await prisma.user.findFirstOrThrow({ include: { role: true }, orderBy: { createdAt: 'asc' } });
  const unit = (await prisma.unit.findMany())[0]!;
  const fy = await prisma.financialYear.findFirstOrThrow({ where: { status: 'OPEN' } });
  owner = {
    auth: {
      userId: admin.id,
      sessionId: 'analytics-owner',
      roleId: admin.roleId,
      roleCode: admin.role.code,
      level: admin.role.level,
      allUnits: true,
      departments: [],
      role: admin.role.code,
      user: admin as any,
    },
    ctx: { unitId: unit.id, fyId: fy.id, allUnits: true, unit, fy } as any,
    meta: { ip: '127.0.0.1', userAgent: 'vitest' },
  };
});

describe('BI analytics (computed from real records)', () => {
  it('every dashboard runs against the database and returns well-formed datasets', async () => {
    for (const kind of ANALYTICS_KINDS) {
      const res = await getAnalytics(owner, kind);
      expect(res.kind).toBe(kind);
      expect(res.kpis.length).toBeGreaterThan(0);
      expect(Object.keys(res.datasets).length).toBeGreaterThan(0);
      for (const ds of Object.values(res.datasets)) {
        expect(ds.columns.length).toBeGreaterThan(0);
        for (const row of ds.rows) for (const c of ds.columns) expect(row).toHaveProperty(c.key);
      }
    }
  });

  it('sales monthly revenue equals the sum of the real approved orders (no invented numbers)', async () => {
    const res = await getAnalytics(owner, 'sales');
    const shown = res.datasets.monthly!.rows.reduce((s, r) => s + Number(r.revenue), 0);
    const real = await query(
      prisma,
      `SELECT COALESCE(SUM(grand_total), 0)::float8 AS v FROM sales_orders
        WHERE deleted_at IS NULL AND status IN ('Approved','Posted')
          AND order_date >= date_trunc('month', CURRENT_DATE) - interval '11 months' AND order_date < date_trunc('month', CURRENT_DATE) + interval '1 month'`,
    );
    expect(Math.round(shown * 100)).toBe(Math.round(Number((real[0] as any).v) * 100));
    expect(res.datasets.monthly!.rows).toHaveLength(12);
  });

  it('rejects an unknown dashboard', async () => {
    await expect(getAnalytics(owner, 'nope')).rejects.toThrow();
  });

  it('AI overview returns rule based findings with real evidence and a bounded health score', async () => {
    const ov = await getAiOverview(owner);
    expect(ov.health).toBeGreaterThanOrEqual(0);
    expect(ov.health).toBeLessThanOrEqual(100);
    expect(ov.trend.length).toBeLessThanOrEqual(20);
    for (const f of ov.findings) {
      expect(['High', 'Medium', 'Low']).toContain(f.severity);
      expect(f.finding.length).toBeGreaterThan(10);
      expect(f.evidence.length).toBeGreaterThan(0);
    }
    expect(ov.moduleRisk.every((m) => m.risk >= 0 && m.risk <= 100)).toBe(true);
    expect(ov.governance).toHaveProperty('aiEnabled');
    expect(ov.skipped).toEqual([]); // no rule may fail on a SQL error
  });

  it('BI library lists dashboards, reports, runs, schedules and datasets', async () => {
    const lib = await getLibrary(owner);
    expect(Array.isArray(lib.dashboards)).toBe(true);
    expect(Array.isArray(lib.reports)).toBe(true);
    expect(Array.isArray(lib.runs)).toBe(true);
    expect(Array.isArray(lib.schedules)).toBe(true);
    expect(lib.datasets.length).toBeGreaterThan(0);
  });
});
