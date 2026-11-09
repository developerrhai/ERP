-- Phase 09 / A: procurement masters (docs/phases/PHASE-09.md §4.1). Forward-only, no company_id (R-01).
-- Every statutory row is DATED and needs_review = true (R-23, E-16, E-30): the accountant signs them off.
-- tds_sections: rates the spec did not state (194J, 194H, TCS 206C(1H), no-PAN, individual rates, Income-tax
-- Act 2025 section references) are NULL on purpose. The code refuses to deduct while a rate is NULL.

CREATE TABLE "tds_sections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" varchar(12) NOT NULL,
  "legacy_code" varchar(12) NOT NULL,
  "new_section_ref" varchar(40),
  "tax_kind" varchar(3) NOT NULL DEFAULT 'TDS',
  "description" varchar(200) NOT NULL,
  "mode" varchar(10) NOT NULL DEFAULT 'ON_ALL',
  "threshold_single" numeric(18,2),
  "threshold_annual" numeric(18,2),
  "rate_pct" numeric(7,4),
  "rate_pct_individual" numeric(7,4),
  "no_pan_rate" numeric(7,4),
  "rounding" varchar(5) NOT NULL DEFAULT 'RUPEE',
  "effective_from" date NOT NULL,
  "effective_to" date,
  "needs_review" boolean NOT NULL DEFAULT true,
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "tds_sections_mode_chk" CHECK ("mode" IN ('ON_ALL','ON_EXCESS')),
  CONSTRAINT "tds_sections_kind_chk" CHECK ("tax_kind" IN ('TDS','TCS')),
  CONSTRAINT "tds_sections_rounding_chk" CHECK ("rounding" IN ('RUPEE','PAISE')),
  CONSTRAINT "tds_sections_dates_chk" CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from")
);
CREATE UNIQUE INDEX "tds_sections_code_from_uq" ON "tds_sections"("code","effective_from");
CREATE INDEX "tds_sections_created_by_idx" ON "tds_sections"("created_by_id");
CREATE INDEX "tds_sections_updated_by_idx" ON "tds_sections"("updated_by_id");

INSERT INTO "tds_sections" ("code","legacy_code","description","mode","threshold_single","threshold_annual","rate_pct","effective_from","effective_to","tax_kind") VALUES
 ('194Q','194Q','Purchase of goods above 50 lakh (0.1 % on the excess)','ON_EXCESS',NULL,5000000,0.1,'2021-07-01',NULL,'TDS'),
 ('194C','194C','Payment to contractors (30,000 single / 1,00,000 yearly)','ON_ALL',30000,100000,2,'2020-04-01',NULL,'TDS'),
 ('194J','194J','Professional / technical fees (annual limit 50,000; rate to be confirmed)','ON_ALL',NULL,50000,NULL,'2020-04-01',NULL,'TDS'),
 ('194H','194H','Commission / brokerage (annual limit 20,000; rate to be confirmed)','ON_ALL',NULL,20000,NULL,'2020-04-01',NULL,'TDS'),
 ('206C1H','206C(1H)','TCS on sale of goods - switched off from 1-Apr-2025','ON_EXCESS',NULL,5000000,NULL,'2020-10-01','2025-03-31','TCS');

CREATE TABLE "supplier_tds_ledger" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "supplier_id" uuid NOT NULL REFERENCES "suppliers"("id") ON DELETE RESTRICT,
  "fy_id" uuid NOT NULL REFERENCES "financial_years"("id") ON DELETE RESTRICT,
  "section_code" varchar(12) NOT NULL,
  "doc_type" varchar(10) NOT NULL,
  "doc_id" uuid NOT NULL,
  "doc_date" date NOT NULL,
  "base" numeric(18,2) NOT NULL,
  "cum_base_after" numeric(18,2) NOT NULL,
  "cum_tds_base_after" numeric(18,2) NOT NULL,
  "tds_amount" numeric(18,2) NOT NULL DEFAULT 0,
  "reverses_id" uuid REFERENCES "supplier_tds_ledger"("id") ON DELETE RESTRICT,
  "needs_review" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "supplier_tds_ledger_doc_chk" CHECK ("doc_type" IN ('PINV','DN','REVERSAL'))
);
CREATE INDEX "supplier_tds_ledger_key_idx" ON "supplier_tds_ledger"("supplier_id","fy_id","section_code","created_at");
CREATE INDEX "supplier_tds_ledger_doc_idx" ON "supplier_tds_ledger"("doc_id");
CREATE INDEX "supplier_tds_ledger_fy_idx" ON "supplier_tds_ledger"("fy_id");
CREATE INDEX "supplier_tds_ledger_reverses_idx" ON "supplier_tds_ledger"("reverses_id");
CREATE INDEX "supplier_tds_ledger_created_by_idx" ON "supplier_tds_ledger"("created_by_id");

