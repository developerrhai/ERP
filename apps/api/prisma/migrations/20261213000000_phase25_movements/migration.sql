-- Phase 25: Department Work Movement engine - a record travels between departments with a full handover trail
-- (Sent -> Received -> Accepted -> In work -> Forwarded / Returned), the Workflow Matrix suggests the next department,
-- plant routes and transfer notes. Forward-only. Local / test databases only until the owner deploys by hand.

-- 1. Workflow Matrix: who owns a page's documents and who normally receives them next.
CREATE TABLE IF NOT EXISTS "workflow_rules" (
  "module_id" varchar(80) PRIMARY KEY,
  "owner_department_id" uuid REFERENCES "departments"("id") ON DELETE SET NULL,
  "next_department_id" uuid REFERENCES "departments"("id") ON DELETE SET NULL,
  "approval_department_id" uuid REFERENCES "departments"("id") ON DELETE SET NULL,
  "route_mode" varchar(8) NOT NULL DEFAULT 'SUGGEST' CHECK ("route_mode" IN ('MANUAL', 'SUGGEST')),
  "sla_days" numeric(5,2) NOT NULL DEFAULT 2 CHECK ("sla_days" >= 0),
  "routed_edit" boolean NOT NULL DEFAULT true,
  "active" boolean NOT NULL DEFAULT true,
  "required_attachment_types" text[] NOT NULL DEFAULT '{}',
  "required_fields" text[] NOT NULL DEFAULT '{}',
  "next_process_module_id" varchar(80),
  "updated_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "workflow_rules_owner_idx" ON "workflow_rules" ("owner_department_id");
CREATE INDEX IF NOT EXISTS "workflow_rules_next_idx" ON "workflow_rules" ("next_department_id");
CREATE INDEX IF NOT EXISTS "workflow_rules_approval_idx" ON "workflow_rules" ("approval_department_id");
CREATE INDEX IF NOT EXISTS "workflow_rules_updated_by_idx" ON "workflow_rules" ("updated_by_id");

-- default chain (V33) for the pages that exist; editable by Admin. A missing department leaves the cell empty.
INSERT INTO "workflow_rules" ("module_id", "owner_department_id", "next_department_id")
SELECT v.module_id,
       (SELECT d.id FROM departments d WHERE lower(d.name) = lower(v.owner) LIMIT 1),
       (SELECT d.id FROM departments d WHERE lower(d.name) = lower(v.nxt) LIMIT 1)
  FROM (VALUES
    ('sales-orders', 'Sales', 'Projects'),
    ('proj-projects', 'Projects', 'Engineering'),
    ('scm-po', 'Purchase', 'Warehouse'),
    ('scm-grn', 'Warehouse', 'Quality'),
    ('qms-incoming', 'Quality', 'Production'),
    ('mfg-orders', 'Production', 'Quality'),
    ('qms-final', 'Quality', 'Warehouse'),
    ('sales-delivery', 'Warehouse', 'Finance')
  ) AS v(module_id, owner, nxt)
ON CONFLICT ("module_id") DO NOTHING;

-- 2. Movements. One open movement per document (partial unique index below).
CREATE TABLE IF NOT EXISTS "work_movements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "number" varchar(40) NOT NULL UNIQUE,
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "to_unit_id" uuid REFERENCES "units"("id") ON DELETE RESTRICT,
  "doc_type" varchar(80) NOT NULL,
  "doc_id" uuid NOT NULL,
  "doc_no" varchar(60),
  "project_id" uuid, "so_id" uuid, "po_id" uuid, "mo_id" uuid, "job_card_id" uuid,
  "parent_movement_id" uuid REFERENCES "work_movements"("id") ON DELETE SET NULL,
  "from_department_id" uuid NOT NULL REFERENCES "departments"("id") ON DELETE RESTRICT,
  "to_department_id" uuid NOT NULL REFERENCES "departments"("id") ON DELETE RESTRICT,
  "assigned_manager_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "route_type" varchar(40) NOT NULL DEFAULT 'Department Work Handover' CHECK ("route_type" IN
    ('Department Work Handover','Technical Work','Purchase','Material Action','Manufacturing Action','Quality Action',
     'Finance','Commercial Action','Project Action','Correction','Rework')),
  "priority" varchar(8) NOT NULL DEFAULT 'Normal' CHECK ("priority" IN ('Normal','High','Critical')),
  "required_by" date,
  "work_status" varchar(40) NOT NULL DEFAULT 'Work Required' CHECK ("work_status" IN
    ('Work Required','Review Required','Material Action Required','Manufacturing Required','Quality Check Required',
     'Dispatch Action Required','Finance Action Required','Correction Required')),
  "handover_note" varchar(500),
  "state" varchar(18) NOT NULL DEFAULT 'SENT' CHECK ("state" IN
    ('SENT','RECEIVED','ACCEPTED','IN_WORK','WAITING_APPROVAL','COMPLETED','FORWARDED','RETURNED','RECALLED','CANCELLED')),
  "sent_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL, "sent_at" timestamptz(3) NOT NULL DEFAULT now(),
  "received_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL, "received_at" timestamptz(3),
  "accepted_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL, "accepted_at" timestamptz(3),
  "completed_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL, "completed_at" timestamptz(3),
  "returned_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL, "returned_at" timestamptz(3),
  "recalled_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL, "recalled_at" timestamptz(3),
  "return_reason" varchar(500),
  "sla_due_at" timestamptz(3),
  "late" boolean NOT NULL DEFAULT false,
  "is_physical" boolean NOT NULL DEFAULT false,
  "version" integer NOT NULL DEFAULT 1,
  CHECK ("to_unit_id" IS NULL OR "to_unit_id" <> "unit_id" OR NOT "is_physical")
);
CREATE UNIQUE INDEX IF NOT EXISTS "work_movements_one_open_uq" ON "work_movements" ("doc_type", "doc_id")
  WHERE "state" IN ('SENT','RECEIVED','ACCEPTED','IN_WORK','WAITING_APPROVAL');
