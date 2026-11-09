-- Phase 10 / D: dispatch (delivery challan), sales invoice, sales return with credit note.
CREATE TABLE "sales_dispatches" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "fy_id" uuid NOT NULL REFERENCES "financial_years"("id") ON DELETE RESTRICT,
  "number" varchar(40),
  "department" varchar(60) NOT NULL DEFAULT '',
  "status" varchar(20) NOT NULL DEFAULT 'Draft',
  "customer_id" uuid NOT NULL REFERENCES "customers"("id") ON DELETE RESTRICT,
  "order_id" uuid NOT NULL REFERENCES "sales_orders"("id") ON DELETE RESTRICT,
  "warehouse_id" uuid NOT NULL REFERENCES "warehouses"("id") ON DELETE RESTRICT,
  "dispatch_date" date NOT NULL DEFAULT CURRENT_DATE,
  "vehicle_no" varchar(30),
  "transporter" varchar(100),
  "lr_no" varchar(40),
  "driver" varchar(80),
  "ship_to" varchar(300),
  "weight_kg" numeric(18,3),
  "remark" varchar(300),
  "cost_total" numeric(18,2) NOT NULL DEFAULT 0,
  "journal_id" uuid,
  "cancel_journal_id" uuid,
  "posted_at" timestamptz(3),
  "cancel_reason" varchar(300),
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "deleted_at" timestamptz(3),
  "deleted_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "sales_dispatches_status_chk" CHECK ("status" IN ('Draft','Pending Approval','Approved','Rejected','Posted','Cancelled'))
);
CREATE UNIQUE INDEX "sales_dispatches_number_uq" ON "sales_dispatches"("unit_id","fy_id","number") WHERE "number" IS NOT NULL;
CREATE INDEX "sales_dispatches_unit_idx" ON "sales_dispatches"("unit_id");
CREATE INDEX "sales_dispatches_fy_idx" ON "sales_dispatches"("fy_id");
CREATE INDEX "sales_dispatches_status_idx" ON "sales_dispatches"("status");
CREATE INDEX "sales_dispatches_created_by_idx" ON "sales_dispatches"("created_by_id");
CREATE INDEX "sales_dispatches_updated_by_idx" ON "sales_dispatches"("updated_by_id");
CREATE INDEX "sales_dispatches_deleted_by_idx" ON "sales_dispatches"("deleted_by_id");

CREATE INDEX "sd_customer_idx" ON "sales_dispatches"("customer_id");
CREATE INDEX "sd_order_idx" ON "sales_dispatches"("order_id");
CREATE INDEX "sd_wh_idx" ON "sales_dispatches"("warehouse_id");
CREATE TABLE "sales_dispatch_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "dispatch_id" uuid NOT NULL REFERENCES "sales_dispatches"("id") ON DELETE CASCADE,
  "line_no" integer NOT NULL,
  "order_line_id" uuid NOT NULL REFERENCES "sales_order_lines"("id") ON DELETE RESTRICT,
  "item_id" uuid NOT NULL REFERENCES "items"("id") ON DELETE RESTRICT,
  "qty" numeric(18,3) NOT NULL,
  "uom" varchar(20) NOT NULL,
  "batch_no" varchar(60),
  "serial_nos" text[],
  "inspection_serial" varchar(60),
  "remark" varchar(200),
  "unit_cost" numeric(18,6) NOT NULL DEFAULT 0,
  "cost_value" numeric(18,2) NOT NULL DEFAULT 0,
  "invoiced_qty" numeric(18,3) NOT NULL DEFAULT 0,
  "returned_qty" numeric(18,3) NOT NULL DEFAULT 0,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "sdl_qty_chk" CHECK ("qty" > 0 AND "invoiced_qty" >= 0 AND "returned_qty" >= 0)
);
CREATE INDEX "sales_dispatch_lines_dispatch_id_idx" ON "sales_dispatch_lines"("dispatch_id");
CREATE INDEX "sales_dispatch_lines_order_line_id_idx" ON "sales_dispatch_lines"("order_line_id");
CREATE INDEX "sales_dispatch_lines_item_id_idx" ON "sales_dispatch_lines"("item_id");

