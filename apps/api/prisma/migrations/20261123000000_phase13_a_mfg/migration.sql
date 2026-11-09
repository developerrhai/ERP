-- Phase 13 / A: Manufacturing. Work centres, BOM and routing (versioned), production orders with their materials and
-- operations, the operation log, scrap and rework registers, final-inspection lots, MRP runs, the daily line-planning board
-- and the job-work registers. Forward-only. Stock and ledger postings go through the Phase 8 StockService; nothing here
-- changes a stock or GL table. Customer-supplied material stays in the Phase 8 non-valued customer-material ledger; the flag
-- on the item only tells MRP and the order which components come from the customer.

ALTER TABLE "items" ADD COLUMN "is_customer_supplied" boolean NOT NULL DEFAULT false;

-- ------------------------------------------------------------------ work centres
CREATE TABLE "mfg_work_centres" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "code" varchar(30) NOT NULL,
  "name" varchar(120) NOT NULL,
  "kind" varchar(12) NOT NULL DEFAULT 'MACHINE',
  "capacity_hours" numeric(6,2) NOT NULL DEFAULT 8,
  "cost_per_hour" numeric(18,2) NOT NULL DEFAULT 0,
  "status" varchar(10) NOT NULL DEFAULT 'ACTIVE',
  "notes" varchar(300),
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "deleted_at" timestamptz(3),
  "deleted_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "mfg_wc_kind_chk" CHECK ("kind" IN ('MACHINE','LINE','MANUAL','OUTSIDE')),
  CONSTRAINT "mfg_wc_status_chk" CHECK ("status" IN ('ACTIVE','INACTIVE')),
  CONSTRAINT "mfg_wc_cap_chk" CHECK ("capacity_hours" > 0 AND "capacity_hours" <= 24),
  CONSTRAINT "mfg_wc_cost_chk" CHECK ("cost_per_hour" >= 0)
);
CREATE UNIQUE INDEX "mfg_wc_code_uq" ON "mfg_work_centres"("unit_id","code") WHERE "deleted_at" IS NULL;
CREATE INDEX "mfg_wc_created_by_idx" ON "mfg_work_centres"("created_by_id");
CREATE INDEX "mfg_wc_updated_by_idx" ON "mfg_work_centres"("updated_by_id");
CREATE INDEX "mfg_wc_deleted_by_idx" ON "mfg_work_centres"("deleted_by_id");

-- ------------------------------------------------------------------ bill of materials (versioned)
CREATE TABLE "mfg_boms" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "fy_id" uuid NOT NULL REFERENCES "financial_years"("id") ON DELETE RESTRICT,
  "number" varchar(40),
  "item_id" uuid NOT NULL REFERENCES "items"("id") ON DELETE RESTRICT,
  "version_no" integer NOT NULL DEFAULT 1,
  "status" varchar(10) NOT NULL DEFAULT 'DRAFT',
  "base_qty" numeric(18,3) NOT NULL DEFAULT 1,
  "notes" varchar(300),
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "deleted_at" timestamptz(3),
  "deleted_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "mfg_bom_status_chk" CHECK ("status" IN ('DRAFT','ACTIVE','RETIRED')),
  CONSTRAINT "mfg_bom_base_chk" CHECK ("base_qty" > 0)
);
CREATE UNIQUE INDEX "mfg_bom_number_uq" ON "mfg_boms"("unit_id","fy_id","number") WHERE "number" IS NOT NULL;
CREATE UNIQUE INDEX "mfg_bom_version_uq" ON "mfg_boms"("unit_id","item_id","version_no") WHERE "deleted_at" IS NULL;
CREATE UNIQUE INDEX "mfg_bom_active_uq" ON "mfg_boms"("unit_id","item_id") WHERE "status" = 'ACTIVE' AND "deleted_at" IS NULL;
CREATE INDEX "mfg_bom_fy_idx" ON "mfg_boms"("fy_id");
CREATE INDEX "mfg_bom_item_idx" ON "mfg_boms"("item_id");
CREATE INDEX "mfg_bom_created_by_idx" ON "mfg_boms"("created_by_id");
CREATE INDEX "mfg_bom_updated_by_idx" ON "mfg_boms"("updated_by_id");
CREATE INDEX "mfg_bom_deleted_by_idx" ON "mfg_boms"("deleted_by_id");

