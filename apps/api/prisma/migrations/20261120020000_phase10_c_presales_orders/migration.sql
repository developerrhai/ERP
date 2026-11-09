-- Phase 10 / C: customer RFQ with internal review, quotation (customer-wise format, revisions) and sales order.
CREATE TABLE "customer_rfqs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "fy_id" uuid NOT NULL REFERENCES "financial_years"("id") ON DELETE RESTRICT,
  "number" varchar(40),
  "department" varchar(60) NOT NULL DEFAULT '',
  "status" varchar(24) NOT NULL DEFAULT 'Received',
  "customer_id" uuid NOT NULL REFERENCES "customers"("id") ON DELETE RESTRICT,
  "opportunity_id" uuid REFERENCES "opportunities"("id") ON DELETE SET NULL,
  "customer_ref" varchar(60),
  "received_on" date NOT NULL DEFAULT CURRENT_DATE,
  "required_by" date,
  "description" varchar(500),
  "feasibility" varchar(14) NOT NULL DEFAULT 'PENDING',
  "engineering_note" varchar(500),
  "engineering_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "finance_margin_pct" numeric(7,4),
  "finance_note" varchar(500),
  "finance_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "estimated_value" numeric(18,2) NOT NULL DEFAULT 0,
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "deleted_at" timestamptz(3),
  "deleted_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "customer_rfqs_status_chk" CHECK ("status" IN ('Received','In review','Reviewed','Not feasible','Quoted')),
  CONSTRAINT "crfq_feas_chk" CHECK ("feasibility" IN ('PENDING','FEASIBLE','NOT_FEASIBLE'))
);
CREATE UNIQUE INDEX "customer_rfqs_number_uq" ON "customer_rfqs"("unit_id","fy_id","number") WHERE "number" IS NOT NULL;
CREATE INDEX "customer_rfqs_unit_idx" ON "customer_rfqs"("unit_id");
CREATE INDEX "customer_rfqs_fy_idx" ON "customer_rfqs"("fy_id");
CREATE INDEX "customer_rfqs_status_idx" ON "customer_rfqs"("status");
CREATE INDEX "customer_rfqs_created_by_idx" ON "customer_rfqs"("created_by_id");
CREATE INDEX "customer_rfqs_updated_by_idx" ON "customer_rfqs"("updated_by_id");
CREATE INDEX "customer_rfqs_deleted_by_idx" ON "customer_rfqs"("deleted_by_id");

CREATE INDEX "crfq_customer_idx" ON "customer_rfqs"("customer_id");
CREATE INDEX "crfq_opp_idx" ON "customer_rfqs"("opportunity_id");
CREATE INDEX "crfq_eng_idx" ON "customer_rfqs"("engineering_by_id");
CREATE INDEX "crfq_fin_idx" ON "customer_rfqs"("finance_by_id");
CREATE TABLE "customer_rfq_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "rfq_id" uuid NOT NULL REFERENCES "customer_rfqs"("id") ON DELETE CASCADE,
  "line_no" integer NOT NULL,
  "item_id" uuid REFERENCES "items"("id") ON DELETE RESTRICT,
  "description" varchar(300),
  "part_no" varchar(60),
  "qty" numeric(18,3) NOT NULL,
  "uom" varchar(20) NOT NULL DEFAULT 'NOS',
  "target_rate" numeric(18,6),
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "crfql_qty_chk" CHECK ("qty" > 0)
);
CREATE INDEX "customer_rfq_lines_rfq_id_idx" ON "customer_rfq_lines"("rfq_id");
CREATE INDEX "customer_rfq_lines_item_id_idx" ON "customer_rfq_lines"("item_id");

