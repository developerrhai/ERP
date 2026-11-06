-- Migration B: Roles & Access v2 per Phase 02 §4 steps 1–11
-- One transaction. Safe on a live DB; rolls back completely on any error.

-- 1. Create table roles
CREATE TABLE "roles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "description" VARCHAR(300),
    "level" INTEGER NOT NULL,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "all_units" BOOLEAN NOT NULL DEFAULT false,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_by_id" UUID,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "roles" ADD CONSTRAINT "roles_code_format" CHECK ("code" ~ '^[A-Z][A-Z0-9_]{1,29}$');
ALTER TABLE "roles" ADD CONSTRAINT "roles_level_range" CHECK ("level" BETWEEN 1 AND 99);

CREATE UNIQUE INDEX "roles_code_key" ON "roles"("code");
CREATE UNIQUE INDEX "roles_name_key" ON "roles"("name");
CREATE UNIQUE INDEX "roles_single_super_user_idx" ON "roles"("code") WHERE "code" = 'SUPER_USER';
CREATE INDEX "roles_level_idx" ON "roles"("level");

ALTER TABLE "roles" ADD CONSTRAINT "roles_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "roles" ADD CONSTRAINT "roles_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION check_role_code_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW.code <> OLD.code THEN
    RAISE EXCEPTION 'System roles cannot be deleted. Their code and level are fixed.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER roles_code_immutable_trigger
  BEFORE UPDATE ON "roles"
  FOR EACH ROW EXECUTE FUNCTION check_role_code_immutable();

-- 2. Insert the 9 system roles
INSERT INTO "roles" ("id", "code", "name", "description", "level", "is_system", "all_units", "status", "version") VALUES
  (gen_random_uuid(), 'SUPER_USER', 'Super User', 'Full system access and ownership', 99, true, true, 'ACTIVE', 1),
  (gen_random_uuid(), 'ADMINISTRATOR', 'Administrator', 'System administration and configuration', 95, true, true, 'ACTIVE', 1),
  (gen_random_uuid(), 'DIRECTOR', 'Director', 'Company director with cross-unit operational access', 90, true, true, 'ACTIVE', 1),
  (gen_random_uuid(), 'CFO', 'CFO', 'Chief Financial Officer', 80, true, true, 'ACTIVE', 1),
  (gen_random_uuid(), 'GENERAL_MANAGER', 'General Manager', 'General operational management across units', 70, true, true, 'ACTIVE', 1),
  (gen_random_uuid(), 'DEPT_HEAD', 'Department Head', 'Department head with departmental authority', 60, true, false, 'ACTIVE', 1),
  (gen_random_uuid(), 'DEPT_MANAGER', 'Department Manager', 'Department manager overseeing operations', 50, true, false, 'ACTIVE', 1),
  (gen_random_uuid(), 'SUPERVISOR', 'Supervisor', 'Supervisory authority over team records', 30, true, false, 'ACTIVE', 1),
  (gen_random_uuid(), 'EMPLOYEE', 'Employee', 'Standard employee with own-record access', 10, true, false, 'ACTIVE', 1);

-- 3. Move users to role ids
ALTER TABLE "users" ADD COLUMN "role_id" UUID;

UPDATE "users" u
SET "role_id" = r.id
FROM "roles" r
WHERE (
  (u."role"::text = 'SUPER_ADMIN' AND r.code = 'SUPER_USER') OR
  (u."role"::text = 'ADMIN' AND r.code = 'ADMINISTRATOR') OR
  (u."role"::text = 'MANAGER' AND r.code = 'DEPT_MANAGER') OR
  (u."role"::text = 'LEAD' AND r.code = 'SUPERVISOR') OR
  (u."role"::text = 'MEMBER' AND r.code = 'EMPLOYEE')
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "users" WHERE "role_id" IS NULL) THEN
    RAISE EXCEPTION 'Unmapped users found during role migration';
  END IF;
END $$;

ALTER TABLE "users" ALTER COLUMN "role_id" SET NOT NULL;
ALTER TABLE "users" ADD CONSTRAINT "users_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "users_role_id_idx" ON "users"("role_id");

