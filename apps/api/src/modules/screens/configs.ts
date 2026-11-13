// Phase 22-A/§2: the screens that move from the generic record engine to their own tables.
// Each config says which table(s) a page reads, which columns it shows (V40 labels, letter for
// letter where V40 has the field), how it sorts, and where unit / owner scope is applied.
// SQL fragments here are trusted constants; user input never reaches them (sorts are whitelisted).

import type { Prisma } from '@prisma/client';
import { WMS_SCREENS } from './configs-wms';
import { attachForms } from './forms-config';

export type ColType = 'text' | 'date' | 'datetime' | 'money' | 'num' | 'pct' | 'bool' | 'status';

export interface ScreenColumn {
  key: string;
  /** V40 field label. */
  label: string;
  sql: string;
  type?: ColType;
}

export type FieldType = 'text' | 'textarea' | 'number' | 'int' | 'date' | 'bool' | 'select' | 'lookup';

export interface FormField {
  key: string;
  /** V40 label (or the closest plain-English label). */
  label: string;
  column: string;
  type: FieldType;
  required?: boolean;
  options?: readonly string[];
  /** Name of an entry in FormConfig.lookups. */
  lookup?: string;
  /** Header field whose value filters this lookup (e.g. racks of the chosen zone). */
  parent?: string;
  min?: number;
  max?: number;
  maxLength?: number;
  default?: string | number | boolean;
  /** false = can be chosen on create but not changed afterwards. */
  editable?: boolean;
  /** Not a column: validated and passed to derive / unit checks only. */
  virtual?: boolean;
  help?: string;
}

export interface FormLookup {
  /** SELECT x.id::text AS id, <label> AS label FROM ... (the engine adds the filters, ORDER BY and LIMIT 20). */
  from: string;
  label: string;
  searchSql: string[];
  /** Column of the parent value, when the lookup depends on another field. */
  parentSql?: string;
  where?: string;
  /** Plant of a row, to keep the list inside the chosen plant. */
  unitSql?: string;
}

export interface FormLines {
  table: string;
  fk: string;
  fields: FormField[];
  min: number;
  max: number;
  /** Column that gets 1..n in entry order. */
  lineNoColumn: string;
  /** Extra constant columns copied from a header value, e.g. route_seq = line number. */
  seqColumn?: string;
  label: string;
}

export interface FormConfig {
  table: string;
  title: string;
  fields: FormField[];
  lines?: FormLines;
  lookups: Record<string, FormLookup>;
  /** Document number from the numbering service. */
  numbering?: { docType: string; column: string };
  /** Set unit_id / fy_id from the chosen plant and year. */
  unitColumn?: string;
  fyColumn?: string;
  /** SQL returning the plant (unit_id) of the row being created, given $1 = the value of fromKey. */
  unitOf?: { fromKey: string; sql: string };
  /** Columns filled from another value: column -> { fromKey, sql ($1 = that value) }. */
  derive?: Record<string, { fromKey: string; sql: string }>;
  /** Statuses in which the record may be edited or deleted. Absent = always. */
  editStatuses?: readonly string[];
  /** Soft delete guard: SQL ($1 = id) returning a count; a non-zero count blocks the delete. */
  deleteGuard?: { sql: string; message: string };
  softDelete: boolean;
  /** Extra columns computed from the cleaned values (e.g. a loan's EMI), added to the INSERT. */
  compute?: (values: Record<string, string | boolean | null>) => Record<string, string | number | null>;
  /** Runs inside the create transaction, after the row exists (e.g. the loan's instalment schedule). */
  afterCreate?: (
    tx: Prisma.TransactionClient,
    id: string,
    values: Record<string, string | boolean | null>,
  ) => Promise<void>;
  /** The record cannot be edited / deleted once created; this is the reason shown on the greyed button. */
  noEdit?: string;
  noDelete?: string;
  /** false for tables without an updated_by_id column (created-only records). */
  hasUpdatedBy?: boolean;
  /** false for tables without a created_by_id column. */
  hasCreatedBy?: boolean;
  statusColumn?: string;
  /** Created with this status column value. */
  createStatus?: string;
}