CREATE TABLE "mfg_bom_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "bom_id" uuid NOT NULL REFERENCES "mfg_boms"("id") ON DELETE CASCADE,
  "line_no" integer NOT NULL,
  "item_id" uuid NOT NULL REFERENCES "items"("id") ON DELETE RESTRICT,
  "qty_per" numeric(18,6) NOT NULL,
  "scrap_pct" numeric(7,4) NOT NULL DEFAULT 0,
  "notes" varchar(200),
  CONSTRAINT "mfg_bomline_qty_chk" CHECK ("qty_per" > 0),
  CONSTRAINT "mfg_bomline_scrap_chk" CHECK ("scrap_pct" >= 0 AND "scrap_pct" < 100)
);
CREATE UNIQUE INDEX "mfg_bomline_no_uq" ON "mfg_bom_lines"("bom_id","line_no");
CREATE UNIQUE INDEX "mfg_bomline_item_uq" ON "mfg_bom_lines"("bom_id","item_id");
CREATE INDEX "mfg_bomline_item_idx" ON "mfg_bom_lines"("item_id");

-- ------------------------------------------------------------------ routing (versioned)
CREATE TABLE "mfg_routings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "fy_id" uuid NOT NULL REFERENCES "financial_years"("id") ON DELETE RESTRICT,
  "number" varchar(40),
  "item_id" uuid NOT NULL REFERENCES "items"("id") ON DELETE RESTRICT,
  "version_no" integer NOT NULL DEFAULT 1,
  "status" varchar(10) NOT NULL DEFAULT 'DRAFT',
  "notes" varchar(300),
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "deleted_at" timestamptz(3),
  "deleted_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "mfg_rt_status_chk" CHECK ("status" IN ('DRAFT','ACTIVE','RETIRED'))
);
CREATE UNIQUE INDEX "mfg_rt_number_uq" ON "mfg_routings"("unit_id","fy_id","number") WHERE "number" IS NOT NULL;
CREATE UNIQUE INDEX "mfg_rt_version_uq" ON "mfg_routings"("unit_id","item_id","version_no") WHERE "deleted_at" IS NULL;
CREATE UNIQUE INDEX "mfg_rt_active_uq" ON "mfg_routings"("unit_id","item_id") WHERE "status" = 'ACTIVE' AND "deleted_at" IS NULL;
CREATE INDEX "mfg_rt_fy_idx" ON "mfg_routings"("fy_id");
CREATE INDEX "mfg_rt_item_idx" ON "mfg_routings"("item_id");
CREATE INDEX "mfg_rt_created_by_idx" ON "mfg_routings"("created_by_id");
CREATE INDEX "mfg_rt_updated_by_idx" ON "mfg_routings"("updated_by_id");
CREATE INDEX "mfg_rt_deleted_by_idx" ON "mfg_routings"("deleted_by_id");

CREATE TABLE "mfg_routing_ops" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "routing_id" uuid NOT NULL REFERENCES "mfg_routings"("id") ON DELETE CASCADE,
  "seq" integer NOT NULL,
  "name" varchar(120) NOT NULL,
  "work_centre_id" uuid NOT NULL REFERENCES "mfg_work_centres"("id") ON DELETE RESTRICT,
  "setup_minutes" numeric(10,2) NOT NULL DEFAULT 0,
  "run_minutes" numeric(10,4) NOT NULL DEFAULT 0,
  "inspection_required" boolean NOT NULL DEFAULT false,
  CONSTRAINT "mfg_rtop_seq_chk" CHECK ("seq" > 0),
  CONSTRAINT "mfg_rtop_min_chk" CHECK ("setup_minutes" >= 0 AND "run_minutes" >= 0)
);
CREATE UNIQUE INDEX "mfg_rtop_seq_uq" ON "mfg_routing_ops"("routing_id","seq");
CREATE INDEX "mfg_rtop_wc_idx" ON "mfg_routing_ops"("work_centre_id");

