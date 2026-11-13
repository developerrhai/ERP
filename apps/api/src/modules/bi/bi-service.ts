// apps/api/src/modules/bi/bi-service.ts
import { prisma } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { recordAudit } from '../../core/audit/audit-service';
import { accessUserOf, can, scopeFor } from '../../core/rbac/access';
import { norm, query, exec } from '../procurement/core';
import type { Row } from '../procurement/core';
import type { Caller } from '../records/service';
import { safeRatio } from './bi-calc';

export interface DatasetColumnMeta {
  key: string;
  label: string;
  type: 'string' | 'number' | 'date';
  sensitive: boolean;
  filterable: boolean;
  groupable: boolean;
}

export interface DatasetFilter {
  column: string;
  op: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'contains' | 'is_null';
  value?: unknown;
}

export class BiService {
  async listDatasets(): Promise<Row[]> {
    const rows = await query(prisma, `SELECT * FROM bi_datasets ORDER BY label ASC`);
    return rows.map(norm);
  }

  /**
   * Builds unit & record-level SQL scope predicate matching source module visibility.
   */
  async buildScopePredicate(
    caller: Caller,
    permissionResource: string,
    unitCol = 'unit_id',
    ownerCol = 'created_by_id',
    args: unknown[] = [],
  ): Promise<{ sql: string; args: unknown[]; scopeLabel: string }> {
    const parts: string[] = ['1=1'];
    let scopeLabel = 'ALL';

    if (unitCol) {
      if (!caller.ctx.allUnits && caller.ctx.unitId) {
        args.push(caller.ctx.unitId);
        parts.push(`(${unitCol} = $${args.length}::uuid OR ${unitCol} IS NULL)`);
        scopeLabel = `UNIT:${caller.ctx.unitId}`;
      } else if (!caller.ctx.allUnits && !caller.ctx.unitId) {
        parts.push('1=0');
        scopeLabel = 'NONE';
      }
    }

    if (caller.auth.level < 95 && ownerCol) {
      const recScope = await scopeFor(accessUserOf(caller.auth.user), permissionResource);
      if (recScope === 'OWN') {
        args.push(caller.auth.userId);
        parts.push(`${ownerCol} = $${args.length}::uuid`);
        scopeLabel = `OWN:${caller.auth.userId}`;
      }
    }

    return { sql: parts.join(' AND '), args, scopeLabel };
  }

