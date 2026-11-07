-- Phase 06 M4: suppliers (docs/phases/PHASE-06.md §4). A new supplier is PENDING until approved (R-06).
-- Client addition (E-32): supplier_type MATERIAL / CONTRACTOR.
CREATE TABLE "suppliers" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" VARCHAR(30) NOT NULL,
  "name" VARCHAR(150) NOT NULL,
  "legal_name" VARCHAR(200),
  "name_key" VARCHAR(200) NOT NULL,
  "supplier_type" VARCHAR(12) NOT NULL DEFAULT 'MATERIAL',
  "supplier_group_id" UUID REFERENCES "party_groups"("id") ON DELETE SET NULL,
  "gst_registration_type" VARCHAR(12) NOT NULL DEFAULT 'REGULAR',
  "gstin" VARCHAR(15),
  "pan" VARCHAR(10),
  "state_code" CHAR(2) NOT NULL REFERENCES "gst_states"("code"),
  "gstin_verified_on_portal" BOOLEAN NOT NULL DEFAULT false,
  "gstin_verified_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "gstin_verified_at" TIMESTAMPTZ(3),
  "currency_code" VARCHAR(3) NOT NULL DEFAULT 'INR',
  "payment_term_id" UUID REFERENCES "payment_terms"("id") ON DELETE SET NULL,
  "msme_udyam_no" VARCHAR(25),
  "msme_category" VARCHAR(10),
  "msme_activity" VARCHAR(15),
  "msme_agreed_days" SMALLINT,
  "msme_45day_applies" BOOLEAN GENERATED ALWAYS AS (
    "msme_category" IN ('MICRO','SMALL') AND "msme_activity" IS DISTINCT FROM 'TRADING'
  ) STORED,
  "tds_section_code" VARCHAR(10),
  "lower_tds_cert_no" VARCHAR(40),
  "lower_tds_rate" NUMERIC(7,4),
  "lower_tds_valid_to" DATE,
  "purchase_hold" BOOLEAN NOT NULL DEFAULT false,
  "hold_reason" VARCHAR(300),
  "ap_account_id" UUID,
  "approval_status" VARCHAR(10) NOT NULL DEFAULT 'PENDING',
  "status" VARCHAR(10) NOT NULL DEFAULT 'ACTIVE',
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "created_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "deleted_at" TIMESTAMPTZ(3),
  "deleted_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "suppliers_code_chk" CHECK ("code" ~ '^[A-Z0-9/_-]{2,30}$'),
  CONSTRAINT "suppliers_type_chk" CHECK ("supplier_type" IN ('MATERIAL','CONTRACTOR')),
  CONSTRAINT "suppliers_regtype_chk" CHECK ("gst_registration_type" IN ('REGULAR','COMPOSITION','UNREGISTERED','SEZ','OVERSEAS')),
  CONSTRAINT "suppliers_gstin_regtype_chk" CHECK (("gst_registration_type" IN ('UNREGISTERED','OVERSEAS')) = ("gstin" IS NULL)),
  CONSTRAINT "suppliers_gstin_pan_chk" CHECK ("gstin" IS NULL OR "pan" IS NULL OR substr("gstin", 3, 10) = "pan"),
  CONSTRAINT "suppliers_pan_chk" CHECK ("pan" IS NULL OR "pan" ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  CONSTRAINT "suppliers_udyam_chk" CHECK ("msme_udyam_no" IS NULL OR "msme_udyam_no" ~ '^UDYAM-[A-Z]{2}-[0-9]{2}-[0-9]{7}$'),
  CONSTRAINT "suppliers_msme_pair_chk" CHECK (("msme_udyam_no" IS NULL) = ("msme_category" IS NULL)),
  CONSTRAINT "suppliers_msme_category_chk" CHECK ("msme_category" IS NULL OR "msme_category" IN ('MICRO','SMALL','MEDIUM')),
  CONSTRAINT "suppliers_msme_activity_chk" CHECK ("msme_activity" IS NULL OR "msme_activity" IN ('MANUFACTURING','SERVICES','TRADING')),
  CONSTRAINT "suppliers_msme_days_chk" CHECK ("msme_agreed_days" IS NULL OR "msme_agreed_days" BETWEEN 1 AND 45),
  CONSTRAINT "suppliers_approval_chk" CHECK ("approval_status" IN ('PENDING','APPROVED','REJECTED')),
  CONSTRAINT "suppliers_status_chk" CHECK ("status" IN ('ACTIVE','INACTIVE'))
);
CREATE UNIQUE INDEX "suppliers_code_uq" ON "suppliers"("code") WHERE "deleted_at" IS NULL;
CREATE UNIQUE INDEX "suppliers_gstin_uq" ON "suppliers"("gstin") WHERE "gstin" IS NOT NULL AND "deleted_at" IS NULL;
CREATE INDEX "suppliers_pan_idx" ON "suppliers"("pan");
CREATE INDEX "suppliers_name_key_trgm_idx" ON "suppliers" USING gin ("name_key" gin_trgm_ops);
CREATE INDEX "suppliers_group_idx" ON "suppliers"("supplier_group_id");
CREATE INDEX "suppliers_state_idx" ON "suppliers"("state_code");
CREATE INDEX "suppliers_term_idx" ON "suppliers"("payment_term_id");
CREATE INDEX "suppliers_verified_by_idx" ON "suppliers"("gstin_verified_by_id");
CREATE INDEX "suppliers_created_by_idx" ON "suppliers"("created_by_id");
CREATE INDEX "suppliers_updated_by_idx" ON "suppliers"("updated_by_id");
CREATE INDEX "suppliers_deleted_by_idx" ON "suppliers"("deleted_by_id");

