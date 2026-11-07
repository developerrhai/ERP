-- Phase 07 M5: manual credit / debit notes, expense claims, recurring journals, foreign currency capture,
-- and the Finance-side tax REGISTERS (sales / purchase register, TDS register, challans).
-- Statutory numbers are never decided here (R-11, D-21): the tax register stores the amounts a producer sends
-- and checks that they add up; it computes no GST/TDS rate, files nothing and calls no portal (R-12).

-- ---- employees as a ledger party (expense reimbursements, account 2104) --------------------------------
ALTER TABLE "journal_lines" DROP CONSTRAINT "journal_lines_party_check";
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_party_check"
  CHECK (("party_id" IS NULL) = ("party_type" IS NULL) AND ("party_type" IS NULL OR "party_type" IN ('CUSTOMER','SUPPLIER','EMPLOYEE')));
ALTER TABLE "open_items" DROP CONSTRAINT "open_items_party_type_check";
ALTER TABLE "open_items" ADD CONSTRAINT "open_items_party_type_check" CHECK ("party_type" IN ('CUSTOMER','SUPPLIER','EMPLOYEE'));

-- ---- foreign currency capture (BR-FIN-09): the ledger is INR; a line may carry the foreign amount and rate -----
ALTER TABLE "journal_lines" ADD COLUMN "fx_rate" numeric(18,6) NOT NULL DEFAULT 1;
ALTER TABLE "journal_lines" ADD COLUMN "amount_fc" numeric(18,2) NULL;
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_fx_check" CHECK ("fx_rate" > 0 AND ("currency_code" = 'INR' OR "amount_fc" IS NOT NULL));
ALTER TABLE "gl_entries" ADD COLUMN "fx_rate" numeric(18,6) NOT NULL DEFAULT 1;
ALTER TABLE "gl_entries" ADD COLUMN "amount_fc" numeric(18,2) NULL;
ALTER TABLE "open_items" ADD COLUMN "amount_fc" numeric(18,2) NULL;

CREATE TABLE "fx_rates" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "currency_code" char(3) NOT NULL,
  "rate_date"     date NOT NULL,
  "rate"          numeric(18,6) NOT NULL,
  "source"        varchar(60) NULL,
  "created_at"    timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fx_rates_rate_check" CHECK ("rate" > 0),
  CONSTRAINT "fx_rates_currency_check" CHECK ("currency_code" <> 'INR')
);
CREATE UNIQUE INDEX "fx_rates_currency_date_key" ON "fx_rates" ("currency_code","rate_date");
CREATE INDEX "fx_rates_created_by_id_idx" ON "fx_rates" ("created_by_id");

-- ---- manual credit / debit notes (corrections with no goods movement) -----------------------------------
CREATE TABLE "credit_debit_notes" (
  "id"                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id"            uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "fy_id"              uuid NOT NULL REFERENCES "financial_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "code"               varchar(60) NOT NULL,
  "kind"               text NOT NULL,
  "effect"             text NOT NULL,
  "party_type"         text NOT NULL,
  "party_id"           uuid NOT NULL,
  "doc_date"           date NOT NULL,
  "counter_account_id" uuid NOT NULL REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "cost_center_id"     uuid NULL REFERENCES "cost_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "amount"             numeric(18,2) NOT NULL,
  "reason"             varchar(300) NOT NULL,
  "against_doc_no"     varchar(60) NULL,
  "status"             text NOT NULL DEFAULT 'Draft',
  "journal_id"         uuid NULL REFERENCES "journals"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "version"            integer NOT NULL DEFAULT 1,
  "created_at"         timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id"      uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "updated_at"         timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id"      uuid NULL REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "deleted_at"         timestamptz(3) NULL,
  "deleted_by_id"      uuid NULL REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "credit_debit_notes_kind_check" CHECK ("kind" IN ('CREDIT','DEBIT')),
  CONSTRAINT "credit_debit_notes_effect_check" CHECK ("effect" IN ('REDUCE','ADD')),
  CONSTRAINT "credit_debit_notes_party_check" CHECK (("kind" = 'CREDIT' AND "party_type" = 'CUSTOMER') OR ("kind" = 'DEBIT' AND "party_type" = 'SUPPLIER')),
  CONSTRAINT "credit_debit_notes_amount_check" CHECK ("amount" > 0),
  CONSTRAINT "credit_debit_notes_status_check" CHECK ("status" IN ('Draft','Posted','Cancelled'))
);
CREATE UNIQUE INDEX "credit_debit_notes_code_key" ON "credit_debit_notes" ("code");
CREATE INDEX "credit_debit_notes_unit_date_idx" ON "credit_debit_notes" ("unit_id","doc_date");
CREATE INDEX "credit_debit_notes_party_idx" ON "credit_debit_notes" ("party_type","party_id");
CREATE INDEX "credit_debit_notes_fy_id_idx" ON "credit_debit_notes" ("fy_id");
CREATE INDEX "credit_debit_notes_counter_account_id_idx" ON "credit_debit_notes" ("counter_account_id");
CREATE INDEX "credit_debit_notes_cost_center_id_idx" ON "credit_debit_notes" ("cost_center_id");
CREATE INDEX "credit_debit_notes_journal_id_idx" ON "credit_debit_notes" ("journal_id");
CREATE INDEX "credit_debit_notes_created_by_id_idx" ON "credit_debit_notes" ("created_by_id");

