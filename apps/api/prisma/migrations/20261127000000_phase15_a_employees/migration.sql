-- Phase 15 Part A: Core Employee & Organization Models
-- Seed statutory rules from §3 (all needs_review = true, with source_url).

CREATE TABLE "hr_statutory_rules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "law_basis_code" varchar(30) NOT NULL,
  "rule_key" varchar(40) NOT NULL,
  "value_text" varchar(100),
  "value_num" numeric(18,4),
  "unit" varchar(20),
  "effective_from" date NOT NULL,
  "effective_to" date,
  "source_url" text NOT NULL,
  "needs_review" boolean NOT NULL DEFAULT true,
  "verified_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "verified_at" timestamptz(3),
  "created_at" timestamptz(3) NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "hr_stat_rules_uq" ON "hr_statutory_rules"("law_basis_code", "rule_key", "effective_from");

-- Seed rows (needs_review = true)
INSERT INTO "hr_statutory_rules" ("law_basis_code", "rule_key", "value_text", "value_num", "unit", "effective_from", "source_url", "needs_review") VALUES
  ('FACTORIES_ACT', 'MAX_DAILY_MIN', NULL, 540, 'MINUTES', '2026-01-01', 'https://labour.gov.in/factories-act-1948', true),
  ('FACTORIES_ACT', 'MAX_WEEKLY_MIN', NULL, 2880, 'MINUTES', '2026-01-01', 'https://labour.gov.in/factories-act-1948', true),
  ('FACTORIES_ACT', 'REST_AFTER_MIN', NULL, 300, 'MINUTES', '2026-01-01', 'https://labour.gov.in/factories-act-1948', true),
  ('FACTORIES_ACT', 'SPREAD_OVER_MIN', NULL, 630, 'MINUTES', '2026-01-01', 'https://labour.gov.in/factories-act-1948', true),
  ('FACTORIES_ACT', 'OT_MULTIPLIER', NULL, 2.0, 'RATIO', '2026-01-01', 'https://labour.gov.in/factories-act-1948', true),
  ('FACTORIES_ACT', 'OT_QUARTER_CAP_MIN', NULL, 6900, 'MINUTES', '2026-01-01', 'https://labour.gov.in/factories-act-1948', true),
  ('FACTORIES_ACT', 'EL_DAYS_PER_WORKED', NULL, 20, 'DAYS', '2026-01-01', 'https://labour.gov.in/factories-act-1948', true),
  ('OSH_CODE', 'EL_ELIGIBILITY_DAYS', NULL, 180, 'DAYS', '2025-11-21', 'https://labour.gov.in/labour-codes', true),
  ('FACTORIES_ACT', 'EL_CARRY_CAP', NULL, 30, 'DAYS', '2026-01-01', 'https://labour.gov.in/factories-act-1948', true),
  ('MH_SE_2017', 'CASUAL_LEAVE_ANNUAL', NULL, 8, 'DAYS', '2026-01-01', 'https://mahakamgar.maharashtra.gov.in', true),
  ('CODE_ON_WAGES', 'FNF_DUE_WORKING_DAYS', NULL, 2, 'DAYS', '2025-11-21', 'https://labour.gov.in/wage-code-2019', true),
  ('MATERNITY_BENEFIT', 'MATERNITY_WEEKS', NULL, 26, 'WEEKS', '2026-01-01', 'https://labour.gov.in/maternity-benefit-act-1961', true);

