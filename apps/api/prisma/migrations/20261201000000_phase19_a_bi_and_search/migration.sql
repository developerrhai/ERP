-- Phase 19 Part A: BI Views, Datasets, KPIs, Reports, Schedules & Global Search Index
-- Compliant with ERRATA E-18 (no company_id columns)

-- ---------------------------------------------------------------------------
-- 1. Governed SQL Dataset Views
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW "sales_orders_v" AS
SELECT so.id, so.number AS doc_no, so.order_date, so.delivery_date AS due_date, so.status,
       so.unit_id, so.department, so.created_by_id,
       c.code AS customer_code, c.name AS customer_name,
       so.taxable, so.grand_total
FROM sales_orders so
JOIN customers c ON c.id = so.customer_id
WHERE so.deleted_at IS NULL;

CREATE OR REPLACE VIEW "invoices_v" AS
SELECT si.id, si.number AS doc_no, si.invoice_date, si.due_date, si.status, si.receipt_status,
       si.unit_id, si.department, si.created_by_id,
       c.code AS customer_code, c.name AS customer_name,
       si.taxable, si.grand_total, si.received_amount,
       (si.grand_total - si.received_amount) AS balance_due
FROM sales_invoices si
JOIN customers c ON c.id = si.customer_id
WHERE si.deleted_at IS NULL;

CREATE OR REPLACE VIEW "ar_aging_v" AS
SELECT si.id, si.number AS doc_no, si.invoice_date, si.due_date, si.unit_id, si.department, si.created_by_id,
       c.name AS customer_name, (si.grand_total - si.received_amount) AS overdue_amount,
       GREATEST(0, CURRENT_DATE - si.due_date) AS overdue_days
FROM sales_invoices si
JOIN customers c ON c.id = si.customer_id
WHERE si.deleted_at IS NULL AND si.grand_total > si.received_amount;

CREATE OR REPLACE VIEW "po_lines_v" AS
SELECT pol.id, po.id AS po_id, po.number AS doc_no, po.po_date, po.status,
       po.unit_id, po.department, po.created_by_id,
       s.name AS supplier_name, i.code AS item_code, i.name AS item_name,
       pol.qty, pol.received_qty, pol.rate, pol.taxable
FROM purchase_order_lines pol
JOIN purchase_orders po ON po.id = pol.po_id
JOIN suppliers s ON s.id = po.supplier_id
LEFT JOIN items i ON i.id = pol.item_id
WHERE po.deleted_at IS NULL;

CREATE OR REPLACE VIEW "grn_v" AS
SELECT grn.id, grn.number AS doc_no, grn.receipt_date, grn.status, grn.qc_status,
       grn.unit_id, grn.department, grn.created_by_id,
       s.name AS supplier_name, grn.total_value
FROM goods_receipts grn
JOIN suppliers s ON s.id = grn.supplier_id
WHERE grn.deleted_at IS NULL;

CREATE OR REPLACE VIEW "stock_balance_v" AS
SELECT sb.item_id, sb.warehouse_id, w.unit_id, 'Stores'::varchar AS department, NULL::uuid AS created_by_id,
       i.code AS item_code, i.name AS item_name, w.code AS warehouse_code,
       sb.on_hand, sb.reserved_qty, sb.avg_rate, sb.value AS stock_value
FROM stock_balances sb
JOIN items i ON i.id = sb.item_id
JOIN warehouses w ON w.id = sb.warehouse_id;

CREATE OR REPLACE VIEW "stock_ledger_v" AS
SELECT sl.id, sl.posting_date, sl.unit_id, 'Stores'::varchar AS department, sl.created_by_id,
       i.code AS item_code, i.name AS item_name, w.code AS warehouse_code,
       sl.voucher_type, sl.voucher_no, sl.qty_in, sl.qty_out, sl.rate, sl.value
FROM stock_ledger sl
JOIN items i ON i.id = sl.item_id
JOIN warehouses w ON w.id = sl.warehouse_id;

CREATE OR REPLACE VIEW "gl_trial_v" AS
SELECT ge.id, ge.posting_date, ge.unit_id, 'Finance'::varchar AS department, ge.created_by_id,
       a.code AS account_code, a.name AS account_name, a.root_type,
       ge.voucher_type, ge.voucher_no, ge.debit, ge.credit, ge.project_id