-- ---- expense claims ----------------------------------------------------------------------------------------
CREATE TABLE "expense_policies" (
  "category"          varchar(30) PRIMARY KEY,
  "per_claim_limit"   numeric(18,2) NOT NULL,
  "per_month_limit"   numeric(18,2) NOT NULL,
  "approval_limit"    numeric(18,2) NOT NULL,
  "default_account_id" uuid NULL REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "version"           integer NOT NULL DEFAULT 1,
  "updated_at"        timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id"     uuid NULL REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "expense_policies_default_account_id_idx" ON "expense_policies" ("default_account_id");
CREATE INDEX "expense_policies_updated_by_id_idx" ON "expense_policies" ("updated_by_id");
-- limits are examples the CFO edits (05b 5.18); approval_limit = 3 x the per-claim limit
INSERT INTO "expense_policies" ("category","per_claim_limit","per_month_limit","approval_limit","default_account_id")
SELECT v.cat, v.pc, v.pm, v.pc * 3, a."id" FROM (VALUES
  ('Travel',5000,25000,'6206'),('Food',1500,6000,'6222'),('Fuel',3000,12000,'6221'),('Lodging',6000,30000,'6223'),
  ('Communication',1500,3000,'6204'),('Office',5000,20000,'6217'),('Repairs',10000,50000,'6211'),('Training',15000,50000,'6219'),
  ('Entertainment',3000,10000,'6218'),('Other',2000,10000,'6264')
) AS v(cat, pc, pm, code) JOIN "accounts" a ON a."code" = v.code;

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

-- ---- recurring journals ------------------------------------------------------------------------------------
CREATE TABLE "recurring_journals" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id"       uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "name"          varchar(120) NOT NULL,
  "voucher_type"  varchar(30) NOT NULL REFERENCES "voucher_types"("code") ON DELETE RESTRICT ON UPDATE CASCADE,
  "narration"     varchar(300) NULL,
  "lines"         jsonb NOT NULL,
  "frequency"     text NOT NULL,
  "next_run"      date NOT NULL,
  "end_date"      date NULL,
  "auto_post"     boolean NOT NULL DEFAULT false,
  "reverse_next_day" boolean NOT NULL DEFAULT false,
  "status"        text NOT NULL DEFAULT 'Active',
  "last_journal_id" uuid NULL REFERENCES "journals"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "runs"          integer NOT NULL DEFAULT 0,
  "version"       integer NOT NULL DEFAULT 1,
  "created_at"    timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "updated_at"    timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid NULL REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "recurring_journals_frequency_check" CHECK ("frequency" IN ('WEEKLY','MONTHLY','QUARTERLY','YEARLY')),
  CONSTRAINT "recurring_journals_status_check" CHECK ("status" IN ('Active','Paused','Finished'))
);
CREATE INDEX "recurring_journals_due_idx" ON "recurring_journals" ("status","next_run");
CREATE INDEX "recurring_journals_unit_id_idx" ON "recurring_journals" ("unit_id");
CREATE INDEX "recurring_journals_voucher_type_idx" ON "recurring_journals" ("voucher_type");
CREATE INDEX "recurring_journals_last_journal_id_idx" ON "recurring_journals" ("last_journal_id");
CREATE INDEX "recurring_journals_created_by_id_idx" ON "recurring_journals" ("created_by_id");

