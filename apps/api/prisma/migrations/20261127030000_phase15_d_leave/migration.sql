-- Phase 15 Part D: Leave Management (Append-only Ledger)

CREATE TABLE "leave_types" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" varchar(10) NOT NULL UNIQUE,
  "name" varchar(60) NOT NULL,
  "is_paid" boolean NOT NULL DEFAULT true,
  "is_half_day_allowed" boolean NOT NULL DEFAULT true,
  "sandwich_rule" boolean NOT NULL DEFAULT false,
  "sandwich_cross_app" boolean NOT NULL DEFAULT false,
  "requires_doc_after_days" integer NOT NULL DEFAULT 0,
  "max_per_application" numeric(4,1),
  "encashable" boolean NOT NULL DEFAULT false,
  "applies_to_category" varchar(20),
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz(3) NOT NULL DEFAULT now()
);

-- Seed standard leave types
INSERT INTO "leave_types" ("code","name","is_paid","is_half_day_allowed","sandwich_rule","requires_doc_after_days","encashable") VALUES
  ('EL', 'Earned Leave', true, false, false, 0, true),
  ('CL', 'Casual Leave', true, true, true, 0, false),
  ('SL', 'Sick Leave', true, true, false, 2, false),
  ('ML', 'Maternity Leave', true, false, false, 0, false),
  ('COMP', 'Compensatory Off', true, false, false, 0, false),
  ('LOP', 'Loss of Pay', false, true, false, 0, false),
  ('OD', 'On Duty', true, true, false, 0, false);

CREATE TABLE "leave_policies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" varchar(100) NOT NULL,
  "description" text,
  "created_at" timestamptz(3) NOT NULL DEFAULT now()
);

CREATE TABLE "leave_policy_rules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "policy_id" uuid NOT NULL REFERENCES "leave_policies"("id") ON DELETE CASCADE,
  "leave_type_id" uuid NOT NULL REFERENCES "leave_types"("id") ON DELETE CASCADE,
  "accrual_method" varchar(20) NOT NULL DEFAULT 'MONTHLY',
  "rate" numeric(7,4) NOT NULL DEFAULT 0,
  "eligibility_days" integer NOT NULL DEFAULT 0,
  "carry_cap" numeric(5,1) NOT NULL DEFAULT 0,
  "accumulation_cap" numeric(5,1) NOT NULL DEFAULT 0,
  "encash_allowed" boolean NOT NULL DEFAULT false,
  "effective_from" date NOT NULL,
  "effective_to" date,
  "needs_review" boolean NOT NULL DEFAULT true,
  "source_url" text,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "lp_accrual_chk" CHECK ("accrual_method" IN ('WORKED_DAYS','MONTHLY','ANNUAL_GRANT','NONE'))
);

CREATE TABLE "leave_policy_assignments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
  "policy_id" uuid NOT NULL REFERENCES "leave_policies"("id") ON DELETE RESTRICT,
  "effective_from" date NOT NULL,
  "effective_to" date,
  "created_at" timestamptz(3) NOT NULL DEFAULT now()
);

CREATE TABLE "leave_ledger" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
  "leave_type_id" uuid NOT NULL REFERENCES "leave_types"("id") ON DELETE RESTRICT,
  "txn_date" date NOT NULL,
  "kind" varchar(20) NOT NULL,
  "days" numeric(5,2) NOT NULL,
  "balance_after" numeric(7,2) NOT NULL,
  "reference_id" uuid,
  "reference_type" varchar(40),
  "expires_on" date,
  "note" varchar(300),
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "ll_kind_chk" CHECK ("kind" IN ('ACCRUAL','GRANT','AVAIL','REVERSAL','CARRY_FWD','LAPSE','ENCASH','ADJUST','COMP_CREDIT','COMP_EXPIRE'))
);
CREATE INDEX "leave_ledger_emp_type_idx" ON "leave_ledger"("employee_id", "leave_type_id", "txn_date");

-- Append-only trigger for leave_ledger
CREATE OR REPLACE FUNCTION leave_ledger_no_update_delete()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'leave_ledger is append-only: updates and deletes are prohibited';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "leave_ledger_immutable"
BEFORE UPDATE OR DELETE ON "leave_ledger"
FOR EACH ROW EXECUTE FUNCTION leave_ledger_no_update_delete();

CREATE TABLE "leave_applications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
  "leave_type_id" uuid NOT NULL REFERENCES "leave_types"("id") ON DELETE RESTRICT,
  "start_date" date NOT NULL,
  "end_date" date NOT NULL,
  "half_day_first" boolean NOT NULL DEFAULT false,
  "half_day_last" boolean NOT NULL DEFAULT false,
  "days_computed" numeric(5,2) NOT NULL,
  "reason" varchar(300) NOT NULL,
  "document_file_id" uuid,
  "status" varchar(20) NOT NULL DEFAULT 'DRAFT',
  "approval_request_id" uuid,
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "la_status_chk" CHECK ("status" IN ('DRAFT','PENDING_APPROVAL','APPROVED','REJECTED','CANCELLED'))
);

