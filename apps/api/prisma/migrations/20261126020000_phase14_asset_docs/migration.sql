-- Phase 14 (asset documents, section 4): capitalisation (AS 10 cost lines), allocation, transfer (inter-unit posts), disposal
-- (s.18(6) memo), shift usage, revaluation / impairment placeholders, QR labels and scans, physical verification. Forward-only.

CREATE TABLE "asset_capitalisations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "fy_id" uuid REFERENCES "financial_years"("id") ON DELETE RESTRICT,
  "cap_no" varchar(40) NOT NULL,
  "asset_id" uuid NOT NULL REFERENCES "assets"("id") ON DELETE RESTRICT,
  "capitalisation_date" date NOT NULL,
  "source" varchar(14) NOT NULL DEFAULT 'PURCHASE',
  "total_cost" numeric(18,2) NOT NULL DEFAULT 0,
  "residual_override_pct" numeric(7,4),
  "residual_justification" varchar(300),
  "approval_status" varchar(10) NOT NULL DEFAULT 'DRAFT',
  "approved_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "journal_id" uuid,
  "status" varchar(10) NOT NULL DEFAULT 'DRAFT',
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "deleted_at" timestamptz(3),
  CONSTRAINT "acap_source_chk" CHECK ("source" IN ('PURCHASE','CWIP','OPENING_IMPORT')),
  CONSTRAINT "acap_appr_chk" CHECK ("approval_status" IN ('DRAFT','PENDING','APPROVED','REJECTED')),
  CONSTRAINT "acap_status_chk" CHECK ("status" IN ('DRAFT','POSTED','CANCELLED'))
);
CREATE UNIQUE INDEX "acap_no_uq" ON "asset_capitalisations"("cap_no");
CREATE INDEX "acap_asset_idx" ON "asset_capitalisations"("asset_id");
CREATE INDEX "acap_unit_idx" ON "asset_capitalisations"("unit_id","status");
CREATE INDEX "acap_fy_idx" ON "asset_capitalisations"("fy_id");

CREATE TABLE "asset_cap_cost_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "cap_id" uuid NOT NULL REFERENCES "asset_capitalisations"("id") ON DELETE CASCADE,
  "component" varchar(14) NOT NULL,
  "source_doc_ref" varchar(60),
  "amount" numeric(18,2) NOT NULL,
  "gl_source_account" varchar(20) NOT NULL,
  "gst_amount" numeric(18,2) NOT NULL DEFAULT 0,
  "gst_added_to_cost" boolean NOT NULL DEFAULT false,
  CONSTRAINT "accl_comp_chk" CHECK ("component" IN ('BASE','FREIGHT','INSTALLATION','TESTING','PROF_FEE','OTHER')),
  CONSTRAINT "accl_amt_chk" CHECK ("amount" >= 0 AND "gst_amount" >= 0)
);
CREATE INDEX "accl_cap_idx" ON "asset_cap_cost_lines"("cap_id");

CREATE TABLE "asset_allocations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "alloc_no" varchar(40) NOT NULL,
  "asset_id" uuid NOT NULL REFERENCES "assets"("id") ON DELETE RESTRICT,
  "employee_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "department" varchar(60),
  "location" varchar(120),
  "allocated_on" date NOT NULL DEFAULT CURRENT_DATE,
  "condition_out" varchar(120),
  "handover_doc" varchar(120),
  "return_due" date,
  "returned_on" date,
  "condition_in" varchar(120),
  "status" varchar(10) NOT NULL DEFAULT 'ALLOCATED',
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "deleted_at" timestamptz(3),
  CONSTRAINT "aal_status_chk" CHECK ("status" IN ('ALLOCATED','RETURNED')),
  CONSTRAINT "aal_who_chk" CHECK ("employee_id" IS NOT NULL OR "department" IS NOT NULL OR "location" IS NOT NULL)
);
CREATE UNIQUE INDEX "aal_no_uq" ON "asset_allocations"("alloc_no");
CREATE UNIQUE INDEX "aal_one_open_uq" ON "asset_allocations"("asset_id") WHERE "status" = 'ALLOCATED' AND "deleted_at" IS NULL;
CREATE INDEX "aal_unit_idx" ON "asset_allocations"("unit_id","status");
CREATE INDEX "aal_emp_idx" ON "asset_allocations"("employee_id");