-- One row of settings (tolerances, weights). The grade bands and the rate-of-interest are needs_review.
CREATE TABLE "scm_settings" (
  "id" integer PRIMARY KEY DEFAULT 1,
  "tolerance_qty_pct" numeric(7,4) NOT NULL DEFAULT 2,
  "tolerance_price_pct" numeric(7,4) NOT NULL DEFAULT 2,
  "tolerance_tax_amount" numeric(18,2) NOT NULL DEFAULT 1,
  "over_receipt_pct" numeric(7,4) NOT NULL DEFAULT 0,
  "rfq_min_suppliers_above" numeric(18,2),
  "msme_alert_days" integer NOT NULL DEFAULT 7,
  "itc_180_alert_days" integer NOT NULL DEFAULT 15,
  "eval_w_quality" numeric(7,4) NOT NULL DEFAULT 40,
  "eval_w_delivery" numeric(7,4) NOT NULL DEFAULT 30,
  "eval_w_cost" numeric(7,4) NOT NULL DEFAULT 20,
  "eval_w_response" numeric(7,4) NOT NULL DEFAULT 10,
  "grade_a_min" numeric(7,4) NOT NULL DEFAULT 85,
  "grade_b_min" numeric(7,4) NOT NULL DEFAULT 70,
  "grade_c_min" numeric(7,4) NOT NULL DEFAULT 50,
  "delivery_floor" numeric(7,4) NOT NULL DEFAULT 70,
  "msme_bank_rate_pct" numeric(7,4),
  "tds_194q_applicable" boolean NOT NULL DEFAULT false,
  "post_on_approve" boolean NOT NULL DEFAULT true,
  "needs_review" boolean NOT NULL DEFAULT true,
  "version" integer NOT NULL DEFAULT 1,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "scm_settings_single_chk" CHECK ("id" = 1)
);
CREATE INDEX "scm_settings_updated_by_idx" ON "scm_settings"("updated_by_id");
INSERT INTO "scm_settings" ("id") VALUES (1);

CREATE TABLE "scm_unit_settings" (
  "unit_id" uuid PRIMARY KEY REFERENCES "units"("id") ON DELETE CASCADE,
  "qc_hold_warehouse_id" uuid REFERENCES "warehouses"("id") ON DELETE RESTRICT,
  "version" integer NOT NULL DEFAULT 1,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL
);
CREATE INDEX "scm_unit_settings_wh_idx" ON "scm_unit_settings"("qc_hold_warehouse_id");
CREATE INDEX "scm_unit_settings_updated_by_idx" ON "scm_unit_settings"("updated_by_id");

CREATE TABLE "supplier_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "supplier_id" uuid NOT NULL REFERENCES "suppliers"("id") ON DELETE RESTRICT,
  "item_id" uuid NOT NULL REFERENCES "items"("id") ON DELETE RESTRICT,
  "last_price" numeric(18,6),
  "lead_days" integer,
  "quality_hold" boolean NOT NULL DEFAULT false,
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL
);
CREATE UNIQUE INDEX "supplier_items_uq" ON "supplier_items"("supplier_id","item_id");
CREATE INDEX "supplier_items_item_idx" ON "supplier_items"("item_id");
CREATE INDEX "supplier_items_created_by_idx" ON "supplier_items"("created_by_id");
CREATE INDEX "supplier_items_updated_by_idx" ON "supplier_items"("updated_by_id");

CREATE TABLE "scm_budgets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "fy_id" uuid NOT NULL REFERENCES "financial_years"("id") ON DELETE RESTRICT,
  "cost_center_id" uuid NOT NULL REFERENCES "cost_centers"("id") ON DELETE RESTRICT,
  "amount" numeric(18,2) NOT NULL,
  "mode" varchar(6) NOT NULL DEFAULT 'OFF',
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "scm_budgets_mode_chk" CHECK ("mode" IN ('OFF','WARN','BLOCK'))
);
CREATE UNIQUE INDEX "scm_budgets_uq" ON "scm_budgets"("unit_id","fy_id","cost_center_id");
CREATE INDEX "scm_budgets_fy_idx" ON "scm_budgets"("fy_id");
CREATE INDEX "scm_budgets_cc_idx" ON "scm_budgets"("cost_center_id");
CREATE INDEX "scm_budgets_created_by_idx" ON "scm_budgets"("created_by_id");
CREATE INDEX "scm_budgets_updated_by_idx" ON "scm_budgets"("updated_by_id");

