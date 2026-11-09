-- Phase 09 / F: monthly supplier evaluation (PHASE-09 §4.6).
CREATE TABLE "supplier_evaluations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "supplier_id" uuid NOT NULL REFERENCES "suppliers"("id") ON DELETE RESTRICT,
  "period" char(7) NOT NULL,
  "quality" numeric(7,4),
  "delivery" numeric(7,4),
  "cost" numeric(7,4),
  "response" numeric(7,4),
  "compliance_ok" boolean NOT NULL DEFAULT true,
  "ppm" numeric(18,2),
  "otif_pct" numeric(7,4),
  "overall" numeric(7,4),
  "grade" char(1),
  "rank" integer,
  "risk_flag" boolean NOT NULL DEFAULT false,
  "details" jsonb,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "supplier_evaluations_grade_chk" CHECK ("grade" IS NULL OR "grade" IN ('A','B','C','D')),
  CONSTRAINT "supplier_evaluations_period_chk" CHECK ("period" ~ '^[0-9]{4}-[0-9]{2}$')
);
CREATE UNIQUE INDEX "supplier_evaluations_uq" ON "supplier_evaluations"("unit_id","supplier_id","period");
CREATE INDEX "supplier_evaluations_supplier_idx" ON "supplier_evaluations"("supplier_id");
CREATE INDEX "supplier_evaluations_created_by_idx" ON "supplier_evaluations"("created_by_id");
