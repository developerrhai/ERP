-- Phase 06 M1: tax masters (docs/phases/PHASE-06.md §4). Statutory numbers are DATA rows with effective
-- dates (R-11), flagged needs_review until the accountant signs them off. Never checked online (R-12).

-- gst_states: Phase 3 kept the state list only in code (packages/statutory); the FKs of this phase need a table.
CREATE TABLE "gst_states" (
  "code" CHAR(2) PRIMARY KEY,
  "name" VARCHAR(80) NOT NULL,
  "is_union_territory" BOOLEAN NOT NULL DEFAULT false,
  "needs_review" BOOLEAN NOT NULL DEFAULT true
);
INSERT INTO "gst_states" ("code", "name", "is_union_territory") VALUES
  ('01', 'Jammu and Kashmir', true),
  ('02', 'Himachal Pradesh', false),
  ('03', 'Punjab', false),
  ('04', 'Chandigarh', true),
  ('05', 'Uttarakhand', false),
  ('06', 'Haryana', false),
  ('07', 'Delhi', true),
  ('08', 'Rajasthan', false),
  ('09', 'Uttar Pradesh', false),
  ('10', 'Bihar', false),
  ('11', 'Sikkim', false),
  ('12', 'Arunachal Pradesh', false),
  ('13', 'Nagaland', false),
  ('14', 'Manipur', false),
  ('15', 'Mizoram', false),
  ('16', 'Tripura', false),
  ('17', 'Meghalaya', false),
  ('18', 'Assam', false),
  ('19', 'West Bengal', false),
  ('20', 'Jharkhand', false),
  ('21', 'Odisha', false),
  ('22', 'Chhattisgarh', false),
  ('23', 'Madhya Pradesh', false),
  ('24', 'Gujarat', false),
  ('26', 'Dadra and Nagar Haveli and Daman and Diu', true),
  ('27', 'Maharashtra', false),
  ('29', 'Karnataka', false),
  ('30', 'Goa', false),
  ('31', 'Lakshadweep', true),
  ('32', 'Kerala', false),
  ('33', 'Tamil Nadu', false),
  ('34', 'Puducherry', true),
  ('35', 'Andaman and Nicobar Islands', true),
  ('36', 'Telangana', false),
  ('37', 'Andhra Pradesh', false),
  ('38', 'Ladakh', true),
  ('96', 'Other Country', false),
  ('97', 'Other Territory', true),
  ('99', 'Centre Jurisdiction', false);

CREATE TABLE "gst_registrations" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id" UUID NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "gstin" VARCHAR(15) NOT NULL,
  "legal_name" VARCHAR(200) NOT NULL,
  "trade_name" VARCHAR(200),
  "state_code" CHAR(2) NOT NULL REFERENCES "gst_states"("code"),
  "registration_type" VARCHAR(12) NOT NULL,
  "effective_from" DATE NOT NULL,
  "einvoice_enabled" BOOLEAN NOT NULL DEFAULT false,
  "eway_enabled" BOOLEAN NOT NULL DEFAULT false,
  "min_hsn_digits" SMALLINT NOT NULL DEFAULT 6,
  "status" VARCHAR(10) NOT NULL DEFAULT 'ACTIVE',
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "created_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "deleted_at" TIMESTAMPTZ(3),
  "deleted_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "gst_registrations_type_chk" CHECK ("registration_type" IN ('REGULAR','COMPOSITION','SEZ')),
  CONSTRAINT "gst_registrations_hsn_chk" CHECK ("min_hsn_digits" IN (4,6,8)),
  CONSTRAINT "gst_registrations_status_chk" CHECK ("status" IN ('ACTIVE','INACTIVE'))
);
CREATE UNIQUE INDEX "gst_registrations_gstin_uq" ON "gst_registrations"("gstin") WHERE "deleted_at" IS NULL;
CREATE INDEX "gst_registrations_unit_idx" ON "gst_registrations"("unit_id");
CREATE INDEX "gst_registrations_state_idx" ON "gst_registrations"("state_code");
CREATE INDEX "gst_registrations_created_by_idx" ON "gst_registrations"("created_by_id");
CREATE INDEX "gst_registrations_updated_by_idx" ON "gst_registrations"("updated_by_id");
CREATE INDEX "gst_registrations_deleted_by_idx" ON "gst_registrations"("deleted_by_id");

