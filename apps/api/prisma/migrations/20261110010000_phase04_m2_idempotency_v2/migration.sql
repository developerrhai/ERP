-- Phase 04 M2: idempotency v2 (scope, state, stored response, expiry).
ALTER TABLE "idempotency_keys"
  ADD COLUMN "scope" VARCHAR(160) NOT NULL DEFAULT 'records:create',
  ADD COLUMN "state" VARCHAR(12) NOT NULL DEFAULT 'DONE',
  ADD COLUMN "response_code" INTEGER,
  ADD COLUMN "response_body" JSONB,
  ADD COLUMN "expires_at" TIMESTAMPTZ(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP + interval '24 hours');
ALTER TABLE "idempotency_keys" ALTER COLUMN "record_id" DROP NOT NULL;
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_state_chk"
  CHECK ("state" IN ('RUNNING','DONE','FAILED'));
ALTER TABLE "idempotency_keys" DROP CONSTRAINT "idempotency_keys_pkey";
ALTER TABLE "idempotency_keys" ADD PRIMARY KEY ("user_id", "scope", "key");
CREATE INDEX "idempotency_keys_expires_idx" ON "idempotency_keys"("expires_at");