  /**
   * No-SQL Governed Report Query on whitelisted dataset view only.
   */
  async queryDataset(
    caller: Caller,
    params: {
      datasetCode: string;
      columns?: string[];
      filters?: DatasetFilter[];
      groupBy?: string[];
      limit?: number;
    },
  ): Promise<{ rows: Row[]; total: number; dataset: Row; scopeApplied: string }> {
    const dsRows = await query(prisma, `SELECT * FROM bi_datasets WHERE code = $1`, params.datasetCode);
    if (!dsRows[0]) throw Errors.notFound(`Unknown dataset: ${params.datasetCode}`);
    const ds = dsRows[0];

    const permRes = String(ds.permission_resource);
    if (caller.auth.level < 99) {
      const allowed = await can(accessUserOf(caller.auth.user), permRes, 'view');
      if (!allowed) {
        const msg = `You don't have access to dataset ${ds.label}.`;
        throw Errors.forbidden(msg);
      }
    }

    const colMeta = (Array.isArray(ds.columns) ? ds.columns : []) as DatasetColumnMeta[];
    const colMap = new Map(colMeta.map((c) => [c.key, c]));

    // Validate requested columns
    const requestedCols =
      params.columns && params.columns.length > 0
        ? params.columns.filter((c) => colMap.has(c))
        : colMeta.map((c) => c.key);

    if (requestedCols.length === 0) {
      throw Errors.validation({ columns: 'Select at least one valid column.' });
    }

    // Validate filters strictly against whitelisted filterable columns
    const args: unknown[] = [];
    const whereParts: string[] = [];

    for (const f of params.filters ?? []) {
      const meta = colMap.get(f.column);
      if (!meta || !meta.filterable) {
        const msg = `Column ${f.column} cannot be filtered.`;
        throw Errors.validation({ filters: msg }, msg);
      }
      const colIdent = `"${meta.key}"`;
      switch (f.op) {
        case 'is_null':
          whereParts.push(`${colIdent} IS ${f.value === false ? 'NOT NULL' : 'NULL'}`);
          break;
        case 'eq':
          args.push(f.value);
          whereParts.push(`${colIdent} = $${args.length}`);
          break;
        case 'ne':
          args.push(f.value);
          whereParts.push(`${colIdent} <> $${args.length}`);
          break;
        case 'gt':
          args.push(f.value);
          whereParts.push(`${colIdent} > $${args.length}`);
          break;
        case 'gte':
          args.push(f.value);
          whereParts.push(`${colIdent} >= $${args.length}`);
          break;
        case 'lt':
          args.push(f.value);
          whereParts.push(`${colIdent} < $${args.length}`);
          break;
        case 'lte':
          args.push(f.value);
          whereParts.push(`${colIdent} <= $${args.length}`);
          break;
        case 'contains':
          args.push(`%${String(f.value ?? '')}%`);
          whereParts.push(`${colIdent}::text ILIKE $${args.length}`);
          break;
        case 'in':
          if (Array.isArray(f.value)) {
            args.push(f.value);
            whereParts.push(`${colIdent} = ANY($${args.length})`);
          }
          break;
      }
    }

    const scope = await this.buildScopePredicate(
      caller,
      permRes,
      ds.unit_column ? String(ds.unit_column) : '',
      ds.owner_column ? String(ds.owner_column) : '',
      args,
    );

    const viewName = String(ds.view_name);
    const selectClause = requestedCols.map((c) => `"${c}"`).join(', ');
    const whereClause = [scope.sql, ...whereParts].join(' AND ');
    const limit = Math.min(Math.max(1, params.limit ?? 200), 1000);

    const sql = `SELECT ${selectClause} FROM "${viewName}" WHERE ${whereClause} LIMIT ${limit}`;
    const rawRows = await query(prisma, sql, ...args);

    // Mask sensitive fields unless privileged HR/Finance Admin (>= 90)
    const canSeeSensitive = caller.auth.level >= 90;
    const maskedRows = rawRows.map((r) => {
      const copy: Row = {};
      for (const key of requestedCols) {
        const meta = colMap.get(key)!;
        copy[key] = meta.sensitive && !canSeeSensitive ? '****' : r[key];
      }
      return norm(copy);
    });

    return {
      rows: maskedRows,
      total: maskedRows.length,
      dataset: norm(ds),
      scopeApplied: scope.scopeLabel,
    };
  }

  // ------------------------------------------------------------------------- Reports & Schedules
  async listReports(caller: Caller): Promise<Row[]> {
    const rows = await query(
      prisma,
      `SELECT r.*, d.label AS dataset_label FROM report_definitions r JOIN bi_datasets d ON d.code = r.dataset_code
       WHERE r.visibility = 'ALL' OR r.created_by_id = $1::uuid OR r.department = $2
       ORDER BY r.created_at DESC`,
      caller.auth.userId,
      caller.auth.user.department ?? 'Administration',
    );
    return rows.map(norm);
  }

  async createReport(
    caller: Caller,
    input: {
      code: string;
      name: string;
      datasetCode: string;
      columns: string[];
      filters?: DatasetFilter[];
      groupBy?: string[];
      chartType?: string;
      visibility?: 'PRIVATE' | 'DEPARTMENT' | 'ALL';
    },
  ): Promise<Row> {
    const rows = await query(
      prisma,
      `INSERT INTO report_definitions (
        code, name, dataset_code, columns, filters, group_by, chart_type, visibility, department, created_by_id
      ) VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7,$8,$9,$10::uuid)
      RETURNING *`,
      input.code.trim().toUpperCase(),
      input.name,
      input.datasetCode,
      JSON.stringify(input.columns),
      JSON.stringify(input.filters ?? []),
      JSON.stringify(input.groupBy ?? []),
      input.chartType ?? 'TABLE',
      input.visibility ?? 'DEPARTMENT',
      caller.auth.user.department ?? 'Administration',
      caller.auth.userId,
    );
    return norm(rows[0]!);
  }

