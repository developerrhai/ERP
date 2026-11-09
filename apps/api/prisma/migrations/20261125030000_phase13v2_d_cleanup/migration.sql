-- Phase 13 v2: a component may appear on more than one operation of a BOM (different issue points), so the one-line-per-item rule goes.
DROP INDEX IF EXISTS "mfg_bomline_item_uq";
CREATE INDEX IF NOT EXISTS "mfg_bomline_item_idx" ON "mfg_bom_lines"("bom_id","item_id");
