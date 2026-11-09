-- Phase 12 / A: Quality (QMS). One inspection engine: form templates (data, R-16/R-17), inspection plans, inspections with
-- readings, the usage decision, generic quality forms (8D, quality alert, minutes of meeting, continuous improvement),
-- rejection register, PPM / quality-cost figures, instruments and calibration. Forward-only; nothing is computed in code
-- that the owner should set: targets and the reminder window are rows of qms_settings.

-- ------------------------------------------------------------------ templates (versioned data)
CREATE TABLE "qms_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" varchar(30) NOT NULL,
  "family" varchar(12) NOT NULL,
  "kind" varchar(20) NOT NULL,
  "name" varchar(120) NOT NULL,
  "customer_id" uuid REFERENCES "customers"("id") ON DELETE RESTRICT,
  "unit_id" uuid REFERENCES "units"("id") ON DELETE RESTRICT,
  "version" integer NOT NULL DEFAULT 1,
  "status" varchar(10) NOT NULL DEFAULT 'ACTIVE',
  "header_fields" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "row_config" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "close_requires" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "change_reason" varchar(300),
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "qms_templates_family_chk" CHECK ("family" IN ('INSPECTION','FORM')),
  CONSTRAINT "qms_templates_kind_chk" CHECK ("kind" IN ('INCOMING','IN_PROCESS','PRE_DISPATCH','ISIR','WELDING','VT','EIGHT_D','ALERT','MOM','CI')),
  CONSTRAINT "qms_templates_status_chk" CHECK ("status" IN ('ACTIVE','RETIRED'))
);
CREATE UNIQUE INDEX "qms_templates_ver_uq" ON "qms_templates"("code","version");
-- one ACTIVE template per (kind, customer, unit)
CREATE UNIQUE INDEX "qms_templates_active_uq" ON "qms_templates"("kind", COALESCE("customer_id", '00000000-0000-0000-0000-000000000000'::uuid), COALESCE("unit_id", '00000000-0000-0000-0000-000000000000'::uuid)) WHERE "status" = 'ACTIVE';
CREATE INDEX "qms_templates_customer_idx" ON "qms_templates"("customer_id");
CREATE INDEX "qms_templates_unit_idx" ON "qms_templates"("unit_id");
CREATE INDEX "qms_templates_created_by_idx" ON "qms_templates"("created_by_id");

-- ------------------------------------------------------------------ inspection plans
CREATE TABLE "qms_plans" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" varchar(40) NOT NULL,
  "name" varchar(150) NOT NULL,
  "kind" varchar(20) NOT NULL,
  "item_id" uuid REFERENCES "items"("id") ON DELETE RESTRICT,
  "customer_id" uuid REFERENCES "customers"("id") ON DELETE RESTRICT,
  "characteristics" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "status" varchar(10) NOT NULL DEFAULT 'ACTIVE',
  "notes" varchar(500),
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "qms_plans_kind_chk" CHECK ("kind" IN ('INCOMING','IN_PROCESS','PRE_DISPATCH','ISIR','WELDING','VT')),
  CONSTRAINT "qms_plans_status_chk" CHECK ("status" IN ('ACTIVE','INACTIVE'))
);
CREATE UNIQUE INDEX "qms_plans_code_uq" ON "qms_plans"("code");
CREATE INDEX "qms_plans_item_idx" ON "qms_plans"("item_id", "kind");
CREATE INDEX "qms_plans_customer_idx" ON "qms_plans"("customer_id");
CREATE INDEX "qms_plans_created_by_idx" ON "qms_plans"("created_by_id");
CREATE INDEX "qms_plans_updated_by_idx" ON "qms_plans"("updated_by_id");