-- ---- tax registers (Finance side; amounts come from the producer, nothing is computed here) -------------------
CREATE TABLE "tax_documents" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id"          uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "direction"        text NOT NULL,
  "doc_kind"         text NOT NULL,
  "doc_no"           varchar(60) NOT NULL,
  "doc_date"         date NOT NULL,
  "party_type"       text NULL,
  "party_id"         uuid NULL,
  "party_name"       varchar(150) NOT NULL,
  "party_gstin"      varchar(15) NULL,
  "party_state_code" char(2) NULL,
  "place_of_supply"  char(2) NOT NULL,
  "reverse_charge"   boolean NOT NULL DEFAULT false,
  "taxable"          numeric(18,2) NOT NULL,
  "cgst"             numeric(18,2) NOT NULL DEFAULT 0,
  "sgst"             numeric(18,2) NOT NULL DEFAULT 0,
  "igst"             numeric(18,2) NOT NULL DEFAULT 0,
  "cess"             numeric(18,2) NOT NULL DEFAULT 0,
  "journal_id"       uuid NOT NULL REFERENCES "journals"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "status"           text NOT NULL DEFAULT 'Active',
  "created_at"       timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id"    uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "tax_documents_direction_check" CHECK ("direction" IN ('OUTWARD','INWARD')),
  CONSTRAINT "tax_documents_kind_check" CHECK ("doc_kind" IN ('INV','CRN','DBN')),
  CONSTRAINT "tax_documents_status_check" CHECK ("status" IN ('Active','Cancelled')),
  CONSTRAINT "tax_documents_amounts_check" CHECK ("taxable" >= 0 AND "cgst" >= 0 AND "sgst" >= 0 AND "igst" >= 0 AND "cess" >= 0)
);
CREATE UNIQUE INDEX "tax_documents_doc_key" ON "tax_documents" ("unit_id","direction","doc_kind","doc_no") WHERE "status" = 'Active';
CREATE INDEX "tax_documents_date_idx" ON "tax_documents" ("unit_id","direction","doc_date");
CREATE INDEX "tax_documents_party_idx" ON "tax_documents" ("party_type","party_id");
CREATE INDEX "tax_documents_journal_id_idx" ON "tax_documents" ("journal_id");
CREATE INDEX "tax_documents_created_by_id_idx" ON "tax_documents" ("created_by_id");

CREATE TABLE "tax_document_lines" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tax_document_id" uuid NOT NULL REFERENCES "tax_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "line_no"         integer NOT NULL,
  "hsn"             varchar(8) NOT NULL,
  "uqc"             varchar(10) NULL,
  "qty"             numeric(18,3) NOT NULL DEFAULT 0,
  "taxable"         numeric(18,2) NOT NULL,
  "rate_pct"        numeric(7,4) NOT NULL DEFAULT 0,
  "cgst"            numeric(18,2) NOT NULL DEFAULT 0,
  "sgst"            numeric(18,2) NOT NULL DEFAULT 0,
  "igst"            numeric(18,2) NOT NULL DEFAULT 0,
  "cess"            numeric(18,2) NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX "tax_document_lines_key" ON "tax_document_lines" ("tax_document_id","line_no");

CREATE TABLE "tax_challans" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id"         uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "tax_kind"        text NOT NULL,
  "challan_no"      varchar(40) NOT NULL,
  "bsr_code"        varchar(10) NULL,
  "paid_on"         date NOT NULL,
  "amount"          numeric(18,2) NOT NULL,
  "bank_account_id" uuid NOT NULL REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "payment_id"      uuid NOT NULL REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "created_at"      timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id"   uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "tax_challans_kind_check" CHECK ("tax_kind" IN ('TDS','TCS')),
  CONSTRAINT "tax_challans_amount_check" CHECK ("amount" > 0)
);
CREATE UNIQUE INDEX "tax_challans_no_key" ON "tax_challans" ("tax_kind","challan_no");
CREATE INDEX "tax_challans_unit_id_idx" ON "tax_challans" ("unit_id");
CREATE INDEX "tax_challans_bank_account_id_idx" ON "tax_challans" ("bank_account_id");
CREATE INDEX "tax_challans_payment_id_idx" ON "tax_challans" ("payment_id");
CREATE INDEX "tax_challans_created_by_id_idx" ON "tax_challans" ("created_by_id");

CREATE TABLE "tds_entries" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id"        uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "kind"           text NOT NULL DEFAULT 'TDS',
  "supplier_id"    uuid NULL REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "section_code"   varchar(10) NOT NULL,
  "base_amount"    numeric(18,2) NOT NULL,
  "rate_pct"       numeric(7,4) NOT NULL,
  "tds_amount"     numeric(18,2) NOT NULL,
  "deducted_on"    date NOT NULL,
  "source_doc_no"  varchar(60) NULL,
  "journal_id"     uuid NOT NULL REFERENCES "journals"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "challan_id"     uuid NULL REFERENCES "tax_challans"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "status"         text NOT NULL DEFAULT 'Active',
  "created_at"     timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id"  uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "tds_entries_kind_check" CHECK ("kind" IN ('TDS','TCS')),
  CONSTRAINT "tds_entries_status_check" CHECK ("status" IN ('Active','Cancelled')),
  CONSTRAINT "tds_entries_amount_check" CHECK ("tds_amount" >= 0 AND "base_amount" >= 0 AND "rate_pct" >= 0)
);
CREATE INDEX "tds_entries_unit_date_idx" ON "tds_entries" ("unit_id","kind","deducted_on");
CREATE INDEX "tds_entries_supplier_id_idx" ON "tds_entries" ("supplier_id");
CREATE INDEX "tds_entries_journal_id_idx" ON "tds_entries" ("journal_id");
CREATE INDEX "tds_entries_challan_id_idx" ON "tds_entries" ("challan_id");
CREATE INDEX "tds_entries_created_by_id_idx" ON "tds_entries" ("created_by_id");