CREATE TABLE "sales_quotations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "fy_id" uuid NOT NULL REFERENCES "financial_years"("id") ON DELETE RESTRICT,
  "number" varchar(40),
  "department" varchar(60) NOT NULL DEFAULT '',
  "status" varchar(20) NOT NULL DEFAULT 'Draft',
  "customer_id" uuid NOT NULL REFERENCES "customers"("id") ON DELETE RESTRICT,
  "rfq_id" uuid REFERENCES "customer_rfqs"("id") ON DELETE RESTRICT,
  "opportunity_id" uuid REFERENCES "opportunities"("id") ON DELETE SET NULL,
  "quote_date" date NOT NULL DEFAULT CURRENT_DATE,
  "valid_until" date,
  "format_code" varchar(40),
  "payment_term_id" uuid REFERENCES "payment_terms"("id") ON DELETE SET NULL,
  "price_list_id" uuid REFERENCES "price_lists"("id") ON DELETE SET NULL,
  "regime" varchar(10) NOT NULL DEFAULT 'INTRA',
  "taxable" numeric(18,2) NOT NULL DEFAULT 0,
  "cgst" numeric(18,2) NOT NULL DEFAULT 0,
  "sgst" numeric(18,2) NOT NULL DEFAULT 0,
  "igst" numeric(18,2) NOT NULL DEFAULT 0,
  "round_off" numeric(18,2) NOT NULL DEFAULT 0,
  "grand_total" numeric(18,2) NOT NULL DEFAULT 0,
  "margin_pct" numeric(7,4),
  "revision_no" integer NOT NULL DEFAULT 0,
  "customer_status" varchar(10) NOT NULL DEFAULT 'PENDING',
  "customer_ref" varchar(60),
  "decided_on" date,
  "notes" varchar(500),
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "deleted_at" timestamptz(3),
  "deleted_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "sales_quotations_status_chk" CHECK ("status" IN ('Draft','Pending Approval','Approved','Rejected','Posted','Cancelled')),
  CONSTRAINT "sq_cs_chk" CHECK ("customer_status" IN ('PENDING','ACCEPTED','REJECTED')),
  CONSTRAINT "sq_regime_chk" CHECK ("regime" IN ('INTRA','INTER'))
);
CREATE UNIQUE INDEX "sales_quotations_number_uq" ON "sales_quotations"("unit_id","fy_id","number") WHERE "number" IS NOT NULL;
CREATE INDEX "sales_quotations_unit_idx" ON "sales_quotations"("unit_id");
CREATE INDEX "sales_quotations_fy_idx" ON "sales_quotations"("fy_id");
CREATE INDEX "sales_quotations_status_idx" ON "sales_quotations"("status");
CREATE INDEX "sales_quotations_created_by_idx" ON "sales_quotations"("created_by_id");
CREATE INDEX "sales_quotations_updated_by_idx" ON "sales_quotations"("updated_by_id");
CREATE INDEX "sales_quotations_deleted_by_idx" ON "sales_quotations"("deleted_by_id");

CREATE INDEX "sq_customer_idx" ON "sales_quotations"("customer_id","status");
CREATE INDEX "sq_rfq_idx" ON "sales_quotations"("rfq_id");
CREATE INDEX "sq_opp_idx" ON "sales_quotations"("opportunity_id");
CREATE INDEX "sq_term_idx" ON "sales_quotations"("payment_term_id");
CREATE INDEX "sq_pl_idx" ON "sales_quotations"("price_list_id");
CREATE TABLE "sales_quotation_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "quotation_id" uuid NOT NULL REFERENCES "sales_quotations"("id") ON DELETE CASCADE,
  "line_no" integer NOT NULL,
  "item_id" uuid REFERENCES "items"("id") ON DELETE RESTRICT,
  "description" varchar(300),
  "part_no" varchar(60),
  "hsn_sac" varchar(8),
  "qty" numeric(18,3) NOT NULL,
  "uom" varchar(20) NOT NULL,
  "rate" numeric(18,6) NOT NULL,
  "discount_pct" numeric(7,4) NOT NULL DEFAULT 0,
  "gst_pct" numeric(7,4) NOT NULL DEFAULT 0,
  "taxable" numeric(18,2) NOT NULL DEFAULT 0,
  "unit_cost" numeric(18,6),
  "cost_breakup" jsonb,
  "lead_days" integer,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "sql_qty_chk" CHECK ("qty" > 0 AND "rate" >= 0)
);
CREATE INDEX "sales_quotation_lines_quotation_id_idx" ON "sales_quotation_lines"("quotation_id");
CREATE INDEX "sales_quotation_lines_item_id_idx" ON "sales_quotation_lines"("item_id");

CREATE TABLE "sales_quotation_revisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "quotation_id" uuid NOT NULL REFERENCES "sales_quotations"("id") ON DELETE CASCADE,
  "revision_no" integer NOT NULL,
  "snapshot" jsonb NOT NULL,
  "reason" varchar(300),
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL
);
CREATE UNIQUE INDEX "sqr_uq" ON "sales_quotation_revisions"("quotation_id","revision_no");
CREATE INDEX "sqr_user_idx" ON "sales_quotation_revisions"("created_by_id");

