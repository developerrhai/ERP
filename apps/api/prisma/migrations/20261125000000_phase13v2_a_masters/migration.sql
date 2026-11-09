-- Phase 13 v2 / A: masters, brought to docs/phases/PHASE-13.md section 4. Extends the tables of the first build (mfg_*):
-- work centres get rates, shifts, calendars and a cost centre; BOMs and routings get the DRAFT / PENDING_APPROVAL / RELEASED /
-- OBSOLETE life, phantom lines, alternates, effectivity, issue method; item planning data; downtime and scrap reasons; the
-- OVERHEAD_ABSORBED contra-expense account (E-22) and the stock voucher types of the spec. Forward-only.

-- ------------------------------------------------------------------ accounting keys and voucher types
INSERT INTO "accounts" ("code","name","parent_id","is_group","root_type","normal_balance","sub_type","posting_allowed","cost_center_required","party_required","control_side","cf_class","is_system")
SELECT '5116','Manufacturing Overhead Absorbed (contra expense)', p."id", false, 'Expense','Debit','Other', true, true, false, NULL, 'NA', true
  FROM "accounts" p WHERE p."code" = '5000'
ON CONFLICT DO NOTHING;
INSERT INTO "account_defaults" ("key","account_id")
SELECT 'OVERHEAD_ABSORBED', a."id" FROM "accounts" a WHERE a."code" = '5116'
ON CONFLICT DO NOTHING;
INSERT INTO "posting_rules" ("event","line_key","seq","description","account_selector","account_ref","condition") VALUES
 ('*','OVERHEAD_ABSORBED',99,'Labour and overhead absorbed into production (contra expense)','FIXED_CODE','5116',NULL)
ON CONFLICT DO NOTHING;
INSERT INTO "stock_voucher_types" ("code","name","direction") VALUES
  ('MFG_ISSUE','Material issue to production','OUT'),
  ('MFG_RETURN','Material return from production','IN'),
  ('FG_RECEIPT','Finished goods receipt','IN'),
  ('SCRAP','Scrap recovery','IN')
ON CONFLICT DO NOTHING;

-- ------------------------------------------------------------------ calendars (weekdays until Phase 15 holidays exist, E-25)
CREATE TABLE "mfg_wc_calendars" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "name" varchar(80) NOT NULL,
  "work_days" smallint[] NOT NULL DEFAULT ARRAY[1,2,3,4,5,6]::smallint[],
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "deleted_at" timestamptz(3)
);
CREATE UNIQUE INDEX "mfg_cal_name_uq" ON "mfg_wc_calendars"("unit_id","name") WHERE "deleted_at" IS NULL;
CREATE INDEX "mfg_cal_created_by_idx" ON "mfg_wc_calendars"("created_by_id");
CREATE TABLE "mfg_wc_calendar_exceptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "calendar_id" uuid NOT NULL REFERENCES "mfg_wc_calendars"("id") ON DELETE CASCADE,
  "exc_date" date NOT NULL,
  "available_hrs" numeric(5,2) NOT NULL DEFAULT 0,
  "reason" varchar(120),
  CONSTRAINT "mfg_calx_hrs_chk" CHECK ("available_hrs" >= 0 AND "available_hrs" <= 24)
);
CREATE UNIQUE INDEX "mfg_calx_uq" ON "mfg_wc_calendar_exceptions"("calendar_id","exc_date");

-- ------------------------------------------------------------------ work centres
ALTER TABLE "mfg_work_centres"
  ADD COLUMN "department" varchar(60),
  ADD COLUMN "cost_centre_id" uuid REFERENCES "cost_centers"("id") ON DELETE RESTRICT,
  ADD COLUMN "machine_count" integer NOT NULL DEFAULT 1,
  ADD COLUMN "labour_count" integer NOT NULL DEFAULT 1,
  ADD COLUMN "calendar_id" uuid REFERENCES "mfg_wc_calendars"("id") ON DELETE SET NULL,
  ADD COLUMN "hours_per_shift" numeric(5,2) NOT NULL DEFAULT 8,
  ADD COLUMN "shifts_per_day" integer NOT NULL DEFAULT 1,
  ADD COLUMN "normal_capacity_hrs" numeric(6,2),
  ADD COLUMN "labour_rate_per_hr" numeric(18,2),
  ADD COLUMN "overhead_rate_per_hr" numeric(18,2),
  ADD COLUMN "oee_target_pct" numeric(5,2),
  ADD COLUMN "efficiency_pct" numeric(5,2) NOT NULL DEFAULT 100;