FROM gl_entries ge
JOIN accounts a ON a.id = ge.account_id;

CREATE OR REPLACE VIEW "production_orders_v" AS
SELECT mo.id, mo.number AS doc_no, mo.status, mo.unit_id, 'Production'::varchar AS department, mo.created_by_id,
       i.code AS item_code, i.name AS item_name,
       mo.qty, mo.qty_completed, mo.qty_scrapped, mo.qty_rejected, mo.start_date, mo.due_date, mo.std_value
FROM mfg_orders mo
JOIN items i ON i.id = mo.item_id
WHERE mo.deleted_at IS NULL;

CREATE OR REPLACE VIEW "inspections_v" AS
SELECT qi.id, qi.number AS doc_no, qi.kind, qi.status, qi.decision, qi.doc_date,
       qi.unit_id, qi.department, qi.created_by_id,
       qi.lot_qty, qi.accepted_qty, qi.rejected_qty
FROM qms_inspections qi
WHERE qi.deleted_at IS NULL;

CREATE OR REPLACE VIEW "ncr_v" AS
SELECT qf.id, qf.number AS doc_no, qf.kind, qf.status, qf.title, qf.doc_date,
       qf.unit_id, qf.department, qf.created_by_id
FROM qms_forms qf
WHERE qf.deleted_at IS NULL;

CREATE OR REPLACE VIEW "pm_orders_v" AS
SELECT mwo.id, mwo.mwo_no AS doc_no, mwo.wo_type, mwo.priority, mwo.status,
       mwo.unit_id, 'Maintenance'::varchar AS department, mwo.created_by_id,
       mwo.est_cost, mwo.planned_start, mwo.actual_end
FROM maint_work_orders mwo
WHERE mwo.deleted_at IS NULL;

CREATE OR REPLACE VIEW "employees_v" AS
SELECT e.id, e.emp_code, (e.first_name || ' ' || e.last_name) AS full_name,
       e.status, e.joining_date, e.mobile, e.pan,
       ea.unit_id, COALESCE(ea.department, 'HR') AS department, e.created_by_id
FROM employees e
LEFT JOIN employee_assignments ea ON ea.employee_id = e.id AND ea.effective_to IS NULL
WHERE e.deleted_at IS NULL;

CREATE OR REPLACE VIEW "payroll_runs_v" AS
SELECT pr.id, pr.run_no AS doc_no, pr.run_type, pr.status,
       pr.unit_id, 'HR'::varchar AS department, pr.created_by_id,
       pr.total_gross, pr.total_deductions, pr.total_net, pr.employee_count, pr.created_at
FROM payroll_runs pr;

CREATE OR REPLACE VIEW "projects_v" AS
SELECT p.id, p.code AS doc_no, p.name, p.project_type, p.status, p.health,
       p.unit_id, 'Projects'::varchar AS department, p.created_by_id,
       p.contract_value, p.start_date, p.end_date
FROM projects p;

CREATE OR REPLACE VIEW "timesheets_v" AS
SELECT ts.id, ts.timesheet_no AS doc_no, ts.week_start, ts.total_hours, ts.status,
       ea.unit_id, COALESCE(ea.department, 'Projects') AS department, ts.created_by_id,
       e.emp_code, (e.first_name || ' ' || e.last_name) AS employee_name
FROM timesheets ts
JOIN employees e ON e.id = ts.employee_id
LEFT JOIN employee_assignments ea ON ea.employee_id = e.id AND ea.effective_to IS NULL;

CREATE OR REPLACE VIEW "tickets_v" AS
SELECT st.id, st.ticket_no AS doc_no, st.subject, st.category, st.priority, st.sla_state, st.status,
       NULL::uuid AS unit_id, 'Service'::varchar AS department, NULL::uuid AS created_by_id,
       c.name AS customer_name, st.created_at, st.resolved_at
FROM service_tickets st
JOIN customers c ON c.id = st.customer_id;

CREATE OR REPLACE VIEW "shipments_v" AS
SELECT s.id, s.shipment_no AS doc_no, s.status, s.unit_id, 'Logistics'::varchar AS department, s.created_by_id,
       c.name AS customer_name, s.weight_kg, s.planned_delivery_at, s.actual_delivery_at
FROM shipments s
LEFT JOIN customers c ON c.id = s.customer_id
WHERE s.deleted_at IS NULL;

