-- Phase 8 / migration E: customer-supplied material (client requirement 4, ERRATA E-32).
-- The customer material kept in our stores is tracked in its OWN tables and never touches stock_balances,
-- stock_ledger, stock_slices or the GL: it has no value, so "stock value = GL" (INV-1..6) cannot be disturbed.
-- A lot = one customer material of one item in one warehouse from one challan (and batch).
-- Documents (receipt / issue / return) are posted at once; a posted document is never edited, only cancelled by a
-- reversal dated the cancel date. The ledger is append-only. No company_id (D-01); no CHECK type lists (D-11).

CREATE TABLE "customer_material_lots" (
  "id"            uuid NOT NULL DEFAULT gen_random_uuid(),
  "unit_id"       uuid NOT NULL,
  "customer_id"   uuid NOT NULL,
  "item_id"       uuid NOT NULL,
  "warehouse_id"  uuid NOT NULL,
  "batch_no"      varchar(60),
  "mfg_date"      date,
  "expiry_date"   date,
  "challan_no"    varchar(60) NOT NULL,
  "challan_date"  date NOT NULL,
  "received_qty"  numeric(18,3) NOT NULL,
  "balance_qty"   numeric(18,3) NOT NULL,
  "created_by_id" uuid NOT NULL,
  "created_at"    timestamptz(3) NOT NULL DEFAULT now(),
  "updated_at"    timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "customer_material_lots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "cml_unit_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "cml_customer_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "cml_item_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "cml_warehouse_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "cml_created_by_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "cml_received_pos" CHECK ("received_qty" > 0),
  CONSTRAINT "cml_balance_range" CHECK ("balance_qty" >= 0 AND "balance_qty" <= "received_qty"),
  CONSTRAINT "cml_dates" CHECK ("expiry_date" IS NULL OR "mfg_date" IS NULL OR "expiry_date" > "mfg_date")
);
CREATE INDEX "cml_customer_item_idx" ON "customer_material_lots" ("customer_id","item_id");
CREATE INDEX "cml_warehouse_idx" ON "customer_material_lots" ("warehouse_id");
CREATE INDEX "cml_expiry_idx" ON "customer_material_lots" ("expiry_date") WHERE "expiry_date" IS NOT NULL AND "balance_qty" > 0;

CREATE TABLE "customer_material_docs" (
  "id"              uuid NOT NULL DEFAULT gen_random_uuid(),
  "code"            varchar(40) NOT NULL,
  "unit_id"         uuid NOT NULL,
  "fy_id"           uuid NOT NULL,
  "doc_type"        varchar(10) NOT NULL,
  "doc_date"        date NOT NULL,
  "customer_id"     uuid NOT NULL,
  "warehouse_id"    uuid NOT NULL,
  "challan_no"      varchar(60),
  "challan_date"    date,
  "vehicle_no"      varchar(30),
  "reference"       varchar(120),
  "remarks"         varchar(300),
  "status"          varchar(10) NOT NULL DEFAULT 'Posted',
  "cancel_reason"   varchar(300),
  "cancel_date"     date,
  "cancelled_by_id" uuid,
  "cancelled_at"    timestamptz(3),
  "version"         integer NOT NULL DEFAULT 1,
  "created_by_id"   uuid NOT NULL,
  "created_at"      timestamptz(3) NOT NULL DEFAULT now(),
  "updated_at"      timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "customer_material_docs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "cmd_unit_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "cmd_fy_fkey" FOREIGN KEY ("fy_id") REFERENCES "financial_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "cmd_customer_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "cmd_warehouse_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "cmd_created_by_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "cmd_cancelled_by_fkey" FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "cmd_status" CHECK ("status" IN ('Posted','Cancelled'))
);
CREATE UNIQUE INDEX "cmd_unit_code_key" ON "customer_material_docs" ("unit_id","code");
CREATE INDEX "cmd_customer_idx" ON "customer_material_docs" ("customer_id","doc_date");

CREATE TABLE "customer_material_lines" (
  "id"      uuid NOT NULL DEFAULT gen_random_uuid(),
  "doc_id"  uuid NOT NULL,
  "line_no" integer NOT NULL,
  "lot_id"  uuid NOT NULL,
  "item_id" uuid NOT NULL,
  "qty"     numeric(18,3) NOT NULL,
  "remarks" varchar(200),
  CONSTRAINT "customer_material_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "cmln_doc_fkey" FOREIGN KEY ("doc_id") REFERENCES "customer_material_docs"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "cmln_lot_fkey" FOREIGN KEY ("lot_id") REFERENCES "customer_material_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "cmln_item_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "cmln_qty_pos" CHECK ("qty" > 0)
);
CREATE UNIQUE INDEX "cmln_doc_line_key" ON "customer_material_lines" ("doc_id","line_no");
CREATE INDEX "cmln_lot_idx" ON "customer_material_lines" ("lot_id");

-- Append-only movement history of a lot (qty is signed: receipt +, issue / return -, a reversal the opposite).
CREATE TABLE "customer_material_ledger" (
  "id"            uuid NOT NULL DEFAULT gen_random_uuid(),
  "lot_id"        uuid NOT NULL,
  "doc_id"        uuid NOT NULL,
  "line_id"       uuid NOT NULL,
  "entry_type"    varchar(10) NOT NULL,
  "qty"           numeric(18,3) NOT NULL,
  "balance_after" numeric(18,3) NOT NULL,
  "entry_date"    date NOT NULL,
  "created_by_id" uuid NOT NULL,
  "created_at"    timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "customer_material_ledger_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "cmled_lot_fkey" FOREIGN KEY ("lot_id") REFERENCES "customer_material_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "cmled_doc_fkey" FOREIGN KEY ("doc_id") REFERENCES "customer_material_docs"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "cmled_line_fkey" FOREIGN KEY ("line_id") REFERENCES "customer_material_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "cmled_created_by_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "cmled_balance_nonneg" CHECK ("balance_after" >= 0),
  CONSTRAINT "cmled_qty_nonzero" CHECK ("qty" <> 0)
);
CREATE INDEX "cmled_lot_idx" ON "customer_material_ledger" ("lot_id","created_at");
CREATE INDEX "cmled_doc_idx" ON "customer_material_ledger" ("doc_id");
SELECT inv_make_append_only('customer_material_ledger');

-- Posted lines are never edited (R-09): lines are only ever inserted, together with their already Posted header.
CREATE FUNCTION "customer_material_lines_frozen"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Customer material lines cannot be changed after posting; cancel the document instead.' USING ERRCODE = 'P0001';
END $$;
CREATE TRIGGER "customer_material_lines_frozen_upd_del" BEFORE UPDATE OR DELETE ON "customer_material_lines"
  FOR EACH ROW EXECUTE FUNCTION "customer_material_lines_frozen"();