  async runReport(caller: Caller, reportId: string) {
    const t0 = Date.now();
    const repRows = await query(prisma, `SELECT * FROM report_definitions WHERE id = $1::uuid`, reportId);
    if (!repRows[0]) throw Errors.notFound(`Report not found: ${reportId}`);
    const rep = repRows[0];

    const res = await this.queryDataset(caller, {
      datasetCode: String(rep.dataset_code),
      columns: Array.isArray(rep.columns) ? (rep.columns as string[]) : undefined,
      filters: Array.isArray(rep.filters) ? (rep.filters as DatasetFilter[]) : [],
      limit: 500,
    });

    const durationMs = Date.now() - t0;
    await exec(
      prisma,
      `INSERT INTO report_runs (report_id, run_by_id, row_count, duration_ms) VALUES ($1::uuid, $2::uuid, $3, $4)`,
      reportId,
      caller.auth.userId,
      res.rows.length,
      durationMs,
    );
    await recordAudit(
      {
        actorId: caller.auth.userId,
        action: 'bi.report.run',
        targetType: 'report_definitions',
        targetId: reportId,
        detail: { rowCount: res.rows.length, durationMs },
      },
      prisma,
    );
    return { report: norm(rep), rows: res.rows, rowCount: res.rows.length, durationMs };
  }

  async createSchedule(
    caller: Caller,
    input: {
      reportId: string;
      cronExpr: string;
      format?: 'PDF' | 'XLSX' | 'CSV';
      recipientUserIds: string[];
    },
  ): Promise<Row> {
    // Reject schedules firing more frequently than every 15 minutes
    const parts = input.cronExpr.trim().split(/\s+/);
    const minPart = parts[0] ?? '*';
    if (minPart === '*') {
      const msg = 'Schedules can run at most every 15 minutes.';
      throw Errors.validation({ cronExpr: msg }, msg);
    }
    const stepMatch = /^\*\/(\d+)$/.exec(minPart);
    if (stepMatch && Number(stepMatch[1]) < 15) {
      const msg = 'Schedules can run at most every 15 minutes.';
      throw Errors.validation({ cronExpr: msg }, msg);
    }

    const rows = await query(
      prisma,
      `INSERT INTO report_schedules (report_id, cron_expr, format, run_as_user_id, recipient_user_ids)
       VALUES ($1::uuid, $2, $3, $4::uuid, $5::jsonb) RETURNING *`,
      input.reportId,
      input.cronExpr,
      input.format ?? 'CSV',
      caller.auth.userId,
      JSON.stringify(input.recipientUserIds),
    );
    return norm(rows[0]!);
  }

