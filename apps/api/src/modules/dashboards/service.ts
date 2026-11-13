// Phase 24: dashboards. Every number comes from the Phase 19 KPI formulas (real SQL on posted records) - nothing is
// stored as a made-up value. A dashboard is built from the KPI definitions, the user's plants and the targets set in
// kpi_targets; the user's own layout changes sit on top (user_dashboard_overrides).
import { createHash, randomBytes } from 'node:crypto';
import { mailService } from '../../core/mail/mail-service';
import { recordAudit } from '../../core/audit/audit-service';
import { prisma } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { query } from '../procurement/core';
import type { Row } from '../procurement/core';
import { approvalQueries } from '../approvals/queries';
import { notificationService } from '../notifications/service';
import { biService } from '../bi/bi-service';
import type { Caller } from '../records/service';
import {
  achievementPct,
  alertCrossed,
  dailyDue,
  isAdditive,
  parseDailyCron,
  ragOf,
  type Direction,
  type Rag,
} from './calc';

export interface KpiCard {
  code: string;
  name: string;
  department: string;
  format: string;
  unitLabel: string;
  value: number | null;
  target: number | null;
  /** achievement against the target, percent; null when no target is set */
  pct: number | null;
  rag: Rag;
  direction: Direction;
  formulaText: string;
  sourceText: string | null;
  rowCount: number;
  /** "No data in period" when the formula had a zero denominator */
  noData: boolean;
  drill: { page: string | null; filters: Record<string, string> };
  refreshedAt: string;
  unitId: string | null;
}

interface KpiDef {
  code: string;
  name: string;
  department: string;
  format: string;
  unit_label: string;
  direction: Direction;
  target_val: string | null;
  drill_page: string | null;
  source_text: string | null;
}

/** A caller looking at exactly one plant (the KPI formulas read ctx.unitId). */
function forPlant(caller: Caller, unitId: string): Caller {
  return { ...caller, ctx: { ...caller.ctx, unitId, allUnits: false, unitIds: [unitId] } };
}

function periodStart(kind: 'DAY' | 'WEEK' | 'MONTH' | 'QUARTER' | 'FY', now = new Date()): string {
  const d = new Date(now.getTime() + 330 * 60_000);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const iso = (dt: Date) => dt.toISOString().slice(0, 10);
  switch (kind) {
    case 'DAY':
      return iso(d);
    case 'WEEK': {
      const wd = (d.getUTCDay() + 6) % 7; // Monday = 0
      return iso(new Date(Date.UTC(y, m, d.getUTCDate() - wd)));
    }
    case 'MONTH':
      return iso(new Date(Date.UTC(y, m, 1)));
    case 'QUARTER':
      return iso(new Date(Date.UTC(y, Math.floor(m / 3) * 3, 1)));
    case 'FY':
      return iso(new Date(Date.UTC(m >= 3 ? y : y - 1, 3, 1)));
  }
}

async function defs(codes?: string[], department?: string): Promise<KpiDef[]> {
  // unpaginated: admin-defined config table, a few hundred rows at most; page UIs read it whole
  const rows = await query(
    prisma,
    `SELECT code, name, department, format, unit_label, direction, target_val::text AS target_val, drill_page, source_text
       FROM kpi_definitions
      WHERE ($1::text[] IS NULL OR code = ANY($1::text[]))
        AND ($2::text IS NULL OR lower(department) = lower($2))
      ORDER BY department, code`,
    codes ?? null,
    department ?? null,
  );
  return rows as unknown as KpiDef[];
}

