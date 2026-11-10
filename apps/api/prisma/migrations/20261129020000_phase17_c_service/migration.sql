-- Phase 17 Part C: After-Sales Service, SLA Policies, Tickets, Technicians, Visits & Spares

CREATE TABLE "sla_policies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" varchar(100) NOT NULL UNIQUE,
  "priority" integer NOT NULL,
  "response_mins" integer NOT NULL,
  "resolution_mins" integer NOT NULL,
  "pause_statuses" jsonb NOT NULL DEFAULT '["AWAITING_CUSTOMER","AWAITING_PARTS"]'::jsonb,
  "calendar_config" jsonb NOT NULL DEFAULT '{"startHour":9,"endHour":18,"workingDays":[1,2,3,4,5]}'::jsonb,
  "applies_to" varchar(30) NOT NULL DEFAULT 'ALL',
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz(3) NOT NULL DEFAULT now()
);

-- Seed Standard SLA Policies (P1 to P4)
INSERT INTO "sla_policies" ("name", "priority", "response_mins", "resolution_mins") VALUES
  ('Critical Emergency (P1)', 1, 60, 240),
  ('High Urgency (P2)', 2, 120, 480),
  ('Medium Standard (P3)', 3, 240, 960),
  ('Low Maintenance (P4)', 4, 480, 1920)
ON CONFLICT DO NOTHING;

ALTER TABLE "territories" ADD COLUMN IF NOT EXISTS "pincodes" jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Seed Standard Territories
INSERT INTO "territories" ("code", "name", "pincodes") VALUES
  ('MH-PUN', 'Pune District', '["411001","411018","411019","411026","411038"]'::jsonb),
  ('MH-MUM', 'Mumbai Metro', '["400001","400050","400072","400093"]'::jsonb),
  ('MH-NGP', 'Nagpur Region', '["440001","440010","440022"]'::jsonb)
ON CONFLICT ("code") DO UPDATE SET "pincodes" = EXCLUDED."pincodes";

CREATE TABLE "technicians" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "employee_id" uuid NOT NULL UNIQUE REFERENCES "employees"("id") ON DELETE RESTRICT,
  "territory_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "max_open_jobs" integer NOT NULL DEFAULT 5,
  "van_warehouse_id" uuid REFERENCES "warehouses"("id") ON DELETE SET NULL,
  "home_lat" numeric(10,6),
  "home_lng" numeric(10,6),
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz(3) NOT NULL DEFAULT now()
);

CREATE TABLE "technician_skills" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "technician_id" uuid NOT NULL REFERENCES "technicians"("id") ON DELETE CASCADE,
  "skill_code" varchar(50) NOT NULL,
  "level" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "ts_skill_level_chk" CHECK ("level" >= 1 AND "level" <= 5),
  CONSTRAINT "ts_tech_skill_unique" UNIQUE ("technician_id", "skill_code")
);

CREATE TABLE "service_tickets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "ticket_no" varchar(50) NOT NULL UNIQUE,
  "customer_id" uuid NOT NULL REFERENCES "customers"("id") ON DELETE RESTRICT,
  "contact_person" varchar(100),
  "contact_phone" varchar(20),
  "site_address" text NOT NULL,
  "serial_number_id" uuid REFERENCES "serial_numbers"("id") ON DELETE SET NULL,
  "item_id" uuid REFERENCES "items"("id") ON DELETE SET NULL,
  "subject" varchar(200) NOT NULL,
  "category" varchar(30) NOT NULL DEFAULT 'BREAKDOWN',
  "channel" varchar(30) NOT NULL DEFAULT 'PORTAL',
  "impact" integer NOT NULL DEFAULT 2,
  "urgency" integer NOT NULL DEFAULT 2,
  "priority" integer NOT NULL DEFAULT 3,
  "sla_policy_id" uuid REFERENCES "sla_policies"("id") ON DELETE SET NULL,
  "response_due_at" timestamptz(3),
  "resolution_due_at" timestamptz(3),
  "first_response_at" timestamptz(3),
  "resolved_at" timestamptz(3),
  "closed_at" timestamptz(3),
  "sla_paused_mins" integer NOT NULL DEFAULT 0,
  "sla_state" varchar(20) NOT NULL DEFAULT 'ACTIVE',
  "entitlement" varchar(30) NOT NULL DEFAULT 'CHARGEABLE',
  "amc_contract_id" uuid,
  "warranty_id" uuid,
  "assigned_technician_id" uuid REFERENCES "technicians"("id") ON DELETE SET NULL,
  "rating" integer,
  "status" varchar(30) NOT NULL DEFAULT 'NEW',
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "tkt_category_chk" CHECK ("category" IN ('BREAKDOWN','INSTALLATION','PM','COMPLAINT')),
  CONSTRAINT "tkt_entitlement_chk" CHECK ("entitlement" IN ('WARRANTY','AMC','CHARGEABLE')),
  CONSTRAINT "tkt_sla_state_chk" CHECK ("sla_state" IN ('ACTIVE','PAUSED','WARNING','BREACHED','MET')),
  CONSTRAINT "tkt_status_chk" CHECK ("status" IN ('NEW','ASSIGNED','IN_PROGRESS','AWAITING_CUSTOMER','AWAITING_PARTS','RESOLVED','CLOSED','CANCELLED'))
);

