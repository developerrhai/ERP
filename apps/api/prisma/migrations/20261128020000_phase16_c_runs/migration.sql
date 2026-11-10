-- Phase 16 Part C: Payroll Periods, Runs, Run Employees & Run Lines

CREATE TABLE "payroll_periods" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "fiscal_period_id" uuid REFERENCES "financial_year_periods"("id") ON DELETE SET NULL,
  "month" varchar(7) NOT NULL UNIQUE,
  "start_date" date NOT NULL,
  "end_date" date NOT NULL,
  "days_basis" integer NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'OPEN',
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "pp_status_chk" CHECK ("status" IN ('OPEN','CLOSED'))
);

CREATE TABLE "payroll_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "run_no" varchar(50) NOT NULL UNIQUE,
  "period_id" uuid NOT NULL REFERENCES "payroll_periods"("id") ON DELETE RESTRICT,
  "unit_id" uuid REFERENCES "units"("id") ON DELETE RESTRICT,
  "run_type" varchar(20) NOT NULL DEFAULT 'REGULAR',
  "status" varchar(30) NOT NULL DEFAULT 'DRAFT',
  "total_gross" numeric(18,2) NOT NULL DEFAULT 0,
  "total_deductions" numeric(18,2) NOT NULL DEFAULT 0,
  "total_net" numeric(18,2) NOT NULL DEFAULT 0,
  "total_employer_cost" numeric(18,2) NOT NULL DEFAULT 0,
  "employee_count" integer NOT NULL DEFAULT 0,
  "approved_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "approved_at" timestamptz(3),
  "journal_id" uuid REFERENCES "journals"("id") ON DELETE SET NULL,
  "locked_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "locked_at" timestamptz(3),
  "reversal_of_id" uuid REFERENCES "payroll_runs"("id") ON DELETE SET NULL,
  "calc_job_id" varchar(100),
  "input_hash" varchar(64),
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "pr_run_type_chk" CHECK ("run_type" IN ('REGULAR','ARREAR','FNF','BONUS','REVERSAL')),
  CONSTRAINT "pr_status_chk" CHECK ("status" IN ('DRAFT','CALCULATED','PENDING_APPROVAL','APPROVED','LOCKED','POSTED','PAID','CANCELLED'))
);

CREATE UNIQUE INDEX "idx_pr_regular_unique" ON "payroll_runs"("period_id", COALESCE("unit_id", '00000000-0000-0000-0000-000000000000'::uuid)) 
WHERE "run_type" = 'REGULAR' AND "status" != 'CANCELLED';

CREATE TABLE "payroll_run_employees" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "run_id" uuid NOT NULL REFERENCES "payroll_runs"("id") ON DELETE CASCADE,
  "employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE RESTRICT,
  "paid_days" numeric(6,2) NOT NULL DEFAULT 0,
  "lop_days" numeric(6,2) NOT NULL DEFAULT 0,
  "ncp_days" numeric(6,2) NOT NULL DEFAULT 0,
  "gross" numeric(18,2) NOT NULL DEFAULT 0,
  "deductions" numeric(18,2) NOT NULL DEFAULT 0,
  "net" numeric(18,2) NOT NULL DEFAULT 0,
  "employer_cost" numeric(18,2) NOT NULL DEFAULT 0,
  "status" varchar(20) NOT NULL DEFAULT 'OK',
  "messages" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "snapshot" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "pre_status_chk" CHECK ("status" IN ('OK','WARN','ERROR','HELD')),
  CONSTRAINT "pre_unique" UNIQUE ("run_id", "employee_id")
);

CREATE TABLE "payroll_run_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "run_employee_id" uuid NOT NULL REFERENCES "payroll_run_employees"("id") ON DELETE CASCADE,
  "component_id" uuid NOT NULL REFERENCES "pay_components"("id") ON DELETE RESTRICT,
  "amount" numeric(18,2) NOT NULL DEFAULT 0,
  "basis" numeric(18,2),
  "rate" numeric(7,4),
  "rate_row_id" uuid REFERENCES "statutory_rates"("id") ON DELETE SET NULL,
  "source" varchar(20) NOT NULL DEFAULT 'STRUCTURE',
  "note" text,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "prl_source_chk" CHECK ("source" IN ('STRUCTURE','OT','INCENTIVE','LOAN','ARREAR','MANUAL','STATUTORY'))
);

CREATE INDEX "idx_pr_period" ON "payroll_runs"("period_id", "status");
CREATE INDEX "idx_pre_run" ON "payroll_run_employees"("run_id");
CREATE INDEX "idx_pre_employee" ON "payroll_run_employees"("employee_id");
CREATE INDEX "idx_prl_employee" ON "payroll_run_lines"("run_employee_id");