-- ------------------------------------------------------------------ inspections
CREATE TABLE "qms_inspections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "fy_id" uuid NOT NULL REFERENCES "financial_years"("id") ON DELETE RESTRICT,
  "number" varchar(40),
  "kind" varchar(20) NOT NULL,
  "department" varchar(60) NOT NULL DEFAULT '',
  "status" varchar(12) NOT NULL DEFAULT 'Draft',
  "template_id" uuid NOT NULL REFERENCES "qms_templates"("id") ON DELETE RESTRICT,
  "template_snapshot" jsonb NOT NULL,
  "plan_id" uuid REFERENCES "qms_plans"("id") ON DELETE SET NULL,
  "doc_date" date NOT NULL DEFAULT CURRENT_DATE,
  "customer_id" uuid REFERENCES "customers"("id") ON DELETE RESTRICT,
  "supplier_id" uuid REFERENCES "suppliers"("id") ON DELETE RESTRICT,
  "item_id" uuid REFERENCES "items"("id") ON DELETE RESTRICT,
  "header" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "source_type" varchar(20),
  "source_id" uuid,
  "lot_qty" numeric(18,3),
  "result" varchar(12),
  "result_note" varchar(500),
  "accepted_qty" numeric(18,3),
  "rejected_qty" numeric(18,3),
  "decision" varchar(12),
  "decision_note" varchar(500),
  "inspector_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "submitted_at" timestamptz(3),
  "decided_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "decided_at" timestamptz(3),
  "cancelled_at" timestamptz(3),
  "cancel_reason" varchar(300),
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "deleted_at" timestamptz(3),
  "deleted_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "qms_insp_kind_chk" CHECK ("kind" IN ('INCOMING','IN_PROCESS','PRE_DISPATCH','ISIR','WELDING','VT')),
  CONSTRAINT "qms_insp_status_chk" CHECK ("status" IN ('Draft','Submitted','Decided','Cancelled')),
  CONSTRAINT "qms_insp_result_chk" CHECK ("result" IS NULL OR "result" IN ('ACCEPTED','REJECTED','CONDITIONAL')),
  CONSTRAINT "qms_insp_decision_chk" CHECK ("decision" IS NULL OR "decision" IN ('ACCEPTED','REJECTED','PARTIAL','CONDITIONAL')),
  CONSTRAINT "qms_insp_qty_chk" CHECK (("accepted_qty" IS NULL OR "accepted_qty" >= 0) AND ("rejected_qty" IS NULL OR "rejected_qty" >= 0))
);
CREATE UNIQUE INDEX "qms_insp_number_uq" ON "qms_inspections"("unit_id","fy_id","number") WHERE "number" IS NOT NULL;
-- a goods-receipt line has at most one live inspection lot
CREATE UNIQUE INDEX "qms_insp_source_uq" ON "qms_inspections"("source_type","source_id") WHERE "source_id" IS NOT NULL AND "status" <> 'Cancelled' AND "deleted_at" IS NULL;
CREATE INDEX "qms_insp_unit_idx" ON "qms_inspections"("unit_id","kind","status");
CREATE INDEX "qms_insp_fy_idx" ON "qms_inspections"("fy_id");
CREATE INDEX "qms_insp_template_idx" ON "qms_inspections"("template_id");
CREATE INDEX "qms_insp_plan_idx" ON "qms_inspections"("plan_id");
CREATE INDEX "qms_insp_customer_idx" ON "qms_inspections"("customer_id");
CREATE INDEX "qms_insp_supplier_idx" ON "qms_inspections"("supplier_id");
CREATE INDEX "qms_insp_item_idx" ON "qms_inspections"("item_id");
CREATE INDEX "qms_insp_inspector_idx" ON "qms_inspections"("inspector_id");
CREATE INDEX "qms_insp_decided_by_idx" ON "qms_inspections"("decided_by_id");
CREATE INDEX "qms_insp_created_by_idx" ON "qms_inspections"("created_by_id");
CREATE INDEX "qms_insp_updated_by_idx" ON "qms_inspections"("updated_by_id");
CREATE INDEX "qms_insp_deleted_by_idx" ON "qms_inspections"("deleted_by_id");

CREATE TABLE "qms_inspection_rows" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "inspection_id" uuid NOT NULL REFERENCES "qms_inspections"("id") ON DELETE CASCADE,
  "row_no" integer NOT NULL,
  "label" varchar(200) NOT NULL,
  "spec" varchar(200),
  "method" varchar(120),
  "unit" varchar(20),
  "row_type" varchar(10) NOT NULL DEFAULT 'NUMERIC',
  "lsl" numeric(18,6),
  "usl" numeric(18,6),
  "readings" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "extra" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "row_status" varchar(10) NOT NULL DEFAULT 'PENDING',
  "remark" varchar(300),
  CONSTRAINT "qms_rows_type_chk" CHECK ("row_type" IN ('NUMERIC','ATTRIBUTE')),
  CONSTRAINT "qms_rows_status_chk" CHECK ("row_status" IN ('PENDING','OK','NOT_OK','NA')),
  CONSTRAINT "qms_rows_limits_chk" CHECK ("lsl" IS NULL OR "usl" IS NULL OR "lsl" <= "usl")
);
CREATE UNIQUE INDEX "qms_rows_no_uq" ON "qms_inspection_rows"("inspection_id","row_no");