CREATE INDEX IF NOT EXISTS "work_movements_to_dept_idx" ON "work_movements" ("to_department_id", "unit_id", "state", "sent_at" DESC);
CREATE INDEX IF NOT EXISTS "work_movements_from_dept_idx" ON "work_movements" ("from_department_id", "unit_id", "state", "sent_at" DESC);
CREATE INDEX IF NOT EXISTS "work_movements_doc_idx" ON "work_movements" ("doc_type", "doc_id", "sent_at" DESC);
CREATE INDEX IF NOT EXISTS "work_movements_unit_idx" ON "work_movements" ("unit_id");
CREATE INDEX IF NOT EXISTS "work_movements_to_unit_idx" ON "work_movements" ("to_unit_id");
CREATE INDEX IF NOT EXISTS "work_movements_parent_idx" ON "work_movements" ("parent_movement_id");
CREATE INDEX IF NOT EXISTS "work_movements_manager_idx" ON "work_movements" ("assigned_manager_id");
CREATE INDEX IF NOT EXISTS "work_movements_sent_by_idx" ON "work_movements" ("sent_by_id");
CREATE INDEX IF NOT EXISTS "work_movements_received_by_idx" ON "work_movements" ("received_by_id");
CREATE INDEX IF NOT EXISTS "work_movements_accepted_by_idx" ON "work_movements" ("accepted_by_id");
CREATE INDEX IF NOT EXISTS "work_movements_completed_by_idx" ON "work_movements" ("completed_by_id");
CREATE INDEX IF NOT EXISTS "work_movements_returned_by_idx" ON "work_movements" ("returned_by_id");
CREATE INDEX IF NOT EXISTS "work_movements_recalled_by_idx" ON "work_movements" ("recalled_by_id");
CREATE INDEX IF NOT EXISTS "work_movements_late_idx" ON "work_movements" ("sla_due_at") WHERE "late" = false;

CREATE TABLE IF NOT EXISTS "movement_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "movement_id" uuid NOT NULL REFERENCES "work_movements"("id") ON DELETE CASCADE,
  "line_no" integer NOT NULL,
  "item_id" uuid, "description" varchar(200),
  "qty" numeric(18,3) NOT NULL CHECK ("qty" > 0), "uom" varchar(20), "batch" varchar(40),
  "from_location" varchar(60), "to_location" varchar(60),
  "received_qty" numeric(18,3), "accepted_qty" numeric(18,3), "short_qty" numeric(18,3),
  "short_reason" varchar(300),
  "stock_txn_ids" uuid[] NOT NULL DEFAULT '{}',
  UNIQUE ("movement_id", "line_no")
);
CREATE INDEX IF NOT EXISTS "movement_lines_item_idx" ON "movement_lines" ("item_id");

