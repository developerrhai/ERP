-- Phase 17 Part D: AMC Contracts, Visit & Billing & Revenue Schedules, Warranties, Claims & Service History View

CREATE TABLE "amc_contracts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "contract_no" varchar(50) NOT NULL UNIQUE,
  "customer_id" uuid NOT NULL REFERENCES "customers"("id") ON DELETE RESTRICT,
  "coverage" varchar(30) NOT NULL DEFAULT 'COMPREHENSIVE',
  "start_date" date NOT NULL,
  "end_date" date NOT NULL,
  "visit_frequency" varchar(30) NOT NULL DEFAULT 'QUARTERLY',
  "contract_value" numeric(18,2) NOT NULL DEFAULT 0,
  "billing_frequency" varchar(30) NOT NULL DEFAULT 'QUARTERLY',
  "service_item_id" uuid REFERENCES "items"("id") ON DELETE SET NULL,
  "sla_policy_id" uuid REFERENCES "sla_policies"("id") ON DELETE SET NULL,
  "renewal_stage" varchar(30) NOT NULL DEFAULT 'ACTIVE',
  "renewed_from_id" uuid REFERENCES "amc_contracts"("id") ON DELETE SET NULL,
  "approval_status" varchar(30) NOT NULL DEFAULT 'DRAFT',
  "status" varchar(30) NOT NULL DEFAULT 'DRAFT',
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "amc_coverage_chk" CHECK ("coverage" IN ('COMPREHENSIVE','NON_COMPREHENSIVE')),
  CONSTRAINT "amc_visit_freq_chk" CHECK ("visit_frequency" IN ('MONTHLY','QUARTERLY','HALF_YEARLY','ANNUAL')),
  CONSTRAINT "amc_billing_freq_chk" CHECK ("billing_frequency" IN ('MONTHLY','QUARTERLY','ANNUAL')),
  CONSTRAINT "amc_renewal_stage_chk" CHECK ("renewal_stage" IN ('ACTIVE','REMINDER_60','REMINDER_30','REMINDER_7','EXPIRED','RENEWED')),
  CONSTRAINT "amc_approval_chk" CHECK ("approval_status" IN ('DRAFT','SUBMITTED','APPROVED','REJECTED')),
  CONSTRAINT "amc_status_chk" CHECK ("status" IN ('DRAFT','ACTIVE','TERMINATED','EXPIRED')),
  CONSTRAINT "amc_dates_chk" CHECK ("end_date" >= "start_date")
);

CREATE TABLE "amc_contract_assets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "amc_contract_id" uuid NOT NULL REFERENCES "amc_contracts"("id") ON DELETE CASCADE,
  "serial_number_id" uuid NOT NULL REFERENCES "serial_numbers"("id") ON DELETE RESTRICT,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "amc_asset_unique" UNIQUE ("amc_contract_id", "serial_number_id")
);

CREATE TABLE "amc_visit_schedule" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "amc_contract_id" uuid NOT NULL REFERENCES "amc_contracts"("id") ON DELETE CASCADE,
  "serial_number_id" uuid REFERENCES "serial_numbers"("id") ON DELETE SET NULL,
  "due_date" date NOT NULL,
  "service_visit_id" uuid REFERENCES "service_visits"("id") ON DELETE SET NULL,
  "status" varchar(30) NOT NULL DEFAULT 'PENDING',
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "amc_visit_status_chk" CHECK ("status" IN ('PENDING','SCHEDULED','COMPLETED','SKIPPED')),
  CONSTRAINT "amc_visit_unique" UNIQUE ("amc_contract_id", "serial_number_id", "due_date")
);

CREATE TABLE "amc_billing_schedule" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "amc_contract_id" uuid NOT NULL REFERENCES "amc_contracts"("id") ON DELETE CASCADE,
  "period_name" varchar(50) NOT NULL,
  "amount" numeric(18,2) NOT NULL,
  "due_date" date NOT NULL,
  "sales_invoice_id" uuid REFERENCES "sales_invoices"("id") ON DELETE SET NULL,
  "status" varchar(30) NOT NULL DEFAULT 'PENDING',
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "amc_bill_status_chk" CHECK ("status" IN ('PENDING','BILLED','PAID','CANCELLED'))
);

CREATE TABLE "amc_revenue_schedule" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "amc_contract_id" uuid NOT NULL REFERENCES "amc_contracts"("id") ON DELETE CASCADE,
  "period" varchar(7) NOT NULL,
  "amount" numeric(18,2) NOT NULL,
  "journal_id" uuid REFERENCES "journals"("id") ON DELETE SET NULL,
  "status" varchar(30) NOT NULL DEFAULT 'PENDING',
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "amc_rev_unique" UNIQUE ("amc_contract_id", "period")
);

CREATE TABLE "warranty_terms" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" varchar(50) NOT NULL UNIQUE,
  "name" varchar(100) NOT NULL,
  "item_id" uuid REFERENCES "items"("id") ON DELETE SET NULL,
  "item_category" varchar(50),
  "months" integer NOT NULL,
  "start_basis" varchar(30) NOT NULL DEFAULT 'DELIVERY',
  "coverage" varchar(30) NOT NULL DEFAULT 'PARTS_AND_LABOUR',
  "exclusions" text,
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "wterm_start_chk" CHECK ("start_basis" IN ('INVOICE','DELIVERY','INSTALLATION')),
  CONSTRAINT "wterm_coverage_chk" CHECK ("coverage" IN ('PARTS','LABOUR','PARTS_AND_LABOUR'))
);

