-- Phase 8 / migration B: batches, serials, bins and the stock slice layer.
-- stock_balances (item x warehouse) stays the authority for quantity and value. stock_slices splits the
-- quantity by batch / bin / stock status and MUST add up to it (invariant INV-3, checked by
-- GET /inventory/integrity). No company_id (D-01), closed lists use CHECK (STANDARDS §5).

CREATE TABLE "batches" (
  "id"            uuid NOT NULL DEFAULT gen_random_uuid(),
  "item_id"       uuid NOT NULL,
  "batch_no"      varchar(60) NOT NULL,
  "mfg_date"      date,
  "expiry_date"   date,
  "supplier_name" varchar(150),
  "grn_ref"       varchar(60),
  "qc_status"     varchar(12) NOT NULL DEFAULT 'Released',
  "recalled"      boolean NOT NULL DEFAULT false,
  "disposition"   varchar(20),
  "is_legacy"     boolean NOT NULL DEFAULT false,
  "notes"         varchar(300),
  "status"        varchar(10) NOT NULL DEFAULT 'Active',
  "version"       integer NOT NULL DEFAULT 1,
  "created_by_id" uuid NOT NULL,
  "created_at"    timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid,
  "updated_at"    timestamptz(3) NOT NULL DEFAULT now(),
  "deleted_by_id" uuid,
  "deleted_at"    timestamptz(3),
  CONSTRAINT "batches_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "batches_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "batches_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "batches_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "batches_deleted_by_id_fkey" FOREIGN KEY ("deleted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "batches_qc_status" CHECK ("qc_status" IN ('Pending QC','Released','On Hold','Rejected')),
  CONSTRAINT "batches_status" CHECK ("status" IN ('Active','Inactive','Exhausted')),
  CONSTRAINT "batches_disposition" CHECK ("disposition" IS NULL OR "disposition" IN ('Use First','Discount Sale','Return to Supplier','Rework','Scrap','Donate')),
  CONSTRAINT "batches_dates" CHECK ("expiry_date" IS NULL OR "mfg_date" IS NULL OR "expiry_date" > "mfg_date"),
  CONSTRAINT "batches_batch_no" CHECK (char_length("batch_no") BETWEEN 1 AND 60)
);
CREATE UNIQUE INDEX "batches_item_id_batch_no_key" ON "batches" ("item_id","batch_no");
CREATE INDEX "batches_expiry_date_idx" ON "batches" ("expiry_date") WHERE "expiry_date" IS NOT NULL;

CREATE TABLE "batch_events" (
  "id"            uuid NOT NULL DEFAULT gen_random_uuid(),
  "batch_id"      uuid NOT NULL,
  "event"         varchar(30) NOT NULL,
  "from_value"    varchar(60),
  "to_value"      varchar(60),
  "reason"        varchar(300),
  "created_by_id" uuid NOT NULL,
  "created_at"    timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "batch_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "batch_events_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "batch_events_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "batch_events_batch_id_idx" ON "batch_events" ("batch_id");
SELECT inv_make_append_only('batch_events');

-- Bins (a bin belongs to ONE warehouse; zone is a free label, racks/shelves are not modelled).
CREATE TABLE "wms_bins" (
  "id"            uuid NOT NULL DEFAULT gen_random_uuid(),
  "warehouse_id"  uuid NOT NULL,
  "code"          varchar(30) NOT NULL,
  "name"          varchar(100),
  "zone"          varchar(30),
  "bin_type"      varchar(12) NOT NULL DEFAULT 'Storage',
  "capacity"      numeric(18,3),
  "status"        varchar(10) NOT NULL DEFAULT 'Active',
  "version"       integer NOT NULL DEFAULT 1,
  "created_by_id" uuid NOT NULL,
  "created_at"    timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid,
  "updated_at"    timestamptz(3) NOT NULL DEFAULT now(),
  "deleted_by_id" uuid,
  "deleted_at"    timestamptz(3),
  CONSTRAINT "wms_bins_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "wms_bins_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "wms_bins_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "wms_bins_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "wms_bins_deleted_by_id_fkey" FOREIGN KEY ("deleted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "wms_bins_code" CHECK ("code" ~ '^[A-Z0-9_/-]{1,30}$'),
  CONSTRAINT "wms_bins_type" CHECK ("bin_type" IN ('Storage','Staging','Quarantine','Pick Face')),
  CONSTRAINT "wms_bins_status" CHECK ("status" IN ('Active','Inactive')),
  CONSTRAINT "wms_bins_capacity" CHECK ("capacity" IS NULL OR "capacity" >= 0)
);
CREATE UNIQUE INDEX "wms_bins_warehouse_id_code_key" ON "wms_bins" ("warehouse_id","code");
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_bin_id_fkey" FOREIGN KEY ("bin_id") REFERENCES "wms_bins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "stock_ledger_batch_id_idx" ON "stock_ledger" ("batch_id") WHERE "batch_id" IS NOT NULL;
ALTER TABLE "stock_voucher_lines" ADD CONSTRAINT "stock_voucher_lines_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_voucher_lines" ADD CONSTRAINT "stock_voucher_lines_bin_id_fkey" FOREIGN KEY ("bin_id") REFERENCES "wms_bins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "stock_voucher_lines_batch_id_idx" ON "stock_voucher_lines" ("batch_id") WHERE "batch_id" IS NOT NULL;

-- Serial numbers
CREATE TABLE "serial_numbers" (
  "id"               uuid NOT NULL DEFAULT gen_random_uuid(),
  "item_id"          uuid NOT NULL,
  "serial_no"        varchar(60) NOT NULL,
  "warehouse_id"     uuid,
  "status"           varchar(12) NOT NULL DEFAULT 'In Stock',
  "batch_id"         uuid,
  "current_owner"    varchar(100),
  "last_movement_at" timestamptz(3),
  "created_by_id"    uuid NOT NULL,
  "created_at"       timestamptz(3) NOT NULL DEFAULT now(),
  "version"          integer NOT NULL DEFAULT 1,
  CONSTRAINT "serial_numbers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "serial_numbers_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "serial_numbers_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "serial_numbers_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "serial_numbers_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "serial_numbers_status" CHECK ("status" IN ('In Stock','Reserved','In Transit','Issued','Returned','Scrapped'))
);
CREATE UNIQUE INDEX "serial_numbers_item_id_serial_no_key" ON "serial_numbers" ("item_id","serial_no");
CREATE INDEX "serial_numbers_warehouse_id_idx" ON "serial_numbers" ("warehouse_id") WHERE "warehouse_id" IS NOT NULL;

CREATE TABLE "serial_events" (
  "id"            uuid NOT NULL DEFAULT gen_random_uuid(),
  "serial_id"     uuid NOT NULL,
  "event"         varchar(20) NOT NULL,
  "warehouse_id"  uuid,
  "voucher_id"    uuid,
  "voucher_no"    varchar(60),
  "created_by_id" uuid NOT NULL,
  "created_at"    timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "serial_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "serial_events_serial_id_fkey" FOREIGN KEY ("serial_id") REFERENCES "serial_numbers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "serial_events_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "serial_events_serial_id_idx" ON "serial_events" ("serial_id");
SELECT inv_make_append_only('serial_events');

-- The slice layer: quantity by (item, warehouse, batch, bin, status). NULL batch/bin are stored as the
-- all-zero uuid so the primary key stays plain and ON CONFLICT works.
CREATE TABLE "stock_slices" (
  "item_id"      uuid NOT NULL,
  "warehouse_id" uuid NOT NULL,
  "batch_id"     uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  "bin_id"       uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  "stock_status" varchar(20) NOT NULL DEFAULT 'UNRESTRICTED',
  "qty"          numeric(18,3) NOT NULL DEFAULT 0,
  "updated_at"   timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "stock_slices_pkey" PRIMARY KEY ("item_id","warehouse_id","batch_id","bin_id","stock_status"),
  CONSTRAINT "stock_slices_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "stock_slices_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "stock_slices_status" CHECK ("stock_status" IN ('UNRESTRICTED','QUALITY_INSPECTION','BLOCKED')),
  CONSTRAINT "stock_slices_qty_not_negative" CHECK ("qty" >= 0)
);
CREATE INDEX "stock_slices_warehouse_id_idx" ON "stock_slices" ("warehouse_id");
CREATE INDEX "stock_slices_batch_id_idx" ON "stock_slices" ("batch_id") WHERE "batch_id" <> '00000000-0000-0000-0000-000000000000';

-- Reservations and holds (reserved qty lives on stock_balances.reserved_qty, from the foundation migration).
CREATE TABLE "stock_reservations" (
  "id"             uuid NOT NULL DEFAULT gen_random_uuid(),
  "code"           varchar(60) NOT NULL,
  "unit_id"        uuid NOT NULL,
  "fy_id"          uuid NOT NULL,
  "department"     varchar(60) NOT NULL,
  "item_id"        uuid NOT NULL,
  "warehouse_id"   uuid NOT NULL,
  "batch_id"       uuid,
  "demand_type"    varchar(30) NOT NULL DEFAULT 'Manual',
  "demand_ref"     varchar(60),
  "priority"       varchar(8) NOT NULL DEFAULT 'Medium',
  "required_qty"   numeric(18,3) NOT NULL,
  "reserved_qty"   numeric(18,3) NOT NULL DEFAULT 0,
  "fulfilled_qty"  numeric(18,3) NOT NULL DEFAULT 0,
  "reserved_until" date,
  "status"         varchar(10) NOT NULL DEFAULT 'Waiting',
  "release_reason" varchar(300),
  "version"        integer NOT NULL DEFAULT 1,
  "created_by_id"  uuid NOT NULL,
  "created_at"     timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id"  uuid,
  "updated_at"     timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "stock_reservations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "stock_reservations_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "stock_reservations_fy_id_fkey" FOREIGN KEY ("fy_id") REFERENCES "financial_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "stock_reservations_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "stock_reservations_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "stock_reservations_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "stock_reservations_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "stock_reservations_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "stock_reservations_priority" CHECK ("priority" IN ('Critical','High','Medium','Low')),
  CONSTRAINT "stock_reservations_status" CHECK ("status" IN ('Waiting','Partial','Reserved','Fulfilled','Released','Expired')),
  CONSTRAINT "stock_reservations_qty" CHECK ("required_qty" > 0 AND "reserved_qty" >= 0 AND "fulfilled_qty" >= 0 AND "reserved_qty" + "fulfilled_qty" <= "required_qty")
);
CREATE UNIQUE INDEX "stock_reservations_code_key" ON "stock_reservations" ("code");
CREATE INDEX "stock_reservations_item_warehouse_idx" ON "stock_reservations" ("item_id","warehouse_id");
CREATE INDEX "stock_reservations_unit_id_idx" ON "stock_reservations" ("unit_id");
ALTER TABLE "stock_voucher_lines" ADD COLUMN "reservation_id" uuid;
ALTER TABLE "stock_voucher_lines" ADD CONSTRAINT "stock_voucher_lines_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "stock_reservations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "stock_holds" (
  "id"            uuid NOT NULL DEFAULT gen_random_uuid(),
  "code"          varchar(60) NOT NULL,
  "unit_id"       uuid NOT NULL,
  "item_id"       uuid NOT NULL,
  "warehouse_id"  uuid NOT NULL,
  "batch_id"      uuid,
  "qty"           numeric(18,3) NOT NULL,
  "reason"        varchar(300) NOT NULL,
  "status"        varchar(10) NOT NULL DEFAULT 'Active',
  "released_at"   timestamptz(3),
  "released_by_id" uuid,
  "created_by_id" uuid NOT NULL,
  "created_at"    timestamptz(3) NOT NULL DEFAULT now(),
  "version"       integer NOT NULL DEFAULT 1,
  CONSTRAINT "stock_holds_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "stock_holds_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "stock_holds_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "stock_holds_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "stock_holds_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "stock_holds_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "stock_holds_released_by_id_fkey" FOREIGN KEY ("released_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "stock_holds_status" CHECK ("status" IN ('Active','Released')),
  CONSTRAINT "stock_holds_qty" CHECK ("qty" > 0)
);
CREATE UNIQUE INDEX "stock_holds_code_key" ON "stock_holds" ("code");
CREATE INDEX "stock_holds_item_warehouse_idx" ON "stock_holds" ("item_id","warehouse_id") WHERE "status" = 'Active';

-- ---------------------------------------------------------------------------------------------
-- Backfill (pre-flight job proves it first): every existing positive balance becomes ONE UNRESTRICTED
-- slice with no batch / bin. Legacy tracked items keep working because their slice carries no batch yet;
-- the integrity check lists tracked items that still hold un-batched stock.
-- ---------------------------------------------------------------------------------------------
INSERT INTO "stock_slices" ("item_id","warehouse_id","stock_status","qty")
SELECT "item_id","warehouse_id",'UNRESTRICTED',"on_hand" FROM "stock_balances" WHERE "on_hand" > 0
ON CONFLICT DO NOTHING;
