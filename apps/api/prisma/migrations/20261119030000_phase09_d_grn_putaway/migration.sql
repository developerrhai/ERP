-- Phase 09 / D: goods receipt, batches, charges and put-away tasks (PHASE-09 §4.4).

CREATE TABLE "goods_receipts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "fy_id" uuid NOT NULL REFERENCES "financial_years"("id") ON DELETE RESTRICT,
  "number" varchar(40),
  "department" varchar(60) NOT NULL DEFAULT '',
  "status" varchar(20) NOT NULL DEFAULT 'Draft',
  "po_id" uuid NOT NULL REFERENCES "purchase_orders"("id") ON DELETE RESTRICT,
  "supplier_id" uuid NOT NULL REFERENCES "suppliers"("id") ON DELETE RESTRICT,
  "warehouse_id" uuid NOT NULL REFERENCES "warehouses"("id") ON DELETE RESTRICT,
  "receipt_date" date NOT NULL DEFAULT CURRENT_DATE,
  "vehicle_no" varchar(30),
  "lr_no" varchar(40),
  "vendor_invoice_ref" varchar(60),
  "qc_status" varchar(10) NOT NULL DEFAULT 'NONE',
  "putaway_status" varchar(10) NOT NULL DEFAULT 'NONE',
  "posted_at" timestamptz(3),
  "journal_id" uuid,
  "cancel_journal_id" uuid,
  "cancelled_at" timestamptz(3),
  "cancel_reason" varchar(300),
  "total_value" numeric(18,2) NOT NULL DEFAULT 0,
  "notes" varchar(500),
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "deleted_at" timestamptz(3),
  "deleted_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "goods_receipts_status_chk" CHECK ("status" IN ('Draft','Pending Approval','Approved','Rejected','Posted','Cancelled')),
  CONSTRAINT "goods_receipts_qc_chk" CHECK ("qc_status" IN ('NONE','PENDING','PARTIAL','DONE')),
  CONSTRAINT "goods_receipts_put_chk" CHECK ("putaway_status" IN ('NONE','PENDING','PARTIAL','DONE'))
);
CREATE UNIQUE INDEX "goods_receipts_number_uq" ON "goods_receipts"("unit_id","fy_id","number") WHERE "number" IS NOT NULL;
CREATE INDEX "goods_receipts_unit_idx" ON "goods_receipts"("unit_id");
CREATE INDEX "goods_receipts_fy_idx" ON "goods_receipts"("fy_id");
CREATE INDEX "goods_receipts_status_idx" ON "goods_receipts"("status");
CREATE INDEX "goods_receipts_created_by_idx" ON "goods_receipts"("created_by_id");
CREATE INDEX "goods_receipts_updated_by_idx" ON "goods_receipts"("updated_by_id");
CREATE INDEX "goods_receipts_deleted_by_idx" ON "goods_receipts"("deleted_by_id");

CREATE INDEX "goods_receipts_po_idx" ON "goods_receipts"("po_id");
CREATE INDEX "goods_receipts_supplier_idx" ON "goods_receipts"("supplier_id","status");
CREATE INDEX "goods_receipts_wh_idx" ON "goods_receipts"("warehouse_id");

CREATE TABLE "goods_receipt_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "grn_id" uuid NOT NULL REFERENCES "goods_receipts"("id") ON DELETE CASCADE,
  "line_no" integer NOT NULL,
  "po_line_id" uuid NOT NULL REFERENCES "purchase_order_lines"("id") ON DELETE RESTRICT,
  "item_id" uuid REFERENCES "items"("id") ON DELETE RESTRICT,
  "uom" varchar(20) NOT NULL,
  "received_qty" numeric(18,3) NOT NULL,
  "base_qty" numeric(18,3) NOT NULL,
  "qc_required" boolean NOT NULL DEFAULT false,
  "qc_state" varchar(14) NOT NULL DEFAULT 'NOT_REQUIRED',
  "accepted_qty" numeric(18,3) NOT NULL DEFAULT 0,
  "rejected_qty" numeric(18,3) NOT NULL DEFAULT 0,
  "reject_reason" varchar(300),
  "rate" numeric(18,6) NOT NULL DEFAULT 0,
  "taxable_value" numeric(18,2) NOT NULL DEFAULT 0,
  "landed_charge" numeric(18,2) NOT NULL DEFAULT 0,
  "stock_value" numeric(18,2) NOT NULL DEFAULT 0,
  "unit_cost" numeric(18,6) NOT NULL DEFAULT 0,
  "billed_qty" numeric(18,3) NOT NULL DEFAULT 0,
  "returned_qty" numeric(18,3) NOT NULL DEFAULT 0,
  "putaway_qty" numeric(18,3) NOT NULL DEFAULT 0,
  "weight" numeric(18,3),
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "grn_lines_qc_state_chk" CHECK ("qc_state" IN ('PENDING','DONE','NOT_REQUIRED')),
  CONSTRAINT "grn_lines_qty_chk" CHECK ("received_qty" > 0 AND "accepted_qty" >= 0 AND "rejected_qty" >= 0 AND "billed_qty" >= 0 AND "returned_qty" >= 0 AND "putaway_qty" >= 0 AND "accepted_qty" + "rejected_qty" <= "received_qty")
);
CREATE INDEX "goods_receipt_lines_grn_id_idx" ON "goods_receipt_lines"("grn_id");
CREATE INDEX "goods_receipt_lines_po_line_id_idx" ON "goods_receipt_lines"("po_line_id");
CREATE INDEX "goods_receipt_lines_item_id_idx" ON "goods_receipt_lines"("item_id");

