-- Phase 13 / E: time-phased MRP (bucket per run, bucket date per line), rework cost (minutes at the operation's rate), outside
-- processing (subcontract) moves of an operation, and a free-text machine / asset reference on the work centre (Phase 14 will
-- replace it with a link to the asset register).
ALTER TABLE "mfg_work_centres" ADD COLUMN "asset_ref" varchar(60);

ALTER TABLE "mfg_mrp_runs" ADD COLUMN "bucket" varchar(6) NOT NULL DEFAULT 'WEEK';
ALTER TABLE "mfg_mrp_runs" ADD CONSTRAINT "mfg_mrp_bucket_chk" CHECK ("bucket" IN ('DAY','WEEK','MONTH','RANGE'));
ALTER TABLE "mfg_mrp_lines" ADD COLUMN "bucket_start" date;

ALTER TABLE "mfg_rework" ADD COLUMN "minutes" numeric(10,2) NOT NULL DEFAULT 0;
ALTER TABLE "mfg_rework" ADD COLUMN "cost" numeric(18,2) NOT NULL DEFAULT 0;

CREATE TABLE "mfg_outside_moves" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "order_id" uuid NOT NULL REFERENCES "mfg_orders"("id") ON DELETE CASCADE,
  "op_id" uuid NOT NULL REFERENCES "mfg_order_ops"("id") ON DELETE CASCADE,
  "direction" varchar(8) NOT NULL,
  "move_date" date NOT NULL DEFAULT CURRENT_DATE,
  "qty" numeric(18,3) NOT NULL,
  "qty_scrap" numeric(18,3) NOT NULL DEFAULT 0,
  "doc_no" varchar(60) NOT NULL,
  "supplier_id" uuid NOT NULL REFERENCES "suppliers"("id") ON DELETE RESTRICT,
  "rate" numeric(18,4) NOT NULL DEFAULT 0,
  "cost" numeric(18,2) NOT NULL DEFAULT 0,
  "remark" varchar(200),
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "mfg_out_dir_chk" CHECK ("direction" IN ('SENT','RECEIVED')),
  CONSTRAINT "mfg_out_qty_chk" CHECK ("qty" >= 0 AND "qty_scrap" >= 0 AND ("qty" + "qty_scrap") > 0 AND "rate" >= 0 AND "cost" >= 0)
);
CREATE INDEX "mfg_out_unit_idx" ON "mfg_outside_moves"("unit_id","move_date");
CREATE INDEX "mfg_out_order_idx" ON "mfg_outside_moves"("order_id");
CREATE INDEX "mfg_out_op_idx" ON "mfg_outside_moves"("op_id");
CREATE INDEX "mfg_out_supplier_idx" ON "mfg_outside_moves"("supplier_id");
CREATE INDEX "mfg_out_created_by_idx" ON "mfg_outside_moves"("created_by_id");