  // ------------------------------------------------------------------------- Real SQL KPIs & Dashboards
  async computeKpiValue(
    caller: Caller,
    kpiCode: string,
  ): Promise<{
    code: string;
    name: string;
    value: number | null;
    numerator: number | null;
    denominator: number | null;
    unitLabel: string;
    formulaText: string;
    rowCount: number;
    tooltip: string;
  }> {
    const defs = await query(prisma, `SELECT * FROM kpi_definitions WHERE code = $1`, kpiCode);
    if (!defs[0]) throw Errors.notFound(`Unknown KPI: ${kpiCode}`);
    const def = defs[0];
    const unitFilter = !caller.ctx.allUnits && caller.ctx.unitId ? caller.ctx.unitId : null;

    let value: number | null = null;
    let numerator: number | null = null;
    let denominator: number | null = null;
    let rowCount = 0;
    let formulaText = String(def.formula_key);

    switch (kpiCode) {
      case 'admin_active_sessions': {
        const r = await query(
          prisma,
          `SELECT COUNT(*) AS cnt FROM sessions WHERE revoked_at IS NULL AND expires_at > now()`,
        );
        rowCount = Number(r[0]?.cnt ?? 0);
        value = rowCount;
        formulaText = 'Active non-revoked user sessions';
        break;
      }
      case 'admin_pending_approvals': {
        const r = await query(
          prisma,
          `SELECT COUNT(*) AS cnt FROM approval_requests WHERE status = 'PENDING' AND ($1::uuid IS NULL OR unit_id = $1::uuid)`,
          unitFilter,
        );
        rowCount = Number(r[0]?.cnt ?? 0);
        value = rowCount;
        formulaText = 'Count of PENDING approval requests';
        break;
      }
      case 'admin_failed_jobs': {
        const r = await query(
          prisma,
          `SELECT COUNT(*) AS cnt FROM webhook_deliveries WHERE status = 'DEAD_LETTER' AND created_at >= now() - interval '24 hours'`,
        );
        rowCount = Number(r[0]?.cnt ?? 0);
        value = rowCount;
        formulaText = 'Failed webhook deliveries in 24h';
        break;
      }
      case 'admin_security_alerts': {
        const r = await query(
          prisma,
          `SELECT COUNT(*) AS cnt FROM users WHERE locked_until IS NOT NULL AND locked_until > now()`,
        );
        rowCount = Number(r[0]?.cnt ?? 0);
        value = rowCount;
        formulaText = 'Locked user accounts';
        break;
      }
      case 'sales_orders_mtd': {
        const r = await query(
          prisma,
          `SELECT COUNT(*) AS cnt, COALESCE(SUM(grand_total), 0) AS amt FROM sales_orders WHERE deleted_at IS NULL AND date_trunc('month', order_date) = date_trunc('month', CURRENT_DATE) AND ($1::uuid IS NULL OR unit_id = $1::uuid)`,
          unitFilter,
        );
        rowCount = Number(r[0]?.cnt ?? 0);
        value = Math.round(Number(r[0]?.amt ?? 0) * 100) / 100;
        formulaText = 'SUM(grand_total) of Sales Orders this month';
        break;
      }
      case 'sales_ar_overdue': {
        const r = await query(
          prisma,
          `SELECT COUNT(*) AS cnt, COALESCE(SUM(grand_total - received_amount), 0) AS amt FROM sales_invoices WHERE deleted_at IS NULL AND due_date < CURRENT_DATE AND grand_total > received_amount AND ($1::uuid IS NULL OR unit_id = $1::uuid)`,
          unitFilter,
        );
        rowCount = Number(r[0]?.cnt ?? 0);
        value = Math.round(Number(r[0]?.amt ?? 0) * 100) / 100;
        formulaText = 'SUM(balance_due) past due_date';
        break;
      }
      case 'sales_dso': {
        const r = await query(
          prisma,
          `SELECT COUNT(*) AS cnt, COALESCE(SUM(grand_total - received_amount), 0) AS ar, COALESCE(SUM(grand_total), 0) AS sales FROM sales_invoices WHERE deleted_at IS NULL AND invoice_date >= CURRENT_DATE - interval '90 days' AND ($1::uuid IS NULL OR unit_id = $1::uuid)`,
          unitFilter,
        );
        rowCount = Number(r[0]?.cnt ?? 0);
        numerator = Number(r[0]?.ar ?? 0) * 90;
        denominator = Number(r[0]?.sales ?? 0);
        value = safeRatio(numerator, denominator, 1);
        formulaText = 'AR / 90-day Credit Sales × 90';
        break;
      }
      case 'sales_invoiced_mtd': {
        const r = await query(
          prisma,
          `SELECT COUNT(*) AS cnt, COALESCE(SUM(grand_total), 0) AS amt FROM sales_invoices WHERE deleted_at IS NULL AND date_trunc('month', invoice_date) = date_trunc('month', CURRENT_DATE) AND ($1::uuid IS NULL OR unit_id = $1::uuid)`,
          unitFilter,
        );
        rowCount = Number(r[0]?.cnt ?? 0);
        value = Math.round(Number(r[0]?.amt ?? 0) * 100) / 100;
        formulaText = 'SUM(grand_total) of Sales Invoices this month';
        break;
      }
      case 'purch_open_pos': {
        const r = await query(
          prisma,
          `SELECT COUNT(*) AS cnt, COALESCE(SUM(grand_total), 0) AS amt FROM purchase_orders WHERE deleted_at IS NULL AND status IN ('APPROVED','ISSUED','PARTIALLY_RECEIVED') AND ($1::uuid IS NULL OR unit_id = $1::uuid)`,
          unitFilter,
        );
        rowCount = Number(r[0]?.cnt ?? 0);
        value = Math.round(Number(r[0]?.amt ?? 0) * 100) / 100;
        formulaText = 'SUM(grand_total) of open Purchase Orders';
        break;
      }
      case 'purch_grn_mtd': {
        const r = await query(
          prisma,
          `SELECT COUNT(*) AS cnt FROM goods_receipts WHERE deleted_at IS NULL AND date_trunc('month', receipt_date) = date_trunc('month', CURRENT_DATE) AND ($1::uuid IS NULL OR unit_id = $1::uuid)`,
          unitFilter,
        );
        rowCount = Number(r[0]?.cnt ?? 0);
        value = rowCount;
        formulaText = 'Count of Goods Receipts this month';
        break;
      }
      case 'fin_cash_bank': {
        const r = await query(
          prisma,
          `SELECT COUNT(*) AS cnt, COALESCE(SUM(ge.debit - ge.credit), 0) AS bal FROM gl_entries ge JOIN accounts a ON a.id = ge.account_id WHERE a.cf_class = 'CASH' AND ($1::uuid IS NULL OR ge.unit_id = $1::uuid)`,
          unitFilter,
        );
        rowCount = Number(r[0]?.cnt ?? 0);
        value = Math.round(Number(r[0]?.bal ?? 0) * 100) / 100;
        formulaText = 'SUM(debit - credit) across Cash & Bank accounts';
        break;
      }
      case 'fin_net_profit_mtd': {
        const r = await query(
          prisma,
          `SELECT COUNT(*) AS cnt, COALESCE(SUM(CASE WHEN a.root_type = 'Income' THEN ge.credit - ge.debit WHEN a.root_type = 'Expense' THEN -(ge.debit - ge.credit) ELSE 0 END), 0) AS profit FROM gl_entries ge JOIN accounts a ON a.id = ge.account_id WHERE date_trunc('month', ge.posting_date) = date_trunc('month', CURRENT_DATE) AND ($1::uuid IS NULL OR ge.unit_id = $1::uuid)`,
          unitFilter,
        );
        rowCount = Number(r[0]?.cnt ?? 0);
        value = Math.round(Number(r[0]?.profit ?? 0) * 100) / 100;
        formulaText = 'Income − Expenses MTD from GL Entries';
        break;
      }
      case 'hr_headcount': {
        const r = await query(
          prisma,
          `SELECT COUNT(DISTINCT e.id) AS cnt FROM employees e LEFT JOIN employee_assignments ea ON ea.employee_id = e.id AND ea.effective_to IS NULL WHERE e.deleted_at IS NULL AND e.status = 'ACTIVE' AND ($1::uuid IS NULL OR ea.unit_id = $1::uuid)`,
          unitFilter,
        );
        rowCount = Number(r[0]?.cnt ?? 0);
        value = rowCount;
        formulaText = 'Active employee headcount';
        break;
      }
      case 'hr_last_payroll': {
        const r = await query(
          prisma,
          `SELECT COUNT(*) AS cnt, COALESCE(MAX(total_gross), 0) AS gross FROM payroll_runs WHERE ($1::uuid IS NULL OR unit_id = $1::uuid)`,
          unitFilter,
        );
        rowCount = Number(r[0]?.cnt ?? 0);
        value = rowCount > 0 ? Number(r[0]?.gross ?? 0) : null;
        formulaText = 'Latest Payroll Run total gross';
        break;
      }
      case 'prod_wip_orders': {
        const r = await query(
          prisma,
          `SELECT COUNT(*) AS cnt FROM mfg_orders WHERE deleted_at IS NULL AND status IN ('Released','In Progress','In_Progress') AND ($1::uuid IS NULL OR unit_id = $1::uuid)`,
          unitFilter,
        );
        rowCount = Number(r[0]?.cnt ?? 0);
        value = rowCount;
        formulaText = 'Open Released / In-Progress Production Orders';
        break;
      }
      case 'prod_rejection_pct': {
        const r = await query(
          prisma,
          `SELECT COUNT(*) AS cnt, COALESCE(SUM(qty_rejected), 0) AS rej, COALESCE(SUM(qty_completed + qty_rejected), 0) AS tot FROM mfg_orders WHERE deleted_at IS NULL AND ($1::uuid IS NULL OR unit_id = $1::uuid)`,
          unitFilter,
        );
        rowCount = Number(r[0]?.cnt ?? 0);
        numerator = Number(r[0]?.rej ?? 0);
        denominator = Number(r[0]?.tot ?? 0);
        value = safeRatio(numerator, denominator, 100);
        formulaText = 'Rejected Qty / (Completed + Rejected Qty) × 100';
        break;
      }
      case 'qual_fpy': {
        const r = await query(
          prisma,
          `SELECT COUNT(*) AS cnt, COALESCE(SUM(accepted_qty), 0) AS acc, COALESCE(SUM(lot_qty), 0) AS lot FROM qms_inspections WHERE deleted_at IS NULL AND ($1::uuid IS NULL OR unit_id = $1::uuid)`,
          unitFilter,
        );
        rowCount = Number(r[0]?.cnt ?? 0);
        numerator = Number(r[0]?.acc ?? 0);
        denominator = Number(r[0]?.lot ?? 0);
        value = safeRatio(numerator, denominator, 100);
        formulaText = 'Accepted Qty / Total Inspected Lot Qty × 100 (FPY)';
        break;
      }
      case 'maint_open_mwo': {
        const r = await query(
          prisma,
          `SELECT COUNT(*) AS cnt FROM maint_work_orders WHERE deleted_at IS NULL AND status NOT IN ('CLOSED','CANCELLED','Completed') AND ($1::uuid IS NULL OR unit_id = $1::uuid)`,
          unitFilter,
        );
        rowCount = Number(r[0]?.cnt ?? 0);
        value = rowCount;
        formulaText = 'Open Maintenance Work Orders';
        break;
      }
      case 'wh_stock_value': {
        const r = await query(
          prisma,
          `SELECT COUNT(*) AS cnt, COALESCE(SUM(sb.value), 0) AS val FROM stock_balances sb JOIN warehouses w ON w.id = sb.warehouse_id WHERE ($1::uuid IS NULL OR w.unit_id = $1::uuid)`,
          unitFilter,
        );
        rowCount = Number(r[0]?.cnt ?? 0);
        value = Math.round(Number(r[0]?.val ?? 0) * 100) / 100;
        formulaText = 'SUM(stock_balances.value) across scoped warehouses';
        break;
      }
      case 'proj_active': {
        const r = await query(
          prisma,
          `SELECT COUNT(*) AS cnt FROM projects WHERE status IN ('PLANNING','ACTIVE') AND ($1::uuid IS NULL OR unit_id = $1::uuid)`,
          unitFilter,
        );
        rowCount = Number(r[0]?.cnt ?? 0);
        value = rowCount;
        formulaText = 'Count of active Customer Projects';
        break;
      }
      case 'proj_at_risk': {
        const r = await query(
          prisma,
          `SELECT COUNT(*) AS cnt FROM projects WHERE health IN ('AMBER','RED') AND status NOT IN ('CLOSED') AND ($1::uuid IS NULL OR unit_id = $1::uuid)`,
          unitFilter,
        );
        rowCount = Number(r[0]?.cnt ?? 0);
        value = rowCount;
        formulaText = 'Projects with CPI or SPI < 0.95';
        break;
      }
      case 'srv_open_tickets': {
        const r = await query(prisma, `SELECT COUNT(*) AS cnt FROM service_tickets WHERE status NOT IN ('RESOLVED','CLOSED')`);
        rowCount = Number(r[0]?.cnt ?? 0);
        value = rowCount;
        formulaText = 'Open customer service tickets';
        break;
      }
      case 'srv_sla_pct': {
        const r = await query(
          prisma,
          `SELECT COUNT(*) AS tot, COUNT(*) FILTER (WHERE sla_state <> 'BREACHED') AS met FROM service_tickets`,
        );
        rowCount = Number(r[0]?.tot ?? 0);
        numerator = Number(r[0]?.met ?? 0);
        denominator = rowCount;
        value = safeRatio(numerator, denominator, 100);
        formulaText = 'Tickets within SLA / Total Tickets × 100';
        break;
      }
    }

    const tooltip = value === null ? 'No data in period' : `${formulaText} (source rows: ${rowCount})`;
    return {
      code: String(def.code),
      name: String(def.name),
      value,
      numerator,
      denominator,
      unitLabel: String(def.unit_label),
      formulaText,
      rowCount,
      tooltip,
    };
  }

