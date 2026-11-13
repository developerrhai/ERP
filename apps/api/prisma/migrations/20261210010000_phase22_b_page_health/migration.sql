-- Phase 22-E/B: crawler results (page_health) and the history of registry v2 (registry_snapshots).
-- No business table changes.

CREATE TABLE IF NOT EXISTS "page_health" (
  "page_id"     varchar(64)  NOT NULL,
  "role_code"   varchar(32)  NOT NULL,
  "unit_combo"  varchar(64)  NOT NULL,
  "run_id"      uuid         NOT NULL,
  "status"      varchar(8)   NOT NULL CHECK ("status" IN ('OK', 'ERROR')),
  "error_kind"  varchar(24)  CHECK ("error_kind" IN ('CONSOLE', 'PAGE_ERROR', 'HTTP', 'FORBIDDEN_TEXT', 'NO_ACTIONBAR', 'TIMEOUT', 'OTHER')),
  "error_text"  text,
  "p95_ms"      int,
  "checked_at"  timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("page_id", "role_code", "unit_combo", "run_id"),
  CHECK (("status" = 'OK') = ("error_kind" IS NULL))
);
CREATE INDEX IF NOT EXISTS "page_health_run_idx" ON "page_health" ("run_id", "status");
CREATE INDEX IF NOT EXISTS "page_health_checked_idx" ON "page_health" ("checked_at" DESC);

CREATE TABLE IF NOT EXISTS "registry_snapshots" (
  "version"      int          PRIMARY KEY,
  "sha256"       char(64)     NOT NULL UNIQUE,
  "generated_at" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "pages_count"  int          NOT NULL,
  "json"         jsonb        NOT NULL
);

-- Crawler failures in CI notify the Administrators once a day (deduped by the importer).
INSERT INTO "notification_types"
  ("code", "module", "category", "label", "label_hi", "priority", "enabled",
   "allowed_channels", "default_channels", "mandatory_channels", "sensitive",
   "title_tpl", "body_tpl", "deep_link_tpl", "collapse_key_tpl", "digest_allowed")
VALUES
  ('system.page_health', 'System', 'ALERT', 'Page health check failed', 'पेज हेल्थ जांच विफल',
   'HIGH', true, ARRAY['IN_APP','EMAIL'], ARRAY['IN_APP'], ARRAY['IN_APP'], false,
   '{{title}}', '{{body}}', '/m/admin-page-health', 'page_health:{{entityId}}', false)
ON CONFLICT ("code") DO NOTHING;
