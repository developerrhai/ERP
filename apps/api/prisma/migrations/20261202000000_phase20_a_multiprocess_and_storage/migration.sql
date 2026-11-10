-- Phase 20-A & 20-C: Multi-process rate limit store, unknown-identifier lockout store, and S3 storage metadata.
-- Applied locally to rhai_erp / rhai_erp_test; prod applies via RUNBOOK (E-01, R-16).

CREATE UNLOGGED TABLE IF NOT EXISTS "rate_limit_hits" (
  "key" text NOT NULL,
  "window_start" timestamptz(3) NOT NULL,
  "hits" int NOT NULL DEFAULT 1,
  PRIMARY KEY ("key", "window_start")
);

CREATE INDEX IF NOT EXISTS "rate_limit_hits_window_start_idx"
  ON "rate_limit_hits" ("window_start");

CREATE UNLOGGED TABLE IF NOT EXISTS "unknown_identifier_failures" (
  "identifier_key" varchar(300) PRIMARY KEY,
  "fail_count" int NOT NULL DEFAULT 0,
  "locked_until" timestamptz(3),
  "expires_at" timestamptz(3) NOT NULL
);

CREATE INDEX IF NOT EXISTS "unknown_identifier_failures_expires_at_idx"
  ON "unknown_identifier_failures" ("expires_at");

-- S3 file migration tracking columns on Phase 3/4 stored_files (ERRATA E-07: extend stored_files, never create 'files')
ALTER TABLE "stored_files"
  ADD COLUMN IF NOT EXISTS "storage_driver" varchar(16) NOT NULL DEFAULT 'local',
  ADD COLUMN IF NOT EXISTS "s3_bucket" varchar(128),
  ADD COLUMN IF NOT EXISTS "s3_key" varchar(512),
  ADD COLUMN IF NOT EXISTS "migrated_at" timestamptz(3),
  ADD COLUMN IF NOT EXISTS "s3_verified_at" timestamptz(3);

CREATE INDEX IF NOT EXISTS "stored_files_storage_driver_idx"
  ON "stored_files" ("storage_driver");

