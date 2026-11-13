-- Phase 28: attendance automation. Device push and agents, policies, automatic actions with reasons, alerts, live presence, mobile punch, auto-lock.
-- Forward-only and idempotent. The Phase 15 tables are only extended.

-- 1. Devices: how they connect and whether they are alive.
ALTER TABLE attendance_devices ADD COLUMN IF NOT EXISTS connection text NOT NULL DEFAULT 'MANUAL' CHECK (connection IN ('PUSH','AGENT','MANUAL'));
ALTER TABLE attendance_devices ADD COLUMN IF NOT EXISTS agent_id uuid;
ALTER TABLE attendance_devices ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;
ALTER TABLE attendance_devices ADD COLUMN IF NOT EXISTS last_punch_at timestamptz;
ALTER TABLE attendance_devices ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'OFFLINE' CHECK (status IN ('ONLINE','STALE','OFFLINE'));
ALTER TABLE attendance_devices ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'Asia/Kolkata';
CREATE UNIQUE INDEX IF NOT EXISTS attendance_devices_serial_uq ON attendance_devices (serial_no) WHERE serial_no IS NOT NULL AND active;

CREATE TABLE IF NOT EXISTS attendance_agents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id       uuid NOT NULL,
  name          text NOT NULL,
  key_hash      text NOT NULL,
  last_seen_at  timestamptz,
  version       text,
  status        text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','REVOKED')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by_id uuid
);

CREATE TABLE IF NOT EXISTS device_sync_logs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id      uuid,
  agent_id       uuid,
  unit_id        uuid,
  at             timestamptz NOT NULL DEFAULT now(),
  received       int NOT NULL DEFAULT 0,
  inserted       int NOT NULL DEFAULT 0,
  duplicates     int NOT NULL DEFAULT 0,
  unknown_codes  int NOT NULL DEFAULT 0,
  error          text
);
CREATE INDEX IF NOT EXISTS device_sync_logs_device_idx ON device_sync_logs (device_id, at DESC);

-- Automatic deductions are kept in columns (the Phase 15 engine owns the flags array and rewrites it).
ALTER TABLE attendance_days ADD COLUMN IF NOT EXISTS auto_lop numeric(4,2) NOT NULL DEFAULT 0;
ALTER TABLE attendance_days ADD COLUMN IF NOT EXISTS auto_hd boolean NOT NULL DEFAULT false;

-- 2. Policies (unit_id NULL = every plant; category ALL = every kind of employee).
CREATE TABLE IF NOT EXISTS attendance_policies (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id        uuid,
  category       text NOT NULL DEFAULT 'ALL' CHECK (category IN ('ALL','WORKER','STAFF','CONTRACT')),
  policy_key     text NOT NULL CHECK (policy_key IN ('LATE_MARK','MISSED_PUNCH','AUTO_ABSENT','AUTO_LEAVE','AUTO_OT','AUTO_COMPOFF','AUTO_SHIFT','MOBILE_PUNCH','BUDDY_ALERT','AUTO_LOCK')),
  enabled        boolean NOT NULL,
  params         jsonb NOT NULL DEFAULT '{}'::jsonb,
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by_id  uuid
);
CREATE UNIQUE INDEX IF NOT EXISTS attendance_policies_uq ON attendance_policies (coalesce(unit_id, '00000000-0000-0000-0000-000000000000'::uuid), category, policy_key);

INSERT INTO attendance_policies (policy_key, enabled, params) VALUES
  ('LATE_MARK',    false, '{"lates":3,"deductDays":0.5}'),
  ('MISSED_PUNCH', true,  '{"days":3}'),
  ('AUTO_ABSENT',  true,  '{"afterShiftEndHours":2}'),
  ('AUTO_LEAVE',   false, '{}'),
  ('AUTO_OT',      true,  '{}'),
  ('AUTO_COMPOFF', true,  '{}'),
  ('AUTO_SHIFT',   false, '{"withinMinutes":90}'),
  ('MOBILE_PUNCH', false, '{"maxAccuracyM":100,"requireSelfie":false}'),
  ('BUDDY_ALERT',  true,  '{"seconds":3,"times":3}'),
  ('AUTO_LOCK',    true,  '{"day":2,"hour":18}')
ON CONFLICT DO NOTHING;

-- 3. Automatic actions (each with a reason, reversible by HR) and alerts.
CREATE TABLE IF NOT EXISTS attendance_auto_actions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id    uuid NOT NULL,
  unit_id        uuid,
  action_date    date NOT NULL,
  policy_key     text NOT NULL,
  action         text NOT NULL CHECK (action IN ('MARK_HD','MARK_LOP','MARK_A','CREATE_LEAVE_REQ','CREATE_OT_REQ','OFFER_COMPOFF','SHIFT_ASSIGNED','LOCKED')),
  before_json    jsonb,
  after_json     jsonb,
  reason         text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  reversed_by_id uuid,
  reversed_at    timestamptz,
  reverse_reason text
);
CREATE UNIQUE INDEX IF NOT EXISTS attendance_auto_actions_uq ON attendance_auto_actions (employee_id, action_date, policy_key, action);
CREATE INDEX IF NOT EXISTS attendance_auto_actions_unit_idx ON attendance_auto_actions (unit_id, action_date DESC);

