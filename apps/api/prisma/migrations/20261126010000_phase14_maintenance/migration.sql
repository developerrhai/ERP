-- Phase 14 (maintenance, section 4): PM plans by time or meter, checklists, breakdown tickets (ISO 14224-style codes),
-- maintenance work orders with tasks / spares / labour / vendor charges, downtime events (no overlap per asset), alerts.
-- Forward-only.

CREATE TABLE "failure_codes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "kind" varchar(10) NOT NULL,
  "code" varchar(20) NOT NULL,
  "name" varchar(120) NOT NULL,
  "needs_review" boolean NOT NULL DEFAULT true,
  CONSTRAINT "fc_kind_chk" CHECK ("kind" IN ('MODE','CAUSE','MECHANISM'))
);
CREATE UNIQUE INDEX "fc_uq" ON "failure_codes"("kind","code");

CREATE TABLE "checklist_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" varchar(20) NOT NULL,
  "name" varchar(120) NOT NULL,
  "status" varchar(10) NOT NULL DEFAULT 'ACTIVE',
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "deleted_at" timestamptz(3),
  CONSTRAINT "ct_status_chk" CHECK ("status" IN ('ACTIVE','INACTIVE'))
);
CREATE UNIQUE INDEX "ct_code_uq" ON "checklist_templates"("code") WHERE "deleted_at" IS NULL;
CREATE TABLE "checklist_template_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "template_id" uuid NOT NULL REFERENCES "checklist_templates"("id") ON DELETE CASCADE,
  "seq" integer NOT NULL,
  "text" varchar(300) NOT NULL,
  "answer_type" varchar(10) NOT NULL DEFAULT 'OK_NOTOK',
  "min_value" numeric(18,3),
  "max_value" numeric(18,3),
  CONSTRAINT "cti_type_chk" CHECK ("answer_type" IN ('OK_NOTOK','NUMBER','TEXT'))
);
CREATE UNIQUE INDEX "cti_uq" ON "checklist_template_items"("template_id","seq");

CREATE TABLE "pm_plans" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "plan_no" varchar(40) NOT NULL,
  "asset_id" uuid NOT NULL REFERENCES "assets"("id") ON DELETE RESTRICT,
  "title" varchar(160) NOT NULL,
  "trigger_type" varchar(5) NOT NULL DEFAULT 'TIME',
  "interval_days" integer,
  "meter_id" uuid REFERENCES "meters"("id") ON DELETE SET NULL,
  "interval_meter" numeric(18,3),
  "lead_days" integer NOT NULL DEFAULT 3,
  "est_hours" numeric(9,2),
  "skill_designation" varchar(80),
  "checklist_template_id" uuid REFERENCES "checklist_templates"("id") ON DELETE SET NULL,
  "last_done_on" date,
  "last_done_meter" numeric(18,3),
  "start_from" date NOT NULL DEFAULT CURRENT_DATE,
  "active" boolean NOT NULL DEFAULT true,
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "deleted_at" timestamptz(3),
  "deleted_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "pmp_trigger_chk" CHECK ("trigger_type" IN ('TIME','METER','BOTH')),
  CONSTRAINT "pmp_time_chk" CHECK ("trigger_type" = 'METER' OR ("interval_days" IS NOT NULL AND "interval_days" > 0)),
  CONSTRAINT "pmp_meter_chk" CHECK ("trigger_type" = 'TIME' OR ("meter_id" IS NOT NULL AND "interval_meter" IS NOT NULL AND "interval_meter" > 0))
);
CREATE UNIQUE INDEX "pmp_no_uq" ON "pm_plans"("plan_no");
CREATE INDEX "pmp_asset_idx" ON "pm_plans"("asset_id");
CREATE INDEX "pmp_unit_idx" ON "pm_plans"("unit_id","active");
CREATE INDEX "pmp_meter_idx" ON "pm_plans"("meter_id");
CREATE INDEX "pmp_checklist_idx" ON "pm_plans"("checklist_template_id");

CREATE TABLE "pm_plan_spares" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "plan_id" uuid NOT NULL REFERENCES "pm_plans"("id") ON DELETE CASCADE,
  "item_id" uuid NOT NULL REFERENCES "items"("id") ON DELETE RESTRICT,
  "qty" numeric(18,3) NOT NULL,
  "uom" varchar(20),
  CONSTRAINT "pmps_qty_chk" CHECK ("qty" > 0)
);
CREATE INDEX "pmps_plan_idx" ON "pm_plan_spares"("plan_id");
CREATE INDEX "pmps_item_idx" ON "pm_plan_spares"("item_id");

