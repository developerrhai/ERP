import type { DocSource } from './types';

// part 3: filled in by a helper; see docs/build/mf-part3.json for the pages it covers.
// `where` has no table alias, so it uses bare column names.
const NOT_DELETED = 'deleted_at IS NULL';
const INTERPLANT = '(is_physical OR (to_unit_id IS NOT NULL AND to_unit_id <> unit_id))';
const MAINT_DOCS =
  "doc_type IN ('maint-spares','maint-workorders','maint-breakdown','maint-preventive','maint-equipment','maint-machines','maint-schedule','asset-maintenance','service-spares')";

const movement = (pageId: string, where?: string): DocSource => ({
  pageId,
  table: 'work_movements',
  numberCol: 'number',
  statusCol: 'state',
  dateCol: 'sent_at',
  unitCol: 'unit_id',
  ...(where ? { where } : {}),
});

const comm = (pageId: string, channel?: string): DocSource => ({
  pageId,
  table: 'outbound_messages',
  numberCol: 'recipient',
  statusCol: 'status',
  dateCol: 'created_at',
  ...(channel ? { where: `channel = '${channel}'` } : {}),
});

export const PART3: DocSource[] = [
  // Logistics / Fleet
  { pageId: 'gate-nonreturn', table: 'gate_passes', numberCol: 'pass_no', statusCol: 'status', dateCol: 'entry_at', unitCol: 'unit_id', where: `pass_type = 'NON_RETURNABLE' AND ${NOT_DELETED}` },
  { pageId: 'container-track', table: 'containers', numberCol: 'container_no', statusCol: 'current_status', dateCol: 'created_at' },

  // Business Documents / Integrated Plant Flow (all read work_movements)
  movement('document-movement-center'),
  movement('dept-work-engineering'),
  movement('dept-work-administration'),
  movement('maint-part-movement', `NOT ${INTERPLANT} AND ${MAINT_DOCS}`),
  movement('plant-process-movement', `NOT ${INTERPLANT} AND NOT COALESCE(${MAINT_DOCS}, false) AND route_type = 'Manufacturing Action'`),
  movement('plant-interplant-movement', INTERPLANT),
  { pageId: 'plant-project-forward', table: 'projects', numberCol: 'code', statusCol: 'status', dateCol: 'created_at', unitCol: 'unit_id' },
  { pageId: 'plant-unit-routing', table: 'plant_routes', numberCol: 'code', dateCol: 'created_at' },
  { pageId: 'mfg-unit-route', table: 'mfg_orders', numberCol: 'number', statusCol: 'status', dateCol: 'created_at', unitCol: 'unit_id', where: NOT_DELETED },
  { pageId: 'flow-bom-approval', table: 'bom_material_flows', numberCol: 'flow_no', statusCol: 'status', dateCol: 'created_at', unitCol: 'unit_id' },
  { pageId: 'mfg-transfer-note', table: 'transfer_notes', numberCol: 'note_no', statusCol: 'receipt_status', dateCol: 'created_at', unitCol: 'unit_id' },

  // Document Management
  { pageId: 'dms-folders', table: 'dms_folders', numberCol: 'name', statusCol: 'status', dateCol: 'created_at', unitCol: 'unit_id', where: NOT_DELETED },
  { pageId: 'dms-docs', table: 'dms_documents', numberCol: 'doc_code', statusCol: 'status', dateCol: 'created_at', unitCol: 'unit_id', where: NOT_DELETED },
  { pageId: 'dms-search', table: 'dms_documents', numberCol: 'doc_code', statusCol: 'status', dateCol: 'created_at', unitCol: 'unit_id', where: NOT_DELETED },
  { pageId: 'dms-versions', table: 'dms_document_versions', numberCol: 'version_no', dateCol: 'created_at' },
  { pageId: 'dms-permissions', table: 'dms_folder_acl', numberCol: 'principal_type', dateCol: 'created_at' },
  { pageId: 'dms-tags', table: 'dms_tags', numberCol: 'code', dateCol: 'created_at' },

  // Business Intelligence
  { pageId: 'bi-builder', table: 'report_definitions', numberCol: 'code', dateCol: 'created_at', deptCol: 'department' },
  { pageId: 'bi-reports', table: 'report_definitions', numberCol: 'code', dateCol: 'created_at', deptCol: 'department' },
  { pageId: 'bi-dashboards', table: 'dashboards', numberCol: 'name', dateCol: 'created_at', deptCol: 'department' },
  { pageId: 'bi-scheduler', table: 'report_schedules', numberCol: 'cron_expr', dateCol: 'created_at' },

  // AI & Automation
  { pageId: 'auto-workflows', table: 'automation_rules', numberCol: 'code', statusCol: 'status', dateCol: 'created_at' },
  { pageId: 'auto-rules', table: 'automation_rules', numberCol: 'code', statusCol: 'status', dateCol: 'created_at' },
  { pageId: 'auto-webhooks', table: 'webhook_endpoints', numberCol: 'name', statusCol: 'status', dateCol: 'created_at' },

  // Communication
  comm('comm-whatsapp', 'WHATSAPP'),
  comm('comm-email', 'EMAIL'),
  comm('comm-sms', 'SMS'),
  comm('comm-logs'),
  { pageId: 'comm-templates', table: 'message_templates', numberCol: 'code', statusCol: 'status', dateCol: 'created_at' },
  { pageId: 'comm-payment', table: 'payment_links', numberCol: 'link_id', statusCol: 'status', dateCol: 'created_at' },

  // Administration
  { pageId: 'admin-company', table: 'companies', numberCol: 'code', dateCol: 'created_at' },
  { pageId: 'admin-branches', table: 'units', numberCol: 'code', statusCol: 'status', dateCol: 'created_at' },
  { pageId: 'admin-departments', table: 'departments', numberCol: 'code', statusCol: 'status', dateCol: 'created_at' },
  { pageId: 'admin-designations', table: 'designations', numberCol: 'code', statusCol: 'status', dateCol: 'created_at', where: NOT_DELETED },
  { pageId: 'admin-users', table: 'users', numberCol: 'login_id', statusCol: 'status', dateCol: 'created_at', deptCol: 'department' },
  { pageId: 'admin-roles', table: 'roles', numberCol: 'code', statusCol: 'status', dateCol: 'created_at' },
  { pageId: 'admin-fy', table: 'financial_years', numberCol: 'code', statusCol: 'status', dateCol: 'created_at' },
  { pageId: 'admin-currency', table: 'currencies', numberCol: 'code', statusCol: 'status', dateCol: 'created_at', where: NOT_DELETED },
  { pageId: 'admin-uom', table: 'uoms', numberCol: 'code', statusCol: 'status', dateCol: 'created_at', where: NOT_DELETED },
  { pageId: 'admin-customfields', table: 'custom_field_defs', numberCol: 'label', dateCol: 'created_at' },
  { pageId: 'admin-formbuilder', table: 'form_rules', numberCol: 'field_key', statusCol: 'status', dateCol: 'created_at', unitCol: 'unit_id' },
  { pageId: 'admin-import', table: 'data_jobs', numberCol: 'kind', statusCol: 'status', dateCol: 'created_at', unitCol: 'unit_id' },
  { pageId: 'admin-api', table: 'api_keys', numberCol: 'name', dateCol: 'created_at' },
  { pageId: 'admin-integrations', table: 'integration_configs', numberCol: 'provider_code', dateCol: 'updated_at' },

  // Contract Labour Management
  { pageId: 'cl-contractors', table: 'contractors', numberCol: 'code', statusCol: 'status', dateCol: 'created_at' },
  { pageId: 'cl-workorders', table: 'cl_work_orders', numberCol: 'number', statusCol: 'status', dateCol: 'created_at', unitCol: 'unit_id', deptCol: 'department' },
  { pageId: 'cl-workers', table: 'cl_workers', numberCol: 'worker_no', statusCol: 'status', dateCol: 'created_at', unitCol: 'unit_id', deptCol: 'department' },
  { pageId: 'cl-onboarding', table: 'cl_workers', numberCol: 'worker_no', statusCol: 'status', dateCol: 'created_at', unitCol: 'unit_id', deptCol: 'department' },
  { pageId: 'cl-deployment', table: 'cl_workers', numberCol: 'worker_no', statusCol: 'status', dateCol: 'created_at', unitCol: 'unit_id', deptCol: 'department' },
  { pageId: 'cl-exit', table: 'cl_workers', numberCol: 'worker_no', statusCol: 'status', dateCol: 'created_at', unitCol: 'unit_id', deptCol: 'department' },
  { pageId: 'cl-attendance', table: 'cl_attendance', numberCol: 'att_date', statusCol: 'status', dateCol: 'att_date', unitCol: 'unit_id' },
  { pageId: 'cl-wages', table: 'cl_wage_sheets', numberCol: 'month', statusCol: 'status', dateCol: 'computed_at', unitCol: 'unit_id' },
  { pageId: 'cl-invoices', table: 'cl_invoices', numberCol: 'invoice_no', statusCol: 'status', dateCol: 'created_at', unitCol: 'unit_id' },
  { pageId: 'cl-compliance', table: 'cl_compliance_months', numberCol: 'month', statusCol: 'risk_level', dateCol: 'updated_at', unitCol: 'unit_id' },
  { pageId: 'cl-ppe', table: 'cl_compliance_months', numberCol: 'month', statusCol: 'risk_level', dateCol: 'updated_at', unitCol: 'unit_id' },
  { pageId: 'cl-medical', table: 'cl_compliance_months', numberCol: 'month', statusCol: 'risk_level', dateCol: 'updated_at', unitCol: 'unit_id' },
  { pageId: 'cl-incidents', table: 'cl_incidents', numberCol: 'incident_no', statusCol: 'status', dateCol: 'created_at', unitCol: 'unit_id' },
  { pageId: 'cl-safety', table: 'cl_incidents', numberCol: 'incident_no', statusCol: 'status', dateCol: 'created_at', unitCol: 'unit_id' },
  { pageId: 'cl-gatepass', table: 'gate_passes', numberCol: 'pass_no', statusCol: 'status', dateCol: 'entry_at', unitCol: 'unit_id', where: `direction = 'IN' AND ${NOT_DELETED}` },
  { pageId: 'cl-canteen', table: 'canteen_coupons', numberCol: 'coupon_no', statusCol: 'status', dateCol: 'date', unitCol: 'unit_id' },

  // Work Management / HRMS / Workplace
  { pageId: 'ops-tasks', table: 'tasks', numberCol: 'task_no', statusCol: 'status', dateCol: 'created_at', unitCol: 'unit_id', deptCol: 'department', where: NOT_DELETED },
  { pageId: 'hr-shifts', table: 'shifts', numberCol: 'code', dateCol: 'created_at' },
  { pageId: 'ops-shift-roster', table: 'shift_handovers', numberCol: 'handover_date', statusCol: 'status', dateCol: 'created_at', unitCol: 'unit_id', deptCol: 'department' },
  { pageId: 'ops-canteen', table: 'canteen_coupons', numberCol: 'coupon_no', statusCol: 'status', dateCol: 'date', unitCol: 'unit_id' },

  // Business Documents (docsmail, sales aliases)
  { pageId: 'quality-certificate', table: 'quality_certificates', numberCol: 'number', statusCol: 'quality_approval', dateCol: 'created_at', unitCol: 'unit_id', where: NOT_DELETED },
  { pageId: 'hr-offer-letter', table: 'issued_letters', numberCol: 'number', statusCol: 'status', dateCol: 'created_at', unitCol: 'unit_id' },
  { pageId: 'hr-appointment-letter', table: 'issued_letters', numberCol: 'number', statusCol: 'status', dateCol: 'created_at', unitCol: 'unit_id' },
  { pageId: 'dispatch-dc', table: 'sales_dispatches', numberCol: 'number', statusCol: 'status', dateCol: 'created_at', unitCol: 'unit_id', deptCol: 'department', where: NOT_DELETED },
  { pageId: 'accounts-gst-invoice', table: 'sales_invoices', numberCol: 'number', statusCol: 'status', dateCol: 'created_at', unitCol: 'unit_id', deptCol: 'department', where: NOT_DELETED },
];

// Skipped pages (no record table, or kept in generic_records):
// bi-sales, bi-purchase, bi-inventory, bi-finance, bi-branch, bi-profit: report views over datasets, no records of their own.
// ai-copilot, ai-demand, ai-inventory, ai-sales, ai-vendor, ai-finance, ai-executive: chat / forecast / insight screens, no document records.
// auto-jobs: reads the pg-boss queue (schema pgboss), not a public table.
// business-documents: the Document Center catalog that lists other pages' records.
// plant-flow-command: dashboard (overview counters).
// admin-permissions: role/permission matrix, no document records.
// admin-approval: approval_rule_sets rows have no readable label (doc_type and unit_id are often NULL, department-level rules).
// admin-workflow: workflow_rules has no id column (keyed by module_id).
// admin-numbering: number_series has no id column (composite key).
// admin-audit: read-only audit log, not a document.
// admin-security, admin-backup, admin-settings: consoles / settings, no records.
// cl-command-center: dashboard (counters), no records.
// admin-taxes: generic register (GENERIC_ADMIN_PAGES), rows live in generic_records.
// admin-duplicates: generic register (rows live in generic_records), left to the picker's generic fallback.
