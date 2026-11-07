-- Phase 06B: Format & Settings engine (docs/phases/PHASE-06B.md §4).
-- format_definitions: versioned document layouts (one ACTIVE per page + kind + customer + unit).
-- rule_sets: versioned calculation parameters / formulas (one ACTIVE per page + code).
-- settings_changes: append-only history of who changed what and why.
-- Active and retired versions are immutable (a trigger); a change is always a new version.
CREATE TABLE "format_definitions" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "page_id" VARCHAR(80) NOT NULL,
  "kind" VARCHAR(8) NOT NULL,
  "customer_id" UUID REFERENCES "customers"("id") ON DELETE RESTRICT,
  "unit_id" UUID REFERENCES "units"("id") ON DELETE RESTRICT,
  "version" INTEGER NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
  "name" VARCHAR(120) NOT NULL,
  "schema" JSONB NOT NULL,
  "source_file_id" UUID REFERENCES "stored_files"("id") ON DELETE SET NULL,
  "reason" VARCHAR(500),
  "row_version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "published_at" TIMESTAMPTZ(3),
  "published_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "retired_at" TIMESTAMPTZ(3),
  CONSTRAINT "format_definitions_kind_chk" CHECK ("kind" IN ('PRINT','FORM','REPORT')),
  CONSTRAINT "format_definitions_status_chk" CHECK ("status" IN ('DRAFT','PENDING_APPROVAL','ACTIVE','RETIRED')),
  CONSTRAINT "format_definitions_version_chk" CHECK ("version" >= 1)
);
CREATE UNIQUE INDEX "format_definitions_version_uq" ON "format_definitions"
  ("page_id", "kind", COALESCE("customer_id", '00000000-0000-0000-0000-000000000000'::uuid),
   COALESCE("unit_id", '00000000-0000-0000-0000-000000000000'::uuid), "version");
CREATE UNIQUE INDEX "format_definitions_one_active_uq" ON "format_definitions"
  ("page_id", "kind", COALESCE("customer_id", '00000000-0000-0000-0000-000000000000'::uuid),
   COALESCE("unit_id", '00000000-0000-0000-0000-000000000000'::uuid)) WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX "format_definitions_one_open_uq" ON "format_definitions"
  ("page_id", "kind", COALESCE("customer_id", '00000000-0000-0000-0000-000000000000'::uuid),
   COALESCE("unit_id", '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE "status" IN ('DRAFT','PENDING_APPROVAL');
CREATE INDEX "format_definitions_page_idx" ON "format_definitions"("page_id", "kind", "status");
CREATE INDEX "format_definitions_customer_idx" ON "format_definitions"("customer_id");
CREATE INDEX "format_definitions_unit_idx" ON "format_definitions"("unit_id");
CREATE INDEX "format_definitions_source_file_idx" ON "format_definitions"("source_file_id");
CREATE INDEX "format_definitions_created_by_idx" ON "format_definitions"("created_by_id");

CREATE TABLE "rule_sets" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "page_id" VARCHAR(80) NOT NULL,
  "code" VARCHAR(40) NOT NULL,
  "version" INTEGER NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
  "name" VARCHAR(120) NOT NULL,
  "money_affecting" BOOLEAN NOT NULL DEFAULT true,
  "definition" JSONB NOT NULL,
  "source_file_id" UUID REFERENCES "stored_files"("id") ON DELETE SET NULL,
  "reason" VARCHAR(500),
  "row_version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "published_at" TIMESTAMPTZ(3),
  "published_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "retired_at" TIMESTAMPTZ(3),
  CONSTRAINT "rule_sets_status_chk" CHECK ("status" IN ('DRAFT','PENDING_APPROVAL','ACTIVE','RETIRED')),
  CONSTRAINT "rule_sets_version_chk" CHECK ("version" >= 1),
  CONSTRAINT "rule_sets_code_chk" CHECK ("code" ~ '^[A-Za-z][A-Za-z0-9_]{0,39}$'),
  CONSTRAINT "rule_sets_version_uq" UNIQUE ("page_id", "code", "version")
);
CREATE UNIQUE INDEX "rule_sets_one_active_uq" ON "rule_sets"("page_id", "code") WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX "rule_sets_one_open_uq" ON "rule_sets"("page_id", "code") WHERE "status" IN ('DRAFT','PENDING_APPROVAL');
CREATE INDEX "rule_sets_page_idx" ON "rule_sets"("page_id", "status");
CREATE INDEX "rule_sets_source_file_idx" ON "rule_sets"("source_file_id");
CREATE INDEX "rule_sets_created_by_idx" ON "rule_sets"("created_by_id");

CREATE TABLE "settings_changes" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "target_type" VARCHAR(10) NOT NULL,
  "target_id" UUID NOT NULL,
  "page_id" VARCHAR(80) NOT NULL,
  "version" INTEGER NOT NULL,
  "action" VARCHAR(12) NOT NULL,
  "changed_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "reason" VARCHAR(500),
  "before" JSONB,
  "after" JSONB,
  "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "settings_changes_target_chk" CHECK ("target_type" IN ('FORMAT','RULE_SET')),
  CONSTRAINT "settings_changes_action_chk" CHECK ("action" IN ('DRAFTED','PUBLISHED','RETIRED','IMPORTED','RESTORED','DISCARDED'))
);
CREATE INDEX "settings_changes_target_idx" ON "settings_changes"("target_type", "target_id", "at" DESC);
CREATE INDEX "settings_changes_page_idx" ON "settings_changes"("page_id", "at" DESC);
CREATE INDEX "settings_changes_user_idx" ON "settings_changes"("changed_by_id");

