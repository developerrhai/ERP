-- Migration M3: Typed Masters — Designations, Currencies, and UOM cleanup
-- Phase 03: Organisation Masters (Remove from generic admin, implement typed tables with full audit)

-- 1. Create designations table
CREATE TABLE IF NOT EXISTS "designations" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" VARCHAR(20) NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "department_id" UUID REFERENCES "departments"("id") ON DELETE SET NULL,
  "level" INTEGER NOT NULL DEFAULT 10 CHECK ("level" BETWEEN 1 AND 99),
  "status" VARCHAR(10) NOT NULL DEFAULT 'ACTIVE' CHECK ("status" IN ('ACTIVE', 'INACTIVE')),
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "deleted_at" TIMESTAMPTZ(3),
  "deleted_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "designations_code_format" CHECK ("code" ~ '^[A-Z0-9_-]{2,20}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS "designations_code_key" ON "designations"("code") WHERE "deleted_at" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "designations_name_key" ON "designations"("name") WHERE "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "designations_department_id_idx" ON "designations"("department_id");
CREATE INDEX IF NOT EXISTS "designations_status_idx" ON "designations"("status");

-- 2. Create currencies table
CREATE TABLE IF NOT EXISTS "currencies" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" VARCHAR(3) NOT NULL,
  "name" VARCHAR(60) NOT NULL,
  "symbol" VARCHAR(10) NOT NULL,
  "decimal_places" INTEGER NOT NULL DEFAULT 2 CHECK ("decimal_places" BETWEEN 0 AND 4),
  "is_base" BOOLEAN NOT NULL DEFAULT false,
  "exchange_rate" NUMERIC(18,6) NOT NULL DEFAULT 1.000000 CHECK ("exchange_rate" > 0),
  "status" VARCHAR(10) NOT NULL DEFAULT 'ACTIVE' CHECK ("status" IN ('ACTIVE', 'INACTIVE')),
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "deleted_at" TIMESTAMPTZ(3),
  "deleted_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "currencies_code_format" CHECK ("code" ~ '^[A-Z]{3}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS "currencies_code_key" ON "currencies"("code") WHERE "deleted_at" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "currencies_base_unique" ON "currencies"("is_base") WHERE "is_base" = true AND "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "currencies_status_idx" ON "currencies"("status");

-- Seed base currency INR (if not exists)
INSERT INTO "currencies" ("code", "name", "symbol", "decimal_places", "is_base", "exchange_rate", "status")
VALUES ('INR', 'Indian Rupee', '₹', 2, true, 1.000000, 'ACTIVE')
ON CONFLICT DO NOTHING;

-- 3. Align uoms & uom_conversions with D-01 (company_id is no longer required)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'uoms' AND column_name = 'company_id' AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE "uoms" ALTER COLUMN "company_id" DROP NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'uom_conversions' AND column_name = 'company_id' AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE "uom_conversions" ALTER COLUMN "company_id" DROP NOT NULL;
  END IF;
END $$;