  async getDepartmentDashboard(caller: Caller, department: string): Promise<Row> {
    const deptKpis = await query(
      prisma,
      `SELECT code FROM kpi_definitions WHERE lower(department) = lower($1) ORDER BY code ASC`,
      department,
    );
    const kpiResults = [];
    for (const k of deptKpis) {
      kpiResults.push(await this.computeKpiValue(caller, String(k.code)));
    }

    // Real open exceptions across system
    const exceptions = await query(
      prisma,
      `SELECT id, doc_type AS module, doc_code, doc_title AS title, status, requested_at AS created_at
       FROM approval_requests WHERE status = 'PENDING'
         AND ($1::uuid IS NULL OR unit_id = $1::uuid)
       ORDER BY requested_at DESC LIMIT 20`,
      !caller.ctx.allUnits && caller.ctx.unitId ? caller.ctx.unitId : null,
    );

    return {
      department,
      kpis: kpiResults,
      exceptions: exceptions.map(norm),
      summary: `${department}: ${kpiResults.length} governed KPIs calculated directly from posted records (${exceptions.length} open approvals).`,
    };
  }

  async getCommandCenter(caller: Caller): Promise<Row> {
    const allKpis = await query(prisma, `SELECT code, department FROM kpi_definitions ORDER BY department, code`);
    const results = [];
    for (const k of allKpis) {
      results.push({
        department: String(k.department),
        ...(await this.computeKpiValue(caller, String(k.code))),
      });
    }
    return { kpis: results };
  }