-- ------------------------------------------------------------------ generic quality forms (8D, alert, MOM, CI)
CREATE TABLE "qms_forms" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "fy_id" uuid NOT NULL REFERENCES "financial_years"("id") ON DELETE RESTRICT,
  "number" varchar(40),
  "kind" varchar(10) NOT NULL,
  "department" varchar(60) NOT NULL DEFAULT '',
  "status" varchar(10) NOT NULL DEFAULT 'Open',
  "title" varchar(200) NOT NULL,
  "doc_date" date NOT NULL DEFAULT CURRENT_DATE,
  "template_id" uuid NOT NULL REFERENCES "qms_templates"("id") ON DELETE RESTRICT,
  "template_snapshot" jsonb NOT NULL,
  "customer_id" uuid REFERENCES "customers"("id") ON DELETE RESTRICT,
  "supplier_id" uuid REFERENCES "suppliers"("id") ON DELETE RESTRICT,
  "item_id" uuid REFERENCES "items"("id") ON DELETE RESTRICT,
  "data" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "capa_ref" varchar(60),
  "closed_at" timestamptz(3),
  "close_note" varchar(500),
  "cancelled_at" timestamptz(3),
  "cancel_reason" varchar(300),
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "deleted_at" timestamptz(3),
  "deleted_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "qms_forms_kind_chk" CHECK ("kind" IN ('EIGHT_D','ALERT','MOM','CI')),
  CONSTRAINT "qms_forms_status_chk" CHECK ("status" IN ('Open','Closed','Cancelled'))
);
CREATE UNIQUE INDEX "qms_forms_number_uq" ON "qms_forms"("unit_id","fy_id","number") WHERE "number" IS NOT NULL;
CREATE INDEX "qms_forms_unit_idx" ON "qms_forms"("unit_id","kind","status");
CREATE INDEX "qms_forms_fy_idx" ON "qms_forms"("fy_id");
CREATE INDEX "qms_forms_template_idx" ON "qms_forms"("template_id");
CREATE INDEX "qms_forms_customer_idx" ON "qms_forms"("customer_id");
CREATE INDEX "qms_forms_supplier_idx" ON "qms_forms"("supplier_id");
CREATE INDEX "qms_forms_item_idx" ON "qms_forms"("item_id");
CREATE INDEX "qms_forms_created_by_idx" ON "qms_forms"("created_by_id");
CREATE INDEX "qms_forms_updated_by_idx" ON "qms_forms"("updated_by_id");
CREATE INDEX "qms_forms_deleted_by_idx" ON "qms_forms"("deleted_by_id");

-- ------------------------------------------------------------------ rejection / rework register
CREATE TABLE "qms_rejections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "fy_id" uuid NOT NULL REFERENCES "financial_years"("id") ON DELETE RESTRICT,
  "number" varchar(40),
  "reject_date" date NOT NULL DEFAULT CURRENT_DATE,
  "process" varchar(80) NOT NULL,
  "operator" varchar(80),
  "item_id" uuid REFERENCES "items"("id") ON DELETE RESTRICT,
  "part" varchar(150) NOT NULL,
  "hold_qty" numeric(18,3) NOT NULL,
  "defect" varchar(200) NOT NULL,
  "defect_type" varchar(60) NOT NULL,
  "disposition" varchar(20) NOT NULL DEFAULT 'HOLD',
  "disposition_note" varchar(300),
  "source_inspection_id" uuid REFERENCES "qms_inspections"("id") ON DELETE SET NULL,
  "status" varchar(10) NOT NULL DEFAULT 'Open',
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "deleted_at" timestamptz(3),
  "deleted_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "qms_rej_qty_chk" CHECK ("hold_qty" > 0),
  CONSTRAINT "qms_rej_disp_chk" CHECK ("disposition" IN ('HOLD','REWORK','SCRAP','USE_AS_IS','RETURN_TO_VENDOR')),
  CONSTRAINT "qms_rej_status_chk" CHECK ("status" IN ('Open','Closed','Cancelled'))
);
CREATE UNIQUE INDEX "qms_rej_number_uq" ON "qms_rejections"("unit_id","fy_id","number") WHERE "number" IS NOT NULL;
CREATE INDEX "qms_rej_unit_idx" ON "qms_rejections"("unit_id","reject_date");
CREATE INDEX "qms_rej_fy_idx" ON "qms_rejections"("fy_id");
CREATE INDEX "qms_rej_item_idx" ON "qms_rejections"("item_id");
CREATE INDEX "qms_rej_insp_idx" ON "qms_rejections"("source_inspection_id");
CREATE INDEX "qms_rej_created_by_idx" ON "qms_rejections"("created_by_id");
CREATE INDEX "qms_rej_updated_by_idx" ON "qms_rejections"("updated_by_id");
CREATE INDEX "qms_rej_deleted_by_idx" ON "qms_rejections"("deleted_by_id");

