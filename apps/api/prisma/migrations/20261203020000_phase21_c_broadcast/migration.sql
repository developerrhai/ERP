-- Phase 21-C: Admin Broadcast Announcements with audience resolution, approval link & ack tracking.

CREATE TABLE IF NOT EXISTS "broadcasts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "number" varchar(32) NOT NULL UNIQUE,
  "title" varchar(120) NOT NULL,
  "body_md" varchar(4000) NOT NULL,
  "severity" varchar(12) NOT NULL DEFAULT 'INFO' CHECK ("severity" IN ('INFO', 'WARNING', 'CRITICAL')),
  "audience" jsonb NOT NULL DEFAULT '{"all":true}'::jsonb,
  "channels" text[] NOT NULL DEFAULT ARRAY['IN_APP']::text[],
  "emergency" boolean NOT NULL DEFAULT false,
  "scheduled_at" timestamptz(3),
  "expires_at" timestamptz(3),
  "pin_banner" boolean NOT NULL DEFAULT false,
  "require_ack" boolean NOT NULL DEFAULT false,
  "status" varchar(24) NOT NULL DEFAULT 'DRAFT' CHECK ("status" IN ('DRAFT', 'PENDING_APPROVAL', 'SCHEDULED', 'SENDING', 'SENT', 'WITHDRAWN', 'CANCELLED')),
  "approval_request_id" uuid REFERENCES "approval_requests"("id") ON DELETE SET NULL,
  "recipient_count" int NOT NULL DEFAULT 0,
  "created_by_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "sent_at" timestamptz(3),
  "withdrawn_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "withdrawn_at" timestamptz(3),
  "reason" varchar(500),
  "version" int NOT NULL DEFAULT 1,
  "created_at" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "broadcasts_status_sched_idx" ON "broadcasts" ("status", "scheduled_at");
CREATE INDEX IF NOT EXISTS "broadcasts_approval_req_idx" ON "broadcasts" ("approval_request_id");
CREATE INDEX IF NOT EXISTS "broadcasts_created_by_idx" ON "broadcasts" ("created_by_id");
CREATE INDEX IF NOT EXISTS "broadcasts_withdrawn_by_idx" ON "broadcasts" ("withdrawn_by_id");

CREATE TABLE IF NOT EXISTS "broadcast_recipients" (
  "broadcast_id" uuid NOT NULL REFERENCES "broadcasts"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "notification_id" uuid REFERENCES "notifications"("id") ON DELETE SET NULL,
  "read_at" timestamptz(3),
  "acked_at" timestamptz(3),
  PRIMARY KEY ("broadcast_id", "user_id")
);

CREATE INDEX IF NOT EXISTS "broadcast_recipients_user_idx" ON "broadcast_recipients" ("user_id");
CREATE INDEX IF NOT EXISTS "broadcast_recipients_notif_idx" ON "broadcast_recipients" ("notification_id");

ALTER TABLE "notifications"
  DROP CONSTRAINT IF EXISTS "notifications_broadcast_id_fkey",
  ADD CONSTRAINT "notifications_broadcast_id_fkey"
  FOREIGN KEY ("broadcast_id") REFERENCES "broadcasts"("id") ON DELETE SET NULL;

