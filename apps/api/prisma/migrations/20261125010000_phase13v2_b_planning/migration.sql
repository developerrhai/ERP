-- Phase 13 v2 / B: production plans and MRP (spec section 4 "Planning"). The first build's mrp lines are replaced by buckets,
-- suggestions with pegging, and exceptions; a run is queued and executed by a background job, one at a time per unit.
CREATE TABLE "mfg_production_plans" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "fy_id" uuid NOT NULL REFERENCES "financial_years"("id") ON DELETE RESTRICT,
  "number" varchar(40),
  "plan_date" date NOT NULL DEFAULT CURRENT_DATE,
  "horizon_days" integer NOT NULL DEFAULT 30,
  "status" varchar(10) NOT NULL DEFAULT 'DRAFT',
  "notes" varchar(300),
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "deleted_at" timestamptz(3),
  "deleted_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "mfg_pp_status_chk" CHECK ("status" IN ('DRAFT','SUBMITTED','RELEASED','CLOSED')),
  CONSTRAINT "mfg_pp_horizon_chk" CHECK ("horizon_days" BETWEEN 1 AND 366)
);
CREATE UNIQUE INDEX "mfg_pp_number_uq" ON "mfg_production_plans"("unit_id","fy_id","number") WHERE "number" IS NOT NULL;
CREATE INDEX "mfg_pp_unit_idx" ON "mfg_production_plans"("unit_id","plan_date");
CREATE INDEX "mfg_pp_fy_idx" ON "mfg_production_plans"("fy_id");
CREATE INDEX "mfg_pp_created_by_idx" ON "mfg_production_plans"("created_by_id");
CREATE INDEX "mfg_pp_updated_by_idx" ON "mfg_production_plans"("updated_by_id");
CREATE INDEX "mfg_pp_deleted_by_idx" ON "mfg_production_plans"("deleted_by_id");

CREATE TABLE "mfg_production_plan_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "plan_id" uuid NOT NULL REFERENCES "mfg_production_plans"("id") ON DELETE CASCADE,
  "demand_source" varchar(12) NOT NULL DEFAULT 'MANUAL',
  "so_line_id" uuid REFERENCES "sales_order_lines"("id") ON DELETE SET NULL,
  "item_id" uuid NOT NULL REFERENCES "items"("id") ON DELETE RESTRICT,
  "demand_qty" numeric(18,3) NOT NULL,
  "planned_qty" numeric(18,3) NOT NULL,
  "required_date" date NOT NULL,
  "bom_id" uuid REFERENCES "mfg_boms"("id") ON DELETE SET NULL,
  "capacity_load_pct" numeric(9,2),
  "material_avail_pct" numeric(9,2),
  "checked_at" timestamptz(3),
  CONSTRAINT "mfg_ppl_src_chk" CHECK ("demand_source" IN ('SALES_ORDER','MANUAL','FORECAST')),
  CONSTRAINT "mfg_ppl_qty_chk" CHECK ("demand_qty" >= 0 AND "planned_qty" > 0)
);
CREATE INDEX "mfg_ppl_plan_idx" ON "mfg_production_plan_lines"("plan_id");
CREATE INDEX "mfg_ppl_so_idx" ON "mfg_production_plan_lines"("so_line_id");
CREATE INDEX "mfg_ppl_item_idx" ON "mfg_production_plan_lines"("item_id");
CREATE INDEX "mfg_ppl_bom_idx" ON "mfg_production_plan_lines"("bom_id");

-- ------------------------------------------------------------------ MRP
DROP TABLE "mfg_mrp_lines";
ALTER TABLE "mfg_mrp_runs" DROP CONSTRAINT "mfg_mrp_status_chk";
UPDATE "mfg_mrp_runs" SET "status" = 'DONE' WHERE "status" IN ('Draft','Applied');
UPDATE "mfg_mrp_runs" SET "status" = 'FAILED' WHERE "status" = 'Cancelled';
ALTER TABLE "mfg_mrp_runs" ALTER COLUMN "status" SET DEFAULT 'QUEUED';
ALTER TABLE "mfg_mrp_runs" ADD CONSTRAINT "mfg_mrp_status_chk" CHECK ("status" IN ('QUEUED','RUNNING','DONE','FAILED'));
ALTER TABLE "mfg_mrp_runs"
  ADD COLUMN "plan_id" uuid REFERENCES "mfg_production_plans"("id") ON DELETE SET NULL,
  ADD COLUMN "horizon_days" integer NOT NULL DEFAULT 30,
  ADD COLUMN "include_so" boolean NOT NULL DEFAULT true,
  ADD COLUMN "job_id" varchar(60),
  ADD COLUMN "started_at" timestamptz(3),
  ADD COLUMN "finished_at" timestamptz(3),
  ADD COLUMN "error" varchar(500),
  ADD COLUMN "params" jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX "mfg_mrp_plan_idx" ON "mfg_mrp_runs"("plan_id");
