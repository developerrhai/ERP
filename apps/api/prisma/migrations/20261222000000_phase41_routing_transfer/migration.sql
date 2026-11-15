-- Phase 41 (routing, BOM & material approval, material transfer note). Forward-only and idempotent: safe to run twice.
-- Builds on the Phase 25 tables plant_routes, plant_route_steps, job_card_routes, transfer_notes, bom_material_flows.
-- NOT applied by the build. The owner applies it by hand (local rhai_erp / rhai_erp_test first).

-- 1. Route steps: V40 "Approval" column.
ALTER TABLE "plant_route_steps" ADD COLUMN IF NOT EXISTS "approval_required" boolean NOT NULL DEFAULT false;

-- 2. Transfer notes carry the stock they moved (StockService transfer to the unit's transit warehouse).
ALTER TABLE "transfer_notes" ADD COLUMN IF NOT EXISTS "item_id" uuid REFERENCES "items"("id") ON DELETE RESTRICT;
ALTER TABLE "transfer_notes" ADD COLUMN IF NOT EXISTS "from_warehouse_id" uuid REFERENCES "warehouses"("id") ON DELETE RESTRICT;
ALTER TABLE "transfer_notes" ADD COLUMN IF NOT EXISTS "to_warehouse_id" uuid REFERENCES "warehouses"("id") ON DELETE RESTRICT;
ALTER TABLE "transfer_notes" ADD COLUMN IF NOT EXISTS "uom" varchar(20);
ALTER TABLE "transfer_notes" ADD COLUMN IF NOT EXISTS "order_id" uuid REFERENCES "mfg_orders"("id") ON DELETE SET NULL;
ALTER TABLE "transfer_notes" ADD COLUMN IF NOT EXISTS "received_qty" numeric(18,3);
ALTER TABLE "transfer_notes" ADD COLUMN IF NOT EXISTS "short_qty" numeric(18,3) NOT NULL DEFAULT 0;
ALTER TABLE "transfer_notes" ADD COLUMN IF NOT EXISTS "short_reason" varchar(300);
ALTER TABLE "transfer_notes" ADD COLUMN IF NOT EXISTS "stock_state" varchar(12) NOT NULL DEFAULT 'NONE';
ALTER TABLE "transfer_notes" ADD COLUMN IF NOT EXISTS "dispatch_detail" jsonb;
ALTER TABLE "transfer_notes" ADD COLUMN IF NOT EXISTS "dispatched_at" timestamptz(3);
ALTER TABLE "transfer_notes" ADD COLUMN IF NOT EXISTS "received_at" timestamptz(3);
ALTER TABLE "transfer_notes" ADD COLUMN IF NOT EXISTS "reconciled_at" timestamptz(3);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transfer_notes_stock_state_chk') THEN
    ALTER TABLE "transfer_notes" ADD CONSTRAINT "transfer_notes_stock_state_chk"
      CHECK ("stock_state" IN ('NONE','IN_TRANSIT','RECEIVED','RETURNED'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "transfer_notes_item_idx" ON "transfer_notes" ("item_id");
CREATE INDEX IF NOT EXISTS "transfer_notes_from_wh_idx" ON "transfer_notes" ("from_warehouse_id");
CREATE INDEX IF NOT EXISTS "transfer_notes_to_wh_idx" ON "transfer_notes" ("to_warehouse_id");
CREATE INDEX IF NOT EXISTS "transfer_notes_order_idx" ON "transfer_notes" ("order_id");

-- 3. Short receipts: the missing quantity stays in transit and opens a dispute until the warehouse returns it.
CREATE TABLE IF NOT EXISTS "transfer_disputes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "dispute_no" varchar(60) NOT NULL UNIQUE,
  "note_id" uuid NOT NULL REFERENCES "transfer_notes"("id") ON DELETE CASCADE,
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "qty" numeric(18,3) NOT NULL CHECK ("qty" > 0),
  "reason" varchar(300) NOT NULL,
  "status" varchar(12) NOT NULL DEFAULT 'OPEN' CHECK ("status" IN ('OPEN','RETURNED')),
  "resolution_note" varchar(300),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "resolved_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "resolved_at" timestamptz(3)
);
CREATE INDEX IF NOT EXISTS "transfer_disputes_note_idx" ON "transfer_disputes" ("note_id");
CREATE INDEX IF NOT EXISTS "transfer_disputes_unit_idx" ON "transfer_disputes" ("unit_id", "status");
CREATE INDEX IF NOT EXISTS "transfer_disputes_created_by_idx" ON "transfer_disputes" ("created_by_id");
CREATE INDEX IF NOT EXISTS "transfer_disputes_resolved_by_idx" ON "transfer_disputes" ("resolved_by_id");

-- 4. BOM & Material Approval: the BOM and quantity the flow is for, the PR it raised, who approved / released.
ALTER TABLE "bom_material_flows" ADD COLUMN IF NOT EXISTS "bom_id" uuid REFERENCES "mfg_boms"("id") ON DELETE RESTRICT;
ALTER TABLE "bom_material_flows" ADD COLUMN IF NOT EXISTS "qty" numeric(18,3);
ALTER TABLE "bom_material_flows" ADD COLUMN IF NOT EXISTS "sales_order_id" uuid REFERENCES "sales_orders"("id") ON DELETE SET NULL;
ALTER TABLE "bom_material_flows" ADD COLUMN IF NOT EXISTS "pr_id" uuid REFERENCES "purchase_requisitions"("id") ON DELETE SET NULL;
ALTER TABLE "bom_material_flows" ADD COLUMN IF NOT EXISTS "sales_approved_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "bom_material_flows" ADD COLUMN IF NOT EXISTS "sales_approved_at" timestamptz(3);
ALTER TABLE "bom_material_flows" ADD COLUMN IF NOT EXISTS "released_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "bom_material_flows" ADD COLUMN IF NOT EXISTS "released_at" timestamptz(3);
CREATE INDEX IF NOT EXISTS "bom_material_flows_bom_idx" ON "bom_material_flows" ("bom_id");
CREATE INDEX IF NOT EXISTS "bom_material_flows_so_idx" ON "bom_material_flows" ("sales_order_id");
CREATE INDEX IF NOT EXISTS "bom_material_flows_pr_idx" ON "bom_material_flows" ("pr_id");
CREATE INDEX IF NOT EXISTS "bom_material_flows_sales_by_idx" ON "bom_material_flows" ("sales_approved_by_id");
CREATE INDEX IF NOT EXISTS "bom_material_flows_released_by_idx" ON "bom_material_flows" ("released_by_id");

CREATE TABLE IF NOT EXISTS "bom_material_flow_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "flow_id" uuid NOT NULL REFERENCES "bom_material_flows"("id") ON DELETE CASCADE,
  "line_no" integer NOT NULL,
  "item_id" uuid NOT NULL REFERENCES "items"("id") ON DELETE RESTRICT,
  "uom" varchar(20) NOT NULL,
  "required_qty" numeric(18,3) NOT NULL,
  "available_qty" numeric(18,3) NOT NULL DEFAULT 0,
  "shortage_qty" numeric(18,3) GENERATED ALWAYS AS (GREATEST("required_qty" - "available_qty", 0)) STORED,
  UNIQUE ("flow_id", "line_no")
);
CREATE INDEX IF NOT EXISTS "bom_material_flow_lines_item_idx" ON "bom_material_flow_lines" ("item_id");
