-- Phase 14 (depreciation, section 4): depreciation runs for two areas (BOOK posts to the GL, TAX is a memo on IT-Act blocks),
-- the run lines, the IT block ledger per financial year; plus the MAINT_EXPENSE account key and the stock voucher types the
-- maintenance work orders use for spares. Forward-only.

INSERT INTO "account_defaults" ("key","account_id")
SELECT 'MAINT_EXPENSE', a."id" FROM "accounts" a WHERE a."code" = '6211'
ON CONFLICT DO NOTHING;
INSERT INTO "posting_rules" ("event","line_key","seq","description","account_selector","account_ref","condition") VALUES
 ('*','MAINT_EXPENSE',99,'Spares consumed on maintenance work orders','FIXED_CODE','6211',NULL)
ON CONFLICT DO NOTHING;
INSERT INTO "stock_voucher_types" ("code","name","direction") VALUES
  ('MWO_ISSUE','Spares issued to a maintenance work order','OUT'),
  ('MWO_RETURN','Spares returned from a maintenance work order','IN')
ON CONFLICT DO NOTHING;

CREATE TABLE "depreciation_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "fy_id" uuid REFERENCES "financial_years"("id") ON DELETE RESTRICT,
  "run_no" varchar(40) NOT NULL,
  "area" varchar(4) NOT NULL,
  "period" varchar(8) NOT NULL,
  "status" varchar(10) NOT NULL DEFAULT 'DRAFT',
  "total_amount" numeric(18,2) NOT NULL DEFAULT 0,
  "journal_id" uuid,
  "reversal_journal_id" uuid,
  "run_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "job_id" varchar(60),
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "posted_at" timestamptz(3),
  "deleted_at" timestamptz(3),
  CONSTRAINT "dr_area_chk" CHECK ("area" IN ('BOOK','TAX')),
  CONSTRAINT "dr_status_chk" CHECK ("status" IN ('DRAFT','POSTED','REVERSED'))
);
CREATE UNIQUE INDEX "dr_no_uq" ON "depreciation_runs"("run_no");
-- one live run per area, unit and period (a reversed run frees the period)
CREATE UNIQUE INDEX "dr_period_uq" ON "depreciation_runs"("area","unit_id","period") WHERE "status" <> 'REVERSED' AND "deleted_at" IS NULL;
CREATE INDEX "dr_unit_idx" ON "depreciation_runs"("unit_id","status");
CREATE INDEX "dr_fy_idx" ON "depreciation_runs"("fy_id");

CREATE TABLE "depreciation_run_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "run_id" uuid NOT NULL REFERENCES "depreciation_runs"("id") ON DELETE CASCADE,
  "asset_id" uuid REFERENCES "assets"("id") ON DELETE RESTRICT,
  "block_id" uuid REFERENCES "it_blocks"("id") ON DELETE RESTRICT,
  "opening_value" numeric(18,2) NOT NULL DEFAULT 0,
  "base" numeric(18,2) NOT NULL DEFAULT 0,
  "method" varchar(3),
  "rate" numeric(9,4),
  "days" integer,
  "shift_factor" numeric(5,2) NOT NULL DEFAULT 1,
  "amount" numeric(18,2) NOT NULL DEFAULT 0,
  "closing_value" numeric(18,2) NOT NULL DEFAULT 0,
  CONSTRAINT "drl_target_chk" CHECK ("asset_id" IS NOT NULL OR "block_id" IS NOT NULL),
  CONSTRAINT "drl_amt_chk" CHECK ("amount" >= 0)
);
CREATE INDEX "drl_run_idx" ON "depreciation_run_lines"("run_id");
CREATE INDEX "drl_asset_idx" ON "depreciation_run_lines"("asset_id");
CREATE INDEX "drl_block_idx" ON "depreciation_run_lines"("block_id");

CREATE TABLE "it_block_ledger" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "block_id" uuid NOT NULL REFERENCES "it_blocks"("id") ON DELETE RESTRICT,
  "fy_id" uuid NOT NULL REFERENCES "financial_years"("id") ON DELETE RESTRICT,
  "opening_wdv" numeric(18,2) NOT NULL DEFAULT 0,
  "additions_ge180" numeric(18,2) NOT NULL DEFAULT 0,
  "additions_lt180" numeric(18,2) NOT NULL DEFAULT 0,
  "deletions" numeric(18,2) NOT NULL DEFAULT 0,
  "depreciation" numeric(18,2) NOT NULL DEFAULT 0,
  "closing_wdv" numeric(18,2) NOT NULL DEFAULT 0,
  "needs_review" boolean NOT NULL DEFAULT true,
  "run_id" uuid REFERENCES "depreciation_runs"("id") ON DELETE SET NULL
);
CREATE UNIQUE INDEX "itbl_uq" ON "it_block_ledger"("unit_id","block_id","fy_id");
CREATE INDEX "itbl_block_idx" ON "it_block_ledger"("block_id");
CREATE INDEX "itbl_fy_idx" ON "it_block_ledger"("fy_id");
CREATE INDEX "itbl_run_idx" ON "it_block_ledger"("run_id");
