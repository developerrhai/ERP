-- Phase 13 v2 / C: execution and costing (spec section 4). Production orders get the plan / sales-order links, the over-production
-- tolerance and an approval state; the operations of an order become job cards with time logs and downtime; production receipts
-- carry the QC hold; scrap entries carry normal / abnormal and recovery; rework orders link to the NCR; the cost ledger is the WIP
-- sub-ledger and cost sheets compare standard with actual. Forward-only.

-- ------------------------------------------------------------------ production orders
ALTER TABLE "mfg_orders" DROP CONSTRAINT "mfg_ord_status_chk";
ALTER TABLE "mfg_orders" ADD CONSTRAINT "mfg_ord_status_chk" CHECK ("status" IN ('Planned','Pending Approval','Released','In Progress','Completed','Closed','Cancelled'));
ALTER TABLE "mfg_orders" DROP CONSTRAINT "mfg_ord_source_chk";
ALTER TABLE "mfg_orders" ADD CONSTRAINT "mfg_ord_source_chk" CHECK ("source_type" IN ('MANUAL','SALES_ORDER','MRP','PLAN'));
ALTER TABLE "mfg_orders"
  ADD COLUMN "priority" smallint NOT NULL DEFAULT 5,
  ADD COLUMN "plan_line_id" uuid REFERENCES "mfg_production_plan_lines"("id") ON DELETE SET NULL,
  ADD COLUMN "so_line_id" uuid REFERENCES "sales_order_lines"("id") ON DELETE SET NULL,
  ADD COLUMN "suggestion_id" uuid REFERENCES "mfg_mrp_suggestions"("id") ON DELETE SET NULL,
  ADD COLUMN "wip_wh_id" uuid REFERENCES "warehouses"("id") ON DELETE RESTRICT,
  ADD COLUMN "over_production_pct" numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN "material_status" varchar(12) NOT NULL DEFAULT 'NOT_ISSUED',
  ADD COLUMN "std_value" numeric(18,2),
  ADD COLUMN "qty_rejected" numeric(18,3) NOT NULL DEFAULT 0,
  ADD COLUMN "submitted_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN "approved_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "mfg_orders" ADD CONSTRAINT "mfg_ord_prio_chk" CHECK ("priority" BETWEEN 1 AND 9 AND "over_production_pct" >= 0 AND "over_production_pct" <= 100);
ALTER TABLE "mfg_orders" ADD CONSTRAINT "mfg_ord_matstatus_chk" CHECK ("material_status" IN ('NOT_ISSUED','PARTIAL','ISSUED'));
-- the receipt may exceed the order quantity by the tolerance only
ALTER TABLE "mfg_orders" DROP CONSTRAINT "mfg_ord_qty_chk";
ALTER TABLE "mfg_orders" ADD CONSTRAINT "mfg_ord_qty_chk" CHECK ("qty" > 0 AND "qty_completed" >= 0 AND "qty_scrapped" >= 0 AND "qty_rejected" >= 0 AND "qty_received" >= 0 AND "qty_received" <= "qty_completed");
CREATE INDEX "mfg_ord_planline_idx" ON "mfg_orders"("plan_line_id");
CREATE INDEX "mfg_ord_soline_idx" ON "mfg_orders"("so_line_id");
CREATE INDEX "mfg_ord_sugg_idx" ON "mfg_orders"("suggestion_id");
CREATE INDEX "mfg_ord_wipwh_idx" ON "mfg_orders"("wip_wh_id");
CREATE INDEX "mfg_ord_submitted_by_idx" ON "mfg_orders"("submitted_by_id");
CREATE INDEX "mfg_ord_approved_by_idx" ON "mfg_orders"("approved_by_id");

ALTER TABLE "mfg_order_materials"
  ADD COLUMN "issue_method" varchar(9) NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "operation_seq" integer,
  ADD COLUMN "consumed_qty" numeric(18,3) NOT NULL DEFAULT 0;
ALTER TABLE "mfg_order_materials" ADD CONSTRAINT "mfg_om_issue_chk" CHECK ("issue_method" IN ('MANUAL','BACKFLUSH'));

-- ------------------------------------------------------------------ job cards (one per operation of an order)
ALTER TABLE "mfg_order_ops" DROP CONSTRAINT "mfg_oop_status_chk";
ALTER TABLE "mfg_order_ops" ADD CONSTRAINT "mfg_oop_status_chk" CHECK ("status" IN ('Pending','In Progress','Paused','Done'));
ALTER TABLE "mfg_order_ops"
  ADD COLUMN "planned_qty" numeric(18,3),
  ADD COLUMN "qty_rejected" numeric(18,3) NOT NULL DEFAULT 0,
  ADD COLUMN "queue_min" numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN "move_min" numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN "labour_rate" numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN "overhead_rate" numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN "setup_minutes_actual" numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "run_minutes_actual" numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "absorbed_posted" boolean NOT NULL DEFAULT false;
