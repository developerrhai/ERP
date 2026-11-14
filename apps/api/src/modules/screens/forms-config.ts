// Phase 22: Add / Edit / Delete for the screens whose tables are plain masters or simple documents.
// Declarative: the engine in forms.ts validates, checks the plant, numbers, audits and writes.
// Screens that belong to a domain service (loans, payroll, GST returns, ...) keep using that service.
import { loanSchedule, regularEmi } from './loan';
import type { FormConfig, FormField, FormLookup, ScreenConfig } from './configs';

const STATUS_AI = ['Active', 'Inactive'] as const;
const NOEDIT_MSG = 'It cannot be changed after it is created. Raise a new entry instead.';

const L = {
  warehouses: {
    from: 'warehouses x',
    label: `x.code || ' — ' || x.name`,
    searchSql: ['x.code', 'x.name'],
    where: 'x.deleted_at IS NULL',
    unitSql: 'x.unit_id',
  },
  zones: {
    from: 'wms_zones x JOIN warehouses w ON w.id = x.warehouse_id',
    label: `x.code || ' — ' || x.name || ' (' || w.name || ')'`,
    searchSql: ['x.code', 'x.name'],
    where: `x.deleted_at IS NULL AND x.status = 'Active'`,
    unitSql: 'w.unit_id',
  },
  racks: {
    from: 'wms_racks x JOIN warehouses w ON w.id = x.warehouse_id',
    label: `x.code || ' (' || w.name || ')'`,
    searchSql: ['x.code'],
    where: `x.deleted_at IS NULL AND x.status = 'Active'`,
    unitSql: 'w.unit_id',
  },
  bins: {
    from: 'wms_bins x JOIN warehouses w ON w.id = x.warehouse_id',
    label: `x.code || ' (' || w.name || ')'`,
    searchSql: ['x.code', 'x.name'],
    parentSql: 'x.warehouse_id',
    where: 'x.deleted_at IS NULL',
    unitSql: 'w.unit_id',
  },
  items: {
    from: 'items x',
    label: `x.code || ' — ' || x.name`,
    searchSql: ['x.code', 'x.name'],
    where: 'x.deleted_at IS NULL',
  },
  employees: {
    from: 'employees x',
    label: `x.emp_code || ' — ' || trim(x.first_name || ' ' || coalesce(x.last_name, ''))`,
    searchSql: ['x.emp_code', 'x.first_name', 'x.last_name'],
    where: `x.deleted_at IS NULL AND x.status = 'ACTIVE'`,
  },
  users: {
    from: 'users x',
    label: 'x.name',
    searchSql: ['x.name', 'x.login_id'],
    where: `x.status = 'ACTIVE'`,
  },
  gstRates: {
    from: 'gst_rates x',
    label: `x.name || ' (IGST ' || x.igst_pct::text || ' %)'`,
    searchSql: ['x.code', 'x.name'],
    where: `x.deleted_at IS NULL AND x.status = 'ACTIVE'`,
  },
  customers: {
    from: 'customers x',
    label: `x.code || ' — ' || x.name`,
    searchSql: ['x.code', 'x.name'],
    where: 'x.deleted_at IS NULL',
  },
  candidates: {
    from: 'candidates x',
    label: `x.name || coalesce(' (' || x.mobile || ')', '')`,
    searchSql: ['x.name', 'x.mobile', 'x.email'],
  },
  requisitions: {
    from: 'job_requisitions x',
    label: `x.req_code || ' - ' || coalesce(x.department, '')`,
    searchSql: ['x.req_code', 'x.department'],
    where: `x.deleted_at IS NULL`,
  },
  perfCycles: {
    from: 'perf_cycles x',
    label: 'x.name',
    searchSql: ['x.name'],
  },
  projects: {
    from: 'projects x',
    label: `x.code || ' - ' || x.name`,
    searchSql: ['x.code', 'x.name'],
    unitSql: 'x.unit_id',
  },
  tasks: {
    from: 'project_tasks x',
    label: `x.number || ' - ' || x.name`,
    searchSql: ['x.number', 'x.name'],
    parentSql: 'x.project_id',
  },
  technicians: {
    from: 'technicians x JOIN employees e ON e.id = x.employee_id',
    label: `e.emp_code || ' - ' || trim(e.first_name || ' ' || coalesce(e.last_name, ''))`,
    searchSql: ['e.emp_code', 'e.first_name', 'e.last_name'],
    where: 'x.active',
  },
  waves: {
    from: 'pick_waves x',
    label: 'x.number',
    searchSql: ['x.number', 'x.reference'],
    where: `x.deleted_at IS NULL AND x.status <> 'Cancelled'`,
    unitSql: 'x.unit_id',
  },
} satisfies Record<string, FormLookup>;

