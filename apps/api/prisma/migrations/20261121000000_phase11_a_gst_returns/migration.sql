-- Phase 11 / A: Indian taxation (docs/phases/PHASE-11.md). Forward-only. Statutory numbers are DATED DATA with
-- needs_review = true until the accountant signs them (R-11, E-16, E-30). Nothing here calls GSTN, the IRP,
-- the e-way bill portal or TRACES (R-12): files are produced, people enter the returned numbers.

-- ---- 11-A1 GST setup: filing frequency per registration ----------------------------------------------------------
ALTER TABLE "gst_registrations"
  ADD COLUMN "filing_frequency" varchar(8) NOT NULL DEFAULT 'MONTHLY',
  ADD CONSTRAINT "gst_registrations_freq_chk" CHECK ("filing_frequency" IN ('MONTHLY','QRMP'));

-- ---- statutory numbers as dated data ----------------------------------------------------------------------------
CREATE TABLE "tax_rules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "rule_key" varchar(40) NOT NULL,
  "description" varchar(200) NOT NULL,
  "value_num" numeric(18,4),
  "value_text" varchar(200),
  "effective_from" date NOT NULL,
  "effective_to" date,
  "needs_review" boolean NOT NULL DEFAULT true,
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "tax_rules_dates_chk" CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from")
);
CREATE UNIQUE INDEX "tax_rules_key_from_uq" ON "tax_rules"("rule_key","effective_from");
CREATE INDEX "tax_rules_updated_by_idx" ON "tax_rules"("updated_by_id");

INSERT INTO "tax_rules" ("rule_key","description","value_num","value_text","effective_from") VALUES
 ('GSTR1_DUE_DAY',        'GSTR-1 monthly due day of the next month',                      11,   NULL, '2017-07-01'),
 ('GSTR3B_DUE_DAY',       'GSTR-3B monthly due day of the next month',                     20,   NULL, '2017-07-01'),
 ('GST_INTEREST_PA',      'Interest on late GST payment, per year (%)',                    18,   NULL, '2017-07-01'),
 ('GST_ITC_INTEREST_PA',  'Interest on ITC wrongly availed and used, per year (%)',        24,   NULL, '2017-07-01'),
 ('GST_LATE_FEE_PER_DAY', 'Late fee per day, GSTR-3B/GSTR-1 with tax payable (CGST+SGST)',  50,   NULL, '2017-07-01'),
 ('GST_LATE_FEE_NIL_DAY', 'Late fee per day, nil return (CGST+SGST)',                      20,   NULL, '2017-07-01'),
 ('ITC_REVERSAL_DAYS',    'Supplier not paid within this many days: ITC reversed (rule 37)',180,  NULL, '2017-07-01'),
 ('EINV_REPORT_DAYS',     'E-invoice must be reported within this many days of the invoice',30,  NULL, '2017-07-01'),
 ('EINV_CANCEL_HOURS',    'E-invoice can be cancelled within this many hours of the ack',  24,   NULL, '2017-07-01'),
 ('EWB_KM_PER_DAY',       'E-way bill validity: kilometres per day',                       200,  NULL, '2017-07-01'),
 ('EWB_EXTEND_HOURS',     'E-way bill extension window, hours before / after expiry',     8,    NULL, '2017-07-01'),
 ('EWB_MIN_VALUE',        'E-way bill needed above this consignment value',                50000,NULL, '2017-07-01'),
 ('TDS_DEPOSIT_DUE_DAY',  'TDS deposit due day of the next month',                         7,    NULL, '2017-07-01'),
 ('TDS_LATE_DEDUCT_PM',   'Interest per month (or part) on TDS not deducted (%)',          1,    NULL, '2017-07-01'),
 ('TDS_LATE_DEPOSIT_PM',  'Interest per month (or part) on TDS deducted but not deposited (%)',1.5,NULL,'2017-07-01'),
 ('GSTR1_JSON_VERSION',   'Offline-tool JSON version string written into the GSTR-1 file', NULL, 'GST3.1.6', '2017-07-01'),
 ('GSTR1_B2CL_LIMIT',     'Inter-state B2C invoice value above which it goes to B2CL',     100000,NULL,'2017-07-01');

-- ---- return preparation and the GST-period lock (11-A2, A3, A10) ------------------------------------------------
CREATE TABLE "gst_returns" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "gstin" varchar(15) NOT NULL,
  "return_type" varchar(8) NOT NULL,
  "period_month" date NOT NULL,
  "status" varchar(10) NOT NULL DEFAULT 'Prepared',
  "snapshot" jsonb,
  "prepared_at" timestamptz(3) NOT NULL DEFAULT now(),
  "prepared_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "filed_on" date,
  "arn" varchar(40),
  "filed_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "version" integer NOT NULL DEFAULT 1,
  CONSTRAINT "gst_returns_type_chk" CHECK ("return_type" IN ('GSTR1','GSTR3B')),
  CONSTRAINT "gst_returns_status_chk" CHECK ("status" IN ('Prepared','Filed')),
  CONSTRAINT "gst_returns_month_chk" CHECK (EXTRACT(DAY FROM "period_month") = 1),
  CONSTRAINT "gst_returns_filed_chk" CHECK ("status" <> 'Filed' OR ("filed_on" IS NOT NULL AND "arn" IS NOT NULL))
);
CREATE UNIQUE INDEX "gst_returns_key_uq" ON "gst_returns"("gstin","return_type","period_month");
CREATE INDEX "gst_returns_unit_idx" ON "gst_returns"("unit_id");
CREATE INDEX "gst_returns_prepared_by_idx" ON "gst_returns"("prepared_by_id");
CREATE INDEX "gst_returns_filed_by_idx" ON "gst_returns"("filed_by_id");

