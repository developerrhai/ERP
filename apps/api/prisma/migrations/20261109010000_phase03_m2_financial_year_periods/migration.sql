-- Migration M2: Financial Year Periods & Period Locking
-- Phase 03: Organisation Masters (Period-level lock, monthly periods 1..12 per financial year)

CREATE TABLE IF NOT EXISTS "financial_year_periods" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "fy_id" UUID NOT NULL REFERENCES "financial_years"("id") ON DELETE CASCADE,
  "period_no" INTEGER NOT NULL CHECK ("period_no" BETWEEN 1 AND 12),
  "code" VARCHAR(10) NOT NULL,
  "label" VARCHAR(40) NOT NULL,
  "start_date" DATE NOT NULL,
  "end_date" DATE NOT NULL,
  "status" VARCHAR(10) NOT NULL DEFAULT 'OPEN' CHECK ("status" IN ('OPEN', 'CLOSED')),
  "closed_at" TIMESTAMPTZ(3),
  "closed_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "financial_year_periods_fy_period_no_unique" UNIQUE ("fy_id", "period_no"),
  CONSTRAINT "financial_year_periods_fy_code_unique" UNIQUE ("fy_id", "code"),
  CONSTRAINT "financial_year_periods_dates_check" CHECK ("start_date" <= "end_date")
);

CREATE INDEX IF NOT EXISTS "financial_year_periods_fy_dates_idx"
  ON "financial_year_periods"("fy_id", "start_date", "end_date");
CREATE INDEX IF NOT EXISTS "financial_year_periods_status_idx"
  ON "financial_year_periods"("status");

-- Function to generate 12 monthly periods for a financial year (Apr - Mar)
CREATE OR REPLACE FUNCTION "generate_fy_periods"(p_fy_id UUID, p_start_date DATE)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  v_month_start DATE;
  v_month_end DATE;
  v_period_no INT;
  v_code VARCHAR(10);
  v_label VARCHAR(40);
BEGIN
  FOR v_period_no IN 1..12 LOOP
    v_month_start := (p_start_date + ((v_period_no - 1) || ' month')::INTERVAL)::DATE;
    v_month_end := ((v_month_start + '1 month'::INTERVAL)::DATE - 1);
    v_code := TO_CHAR(v_month_start, 'YYYY-MM');
    v_label := TO_CHAR(v_month_start, 'FMMonth YYYY');

    INSERT INTO "financial_year_periods" (
      "fy_id", "period_no", "code", "label", "start_date", "end_date", "status"
    ) VALUES (
      p_fy_id, v_period_no, v_code, v_label, v_month_start, v_month_end, 'OPEN'
    )
    ON CONFLICT ("fy_id", "period_no") DO NOTHING;
  END LOOP;
END;
$$;

-- Trigger on financial_years to auto-generate periods on new FY creation
CREATE OR REPLACE FUNCTION "trg_fy_auto_generate_periods"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM "generate_fy_periods"(NEW."id", NEW."start_date");
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "trg_financial_years_periods" ON "financial_years";
CREATE TRIGGER "trg_financial_years_periods"
  AFTER INSERT ON "financial_years"
  FOR EACH ROW
  EXECUTE FUNCTION "trg_fy_auto_generate_periods"();

-- Backfill 12 periods for all existing financial_years
DO $$
DECLARE
  fy RECORD;
BEGIN
  FOR fy IN SELECT "id", "start_date" FROM "financial_years" LOOP
    PERFORM "generate_fy_periods"(fy."id", fy."start_date");
  END LOOP;
END $$;
