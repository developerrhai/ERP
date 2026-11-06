-- Migration M5: Stored Files & Letterhead v2
-- Phase 03: Organisation Masters (File storage registry + Letterhead asset linking)

CREATE TABLE IF NOT EXISTS "stored_files" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "filename" VARCHAR(255) NOT NULL,
  "original_filename" VARCHAR(255) NOT NULL,
  "mime_type" VARCHAR(100) NOT NULL,
  "file_size" BIGINT NOT NULL CHECK ("file_size" >= 0),
  "storage_path" VARCHAR(500) NOT NULL,
  "sha256_hash" CHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "deleted_at" TIMESTAMPTZ(3),
  "deleted_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "stored_files_hash_idx" ON "stored_files"("sha256_hash");
CREATE INDEX IF NOT EXISTS "stored_files_created_by_idx" ON "stored_files"("created_by_id");
CREATE INDEX IF NOT EXISTS "stored_files_deleted_at_idx" ON "stored_files"("deleted_at");

-- Migrate letterhead setting to v2 if present (ensuring backwards compatibility)
DO $$
DECLARE
  v_curr JSONB;
BEGIN
  SELECT "value"::jsonb INTO v_curr FROM "settings" WHERE "key" = 'letterhead';
  IF v_curr IS NOT NULL THEN
    UPDATE "settings"
    SET "value" = v_curr || jsonb_build_object(
      'version', 2,
      'logoFileId', NULL,
      'headerHeightMm', 30,
      'footerHeightMm', 20,
      'primaryColor', COALESCE(v_curr->>'primaryColor', '#0f172a'),
      'showGstin', true,
      'showPan', true,
      'showCin', true
    ),
    "version" = "version" + 1,
    "updated_at" = CURRENT_TIMESTAMP
    WHERE "key" = 'letterhead';
  END IF;
END $$;
