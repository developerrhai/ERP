-- Phase 16 Part D: Statutory (ESIC, Bonus), Loans, OT, Incentives

CREATE TABLE "esic_contribution_periods" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
  "period_start" date NOT NULL,
  "period_end" date NOT NULL,
  "covered" boolean NOT NULL,
  "decided_on_wage" numeric(18,2) NOT NULL,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "ecp_emp_period_unique" UNIQUE ("employee_id", "period_start")
);

CREATE TABLE "employee_loans" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "loan_no" varchar(50) NOT NULL UNIQUE,
  "employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE RESTRICT,
  "principal_amount" numeric(18,2) NOT NULL,
  "interest_rate" numeric(5,2) NOT NULL DEFAULT 0,
  "emi_amount" numeric(18,2) NOT NULL,
  "tenure_months" integer NOT NULL,
  "disbursed_date" date NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'ACTIVE',
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "el_status_chk" CHECK ("status" IN ('ACTIVE','CLOSED','PAUSED'))
);

CREATE TABLE "loan_schedules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "loan_id" uuid NOT NULL REFERENCES "employee_loans"("id") ON DELETE CASCADE,
  "instalment_no" integer NOT NULL,
  "due_period_id" uuid REFERENCES "payroll_periods"("id") ON DELETE SET NULL,
  "due_date" date NOT NULL,
  "principal_component" numeric(18,2) NOT NULL,
  "interest_component" numeric(18,2) NOT NULL DEFAULT 0,
  "total_amount" numeric(18,2) NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'PENDING',
  "payroll_run_id" uuid REFERENCES "payroll_runs"("id") ON DELETE SET NULL,
  "deducted_at" timestamptz(3),
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "ls_status_chk" CHECK ("status" IN ('PENDING','DEDUCTED','DEFERRED','WAIVED'))
);

CREATE TABLE "ot_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE RESTRICT,
  "date" date NOT NULL,
  "shift_id" uuid REFERENCES "shifts"("id") ON DELETE SET NULL,
  "eligible_hours" numeric(5,2) NOT NULL,
  "approved_hours" numeric(5,2) NOT NULL,
  "multiplier_row_id" uuid REFERENCES "statutory_rates"("id") ON DELETE SET NULL,
  "multiplier" numeric(4,2) NOT NULL DEFAULT 2.0,
  "amount" numeric(18,2) NOT NULL DEFAULT 0,
  "status" varchar(20) NOT NULL DEFAULT 'PENDING',
  "approved_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "approved_at" timestamptz(3),
  "period_id" uuid REFERENCES "payroll_periods"("id") ON DELETE SET NULL,
  "run_line_id" uuid REFERENCES "payroll_run_lines"("id") ON DELETE SET NULL,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "ot_status_chk" CHECK ("status" IN ('PENDING','APPROVED','REJECTED','PROCESSED'))
);

CREATE TABLE "incentive_schemes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" varchar(30) NOT NULL UNIQUE,
  "name" varchar(100) NOT NULL,
  "description" text,
  "calc_formula" text,
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz(3) NOT NULL DEFAULT now()
);

CREATE TABLE "incentive_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "scheme_id" uuid REFERENCES "incentive_schemes"("id") ON DELETE SET NULL,
  "employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE RESTRICT,
  "period_id" uuid NOT NULL REFERENCES "payroll_periods"("id") ON DELETE RESTRICT,
  "amount" numeric(18,2) NOT NULL,
  "remarks" text,
  "status" varchar(20) NOT NULL DEFAULT 'APPROVED',
  "approved_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "ie_status_chk" CHECK ("status" IN ('PENDING','APPROVED','PROCESSED'))
);

CREATE TABLE "bonus_accruals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE RESTRICT,
  "period_id" uuid NOT NULL REFERENCES "payroll_periods"("id") ON DELETE RESTRICT,
  "wage_basis" numeric(18,2) NOT NULL,
  "rate" numeric(7,4) NOT NULL DEFAULT 0.0833,
  "amount" numeric(18,2) NOT NULL,
  "payroll_run_id" uuid REFERENCES "payroll_runs"("id") ON DELETE CASCADE,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "ba_unique" UNIQUE ("period_id", "employee_id")
);

CREATE INDEX "idx_ot_emp_date" ON "ot_entries"("employee_id", "date");
CREATE INDEX "idx_loan_sched_due" ON "loan_schedules"("loan_id", "status", "due_date");