/** The target in force today: the most specific one wins (person > department > plant > everyone), else the Phase 19 default. */
async function targetFor(
  code: string,
  unitId: string | null,
  userId: string | null,
  deptName: string | null,
  fallback: string | null,
): Promise<{ target: number | null; amber: number; red: number }> {
  const rows = await query(
    prisma,
    `SELECT t.target::float8 AS target, t.amber_pct::float8 AS amber, t.red_pct::float8 AS red
       FROM kpi_targets t
       LEFT JOIN departments d ON d.id = t.department_id
      WHERE t.kpi_code = $1
        AND (t.unit_id IS NULL OR t.unit_id = $2::uuid)
        AND (t.user_id IS NULL OR t.user_id = $3::uuid)
        AND (t.department_id IS NULL OR d.name = $4)
        AND t.period_start = (CASE t.period_kind
              WHEN 'DAY' THEN $5::date WHEN 'WEEK' THEN $6::date WHEN 'MONTH' THEN $7::date
              WHEN 'QUARTER' THEN $8::date ELSE $9::date END)
      ORDER BY (t.user_id IS NOT NULL) DESC, (t.department_id IS NOT NULL) DESC, (t.unit_id IS NOT NULL) DESC
      LIMIT 1`,
    code,
    unitId,
    userId,
    deptName,
    periodStart('DAY'),
    periodStart('WEEK'),
    periodStart('MONTH'),
    periodStart('QUARTER'),
    periodStart('FY'),
  );
  const r = rows[0];
  if (r) return { target: Number(r.target), amber: Number(r.amber), red: Number(r.red) };
  return { target: fallback === null ? null : Number(fallback), amber: 90, red: 75 };
}

