-- Phase 24: dashboards suite - My Dashboard, department / plant / owner / module dashboards, drill-down, targets,
-- alerts, TV mode, emailed dashboards. Builds on the Phase 19 tables (kpi_definitions, kpi_snapshots, dashboards).
-- Forward-only. Local / test databases only until the owner deploys by hand.

-- 1. KPI definitions: format, drill-down target, plain-language formula and source (shown behind the "i" button).
ALTER TABLE "kpi_definitions" ADD COLUMN IF NOT EXISTS "format" varchar(10) NOT NULL DEFAULT 'count'
  CHECK ("format" IN ('inr','pct','count','days','hours','ratio'));
ALTER TABLE "kpi_definitions" ADD COLUMN IF NOT EXISTS "drill_page" varchar(80);
ALTER TABLE "kpi_definitions" ADD COLUMN IF NOT EXISTS "drill_filter_tpl" text;
ALTER TABLE "kpi_definitions" ADD COLUMN IF NOT EXISTS "formula_text" text;
ALTER TABLE "kpi_definitions" ADD COLUMN IF NOT EXISTS "source_text" text;

UPDATE "kpi_definitions" SET "format" = CASE "unit_label"
    WHEN 'INR' THEN 'inr' WHEN '%' THEN 'pct' WHEN 'days' THEN 'days' ELSE 'count' END
 WHERE "format" = 'count';

UPDATE "kpi_definitions" k SET "drill_page" = v.page, "source_text" = v.src
  FROM (VALUES
    ('sales_orders_mtd', 'sales-orders', 'from sales orders of the month'),
    ('sales_invoiced_mtd', 'sales-invoices', 'from posted sales invoices'),
    ('sales_ar_overdue', 'fin-ar', 'from the receivables sub-ledger'),
    ('sales_dso', 'fin-ar', 'from receivables and 90 days of credit sales'),
    ('purch_open_pos', 'scm-po', 'from open purchase orders'),
    ('purch_grn_mtd', 'scm-grn', 'from goods receipts of the month'),
    ('fin_cash_bank', 'fin-gl', 'from cash and bank ledger balances'),
    ('fin_net_profit_mtd', 'fin-pnl', 'from posted ledger entries of the month'),
    ('hr_headcount', 'hr-employees', 'from active employees'),
    ('hr_last_payroll', 'pay-processing', 'from the latest payroll run'),
    ('prod_wip_orders', 'mfg-orders', 'from running production orders'),
    ('prod_rejection_pct', 'mfg-orders', 'from production orders'),
    ('qual_fpy', 'qms-inspections', 'from inspection lots'),
    ('maint_open_mwo', 'maint-workorders', 'from open maintenance work orders'),
    ('wh_stock_value', 'inv-stock', 'from stock balances'),
    ('proj_active', 'proj-projects', 'from projects'),
    ('proj_at_risk', 'proj-projects', 'from projects with amber or red health'),
    ('srv_open_tickets', 'service-tickets', 'from service tickets'),
    ('srv_sla_pct', 'service-tickets', 'from service tickets'),
    ('admin_pending_approvals', 'admin-approval', 'from pending approval requests')
  ) AS v(code, page, src)
 WHERE k."code" = v.code;

-- 2. Targets: per KPI, optionally per plant / department / person, per period. Green at or above amber_pct of target,
--    amber at or above red_pct, otherwise red (exactly 90 % is green, exactly 75 % is amber).
CREATE TABLE IF NOT EXISTS "kpi_targets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "kpi_code" varchar(50) NOT NULL REFERENCES "kpi_definitions"("code") ON DELETE CASCADE,
  "unit_id" uuid REFERENCES "units"("id") ON DELETE CASCADE,
  "department_id" uuid REFERENCES "departments"("id") ON DELETE CASCADE,
  "user_id" uuid REFERENCES "users"("id") ON DELETE CASCADE,
  "period_kind" varchar(10) NOT NULL DEFAULT 'MONTH' CHECK ("period_kind" IN ('DAY','WEEK','MONTH','QUARTER','FY')),
  "period_start" date NOT NULL,
  "target" numeric(18,4) NOT NULL,
  "amber_pct" numeric(5,2) NOT NULL DEFAULT 90 CHECK ("amber_pct" > 0 AND "amber_pct" <= 100),
  "red_pct" numeric(5,2) NOT NULL DEFAULT 75 CHECK ("red_pct" > 0 AND "red_pct" <= 100),
  "set_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  CHECK ("red_pct" <= "amber_pct")
);
CREATE UNIQUE INDEX IF NOT EXISTS "kpi_targets_scope_uq" ON "kpi_targets"
  ("kpi_code", coalesce("unit_id", '00000000-0000-0000-0000-000000000000'::uuid),
   coalesce("department_id", '00000000-0000-0000-0000-000000000000'::uuid),
   coalesce("user_id", '00000000-0000-0000-0000-000000000000'::uuid), "period_kind", "period_start");