-- ------------------------------------------------------------------ production orders
CREATE TABLE "mfg_orders" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "fy_id" uuid NOT NULL REFERENCES "financial_years"("id") ON DELETE RESTRICT,
  "number" varchar(40),
  "status" varchar(12) NOT NULL DEFAULT 'Planned',
  "item_id" uuid NOT NULL REFERENCES "items"("id") ON DELETE RESTRICT,
  "bom_id" uuid NOT NULL REFERENCES "mfg_boms"("id") ON DELETE RESTRICT,
  "routing_id" uuid REFERENCES "mfg_routings"("id") ON DELETE RESTRICT,
  "qty" numeric(18,3) NOT NULL,
  "start_date" date,
  "due_date" date NOT NULL,
  "source_type" varchar(20) NOT NULL DEFAULT 'MANUAL',
  "source_id" uuid,
  "customer_id" uuid REFERENCES "customers"("id") ON DELETE RESTRICT,
  "customer_po_no" varchar(60),
  "warehouse_id" uuid NOT NULL REFERENCES "warehouses"("id") ON DELETE RESTRICT,
  "rm_warehouse_id" uuid NOT NULL REFERENCES "warehouses"("id") ON DELETE RESTRICT,
  "qty_completed" numeric(18,3) NOT NULL DEFAULT 0,
  "qty_scrapped" numeric(18,3) NOT NULL DEFAULT 0,
  "qty_received" numeric(18,3) NOT NULL DEFAULT 0,
  "released_at" timestamptz(3),
  "closed_at" timestamptz(3),
  "close_note" varchar(300),
  "notes" varchar(300),
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "deleted_at" timestamptz(3),
  "deleted_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "mfg_ord_status_chk" CHECK ("status" IN ('Planned','Released','In Progress','Completed','Closed','Cancelled')),
  CONSTRAINT "mfg_ord_source_chk" CHECK ("source_type" IN ('MANUAL','SALES_ORDER','MRP')),
  CONSTRAINT "mfg_ord_qty_chk" CHECK ("qty" > 0 AND "qty_completed" >= 0 AND "qty_scrapped" >= 0 AND "qty_received" >= 0 AND "qty_received" <= "qty_completed")
);
CREATE UNIQUE INDEX "mfg_ord_number_uq" ON "mfg_orders"("unit_id","fy_id","number") WHERE "number" IS NOT NULL;
CREATE INDEX "mfg_ord_unit_idx" ON "mfg_orders"("unit_id","status","due_date");
CREATE INDEX "mfg_ord_fy_idx" ON "mfg_orders"("fy_id");
CREATE INDEX "mfg_ord_item_idx" ON "mfg_orders"("item_id");
CREATE INDEX "mfg_ord_bom_idx" ON "mfg_orders"("bom_id");
CREATE INDEX "mfg_ord_routing_idx" ON "mfg_orders"("routing_id");
CREATE INDEX "mfg_ord_customer_idx" ON "mfg_orders"("customer_id");
CREATE INDEX "mfg_ord_wh_idx" ON "mfg_orders"("warehouse_id");
CREATE INDEX "mfg_ord_rmwh_idx" ON "mfg_orders"("rm_warehouse_id");
CREATE INDEX "mfg_ord_created_by_idx" ON "mfg_orders"("created_by_id");
CREATE INDEX "mfg_ord_updated_by_idx" ON "mfg_orders"("updated_by_id");
CREATE INDEX "mfg_ord_deleted_by_idx" ON "mfg_orders"("deleted_by_id");

