-- Phase 22 fix: the Phase 15 migration (20261127040000_phase15_e_expenses) ran
-- DROP TABLE "expense_claims" CASCADE and re-used the name, which destroyed the Phase 7 finance
-- expense claims (fin-expenses) and made every finance expense call fail with 'column "amount" does not exist'.
-- Two different tables need two names: the HR claim (header + expense_claim_lines) becomes
-- "hr_expense_claims", and the Phase 7 finance table is created again exactly as Phase 7 defined it.
-- Forward-only; the HR service SQL is updated in the same change.

ALTER TABLE "expense_claims" RENAME TO "hr_expense_claims";
ALTER INDEX IF EXISTS "expense_claims_pkey" RENAME TO "hr_expense_claims_pkey";
ALTER INDEX IF EXISTS "expense_claims_claim_no_key" RENAME TO "hr_expense_claims_claim_no_key";
ALTER TABLE "hr_expense_claims" RENAME CONSTRAINT "ec_status_chk" TO "hr_ec_status_chk";

CREATE TABLE "expense_claims" (
  "id"                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id"           uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "fy_id"             uuid NOT NULL REFERENCES "financial_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "code"              varchar(60) NOT NULL,
  "employee_id"       uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "claim_date"        date NOT NULL,
  "category"          varchar(30) NOT NULL REFERENCES "expense_policies"("category") ON DELETE RESTRICT ON UPDATE CASCADE,
  "expense_account_id" uuid NOT NULL REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "cost_center_id"    uuid NULL REFERENCES "cost_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "amount"            numeric(18,2) NOT NULL,
  "description"       varchar(300) NOT NULL,
  "bill_no"           varchar(60) NULL,
  "status"            text NOT NULL DEFAULT 'Draft',
  "journal_id"        uuid NULL REFERENCES "journals"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "payment_id"        uuid NULL REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "warnings"          jsonb NOT NULL DEFAULT '[]'::jsonb,
  "version"           integer NOT NULL DEFAULT 1,
  "created_at"        timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id"     uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "updated_at"        timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id"     uuid NULL REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "deleted_at"        timestamptz(3) NULL,
  "deleted_by_id"     uuid NULL REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "expense_claims_amount_check" CHECK ("amount" > 0),
  CONSTRAINT "expense_claims_status_check" CHECK ("status" IN ('Draft','Pending Approval','Approved','Rejected','Paid','Cancelled'))
);
CREATE UNIQUE INDEX "expense_claims_code_key" ON "expense_claims" ("code");
CREATE INDEX "expense_claims_unit_date_idx" ON "expense_claims" ("unit_id","claim_date");
CREATE INDEX "expense_claims_employee_idx" ON "expense_claims" ("employee_id","claim_date");
CREATE INDEX "expense_claims_fy_id_idx" ON "expense_claims" ("fy_id");
CREATE INDEX "expense_claims_category_idx" ON "expense_claims" ("category");
CREATE INDEX "expense_claims_expense_account_id_idx" ON "expense_claims" ("expense_account_id");
CREATE INDEX "expense_claims_cost_center_id_idx" ON "expense_claims" ("cost_center_id");
CREATE INDEX "expense_claims_journal_id_idx" ON "expense_claims" ("journal_id");
CREATE INDEX "expense_claims_payment_id_idx" ON "expense_claims" ("payment_id");
CREATE INDEX "expense_claims_created_by_id_idx" ON "expense_claims" ("created_by_id");

-- Phase 20 requires every foreign key to be indexed (tools/verify-fk-indexes.ts).
CREATE INDEX IF NOT EXISTS "expense_claims_updated_by_id_idx" ON "expense_claims" ("updated_by_id");
CREATE INDEX IF NOT EXISTS "expense_claims_deleted_by_id_idx" ON "expense_claims" ("deleted_by_id");
