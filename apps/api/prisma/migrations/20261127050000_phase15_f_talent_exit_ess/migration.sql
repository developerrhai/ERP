-- Phase 15 Part F: Talent, Training, Exit Management, F&F Handoff & ESS DPDP Privacy Notices

CREATE TABLE "training_programs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" varchar(30) NOT NULL UNIQUE,
  "name" varchar(100) NOT NULL,
  "description" text,
  "trainer" varchar(100),
  "duration_hours" numeric(5,2),
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL
);

CREATE TABLE "training_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "program_id" uuid NOT NULL REFERENCES "training_programs"("id") ON DELETE CASCADE,
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "session_date" date NOT NULL,
  "venue" varchar(100),
  "status" varchar(20) NOT NULL DEFAULT 'PLANNED',
  "created_at" timestamptz(3) NOT NULL DEFAULT now()
);

CREATE TABLE "training_participants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "session_id" uuid NOT NULL REFERENCES "training_sessions"("id") ON DELETE CASCADE,
  "employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
  "attendance_status" varchar(20) NOT NULL DEFAULT 'ENROLLED',
  "score" numeric(5,2),
  "certificate_document_id" uuid,
  "valid_until" date,
  "created_at" timestamptz(3) NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "tr_part_sess_emp_uq" ON "training_participants"("session_id", "employee_id");

CREATE TABLE "perf_cycles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" varchar(100) NOT NULL,
  "start_date" date NOT NULL,
  "end_date" date NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'DRAFT',
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL
);

CREATE TABLE "perf_goals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "cycle_id" uuid NOT NULL REFERENCES "perf_cycles"("id") ON DELETE CASCADE,
  "employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
  "goal_text" varchar(300) NOT NULL,
  "kra" varchar(100),
  "weight" numeric(5,2) NOT NULL DEFAULT 0,
  "target_metric" varchar(100),
  "progress_pct" numeric(5,2) NOT NULL DEFAULT 0,
  "created_at" timestamptz(3) NOT NULL DEFAULT now()
);

CREATE TABLE "perf_reviews" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "cycle_id" uuid NOT NULL REFERENCES "perf_cycles"("id") ON DELETE CASCADE,
  "employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
  "reviewer_employee_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "self_rating" numeric(3,1),
  "reviewer_rating" numeric(3,1),
  "final_rating" numeric(3,1),
  "comments" text,
  "status" varchar(20) NOT NULL DEFAULT 'DRAFT',
  "submitted_at" timestamptz(3),
  "created_at" timestamptz(3) NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "perf_rev_cycle_emp_uq" ON "perf_reviews"("cycle_id", "employee_id");

CREATE TABLE "exit_cases" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "case_no" varchar(40) NOT NULL UNIQUE,
  "employee_id" uuid NOT NULL UNIQUE REFERENCES "employees"("id") ON DELETE RESTRICT,
  "exit_type" varchar(30) NOT NULL DEFAULT 'RESIGNATION',
  "resignation_date" date NOT NULL,
  "notice_days" integer NOT NULL DEFAULT 30,
  "expected_lwd" date NOT NULL,
  "approved_lwd" date,
  "shortfall_days" integer NOT NULL DEFAULT 0,
  "shortfall_waived" boolean NOT NULL DEFAULT false,
  "reason" varchar(500) NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'DRAFT',
  "approval_request_id" uuid,
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "exit_type_chk" CHECK ("exit_type" IN ('RESIGNATION','TERMINATION','RETIREMENT','DEATH','ABSCONDING','CONTRACT_END')),
  CONSTRAINT "exit_status_chk" CHECK ("status" IN ('DRAFT','PENDING_APPROVAL','APPROVED','CLEARANCE','FNF','CLOSED','WITHDRAWN'))
);

CREATE TABLE "exit_clearance_tasks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "case_id" uuid NOT NULL REFERENCES "exit_cases"("id") ON DELETE CASCADE,
  "department" varchar(60) NOT NULL,
  "task_name" varchar(100) NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'PENDING',
  "remarks" varchar(300),
  "cleared_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "cleared_at" timestamptz(3)
);

CREATE TABLE "exit_interviews" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "case_id" uuid NOT NULL UNIQUE REFERENCES "exit_cases"("id") ON DELETE CASCADE,
  "interviewer_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "conducted_at" timestamptz(3),
  "primary_reason" varchar(100),
  "feedback" text,
  "will_rejoin" boolean,
  "created_at" timestamptz(3) NOT NULL DEFAULT now()
);

CREATE TABLE "fnf_handoffs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "exit_case_id" uuid REFERENCES "exit_cases"("id") ON DELETE SET NULL,
  "employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE RESTRICT,
  "lwd" date NOT NULL,
  "paid_days_last_period" numeric(5,2) NOT NULL DEFAULT 0,
  "el_encashable_days" numeric(5,2) NOT NULL DEFAULT 0,
  "notice_shortfall_days" integer NOT NULL DEFAULT 0,
  "gratuity_eligible" boolean NOT NULL DEFAULT false,
  "bonus_months" numeric(4,2) NOT NULL DEFAULT 0,
  "loan_balance" numeric(18,2) NOT NULL DEFAULT 0,
  "advances_outstanding" numeric(18,2) NOT NULL DEFAULT 0,
  "recoveries" numeric(18,2) NOT NULL DEFAULT 0,
  "due_by" date NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'READY',
  "consumed_at" timestamptz(3),
  "consumed_by_payroll_run_id" uuid,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "fnf_handoff_status_chk" CHECK ("status" IN ('READY','CONSUMED','CANCELLED'))
);

CREATE TABLE "hr_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "req_no" varchar(40) NOT NULL UNIQUE,
  "employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
  "category" varchar(40) NOT NULL,
  "subject" varchar(150) NOT NULL,
  "description" text NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'OPEN',
  "response" text,
  "resolved_at" timestamptz(3),
  "resolved_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "hr_req_status_chk" CHECK ("status" IN ('OPEN','IN_PROGRESS','RESOLVED','CLOSED'))
);

CREATE TABLE "privacy_notices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "version" varchar(20) NOT NULL UNIQUE,
  "title" varchar(100) NOT NULL,
  "text_md" text NOT NULL,
  "effective_from" date NOT NULL,
  "created_at" timestamptz(3) NOT NULL DEFAULT now()
);

-- Seed initial DPDP privacy notice
INSERT INTO "privacy_notices" ("version", "title", "text_md", "effective_from") VALUES
  ('v1.0', 'Employee Privacy & DPDP Notice', '# Privacy & Data Protection Notice\nWe collect and process your personal information strictly for employment, compliance, statutory benefits, and safety purposes under the Digital Personal Data Protection Act.', '2026-01-01')
ON CONFLICT ("version") DO NOTHING;

CREATE TABLE "privacy_notice_acceptances" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "notice_id" uuid NOT NULL REFERENCES "privacy_notices"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "accepted_at" timestamptz(3) NOT NULL DEFAULT now(),
  "ip" varchar(64)
);
CREATE UNIQUE INDEX "pna_notice_user_uq" ON "privacy_notice_acceptances"("notice_id", "user_id");