-- ------------------------------------------------------------------ PPM and quality-cost figures
CREATE TABLE "qms_monthly" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "month" date NOT NULL,
  "produced_qty" numeric(18,3) NOT NULL DEFAULT 0,
  "rejected_qty" numeric(18,3) NOT NULL DEFAULT 0,
  "customer_rejected_qty" numeric(18,3) NOT NULL DEFAULT 0,
  "sales_value" numeric(18,2) NOT NULL DEFAULT 0,
  "note" varchar(300),
  "version" integer NOT NULL DEFAULT 1,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "qms_monthly_first_chk" CHECK (EXTRACT(day FROM "month") = 1),
  CONSTRAINT "qms_monthly_qty_chk" CHECK ("produced_qty" >= 0 AND "rejected_qty" >= 0 AND "customer_rejected_qty" >= 0 AND "sales_value" >= 0)
);
CREATE UNIQUE INDEX "qms_monthly_uq" ON "qms_monthly"("unit_id","month");
CREATE INDEX "qms_monthly_updated_by_idx" ON "qms_monthly"("updated_by_id");

CREATE TABLE "qms_cost_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "month" date NOT NULL,
  "category" varchar(20) NOT NULL,
  "description" varchar(200) NOT NULL,
  "amount" numeric(18,2) NOT NULL,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "deleted_at" timestamptz(3),
  CONSTRAINT "qms_cost_first_chk" CHECK (EXTRACT(day FROM "month") = 1),
  CONSTRAINT "qms_cost_cat_chk" CHECK ("category" IN ('PREVENTION','APPRAISAL','INTERNAL_FAILURE','EXTERNAL_FAILURE')),
  CONSTRAINT "qms_cost_amt_chk" CHECK ("amount" > 0)
);
CREATE INDEX "qms_cost_unit_idx" ON "qms_cost_entries"("unit_id","month");
CREATE INDEX "qms_cost_created_by_idx" ON "qms_cost_entries"("created_by_id");

-- targets and the reminder window are the owner's numbers: none is seeded except the reminder window, flagged for review
CREATE TABLE "qms_settings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id" uuid REFERENCES "units"("id") ON DELETE CASCADE,
  "key" varchar(40) NOT NULL,
  "value" numeric(18,4) NOT NULL,
  "needs_review" boolean NOT NULL DEFAULT true,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "qms_settings_key_chk" CHECK ("key" IN ('CAL_REMINDER_DAYS','INTERNAL_PPM_TARGET','CUSTOMER_PPM_TARGET','QUALITY_COST_PCT_TARGET'))
);
CREATE UNIQUE INDEX "qms_settings_uq" ON "qms_settings"(COALESCE("unit_id", '00000000-0000-0000-0000-000000000000'::uuid), "key");
CREATE INDEX "qms_settings_updated_by_idx" ON "qms_settings"("updated_by_id");
INSERT INTO "qms_settings" ("unit_id","key","value","needs_review") VALUES (NULL,'CAL_REMINDER_DAYS',15,true);