UPDATE "mfg_order_ops" SET "labour_rate" = "cost_per_hour";
ALTER TABLE "mfg_order_ops" ADD CONSTRAINT "mfg_oop_rej_chk" CHECK ("qty_rejected" >= 0 AND "setup_minutes_actual" >= 0 AND "run_minutes_actual" >= 0 AND "labour_rate" >= 0 AND "overhead_rate" >= 0);

CREATE TABLE "mfg_job_card_time_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "order_id" uuid NOT NULL REFERENCES "mfg_orders"("id") ON DELETE CASCADE,
  "op_id" uuid NOT NULL REFERENCES "mfg_order_ops"("id") ON DELETE CASCADE,
  "from_ts" timestamptz(3) NOT NULL,
  "to_ts" timestamptz(3),
  "kind" varchar(5) NOT NULL,
  "operator_name" varchar(80),
  "good" numeric(18,3) NOT NULL DEFAULT 0,
  "rejected" numeric(18,3) NOT NULL DEFAULT 0,
  "idempotency_key" varchar(80),
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "mfg_tl_kind_chk" CHECK ("kind" IN ('SETUP','RUN')),
  CONSTRAINT "mfg_tl_time_chk" CHECK ("to_ts" IS NULL OR "to_ts" >= "from_ts"),
  CONSTRAINT "mfg_tl_qty_chk" CHECK ("good" >= 0 AND "rejected" >= 0)
);
CREATE UNIQUE INDEX "mfg_tl_idem_uq" ON "mfg_job_card_time_logs"("op_id","idempotency_key") WHERE "idempotency_key" IS NOT NULL;
CREATE INDEX "mfg_tl_unit_idx" ON "mfg_job_card_time_logs"("unit_id","from_ts");
CREATE INDEX "mfg_tl_order_idx" ON "mfg_job_card_time_logs"("order_id");
CREATE INDEX "mfg_tl_op_idx" ON "mfg_job_card_time_logs"("op_id");
CREATE INDEX "mfg_tl_by_idx" ON "mfg_job_card_time_logs"("created_by_id");
-- time logs of one job card cannot overlap
CREATE FUNCTION "mfg_tl_no_overlap"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "mfg_job_card_time_logs" t
     WHERE t."op_id" = NEW."op_id" AND t."id" <> NEW."id"
       AND tstzrange(t."from_ts", COALESCE(t."to_ts", 'infinity'::timestamptz), '[)') && tstzrange(NEW."from_ts", COALESCE(NEW."to_ts", 'infinity'::timestamptz), '[)')
  ) THEN
    RAISE EXCEPTION 'TIME_LOG_OVERLAP' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "mfg_tl_no_overlap_trg" BEFORE INSERT OR UPDATE ON "mfg_job_card_time_logs" FOR EACH ROW EXECUTE FUNCTION "mfg_tl_no_overlap"();

CREATE TABLE "mfg_downtime_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "work_centre_id" uuid NOT NULL REFERENCES "mfg_work_centres"("id") ON DELETE RESTRICT,
  "op_id" uuid REFERENCES "mfg_order_ops"("id") ON DELETE SET NULL,
  "reason_id" uuid NOT NULL REFERENCES "mfg_downtime_reasons"("id") ON DELETE RESTRICT,
  "from_ts" timestamptz(3) NOT NULL,
  "to_ts" timestamptz(3),
  "minutes" numeric(12,2) GENERATED ALWAYS AS (CASE WHEN "to_ts" IS NULL THEN NULL ELSE round((EXTRACT(EPOCH FROM ("to_ts" - "from_ts")) / 60)::numeric, 2) END) STORED,
  "remarks" varchar(200),
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "mfg_dl_time_chk" CHECK ("to_ts" IS NULL OR "to_ts" >= "from_ts")
);
CREATE INDEX "mfg_dl_unit_idx" ON "mfg_downtime_logs"("unit_id","from_ts");
CREATE INDEX "mfg_dl_wc_idx" ON "mfg_downtime_logs"("work_centre_id","from_ts");
CREATE INDEX "mfg_dl_op_idx" ON "mfg_downtime_logs"("op_id");
CREATE INDEX "mfg_dl_reason_idx" ON "mfg_downtime_logs"("reason_id");
CREATE INDEX "mfg_dl_by_idx" ON "mfg_downtime_logs"("created_by_id");