-- 11 (computed now while old role column exists): Record migration counts
INSERT INTO "audit_logs" ("id", "at", "action", "target_type", "target_id", "detail")
SELECT
  gen_random_uuid(),
  CURRENT_TIMESTAMP,
  'ROLES_MIGRATED',
  'System',
  'roles',
  coalesce(
    (SELECT jsonb_object_agg(old_role || ' -> ' || new_role, cnt)
     FROM (
       SELECT u."role"::text AS old_role, r.code AS new_role, count(*) AS cnt
       FROM "users" u
       JOIN "roles" r ON u."role_id" = r.id
       GROUP BY u."role", r.code
     ) stats),
    '{}'::jsonb
  );

-- 4. Replace the department CHECK with a trigger: department required unless SUPER_USER
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_department_required";

CREATE OR REPLACE FUNCTION check_user_department_required() RETURNS trigger AS $$
DECLARE
  v_code varchar(30);
BEGIN
  SELECT code INTO v_code FROM "roles" WHERE id = NEW.role_id;
  IF v_code <> 'SUPER_USER' AND (NEW.department IS NULL OR trim(NEW.department) = '') THEN
    RAISE EXCEPTION 'Department is required for non-super users';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_department_required_trigger
  BEFORE INSERT OR UPDATE ON "users"
  FOR EACH ROW EXECUTE FUNCTION check_user_department_required();

-- 5. Add users.approval_limit numeric(18,2)
ALTER TABLE "users" ADD COLUMN "approval_limit" NUMERIC(18, 2);

UPDATE "users" u
SET "approval_limit" = CASE
  WHEN r.code = 'SUPER_USER' THEN NULL
  ELSE 0
END
FROM "roles" r
WHERE u.role_id = r.id;

CREATE OR REPLACE FUNCTION check_user_approval_limit() RETURNS trigger AS $$
DECLARE
  v_code varchar(30);
BEGIN
  SELECT code INTO v_code FROM "roles" WHERE id = NEW.role_id;
  IF v_code <> 'SUPER_USER' AND NEW.approval_limit IS NULL THEN
    RAISE EXCEPTION 'Only a Super User can have no limit.';
  END IF;
  IF NEW.approval_limit IS NOT NULL AND NEW.approval_limit < 0 THEN
    RAISE EXCEPTION 'Enter an amount of 0 or more with up to 2 decimals.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_approval_limit_trigger
  BEFORE INSERT OR UPDATE ON "users"
  FOR EACH ROW EXECUTE FUNCTION check_user_approval_limit();

-- 6. Move role_permissions to role ids
ALTER TABLE "role_permissions" ADD COLUMN "role_id" UUID;

UPDATE "role_permissions" rp
SET "role_id" = r.id
FROM "roles" r
WHERE (
  (rp."role"::text = 'ADMIN' AND r.code = 'ADMINISTRATOR') OR
  (rp."role"::text = 'MANAGER' AND r.code = 'DEPT_MANAGER') OR
  (rp."role"::text = 'LEAD' AND r.code = 'SUPERVISOR') OR
  (rp."role"::text = 'MEMBER' AND r.code = 'EMPLOYEE')
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "role_permissions" WHERE "role_id" IS NULL) THEN
    RAISE EXCEPTION 'Unmapped role_permissions found during migration';
  END IF;
END $$;

ALTER TABLE "role_permissions" ALTER COLUMN "role_id" SET NOT NULL;

ALTER TABLE "role_permissions" DROP CONSTRAINT IF EXISTS "role_permissions_no_super_admin";
ALTER TABLE "role_permissions" DROP CONSTRAINT IF EXISTS "role_permissions_role_resource_key";
DROP INDEX IF EXISTS "role_permissions_role_resource_key";

CREATE UNIQUE INDEX "role_permissions_role_id_resource_key" ON "role_permissions"("role_id", "resource");

ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey"
  FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION check_role_permission_no_super_user() RETURNS trigger AS $$
DECLARE
  v_code varchar(30);
BEGIN
  SELECT code INTO v_code FROM "roles" WHERE id = NEW.role_id;
  IF v_code = 'SUPER_USER' THEN
    RAISE EXCEPTION 'Role permissions are not allowed for SUPER_USER';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER role_permissions_no_super_user_trigger
  BEFORE INSERT OR UPDATE ON "role_permissions"
  FOR EACH ROW EXECUTE FUNCTION check_role_permission_no_super_user();