-- ------------------------------------------------------------------ instruments and calibration
CREATE TABLE "qms_instruments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "history_card_no" varchar(40) NOT NULL,
  "name" varchar(150) NOT NULL,
  "equipment_no" varchar(60) NOT NULL,
  "division" varchar(80),
  "measuring_range" varchar(80),
  "least_count" varchar(40),
  "make" varchar(80),
  "location" varchar(80),
  "frequency_months" integer NOT NULL DEFAULT 12,
  "last_calibrated_on" date,
  "valid_until" date,
  "status" varchar(14) NOT NULL DEFAULT 'ACTIVE',
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "deleted_at" timestamptz(3),
  "deleted_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "qms_instr_status_chk" CHECK ("status" IN ('ACTIVE','OUT_OF_SERVICE','RETIRED')),
  CONSTRAINT "qms_instr_freq_chk" CHECK ("frequency_months" BETWEEN 1 AND 120)
);
CREATE UNIQUE INDEX "qms_instr_card_uq" ON "qms_instruments"("unit_id","history_card_no") WHERE "deleted_at" IS NULL;
CREATE UNIQUE INDEX "qms_instr_equip_uq" ON "qms_instruments"("unit_id","equipment_no") WHERE "deleted_at" IS NULL;
CREATE INDEX "qms_instr_valid_idx" ON "qms_instruments"("unit_id","valid_until");
CREATE INDEX "qms_instr_created_by_idx" ON "qms_instruments"("created_by_id");
CREATE INDEX "qms_instr_updated_by_idx" ON "qms_instruments"("updated_by_id");
CREATE INDEX "qms_instr_deleted_by_idx" ON "qms_instruments"("deleted_by_id");

CREATE TABLE "qms_calibrations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "instrument_id" uuid NOT NULL REFERENCES "qms_instruments"("id") ON DELETE RESTRICT,
  "calibrated_on" date NOT NULL,
  "valid_until" date NOT NULL,
  "certificate_no" varchar(60),
  "agency" varchar(120),
  "result" varchar(10) NOT NULL,
  "error_found" varchar(200),
  "note" varchar(300),
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "qms_cal_result_chk" CHECK ("result" IN ('PASS','FAIL')),
  CONSTRAINT "qms_cal_dates_chk" CHECK ("valid_until" >= "calibrated_on")
);
CREATE INDEX "qms_cal_instr_idx" ON "qms_calibrations"("instrument_id","calibrated_on");
CREATE INDEX "qms_cal_created_by_idx" ON "qms_calibrations"("created_by_id");

-- ------------------------------------------------------------------ seed templates (structure only, from the client forms)
INSERT INTO "qms_templates" ("code","family","kind","name","header_fields","row_config","close_requires") VALUES
('TPL-INCOMING','INSPECTION','INCOMING','Incoming (RM) inspection sheet',
 '[{"key":"supplier","label":"Supplier","type":"supplier","required":true},
   {"key":"invoice_no","label":"Invoice no","type":"text","required":true},
   {"key":"item","label":"Item","type":"item","required":true},
   {"key":"grade_spec","label":"Grade / specification","type":"text"},
   {"key":"heat_batch_no","label":"Heat / batch no","type":"text"},
   {"key":"dimensions","label":"Dimensions","type":"text"}]',
 '{"readings":1,"readingLabel":"Result","labelHeader":"Characteristic"}','[]'),
('TPL-IN-PROCESS','INSPECTION','IN_PROCESS','In-process inspection',
 '[{"key":"part","label":"Part no / name","type":"item","required":true},
   {"key":"machine","label":"Machine","type":"text","required":true},
   {"key":"operation","label":"Operation","type":"text","required":true}]',
 '{"readings":5,"readingLabel":"Part","labelHeader":"Specification / characteristic"}','[]'),
('TPL-PRE-DISPATCH','INSPECTION','PRE_DISPATCH','Pre-dispatch inspection',
 '[{"key":"customer","label":"Customer","type":"customer","required":true},
   {"key":"part","label":"Part","type":"item","required":true},
   {"key":"challan_no","label":"Challan no","type":"text","required":true},
   {"key":"in_charge","label":"In-charge","type":"text"}]',
 '{"readings":5,"readingLabel":"Reading","labelHeader":"Parameter"}','[]'),
('TPL-ISIR','INSPECTION','ISIR','Initial sample inspection report (ISIR)',
 '[{"key":"supplier","label":"Supplier","type":"supplier","required":true},
   {"key":"part_no","label":"Part no","type":"item","required":true},
   {"key":"revision","label":"Revision","type":"text","required":true},
   {"key":"material_spec","label":"Material specification","type":"text"},
   {"key":"reviewed_by","label":"Reviewed by","type":"text"}]',
 '{"readings":5,"readingLabel":"Sample","labelHeader":"Dimension","extra":[{"key":"zone_item","label":"Zone / item"},{"key":"tolerance","label":"Tolerance"}]}','[]'),
