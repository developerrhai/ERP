-- Phase 20-G (Opening balances cut-over & sign-offs), 20-H (user preferred_locale), 20-J (DPDP Rules compliance).

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "preferred_locale" varchar(8) NOT NULL DEFAULT 'en';

-- Extend Phase 15 privacy_notices with grievance officer & needs_review metadata + En/Hi/Mr translations table.
ALTER TABLE "privacy_notices"
  ADD COLUMN IF NOT EXISTS "grievance_officer_name" varchar(120) NOT NULL DEFAULT 'Data Protection & Grievance Officer — Sawant Group',
  ADD COLUMN IF NOT EXISTS "grievance_officer_email" varchar(200) NOT NULL DEFAULT 'privacy@sawantgroup.example',
  ADD COLUMN IF NOT EXISTS "grievance_officer_phone" varchar(40) NOT NULL DEFAULT '+91-20-0000-0000',
  ADD COLUMN IF NOT EXISTS "needs_review" boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS "privacy_notice_translations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "notice_id" uuid NOT NULL REFERENCES "privacy_notices"("id") ON DELETE CASCADE,
  "locale" varchar(8) NOT NULL CHECK ("locale" IN ('en', 'hi', 'mr')),
  "title" varchar(200) NOT NULL,
  "text_md" text NOT NULL,
  UNIQUE ("notice_id", "locale")
);

INSERT INTO "privacy_notice_translations" ("notice_id", "locale", "title", "text_md")
SELECT n.id, v.locale, v.title, v.text_md
FROM "privacy_notices" n
CROSS JOIN (
  VALUES
    (
      'en',
      'Sawant Group ERP — Data Privacy Notice (DPDP Act, 2023)',
      E'We process personal data solely for lawful business, statutory compliance (GST, TDS, EPF, ESIC, PT), employment administration (legitimate use under Section 7(i)), and contract fulfilment.\n\nData Principals (customers, suppliers, contacts, employees) may exercise rights of Access, Correction, Erasure, and Grievance Redressal via System > DPDP Privacy & Requests (30-day SLA). Statutory books of account (8 years) and GST records (72 months) are retained strictly as mandated by Indian law.\n\n[Legal Notice: Review by Company Legal Counsel / CA before 13-May-2027 — needs_review]'
    ),
    (
      'hi',
      'सावंत ग्रुप ईआरपी — डेटा गोपनीयता सूचना (DPDP अधिनियम, 2023)',
      E'हम व्यक्तिगत डेटा का प्रसंस्करण केवल वैध व्यावसायिक संचालन, वैधानिक अनुपालन (GST, TDS, EPF, ESIC, PT), रोजगार प्रशासन और अनुबंध पूर्ति के लिए करते हैं।\n\nडेटा स्वामी 30-दिन के SLA के भीतर पहुंच, सुधार, विलोपन और शिकायत निवारण का अनुरोध कर सकते हैं। [समीक्षा आवश्यक — needs_review]'
    ),
    (
      'mr',
      'सावंत ग्रुप ईआरपी — डेटा गोपनीयता सूचना (DPDP कायदा, 2023)',
      E'आम्ही वैयक्तिक डेटावर केवळ कायदेशीर व्यवसाय, वैधानिक पालन (GST, TDS, EPF, ESIC, PT), रोजगार प्रशासन आणि करार पूर्ततेसाठी प्रक्रिया करतो.\n\nडेटा मालक 30 दिवसांच्या SLA मध्ये प्रवेश, दुरुस्ती, हटवणे आणि तक्रार निवारणाची विनंती करू शकतात. [पुनरावलोकन आवश्यक — needs_review]'
    )
) AS v(locale, title, text_md)
WHERE n.version = 'v1.0'
ON CONFLICT ("notice_id", "locale") DO NOTHING;

-- Data-Principal Request Register (Access / Correction / Erasure, 30-day SLA)
CREATE TABLE IF NOT EXISTS "dpdp_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "request_no" varchar(32) NOT NULL UNIQUE,
  "request_type" varchar(16) NOT NULL CHECK ("request_type" IN ('ACCESS', 'CORRECTION', 'ERASURE')),
  "principal_type" varchar(24) NOT NULL CHECK ("principal_type" IN ('EMPLOYEE', 'CUSTOMER', 'SUPPLIER', 'CONTACT')),
  "principal_id" uuid,
  "principal_name" varchar(160) NOT NULL,
  "contact_email" varchar(254),
  "contact_phone" varchar(32),
  "description" text NOT NULL,
  "status" varchar(16) NOT NULL DEFAULT 'OPEN' CHECK ("status" IN ('OPEN', 'IN_PROGRESS', 'COMPLETED', 'REJECTED')),
  "due_at" timestamptz(3) NOT NULL,
  "resolved_at" timestamptz(3),
  "resolution_notes" text,
  "handled_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "anonymized_at" timestamptz(3),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "version" int NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS "dpdp_requests_status_due_idx" ON "dpdp_requests" ("status", "due_at");