CREATE TABLE "mfg_order_materials" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "order_id" uuid NOT NULL REFERENCES "mfg_orders"("id") ON DELETE CASCADE,
  "line_no" integer NOT NULL,
  "item_id" uuid NOT NULL REFERENCES "items"("id") ON DELETE RESTRICT,
  "required_qty" numeric(18,3) NOT NULL,
  "issued_qty" numeric(18,3) NOT NULL DEFAULT 0,
  "returned_qty" numeric(18,3) NOT NULL DEFAULT 0,
  "issued_value" numeric(18,2) NOT NULL DEFAULT 0,
  "returned_value" numeric(18,2) NOT NULL DEFAULT 0,
  "customer_supplied" boolean NOT NULL DEFAULT false,
  CONSTRAINT "mfg_om_qty_chk" CHECK ("required_qty" >= 0 AND "issued_qty" >= 0 AND "returned_qty" >= 0 AND "returned_qty" <= "issued_qty")
);
CREATE UNIQUE INDEX "mfg_om_no_uq" ON "mfg_order_materials"("order_id","line_no");
CREATE INDEX "mfg_om_item_idx" ON "mfg_order_materials"("item_id");

CREATE TABLE "mfg_order_ops" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "order_id" uuid NOT NULL REFERENCES "mfg_orders"("id") ON DELETE CASCADE,
  "seq" integer NOT NULL,
  "name" varchar(120) NOT NULL,
  "work_centre_id" uuid NOT NULL REFERENCES "mfg_work_centres"("id") ON DELETE RESTRICT,
  "setup_minutes" numeric(10,2) NOT NULL DEFAULT 0,
  "run_minutes" numeric(10,4) NOT NULL DEFAULT 0,
  "inspection_required" boolean NOT NULL DEFAULT false,
  "status" varchar(12) NOT NULL DEFAULT 'Pending',
  "qty_done" numeric(18,3) NOT NULL DEFAULT 0,
  "qty_scrap" numeric(18,3) NOT NULL DEFAULT 0,
  "qty_rework" numeric(18,3) NOT NULL DEFAULT 0,
  "actual_minutes" numeric(12,2) NOT NULL DEFAULT 0,
  "inspection_id" uuid REFERENCES "qms_inspections"("id") ON DELETE SET NULL,
  "started_at" timestamptz(3),
  "completed_at" timestamptz(3),
  CONSTRAINT "mfg_oop_status_chk" CHECK ("status" IN ('Pending','In Progress','Done')),
  CONSTRAINT "mfg_oop_qty_chk" CHECK ("qty_done" >= 0 AND "qty_scrap" >= 0 AND "qty_rework" >= 0 AND "actual_minutes" >= 0)
);
CREATE UNIQUE INDEX "mfg_oop_seq_uq" ON "mfg_order_ops"("order_id","seq");
CREATE INDEX "mfg_oop_wc_idx" ON "mfg_order_ops"("work_centre_id");
CREATE INDEX "mfg_oop_insp_idx" ON "mfg_order_ops"("inspection_id");

CREATE TABLE "mfg_op_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "order_id" uuid NOT NULL REFERENCES "mfg_orders"("id") ON DELETE CASCADE,
  "op_id" uuid NOT NULL REFERENCES "mfg_order_ops"("id") ON DELETE CASCADE,
  "log_date" date NOT NULL DEFAULT CURRENT_DATE,
  "operator" varchar(80),
  "qty_good" numeric(18,3) NOT NULL DEFAULT 0,
  "qty_scrap" numeric(18,3) NOT NULL DEFAULT 0,
  "qty_rework" numeric(18,3) NOT NULL DEFAULT 0,
  "minutes" numeric(10,2) NOT NULL DEFAULT 0,
  "note" varchar(200),
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "mfg_log_qty_chk" CHECK ("qty_good" >= 0 AND "qty_scrap" >= 0 AND "qty_rework" >= 0 AND "minutes" >= 0 AND ("qty_good" + "qty_scrap" + "qty_rework" + "minutes") > 0)
);
CREATE INDEX "mfg_log_unit_idx" ON "mfg_op_logs"("unit_id","log_date");
CREATE INDEX "mfg_log_order_idx" ON "mfg_op_logs"("order_id");
CREATE INDEX "mfg_log_op_idx" ON "mfg_op_logs"("op_id");
CREATE INDEX "mfg_log_created_by_idx" ON "mfg_op_logs"("created_by_id");

