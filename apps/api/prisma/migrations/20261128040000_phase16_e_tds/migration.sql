-- Phase 16 Part E: TDS Declarations & Computations

CREATE TABLE "tax_declarations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
  "financial_year" varchar(10) NOT NULL,
  "regime" varchar(10) NOT NULL DEFAULT 'NEW',
  "locked" boolean NOT NULL DEFAULT false,
  "locked_at" timestamptz(3),
  "submitted_at" timestamptz(3),
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "td_regime_chk" CHECK ("regime" IN ('NEW','OLD')),
  CONSTRAINT "td_emp_fy_unique" UNIQUE ("employee_id", "financial_year")
);

CREATE TABLE "tax_declaration_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "declaration_id" uuid NOT NULL REFERENCES "tax_declarations"("id") ON DELETE CASCADE,
  "section" varchar(40) NOT NULL,
  "description" text,
  "declared_amount" numeric(18,2) NOT NULL DEFAULT 0,
  "proof_doc_id" uuid REFERENCES "stored_files"("id") ON DELETE SET NULL,
  "verified_amount" numeric(18,2),
  "verification_status" varchar(20) NOT NULL DEFAULT 'PENDING',
  "verified_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "verified_at" timestamptz(3),
  "remarks" text,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "tdi_status_chk" CHECK ("verification_status" IN ('PENDING','VERIFIED','REJECTED'))
);

CREATE TABLE "previous_employer_incomes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
  "financial_year" varchar(10) NOT NULL,
  "gross_income" numeric(18,2) NOT NULL DEFAULT 0,
  "pf_amount" numeric(18,2) NOT NULL DEFAULT 0,
  "pt_amount" numeric(18,2) NOT NULL DEFAULT 0,
  "tds_deducted" numeric(18,2) NOT NULL DEFAULT 0,
  "form12b_doc_id" uuid REFERENCES "stored_files"("id") ON DELETE SET NULL,
  "verified" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "pei_emp_fy_unique" UNIQUE ("employee_id", "financial_year")
);

CREATE TABLE "tds_computations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "run_id" uuid NOT NULL REFERENCES "payroll_runs"("id") ON DELETE CASCADE,
  "employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE RESTRICT,
  "financial_year" varchar(10) NOT NULL,
  "regime" varchar(10) NOT NULL DEFAULT 'NEW',
  "projected_gross" numeric(18,2) NOT NULL,
  "exemptions" numeric(18,2) NOT NULL DEFAULT 0,
  "std_deduction" numeric(18,2) NOT NULL DEFAULT 75000,
  "taxable_income" numeric(18,2) NOT NULL,
  "gross_tax" numeric(18,2) NOT NULL,
  "rebate" numeric(18,2) NOT NULL DEFAULT 0,
  "tax_after_rebate" numeric(18,2) NOT NULL,
  "surcharge" numeric(18,2) NOT NULL DEFAULT 0,
  "cess" numeric(18,2) NOT NULL DEFAULT 0,
  "annual_tax" numeric(18,2) NOT NULL,
  "tds_to_date" numeric(18,2) NOT NULL DEFAULT 0,
  "months_remaining" integer NOT NULL,
  "current_tds" numeric(18,2) NOT NULL DEFAULT 0,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "tc_run_emp_unique" UNIQUE ("run_id", "employee_id")
);

CREATE INDEX "idx_tds_comp_run" ON "tds_computations"("run_id");
CREATE INDEX "idx_tds_comp_emp" ON "tds_computations"("employee_id", "financial_year");

