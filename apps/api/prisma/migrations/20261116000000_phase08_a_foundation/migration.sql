-- Phase 8 / migration A: additive foundation (no existing column is dropped; legacy single-item
-- columns stay until migration D, which needs the owner's approval).
--   * D-11: voucher types are a lookup table, not a CHECK list.
--   * D-01 / Phase 7: the GL is posted inline by PostingService; the event queue loses company_id.
--   * R-08: stock_vouchers becomes a header; its lines live in stock_voucher_lines.
--   * Client requirement 2: stock status (UNRESTRICTED / QUALITY_INSPECTION / BLOCKED) per line.

-- ---------------------------------------------------------------------------------------------
-- 1. Voucher types as data (D-11)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE "stock_voucher_types" (
  "code"        varchar(20) PRIMARY KEY,
  "name"        varchar(60) NOT NULL,
  "direction"   varchar(8)  NOT NULL DEFAULT 'BOTH',
  "created_at"  timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "stock_voucher_types_direction" CHECK ("direction" IN ('IN','OUT','BOTH','VALUE'))
);
INSERT INTO "stock_voucher_types" ("code","name","direction") VALUES
  ('OPENING','Opening stock','IN'),
  ('RECEIPT','Receipt','IN'),
  ('ISSUE','Issue','OUT'),
  ('ADJUSTMENT','Adjustment','BOTH'),
  ('TRANSFER_OUT','Transfer out','OUT'),
  ('TRANSFER_IN','Transfer in','IN'),
  ('REVERSAL','Reversal','BOTH'),
  ('RECONCILIATION','Count reconciliation','BOTH'),
  ('REVALUATION','Revaluation','VALUE'),
  ('STATUS_CHANGE','Stock status change','BOTH')
ON CONFLICT DO NOTHING;

ALTER TABLE "stock_ledger" DROP CONSTRAINT IF EXISTS "stock_ledger_voucher_type";
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_voucher_type_fkey"
  FOREIGN KEY ("voucher_type") REFERENCES "stock_voucher_types"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------------------------
-- 2. The event queue is replaced by inline posting (Phase 7). Keep the table for the cut-over job
--    (drains old PENDING rows), but it no longer needs company_id (R-01 / D-01).
-- ---------------------------------------------------------------------------------------------
ALTER TABLE "accounting_event_queue" DROP CONSTRAINT IF EXISTS "accounting_event_queue_company_id_fkey";
ALTER TABLE "accounting_event_queue" DROP COLUMN IF EXISTS "company_id";

-- ---------------------------------------------------------------------------------------------
-- 3. stock_vouchers becomes a header
-- ---------------------------------------------------------------------------------------------
ALTER TABLE "stock_vouchers" ALTER COLUMN "item_id" DROP NOT NULL;
ALTER TABLE "stock_vouchers" ALTER COLUMN "qty" DROP NOT NULL;
ALTER TABLE "stock_vouchers" ALTER COLUMN "qty" SET DEFAULT 0;
ALTER TABLE "stock_vouchers" DROP CONSTRAINT "stock_vouchers_qty_positive";
ALTER TABLE "stock_vouchers" ADD CONSTRAINT "stock_vouchers_qty_positive"
  CHECK ("qty" IS NULL OR "qty" > 0 OR "kind" = 'ADJUSTMENT' OR "item_id" IS NULL);

ALTER TABLE "stock_vouchers"
  ADD COLUMN "has_lines"            boolean       NOT NULL DEFAULT false,
  ADD COLUMN "total_qty"            numeric(18,3),
  ADD COLUMN "total_value"          numeric(18,2),
  ADD COLUMN "narration"            varchar(300),
  ADD COLUMN "submitted_at"         timestamptz(3),
  ADD COLUMN "submitted_by_id"      uuid,
  ADD COLUMN "approved_at"          timestamptz(3),
  ADD COLUMN "cancelled_at"         timestamptz(3),
  ADD COLUMN "cancelled_by_id"      uuid,
  ADD COLUMN "cancel_date"          date,
  ADD COLUMN "cancel_reason"        varchar(300),
  ADD COLUMN "journal_id"           uuid,
  ADD COLUMN "cancel_journal_id"    uuid,
  ADD COLUMN "from_gstin"           varchar(15),
  ADD COLUMN "to_gstin"             varchar(15),
  ADD COLUMN "transit_warehouse_id" uuid;
ALTER TABLE "stock_vouchers" ADD CONSTRAINT "stock_vouchers_submitted_by_id_fkey" FOREIGN KEY ("submitted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "stock_vouchers" ADD CONSTRAINT "stock_vouchers_cancelled_by_id_fkey" FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "stock_vouchers" ADD CONSTRAINT "stock_vouchers_journal_id_fkey" FOREIGN KEY ("journal_id") REFERENCES "journals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_vouchers" ADD CONSTRAINT "stock_vouchers_cancel_journal_id_fkey" FOREIGN KEY ("cancel_journal_id") REFERENCES "journals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_vouchers" ADD CONSTRAINT "stock_vouchers_transit_warehouse_id_fkey" FOREIGN KEY ("transit_warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "stock_vouchers_journal_id_idx" ON "stock_vouchers" ("journal_id") WHERE "journal_id" IS NOT NULL;
CREATE INDEX "stock_vouchers_transit_warehouse_id_idx" ON "stock_vouchers" ("transit_warehouse_id") WHERE "transit_warehouse_id" IS NOT NULL;

-- Universal lifecycle (STANDARDS §6) plus the transfer states.
ALTER TABLE "stock_vouchers" DROP CONSTRAINT "stock_vouchers_status";
ALTER TABLE "stock_vouchers" ADD CONSTRAINT "stock_vouchers_status" CHECK ("status" IN
  ('Draft','Pending Approval','Approved','Rejected','Posted','Dispatched','Received','Cancelled'));
ALTER TABLE "stock_vouchers" DROP CONSTRAINT "stock_vouchers_kind";
ALTER TABLE "stock_vouchers" ADD CONSTRAINT "stock_vouchers_kind" CHECK ("kind" IN
  ('OPENING','TRANSACTION','ADJUSTMENT','TRANSFER'));

-- ---------------------------------------------------------------------------------------------
-- 4. Lines
-- ---------------------------------------------------------------------------------------------
CREATE TABLE "stock_voucher_lines" (
  "id"             uuid NOT NULL DEFAULT gen_random_uuid(),
  "voucher_id"     uuid NOT NULL,
  "line_no"        integer NOT NULL,
  "item_id"        uuid NOT NULL,
  "warehouse_id"   uuid,
  "qty"            numeric(18,3) NOT NULL,
  "entered_qty"    numeric(18,3),
  "uom"            varchar(20),
  "uom_factor"     numeric(18,6),
  "unit_cost"      numeric(18,6),
  "value"          numeric(18,2),
  "stock_status"   varchar(20) NOT NULL DEFAULT 'UNRESTRICTED',
  "batch_id"       uuid,
  "batch_no"       varchar(60),
  "mfg_date"       date,
  "expiry_date"    date,
  "serial_nos"     jsonb,
  "bin_id"         uuid,
  "counted_qty"    numeric(18,3),
  "system_qty"     numeric(18,3),
  "variance_qty"   numeric(18,3),
  "reason_code"    varchar(30),
  "remarks"        varchar(300),
  "dispatched_qty" numeric(18,3),
  "received_qty"   numeric(18,3),
  "dispatch_rate"  numeric(18,6),
  "dispatch_value" numeric(18,2),
  "ledger_ids"     jsonb,
  CONSTRAINT "stock_voucher_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "stock_voucher_lines_voucher_id_fkey" FOREIGN KEY ("voucher_id") REFERENCES "stock_vouchers"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "stock_voucher_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "stock_voucher_lines_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "stock_voucher_lines_line_no" CHECK ("line_no" >= 1),
  CONSTRAINT "stock_voucher_lines_qty" CHECK ("qty" >= 0),
  CONSTRAINT "stock_voucher_lines_uom_factor" CHECK ("uom_factor" IS NULL OR "uom_factor" > 0),
  CONSTRAINT "stock_voucher_lines_stock_status" CHECK ("stock_status" IN ('UNRESTRICTED','QUALITY_INSPECTION','BLOCKED')),
  CONSTRAINT "stock_voucher_lines_expiry_after_mfg" CHECK ("expiry_date" IS NULL OR "mfg_date" IS NULL OR "expiry_date" > "mfg_date")
);
CREATE UNIQUE INDEX "stock_voucher_lines_voucher_id_line_no_key" ON "stock_voucher_lines" ("voucher_id","line_no");
CREATE INDEX "stock_voucher_lines_item_id_idx" ON "stock_voucher_lines" ("item_id");
CREATE INDEX "stock_voucher_lines_warehouse_id_idx" ON "stock_voucher_lines" ("warehouse_id") WHERE "warehouse_id" IS NOT NULL;

-- Posted lines are never edited (R-09): a trigger refuses line changes once the header left Draft/Rejected.
CREATE FUNCTION "stock_voucher_lines_frozen"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
  SELECT "status" INTO st FROM "stock_vouchers" WHERE "id" = COALESCE(NEW."voucher_id", OLD."voucher_id");
  IF st IN ('Posted','Dispatched','Received','Cancelled') AND TG_OP IN ('INSERT','DELETE') THEN
    RAISE EXCEPTION 'lines of a % voucher cannot be % (use a reversal)', st, TG_OP USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
CREATE TRIGGER "stock_voucher_lines_frozen_ins_del" BEFORE INSERT OR DELETE ON "stock_voucher_lines"
  FOR EACH ROW EXECUTE FUNCTION "stock_voucher_lines_frozen"();

-- ---------------------------------------------------------------------------------------------
-- 5. Ledger: stock status and the voucher line that produced each row (nullable, forward-only)
-- ---------------------------------------------------------------------------------------------
ALTER TABLE "stock_ledger"
  ADD COLUMN "stock_status" varchar(20) NOT NULL DEFAULT 'UNRESTRICTED',
  ADD COLUMN "line_id"      uuid,
  ADD COLUMN "journal_id"   uuid;
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_stock_status" CHECK ("stock_status" IN ('UNRESTRICTED','QUALITY_INSPECTION','BLOCKED'));
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_line_id_fkey" FOREIGN KEY ("line_id") REFERENCES "stock_voucher_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_journal_id_fkey" FOREIGN KEY ("journal_id") REFERENCES "journals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "stock_ledger_line_id_idx" ON "stock_ledger" ("line_id") WHERE "line_id" IS NOT NULL;
CREATE INDEX "stock_ledger_journal_id_idx" ON "stock_ledger" ("journal_id") WHERE "journal_id" IS NOT NULL;

-- ---------------------------------------------------------------------------------------------
-- 6. Transit warehouses and the GST identity of a warehouse's unit (E-24)
-- ---------------------------------------------------------------------------------------------
ALTER TABLE "warehouses"
  ADD COLUMN "is_transit"      boolean NOT NULL DEFAULT false,
  ADD COLUMN "transit_for_unit_id" uuid;
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_transit_for_unit_id_fkey" FOREIGN KEY ("transit_for_unit_id") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_transit_has_unit" CHECK (NOT "is_transit" OR "transit_for_unit_id" IS NOT NULL);

-- ---------------------------------------------------------------------------------------------
-- 7. Account keys: the posting rules for stock postings (E-10 keys already exist from Phase 7).
--    Item type -> inventory account key is DATA (R-11 / R-16), not code.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE "item_type_accounts" (
  "item_type"     varchar(30) PRIMARY KEY,
  "inventory_key" varchar(40) NOT NULL,
  "created_at"    timestamptz(3) NOT NULL DEFAULT now()
);
INSERT INTO "item_type_accounts" ("item_type","inventory_key") VALUES
  ('Raw Material','INVENTORY_RM'),
  ('Packing Material','INVENTORY_RM'),
  ('Consumable','INVENTORY_RM'),
  ('Spare Part','INVENTORY_RM'),
  ('Semi-Finished','INVENTORY_WIP'),
  ('Finished Good','INVENTORY_FG')
ON CONFLICT DO NOTHING;