export interface DetailSection {
  title: string;
  /** SELECT of the child rows; $1 = the record id. Must end without LIMIT (the engine adds LIMIT 500). */
  sql: string;
  columns: { key: string; label: string; type?: ColType }[];
}

export interface ScreenConfig {
  /** Child tables shown in the drawer: the EMI schedule of a loan, the tasks of a pick wave... */
  details?: DetailSection[];
  form?: FormConfig;
  pageId: string;
  /** Hint for the empty state: "No {things} yet." */
  things: string;
  /** FROM + JOINs; the main table is aliased `t`. */
  from: string;
  /** Extra always-on filter (without WHERE). */
  baseWhere?: string;
  columns: ScreenColumn[];
  /** public sort name -> SQL; the id tie-breaker is always t.id. */
  sorts: Record<string, string>;
  defaultSort: string;
  /** Cast of the default sort column, for the keyset comparison. */
  sortCast: Record<string, string>;
  statusSql: string | null;
  searchSql: string[];
  unitSql?: string;
  /** Column holding the creator, for OWN scope. */
  ownerSql?: string;
  /** Table for the reltuples estimate. */
  table: string;
}

const EMP = (a: string) => `trim(${a}.first_name || ' ' || coalesce(${a}.last_name, ''))`;

export const SCREENS: Record<string, ScreenConfig> = {
  'hr-recruitment': {
    pageId: 'hr-recruitment',
    things: 'candidate applications',
    table: 'candidate_applications',
    from: `candidate_applications t JOIN candidates c ON c.id = t.candidate_id`,
    columns: [
      { key: 'candidate', label: 'Candidate', sql: 'c.name' },
      { key: 'source', label: 'Source', sql: 'c.source' },
      { key: 'stage', label: 'Stage', sql: 't.stage' },
      { key: 'status', label: 'Status', sql: 't.status', type: 'status' },
      { key: 'created', label: 'Applied On', sql: 't.created_at', type: 'datetime' },
    ],
    sorts: { created_at: 't.created_at', candidate: 'c.name' },
    defaultSort: '-created_at',
    sortCast: { created_at: 'timestamptz', candidate: 'text' },
    statusSql: 't.status',
    searchSql: ['c.name', 't.stage'],
  },
  'hr-onboarding': {
    pageId: 'hr-onboarding',
    things: 'onboarding cases',
    table: 'onboarding_cases',
    from: `onboarding_cases t JOIN employees e ON e.id = t.employee_id`,
    columns: [
      { key: 'employee', label: 'Employee Candidate', sql: EMP('e') },
      { key: 'empCode', label: 'Onboarding ID', sql: 'e.emp_code' },
      { key: 'joining', label: 'Joining Date', sql: 'e.joining_date', type: 'date' },
      { key: 'laptop', label: 'Laptop Asset', sql: 't.it_asset_allocated', type: 'bool' },
      { key: 'status', label: 'Status', sql: 't.status', type: 'status' },
    ],
    sorts: { created_at: 't.created_at', joining: 'e.joining_date' },
    defaultSort: '-created_at',
    sortCast: { created_at: 'timestamptz', joining: 'date' },
    statusSql: 't.status',
    searchSql: [EMP('e'), 'e.emp_code'],
    ownerSql: 't.created_by_id',
  },
  'hr-training': {
    pageId: 'hr-training',
    things: 'training programs',
    table: 'training_programs',
    from: `training_programs t`,
    columns: [
      { key: 'code', label: 'Training ID', sql: 't.code' },
      { key: 'name', label: 'Program', sql: 't.name' },
      { key: 'trainer', label: 'Provider', sql: 't.trainer' },
      { key: 'hours', label: 'Duration (hrs)', sql: 't.duration_hours', type: 'num' },
      { key: 'status', label: 'Status', sql: `CASE WHEN t.active THEN 'Active' ELSE 'Inactive' END`, type: 'status' },
    ],
    sorts: { created_at: 't.created_at', name: 't.name' },
    defaultSort: '-created_at',
    sortCast: { created_at: 'timestamptz', name: 'text' },
    statusSql: `CASE WHEN t.active THEN 'Active' ELSE 'Inactive' END`,
    searchSql: ['t.code', 't.name', 't.trainer'],
    ownerSql: 't.created_by_id',
  },
  'hr-performance': {
    pageId: 'hr-performance',
    things: 'performance reviews',
    table: 'perf_reviews',
    from: `perf_reviews t JOIN employees e ON e.id = t.employee_id JOIN perf_cycles pc ON pc.id = t.cycle_id`,
    columns: [
      { key: 'cycle', label: 'Cycle', sql: 'pc.name' },
      { key: 'employee', label: 'Employee', sql: EMP('e') },
      { key: 'manager', label: 'Manager Rating', sql: 't.reviewer_rating', type: 'num' },
      { key: 'final', label: 'Final Rating', sql: 't.final_rating', type: 'num' },
      { key: 'status', label: 'Status', sql: 't.status', type: 'status' },
    ],
    sorts: { created_at: 't.created_at', employee: EMP('e') },
    defaultSort: '-created_at',
    sortCast: { created_at: 'timestamptz', employee: 'text' },
    statusSql: 't.status',
    searchSql: [EMP('e'), 'pc.name'],
  },
  'hr-exit': {
    pageId: 'hr-exit',
    things: 'exit cases',
    table: 'exit_cases',
    from: `exit_cases t JOIN employees e ON e.id = t.employee_id`,
    columns: [
      { key: 'caseNo', label: 'Exit Case No', sql: 't.case_no' },
      { key: 'employee', label: 'Employee', sql: EMP('e') },
      { key: 'resignation', label: 'Resignation Date', sql: 't.resignation_date', type: 'date' },
      { key: 'lwd', label: 'Last Working Date', sql: 'coalesce(t.approved_lwd, t.expected_lwd)', type: 'date' },
      { key: 'reason', label: 'Reason', sql: 't.reason' },
      { key: 'status', label: 'Status', sql: 't.status', type: 'status' },
    ],
    sorts: { created_at: 't.created_at', resignation: 't.resignation_date' },
    defaultSort: '-created_at',
    sortCast: { created_at: 'timestamptz', resignation: 'date' },
    statusSql: 't.status',
    searchSql: ['t.case_no', EMP('e')],
    ownerSql: 't.created_by_id',
  },
  'pay-loan': {
    details: [
      {
        title: 'EMI Schedule',
        sql: 'SELECT instalment_no AS no, due_date AS due, total_amount AS amount, status FROM loan_schedules WHERE loan_id = $1::uuid ORDER BY instalment_no',
        columns: [
          { key: 'no', label: 'EMI No', type: 'num' },
          { key: 'due', label: 'Next Recovery', type: 'date' },
          { key: 'amount', label: 'EMI', type: 'money' },
          { key: 'status', label: 'Status', type: 'status' },
        ],
      },
    ],
    pageId: 'pay-loan',
    things: 'loans',
    table: 'employee_loans',
    from: `employee_loans t JOIN employees e ON e.id = t.employee_id`,
    columns: [
      { key: 'loanNo', label: 'Loan No', sql: 't.loan_no' },
      { key: 'employee', label: 'Employee', sql: EMP('e') },
      { key: 'disbursed', label: 'Disbursement Date', sql: 't.disbursed_date', type: 'date' },
      { key: 'principal', label: 'Principal', sql: 't.principal_amount', type: 'money' },
      { key: 'interest', label: 'Interest', sql: 't.interest_rate', type: 'pct' },
      { key: 'emi', label: 'EMI', sql: 't.emi_amount', type: 'money' },
      { key: 'tenure', label: 'Tenure (months)', sql: 't.tenure_months', type: 'num' },
      { key: 'status', label: 'Status', sql: 't.status', type: 'status' },
    ],
    sorts: { created_at: 't.created_at', loan_no: 't.loan_no' },
    defaultSort: '-created_at',
    sortCast: { created_at: 'timestamptz', loan_no: 'text' },
    statusSql: 't.status',
    searchSql: ['t.loan_no', EMP('e')],
    ownerSql: 't.created_by_id',
  },
  'pay-overtime': {
    pageId: 'pay-overtime',
    things: 'overtime entries',
    table: 'ot_entries',
    from: `ot_entries t JOIN employees e ON e.id = t.employee_id`,
    columns: [
      { key: 'employee', label: 'Employee', sql: EMP('e') },
      { key: 'date', label: 'Date', sql: 't.date', type: 'date' },
      { key: 'eligible', label: 'Eligible Hours', sql: 't.eligible_hours', type: 'num' },
      { key: 'approved', label: 'Approved Hours', sql: 't.approved_hours', type: 'num' },
      { key: 'amount', label: 'OT Amount', sql: 't.amount', type: 'money' },
      { key: 'status', label: 'Status', sql: 't.status', type: 'status' },
    ],
    sorts: { date: 't.date', created_at: 't.created_at' },
    defaultSort: '-date',
    sortCast: { date: 'date', created_at: 'timestamptz' },
    statusSql: 't.status',
    searchSql: [EMP('e')],
  },
  'pay-incentive': {
    pageId: 'pay-incentive',
    things: 'incentives',
    table: 'incentive_entries',
    from: `incentive_entries t JOIN employees e ON e.id = t.employee_id JOIN incentive_schemes s ON s.id = t.scheme_id`,
    columns: [
      { key: 'employee', label: 'Employee', sql: EMP('e') },
      { key: 'scheme', label: 'Scheme', sql: 's.name' },
      { key: 'amount', label: 'Approved Amount', sql: 't.amount', type: 'money' },
      { key: 'remarks', label: 'Comments', sql: 't.remarks' },
      { key: 'status', label: 'Status', sql: 't.status', type: 'status' },
    ],
    sorts: { created_at: 't.created_at' },
    defaultSort: '-created_at',
    sortCast: { created_at: 'timestamptz' },
    statusSql: 't.status',
    searchSql: [EMP('e'), 's.name'],
  },
  'proj-budget': {
    pageId: 'proj-budget',
    things: 'project budgets',
    table: 'project_budgets',
    from: `project_budgets t JOIN projects p ON p.id = t.project_id`,
    columns: [
      { key: 'project', label: 'Project', sql: `p.code || ' · ' || p.name` },
      { key: 'version', label: 'Version', sql: 't.version', type: 'num' },
      { key: 'budget', label: 'Budget', sql: 't.total_budget', type: 'money' },
      { key: 'status', label: 'Status', sql: 't.status', type: 'status' },
    ],
    sorts: { created_at: 't.created_at', project: 'p.code' },
    defaultSort: '-created_at',
    sortCast: { created_at: 'timestamptz', project: 'text' },
    statusSql: 't.status',
    searchSql: ['p.code', 'p.name'],
    unitSql: 'p.unit_id',
    ownerSql: 't.created_by_id',
  },
  'proj-expenses': {
    pageId: 'proj-expenses',
    things: 'project expenses',
    table: 'project_expenses',
    from: `project_expenses t JOIN projects p ON p.id = t.project_id`,
    columns: [
      { key: 'expenseNo', label: 'Expense No', sql: 't.expense_no' },
      { key: 'project', label: 'Project', sql: `p.code || ' · ' || p.name` },
      { key: 'date', label: 'Date', sql: 't.date', type: 'date' },
      { key: 'amount', label: 'Amount', sql: 't.total_amount', type: 'money' },
      { key: 'status', label: 'Status', sql: 't.status', type: 'status' },
    ],
    sorts: { date: 't.date', created_at: 't.created_at' },
    defaultSort: '-date',
    sortCast: { date: 'date', created_at: 'timestamptz' },
    statusSql: 't.status',
    searchSql: ['t.expense_no', 'p.code', 'p.name'],
    unitSql: 'p.unit_id',
    ownerSql: 't.created_by_id',
  },
  'proj-milestones': {
    pageId: 'proj-milestones',
    things: 'milestones',
    table: 'project_milestones',
    from: `project_milestones t JOIN projects p ON p.id = t.project_id`,
    columns: [
      { key: 'project', label: 'Project', sql: `p.code || ' · ' || p.name` },
      { key: 'name', label: 'Milestone', sql: 't.name' },
      { key: 'target', label: 'Target Date', sql: 't.target_date', type: 'date' },
      { key: 'actual', label: 'Actual Date', sql: 't.actual_date', type: 'date' },
      { key: 'criteria', label: 'Acceptance Criteria', sql: 't.acceptance_criteria' },
      { key: 'status', label: 'Status', sql: 't.status', type: 'status' },
    ],
    sorts: { target_date: 't.target_date', created_at: 't.created_at' },
    defaultSort: 'target_date',
    sortCast: { target_date: 'date', created_at: 'timestamptz' },
    statusSql: 't.status',
    searchSql: ['t.name', 'p.code', 'p.name'],
    unitSql: 'p.unit_id',
  },
  'proj-subtasks': {
    pageId: 'proj-subtasks',
    things: 'subtasks',
    table: 'project_tasks',
    from: `project_tasks t JOIN projects p ON p.id = t.project_id JOIN project_tasks par ON par.id = t.parent_task_id`,
    columns: [
      { key: 'number', label: 'Subtask No', sql: 't.number' },
      { key: 'parent', label: 'Parent Task', sql: `par.number || ' · ' || par.name` },
      { key: 'name', label: 'Subtask', sql: 't.name' },
      { key: 'due', label: 'Due Date', sql: 't.planned_end', type: 'date' },
      { key: 'est', label: 'Estimated Hrs', sql: 't.estimated_hrs', type: 'num' },
      { key: 'act', label: 'Actual Hrs', sql: 't.actual_hrs', type: 'num' },
      { key: 'progress', label: 'Progress %', sql: 't.progress_pct', type: 'pct' },
      { key: 'status', label: 'Status', sql: 't.status', type: 'status' },
    ],
    sorts: { planned_end: "coalesce(t.planned_end, DATE '1900-01-01')", created_at: 't.created_at' },
    defaultSort: 'planned_end',
    sortCast: { planned_end: 'date', created_at: 'timestamptz' },
    statusSql: 't.status',
    searchSql: ['t.number', 't.name', 'par.name', 'p.code'],
    unitSql: 'p.unit_id',
  },
  'proj-team': {
    pageId: 'proj-team',
    things: 'team assignments',
    table: 'project_team',
    from: `project_team t JOIN projects p ON p.id = t.project_id JOIN employees e ON e.id = t.employee_id`,
    columns: [
      { key: 'project', label: 'Project', sql: `p.code || ' · ' || p.name` },
      { key: 'employee', label: 'Employee', sql: EMP('e') },
      { key: 'role', label: 'Role', sql: 't.role' },
      { key: 'alloc', label: 'Allocation %', sql: 't.allocation_pct', type: 'pct' },
      { key: 'from', label: 'From Date', sql: 't.start_date', type: 'date' },
      { key: 'to', label: 'To Date', sql: 't.end_date', type: 'date' },
      { key: 'billable', label: 'Billable', sql: 't.billable', type: 'bool' },
      { key: 'cost', label: 'Hourly Cost', sql: 't.cost_rate', type: 'money' },
    ],
    sorts: { created_at: 't.created_at', project: 'p.code' },
    defaultSort: '-created_at',
    sortCast: { created_at: 'timestamptz', project: 'text' },
    statusSql: null,
    searchSql: [EMP('e'), 'p.code', 'p.name', 't.role'],
    unitSql: 'p.unit_id',
  },
  'sales-pricelist': {
    pageId: 'sales-pricelist',
    things: 'price lists',
    table: 'price_lists',
    from: `price_lists t LEFT JOIN customers cu ON cu.id = t.customer_id`,
    baseWhere: 't.deleted_at IS NULL',
    columns: [
      { key: 'code', label: 'Price List Code', sql: 't.code' },
      { key: 'name', label: 'Price List Name', sql: 't.name' },
      { key: 'customer', label: 'Customer Segment', sql: 'cu.name' },
      { key: 'currency', label: 'Currency', sql: 't.currency_code' },
      { key: 'from', label: 'Effective From', sql: 't.valid_from', type: 'date' },
      { key: 'to', label: 'Effective To', sql: 't.valid_to', type: 'date' },
      { key: 'status', label: 'Status', sql: 't.status', type: 'status' },
    ],
    sorts: { created_at: 't.created_at', code: 't.code' },
    defaultSort: '-created_at',
    sortCast: { created_at: 'timestamptz', code: 'text' },
    statusSql: 't.status',
    searchSql: ['t.code', 't.name', 'cu.name'],
    ownerSql: 't.created_by_id',
  },
  'scm-approval': {
    pageId: 'scm-approval',
    things: 'purchase approvals',
    table: 'approval_requests',
    from: `approval_requests t`,
    baseWhere: `t.doc_type LIKE 'scm-%'`,
    columns: [
      { key: 'docType', label: 'Transaction Type', sql: 't.doc_type' },
      { key: 'docNo', label: 'Document No', sql: 't.doc_code' },
      { key: 'title', label: 'Comments', sql: 't.doc_title' },
      { key: 'amount', label: 'Amount', sql: 't.amount', type: 'money' },
      { key: 'level', label: 'Current Level', sql: `t.current_level || ' of ' || t.total_levels` },
      { key: 'submitted', label: 'Submitted At', sql: 't.requested_at', type: 'datetime' },
      { key: 'status', label: 'Status', sql: 't.status', type: 'status' },
    ],
    sorts: { requested_at: 't.requested_at' },
    defaultSort: '-requested_at',
    sortCast: { requested_at: 'timestamptz' },
    statusSql: 't.status',
    searchSql: ['t.doc_code', 't.doc_title', 't.doc_type'],
    unitSql: 't.unit_id',
    ownerSql: 't.requested_by',
  },
  'service-history': {
    pageId: 'service-history',
    things: 'service events',
    table: 'service_history',
    from: `service_history t LEFT JOIN customers cu ON cu.id = t.customer_id`,
    columns: [
      { key: 'ref', label: 'History Ref', sql: 't.ref_no' },
      { key: 'customer', label: 'Customer', sql: 'cu.name' },
      { key: 'type', label: 'Event Type', sql: 't.record_type' },
      { key: 'date', label: 'Date', sql: 't.event_date', type: 'datetime' },
      { key: 'summary', label: 'Issue', sql: 't.summary' },
      { key: 'status', label: 'Status', sql: 't.status', type: 'status' },
    ],
    sorts: { event_date: 't.event_date' },
    defaultSort: '-event_date',
    sortCast: { event_date: 'timestamptz' },
    statusSql: 't.status',
    searchSql: ['t.ref_no', 'cu.name', 't.summary'],
  },
  'service-requests': {
    pageId: 'service-requests',
    things: 'service requests',
    table: 'service_requests',
    from: `service_requests t LEFT JOIN customers cu ON cu.id = t.customer_id`,
    columns: [
      { key: 'no', label: 'Request No', sql: 't.request_no' },
      { key: 'customer', label: 'Customer', sql: 'cu.name' },
      { key: 'type', label: 'Request Type', sql: 't.request_type' },
      { key: 'estimate', label: 'Estimate', sql: 't.estimate_amount', type: 'money' },
      { key: 'approval', label: 'Approval', sql: 't.approval_status' },
      { key: 'created', label: 'Requested Date', sql: 't.created_at', type: 'datetime' },
    ],
    sorts: { created_at: 't.created_at', request_no: 't.request_no' },
    defaultSort: '-created_at',
    sortCast: { created_at: 'timestamptz', request_no: 'text' },
    statusSql: 't.approval_status',
    searchSql: ['t.request_no', 'cu.name', 't.request_type'],
  },
  'service-spares': {
    pageId: 'service-spares',
    things: 'spare issues',
    table: 'spare_issues',
    from: `spare_issues t`,
    columns: [
      { key: 'no', label: 'Issue No', sql: 't.issue_no' },
      { key: 'cost', label: 'Value', sql: 't.total_cost', type: 'money' },
      { key: 'chargeable', label: 'Chargeable', sql: 't.chargeable', type: 'bool' },
      { key: 'created', label: 'Issued On', sql: 't.created_at', type: 'datetime' },
      { key: 'status', label: 'Status', sql: 't.status', type: 'status' },
    ],
    sorts: { created_at: 't.created_at', issue_no: 't.issue_no' },
    defaultSort: '-created_at',
    sortCast: { created_at: 'timestamptz', issue_no: 'text' },
    statusSql: 't.status',
    searchSql: ['t.issue_no'],
  },
  'tax-gst': {
    pageId: 'tax-gst',
    things: 'GST rates',
    table: 'gst_rates',
    from: `gst_rates t`,
    baseWhere: 't.deleted_at IS NULL',
    columns: [
      { key: 'code', label: 'GST Rate', sql: 't.code' },
      { key: 'name', label: 'Legal Name', sql: 't.name' },
      { key: 'kind', label: 'Registration Type', sql: 't.kind' },
      { key: 'igst', label: 'IGST %', sql: 't.igst_pct', type: 'pct' },
      { key: 'cgst', label: 'CGST %', sql: 't.cgst_pct', type: 'pct' },
      { key: 'sgst', label: 'SGST %', sql: 't.sgst_pct', type: 'pct' },
      { key: 'from', label: 'Effective Date', sql: 't.effective_from', type: 'date' },
      { key: 'review', label: 'Needs Review', sql: 't.needs_review', type: 'bool' },
      { key: 'status', label: 'Status', sql: 't.status', type: 'status' },
    ],
    sorts: { effective_from: 't.effective_from', code: 't.code' },
    defaultSort: '-effective_from',
    sortCast: { effective_from: 'date', code: 'text' },
    statusSql: 't.status',
    searchSql: ['t.code', 't.name'],
    ownerSql: 't.created_by_id',
  },
  'tax-hsn': {
    pageId: 'tax-hsn',
    things: 'HSN / SAC codes',
    table: 'hsn_sac_codes',
    from: `hsn_sac_codes t`,
    baseWhere: 't.deleted_at IS NULL',
    columns: [
      { key: 'code', label: 'HSN SAC', sql: 't.code' },
      { key: 'desc', label: 'Description', sql: 't.description' },
      { key: 'kind', label: 'Goods Service', sql: `CASE WHEN t.is_service THEN 'Service' ELSE 'Goods' END` },
      { key: 'uqc', label: 'UQC', sql: 't.default_uqc' },
      { key: 'review', label: 'Needs Review', sql: 't.needs_review', type: 'bool' },
      { key: 'status', label: 'Status', sql: 't.status', type: 'status' },
    ],
    sorts: { code: 't.code', created_at: 't.created_at' },
    defaultSort: 'code',
    sortCast: { code: 'text', created_at: 'timestamptz' },
    statusSql: 't.status',
    searchSql: ['t.code', 't.description'],
    ownerSql: 't.created_by_id',
  },
  'wms-transfer': {
    pageId: 'wms-transfer',
    things: 'warehouse transfers',
    table: 'stock_vouchers',
    from: `stock_vouchers t LEFT JOIN warehouses sw ON sw.id = t.warehouse_id LEFT JOIN warehouses dw ON dw.id = t.to_warehouse_id`,
    baseWhere: `t.kind = 'TRANSFER' AND t.deleted_at IS NULL`,
    columns: [
      { key: 'no', label: 'WMS Transfer No', sql: 't.number' },
      { key: 'source', label: 'Source Warehouse', sql: 'sw.name' },
      { key: 'dest', label: 'Destination', sql: 'dw.name' },
      { key: 'qty', label: 'In Transit Qty', sql: 'coalesce(t.dispatched_qty, t.total_qty)', type: 'num' },
      { key: 'received', label: 'Received Qty', sql: 't.received_qty', type: 'num' },
      { key: 'expected', label: 'Expected Date', sql: 't.expected_receipt', type: 'date' },
      { key: 'date', label: 'Posting Date', sql: 't.posting_date', type: 'date' },
      { key: 'status', label: 'Status', sql: 't.status', type: 'status' },
    ],
    sorts: { posting_date: 't.posting_date', number: 't.number' },
    defaultSort: '-posting_date',
    sortCast: { posting_date: 'date', number: 'text' },
    statusSql: 't.status',
    searchSql: ['t.number', 'sw.name', 'dw.name'],
    unitSql: 't.unit_id',
    ownerSql: 't.created_by_id',
  },
};

Object.assign(SCREENS, WMS_SCREENS);
attachForms(SCREENS);
export const SCREEN_PAGE_IDS = Object.keys(SCREENS);
