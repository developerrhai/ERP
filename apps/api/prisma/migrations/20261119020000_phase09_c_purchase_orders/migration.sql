-- Phase 09 / C: purchase orders (PHASE-09 §4.3). Lines carry the delivery-tracking columns (client req 1).

CREATE TABLE "purchase_orders" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "fy_id" uuid NOT NULL REFERENCES "financial_years"("id") ON DELETE RESTRICT,
  "number" varchar(40),
  "department" varchar(60) NOT NULL DEFAULT '',
  "status" varchar(20) NOT NULL DEFAULT 'Draft',
  "supplier_id" uuid NOT NULL REFERENCES "suppliers"("id") ON DELETE RESTRICT,
  "po_date" date NOT NULL DEFAULT CURRENT_DATE,
  "po_type" varchar(12) NOT NULL DEFAULT 'Standard',
  "supplier_type" varchar(10) NOT NULL DEFAULT 'MATERIAL',
  "ship_to_warehouse_id" uuid REFERENCES "warehouses"("id") ON DELETE RESTRICT,
  "payment_term_id" uuid REFERENCES "payment_terms"("id") ON DELETE SET NULL,
  "pos_state" char(2),
  "regime" varchar(10) NOT NULL DEFAULT 'INTRA',
  "taxable_total" numeric(18,2) NOT NULL DEFAULT 0,
  "cgst_total" numeric(18,2) NOT NULL DEFAULT 0,
  "sgst_total" numeric(18,2) NOT NULL DEFAULT 0,
  "igst_total" numeric(18,2) NOT NULL DEFAULT 0,
  "round_off" numeric(18,2) NOT NULL DEFAULT 0,
  "grand_total" numeric(18,2) NOT NULL DEFAULT 0,
  "revision_no" integer NOT NULL DEFAULT 0,
  "amending" boolean NOT NULL DEFAULT false,
  "contract_id" uuid REFERENCES "purchase_contracts"("id") ON DELETE RESTRICT,
  "comparison_id" uuid REFERENCES "vendor_comparisons"("id") ON DELETE RESTRICT,
  "notes" varchar(500),
  "closed_at" timestamptz(3),
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "deleted_at" timestamptz(3),
  "deleted_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "purchase_orders_status_chk" CHECK ("status" IN ('Draft','Pending Approval','Approved','Rejected','Posted','Cancelled')),
  CONSTRAINT "purchase_orders_type_chk" CHECK ("po_type" IN ('Standard','Capital','Service','Subcontract')),
  CONSTRAINT "purchase_orders_stype_chk" CHECK ("supplier_type" IN ('MATERIAL','CONTRACTOR')),
  CONSTRAINT "purchase_orders_regime_chk" CHECK ("regime" IN ('INTRA','INTER'))
);
CREATE UNIQUE INDEX "purchase_orders_number_uq" ON "purchase_orders"("unit_id","fy_id","number") WHERE "number" IS NOT NULL;
CREATE INDEX "purchase_orders_unit_idx" ON "purchase_orders"("unit_id");
CREATE INDEX "purchase_orders_fy_idx" ON "purchase_orders"("fy_id");
CREATE INDEX "purchase_orders_status_idx" ON "purchase_orders"("status");
CREATE INDEX "purchase_orders_created_by_idx" ON "purchase_orders"("created_by_id");
CREATE INDEX "purchase_orders_updated_by_idx" ON "purchase_orders"("updated_by_id");
CREATE INDEX "purchase_orders_deleted_by_idx" ON "purchase_orders"("deleted_by_id");

CREATE INDEX "purchase_orders_supplier_status_idx" ON "purchase_orders"("supplier_id","status");
CREATE INDEX "purchase_orders_wh_idx" ON "purchase_orders"("ship_to_warehouse_id");
CREATE INDEX "purchase_orders_term_idx" ON "purchase_orders"("payment_term_id");
CREATE INDEX "purchase_orders_contract_idx" ON "purchase_orders"("contract_id");
CREATE INDEX "purchase_orders_comparison_idx" ON "purchase_orders"("comparison_id");

CREATE TABLE "purchase_order_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "po_id" uuid NOT NULL REFERENCES "purchase_orders"("id") ON DELETE CASCADE,
  "line_no" integer NOT NULL,
  "item_id" uuid REFERENCES "items"("id") ON DELETE RESTRICT,
  "service_text" varchar(300),
  "hsn_sac" varchar(8),
  "qty" numeric(18,3) NOT NULL,
  "uom" varchar(20) NOT NULL,
  "base_qty" numeric(18,3) NOT NULL,
  "rate" numeric(18,6) NOT NULL,
  "discount_pct" numeric(7,4) NOT NULL DEFAULT 0,
  "gst_pct" numeric(7,4) NOT NULL DEFAULT 0,
  "taxable" numeric(18,2) NOT NULL DEFAULT 0,
  "cgst" numeric(18,2) NOT NULL DEFAULT 0,
  "sgst" numeric(18,2) NOT NULL DEFAULT 0,
  "igst" numeric(18,2) NOT NULL DEFAULT 0,
  "net_rate" numeric(18,6) NOT NULL DEFAULT 0,
  "delivery_date" date,
  "lead_days" integer,
  "model" varchar(60),
  "part_no" varchar(60),
  "cost_center_id" uuid REFERENCES "cost_centers"("id") ON DELETE RESTRICT,
  "pr_line_id" uuid REFERENCES "purchase_requisition_lines"("id") ON DELETE RESTRICT,
  "contract_line_id" uuid REFERENCES "purchase_contract_lines"("id") ON DELETE RESTRICT,
  "received_qty" numeric(18,3) NOT NULL DEFAULT 0,
  "accepted_qty" numeric(18,3) NOT NULL DEFAULT 0,
  "billed_qty" numeric(18,3) NOT NULL DEFAULT 0,
  "returned_qty" numeric(18,3) NOT NULL DEFAULT 0,
  "closed_qty" numeric(18,3) NOT NULL DEFAULT 0,
  "over_receipt_pct" numeric(7,4),
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "po_lines_item_or_text_chk" CHECK ("item_id" IS NOT NULL OR "service_text" IS NOT NULL),
  CONSTRAINT "po_lines_qty_chk" CHECK ("qty" > 0 AND "received_qty" >= 0 AND "accepted_qty" >= 0 AND "billed_qty" >= 0 AND "returned_qty" >= 0 AND "closed_qty" >= 0)
);
CREATE INDEX "purchase_order_lines_po_id_idx" ON "purchase_order_lines"("po_id");
CREATE INDEX "purchase_order_lines_item_id_idx" ON "purchase_order_lines"("item_id");
CREATE INDEX "purchase_order_lines_cost_center_id_idx" ON "purchase_order_lines"("cost_center_id");
CREATE INDEX "purchase_order_lines_pr_line_id_idx" ON "purchase_order_lines"("pr_line_id");
CREATE INDEX "purchase_order_lines_contract_line_id_idx" ON "purchase_order_lines"("contract_line_id");

CREATE UNIQUE INDEX "po_lines_po_line_uq" ON "purchase_order_lines"("po_id","line_no");

CREATE TABLE "purchase_order_revisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "po_id" uuid NOT NULL REFERENCES "purchase_orders"("id") ON DELETE CASCADE,
  "revision_no" integer NOT NULL,
  "snapshot" jsonb NOT NULL,
  "reason" varchar(300),
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL
);
CREATE UNIQUE INDEX "po_revisions_uq" ON "purchase_order_revisions"("po_id","revision_no");
CREATE INDEX "po_revisions_created_by_idx" ON "purchase_order_revisions"("created_by_id");
