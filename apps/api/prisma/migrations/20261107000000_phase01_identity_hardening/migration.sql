-- Phase 01: Identity Hardening Migration
-- Adds password_changed_at, login telemetry, TOTP MFA columns, session liveness columns,
-- recovery codes table, MFA challenges table, password reset tokens table, and default security policy.

-- 1. Users table additions
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "password_changed_at" TIMESTAMPTZ(3);
UPDATE "users" SET "password_changed_at" = "updated_at" WHERE "password_changed_at" IS NULL;
ALTER TABLE "users" ALTER COLUMN "password_changed_at" SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "previous_login_at" TIMESTAMPTZ(3);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "previous_login_ip" VARCHAR(64);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_login_ip" VARCHAR(64);

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "mfa_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "mfa_secret_enc" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "mfa_pending_secret_enc" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "mfa_enrolled_at" TIMESTAMPTZ(3);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "mfa_last_step" BIGINT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_mfa_enabled_check') THEN
    ALTER TABLE "users" ADD CONSTRAINT "users_mfa_enabled_check"
      CHECK (NOT mfa_enabled OR mfa_secret_enc IS NOT NULL);
  END IF;
END $$;

-- 2. Sessions table additions
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "family_started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "sessions" s
SET "family_started_at" = f.min_created_at
FROM (
  SELECT "family_id", MIN("created_at") AS min_created_at
  FROM "sessions"
  GROUP BY "family_id"
) f
WHERE s."family_id" = f."family_id";

ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "mfa_verified" BOOLEAN DEFAULT false;
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "revoked_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "sessions_user_id_active_idx" ON "sessions"("user_id") WHERE "revoked_at" IS NULL;

-- Policy migration: revoke live sessions older than 12 hours
UPDATE "sessions"
SET "revoked_at" = CURRENT_TIMESTAMP, "revoked_reason" = 'policy_migration'
WHERE "revoked_at" IS NULL AND "created_at" < (CURRENT_TIMESTAMP - INTERVAL '12 hours');

-- 3. Recovery codes table
CREATE TABLE IF NOT EXISTS "user_mfa_recovery_codes" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "code_hash" CHAR(64) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_mfa_recovery_codes_user_hash_unique" UNIQUE ("user_id", "code_hash")
);

CREATE INDEX IF NOT EXISTS "user_mfa_recovery_codes_user_id_idx" ON "user_mfa_recovery_codes"("user_id");

-- 4. MFA challenges table
CREATE TABLE IF NOT EXISTS "mfa_challenges" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "attempts" INT NOT NULL DEFAULT 0 CHECK (attempts <= 5),
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    "ip" VARCHAR(64),
    "user_agent" VARCHAR(512),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "mfa_challenges_user_id_idx" ON "mfa_challenges"("user_id");
CREATE INDEX IF NOT EXISTS "mfa_challenges_expires_at_idx" ON "mfa_challenges"("expires_at");

-- 5. Password reset tokens table
CREATE TABLE IF NOT EXISTS "password_reset_tokens" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "token_hash" VARCHAR(64) NOT NULL UNIQUE,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "requested_ip" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "password_reset_tokens_user_id_idx" ON "password_reset_tokens"("user_id");

-- 6. Default security policy in settings
INSERT INTO "settings" ("key", "value", "version", "created_at", "updated_at")
VALUES (
    'security_policy',
    '{"passwordMinLength":12,"maxFailedLogins":10,"lockoutMinutes":15,"idleMinutes":30,"absoluteHours":12,"maxSessionsPerUser":10,"mfaRequiredForAdmins":false}'::jsonb,
    1,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO NOTHING;
