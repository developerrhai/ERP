-- Phase 18 Part A: Fleet Masters, Vehicle Documents, Fuel Logs, Vehicle Services + GL Account Defaults

INSERT INTO "accounts" ("code","name","parent_id","is_group","root_type","normal_balance","sub_type","posting_allowed","cost_center_required","party_required","control_side","cf_class","is_system")
SELECT '6219','Fleet Fuel Expense', p."id", false, 'Expense','Debit','Other', true, true, false, NULL, 'NA', true
  FROM "accounts" p WHERE p."code" = '6200'
ON CONFLICT DO NOTHING;

INSERT INTO "accounts" ("code","name","parent_id","is_group","root_type","normal_balance","sub_type","posting_allowed","cost_center_required","party_required","control_side","cf_class","is_system")
SELECT '6220','Vehicle Repair & Maintenance', p."id", false, 'Expense','Debit','Other', true, true, false, NULL, 'NA', true
  FROM "accounts" p WHERE p."code" = '6200'
ON CONFLICT DO NOTHING;

INSERT INTO "accounts" ("code","name","parent_id","is_group","root_type","normal_balance","sub_type","posting_allowed","cost_center_required","party_required","control_side","cf_class","is_system")
SELECT '6221','Outward Freight Expense', p."id", false, 'Expense','Debit','Other', true, true, false, NULL, 'NA', true
  FROM "accounts" p WHERE p."code" = '6200'
ON CONFLICT DO NOTHING;

INSERT INTO "account_defaults" ("key","account_id")
SELECT 'FLEET_FUEL_EXPENSE', a."id" FROM "accounts" a WHERE a."code" = '6219'
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "account_defaults" ("key","account_id")
SELECT 'VEHICLE_RM_EXPENSE', a."id" FROM "accounts" a WHERE a."code" = '6220'
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "account_defaults" ("key","account_id")
SELECT 'FREIGHT_EXPENSE', a."id" FROM "accounts" a WHERE a."code" = '6221'
ON CONFLICT ("key") DO NOTHING;

CREATE TABLE "vehicles" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "reg_no" VARCHAR(20) NOT NULL UNIQUE,
  "vehicle_type" VARCHAR(30) NOT NULL,
  "ownership" VARCHAR(12) NOT NULL DEFAULT 'OWN' CHECK ("ownership" IN ('OWN','LEASED')),
  "is_transport" BOOLEAN NOT NULL DEFAULT true,
  "unit_id" UUID NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "make_model" VARCHAR(120),
  "fuel_type" VARCHAR(20) NOT NULL DEFAULT 'DIESEL' CHECK ("fuel_type" IN ('DIESEL','PETROL','CNG','ELECTRIC')),
  "tank_capacity_l" NUMERIC(10,2) NOT NULL DEFAULT 60,
  "std_kmpl" NUMERIC(8,2) NOT NULL DEFAULT 4.5,
  "current_odometer" NUMERIC(12,2) NOT NULL DEFAULT 0,
  "asset_id" UUID REFERENCES "assets"("id") ON DELETE SET NULL,
  "cost_center_id" UUID REFERENCES "cost_centers"("id") ON DELETE SET NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE' CHECK ("status" IN ('ACTIVE','MAINTENANCE','INACTIVE')),
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "created_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "deleted_at" TIMESTAMPTZ(3)
);
CREATE INDEX "vehicles_unit_idx" ON "vehicles"("unit_id") WHERE "deleted_at" IS NULL;

CREATE TABLE "drivers" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "employee_id" UUID REFERENCES "employees"("id") ON DELETE SET NULL,
  "name" VARCHAR(150) NOT NULL,
  "mobile" VARCHAR(20) NOT NULL,
  "licence_no" VARCHAR(30) NOT NULL UNIQUE,
  "licence_class" VARCHAR(20) NOT NULL DEFAULT 'HMV',
  "licence_expiry" DATE NOT NULL,
  "hazardous_endorsement" BOOLEAN NOT NULL DEFAULT false,
  "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE' CHECK ("status" IN ('ACTIVE','ON_LEAVE','INACTIVE')),
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "created_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "deleted_at" TIMESTAMPTZ(3)
);

CREATE TABLE "vehicle_assignments" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "vehicle_id" UUID NOT NULL REFERENCES "vehicles"("id") ON DELETE CASCADE,
  "driver_id" UUID NOT NULL REFERENCES "drivers"("id") ON DELETE CASCADE,
  "assigned_from" DATE NOT NULL,
  "assigned_to" DATE,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);
CREATE INDEX "vehicle_assignments_veh_idx" ON "vehicle_assignments"("vehicle_id", "is_active");

