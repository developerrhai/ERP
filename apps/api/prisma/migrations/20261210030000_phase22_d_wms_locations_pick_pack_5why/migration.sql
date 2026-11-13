-- Phase 22 §2A: the tables behind the screens whose tables were planned but never created.
--  * wms_zones / wms_racks / wms_shelves  (PHASE-08 Migration B) + wms_bins.shelf_id/zone_id/rack_id
--  * wms_rfid_tags                        (RFID / barcode tags of bins and shelves, label print counter)
--  * pick_waves / pick_tasks / pack_units (PHASE-10 fulfilment)
--  * five_why_cases / five_why_steps      (PHASE-12 5-Why)
-- Forward-only. Records that belong to a plant carry unit_id.

-- ---------------------------------------------------------------- locations
CREATE TABLE "wms_zones" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "warehouse_id" uuid NOT NULL REFERENCES "warehouses"("id") ON DELETE RESTRICT,
  "code" varchar(30) NOT NULL,
  "name" varchar(120) NOT NULL,
  "zone_type" varchar(30) NOT NULL DEFAULT 'Storage',
  "storage_class" varchar(30),
  "temperature" varchar(30),
  "capacity" numeric(18,3),
  "putaway_priority" integer NOT NULL DEFAULT 100,
  "pick_sequence" integer NOT NULL DEFAULT 100,
  "status" varchar(10) NOT NULL DEFAULT 'Active' CHECK ("status" IN ('Active','Inactive')),
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "deleted_at" timestamptz(3),
  "deleted_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "wms_zones_wh_code_key" UNIQUE ("warehouse_id", "code")
);
CREATE INDEX "wms_zones_created_by_id_idx" ON "wms_zones" ("created_by_id");
CREATE INDEX "wms_zones_updated_by_id_idx" ON "wms_zones" ("updated_by_id");
CREATE INDEX "wms_zones_deleted_by_id_idx" ON "wms_zones" ("deleted_by_id");

CREATE TABLE "wms_racks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "zone_id" uuid NOT NULL REFERENCES "wms_zones"("id") ON DELETE RESTRICT,
  "warehouse_id" uuid NOT NULL REFERENCES "warehouses"("id") ON DELETE RESTRICT,
  "code" varchar(30) NOT NULL,
  "aisle" varchar(30),
  "rack_type" varchar(30) NOT NULL DEFAULT 'Selective',
  "levels" integer NOT NULL DEFAULT 1 CHECK ("levels" >= 1),
  "max_load_kg" numeric(18,3),
  "status" varchar(10) NOT NULL DEFAULT 'Active' CHECK ("status" IN ('Active','Inactive')),
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "deleted_at" timestamptz(3),
  "deleted_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "wms_racks_zone_code_key" UNIQUE ("zone_id", "code")
);
CREATE INDEX "wms_racks_warehouse_id_idx" ON "wms_racks" ("warehouse_id");
CREATE INDEX "wms_racks_created_by_id_idx" ON "wms_racks" ("created_by_id");
CREATE INDEX "wms_racks_updated_by_id_idx" ON "wms_racks" ("updated_by_id");
CREATE INDEX "wms_racks_deleted_by_id_idx" ON "wms_racks" ("deleted_by_id");

CREATE TABLE "wms_shelves" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "rack_id" uuid NOT NULL REFERENCES "wms_racks"("id") ON DELETE RESTRICT,
  "code" varchar(30) NOT NULL,
  "level" integer NOT NULL DEFAULT 1 CHECK ("level" >= 1),
  "dimensions" varchar(60),
  "max_weight_kg" numeric(18,3),
  "storage_rule" varchar(120),
  "status" varchar(10) NOT NULL DEFAULT 'Active' CHECK ("status" IN ('Active','Inactive')),
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "deleted_at" timestamptz(3),
  "deleted_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "wms_shelves_rack_code_key" UNIQUE ("rack_id", "code")
);
CREATE INDEX "wms_shelves_created_by_id_idx" ON "wms_shelves" ("created_by_id");
CREATE INDEX "wms_shelves_updated_by_id_idx" ON "wms_shelves" ("updated_by_id");
CREATE INDEX "wms_shelves_deleted_by_id_idx" ON "wms_shelves" ("deleted_by_id");

-- Bins may sit on a shelf. Zone / rack are copied from the shelf and kept consistent by a trigger.
ALTER TABLE "wms_bins"
  ADD COLUMN "shelf_id" uuid REFERENCES "wms_shelves"("id") ON DELETE RESTRICT,
  ADD COLUMN "zone_id" uuid REFERENCES "wms_zones"("id") ON DELETE RESTRICT,
  ADD COLUMN "rack_id" uuid REFERENCES "wms_racks"("id") ON DELETE RESTRICT;