CREATE TABLE "asset_transfers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "fy_id" uuid REFERENCES "financial_years"("id") ON DELETE RESTRICT,
  "tr_no" varchar(40) NOT NULL,
  "asset_id" uuid NOT NULL REFERENCES "assets"("id") ON DELETE RESTRICT,
  "from_unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "to_unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "to_location" varchar(120),
  "to_employee_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "to_cost_centre_id" uuid REFERENCES "cost_centers"("id") ON DELETE SET NULL,
  "request_date" date NOT NULL DEFAULT CURRENT_DATE,
  "transfer_date" date,
  "approval_status" varchar(10) NOT NULL DEFAULT 'DRAFT',
  "approved_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "condition" varchar(120),
  "verified_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "journal_out_id" uuid,
  "journal_in_id" uuid,
  "status" varchar(10) NOT NULL DEFAULT 'DRAFT',
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "deleted_at" timestamptz(3),
  CONSTRAINT "atr_appr_chk" CHECK ("approval_status" IN ('DRAFT','PENDING','APPROVED','REJECTED')),
  CONSTRAINT "atr_status_chk" CHECK ("status" IN ('DRAFT','COMPLETED','CANCELLED'))
);
CREATE UNIQUE INDEX "atr_no_uq" ON "asset_transfers"("tr_no");
CREATE INDEX "atr_asset_idx" ON "asset_transfers"("asset_id");
CREATE INDEX "atr_unit_idx" ON "asset_transfers"("unit_id","status");
CREATE INDEX "atr_from_idx" ON "asset_transfers"("from_unit_id");
CREATE INDEX "atr_to_idx" ON "asset_transfers"("to_unit_id");
CREATE INDEX "atr_emp_idx" ON "asset_transfers"("to_employee_id");
CREATE INDEX "atr_cc_idx" ON "asset_transfers"("to_cost_centre_id");

CREATE TABLE "asset_shift_usage" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "asset_id" uuid NOT NULL REFERENCES "assets"("id") ON DELETE CASCADE,
  "period" char(7) NOT NULL,
  "single_days" integer NOT NULL DEFAULT 0,
  "double_days" integer NOT NULL DEFAULT 0,
  "triple_days" integer NOT NULL DEFAULT 0,
  CONSTRAINT "asu_period_chk" CHECK ("period" ~ '^[0-9]{4}-[0-9]{2}$'),
  CONSTRAINT "asu_days_chk" CHECK ("single_days" >= 0 AND "double_days" >= 0 AND "triple_days" >= 0 AND "single_days" + "double_days" + "triple_days" <= 31)
);
CREATE UNIQUE INDEX "asu_uq" ON "asset_shift_usage"("asset_id","period");

CREATE TABLE "asset_disposals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "fy_id" uuid REFERENCES "financial_years"("id") ON DELETE RESTRICT,
  "disp_no" varchar(40) NOT NULL,
  "asset_id" uuid NOT NULL REFERENCES "assets"("id") ON DELETE RESTRICT,
  "method" varchar(10) NOT NULL,
  "request_date" date NOT NULL DEFAULT CURRENT_DATE,
  "disposal_date" date,
  "buyer" varchar(160),
  "sale_value" numeric(18,2) NOT NULL DEFAULT 0,
  "gst_on_sale" numeric(18,2) NOT NULL DEFAULT 0,
  "proceeds_account" varchar(20),
  "itc_taken" numeric(18,2) NOT NULL DEFAULT 0,
  "quarters_used" integer NOT NULL DEFAULT 0,
  "s18_6_calc" numeric(18,2),
  "s18_6_payable_extra" numeric(18,2),
  "nbv_at_disposal" numeric(18,2),
  "gain_loss" numeric(18,2),
  "approval_status" varchar(10) NOT NULL DEFAULT 'DRAFT',
  "approved_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "journal_id" uuid,
  "status" varchar(10) NOT NULL DEFAULT 'DRAFT',
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "deleted_at" timestamptz(3),
  CONSTRAINT "adsp_method_chk" CHECK ("method" IN ('SALE','SCRAP','WRITE_OFF','DONATION')),
  CONSTRAINT "adsp_appr_chk" CHECK ("approval_status" IN ('DRAFT','PENDING','APPROVED','REJECTED')),
  CONSTRAINT "adsp_status_chk" CHECK ("status" IN ('DRAFT','POSTED','CANCELLED')),
  CONSTRAINT "adsp_amt_chk" CHECK ("sale_value" >= 0 AND "gst_on_sale" >= 0 AND "itc_taken" >= 0 AND "quarters_used" >= 0)
);
CREATE UNIQUE INDEX "adsp_no_uq" ON "asset_disposals"("disp_no");
CREATE INDEX "adsp_asset_idx" ON "asset_disposals"("asset_id");
CREATE INDEX "adsp_unit_idx" ON "asset_disposals"("unit_id","status");
CREATE INDEX "adsp_fy_idx" ON "asset_disposals"("fy_id");

