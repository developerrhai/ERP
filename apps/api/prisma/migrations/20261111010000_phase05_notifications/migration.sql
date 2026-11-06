-- Phase 05 M2: notifications, preferences and the email outbox (docs/phases/PHASE-05.md §4).
CREATE TABLE "notifications" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "type" VARCHAR(40) NOT NULL,
  "severity" VARCHAR(8) NOT NULL DEFAULT 'INFO',
  "title" VARCHAR(200) NOT NULL,
  "body" VARCHAR(1000) NOT NULL DEFAULT '',
  "link" VARCHAR(300),
  "entity_type" VARCHAR(40),
  "entity_id" VARCHAR(64),
  "dedupe_key" VARCHAR(120),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "read_at" TIMESTAMPTZ(3),
  "emailed_at" TIMESTAMPTZ(3),
  "digested_at" TIMESTAMPTZ(3),
  CONSTRAINT "notifications_severity_chk" CHECK ("severity" IN ('INFO','ACTION','WARN')),
  CONSTRAINT "notifications_user_dedupe_uq" UNIQUE ("user_id", "dedupe_key")
);
CREATE INDEX "notifications_user_read_idx" ON "notifications"("user_id", "read_at", "created_at" DESC);
CREATE INDEX "notifications_purge_idx" ON "notifications"("read_at");

CREATE TABLE "notification_preferences" (
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "type" VARCHAR(40) NOT NULL,
  "in_app" BOOLEAN NOT NULL DEFAULT true,
  "email" VARCHAR(8) NOT NULL DEFAULT 'INSTANT',
  PRIMARY KEY ("user_id", "type"),
  CONSTRAINT "notification_preferences_email_chk" CHECK ("email" IN ('OFF','INSTANT','DIGEST'))
);

CREATE TABLE "email_outbox" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "to_email" VARCHAR(254) NOT NULL,
  "subject" VARCHAR(300) NOT NULL,
  "html" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "status" VARCHAR(8) NOT NULL DEFAULT 'QUEUED',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "last_error" VARCHAR(500),
  "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sent_at" TIMESTAMPTZ(3),
  CONSTRAINT "email_outbox_status_chk" CHECK ("status" IN ('QUEUED','SENT','FAILED','SKIPPED'))
);
CREATE INDEX "email_outbox_status_idx" ON "email_outbox"("status", "next_attempt_at");