-- ------------------------------------------------------------------ scrap and rework registers
CREATE TABLE "mfg_scrap" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "fy_id" uuid NOT NULL REFERENCES "financial_years"("id") ON DELETE RESTRICT,
  "number" varchar(40),
  "scrap_date" date NOT NULL DEFAULT CURRENT_DATE,
  "order_id" uuid NOT NULL REFERENCES "mfg_orders"("id") ON DELETE RESTRICT,
  "op_id" uuid REFERENCES "mfg_order_ops"("id") ON DELETE SET NULL,
  "item_id" uuid NOT NULL REFERENCES "items"("id") ON DELETE RESTRICT,
  "qty" numeric(18,3) NOT NULL,
  "reason" varchar(200) NOT NULL,
  "source" varchar(12) NOT NULL DEFAULT 'OPERATION',
  "rejection_id" uuid REFERENCES "qms_rejections"("id") ON DELETE SET NULL,
  "status" varchar(10) NOT NULL DEFAULT 'Recorded',
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "deleted_at" timestamptz(3),
  "deleted_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "mfg_scrap_qty_chk" CHECK ("qty" > 0),
  CONSTRAINT "mfg_scrap_source_chk" CHECK ("source" IN ('OPERATION','REWORK')),
  CONSTRAINT "mfg_scrap_status_chk" CHECK ("status" IN ('Recorded','Cancelled'))
);
CREATE UNIQUE INDEX "mfg_scrap_number_uq" ON "mfg_scrap"("unit_id","fy_id","number") WHERE "number" IS NOT NULL;
CREATE INDEX "mfg_scrap_unit_idx" ON "mfg_scrap"("unit_id","scrap_date");
CREATE INDEX "mfg_scrap_fy_idx" ON "mfg_scrap"("fy_id");
CREATE INDEX "mfg_scrap_order_idx" ON "mfg_scrap"("order_id");
CREATE INDEX "mfg_scrap_op_idx" ON "mfg_scrap"("op_id");
CREATE INDEX "mfg_scrap_item_idx" ON "mfg_scrap"("item_id");
CREATE INDEX "mfg_scrap_rej_idx" ON "mfg_scrap"("rejection_id");
CREATE INDEX "mfg_scrap_created_by_idx" ON "mfg_scrap"("created_by_id");
CREATE INDEX "mfg_scrap_updated_by_idx" ON "mfg_scrap"("updated_by_id");
CREATE INDEX "mfg_scrap_deleted_by_idx" ON "mfg_scrap"("deleted_by_id");

CREATE TABLE "mfg_rework" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "fy_id" uuid NOT NULL REFERENCES "financial_years"("id") ON DELETE RESTRICT,
  "number" varchar(40),
  "rework_date" date NOT NULL DEFAULT CURRENT_DATE,
  "order_id" uuid NOT NULL REFERENCES "mfg_orders"("id") ON DELETE RESTRICT,
  "op_id" uuid NOT NULL REFERENCES "mfg_order_ops"("id") ON DELETE RESTRICT,
  "item_id" uuid NOT NULL REFERENCES "items"("id") ON DELETE RESTRICT,
  "qty" numeric(18,3) NOT NULL,
  "reason" varchar(200) NOT NULL,
  "qty_ok" numeric(18,3) NOT NULL DEFAULT 0,
  "qty_scrap" numeric(18,3) NOT NULL DEFAULT 0,
  "rejection_id" uuid REFERENCES "qms_rejections"("id") ON DELETE SET NULL,
  "status" varchar(10) NOT NULL DEFAULT 'Open',
  "done_at" timestamptz(3),
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "deleted_at" timestamptz(3),
  "deleted_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "mfg_rw_qty_chk" CHECK ("qty" > 0 AND "qty_ok" >= 0 AND "qty_scrap" >= 0 AND "qty_ok" + "qty_scrap" <= "qty"),
  CONSTRAINT "mfg_rw_status_chk" CHECK ("status" IN ('Open','Done','Cancelled'))
);
CREATE UNIQUE INDEX "mfg_rw_number_uq" ON "mfg_rework"("unit_id","fy_id","number") WHERE "number" IS NOT NULL;
CREATE INDEX "mfg_rw_unit_idx" ON "mfg_rework"("unit_id","rework_date");
CREATE INDEX "mfg_rw_fy_idx" ON "mfg_rework"("fy_id");
CREATE INDEX "mfg_rw_order_idx" ON "mfg_rework"("order_id");
CREATE INDEX "mfg_rw_op_idx" ON "mfg_rework"("op_id");
CREATE INDEX "mfg_rw_item_idx" ON "mfg_rework"("item_id");
CREATE INDEX "mfg_rw_rej_idx" ON "mfg_rework"("rejection_id");
CREATE INDEX "mfg_rw_created_by_idx" ON "mfg_rework"("created_by_id");
CREATE INDEX "mfg_rw_updated_by_idx" ON "mfg_rework"("updated_by_id");
CREATE INDEX "mfg_rw_deleted_by_idx" ON "mfg_rework"("deleted_by_id");