ALTER TABLE "customers"
  ADD CONSTRAINT "customers_linked_supplier_fk" FOREIGN KEY ("linked_supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL;

CREATE TABLE "supplier_addresses" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "supplier_id" UUID NOT NULL REFERENCES "suppliers"("id") ON DELETE CASCADE,
  "type" VARCHAR(10) NOT NULL,
  "label" VARCHAR(60),
  "line1" VARCHAR(200) NOT NULL,
  "line2" VARCHAR(200),
  "city" VARCHAR(100) NOT NULL,
  "district" VARCHAR(100),
  "pincode" VARCHAR(10),
  "state_code" CHAR(2) NOT NULL REFERENCES "gst_states"("code"),
  "country" VARCHAR(60) NOT NULL DEFAULT 'India',
  "gstin" VARCHAR(15),
  "is_default" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "supplier_addresses_type_chk" CHECK ("type" IN ('BILLING','SHIPPING'))
);
CREATE INDEX "supplier_addresses_supplier_idx" ON "supplier_addresses"("supplier_id");
CREATE INDEX "supplier_addresses_state_idx" ON "supplier_addresses"("state_code");

CREATE TABLE "supplier_contacts" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "supplier_id" UUID NOT NULL REFERENCES "suppliers"("id") ON DELETE CASCADE,
  "name" VARCHAR(100) NOT NULL,
  "designation" VARCHAR(80),
  "mobile" VARCHAR(15),
  "email" VARCHAR(254),
  "is_primary" BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX "supplier_contacts_supplier_idx" ON "supplier_contacts"("supplier_id");
CREATE INDEX "supplier_contacts_mobile_idx" ON "supplier_contacts"("mobile");
CREATE INDEX "supplier_contacts_email_idx" ON "supplier_contacts"("email");

-- Bank numbers: AES-GCM ciphertext + last 4 + HMAC. A changed account must be verified by ANOTHER user
-- (the database refuses self-verification).
CREATE TABLE "supplier_bank_accounts" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "supplier_id" UUID NOT NULL REFERENCES "suppliers"("id") ON DELETE CASCADE,
  "bank_id" UUID REFERENCES "banks"("id") ON DELETE SET NULL,
  "ifsc" VARCHAR(11) NOT NULL,
  "holder_name" VARCHAR(150) NOT NULL,
  "account_no_enc" TEXT NOT NULL,
  "account_last4" CHAR(4) NOT NULL,
  "account_hash" CHAR(64) NOT NULL,
  "is_default" BOOLEAN NOT NULL DEFAULT false,
  "changed_by_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "verified_by_id" UUID REFERENCES "users"("id") ON DELETE RESTRICT,
  "verified_at" TIMESTAMPTZ(3),
  CONSTRAINT "supplier_bank_accounts_ifsc_chk" CHECK ("ifsc" ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
  CONSTRAINT "supplier_bank_accounts_no_self_verify_chk" CHECK ("verified_by_id" IS NULL OR "verified_by_id" <> "changed_by_id")
);
CREATE INDEX "supplier_bank_accounts_supplier_idx" ON "supplier_bank_accounts"("supplier_id");
CREATE INDEX "supplier_bank_accounts_bank_idx" ON "supplier_bank_accounts"("bank_id");
CREATE INDEX "supplier_bank_accounts_hash_idx" ON "supplier_bank_accounts"("account_hash");
CREATE INDEX "supplier_bank_accounts_changed_by_idx" ON "supplier_bank_accounts"("changed_by_id");
CREATE INDEX "supplier_bank_accounts_verified_by_idx" ON "supplier_bank_accounts"("verified_by_id");

CREATE TABLE "supplier_documents" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "supplier_id" UUID NOT NULL REFERENCES "suppliers"("id") ON DELETE CASCADE,
  "doc_kind" VARCHAR(20) NOT NULL,
  "doc_no" VARCHAR(60),
  "valid_from" DATE,
  "valid_to" DATE,
  "document_id" UUID REFERENCES "record_documents"("id") ON DELETE SET NULL,
  CONSTRAINT "supplier_documents_kind_chk" CHECK ("doc_kind" IN ('GST_CERT','PAN','UDYAM','CANCELLED_CHEQUE','LOWER_TDS','ISO','OTHER')),
  CONSTRAINT "supplier_documents_dates_chk" CHECK ("valid_to" IS NULL OR "valid_from" IS NULL OR "valid_to" >= "valid_from")
);
CREATE INDEX "supplier_documents_supplier_idx" ON "supplier_documents"("supplier_id");
CREATE INDEX "supplier_documents_document_idx" ON "supplier_documents"("document_id");

-- Supplier codes SUP/00001 ... (plain sequence).
CREATE SEQUENCE "supplier_code_seq" START 1;