CREATE TABLE IF NOT EXISTS attendance_alerts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id   uuid,
  unit_id       uuid,
  alert_date    date NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('MISSED_PUNCH','LATE','ABSENT','OT_PENDING','BUDDY','DEVICE_OFFLINE','DEVICE_STALE')),
  ref           text NOT NULL DEFAULT '',
  detail        text,
  sent_channels text[] NOT NULL DEFAULT '{}',
  status        text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','SENT','CLOSED')),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS attendance_alerts_uq ON attendance_alerts (coalesce(employee_id, '00000000-0000-0000-0000-000000000000'::uuid), alert_date, kind, ref);

-- 4. Mobile punch.
CREATE TABLE IF NOT EXISTS geo_sites (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id   uuid NOT NULL,
  name      text NOT NULL,
  lat       double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng       double precision NOT NULL CHECK (lng BETWEEN -180 AND 180),
  radius_m  int NOT NULL CHECK (radius_m BETWEEN 10 AND 5000),
  active    boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS mobile_punches (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id    uuid NOT NULL,
  at             timestamptz NOT NULL DEFAULT now(),
  lat            double precision,
  lng            double precision,
  accuracy_m     double precision,
  site_id        uuid,
  inside         boolean NOT NULL,
  distance_m     double precision,
  selfie_document_id uuid,
  device_info    text
);
CREATE INDEX IF NOT EXISTS mobile_punches_emp_idx ON mobile_punches (employee_id, at DESC);

-- 5. Live presence (who is inside now), kept per punch.
CREATE TABLE IF NOT EXISTS live_presence (
  unit_id       uuid NOT NULL,
  employee_id   uuid NOT NULL,
  department    text,
  status        text NOT NULL CHECK (status IN ('INSIDE','OUT')),
  last_punch_at timestamptz NOT NULL,
  PRIMARY KEY (unit_id, employee_id)
);
CREATE INDEX IF NOT EXISTS live_presence_status_idx ON live_presence (unit_id, status);

-- 6. Notification types.
INSERT INTO "notification_types"
  ("code", "module", "category", "label", "label_hi", "priority", "enabled",
   "allowed_channels", "default_channels", "mandatory_channels", "sensitive",
   "title_tpl", "body_tpl", "deep_link_tpl", "collapse_key_tpl", "digest_allowed")
VALUES
  ('attendance.missed_punch', 'HR', 'ALERT', 'Missed punch', 'छूटी हुई पंच', 'NORMAL', true,
   ARRAY['IN_APP','EMAIL','PUSH'], ARRAY['IN_APP'], ARRAY['IN_APP'], false, '{{title}}', '{{body}}', '/m/hr-ess', 'att:{{entityId}}', true),
  ('attendance.auto_action', 'HR', 'DOCUMENT', 'Automatic attendance change', 'स्वचालित उपस्थिति परिवर्तन', 'NORMAL', true,
   ARRAY['IN_APP','EMAIL'], ARRAY['IN_APP'], ARRAY['IN_APP'], false, '{{title}}', '{{body}}', '/m/hr-attendance', 'att:{{entityId}}', true),
  ('attendance.device', 'HR', 'ALERT', 'Attendance device alert', 'उपस्थिति डिवाइस अलर्ट', 'HIGH', true,
   ARRAY['IN_APP','EMAIL','PUSH'], ARRAY['IN_APP'], ARRAY['IN_APP'], false, '{{title}}', '{{body}}', '/m/hr-attendance-devices', 'dev:{{entityId}}', false),
  ('attendance.ot_request', 'HR', 'DOCUMENT', 'Overtime to approve', 'ओवरटाइम स्वीकृति', 'NORMAL', true,
   ARRAY['IN_APP','EMAIL'], ARRAY['IN_APP'], ARRAY['IN_APP'], false, '{{title}}', '{{body}}', '/m/hr-attendance', 'ot:{{entityId}}', true),
  ('attendance.locked', 'HR', 'DOCUMENT', 'Attendance locked', 'उपस्थिति लॉक', 'NORMAL', true,
   ARRAY['IN_APP','EMAIL'], ARRAY['IN_APP'], ARRAY['IN_APP'], false, '{{title}}', '{{body}}', '/m/hr-attendance', 'lock:{{entityId}}', true)
ON CONFLICT ("code") DO NOTHING;

-- 7. The mail automations that now run by themselves (#31 missed punch, #32 daily attendance report).
UPDATE mail_automation_library SET wired = true WHERE code IN ('missed_punch', 'daily_attendance');
UPDATE mail_automation_library SET trigger_kind = 'SCHEDULE', run_time = '10:00', trigger_text = 'Next morning 10:00 after a missed punch' WHERE code = 'missed_punch';