CREATE UNIQUE INDEX "grn_lines_grn_line_uq" ON "goods_receipt_lines"("grn_id","line_no");

CREATE TABLE "goods_receipt_batches" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "grn_line_id" uuid NOT NULL REFERENCES "goods_receipt_lines"("id") ON DELETE CASCADE,
  "batch_no" varchar(60) NOT NULL,
  "batch_id" uuid REFERENCES "batches"("id") ON DELETE RESTRICT,
  "mfg_date" date,
  "expiry_date" date,
  "qty" numeric(18,3) NOT NULL,
  "serial_nos" text[],
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "grn_batches_qty_chk" CHECK ("qty" > 0)
);
CREATE INDEX "goods_receipt_batches_grn_line_id_idx" ON "goods_receipt_batches"("grn_line_id");
CREATE INDEX "goods_receipt_batches_batch_id_idx" ON "goods_receipt_batches"("batch_id");

CREATE TABLE "goods_receipt_charges" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "grn_id" uuid NOT NULL REFERENCES "goods_receipts"("id") ON DELETE CASCADE,
  "charge_type" varchar(20) NOT NULL,
  "amount" numeric(18,2) NOT NULL,
  "basis" varchar(6) NOT NULL DEFAULT 'VALUE',
  "capitalize" boolean NOT NULL DEFAULT true,
  "supplier_id" uuid REFERENCES "suppliers"("id") ON DELETE RESTRICT,
  "invoice_id" uuid,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "grn_charges_basis_chk" CHECK ("basis" IN ('VALUE','QTY','WEIGHT')),
  CONSTRAINT "grn_charges_amount_chk" CHECK ("amount" >= 0)
);
CREATE INDEX "goods_receipt_charges_grn_id_idx" ON "goods_receipt_charges"("grn_id");
CREATE INDEX "goods_receipt_charges_supplier_id_idx" ON "goods_receipt_charges"("supplier_id");

CREATE TABLE "putaway_tasks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "task_no" varchar(40),
  "grn_id" uuid NOT NULL REFERENCES "goods_receipts"("id") ON DELETE RESTRICT,
  "grn_line_id" uuid NOT NULL REFERENCES "goods_receipt_lines"("id") ON DELETE RESTRICT,
  "item_id" uuid NOT NULL REFERENCES "items"("id") ON DELETE RESTRICT,
  "batch_id" uuid REFERENCES "batches"("id") ON DELETE RESTRICT,
  "qty" numeric(18,3) NOT NULL,
  "warehouse_id" uuid NOT NULL REFERENCES "warehouses"("id") ON DELETE RESTRICT,
  "from_bin_id" uuid REFERENCES "wms_bins"("id") ON DELETE RESTRICT,
  "suggested_bin_id" uuid REFERENCES "wms_bins"("id") ON DELETE RESTRICT,
  "actual_bin_id" uuid REFERENCES "wms_bins"("id") ON DELETE RESTRICT,
  "operator_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "priority" smallint NOT NULL DEFAULT 3,
  "status" varchar(10) NOT NULL DEFAULT 'Open',
  "exception_reason" varchar(300),
  "claimed_at" timestamptz(3),
  "completed_at" timestamptz(3),
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "putaway_tasks_status_chk" CHECK ("status" IN ('Open','Assigned','Done','Exception','Cancelled')),
  CONSTRAINT "putaway_tasks_qty_chk" CHECK ("qty" > 0)
);
CREATE UNIQUE INDEX "putaway_tasks_no_uq" ON "putaway_tasks"("unit_id","task_no") WHERE "task_no" IS NOT NULL;
CREATE INDEX "putaway_tasks_status_idx" ON "putaway_tasks"("unit_id","status");
CREATE INDEX "putaway_tasks_grn_idx" ON "putaway_tasks"("grn_id");
CREATE INDEX "putaway_tasks_grn_line_idx" ON "putaway_tasks"("grn_line_id");
CREATE INDEX "putaway_tasks_item_idx" ON "putaway_tasks"("item_id");
CREATE INDEX "putaway_tasks_batch_idx" ON "putaway_tasks"("batch_id");
CREATE INDEX "putaway_tasks_wh_idx" ON "putaway_tasks"("warehouse_id");
CREATE INDEX "putaway_tasks_from_bin_idx" ON "putaway_tasks"("from_bin_id");
CREATE INDEX "putaway_tasks_sug_bin_idx" ON "putaway_tasks"("suggested_bin_id");
CREATE INDEX "putaway_tasks_act_bin_idx" ON "putaway_tasks"("actual_bin_id");
CREATE INDEX "putaway_tasks_operator_idx" ON "putaway_tasks"("operator_id");
CREATE INDEX "putaway_tasks_created_by_idx" ON "putaway_tasks"("created_by_id");
CREATE INDEX "putaway_tasks_updated_by_idx" ON "putaway_tasks"("updated_by_id");