export const dashboardsService = {
  /** One KPI for one plant, with its target and colour. */
  async card(caller: Caller, def: KpiDef, unitId: string | null): Promise<KpiCard> {
    const who = unitId ? forPlant(caller, unitId) : caller;
    const k = await biService.computeKpiValue(who, def.code);
    const t = await targetFor(def.code, unitId, caller.auth.userId || null, null, def.target_val);
    const pct = achievementPct(k.value, t.target, def.direction);
    return {
      code: def.code,
      name: def.name,
      department: def.department,
      format: def.format,
      unitLabel: def.unit_label,
      value: k.value,
      target: t.target,
      pct,
      rag: ragOf(pct, t.amber, t.red),
      direction: def.direction,
      formulaText: k.formulaText,
      sourceText: def.source_text,
      rowCount: k.rowCount,
      noData: k.value === null,
      drill: { page: def.drill_page, filters: unitId ? { unit: unitId } : {} },
      refreshedAt: new Date().toISOString(),
      unitId,
    };
  },

  /** Plants the caller chose to look at, with names. */
  async selectedPlants(caller: Caller): Promise<{ id: string; code: string; name: string }[]> {
    const rows = await query(
      prisma,
      `SELECT id::text AS id, code, name FROM units WHERE id = ANY($1::uuid[]) AND status = 'ACTIVE' ORDER BY created_at, code`,
      caller.ctx.unitIds,
    );
    return rows as unknown as { id: string; code: string; name: string }[];
  },

  /** Rows = KPIs, columns = plants + total (total only where adding plants makes sense). */
  async compareGrid(caller: Caller, defsList: KpiDef[]) {
    const plants = await this.selectedPlants(caller);
    const rows = [];
    for (const def of defsList) {
      const cells = [];
      for (const p of plants) cells.push(await this.card(caller, def, p.id));
      const additive = isAdditive(def.format);
      const sum = additive ? cells.reduce((s, c) => s + (c.value ?? 0), 0) : null;
      const anyValue = cells.some((c) => c.value !== null);
      rows.push({
        code: def.code,
        name: def.name,
        department: def.department,
        format: def.format,
        direction: def.direction,
        cells,
        total: additive && anyValue ? sum : null,
        totalNote: additive ? null : 'Not added across plants',
      });
    }
    return { plants, rows };
  },

  // ----------------------------------------------------------------------------------------------- dashboards
  async my(caller: Caller) {
    const u = caller.auth.user;
    const dept = u.department ?? 'Administration';
    const defsList = await defs(undefined, dept);
    const unitId = caller.ctx.unitId;
    const cards = [];
    for (const d of defsList) cards.push(await this.card(caller, d, unitId));
    const counts = await approvalQueries.counts(caller.auth);
    const mine = await query(
      prisma,
      `SELECT status, count(*)::int AS n FROM generic_records
        WHERE created_by_id = $1::uuid AND deleted_at IS NULL AND unit_id = ANY($2::uuid[])
        GROUP BY status ORDER BY status`,
      caller.auth.userId,
      caller.ctx.unitIds,
    );
    return {
      key: 'my',
      title: 'My Dashboard',
      department: dept,
      // honest scope note: the department KPI formulas are plant-level; the queues below are strictly the user's own
      scopeNote:
        'Your approvals and documents below are your own. Department figures are for the plant and are not limited to you.',
      queues: {
        approvalsWaiting: counts.waitingForMe,
        approvalsOverdue: counts.overdue,
        submittedPending: counts.submittedPending,
      },
      myDocumentsByStatus: mine.map((r) => ({ status: String(r.status), count: Number(r.n) })),
      cards,
      override: await this.getOverride(caller.auth.userId, 'my'),
    };
  },

  async department(caller: Caller, dept: string) {
    const list = await defs(undefined, dept);
    const unitId = caller.ctx.unitId;
    const cards = [];
    for (const d of list) cards.push(await this.card(caller, d, unitId));
    const base = await biService.getDepartmentDashboard(caller, dept);
    return {
      key: `department:${dept}`,
      title: `${dept} Dashboard`,
      cards,
      exceptions: (base.exceptions as Row[]) ?? [],
      override: await this.getOverride(caller.auth.userId, `department:${dept}`),
    };
  },

  async plant(caller: Caller) {
    const all = await defs();
    const grid = await this.compareGrid(caller, all);
    return { key: 'plant', title: 'Plant Dashboard', ...grid, override: await this.getOverride(caller.auth.userId, 'plant') };
  },

  async owner(caller: Caller) {
    const all = await defs();
    const grid = await this.compareGrid(caller, all);
    const age = await query(
      prisma,
      `SELECT
         count(*) FILTER (WHERE now() - requested_at < interval '1 day')::int AS d0,
         count(*) FILTER (WHERE now() - requested_at >= interval '1 day' AND now() - requested_at < interval '3 days')::int AS d1,
         count(*) FILTER (WHERE now() - requested_at >= interval '3 days' AND now() - requested_at < interval '7 days')::int AS d3,
         count(*) FILTER (WHERE now() - requested_at >= interval '7 days')::int AS d7
       FROM approval_requests WHERE status = 'PENDING' AND unit_id = ANY($1::uuid[])`,
      caller.ctx.unitIds,
    );
    const review = await query(
      prisma,
      `SELECT (SELECT count(*)::int FROM gst_rates WHERE needs_review AND deleted_at IS NULL) AS gst,
              (SELECT count(*)::int FROM hsn_sac_codes WHERE needs_review AND deleted_at IS NULL) AS hsn`,
    );
    const a = age[0] ?? {};
    return {
      key: 'owner',
      title: 'Owner Console',
      ...grid,
      approvalsByAge: [
        { label: 'Under 1 day', count: Number(a.d0 ?? 0) },
        { label: '1 to 3 days', count: Number(a.d1 ?? 0) },
        { label: '3 to 7 days', count: Number(a.d3 ?? 0) },
        { label: 'Over 7 days', count: Number(a.d7 ?? 0) },
      ],
      needsReview: { gstRates: Number(review[0]?.gst ?? 0), hsnCodes: Number(review[0]?.hsn ?? 0) },
    };
  },

  async module(caller: Caller, code: string) {
    const deptOf: Record<string, string> = {
      sales: 'Sales',
      purchase: 'Purchase',
      inventory: 'Warehouse',
      finance: 'Finance',
      production: 'Production',
      quality: 'Quality',
      hr: 'HR',
      maintenance: 'Maintenance',
      projects: 'Projects',
      service: 'Service',
      logistics: 'Logistics',
    };
    const dept = deptOf[code];
    if (!dept) throw Errors.notFound('Unknown analytics module.');
    const list = await defs(undefined, dept);
    const grid = await this.compareGrid(caller, list);
    return {
      key: `module:${code}`,
      title: `${dept} Analytics`,
      ...grid,
      empty: list.length === 0 ? `No KPIs are defined for ${dept} yet.` : null,
      override: await this.getOverride(caller.auth.userId, `module:${code}`),
    };
  },

  // ----------------------------------------------------------------------------------------------- layouts
  async getOverride(userId: string, key: string): Promise<unknown[] | null> {
    const rows = await query(prisma, `SELECT layout FROM user_dashboard_overrides WHERE user_id = $1::uuid AND dashboard_key = $2`, userId, key);
    return rows[0] ? (rows[0].layout as unknown[]) : null;
  },

  async putOverride(userId: string, key: string, layout: unknown[]): Promise<void> {
    await prisma.$executeRaw`
      INSERT INTO user_dashboard_overrides (user_id, dashboard_key, layout, updated_at)
      VALUES (${userId}::uuid, ${key}, ${JSON.stringify(layout)}::jsonb, now())
      ON CONFLICT (user_id, dashboard_key) DO UPDATE SET layout = EXCLUDED.layout, updated_at = now()`;
  },

  async resetOverride(userId: string, key: string): Promise<void> {
    await prisma.$executeRaw`DELETE FROM user_dashboard_overrides WHERE user_id = ${userId}::uuid AND dashboard_key = ${key}`;
  },

  async widgetLibrary(): Promise<Row[]> {
    // unpaginated: admin-defined config table, a few hundred rows at most; page UIs read it whole
    return query(prisma, `SELECT code, title, kind, kpi_code, category, min_w, min_h FROM widgets_library ORDER BY category, title`);
  },

  // ----------------------------------------------------------------------------------------------- targets
  async listTargets(): Promise<Row[]> {
    // unpaginated: admin-defined config table, a few hundred rows at most; page UIs read it whole
    return query(
      prisma,
      `SELECT t.id::text AS id, t.kpi_code, k.name AS kpi_name, t.unit_id::text AS unit_id, u.code AS unit_code,
              t.user_id::text AS user_id, us.name AS user_name, t.department_id::text AS department_id, d.name AS department,
              t.period_kind, t.period_start::text AS period_start, t.target::float8 AS target,
              t.amber_pct::float8 AS amber_pct, t.red_pct::float8 AS red_pct
         FROM kpi_targets t
         JOIN kpi_definitions k ON k.code = t.kpi_code
         LEFT JOIN units u ON u.id = t.unit_id
         LEFT JOIN users us ON us.id = t.user_id
         LEFT JOIN departments d ON d.id = t.department_id
        ORDER BY t.period_start DESC, k.name LIMIT 500`,
    );
  },

  async saveTarget(
    caller: Caller,
    input: {
      kpiCode: string;
      unitId?: string | null;
      userId?: string | null;
      departmentId?: string | null;
      periodKind: 'DAY' | 'WEEK' | 'MONTH' | 'QUARTER' | 'FY';
      periodStart?: string;
      target: number;
      amberPct?: number;
      redPct?: number;
    },
  ): Promise<{ id: string }> {
    const amber = input.amberPct ?? 90;
    const red = input.redPct ?? 75;
    if (red > amber) throw Errors.validation({ redPct: 'The red limit cannot be above the amber limit.' });
    if (!(await defs([input.kpiCode]))[0]) throw Errors.validation({ kpiCode: 'Choose a KPI from the list.' });
    const start = input.periodStart ?? periodStart(input.periodKind);
    const rows = await query(
      prisma,
      `INSERT INTO kpi_targets (kpi_code, unit_id, user_id, department_id, period_kind, period_start, target, amber_pct, red_pct, set_by)
       VALUES ($1, $2::uuid, $3::uuid, $4::uuid, $5, $6::date, $7::numeric, $8::numeric, $9::numeric, $10::uuid)
       ON CONFLICT (kpi_code, coalesce(unit_id, '00000000-0000-0000-0000-000000000000'::uuid),
                    coalesce(department_id, '00000000-0000-0000-0000-000000000000'::uuid),
                    coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid), period_kind, period_start)
       DO UPDATE SET target = EXCLUDED.target, amber_pct = EXCLUDED.amber_pct, red_pct = EXCLUDED.red_pct,
                     set_by = EXCLUDED.set_by, updated_at = now()
       RETURNING id::text AS id`,
      input.kpiCode,
      input.unitId ?? null,
      input.userId ?? null,
      input.departmentId ?? null,
      input.periodKind,
      start,
      input.target,
      amber,
      red,
      caller.auth.userId,
    );
    const id = String(rows[0]?.id);
    await recordAudit({ action: 'kpi.target_set', actorId: caller.auth.userId, targetType: 'kpi_target', targetId: id, detail: { ...input } });
    return { id };
  },

  async deleteTarget(caller: Caller, id: string): Promise<void> {
    const n = await prisma.$executeRaw`DELETE FROM kpi_targets WHERE id = ${id}::uuid`;
    if (n === 0) throw Errors.notFound('Target not found.');
    await recordAudit({ action: 'kpi.target_deleted', actorId: caller.auth.userId, targetType: 'kpi_target', targetId: id });
  },

  // ----------------------------------------------------------------------------------------------- alerts
  async listAlertRules(): Promise<Row[]> {
    // unpaginated: admin-defined config table, a few hundred rows at most; page UIs read it whole
    return query(
      prisma,
      `SELECT r.id::text AS id, r.kpi_code, k.name AS kpi_name, r.unit_id::text AS unit_id, u.code AS unit_code, r.condition,
              r.threshold::float8 AS threshold, r.recipient_role_ids::text[] AS recipient_role_ids,
              r.recipient_user_ids::text[] AS recipient_user_ids, r.channels, r.cooldown_hours, r.active,
              (SELECT max(e.raised_at) FROM kpi_alert_events e WHERE e.rule_id = r.id) AS last_raised_at
         FROM kpi_alert_rules r JOIN kpi_definitions k ON k.code = r.kpi_code LEFT JOIN units u ON u.id = r.unit_id
        ORDER BY k.name, r.created_at LIMIT 500`,
    );
  },

  async saveAlertRule(
    caller: Caller,
    input: {
      kpiCode: string;
      unitId?: string | null;
      condition: 'GT' | 'LT' | 'BELOW_TARGET' | 'ABOVE_TARGET';
      threshold?: number | null;
      recipientRoleIds?: string[];
      recipientUserIds?: string[];
      channels?: string[];
      cooldownHours?: number;
      active?: boolean;
    },
  ): Promise<{ id: string }> {
    if (!(await defs([input.kpiCode]))[0]) throw Errors.validation({ kpiCode: 'Choose a KPI from the list.' });
    if ((input.condition === 'GT' || input.condition === 'LT') && (input.threshold === undefined || input.threshold === null)) {
      throw Errors.validation({ threshold: 'Enter the limit that raises the alert.' });
    }
    if ((input.recipientRoleIds?.length ?? 0) + (input.recipientUserIds?.length ?? 0) === 0) {
      throw Errors.validation({ recipients: 'Choose at least one person or role to alert.' });
    }
    const rows = await query(
      prisma,
      `INSERT INTO kpi_alert_rules (kpi_code, unit_id, condition, threshold, recipient_role_ids, recipient_user_ids, channels, cooldown_hours, active, created_by)
       VALUES ($1, $2::uuid, $3, $4::numeric, $5::uuid[], $6::uuid[], $7::text[], $8::int, $9, $10::uuid) RETURNING id::text AS id`,
      input.kpiCode,
      input.unitId ?? null,
      input.condition,
      input.threshold ?? null,
      input.recipientRoleIds ?? [],
      input.recipientUserIds ?? [],
      input.channels ?? ['in_app'],
      input.cooldownHours ?? 24,
      input.active ?? true,
      caller.auth.userId,
    );
    const id = String(rows[0]?.id);
    await recordAudit({ action: 'kpi.alert_rule_created', actorId: caller.auth.userId, targetType: 'kpi_alert_rule', targetId: id, detail: { ...input } });
    return { id };
  },

  async setAlertActive(caller: Caller, id: string, active: boolean): Promise<void> {
    const n = await prisma.$executeRaw`UPDATE kpi_alert_rules SET active = ${active}, updated_at = now() WHERE id = ${id}::uuid`;
    if (n === 0) throw Errors.notFound('Alert rule not found.');
    await recordAudit({ action: 'kpi.alert_rule_toggled', actorId: caller.auth.userId, targetType: 'kpi_alert_rule', targetId: id, detail: { active } });
  },

  async deleteAlertRule(caller: Caller, id: string): Promise<void> {
    const n = await prisma.$executeRaw`DELETE FROM kpi_alert_rules WHERE id = ${id}::uuid`;
    if (n === 0) throw Errors.notFound('Alert rule not found.');
    await recordAudit({ action: 'kpi.alert_rule_deleted', actorId: caller.auth.userId, targetType: 'kpi_alert_rule', targetId: id });
  },

  /**
   * Job kpi.alerts: checks every active rule for its plant (or every active plant) and notifies the recipients
   * when the value crosses the limit, at most once per cooldown. Returns how many alerts were raised.
   */
  async evaluateAlerts(now = new Date()): Promise<{ checked: number; raised: number }> {
    // unpaginated: system fan-out/queue worker: must visit every eligible row, runs in a job in batches or per event
    const rules = await query(prisma, `SELECT * FROM kpi_alert_rules WHERE active ORDER BY created_at`);
    const units = (await query(prisma, `SELECT id::text AS id, code, name FROM units WHERE status = 'ACTIVE'`)) as unknown as {
      id: string;
      code: string;
      name: string;
    }[];
    const company = (await query(prisma, `SELECT id::text AS id FROM companies ORDER BY created_at LIMIT 1`))[0];
    const fy = (await query(prisma, `SELECT id::text AS id FROM financial_years WHERE is_current ORDER BY start_date DESC LIMIT 1`))[0];
    let checked = 0;
    let raised = 0;
    for (const rule of rules) {
      const def = (await defs([String(rule.kpi_code)]))[0];
      if (!def) continue;
      const targetUnits = rule.unit_id ? units.filter((u) => u.id === String(rule.unit_id)) : units;
      for (const unit of targetUnits) {
        checked += 1;
        const system = {
          auth: { userId: String(rule.created_by ?? ''), user: {} },
          ctx: { companyId: company?.id ?? '', unitId: unit.id, allUnits: false, unitIds: [unit.id], fyId: fy?.id ?? '' },
          meta: {},
        } as unknown as Caller;
        const value = (await biService.computeKpiValue(system, def.code)).value;
        const t = await targetFor(def.code, unit.id, null, null, def.target_val);
        if (!alertCrossed(String(rule.condition) as 'GT', value, rule.threshold === null ? null : Number(rule.threshold), t.target)) continue;
        const recent = await query(
          prisma,
          `SELECT 1 FROM kpi_alert_events WHERE rule_id = $1::uuid AND unit_id = $2::uuid AND raised_at > $3::timestamptz - ($4::int * interval '1 hour') LIMIT 1`,
          rule.id,
          unit.id,
          now,
          Number(rule.cooldown_hours),
        );
        if (recent[0]) continue;
        const recipients = await query(
          prisma,
          `SELECT DISTINCT u.id::text AS id FROM users u
            WHERE u.status = 'ACTIVE' AND (u.id = ANY($1::uuid[]) OR u.role_id = ANY($2::uuid[]))
              AND (EXISTS (SELECT 1 FROM user_units uu WHERE uu.user_id = u.id AND uu.unit_id = $3::uuid)
                   OR EXISTS (SELECT 1 FROM roles r WHERE r.id = u.role_id AND r.all_units)
                   OR u.all_units_access)`,
          rule.recipient_user_ids,
          rule.recipient_role_ids,
          unit.id,
        );
        const ids = recipients.map((r) => String(r.id));
        const limit = rule.threshold === null ? t.target : Number(rule.threshold);
        const body = `${def.name} is ${value ?? '—'} at ${unit.name}${limit === null ? '' : ` (limit ${limit})`}.`;
        let delivered = 0;
        if (ids.length > 0) {
          await notificationService.notify(prisma, ids, {
            type: 'kpi.alert',
            title: `KPI alert: ${def.name}`,
            body,
            link: def.drill_page ? `/m/${def.drill_page}` : '/m/kpi-alerts',
            entityType: 'kpi_alert_rule',
            entityId: String(rule.id),
            dedupeKey: `kpi:${String(rule.id)}:${unit.id}:${now.toISOString().slice(0, 13)}`,
          });
          delivered = ids.length;
        }
        await prisma.$executeRaw`
          INSERT INTO kpi_alert_events (rule_id, unit_id, value, threshold, raised_at, delivered)
          VALUES (${String(rule.id)}::uuid, ${unit.id}::uuid, ${value}::numeric, ${limit}::numeric, ${now}, ${delivered})`;
        raised += 1;
      }
    }
    return { checked, raised };
  },

  // ----------------------------------------------------------------------------------------------- TV mode
  /** Creates a read-only link for a plant's dashboard. The plain token is returned once; only its hash is stored. */
  async createTvToken(caller: Caller, key: string, unitId: string | null, days = 30) {
    const token = randomBytes(24).toString('base64url');
    const hash = createHash('sha256').update(token).digest('hex');
    const expires = new Date(Date.now() + days * 86_400_000);
    // rotating: older links for this dashboard and plant stop working
    await prisma.$executeRaw`UPDATE dashboard_tv_tokens SET revoked_at = now() WHERE dashboard_key = ${key} AND unit_id IS NOT DISTINCT FROM ${unitId}::uuid AND revoked_at IS NULL`;
    await prisma.$executeRaw`
      INSERT INTO dashboard_tv_tokens (dashboard_key, unit_id, token_hash, expires_at, created_by)
      VALUES (${key}, ${unitId}::uuid, ${hash}, ${expires}, ${caller.auth.userId}::uuid)`;
    await recordAudit({ action: 'dashboard.tv_token_created', actorId: caller.auth.userId, targetType: 'dashboard', targetId: key, detail: { unitId, days } });
    return { token, expiresAt: expires.toISOString() };
  },

  async tvView(key: string, token: string) {
    const hash = createHash('sha256').update(token).digest('hex');
    const rows = await query(
      prisma,
      `SELECT dashboard_key, unit_id::text AS unit_id, expires_at, revoked_at FROM dashboard_tv_tokens WHERE token_hash = $1`,
      hash,
    );
    const t = rows[0];
    if (!t || t.dashboard_key !== key || t.revoked_at || new Date(String(t.expires_at)) < new Date()) {
      throw Errors.unauthenticated();
    }
    const company = (await query(prisma, `SELECT id::text AS id FROM companies ORDER BY created_at LIMIT 1`))[0];
    const fy = (await query(prisma, `SELECT id::text AS id FROM financial_years WHERE is_current ORDER BY start_date DESC LIMIT 1`))[0];
    const unitIds = t.unit_id
      ? [String(t.unit_id)]
      : ((await query(prisma, `SELECT id::text AS id FROM units WHERE status = 'ACTIVE'`)) as unknown as { id: string }[]).map((u) => u.id);
    const system = {
      auth: { userId: '', user: {} },
      ctx: { companyId: company?.id ?? '', unitId: unitIds[0] ?? null, allUnits: false, unitIds, fyId: fy?.id ?? '' },
      meta: {},
    } as unknown as Caller;
    const list = key.startsWith('department:') ? await defs(undefined, key.slice('department:'.length)) : await defs();
    const grid = await this.compareGrid(system, list);
    return { key, title: key === 'owner' ? 'Owner Console' : key, refreshSeconds: 60, ...grid };
  },

  // ----------------------------------------------------------------------------------------------- schedules
  async listSchedules(): Promise<Row[]> {
    // unpaginated: admin-defined config table, a few hundred rows at most; page UIs read it whole
    return query(prisma, `SELECT id::text AS id, dashboard_key, name, cron_expr, recipient_user_ids::text[] AS recipient_user_ids, active, last_run_at FROM dashboard_schedules ORDER BY name LIMIT 200`);
  },

  async saveSchedule(
    caller: Caller,
    input: { dashboardKey: string; name: string; cronExpr: string; recipientUserIds: string[] },
  ): Promise<{ id: string }> {
    if (!parseDailyCron(input.cronExpr)) {
      throw Errors.validation({ cronExpr: 'Use a daily time such as "0 8 * * *" (08:00 every day).' });
    }
    if (input.recipientUserIds.length === 0) throw Errors.validation({ recipients: 'Choose at least one person.' });
    const rows = await query(
      prisma,
      `INSERT INTO dashboard_schedules (dashboard_key, name, cron_expr, recipient_user_ids, created_by)
       VALUES ($1, $2, $3, $4::uuid[], $5::uuid) RETURNING id::text AS id`,
      input.dashboardKey,
      input.name,
      input.cronExpr,
      input.recipientUserIds,
      caller.auth.userId,
    );
    const id = String(rows[0]?.id);
    await recordAudit({ action: 'dashboard.schedule_created', actorId: caller.auth.userId, targetType: 'dashboard_schedule', targetId: id, detail: { ...input } });
    return { id };
  },

  /**
   * Job dashboard.emails: sends every due daily schedule. Each recipient gets the dashboard for THEIR plants only
   * (their user_units, or every active plant for an all-plants user), never wider than their own access.
   */
  async runDueSchedules(now = new Date()): Promise<{ due: number; sent: number }> {
    // unpaginated: system fan-out/queue worker: must visit every eligible row, runs in a job in batches or per event
    const schedules = await query(prisma, `SELECT * FROM dashboard_schedules WHERE active`);
    const company = (await query(prisma, `SELECT id::text AS id FROM companies ORDER BY created_at LIMIT 1`))[0];
    const fy = (await query(prisma, `SELECT id::text AS id FROM financial_years WHERE is_current ORDER BY start_date DESC LIMIT 1`))[0];
    let due = 0;
    let sent = 0;
    for (const s of schedules) {
      const cron = parseDailyCron(String(s.cron_expr));
      if (!cron || !dailyDue(cron, now, s.last_run_at ? new Date(String(s.last_run_at)) : null)) continue;
      due += 1;
      const key = String(s.dashboard_key);
      const list = key.startsWith('department:') ? await defs(undefined, key.slice('department:'.length)) : await defs();
      for (const uid of s.recipient_user_ids as string[]) {
        const u = (
          await query(
            prisma,
            `SELECT u.id::text AS id, u.name, u.email,
                    (r.all_units OR u.all_units_access) AS everything
               FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = $1::uuid AND u.status = 'ACTIVE'`,
            uid,
          )
        )[0];
        if (!u || !u.email) continue;
        const unitRows = await query(
          prisma,
          `SELECT id::text AS id FROM units WHERE status = 'ACTIVE' AND ($1::boolean OR id IN (SELECT unit_id FROM user_units WHERE user_id = $2::uuid))`,
          Boolean(u.everything),
          uid,
        );
        const unitIds = unitRows.map((r) => String(r.id));
        if (unitIds.length === 0) continue;
        const caller = {
          auth: { userId: uid, user: {} },
          ctx: { companyId: company?.id ?? '', unitId: unitIds[0] ?? null, allUnits: false, unitIds, fyId: fy?.id ?? '' },
          meta: {},
        } as unknown as Caller;
        const grid = await this.compareGrid(caller, list);
        const head = grid.plants.map((p) => `<th>${p.name}</th>`).join('');
        const body = grid.rows
          .map(
            (row) =>
              `<tr><td>${row.name}</td>${row.cells.map((c) => `<td>${c.value ?? '—'}</td>`).join('')}<td>${row.total ?? '—'}</td></tr>`,
          )
          .join('');
        const html = `<h2>${String(s.name)}</h2><table border="1" cellpadding="6" cellspacing="0"><tr><th>KPI</th>${head}<th>Total</th></tr>${body}</table>`;
        if (await mailService.sendHtml(String(u.email), String(s.name), html)) sent += 1;
      }
      await prisma.$executeRaw`UPDATE dashboard_schedules SET last_run_at = ${now} WHERE id = ${String(s.id)}::uuid`;
    }
    return { due, sent };
  },

  async deleteSchedule(caller: Caller, id: string): Promise<void> {
    const n = await prisma.$executeRaw`DELETE FROM dashboard_schedules WHERE id = ${id}::uuid`;
    if (n === 0) throw Errors.notFound('Schedule not found.');
    await recordAudit({ action: 'dashboard.schedule_deleted', actorId: caller.auth.userId, targetType: 'dashboard_schedule', targetId: id });
  },
};
