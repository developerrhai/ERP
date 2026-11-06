-- Phase 04 M3: data_jobs (async export, import validate/commit). pg-boss creates its own "pgboss" schema at start.
CREATE TABLE "data_jobs" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "kind" VARCHAR(20) NOT NULL,
  "page_id" VARCHAR(80) NOT NULL,
  "unit_id" UUID NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "fy_id" UUID NOT NULL REFERENCES "financial_years"("id") ON DELETE RESTRICT,
  "status" VARCHAR(12) NOT NULL DEFAULT 'QUEUED',
  "params" JSONB NOT NULL DEFAULT '{}',
  "input_file_id" UUID REFERENCES "stored_files"("id") ON DELETE SET NULL,
  "output_file_id" UUID REFERENCES "stored_files"("id") ON DELETE SET NULL,
  "total_rows" INTEGER,
  "ok_rows" INTEGER,
  "error_rows" INTEGER,
  "error_summary" JSONB,
  "created_by_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "started_at" TIMESTAMPTZ(3),
  "finished_at" TIMESTAMPTZ(3),
  "expires_at" TIMESTAMPTZ(3),
  CONSTRAINT "data_jobs_kind_chk" CHECK ("kind" IN ('EXPORT','IMPORT_VALIDATE','IMPORT_COMMIT')),
  CONSTRAINT "data_jobs_status_chk" CHECK ("status" IN ('QUEUED','RUNNING','DONE','FAILED','CANCELLED'))
);
CREATE INDEX "data_jobs_user_idx" ON "data_jobs"("created_by_id", "created_at" DESC);