CREATE INDEX IF NOT EXISTS "kpi_targets_set_by_idx" ON "kpi_targets" ("set_by");
CREATE INDEX IF NOT EXISTS "kpi_targets_unit_idx" ON "kpi_targets" ("unit_id");
CREATE INDEX IF NOT EXISTS "kpi_targets_dept_idx" ON "kpi_targets" ("department_id");
CREATE INDEX IF NOT EXISTS "kpi_targets_user_idx" ON "kpi_targets" ("user_id");

-- 3. Widget library: what the "add widget" drawer offers. KPI widgets are generated from kpi_definitions below.
CREATE TABLE IF NOT EXISTS "widgets_library" (
  "code" varchar(60) PRIMARY KEY,
  "title" varchar(120) NOT NULL,
  "kind" varchar(20) NOT NULL CHECK ("kind" IN ('KPI','CHART_LINE','CHART_BAR','CHART_DONUT','STACKED','HEATMAP','FUNNEL','GAUGE','TABLE','LIST','COUNTER','CALENDAR','QUEUE_CARDS')),
  "kpi_code" varchar(50) REFERENCES "kpi_definitions"("code") ON DELETE CASCADE,
  "dataset" varchar(50),
  "category" varchar(30) NOT NULL DEFAULT 'General',
  "min_w" integer NOT NULL DEFAULT 3,
  "min_h" integer NOT NULL DEFAULT 2,
  "params_schema" jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS "widgets_library_kpi_idx" ON "widgets_library" ("kpi_code");

INSERT INTO "widgets_library" ("code", "title", "kind", "kpi_code", "category")
SELECT 'kpi.' || k."code", k."name", 'KPI', k."code", k."department" FROM "kpi_definitions" k
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "widgets_library" ("code", "title", "kind", "category", "min_w", "min_h") VALUES
  ('work.my_approvals', 'My approvals', 'COUNTER', 'Work', 3, 2),
  ('work.queue_cards', 'Department queues', 'QUEUE_CARDS', 'Work', 12, 2),
  ('work.approvals_by_age', 'Pending approvals by age', 'CHART_BAR', 'Work', 6, 3),
  ('work.open_exceptions', 'Open approvals', 'LIST', 'Work', 6, 3),
  ('plant.compare_grid', 'Plant comparison', 'TABLE', 'Plants', 12, 4)
ON CONFLICT ("code") DO NOTHING;

-- 4. Dashboards (Phase 19 table): kind, grid layout, who may open it, TV switch.
ALTER TABLE "dashboards" ADD COLUMN IF NOT EXISTS "kind" varchar(12) NOT NULL DEFAULT 'DEPARTMENT'
  CHECK ("kind" IN ('MY','DEPARTMENT','PLANT','OWNER','MODULE','CUSTOM'));
ALTER TABLE "dashboards" ADD COLUMN IF NOT EXISTS "shared_with_roles" text[] NOT NULL DEFAULT '{}';
ALTER TABLE "dashboards" ADD COLUMN IF NOT EXISTS "tv_enabled" boolean NOT NULL DEFAULT false;
ALTER TABLE "dashboards" ADD COLUMN IF NOT EXISTS "refresh_seconds" integer NOT NULL DEFAULT 300;

-- personal changes over a role / department default; "Reset to default" deletes the row
CREATE TABLE IF NOT EXISTS "user_dashboard_overrides" (
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "dashboard_key" varchar(80) NOT NULL,
  "layout" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  PRIMARY KEY ("user_id", "dashboard_key")
);

-- 5. Alert rules and what they raised.
CREATE TABLE IF NOT EXISTS "kpi_alert_rules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "kpi_code" varchar(50) NOT NULL REFERENCES "kpi_definitions"("code") ON DELETE CASCADE,
  "unit_id" uuid REFERENCES "units"("id") ON DELETE CASCADE,
  "condition" varchar(12) NOT NULL CHECK ("condition" IN ('GT','LT','BELOW_TARGET','ABOVE_TARGET')),
  "threshold" numeric(18,4),
  "recipient_role_ids" uuid[] NOT NULL DEFAULT '{}',
  "recipient_user_ids" uuid[] NOT NULL DEFAULT '{}',
  "channels" text[] NOT NULL DEFAULT '{in_app}',
  "cooldown_hours" integer NOT NULL DEFAULT 24 CHECK ("cooldown_hours" >= 1),
  "active" boolean NOT NULL DEFAULT true,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  CHECK (("condition" IN ('GT','LT') AND "threshold" IS NOT NULL) OR "condition" IN ('BELOW_TARGET','ABOVE_TARGET'))
);
CREATE INDEX IF NOT EXISTS "kpi_alert_rules_kpi_idx" ON "kpi_alert_rules" ("kpi_code");
CREATE INDEX IF NOT EXISTS "kpi_alert_rules_unit_idx" ON "kpi_alert_rules" ("unit_id");
CREATE INDEX IF NOT EXISTS "kpi_alert_rules_created_by_idx" ON "kpi_alert_rules" ("created_by");