CREATE TABLE IF NOT EXISTS "movement_attachments" (
  "movement_id" uuid NOT NULL REFERENCES "work_movements"("id") ON DELETE CASCADE,
  "document_id" uuid NOT NULL,
  PRIMARY KEY ("movement_id", "document_id")
);

-- append-only history: who did what, from which department, when
CREATE TABLE IF NOT EXISTS "movement_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "movement_id" uuid NOT NULL REFERENCES "work_movements"("id") ON DELETE CASCADE,
  "doc_type" varchar(80) NOT NULL,
  "doc_id" uuid NOT NULL,
  "event" varchar(20) NOT NULL,
  "from_state" varchar(18), "to_state" varchar(18),
  "department_id" uuid REFERENCES "departments"("id") ON DELETE SET NULL,
  "actor_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "note" varchar(500),
  "at" timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "movement_events_movement_idx" ON "movement_events" ("movement_id", "at");
CREATE INDEX IF NOT EXISTS "movement_events_doc_idx" ON "movement_events" ("doc_type", "doc_id", "at");
CREATE INDEX IF NOT EXISTS "movement_events_dept_idx" ON "movement_events" ("department_id");
CREATE INDEX IF NOT EXISTS "movement_events_actor_idx" ON "movement_events" ("actor_id");
CREATE OR REPLACE FUNCTION phase25_block_event_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'movement_events is append-only'; END $$;
DROP TRIGGER IF EXISTS "movement_events_no_update" ON "movement_events";
CREATE TRIGGER "movement_events_no_update" BEFORE UPDATE ON "movement_events" FOR EACH ROW EXECUTE FUNCTION phase25_block_event_change();

-- 3. Plant routes (multi-plant part routing) and the job cards that follow them.
CREATE TABLE IF NOT EXISTS "plant_routes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" varchar(30) NOT NULL UNIQUE,
  "name" varchar(120) NOT NULL,
  "item_or_family" varchar(120),
  "active" boolean NOT NULL DEFAULT true,
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "plant_routes_created_by_idx" ON "plant_routes" ("created_by_id");

CREATE TABLE IF NOT EXISTS "plant_route_steps" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "route_id" uuid NOT NULL REFERENCES "plant_routes"("id") ON DELETE CASCADE,
  "seq" integer NOT NULL CHECK ("seq" >= 1),
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "process_name" varchar(120) NOT NULL,
  "department_id" uuid REFERENCES "departments"("id") ON DELETE SET NULL,
  "work_centre_id" uuid,
  "std_hours" numeric(8,2),
  "qc_required" boolean NOT NULL DEFAULT false,
  UNIQUE ("route_id", "seq")
);
CREATE INDEX IF NOT EXISTS "plant_route_steps_unit_idx" ON "plant_route_steps" ("unit_id");
CREATE INDEX IF NOT EXISTS "plant_route_steps_dept_idx" ON "plant_route_steps" ("department_id");

CREATE TABLE IF NOT EXISTS "job_card_routes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "job_card_id" uuid NOT NULL,
  "route_id" uuid NOT NULL REFERENCES "plant_routes"("id") ON DELETE RESTRICT,
  "current_step" integer NOT NULL DEFAULT 1,
  "planned" numeric(18,3) NOT NULL DEFAULT 0,
  "good" numeric(18,3) NOT NULL DEFAULT 0,
  "rejected" numeric(18,3) NOT NULL DEFAULT 0,
  "scrap" numeric(18,3) NOT NULL DEFAULT 0,
  "transferred" numeric(18,3) NOT NULL DEFAULT 0,
  "balance" numeric(18,3) GENERATED ALWAYS AS ("planned" - "good" - "scrap") STORED,
  "route_status" varchar(20) NOT NULL DEFAULT 'IN_PROGRESS',
  "quality_approval" varchar(20),
  "dc_status" varchar(20),
  "payment_status" varchar(20),
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  UNIQUE ("job_card_id")
);
CREATE INDEX IF NOT EXISTS "job_card_routes_route_idx" ON "job_card_routes" ("route_id");

