-- Phase 18 Part B: Logistics (Transporters, Routes, Rate Cards, Shipments, Tracking, POD, Containers)

ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "is_transporter" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "supplier_transporter_profiles" (
  "supplier_id" UUID PRIMARY KEY REFERENCES "suppliers"("id") ON DELETE CASCADE,
  "transin" VARCHAR(30),
  "pan" VARCHAR(10),
  "vehicle_types" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "gta_rcm" BOOLEAN NOT NULL DEFAULT true,
  "insurance_valid_till" DATE,
  "rating" NUMERIC(3,2) DEFAULT 5.00,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);

CREATE TABLE "routes" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" VARCHAR(30) NOT NULL UNIQUE,
  "name" VARCHAR(150) NOT NULL,
  "origin_unit_id" UUID REFERENCES "units"("id") ON DELETE SET NULL,
  "origin_place" VARCHAR(150) NOT NULL,
  "destination_place" VARCHAR(150) NOT NULL,
  "distance_km" NUMERIC(10,2) NOT NULL DEFAULT 0,
  "std_transit_hrs" NUMERIC(8,2) NOT NULL DEFAULT 24,
  "toll_cost" NUMERIC(12,2) NOT NULL DEFAULT 0,
  "restriction_text" VARCHAR(300),
  "primary_transporter_id" UUID REFERENCES "suppliers"("id") ON DELETE SET NULL,
  "status" VARCHAR(12) NOT NULL DEFAULT 'ACTIVE' CHECK ("status" IN ('ACTIVE','INACTIVE')),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "created_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "deleted_at" TIMESTAMPTZ(3)
);

CREATE TABLE "route_stops" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "route_id" UUID NOT NULL REFERENCES "routes"("id") ON DELETE CASCADE,
  "seq" INTEGER NOT NULL,
  "place" VARCHAR(150) NOT NULL,
  "km_from_origin" NUMERIC(10,2) NOT NULL DEFAULT 0,
  "std_halt_min" INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE "transporter_lanes" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "supplier_id" UUID NOT NULL REFERENCES "suppliers"("id") ON DELETE CASCADE,
  "route_id" UUID NOT NULL REFERENCES "routes"("id") ON DELETE CASCADE,
  "vehicle_type" VARCHAR(30) NOT NULL,
  UNIQUE ("supplier_id", "route_id", "vehicle_type")
);

CREATE TABLE "freight_rate_cards" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" VARCHAR(40) NOT NULL UNIQUE,
  "supplier_id" UUID NOT NULL REFERENCES "suppliers"("id") ON DELETE RESTRICT,
  "route_id" UUID NOT NULL REFERENCES "routes"("id") ON DELETE RESTRICT,
  "vehicle_type" VARCHAR(30) NOT NULL,
  "basis" VARCHAR(20) NOT NULL CHECK ("basis" IN ('PER_KG_SLAB','PER_KM','PER_TRIP','PER_CBM')),
  "flat_rate" NUMERIC(12,2) NOT NULL DEFAULT 0,
  "min_charge" NUMERIC(12,2) NOT NULL DEFAULT 0,
  "min_km" NUMERIC(10,2) NOT NULL DEFAULT 0,
  "fuel_surcharge_pct" NUMERIC(6,2) NOT NULL DEFAULT 0,
  "valid_from" DATE NOT NULL,
  "valid_till" DATE NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'DRAFT' CHECK ("status" IN ('DRAFT','SUBMITTED','APPROVED','REJECTED')),
  "approval_status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "created_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "deleted_at" TIMESTAMPTZ(3)
);

CREATE TABLE "freight_rate_slabs" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "rate_card_id" UUID NOT NULL REFERENCES "freight_rate_cards"("id") ON DELETE CASCADE,
  "from_qty" NUMERIC(12,2) NOT NULL,
  "to_qty" NUMERIC(12,2) NOT NULL,
  "rate" NUMERIC(12,2) NOT NULL
);

CREATE TABLE "shipments" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "shipment_no" VARCHAR(30) NOT NULL UNIQUE,
  "unit_id" UUID NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "customer_id" UUID REFERENCES "customers"("id") ON DELETE SET NULL,
  "transporter_id" UUID REFERENCES "suppliers"("id") ON DELETE SET NULL,
  "vehicle_id" UUID REFERENCES "vehicles"("id") ON DELETE SET NULL,
  "hired_vehicle_no" VARCHAR(20),
  "driver_id" UUID REFERENCES "drivers"("id") ON DELETE SET NULL,
  "hired_driver_name" VARCHAR(120),
  "hired_driver_mobile" VARCHAR(20),
  "route_id" UUID REFERENCES "routes"("id") ON DELETE SET NULL,
  "planned_dispatch_at" TIMESTAMPTZ(3),
  "planned_delivery_at" TIMESTAMPTZ(3),
  "actual_dispatch_at" TIMESTAMPTZ(3),
  "actual_delivery_at" TIMESTAMPTZ(3),
  "lr_no" VARCHAR(40),
  "lr_date" DATE,
  "eway_bill_no" VARCHAR(20),
  "eway_valid_till" TIMESTAMPTZ(3),
  "weight_kg" NUMERIC(12,2) NOT NULL DEFAULT 0,
  "volume_cbm" NUMERIC(10,2) NOT NULL DEFAULT 0,
  "status" VARCHAR(20) NOT NULL DEFAULT 'PLANNED' CHECK ("status" IN ('PLANNED','LOADING','DISPATCHED','IN_TRANSIT','DELIVERED','POD_RECEIVED','CLOSED','CANCELLED')),
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "created_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "deleted_at" TIMESTAMPTZ(3)
);
CREATE INDEX "shipments_unit_status_idx" ON "shipments"("unit_id", "status");

