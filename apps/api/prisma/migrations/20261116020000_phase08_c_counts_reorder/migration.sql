-- Phase 8 / migration C: counts (cycle, physical, weekly powder sheet), reorder policy and suggestions,
-- barcode scans, GL cut-over runs; backfill of one line per existing single-item voucher.

CREATE TABLE "stock_counts" (
  "id"            uuid NOT NULL DEFAULT gen_random_uuid(),
  "code"          varchar(60) NOT NULL,
  "count_type"    varchar(14) NOT NULL DEFAULT 'CYCLE',
  "unit_id"       uuid NOT NULL,
  "fy_id"         uuid NOT NULL,
  "department"    varchar(60) NOT NULL,
  "warehouse_id"  uuid NOT NULL,
  "status"        varchar(14) NOT NULL DEFAULT 'Planned',
  "planned_date"  date NOT NULL,
  "month_label"   varchar(7),
  "frequency"     varchar(10),
  "blind"         boolean NOT NULL DEFAULT true,
  "freeze_warehouse" boolean NOT NULL DEFAULT false,
  "tolerance_pct" numeric(7,4) NOT NULL DEFAULT 2,
  "tolerance_value" numeric(18,2) NOT NULL DEFAULT 500,
  "snapshot_at"   timestamptz(3),
  "accuracy_pct"  numeric(7,2),
  "reconciliation_voucher_id" uuid,
  "closure_note"  varchar(300),
  "version"       integer NOT NULL DEFAULT 1,
  "created_by_id" uuid NOT NULL,
  "created_at"    timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid,
  "updated_at"    timestamptz(3) NOT NULL DEFAULT now(),
  "deleted_by_id" uuid,
  "deleted_at"    timestamptz(3),
  CONSTRAINT "stock_counts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "stock_counts_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "stock_counts_fy_id_fkey" FOREIGN KEY ("fy_id") REFERENCES "financial_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "stock_counts_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "stock_counts_reconciliation_voucher_id_fkey" FOREIGN KEY ("reconciliation_voucher_id") REFERENCES "stock_vouchers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "stock_counts_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "stock_counts_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "stock_counts_deleted_by_id_fkey" FOREIGN KEY ("deleted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "stock_counts_type" CHECK ("count_type" IN ('CYCLE','PHYSICAL','POWDER_WEEKLY')),
  CONSTRAINT "stock_counts_status" CHECK ("status" IN ('Planned','Counting','Under Review','Approved','Posted','Closed','Cancelled')),
  CONSTRAINT "stock_counts_frequency" CHECK ("frequency" IS NULL OR "frequency" IN ('Weekly','Monthly','Quarterly','Yearly')),
  CONSTRAINT "stock_counts_month_label" CHECK ("month_label" IS NULL OR "month_label" ~ '^[0-9]{4}-[0-9]{2}$')
);
CREATE UNIQUE INDEX "stock_counts_code_key" ON "stock_counts" ("code");
CREATE INDEX "stock_counts_warehouse_id_idx" ON "stock_counts" ("warehouse_id");
CREATE INDEX "stock_counts_unit_id_idx" ON "stock_counts" ("unit_id");