  // ------------------------------------------------------------------------- Global Search (Postgres FTS 'simple')
  async upsertSearchDocument(input: {
    entityType: string;
    entityId: string;
    title: string;
    subtitle?: string;
    docNo?: string;
    docDate?: string;
    unitId?: string;
    department?: string;
    ownerUserId?: string;
    permissionResource: string;
  }): Promise<void> {
    await exec(
      prisma,
      `INSERT INTO search_index (
        entity_type, entity_id, title, subtitle, doc_no, doc_date, unit_id, department, owner_user_id, permission_resource, updated_at
      ) VALUES ($1,$2::uuid,$3,$4,$5,$6::date,$7::uuid,$8,$9::uuid,$10,now())
      ON CONFLICT (entity_type, entity_id) DO UPDATE SET
        title = EXCLUDED.title,
        subtitle = EXCLUDED.subtitle,
        doc_no = EXCLUDED.doc_no,
        doc_date = EXCLUDED.doc_date,
        unit_id = EXCLUDED.unit_id,
        department = EXCLUDED.department,
        updated_at = now()`,
      input.entityType,
      input.entityId,
      input.title,
      input.subtitle ?? null,
      input.docNo ?? null,
      input.docDate ?? null,
      input.unitId ?? null,
      input.department ?? null,
      input.ownerUserId ?? null,
      input.permissionResource,
    );
  }

