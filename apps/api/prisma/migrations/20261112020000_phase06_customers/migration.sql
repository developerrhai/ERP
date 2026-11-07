-- Phase 06 M3: customers (docs/phases/PHASE-06.md §4). D-26: customers and suppliers are separate tables.
-- price_list_id / ar_account_id are plain uuid columns here: price_lists arrives in M6, accounts in Phase 7.
CREATE TABLE "customers" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" VARCHAR(30) NOT NULL,
  "name" VARCHAR(150) NOT NULL,
  "legal_name" VARCHAR(200),
  "name_key" VARCHAR(200) NOT NULL,
  "customer_group_id" UUID REFERENCES "party_groups"("id") ON DELETE SET NULL,
  "territory_id" UUID REFERENCES "territories"("id") ON DELETE SET NULL,
  "sales_person_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "gst_registration_type" VARCHAR(12) NOT NULL DEFAULT 'REGULAR',
  "gstin" VARCHAR(15),
  "pan" VARCHAR(10),
  "state_code" CHAR(2) NOT NULL REFERENCES "gst_states"("code"),
  "gstin_verified_on_portal" BOOLEAN NOT NULL DEFAULT false,
  "gstin_verified_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "gstin_verified_at" TIMESTAMPTZ(3),
  "currency_code" VARCHAR(3) NOT NULL DEFAULT 'INR',
  "payment_term_id" UUID REFERENCES "payment_terms"("id") ON DELETE SET NULL,
  "price_list_id" UUID,
  "credit_limit" NUMERIC(18,2),
  "credit_days" SMALLINT,
  "tier" CHAR(1) NOT NULL DEFAULT 'C',
  "linked_supplier_id" UUID,
  "ar_account_id" UUID,
  "approval_status" VARCHAR(10) NOT NULL DEFAULT 'APPROVED',
  "status" VARCHAR(10) NOT NULL DEFAULT 'ACTIVE',
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "created_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "deleted_at" TIMESTAMPTZ(3),
  "deleted_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "customers_code_chk" CHECK ("code" ~ '^[A-Z0-9/_-]{2,30}$'),
  CONSTRAINT "customers_regtype_chk" CHECK ("gst_registration_type" IN ('REGULAR','COMPOSITION','UNREGISTERED','SEZ','OVERSEAS')),
  CONSTRAINT "customers_gstin_regtype_chk" CHECK (("gst_registration_type" IN ('UNREGISTERED','OVERSEAS')) = ("gstin" IS NULL)),
  CONSTRAINT "customers_gstin_pan_chk" CHECK ("gstin" IS NULL OR "pan" IS NULL OR substr("gstin", 3, 10) = "pan"),
  CONSTRAINT "customers_pan_chk" CHECK ("pan" IS NULL OR "pan" ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  CONSTRAINT "customers_credit_chk" CHECK ("credit_limit" IS NULL OR "credit_limit" >= 0),
  CONSTRAINT "customers_credit_days_chk" CHECK ("credit_days" IS NULL OR "credit_days" BETWEEN 0 AND 365),
  CONSTRAINT "customers_tier_chk" CHECK ("tier" IN ('A','B','C','D')),
  CONSTRAINT "customers_approval_chk" CHECK ("approval_status" IN ('PENDING','APPROVED','REJECTED')),
  CONSTRAINT "customers_status_chk" CHECK ("status" IN ('ACTIVE','INACTIVE'))
);
CREATE UNIQUE INDEX "customers_code_uq" ON "customers"("code") WHERE "deleted_at" IS NULL;
CREATE UNIQUE INDEX "customers_gstin_uq" ON "customers"("gstin") WHERE "gstin" IS NOT NULL AND "deleted_at" IS NULL;
CREATE INDEX "customers_pan_idx" ON "customers"("pan");
CREATE INDEX "customers_name_key_trgm_idx" ON "customers" USING gin ("name_key" gin_trgm_ops);
CREATE INDEX "customers_group_idx" ON "customers"("customer_group_id");
CREATE INDEX "customers_territory_idx" ON "customers"("territory_id");
CREATE INDEX "customers_sales_person_idx" ON "customers"("sales_person_id");
CREATE INDEX "customers_state_idx" ON "customers"("state_code");
CREATE INDEX "customers_term_idx" ON "customers"("payment_term_id");
CREATE INDEX "customers_price_list_idx" ON "customers"("price_list_id");
CREATE INDEX "customers_linked_supplier_idx" ON "customers"("linked_supplier_id");
CREATE INDEX "customers_verified_by_idx" ON "customers"("gstin_verified_by_id");
CREATE INDEX "customers_created_by_idx" ON "customers"("created_by_id");
CREATE INDEX "customers_updated_by_idx" ON "customers"("updated_by_id");
CREATE INDEX "customers_deleted_by_idx" ON "customers"("deleted_by_id");

CREATE TABLE "customer_addresses" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "customer_id" UUID NOT NULL REFERENCES "customers"("id") ON DELETE CASCADE,
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
  CONSTRAINT "customer_addresses_type_chk" CHECK ("type" IN ('BILLING','SHIPPING'))
);
CREATE INDEX "customer_addresses_customer_idx" ON "customer_addresses"("customer_id");
CREATE INDEX "customer_addresses_state_idx" ON "customer_addresses"("state_code");

CREATE TABLE "customer_contacts" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "customer_id" UUID NOT NULL REFERENCES "customers"("id") ON DELETE CASCADE,
  "name" VARCHAR(100) NOT NULL,
  "designation" VARCHAR(80),
  "mobile" VARCHAR(15),
  "email" VARCHAR(254),
  "is_primary" BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX "customer_contacts_customer_idx" ON "customer_contacts"("customer_id");
CREATE INDEX "customer_contacts_mobile_idx" ON "customer_contacts"("mobile");
CREATE INDEX "customer_contacts_email_idx" ON "customer_contacts"("email");

CREATE TABLE "customer_credit_requests" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "customer_id" UUID NOT NULL REFERENCES "customers"("id") ON DELETE CASCADE,
  "old_limit" NUMERIC(18,2),
  "new_limit" NUMERIC(18,2),
  "old_days" SMALLINT,
  "new_days" SMALLINT,
  "reason" VARCHAR(500) NOT NULL,
  "approval_request_id" UUID REFERENCES "approval_requests"("id") ON DELETE SET NULL,
  "status" VARCHAR(10) NOT NULL DEFAULT 'PENDING',
  "requested_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "decided_at" TIMESTAMPTZ(3),
  CONSTRAINT "customer_credit_requests_status_chk" CHECK ("status" IN ('PENDING','APPROVED','REJECTED','WITHDRAWN'))
);
-- One open credit change per customer (CREDIT_PENDING).
CREATE UNIQUE INDEX "customer_credit_requests_one_pending_uq" ON "customer_credit_requests"("customer_id") WHERE "status" = 'PENDING';
CREATE INDEX "customer_credit_requests_approval_idx" ON "customer_credit_requests"("approval_request_id");
CREATE INDEX "customer_credit_requests_requested_by_idx" ON "customer_credit_requests"("requested_by_id");

-- Gap-free numbering is not needed for masters: a plain sequence gives CUS/00001, CUS/00002 ...
CREATE SEQUENCE "customer_code_seq" START 1;
