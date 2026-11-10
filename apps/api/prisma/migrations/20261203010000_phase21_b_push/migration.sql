-- Phase 21-B: Web Push device subscriptions & revocation lifecycle.

CREATE TABLE IF NOT EXISTS "push_subscriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "endpoint" text NOT NULL UNIQUE,
  "p256dh" text NOT NULL,
  "auth" text NOT NULL,
  "platform" varchar(16) NOT NULL DEFAULT 'DESKTOP' CHECK ("platform" IN ('ANDROID', 'IOS', 'DESKTOP', 'OTHER')),
  "browser" varchar(64) NOT NULL DEFAULT 'Chrome',
  "device_label" varchar(120) NOT NULL DEFAULT 'Browser Device',
  "standalone" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_success_at" timestamptz(3),
  "failure_count" int NOT NULL DEFAULT 0,
  "revoked_at" timestamptz(3),
  "revoke_reason" varchar(24) CHECK ("revoke_reason" IN ('LOGOUT', 'GONE_410', 'USER', 'ADMIN', 'DEACTIVATED'))
);

CREATE INDEX IF NOT EXISTS "push_subscriptions_user_idx" ON "push_subscriptions" ("user_id");
CREATE INDEX IF NOT EXISTS "push_subscriptions_active_idx" ON "push_subscriptions" ("revoked_at");