CREATE OR REPLACE VIEW "gate_passes_v" AS
SELECT gp.id, gp.pass_no AS doc_no, gp.direction, gp.pass_type, gp.vehicle_no, gp.status,
       gp.unit_id, 'Security'::varchar AS department, gp.created_by_id,
       gp.net_kg, gp.entry_at, gp.exit_at
FROM gate_passes gp
WHERE gp.deleted_at IS NULL;

CREATE OR REPLACE VIEW "fuel_logs_v" AS
SELECT fl.id, fl.fuel_no AS doc_no, fl.filled_at, fl.odometer, fl.litres, fl.amount, fl.kmpl, fl.status,
       fl.unit_id, 'Logistics'::varchar AS department, fl.created_by_id,
       v.reg_no
FROM fuel_logs fl
JOIN vehicles v ON v.id = fl.vehicle_id;

CREATE OR REPLACE VIEW "dms_documents_v" AS
SELECT d.id, d.doc_code AS doc_no, d.title, d.confidentiality, d.status, d.legal_hold, d.disposition_due,
       d.unit_id, 'Administration'::varchar AS department, d.owner_id AS created_by_id
FROM dms_documents d
WHERE d.deleted_at IS NULL;

CREATE OR REPLACE VIEW "approvals_v" AS
SELECT ar.id, ar.doc_type, ar.doc_code AS doc_no, ar.doc_title, ar.status, ar.amount,
       ar.unit_id, 'Administration'::varchar AS department, ar.created_by_id, ar.requested_at
FROM approval_requests ar;

-- ---------------------------------------------------------------------------
-- 2. BI Tables
-- ---------------------------------------------------------------------------
CREATE TABLE "bi_datasets" (
  "code" VARCHAR(50) PRIMARY KEY,
  "label" VARCHAR(120) NOT NULL,
  "view_name" VARCHAR(60) NOT NULL,
  "owner_department" VARCHAR(60) NOT NULL,
  "unit_column" VARCHAR(40) DEFAULT 'unit_id',
  "dept_column" VARCHAR(40) DEFAULT 'department',
  "owner_column" VARCHAR(40) DEFAULT 'created_by_id',
  "permission_resource" VARCHAR(60) NOT NULL,
  "columns" JSONB NOT NULL DEFAULT '[]'::jsonb
);