CREATE TABLE IF NOT EXISTS "kpi_alert_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "rule_id" uuid NOT NULL REFERENCES "kpi_alert_rules"("id") ON DELETE CASCADE,
  "unit_id" uuid REFERENCES "units"("id") ON DELETE SET NULL,
  "value" numeric(18,4),
  "threshold" numeric(18,4),
  "raised_at" timestamptz(3) NOT NULL DEFAULT now(),
  "delivered" integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS "kpi_alert_events_rule_idx" ON "kpi_alert_events" ("rule_id", "raised_at" DESC);
CREATE INDEX IF NOT EXISTS "kpi_alert_events_unit_idx" ON "kpi_alert_events" ("unit_id");

-- 6. Scheduled dashboard emails. Each recipient gets the dashboard in THEIR plants and scope, never wider.
CREATE TABLE IF NOT EXISTS "dashboard_schedules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "dashboard_key" varchar(80) NOT NULL,
  "name" varchar(120) NOT NULL,
  "cron_expr" varchar(60) NOT NULL,
  "recipient_user_ids" uuid[] NOT NULL DEFAULT '{}',
  "active" boolean NOT NULL DEFAULT true,
  "last_run_at" timestamptz(3),
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "dashboard_schedules_created_by_idx" ON "dashboard_schedules" ("created_by");

-- 7. TV mode: a read-only signed link per dashboard; only the hash is stored, links expire and can be rotated.
CREATE TABLE IF NOT EXISTS "dashboard_tv_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "dashboard_key" varchar(80) NOT NULL,
  "unit_id" uuid REFERENCES "units"("id") ON DELETE CASCADE,
  "token_hash" varchar(64) NOT NULL UNIQUE,
  "expires_at" timestamptz(3) NOT NULL,
  "revoked_at" timestamptz(3),
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "dashboard_tv_tokens_created_by_idx" ON "dashboard_tv_tokens" ("created_by");
CREATE INDEX IF NOT EXISTS "dashboard_tv_tokens_unit_idx" ON "dashboard_tv_tokens" ("unit_id");

-- 8. Notification type for KPI alerts (delivery through Phase 21).
INSERT INTO "notification_types"
  ("code", "module", "category", "label", "label_hi", "priority", "enabled",
   "allowed_channels", "default_channels", "mandatory_channels", "sensitive",
   "title_tpl", "body_tpl", "deep_link_tpl", "collapse_key_tpl", "digest_allowed")
VALUES
  ('kpi.alert', 'Dashboards', 'ALERT', 'KPI alert', 'केपीआई अलर्ट',
   'HIGH', true, ARRAY['IN_APP','EMAIL','PUSH'], ARRAY['IN_APP'], ARRAY['IN_APP'], false,
   '{{title}}', '{{body}}', '/m/kpi-alerts', 'kpi:{{entityId}}', false)
ON CONFLICT ("code") DO NOTHING;
