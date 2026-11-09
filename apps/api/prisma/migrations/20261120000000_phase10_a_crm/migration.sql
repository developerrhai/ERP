-- Phase 10 / A: CRM (docs/phases/PHASE-10.md + archive plan 04, adapted to today's rules). No company_id (D-01).
CREATE TABLE "lead_sources" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" varchar(20) NOT NULL,
  "name" varchar(80) NOT NULL,
  "status" varchar(10) NOT NULL DEFAULT 'Active',
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "lead_sources_status_chk" CHECK ("status" IN ('Active','Inactive'))
);
CREATE UNIQUE INDEX "lead_sources_code_uq" ON "lead_sources"("code");
CREATE INDEX "lead_sources_created_by_idx" ON "lead_sources"("created_by_id");
CREATE INDEX "lead_sources_updated_by_idx" ON "lead_sources"("updated_by_id");
INSERT INTO "lead_sources" ("code","name") VALUES ('WEB','Website'),('REF','Referral'),('EXH','Exhibition'),('CALL','Cold call'),('CUST','Existing customer'),('OTH','Other');

CREATE TABLE "leads" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "fy_id" uuid NOT NULL REFERENCES "financial_years"("id") ON DELETE RESTRICT,
  "number" varchar(40),
  "department" varchar(60) NOT NULL DEFAULT '',
  "status" varchar(24) NOT NULL DEFAULT 'New',
  "name" varchar(150) NOT NULL,
  "company" varchar(150),
  "mobile" varchar(20),
  "email" varchar(150),
  "state_code" char(2),
  "source_id" uuid REFERENCES "lead_sources"("id") ON DELETE SET NULL,
  "assigned_to_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "interest" varchar(300),
  "est_value" numeric(18,2),
  "score" smallint NOT NULL DEFAULT 0,
  "lost_reason" varchar(300),
  "customer_id" uuid REFERENCES "customers"("id") ON DELETE SET NULL,
  "opportunity_id" uuid,
  "converted_at" timestamptz(3),
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "deleted_at" timestamptz(3),
  "deleted_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "leads_status_chk" CHECK ("status" IN ('New','Contacted','Qualified','Unqualified','Converted')),
  CONSTRAINT "leads_score_chk" CHECK ("score" BETWEEN 0 AND 100)
);
CREATE UNIQUE INDEX "leads_number_uq" ON "leads"("unit_id","fy_id","number") WHERE "number" IS NOT NULL;
CREATE INDEX "leads_unit_idx" ON "leads"("unit_id");
CREATE INDEX "leads_fy_idx" ON "leads"("fy_id");
CREATE INDEX "leads_status_idx" ON "leads"("status");
CREATE INDEX "leads_created_by_idx" ON "leads"("created_by_id");
CREATE INDEX "leads_updated_by_idx" ON "leads"("updated_by_id");
CREATE INDEX "leads_deleted_by_idx" ON "leads"("deleted_by_id");

CREATE INDEX "leads_source_idx" ON "leads"("source_id");
CREATE INDEX "leads_assigned_idx" ON "leads"("assigned_to_id");
CREATE INDEX "leads_customer_idx" ON "leads"("customer_id");

CREATE TABLE "opportunities" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "fy_id" uuid NOT NULL REFERENCES "financial_years"("id") ON DELETE RESTRICT,
  "number" varchar(40),
  "department" varchar(60) NOT NULL DEFAULT '',
  "status" varchar(24) NOT NULL DEFAULT 'Prospecting',
  "customer_id" uuid REFERENCES "customers"("id") ON DELETE RESTRICT,
  "lead_id" uuid REFERENCES "leads"("id") ON DELETE SET NULL,
  "title" varchar(200) NOT NULL,
  "amount" numeric(18,2) NOT NULL DEFAULT 0,
  "probability" smallint NOT NULL DEFAULT 10,
  "expected_close" date,
  "owner_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "lost_reason" varchar(300),
  "closed_at" timestamptz(3),
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "deleted_at" timestamptz(3),
  "deleted_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "opportunities_status_chk" CHECK ("status" IN ('Prospecting','Qualification','Proposal','Negotiation','Won','Lost')),
  CONSTRAINT "opps_prob_chk" CHECK ("probability" BETWEEN 0 AND 100)
);
CREATE UNIQUE INDEX "opportunities_number_uq" ON "opportunities"("unit_id","fy_id","number") WHERE "number" IS NOT NULL;
CREATE INDEX "opportunities_unit_idx" ON "opportunities"("unit_id");
CREATE INDEX "opportunities_fy_idx" ON "opportunities"("fy_id");
CREATE INDEX "opportunities_status_idx" ON "opportunities"("status");
CREATE INDEX "opportunities_created_by_idx" ON "opportunities"("created_by_id");
CREATE INDEX "opportunities_updated_by_idx" ON "opportunities"("updated_by_id");
CREATE INDEX "opportunities_deleted_by_idx" ON "opportunities"("deleted_by_id");