-- tax_documents carry what the returns need: the original document of a note, the source row and the IRN
ALTER TABLE "tax_documents"
  ADD COLUMN "orig_doc_no" varchar(60),
  ADD COLUMN "orig_doc_date" date,
  ADD COLUMN "source_type" varchar(30),
  ADD COLUMN "source_id" uuid,
  ADD COLUMN "gstin" varchar(15);
CREATE INDEX "tax_documents_source_idx" ON "tax_documents"("source_type","source_id");
CREATE INDEX "tax_documents_gstin_date_idx" ON "tax_documents"("gstin","doc_date");

-- ---- 11-A4 GSTR-2B import and ITC matching ---------------------------------------------------------------------
CREATE TABLE "gstr2b_imports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "gstin" varchar(15) NOT NULL,
  "period_month" date NOT NULL,
  "source_name" varchar(200),
  "line_count" integer NOT NULL DEFAULT 0,
  "imported_at" timestamptz(3) NOT NULL DEFAULT now(),
  "imported_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL
);
CREATE INDEX "gstr2b_imports_key_idx" ON "gstr2b_imports"("gstin","period_month");
CREATE INDEX "gstr2b_imports_unit_idx" ON "gstr2b_imports"("unit_id");
CREATE INDEX "gstr2b_imports_by_idx" ON "gstr2b_imports"("imported_by_id");

CREATE TABLE "gstr2b_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "import_id" uuid NOT NULL REFERENCES "gstr2b_imports"("id") ON DELETE CASCADE,
  "supplier_gstin" varchar(15) NOT NULL,
  "supplier_name" varchar(200),
  "doc_kind" varchar(3) NOT NULL DEFAULT 'INV',
  "doc_no" varchar(60) NOT NULL,
  "doc_no_norm" varchar(60) NOT NULL,
  "doc_date" date NOT NULL,
  "taxable" numeric(18,2) NOT NULL DEFAULT 0,
  "cgst" numeric(18,2) NOT NULL DEFAULT 0,
  "sgst" numeric(18,2) NOT NULL DEFAULT 0,
  "igst" numeric(18,2) NOT NULL DEFAULT 0,
  "cess" numeric(18,2) NOT NULL DEFAULT 0,
  "itc_available" boolean NOT NULL DEFAULT true,
  "itc_reason" varchar(200),
  "match_status" varchar(14) NOT NULL DEFAULT 'EXTRA',
  "invoice_id" uuid REFERENCES "purchase_invoices"("id") ON DELETE SET NULL,
  "diff_note" varchar(300),
  CONSTRAINT "gstr2b_lines_kind_chk" CHECK ("doc_kind" IN ('INV','CRN','DBN')),
  CONSTRAINT "gstr2b_lines_match_chk" CHECK ("match_status" IN ('MATCHED','MISMATCH','EXTRA'))
);
CREATE INDEX "gstr2b_lines_import_idx" ON "gstr2b_lines"("import_id");
CREATE INDEX "gstr2b_lines_invoice_idx" ON "gstr2b_lines"("invoice_id");
CREATE INDEX "gstr2b_lines_supplier_idx" ON "gstr2b_lines"("supplier_gstin","doc_no_norm");

-- itc_reversals (Phase 9) is only ALTERed here (E-23)
ALTER TABLE "itc_reversals" DROP CONSTRAINT "itc_reversals_kind_chk";
ALTER TABLE "itc_reversals" ADD CONSTRAINT "itc_reversals_kind_chk"
  CHECK ("kind" IN ('R37_REVERSE','R37_RECLAIM','R37A','S17_5','MANUAL'));
ALTER TABLE "itc_reversals" ALTER COLUMN "invoice_id" DROP NOT NULL;
ALTER TABLE "itc_reversals" ADD COLUMN "note" varchar(300);