CREATE INDEX "wms_bins_shelf_id_idx" ON "wms_bins" ("shelf_id");
CREATE INDEX "wms_bins_zone_id_idx" ON "wms_bins" ("zone_id");
CREATE INDEX "wms_bins_rack_id_idx" ON "wms_bins" ("rack_id");

CREATE OR REPLACE FUNCTION wms_bins_sync_location() RETURNS trigger AS $$
DECLARE s record;
BEGIN
  IF NEW.shelf_id IS NULL THEN
    NEW.zone_id := NULL;
    NEW.rack_id := NULL;
    RETURN NEW;
  END IF;
  SELECT r.id AS rack_id, r.zone_id AS zone_id, r.warehouse_id AS warehouse_id, z.code AS zone_code
    INTO s
    FROM wms_shelves sh JOIN wms_racks r ON r.id = sh.rack_id JOIN wms_zones z ON z.id = r.zone_id
   WHERE sh.id = NEW.shelf_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Shelf not found'; END IF;
  IF s.warehouse_id <> NEW.warehouse_id THEN
    RAISE EXCEPTION 'A bin must be in the same warehouse as its shelf';
  END IF;
  NEW.rack_id := s.rack_id;
  NEW.zone_id := s.zone_id;
  IF NEW.zone IS NULL OR NEW.zone = '' THEN NEW.zone := s.zone_code; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER "wms_bins_sync_location" BEFORE INSERT OR UPDATE OF shelf_id, warehouse_id ON "wms_bins"
  FOR EACH ROW EXECUTE FUNCTION wms_bins_sync_location();

-- ---------------------------------------------------------------- RFID / barcode tags
CREATE TABLE "wms_rfid_tags" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tag_code" varchar(60) NOT NULL UNIQUE,
  "tag_type" varchar(10) NOT NULL DEFAULT 'BARCODE' CHECK ("tag_type" IN ('RFID','BARCODE')),
  "warehouse_id" uuid NOT NULL REFERENCES "warehouses"("id") ON DELETE RESTRICT,
  "bin_id" uuid REFERENCES "wms_bins"("id") ON DELETE SET NULL,
  "shelf_id" uuid REFERENCES "wms_shelves"("id") ON DELETE SET NULL,
  "status" varchar(10) NOT NULL DEFAULT 'Active' CHECK ("status" IN ('Active','Inactive','Lost')),
  "print_count" integer NOT NULL DEFAULT 0,
  "last_printed_at" timestamptz(3),
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "deleted_at" timestamptz(3)
);
CREATE INDEX "wms_rfid_tags_warehouse_id_idx" ON "wms_rfid_tags" ("warehouse_id");
CREATE INDEX "wms_rfid_tags_bin_id_idx" ON "wms_rfid_tags" ("bin_id");
CREATE INDEX "wms_rfid_tags_shelf_id_idx" ON "wms_rfid_tags" ("shelf_id");
CREATE INDEX "wms_rfid_tags_created_by_id_idx" ON "wms_rfid_tags" ("created_by_id");
CREATE INDEX "wms_rfid_tags_updated_by_id_idx" ON "wms_rfid_tags" ("updated_by_id");

-- ---------------------------------------------------------------- pick / pack (PHASE-10 fulfilment)
CREATE TABLE "pick_waves" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "number" varchar(40) NOT NULL UNIQUE,
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "fy_id" uuid NOT NULL REFERENCES "financial_years"("id") ON DELETE RESTRICT,
  "warehouse_id" uuid NOT NULL REFERENCES "warehouses"("id") ON DELETE RESTRICT,
  "planned_date" date NOT NULL DEFAULT CURRENT_DATE,
  "reference" varchar(60),
  "status" varchar(12) NOT NULL DEFAULT 'Draft' CHECK ("status" IN ('Draft','Released','Picking','Picked','Cancelled')),
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "deleted_at" timestamptz(3)
);
CREATE INDEX "pick_waves_unit_status_idx" ON "pick_waves" ("unit_id", "status", "id" DESC);
CREATE INDEX "pick_waves_unit_date_idx" ON "pick_waves" ("unit_id", "planned_date" DESC, "id" DESC);
CREATE INDEX "pick_waves_fy_id_idx" ON "pick_waves" ("fy_id");
CREATE INDEX "pick_waves_warehouse_id_idx" ON "pick_waves" ("warehouse_id");
CREATE INDEX "pick_waves_created_by_id_idx" ON "pick_waves" ("created_by_id");
CREATE INDEX "pick_waves_updated_by_id_idx" ON "pick_waves" ("updated_by_id");