CREATE TABLE "warranty_registrations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "serial_number_id" uuid NOT NULL UNIQUE REFERENCES "serial_numbers"("id") ON DELETE RESTRICT,
  "customer_id" uuid NOT NULL REFERENCES "customers"("id") ON DELETE RESTRICT,
  "invoice_ref" varchar(100),
  "sales_invoice_id" uuid REFERENCES "sales_invoices"("id") ON DELETE SET NULL,
  "term_id" uuid REFERENCES "warranty_terms"("id") ON DELETE SET NULL,
  "start_date" date NOT NULL,
  "end_date" date NOT NULL,
  "installation_date" date,
  "status" varchar(30) NOT NULL DEFAULT 'ACTIVE',
  "void_reason" text,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "wreg_status_chk" CHECK ("status" IN ('ACTIVE','EXPIRED','VOID')),
  CONSTRAINT "wreg_dates_chk" CHECK ("end_date" >= "start_date")
);

CREATE TABLE "warranty_claims" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "claim_no" varchar(50) NOT NULL UNIQUE,
  "warranty_registration_id" uuid REFERENCES "warranty_registrations"("id") ON DELETE SET NULL,
  "ticket_id" uuid REFERENCES "service_tickets"("id") ON DELETE SET NULL,
  "customer_id" uuid NOT NULL REFERENCES "customers"("id") ON DELETE RESTRICT,
  "serial_number_id" uuid NOT NULL REFERENCES "serial_numbers"("id") ON DELETE RESTRICT,
  "failure_date" date NOT NULL,
  "problem_description" text NOT NULL,
  "eligibility_result" varchar(30) NOT NULL DEFAULT 'IN_WARRANTY',
  "eligibility_notes" text,
  "inspection_result" text,
  "decision" varchar(30) NOT NULL DEFAULT 'PENDING',
  "replacement_serial_id" uuid REFERENCES "serial_numbers"("id") ON DELETE SET NULL,
  "claim_cost" numeric(18,2) NOT NULL DEFAULT 0,
  "supplier_id" uuid REFERENCES "suppliers"("id") ON DELETE SET NULL,
  "supplier_grn_ref" varchar(100),
  "supplier_claim_amount" numeric(18,2) NOT NULL DEFAULT 0,
  "supplier_settled_amount" numeric(18,2) NOT NULL DEFAULT 0,
  "approval_status" varchar(30) NOT NULL DEFAULT 'DRAFT',
  "status" varchar(30) NOT NULL DEFAULT 'PENDING',
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "wcl_elig_chk" CHECK ("eligibility_result" IN ('IN_WARRANTY','AMC_COVERED','OUT_OF_WARRANTY','CONDITIONAL')),
  CONSTRAINT "wcl_decision_chk" CHECK ("decision" IN ('PENDING','REPAIR','REPLACE','REJECT')),
  CONSTRAINT "wcl_status_chk" CHECK ("status" IN ('PENDING','APPROVED','REJECTED','CLAIMED_SUPPLIER','SETTLED'))
);

-- Foreign keys back to service_tickets and service_visits
ALTER TABLE "service_tickets"
  ADD CONSTRAINT "fk_tkt_amc" FOREIGN KEY ("amc_contract_id") REFERENCES "amc_contracts"("id") ON DELETE SET NULL,
  ADD CONSTRAINT "fk_tkt_wreg" FOREIGN KEY ("warranty_id") REFERENCES "warranty_registrations"("id") ON DELETE SET NULL;

ALTER TABLE "service_visits"
  ADD CONSTRAINT "fk_vis_amc_sched" FOREIGN KEY ("amc_schedule_id") REFERENCES "amc_visit_schedule"("id") ON DELETE SET NULL;

-- View: service_history
CREATE OR REPLACE VIEW "service_history" AS
  SELECT 
    t."id" AS "id",
    'TICKET' AS "record_type",
    t."ticket_no" AS "ref_no",
    t."customer_id" AS "customer_id",
    t."serial_number_id" AS "serial_number_id",
    t."created_at" AS "event_date",
    t."subject" AS "summary",
    t."status" AS "status"
  FROM "service_tickets" t
  UNION ALL
  SELECT 
    v."id" AS "id",
    'VISIT' AS "record_type",
    v."visit_no" AS "ref_no",
    v."customer_id" AS "customer_id",
    t."serial_number_id" AS "serial_number_id",
    v."scheduled_start" AS "event_date",
    COALESCE(v."findings", v."action_taken", 'Service visit') AS "summary",
    v."status" AS "status"
  FROM "service_visits" v
  LEFT JOIN "service_tickets" t ON v."ticket_id" = t."id"
  UNION ALL
  SELECT 
    c."id" AS "id",
    'CLAIM' AS "record_type",
    c."claim_no" AS "ref_no",
    c."customer_id" AS "customer_id",
    c."serial_number_id" AS "serial_number_id",
    c."failure_date"::timestamptz AS "event_date",
    c."problem_description" AS "summary",
    c."status" AS "status"
  FROM "warranty_claims" c
  UNION ALL
  SELECT 
    s."id" AS "id",
    'SPARE' AS "record_type",
    s."issue_no" AS "ref_no",
    v."customer_id" AS "customer_id",
    NULL::uuid AS "serial_number_id",
    s."created_at" AS "event_date",
    ('Spare Issue ' || s."issue_no") AS "summary",
    s."status" AS "status"
  FROM "spare_issues" s
  JOIN "service_visits" v ON s."visit_id" = v."id";

CREATE INDEX "idx_amc_cust" ON "amc_contracts"("customer_id", "status");
CREATE INDEX "idx_wreg_cust" ON "warranty_registrations"("customer_id", "status");
CREATE INDEX "idx_wcl_cust" ON "warranty_claims"("customer_id", "status");
CREATE INDEX "idx_wcl_serial" ON "warranty_claims"("serial_number_id");

