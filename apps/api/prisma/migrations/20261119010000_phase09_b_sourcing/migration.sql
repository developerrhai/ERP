-- Phase 09 / B: sourcing documents PR -> RFQ -> vendor quote -> comparison (PHASE-09 §4.2).
-- Client requirement 5: supplier_type MATERIAL / CONTRACTOR is carried on PR, RFQ and PO.

CREATE TABLE "purchase_requisitions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "fy_id" uuid NOT NULL REFERENCES "financial_years"("id") ON DELETE RESTRICT,
  "number" varchar(40),
  "department" varchar(60) NOT NULL DEFAULT '',
  "status" varchar(20) NOT NULL DEFAULT 'Draft',
  "required_date" date,
  "requested_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "supplier_type" varchar(10) NOT NULL DEFAULT 'MATERIAL',
  "purpose" varchar(300),
  "estimated_total" numeric(18,2) NOT NULL DEFAULT 0,
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "deleted_at" timestamptz(3),
  "deleted_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "purchase_requisitions_status_chk" CHECK ("status" IN ('Draft','Pending Approval','Approved','Rejected','Posted','Cancelled')),
  CONSTRAINT "purchase_requisitions_stype_chk" CHECK ("supplier_type" IN ('MATERIAL','CONTRACTOR'))
);
CREATE UNIQUE INDEX "purchase_requisitions_number_uq" ON "purchase_requisitions"("unit_id","fy_id","number") WHERE "number" IS NOT NULL;
CREATE INDEX "purchase_requisitions_unit_idx" ON "purchase_requisitions"("unit_id");
CREATE INDEX "purchase_requisitions_fy_idx" ON "purchase_requisitions"("fy_id");
CREATE INDEX "purchase_requisitions_status_idx" ON "purchase_requisitions"("status");
CREATE INDEX "purchase_requisitions_created_by_idx" ON "purchase_requisitions"("created_by_id");
CREATE INDEX "purchase_requisitions_updated_by_idx" ON "purchase_requisitions"("updated_by_id");
CREATE INDEX "purchase_requisitions_deleted_by_idx" ON "purchase_requisitions"("deleted_by_id");

CREATE TABLE "purchase_requisition_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "pr_id" uuid NOT NULL REFERENCES "purchase_requisitions"("id") ON DELETE CASCADE,
  "line_no" integer NOT NULL,
  "item_id" uuid REFERENCES "items"("id") ON DELETE RESTRICT,
  "service_text" varchar(300),
  "qty" numeric(18,3) NOT NULL,
  "uom" varchar(20) NOT NULL,
  "est_rate" numeric(18,6) NOT NULL DEFAULT 0,
  "cost_center_id" uuid REFERENCES "cost_centers"("id") ON DELETE RESTRICT,
  "required_date" date,
  "closed_qty" numeric(18,3) NOT NULL DEFAULT 0,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "pr_lines_item_or_text_chk" CHECK ("item_id" IS NOT NULL OR "service_text" IS NOT NULL),
  CONSTRAINT "pr_lines_qty_chk" CHECK ("qty" > 0 AND "closed_qty" >= 0 AND "closed_qty" <= "qty")
);
CREATE INDEX "purchase_requisition_lines_pr_id_idx" ON "purchase_requisition_lines"("pr_id");
CREATE INDEX "purchase_requisition_lines_item_id_idx" ON "purchase_requisition_lines"("item_id");
CREATE INDEX "purchase_requisition_lines_cost_center_id_idx" ON "purchase_requisition_lines"("cost_center_id");

CREATE TABLE "rfqs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "fy_id" uuid NOT NULL REFERENCES "financial_years"("id") ON DELETE RESTRICT,
  "number" varchar(40),
  "department" varchar(60) NOT NULL DEFAULT '',
  "status" varchar(20) NOT NULL DEFAULT 'Draft',
  "issue_date" date,
  "due_date" date,
  "supplier_type" varchar(10) NOT NULL DEFAULT 'MATERIAL',
  "notes" varchar(500),
  "issued_at" timestamptz(3),
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "deleted_at" timestamptz(3),
  "deleted_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "rfqs_status_chk" CHECK ("status" IN ('Draft','Pending Approval','Approved','Rejected','Posted','Cancelled')),
  CONSTRAINT "rfqs_stype_chk" CHECK ("supplier_type" IN ('MATERIAL','CONTRACTOR'))
);
CREATE UNIQUE INDEX "rfqs_number_uq" ON "rfqs"("unit_id","fy_id","number") WHERE "number" IS NOT NULL;
CREATE INDEX "rfqs_unit_idx" ON "rfqs"("unit_id");
CREATE INDEX "rfqs_fy_idx" ON "rfqs"("fy_id");
CREATE INDEX "rfqs_status_idx" ON "rfqs"("status");
CREATE INDEX "rfqs_created_by_idx" ON "rfqs"("created_by_id");
CREATE INDEX "rfqs_updated_by_idx" ON "rfqs"("updated_by_id");
CREATE INDEX "rfqs_deleted_by_idx" ON "rfqs"("deleted_by_id");