-- stock documents of an order: back-flush is a kind of its own
ALTER TABLE "mfg_order_moves" DROP CONSTRAINT "mfg_move_kind_chk";
ALTER TABLE "mfg_order_moves" ADD CONSTRAINT "mfg_move_kind_chk" CHECK ("kind" IN ('ISSUE','RETURN','FG_RECEIPT','BACKFLUSH','SCRAP_RECOVERY'));
ALTER TABLE "mfg_order_moves" ADD COLUMN "status" varchar(10) NOT NULL DEFAULT 'Posted';
ALTER TABLE "mfg_order_moves" ADD COLUMN "reversal_of_id" uuid REFERENCES "mfg_order_moves"("id") ON DELETE SET NULL;
ALTER TABLE "mfg_order_moves" ADD CONSTRAINT "mfg_move_status_chk" CHECK ("status" IN ('Posted','Cancelled'));
CREATE INDEX "mfg_move_rev_idx" ON "mfg_order_moves"("reversal_of_id");

-- ------------------------------------------------------------------ production receipts (FG), QC hold
CREATE TABLE "mfg_production_receipts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "fy_id" uuid NOT NULL REFERENCES "financial_years"("id") ON DELETE RESTRICT,
  "number" varchar(40),
  "order_id" uuid NOT NULL REFERENCES "mfg_orders"("id") ON DELETE RESTRICT,
  "item_id" uuid NOT NULL REFERENCES "items"("id") ON DELETE RESTRICT,
  "receipt_date" date NOT NULL,
  "qty" numeric(18,3) NOT NULL,
  "batch_no" varchar(60),
  "qc_status" varchar(12) NOT NULL DEFAULT 'NOT_REQUIRED',
  "lot_id" uuid REFERENCES "mfg_lots"("id") ON DELETE SET NULL,
  "qms_inspection_ref" varchar(60),
  "unit_cost" numeric(18,6) NOT NULL DEFAULT 0,
  "amount" numeric(18,2) NOT NULL DEFAULT 0,
  "cost_breakup" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "move_id" uuid REFERENCES "mfg_order_moves"("id") ON DELETE SET NULL,
  "is_final" boolean NOT NULL DEFAULT false,
  "status" varchar(10) NOT NULL DEFAULT 'Posted',
  "cancel_reason" varchar(200),
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "mfg_pr_qc_chk" CHECK ("qc_status" IN ('NOT_REQUIRED','PENDING','ACCEPTED','REJECTED')),
  CONSTRAINT "mfg_pr_status_chk" CHECK ("status" IN ('Posted','Cancelled')),
  CONSTRAINT "mfg_pr_qty_chk" CHECK ("qty" > 0 AND "amount" >= 0)
);
CREATE UNIQUE INDEX "mfg_pr_number_uq" ON "mfg_production_receipts"("unit_id","fy_id","number") WHERE "number" IS NOT NULL;
CREATE INDEX "mfg_pr_unit_idx" ON "mfg_production_receipts"("unit_id","receipt_date");
CREATE INDEX "mfg_pr_fy_idx" ON "mfg_production_receipts"("fy_id");
CREATE INDEX "mfg_pr_order_idx" ON "mfg_production_receipts"("order_id");
CREATE INDEX "mfg_pr_item_idx" ON "mfg_production_receipts"("item_id");
CREATE INDEX "mfg_pr_lot_idx" ON "mfg_production_receipts"("lot_id");
CREATE INDEX "mfg_pr_move_idx" ON "mfg_production_receipts"("move_id");
CREATE INDEX "mfg_pr_by_idx" ON "mfg_production_receipts"("created_by_id");
ALTER TABLE "mfg_lots" ADD COLUMN "receipt_id" uuid REFERENCES "mfg_production_receipts"("id") ON DELETE SET NULL;
CREATE INDEX "mfg_lot_receipt_idx" ON "mfg_lots"("receipt_id");

-- ------------------------------------------------------------------ scrap entries and rework orders
ALTER TABLE "mfg_scrap" DROP CONSTRAINT "mfg_scrap_status_chk";
UPDATE "mfg_scrap" SET "status" = 'Submitted' WHERE "status" = 'Recorded';
ALTER TABLE "mfg_scrap" ADD CONSTRAINT "mfg_scrap_status_chk" CHECK ("status" IN ('Draft','Submitted','Cancelled'));
ALTER TABLE "mfg_scrap" ALTER COLUMN "status" SET DEFAULT 'Draft';
ALTER TABLE "mfg_scrap"
  ADD COLUMN "is_normal" boolean NOT NULL DEFAULT false,
  ADD COLUMN "recoverable_qty" numeric(18,3) NOT NULL DEFAULT 0,
  ADD COLUMN "recovery_item_id" uuid REFERENCES "items"("id") ON DELETE RESTRICT,
  ADD COLUMN "recovery_value" numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN "disposal_method" varchar(30),
  ADD COLUMN "loss_value" numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN "reason_id" uuid REFERENCES "mfg_scrap_reasons"("id") ON DELETE RESTRICT,
  ADD COLUMN "journal_id" uuid REFERENCES "journals"("id") ON DELETE SET NULL,
  ADD COLUMN "approved_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL;