CREATE INDEX "opps_customer_idx" ON "opportunities"("customer_id");
CREATE INDEX "opps_lead_idx" ON "opportunities"("lead_id");
CREATE INDEX "opps_owner_idx" ON "opportunities"("owner_id");
ALTER TABLE "leads" ADD CONSTRAINT "leads_opportunity_fk" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE SET NULL;
CREATE INDEX "leads_opportunity_idx" ON "leads"("opportunity_id");

CREATE TABLE "opportunity_stage_history" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "opportunity_id" uuid NOT NULL REFERENCES "opportunities"("id") ON DELETE CASCADE,
  "from_stage" varchar(24),
  "to_stage" varchar(24) NOT NULL,
  "note" varchar(300),
  "changed_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "changed_at" timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX "osh_opp_idx" ON "opportunity_stage_history"("opportunity_id");
CREATE INDEX "osh_user_idx" ON "opportunity_stage_history"("changed_by_id");

CREATE TABLE "crm_followups" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "fy_id" uuid NOT NULL REFERENCES "financial_years"("id") ON DELETE RESTRICT,
  "number" varchar(40),
  "department" varchar(60) NOT NULL DEFAULT '',
  "status" varchar(24) NOT NULL DEFAULT 'Open',
  "related_type" varchar(12) NOT NULL DEFAULT 'LEAD',
  "related_id" uuid,
  "customer_id" uuid REFERENCES "customers"("id") ON DELETE RESTRICT,
  "title" varchar(200) NOT NULL,
  "kind" varchar(12) NOT NULL DEFAULT 'Call',
  "due_at" timestamptz(3) NOT NULL,
  "assigned_to_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "outcome" varchar(300),
  "done_at" timestamptz(3),
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "deleted_at" timestamptz(3),
  "deleted_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "crm_followups_status_chk" CHECK ("status" IN ('Open','Done','Cancelled')),
  CONSTRAINT "followups_rel_chk" CHECK ("related_type" IN ('LEAD','OPPORTUNITY','CUSTOMER','ORDER'))
);
CREATE UNIQUE INDEX "crm_followups_number_uq" ON "crm_followups"("unit_id","fy_id","number") WHERE "number" IS NOT NULL;
CREATE INDEX "crm_followups_unit_idx" ON "crm_followups"("unit_id");
CREATE INDEX "crm_followups_fy_idx" ON "crm_followups"("fy_id");
CREATE INDEX "crm_followups_status_idx" ON "crm_followups"("status");
CREATE INDEX "crm_followups_created_by_idx" ON "crm_followups"("created_by_id");
CREATE INDEX "crm_followups_updated_by_idx" ON "crm_followups"("updated_by_id");
CREATE INDEX "crm_followups_deleted_by_idx" ON "crm_followups"("deleted_by_id");

CREATE INDEX "followups_assigned_idx" ON "crm_followups"("assigned_to_id","status");
CREATE INDEX "followups_customer_idx" ON "crm_followups"("customer_id");