CREATE TABLE "rfq_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "rfq_id" uuid NOT NULL REFERENCES "rfqs"("id") ON DELETE CASCADE,
  "line_no" integer NOT NULL,
  "pr_line_id" uuid REFERENCES "purchase_requisition_lines"("id") ON DELETE RESTRICT,
  "item_id" uuid REFERENCES "items"("id") ON DELETE RESTRICT,
  "service_text" varchar(300),
  "qty" numeric(18,3) NOT NULL,
  "uom" varchar(20) NOT NULL,
  "required_date" date,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "rfq_lines_qty_chk" CHECK ("qty" > 0)
);
CREATE INDEX "rfq_lines_rfq_id_idx" ON "rfq_lines"("rfq_id");
CREATE INDEX "rfq_lines_pr_line_id_idx" ON "rfq_lines"("pr_line_id");
CREATE INDEX "rfq_lines_item_id_idx" ON "rfq_lines"("item_id");

CREATE TABLE "rfq_suppliers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "rfq_id" uuid NOT NULL REFERENCES "rfqs"("id") ON DELETE CASCADE,
  "supplier_id" uuid NOT NULL REFERENCES "suppliers"("id") ON DELETE RESTRICT,
  "invited_at" timestamptz(3),
  "responded_at" timestamptz(3),
  "created_at" timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX "rfq_suppliers_rfq_id_idx" ON "rfq_suppliers"("rfq_id");
CREATE INDEX "rfq_suppliers_supplier_id_idx" ON "rfq_suppliers"("supplier_id");

CREATE UNIQUE INDEX "rfq_suppliers_uq" ON "rfq_suppliers"("rfq_id","supplier_id");

CREATE TABLE "vendor_quotes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "fy_id" uuid NOT NULL REFERENCES "financial_years"("id") ON DELETE RESTRICT,
  "number" varchar(40),
  "department" varchar(60) NOT NULL DEFAULT '',
  "status" varchar(20) NOT NULL DEFAULT 'Draft',
  "rfq_id" uuid REFERENCES "rfqs"("id") ON DELETE RESTRICT,
  "supplier_id" uuid NOT NULL REFERENCES "suppliers"("id") ON DELETE RESTRICT,
  "quote_date" date NOT NULL DEFAULT CURRENT_DATE,
  "valid_until" date,
  "round_no" integer NOT NULL DEFAULT 1,
  "is_current" boolean NOT NULL DEFAULT true,
  "payment_term_id" uuid REFERENCES "payment_terms"("id") ON DELETE SET NULL,
  "freight" numeric(18,2) NOT NULL DEFAULT 0,
  "other_charges" numeric(18,2) NOT NULL DEFAULT 0,
  "technical_compliance" boolean NOT NULL DEFAULT true,
  "total" numeric(18,2) NOT NULL DEFAULT 0,
  "notes" varchar(500),
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "deleted_at" timestamptz(3),
  "deleted_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "vendor_quotes_status_chk" CHECK ("status" IN ('Draft','Pending Approval','Approved','Rejected','Posted','Cancelled'))
);
CREATE UNIQUE INDEX "vendor_quotes_number_uq" ON "vendor_quotes"("unit_id","fy_id","number") WHERE "number" IS NOT NULL;
CREATE INDEX "vendor_quotes_unit_idx" ON "vendor_quotes"("unit_id");
CREATE INDEX "vendor_quotes_fy_idx" ON "vendor_quotes"("fy_id");
CREATE INDEX "vendor_quotes_status_idx" ON "vendor_quotes"("status");
CREATE INDEX "vendor_quotes_created_by_idx" ON "vendor_quotes"("created_by_id");
CREATE INDEX "vendor_quotes_updated_by_idx" ON "vendor_quotes"("updated_by_id");
CREATE INDEX "vendor_quotes_deleted_by_idx" ON "vendor_quotes"("deleted_by_id");

