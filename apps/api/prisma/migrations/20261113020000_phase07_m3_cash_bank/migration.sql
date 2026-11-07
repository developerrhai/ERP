-- Phase 07 M3: cash and bank books: bank accounts, payments / receipts / transfers, statements, reconciliation.
-- Source: docs/archive/plans/05b 5.9 (reduced to what the ledger needs; no GST/TDS columns - those are Phase 11).
-- A payment is created already Posted (its journal is posted in the same transaction); undo = Cancel (reversal journal).

CREATE TABLE "bank_accounts" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id"       uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "account_id"    uuid NOT NULL REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "kind"          text NOT NULL,
  "name"          varchar(120) NOT NULL,
  "bank_name"     varchar(120) NULL,
  "account_last4" varchar(4) NULL,
  "ifsc"          varchar(11) NULL,
  "status"        text NOT NULL DEFAULT 'Active',
  "version"       integer NOT NULL DEFAULT 1,
  "created_at"    timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "updated_at"    timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid NULL REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "deleted_at"    timestamptz(3) NULL,
  "deleted_by_id" uuid NULL REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "bank_accounts_kind_check" CHECK ("kind" IN ('BANK','CASH','PETTY')),
  CONSTRAINT "bank_accounts_status_check" CHECK ("status" IN ('Active','Inactive')),
  CONSTRAINT "bank_accounts_ifsc_check" CHECK ("ifsc" IS NULL OR "ifsc" ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
  CONSTRAINT "bank_accounts_last4_check" CHECK ("account_last4" IS NULL OR "account_last4" ~ '^[0-9]{4}$')
);
CREATE UNIQUE INDEX "bank_accounts_account_id_key" ON "bank_accounts" ("account_id") WHERE "deleted_at" IS NULL;
CREATE INDEX "bank_accounts_unit_id_idx" ON "bank_accounts" ("unit_id");
CREATE INDEX "bank_accounts_created_by_id_idx" ON "bank_accounts" ("created_by_id");

CREATE TABLE "payments" (
  "id"                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id"             uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "fy_id"               uuid NOT NULL REFERENCES "financial_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "code"                varchar(60) NOT NULL,
  "kind"                text NOT NULL,
  "purpose"             text NOT NULL,
  "doc_date"            date NOT NULL,
  "party_type"          text NULL,
  "party_id"            uuid NULL,
  "bank_account_id"     uuid NOT NULL REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "to_bank_account_id"  uuid NULL REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "counter_account_id"  uuid NULL REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "amount"              numeric(18,2) NOT NULL,
  "mode"                text NOT NULL,
  "reference_no"        varchar(60) NULL,
  "narration"           varchar(300) NULL,
  "status"              text NOT NULL DEFAULT 'Posted',
  "journal_id"          uuid NOT NULL REFERENCES "journals"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "reversal_journal_id" uuid NULL REFERENCES "journals"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "cancel_reason"       varchar(300) NULL,
  "version"             integer NOT NULL DEFAULT 1,
  "created_at"          timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id"       uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "updated_at"          timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id"       uuid NULL REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "payments_kind_check" CHECK ("kind" IN ('PAYMENT','RECEIPT','TRANSFER')),
  CONSTRAINT "payments_purpose_check" CHECK ("purpose" IN ('SUPPLIER','OTHER','TRANSFER')),
  CONSTRAINT "payments_mode_check" CHECK ("mode" IN ('NEFT','RTGS','IMPS','UPI','Cheque','Cash')),
  CONSTRAINT "payments_status_check" CHECK ("status" IN ('Posted','Cancelled')),
  CONSTRAINT "payments_amount_check" CHECK ("amount" > 0),
  CONSTRAINT "payments_party_check" CHECK (("party_id" IS NULL) = ("party_type" IS NULL)),
  CONSTRAINT "payments_transfer_check" CHECK (("kind" = 'TRANSFER') = ("to_bank_account_id" IS NOT NULL)),
  CONSTRAINT "payments_transfer_distinct_check" CHECK ("to_bank_account_id" IS NULL OR "to_bank_account_id" <> "bank_account_id")
);
CREATE UNIQUE INDEX "payments_code_key" ON "payments" ("code");
CREATE UNIQUE INDEX "payments_journal_id_key" ON "payments" ("journal_id");
CREATE INDEX "payments_unit_date_idx" ON "payments" ("unit_id","doc_date");
CREATE INDEX "payments_fy_id_idx" ON "payments" ("fy_id");
CREATE INDEX "payments_party_idx" ON "payments" ("party_type","party_id");
CREATE INDEX "payments_bank_account_id_idx" ON "payments" ("bank_account_id");
CREATE INDEX "payments_to_bank_account_id_idx" ON "payments" ("to_bank_account_id");
CREATE INDEX "payments_counter_account_id_idx" ON "payments" ("counter_account_id");
CREATE INDEX "payments_reversal_journal_id_idx" ON "payments" ("reversal_journal_id");
CREATE INDEX "payments_created_by_id_idx" ON "payments" ("created_by_id");

