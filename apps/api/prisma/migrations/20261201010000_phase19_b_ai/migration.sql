-- Phase 19 Part B: AI Copilot, Insights & Statistical Forecasts
-- Compliant with ERRATA E-18 (single-row ai_settings; no company_id anywhere)

CREATE TABLE "ai_settings" (
  "id" INTEGER PRIMARY KEY DEFAULT 1 CHECK ("id" = 1),
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "analysis_model" VARCHAR(60) NOT NULL DEFAULT 'claude-sonnet-5-5',
  "classify_model" VARCHAR(60) NOT NULL DEFAULT 'claude-haiku-5-5',
  "org_daily_token_cap" INTEGER NOT NULL DEFAULT 500000,
  "org_daily_inr_cap" NUMERIC(12,2) NOT NULL DEFAULT 500.00,
  "user_daily_token_cap" INTEGER NOT NULL DEFAULT 50000,
  "user_daily_inr_cap" NUMERIC(12,2) NOT NULL DEFAULT 100.00,
  "allowed_departments" JSONB NOT NULL DEFAULT '["Administration","Sales","Purchase","Finance","HR","Production","Quality","Maintenance","Warehouse","Projects","Service","Logistics"]'::jsonb,
  "mask_fields" JSONB NOT NULL DEFAULT '["pan","aadhaar","bank_account","salary","mobile","total_gross","total_net"]'::jsonb,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL
);

INSERT INTO "ai_settings" ("id","enabled") VALUES (1, false) ON CONFLICT ("id") DO NOTHING;

CREATE TABLE "ai_conversations" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "module_page_id" VARCHAR(60),
  "title" VARCHAR(200) NOT NULL DEFAULT 'Copilot Chat',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);

CREATE TABLE "ai_messages" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "conversation_id" UUID NOT NULL REFERENCES "ai_conversations"("id") ON DELETE CASCADE,
  "role" VARCHAR(16) NOT NULL CHECK ("role" IN ('user','assistant','system')),
  "content" TEXT NOT NULL,
  "citations" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "refused" BOOLEAN NOT NULL DEFAULT false,
  "model" VARCHAR(60),
  "input_tokens" INTEGER NOT NULL DEFAULT 0,
  "output_tokens" INTEGER NOT NULL DEFAULT 0,
  "cost_inr" NUMERIC(10,4) NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);

CREATE TABLE "ai_tool_calls" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "conversation_id" UUID NOT NULL REFERENCES "ai_conversations"("id") ON DELETE CASCADE,
  "message_id" UUID REFERENCES "ai_messages"("id") ON DELETE SET NULL,
  "tool_name" VARCHAR(60) NOT NULL,
  "tool_input" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "row_count" INTEGER NOT NULL DEFAULT 0,
  "scope_applied" VARCHAR(200),
  "duration_ms" INTEGER NOT NULL DEFAULT 0,
  "error" VARCHAR(300),
  "called_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);

CREATE TABLE "ai_usage_daily" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "usage_date" DATE NOT NULL DEFAULT CURRENT_DATE,
  "tokens_used" INTEGER NOT NULL DEFAULT 0,
  "cost_inr" NUMERIC(12,4) NOT NULL DEFAULT 0,
  "question_count" INTEGER NOT NULL DEFAULT 0,
  UNIQUE ("user_id", "usage_date")
);

CREATE TABLE "ai_insights" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "kpi_code" VARCHAR(50),
  "dataset_code" VARCHAR(50),
  "entity_type" VARCHAR(40),
  "entity_id" UUID,
  "kind" VARCHAR(16) NOT NULL CHECK ("kind" IN ('THRESHOLD','ANOMALY','TREND')),
  "severity" VARCHAR(12) NOT NULL DEFAULT 'WARN' CHECK ("severity" IN ('INFO','WARN','CRITICAL')),
  "score" NUMERIC(10,4) NOT NULL DEFAULT 0,
  "message" VARCHAR(300) NOT NULL,
  "evidence" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "unit_id" UUID REFERENCES "units"("id") ON DELETE SET NULL,
  "department" VARCHAR(60),
  "status" VARCHAR(16) NOT NULL DEFAULT 'OPEN' CHECK ("status" IN ('OPEN','ACKNOWLEDGED','DISMISSED')),
  "detected_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);

CREATE TABLE "forecast_runs" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "subject" VARCHAR(30) NOT NULL CHECK ("subject" IN ('ITEM_DEMAND','KPI','CASH')),
  "subject_id" VARCHAR(80) NOT NULL,
  "method" VARCHAR(16) NOT NULL CHECK ("method" IN ('MA','SES','HOLT')),
  "params" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "window_size" INTEGER NOT NULL,
  "horizon" INTEGER NOT NULL,
  "output" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "mape" NUMERIC(10,4) NOT NULL DEFAULT 0,
  "rmse" NUMERIC(12,4) NOT NULL DEFAULT 0,
  "unit_id" UUID REFERENCES "units"("id") ON DELETE SET NULL,
  "run_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);