CREATE TABLE "ticket_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "ticket_id" uuid NOT NULL REFERENCES "service_tickets"("id") ON DELETE CASCADE,
  "event_at" timestamptz(3) NOT NULL DEFAULT now(),
  "actor_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "kind" varchar(30) NOT NULL DEFAULT 'STATUS_CHANGE',
  "from_status" varchar(30),
  "to_status" varchar(30),
  "body" text,
  CONSTRAINT "te_kind_chk" CHECK ("kind" IN ('COMMENT','STATUS_CHANGE','ASSIGN','PAUSE','RESUME'))
);

CREATE TABLE "service_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "request_no" varchar(50) NOT NULL UNIQUE,
  "request_type" varchar(30) NOT NULL,
  "customer_id" uuid NOT NULL REFERENCES "customers"("id") ON DELETE RESTRICT,
  "ticket_id" uuid REFERENCES "service_tickets"("id") ON DELETE SET NULL,
  "estimate_amount" numeric(18,2) NOT NULL DEFAULT 0,
  "approval_status" varchar(30) NOT NULL DEFAULT 'DRAFT',
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "srq_type_chk" CHECK ("request_type" IN ('INSTALLATION','RELOCATION','OVERHAUL','UPGRADE'))
);

CREATE TABLE "service_visits" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "visit_no" varchar(50) NOT NULL UNIQUE,
  "ticket_id" uuid REFERENCES "service_tickets"("id") ON DELETE SET NULL,
  "amc_schedule_id" uuid,
  "customer_id" uuid NOT NULL REFERENCES "customers"("id") ON DELETE RESTRICT,
  "site_address" text NOT NULL,
  "technician_id" uuid NOT NULL REFERENCES "technicians"("id") ON DELETE RESTRICT,
  "scheduled_start" timestamptz(3) NOT NULL,
  "scheduled_end" timestamptz(3) NOT NULL,
  "check_in_at" timestamptz(3),
  "check_in_lat" numeric(10,6),
  "check_in_lng" numeric(10,6),
  "check_out_at" timestamptz(3),
  "check_out_lat" numeric(10,6),
  "check_out_lng" numeric(10,6),
  "travel_km" numeric(6,2) NOT NULL DEFAULT 0,
  "checklist_template" jsonb,
  "checklist_result" jsonb,
  "findings" text,
  "action_taken" text,
  "photos" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "signatory_name" varchar(100),
  "signature_doc_id" uuid REFERENCES "stored_files"("id") ON DELETE SET NULL,
  "signed_at" timestamptz(3),
  "billable" boolean NOT NULL DEFAULT false,
  "report_pdf_doc_id" uuid REFERENCES "stored_files"("id") ON DELETE SET NULL,
  "status" varchar(30) NOT NULL DEFAULT 'SCHEDULED',
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "vis_status_chk" CHECK ("status" IN ('SCHEDULED','EN_ROUTE','IN_PROGRESS','COMPLETED','CANCELLED'))
);

CREATE TABLE "spare_issues" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "issue_no" varchar(50) NOT NULL UNIQUE,
  "visit_id" uuid REFERENCES "service_visits"("id") ON DELETE CASCADE,
  "technician_id" uuid NOT NULL REFERENCES "technicians"("id") ON DELETE RESTRICT,
  "warehouse_id" uuid NOT NULL REFERENCES "warehouses"("id") ON DELETE RESTRICT,
  "total_cost" numeric(18,2) NOT NULL DEFAULT 0,
  "chargeable" boolean NOT NULL DEFAULT false,
  "status" varchar(30) NOT NULL DEFAULT 'ISSUED',
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "spi_status_chk" CHECK ("status" IN ('ISSUED','CONSUMED','RETURNED','RECONCILED'))
);

CREATE TABLE "spare_issue_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "spare_issue_id" uuid NOT NULL REFERENCES "spare_issues"("id") ON DELETE CASCADE,
  "item_id" uuid NOT NULL REFERENCES "items"("id") ON DELETE RESTRICT,
  "serial_number_id" uuid REFERENCES "serial_numbers"("id") ON DELETE SET NULL,
  "issued_qty" numeric(18,4) NOT NULL,
  "used_qty" numeric(18,4) NOT NULL DEFAULT 0,
  "returned_qty" numeric(18,4) NOT NULL DEFAULT 0,
  "unit_cost" numeric(18,4) NOT NULL DEFAULT 0,
  "chargeable" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "spil_qty_chk" CHECK (("used_qty" + "returned_qty") <= "issued_qty")
);

CREATE INDEX "idx_tkt_customer" ON "service_tickets"("customer_id", "status");
CREATE INDEX "idx_tkt_tech" ON "service_tickets"("assigned_technician_id", "status");
CREATE INDEX "idx_vis_tech" ON "service_visits"("technician_id", "scheduled_start");