INSERT INTO "bi_datasets" ("code","label","view_name","owner_department","permission_resource","columns") VALUES
  ('sales_orders', 'Sales Orders', 'sales_orders_v', 'Sales', 'sales-orders', '[{"key":"doc_no","label":"Order No","type":"string","sensitive":false,"filterable":true,"groupable":false},{"key":"customer_name","label":"Customer","type":"string","sensitive":false,"filterable":true,"groupable":true},{"key":"status","label":"Status","type":"string","sensitive":false,"filterable":true,"groupable":true},{"key":"grand_total","label":"Total","type":"number","sensitive":false,"filterable":true,"groupable":false}]'),
  ('invoices', 'Sales Invoices', 'invoices_v', 'Sales', 'sales-invoices', '[{"key":"doc_no","label":"Invoice No","type":"string","sensitive":false,"filterable":true,"groupable":false},{"key":"customer_name","label":"Customer","type":"string","sensitive":false,"filterable":true,"groupable":true},{"key":"status","label":"Status","type":"string","sensitive":false,"filterable":true,"groupable":true},{"key":"grand_total","label":"Grand Total","type":"number","sensitive":false,"filterable":true,"groupable":false},{"key":"balance_due","label":"Balance Due","type":"number","sensitive":false,"filterable":true,"groupable":false}]'),
  ('ar_aging', 'AR Aging', 'ar_aging_v', 'Finance', 'fin-ar', '[{"key":"doc_no","label":"Invoice No","type":"string","sensitive":false,"filterable":true,"groupable":false},{"key":"customer_name","label":"Customer","type":"string","sensitive":false,"filterable":true,"groupable":true},{"key":"overdue_amount","label":"Overdue","type":"number","sensitive":false,"filterable":true,"groupable":false},{"key":"overdue_days","label":"Days Overdue","type":"number","sensitive":false,"filterable":true,"groupable":false}]'),
  ('po_lines', 'Purchase Order Lines', 'po_lines_v', 'Purchase', 'scm-po', '[{"key":"doc_no","label":"PO No","type":"string","sensitive":false,"filterable":true,"groupable":false},{"key":"supplier_name","label":"Supplier","type":"string","sensitive":false,"filterable":true,"groupable":true},{"key":"item_name","label":"Item","type":"string","sensitive":false,"filterable":true,"groupable":true},{"key":"taxable","label":"Amount","type":"number","sensitive":false,"filterable":true,"groupable":false}]'),
  ('grn', 'Goods Receipts', 'grn_v', 'Stores', 'scm-grn', '[{"key":"doc_no","label":"GRN No","type":"string","sensitive":false,"filterable":true,"groupable":false},{"key":"supplier_name","label":"Supplier","type":"string","sensitive":false,"filterable":true,"groupable":true},{"key":"status","label":"Status","type":"string","sensitive":false,"filterable":true,"groupable":true},{"key":"total_value","label":"Value","type":"number","sensitive":false,"filterable":true,"groupable":false}]'),
  ('stock_balance', 'Stock Balances', 'stock_balance_v', 'Stores', 'inv-stock', '[{"key":"item_code","label":"SKU","type":"string","sensitive":false,"filterable":true,"groupable":true},{"key":"item_name","label":"Item","type":"string","sensitive":false,"filterable":true,"groupable":true},{"key":"warehouse_code","label":"Warehouse","type":"string","sensitive":false,"filterable":true,"groupable":true},{"key":"on_hand","label":"On Hand","type":"number","sensitive":false,"filterable":true,"groupable":false},{"key":"stock_value","label":"Value","type":"number","sensitive":false,"filterable":true,"groupable":false}]'),
  ('gl_trial', 'General Ledger', 'gl_trial_v', 'Finance', 'fin-gl', '[{"key":"account_code","label":"Account","type":"string","sensitive":false,"filterable":true,"groupable":true},{"key":"account_name","label":"Account Name","type":"string","sensitive":false,"filterable":true,"groupable":true},{"key":"root_type","label":"Type","type":"string","sensitive":false,"filterable":true,"groupable":true},{"key":"debit","label":"Debit","type":"number","sensitive":false,"filterable":true,"groupable":false},{"key":"credit","label":"Credit","type":"number","sensitive":false,"filterable":true,"groupable":false}]'),
  ('production_orders', 'Production Orders', 'production_orders_v', 'Production', 'mfg-orders', '[{"key":"doc_no","label":"Order No","type":"string","sensitive":false,"filterable":true,"groupable":false},{"key":"item_name","label":"Product","type":"string","sensitive":false,"filterable":true,"groupable":true},{"key":"status","label":"Status","type":"string","sensitive":false,"filterable":true,"groupable":true},{"key":"qty","label":"Planned Qty","type":"number","sensitive":false,"filterable":true,"groupable":false},{"key":"qty_completed","label":"Completed","type":"number","sensitive":false,"filterable":true,"groupable":false}]'),
  ('inspections', 'QMS Inspections', 'inspections_v', 'Quality', 'qms-incoming', '[{"key":"doc_no","label":"Inspection No","type":"string","sensitive":false,"filterable":true,"groupable":false},{"key":"kind","label":"Kind","type":"string","sensitive":false,"filterable":true,"groupable":true},{"key":"decision","label":"Decision","type":"string","sensitive":false,"filterable":true,"groupable":true},{"key":"lot_qty","label":"Lot Qty","type":"number","sensitive":false,"filterable":true,"groupable":false},{"key":"accepted_qty","label":"Accepted","type":"number","sensitive":false,"filterable":true,"groupable":false}]'),
  ('employees', 'Employees', 'employees_v', 'HR', 'hr-employees', '[{"key":"emp_code","label":"Emp Code","type":"string","sensitive":false,"filterable":true,"groupable":false},{"key":"full_name","label":"Name","type":"string","sensitive":false,"filterable":true,"groupable":false},{"key":"department","label":"Department","type":"string","sensitive":false,"filterable":true,"groupable":true},{"key":"mobile","label":"Mobile","type":"string","sensitive":true,"filterable":false,"groupable":false},{"key":"pan","label":"PAN","type":"string","sensitive":true,"filterable":false,"groupable":false}]'),
  ('payroll_runs', 'Payroll Runs', 'payroll_runs_v', 'HR', 'pay-processing', '[{"key":"doc_no","label":"Run No","type":"string","sensitive":false,"filterable":true,"groupable":false},{"key":"status","label":"Status","type":"string","sensitive":false,"filterable":true,"groupable":true},{"key":"total_gross","label":"Gross Pay","type":"number","sensitive":true,"filterable":false,"groupable":false},{"key":"total_net","label":"Net Pay","type":"number","sensitive":true,"filterable":false,"groupable":false},{"key":"employee_count","label":"Employees","type":"number","sensitive":false,"filterable":true,"groupable":false}]'),
  ('projects', 'Customer Projects', 'projects_v', 'Projects', 'proj-projects', '[{"key":"doc_no","label":"Project Code","type":"string","sensitive":false,"filterable":true,"groupable":false},{"key":"name","label":"Project Name","type":"string","sensitive":false,"filterable":true,"groupable":false},{"key":"status","label":"Status","type":"string","sensitive":false,"filterable":true,"groupable":true},{"key":"health","label":"Health","type":"string","sensitive":false,"filterable":true,"groupable":true},{"key":"contract_value","label":"Value","type":"number","sensitive":false,"filterable":true,"groupable":false}]'),
  ('tickets', 'Service Tickets', 'tickets_v', 'Service', 'service-tickets', '[{"key":"doc_no","label":"Ticket No","type":"string","sensitive":false,"filterable":true,"groupable":false},{"key":"customer_name","label":"Customer","type":"string","sensitive":false,"filterable":true,"groupable":true},{"key":"priority","label":"Priority","type":"number","sensitive":false,"filterable":true,"groupable":true},{"key":"sla_state","label":"SLA","type":"string","sensitive":false,"filterable":true,"groupable":true},{"key":"status","label":"Status","type":"string","sensitive":false,"filterable":true,"groupable":true}]'),
  ('shipments', 'Shipments', 'shipments_v', 'Logistics', 'log-shipments', '[{"key":"doc_no","label":"Shipment No","type":"string","sensitive":false,"filterable":true,"groupable":false},{"key":"customer_name","label":"Customer","type":"string","sensitive":false,"filterable":true,"groupable":true},{"key":"status","label":"Status","type":"string","sensitive":false,"filterable":true,"groupable":true},{"key":"weight_kg","label":"Weight (kg)","type":"number","sensitive":false,"filterable":true,"groupable":false}]'),
  ('gate_passes', 'Gate Passes', 'gate_passes_v', 'Security', 'gate-in', '[{"key":"doc_no","label":"Pass No","type":"string","sensitive":false,"filterable":true,"groupable":false},{"key":"direction","label":"Direction","type":"string","sensitive":false,"filterable":true,"groupable":true},{"key":"vehicle_no","label":"Vehicle","type":"string","sensitive":false,"filterable":true,"groupable":false},{"key":"status","label":"Status","type":"string","sensitive":false,"filterable":true,"groupable":true}]'),
  ('approvals', 'Approvals', 'approvals_v', 'Administration', 'admin-approval', '[{"key":"doc_type","label":"Doc Type","type":"string","sensitive":false,"filterable":true,"groupable":true},{"key":"doc_no","label":"Doc Code","type":"string","sensitive":false,"filterable":true,"groupable":false},{"key":"status","label":"Status","type":"string","sensitive":false,"filterable":true,"groupable":true},{"key":"amount","label":"Amount","type":"number","sensitive":false,"filterable":true,"groupable":false}]')