('TPL-WELDING','INSPECTION','WELDING','Welding inspection (before / after)',
 '[{"key":"stage","label":"Stage","type":"select","options":["BEFORE","AFTER"],"required":true},
   {"key":"acceptance_class","label":"Acceptance criterion (ISO 5817 class)","type":"select","options":["B","C","D"],"required":true},
   {"key":"weld_no","label":"Weld no","type":"text","required":true},
   {"key":"welder_no","label":"Welder no","type":"text","required":true},
   {"key":"wps_no","label":"WPS no","type":"text","required":true},
   {"key":"heat_no","label":"Heat no","type":"text"}]',
 '{"readings":1,"readingLabel":"Result","labelHeader":"Fit-up / weld check","attribute":true}','[]'),
('TPL-VT','INSPECTION','VT','Visual test (VT) report',
 '[{"key":"part","label":"Part / job","type":"text"},
   {"key":"location","label":"Location","type":"text"}]',
 '{"readings":1,"readingLabel":"Result","labelHeader":"Check","attribute":true}','[]'),
('TPL-8D','FORM','EIGHT_D','8D problem solving',
 '[{"key":"d1_team","label":"D1 Team","type":"textarea","required":true},
   {"key":"d2_problem","label":"D2 Problem description","type":"textarea","required":true},
   {"key":"d3_containment","label":"D3 Containment action","type":"textarea"},
   {"key":"why_made","label":"Why-Why: why it was made (1 to 5)","type":"textarea"},
   {"key":"why_missed","label":"Why-Why: why it was missed (1 to 5)","type":"textarea"},
   {"key":"cause_effect","label":"Cause and effect","type":"textarea"},
   {"key":"d4_root_cause","label":"D4 Root cause","type":"textarea"},
   {"key":"d5_corrective","label":"D5 Corrective action","type":"textarea"},
   {"key":"d6_implemented","label":"D6 Implementation and check","type":"textarea"},
   {"key":"d7_prevent","label":"D7 Prevent recurrence","type":"textarea"},
   {"key":"d8_recognise","label":"D8 Team recognition","type":"textarea"}]',
 '{}','["d4_root_cause","d5_corrective","d7_prevent"]'),
('TPL-ALERT','FORM','ALERT','Quality alert',
 '[{"key":"part","label":"Part","type":"item","required":true},
   {"key":"notification_date","label":"Notification date","type":"date","required":true},
   {"key":"issue","label":"Issue","type":"textarea","required":true},
   {"key":"evidence_ok","label":"OK sample / evidence","type":"textarea"},
   {"key":"evidence_not_ok","label":"NOT OK sample / evidence","type":"textarea"},
   {"key":"containment","label":"Containment action","type":"textarea"}]',
 '{}','["containment"]'),
('TPL-MOM','FORM','MOM','Minutes of meeting',
 '[{"key":"agenda","label":"Agenda","type":"textarea","required":true},
   {"key":"customer_reps","label":"Customer representatives","type":"text"},
   {"key":"own_reps","label":"Our representatives","type":"text"},
   {"key":"points","label":"Points discussed (point / responsible / remark)","type":"textarea","required":true}]',
 '{}','[]'),
('TPL-CI','FORM','CI','Continuous improvement (SQDCPE)',
 '[{"key":"theme","label":"Theme","type":"text","required":true},
   {"key":"project_no","label":"Project no","type":"text","required":true},
   {"key":"start_date","label":"Start date","type":"date"},
   {"key":"end_date","label":"End date","type":"date"},
   {"key":"category","label":"Category","type":"select","options":["S","Q","D","C","P","E"],"required":true},
   {"key":"team","label":"Team","type":"text"},
   {"key":"before","label":"Before","type":"textarea"},
   {"key":"target","label":"Target","type":"textarea"},
   {"key":"why_1","label":"Why 1","type":"text"},
   {"key":"why_2","label":"Why 2","type":"text"},
   {"key":"why_3","label":"Why 3","type":"text"},
   {"key":"why_4","label":"Why 4","type":"text"},
   {"key":"root_cause","label":"Root cause","type":"textarea"},
   {"key":"actions","label":"Actions","type":"textarea"},
   {"key":"after","label":"After","type":"textarea"}]',
 '{}','["root_cause","actions","after"]');