CREATE TABLE "employees" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "emp_code" varchar(30) NOT NULL UNIQUE,
  "user_id" uuid UNIQUE REFERENCES "users"("id") ON DELETE SET NULL,
  "first_name" varchar(60) NOT NULL,
  "middle_name" varchar(60),
  "last_name" varchar(60) NOT NULL,
  "gender" varchar(10) NOT NULL,
  "dob" date NOT NULL,
  "marital_status" varchar(20),
  "mobile" varchar(20) NOT NULL,
  "personal_email" varchar(120),
  "official_email" varchar(120),
  "photo_document_id" uuid,
  "employment_type_code" varchar(30) NOT NULL DEFAULT 'PERMANENT',
  "worker_category" varchar(20) NOT NULL DEFAULT 'STAFF',
  "joining_date" date NOT NULL,
  "confirmation_date" date,
  "probation_end" date,
  "lwd" date,
  "status" varchar(20) NOT NULL DEFAULT 'ACTIVE',
  "biometric_code" varchar(40) UNIQUE,
  "pan" varchar(10),
  "aadhaar_last4" varchar(4),
  "uan" varchar(20),
  "esic_ip" varchar(20),
  "pf_applicable" boolean NOT NULL DEFAULT true,
  "esic_applicable" boolean NOT NULL DEFAULT false,
  "blood_group" varchar(10),
  "present_address" jsonb,
  "permanent_address" jsonb,
  "notice_days" integer NOT NULL DEFAULT 30,
  "law_basis_code" varchar(30) NOT NULL DEFAULT 'FACTORIES_ACT',
  "contractor_name" varchar(100),
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "deleted_at" timestamptz(3),
  "deleted_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "emp_worker_cat_chk" CHECK ("worker_category" IN ('WORKER','STAFF')),
  CONSTRAINT "emp_status_chk" CHECK ("status" IN ('ACTIVE','ON_NOTICE','SEPARATED','ABSCONDING'))
);
CREATE UNIQUE INDEX "emp_mobile_active_uq" ON "employees"("mobile") WHERE "status" = 'ACTIVE' AND "deleted_at" IS NULL;

-- Vault for encrypted Aadhaar (only place full Aadhaar exists)
CREATE TABLE "employee_identity_vault" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "employee_id" uuid NOT NULL UNIQUE REFERENCES "employees"("id") ON DELETE CASCADE,
  "aadhaar_enc" text NOT NULL,
  "ref_key" varchar(64),
  "key_version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL
);

CREATE TABLE "employee_bank_accounts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
  "bank_name" varchar(100) NOT NULL,
  "branch_name" varchar(100),
  "ifsc" varchar(11) NOT NULL,
  "account_enc" text NOT NULL,
  "last4" varchar(4) NOT NULL,
  "is_primary" boolean NOT NULL DEFAULT true,
  "verified_at" timestamptz(3),
  "effective_from" date NOT NULL,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL
);

CREATE TABLE "employee_emergency_contacts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
  "name" varchar(100) NOT NULL,
  "relationship" varchar(50) NOT NULL,
  "mobile" varchar(20) NOT NULL,
  "alternate_phone" varchar(20),
  "created_at" timestamptz(3) NOT NULL DEFAULT now()
);

CREATE TABLE "employee_family" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
  "name" varchar(100) NOT NULL,
  "relationship" varchar(50) NOT NULL,
  "dob" date,
  "is_nominee" boolean NOT NULL DEFAULT false,
  "pf_nominee_pct" numeric(5,2),
  "gratuity_nominee_pct" numeric(5,2),
  "created_at" timestamptz(3) NOT NULL DEFAULT now()
);

CREATE TABLE "employee_assignments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
  "effective_from" date NOT NULL,
  "effective_to" date,
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "department" varchar(60) NOT NULL,
  "designation_id" uuid REFERENCES "designations"("id") ON DELETE SET NULL,
  "cost_centre" varchar(60),
  "reporting_manager_employee_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "grade" varchar(20),
  "reason" varchar(30) NOT NULL DEFAULT 'JOIN',
  "remarks" varchar(300),
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "emp_asgn_reason_chk" CHECK ("reason" IN ('JOIN','TRANSFER','PROMOTION','REDESIGNATION','MANAGER_CHANGE'))
);
CREATE INDEX "emp_asgn_emp_dates_idx" ON "employee_assignments"("employee_id", "effective_from");

CREATE TABLE "pii_access_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
  "field" varchar(40) NOT NULL,
  "purpose" varchar(300) NOT NULL,
  "ip" varchar(64),
  "accessed_at" timestamptz(3) NOT NULL DEFAULT now()
);