CREATE TABLE "sales_invoices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "fy_id" uuid NOT NULL REFERENCES "financial_years"("id") ON DELETE RESTRICT,
  "number" varchar(40),
  "department" varchar(60) NOT NULL DEFAULT '',
  "status" varchar(20) NOT NULL DEFAULT 'Draft',
  "customer_id" uuid NOT NULL REFERENCES "customers"("id") ON DELETE RESTRICT,
  "order_id" uuid REFERENCES "sales_orders"("id") ON DELETE RESTRICT,
  "invoice_date" date NOT NULL DEFAULT CURRENT_DATE,
  "due_date" date,
  "customer_state" char(2),
  "regime" varchar(10) NOT NULL DEFAULT 'INTRA',
  "taxable" numeric(18,2) NOT NULL DEFAULT 0,
  "cgst" numeric(18,2) NOT NULL DEFAULT 0,
  "sgst" numeric(18,2) NOT NULL DEFAULT 0,
  "igst" numeric(18,2) NOT NULL DEFAULT 0,
  "freight" numeric(18,2) NOT NULL DEFAULT 0,
  "round_off" numeric(18,2) NOT NULL DEFAULT 0,
  "grand_total" numeric(18,2) NOT NULL DEFAULT 0,
  "received_amount" numeric(18,2) NOT NULL DEFAULT 0,
  "receipt_status" varchar(10) NOT NULL DEFAULT 'UNPAID',
  "irn" varchar(64),
  "journal_id" uuid,
  "cancel_journal_id" uuid,
  "posted_at" timestamptz(3),
  "cancel_reason" varchar(300),
  "notes" varchar(500),
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "deleted_at" timestamptz(3),
  "deleted_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "sales_invoices_status_chk" CHECK ("status" IN ('Draft','Pending Approval','Approved','Rejected','Posted','Cancelled')),
  CONSTRAINT "si_regime_chk" CHECK ("regime" IN ('INTRA','INTER')),
  CONSTRAINT "si_rcpt_chk" CHECK ("receipt_status" IN ('UNPAID','PARTIAL','PAID'))
);
CREATE UNIQUE INDEX "sales_invoices_number_uq" ON "sales_invoices"("unit_id","fy_id","number") WHERE "number" IS NOT NULL;
CREATE INDEX "sales_invoices_unit_idx" ON "sales_invoices"("unit_id");
CREATE INDEX "sales_invoices_fy_idx" ON "sales_invoices"("fy_id");
CREATE INDEX "sales_invoices_status_idx" ON "sales_invoices"("status");
CREATE INDEX "sales_invoices_created_by_idx" ON "sales_invoices"("created_by_id");
CREATE INDEX "sales_invoices_updated_by_idx" ON "sales_invoices"("updated_by_id");
CREATE INDEX "sales_invoices_deleted_by_idx" ON "sales_invoices"("deleted_by_id");

CREATE INDEX "si_customer_idx" ON "sales_invoices"("customer_id","status");
CREATE INDEX "si_order_idx" ON "sales_invoices"("order_id");
CREATE INDEX "si_due_idx" ON "sales_invoices"("due_date") WHERE "receipt_status" <> 'PAID';
CREATE TABLE "sales_invoice_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "invoice_id" uuid NOT NULL REFERENCES "sales_invoices"("id") ON DELETE CASCADE,
  "line_no" integer NOT NULL,
  "dispatch_line_id" uuid REFERENCES "sales_dispatch_lines"("id") ON DELETE RESTRICT,
  "order_line_id" uuid REFERENCES "sales_order_lines"("id") ON DELETE RESTRICT,
  "item_id" uuid REFERENCES "items"("id") ON DELETE RESTRICT,
  "description" varchar(300),
  "hsn_sac" varchar(8),
  "qty" numeric(18,3) NOT NULL,
  "uom" varchar(20),
  "rate" numeric(18,6) NOT NULL,
  "discount_pct" numeric(7,4) NOT NULL DEFAULT 0,
  "gst_pct" numeric(7,4) NOT NULL DEFAULT 0,
  "taxable" numeric(18,2) NOT NULL DEFAULT 0,
  "cgst" numeric(18,2) NOT NULL DEFAULT 0,
  "sgst" numeric(18,2) NOT NULL DEFAULT 0,
  "igst" numeric(18,2) NOT NULL DEFAULT 0,
  "returned_qty" numeric(18,3) NOT NULL DEFAULT 0,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "sil_qty_chk" CHECK ("qty" > 0 AND "returned_qty" >= 0)
);
CREATE INDEX "sales_invoice_lines_invoice_id_idx" ON "sales_invoice_lines"("invoice_id");
CREATE INDEX "sales_invoice_lines_dispatch_line_id_idx" ON "sales_invoice_lines"("dispatch_line_id");
CREATE INDEX "sales_invoice_lines_order_line_id_idx" ON "sales_invoice_lines"("order_line_id");
CREATE INDEX "sales_invoice_lines_item_id_idx" ON "sales_invoice_lines"("item_id");

CREATE TABLE "sales_receipts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "fy_id" uuid NOT NULL REFERENCES "financial_years"("id") ON DELETE RESTRICT,
  "number" varchar(40),
  "customer_id" uuid NOT NULL REFERENCES "customers"("id") ON DELETE RESTRICT,
  "receipt_date" date NOT NULL,
  "amount" numeric(18,2) NOT NULL,
  "bank_account_id" uuid NOT NULL,
  "mode" varchar(10) NOT NULL,
  "reference" varchar(60),
  "journal_id" uuid,
  "status" varchar(10) NOT NULL DEFAULT 'Posted',
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "sr_amount_chk" CHECK ("amount" > 0),
  CONSTRAINT "sr_status_chk" CHECK ("status" IN ('Posted','Cancelled'))
);
CREATE UNIQUE INDEX "sr_number_uq" ON "sales_receipts"("unit_id","fy_id","number") WHERE "number" IS NOT NULL;
CREATE INDEX "sr_customer_idx" ON "sales_receipts"("customer_id");
CREATE INDEX "sr_fy_idx" ON "sales_receipts"("fy_id");
CREATE INDEX "sr_created_by_idx" ON "sales_receipts"("created_by_id");
CREATE TABLE "sales_receipt_allocations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "receipt_id" uuid NOT NULL REFERENCES "sales_receipts"("id") ON DELETE CASCADE,
  "invoice_id" uuid NOT NULL REFERENCES "sales_invoices"("id") ON DELETE RESTRICT,
  "amount" numeric(18,2) NOT NULL,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "sra_amount_chk" CHECK ("amount" > 0)
);
CREATE INDEX "sales_receipt_allocations_receipt_id_idx" ON "sales_receipt_allocations"("receipt_id");
CREATE INDEX "sales_receipt_allocations_invoice_id_idx" ON "sales_receipt_allocations"("invoice_id");