CREATE TABLE "sales_orders" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "fy_id" uuid NOT NULL REFERENCES "financial_years"("id") ON DELETE RESTRICT,
  "number" varchar(40),
  "department" varchar(60) NOT NULL DEFAULT '',
  "status" varchar(20) NOT NULL DEFAULT 'Draft',
  "customer_id" uuid NOT NULL REFERENCES "customers"("id") ON DELETE RESTRICT,
  "quotation_id" uuid REFERENCES "sales_quotations"("id") ON DELETE RESTRICT,
  "customer_po_no" varchar(60),
  "customer_po_date" date,
  "order_date" date NOT NULL DEFAULT CURRENT_DATE,
  "delivery_date" date,
  "ship_to" varchar(300),
  "payment_term_id" uuid REFERENCES "payment_terms"("id") ON DELETE SET NULL,
  "regime" varchar(10) NOT NULL DEFAULT 'INTRA',
  "taxable" numeric(18,2) NOT NULL DEFAULT 0,
  "cgst" numeric(18,2) NOT NULL DEFAULT 0,
  "sgst" numeric(18,2) NOT NULL DEFAULT 0,
  "igst" numeric(18,2) NOT NULL DEFAULT 0,
  "round_off" numeric(18,2) NOT NULL DEFAULT 0,
  "grand_total" numeric(18,2) NOT NULL DEFAULT 0,
  "credit_override_reason" varchar(300),
  "closed_at" timestamptz(3),
  "notes" varchar(500),
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "deleted_at" timestamptz(3),
  "deleted_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "sales_orders_status_chk" CHECK ("status" IN ('Draft','Pending Approval','Approved','Rejected','Posted','Cancelled')),
  CONSTRAINT "so_regime_chk" CHECK ("regime" IN ('INTRA','INTER'))
);
CREATE UNIQUE INDEX "sales_orders_number_uq" ON "sales_orders"("unit_id","fy_id","number") WHERE "number" IS NOT NULL;
CREATE INDEX "sales_orders_unit_idx" ON "sales_orders"("unit_id");
CREATE INDEX "sales_orders_fy_idx" ON "sales_orders"("fy_id");
CREATE INDEX "sales_orders_status_idx" ON "sales_orders"("status");
CREATE INDEX "sales_orders_created_by_idx" ON "sales_orders"("created_by_id");
CREATE INDEX "sales_orders_updated_by_idx" ON "sales_orders"("updated_by_id");
CREATE INDEX "sales_orders_deleted_by_idx" ON "sales_orders"("deleted_by_id");

CREATE INDEX "so_customer_idx" ON "sales_orders"("customer_id","status");
CREATE INDEX "so_quotation_idx" ON "sales_orders"("quotation_id");
CREATE INDEX "so_term_idx" ON "sales_orders"("payment_term_id");
CREATE UNIQUE INDEX "so_customer_po_uq" ON "sales_orders"("customer_id","customer_po_no") WHERE "customer_po_no" IS NOT NULL AND "status" <> 'Cancelled' AND "deleted_at" IS NULL;
CREATE TABLE "sales_order_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "order_id" uuid NOT NULL REFERENCES "sales_orders"("id") ON DELETE CASCADE,
  "line_no" integer NOT NULL,
  "item_id" uuid NOT NULL REFERENCES "items"("id") ON DELETE RESTRICT,
  "description" varchar(300),
  "part_no" varchar(60),
  "colour" varchar(60),
  "hsn_sac" varchar(8),
  "qty" numeric(18,3) NOT NULL,
  "uom" varchar(20) NOT NULL,
  "rate" numeric(18,6) NOT NULL,
  "discount_pct" numeric(7,4) NOT NULL DEFAULT 0,
  "gst_pct" numeric(7,4) NOT NULL DEFAULT 0,
  "taxable" numeric(18,2) NOT NULL DEFAULT 0,
  "delivery_date" date,
  "warehouse_id" uuid REFERENCES "warehouses"("id") ON DELETE RESTRICT,
  "reserved_qty" numeric(18,3) NOT NULL DEFAULT 0,
  "reservation_id" uuid,
  "dispatched_qty" numeric(18,3) NOT NULL DEFAULT 0,
  "invoiced_qty" numeric(18,3) NOT NULL DEFAULT 0,
  "returned_qty" numeric(18,3) NOT NULL DEFAULT 0,
  "closed_qty" numeric(18,3) NOT NULL DEFAULT 0,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "sol_qty_chk" CHECK ("qty" > 0 AND "dispatched_qty" >= 0 AND "invoiced_qty" >= 0 AND "returned_qty" >= 0 AND "closed_qty" >= 0)
);
CREATE INDEX "sales_order_lines_order_id_idx" ON "sales_order_lines"("order_id");
CREATE INDEX "sales_order_lines_item_id_idx" ON "sales_order_lines"("item_id");
CREATE INDEX "sales_order_lines_warehouse_id_idx" ON "sales_order_lines"("warehouse_id");

CREATE UNIQUE INDEX "sol_order_line_uq" ON "sales_order_lines"("order_id","line_no");