-- ------------------------------------------------------------------ final inspection lots (one sheet per lot)
CREATE TABLE "mfg_fg_lots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "order_id" uuid NOT NULL REFERENCES "mfg_orders"("id") ON DELETE CASCADE,
  "lot_no" integer NOT NULL,
  "lot_qty" numeric(18,3) NOT NULL,
  "inspection_id" uuid NOT NULL REFERENCES "qms_inspections"("id") ON DELETE RESTRICT,
  "received_qty" numeric(18,3) NOT NULL DEFAULT 0,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "mfg_lot_qty_chk" CHECK ("lot_qty" > 0 AND "received_qty" >= 0 AND "received_qty" <= "lot_qty")
);
CREATE UNIQUE INDEX "mfg_lot_no_uq" ON "mfg_fg_lots"("order_id","lot_no");
CREATE UNIQUE INDEX "mfg_lot_insp_uq" ON "mfg_fg_lots"("inspection_id");
CREATE INDEX "mfg_lot_unit_idx" ON "mfg_fg_lots"("unit_id");
CREATE INDEX "mfg_lot_created_by_idx" ON "mfg_fg_lots"("created_by_id");

-- ------------------------------------------------------------------ MRP
CREATE TABLE "mfg_mrp_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "fy_id" uuid NOT NULL REFERENCES "financial_years"("id") ON DELETE RESTRICT,
  "number" varchar(40),
  "from_date" date NOT NULL,
  "to_date" date NOT NULL,
  "include_forecast" boolean NOT NULL DEFAULT true,
  "status" varchar(10) NOT NULL DEFAULT 'Draft',
  "pr_id" uuid REFERENCES "purchase_requisitions"("id") ON DELETE SET NULL,
  "applied_at" timestamptz(3),
  "applied_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "notes" varchar(300),
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "deleted_at" timestamptz(3),
  "deleted_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "mfg_mrp_status_chk" CHECK ("status" IN ('Draft','Applied','Cancelled')),
  CONSTRAINT "mfg_mrp_dates_chk" CHECK ("to_date" >= "from_date")
);
CREATE UNIQUE INDEX "mfg_mrp_number_uq" ON "mfg_mrp_runs"("unit_id","fy_id","number") WHERE "number" IS NOT NULL;
CREATE INDEX "mfg_mrp_unit_idx" ON "mfg_mrp_runs"("unit_id","created_at");
CREATE INDEX "mfg_mrp_fy_idx" ON "mfg_mrp_runs"("fy_id");
CREATE INDEX "mfg_mrp_pr_idx" ON "mfg_mrp_runs"("pr_id");
CREATE INDEX "mfg_mrp_applied_by_idx" ON "mfg_mrp_runs"("applied_by_id");
CREATE INDEX "mfg_mrp_created_by_idx" ON "mfg_mrp_runs"("created_by_id");
CREATE INDEX "mfg_mrp_updated_by_idx" ON "mfg_mrp_runs"("updated_by_id");
CREATE INDEX "mfg_mrp_deleted_by_idx" ON "mfg_mrp_runs"("deleted_by_id");

