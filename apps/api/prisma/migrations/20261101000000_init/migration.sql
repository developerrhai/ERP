-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'LEAD', 'MEMBER');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "login_id" VARCHAR(64) NOT NULL,
    "email" VARCHAR(254),
    "name" VARCHAR(100) NOT NULL,
    "role" "Role" NOT NULL,
    "department" VARCHAR(40),
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "password_hash" TEXT NOT NULL,
    "must_change_password" BOOLEAN NOT NULL DEFAULT true,
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(3),
    "last_login_at" TIMESTAMPTZ(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "refresh_token_hash" CHAR(64) NOT NULL,
    "user_agent" VARCHAR(512),
    "ip" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_reason" VARCHAR(40),

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_id" UUID,
    "action" VARCHAR(64) NOT NULL,
    "target_type" VARCHAR(40),
    "target_id" VARCHAR(64),
    "ip" VARCHAR(64),
    "user_agent" VARCHAR(512),
    "detail" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_login_id_key" ON "users"("login_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE INDEX "users_department_idx" ON "users"("department");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_refresh_token_hash_key" ON "sessions"("refresh_token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_family_id_idx" ON "sessions"("family_id");

-- CreateIndex
CREATE INDEX "audit_logs_action_at_idx" ON "audit_logs"("action", "at");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_idx" ON "audit_logs"("actor_id");

-- CreateIndex
CREATE INDEX "audit_logs_target_id_idx" ON "audit_logs"("target_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written rules Prisma cannot express (CONTRACT §5)
-- ---------------------------------------------------------------------------

-- At most one SUPER_ADMIN can ever exist.
CREATE UNIQUE INDEX "users_single_super_admin" ON "users" ("role") WHERE "role" = 'SUPER_ADMIN';

-- loginId and email are always stored lowercase; department is required for everyone but the SUPER_ADMIN.
ALTER TABLE "users" ADD CONSTRAINT "users_login_id_lowercase" CHECK ("login_id" = lower("login_id"));
ALTER TABLE "users" ADD CONSTRAINT "users_email_lowercase" CHECK ("email" IS NULL OR "email" = lower("email"));
ALTER TABLE "users" ADD CONSTRAINT "users_department_required" CHECK ("role" = 'SUPER_ADMIN' OR "department" IS NOT NULL);

-- audit_logs is append-only: UPDATE, DELETE and TRUNCATE raise.
CREATE FUNCTION "audit_logs_block_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only (% is not allowed)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "audit_logs_no_update_delete"
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION "audit_logs_block_mutation"();

CREATE TRIGGER "audit_logs_no_truncate"
  BEFORE TRUNCATE ON "audit_logs"
  FOR EACH STATEMENT EXECUTE FUNCTION "audit_logs_block_mutation"();
