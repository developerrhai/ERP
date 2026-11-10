-- Phase 18 Part C: Gate Passes, Gate Lines (with Job Work s.143 & Returnables), Return Receipts

ALTER TABLE "warehouses" ADD COLUMN IF NOT EXISTS "is_returnable" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "gate_passes" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "pass_no" VARCHAR(16) NOT NULL UNIQUE,
  "unit_id" UUID NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "gate_name" VARCHAR(40) NOT NULL DEFAULT 'MAIN_GATE',
  "direction" VARCHAR(6) NOT NULL CHECK ("direction" IN ('IN','OUT')),
  "pass_type" VARCHAR(24) NOT NULL CHECK ("pass_type" IN ('INWARD_PO','INWARD_RETURN','INWARD_OTHER','OUTWARD_DISPATCH','RETURNABLE','NON_RETURNABLE')),
  "party_type" VARCHAR(16) NOT NULL DEFAULT 'SUPPLIER' CHECK ("party_type" IN ('SUPPLIER','CUSTOMER','OTHER')),
  "supplier_id" UUID REFERENCES "suppliers"("id") ON DELETE SET NULL,
  "customer_id" UUID REFERENCES "customers"("id") ON DELETE SET NULL,
  "party_name" VARCHAR(150),
  "vehicle_no" VARCHAR(20) NOT NULL,
  "vehicle_id" UUID REFERENCES "vehicles"("id") ON DELETE SET NULL,
  "driver_name" VARCHAR(120),
  "driver_mobile" VARCHAR(20),
  "driver_id" UUID REFERENCES "drivers"("id") ON DELETE SET NULL,
  "photo_file_id" UUID REFERENCES "stored_files"("id") ON DELETE SET NULL,
  "challan_ref" VARCHAR(60),
  "entry_at" TIMESTAMPTZ(3),
  "exit_at" TIMESTAMPTZ(3),
  "weigh_in_kg" NUMERIC(12,2),
  "weigh_out_kg" NUMERIC(12,2),
  "net_kg" NUMERIC(12,2) GENERATED ALWAYS AS (
    CASE WHEN "weigh_in_kg" IS NOT NULL AND "weigh_out_kg" IS NOT NULL
         THEN ABS("weigh_out_kg" - "weigh_in_kg")
         ELSE NULL END
  ) STORED,
  "challan_weight_kg" NUMERIC(12,2),
  "purpose" VARCHAR(200),
  "expected_return_date" DATE,
  "is_challan" BOOLEAN NOT NULL DEFAULT false,
  "is_inter_state" BOOLEAN NOT NULL DEFAULT false,
  "eway_bill_no" VARCHAR(20),
  "eway_vehicle_no" VARCHAR(20),
  "shipment_id" UUID REFERENCES "shipments"("id") ON DELETE SET NULL,
  "visitor_note" TEXT,
  "approval_status" VARCHAR(16) NOT NULL DEFAULT 'NONE' CHECK ("approval_status" IN ('NONE','PENDING','APPROVED','REJECTED')),
  "status" VARCHAR(16) NOT NULL DEFAULT 'DRAFT' CHECK ("status" IN ('DRAFT','AT_GATE','INSIDE','EXITED','CLOSED','CANCELLED')),
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "created_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "deleted_at" TIMESTAMPTZ(3),
  CONSTRAINT "gate_passes_no_len_chk" CHECK (char_length("pass_no") <= 16)
);
CREATE INDEX "gate_passes_unit_status_idx" ON "gate_passes"("unit_id", "status", "direction");

CREATE TABLE "gate_pass_lines" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "gate_pass_id" UUID NOT NULL REFERENCES "gate_passes"("id") ON DELETE CASCADE,
  "item_id" UUID REFERENCES "items"("id") ON DELETE SET NULL,
  "description" VARCHAR(200) NOT NULL,
  "uom" VARCHAR(20) NOT NULL DEFAULT 'NOS',
  "qty" NUMERIC(14,3) NOT NULL CHECK ("qty" > 0),
  "unit_rate" NUMERIC(14,2) NOT NULL DEFAULT 0,
  "value" NUMERIC(14,2) NOT NULL DEFAULT 0,
  "tax_amount" NUMERIC(14,2) NOT NULL DEFAULT 0,
  "hsn_code" VARCHAR(12),
  "po_id" UUID REFERENCES "purchase_orders"("id") ON DELETE SET NULL,
  "po_line_id" UUID REFERENCES "purchase_order_lines"("id") ON DELETE SET NULL,
  "grn_id" UUID REFERENCES "goods_receipts"("id") ON DELETE SET NULL,
  "dispatch_id" UUID REFERENCES "sales_dispatches"("id") ON DELETE SET NULL,
  "dispatch_line_id" UUID REFERENCES "sales_dispatch_lines"("id") ON DELETE SET NULL,
  "jobwork_category" VARCHAR(20) NOT NULL DEFAULT 'NONE' CHECK ("jobwork_category" IN ('INPUT','CAPITAL_GOOD','TOOL_EXEMPT','NONE')),
  "statutory_due_date" DATE,
  "deemed_supply_risk" BOOLEAN NOT NULL DEFAULT false,
  "returned_qty" NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK ("returned_qty" >= 0),
  "balance_qty" NUMERIC(14,3) GENERATED ALWAYS AS ("qty" - "returned_qty") STORED,
  "source_warehouse_id" UUID REFERENCES "warehouses"("id") ON DELETE SET NULL,
  "out_warehouse_id" UUID REFERENCES "warehouses"("id") ON DELETE SET NULL
);
CREATE INDEX "gate_pass_lines_gp_idx" ON "gate_pass_lines"("gate_pass_id");

CREATE TABLE "gate_return_receipts" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "out_line_id" UUID NOT NULL REFERENCES "gate_pass_lines"("id") ON DELETE CASCADE,
  "in_pass_id" UUID NOT NULL REFERENCES "gate_passes"("id") ON DELETE CASCADE,
  "qty" NUMERIC(14,3) NOT NULL CHECK ("qty" > 0),
  "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "condition" VARCHAR(30) NOT NULL DEFAULT 'GOOD',
  "remarks" VARCHAR(200),
  "created_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL
);