  async globalSearch(caller: Caller, q: string, types?: string[]): Promise<Row[]> {
    const term = q.trim();
    if (!term) return [];

    const args: unknown[] = [term];
    const conds: string[] = [`(si.tsv @@ websearch_to_tsquery('simple', $1) OR si.doc_no % $1 OR si.title ILIKE '%' || $1 || '%')`];

    if (!caller.ctx.allUnits && caller.ctx.unitId) {
      args.push(caller.ctx.unitId);
      conds.push(`(si.unit_id = $${args.length}::uuid OR si.unit_id IS NULL)`);
    }
    if (types && types.length > 0) {
      args.push(types);
      conds.push(`si.entity_type = ANY($${args.length})`);
    }

    const sql = `
      SELECT si.entity_type, si.entity_id, si.title, si.subtitle, si.doc_no, si.doc_date,
             si.unit_id, si.department, si.permission_resource,
             COALESCE(ts_rank_cd(si.tsv, websearch_to_tsquery('simple', $1)), 0) AS rank
      FROM search_index si
      WHERE ${conds.join(' AND ')}
      ORDER BY rank DESC, si.doc_date DESC NULLS LAST
      LIMIT 20
    `;
    const rows = await query(prisma, sql, ...args);

    // Filter each hit by caller's real view permission!
    const authorized: Row[] = [];
    for (const r of rows) {
      if (caller.auth.level >= 99) {
        authorized.push(norm(r));
        continue;
      }
      const allowed = await can(accessUserOf(caller.auth.user), String(r.permission_resource), 'view');
      if (allowed) authorized.push(norm(r));
    }
    return authorized;
  }
}

export const biService = new BiService();