-- Ensure updated_at has a default
ALTER TABLE "role_permissions" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;

-- 7. Add 5 action columns: submit, post, cancel, print, "import"
ALTER TABLE "role_permissions"
  ADD COLUMN "submit" BOOLEAN,
  ADD COLUMN "post" BOOLEAN,
  ADD COLUMN "cancel" BOOLEAN,
  ADD COLUMN "print" BOOLEAN,
  ADD COLUMN "import" BOOLEAN;

-- Backfill * rows per §5.4 defaults
-- ADMINISTRATOR: view, add, edit, delete, submit, export, print, import, controls (no approve, post or cancel), scope ALL
UPDATE "role_permissions" rp
SET "approve" = false,
    "submit" = true,
    "post" = false,
    "cancel" = false,
    "print" = true,
    "import" = true
FROM "roles" r
WHERE rp.role_id = r.id AND r.code = 'ADMINISTRATOR' AND rp.resource = '*';

-- DEPT_MANAGER: everything except controls and import, scope DEPARTMENT
UPDATE "role_permissions" rp
SET "submit" = true,
    "post" = true,
    "cancel" = true,
    "print" = true,
    "import" = false
FROM "roles" r
WHERE rp.role_id = r.id AND r.code = 'DEPT_MANAGER' AND rp.resource = '*';

-- SUPERVISOR: view, add, edit, submit, export, print, scope DEPARTMENT
UPDATE "role_permissions" rp
SET "submit" = true,
    "post" = false,
    "cancel" = false,
    "print" = true,
    "import" = false
FROM "roles" r
WHERE rp.role_id = r.id AND r.code = 'SUPERVISOR' AND rp.resource = '*';

-- EMPLOYEE: view, add, edit, submit, print, scope OWN
UPDATE "role_permissions" rp
SET "submit" = true,
    "post" = false,
    "cancel" = false,
    "print" = true,
    "import" = false
FROM "roles" r
WHERE rp.role_id = r.id AND r.code = 'EMPLOYEE' AND rp.resource = '*';

-- Extend the default row complete check to all 12 actions + scope
ALTER TABLE "role_permissions" DROP CONSTRAINT IF EXISTS "role_permissions_default_complete";
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_default_complete"
  CHECK ("resource" <> '*' OR (
    "view" IS NOT NULL AND "add" IS NOT NULL AND "edit" IS NOT NULL
    AND "delete" IS NOT NULL AND "approve" IS NOT NULL AND "export" IS NOT NULL
    AND "controls" IS NOT NULL AND "submit" IS NOT NULL AND "post" IS NOT NULL
    AND "cancel" IS NOT NULL AND "print" IS NOT NULL AND "import" IS NOT NULL
    AND "scope" IS NOT NULL
  ));

-- 8. Drop the old enum and columns
DROP INDEX IF EXISTS "users_role_idx";
ALTER TABLE "users" DROP COLUMN "role";
ALTER TABLE "role_permissions" DROP COLUMN "role";
DROP TYPE IF EXISTS "Role";