CREATE TABLE "pick_tasks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "wave_id" uuid NOT NULL REFERENCES "pick_waves"("id") ON DELETE CASCADE,
  "line_no" integer NOT NULL,
  "item_id" uuid NOT NULL REFERENCES "items"("id") ON DELETE RESTRICT,
  "source_bin_id" uuid REFERENCES "wms_bins"("id") ON DELETE RESTRICT,
  "batch_id" uuid REFERENCES "batches"("id") ON DELETE RESTRICT,
  "serials" text[] NOT NULL DEFAULT '{}',
  "required_qty" numeric(18,3) NOT NULL CHECK ("required_qty" > 0),
  "picked_qty" numeric(18,3) NOT NULL DEFAULT 0 CHECK ("picked_qty" >= 0),
  "short_qty" numeric(18,3) NOT NULL DEFAULT 0 CHECK ("short_qty" >= 0),
  "route_seq" integer NOT NULL DEFAULT 0,
  "status" varchar(10) NOT NULL DEFAULT 'Open' CHECK ("status" IN ('Open','Picked','Short','Cancelled')),
  CONSTRAINT "pick_tasks_wave_line_key" UNIQUE ("wave_id", "line_no")
);
CREATE INDEX "pick_tasks_item_id_idx" ON "pick_tasks" ("item_id");
CREATE INDEX "pick_tasks_source_bin_id_idx" ON "pick_tasks" ("source_bin_id");
CREATE INDEX "pick_tasks_batch_id_idx" ON "pick_tasks" ("batch_id");

CREATE TABLE "pack_units" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "number" varchar(40) NOT NULL UNIQUE,
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "wave_id" uuid REFERENCES "pick_waves"("id") ON DELETE SET NULL,
  "cartons" integer NOT NULL DEFAULT 1 CHECK ("cartons" >= 1),
  "gross_kg" numeric(18,3),
  "volumetric_kg" numeric(18,3),
  "label_status" varchar(10) NOT NULL DEFAULT 'Pending' CHECK ("label_status" IN ('Pending','Printed')),
  "qc_check" boolean NOT NULL DEFAULT false,
  "status" varchar(10) NOT NULL DEFAULT 'Open' CHECK ("status" IN ('Open','Packed','Dispatched','Cancelled')),
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "deleted_at" timestamptz(3)
);
CREATE INDEX "pack_units_unit_status_idx" ON "pack_units" ("unit_id", "status", "id" DESC);
CREATE INDEX "pack_units_wave_id_idx" ON "pack_units" ("wave_id");
CREATE INDEX "pack_units_created_by_id_idx" ON "pack_units" ("created_by_id");
CREATE INDEX "pack_units_updated_by_id_idx" ON "pack_units" ("updated_by_id");

-- ---------------------------------------------------------------- 5-Why (PHASE-12)
CREATE TABLE "five_why_cases" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "number" varchar(40) NOT NULL UNIQUE,
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "fy_id" uuid NOT NULL REFERENCES "financial_years"("id") ON DELETE RESTRICT,
  "title" varchar(200) NOT NULL,
  "problem" text NOT NULL,
  "department" varchar(60),
  "owner_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "ncr_ref" varchar(60),
  "root_cause" text,
  "corrective_action" text,
  "capa_ref" varchar(60),
  "status" varchar(10) NOT NULL DEFAULT 'Open' CHECK ("status" IN ('Open','Closed','Cancelled')),
  "closed_at" timestamptz(3),
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "deleted_at" timestamptz(3),
  CONSTRAINT "five_why_closed_needs_cause" CHECK ("status" <> 'Closed' OR ("root_cause" IS NOT NULL AND "root_cause" <> ''))
);
CREATE INDEX "five_why_cases_unit_status_idx" ON "five_why_cases" ("unit_id", "status", "id" DESC);
CREATE INDEX "five_why_cases_fy_id_idx" ON "five_why_cases" ("fy_id");
CREATE INDEX "five_why_cases_owner_id_idx" ON "five_why_cases" ("owner_id");
CREATE INDEX "five_why_cases_created_by_id_idx" ON "five_why_cases" ("created_by_id");
CREATE INDEX "five_why_cases_updated_by_id_idx" ON "five_why_cases" ("updated_by_id");

CREATE TABLE "five_why_steps" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "case_id" uuid NOT NULL REFERENCES "five_why_cases"("id") ON DELETE CASCADE,
  "step_no" integer NOT NULL CHECK ("step_no" BETWEEN 1 AND 5),
  "why" varchar(300) NOT NULL,
  "answer" text NOT NULL,
  CONSTRAINT "five_why_steps_case_step_key" UNIQUE ("case_id", "step_no")
);
