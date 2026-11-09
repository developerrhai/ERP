-- Phase 8 / migration D: DRAFT. NOT in prisma/migrations, so `migrate deploy` never applies it.
-- Owner approval is required before it is moved to prisma/migrations/<timestamp>_phase08_d_legacy_cleanup/.
--
-- What it does (forward-only; it DROPS the old single-item columns of stock_vouchers):
--   1. refuses to run unless every voucher has its lines, the stock integrity holds and every item has an HSN / SAC;
--   2. validates the two constraints Phase 6 left NOT VALID (items_hsn_required, items_one_tracking);
--   3. drops the legacy single-item columns of stock_vouchers (their data lives in stock_voucher_lines since migration C);
--   4. makes `has_lines` true for every voucher.
-- Run `npm run inventory:preflight` first: it must say READY.

DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM stock_vouchers v
   WHERE v.item_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM stock_voucher_lines l WHERE l.voucher_id = v.id);
  IF n > 0 THEN RAISE EXCEPTION 'migration D refused: % voucher(s) have no lines (preflight P-01)', n; END IF;

  SELECT count(*) INTO n FROM stock_balances b
   LEFT JOIN (SELECT item_id, warehouse_id, sum(qty_in - qty_out) q, sum(value) v FROM stock_ledger GROUP BY 1,2) s
     ON s.item_id = b.item_id AND s.warehouse_id = b.warehouse_id
   WHERE b.on_hand <> COALESCE(s.q,0) OR b.value <> COALESCE(s.v,0);
  IF n > 0 THEN RAISE EXCEPTION 'migration D refused: % balance(s) differ from the ledger (INV-1)', n; END IF;

  SELECT count(*) INTO n FROM items WHERE hsn_id IS NULL AND deleted_at IS NULL;
  IF n > 0 THEN RAISE EXCEPTION 'migration D refused: % item(s) have no HSN / SAC (preflight P-04)', n; END IF;
END $$;

ALTER TABLE "items" VALIDATE CONSTRAINT "items_hsn_required";
ALTER TABLE "items" VALIDATE CONSTRAINT "items_one_tracking";

ALTER TABLE "stock_vouchers" DROP CONSTRAINT IF EXISTS "stock_vouchers_qty_positive";
ALTER TABLE "stock_vouchers" DROP CONSTRAINT IF EXISTS "stock_vouchers_uom_factor";
ALTER TABLE "stock_vouchers"
  DROP COLUMN "item_id",
  DROP COLUMN "batch_serial",
  DROP COLUMN "qty",
  DROP COLUMN "counted_qty",
  DROP COLUMN "dispatched_qty",
  DROP COLUMN "received_qty",
  DROP COLUMN "unit_cost",
  DROP COLUMN "system_qty",
  DROP COLUMN "variance_qty",
  DROP COLUMN "reason_code",
  DROP COLUMN "dispatch_rate",
  DROP COLUMN "dispatch_value",
  DROP COLUMN "entered_qty",
  DROP COLUMN "uom",
  DROP COLUMN "uom_factor",
  DROP COLUMN "mfg_date",
  DROP COLUMN "expiry_date",
  DROP COLUMN "serial_nos";
ALTER TABLE "stock_vouchers" ALTER COLUMN "has_lines" SET DEFAULT true;
UPDATE "stock_vouchers" SET "has_lines" = true WHERE NOT "has_lines";