-- only one run is RUNNING per unit (the advisory lock also guards it)
CREATE UNIQUE INDEX "mfg_mrp_running_uq" ON "mfg_mrp_runs"("unit_id") WHERE "status" = 'RUNNING';

CREATE TABLE "mfg_mrp_buckets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "run_id" uuid NOT NULL REFERENCES "mfg_mrp_runs"("id") ON DELETE CASCADE,
  "item_id" uuid NOT NULL REFERENCES "items"("id") ON DELETE RESTRICT,
  "bucket_date" date NOT NULL,
  "gross" numeric(18,3) NOT NULL DEFAULT 0,
  "scheduled_receipts" numeric(18,3) NOT NULL DEFAULT 0,
  "projected_on_hand" numeric(18,3) NOT NULL DEFAULT 0,
  "net" numeric(18,3) NOT NULL DEFAULT 0,
  "planned_receipt" numeric(18,3) NOT NULL DEFAULT 0,
  "planned_release" date
);
CREATE INDEX "mfg_mrpb_run_item_idx" ON "mfg_mrp_buckets"("run_id","item_id");
CREATE INDEX "mfg_mrpb_item_idx" ON "mfg_mrp_buckets"("item_id");

CREATE TABLE "mfg_mrp_suggestions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "run_id" uuid NOT NULL REFERENCES "mfg_mrp_runs"("id") ON DELETE CASCADE,
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "item_id" uuid NOT NULL REFERENCES "items"("id") ON DELETE RESTRICT,
  "type" varchar(4) NOT NULL,
  "qty" numeric(18,3) NOT NULL,
  "release_date" date NOT NULL,
  "due_date" date NOT NULL,
  "status" varchar(10) NOT NULL DEFAULT 'OPEN',
  "converted_doc_type" varchar(20),
  "converted_doc_id" uuid,
  "version" integer NOT NULL DEFAULT 1,
  CONSTRAINT "mfg_mrps_type_chk" CHECK ("type" IN ('MAKE','BUY')),
  CONSTRAINT "mfg_mrps_status_chk" CHECK ("status" IN ('OPEN','FIRMED','CONVERTED','IGNORED')),
  CONSTRAINT "mfg_mrps_qty_chk" CHECK ("qty" > 0)
);
CREATE INDEX "mfg_mrps_run_idx" ON "mfg_mrp_suggestions"("run_id","status");
CREATE INDEX "mfg_mrps_unit_idx" ON "mfg_mrp_suggestions"("unit_id","status");
CREATE INDEX "mfg_mrps_item_idx" ON "mfg_mrp_suggestions"("item_id");

CREATE TABLE "mfg_mrp_pegging" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "suggestion_id" uuid NOT NULL REFERENCES "mfg_mrp_suggestions"("id") ON DELETE CASCADE,
  "source_type" varchar(20) NOT NULL,
  "source_id" varchar(60),
  "source_ref" varchar(80),
  "qty" numeric(18,3) NOT NULL,
  CONSTRAINT "mfg_mrpp_src_chk" CHECK ("source_type" IN ('SO_LINE','PLAN_LINE','PARENT_SUGGESTION','SAFETY_STOCK','ORDER_REQUIREMENT'))
);
CREATE INDEX "mfg_mrpp_sug_idx" ON "mfg_mrp_pegging"("suggestion_id");

CREATE TABLE "mfg_mrp_exceptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "run_id" uuid NOT NULL REFERENCES "mfg_mrp_runs"("id") ON DELETE CASCADE,
  "item_id" uuid REFERENCES "items"("id") ON DELETE CASCADE,
  "code" varchar(24) NOT NULL,
  "message" varchar(300) NOT NULL,
  CONSTRAINT "mfg_mrpe_code_chk" CHECK ("code" IN ('PAST_DUE_RELEASE','NO_BOM','NO_SUPPLIER','CYCLE','EXPEDITE'))
);
CREATE INDEX "mfg_mrpe_run_idx" ON "mfg_mrp_exceptions"("run_id");
CREATE INDEX "mfg_mrpe_item_idx" ON "mfg_mrp_exceptions"("item_id");