CREATE TABLE "mfg_mrp_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "run_id" uuid NOT NULL REFERENCES "mfg_mrp_runs"("id") ON DELETE CASCADE,
  "item_id" uuid NOT NULL REFERENCES "items"("id") ON DELETE RESTRICT,
  "level" integer NOT NULL DEFAULT 0,
  "action" varchar(10) NOT NULL,
  "gross_qty" numeric(18,3) NOT NULL DEFAULT 0,
  "on_hand_qty" numeric(18,3) NOT NULL DEFAULT 0,
  "scheduled_qty" numeric(18,3) NOT NULL DEFAULT 0,
  "net_qty" numeric(18,3) NOT NULL DEFAULT 0,
  "need_date" date,
  "sources" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "order_id" uuid REFERENCES "mfg_orders"("id") ON DELETE SET NULL,
  CONSTRAINT "mfg_mrpl_action_chk" CHECK ("action" IN ('PRODUCE','BUY','NONE','CUSTOMER'))
);
CREATE INDEX "mfg_mrpl_run_idx" ON "mfg_mrp_lines"("run_id");
CREATE INDEX "mfg_mrpl_item_idx" ON "mfg_mrp_lines"("item_id");
CREATE INDEX "mfg_mrpl_order_idx" ON "mfg_mrp_lines"("order_id");

-- ------------------------------------------------------------------ daily board / line planning
CREATE TABLE "mfg_plan_days" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "plan_date" date NOT NULL,
  "order_id" uuid REFERENCES "mfg_orders"("id") ON DELETE SET NULL,
  "item_id" uuid REFERENCES "items"("id") ON DELETE RESTRICT,
  "customer_po_no" varchar(60),
  "delivery_date" date,
  "line_qty" numeric(18,3) NOT NULL DEFAULT 0,
  "unit2_qty" numeric(18,3) NOT NULL DEFAULT 0,
  "coating_qty" numeric(18,3) NOT NULL DEFAULT 0,
  "dispatch_qty" numeric(18,3) NOT NULL DEFAULT 0,
  "owner_line" varchar(80),
  "owner_unit2" varchar(80),
  "owner_coating" varchar(80),
  "owner_dispatch" varchar(80),
  "remark" varchar(300),
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "deleted_at" timestamptz(3),
  "deleted_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "mfg_pd_qty_chk" CHECK ("line_qty" >= 0 AND "unit2_qty" >= 0 AND "coating_qty" >= 0 AND "dispatch_qty" >= 0)
);
CREATE INDEX "mfg_pd_unit_idx" ON "mfg_plan_days"("unit_id","plan_date");
CREATE INDEX "mfg_pd_order_idx" ON "mfg_plan_days"("order_id");
CREATE INDEX "mfg_pd_item_idx" ON "mfg_plan_days"("item_id");
CREATE INDEX "mfg_pd_created_by_idx" ON "mfg_plan_days"("created_by_id");
CREATE INDEX "mfg_pd_updated_by_idx" ON "mfg_plan_days"("updated_by_id");
CREATE INDEX "mfg_pd_deleted_by_idx" ON "mfg_plan_days"("deleted_by_id");

-- ------------------------------------------------------------------ job work: registers per customer PO line
CREATE TABLE "mfg_jw_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "customer_id" uuid NOT NULL REFERENCES "customers"("id") ON DELETE RESTRICT,
  "customer_po_no" varchar(60) NOT NULL,
  "po_line_no" integer NOT NULL DEFAULT 1,
  "item_id" uuid REFERENCES "items"("id") ON DELETE RESTRICT,
  "part" varchar(150) NOT NULL,
  "po_qty" numeric(18,3) NOT NULL,
  "uom" varchar(20) NOT NULL,
  "status" varchar(10) NOT NULL DEFAULT 'Open',
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "deleted_at" timestamptz(3),
  "deleted_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "mfg_jwl_qty_chk" CHECK ("po_qty" > 0),
  CONSTRAINT "mfg_jwl_status_chk" CHECK ("status" IN ('Open','Closed'))
);
CREATE UNIQUE INDEX "mfg_jwl_po_uq" ON "mfg_jw_lines"("unit_id","customer_id","customer_po_no","po_line_no") WHERE "deleted_at" IS NULL;
CREATE INDEX "mfg_jwl_customer_idx" ON "mfg_jw_lines"("customer_id");
CREATE INDEX "mfg_jwl_item_idx" ON "mfg_jw_lines"("item_id");
CREATE INDEX "mfg_jwl_created_by_idx" ON "mfg_jw_lines"("created_by_id");
CREATE INDEX "mfg_jwl_updated_by_idx" ON "mfg_jw_lines"("updated_by_id");
CREATE INDEX "mfg_jwl_deleted_by_idx" ON "mfg_jw_lines"("deleted_by_id");