UPDATE "mfg_work_centres" SET "labour_rate_per_hr" = "cost_per_hour", "normal_capacity_hrs" = "capacity_hours";
ALTER TABLE "mfg_work_centres" ADD CONSTRAINT "mfg_wc_rates_chk" CHECK (
  ("labour_rate_per_hr" IS NULL OR "labour_rate_per_hr" >= 0) AND ("overhead_rate_per_hr" IS NULL OR "overhead_rate_per_hr" >= 0)
  AND "machine_count" >= 0 AND "labour_count" >= 0 AND "shifts_per_day" BETWEEN 1 AND 3 AND "efficiency_pct" > 0 AND "efficiency_pct" <= 200
  AND ("oee_target_pct" IS NULL OR ("oee_target_pct" > 0 AND "oee_target_pct" <= 100)));
CREATE INDEX "mfg_wc_cc_idx" ON "mfg_work_centres"("cost_centre_id");
CREATE INDEX "mfg_wc_cal_idx" ON "mfg_work_centres"("calendar_id");

-- ------------------------------------------------------------------ reasons (needs review: starting rows, the owner may change them)
CREATE TABLE "mfg_downtime_reasons" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" varchar(30) NOT NULL,
  "name" varchar(120) NOT NULL,
  "category" varchar(10) NOT NULL,
  "counts_against_availability" boolean NOT NULL DEFAULT true,
  "status" varchar(10) NOT NULL DEFAULT 'ACTIVE',
  CONSTRAINT "mfg_dtr_cat_chk" CHECK ("category" IN ('PLANNED','UNPLANNED')),
  CONSTRAINT "mfg_dtr_status_chk" CHECK ("status" IN ('ACTIVE','INACTIVE'))
);
CREATE UNIQUE INDEX "mfg_dtr_code_uq" ON "mfg_downtime_reasons"("code");
INSERT INTO "mfg_downtime_reasons" ("code","name","category","counts_against_availability") VALUES
 ('BREAKDOWN','Machine breakdown','UNPLANNED',true),
 ('NO_MATERIAL','Waiting for material','UNPLANNED',true),
 ('NO_OPERATOR','No operator available','UNPLANNED',true),
 ('POWER_CUT','Power cut','UNPLANNED',true),
 ('BREAK','Tea / meal break','PLANNED',false),
 ('PLANNED_MAINT','Planned maintenance','PLANNED',false);

CREATE TABLE "mfg_scrap_reasons" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" varchar(30) NOT NULL,
  "name" varchar(120) NOT NULL,
  "normal" boolean NOT NULL DEFAULT false,
  "status" varchar(10) NOT NULL DEFAULT 'ACTIVE',
  CONSTRAINT "mfg_scr_status_chk" CHECK ("status" IN ('ACTIVE','INACTIVE'))
);
CREATE UNIQUE INDEX "mfg_scr_code_uq" ON "mfg_scrap_reasons"("code");
INSERT INTO "mfg_scrap_reasons" ("code","name","normal") VALUES
 ('PROCESS_LOSS','Normal process loss (within BOM scrap %)',true),
 ('DEFECT','Defect found',false),
 ('MACHINE_FAULT','Machine fault',false),
 ('MATERIAL_DEFECT','Defective material',false),
 ('OPERATOR_ERROR','Operator error',false);

