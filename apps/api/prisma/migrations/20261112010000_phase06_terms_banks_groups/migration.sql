-- Phase 06 M2: payment terms, banks, party groups, territories (docs/phases/PHASE-06.md §4).
-- Starter rows only (terms IMMEDIATE / NET30 / NET45). No demo parties.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE "payment_terms" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" VARCHAR(20) NOT NULL,
  "name" VARCHAR(80) NOT NULL,
  "description" VARCHAR(300),
  "status" VARCHAR(10) NOT NULL DEFAULT 'ACTIVE',
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "created_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "deleted_at" TIMESTAMPTZ(3),
  "deleted_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "payment_terms_status_chk" CHECK ("status" IN ('ACTIVE','INACTIVE')),
  CONSTRAINT "payment_terms_code_uq" UNIQUE ("code")
);
CREATE INDEX "payment_terms_created_by_idx" ON "payment_terms"("created_by_id");
CREATE INDEX "payment_terms_updated_by_idx" ON "payment_terms"("updated_by_id");
CREATE INDEX "payment_terms_deleted_by_idx" ON "payment_terms"("deleted_by_id");

CREATE TABLE "payment_term_lines" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "payment_term_id" UUID NOT NULL REFERENCES "payment_terms"("id") ON DELETE CASCADE,
  "line_no" SMALLINT NOT NULL,
  "portion_pct" NUMERIC(7,4) NOT NULL,
  "due_basis" VARCHAR(24) NOT NULL,
  "days" SMALLINT NOT NULL DEFAULT 0,
  "discount_pct" NUMERIC(7,4) NOT NULL DEFAULT 0,
  "discount_days" SMALLINT NOT NULL DEFAULT 0,
  CONSTRAINT "payment_term_lines_portion_chk" CHECK ("portion_pct" > 0 AND "portion_pct" <= 100),
  CONSTRAINT "payment_term_lines_basis_chk" CHECK ("due_basis" IN ('ADVANCE','INVOICE_DATE','END_OF_INVOICE_MONTH','RECEIPT_OF_GOODS')),
  CONSTRAINT "payment_term_lines_days_chk" CHECK ("days" BETWEEN 0 AND 365),
  CONSTRAINT "payment_term_lines_line_uq" UNIQUE ("payment_term_id", "line_no")
);

CREATE TABLE "banks" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" CHAR(4) NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "status" VARCHAR(10) NOT NULL DEFAULT 'ACTIVE',
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "created_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "deleted_at" TIMESTAMPTZ(3),
  "deleted_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "banks_code_chk" CHECK ("code" ~ '^[A-Z]{4}$'),
  CONSTRAINT "banks_status_chk" CHECK ("status" IN ('ACTIVE','INACTIVE')),
  CONSTRAINT "banks_code_uq" UNIQUE ("code")
);
CREATE INDEX "banks_created_by_idx" ON "banks"("created_by_id");
CREATE INDEX "banks_updated_by_idx" ON "banks"("updated_by_id");
CREATE INDEX "banks_deleted_by_idx" ON "banks"("deleted_by_id");

CREATE TABLE "territories" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" VARCHAR(20) NOT NULL,
  "name" VARCHAR(80) NOT NULL,
  "parent_id" UUID REFERENCES "territories"("id") ON DELETE SET NULL,
  "state_code" CHAR(2) REFERENCES "gst_states"("code"),
  "status" VARCHAR(10) NOT NULL DEFAULT 'ACTIVE',
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "created_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "deleted_at" TIMESTAMPTZ(3),
  "deleted_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "territories_status_chk" CHECK ("status" IN ('ACTIVE','INACTIVE')),
  CONSTRAINT "territories_code_uq" UNIQUE ("code")
);
CREATE INDEX "territories_parent_idx" ON "territories"("parent_id");
CREATE INDEX "territories_state_idx" ON "territories"("state_code");
CREATE INDEX "territories_created_by_idx" ON "territories"("created_by_id");
CREATE INDEX "territories_updated_by_idx" ON "territories"("updated_by_id");
CREATE INDEX "territories_deleted_by_idx" ON "territories"("deleted_by_id");

CREATE TABLE "party_groups" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "kind" VARCHAR(10) NOT NULL,
  "code" VARCHAR(20) NOT NULL,
  "name" VARCHAR(80) NOT NULL,
  "parent_id" UUID REFERENCES "party_groups"("id") ON DELETE SET NULL,
  "default_payment_term_id" UUID REFERENCES "payment_terms"("id") ON DELETE SET NULL,
  "default_price_list_id" UUID,
  "control_account_key" VARCHAR(40),
  "status" VARCHAR(10) NOT NULL DEFAULT 'ACTIVE',
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "created_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "deleted_at" TIMESTAMPTZ(3),
  "deleted_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "party_groups_kind_chk" CHECK ("kind" IN ('CUSTOMER','SUPPLIER')),
  CONSTRAINT "party_groups_status_chk" CHECK ("status" IN ('ACTIVE','INACTIVE')),
  CONSTRAINT "party_groups_kind_code_uq" UNIQUE ("kind", "code")
);
CREATE INDEX "party_groups_parent_idx" ON "party_groups"("parent_id");
CREATE INDEX "party_groups_term_idx" ON "party_groups"("default_payment_term_id");
CREATE INDEX "party_groups_price_list_idx" ON "party_groups"("default_price_list_id");
CREATE INDEX "party_groups_created_by_idx" ON "party_groups"("created_by_id");
CREATE INDEX "party_groups_updated_by_idx" ON "party_groups"("updated_by_id");
CREATE INDEX "party_groups_deleted_by_idx" ON "party_groups"("deleted_by_id");

-- Starter data (no demo parties). Bank codes are the first 4 letters of the IFSC; the list is a starting point
-- for the accountant to extend, not a statutory table.
INSERT INTO "payment_terms" ("code", "name", "description") VALUES
  ('IMMEDIATE', 'Immediate', 'Due on the invoice date'),
  ('NET30',     'Net 30',    'Due 30 days after the invoice date'),
  ('NET45',     'Net 45',    'Due 45 days after the invoice date');
INSERT INTO "payment_term_lines" ("payment_term_id", "line_no", "portion_pct", "due_basis", "days")
  SELECT "id", 1, 100, 'INVOICE_DATE', CASE "code" WHEN 'IMMEDIATE' THEN 0 WHEN 'NET30' THEN 30 ELSE 45 END
    FROM "payment_terms" WHERE "code" IN ('IMMEDIATE','NET30','NET45');
INSERT INTO "banks" ("code", "name") VALUES
  ('SBIN', 'State Bank of India'),
  ('HDFC', 'HDFC Bank'),
  ('ICIC', 'ICICI Bank'),
  ('UTIB', 'Axis Bank'),
  ('KKBK', 'Kotak Mahindra Bank'),
  ('YESB', 'Yes Bank'),
  ('PUNB', 'Punjab National Bank'),
  ('BARB', 'Bank of Baroda'),
  ('CNRB', 'Canara Bank'),
  ('UBIN', 'Union Bank of India'),
  ('IDIB', 'Indian Bank'),
  ('BKID', 'Bank of India'),
  ('MAHB', 'Bank of Maharashtra'),
  ('IBKL', 'IDBI Bank'),
  ('INDB', 'IndusInd Bank');