CREATE TABLE "purchase_contracts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "fy_id" uuid NOT NULL REFERENCES "financial_years"("id") ON DELETE RESTRICT,
  "number" varchar(40),
  "department" varchar(60) NOT NULL DEFAULT '',
  "status" varchar(20) NOT NULL DEFAULT 'Draft',
  "supplier_id" uuid NOT NULL REFERENCES "suppliers"("id") ON DELETE RESTRICT,
  "title" varchar(150) NOT NULL DEFAULT '',
  "valid_from" date NOT NULL,
  "valid_to" date NOT NULL,
  "contract_type" varchar(10) NOT NULL DEFAULT 'RATE',
  "max_value" numeric(18,2),
  "released_value" numeric(18,2) NOT NULL DEFAULT 0,
  "notes" varchar(500),
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "deleted_at" timestamptz(3),
  "deleted_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "purchase_contracts_status_chk" CHECK ("status" IN ('Draft','Pending Approval','Approved','Rejected','Posted','Cancelled')),
  CONSTRAINT "purchase_contracts_type_chk" CHECK ("contract_type" IN ('RATE','BLANKET')),
  CONSTRAINT "purchase_contracts_dates_chk" CHECK ("valid_to" >= "valid_from")
);
CREATE UNIQUE INDEX "purchase_contracts_number_uq" ON "purchase_contracts"("unit_id","fy_id","number") WHERE "number" IS NOT NULL;
CREATE INDEX "purchase_contracts_unit_idx" ON "purchase_contracts"("unit_id");
CREATE INDEX "purchase_contracts_fy_idx" ON "purchase_contracts"("fy_id");
CREATE INDEX "purchase_contracts_status_idx" ON "purchase_contracts"("status");
CREATE INDEX "purchase_contracts_created_by_idx" ON "purchase_contracts"("created_by_id");
CREATE INDEX "purchase_contracts_updated_by_idx" ON "purchase_contracts"("updated_by_id");
CREATE INDEX "purchase_contracts_deleted_by_idx" ON "purchase_contracts"("deleted_by_id");

CREATE INDEX "purchase_contracts_supplier_idx" ON "purchase_contracts"("supplier_id","status");

CREATE TABLE "purchase_contract_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "contract_id" uuid NOT NULL REFERENCES "purchase_contracts"("id") ON DELETE CASCADE,
  "line_no" integer NOT NULL,
  "item_id" uuid NOT NULL REFERENCES "items"("id") ON DELETE RESTRICT,
  "uom" varchar(20) NOT NULL,
  "rate" numeric(18,6) NOT NULL,
  "discount_pct" numeric(7,4) NOT NULL DEFAULT 0,
  "min_qty" numeric(18,3),
  "max_qty" numeric(18,3),
  "released_qty" numeric(18,3) NOT NULL DEFAULT 0,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "purchase_contract_lines_qty_chk" CHECK ("released_qty" >= 0 AND ("max_qty" IS NULL OR "min_qty" IS NULL OR "max_qty" >= "min_qty"))
);
CREATE INDEX "purchase_contract_lines_contract_id_idx" ON "purchase_contract_lines"("contract_id");
CREATE INDEX "purchase_contract_lines_item_id_idx" ON "purchase_contract_lines"("item_id");

-- Lookups (ON CONFLICT DO NOTHING). The document-number prefixes live in DOC_PREFIX (NumberingService);
-- this repository has no document_types table.
INSERT INTO "stock_voucher_types" ("code","name","direction") VALUES
  ('GRN','Goods receipt','IN'),
  ('GRN_QC','Goods receipt QC decision','BOTH'),
  ('PUTAWAY','Put-away','BOTH'),
  ('PURCH_RETURN','Purchase return','OUT')
ON CONFLICT DO NOTHING;

-- Account key ITC_REVERSED_180 (E-22). LANDED_COST_CLEARING and ITC_INELIGIBLE_EXPENSE already map (Phase 7).
INSERT INTO "accounts" ("code","name","parent_id","is_group","root_type","normal_balance","sub_type","posting_allowed","cost_center_required","party_required","control_side","cf_class","is_system")
SELECT '6272','ITC Reversed - Rule 37 (180 days unpaid)', p."id", false, 'Expense','Debit','Other', true, false, false, NULL, 'NA', true
  FROM "accounts" p WHERE p."code" = '6260'
ON CONFLICT DO NOTHING;
INSERT INTO "account_defaults" ("key","account_id")
SELECT 'ITC_REVERSED_180', a."id" FROM "accounts" a WHERE a."code" = '6272'
ON CONFLICT DO NOTHING;
INSERT INTO "posting_rules" ("event","line_key","seq","description","account_selector","account_ref","condition") VALUES
 ('*','ITC_REVERSED_180',99,'ITC reversed - Rule 37','FIXED_CODE','6272',NULL),
 ('*','LANDED_COST_CLEARING',99,'Landed cost clearing','FIXED_CODE','2151',NULL),
 ('*','ITC_INELIGIBLE_EXPENSE',99,'Ineligible GST credit expensed','FIXED_CODE','6269',NULL)
ON CONFLICT DO NOTHING;