CREATE INDEX IF NOT EXISTS "dpdp_requests_handled_by_idx" ON "dpdp_requests" ("handled_by_id");
CREATE INDEX IF NOT EXISTS "dpdp_requests_created_by_idx" ON "dpdp_requests" ("created_by_id");

CREATE TABLE IF NOT EXISTS "dpdp_retention_policies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "data_category" varchar(64) NOT NULL UNIQUE,
  "retention_days" int NOT NULL CHECK ("retention_days" > 0),
  "legal_basis" varchar(240) NOT NULL,
  "anonymize_enabled" boolean NOT NULL DEFAULT false,
  "needs_review" boolean NOT NULL DEFAULT true,
  "last_run_at" timestamptz(3),
  "last_affected_count" int NOT NULL DEFAULT 0,
  "updated_at" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO "dpdp_retention_policies" ("data_category", "retention_days", "legal_basis", "anonymize_enabled", "needs_review")
VALUES
  ('BOOKS_OF_ACCOUNT', 2920, 'Income-tax Act & Companies Act — 8 years (needs_review)', false, true),
  ('GST_RECORDS', 2190, 'CGST Act Section 36 — 72 months from annual return due date (needs_review)', false, true),
  ('EPF_ESI_PAYROLL', 2920, 'EPF & ESIC statutory registers retention (needs_review)', false, true),
  ('RECRUITMENT_CANDIDATES', 365, 'Unselected candidate resumes — anonymise after 365 days', true, true),
  ('ACCESS_AND_AUDIT_LOGS', 365, 'DPDP Rules security access log minimum >= 1 year (audit table retained 8 years)', false, true)
ON CONFLICT ("data_category") DO NOTHING;

-- Opening-balance cut-over batches and CFO/Dept-Head sign-off records (20-G)
CREATE TABLE IF NOT EXISTS "opening_cutover_batches" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "batch_no" varchar(32) NOT NULL UNIQUE,
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "fy_id" uuid NOT NULL REFERENCES "financial_years"("id") ON DELETE RESTRICT,
  "dataset" varchar(24) NOT NULL CHECK ("dataset" IN ('GL_TRIAL', 'STOCK', 'AR_OPEN', 'AP_OPEN', 'EMPLOYEES_YTD', 'ASSET_REGISTER', 'OPEN_PO_SO')),
  "source" varchar(16) NOT NULL DEFAULT 'OPENING',
  "status" varchar(16) NOT NULL DEFAULT 'DRY_RUN' CHECK ("status" IN ('DRY_RUN', 'VALIDATED', 'COMMITTED', 'SIGNED_OFF')),
  "total_rows" int NOT NULL DEFAULT 0,
  "valid_rows" int NOT NULL DEFAULT 0,
  "error_rows" int NOT NULL DEFAULT 0,
  "legacy_total" numeric(18,2) NOT NULL DEFAULT 0,
  "erp_total" numeric(18,2) NOT NULL DEFAULT 0,
  "difference" numeric(18,2) NOT NULL DEFAULT 0,
  "rows_payload" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "errors_payload" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "reconciliation_file_id" uuid REFERENCES "stored_files"("id") ON DELETE SET NULL,
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "committed_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "committed_at" timestamptz(3),
  "created_at" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "opening_cutover_batches_unit_fy_idx" ON "opening_cutover_batches" ("unit_id", "fy_id", "dataset");
CREATE INDEX IF NOT EXISTS "opening_cutover_batches_recon_file_idx" ON "opening_cutover_batches" ("reconciliation_file_id");
CREATE INDEX IF NOT EXISTS "opening_cutover_batches_created_by_idx" ON "opening_cutover_batches" ("created_by_id");
CREATE INDEX IF NOT EXISTS "opening_cutover_batches_committed_by_idx" ON "opening_cutover_batches" ("committed_by_id");

CREATE TABLE IF NOT EXISTS "opening_signoffs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "batch_id" uuid NOT NULL UNIQUE REFERENCES "opening_cutover_batches"("id") ON DELETE CASCADE,
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "fy_id" uuid NOT NULL REFERENCES "financial_years"("id") ON DELETE RESTRICT,
  "dataset" varchar(24) NOT NULL,
  "difference" numeric(18,2) NOT NULL CHECK ("difference" = 0),
  "cfo_signed_by_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "cfo_signed_at" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "dept_head_signed_by_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "dept_head_signed_at" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "dms_document_id" uuid REFERENCES "dms_documents"("id") ON DELETE SET NULL,
  "notes" text,
  "created_at" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "opening_signoffs_unit_fy_idx" ON "opening_signoffs" ("unit_id", "fy_id");
CREATE INDEX IF NOT EXISTS "opening_signoffs_cfo_idx" ON "opening_signoffs" ("cfo_signed_by_id");
CREATE INDEX IF NOT EXISTS "opening_signoffs_dept_head_idx" ON "opening_signoffs" ("dept_head_signed_by_id");
CREATE INDEX IF NOT EXISTS "opening_signoffs_dms_doc_idx" ON "opening_signoffs" ("dms_document_id");