CREATE INDEX "vendor_quotes_rfq_idx" ON "vendor_quotes"("rfq_id");
CREATE INDEX "vendor_quotes_supplier_idx" ON "vendor_quotes"("supplier_id");
CREATE TABLE "vendor_quote_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "quote_id" uuid NOT NULL REFERENCES "vendor_quotes"("id") ON DELETE CASCADE,
  "line_no" integer NOT NULL,
  "rfq_line_id" uuid REFERENCES "rfq_lines"("id") ON DELETE RESTRICT,
  "item_id" uuid REFERENCES "items"("id") ON DELETE RESTRICT,
  "qty" numeric(18,3) NOT NULL,
  "uom" varchar(20) NOT NULL,
  "rate" numeric(18,6) NOT NULL,
  "discount_pct" numeric(7,4) NOT NULL DEFAULT 0,
  "gst_pct" numeric(7,4) NOT NULL DEFAULT 0,
  "lead_days" integer,
  "landed_cost" numeric(18,2) NOT NULL DEFAULT 0,
  "cost_breakup" jsonb,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "vq_lines_qty_chk" CHECK ("qty" > 0 AND "rate" >= 0)
);
CREATE INDEX "vendor_quote_lines_quote_id_idx" ON "vendor_quote_lines"("quote_id");
CREATE INDEX "vendor_quote_lines_rfq_line_id_idx" ON "vendor_quote_lines"("rfq_line_id");
CREATE INDEX "vendor_quote_lines_item_id_idx" ON "vendor_quote_lines"("item_id");

CREATE TABLE "vendor_comparisons" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "fy_id" uuid NOT NULL REFERENCES "financial_years"("id") ON DELETE RESTRICT,
  "number" varchar(40),
  "department" varchar(60) NOT NULL DEFAULT '',
  "status" varchar(20) NOT NULL DEFAULT 'Draft',
  "rfq_id" uuid NOT NULL REFERENCES "rfqs"("id") ON DELETE RESTRICT,
  "w_price" numeric(7,4) NOT NULL DEFAULT 50,
  "w_lead" numeric(7,4) NOT NULL DEFAULT 20,
  "w_quality" numeric(7,4) NOT NULL DEFAULT 30,
  "locked_at" timestamptz(3),
  "awarded_quote_id" uuid REFERENCES "vendor_quotes"("id") ON DELETE RESTRICT,
  "award_reason" varchar(300),
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "deleted_at" timestamptz(3),
  "deleted_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "vendor_comparisons_status_chk" CHECK ("status" IN ('Draft','Pending Approval','Approved','Rejected','Posted','Cancelled'))
);
CREATE UNIQUE INDEX "vendor_comparisons_number_uq" ON "vendor_comparisons"("unit_id","fy_id","number") WHERE "number" IS NOT NULL;
CREATE INDEX "vendor_comparisons_unit_idx" ON "vendor_comparisons"("unit_id");
CREATE INDEX "vendor_comparisons_fy_idx" ON "vendor_comparisons"("fy_id");
CREATE INDEX "vendor_comparisons_status_idx" ON "vendor_comparisons"("status");
CREATE INDEX "vendor_comparisons_created_by_idx" ON "vendor_comparisons"("created_by_id");
CREATE INDEX "vendor_comparisons_updated_by_idx" ON "vendor_comparisons"("updated_by_id");
CREATE INDEX "vendor_comparisons_deleted_by_idx" ON "vendor_comparisons"("deleted_by_id");

CREATE INDEX "vendor_comparisons_rfq_idx" ON "vendor_comparisons"("rfq_id");
CREATE INDEX "vendor_comparisons_awarded_idx" ON "vendor_comparisons"("awarded_quote_id");
CREATE TABLE "comparison_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "comparison_id" uuid NOT NULL REFERENCES "vendor_comparisons"("id") ON DELETE CASCADE,
  "quote_id" uuid NOT NULL REFERENCES "vendor_quotes"("id") ON DELETE RESTRICT,
  "supplier_id" uuid NOT NULL REFERENCES "suppliers"("id") ON DELETE RESTRICT,
  "price_score" numeric(7,4),
  "lead_score" numeric(7,4),
  "quality_score" numeric(7,4),
  "total_score" numeric(7,4),
  "rank" integer,
  "total_landed" numeric(18,2) NOT NULL DEFAULT 0,
  "created_at" timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX "comparison_entries_comparison_id_idx" ON "comparison_entries"("comparison_id");
CREATE INDEX "comparison_entries_quote_id_idx" ON "comparison_entries"("quote_id");
CREATE INDEX "comparison_entries_supplier_id_idx" ON "comparison_entries"("supplier_id");

CREATE TABLE "document_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "from_type" varchar(12) NOT NULL,
  "from_id" uuid NOT NULL,
  "from_line_id" uuid,
  "to_type" varchar(12) NOT NULL,
  "to_id" uuid NOT NULL,
  "to_line_id" uuid,
  "qty" numeric(18,3),
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL
);
CREATE INDEX "document_links_from_idx" ON "document_links"("from_type","from_id");
CREATE INDEX "document_links_to_idx" ON "document_links"("to_type","to_id");
CREATE INDEX "document_links_created_by_idx" ON "document_links"("created_by_id");
