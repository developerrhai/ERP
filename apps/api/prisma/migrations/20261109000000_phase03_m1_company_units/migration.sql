-- Migration M1: Company & Unit statutory enhancements
-- Phase 03: Organisation Masters (Company & Unit statutory fields, address normalization, state codes)

-- 1. Alter companies table: add statutory, location and contact columns
ALTER TABLE "companies"
  ADD COLUMN IF NOT EXISTS "email" VARCHAR(254),
  ADD COLUMN IF NOT EXISTS "phone" VARCHAR(30),
  ADD COLUMN IF NOT EXISTS "website" VARCHAR(200),
  ADD COLUMN IF NOT EXISTS "city" VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "state" VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "pincode" VARCHAR(10),
  ADD COLUMN IF NOT EXISTS "state_code" VARCHAR(2);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'companies_state_code_check') THEN
    ALTER TABLE "companies" ADD CONSTRAINT "companies_state_code_check"
      CHECK ("state_code" IS NULL OR "state_code" ~ '^[0-9]{2}$');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'companies_pan_check') THEN
    ALTER TABLE "companies" ADD CONSTRAINT "companies_pan_check"
      CHECK ("pan" IS NULL OR "pan" ~ '^[A-Z]{5}[0-9]{4}[A-Z]$');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'companies_cin_check') THEN
    ALTER TABLE "companies" ADD CONSTRAINT "companies_cin_check"
      CHECK ("cin" IS NULL OR "cin" ~ '^[LU][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'companies_gstin_check') THEN
    ALTER TABLE "companies" ADD CONSTRAINT "companies_gstin_check"
      CHECK ("gstin" IS NULL OR "gstin" ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$');
  END IF;
END $$;

-- 2. Alter units table: add statutory, address, and contact columns
ALTER TABLE "units"
  ADD COLUMN IF NOT EXISTS "city" VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "state" VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "pincode" VARCHAR(10),
  ADD COLUMN IF NOT EXISTS "state_code" VARCHAR(2),
  ADD COLUMN IF NOT EXISTS "phone" VARCHAR(30),
  ADD COLUMN IF NOT EXISTS "email" VARCHAR(254);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'units_state_code_check') THEN
    ALTER TABLE "units" ADD CONSTRAINT "units_state_code_check"
      CHECK ("state_code" IS NULL OR "state_code" ~ '^[0-9]{2}$');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'units_gstin_check') THEN
    ALTER TABLE "units" ADD CONSTRAINT "units_gstin_check"
      CHECK ("gstin" IS NULL OR "gstin" ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "units_state_code_idx" ON "units"("state_code");