CREATE TABLE "breakdown_tickets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "fy_id" uuid REFERENCES "financial_years"("id") ON DELETE RESTRICT,
  "bd_no" varchar(40) NOT NULL,
  "asset_id" uuid NOT NULL REFERENCES "assets"("id") ON DELETE RESTRICT,
  "reported_at" timestamptz(3) NOT NULL DEFAULT now(),
  "reported_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "symptom" varchar(400) NOT NULL,
  "photos" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "priority" varchar(2) NOT NULL DEFAULT 'P2',
  "machine_stopped" boolean NOT NULL DEFAULT true,
  "acknowledged_at" timestamptz(3),
  "repair_started_at" timestamptz(3),
  "repaired_at" timestamptz(3),
  "failure_mode" varchar(20),
  "failure_cause" varchar(20),
  "failure_mechanism" varchar(20),
  "root_cause" varchar(400),
  "wo_id" uuid,
  "status" varchar(10) NOT NULL DEFAULT 'OPEN',
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "deleted_at" timestamptz(3),
  CONSTRAINT "bd_prio_chk" CHECK ("priority" IN ('P1','P2','P3')),
  CONSTRAINT "bd_status_chk" CHECK ("status" IN ('OPEN','ACK','IN_REPAIR','RESOLVED','CLOSED','CANCELLED'))
);
CREATE UNIQUE INDEX "bd_no_uq" ON "breakdown_tickets"("bd_no");
CREATE INDEX "bd_asset_idx" ON "breakdown_tickets"("asset_id","reported_at");
CREATE INDEX "bd_unit_idx" ON "breakdown_tickets"("unit_id","status");
CREATE INDEX "bd_wo_idx" ON "breakdown_tickets"("wo_id");
CREATE INDEX "bd_fy_idx" ON "breakdown_tickets"("fy_id");

CREATE TABLE "maint_work_orders" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "fy_id" uuid REFERENCES "financial_years"("id") ON DELETE RESTRICT,
  "mwo_no" varchar(40) NOT NULL,
  "wo_type" varchar(12) NOT NULL DEFAULT 'CORRECTIVE',
  "asset_id" uuid NOT NULL REFERENCES "assets"("id") ON DELETE RESTRICT,
  "source_type" varchar(12) NOT NULL DEFAULT 'MANUAL',
  "source_id" uuid,
  "description" varchar(400) NOT NULL,
  "priority" varchar(2) NOT NULL DEFAULT 'P2',
  "planned_start" timestamptz(3),
  "planned_end" timestamptz(3),
  "actual_start" timestamptz(3),
  "actual_end" timestamptz(3),
  "est_cost" numeric(18,2) NOT NULL DEFAULT 0,
  "approval_status" varchar(12) NOT NULL DEFAULT 'NOT_REQUIRED',
  "approved_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "sign_off_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "sign_off_at" timestamptz(3),
  "status" varchar(12) NOT NULL DEFAULT 'PLANNED',
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "deleted_at" timestamptz(3),
  CONSTRAINT "mwo_type_chk" CHECK ("wo_type" IN ('PM','BREAKDOWN','CORRECTIVE','CALIBRATION','AMC')),
  CONSTRAINT "mwo_source_chk" CHECK ("source_type" IN ('PM_SCHEDULE','BREAKDOWN','MANUAL')),
  CONSTRAINT "mwo_prio_chk" CHECK ("priority" IN ('P1','P2','P3')),
  CONSTRAINT "mwo_appr_chk" CHECK ("approval_status" IN ('NOT_REQUIRED','PENDING','APPROVED','REJECTED')),
  CONSTRAINT "mwo_status_chk" CHECK ("status" IN ('PLANNED','APPROVED','IN_PROGRESS','COMPLETED','CLOSED','CANCELLED'))
);
CREATE UNIQUE INDEX "mwo_no_uq" ON "maint_work_orders"("mwo_no");
CREATE INDEX "mwo_asset_idx" ON "maint_work_orders"("asset_id","status");
CREATE INDEX "mwo_unit_idx" ON "maint_work_orders"("unit_id","status");
CREATE INDEX "mwo_source_idx" ON "maint_work_orders"("source_type","source_id");
CREATE INDEX "mwo_fy_idx" ON "maint_work_orders"("fy_id");
ALTER TABLE "breakdown_tickets" ADD CONSTRAINT "bd_wo_fk" FOREIGN KEY ("wo_id") REFERENCES "maint_work_orders"("id") ON DELETE SET NULL;