ON CONFLICT ("code") DO NOTHING;

CREATE TABLE "kpi_definitions" (
  "code" VARCHAR(50) PRIMARY KEY,
  "name" VARCHAR(120) NOT NULL,
  "department" VARCHAR(60) NOT NULL,
  "dataset_code" VARCHAR(50) REFERENCES "bi_datasets"("code"),
  "formula_key" VARCHAR(60) NOT NULL,
  "unit_label" VARCHAR(16) NOT NULL DEFAULT 'count',
  "direction" VARCHAR(12) NOT NULL DEFAULT 'HIGHER_GOOD' CHECK ("direction" IN ('HIGHER_GOOD','LOWER_GOOD')),
  "target_val" NUMERIC(16,2),
  "amber_val" NUMERIC(16,2),
  "red_val" NUMERIC(16,2),
  "refresh_freq" VARCHAR(12) NOT NULL DEFAULT '15M'
);

INSERT INTO "kpi_definitions" ("code","name","department","dataset_code","formula_key","unit_label","direction","target_val") VALUES
  ('admin_active_sessions', 'Active Sessions (<15m)', 'Administration', NULL, 'admin.active_sessions', 'count', 'HIGHER_GOOD', 5),
  ('admin_pending_approvals', 'Pending Approvals', 'Administration', 'approvals', 'admin.pending_approvals', 'count', 'LOWER_GOOD', 0),
  ('admin_failed_jobs', 'Failed Jobs (24h)', 'Administration', NULL, 'admin.failed_jobs', 'count', 'LOWER_GOOD', 0),
  ('admin_security_alerts', 'Security Alerts', 'Administration', NULL, 'admin.security_alerts', 'count', 'LOWER_GOOD', 0),
  ('sales_orders_mtd', 'Sales Orders MTD', 'Sales', 'sales_orders', 'sales.orders_mtd', 'INR', 'HIGHER_GOOD', 1000000),
  ('sales_ar_overdue', 'AR Overdue', 'Sales', 'ar_aging', 'sales.ar_overdue', 'INR', 'LOWER_GOOD', 0),
  ('sales_dso', 'DSO (90 Days)', 'Sales', 'invoices', 'sales.dso', 'days', 'LOWER_GOOD', 45),
  ('sales_invoiced_mtd', 'Invoiced MTD', 'Sales', 'invoices', 'sales.invoiced_mtd', 'INR', 'HIGHER_GOOD', 1000000),
  ('purch_open_pos', 'Open PO Value', 'Purchase', 'po_lines', 'purchase.open_po_value', 'INR', 'LOWER_GOOD', 500000),
  ('purch_grn_mtd', 'GRNs Received MTD', 'Purchase', 'grn', 'purchase.grn_mtd', 'count', 'HIGHER_GOOD', 10),
  ('fin_cash_bank', 'Cash & Bank Balance', 'Finance', 'gl_trial', 'finance.cash_bank', 'INR', 'HIGHER_GOOD', 100000),
  ('fin_net_profit_mtd', 'Net Profit MTD', 'Finance', 'gl_trial', 'finance.net_profit_mtd', 'INR', 'HIGHER_GOOD', 100000),
  ('hr_headcount', 'Active Headcount', 'HR', 'employees', 'hr.headcount', 'count', 'HIGHER_GOOD', 50),
  ('hr_last_payroll', 'Last Payroll Gross', 'HR', 'payroll_runs', 'hr.last_payroll', 'INR', 'LOWER_GOOD', 1000000),
  ('prod_wip_orders', 'Active Production Orders', 'Production', 'production_orders', 'production.active_orders', 'count', 'HIGHER_GOOD', 5),
  ('prod_rejection_pct', 'Rejection Rate %', 'Production', 'production_orders', 'production.rejection_pct', '%', 'LOWER_GOOD', 2),
  ('qual_fpy', 'First Pass Yield %', 'Quality', 'inspections', 'quality.fpy', '%', 'HIGHER_GOOD', 98),
  ('maint_open_mwo', 'Open Maintenance WOs', 'Maintenance', NULL, 'maint.open_mwo', 'count', 'LOWER_GOOD', 2),
  ('wh_stock_value', 'Inventory Value', 'Warehouse', 'stock_balance', 'warehouse.stock_value', 'INR', 'HIGHER_GOOD', 500000),
  ('proj_active', 'Active Projects', 'Projects', 'projects', 'projects.active', 'count', 'HIGHER_GOOD', 5),
  ('proj_at_risk', 'At-Risk Projects', 'Projects', 'projects', 'projects.at_risk', 'count', 'LOWER_GOOD', 0),
  ('srv_open_tickets', 'Open Service Tickets', 'Service', 'tickets', 'service.open_tickets', 'count', 'LOWER_GOOD', 5),
  ('srv_sla_pct', 'SLA Compliance %', 'Service', 'tickets', 'service.sla_pct', '%', 'HIGHER_GOOD', 95)