-- tables only: the methods throw NOT_IN_SCOPE
CREATE TABLE "asset_revaluations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "asset_id" uuid NOT NULL REFERENCES "assets"("id") ON DELETE RESTRICT,
  "reval_date" date NOT NULL,
  "fair_value" numeric(18,2) NOT NULL,
  "created_at" timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX "arv_asset_idx" ON "asset_revaluations"("asset_id");
CREATE TABLE "asset_impairments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "asset_id" uuid NOT NULL REFERENCES "assets"("id") ON DELETE RESTRICT,
  "impairment_date" date NOT NULL,
  "recoverable_amount" numeric(18,2) NOT NULL,
  "created_at" timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX "aim_asset_idx" ON "asset_impairments"("asset_id");

CREATE TABLE "asset_qr_labels" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "asset_id" uuid NOT NULL REFERENCES "assets"("id") ON DELETE CASCADE,
  "token" varchar(40) NOT NULL,
  "printed_at" timestamptz(3) NOT NULL DEFAULT now(),
  "printed_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "reprint_of_id" uuid REFERENCES "asset_qr_labels"("id") ON DELETE SET NULL
);
CREATE INDEX "aql_asset_idx" ON "asset_qr_labels"("asset_id");
CREATE INDEX "aql_reprint_idx" ON "asset_qr_labels"("reprint_of_id");

CREATE TABLE "asset_scans" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "asset_id" uuid REFERENCES "assets"("id") ON DELETE CASCADE,
  "token" varchar(40) NOT NULL,
  "scanned_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "scanned_at" timestamptz(3) NOT NULL DEFAULT now(),
  "location" varchar(120),
  "purpose" varchar(10) NOT NULL DEFAULT 'VIEW',
  "valid" boolean NOT NULL DEFAULT true,
  CONSTRAINT "ascn_purpose_chk" CHECK ("purpose" IN ('VIEW','VERIFY','BREAKDOWN'))
);
CREATE INDEX "ascn_asset_idx" ON "asset_scans"("asset_id","scanned_at");
CREATE INDEX "ascn_user_idx" ON "asset_scans"("scanned_by_id");

CREATE TABLE "physical_verifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "pv_no" varchar(40) NOT NULL,
  "title" varchar(160) NOT NULL,
  "started_on" date NOT NULL DEFAULT CURRENT_DATE,
  "closed_on" date,
  "status" varchar(10) NOT NULL DEFAULT 'OPEN',
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "deleted_at" timestamptz(3),
  CONSTRAINT "pv_status_chk" CHECK ("status" IN ('OPEN','CLOSED'))
);
CREATE UNIQUE INDEX "pv_no_uq" ON "physical_verifications"("pv_no");
CREATE INDEX "pv_unit_idx" ON "physical_verifications"("unit_id","status");
CREATE TABLE "physical_verification_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "pv_id" uuid NOT NULL REFERENCES "physical_verifications"("id") ON DELETE CASCADE,
  "asset_id" uuid NOT NULL REFERENCES "assets"("id") ON DELETE RESTRICT,
  "found" boolean,
  "condition" varchar(120),
  "location_found" varchar(120),
  "checked_at" timestamptz(3),
  "checked_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL
);
CREATE UNIQUE INDEX "pvl_uq" ON "physical_verification_lines"("pv_id","asset_id");
CREATE INDEX "pvl_asset_idx" ON "physical_verification_lines"("asset_id");
