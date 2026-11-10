-- Phase 18 Part D: DMS (Folders with ltree, ACLs, Versions referencing stored_files, Tags, Retention ISO 15489, Postgres FTS)

CREATE EXTENSION IF NOT EXISTS ltree;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE "dms_folders" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "parent_id" UUID REFERENCES "dms_folders"("id") ON DELETE RESTRICT,
  "path" ltree NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "unit_id" UUID REFERENCES "units"("id") ON DELETE SET NULL,
  "department_id" UUID REFERENCES "departments"("id") ON DELETE SET NULL,
  "owner_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "confidentiality" VARCHAR(16) NOT NULL DEFAULT 'INTERNAL' CHECK ("confidentiality" IN ('PUBLIC','INTERNAL','RESTRICTED')),
  "retention_years" INTEGER NOT NULL DEFAULT 8 CHECK ("retention_years" >= 6),
  "retention_trigger" VARCHAR(16) NOT NULL DEFAULT 'CREATED' CHECK ("retention_trigger" IN ('CREATED','EXPIRY','CLOSED')),
  "inherit_acl" BOOLEAN NOT NULL DEFAULT true,
  "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE' CHECK ("status" IN ('ACTIVE','ARCHIVED')),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "created_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "deleted_at" TIMESTAMPTZ(3)
);
CREATE INDEX "dms_folders_path_gist_idx" ON "dms_folders" USING gist ("path");
CREATE INDEX "dms_folders_parent_idx" ON "dms_folders"("parent_id");

CREATE TABLE "dms_folder_acl" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "folder_id" UUID NOT NULL REFERENCES "dms_folders"("id") ON DELETE CASCADE,
  "principal_type" VARCHAR(16) NOT NULL CHECK ("principal_type" IN ('USER','ROLE','DEPARTMENT')),
  "principal_id" UUID NOT NULL,
  "can_view" BOOLEAN NOT NULL DEFAULT false,
  "can_upload" BOOLEAN NOT NULL DEFAULT false,
  "can_edit" BOOLEAN NOT NULL DEFAULT false,
  "can_delete" BOOLEAN NOT NULL DEFAULT false,
  "can_download" BOOLEAN NOT NULL DEFAULT false,
  "can_share" BOOLEAN NOT NULL DEFAULT false,
  "can_approve" BOOLEAN NOT NULL DEFAULT false,
  "valid_till" TIMESTAMPTZ(3),
  "granted_via_approval_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "created_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  UNIQUE ("folder_id", "principal_type", "principal_id")
);
CREATE INDEX "dms_folder_acl_principal_idx" ON "dms_folder_acl"("principal_type", "principal_id");

CREATE TABLE "dms_documents" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "doc_code" VARCHAR(40) NOT NULL UNIQUE,
  "title" VARCHAR(250) NOT NULL,
  "description" TEXT,
  "folder_id" UUID NOT NULL REFERENCES "dms_folders"("id") ON DELETE RESTRICT,
  "unit_id" UUID REFERENCES "units"("id") ON DELETE SET NULL,
  "owner_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "confidentiality" VARCHAR(16) NOT NULL DEFAULT 'INTERNAL' CHECK ("confidentiality" IN ('PUBLIC','INTERNAL','RESTRICTED')),
  "current_version_no" INTEGER NOT NULL DEFAULT 1,
  "current_file_id" UUID REFERENCES "stored_files"("id") ON DELETE SET NULL,
  "effective_date" DATE,
  "expiry_date" DATE,
  "linked_page_id" VARCHAR(80),
  "linked_record_id" UUID,
  "checked_out_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "checked_out_at" TIMESTAMPTZ(3),
  "legal_hold" BOOLEAN NOT NULL DEFAULT false,
  "legal_hold_reason" VARCHAR(300),
  "disposition_due" DATE,
  "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE' CHECK ("status" IN ('ACTIVE','DESTROYED')),
  "search_tsv" tsvector,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "created_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "deleted_at" TIMESTAMPTZ(3)
);
CREATE INDEX "dms_documents_tsv_gin_idx" ON "dms_documents" USING gin ("search_tsv");
CREATE INDEX "dms_documents_title_trgm_idx" ON "dms_documents" USING gin ("title" gin_trgm_ops);
CREATE INDEX "dms_documents_folder_idx" ON "dms_documents"("folder_id") WHERE "deleted_at" IS NULL;