-- History is append-only.
CREATE FUNCTION "settings_changes_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'settings_changes is append-only (% is not allowed)', TG_OP USING ERRCODE = 'restrict_violation';
END $$;
CREATE TRIGGER "settings_changes_no_change" BEFORE UPDATE OR DELETE ON "settings_changes"
  FOR EACH ROW EXECUTE FUNCTION "settings_changes_append_only"();
CREATE TRIGGER "settings_changes_no_truncate" BEFORE TRUNCATE ON "settings_changes"
  FOR EACH STATEMENT EXECUTE FUNCTION "settings_changes_append_only"();

-- A published version never changes: only ACTIVE -> RETIRED (and the audit columns) is allowed.
-- Only DRAFT rows can be deleted (discarding a draft).
CREATE FUNCTION "format_versions_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'format versions are never deleted' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status IN ('ACTIVE','RETIRED') THEN
    IF NEW.schema IS DISTINCT FROM OLD.schema OR NEW.name IS DISTINCT FROM OLD.name
       OR NEW.version <> OLD.version OR NEW.kind <> OLD.kind OR NEW.page_id <> OLD.page_id
       OR NEW.customer_id IS DISTINCT FROM OLD.customer_id OR NEW.unit_id IS DISTINCT FROM OLD.unit_id THEN
      RAISE EXCEPTION 'A published format version cannot be edited' USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.status = 'RETIRED' AND NEW.status <> 'RETIRED' THEN
      RAISE EXCEPTION 'A retired version cannot be reactivated; publish a new version' USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.status = 'ACTIVE' AND NEW.status NOT IN ('ACTIVE','RETIRED') THEN
      RAISE EXCEPTION 'An active version can only be retired' USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "format_definitions_immutable" BEFORE UPDATE OR DELETE ON "format_definitions"
  FOR EACH ROW EXECUTE FUNCTION "format_versions_immutable"();

CREATE FUNCTION "rule_set_versions_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'rule set versions are never deleted' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status IN ('ACTIVE','RETIRED') THEN
    IF NEW.definition IS DISTINCT FROM OLD.definition OR NEW.name IS DISTINCT FROM OLD.name
       OR NEW.version <> OLD.version OR NEW.code <> OLD.code OR NEW.page_id <> OLD.page_id
       OR NEW.money_affecting <> OLD.money_affecting THEN
      RAISE EXCEPTION 'A published rule set version cannot be edited' USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.status = 'RETIRED' AND NEW.status <> 'RETIRED' THEN
      RAISE EXCEPTION 'A retired version cannot be reactivated; publish a new version' USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.status = 'ACTIVE' AND NEW.status NOT IN ('ACTIVE','RETIRED') THEN
      RAISE EXCEPTION 'An active version can only be retired' USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "rule_sets_immutable" BEFORE UPDATE OR DELETE ON "rule_sets"
  FOR EACH ROW EXECUTE FUNCTION "rule_set_versions_immutable"();

-- Documents remember the format and rule-set versions they were created with (R-09): the version
-- ids never change, so a later publish cannot rewrite them.
ALTER TABLE "generic_records"
  ADD COLUMN "format_version_id" UUID REFERENCES "format_definitions"("id") ON DELETE RESTRICT,
  ADD COLUMN "rule_set_version_ids" JSONB;
CREATE INDEX "generic_records_format_version_idx" ON "generic_records"("format_version_id");