-- 4. Material transfer notes between plants / processes and BOM & material approval flows (V40 fields).
CREATE TABLE IF NOT EXISTS "transfer_notes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "note_no" varchar(40) NOT NULL UNIQUE,
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "job_card_no" varchar(40), "part_code" varchar(60), "part_name" varchar(200),
  "from_unit_id" uuid REFERENCES "units"("id") ON DELETE RESTRICT, "from_process" varchar(120),
  "to_unit_id" uuid REFERENCES "units"("id") ON DELETE RESTRICT, "to_process" varchar(120),
  "transfer_date" date NOT NULL DEFAULT current_date,
  "quantity" numeric(18,3) NOT NULL CHECK ("quantity" > 0),
  "vehicle_person" varchar(120),
  "sent_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "received_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "receipt_status" varchar(16) NOT NULL DEFAULT 'PENDING' CHECK ("receipt_status" IN ('PENDING','RECEIVED','SHORT')),
  "remarks" varchar(300),
  "movement_id" uuid REFERENCES "work_movements"("id") ON DELETE SET NULL,
  "created_at" timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "transfer_notes_unit_idx" ON "transfer_notes" ("unit_id", "transfer_date" DESC);
CREATE INDEX IF NOT EXISTS "transfer_notes_from_unit_idx" ON "transfer_notes" ("from_unit_id");
CREATE INDEX IF NOT EXISTS "transfer_notes_to_unit_idx" ON "transfer_notes" ("to_unit_id");
CREATE INDEX IF NOT EXISTS "transfer_notes_sent_by_idx" ON "transfer_notes" ("sent_by_id");
CREATE INDEX IF NOT EXISTS "transfer_notes_received_by_idx" ON "transfer_notes" ("received_by_id");
CREATE INDEX IF NOT EXISTS "transfer_notes_movement_idx" ON "transfer_notes" ("movement_id");

CREATE TABLE IF NOT EXISTS "bom_material_flows" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "flow_no" varchar(40) NOT NULL UNIQUE,
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "sales_order_no" varchar(60), "part_code" varchar(60), "part_name" varchar(200), "bom_revision" varchar(20),
  "material_required" numeric(18,3), "stock_available" numeric(18,3),
  "shortage" numeric(18,3) GENERATED ALWAYS AS (GREATEST(COALESCE("material_required", 0) - COALESCE("stock_available", 0), 0)) STORED,
  "sales_approval" varchar(16) NOT NULL DEFAULT 'PENDING' CHECK ("sales_approval" IN ('PENDING','APPROVED','REJECTED')),
  "purchase_status" varchar(20) NOT NULL DEFAULT 'NONE',
  "manufacturing_release" boolean NOT NULL DEFAULT false,
  "status" varchar(20) NOT NULL DEFAULT 'OPEN',
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "bom_material_flows_unit_idx" ON "bom_material_flows" ("unit_id");
CREATE INDEX IF NOT EXISTS "bom_material_flows_created_by_idx" ON "bom_material_flows" ("created_by_id");

-- 5. Notification types (delivery through Phase 21).
INSERT INTO "notification_types"
  ("code", "module", "category", "label", "label_hi", "priority", "enabled",
   "allowed_channels", "default_channels", "mandatory_channels", "sensitive",
   "title_tpl", "body_tpl", "deep_link_tpl", "collapse_key_tpl", "digest_allowed")
VALUES
  ('work.sent', 'Work', 'DOCUMENT', 'Work sent to your department', 'आपके विभाग को कार्य भेजा गया', 'NORMAL', true,
   ARRAY['IN_APP','EMAIL','PUSH'], ARRAY['IN_APP'], ARRAY['IN_APP'], false, '{{title}}', '{{body}}', '/m/dept-inbox', 'work:{{entityId}}', true),
  ('work.returned', 'Work', 'DOCUMENT', 'Work returned to you', 'कार्य आपको वापस भेजा गया', 'HIGH', true,
   ARRAY['IN_APP','EMAIL','PUSH'], ARRAY['IN_APP'], ARRAY['IN_APP'], false, '{{title}}', '{{body}}', '/m/dept-inbox', 'work:{{entityId}}', false),
  ('work.late', 'Work', 'ALERT', 'Work is late', 'कार्य में देरी', 'HIGH', true,
   ARRAY['IN_APP','EMAIL','PUSH'], ARRAY['IN_APP'], ARRAY['IN_APP'], false, '{{title}}', '{{body}}', '/m/dept-inbox', 'work:{{entityId}}', false),
  ('work.accepted', 'Work', 'DOCUMENT', 'Work accepted', 'कार्य स्वीकार किया गया', 'LOW', true,
   ARRAY['IN_APP'], ARRAY['IN_APP'], ARRAY[]::text[], false, '{{title}}', '{{body}}', '/m/dept-inbox', 'work:{{entityId}}', true)
ON CONFLICT ("code") DO NOTHING;