ON CONFLICT ("code") DO NOTHING;

CREATE TABLE "kpi_snapshots" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "kpi_code" VARCHAR(50) NOT NULL REFERENCES "kpi_definitions"("code") ON DELETE CASCADE,
  "unit_id" UUID REFERENCES "units"("id") ON DELETE CASCADE,
  "department" VARCHAR(60) NOT NULL,
  "period_date" DATE NOT NULL,
  "grain" VARCHAR(10) NOT NULL DEFAULT 'DAY' CHECK ("grain" IN ('DAY','MONTH')),
  "value" NUMERIC(18,4),
  "numerator" NUMERIC(18,4),
  "denominator" NUMERIC(18,4),
  "source_row_count" INTEGER NOT NULL DEFAULT 0,
  "computed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  UNIQUE ("kpi_code", "unit_id", "department", "period_date", "grain")
);

CREATE TABLE "dashboards" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "scope" VARCHAR(16) NOT NULL DEFAULT 'DEPARTMENT' CHECK ("scope" IN ('DEPARTMENT','USER')),
  "department" VARCHAR(60),
  "user_id" UUID REFERENCES "users"("id") ON DELETE CASCADE,
  "name" VARCHAR(120) NOT NULL,
  "layout" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "is_default" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);

CREATE TABLE "report_definitions" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" VARCHAR(40) NOT NULL UNIQUE,
  "name" VARCHAR(150) NOT NULL,
  "dataset_code" VARCHAR(50) NOT NULL REFERENCES "bi_datasets"("code"),
  "columns" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "filters" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "group_by" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "aggregations" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "sort" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "chart_type" VARCHAR(20) NOT NULL DEFAULT 'TABLE',
  "visibility" VARCHAR(16) NOT NULL DEFAULT 'DEPARTMENT' CHECK ("visibility" IN ('PRIVATE','DEPARTMENT','ALL')),
  "department" VARCHAR(60),
  "is_system" BOOLEAN NOT NULL DEFAULT false,
  "created_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);