const status = (opts: readonly string[], def: string): FormField => ({
  key: 'status',
  label: 'Status',
  column: 'status',
  type: 'select',
  options: opts,
  default: def,
});

const WH_UNIT = {
  fromKey: 'warehouse',
  sql: 'SELECT unit_id::text AS unit_id FROM warehouses WHERE id = $1::uuid',
};

const PROJ_UNIT = {
      fromKey: 'project',
      sql: 'SELECT unit_id::text AS unit_id FROM projects WHERE id = $1::uuid',
    };

const EMP_UNIT = {
  fromKey: 'employee',
  sql: 'SELECT (SELECT a.unit_id::text FROM employee_assignments a WHERE a.employee_id = e.id AND a.effective_to IS NULL ORDER BY a.effective_from DESC LIMIT 1) AS unit_id FROM employees e WHERE e.id = $1::uuid',
};

const WH_UNIT_KEY = (key: string) => ({
  fromKey: key,
  sql: 'SELECT unit_id::text AS unit_id FROM warehouses WHERE id = $1::uuid',
});

export const FORMS: Record<string, FormConfig> = {
  'pay-loan': {
    table: 'employee_loans',
    title: 'Loan',
    softDelete: false,
    lookups: { employees: L.employees },
    numbering: { docType: 'pay-loan', column: 'loan_no' },
    noEdit: 'A loan cannot be changed once created. Foreclose it instead.',
    noDelete: 'A loan cannot be deleted once created. Foreclose it instead.',
    hasUpdatedBy: false,
    unitOf: {
      fromKey: 'employee',
      sql: 'SELECT (SELECT a.unit_id::text FROM employee_assignments a WHERE a.employee_id = e.id AND a.effective_to IS NULL ORDER BY a.effective_from DESC LIMIT 1) AS unit_id FROM employees e WHERE e.id = $1::uuid',
    },
    fields: [
      { key: 'employee', label: 'Employee', column: 'employee_id', type: 'lookup', lookup: 'employees', required: true, editable: false },
      { key: 'principal', label: 'Principal', column: 'principal_amount', type: 'number', required: true, min: 1, help: '₹' },
      { key: 'interest', label: 'Interest', column: 'interest_rate', type: 'number', min: 0, max: 0, default: 0, help: '0 for now: interest rules are not set up yet' },
      { key: 'tenure', label: 'Tenure (months)', column: 'tenure_months', type: 'int', required: true, min: 1, max: 120, default: 10 },
      { key: 'disbursed', label: 'Disbursement Date', column: 'disbursed_date', type: 'date', required: true },
    ],
    compute: (v) => ({ 'emi_amount::numeric': regularEmi(String(v.principal), Number(v.tenure)) }),
    afterCreate: async (tx, id, v) => {
      const rows = loanSchedule(String(v.principal), Number(v.tenure), String(v.disbursed));
      for (const r of rows) {
        await tx.$executeRaw`
          INSERT INTO loan_schedules (loan_id, instalment_no, due_date, principal_component, interest_component, total_amount)
          VALUES (${id}::uuid, ${r.no}, ${r.dueDate}::date, ${r.amount}::numeric, 0, ${r.amount}::numeric)`;
      }
    },
  },
  // Statutory masters: rows start as needs_review = true (R-23 / E-30) until the CA signs them off.
  'tax-hsn': {
    table: 'hsn_sac_codes',
    title: 'HSN / SAC',
    softDelete: true,
    lookups: { gstRates: L.gstRates },
    // The dated rate row (hsn_sac_rates) is written with the code; later rate changes use "Add rate".
    afterCreate: async (tx, id, v) => {
      if (!v.gstRate) return;
      await tx.$executeRaw`
        INSERT INTO hsn_sac_rates (hsn_id, gst_rate_id, cess_pct, effective_from)
        VALUES (${id}::uuid, ${String(v.gstRate)}::uuid, ${String(v.cess ?? '0')}::numeric, ${String(v.effectiveFrom)}::date)`;
    },
    fields: [
      { key: 'code', label: 'HSN / SAC Code', column: 'code', type: 'text', required: true, maxLength: 8, editable: false, help: '4, 6 or 8 digits; 99… is a service (SAC)' },
      { key: 'description', label: 'Description', column: 'description', type: 'text', required: true, maxLength: 300 },
      { key: 'uqc', label: 'Default UQC', column: 'default_uqc', type: 'text', maxLength: 10 },
      { key: 'gstRate', label: 'GST Rate', column: 'id', type: 'lookup', lookup: 'gstRates', required: true, editable: false, virtual: true, help: 'Lines with this HSN take this rate. Later changes: add a new dated rate.' },
      { key: 'cess', label: 'Cess %', column: 'id', type: 'number', min: 0, max: 100, default: 0, editable: false, virtual: true },
      { key: 'effectiveFrom', label: 'Rate Effective From', column: 'id', type: 'date', required: true, editable: false, virtual: true },
      status(['ACTIVE', 'INACTIVE'], 'ACTIVE'),
    ],
  },
  'tax-gst': {
    table: 'gst_rates',
    title: 'GST Rate',
    softDelete: true,
    lookups: {},
    // CGST and SGST are generated by the database (IGST / 2); the rate itself is fixed once created.
    fields: [
      { key: 'code', label: 'Rate Code', column: 'code', type: 'text', required: true, maxLength: 30, editable: false },
      { key: 'name', label: 'Name', column: 'name', type: 'text', required: true, maxLength: 100 },
      { key: 'kind', label: 'Kind', column: 'kind', type: 'select', options: ['TAXABLE', 'NIL', 'EXEMPT', 'NON_GST'], default: 'TAXABLE', editable: false },
      { key: 'igst', label: 'IGST %', column: 'igst_pct', type: 'number', required: true, min: 0, max: 100, default: 0, editable: false, help: 'CGST and SGST are set to half of this' },
      { key: 'from', label: 'Effective From', column: 'effective_from', type: 'date', required: true, editable: false },
      { key: 'to', label: 'Effective To', column: 'effective_to', type: 'date' },
      status(['ACTIVE', 'INACTIVE'], 'ACTIVE'),
    ],
  },
  'sales-pricelist': {
    table: 'price_lists',
    title: 'Price List',
    softDelete: true,
    lookups: { customers: L.customers },
    fields: [
      { key: 'code', label: 'Code', column: 'code', type: 'text', required: true, maxLength: 30, editable: false },
      { key: 'name', label: 'Price List Name', column: 'name', type: 'text', required: true, maxLength: 120 },
      { key: 'kind', label: 'Type', column: 'kind', type: 'select', options: ['SELLING', 'BUYING'], default: 'SELLING', editable: false },
      { key: 'currency', label: 'Currency', column: 'currency_code', type: 'text', maxLength: 3, default: 'INR' },
      { key: 'customer', label: 'Customer', column: 'customer_id', type: 'lookup', lookup: 'customers' },
      { key: 'incl', label: 'Price Includes Tax', column: 'price_includes_tax', type: 'bool', default: false },
      { key: 'from', label: 'Valid From', column: 'valid_from', type: 'date' },
      { key: 'to', label: 'Valid To', column: 'valid_to', type: 'date' },
      { key: 'default', label: 'Default List', column: 'is_default', type: 'bool', default: false },
      status(['ACTIVE', 'INACTIVE'], 'ACTIVE'),
    ],
  },
  'proj-milestones': {
    table: 'project_milestones',
    title: 'Milestone',
    softDelete: false,
    lookups: { projects: L.projects },
    hasUpdatedBy: false,
    hasCreatedBy: false,
    statusColumn: 'status',
    createStatus: 'PLANNED',
    noEdit: NOEDIT_MSG,
    noDelete: NOEDIT_MSG,
    unitOf: PROJ_UNIT,
    fields: [
      { key: 'project', label: 'Project', column: 'project_id', type: 'lookup', lookup: 'projects', required: true },
      { key: 'name', label: 'Milestone', column: 'name', type: 'text', required: true, maxLength: 150 },
      { key: 'target', label: 'Target Date', column: 'target_date', type: 'date', required: true },
      { key: 'criteria', label: 'Acceptance Criteria', column: 'acceptance_criteria', type: 'textarea' },
      { key: 'billing', label: 'Billing Milestone', column: 'is_billing', type: 'bool', default: false },
    ],
  },
  'proj-team': {
    table: 'project_team',
    title: 'Team Member',
    softDelete: false,
    lookups: { projects: L.projects, employees: L.employees },
    hasUpdatedBy: false,
    hasCreatedBy: false,
    noEdit: NOEDIT_MSG,
    noDelete: NOEDIT_MSG,
    unitOf: PROJ_UNIT,
    fields: [
      { key: 'project', label: 'Project', column: 'project_id', type: 'lookup', lookup: 'projects', required: true },
      { key: 'employee', label: 'Employee', column: 'employee_id', type: 'lookup', lookup: 'employees', required: true },
      { key: 'role', label: 'Role', column: 'role', type: 'select', options: ['PM', 'ENGINEER', 'TECHNICIAN', 'QA', 'VIEWER'], default: 'ENGINEER' },
      { key: 'allocation', label: 'Allocation %', column: 'allocation_pct', type: 'number', min: 1, max: 100, default: 100 },
      { key: 'from', label: 'From Date', column: 'start_date', type: 'date', required: true },
      { key: 'to', label: 'To Date', column: 'end_date', type: 'date' },
      { key: 'billable', label: 'Billable', column: 'billable', type: 'bool', default: true },
      { key: 'cost', label: 'Hourly Cost', column: 'cost_rate', type: 'number', min: 0 },
    ],
  },
  'proj-subtasks': {
    table: 'project_tasks',
    title: 'Subtask',
    softDelete: false,
    lookups: { projects: L.projects, tasks: L.tasks, employees: L.employees },
    numbering: { docType: 'proj-subtasks', column: 'number' },
    hasUpdatedBy: false,
    hasCreatedBy: false,
    noEdit: NOEDIT_MSG,
    noDelete: NOEDIT_MSG,
    unitOf: PROJ_UNIT,
    fields: [
      { key: 'project', label: 'Project', column: 'project_id', type: 'lookup', lookup: 'projects', required: true },
      { key: 'parent', label: 'Parent Task', column: 'parent_task_id', type: 'lookup', lookup: 'tasks', parent: 'project', required: true },
      { key: 'name', label: 'Subtask', column: 'name', type: 'text', required: true, maxLength: 150 },
      { key: 'owner', label: 'Owner', column: 'owner_id', type: 'lookup', lookup: 'employees' },
      { key: 'start', label: 'Start Date', column: 'planned_start', type: 'date', required: true },
      { key: 'due', label: 'Due Date', column: 'planned_end', type: 'date', required: true },
      { key: 'hours', label: 'Estimated Hrs', column: 'estimated_hrs', type: 'number', min: 0 },
      { key: 'priority', label: 'Priority', column: 'priority', type: 'select', options: ['P1', 'P2', 'P3', 'P4'], default: 'P3' },
    ],
  },
  'proj-budget': {
    table: 'project_budgets',
    title: 'Project Budget',
    softDelete: false,
    lookups: { projects: L.projects },
    hasUpdatedBy: false,
    hasCreatedBy: true,
    statusColumn: 'status',
    createStatus: 'DRAFT',
    noEdit: NOEDIT_MSG,
    noDelete: NOEDIT_MSG,
    unitOf: PROJ_UNIT,
    derive: {
      version: {
        fromKey: 'project',
        sql: 'SELECT COALESCE(MAX(version), 0) + 1 FROM project_budgets WHERE project_id = $1::uuid',
      },
    },
    fields: [
      { key: 'project', label: 'Project', column: 'project_id', type: 'lookup', lookup: 'projects', required: true },
      { key: 'total', label: 'Budget', column: 'total_budget', type: 'number', required: true, min: 0, help: 'Rs. Saved as a new draft version; approval is a separate step.' },
    ],
  },
  'proj-expenses': {
    table: 'project_expenses',
    title: 'Project Expense',
    softDelete: false,
    lookups: { projects: L.projects, employees: L.employees },
    numbering: { docType: 'proj-expenses', column: 'expense_no' },
    hasUpdatedBy: false,
    statusColumn: 'status',
    createStatus: 'DRAFT',
    noEdit: NOEDIT_MSG,
    noDelete: NOEDIT_MSG,
    unitOf: PROJ_UNIT,
    fields: [
      { key: 'project', label: 'Project', column: 'project_id', type: 'lookup', lookup: 'projects', required: true },
      { key: 'date', label: 'Date', column: 'date', type: 'date', required: true },
      { key: 'payee', label: 'Vendor Employee', column: 'payee_employee_id', type: 'lookup', lookup: 'employees' },
      { key: 'amount', label: 'Amount', column: 'total_amount', type: 'number', required: true, min: 0.01 },
      { key: 'tax', label: 'Tax', column: 'total_tax', type: 'number', min: 0, default: 0 },
    ],
  },
  'hr-exit': {
    table: 'exit_cases',
    title: 'Exit Case',
    softDelete: false,
    lookups: { employees: L.employees },
    numbering: { docType: 'hr-exit', column: 'case_no' },
    hasUpdatedBy: false,
    statusColumn: 'status',
    createStatus: 'DRAFT',
    noEdit: NOEDIT_MSG,
    noDelete: NOEDIT_MSG,
    unitOf: EMP_UNIT,
    fields: [
      { key: 'employee', label: 'Employee', column: 'employee_id', type: 'lookup', lookup: 'employees', required: true },
      { key: 'type', label: 'Exit Type', column: 'exit_type', type: 'select', options: ['RESIGNATION', 'TERMINATION', 'RETIREMENT', 'DEATH', 'ABSCONDING', 'CONTRACT_END'], default: 'RESIGNATION' },
      { key: 'resigned', label: 'Resignation Date', column: 'resignation_date', type: 'date', required: true },
      { key: 'lwd', label: 'Last Working Date', column: 'expected_lwd', type: 'date', required: true },
      { key: 'reason', label: 'Reason', column: 'reason', type: 'text', required: true, maxLength: 200 },
    ],
  },
  'service-spares': {
    table: 'spare_issues',
    title: 'Spare Issue',
    softDelete: false,
    lookups: { technicians: L.technicians, warehouses: L.warehouses },
    numbering: { docType: 'service-spares', column: 'issue_no' },
    hasUpdatedBy: false,
    hasCreatedBy: false,
    statusColumn: 'status',
    createStatus: 'ISSUED',
    noEdit: NOEDIT_MSG,
    noDelete: NOEDIT_MSG,
    unitOf: WH_UNIT_KEY('warehouse'),
    fields: [
      { key: 'technician', label: 'Technician Van', column: 'technician_id', type: 'lookup', lookup: 'technicians', required: true },
      { key: 'warehouse', label: 'Warehouse', column: 'warehouse_id', type: 'lookup', lookup: 'warehouses', required: true },
      { key: 'chargeable', label: 'Chargeable', column: 'chargeable', type: 'bool', default: false },
    ],
  },
  // Create-only registers: their tables have no version / audit columns, so editing and deleting are refused
  // with a reason (the buttons stay greyed) instead of being faked.
  'hr-training': {
    table: 'training_programs',
    title: 'Training Program',
    softDelete: false,
    lookups: {},
    hasUpdatedBy: false,
    noEdit: NOEDIT_MSG,
    noDelete: NOEDIT_MSG,
    fields: [
      { key: 'code', label: 'Training ID', column: 'code', type: 'text', required: true, maxLength: 30 },
      { key: 'name', label: 'Program', column: 'name', type: 'text', required: true, maxLength: 100 },
      { key: 'trainer', label: 'Provider', column: 'trainer', type: 'text', maxLength: 100 },
      { key: 'hours', label: 'Duration (hours)', column: 'duration_hours', type: 'number', min: 0 },
      { key: 'description', label: 'Description', column: 'description', type: 'textarea' },
    ],
  },
  'hr-onboarding': {
    table: 'onboarding_cases',
    title: 'Onboarding Case',
    softDelete: false,
    lookups: { employees: L.employees },
    hasUpdatedBy: false,
    statusColumn: 'status',
    createStatus: 'IN_PROGRESS',
    noEdit: NOEDIT_MSG,
    noDelete: NOEDIT_MSG,
    fields: [
      { key: 'employee', label: 'Employee Candidate', column: 'employee_id', type: 'lookup', lookup: 'employees', required: true },
      { key: 'laptop', label: 'Laptop Asset', column: 'it_asset_allocated', type: 'bool', default: false },
    ],
  },
  'hr-performance': {
    table: 'perf_reviews',
    title: 'Performance Review',
    softDelete: false,
    lookups: { employees: L.employees, cycles: L.perfCycles },
    hasUpdatedBy: false,
    hasCreatedBy: false,
    statusColumn: 'status',
    createStatus: 'DRAFT',
    noEdit: NOEDIT_MSG,
    noDelete: NOEDIT_MSG,
    fields: [
      { key: 'cycle', label: 'Cycle', column: 'cycle_id', type: 'lookup', lookup: 'cycles', required: true },
      { key: 'employee', label: 'Employee', column: 'employee_id', type: 'lookup', lookup: 'employees', required: true },
      { key: 'reviewer', label: 'Manager (Reviewer)', column: 'reviewer_employee_id', type: 'lookup', lookup: 'employees' },
      { key: 'self', label: 'Self Rating', column: 'self_rating', type: 'number', min: 0, max: 5, help: '0 to 5' },
      { key: 'rating', label: 'Manager Rating', column: 'reviewer_rating', type: 'number', min: 0, max: 5, help: '0 to 5' },
      { key: 'comments', label: 'Comments', column: 'comments', type: 'textarea' },
    ],
  },
  'hr-recruitment': {
    table: 'candidate_applications',
    title: 'Candidate Application',
    softDelete: false,
    lookups: { candidates: L.candidates, requisitions: L.requisitions },
    hasUpdatedBy: false,
    hasCreatedBy: false,
    noEdit: NOEDIT_MSG,
    noDelete: NOEDIT_MSG,
    fields: [
      { key: 'candidate', label: 'Candidate', column: 'candidate_id', type: 'lookup', lookup: 'candidates', required: true },
      { key: 'requisition', label: 'Requisition No', column: 'requisition_id', type: 'lookup', lookup: 'requisitions', required: true },
      { key: 'stage', label: 'Stage', column: 'stage', type: 'select', options: ['SCREENING', 'INTERVIEW', 'OFFER', 'JOINED', 'REJECTED', 'WITHDRAWN'], default: 'SCREENING' },
    ],
  },
  'service-requests': {
    table: 'service_requests',
    title: 'Service Request',
    softDelete: false,
    lookups: { customers: L.customers },
    numbering: { docType: 'service-requests', column: 'request_no' },
    hasUpdatedBy: false,
    hasCreatedBy: false,
    noEdit: NOEDIT_MSG,
    noDelete: NOEDIT_MSG,
    fields: [
      { key: 'customer', label: 'Customer', column: 'customer_id', type: 'lookup', lookup: 'customers', required: true },
      { key: 'type', label: 'Request Type', column: 'request_type', type: 'select', options: ['INSTALLATION', 'RELOCATION', 'OVERHAUL', 'UPGRADE'], required: true, default: 'INSTALLATION' },
      { key: 'estimate', label: 'Estimate', column: 'estimate_amount', type: 'number', min: 0 },
    ],
  },
  'wms-zones': {
    table: 'wms_zones',
    title: 'Zone',
    softDelete: true,
    lookups: { warehouses: L.warehouses },
    unitOf: WH_UNIT,
    deleteGuard: {
      sql: 'SELECT count(*)::int AS n FROM wms_racks WHERE zone_id = $1::uuid AND deleted_at IS NULL',
      message: 'This zone still has racks. Remove or move them first.',
    },
    fields: [
      { key: 'warehouse', label: 'Warehouse', column: 'warehouse_id', type: 'lookup', lookup: 'warehouses', required: true, editable: false },
      { key: 'code', label: 'Zone Code', column: 'code', type: 'text', required: true, maxLength: 30, editable: false },
      { key: 'name', label: 'Zone Name', column: 'name', type: 'text', required: true, maxLength: 120 },
      { key: 'type', label: 'Zone Type', column: 'zone_type', type: 'select', options: ['Storage', 'Receiving', 'Dispatch', 'Quarantine', 'Staging', 'Cold Store'], default: 'Storage' },
      { key: 'capacity', label: 'Capacity', column: 'capacity', type: 'number', min: 0 },
      { key: 'storageClass', label: 'Storage Class', column: 'storage_class', type: 'text', maxLength: 30 },
      { key: 'temperature', label: 'Temperature', column: 'temperature', type: 'text', maxLength: 30 },
      { key: 'putaway', label: 'Putaway Priority', column: 'putaway_priority', type: 'int', min: 1, default: 100 },
      { key: 'pickSeq', label: 'Pick Sequence', column: 'pick_sequence', type: 'int', min: 1, default: 100 },
      status(STATUS_AI, 'Active'),
    ],
  },
  'wms-racks': {
    table: 'wms_racks',
    title: 'Rack',
    softDelete: true,
    lookups: { zones: L.zones },
    unitOf: {
      fromKey: 'zone',
      sql: 'SELECT w.unit_id::text AS unit_id FROM wms_zones z JOIN warehouses w ON w.id = z.warehouse_id WHERE z.id = $1::uuid',
    },
    derive: {
      warehouse_id: { fromKey: 'zone', sql: 'SELECT warehouse_id FROM wms_zones WHERE id = $1::uuid' },
    },
    deleteGuard: {
      sql: 'SELECT count(*)::int AS n FROM wms_shelves WHERE rack_id = $1::uuid AND deleted_at IS NULL',
      message: 'This rack still has shelves. Remove or move them first.',
    },
    fields: [
      { key: 'zone', label: 'Zone', column: 'zone_id', type: 'lookup', lookup: 'zones', required: true, editable: false },
      { key: 'code', label: 'Rack Code', column: 'code', type: 'text', required: true, maxLength: 30, editable: false },
      { key: 'aisle', label: 'Aisle', column: 'aisle', type: 'text', maxLength: 30 },
      { key: 'type', label: 'Rack Type', column: 'rack_type', type: 'select', options: ['Selective', 'Drive-in', 'Cantilever', 'Pallet Flow', 'Mezzanine'], default: 'Selective' },
      { key: 'levels', label: 'Levels', column: 'levels', type: 'int', min: 1, default: 1 },
      { key: 'maxLoad', label: 'Max Load', column: 'max_load_kg', type: 'number', min: 0, help: 'kg' },
      status(STATUS_AI, 'Active'),
    ],
  },
  'wms-shelves': {
    table: 'wms_shelves',
    title: 'Shelf',
    softDelete: true,
    lookups: { racks: L.racks, bins: L.bins },
    unitOf: {
      fromKey: 'rack',
      sql: 'SELECT w.unit_id::text AS unit_id FROM wms_racks r JOIN warehouses w ON w.id = r.warehouse_id WHERE r.id = $1::uuid',
    },
    deleteGuard: {
      sql: 'SELECT count(*)::int AS n FROM wms_bins WHERE shelf_id = $1::uuid AND deleted_at IS NULL',
      message: 'Bins are still placed on this shelf. Move them first.',
    },
    fields: [
      { key: 'rack', label: 'Rack', column: 'rack_id', type: 'lookup', lookup: 'racks', required: true, editable: false },
      { key: 'code', label: 'Shelf Code', column: 'code', type: 'text', required: true, maxLength: 30, editable: false },
      { key: 'level', label: 'Level', column: 'level', type: 'int', min: 1, default: 1 },
      { key: 'dimensions', label: 'Dimensions', column: 'dimensions', type: 'text', maxLength: 60, help: 'L × W × H' },
      { key: 'maxWeight', label: 'Max Weight', column: 'max_weight_kg', type: 'number', min: 0, help: 'kg' },
      { key: 'rule', label: 'Storage Rule', column: 'storage_rule', type: 'text', maxLength: 120 },
      status(STATUS_AI, 'Active'),
    ],
  },
  'wms-rfid': {
    table: 'wms_rfid_tags',
    title: 'Tag',
    softDelete: true,
    lookups: { warehouses: L.warehouses, bins: L.bins },
    unitOf: WH_UNIT,
    fields: [
      { key: 'warehouse', label: 'Warehouse', column: 'warehouse_id', type: 'lookup', lookup: 'warehouses', required: true, editable: false },
      { key: 'bin', label: 'Expected Location', column: 'bin_id', type: 'lookup', lookup: 'bins', parent: 'warehouse', required: true, help: 'The bin this tag is stuck on' },
      { key: 'tag', label: 'Tag EPC', column: 'tag_code', type: 'text', required: true, maxLength: 60, editable: false },
      { key: 'type', label: 'Tag Type', column: 'tag_type', type: 'select', options: ['BARCODE', 'RFID'], default: 'BARCODE' },
      status(['Active', 'Inactive', 'Lost'], 'Active'),
    ],
  },
  'wms-pick': {
    table: 'pick_waves',
    title: 'Pick Wave',
    softDelete: true,
    lookups: { warehouses: L.warehouses, bins: L.bins, items: L.items },
    numbering: { docType: 'wms-pick', column: 'number' },
    unitColumn: 'unit_id',
    fyColumn: 'fy_id',
    unitOf: WH_UNIT,
    editStatuses: ['Draft'],
    statusColumn: 'status',
    createStatus: 'Draft',
    fields: [
      { key: 'warehouse', label: 'Warehouse', column: 'warehouse_id', type: 'lookup', lookup: 'warehouses', required: true, editable: false },
      { key: 'planned', label: 'Planned Date', column: 'planned_date', type: 'date', required: true },
      { key: 'reference', label: 'Sales Order', column: 'reference', type: 'text', maxLength: 60 },
      status(['Draft', 'Released', 'Cancelled'], 'Draft'),
    ],
    lines: {
      table: 'pick_tasks',
      fk: 'wave_id',
      label: 'Pick Tasks',
      min: 1,
      max: 200,
      lineNoColumn: 'line_no',
      seqColumn: 'route_seq',
      fields: [
        { key: 'item', label: 'Item', column: 'item_id', type: 'lookup', lookup: 'items', required: true },
        { key: 'bin', label: 'Source Bin', column: 'source_bin_id', type: 'lookup', lookup: 'bins', parent: 'warehouse' },
        { key: 'required', label: 'Required Qty', column: 'required_qty', type: 'number', required: true, min: 0.001 },
      ],
    },
  },
  'wms-packing': {
    table: 'pack_units',
    title: 'Pack Unit',
    softDelete: true,
    lookups: { waves: L.waves },
    numbering: { docType: 'wms-packing', column: 'number' },
    unitColumn: 'unit_id',
    editStatuses: ['Open', 'Packed'],
    statusColumn: 'status',
    createStatus: 'Open',
    fields: [
      { key: 'wave', label: 'Wave No', column: 'wave_id', type: 'lookup', lookup: 'waves' },
      { key: 'cartons', label: 'Cartons', column: 'cartons', type: 'int', min: 1, default: 1, required: true },
      { key: 'gross', label: 'Gross Weight', column: 'gross_kg', type: 'number', min: 0, help: 'kg' },
      { key: 'volumetric', label: 'Volumetric Weight', column: 'volumetric_kg', type: 'number', min: 0, help: 'kg' },
      { key: 'label', label: 'Label Status', column: 'label_status', type: 'select', options: ['Pending', 'Printed'], default: 'Pending' },
      { key: 'qc', label: 'QC Check', column: 'qc_check', type: 'bool', default: false },
      status(['Open', 'Packed', 'Cancelled'], 'Open'),
    ],
  },
  'qms-5why': {
    table: 'five_why_cases',
    title: '5 Why Case',
    softDelete: true,
    lookups: { users: L.users },
    numbering: { docType: 'qms-5why', column: 'number' },
    unitColumn: 'unit_id',
    fyColumn: 'fy_id',
    editStatuses: ['Open'],
    statusColumn: 'status',
    createStatus: 'Open',
    fields: [
      { key: 'title', label: 'Title', column: 'title', type: 'text', required: true, maxLength: 200 },
      { key: 'ncr', label: 'NCR Ref', column: 'ncr_ref', type: 'text', maxLength: 60 },
      { key: 'problem', label: 'Problem', column: 'problem', type: 'textarea', required: true },
      { key: 'department', label: 'Department', column: 'department', type: 'text', maxLength: 60 },
      { key: 'owner', label: 'Owner', column: 'owner_id', type: 'lookup', lookup: 'users' },
      { key: 'root', label: 'Root Cause', column: 'root_cause', type: 'textarea', help: 'Required before the case can be closed' },
      { key: 'action', label: 'Corrective Action', column: 'corrective_action', type: 'textarea' },
      { key: 'capa', label: 'Action Linkage', column: 'capa_ref', type: 'text', maxLength: 60 },
      status(['Open', 'Closed'], 'Open'),
    ],
    lines: {
      table: 'five_why_steps',
      fk: 'case_id',
      label: 'Why Chain',
      min: 1,
      max: 5,
      lineNoColumn: 'step_no',
      fields: [
        { key: 'why', label: 'Why', column: 'why', type: 'text', required: true, maxLength: 300 },
        { key: 'answer', label: 'Because', column: 'answer', type: 'textarea', required: true },
      ],
    },
  },
};

export function attachForms(screens: Record<string, ScreenConfig>): void {
  for (const [id, form] of Object.entries(FORMS)) {
    const s = screens[id];
    if (s) s.form = form;
  }
}
