-- Phase 14 (docs/phases/PHASE-14.md section 4, masters): one asset spine. One physical object = one row in assets.
-- Maintenance pages and fixed-asset pages are two views of that row. Book value is never stored: it comes from v_asset_book_value.
-- Forward-only.

CREATE TABLE "asset_categories" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" varchar(20) NOT NULL,
  "name" varchar(120) NOT NULL,
  "asset_class" varchar(16) NOT NULL,
  "asset_account" varchar(20) NOT NULL,
  "accum_dep_account" varchar(20),
  "expense_account" varchar(20),
  "cwip_account" varchar(20),
  "itc_eligible" boolean NOT NULL DEFAULT true,
  "is_maintainable_default" boolean NOT NULL DEFAULT false,
  "nesd" boolean NOT NULL DEFAULT false,
  "it_block_code" varchar(20),
  "needs_review" boolean NOT NULL DEFAULT true,
  "status" varchar(10) NOT NULL DEFAULT 'ACTIVE',
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "deleted_at" timestamptz(3),
  CONSTRAINT "ac_class_chk" CHECK ("asset_class" IN ('BUILDING','PM','FURNITURE','VEHICLE','COMPUTER','OFFICE_EQUIP','ELECTRICAL','INTANGIBLE')),
  CONSTRAINT "ac_status_chk" CHECK ("status" IN ('ACTIVE','INACTIVE'))
);
CREATE UNIQUE INDEX "ac_code_uq" ON "asset_categories"("code") WHERE "deleted_at" IS NULL;

CREATE TABLE "asset_category_book_params" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "category_id" uuid NOT NULL REFERENCES "asset_categories"("id") ON DELETE CASCADE,
  "effective_from" date NOT NULL,
  "effective_to" date,
  "method" varchar(3) NOT NULL DEFAULT 'SLM',
  "useful_life_months" integer NOT NULL,
  "residual_pct" numeric(7,4) NOT NULL DEFAULT 5,
  "sch2_ref" varchar(120),
  "needs_review" boolean NOT NULL DEFAULT true,
  CONSTRAINT "acbp_method_chk" CHECK ("method" IN ('SLM','WDV')),
  CONSTRAINT "acbp_life_chk" CHECK ("useful_life_months" > 0),
  CONSTRAINT "acbp_res_chk" CHECK ("residual_pct" >= 0 AND "residual_pct" <= 5),
  CONSTRAINT "acbp_dates_chk" CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from")
);
CREATE UNIQUE INDEX "acbp_uq" ON "asset_category_book_params"("category_id","effective_from");

CREATE TABLE "it_blocks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" varchar(20) NOT NULL UNIQUE,
  "name" varchar(120) NOT NULL,
  "act_ref" varchar(60) NOT NULL DEFAULT 'ITA1961 s.32'
);
CREATE TABLE "it_block_rates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "block_id" uuid NOT NULL REFERENCES "it_blocks"("id") ON DELETE CASCADE,
  "effective_from" date NOT NULL,
  "rate_pct" numeric(7,4) NOT NULL,
  "half_rate_rule" boolean NOT NULL DEFAULT true,
  "act_ref" varchar(60) NOT NULL,
  "needs_review" boolean NOT NULL DEFAULT true,
  CONSTRAINT "itbr_rate_chk" CHECK ("rate_pct" >= 0 AND "rate_pct" <= 100)
);
CREATE UNIQUE INDEX "itbr_uq" ON "it_block_rates"("block_id","effective_from");

CREATE TABLE "assets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "fy_id" uuid REFERENCES "financial_years"("id") ON DELETE RESTRICT,
  "asset_no" varchar(40) NOT NULL,
  "name" varchar(160) NOT NULL,
  "category_id" uuid NOT NULL REFERENCES "asset_categories"("id") ON DELETE RESTRICT,
  "asset_kind" varchar(10) NOT NULL DEFAULT 'OTHER',
  "parent_asset_id" uuid REFERENCES "assets"("id") ON DELETE RESTRICT,
  "is_component" boolean NOT NULL DEFAULT false,
  "is_maintainable" boolean NOT NULL DEFAULT false,
  "department" varchar(60),
  "location" varchar(120),
  "cost_centre_id" uuid REFERENCES "cost_centers"("id") ON DELETE SET NULL,
  "work_centre_id" uuid,
  "make" varchar(80),
  "model" varchar(80),
  "serial_no" varchar(80),
  "criticality" char(1) NOT NULL DEFAULT 'C',
  "commission_date" date,
  "warranty_end" date,
  "supplier_id" uuid REFERENCES "suppliers"("id") ON DELETE SET NULL,
  "purchase_invoice_ref" varchar(60),
  "put_to_use_date" date,
  "it_block_id" uuid REFERENCES "it_blocks"("id") ON DELETE SET NULL,
  "status" varchar(12) NOT NULL DEFAULT 'CWIP',
  "qr_token" varchar(40) NOT NULL,
  "notes" varchar(300),
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "deleted_at" timestamptz(3),
  "deleted_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "assets_kind_chk" CHECK ("asset_kind" IN ('MACHINE','EQUIPMENT','IT','VEHICLE','FURNITURE','BUILDING','OTHER')),
  CONSTRAINT "assets_crit_chk" CHECK ("criticality" IN ('A','B','C')),
  CONSTRAINT "assets_status_chk" CHECK ("status" IN ('CWIP','ACTIVE','IDLE','UNDER_MAINT','DISPOSED')),
  CONSTRAINT "assets_self_chk" CHECK ("parent_asset_id" IS NULL OR "parent_asset_id" <> "id")
);
CREATE UNIQUE INDEX "assets_no_uq" ON "assets"("asset_no");
CREATE UNIQUE INDEX "assets_qr_uq" ON "assets"("qr_token");
CREATE INDEX "assets_unit_idx" ON "assets"("unit_id","asset_kind","status");
CREATE INDEX "assets_cat_idx" ON "assets"("category_id");
CREATE INDEX "assets_parent_idx" ON "assets"("parent_asset_id");
CREATE INDEX "assets_wc_idx" ON "assets"("work_centre_id");
CREATE INDEX "assets_supplier_idx" ON "assets"("supplier_id");
CREATE INDEX "assets_cc_idx" ON "assets"("cost_centre_id");
CREATE INDEX "assets_fy_idx" ON "assets"("fy_id");