CREATE TABLE "report_runs" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "report_id" UUID NOT NULL REFERENCES "report_definitions"("id") ON DELETE CASCADE,
  "run_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "row_count" INTEGER NOT NULL DEFAULT 0,
  "duration_ms" INTEGER NOT NULL DEFAULT 0,
  "stored_file_id" UUID REFERENCES "stored_files"("id") ON DELETE SET NULL,
  "executed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);

CREATE TABLE "report_schedules" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "report_id" UUID NOT NULL REFERENCES "report_definitions"("id") ON DELETE CASCADE,
  "cron_expr" VARCHAR(40) NOT NULL,
  "timezone" VARCHAR(40) NOT NULL DEFAULT 'Asia/Kolkata',
  "format" VARCHAR(10) NOT NULL DEFAULT 'CSV' CHECK ("format" IN ('PDF','XLSX','CSV')),
  "run_as_user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "recipient_user_ids" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "next_run_at" TIMESTAMPTZ(3),
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);

CREATE TABLE "report_deliveries" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "schedule_id" UUID NOT NULL REFERENCES "report_schedules"("id") ON DELETE CASCADE,
  "recipient_user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "stored_file_id" UUID REFERENCES "stored_files"("id") ON DELETE SET NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'SENT',
  "delivered_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 3. Global Full-Text Search Index
-- ---------------------------------------------------------------------------
CREATE TABLE "search_index" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "entity_type" VARCHAR(40) NOT NULL,
  "entity_id" UUID NOT NULL,
  "title" VARCHAR(250) NOT NULL,
  "subtitle" VARCHAR(300),
  "doc_no" VARCHAR(60),
  "doc_date" DATE,
  "unit_id" UUID REFERENCES "units"("id") ON DELETE CASCADE,
  "department" VARCHAR(60),
  "owner_user_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "permission_resource" VARCHAR(60) NOT NULL,
  "tsv" tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce("doc_no", '')), 'A') ||
    setweight(to_tsvector('simple', coalesce("title", '')), 'B') ||
    setweight(to_tsvector('simple', coalesce("subtitle", '')), 'C')
  ) STORED,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  UNIQUE ("entity_type", "entity_id")
);
CREATE INDEX "search_index_tsv_gin_idx" ON "search_index" USING gin ("tsv");
CREATE INDEX "search_index_docno_trgm_idx" ON "search_index" USING gin ("doc_no" gin_trgm_ops);
CREATE INDEX "search_index_scope_idx" ON "search_index"("permission_resource", "unit_id");