CREATE TABLE "mfg_jw_moves" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "jw_line_id" uuid NOT NULL REFERENCES "mfg_jw_lines"("id") ON DELETE CASCADE,
  "direction" varchar(8) NOT NULL,
  "move_date" date NOT NULL DEFAULT CURRENT_DATE,
  "qty" numeric(18,3) NOT NULL,
  "doc_no" varchar(60),
  "remark" varchar(200),
  "status" varchar(10) NOT NULL DEFAULT 'Posted',
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "mfg_jwm_dir_chk" CHECK ("direction" IN ('INWARD','OUTWARD')),
  CONSTRAINT "mfg_jwm_qty_chk" CHECK ("qty" > 0),
  CONSTRAINT "mfg_jwm_status_chk" CHECK ("status" IN ('Posted','Cancelled'))
);
CREATE INDEX "mfg_jwm_unit_idx" ON "mfg_jw_moves"("unit_id","move_date");
CREATE INDEX "mfg_jwm_line_idx" ON "mfg_jw_moves"("jw_line_id");
CREATE INDEX "mfg_jwm_created_by_idx" ON "mfg_jw_moves"("created_by_id");

-- rework register against the customer's delivery challan
CREATE TABLE "mfg_jw_rework" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "customer_id" uuid NOT NULL REFERENCES "customers"("id") ON DELETE RESTRICT,
  "challan_no" varchar(60) NOT NULL,
  "challan_date" date NOT NULL,
  "item_id" uuid REFERENCES "items"("id") ON DELETE RESTRICT,
  "part" varchar(150) NOT NULL,
  "challan_qty" numeric(18,3) NOT NULL,
  "remark" varchar(200),
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "deleted_at" timestamptz(3),
  "deleted_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "mfg_jwr_qty_chk" CHECK ("challan_qty" > 0)
);
CREATE UNIQUE INDEX "mfg_jwr_uq" ON "mfg_jw_rework"("unit_id","customer_id","challan_no","part") WHERE "deleted_at" IS NULL;
CREATE INDEX "mfg_jwr_customer_idx" ON "mfg_jw_rework"("customer_id");
CREATE INDEX "mfg_jwr_item_idx" ON "mfg_jw_rework"("item_id");
CREATE INDEX "mfg_jwr_created_by_idx" ON "mfg_jw_rework"("created_by_id");
CREATE INDEX "mfg_jwr_updated_by_idx" ON "mfg_jw_rework"("updated_by_id");
CREATE INDEX "mfg_jwr_deleted_by_idx" ON "mfg_jw_rework"("deleted_by_id");

CREATE TABLE "mfg_jw_rework_done" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "rework_id" uuid NOT NULL REFERENCES "mfg_jw_rework"("id") ON DELETE CASCADE,
  "done_date" date NOT NULL DEFAULT CURRENT_DATE,
  "qty" numeric(18,3) NOT NULL,
  "done_challan_no" varchar(60) NOT NULL,
  "status" varchar(10) NOT NULL DEFAULT 'Posted',
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "mfg_jwrd_qty_chk" CHECK ("qty" > 0),
  CONSTRAINT "mfg_jwrd_status_chk" CHECK ("status" IN ('Posted','Cancelled'))
);
CREATE INDEX "mfg_jwrd_rework_idx" ON "mfg_jw_rework_done"("rework_id");
CREATE INDEX "mfg_jwrd_created_by_idx" ON "mfg_jw_rework_done"("created_by_id");