CREATE TABLE "mwo_tasks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "wo_id" uuid NOT NULL REFERENCES "maint_work_orders"("id") ON DELETE CASCADE,
  "seq" integer NOT NULL,
  "text" varchar(300) NOT NULL,
  "answer_type" varchar(10) NOT NULL DEFAULT 'OK_NOTOK',
  "min_value" numeric(18,3),
  "max_value" numeric(18,3),
  "result" varchar(200),
  "done_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "done_at" timestamptz(3)
);
CREATE UNIQUE INDEX "mwot_uq" ON "mwo_tasks"("wo_id","seq");

CREATE TABLE "mwo_spares" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "wo_id" uuid NOT NULL REFERENCES "maint_work_orders"("id") ON DELETE CASCADE,
  "item_id" uuid NOT NULL REFERENCES "items"("id") ON DELETE RESTRICT,
  "warehouse_id" uuid REFERENCES "warehouses"("id") ON DELETE RESTRICT,
  "required_qty" numeric(18,3) NOT NULL DEFAULT 0,
  "reserved_qty" numeric(18,3) NOT NULL DEFAULT 0,
  "issued_qty" numeric(18,3) NOT NULL DEFAULT 0,
  "returned_qty" numeric(18,3) NOT NULL DEFAULT 0,
  "rate" numeric(18,6) NOT NULL DEFAULT 0,
  "amount" numeric(18,2) NOT NULL DEFAULT 0,
  "stock_voucher_id" uuid,
  "journal_id" uuid,
  CONSTRAINT "mwos_qty_chk" CHECK ("required_qty" >= 0 AND "issued_qty" >= 0 AND "returned_qty" >= 0 AND "returned_qty" <= "issued_qty")
);
CREATE INDEX "mwos_wo_idx" ON "mwo_spares"("wo_id");
CREATE INDEX "mwos_item_idx" ON "mwo_spares"("item_id");
CREATE INDEX "mwos_wh_idx" ON "mwo_spares"("warehouse_id");

CREATE TABLE "mwo_labour" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "wo_id" uuid NOT NULL REFERENCES "maint_work_orders"("id") ON DELETE CASCADE,
  "employee_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "vendor_name" varchar(120),
  "start_at" timestamptz(3) NOT NULL,
  "end_at" timestamptz(3) NOT NULL,
  "hours" numeric(9,2) GENERATED ALWAYS AS (round((EXTRACT(EPOCH FROM ("end_at" - "start_at")) / 3600)::numeric, 2)) STORED,
  "rate" numeric(18,2) NOT NULL DEFAULT 0,
  "amount" numeric(18,2) NOT NULL DEFAULT 0,
  CONSTRAINT "mwol_time_chk" CHECK ("end_at" > "start_at"),
  CONSTRAINT "mwol_who_chk" CHECK ("employee_id" IS NOT NULL OR "vendor_name" IS NOT NULL)
);
CREATE INDEX "mwol_wo_idx" ON "mwo_labour"("wo_id");
CREATE INDEX "mwol_emp_idx" ON "mwo_labour"("employee_id");

CREATE TABLE "mwo_vendor_charges" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "wo_id" uuid NOT NULL REFERENCES "maint_work_orders"("id") ON DELETE CASCADE,
  "supplier_id" uuid REFERENCES "suppliers"("id") ON DELETE SET NULL,
  "invoice_ref" varchar(60),
  "amount" numeric(18,2) NOT NULL,
  CONSTRAINT "mwov_amt_chk" CHECK ("amount" >= 0)
);
CREATE INDEX "mwov_wo_idx" ON "mwo_vendor_charges"("wo_id");
CREATE INDEX "mwov_sup_idx" ON "mwo_vendor_charges"("supplier_id");

CREATE TABLE "pm_schedules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "plan_id" uuid NOT NULL REFERENCES "pm_plans"("id") ON DELETE CASCADE,
  "due_date" date,
  "due_meter" numeric(18,3),
  "status" varchar(10) NOT NULL DEFAULT 'PLANNED',
  "wo_id" uuid REFERENCES "maint_work_orders"("id") ON DELETE SET NULL,
  "generated_key" varchar(80) NOT NULL,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "pms_status_chk" CHECK ("status" IN ('PLANNED','WO_CREATED','DONE','SKIPPED'))
);
CREATE UNIQUE INDEX "pms_key_uq" ON "pm_schedules"("generated_key");
CREATE INDEX "pms_plan_idx" ON "pm_schedules"("plan_id","status");
CREATE INDEX "pms_unit_idx" ON "pm_schedules"("unit_id","due_date");
CREATE INDEX "pms_wo_idx" ON "pm_schedules"("wo_id");

