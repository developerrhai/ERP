-- Phase 19 Part C: Automation Rules, Standard Webhooks, Communication & Payment Links

CREATE TABLE "automation_rules" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" VARCHAR(40) NOT NULL UNIQUE,
  "name" VARCHAR(150) NOT NULL,
  "module" VARCHAR(40) NOT NULL,
  "trigger_event" VARCHAR(60) NOT NULL,
  "conditions" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "actions" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "priority" INTEGER NOT NULL DEFAULT 10,
  "run_as_user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "requires_approval" BOOLEAN NOT NULL DEFAULT false,
  "max_runs_per_hour" INTEGER NOT NULL DEFAULT 60,
  "status" VARCHAR(20) NOT NULL DEFAULT 'DRAFT' CHECK ("status" IN ('DRAFT','PENDING_APPROVAL','ACTIVE','PAUSED')),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "created_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);

CREATE TABLE "automation_runs" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "rule_id" UUID NOT NULL REFERENCES "automation_rules"("id") ON DELETE CASCADE,
  "event_name" VARCHAR(60) NOT NULL,
  "event_id" VARCHAR(80) NOT NULL,
  "correlation_id" UUID NOT NULL,
  "depth" INTEGER NOT NULL DEFAULT 1,
  "matched" BOOLEAN NOT NULL DEFAULT false,
  "actions_result" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "status" VARCHAR(20) NOT NULL CHECK ("status" IN ('SUCCESS','SKIPPED','LOOP_BLOCKED','PAUSED_RATE','FAILED')),
  "error" VARCHAR(400),
  "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "finished_at" TIMESTAMPTZ(3),
  UNIQUE ("rule_id", "event_id")
);

CREATE TABLE "webhook_endpoints" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" VARCHAR(120) NOT NULL,
  "url" VARCHAR(400) NOT NULL,
  "events" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "secret_enc" TEXT NOT NULL,
  "secret_prev_enc" TEXT,
  "secret_prev_expires_at" TIMESTAMPTZ(3),
  "secret_last4" VARCHAR(8) NOT NULL,
  "timeout_ms" INTEGER NOT NULL DEFAULT 5000,
  "max_retries" INTEGER NOT NULL DEFAULT 8,
  "failure_count" INTEGER NOT NULL DEFAULT 0,
  "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE' CHECK ("status" IN ('ACTIVE','DISABLED')),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "created_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL
);

CREATE TABLE "webhook_deliveries" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "endpoint_id" UUID NOT NULL REFERENCES "webhook_endpoints"("id") ON DELETE CASCADE,
  "webhook_msg_id" VARCHAR(80) NOT NULL,
  "event_name" VARCHAR(60) NOT NULL,
  "attempt" INTEGER NOT NULL DEFAULT 1,
  "headers" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "payload" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "payload_sha256" VARCHAR(64) NOT NULL,
  "http_status" INTEGER,
  "response_snippet" VARCHAR(1024),
  "duration_ms" INTEGER,
  "next_retry_at" TIMESTAMPTZ(3),
  "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING' CHECK ("status" IN ('PENDING','DELIVERED','RETRY','DEAD_LETTER')),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);

CREATE TABLE "webhook_inbound" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "source" VARCHAR(20) NOT NULL CHECK ("source" IN ('META','RAZORPAY')),
  "external_id" VARCHAR(120) NOT NULL,
  "signature_ok" BOOLEAN NOT NULL DEFAULT false,
  "payload" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "processed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  UNIQUE ("source", "external_id")
);

CREATE TABLE "comm_accounts" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "channel" VARCHAR(16) NOT NULL CHECK ("channel" IN ('WHATSAPP','SMS','EMAIL')),
  "provider" VARCHAR(40) NOT NULL,
  "config_enc" TEXT NOT NULL DEFAULT '{}',
  "sender" VARCHAR(100) NOT NULL,
  "dlt_entity_id" VARCHAR(40),
  "daily_limit" INTEGER NOT NULL DEFAULT 1000,
  "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE' CHECK ("status" IN ('ACTIVE','INACTIVE')),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);

CREATE TABLE "message_templates" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" VARCHAR(40) NOT NULL UNIQUE,
  "channel" VARCHAR(16) NOT NULL CHECK ("channel" IN ('WHATSAPP','SMS','EMAIL')),
  "name" VARCHAR(120) NOT NULL,
  "language" VARCHAR(16) NOT NULL DEFAULT 'en',
  "category" VARCHAR(20) NOT NULL DEFAULT 'TRANSACTIONAL' CHECK ("category" IN ('TRANSACTIONAL','SERVICE','PROMOTIONAL','UTILITY','MARKETING')),
  "body" TEXT NOT NULL,
  "variables" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "wa_template_name" VARCHAR(100),
  "wa_status" VARCHAR(20) DEFAULT 'PENDING',
  "dlt_template_id" VARCHAR(40),
  "dlt_header" VARCHAR(16),
  "whitelisted_urls" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);

CREATE TABLE "contact_consents" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "party_type" VARCHAR(16),
  "party_id" UUID,
  "channel" VARCHAR(16) NOT NULL CHECK ("channel" IN ('WHATSAPP','SMS','EMAIL')),
  "address" VARCHAR(150) NOT NULL,
  "opted_in" BOOLEAN NOT NULL DEFAULT true,
  "source" VARCHAR(60) NOT NULL DEFAULT 'WEB_FORM',
  "evidence" VARCHAR(200),
  "consented_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "opted_out_at" TIMESTAMPTZ(3),
  UNIQUE ("channel", "address")
);

CREATE TABLE "outbound_messages" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "channel" VARCHAR(16) NOT NULL CHECK ("channel" IN ('WHATSAPP','SMS','EMAIL')),
  "template_id" UUID REFERENCES "message_templates"("id") ON DELETE SET NULL,
  "account_id" UUID REFERENCES "comm_accounts"("id") ON DELETE SET NULL,
  "recipient" VARCHAR(150) NOT NULL,
  "party_id" UUID,
  "variables" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "rendered_body" TEXT NOT NULL,
  "provider_message_id" VARCHAR(120),
  "status" VARCHAR(16) NOT NULL DEFAULT 'QUEUED' CHECK ("status" IN ('QUEUED','SENT','DELIVERED','READ','FAILED','BLOCKED')),
  "error" VARCHAR(300),
  "cost_inr" NUMERIC(10,4) NOT NULL DEFAULT 0,
  "requested_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "approval_request_id" UUID,
  "rule_run_id" UUID REFERENCES "automation_runs"("id") ON DELETE SET NULL,
  "sent_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);

CREATE TABLE "payment_links" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "invoice_id" UUID REFERENCES "sales_invoices"("id") ON DELETE SET NULL,
  "amount" NUMERIC(14,2) NOT NULL CHECK ("amount" > 0),
  "gateway" VARCHAR(20) NOT NULL DEFAULT 'RAZORPAY_TEST',
  "link_id" VARCHAR(80) NOT NULL UNIQUE,
  "short_url" VARCHAR(300) NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'CREATED' CHECK ("status" IN ('CREATED','PAID','EXPIRED','CANCELLED')),
  "expires_at" TIMESTAMPTZ(3),
  "paid_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "created_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL
);