-- ------------------------------------------------------------------ item planning data (MRP)
CREATE TABLE "mfg_item_planning" (
  "item_id" uuid PRIMARY KEY REFERENCES "items"("id") ON DELETE CASCADE,
  "make_or_buy" varchar(4) NOT NULL DEFAULT 'BUY',
  "low_level_code" integer NOT NULL DEFAULT 0,
  "lead_time_days" integer NOT NULL DEFAULT 0,
  "safety_stock" numeric(18,3) NOT NULL DEFAULT 0,
  "lot_sizing" varchar(5) NOT NULL DEFAULT 'LFL',
  "fixed_lot_qty" numeric(18,3),
  "min_order_qty" numeric(18,3),
  "order_multiple" numeric(18,3),
  "eoq_setup_cost" numeric(18,2),
  "eoq_holding_rate" numeric(7,4),
  "default_bom_id" uuid REFERENCES "mfg_boms"("id") ON DELETE SET NULL,
  "default_routing_id" uuid REFERENCES "mfg_routings"("id") ON DELETE SET NULL,
  "backflush_wh_id" uuid REFERENCES "warehouses"("id") ON DELETE SET NULL,
  "wip_wh_id" uuid REFERENCES "warehouses"("id") ON DELETE SET NULL,
  "fg_wh_id" uuid REFERENCES "warehouses"("id") ON DELETE SET NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "mfg_ip_make_chk" CHECK ("make_or_buy" IN ('MAKE','BUY')),
  CONSTRAINT "mfg_ip_lot_chk" CHECK ("lot_sizing" IN ('LFL','FIXED','EOQ')),
  CONSTRAINT "mfg_ip_qty_chk" CHECK ("lead_time_days" >= 0 AND "safety_stock" >= 0 AND ("fixed_lot_qty" IS NULL OR "fixed_lot_qty" > 0)
    AND ("min_order_qty" IS NULL OR "min_order_qty" >= 0) AND ("order_multiple" IS NULL OR "order_multiple" > 0)),
  CONSTRAINT "mfg_ip_fixed_chk" CHECK ("lot_sizing" <> 'FIXED' OR "fixed_lot_qty" IS NOT NULL)
);
CREATE INDEX "mfg_ip_bom_idx" ON "mfg_item_planning"("default_bom_id");
CREATE INDEX "mfg_ip_rt_idx" ON "mfg_item_planning"("default_routing_id");
CREATE INDEX "mfg_ip_bf_idx" ON "mfg_item_planning"("backflush_wh_id");
CREATE INDEX "mfg_ip_wip_idx" ON "mfg_item_planning"("wip_wh_id");
CREATE INDEX "mfg_ip_fg_idx" ON "mfg_item_planning"("fg_wh_id");
CREATE INDEX "mfg_ip_by_idx" ON "mfg_item_planning"("updated_by_id");

-- ------------------------------------------------------------------ routings: RELEASED / OBSOLETE and the extra operation fields
ALTER TABLE "mfg_routings" DROP CONSTRAINT "mfg_rt_status_chk";
UPDATE "mfg_routings" SET "status" = 'RELEASED' WHERE "status" = 'ACTIVE';
UPDATE "mfg_routings" SET "status" = 'OBSOLETE' WHERE "status" = 'RETIRED';
ALTER TABLE "mfg_routings" ADD CONSTRAINT "mfg_rt_status_chk" CHECK ("status" IN ('DRAFT','RELEASED','OBSOLETE'));
ALTER TABLE "mfg_routings" ADD COLUMN "effective_from" date;
DROP INDEX "mfg_rt_active_uq";
CREATE UNIQUE INDEX "mfg_rt_released_uq" ON "mfg_routings"("unit_id","item_id") WHERE "status" = 'RELEASED' AND "deleted_at" IS NULL;
ALTER TABLE "mfg_routing_ops"
  ADD COLUMN "queue_min" numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN "move_min" numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN "qms_plan_ref" varchar(60),
  ADD COLUMN "is_outside" boolean NOT NULL DEFAULT false,
  ADD COLUMN "tooling_note" varchar(200);

-- ------------------------------------------------------------------ BOMs
ALTER TABLE "mfg_boms" DROP CONSTRAINT "mfg_bom_status_chk";
UPDATE "mfg_boms" SET "status" = 'RELEASED' WHERE "status" = 'ACTIVE';
UPDATE "mfg_boms" SET "status" = 'OBSOLETE' WHERE "status" = 'RETIRED';
ALTER TABLE "mfg_boms" ADD CONSTRAINT "mfg_bom_status_chk" CHECK ("status" IN ('DRAFT','PENDING_APPROVAL','RELEASED','OBSOLETE'));
ALTER TABLE "mfg_boms"
  ADD COLUMN "revision" integer NOT NULL DEFAULT 0,
  ADD COLUMN "bom_type" varchar(12) NOT NULL DEFAULT 'STANDARD',
  ADD COLUMN "effective_from" date,
  ADD COLUMN "effective_to" date,
  ADD COLUMN "is_default" boolean NOT NULL DEFAULT false,
  ADD COLUMN "routing_id" uuid REFERENCES "mfg_routings"("id") ON DELETE SET NULL,
  ADD COLUMN "std_material_cost" numeric(18,2),
  ADD COLUMN "submitted_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN "approved_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN "approved_at" timestamptz(3);
UPDATE "mfg_boms" SET "is_default" = true WHERE "status" = 'RELEASED';
ALTER TABLE "mfg_boms" ADD CONSTRAINT "mfg_bom_type_chk" CHECK ("bom_type" IN ('STANDARD','ENGINEERING','REWORK'));
ALTER TABLE "mfg_boms" ADD CONSTRAINT "mfg_bom_eff_chk" CHECK ("effective_to" IS NULL OR "effective_from" IS NULL OR "effective_to" >= "effective_from");
DROP INDEX "mfg_bom_active_uq";
CREATE UNIQUE INDEX "mfg_bom_default_uq" ON "mfg_boms"("unit_id","item_id") WHERE "status" = 'RELEASED' AND "is_default" AND "bom_type" = 'STANDARD' AND "deleted_at" IS NULL;
CREATE INDEX "mfg_bom_routing_idx" ON "mfg_boms"("routing_id");
CREATE INDEX "mfg_bom_submitted_by_idx" ON "mfg_boms"("submitted_by_id");
CREATE INDEX "mfg_bom_approved_by_idx" ON "mfg_boms"("approved_by_id");

