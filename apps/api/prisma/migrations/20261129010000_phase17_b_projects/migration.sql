-- Phase 17 Part B: Customer Projects, Tasks, Milestones, Team, Timesheets, Budgets, EVM

CREATE TABLE "projects" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" varchar(50) NOT NULL UNIQUE,
  "name" varchar(150) NOT NULL,
  "customer_id" uuid REFERENCES "customers"("id") ON DELETE RESTRICT,
  "project_manager_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "cost_center_id" uuid REFERENCES "cost_centers"("id") ON DELETE SET NULL,
  "profit_center_id" uuid REFERENCES "profit_centers"("id") ON DELETE SET NULL,
  "project_type" varchar(30) NOT NULL DEFAULT 'CUSTOMER',
  "billing_method" varchar(30) NOT NULL DEFAULT 'FIXED_MILESTONE',
  "contract_value" numeric(18,2) NOT NULL DEFAULT 0,
  "start_date" date NOT NULL,
  "end_date" date NOT NULL,
  "baseline_set_at" timestamptz(3),
  "status" varchar(30) NOT NULL DEFAULT 'DRAFT',
  "health" varchar(20) NOT NULL DEFAULT 'GREEN',
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "prj_type_chk" CHECK ("project_type" IN ('CUSTOMER','INTERNAL','CAPEX')),
  CONSTRAINT "prj_billing_chk" CHECK ("billing_method" IN ('FIXED_MILESTONE','TIME_MATERIAL','NON_BILLABLE')),
  CONSTRAINT "prj_status_chk" CHECK ("status" IN ('DRAFT','PLANNED','ACTIVE','ON_HOLD','COMPLETED','CLOSED')),
  CONSTRAINT "prj_health_chk" CHECK ("health" IN ('GREEN','AMBER','RED')),
  CONSTRAINT "prj_dates_chk" CHECK ("end_date" >= "start_date")
);

-- Link journal_lines & gl_entries foreign keys
ALTER TABLE "journal_lines" ADD CONSTRAINT "fk_jl_project" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL;
ALTER TABLE "gl_entries" ADD CONSTRAINT "fk_gl_project" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL;

CREATE TABLE "project_tasks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "parent_task_id" uuid REFERENCES "project_tasks"("id") ON DELETE CASCADE,
  "number" varchar(30) NOT NULL,
  "name" varchar(150) NOT NULL,
  "owner_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "priority" varchar(10) NOT NULL DEFAULT 'P3',
  "planned_start" date NOT NULL,
  "planned_end" date NOT NULL,
  "duration_days" numeric(6,2) NOT NULL DEFAULT 1,
  "baseline_start" date,
  "baseline_end" date,
  "estimated_hrs" numeric(8,2) NOT NULL DEFAULT 0,
  "actual_hrs" numeric(8,2) NOT NULL DEFAULT 0,
  "weight" numeric(5,2) NOT NULL DEFAULT 1,
  "progress_pct" numeric(5,2) NOT NULL DEFAULT 0,
  "kanban_column" varchar(30) NOT NULL DEFAULT 'BACKLOG',
  "kanban_rank" integer NOT NULL DEFAULT 100,
  "is_milestone" boolean NOT NULL DEFAULT false,
  "evidence_doc_id" uuid REFERENCES "stored_files"("id") ON DELETE SET NULL,
  "status" varchar(30) NOT NULL DEFAULT 'OPEN',
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "pt_priority_chk" CHECK ("priority" IN ('P1','P2','P3','P4')),
  CONSTRAINT "pt_status_chk" CHECK ("status" IN ('OPEN','IN_PROGRESS','REVIEW','DONE','CANCELLED')),
  CONSTRAINT "pt_dates_chk" CHECK ("planned_end" >= "planned_start")
);

CREATE TABLE "task_dependencies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "predecessor_id" uuid NOT NULL REFERENCES "project_tasks"("id") ON DELETE CASCADE,
  "successor_id" uuid NOT NULL REFERENCES "project_tasks"("id") ON DELETE CASCADE,
  "type" varchar(10) NOT NULL DEFAULT 'FS',
  "lag_days" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "td_not_self_chk" CHECK ("predecessor_id" != "successor_id"),
  CONSTRAINT "td_type_chk" CHECK ("type" IN ('FS','SS','FF','SF')),
  CONSTRAINT "td_unique" UNIQUE ("predecessor_id", "successor_id")
);

CREATE TABLE "project_milestones" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "name" varchar(150) NOT NULL,
  "target_date" date NOT NULL,
  "actual_date" date,
  "acceptance_criteria" text,
  "owner_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "linked_task_id" uuid REFERENCES "project_tasks"("id") ON DELETE SET NULL,
  "is_billing" boolean NOT NULL DEFAULT false,
  "billing_pct" numeric(5,2),
  "billing_amount" numeric(18,2),
  "sales_invoice_id" uuid REFERENCES "sales_invoices"("id") ON DELETE SET NULL,
  "status" varchar(30) NOT NULL DEFAULT 'PLANNED',
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "pm_status_chk" CHECK ("status" IN ('PLANNED','ACHIEVED','ACCEPTED','INVOICED'))
);