-- a parent chain must never loop
CREATE FUNCTION "assets_no_cycle"() RETURNS trigger AS $$
BEGIN
  IF NEW.parent_asset_id IS NOT NULL AND EXISTS (
    WITH RECURSIVE up(id) AS (
      SELECT NEW.parent_asset_id
      UNION
      SELECT a.parent_asset_id FROM assets a JOIN up ON a.id = up.id WHERE a.parent_asset_id IS NOT NULL
    ) SELECT 1 FROM up WHERE id = NEW.id
  ) THEN
    RAISE EXCEPTION 'ASSET_PARENT_CYCLE';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER "assets_no_cycle_trg" BEFORE INSERT OR UPDATE OF "parent_asset_id" ON "assets"
  FOR EACH ROW EXECUTE FUNCTION "assets_no_cycle"();

CREATE TABLE "asset_book_profile" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "asset_id" uuid NOT NULL REFERENCES "assets"("id") ON DELETE RESTRICT,
  "area" varchar(4) NOT NULL,
  "method" varchar(3),
  "life_months" integer,
  "residual_amount" numeric(18,2) NOT NULL DEFAULT 0,
  "rate_pct" numeric(7,4),
  "dep_start_date" date,
  "cost" numeric(18,2) NOT NULL DEFAULT 0,
  "accum_dep" numeric(18,2) NOT NULL DEFAULT 0,
  "last_dep_date" date,
  "frozen" boolean NOT NULL DEFAULT false,
  "justification" varchar(300),
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "abp_area_chk" CHECK ("area" IN ('BOOK','TAX')),
  CONSTRAINT "abp_method_chk" CHECK ("method" IS NULL OR "method" IN ('SLM','WDV')),
  CONSTRAINT "abp_nonneg_chk" CHECK ("cost" >= 0 AND "accum_dep" >= 0 AND "accum_dep" <= "cost")
);
CREATE UNIQUE INDEX "abp_uq" ON "asset_book_profile"("asset_id","area");

CREATE VIEW "v_asset_book_value" AS
SELECT a."id" AS asset_id, a."unit_id", a."status", COALESCE(p."cost",0) AS cost, COALESCE(p."accum_dep",0) AS accum_dep,
       COALESCE(p."cost",0) - COALESCE(p."accum_dep",0) AS book_value, p."last_dep_date"
  FROM "assets" a LEFT JOIN "asset_book_profile" p ON p."asset_id" = a."id" AND p."area" = 'BOOK';

CREATE TABLE "meters" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "asset_id" uuid NOT NULL REFERENCES "assets"("id") ON DELETE CASCADE,
  "meter_type" varchar(10) NOT NULL,
  "uom" varchar(10) NOT NULL,
  CONSTRAINT "meters_type_chk" CHECK ("meter_type" IN ('RUN_HRS','STROKES','KM'))
);
CREATE UNIQUE INDEX "meters_uq" ON "meters"("asset_id","meter_type");

CREATE TABLE "meter_readings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "meter_id" uuid NOT NULL REFERENCES "meters"("id") ON DELETE CASCADE,
  "reading_at" timestamptz(3) NOT NULL DEFAULT now(),
  "value" numeric(18,3) NOT NULL,
  "is_reset" boolean NOT NULL DEFAULT false,
  "entered_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "source" varchar(6) NOT NULL DEFAULT 'MANUAL',
  CONSTRAINT "mr_source_chk" CHECK ("source" IN ('MANUAL','IOT')),
  CONSTRAINT "mr_value_chk" CHECK ("value" >= 0)
);
CREATE INDEX "mr_meter_idx" ON "meter_readings"("meter_id","reading_at");

-- a meter never reads lower than before, unless the reading is flagged as a reset
CREATE FUNCTION "meter_reading_guard"() RETURNS trigger AS $$
DECLARE last_v numeric;
BEGIN
  IF NEW.is_reset THEN RETURN NEW; END IF;
  SELECT value INTO last_v FROM meter_readings WHERE meter_id = NEW.meter_id ORDER BY reading_at DESC, id DESC LIMIT 1;
  IF last_v IS NOT NULL AND NEW.value < last_v THEN RAISE EXCEPTION 'METER_READING_LOWER'; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER "meter_reading_guard_trg" BEFORE INSERT ON "meter_readings"
  FOR EACH ROW EXECUTE FUNCTION "meter_reading_guard"();

ALTER TABLE "mfg_work_centres" ADD COLUMN "asset_id" uuid REFERENCES "assets"("id") ON DELETE SET NULL;
CREATE INDEX "wc_asset_idx" ON "mfg_work_centres"("asset_id");
ALTER TABLE "assets" ADD CONSTRAINT "assets_wc_fk" FOREIGN KEY ("work_centre_id") REFERENCES "mfg_work_centres"("id") ON DELETE SET NULL;
