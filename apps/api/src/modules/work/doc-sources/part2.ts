import type { DocSource } from './types';

// part 2: filled in by a helper; see docs/build/mf-part2.json for the pages it covers.
export const PART2: DocSource[] = [
  // Finance & Accounts
  { pageId: 'fin-cashbook', table: 'payments', numberCol: 'code', statusCol: 'status', dateCol: 'doc_date', unitCol: 'unit_id', where: "mode = 'Cash'" },
  { pageId: 'fin-bankbook', table: 'payments', numberCol: 'code', statusCol: 'status', dateCol: 'doc_date', unitCol: 'unit_id', where: "mode <> 'Cash'" },
  { pageId: 'fin-ap', table: 'open_items', numberCol: 'doc_no', statusCol: 'status', dateCol: 'doc_date', unitCol: 'unit_id', where: "side = 'PAYABLE'" },
  { pageId: 'fin-ar', table: 'open_items', numberCol: 'doc_no', statusCol: 'status', dateCol: 'doc_date', unitCol: 'unit_id', where: "side = 'RECEIVABLE'" },
  { pageId: 'fin-creditnote', table: 'credit_debit_notes', numberCol: 'code', statusCol: 'status', dateCol: 'doc_date', unitCol: 'unit_id', where: "kind = 'CREDIT' AND deleted_at IS NULL" },
  { pageId: 'fin-debitnote', table: 'credit_debit_notes', numberCol: 'code', statusCol: 'status', dateCol: 'doc_date', unitCol: 'unit_id', where: "kind = 'DEBIT' AND deleted_at IS NULL" },
  { pageId: 'fin-bankreco', table: 'bank_statements', numberCol: 'period_to', statusCol: 'status', dateCol: 'period_to' },
  { pageId: 'fin-costcenter', table: 'cost_centers', numberCol: 'code', statusCol: 'status', dateCol: 'created_at', unitCol: 'unit_id', where: 'deleted_at IS NULL' },
  { pageId: 'fin-profitcenter', table: 'profit_centers', numberCol: 'code', statusCol: 'status', dateCol: 'created_at', unitCol: 'unit_id', where: 'deleted_at IS NULL' },
  { pageId: 'fin-expenses', table: 'expense_claims', numberCol: 'code', statusCol: 'status', dateCol: 'claim_date', unitCol: 'unit_id', where: 'deleted_at IS NULL' },
  { pageId: 'fin-budget', table: 'budgets', numberCol: 'name', statusCol: 'status', dateCol: 'created_at', unitCol: 'unit_id', where: 'deleted_at IS NULL' },

  // Indian Taxation
  { pageId: 'tax-gstr1', table: 'gst_returns', numberCol: 'period_month', statusCol: 'status', dateCol: 'period_month', unitCol: 'unit_id', where: "return_type = 'GSTR1'" },
  { pageId: 'tax-gstr3b', table: 'gst_returns', numberCol: 'period_month', statusCol: 'status', dateCol: 'period_month', unitCol: 'unit_id', where: "return_type = 'GSTR3B'" },
  { pageId: 'tax-tds', table: 'tds_entries', numberCol: 'source_doc_no', statusCol: 'status', dateCol: 'deducted_on', unitCol: 'unit_id', where: "kind = 'TDS'" },
  { pageId: 'tax-tcs', table: 'tds_entries', numberCol: 'source_doc_no', statusCol: 'status', dateCol: 'deducted_on', unitCol: 'unit_id', where: "kind = 'TCS'" },
  { pageId: 'tax-einvoice', table: 'einvoice_records', numberCol: 'doc_no', statusCol: 'status', dateCol: 'doc_date', unitCol: 'unit_id' },
  { pageId: 'tax-eway', table: 'eway_bills', numberCol: 'ewb_no', statusCol: 'status', dateCol: 'ewb_date', unitCol: 'unit_id' },
  { pageId: 'tax-salesreg', table: 'tax_documents', numberCol: 'doc_no', statusCol: 'status', dateCol: 'doc_date', unitCol: 'unit_id', where: "direction = 'OUTWARD'" },
  { pageId: 'tax-purchasereg', table: 'tax_documents', numberCol: 'doc_no', statusCol: 'status', dateCol: 'doc_date', unitCol: 'unit_id', where: "direction = 'INWARD'" },

  // HRMS
  { pageId: 'hr-employees', table: 'employees', numberCol: 'emp_code', statusCol: 'status', dateCol: 'joining_date' },
  { pageId: 'hr-recruitment', table: 'job_requisitions', numberCol: 'req_code', statusCol: 'status', dateCol: 'created_at', unitCol: 'unit_id', deptCol: 'department', where: 'deleted_at IS NULL' },
  { pageId: 'hr-onboarding', table: 'onboarding_cases', numberCol: 'id', statusCol: 'status', dateCol: 'created_at' },
  { pageId: 'hr-attendance', table: 'attendance_days', numberCol: 'attendance_date', statusCol: 'status', dateCol: 'attendance_date' },
  { pageId: 'hr-leave', table: 'leave_applications', numberCol: 'id', statusCol: 'status', dateCol: 'start_date' },
  { pageId: 'hr-expense', table: 'hr_expense_claims', numberCol: 'claim_no', statusCol: 'status', dateCol: 'claim_date', unitCol: 'unit_id', where: 'deleted_at IS NULL' },
  { pageId: 'hr-performance', table: 'perf_reviews', numberCol: 'id', statusCol: 'status', dateCol: 'created_at' },
  { pageId: 'hr-training', table: 'training_programs', numberCol: 'code', dateCol: 'created_at' },
  { pageId: 'hr-exit', table: 'exit_cases', numberCol: 'case_no', statusCol: 'status', dateCol: 'resignation_date' },

  // Payroll
  { pageId: 'pay-structure', table: 'pay_structures', numberCol: 'code', dateCol: 'created_at' },
  { pageId: 'pay-processing', table: 'payroll_runs', numberCol: 'run_no', statusCol: 'status', dateCol: 'created_at', unitCol: 'unit_id' },
  { pageId: 'pay-overtime', table: 'ot_entries', numberCol: 'id', statusCol: 'status', dateCol: 'date' },
  { pageId: 'pay-incentive', table: 'incentive_entries', numberCol: 'id', statusCol: 'status', dateCol: 'created_at' },
  { pageId: 'pay-loan', table: 'employee_loans', numberCol: 'loan_no', statusCol: 'status', dateCol: 'disbursed_date' },
  { pageId: 'pay-payslip', table: 'payslips', numberCol: 'payslip_no', dateCol: 'created_at' },
  { pageId: 'pay-bank', table: 'bank_transfer_batches', numberCol: 'batch_no', statusCol: 'status', dateCol: 'generated_at' },

  // Projects
  { pageId: 'proj-demo-control', table: 'projects', numberCol: 'code', statusCol: 'status', dateCol: 'start_date', unitCol: 'unit_id' },
  { pageId: 'proj-stage-gates', table: 'project_gates', numberCol: 'code', statusCol: 'state', dateCol: 'created_at' },
  { pageId: 'proj-specifications', table: 'project_specs', numberCol: 'spec_no', statusCol: 'status', dateCol: 'created_at' },
  { pageId: 'proj-test-records', table: 'project_tests', numberCol: 'test_name', statusCol: 'result', dateCol: 'tested_at' },
  { pageId: 'proj-documents', table: 'project_documents', numberCol: 'title', statusCol: 'status', dateCol: 'created_at' },
  { pageId: 'proj-projects', table: 'projects', numberCol: 'code', statusCol: 'status', dateCol: 'start_date', unitCol: 'unit_id' },
  { pageId: 'proj-tasks', table: 'project_tasks', numberCol: 'number', statusCol: 'status', dateCol: 'planned_start' },
  { pageId: 'proj-subtasks', table: 'project_tasks', numberCol: 'number', statusCol: 'status', dateCol: 'planned_start', where: 'parent_task_id IS NOT NULL' },
  { pageId: 'proj-milestones', table: 'project_milestones', numberCol: 'name', statusCol: 'status', dateCol: 'target_date' },
  { pageId: 'proj-team', table: 'project_team', numberCol: 'role', dateCol: 'start_date' },
  { pageId: 'proj-timesheets', table: 'timesheets', numberCol: 'timesheet_no', statusCol: 'status', dateCol: 'week_start' },
  { pageId: 'proj-expenses', table: 'project_expenses', numberCol: 'expense_no', statusCol: 'status', dateCol: 'date' },
  { pageId: 'proj-budget', table: 'project_budgets', numberCol: 'id', statusCol: 'status', dateCol: 'created_at' },

  // Assets
  { pageId: 'asset-master', table: 'assets', numberCol: 'asset_no', statusCol: 'status', dateCol: 'created_at', unitCol: 'unit_id' },
  { pageId: 'asset-capitalization', table: 'asset_capitalisations', numberCol: 'cap_no', statusCol: 'status', dateCol: 'capitalisation_date', unitCol: 'unit_id', where: 'deleted_at IS NULL' },
  { pageId: 'asset-allocation', table: 'asset_allocations', numberCol: 'alloc_no', statusCol: 'status', dateCol: 'allocated_on', unitCol: 'unit_id', where: 'deleted_at IS NULL' },
  { pageId: 'asset-transfer', table: 'asset_transfers', numberCol: 'tr_no', statusCol: 'status', dateCol: 'request_date', unitCol: 'unit_id', where: 'deleted_at IS NULL' },
  { pageId: 'asset-maintenance', table: 'maint_work_orders', numberCol: 'mwo_no', statusCol: 'status', dateCol: 'created_at', unitCol: 'unit_id', where: 'deleted_at IS NULL' },
  { pageId: 'asset-depreciation', table: 'depreciation_runs', numberCol: 'run_no', statusCol: 'status', dateCol: 'created_at', unitCol: 'unit_id', where: 'deleted_at IS NULL' },
  { pageId: 'asset-disposal', table: 'asset_disposals', numberCol: 'disp_no', statusCol: 'status', dateCol: 'request_date', unitCol: 'unit_id', where: 'deleted_at IS NULL' },
  { pageId: 'asset-qr', table: 'asset_qr_labels', numberCol: 'token', dateCol: 'printed_at' },

  // Service / Support
  { pageId: 'service-tickets', table: 'service_tickets', numberCol: 'ticket_no', statusCol: 'status', dateCol: 'created_at' },
  { pageId: 'service-requests', table: 'service_requests', numberCol: 'request_no', statusCol: 'approval_status', dateCol: 'created_at' },
  { pageId: 'service-visits', table: 'service_visits', numberCol: 'visit_no', statusCol: 'status', dateCol: 'scheduled_start' },
  { pageId: 'service-spares', table: 'spare_issues', numberCol: 'issue_no', statusCol: 'status', dateCol: 'created_at' },
  { pageId: 'service-history', table: 'service_history', numberCol: 'ref_no', statusCol: 'status', dateCol: 'event_date' },
  { pageId: 'service-amc', table: 'amc_contracts', numberCol: 'contract_no', statusCol: 'status', dateCol: 'start_date' },
  { pageId: 'service-warranty', table: 'warranty_registrations', numberCol: 'id', statusCol: 'status', dateCol: 'start_date' },
  { pageId: 'service-claims', table: 'warranty_claims', numberCol: 'claim_no', statusCol: 'status', dateCol: 'created_at' },

  // Logistics / Fleet
  { pageId: 'log-transporters', table: 'suppliers', numberCol: 'code', statusCol: 'status', dateCol: 'created_at', where: 'is_transporter = true AND deleted_at IS NULL' },
  { pageId: 'log-routes', table: 'routes', numberCol: 'code', statusCol: 'status', dateCol: 'created_at', unitCol: 'origin_unit_id', where: 'deleted_at IS NULL' },
  { pageId: 'log-freight', table: 'freight_calculations', numberCol: 'calc_no', statusCol: 'status', dateCol: 'created_at', unitCol: 'unit_id' },
  { pageId: 'log-shipments', table: 'shipments', numberCol: 'shipment_no', statusCol: 'status', dateCol: 'planned_dispatch_at', unitCol: 'unit_id' },
  { pageId: 'log-tracking', table: 'shipments', numberCol: 'shipment_no', statusCol: 'status', dateCol: 'planned_dispatch_at', unitCol: 'unit_id' },
  { pageId: 'log-pod', table: 'pods', numberCol: 'receiver_name', dateCol: 'delivered_at' },
  { pageId: 'customer-receipts', table: 'sales_receipts', numberCol: 'number', statusCol: 'status', dateCol: 'receipt_date', unitCol: 'unit_id' },
  { pageId: 'fleet-vehicles', table: 'vehicles', numberCol: 'reg_no', statusCol: 'status', dateCol: 'created_at', unitCol: 'unit_id', where: 'deleted_at IS NULL' },
  { pageId: 'fleet-drivers', table: 'drivers', numberCol: 'name', statusCol: 'status', dateCol: 'created_at', where: 'deleted_at IS NULL' },
  { pageId: 'fleet-fuel', table: 'fuel_logs', numberCol: 'fuel_no', statusCol: 'status', dateCol: 'filled_at', unitCol: 'unit_id' },
  { pageId: 'fleet-service', table: 'vehicle_services', numberCol: 'service_no', statusCol: 'status', dateCol: 'service_date', unitCol: 'unit_id' },
  { pageId: 'fleet-documents', table: 'vehicle_documents', numberCol: 'doc_no', statusCol: 'status', dateCol: 'expiry_date' },
  { pageId: 'gate-in', table: 'gate_passes', numberCol: 'pass_no', statusCol: 'status', dateCol: 'entry_at', unitCol: 'unit_id', where: "direction = 'IN'" },
  { pageId: 'gate-out', table: 'gate_passes', numberCol: 'pass_no', statusCol: 'status', dateCol: 'entry_at', unitCol: 'unit_id', where: "direction = 'OUT'" },
  { pageId: 'gate-return', table: 'gate_passes', numberCol: 'pass_no', statusCol: 'status', dateCol: 'entry_at', unitCol: 'unit_id', where: "pass_type = 'RETURNABLE'" },
];

// Skipped pages (not listed above):
// fin-trial, fin-pnl, fin-bs, fin-cashflow, fin-ageing: computed reports, no record table.
// dept-work-hr, dept-work-projects, dept-work-service: department work dashboards (inbox of other pages' records).
// hr-documents: same screen as hr-employees (employee file view), no own record table.
// hr-ess: employee self-service dashboard, no own record table.
// hr-leave number: leave has no document number, so the picker shows the record id.
// pay-pf, pay-esic, pay-pt, pay-tds: statutory rate/rule tables and exports, not documents.
// pay-register: payroll register report over payroll runs (runs are listed under pay-processing).
// proj-dependencies: alias of the Gantt view (task_dependencies links, no document).
// proj-kanban, proj-gantt: boards over project_tasks (tasks are listed under proj-tasks).
// proj-profitability: computed report.
// service-technicians: technician board, no number or label column (only employee_id).
