-- Phase 06 M5: item groups, item UOM conversions and the HSN link on items (docs/phases/PHASE-06.md §4, §4.6).
CREATE TABLE "item_groups" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" VARCHAR(40) NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "parent_id" UUID REFERENCES "item_groups"("id") ON DELETE SET NULL,
  "default_hsn_id" UUID REFERENCES "hsn_sac_codes"("id") ON DELETE SET NULL,
  "status" VARCHAR(10) NOT NULL DEFAULT 'ACTIVE',
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "created_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "deleted_at" TIMESTAMPTZ(3),
  "deleted_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "item_groups_status_chk" CHECK ("status" IN ('ACTIVE','INACTIVE')),
  CONSTRAINT "item_groups_code_uq" UNIQUE ("code")
);
CREATE INDEX "item_groups_parent_idx" ON "item_groups"("parent_id");
CREATE INDEX "item_groups_hsn_idx" ON "item_groups"("default_hsn_id");
CREATE INDEX "item_groups_created_by_idx" ON "item_groups"("created_by_id");
CREATE INDEX "item_groups_updated_by_idx" ON "item_groups"("updated_by_id");
CREATE INDEX "item_groups_deleted_by_idx" ON "item_groups"("deleted_by_id");

-- uom_code is checked against uoms in the service (uoms.code is not unique across the old company column).
CREATE TABLE "item_uom_conversions" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "item_id" UUID NOT NULL REFERENCES "items"("id") ON DELETE CASCADE,
  "uom_code" VARCHAR(20) NOT NULL,
  "factor" NUMERIC(18,6) NOT NULL,
  CONSTRAINT "item_uom_conversions_factor_chk" CHECK ("factor" > 0),
  CONSTRAINT "item_uom_conversions_uq" UNIQUE ("item_id", "uom_code")
);

ALTER TABLE "items"
  ADD COLUMN "item_group_id" UUID REFERENCES "item_groups"("id") ON DELETE SET NULL,
  ADD COLUMN "hsn_id" UUID REFERENCES "hsn_sac_codes"("id") ON DELETE RESTRICT,
  ADD COLUMN "gst_rate_override_id" UUID REFERENCES "gst_rates"("id") ON DELETE SET NULL,
  ADD COLUMN "gst_override_reason" VARCHAR(300);
CREATE INDEX "items_item_group_idx" ON "items"("item_group_id");
CREATE INDEX "items_hsn_idx" ON "items"("hsn_id");
CREATE INDEX "items_gst_rate_override_idx" ON "items"("gst_rate_override_id");

-- NOT VALID on purpose: existing items without an HSN stay as they are and appear in the "Missing HSN" filter.
-- VALIDATE CONSTRAINT runs in Phase 8, once that count is 0. New and edited rows are checked from now on.
ALTER TABLE "items" ADD CONSTRAINT "items_hsn_required" CHECK ("hsn_id" IS NOT NULL) NOT VALID;
ALTER TABLE "items" ADD CONSTRAINT "items_override_reason_chk"
  CHECK ("gst_rate_override_id" IS NULL OR "gst_override_reason" IS NOT NULL) NOT VALID;
