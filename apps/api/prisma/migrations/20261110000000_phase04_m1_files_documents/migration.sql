-- Phase 04 M1: scan state on stored files + record_documents (attachments of generic records).
ALTER TABLE "stored_files"
  ADD COLUMN "scan_status" VARCHAR(12) NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "scan_detail" VARCHAR(200),
  ADD COLUMN "scanned_at" TIMESTAMPTZ(3);
-- Files stored before this phase (letterhead logos) were never scanned.
UPDATE "stored_files" SET "scan_status" = 'SKIPPED';
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_scan_chk"
  CHECK ("scan_status" IN ('PENDING','CLEAN','INFECTED','SKIPPED'));

CREATE TABLE "record_documents" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "page_id" VARCHAR(80) NOT NULL,
  "record_id" UUID NOT NULL REFERENCES "generic_records"("id") ON DELETE RESTRICT,
  "file_id" UUID NOT NULL REFERENCES "stored_files"("id") ON DELETE RESTRICT,
  "doc_type" VARCHAR(40) NOT NULL DEFAULT 'GENERAL',
  "title" VARCHAR(200) NOT NULL,
  "created_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "deleted_at" TIMESTAMPTZ(3)
);
CREATE INDEX "record_documents_record_idx" ON "record_documents"("record_id") WHERE "deleted_at" IS NULL;
CREATE INDEX "record_documents_page_idx" ON "record_documents"("page_id", "created_at");