CREATE TABLE "dms_document_versions" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "document_id" UUID NOT NULL REFERENCES "dms_documents"("id") ON DELETE CASCADE,
  "version_no" INTEGER NOT NULL,
  "stored_file_id" UUID NOT NULL REFERENCES "stored_files"("id") ON DELETE RESTRICT,
  "change_note" VARCHAR(300),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "created_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  UNIQUE ("document_id", "version_no")
);

CREATE TABLE "dms_document_text" (
  "version_id" UUID PRIMARY KEY REFERENCES "dms_document_versions"("id") ON DELETE CASCADE,
  "extracted_text" TEXT NOT NULL DEFAULT '',
  "extracted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);

CREATE TABLE "dms_tags" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" VARCHAR(40) NOT NULL UNIQUE,
  "name" VARCHAR(80) NOT NULL,
  "tag_group" VARCHAR(40),
  "auto_rule" VARCHAR(200),
  "owner_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);

CREATE TABLE "dms_document_tags" (
  "document_id" UUID NOT NULL REFERENCES "dms_documents"("id") ON DELETE CASCADE,
  "tag_id" UUID NOT NULL REFERENCES "dms_tags"("id") ON DELETE CASCADE,
  PRIMARY KEY ("document_id", "tag_id")
);

CREATE TABLE "dms_share_links" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "token_hash" VARCHAR(64) NOT NULL UNIQUE,
  "document_id" UUID NOT NULL REFERENCES "dms_documents"("id") ON DELETE CASCADE,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "max_downloads" INTEGER,
  "download_count" INTEGER NOT NULL DEFAULT 0,
  "created_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);

CREATE TABLE "dms_saved_searches" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name" VARCHAR(100) NOT NULL,
  "query_text" VARCHAR(300) NOT NULL,
  "filters" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);

CREATE TABLE "dms_search_log" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "query_text" VARCHAR(300) NOT NULL,
  "result_count" INTEGER NOT NULL DEFAULT 0,
  "executed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);

CREATE TABLE "dms_dispositions" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "document_id" UUID NOT NULL REFERENCES "dms_documents"("id") ON DELETE CASCADE,
  "action" VARCHAR(16) NOT NULL CHECK ("action" IN ('REVIEW','DESTROY','EXTEND')),
  "approval_status" VARCHAR(16) NOT NULL DEFAULT 'PENDING' CHECK ("approval_status" IN ('PENDING','APPROVED','REJECTED')),
  "approved_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "certificate_file_id" UUID REFERENCES "stored_files"("id") ON DELETE SET NULL,
  "executed_at" TIMESTAMPTZ(3),
  "remarks" VARCHAR(300),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);

-- Function to recompute weighted 'simple' tsvector for a document
CREATE OR REPLACE FUNCTION dms_refresh_search_tsv(doc_id UUID) RETURNS void AS $$
DECLARE
  v_tags TEXT;
  v_extracted TEXT;
BEGIN
  SELECT string_agg(t.name || ' ' || t.code, ' ') INTO v_tags
  FROM dms_document_tags dt
  JOIN dms_tags t ON t.id = dt.tag_id
  WHERE dt.document_id = doc_id;

  SELECT dt.extracted_text INTO v_extracted
  FROM dms_documents d
  JOIN dms_document_versions v ON v.document_id = d.id AND v.version_no = d.current_version_no
  JOIN dms_document_text dt ON dt.version_id = v.id
  WHERE d.id = doc_id;

  UPDATE dms_documents
  SET search_tsv =
    setweight(to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(doc_code, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(v_tags, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(description, '')), 'C') ||
    setweight(to_tsvector('simple', left(coalesce(v_extracted, ''), 512000)), 'D')
  WHERE id = doc_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION dms_documents_tsv_trigger() RETURNS trigger AS $$
BEGIN
  NEW.search_tsv :=
    setweight(to_tsvector('simple', coalesce(NEW.title, '') || ' ' || coalesce(NEW.doc_code, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(NEW.description, '')), 'C');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_dms_documents_tsv
  BEFORE INSERT OR UPDATE OF title, doc_code, description ON "dms_documents"
  FOR EACH ROW EXECUTE FUNCTION dms_documents_tsv_trigger();

