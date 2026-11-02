-- Phase 5 / Inventory slice (docs/phase3-4/CONTRACT.md Stage C): items, warehouses, the append-only
-- stock ledger, stock balances and the stock vouchers. The foreign keys to users, the CHECKs, the
-- partial unique barcode index, the append-only trigger and the three Main Store warehouses are raw SQL.

-- CreateEnum
CREATE TYPE "MasterStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateTable
CREATE TABLE "items" (
    "id" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "item_type" VARCHAR(30) NOT NULL,
    "category" VARCHAR(100),
    "brand" VARCHAR(100),
    "hsn_sac" VARCHAR(8),
    "base_uom" VARCHAR(20) NOT NULL,
    "alt_uom" VARCHAR(20),
    "alt_uom_factor" DECIMAL(18,6),
    "barcode" VARCHAR(60),
    "batch_tracked" BOOLEAN NOT NULL DEFAULT false,
    "serial_tracked" BOOLEAN NOT NULL DEFAULT false,
    "shelf_life_days" INTEGER,
    "standard_cost" DECIMAL(18,2),
    "selling_price" DECIMAL(18,2),
    "reorder_level" DECIMAL(18,3),
    "status" "MasterStatus" NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouses" (
    "id" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "unit_id" UUID NOT NULL,
    "address" VARCHAR(300),
    "manager" VARCHAR(100),
    "total_capacity" DECIMAL(18,3),
    "dock_doors" INTEGER,
    "operating_hours" VARCHAR(100),
    "temperature_zone" VARCHAR(20),
    "status" "MasterStatus" NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_ledger" (
    "id" UUID NOT NULL,
    "posting_date" DATE NOT NULL,
    "posted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unit_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "qty_in" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "qty_out" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "rate" DECIMAL(18,6) NOT NULL,
    "value" DECIMAL(18,2) NOT NULL,
    "balance_qty" DECIMAL(18,3) NOT NULL,
    "balance_value" DECIMAL(18,2) NOT NULL,
    "voucher_type" VARCHAR(20) NOT NULL,
    "voucher_id" UUID NOT NULL,
    "voucher_no" VARCHAR(60) NOT NULL,
    "reverses_id" UUID,
    "created_by_id" UUID NOT NULL,

    CONSTRAINT "stock_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_balances" (
    "item_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "on_hand" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "value" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "avg_rate" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_balances_pkey" PRIMARY KEY ("item_id","warehouse_id")
);

-- CreateTable
CREATE TABLE "stock_vouchers" (
    "id" UUID NOT NULL,
    "kind" VARCHAR(12) NOT NULL,
    "number" VARCHAR(60) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "unit_id" UUID NOT NULL,
    "to_unit_id" UUID,
    "fy_id" UUID NOT NULL,
    "posting_date" DATE NOT NULL,
    "item_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "to_warehouse_id" UUID,
    "tx_type" VARCHAR(10),
    "reference" VARCHAR(100),
    "batch_serial" VARCHAR(100),
    "qty" DECIMAL(18,3) NOT NULL,
    "counted_qty" DECIMAL(18,3),
    "dispatched_qty" DECIMAL(18,3),
    "received_qty" DECIMAL(18,3),
    "unit_cost" DECIMAL(18,6),
    "value" DECIMAL(18,2),
    "system_qty" DECIMAL(18,3),
    "variance_qty" DECIMAL(18,3),
    "reason_code" VARCHAR(30),
    "approver" VARCHAR(100),
    "vehicle_ref" VARCHAR(60),
    "expected_receipt" DATE,
    "dispatch_rate" DECIMAL(18,6),
    "dispatch_value" DECIMAL(18,2),
    "department" VARCHAR(60) NOT NULL,
    "posted_at" TIMESTAMPTZ(3),
    "posted_by_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "stock_vouchers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "items_code_key" ON "items"("code");

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_code_key" ON "warehouses"("code");

-- CreateIndex
CREATE INDEX "warehouses_unit_id_idx" ON "warehouses"("unit_id");

-- CreateIndex
CREATE INDEX "stock_ledger_item_id_warehouse_id_posted_at_idx" ON "stock_ledger"("item_id", "warehouse_id", "posted_at");

-- CreateIndex
CREATE INDEX "stock_ledger_unit_id_posting_date_idx" ON "stock_ledger"("unit_id", "posting_date");

-- CreateIndex
CREATE INDEX "stock_ledger_voucher_id_idx" ON "stock_ledger"("voucher_id");

-- CreateIndex
CREATE INDEX "stock_balances_warehouse_id_idx" ON "stock_balances"("warehouse_id");

-- CreateIndex
CREATE INDEX "stock_vouchers_kind_unit_id_deleted_at_idx" ON "stock_vouchers"("kind", "unit_id", "deleted_at");

-- CreateIndex
CREATE INDEX "stock_vouchers_item_id_warehouse_id_idx" ON "stock_vouchers"("item_id", "warehouse_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_vouchers_kind_number_key" ON "stock_vouchers"("kind", "number");

-- AddForeignKey
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_vouchers" ADD CONSTRAINT "stock_vouchers_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_vouchers" ADD CONSTRAINT "stock_vouchers_fy_id_fkey" FOREIGN KEY ("fy_id") REFERENCES "financial_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_vouchers" ADD CONSTRAINT "stock_vouchers_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_vouchers" ADD CONSTRAINT "stock_vouchers_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_vouchers" ADD CONSTRAINT "stock_vouchers_to_warehouse_id_fkey" FOREIGN KEY ("to_warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Foreign keys to users (the Prisma models keep these as plain columns)
-- ---------------------------------------------------------------------------
ALTER TABLE "items" ADD CONSTRAINT "items_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "items" ADD CONSTRAINT "items_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "items" ADD CONSTRAINT "items_deleted_by_id_fkey" FOREIGN KEY ("deleted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_deleted_by_id_fkey" FOREIGN KEY ("deleted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_vouchers" ADD CONSTRAINT "stock_vouchers_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_vouchers" ADD CONSTRAINT "stock_vouchers_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "stock_vouchers" ADD CONSTRAINT "stock_vouchers_posted_by_id_fkey" FOREIGN KEY ("posted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "stock_vouchers" ADD CONSTRAINT "stock_vouchers_deleted_by_id_fkey" FOREIGN KEY ("deleted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Rules Prisma cannot express
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX "items_barcode_key" ON "items" ("barcode") WHERE "barcode" IS NOT NULL;
ALTER TABLE "items" ADD CONSTRAINT "items_code_format" CHECK ("code" ~ '^[A-Z0-9/_-]{2,30}$');
ALTER TABLE "items" ADD CONSTRAINT "items_name_length" CHECK (char_length("name") BETWEEN 2 AND 150);
ALTER TABLE "items" ADD CONSTRAINT "items_hsn_format" CHECK ("hsn_sac" IS NULL OR "hsn_sac" ~ '^([0-9]{4}|[0-9]{6}|[0-9]{8})$');
ALTER TABLE "items" ADD CONSTRAINT "items_alt_uom_factor" CHECK (("alt_uom" IS NULL AND "alt_uom_factor" IS NULL) OR ("alt_uom" IS NOT NULL AND "alt_uom_factor" > 0));
ALTER TABLE "items" ADD CONSTRAINT "items_amounts_not_negative" CHECK (COALESCE("standard_cost", 0) >= 0 AND COALESCE("selling_price", 0) >= 0 AND COALESCE("reorder_level", 0) >= 0 AND COALESCE("shelf_life_days", 1) >= 1);

ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_code_format" CHECK ("code" ~ '^[A-Z0-9/_-]{2,30}$');
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_name_length" CHECK (char_length("name") BETWEEN 2 AND 100);

ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_not_negative" CHECK ("on_hand" >= 0);
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_one_direction"
  CHECK (("qty_in" > 0 AND "qty_out" = 0) OR ("qty_in" = 0 AND "qty_out" > 0));
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_balance_not_negative" CHECK ("balance_qty" >= 0);
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_voucher_type" CHECK ("voucher_type" IN
  ('OPENING', 'RECEIPT', 'ISSUE', 'ADJUSTMENT', 'TRANSFER_OUT', 'TRANSFER_IN', 'REVERSAL'));

ALTER TABLE "stock_vouchers" ADD CONSTRAINT "stock_vouchers_kind" CHECK ("kind" IN ('OPENING', 'TRANSACTION', 'ADJUSTMENT', 'TRANSFER'));
ALTER TABLE "stock_vouchers" ADD CONSTRAINT "stock_vouchers_status" CHECK ("status" IN ('Draft', 'Posted', 'Cancelled', 'Dispatched', 'Received'));
ALTER TABLE "stock_vouchers" ADD CONSTRAINT "stock_vouchers_qty_positive" CHECK ("qty" > 0 OR "kind" = 'ADJUSTMENT');
ALTER TABLE "stock_vouchers" ADD CONSTRAINT "stock_vouchers_transfer_differs" CHECK ("kind" <> 'TRANSFER' OR ("to_warehouse_id" IS NOT NULL AND "to_warehouse_id" <> "warehouse_id"));

-- The ledger is append-only: no UPDATE, DELETE or TRUNCATE, for anyone.
CREATE FUNCTION "stock_ledger_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'stock_ledger is append-only (% not allowed)', TG_OP USING ERRCODE = 'restrict_violation';
END;
$$;
CREATE TRIGGER "stock_ledger_no_update_delete" BEFORE UPDATE OR DELETE ON "stock_ledger"
  FOR EACH ROW EXECUTE FUNCTION "stock_ledger_append_only"();
CREATE TRIGGER "stock_ledger_no_truncate" BEFORE TRUNCATE ON "stock_ledger"
  FOR EACH STATEMENT EXECUTE FUNCTION "stock_ledger_append_only"();

-- ---------------------------------------------------------------------------
-- Data: one Main Store per seeded unit, attributed to the oldest user. A database with no user yet
-- (a fresh one) gets them from the seed instead, once the Super Admin exists.
-- ---------------------------------------------------------------------------
INSERT INTO "warehouses" ("id", "code", "name", "unit_id", "status", "version", "created_by_id", "created_at", "updated_at")
SELECT gen_random_uuid(), w.code, w.name, un."id", 'ACTIVE', 1, u."id", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (VALUES ('TAL-MAIN', 'Talwade Main Store', 'TAL'), ('SAW-MAIN', 'Sawardari Main Store', 'SAW'), ('VAR-MAIN', 'Varale Main Store', 'VAR')) AS w(code, name, unit_code)
JOIN "units" un ON un."code" = w.unit_code
CROSS JOIN (SELECT "id" FROM "users" ORDER BY "created_at" ASC LIMIT 1) u
ON CONFLICT DO NOTHING;