CREATE TABLE "vehicle_document_types" (
  "code" VARCHAR(16) PRIMARY KEY,
  "name" VARCHAR(80) NOT NULL,
  "required_for" VARCHAR(16) NOT NULL DEFAULT 'ALL' CHECK ("required_for" IN ('ALL','TRANSPORT')),
  "alert_days" INTEGER[] NOT NULL DEFAULT '{30,15,7}'
);

INSERT INTO "vehicle_document_types" ("code","name","required_for","alert_days") VALUES
  ('RC', 'Registration Certificate', 'ALL', '{30,15,7}'),
  ('INS', 'Motor Insurance Policy', 'ALL', '{30,15,7}'),
  ('PUC', 'Pollution Under Control (PUC)', 'ALL', '{30,15,7}'),
  ('FIT', 'Fitness Certificate', 'TRANSPORT', '{30,15,7}'),
  ('PERMIT', 'National / State Goods Permit', 'TRANSPORT', '{30,15,7}')
ON CONFLICT ("code") DO NOTHING;

CREATE TABLE "vehicle_documents" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "vehicle_id" UUID NOT NULL REFERENCES "vehicles"("id") ON DELETE CASCADE,
  "doc_type_code" VARCHAR(16) NOT NULL REFERENCES "vehicle_document_types"("code"),
  "doc_no" VARCHAR(60) NOT NULL,
  "issue_date" DATE,
  "expiry_date" DATE NOT NULL,
  "authority" VARCHAR(120),
  "stored_file_id" UUID REFERENCES "stored_files"("id") ON DELETE SET NULL,
  "status" VARCHAR(12) NOT NULL DEFAULT 'VALID' CHECK ("status" IN ('VALID','EXPIRING','EXPIRED')),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "created_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL
);
CREATE INDEX "vehicle_documents_exp_idx" ON "vehicle_documents"("vehicle_id", "expiry_date");

CREATE TABLE "fuel_logs" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "fuel_no" VARCHAR(30) NOT NULL UNIQUE,
  "unit_id" UUID NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "vehicle_id" UUID NOT NULL REFERENCES "vehicles"("id") ON DELETE RESTRICT,
  "driver_id" UUID REFERENCES "drivers"("id") ON DELETE SET NULL,
  "filled_at" TIMESTAMPTZ(3) NOT NULL,
  "odometer" NUMERIC(12,2) NOT NULL,
  "litres" NUMERIC(10,2) NOT NULL CHECK ("litres" > 0),
  "rate" NUMERIC(10,2) NOT NULL CHECK ("rate" >= 0),
  "amount" NUMERIC(14,2) NOT NULL CHECK ("amount" >= 0),
  "is_full_tank" BOOLEAN NOT NULL DEFAULT true,
  "vendor_id" UUID REFERENCES "suppliers"("id") ON DELETE SET NULL,
  "kmpl" NUMERIC(8,2),
  "variance_pct" NUMERIC(8,2),
  "anomaly_codes" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "journal_id" UUID REFERENCES "journals"("id") ON DELETE SET NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'DRAFT' CHECK ("status" IN ('DRAFT','POSTED','CANCELLED')),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "created_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);
CREATE INDEX "fuel_logs_veh_idx" ON "fuel_logs"("vehicle_id", "filled_at");

CREATE TABLE "vehicle_services" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "service_no" VARCHAR(30) NOT NULL UNIQUE,
  "unit_id" UUID NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "vehicle_id" UUID NOT NULL REFERENCES "vehicles"("id") ON DELETE RESTRICT,
  "service_type" VARCHAR(40) NOT NULL,
  "due_km" NUMERIC(12,2),
  "due_date" DATE,
  "service_date" DATE,
  "odometer" NUMERIC(12,2),
  "vendor_id" UUID REFERENCES "suppliers"("id") ON DELETE SET NULL,
  "downtime_hrs" NUMERIC(8,2) NOT NULL DEFAULT 0,
  "next_due_km" NUMERIC(12,2),
  "next_due_date" DATE,
  "total_amount" NUMERIC(14,2) NOT NULL DEFAULT 0,
  "journal_id" UUID REFERENCES "journals"("id") ON DELETE SET NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'SCHEDULED' CHECK ("status" IN ('SCHEDULED','IN_PROGRESS','COMPLETED','POSTED','CANCELLED')),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "created_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);

CREATE TABLE "vehicle_service_lines" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "service_id" UUID NOT NULL REFERENCES "vehicle_services"("id") ON DELETE CASCADE,
  "line_type" VARCHAR(12) NOT NULL CHECK ("line_type" IN ('PART','LABOUR')),
  "item_id" UUID REFERENCES "items"("id") ON DELETE SET NULL,
  "description" VARCHAR(200) NOT NULL,
  "qty" NUMERIC(12,3) NOT NULL DEFAULT 1,
  "rate" NUMERIC(12,2) NOT NULL DEFAULT 0,
  "amount" NUMERIC(14,2) NOT NULL DEFAULT 0
);