-- ---- 11-A5 e-invoice (manual IRN entry; no call to the IRP) ------------------------------------------------------
CREATE TABLE "einvoice_records" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "doc_type" varchar(3) NOT NULL,
  "doc_id" uuid NOT NULL,
  "doc_no" varchar(60) NOT NULL,
  "doc_date" date NOT NULL,
  "irn" varchar(64),
  "ack_no" varchar(30),
  "ack_date" timestamptz(3),
  "signed_qr" text,
  "status" varchar(10) NOT NULL DEFAULT 'Generated',
  "late_reported" boolean NOT NULL DEFAULT false,
  "cancelled_at" timestamptz(3),
  "cancel_reason" varchar(300),
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "einvoice_doc_type_chk" CHECK ("doc_type" IN ('INV','CRN')),
  CONSTRAINT "einvoice_status_chk" CHECK ("status" IN ('Generated','Cancelled'))
);
CREATE UNIQUE INDEX "einvoice_live_doc_uq" ON "einvoice_records"("doc_type","doc_id") WHERE "status" = 'Generated';
CREATE UNIQUE INDEX "einvoice_irn_uq" ON "einvoice_records"("irn") WHERE "irn" IS NOT NULL AND "status" = 'Generated';
CREATE INDEX "einvoice_unit_idx" ON "einvoice_records"("unit_id");
CREATE INDEX "einvoice_created_by_idx" ON "einvoice_records"("created_by_id");

-- ---- 11-A6 e-way bill (manual number entry) ---------------------------------------------------------------------
CREATE TABLE "eway_bills" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "invoice_id" uuid NOT NULL REFERENCES "sales_invoices"("id") ON DELETE RESTRICT,
  "ewb_no" varchar(20) NOT NULL,
  "ewb_date" timestamptz(3) NOT NULL,
  "distance_km" integer NOT NULL,
  "valid_until" timestamptz(3) NOT NULL,
  "vehicle_no" varchar(20),
  "transporter" varchar(120),
  "transporter_id" varchar(15),
  "extensions" integer NOT NULL DEFAULT 0,
  "status" varchar(10) NOT NULL DEFAULT 'Active',
  "cancelled_at" timestamptz(3),
  "cancel_reason" varchar(300),
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "eway_status_chk" CHECK ("status" IN ('Active','Cancelled')),
  CONSTRAINT "eway_distance_chk" CHECK ("distance_km" > 0)
);
CREATE UNIQUE INDEX "eway_no_uq" ON "eway_bills"("ewb_no") WHERE "status" = 'Active';
CREATE INDEX "eway_invoice_idx" ON "eway_bills"("invoice_id");
CREATE INDEX "eway_unit_idx" ON "eway_bills"("unit_id");
CREATE INDEX "eway_created_by_idx" ON "eway_bills"("created_by_id");
ALTER TABLE "sales_invoices" ADD COLUMN "ewb_no" varchar(20);

-- ---- 11-A7 lower-deduction certificates --------------------------------------------------------------------------
CREATE TABLE "lower_deduction_certs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "supplier_id" uuid NOT NULL REFERENCES "suppliers"("id") ON DELETE RESTRICT,
  "section_code" varchar(12) NOT NULL,
  "cert_no" varchar(40) NOT NULL,
  "rate_pct" numeric(7,4) NOT NULL,
  "valid_from" date NOT NULL,
  "valid_to" date NOT NULL,
  "max_amount" numeric(18,2),
  "needs_review" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "ldc_dates_chk" CHECK ("valid_to" >= "valid_from"),
  CONSTRAINT "ldc_rate_chk" CHECK ("rate_pct" >= 0 AND "rate_pct" <= 100)
);
CREATE UNIQUE INDEX "ldc_cert_uq" ON "lower_deduction_certs"("cert_no");
CREATE INDEX "ldc_supplier_idx" ON "lower_deduction_certs"("supplier_id","section_code");
CREATE INDEX "ldc_created_by_idx" ON "lower_deduction_certs"("created_by_id");

-- ---- 11-A9 GST settlement ----------------------------------------------------------------------------------------
CREATE TABLE "gst_settlements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "gstin" varchar(15) NOT NULL,
  "period_month" date NOT NULL,
  "set_off" jsonb NOT NULL,
  "cash_paid" numeric(18,2) NOT NULL DEFAULT 0,
  "interest" numeric(18,2) NOT NULL DEFAULT 0,
  "late_fee" numeric(18,2) NOT NULL DEFAULT 0,
  "challan_no" varchar(40),
  "bank_account_id" uuid REFERENCES "bank_accounts"("id") ON DELETE RESTRICT,
  "journal_id" uuid REFERENCES "journals"("id") ON DELETE RESTRICT,
  "status" varchar(10) NOT NULL DEFAULT 'Posted',
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "gst_settlements_status_chk" CHECK ("status" IN ('Posted','Cancelled'))
);
CREATE UNIQUE INDEX "gst_settlements_live_uq" ON "gst_settlements"("gstin","period_month") WHERE "status" = 'Posted';
CREATE INDEX "gst_settlements_unit_idx" ON "gst_settlements"("unit_id");
CREATE INDEX "gst_settlements_bank_idx" ON "gst_settlements"("bank_account_id");
CREATE INDEX "gst_settlements_journal_idx" ON "gst_settlements"("journal_id");
CREATE INDEX "gst_settlements_created_by_idx" ON "gst_settlements"("created_by_id");
