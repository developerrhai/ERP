-- Phase 42: Engineering Change Notice/Order (docs2 RHAI_V40_A3 p.1 "Design fail or customer change" control:
-- "create ECN/ECO if design was frozen"). Raised automatically whenever a RELEASED or OBSOLETE BOM is revised
-- (bomService.revise) and alerts Sales, Purchase and Production (same page's "EMAIL / ALERT" line). An
-- immutable log, like sales_quotation_revisions/purchase_order_revisions: no edit, no approval chain of its
-- own (the new BOM draft goes through the existing BOM approval chain; this is the paper trail + the alert).
CREATE TABLE "engineering_change_orders" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "fy_id" uuid NOT NULL REFERENCES "financial_years"("id") ON DELETE RESTRICT,
  "number" varchar(40),
  "item_id" uuid NOT NULL REFERENCES "items"("id") ON DELETE RESTRICT,
  "from_bom_id" uuid NOT NULL REFERENCES "mfg_boms"("id") ON DELETE RESTRICT,
  "from_revision" integer NOT NULL,
  "to_bom_id" uuid NOT NULL REFERENCES "mfg_boms"("id") ON DELETE RESTRICT,
  "to_revision" integer NOT NULL,
  "reason" varchar(500) NOT NULL,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "deleted_at" timestamptz(3),
  "deleted_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "ecn_reason_chk" CHECK (char_length("reason") > 0)
);
CREATE UNIQUE INDEX "ecn_number_uq" ON "engineering_change_orders"("unit_id","fy_id","number") WHERE "number" IS NOT NULL;
CREATE INDEX "ecn_item_idx" ON "engineering_change_orders"("item_id");
CREATE INDEX "ecn_from_bom_idx" ON "engineering_change_orders"("from_bom_id");
CREATE INDEX "ecn_to_bom_idx" ON "engineering_change_orders"("to_bom_id");
CREATE INDEX "ecn_created_by_idx" ON "engineering_change_orders"("created_by_id");
CREATE INDEX "ecn_deleted_by_idx" ON "engineering_change_orders"("deleted_by_id");
