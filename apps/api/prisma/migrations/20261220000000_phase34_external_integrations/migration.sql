-- Phase 34: external integrations. An encrypted vault with a mode per provider, a call log, the e-invoice fields on the sales invoice,
-- and the columns the webhook retry / dead-letter engine needs. Forward-only and idempotent.

CREATE TABLE IF NOT EXISTS integration_configs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_code   text NOT NULL UNIQUE CHECK (provider_code IN ('GST_IRP','GST_EWAY','WHATSAPP','BANK_FEED','SMTP_RELAY')),
  mode            text NOT NULL DEFAULT 'DISABLED' CHECK (mode IN ('DISABLED','SANDBOX','LIVE')),
  config_json     jsonb NOT NULL DEFAULT '{}'::jsonb,
  secrets_enc     text,
  secret_hints    jsonb NOT NULL DEFAULT '{}'::jsonb,
  fail_streak     int NOT NULL DEFAULT 0,
  last_tested_at  timestamptz,
  last_test_status text,
  updated_by_id   uuid,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS integration_logs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_code    text NOT NULL,
  direction        text NOT NULL CHECK (direction IN ('OUTBOUND','INBOUND')),
  doc_type         text,
  doc_id           uuid,
  http_status      int,
  latency_ms       int,
  request_summary  text,
  response_summary text,
  error_text       text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS integration_logs_provider_idx ON integration_logs (provider_code, created_at DESC);

INSERT INTO integration_configs (provider_code) VALUES ('GST_IRP'), ('GST_EWAY'), ('WHATSAPP'), ('BANK_FEED'), ('SMTP_RELAY') ON CONFLICT (provider_code) DO NOTHING;

ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS ack_no text;
ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS ack_date timestamptz;
ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS signed_qr text;

-- inbound hooks of the new providers are stored in the same table
DO $$
DECLARE c text;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid = 'webhook_inbound'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%source%' LOOP
    EXECUTE format('ALTER TABLE webhook_inbound DROP CONSTRAINT %I', c);
  END LOOP;
  ALTER TABLE webhook_inbound ADD CONSTRAINT webhook_inbound_source_chk CHECK (source IN ('META','RAZORPAY','WHATSAPP','BANK_FEED'));
END $$;

ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS last_error text;
ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS replay_of uuid;
CREATE INDEX IF NOT EXISTS webhook_deliveries_due_idx ON webhook_deliveries (status, next_retry_at) WHERE status IN ('PENDING','RETRY');

INSERT INTO "notification_types"
  ("code", "module", "category", "label", "label_hi", "priority", "enabled",
   "allowed_channels", "default_channels", "mandatory_channels", "sensitive",
   "title_tpl", "body_tpl", "deep_link_tpl", "collapse_key_tpl", "digest_allowed")
VALUES
  ('system.integration_dlq', 'System', 'ALERT', 'An integration needs attention', 'इंटीग्रेशन पर ध्यान दें', 'HIGH', true,
   ARRAY['IN_APP','EMAIL','PUSH'], ARRAY['IN_APP'], ARRAY['IN_APP'], false, '{{title}}', '{{body}}', '/m/admin-integrations', 'int:{{entityId}}', false)
ON CONFLICT ("code") DO NOTHING;
