-- Phase 3 (docs/phase3-4/CONTRACT.md Stage A): company, units, financial years, user units,
-- user preferences. Seeds the single company, the 3 units and FY 2025-26 / 2026-27 here (not only in
-- the seed) so existing non-admin users can be given all 3 units in this same migration.

-- CreateEnum
CREATE TYPE "UnitStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "FinancialYearStatus" AS ENUM ('OPEN', 'CLOSED');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "default_unit_id" UUID;

-- CreateTable
CREATE TABLE "companies" (
    "id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "legal_name" VARCHAR(300) NOT NULL,
    "trade_name" VARCHAR(120) NOT NULL,
    "pan" VARCHAR(10),
    "cin" VARCHAR(21),
    "gstin" VARCHAR(15),
    "address" VARCHAR(300),
    "currency" VARCHAR(3) NOT NULL DEFAULT 'INR',
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'Asia/Kolkata',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "units" (
    "id" UUID NOT NULL,
    "code" VARCHAR(10) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "address" VARCHAR(300),
    "gstin" VARCHAR(15),
    "status" "UnitStatus" NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_years" (
    "id" UUID NOT NULL,
    "code" VARCHAR(7) NOT NULL,
    "label" VARCHAR(40) NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "status" "FinancialYearStatus" NOT NULL DEFAULT 'OPEN',
    "is_current" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "financial_years_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_units" (
    "user_id" UUID NOT NULL,
    "unit_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_units_pkey" PRIMARY KEY ("user_id","unit_id")
);

-- CreateTable
CREATE TABLE "user_preferences" (
    "user_id" UUID NOT NULL,
    "unit_id" UUID,
    "fy_id" UUID,
    "all_units" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("user_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "companies_code_key" ON "companies"("code");

-- CreateIndex
CREATE UNIQUE INDEX "units_code_key" ON "units"("code");

-- CreateIndex
CREATE UNIQUE INDEX "units_name_key" ON "units"("name");

-- CreateIndex
CREATE UNIQUE INDEX "financial_years_code_key" ON "financial_years"("code");

-- CreateIndex
CREATE UNIQUE INDEX "financial_years_start_date_key" ON "financial_years"("start_date");

-- CreateIndex
CREATE INDEX "user_units_unit_id_idx" ON "user_units"("unit_id");

-- CreateIndex
CREATE INDEX "users_default_unit_id_idx" ON "users"("default_unit_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_default_unit_id_fkey" FOREIGN KEY ("default_unit_id") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_units" ADD CONSTRAINT "user_units_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_units" ADD CONSTRAINT "user_units_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_fy_id_fkey" FOREIGN KEY ("fy_id") REFERENCES "financial_years"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Rules Prisma cannot express
-- ---------------------------------------------------------------------------

-- Exactly one company: a unique index on a constant allows at most one row.
CREATE UNIQUE INDEX "companies_singleton" ON "companies" ((true));
ALTER TABLE "companies" ADD CONSTRAINT "companies_code_format" CHECK ("code" ~ '^[A-Z0-9]{2,20}$');
ALTER TABLE "companies" ADD CONSTRAINT "companies_currency_format" CHECK ("currency" ~ '^[A-Z]{3}$');

ALTER TABLE "units" ADD CONSTRAINT "units_code_format" CHECK ("code" ~ '^[A-Z0-9]{2,10}$');
ALTER TABLE "units" ADD CONSTRAINT "units_name_length" CHECK (char_length("name") BETWEEN 2 AND 100);

-- Indian FY: starts 1 April, ends the next 31 March; code is "YYYY-YY" of those two years. With the
-- unique start date this also rules out overlapping years.
ALTER TABLE "financial_years" ADD CONSTRAINT "financial_years_indian_fy"
  CHECK (EXTRACT(MONTH FROM "start_date") = 4 AND EXTRACT(DAY FROM "start_date") = 1
    AND "end_date" = ("start_date" + INTERVAL '1 year' - INTERVAL '1 day')::date);
ALTER TABLE "financial_years" ADD CONSTRAINT "financial_years_code_matches_dates"
  CHECK ("code" = to_char("start_date", 'YYYY') || '-' || to_char("end_date", 'YY'));
-- A closed year is never the current one.
ALTER TABLE "financial_years" ADD CONSTRAINT "financial_years_current_is_open"
  CHECK (NOT "is_current" OR "status" = 'OPEN');
-- "All units" is a unit choice of its own: never together with a concrete unit.
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_all_units_xor_unit"
  CHECK (NOT ("all_units" AND "unit_id" IS NOT NULL));
-- At most one current year.
CREATE UNIQUE INDEX "financial_years_single_current" ON "financial_years" ("is_current") WHERE "is_current";

-- ---------------------------------------------------------------------------
-- Data
-- ---------------------------------------------------------------------------

INSERT INTO "companies" ("id", "code", "legal_name", "trade_name", "currency", "timezone", "version", "created_at", "updated_at")
VALUES (gen_random_uuid(), 'SAWANT', 'Sawant Group (Ready Hand)', 'Sawant Group', 'INR', 'Asia/Kolkata', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;

INSERT INTO "units" ("id", "code", "name", "status", "version", "created_at", "updated_at")
SELECT gen_random_uuid(), u.code, u.name, 'ACTIVE', 1,
       CURRENT_TIMESTAMP + (u.ord * interval '1 millisecond'), CURRENT_TIMESTAMP
FROM (VALUES (1, 'TAL', 'Talwade'), (2, 'SAW', 'Sawardari'), (3, 'VAR', 'Varale')) AS u(ord, code, name)
ON CONFLICT DO NOTHING;

INSERT INTO "financial_years" ("id", "code", "label", "start_date", "end_date", "status", "is_current", "version", "created_at", "updated_at")
VALUES
  (gen_random_uuid(), '2025-26', 'FY 2025-26', DATE '2025-04-01', DATE '2026-03-31', 'OPEN', false, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '2026-27', 'FY 2026-27', DATE '2026-04-01', DATE '2027-03-31', 'OPEN', true, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;

-- Existing MANAGER / LEAD / MEMBER users get all 3 units (ADMIN+ have every unit implicitly).
INSERT INTO "user_units" ("user_id", "unit_id", "created_at")
SELECT u."id", n."id", CURRENT_TIMESTAMP
FROM "users" u CROSS JOIN "units" n
WHERE u."role" IN ('MANAGER', 'LEAD', 'MEMBER')
ON CONFLICT DO NOTHING;

-- Orchestrator decision: Administration pages can no longer have allow_add/edit/delete/export (or
-- enabled) switched off, so anything switched off before is switched back on.
UPDATE "module_controls"
SET "enabled" = true, "allow_add" = true, "allow_edit" = true, "allow_delete" = true,
    "allow_export" = true, "version" = "version" + 1, "updated_at" = CURRENT_TIMESTAMP
WHERE "page_id" IN (
  'admin-company', 'admin-branches', 'admin-departments', 'admin-designations', 'admin-users',
  'admin-roles', 'admin-permissions', 'admin-approval', 'admin-fy', 'admin-currency',
  'admin-taxes', 'admin-numbering', 'admin-uom', 'admin-customfields', 'admin-formbuilder',
  'admin-workflow', 'admin-import', 'admin-duplicates', 'admin-audit', 'admin-security',
  'admin-backup', 'admin-api', 'admin-integrations', 'admin-settings'
)
AND NOT ("enabled" AND "allow_add" AND "allow_edit" AND "allow_delete" AND "allow_export");
