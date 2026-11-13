-- Phase 31: owner and admin control. Custom fields, form rules, modules per plant and role, login policies, View-as, API keys.
-- Forward-only and idempotent.

CREATE TABLE IF NOT EXISTS custom_field_defs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id     text NOT NULL,
  key         text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  label       text NOT NULL,
  label_hi    text,
  type        text NOT NULL CHECK (type IN ('text','number','decimal','date','bool','select','multiselect','lookup','file')),
  options     jsonb NOT NULL DEFAULT '[]'::jsonb,
  lookup_kind text CHECK (lookup_kind IS NULL OR lookup_kind IN ('customer','supplier','item','employee','project','plant')),
  required    boolean NOT NULL DEFAULT false,
  default_value text,
  help        text,
  unit_ids    uuid[] NOT NULL DEFAULT '{}',
  role_ids    uuid[] NOT NULL DEFAULT '{}',
  in_list     boolean NOT NULL DEFAULT false,
  in_filter   boolean NOT NULL DEFAULT false,
  in_pdf      boolean NOT NULL DEFAULT true,
  in_excel    boolean NOT NULL DEFAULT true,
  in_import   boolean NOT NULL DEFAULT true,
  sort        int NOT NULL DEFAULT 0,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by_id uuid,
  UNIQUE (page_id, key)
);
CREATE TABLE IF NOT EXISTS custom_field_values (
  page_id   text NOT NULL,
  record_id uuid NOT NULL,
  key       text NOT NULL,
  value     jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by_id uuid,
  PRIMARY KEY (page_id, record_id, key)
);
CREATE INDEX IF NOT EXISTS custom_field_values_gin ON custom_field_values USING gin (value);

CREATE TABLE IF NOT EXISTS form_rules (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id   text NOT NULL,
  role_id   uuid,
  status    text,
  unit_id   uuid,
  field_key text NOT NULL,
  effect    text NOT NULL CHECK (effect IN ('HIDDEN','READONLY','REQUIRED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_id uuid
);
CREATE UNIQUE INDEX IF NOT EXISTS form_rules_uq ON form_rules (page_id, field_key, effect, coalesce(role_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(status, ''), coalesce(unit_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- a module switched off for one plant (and optionally one role); an "on" row can re-enable it for a narrower scope
CREATE TABLE IF NOT EXISTS module_plant_controls (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id  text NOT NULL,
  unit_id  uuid NOT NULL,
  role_id  uuid,
  enabled  boolean NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by_id uuid
);
CREATE UNIQUE INDEX IF NOT EXISTS module_plant_controls_uq ON module_plant_controls (page_id, unit_id, coalesce(role_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE TABLE IF NOT EXISTS role_login_policies (
  role_id        uuid PRIMARY KEY,
  hours_from     time,
  hours_to       time,
  ip_cidrs       text[] NOT NULL DEFAULT '{}',
  mfa_required   boolean NOT NULL DEFAULT false,
  inactive_days  int CHECK (inactive_days IS NULL OR inactive_days BETWEEN 1 AND 3650),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by_id  uuid,
  CHECK ((hours_from IS NULL) = (hours_to IS NULL))
);

CREATE TABLE IF NOT EXISTS view_as_sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL,
  target_user_id uuid NOT NULL,
  reason        text NOT NULL CHECK (length(btrim(reason)) >= 5),
  started_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  ended_at      timestamptz
);
CREATE INDEX IF NOT EXISTS view_as_owner_idx ON view_as_sessions (owner_user_id, started_at DESC);

CREATE TABLE IF NOT EXISTS api_keys (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  prefix        text NOT NULL UNIQUE,
  key_hash      text NOT NULL,
  scopes        text[] NOT NULL DEFAULT '{}',
  unit_ids      uuid[] NOT NULL DEFAULT '{}',
  expires_at    timestamptz,
  last_used_at  timestamptz,
  revoked_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by_id uuid
);