CREATE TABLE "shipment_lines" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "shipment_id" UUID NOT NULL REFERENCES "shipments"("id") ON DELETE CASCADE,
  "dispatch_id" UUID REFERENCES "sales_dispatches"("id") ON DELETE SET NULL,
  "sales_order_id" UUID REFERENCES "sales_orders"("id") ON DELETE SET NULL,
  "weight_kg" NUMERIC(12,2) NOT NULL DEFAULT 0,
  "volume_cbm" NUMERIC(10,2) NOT NULL DEFAULT 0
);

CREATE TABLE "freight_calculations" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "calc_no" VARCHAR(30) NOT NULL UNIQUE,
  "unit_id" UUID NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "shipment_id" UUID REFERENCES "shipments"("id") ON DELETE SET NULL,
  "rate_card_id" UUID REFERENCES "freight_rate_cards"("id") ON DELETE SET NULL,
  "weight_kg" NUMERIC(12,2) NOT NULL DEFAULT 0,
  "volume_cbm" NUMERIC(10,2) NOT NULL DEFAULT 0,
  "distance_km" NUMERIC(10,2) NOT NULL DEFAULT 0,
  "base_amount" NUMERIC(14,2) NOT NULL DEFAULT 0,
  "fuel_surcharge" NUMERIC(14,2) NOT NULL DEFAULT 0,
  "toll_amount" NUMERIC(14,2) NOT NULL DEFAULT 0,
  "loading_amount" NUMERIC(14,2) NOT NULL DEFAULT 0,
  "other_amount" NUMERIC(14,2) NOT NULL DEFAULT 0,
  "total_amount" NUMERIC(14,2) NOT NULL DEFAULT 0,
  "gta_rcm_amount" NUMERIC(14,2) NOT NULL DEFAULT 0,
  "purchase_invoice_id" UUID REFERENCES "purchase_invoices"("id") ON DELETE SET NULL,
  "billed_amount" NUMERIC(14,2),
  "variance_amount" NUMERIC(14,2),
  "variance_pct" NUMERIC(8,2),
  "approval_status" VARCHAR(16) NOT NULL DEFAULT 'NONE',
  "journal_id" UUID REFERENCES "journals"("id") ON DELETE SET NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'CALCULATED',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "created_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL
);

CREATE TABLE "tracking_events" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "shipment_id" UUID NOT NULL REFERENCES "shipments"("id") ON DELETE CASCADE,
  "milestone" VARCHAR(40) NOT NULL,
  "location" VARCHAR(150),
  "eta_at" TIMESTAMPTZ(3),
  "delay_mins" INTEGER NOT NULL DEFAULT 0,
  "note" VARCHAR(300),
  "source" VARCHAR(12) NOT NULL DEFAULT 'MANUAL' CHECK ("source" IN ('MANUAL','API')),
  "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "recorded_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL
);
CREATE INDEX "tracking_events_shp_idx" ON "tracking_events"("shipment_id", "recorded_at");

CREATE OR REPLACE FUNCTION tracking_events_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'tracking_events is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_tracking_events_no_update
  BEFORE UPDATE OR DELETE ON "tracking_events"
  FOR EACH ROW EXECUTE FUNCTION tracking_events_immutable();

CREATE TABLE "pods" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "shipment_id" UUID NOT NULL UNIQUE REFERENCES "shipments"("id") ON DELETE CASCADE,
  "delivered_at" TIMESTAMPTZ(3) NOT NULL,
  "receiver_name" VARCHAR(120) NOT NULL,
  "receiver_mobile" VARCHAR(20),
  "stored_file_id" UUID REFERENCES "stored_files"("id") ON DELETE SET NULL,
  "billing_released" BOOLEAN NOT NULL DEFAULT false,
  "remarks" VARCHAR(300),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "created_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL
);

CREATE TABLE "pod_lines" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "pod_id" UUID NOT NULL REFERENCES "pods"("id") ON DELETE CASCADE,
  "item_id" UUID REFERENCES "items"("id") ON DELETE SET NULL,
  "short_qty" NUMERIC(12,3) NOT NULL DEFAULT 0,
  "damage_qty" NUMERIC(12,3) NOT NULL DEFAULT 0,
  "remark" VARCHAR(200)
);

CREATE TABLE "containers" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "container_no" VARCHAR(15) NOT NULL UNIQUE,
  "container_type" VARCHAR(20) NOT NULL DEFAULT '20GP',
  "owner" VARCHAR(120),
  "free_days" INTEGER NOT NULL DEFAULT 7,
  "current_status" VARCHAR(20) NOT NULL DEFAULT 'EMPTY_IN_YARD',
  "current_location" VARCHAR(120),
  "last_move_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);

CREATE TABLE "container_movements" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "container_id" UUID NOT NULL REFERENCES "containers"("id") ON DELETE CASCADE,
  "shipment_id" UUID REFERENCES "shipments"("id") ON DELETE SET NULL,
  "event_type" VARCHAR(20) NOT NULL CHECK ("event_type" IN ('GATE_IN','GATE_OUT','STUFFED','DESTUFFED','EMPTY_RETURN')),
  "location" VARCHAR(120),
  "event_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "demurrage_days" INTEGER NOT NULL DEFAULT 0,
  "remarks" VARCHAR(200),
  "created_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL
);