ALTER TABLE "allocations" ADD CONSTRAINT "allocations_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "bank_statements" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "bank_account_id" uuid NOT NULL REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "period_from"     date NOT NULL,
  "period_to"       date NOT NULL,
  "opening_balance" numeric(18,2) NOT NULL,
  "closing_balance" numeric(18,2) NOT NULL,
  "file_hash"       varchar(64) NOT NULL,
  "status"          text NOT NULL DEFAULT 'Open',
  "reconciled_at"   timestamptz(3) NULL,
  "reconciled_by_id" uuid NULL REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "version"         integer NOT NULL DEFAULT 1,
  "created_at"      timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id"   uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "updated_at"      timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "bank_statements_status_check" CHECK ("status" IN ('Open','Reconciled')),
  CONSTRAINT "bank_statements_dates_check" CHECK ("period_to" >= "period_from")
);
CREATE UNIQUE INDEX "bank_statements_hash_key" ON "bank_statements" ("bank_account_id","file_hash");
CREATE INDEX "bank_statements_bank_account_id_idx" ON "bank_statements" ("bank_account_id","period_from");
CREATE INDEX "bank_statements_created_by_id_idx" ON "bank_statements" ("created_by_id");
CREATE INDEX "bank_statements_reconciled_by_id_idx" ON "bank_statements" ("reconciled_by_id");

CREATE TABLE "bank_statement_lines" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "statement_id" uuid NOT NULL REFERENCES "bank_statements"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "line_no"      integer NOT NULL,
  "txn_date"     date NOT NULL,
  "description"  varchar(300) NULL,
  "ref_no"       varchar(60) NULL,
  "withdrawal"   numeric(18,2) NOT NULL DEFAULT 0,
  "deposit"      numeric(18,2) NOT NULL DEFAULT 0,
  "match_status" text NOT NULL DEFAULT 'Unmatched',
  CONSTRAINT "bank_statement_lines_side_check" CHECK ("withdrawal" >= 0 AND "deposit" >= 0 AND (("withdrawal" > 0 AND "deposit" = 0) OR ("deposit" > 0 AND "withdrawal" = 0))),
  CONSTRAINT "bank_statement_lines_match_check" CHECK ("match_status" IN ('Unmatched','Matched','Ignored'))
);
CREATE UNIQUE INDEX "bank_statement_lines_line_key" ON "bank_statement_lines" ("statement_id","line_no");
CREATE INDEX "bank_statement_lines_status_idx" ON "bank_statement_lines" ("statement_id","match_status");

CREATE TABLE "bank_matches" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "line_id"       uuid NOT NULL REFERENCES "bank_statement_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "gl_entry_id"   uuid NOT NULL REFERENCES "gl_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "amount"        numeric(18,2) NOT NULL,
  "matched_by_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "matched_at"    timestamptz(3) NOT NULL DEFAULT now(),
  "unmatched_by_id" uuid NULL REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "unmatched_at"  timestamptz(3) NULL,
  CONSTRAINT "bank_matches_amount_check" CHECK ("amount" > 0)
);
-- one live match per statement line and per ledger row: the same bank entry can never be cleared twice
CREATE UNIQUE INDEX "bank_matches_line_live_key" ON "bank_matches" ("line_id") WHERE "unmatched_at" IS NULL;
CREATE UNIQUE INDEX "bank_matches_gl_live_key" ON "bank_matches" ("gl_entry_id") WHERE "unmatched_at" IS NULL;
CREATE INDEX "bank_matches_matched_by_id_idx" ON "bank_matches" ("matched_by_id");
CREATE INDEX "bank_matches_unmatched_by_id_idx" ON "bank_matches" ("unmatched_by_id");
