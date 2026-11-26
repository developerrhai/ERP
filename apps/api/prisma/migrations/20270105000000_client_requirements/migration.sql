-- Client requirements (docs2/Client_Requirements_.pdf).

-- REQ-04: material classification of suppliers and items (Direct Material / Indirect).
ALTER TABLE "items" ADD COLUMN "material_class" varchar(10);
ALTER TABLE "items" ADD CONSTRAINT "items_material_class_chk" CHECK ("material_class" IN ('DIRECT', 'INDIRECT'));
ALTER TABLE "suppliers" ADD COLUMN "material_class" varchar(10);
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_material_class_chk" CHECK ("material_class" IN ('DIRECT', 'INDIRECT'));

-- REQ-03: a purchase order and a purchase invoice can name the customer order (and so the Customer PO) they are bought for.
ALTER TABLE "purchase_orders" ADD COLUMN "sales_order_id" uuid REFERENCES "sales_orders"("id") ON DELETE SET NULL;
CREATE INDEX "purchase_orders_sales_order_idx" ON "purchase_orders"("sales_order_id");
ALTER TABLE "purchase_invoices" ADD COLUMN "sales_order_id" uuid REFERENCES "sales_orders"("id") ON DELETE SET NULL;
CREATE INDEX "purchase_invoices_sales_order_idx" ON "purchase_invoices"("sales_order_id");

-- REQ-01: netting off what a party owes us (as a customer) against what we owe it (as a supplier). The money lives in
-- the journal and the bill allocations; these two tables record what one adjustment settled, so it can be cancelled.
CREATE TABLE "party_adjustments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "number" varchar(60) NOT NULL,
  "adj_date" date NOT NULL,
  "customer_id" uuid NOT NULL REFERENCES "customers"("id") ON DELETE RESTRICT,
  "supplier_id" uuid NOT NULL REFERENCES "suppliers"("id") ON DELETE RESTRICT,
  "amount" numeric(18, 2) NOT NULL,
  "narration" varchar(300),
  "journal_id" uuid NOT NULL REFERENCES "journals"("id") ON DELETE RESTRICT,
  "status" varchar(10) NOT NULL DEFAULT 'Posted',
  "cancel_reason" varchar(300),
  "cancelled_at" timestamptz(3),
  "cancelled_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "party_adjustments_status_chk" CHECK ("status" IN ('Posted', 'Cancelled')),
  CONSTRAINT "party_adjustments_amount_chk" CHECK ("amount" > 0)
);
CREATE INDEX "party_adjustments_unit_idx" ON "party_adjustments"("unit_id");
CREATE INDEX "party_adjustments_customer_idx" ON "party_adjustments"("customer_id");
CREATE INDEX "party_adjustments_supplier_idx" ON "party_adjustments"("supplier_id");
CREATE INDEX "party_adjustments_journal_idx" ON "party_adjustments"("journal_id");
CREATE INDEX "party_adjustments_created_by_idx" ON "party_adjustments"("created_by_id");
CREATE INDEX "party_adjustments_cancelled_by_idx" ON "party_adjustments"("cancelled_by_id");

CREATE TABLE "party_adjustment_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "adjustment_id" uuid NOT NULL REFERENCES "party_adjustments"("id") ON DELETE CASCADE,
  "side" varchar(10) NOT NULL,
  "open_item_id" uuid NOT NULL REFERENCES "open_items"("id") ON DELETE RESTRICT,
  "allocation_id" uuid NOT NULL REFERENCES "allocations"("id") ON DELETE RESTRICT,
  "sales_invoice_id" uuid REFERENCES "sales_invoices"("id") ON DELETE RESTRICT,
  "purchase_invoice_id" uuid REFERENCES "purchase_invoices"("id") ON DELETE RESTRICT,
  "itc_reclaim_id" uuid REFERENCES "itc_reversals"("id") ON DELETE RESTRICT,
  "amount" numeric(18, 2) NOT NULL,
  CONSTRAINT "party_adjustment_lines_side_chk" CHECK ("side" IN ('RECEIVABLE', 'PAYABLE'))
);
CREATE INDEX "party_adjustment_lines_adjustment_idx" ON "party_adjustment_lines"("adjustment_id");
CREATE INDEX "party_adjustment_lines_open_item_idx" ON "party_adjustment_lines"("open_item_id");
CREATE INDEX "party_adjustment_lines_allocation_idx" ON "party_adjustment_lines"("allocation_id");
CREATE INDEX "party_adjustment_lines_sales_invoice_idx" ON "party_adjustment_lines"("sales_invoice_id");
CREATE INDEX "party_adjustment_lines_purchase_invoice_idx" ON "party_adjustment_lines"("purchase_invoice_id");
CREATE INDEX "party_adjustment_lines_itc_idx" ON "party_adjustment_lines"("itc_reclaim_id");
