-- CreateEnum
CREATE TYPE "DepartmentStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "DataScope" AS ENUM ('OWN', 'DEPARTMENT', 'ALL');

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "department" SET DATA TYPE VARCHAR(60);

-- CreateTable
CREATE TABLE "departments" (
    "id" UUID NOT NULL,
    "code" VARCHAR(10) NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "head" VARCHAR(100),
    "status" "DepartmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "id" UUID NOT NULL,
    "role" "Role" NOT NULL,
    "resource" VARCHAR(120) NOT NULL,
    "view" BOOLEAN,
    "add" BOOLEAN,
    "edit" BOOLEAN,
    "delete" BOOLEAN,
    "approve" BOOLEAN,
    "export" BOOLEAN,
    "controls" BOOLEAN,
    "scope" "DataScope",
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "department_families" (
    "id" UUID NOT NULL,
    "department_name" VARCHAR(60) NOT NULL,
    "family" VARCHAR(60) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "department_families_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "module_controls" (
    "page_id" VARCHAR(80) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "owner_department" VARCHAR(60) NOT NULL,
    "approval_required" BOOLEAN NOT NULL DEFAULT true,
    "allow_add" BOOLEAN NOT NULL DEFAULT true,
    "allow_edit" BOOLEAN NOT NULL DEFAULT true,
    "allow_delete" BOOLEAN NOT NULL DEFAULT true,
    "allow_export" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "module_controls_pkey" PRIMARY KEY ("page_id")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" VARCHAR(60) NOT NULL,
    "value" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "departments_code_key" ON "departments"("code");

-- CreateIndex
CREATE UNIQUE INDEX "departments_name_key" ON "departments"("name");

-- CreateIndex
CREATE UNIQUE INDEX "role_permissions_role_resource_key" ON "role_permissions"("role", "resource");

-- CreateIndex
CREATE UNIQUE INDEX "department_families_department_name_family_key" ON "department_families"("department_name", "family");

-- CreateIndex
CREATE INDEX "module_controls_owner_department_idx" ON "module_controls"("owner_department");

-- ---------------------------------------------------------------------------
-- Data migration BEFORE the users.department FK (docs/phase2/CONTRACT.md §2.3, §2.4)
-- ---------------------------------------------------------------------------

-- The 11 prototype departments, in prototype order (created_at preserves the order for listings).
INSERT INTO "departments" ("id", "code", "name", "head", "status", "version", "created_at", "updated_at")
SELECT gen_random_uuid(), d.code, d.name, d.name || ' Head', 'ACTIVE', 1,
       CURRENT_TIMESTAMP + (d.ord * interval '1 millisecond'), CURRENT_TIMESTAMP
FROM (VALUES
  (1, 'ADMI', 'Administration'), (2, 'SALE', 'Sales'), (3, 'PURC', 'Purchase'),
  (4, 'FINA', 'Finance'), (5, 'HR', 'HR'), (6, 'PROD', 'Production'), (7, 'QUAL', 'Quality'),
  (8, 'MAIN', 'Maintenance'), (9, 'WARE', 'Warehouse'), (10, 'PROJ', 'Projects'), (11, 'SERV', 'Service')
) AS d(ord, code, name)
ON CONFLICT DO NOTHING;

-- Safety net: any department value already on a user that is not one of the 11 becomes a
-- department too (code derived from an md5 so it is unique and matches ^[A-Z0-9]{2,10}$).
INSERT INTO "departments" ("id", "code", "name", "head", "status", "version", "created_at", "updated_at")
SELECT gen_random_uuid(), 'D' || upper(substr(md5(u.department), 1, 8)), u.department, NULL, 'ACTIVE', 1,
       CURRENT_TIMESTAMP + interval '1 second', CURRENT_TIMESTAMP
FROM (SELECT DISTINCT "department" FROM "users" WHERE "department" IS NOT NULL) AS u
WHERE NOT EXISTS (SELECT 1 FROM "departments" d WHERE d."name" = u."department")
ON CONFLICT DO NOTHING;

-- Rules Prisma cannot express.
ALTER TABLE "departments" ADD CONSTRAINT "departments_code_format" CHECK ("code" ~ '^[A-Z0-9]{2,10}$');
ALTER TABLE "departments" ADD CONSTRAINT "departments_name_length" CHECK (char_length("name") BETWEEN 2 AND 60);
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_no_super_admin" CHECK ("role" <> 'SUPER_ADMIN');
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_resource_format"
  CHECK ("resource" = '*' OR "resource" LIKE 'family:_%' OR "resource" LIKE 'page:_%');
-- The "*" row is the role default and is never "inherit": every cell must be set.
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_default_complete"
  CHECK ("resource" <> '*' OR ("view" IS NOT NULL AND "add" IS NOT NULL AND "edit" IS NOT NULL
    AND "delete" IS NOT NULL AND "approve" IS NOT NULL AND "export" IS NOT NULL
    AND "controls" IS NOT NULL AND "scope" IS NOT NULL));

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_department_fkey" FOREIGN KEY ("department") REFERENCES "departments"("name") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "department_families" ADD CONSTRAINT "department_families_department_name_fkey" FOREIGN KEY ("department_name") REFERENCES "departments"("name") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "module_controls" ADD CONSTRAINT "module_controls_owner_department_fkey" FOREIGN KEY ("owner_department") REFERENCES "departments"("name") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "module_controls" ADD CONSTRAINT "module_controls_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settings" ADD CONSTRAINT "settings_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