CREATE TABLE "crm_meetings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "fy_id" uuid NOT NULL REFERENCES "financial_years"("id") ON DELETE RESTRICT,
  "number" varchar(40),
  "department" varchar(60) NOT NULL DEFAULT '',
  "status" varchar(24) NOT NULL DEFAULT 'Planned',
  "related_type" varchar(12) NOT NULL DEFAULT 'LEAD',
  "related_id" uuid,
  "customer_id" uuid REFERENCES "customers"("id") ON DELETE RESTRICT,
  "subject" varchar(200) NOT NULL,
  "kind" varchar(8) NOT NULL DEFAULT 'Meeting',
  "starts_at" timestamptz(3) NOT NULL,
  "duration_min" integer,
  "attendees" varchar(300),
  "outcome" varchar(500),
  "owner_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "deleted_at" timestamptz(3),
  "deleted_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "crm_meetings_status_chk" CHECK ("status" IN ('Planned','Held','Cancelled')),
  CONSTRAINT "meetings_kind_chk" CHECK ("kind" IN ('Meeting','Call'))
);
CREATE UNIQUE INDEX "crm_meetings_number_uq" ON "crm_meetings"("unit_id","fy_id","number") WHERE "number" IS NOT NULL;
CREATE INDEX "crm_meetings_unit_idx" ON "crm_meetings"("unit_id");
CREATE INDEX "crm_meetings_fy_idx" ON "crm_meetings"("fy_id");
CREATE INDEX "crm_meetings_status_idx" ON "crm_meetings"("status");
CREATE INDEX "crm_meetings_created_by_idx" ON "crm_meetings"("created_by_id");
CREATE INDEX "crm_meetings_updated_by_idx" ON "crm_meetings"("updated_by_id");
CREATE INDEX "crm_meetings_deleted_by_idx" ON "crm_meetings"("deleted_by_id");

CREATE INDEX "meetings_customer_idx" ON "crm_meetings"("customer_id");
CREATE INDEX "meetings_owner_idx" ON "crm_meetings"("owner_id");

CREATE TABLE "crm_feedback" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "fy_id" uuid NOT NULL REFERENCES "financial_years"("id") ON DELETE RESTRICT,
  "number" varchar(40),
  "department" varchar(60) NOT NULL DEFAULT '',
  "status" varchar(24) NOT NULL DEFAULT 'New',
  "customer_id" uuid NOT NULL REFERENCES "customers"("id") ON DELETE RESTRICT,
  "rating" smallint NOT NULL,
  "category" varchar(20) NOT NULL DEFAULT 'General',
  "comment" varchar(1000),
  "action_note" varchar(500),
  "given_on" date NOT NULL DEFAULT CURRENT_DATE,
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "deleted_at" timestamptz(3),
  "deleted_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "crm_feedback_status_chk" CHECK ("status" IN ('New','In review','Closed')),
  CONSTRAINT "feedback_rating_chk" CHECK ("rating" BETWEEN 0 AND 10)
);
CREATE UNIQUE INDEX "crm_feedback_number_uq" ON "crm_feedback"("unit_id","fy_id","number") WHERE "number" IS NOT NULL;
CREATE INDEX "crm_feedback_unit_idx" ON "crm_feedback"("unit_id");
CREATE INDEX "crm_feedback_fy_idx" ON "crm_feedback"("fy_id");
CREATE INDEX "crm_feedback_status_idx" ON "crm_feedback"("status");
CREATE INDEX "crm_feedback_created_by_idx" ON "crm_feedback"("created_by_id");
CREATE INDEX "crm_feedback_updated_by_idx" ON "crm_feedback"("updated_by_id");
CREATE INDEX "crm_feedback_deleted_by_idx" ON "crm_feedback"("deleted_by_id");

CREATE INDEX "feedback_customer_idx" ON "crm_feedback"("customer_id");

CREATE TABLE "demand_forecasts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "item_id" uuid NOT NULL REFERENCES "items"("id") ON DELETE RESTRICT,
  "customer_id" uuid REFERENCES "customers"("id") ON DELETE SET NULL,
  "month" char(7) NOT NULL,
  "qty" numeric(18,3) NOT NULL,
  "notes" varchar(300),
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "forecast_month_chk" CHECK ("month" ~ '^[0-9]{4}-[0-9]{2}$'),
  CONSTRAINT "forecast_qty_chk" CHECK ("qty" >= 0)
);
CREATE UNIQUE INDEX "forecast_uq" ON "demand_forecasts"("unit_id","item_id","month",COALESCE("customer_id",'00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX "forecast_item_idx" ON "demand_forecasts"("item_id");
CREATE INDEX "forecast_customer_idx" ON "demand_forecasts"("customer_id");
CREATE INDEX "forecast_created_by_idx" ON "demand_forecasts"("created_by_id");