CREATE TABLE "gst_rates" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" VARCHAR(30) NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "kind" VARCHAR(10) NOT NULL DEFAULT 'TAXABLE',
  "igst_pct" NUMERIC(7,4) NOT NULL DEFAULT 0,
  "cgst_pct" NUMERIC(7,4) GENERATED ALWAYS AS ("igst_pct" / 2) STORED,
  "sgst_pct" NUMERIC(7,4) GENERATED ALWAYS AS ("igst_pct" / 2) STORED,
  "effective_from" DATE NOT NULL,
  "effective_to" DATE,
  "needs_review" BOOLEAN NOT NULL DEFAULT true,
  "status" VARCHAR(10) NOT NULL DEFAULT 'ACTIVE',
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "created_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "deleted_at" TIMESTAMPTZ(3),
  "deleted_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "gst_rates_kind_chk" CHECK ("kind" IN ('TAXABLE','NIL','EXEMPT','NON_GST')),
  CONSTRAINT "gst_rates_pct_chk" CHECK ("igst_pct" >= 0 AND "igst_pct" <= 100),
  CONSTRAINT "gst_rates_dates_chk" CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from"),
  CONSTRAINT "gst_rates_status_chk" CHECK ("status" IN ('ACTIVE','INACTIVE')),
  CONSTRAINT "gst_rates_code_uq" UNIQUE ("code")
);
CREATE INDEX "gst_rates_created_by_idx" ON "gst_rates"("created_by_id");
CREATE INDEX "gst_rates_updated_by_idx" ON "gst_rates"("updated_by_id");
CREATE INDEX "gst_rates_deleted_by_idx" ON "gst_rates"("deleted_by_id");

CREATE TABLE "hsn_sac_codes" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" VARCHAR(8) NOT NULL,
  "description" VARCHAR(300) NOT NULL,
  "is_service" BOOLEAN GENERATED ALWAYS AS ("code" LIKE '99%') STORED,
  "default_uqc" VARCHAR(10),
  "needs_review" BOOLEAN NOT NULL DEFAULT true,
  "status" VARCHAR(10) NOT NULL DEFAULT 'ACTIVE',
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "created_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "deleted_at" TIMESTAMPTZ(3),
  "deleted_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "hsn_sac_codes_code_chk" CHECK ("code" ~ '^([0-9]{4}|[0-9]{6}|[0-9]{8})$'),
  CONSTRAINT "hsn_sac_codes_status_chk" CHECK ("status" IN ('ACTIVE','INACTIVE')),
  CONSTRAINT "hsn_sac_codes_code_uq" UNIQUE ("code")
);
CREATE INDEX "hsn_sac_codes_created_by_idx" ON "hsn_sac_codes"("created_by_id");
CREATE INDEX "hsn_sac_codes_updated_by_idx" ON "hsn_sac_codes"("updated_by_id");
CREATE INDEX "hsn_sac_codes_deleted_by_idx" ON "hsn_sac_codes"("deleted_by_id");

CREATE TABLE "hsn_sac_rates" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "hsn_id" UUID NOT NULL REFERENCES "hsn_sac_codes"("id") ON DELETE CASCADE,
  "gst_rate_id" UUID NOT NULL REFERENCES "gst_rates"("id") ON DELETE RESTRICT,
  "cess_pct" NUMERIC(7,4) NOT NULL DEFAULT 0,
  "condition_note" VARCHAR(200),
  "effective_from" DATE NOT NULL,
  "effective_to" DATE,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "created_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "hsn_sac_rates_cess_chk" CHECK ("cess_pct" >= 0),
  CONSTRAINT "hsn_sac_rates_dates_chk" CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from"),
  CONSTRAINT "hsn_sac_rates_uq" UNIQUE NULLS NOT DISTINCT ("hsn_id", "effective_from", "condition_note")
);
CREATE INDEX "hsn_sac_rates_hsn_idx" ON "hsn_sac_rates"("hsn_id", "effective_from");
CREATE INDEX "hsn_sac_rates_rate_idx" ON "hsn_sac_rates"("gst_rate_id");
CREATE INDEX "hsn_sac_rates_created_by_idx" ON "hsn_sac_rates"("created_by_id");

-- Slabs after the 56th GST Council meeting (Notification 9/2025-CT(Rate), effective 22-09-2025) and the
-- slabs they replaced. ALL rows are needs_review: the CA verifies every slab. HSN -> slab mappings are NOT seeded.
INSERT INTO "gst_rates" ("code", "name", "kind", "igst_pct", "effective_from", "effective_to") VALUES
  ('GST0',       'GST 0 % (nil rated)',          'NIL',     0,    '2017-07-01', NULL),
  ('GST_EXEMPT', 'Exempt',                       'EXEMPT',  0,    '2017-07-01', NULL),
  ('GST_NONGST', 'Non-GST supply',               'NON_GST', 0,    '2017-07-01', NULL),
  ('GST025',     'GST 0.25 %',                   'TAXABLE', 0.25, '2017-07-01', NULL),
  ('GST3',       'GST 3 %',                      'TAXABLE', 3,    '2017-07-01', NULL),
  ('GST5',       'GST 5 %',                      'TAXABLE', 5,    '2017-07-01', NULL),
  ('GST12_OLD',  'GST 12 % (until 21-09-2025)',  'TAXABLE', 12,   '2017-07-01', '2025-09-21'),
  ('GST18',      'GST 18 %',                     'TAXABLE', 18,   '2017-07-01', NULL),
  ('GST28_OLD',  'GST 28 % (until 21-09-2025)',  'TAXABLE', 28,   '2017-07-01', '2025-09-21'),
  ('GST40',      'GST 40 % (demerit goods)',     'TAXABLE', 40,   '2025-09-22', NULL);
