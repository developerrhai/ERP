-- Phase 13 / B: inspection lots serve both a final inspection (FG receipt) and an in-process checkpoint of one operation.
-- One lot = one inspection sheet (qms_inspections.source_type 'MFG_LOT', source_id = the lot id), so a later batch of the
-- same operation can be inspected again after an earlier lot was decided.
ALTER TABLE "mfg_fg_lots" RENAME TO "mfg_lots";
ALTER TABLE "mfg_lots" ADD COLUMN "kind" varchar(4) NOT NULL DEFAULT 'FG';
ALTER TABLE "mfg_lots" ADD COLUMN "op_id" uuid REFERENCES "mfg_order_ops"("id") ON DELETE CASCADE;
ALTER TABLE "mfg_lots" ADD CONSTRAINT "mfg_lot_kind_chk" CHECK (("kind" = 'FG' AND "op_id" IS NULL) OR ("kind" = 'OP' AND "op_id" IS NOT NULL));
CREATE INDEX "mfg_lot_op_idx" ON "mfg_lots"("op_id");