-- 9. Create table user_departments
CREATE TABLE "user_departments" (
    "user_id" UUID NOT NULL,
    "department_name" VARCHAR(60) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,

    CONSTRAINT "user_departments_pkey" PRIMARY KEY ("user_id", "department_name"),
    CONSTRAINT "user_departments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "user_departments_department_name_fkey" FOREIGN KEY ("department_name") REFERENCES "departments"("name") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "user_departments_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "user_departments_department_name_idx" ON "user_departments"("department_name");

CREATE OR REPLACE FUNCTION check_user_department_extra() RETURNS trigger AS $$
DECLARE
  v_home varchar(60);
  v_count int;
BEGIN
  SELECT department INTO v_home FROM "users" WHERE id = NEW.user_id;
  IF v_home IS NOT NULL AND NEW.department_name = v_home THEN
    RAISE EXCEPTION 'Choose departments other than the home department.';
  END IF;
  SELECT count(*) INTO v_count FROM "user_departments" WHERE user_id = NEW.user_id;
  IF v_count >= 10 THEN
    RAISE EXCEPTION 'Up to 10 extra departments.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER user_departments_check_trigger
  BEFORE INSERT ON "user_departments"
  FOR EACH ROW EXECUTE FUNCTION check_user_department_extra();

-- 10. Seed permission rows for DIRECTOR, CFO, GENERAL_MANAGER and DEPT_HEAD per §5.4.
-- Add family:Administration deny row for every role below level 95.

-- DIRECTOR (level 90): everything except controls, scope ALL
INSERT INTO "role_permissions" ("id", "role_id", "resource", "view", "add", "edit", "delete", "approve", "export", "controls", "submit", "post", "cancel", "print", "import", "scope", "version", "created_at", "updated_at")
SELECT gen_random_uuid(), id, '*', true, true, true, true, true, true, false, true, true, true, true, true, 'ALL'::"DataScope", 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "roles" WHERE code = 'DIRECTOR'
ON CONFLICT ("role_id", "resource") DO NOTHING;

-- CFO (level 80): * row: nothing (OWN)
INSERT INTO "role_permissions" ("id", "role_id", "resource", "view", "add", "edit", "delete", "approve", "export", "controls", "submit", "post", "cancel", "print", "import", "scope", "version", "created_at", "updated_at")
SELECT gen_random_uuid(), id, '*', false, false, false, false, false, false, false, false, false, false, false, false, 'OWN'::"DataScope", 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "roles" WHERE code = 'CFO'
ON CONFLICT ("role_id", "resource") DO NOTHING;

-- CFO family rows: Finance & Accounts, Indian Taxation, Sales, Procurement / SCM, Business Intelligence, Executive:
-- everything except delete and controls, scope ALL
INSERT INTO "role_permissions" ("id", "role_id", "resource", "view", "add", "edit", "delete", "approve", "export", "controls", "submit", "post", "cancel", "print", "import", "scope", "version", "created_at", "updated_at")
SELECT gen_random_uuid(), r.id, 'family:' || f.name, true, true, true, false, true, true, false, true, true, true, true, true, 'ALL'::"DataScope", 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "roles" r
CROSS JOIN (VALUES
  ('Finance & Accounts'),
  ('Indian Taxation'),
  ('Sales'),
  ('Procurement / SCM'),
  ('Business Intelligence'),
  ('Executive')
) AS f(name)
WHERE r.code = 'CFO'
ON CONFLICT ("role_id", "resource") DO NOTHING;

-- GENERAL_MANAGER (level 70): everything except delete and controls, scope ALL
INSERT INTO "role_permissions" ("id", "role_id", "resource", "view", "add", "edit", "delete", "approve", "export", "controls", "submit", "post", "cancel", "print", "import", "scope", "version", "created_at", "updated_at")
SELECT gen_random_uuid(), id, '*', true, true, true, false, true, true, false, true, true, true, true, true, 'ALL'::"DataScope", 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "roles" WHERE code = 'GENERAL_MANAGER'
ON CONFLICT ("role_id", "resource") DO NOTHING;

-- DEPT_HEAD (level 60): everything except controls, scope DEPARTMENT
INSERT INTO "role_permissions" ("id", "role_id", "resource", "view", "add", "edit", "delete", "approve", "export", "controls", "submit", "post", "cancel", "print", "import", "scope", "version", "created_at", "updated_at")
SELECT gen_random_uuid(), id, '*', true, true, true, true, true, true, false, true, true, true, true, true, 'DEPARTMENT'::"DataScope", 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "roles" WHERE code = 'DEPT_HEAD'
ON CONFLICT ("role_id", "resource") DO NOTHING;

-- Add family:Administration deny row for every role below level 95 (all 12 actions false)
INSERT INTO "role_permissions" ("id", "role_id", "resource", "view", "add", "edit", "delete", "approve", "export", "controls", "submit", "post", "cancel", "print", "import", "scope", "version", "created_at", "updated_at")
SELECT gen_random_uuid(), r.id, 'family:Administration', false, false, false, false, false, false, false, false, false, false, false, false, 'OWN'::"DataScope", 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "roles" r
WHERE r.level < 95
ON CONFLICT ("role_id", "resource") DO UPDATE SET
  "view" = false,
  "add" = false,
  "edit" = false,
  "delete" = false,
  "approve" = false,
  "export" = false,
  "controls" = false,
  "submit" = false,
  "post" = false,
  "cancel" = false,
  "print" = false,
  "import" = false,
  "scope" = 'OWN'::"DataScope";
