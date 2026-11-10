-- Phase 15 Part B: Recruitment and Onboarding

CREATE TABLE "job_requisitions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "req_code" varchar(40) NOT NULL UNIQUE,
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "department" varchar(60) NOT NULL,
  "designation_id" uuid REFERENCES "designations"("id") ON DELETE SET NULL,
  "positions" integer NOT NULL DEFAULT 1,
  "reason" varchar(300),
  "priority" varchar(10) NOT NULL DEFAULT 'MEDIUM',
  "status" varchar(20) NOT NULL DEFAULT 'DRAFT',
  "approval_request_id" uuid,
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "deleted_at" timestamptz(3),
  CONSTRAINT "jr_priority_chk" CHECK ("priority" IN ('LOW','MEDIUM','HIGH','URGENT')),
  CONSTRAINT "jr_status_chk" CHECK ("status" IN ('DRAFT','PENDING_APPROVAL','APPROVED','OPEN','FILLED','CANCELLED'))
);

CREATE TABLE "candidates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" varchar(100) NOT NULL,
  "email" varchar(120),
  "mobile" varchar(20),
  "resume_file_id" uuid,
  "source" varchar(50),
  "consent_at" timestamptz(3) NOT NULL DEFAULT now(),
  "purge_after" date,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL
);

CREATE TABLE "candidate_applications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "candidate_id" uuid NOT NULL REFERENCES "candidates"("id") ON DELETE CASCADE,
  "requisition_id" uuid NOT NULL REFERENCES "job_requisitions"("id") ON DELETE RESTRICT,
  "status" varchar(20) NOT NULL DEFAULT 'APPLIED',
  "stage" varchar(30) NOT NULL DEFAULT 'SCREENING',
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "ca_stage_chk" CHECK ("stage" IN ('SCREENING','INTERVIEW','OFFER','JOINED','REJECTED','WITHDRAWN'))
);

CREATE TABLE "interviews" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "application_id" uuid NOT NULL REFERENCES "candidate_applications"("id") ON DELETE CASCADE,
  "round_number" integer NOT NULL DEFAULT 1,
  "scheduled_at" timestamptz(3) NOT NULL,
  "interviewers" jsonb NOT NULL,
  "mode" varchar(20) NOT NULL DEFAULT 'OFFLINE',
  "result" varchar(20),
  "notes" text,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL
);

CREATE TABLE "interview_feedback" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "interview_id" uuid NOT NULL REFERENCES "interviews"("id") ON DELETE CASCADE,
  "interviewer_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "rating" integer,
  "comments" text,
  "recommendation" varchar(20),
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "if_rec_chk" CHECK ("recommendation" IN ('HIRE','NO_HIRE','STRONG_HIRE','HOLD'))
);

CREATE TABLE "offers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "offer_no" varchar(40) NOT NULL UNIQUE,
  "application_id" uuid NOT NULL REFERENCES "candidate_applications"("id") ON DELETE RESTRICT,
  "candidate_id" uuid NOT NULL REFERENCES "candidates"("id") ON DELETE RESTRICT,
  "offered_ctc" numeric(18,2) NOT NULL,
  "join_date" date NOT NULL,
  "validity_date" date NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'DRAFT',
  "letter_document_id" uuid,
  "approval_request_id" uuid,
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "offer_status_chk" CHECK ("status" IN ('DRAFT','PENDING_APPROVAL','APPROVED','SENT','ACCEPTED','DECLINED','WITHDRAWN'))
);

CREATE TABLE "onboarding_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" varchar(30) NOT NULL UNIQUE,
  "name" varchar(100) NOT NULL,
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz(3) NOT NULL DEFAULT now()
);

CREATE TABLE "onboarding_template_tasks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "template_id" uuid NOT NULL REFERENCES "onboarding_templates"("id") ON DELETE CASCADE,
  "task_name" varchar(100) NOT NULL,
  "owner_role" varchar(60),
  "due_offset_days" integer NOT NULL DEFAULT 0,
  "doc_type" varchar(40),
  "blocking" boolean NOT NULL DEFAULT false,
  "sequence" integer NOT NULL DEFAULT 1
);

CREATE TABLE "onboarding_cases" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "employee_id" uuid NOT NULL UNIQUE REFERENCES "employees"("id") ON DELETE CASCADE,
  "template_id" uuid REFERENCES "onboarding_templates"("id") ON DELETE SET NULL,
  "status" varchar(20) NOT NULL DEFAULT 'IN_PROGRESS',
  "it_asset_allocated" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "onb_status_chk" CHECK ("status" IN ('IN_PROGRESS','COMPLETED','CANCELLED'))
);

CREATE TABLE "onboarding_tasks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "case_id" uuid NOT NULL REFERENCES "onboarding_cases"("id") ON DELETE CASCADE,
  "task_name" varchar(100) NOT NULL,
  "assigned_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "completed" boolean NOT NULL DEFAULT false,
  "completed_at" timestamptz(3),
  "completed_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "blocking" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz(3) NOT NULL DEFAULT now()
);

