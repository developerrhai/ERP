-- Phase 15 Part E: Employee Expenses and Advances + GL Account Key Mapping (E-22)

-- Map account defaults and posting rules for EMPLOYEE_PAYABLE and EMPLOYEE_ADVANCE
INSERT INTO "account_defaults" ("key","account_id")
SELECT 'EMPLOYEE_ADVANCE', a."id" FROM "accounts" a WHERE a."code" = '1502'
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "account_defaults" ("key","account_id")
SELECT 'EMPLOYEE_PAYABLE', a."id" FROM "accounts" a WHERE a."code" = '2104'
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "posting_rules" ("event","line_key","seq","description","account_selector","account_ref","condition") VALUES
  ('*','EMPLOYEE_ADVANCE',99,'Employee advances','FIXED_CODE','1502',NULL),
  ('*','EMPLOYEE_PAYABLE',99,'Employee reimbursements payable','FIXED_CODE','2104',NULL)
ON CONFLICT DO NOTHING;

CREATE TABLE "expense_categories" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" varchar(100) NOT NULL UNIQUE,
  "gl_key" varchar(40) NOT NULL DEFAULT '6260',
  "limits_by_grade" jsonb,
  "receipt_required_above" numeric(18,2) NOT NULL DEFAULT 500,
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz(3) NOT NULL DEFAULT now()
);

-- Seed standard expense categories
INSERT INTO "expense_categories" ("name", "gl_key", "receipt_required_above") VALUES
  ('Travel & Conveyance', '6251', 100),
  ('Meals & Entertainment', '6252', 500),
  ('Lodging & Hotel', '6253', 1000),
  ('Office Supplies', '6254', 200),
  ('Communication / Telephone', '6255', 500),
  ('Other Employee Expenses', '6260', 500)
ON CONFLICT DO NOTHING;

DROP TABLE IF EXISTS "expense_claims" CASCADE;

CREATE TABLE "expense_claims" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "claim_no" varchar(40) NOT NULL UNIQUE,
  "employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE RESTRICT,
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "fy_id" uuid NOT NULL REFERENCES "financial_years"("id") ON DELETE RESTRICT,
  "claim_date" date NOT NULL,
  "title" varchar(200) NOT NULL,
  "description" text,
  "status" varchar(20) NOT NULL DEFAULT 'DRAFT',
  "approval_request_id" uuid,
  "journal_id" uuid,
  "total_amount" numeric(18,2) NOT NULL DEFAULT 0,
  "approved_amount" numeric(18,2) NOT NULL DEFAULT 0,
  "paid_amount" numeric(18,2) NOT NULL DEFAULT 0,
  "payment_ref" varchar(60),
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "deleted_at" timestamptz(3),
  CONSTRAINT "ec_status_chk" CHECK ("status" IN ('DRAFT','PENDING_APPROVAL','APPROVED','PAID','REJECTED','CANCELLED'))
);

CREATE TABLE "expense_claim_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "claim_id" uuid NOT NULL REFERENCES "expense_claims"("id") ON DELETE CASCADE,
  "category_id" uuid NOT NULL REFERENCES "expense_categories"("id") ON DELETE RESTRICT,
  "expense_date" date NOT NULL,
  "amount" numeric(18,2) NOT NULL,
  "gst_amount" numeric(18,2) NOT NULL DEFAULT 0,
  "description" varchar(300) NOT NULL,
  "receipt_document_id" uuid,
  "policy_breach" boolean NOT NULL DEFAULT false,
  "policy_breach_reason" varchar(300)
);

CREATE TABLE "employee_advances" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "advance_no" varchar(40) NOT NULL UNIQUE,
  "employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE RESTRICT,
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "fy_id" uuid NOT NULL REFERENCES "financial_years"("id") ON DELETE RESTRICT,
  "amount" numeric(18,2) NOT NULL,
  "purpose" varchar(300) NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'DRAFT',
  "approval_request_id" uuid,
  "journal_id" uuid,
  "settled_amount" numeric(18,2) NOT NULL DEFAULT 0,
  "settled_at" timestamptz(3),
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now()
);

