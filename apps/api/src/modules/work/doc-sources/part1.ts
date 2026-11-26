import type { DocSource } from './types';

// part 1: where the records of each V40 page in docs/build/mf-part1.json live (columns checked read-only against the local database).
export const PART1: DocSource[] = [
  { pageId: 'crm-leads', table: 'leads', numberCol: 'number', statusCol: 'status', dateCol: 'created_at', unitCol: 'unit_id', deptCol: 'department', where: "deleted_at IS NULL" },
  { pageId: 'crm-opportunities', table: 'opportunities', numberCol: 'number', statusCol: 'status', dateCol: 'created_at', unitCol: 'unit_id', deptCol: 'department', where: "deleted_at IS NULL" },
  { pageId: 'crm-followups', table: 'crm_followups', numberCol: 'number', statusCol: 'status', dateCol: 'due_at', unitCol: 'unit_id', deptCol: 'department', where: "deleted_at IS NULL" },
  { pageId: 'crm-meetings', table: 'crm_meetings', numberCol: 'number', statusCol: 'status', dateCol: 'starts_at', unitCol: 'unit_id', deptCol: 'department', where: "deleted_at IS NULL" },
  { pageId: 'crm-feedback', table: 'crm_feedback', numberCol: 'number', statusCol: 'status', dateCol: 'given_on', unitCol: 'unit_id', deptCol: 'department', where: "deleted_at IS NULL" },
  { pageId: 'crm-sources', table: 'lead_sources', numberCol: 'code', statusCol: 'status', dateCol: 'created_at' },
  { pageId: 'master-customers', table: 'customers', numberCol: 'code', statusCol: 'status', dateCol: 'created_at', where: "deleted_at IS NULL" },
  { pageId: 'crm-customer360', table: 'customers', numberCol: 'code', statusCol: 'status', dateCol: 'created_at', where: "deleted_at IS NULL" },
  { pageId: 'sales-reservations', table: 'stock_reservations', numberCol: 'code', statusCol: 'status', dateCol: 'created_at', unitCol: 'unit_id', deptCol: 'department' },
  { pageId: 'sales-dispatch', table: 'sales_dispatches', numberCol: 'number', statusCol: 'status', dateCol: 'dispatch_date', unitCol: 'unit_id', deptCol: 'department', where: "deleted_at IS NULL" },
  { pageId: 'sales-invoices', table: 'sales_invoices', numberCol: 'number', statusCol: 'status', dateCol: 'invoice_date', unitCol: 'unit_id', deptCol: 'department', where: "deleted_at IS NULL" },
  { pageId: 'sales-collections', table: 'sales_receipts', numberCol: 'number', statusCol: 'status', dateCol: 'receipt_date', unitCol: 'unit_id' },
  { pageId: 'sales-pricelist', table: 'price_lists', numberCol: 'code', statusCol: 'status', dateCol: 'created_at', where: "deleted_at IS NULL" },
  { pageId: 'sales-returns', table: 'sales_returns', numberCol: 'number', statusCol: 'status', dateCol: 'return_date', unitCol: 'unit_id', deptCol: 'department', where: "deleted_at IS NULL" },
  { pageId: 'scm-rfq', table: 'rfqs', numberCol: 'number', statusCol: 'status', dateCol: 'created_at', unitCol: 'unit_id', deptCol: 'department', where: "deleted_at IS NULL" },
  { pageId: 'scm-vendorquote', table: 'vendor_quotes', numberCol: 'number', statusCol: 'status', dateCol: 'quote_date', unitCol: 'unit_id', deptCol: 'department', where: "deleted_at IS NULL" },
  { pageId: 'scm-comparison', table: 'vendor_comparisons', numberCol: 'number', statusCol: 'status', dateCol: 'created_at', unitCol: 'unit_id', deptCol: 'department', where: "deleted_at IS NULL" },
  { pageId: 'scm-purchaseinvoice', table: 'purchase_invoices', numberCol: 'number', statusCol: 'status', dateCol: 'invoice_date', unitCol: 'unit_id', deptCol: 'department', where: "deleted_at IS NULL" },
  { pageId: 'scm-suppliers', table: 'suppliers', numberCol: 'code', statusCol: 'status', dateCol: 'created_at', where: "deleted_at IS NULL" },
  { pageId: 'scm-evaluation', table: 'supplier_evaluations', numberCol: 'period', dateCol: 'created_at', unitCol: 'unit_id' },
  { pageId: 'scm-contracts', table: 'purchase_contracts', numberCol: 'number', statusCol: 'status', dateCol: 'created_at', unitCol: 'unit_id', deptCol: 'department', where: "deleted_at IS NULL" },
  { pageId: 'inv-items', table: 'items', numberCol: 'code', statusCol: 'status', dateCol: 'created_at', where: "deleted_at IS NULL" },
  { pageId: 'inv-stock', table: 'stock_balance_records', numberCol: 'number', statusCol: 'status', dateCol: 'updated_at', unitCol: 'unit_id' },
  { pageId: 'inv-opening', table: 'stock_vouchers', numberCol: 'number', statusCol: 'status', dateCol: 'posting_date', unitCol: 'unit_id', deptCol: 'department', where: "kind = 'OPENING' AND deleted_at IS NULL" },
  { pageId: 'inv-adjustment', table: 'stock_vouchers', numberCol: 'number', statusCol: 'status', dateCol: 'posting_date', unitCol: 'unit_id', deptCol: 'department', where: "kind = 'ADJUSTMENT' AND deleted_at IS NULL" },
  { pageId: 'inv-transfer', table: 'stock_vouchers', numberCol: 'number', statusCol: 'status', dateCol: 'posting_date', unitCol: 'unit_id', deptCol: 'department', where: "kind = 'TRANSFER' AND deleted_at IS NULL" },
  { pageId: 'wms-transfer', table: 'stock_vouchers', numberCol: 'number', statusCol: 'status', dateCol: 'posting_date', unitCol: 'unit_id', deptCol: 'department', where: "kind = 'TRANSFER' AND deleted_at IS NULL" },
  { pageId: 'inv-reservation', table: 'stock_reservations', numberCol: 'code', statusCol: 'status', dateCol: 'created_at', unitCol: 'unit_id', deptCol: 'department' },
  { pageId: 'inv-reconciliation', table: 'stock_counts', numberCol: 'code', statusCol: 'status', dateCol: 'planned_date', unitCol: 'unit_id', deptCol: 'department', where: "deleted_at IS NULL" },
  { pageId: 'wms-cycle', table: 'stock_counts', numberCol: 'code', statusCol: 'status', dateCol: 'planned_date', unitCol: 'unit_id', deptCol: 'department', where: "count_type IN ('CYCLE', 'POWDER_WEEKLY') AND deleted_at IS NULL" },
  { pageId: 'wms-physical', table: 'stock_counts', numberCol: 'code', statusCol: 'status', dateCol: 'planned_date', unitCol: 'unit_id', deptCol: 'department', where: "count_type = 'PHYSICAL' AND deleted_at IS NULL" },
  { pageId: 'inv-batch', table: 'batches', numberCol: 'batch_no', statusCol: 'status', dateCol: 'created_at', where: "deleted_at IS NULL" },
  { pageId: 'inv-serial', table: 'serial_numbers', numberCol: 'serial_no', statusCol: 'status', dateCol: 'created_at' },
  { pageId: 'wms-zones', table: 'wms_zones', numberCol: 'code', statusCol: 'status', dateCol: 'created_at', where: "deleted_at IS NULL" },
  { pageId: 'wms-racks', table: 'wms_racks', numberCol: 'code', statusCol: 'status', dateCol: 'created_at', where: "deleted_at IS NULL" },
  { pageId: 'wms-shelves', table: 'wms_shelves', numberCol: 'code', statusCol: 'status', dateCol: 'created_at', where: "deleted_at IS NULL" },
  { pageId: 'wms-bins', table: 'wms_bins', numberCol: 'code', statusCol: 'status', dateCol: 'created_at', where: "deleted_at IS NULL" },
  { pageId: 'wms-rfid', table: 'wms_rfid_tags', numberCol: 'tag_code', statusCol: 'status', dateCol: 'created_at', where: "deleted_at IS NULL" },
  { pageId: 'wms-putaway', table: 'putaway_tasks', numberCol: 'task_no', statusCol: 'status', dateCol: 'created_at', unitCol: 'unit_id' },
  { pageId: 'wms-pick', table: 'pick_waves', numberCol: 'number', statusCol: 'status', dateCol: 'planned_date', unitCol: 'unit_id', where: "deleted_at IS NULL" },
  { pageId: 'wms-packing', table: 'pack_units', numberCol: 'number', statusCol: 'status', dateCol: 'created_at', unitCol: 'unit_id', where: "deleted_at IS NULL" },
  { pageId: 'mfg-bom', table: 'mfg_boms', numberCol: 'number', statusCol: 'status', dateCol: 'created_at', unitCol: 'unit_id', where: "deleted_at IS NULL" },
  { pageId: 'mfg-routing', table: 'mfg_routings', numberCol: 'number', statusCol: 'status', dateCol: 'created_at', unitCol: 'unit_id', where: "deleted_at IS NULL" },
  { pageId: 'mfg-workcenters', table: 'mfg_work_centres', numberCol: 'code', statusCol: 'status', dateCol: 'created_at', unitCol: 'unit_id', where: "deleted_at IS NULL" },
  { pageId: 'mfg-plan', table: 'mfg_production_plans', numberCol: 'number', statusCol: 'status', dateCol: 'plan_date', unitCol: 'unit_id', where: "deleted_at IS NULL" },
  { pageId: 'mfg-mrp', table: 'mfg_mrp_runs', numberCol: 'number', statusCol: 'status', dateCol: 'created_at', unitCol: 'unit_id', where: "deleted_at IS NULL" },
  { pageId: 'mfg-workorders', table: 'mfg_orders', numberCol: 'number', statusCol: 'status', dateCol: 'start_date', unitCol: 'unit_id', where: "status IN ('Released', 'In Progress') AND deleted_at IS NULL" },
  { pageId: 'mfg-fg', table: 'mfg_production_receipts', numberCol: 'number', statusCol: 'status', dateCol: 'receipt_date', unitCol: 'unit_id' },
  { pageId: 'mfg-scrap', table: 'mfg_scrap', numberCol: 'number', statusCol: 'status', dateCol: 'scrap_date', unitCol: 'unit_id', where: "deleted_at IS NULL" },
  { pageId: 'mfg-rework', table: 'mfg_rework', numberCol: 'number', statusCol: 'status', dateCol: 'rework_date', unitCol: 'unit_id', where: "deleted_at IS NULL" },
  { pageId: 'qms-plans', table: 'qms_plans', numberCol: 'code', statusCol: 'status', dateCol: 'created_at' },
  { pageId: 'qms-incoming', table: 'qms_inspections', numberCol: 'number', statusCol: 'status', dateCol: 'doc_date', unitCol: 'unit_id', deptCol: 'department', where: "kind = 'INCOMING'" },
  { pageId: 'qms-process', table: 'qms_inspections', numberCol: 'number', statusCol: 'status', dateCol: 'doc_date', unitCol: 'unit_id', deptCol: 'department', where: "kind = 'IN_PROCESS'" },
  { pageId: 'qms-final', table: 'qms_inspections', numberCol: 'number', statusCol: 'status', dateCol: 'doc_date', unitCol: 'unit_id', deptCol: 'department', where: "kind = 'PRE_DISPATCH'" },
  { pageId: 'qms-supplier', table: 'qms_inspections', numberCol: 'number', statusCol: 'status', dateCol: 'doc_date', unitCol: 'unit_id', deptCol: 'department', where: "kind = 'ISIR'" },
  { pageId: 'qms-inspections', table: 'qms_inspections', numberCol: 'number', statusCol: 'status', dateCol: 'doc_date', unitCol: 'unit_id', deptCol: 'department' },
  { pageId: 'qms-ncr', table: 'qms_rejections', numberCol: 'number', statusCol: 'status', dateCol: 'reject_date', unitCol: 'unit_id', where: "deleted_at IS NULL" },
  { pageId: 'qms-capa', table: 'qms_forms', numberCol: 'number', statusCol: 'status', dateCol: 'doc_date', unitCol: 'unit_id', deptCol: 'department', where: "kind IN ('EIGHT_D', 'CI', 'MOM') AND deleted_at IS NULL" },
  { pageId: 'qms-5why', table: 'five_why_cases', numberCol: 'number', statusCol: 'status', dateCol: 'created_at', unitCol: 'unit_id', deptCol: 'department', where: "deleted_at IS NULL" },
  { pageId: 'qms-calibration', table: 'qms_instruments', numberCol: 'equipment_no', statusCol: 'status', dateCol: 'valid_until', unitCol: 'unit_id', where: "deleted_at IS NULL" },
  { pageId: 'maint-machines', table: 'assets', numberCol: 'asset_no', statusCol: 'status', dateCol: 'created_at', unitCol: 'unit_id', deptCol: 'department', where: "asset_kind = 'MACHINE' AND deleted_at IS NULL" },
  { pageId: 'maint-equipment', table: 'assets', numberCol: 'asset_no', statusCol: 'status', dateCol: 'created_at', unitCol: 'unit_id', deptCol: 'department', where: "asset_kind = 'EQUIPMENT' AND deleted_at IS NULL" },
  { pageId: 'maint-preventive', table: 'pm_plans', numberCol: 'plan_no', dateCol: 'created_at', unitCol: 'unit_id', where: "deleted_at IS NULL" },
  { pageId: 'maint-breakdown', table: 'breakdown_tickets', numberCol: 'bd_no', statusCol: 'status', dateCol: 'reported_at', unitCol: 'unit_id', where: "deleted_at IS NULL" },
  { pageId: 'maint-workorders', table: 'maint_work_orders', numberCol: 'mwo_no', statusCol: 'status', dateCol: 'created_at', unitCol: 'unit_id', where: "deleted_at IS NULL" },
  { pageId: 'maint-downtime', table: 'downtime_events', numberCol: 'dt_no', dateCol: 'start_at', unitCol: 'unit_id', where: "deleted_at IS NULL" },
  { pageId: 'maint-alerts', table: 'alerts', numberCol: 'message', statusCol: 'status', dateCol: 'created_at', unitCol: 'unit_id' },
  { pageId: 'fin-coa', table: 'accounts', numberCol: 'code', statusCol: 'status', dateCol: 'created_at', where: "deleted_at IS NULL" },
  { pageId: 'fin-journal', table: 'journals', numberCol: 'code', statusCol: 'status', dateCol: 'doc_date', unitCol: 'unit_id' },
  { pageId: 'process-exceptions', table: 'process_exceptions', numberCol: 'doc_no', dateCol: 'raised_at', unitCol: 'unit_id' },
];

// Skipped pages (not listed in the picker):
// dashboard, ops-mfg-dashboard, command-center, ai-insights, global-search: dashboards / search, no record table.
// notifications: personal notification inbox, not a business document.
// my-approvals: approval queue view over approval_requests, not a document of its own.
// dept-inbox-administration, dept-inbox-projects, dept-inbox-engineering, dept-inbox-service, dept-inbox-maintenance, dept-inbox-hr: department inbox views over moved work.
// dept-work-maintenance: department work center view, no own table.
// project-global-history, ops-order-360, crm-customer360: read-only 360 / history views.
// crm-pipeline: kanban view of the opportunities already mapped.
// sales-delivery: delivery plan computed from sales orders, no own table.
// sales-credit: credit overview computed per customer, no numbered records.
// inv-ageing, inv-valuation, inv-expiry, mfg-wip, mfg-costing, maint-mtbf, fin-gl: reports / ledgers, no record table.
// inv-reorder: reorder policies and suggestions have no number or label column.
// wms-barcode: scan tool, no records.
// mfg-shopfloor: live shop-floor board, no records.
// maint-schedule: pm_schedules rows have no number or label column.
// maint-spares: stock view of spares, not documents.
