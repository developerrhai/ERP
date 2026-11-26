-- QA comparison reports 251-253 (Stock Balance, Item / Product Master, Lead Sources).
-- Adds only: new nullable columns and one read-only view. No existing data is changed.

-- Item / Product Master: the add-form fields of the V40 reference that the item had no column for.
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "part_number" varchar(60);
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "min_stock" numeric(18,3);
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "default_bom_ref" varchar(40);
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "default_routing_ref" varchar(40);
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "project_id" uuid REFERENCES "projects"("id") ON DELETE SET NULL;
ALTER TABLE "items" DROP CONSTRAINT IF EXISTS "items_min_stock_chk";
ALTER TABLE "items" ADD CONSTRAINT "items_min_stock_chk" CHECK ("min_stock" IS NULL OR "min_stock" >= 0);
CREATE INDEX IF NOT EXISTS "items_project_idx" ON "items"("project_id");

-- Lead Sources: the source attributes of the V40 Source Master (leads / qualified / won / revenue are counted from real leads).
ALTER TABLE "lead_sources" ADD COLUMN IF NOT EXISTS "channel" varchar(40);
ALTER TABLE "lead_sources" ADD COLUMN IF NOT EXISTS "campaign" varchar(120);
ALTER TABLE "lead_sources" ADD COLUMN IF NOT EXISTS "utm_source" varchar(80);
ALTER TABLE "lead_sources" ADD COLUMN IF NOT EXISTS "utm_medium" varchar(80);
ALTER TABLE "lead_sources" ADD COLUMN IF NOT EXISTS "monthly_cost" numeric(18,2);
ALTER TABLE "lead_sources" ADD COLUMN IF NOT EXISTS "effective_from" date;
ALTER TABLE "lead_sources" ADD COLUMN IF NOT EXISTS "project_id" uuid REFERENCES "projects"("id") ON DELETE SET NULL;
ALTER TABLE "lead_sources" DROP CONSTRAINT IF EXISTS "lead_sources_cost_chk";
ALTER TABLE "lead_sources" ADD CONSTRAINT "lead_sources_cost_chk" CHECK ("monthly_cost" IS NULL OR "monthly_cost" >= 0);
CREATE INDEX IF NOT EXISTS "lead_sources_project_idx" ON "lead_sources"("project_id");

-- Stock Balance: a balance row is (item, warehouse) with no id of its own, so its Word / PDF / Documents / Move Forward
-- buttons had nothing to point at. The view gives every row one stable id derived from the pair.
CREATE OR REPLACE VIEW "stock_balance_records" AS
SELECT md5(b.item_id::text || ':' || b.warehouse_id::text)::uuid AS id,
       (i.code || ' @ ' || w.code)::text AS number,
       (CASE WHEN i.reorder_level IS NOT NULL AND b.on_hand < i.reorder_level THEN 'Below Reorder' ELSE 'OK' END)::text AS status,
       w.unit_id AS unit_id,
       i.code AS item_code,
       i.name AS item_name,
       i.item_type AS item_type,
       w.code AS warehouse_code,
       w.name AS warehouse_name,
       i.base_uom AS uom,
       b.on_hand AS on_hand,
       b.reserved_qty AS reserved_qty,
       b.avg_rate AS average_rate,
       b.value AS stock_value,
       i.reorder_level AS reorder_level,
       b.item_id AS item_id,
       b.warehouse_id AS warehouse_id,
       b.updated_at AS updated_at
FROM stock_balances b
JOIN items i ON i.id = b.item_id
JOIN warehouses w ON w.id = b.warehouse_id;