CREATE TABLE "sales_returns" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "fy_id" uuid NOT NULL REFERENCES "financial_years"("id") ON DELETE RESTRICT,
  "number" varchar(40),
  "department" varchar(60) NOT NULL DEFAULT '',
  "status" varchar(20) NOT NULL DEFAULT 'Draft',
  "customer_id" uuid NOT NULL REFERENCES "customers"("id") ON DELETE RESTRICT,
  "invoice_id" uuid NOT NULL REFERENCES "sales_invoices"("id") ON DELETE RESTRICT,
  "warehouse_id" uuid NOT NULL REFERENCES "warehouses"("id") ON DELETE RESTRICT,
  "return_date" date NOT NULL DEFAULT CURRENT_DATE,
  "reason" varchar(300),
  "regime" varchar(10) NOT NULL DEFAULT 'INTRA',
  "taxable" numeric(18,2) NOT NULL DEFAULT 0,
  "cgst" numeric(18,2) NOT NULL DEFAULT 0,
  "sgst" numeric(18,2) NOT NULL DEFAULT 0,
  "igst" numeric(18,2) NOT NULL DEFAULT 0,
  "round_off" numeric(18,2) NOT NULL DEFAULT 0,
  "grand_total" numeric(18,2) NOT NULL DEFAULT 0,
  "credit_note_no" varchar(40),
  "journal_id" uuid,
  "cancel_journal_id" uuid,
  "posted_at" timestamptz(3),
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "deleted_at" timestamptz(3),
  "deleted_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "sales_returns_status_chk" CHECK ("status" IN ('Draft','Pending Approval','Approved','Rejected','Posted','Cancelled'))
);
CREATE UNIQUE INDEX "sales_returns_number_uq" ON "sales_returns"("unit_id","fy_id","number") WHERE "number" IS NOT NULL;
CREATE INDEX "sales_returns_unit_idx" ON "sales_returns"("unit_id");
CREATE INDEX "sales_returns_fy_idx" ON "sales_returns"("fy_id");
CREATE INDEX "sales_returns_status_idx" ON "sales_returns"("status");
CREATE INDEX "sales_returns_created_by_idx" ON "sales_returns"("created_by_id");
CREATE INDEX "sales_returns_updated_by_idx" ON "sales_returns"("updated_by_id");
CREATE INDEX "sales_returns_deleted_by_idx" ON "sales_returns"("deleted_by_id");

CREATE INDEX "sret_customer_idx" ON "sales_returns"("customer_id");
CREATE INDEX "sret_invoice_idx" ON "sales_returns"("invoice_id");
CREATE INDEX "sret_wh_idx" ON "sales_returns"("warehouse_id");
CREATE TABLE "sales_return_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "return_id" uuid NOT NULL REFERENCES "sales_returns"("id") ON DELETE CASCADE,
  "line_no" integer NOT NULL,
  "invoice_line_id" uuid NOT NULL REFERENCES "sales_invoice_lines"("id") ON DELETE RESTRICT,
  "item_id" uuid NOT NULL REFERENCES "items"("id") ON DELETE RESTRICT,
  "qty" numeric(18,3) NOT NULL,
  "rate" numeric(18,6) NOT NULL,
  "gst_pct" numeric(7,4) NOT NULL DEFAULT 0,
  "taxable" numeric(18,2) NOT NULL DEFAULT 0,
  "cgst" numeric(18,2) NOT NULL DEFAULT 0,
  "sgst" numeric(18,2) NOT NULL DEFAULT 0,
  "igst" numeric(18,2) NOT NULL DEFAULT 0,
  "unit_cost" numeric(18,6) NOT NULL DEFAULT 0,
  "cost_value" numeric(18,2) NOT NULL DEFAULT 0,
  "reason" varchar(200),
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "sretl_qty_chk" CHECK ("qty" > 0)
);
CREATE INDEX "sales_return_lines_return_id_idx" ON "sales_return_lines"("return_id");
CREATE INDEX "sales_return_lines_invoice_line_id_idx" ON "sales_return_lines"("invoice_line_id");
CREATE INDEX "sales_return_lines_item_id_idx" ON "sales_return_lines"("item_id");

INSERT INTO "stock_voucher_types" ("code","name","direction") VALUES
  ('DISPATCH','Sales dispatch','OUT'),
  ('SALES_RETURN','Sales return','IN')
ON CONFLICT DO NOTHING;