CREATE TABLE "project_team" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE RESTRICT,
  "role" varchar(30) NOT NULL DEFAULT 'ENGINEER',
  "allocation_pct" numeric(5,2) NOT NULL DEFAULT 100,
  "start_date" date NOT NULL,
  "end_date" date,
  "billable" boolean NOT NULL DEFAULT true,
  "bill_rate" numeric(18,2) NOT NULL DEFAULT 0,
  "cost_rate" numeric(18,2) NOT NULL DEFAULT 0,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "ptm_role_chk" CHECK ("role" IN ('PM','ENGINEER','TECHNICIAN','QA','VIEWER')),
  CONSTRAINT "ptm_unique" UNIQUE ("project_id", "employee_id")
);

CREATE TABLE "timesheets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "timesheet_no" varchar(50) NOT NULL UNIQUE,
  "employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE RESTRICT,
  "week_start" date NOT NULL,
  "total_hours" numeric(6,2) NOT NULL DEFAULT 0,
  "approver_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "approved_at" timestamptz(3),
  "rejection_reason" text,
  "status" varchar(30) NOT NULL DEFAULT 'DRAFT',
  "journal_id" uuid REFERENCES "journals"("id") ON DELETE SET NULL,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "ts_status_chk" CHECK ("status" IN ('DRAFT','SUBMITTED','APPROVED','REJECTED','POSTED')),
  CONSTRAINT "ts_emp_week_unique" UNIQUE ("employee_id", "week_start")
);

CREATE TABLE "timesheet_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "timesheet_id" uuid NOT NULL REFERENCES "timesheets"("id") ON DELETE CASCADE,
  "work_date" date NOT NULL,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE RESTRICT,
  "task_id" uuid REFERENCES "project_tasks"("id") ON DELETE SET NULL,
  "hours" numeric(4,2) NOT NULL,
  "billable_hours" numeric(4,2) NOT NULL DEFAULT 0,
  "description" text,
  "cost_rate" numeric(18,2) NOT NULL DEFAULT 0,
  "cost_amount" numeric(18,2) NOT NULL DEFAULT 0,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "tsl_hours_chk" CHECK ("hours" > 0 AND "hours" <= 24)
);

CREATE TABLE "project_expenses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "expense_no" varchar(50) NOT NULL UNIQUE,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE RESTRICT,
  "date" date NOT NULL,
  "payee_employee_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "total_amount" numeric(18,2) NOT NULL DEFAULT 0,
  "total_tax" numeric(18,2) NOT NULL DEFAULT 0,
  "status" varchar(30) NOT NULL DEFAULT 'DRAFT',
  "journal_id" uuid REFERENCES "journals"("id") ON DELETE SET NULL,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "pex_status_chk" CHECK ("status" IN ('DRAFT','SUBMITTED','APPROVED','REJECTED','POSTED'))
);

CREATE TABLE "project_expense_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_expense_id" uuid NOT NULL REFERENCES "project_expenses"("id") ON DELETE CASCADE,
  "date" date NOT NULL,
  "cost_head" varchar(30) NOT NULL,
  "description" text NOT NULL,
  "amount" numeric(18,2) NOT NULL,
  "tax" numeric(18,2) NOT NULL DEFAULT 0,
  "billable" boolean NOT NULL DEFAULT false,
  "receipt_doc_id" uuid REFERENCES "stored_files"("id") ON DELETE SET NULL,
  CONSTRAINT "pel_cost_head_chk" CHECK ("cost_head" IN ('LABOUR','MATERIAL','SUBCONTRACT','TRAVEL','EXPENSE','OVERHEAD'))
);

CREATE TABLE "project_budgets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "version" integer NOT NULL DEFAULT 1,
  "total_budget" numeric(18,2) NOT NULL DEFAULT 0,
  "status" varchar(30) NOT NULL DEFAULT 'DRAFT',
  "approved_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "approved_at" timestamptz(3),
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "pb_status_chk" CHECK ("status" IN ('DRAFT','PENDING','APPROVED','SUPERSEDED'))
);

CREATE TABLE "project_budget_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "budget_id" uuid NOT NULL REFERENCES "project_budgets"("id") ON DELETE CASCADE,
  "cost_head" varchar(30) NOT NULL,
  "account_id" uuid REFERENCES "accounts"("id") ON DELETE SET NULL,
  "amount" numeric(18,2) NOT NULL DEFAULT 0,
  CONSTRAINT "pbl_cost_head_chk" CHECK ("cost_head" IN ('LABOUR','MATERIAL','SUBCONTRACT','TRAVEL','EXPENSE','OVERHEAD'))
);

CREATE TABLE "project_evm_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "as_of" date NOT NULL,
  "bac" numeric(18,2) NOT NULL,
  "pv" numeric(18,2) NOT NULL,
  "ev" numeric(18,2) NOT NULL,
  "ac" numeric(18,2) NOT NULL,
  "cpi" numeric(7,4) NOT NULL,
  "spi" numeric(7,4) NOT NULL,
  "eac" numeric(18,2) NOT NULL,
  "etc" numeric(18,2) NOT NULL,
  "vac" numeric(18,2) NOT NULL,
  "tcpi" numeric(7,4) NOT NULL,
  "health" varchar(20) NOT NULL DEFAULT 'GREEN',
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "pes_unique" UNIQUE ("project_id", "as_of")
);

CREATE INDEX "idx_prj_unit" ON "projects"("unit_id", "status");
CREATE INDEX "idx_prj_tasks_project" ON "project_tasks"("project_id");
CREATE INDEX "idx_ts_employee" ON "timesheets"("employee_id", "status");
CREATE INDEX "idx_tsl_project" ON "timesheet_lines"("project_id", "work_date");