-- A warehouse frozen by a physical count refuses postings (BR-INV-05).
ALTER TABLE "warehouses" ADD COLUMN "frozen_by_count_id" uuid;
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_frozen_by_count_id_fkey" FOREIGN KEY ("frozen_by_count_id") REFERENCES "stock_counts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "stock_count_lines" (
  "id"          uuid NOT NULL DEFAULT gen_random_uuid(),
  "count_id"    uuid NOT NULL,
  "line_no"     integer NOT NULL,
  "item_id"     uuid NOT NULL,
  "batch_id"    uuid,
  "bin_id"      uuid,
  "system_qty"  numeric(18,3) NOT NULL DEFAULT 0,
  "count1_qty"  numeric(18,3),
  "count1_by_id" uuid,
  "count2_qty"  numeric(18,3),
  "count2_by_id" uuid,
  "final_qty"   numeric(18,3),
  "unit_cost"   numeric(18,6),
  "status"      varchar(10) NOT NULL DEFAULT 'Open',
  "week_no"     smallint,
  "remarks"     varchar(300),
  "checked_by_id" uuid,
  "checked_on"  date,
  CONSTRAINT "stock_count_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "stock_count_lines_count_id_fkey" FOREIGN KEY ("count_id") REFERENCES "stock_counts"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "stock_count_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "stock_count_lines_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "stock_count_lines_bin_id_fkey" FOREIGN KEY ("bin_id") REFERENCES "wms_bins"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "stock_count_lines_count1_by_id_fkey" FOREIGN KEY ("count1_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "stock_count_lines_count2_by_id_fkey" FOREIGN KEY ("count2_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "stock_count_lines_checked_by_id_fkey" FOREIGN KEY ("checked_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "stock_count_lines_status" CHECK ("status" IN ('Open','Counted','Recount','Accepted','Stale')),
  CONSTRAINT "stock_count_lines_week" CHECK ("week_no" IS NULL OR "week_no" BETWEEN 1 AND 5),
  CONSTRAINT "stock_count_lines_qty" CHECK (COALESCE("count1_qty",0) >= 0 AND COALESCE("count2_qty",0) >= 0 AND COALESCE("final_qty",0) >= 0)
);
CREATE UNIQUE INDEX "stock_count_lines_count_line_key" ON "stock_count_lines" ("count_id","line_no");
CREATE INDEX "stock_count_lines_item_id_idx" ON "stock_count_lines" ("item_id");

-- Reorder
CREATE TABLE "reorder_policies" (
  "id"            uuid NOT NULL DEFAULT gen_random_uuid(),
  "item_id"       uuid NOT NULL,
  "warehouse_id"  uuid NOT NULL,
  "method"        varchar(10) NOT NULL DEFAULT 'MIN_MAX',
  "min_qty"       numeric(18,3) NOT NULL DEFAULT 0,
  "max_qty"       numeric(18,3) NOT NULL DEFAULT 0,
  "lead_time_days" integer NOT NULL DEFAULT 7,
  "service_level_pct" numeric(7,3) NOT NULL DEFAULT 95,
  "ordering_cost" numeric(18,2) NOT NULL DEFAULT 0,
  "holding_cost_pct" numeric(7,4) NOT NULL DEFAULT 20,
  "order_multiple" numeric(18,3) NOT NULL DEFAULT 1,
  "preferred_supplier_id" uuid,
  "status"        varchar(10) NOT NULL DEFAULT 'Active',
  "version"       integer NOT NULL DEFAULT 1,
  "created_by_id" uuid NOT NULL,
  "created_at"    timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid,
  "updated_at"    timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "reorder_policies_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "reorder_policies_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "reorder_policies_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "reorder_policies_supplier_fkey" FOREIGN KEY ("preferred_supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "reorder_policies_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "reorder_policies_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "reorder_policies_method" CHECK ("method" IN ('MIN_MAX','ROP_EOQ')),
  CONSTRAINT "reorder_policies_status" CHECK ("status" IN ('Active','Inactive')),
  CONSTRAINT "reorder_policies_numbers" CHECK ("min_qty" >= 0 AND "max_qty" >= "min_qty" AND "lead_time_days" >= 0 AND "order_multiple" > 0
    AND "service_level_pct" BETWEEN 50 AND 99.9 AND "ordering_cost" >= 0 AND "holding_cost_pct" >= 0)
);
CREATE UNIQUE INDEX "reorder_policies_item_warehouse_key" ON "reorder_policies" ("item_id","warehouse_id");

CREATE TABLE "reorder_suggestions" (
  "id"            uuid NOT NULL DEFAULT gen_random_uuid(),
  "policy_id"     uuid NOT NULL,
  "suggested_qty" numeric(18,3) NOT NULL,
  "position_qty"  numeric(18,3) NOT NULL,
  "trigger_qty"   numeric(18,3) NOT NULL,
  "status"        varchar(10) NOT NULL DEFAULT 'Open',
  "dismiss_reason" varchar(300),
  "pr_ref"        varchar(60),
  "created_at"    timestamptz(3) NOT NULL DEFAULT now(),
  "updated_at"    timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "reorder_suggestions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "reorder_suggestions_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "reorder_policies"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "reorder_suggestions_status" CHECK ("status" IN ('Open','Converted','Dismissed'))
);
CREATE UNIQUE INDEX "reorder_suggestions_one_open" ON "reorder_suggestions" ("policy_id") WHERE "status" = 'Open';

-- Scans (append-only log; the scan endpoint never posts stock)
CREATE TABLE "scan_events" (
  "id"            uuid NOT NULL DEFAULT gen_random_uuid(),
  "raw"           varchar(300) NOT NULL,
  "context"       varchar(12) NOT NULL,
  "result_kind"   varchar(12) NOT NULL,
  "valid"         boolean NOT NULL,
  "message"       varchar(200),
  "item_id"       uuid,
  "batch_id"      uuid,
  "bin_id"        uuid,
  "created_by_id" uuid NOT NULL,
  "created_at"    timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "scan_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "scan_events_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "scan_events_context" CHECK ("context" IN ('LOOKUP','RECEIVE','COUNT','TRANSFER','ISSUE')),
  CONSTRAINT "scan_events_kind" CHECK ("result_kind" IN ('ITEM','BATCH','SERIAL','BIN','UNKNOWN'))
);
SELECT inv_make_append_only('scan_events');

-- GL cut-over runs: one per unit, records the opening journal that brought the GL inventory
-- accounts level with the stock ledger. A unit cuts over once.
CREATE TABLE "inventory_gl_cutovers" (
  "id"            uuid NOT NULL DEFAULT gen_random_uuid(),
  "unit_id"       uuid NOT NULL,
  "as_of"         date NOT NULL,
  "stock_value"   numeric(18,2) NOT NULL,
  "journal_id"    uuid,
  "status"        varchar(10) NOT NULL DEFAULT 'Done',
  "created_by_id" uuid NOT NULL,
  "created_at"    timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "inventory_gl_cutovers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inventory_gl_cutovers_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "inventory_gl_cutovers_journal_id_fkey" FOREIGN KEY ("journal_id") REFERENCES "journals"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "inventory_gl_cutovers_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "inventory_gl_cutovers_status" CHECK ("status" IN ('Done','Skipped'))
);
CREATE UNIQUE INDEX "inventory_gl_cutovers_unit_id_key" ON "inventory_gl_cutovers" ("unit_id");

-- ---------------------------------------------------------------------------------------------
-- Backfill R-08: every legacy single-item voucher gets exactly one line carrying its figures.
-- Idempotent (skips vouchers that already have a line). Triggers allow it: the line trigger only
-- refuses INSERT on Posted/Cancelled vouchers, so the trigger is disabled for this statement only.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE "stock_voucher_lines" DISABLE TRIGGER "stock_voucher_lines_frozen_ins_del";
INSERT INTO "stock_voucher_lines"
  ("voucher_id","line_no","item_id","warehouse_id","qty","entered_qty","uom","uom_factor","unit_cost","value",
   "batch_no","mfg_date","expiry_date","serial_nos","counted_qty","system_qty","variance_qty","reason_code",
   "dispatched_qty","received_qty","dispatch_rate","dispatch_value")
SELECT v."id", 1, v."item_id", v."warehouse_id", COALESCE(v."qty",0), v."entered_qty", v."uom", v."uom_factor",
       v."unit_cost", v."value", v."batch_serial", v."mfg_date", v."expiry_date", v."serial_nos", v."counted_qty",
       v."system_qty", v."variance_qty", v."reason_code", v."dispatched_qty", v."received_qty", v."dispatch_rate",
       v."dispatch_value"
FROM "stock_vouchers" v
WHERE v."item_id" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "stock_voucher_lines" l WHERE l."voucher_id" = v."id");
ALTER TABLE "stock_voucher_lines" ENABLE TRIGGER "stock_voucher_lines_frozen_ins_del";
UPDATE "stock_vouchers" v SET "has_lines" = true,
  "total_qty" = (SELECT sum(l."qty") FROM "stock_voucher_lines" l WHERE l."voucher_id" = v."id"),
  "total_value" = v."value"
WHERE EXISTS (SELECT 1 FROM "stock_voucher_lines" l WHERE l."voucher_id" = v."id");

-- Link legacy ledger rows to their line (voucher has exactly one line then).
-- stock_ledger is append-only, so this is NOT done; the integrity check joins by voucher_id instead.