CREATE TABLE "downtime_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "dt_no" varchar(40) NOT NULL,
  "asset_id" uuid NOT NULL REFERENCES "assets"("id") ON DELETE RESTRICT,
  "work_centre_id" uuid REFERENCES "mfg_work_centres"("id") ON DELETE SET NULL,
  "start_at" timestamptz(3) NOT NULL,
  "end_at" timestamptz(3),
  "duration_min" numeric(12,2) GENERATED ALWAYS AS (
    CASE WHEN "end_at" IS NOT NULL THEN round((EXTRACT(EPOCH FROM ("end_at" - "start_at")) / 60)::numeric, 2) END
  ) STORED,
  "dt_type" varchar(10) NOT NULL DEFAULT 'UNPLANNED',
  "reason" varchar(200),
  "breakdown_id" uuid REFERENCES "breakdown_tickets"("id") ON DELETE SET NULL,
  "production_order_id" uuid REFERENCES "mfg_orders"("id") ON DELETE SET NULL,
  "lost_qty" numeric(18,3),
  "cost_impact" numeric(18,2),
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "deleted_at" timestamptz(3),
  CONSTRAINT "dte_type_chk" CHECK ("dt_type" IN ('PLANNED','UNPLANNED')),
  CONSTRAINT "dte_time_chk" CHECK ("end_at" IS NULL OR "end_at" > "start_at")
);
CREATE UNIQUE INDEX "dte_no_uq" ON "downtime_events"("dt_no");
CREATE INDEX "dte_asset_idx" ON "downtime_events"("asset_id","start_at");
CREATE INDEX "dte_unit_idx" ON "downtime_events"("unit_id","start_at");
CREATE INDEX "dte_bd_idx" ON "downtime_events"("breakdown_id");
CREATE INDEX "dte_wc_idx" ON "downtime_events"("work_centre_id");
CREATE INDEX "dte_po_idx" ON "downtime_events"("production_order_id");

-- no overlap per asset (open events run to "now")
CREATE FUNCTION "downtime_no_overlap"() RETURNS trigger AS $$
BEGIN
  IF NEW.deleted_at IS NULL AND EXISTS (
    SELECT 1 FROM downtime_events d
     WHERE d.asset_id = NEW.asset_id AND d.id <> NEW.id AND d.deleted_at IS NULL
       AND tstzrange(d.start_at, COALESCE(d.end_at, 'infinity'::timestamptz)) && tstzrange(NEW.start_at, COALESCE(NEW.end_at, 'infinity'::timestamptz))
  ) THEN RAISE EXCEPTION 'DOWNTIME_OVERLAP'; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER "downtime_no_overlap_trg" BEFORE INSERT OR UPDATE OF "start_at","end_at","asset_id","deleted_at" ON "downtime_events"
  FOR EACH ROW EXECUTE FUNCTION "downtime_no_overlap"();

CREATE TABLE "alert_rules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "alert_type" varchar(24) NOT NULL,
  "lead_days" integer NOT NULL DEFAULT 0,
  "escalation_minutes" integer[] NOT NULL DEFAULT '{}',
  "channel" varchar(10) NOT NULL DEFAULT 'IN_APP',
  "active" boolean NOT NULL DEFAULT true,
  CONSTRAINT "ar_type_chk" CHECK ("alert_type" IN ('PM_DUE','PM_OVERDUE','BREAKDOWN_UNACK','WARRANTY_EXPIRY','SPARE_LOW','LOAN_RETURN_DUE')),
  CONSTRAINT "ar_channel_chk" CHECK ("channel" IN ('IN_APP','EMAIL'))
);
CREATE UNIQUE INDEX "ar_type_uq" ON "alert_rules"("alert_type");

CREATE TABLE "alerts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "rule_id" uuid NOT NULL REFERENCES "alert_rules"("id") ON DELETE RESTRICT,
  "asset_id" uuid REFERENCES "assets"("id") ON DELETE CASCADE,
  "ref_type" varchar(20),
  "ref_id" uuid,
  "message" varchar(300) NOT NULL,
  "due_at" timestamptz(3),
  "escalation_level" integer NOT NULL DEFAULT 0,
  "acknowledged_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "acknowledged_at" timestamptz(3),
  "status" varchar(10) NOT NULL DEFAULT 'OPEN',
  "alert_key" varchar(80) NOT NULL,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "al_status_chk" CHECK ("status" IN ('OPEN','ACK','CLEARED'))
);
CREATE UNIQUE INDEX "al_key_uq" ON "alerts"("alert_key");
CREATE INDEX "al_unit_idx" ON "alerts"("unit_id","status");
CREATE INDEX "al_rule_idx" ON "alerts"("rule_id");
CREATE INDEX "al_asset_idx" ON "alerts"("asset_id");
