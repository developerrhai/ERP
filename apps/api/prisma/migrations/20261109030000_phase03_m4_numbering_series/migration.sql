-- Migration M4: Number Series & Numbering Schema Enhancements
-- Phase 03: Organisation Masters (Unified allocate service, pattern formatting, no Postgres sequences)

ALTER TABLE "number_series"
  ADD COLUMN IF NOT EXISTS "prefix" VARCHAR(20),
  ADD COLUMN IF NOT EXISTS "suffix" VARCHAR(20),
  ADD COLUMN IF NOT EXISTS "pattern" VARCHAR(100) DEFAULT '{prefix}/{unit}/{fy}/{number:4}',
  ADD COLUMN IF NOT EXISTS "padding" INTEGER NOT NULL DEFAULT 4,
  ADD COLUMN IF NOT EXISTS "reset_frequency" VARCHAR(20) NOT NULL DEFAULT 'YEARLY',
  ADD COLUMN IF NOT EXISTS "description" VARCHAR(200),
  ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "updated_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'number_series_padding_check') THEN
    ALTER TABLE "number_series" ADD CONSTRAINT "number_series_padding_check"
      CHECK ("padding" BETWEEN 1 AND 10);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'number_series_reset_frequency_check') THEN
    ALTER TABLE "number_series" ADD CONSTRAINT "number_series_reset_frequency_check"
      CHECK ("reset_frequency" IN ('YEARLY', 'MONTHLY', 'NEVER'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "number_series_page_unit_idx" ON "number_series"("page_id", "unit_id");