ALTER TABLE "mfg_bom_lines" DROP CONSTRAINT "mfg_bomline_scrap_chk";
ALTER TABLE "mfg_bom_lines"
  ADD COLUMN "uom" varchar(20),
  ADD COLUMN "conversion_factor" numeric(18,6) NOT NULL DEFAULT 1,
  ADD COLUMN "issue_method" varchar(9) NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "operation_seq" integer,
  ADD COLUMN "effective_from" date,
  ADD COLUMN "effective_to" date,
  ADD COLUMN "is_phantom" boolean NOT NULL DEFAULT false,
  ADD COLUMN "reference_designator" varchar(60);
ALTER TABLE "mfg_bom_lines" ADD CONSTRAINT "mfg_bomline_scrap_chk" CHECK ("scrap_pct" >= 0 AND "scrap_pct" <= 50);
ALTER TABLE "mfg_bom_lines" ADD CONSTRAINT "mfg_bomline_issue_chk" CHECK ("issue_method" IN ('MANUAL','BACKFLUSH'));
ALTER TABLE "mfg_bom_lines" ADD CONSTRAINT "mfg_bomline_conv_chk" CHECK ("conversion_factor" > 0);
ALTER TABLE "mfg_bom_lines" ADD CONSTRAINT "mfg_bomline_eff_chk" CHECK ("effective_to" IS NULL OR "effective_from" IS NULL OR "effective_to" >= "effective_from");

CREATE TABLE "mfg_bom_line_alternates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "line_id" uuid NOT NULL REFERENCES "mfg_bom_lines"("id") ON DELETE CASCADE,
  "alt_item_id" uuid NOT NULL REFERENCES "items"("id") ON DELETE RESTRICT,
  "priority" integer NOT NULL DEFAULT 1,
  "ratio" numeric(18,6) NOT NULL DEFAULT 1,
  CONSTRAINT "mfg_bomalt_ratio_chk" CHECK ("ratio" > 0 AND "priority" > 0)
);
CREATE UNIQUE INDEX "mfg_bomalt_uq" ON "mfg_bom_line_alternates"("line_id","alt_item_id");
CREATE INDEX "mfg_bomalt_item_idx" ON "mfg_bom_line_alternates"("alt_item_id");

CREATE TABLE "mfg_bom_cost_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "bom_id" uuid NOT NULL REFERENCES "mfg_boms"("id") ON DELETE CASCADE,
  "rolled_at" timestamptz(3) NOT NULL DEFAULT now(),
  "material" numeric(18,2) NOT NULL DEFAULT 0,
  "labour" numeric(18,2) NOT NULL DEFAULT 0,
  "overhead" numeric(18,2) NOT NULL DEFAULT 0,
  "total" numeric(18,2) NOT NULL DEFAULT 0,
  "per_unit" numeric(18,6) NOT NULL DEFAULT 0,
  "detail" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "rolled_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL
);
CREATE INDEX "mfg_bomcs_bom_idx" ON "mfg_bom_cost_snapshots"("bom_id");
CREATE INDEX "mfg_bomcs_by_idx" ON "mfg_bom_cost_snapshots"("rolled_by_id");

-- ------------------------------------------------------------------ settings (the owner sets them; none are guessed)
CREATE TABLE "mfg_settings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id" uuid REFERENCES "units"("id") ON DELETE CASCADE,
  "key" varchar(40) NOT NULL,
  "value" numeric(18,4) NOT NULL,
  "needs_review" boolean NOT NULL DEFAULT false,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL
);
CREATE UNIQUE INDEX "mfg_set_uq" ON "mfg_settings"("key", COALESCE("unit_id", '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX "mfg_set_unit_idx" ON "mfg_settings"("unit_id");
CREATE INDEX "mfg_set_by_idx" ON "mfg_settings"("updated_by_id");
-- the spec says: manual over-issue up to 5 % (setting); more needs a supervisor. The approval thresholds (order release value,
-- scrap value) are NOT seeded: until the owner sets them no approval is asked.
INSERT INTO "mfg_settings" ("unit_id","key","value","needs_review") VALUES (NULL,'OVER_ISSUE_PCT',5,true);