UPDATE "mfg_scrap" SET "is_normal" = true;
ALTER TABLE "mfg_scrap" ADD CONSTRAINT "mfg_scrap_rec_chk" CHECK ("recoverable_qty" >= 0 AND "recoverable_qty" <= "qty" AND "recovery_value" >= 0 AND "loss_value" >= 0);
CREATE INDEX "mfg_scrap_recitem_idx" ON "mfg_scrap"("recovery_item_id");
CREATE INDEX "mfg_scrap_reason_idx" ON "mfg_scrap"("reason_id");
CREATE INDEX "mfg_scrap_journal_idx" ON "mfg_scrap"("journal_id");
CREATE INDEX "mfg_scrap_approved_by_idx" ON "mfg_scrap"("approved_by_id");

ALTER TABLE "mfg_rework"
  ADD COLUMN "source_ncr_ref" varchar(60),
  ADD COLUMN "labour_hrs" numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN "material_cost" numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN "reinspection_result" varchar(12),
  ADD COLUMN "released_at" timestamptz(3);
ALTER TABLE "mfg_rework" ADD CONSTRAINT "mfg_rw_reinsp_chk" CHECK ("reinspection_result" IS NULL OR "reinspection_result" IN ('ACCEPTED','REJECTED','PENDING'));

-- ------------------------------------------------------------------ costing: the WIP sub-ledger and the cost sheet
CREATE TABLE "mfg_cost_ledger" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "order_id" uuid NOT NULL REFERENCES "mfg_orders"("id") ON DELETE RESTRICT,
  "event" varchar(20) NOT NULL,
  "element" varchar(10) NOT NULL,
  "amount" numeric(18,2) NOT NULL,
  "journal_id" uuid REFERENCES "journals"("id") ON DELETE SET NULL,
  "ref_type" varchar(20),
  "ref_id" uuid,
  "posted_on" date NOT NULL,
  "reversal_of_id" uuid REFERENCES "mfg_cost_ledger"("id") ON DELETE SET NULL,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "mfg_cl_element_chk" CHECK ("element" IN ('MATERIAL','LABOUR','OVERHEAD','SCRAP','FG')),
  CONSTRAINT "mfg_cl_event_chk" CHECK ("event" IN ('ISSUE','RETURN','BACKFLUSH','LABOUR','OVERHEAD','ABNORMAL_SCRAP','RECOVERY','FG_RECEIPT','SCRAP_LOSS_CLOSE','REVERSAL'))
);
CREATE INDEX "mfg_cl_order_idx" ON "mfg_cost_ledger"("order_id");
CREATE INDEX "mfg_cl_unit_idx" ON "mfg_cost_ledger"("unit_id","posted_on");
CREATE INDEX "mfg_cl_journal_idx" ON "mfg_cost_ledger"("journal_id");
CREATE INDEX "mfg_cl_rev_idx" ON "mfg_cost_ledger"("reversal_of_id");
CREATE INDEX "mfg_cl_by_idx" ON "mfg_cost_ledger"("created_by_id");
-- posted rows are never changed or deleted: corrections are reversal rows
CREATE FUNCTION "mfg_cl_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'The production cost ledger is append-only. Post a reversal instead.' USING ERRCODE = 'P0001';
END $$;
CREATE TRIGGER "mfg_cl_append_only_trg" BEFORE UPDATE OR DELETE ON "mfg_cost_ledger" FOR EACH ROW EXECUTE FUNCTION "mfg_cl_append_only"();

CREATE TABLE "mfg_cost_sheets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "order_id" uuid NOT NULL REFERENCES "mfg_orders"("id") ON DELETE CASCADE,
  "std_material" numeric(18,2) NOT NULL DEFAULT 0,
  "act_material" numeric(18,2) NOT NULL DEFAULT 0,
  "std_labour" numeric(18,2) NOT NULL DEFAULT 0,
  "act_labour" numeric(18,2) NOT NULL DEFAULT 0,
  "std_overhead" numeric(18,2) NOT NULL DEFAULT 0,
  "act_overhead" numeric(18,2) NOT NULL DEFAULT 0,
  "abnormal_scrap" numeric(18,2) NOT NULL DEFAULT 0,
  "std_total" numeric(18,2) NOT NULL DEFAULT 0,
  "act_total" numeric(18,2) NOT NULL DEFAULT 0,
  "variance_pct" numeric(9,2),
  "finalised_at" timestamptz(3),
  "updated_at" timestamptz(3) NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "mfg_cs_order_uq" ON "mfg_cost_sheets"("order_id");
