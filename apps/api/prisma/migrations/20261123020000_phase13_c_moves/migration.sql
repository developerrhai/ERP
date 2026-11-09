-- Phase 13 / C: the stock documents of a production order (material issue, material return, finished-goods receipt).
-- Each row is one stock voucher: its id is the voucher id of the stock ledger rows and of the GL event, so every action
-- posts its own journal and a replay cannot post twice.
CREATE TABLE "mfg_order_moves" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "order_id" uuid NOT NULL REFERENCES "mfg_orders"("id") ON DELETE CASCADE,
  "kind" varchar(10) NOT NULL,
  "seq" integer NOT NULL,
  "number" varchar(60) NOT NULL,
  "move_date" date NOT NULL,
  "lot_id" uuid REFERENCES "mfg_lots"("id") ON DELETE SET NULL,
  "journal_id" uuid REFERENCES "journals"("id") ON DELETE SET NULL,
  "total_qty" numeric(18,3) NOT NULL DEFAULT 0,
  "total_value" numeric(18,2) NOT NULL DEFAULT 0,
  "detail" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "mfg_move_kind_chk" CHECK ("kind" IN ('ISSUE','RETURN','FG_RECEIPT'))
);
CREATE UNIQUE INDEX "mfg_move_seq_uq" ON "mfg_order_moves"("order_id","kind","seq");
CREATE INDEX "mfg_move_unit_idx" ON "mfg_order_moves"("unit_id","move_date");
CREATE INDEX "mfg_move_lot_idx" ON "mfg_order_moves"("lot_id");
CREATE INDEX "mfg_move_journal_idx" ON "mfg_order_moves"("journal_id");
CREATE INDEX "mfg_move_created_by_idx" ON "mfg_order_moves"("created_by_id");
