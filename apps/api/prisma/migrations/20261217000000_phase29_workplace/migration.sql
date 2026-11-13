-- Phase 29: workplace operations. Tasks, shift handover, visitors, canteen. Forward-only and idempotent.

-- 1. Tasks (separate from the Phase 17 project tasks).
CREATE TABLE IF NOT EXISTS tasks (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id          uuid NOT NULL,
  fy_id            uuid,
  task_no          text NOT NULL,
  title            text NOT NULL,
  description      text,
  department       text,
  assigned_to_id   uuid,
  assigned_by_id   uuid NOT NULL,
  priority         text NOT NULL DEFAULT 'Medium' CHECK (priority IN ('Low','Medium','High','Critical')),
  start_date       date,
  due_date         date,
  progress_pct     int NOT NULL DEFAULT 0 CHECK (progress_pct BETWEEN 0 AND 100),
  status           text NOT NULL DEFAULT 'Open' CHECK (status IN ('Open','In Progress','Blocked','Done','Approved','Cancelled')),
  approval_required boolean NOT NULL DEFAULT false,
  approval_status  text NOT NULL DEFAULT 'None' CHECK (approval_status IN ('None','Pending','Approved')),
  project_id       uuid,
  linked_doc_type  text,
  linked_doc_id    uuid,
  recurrence       jsonb,
  is_template      boolean NOT NULL DEFAULT false,
  parent_task_id   uuid REFERENCES tasks(id),
  remarks          text,
  done_at          timestamptz,
  approved_at      timestamptz,
  approved_by_id   uuid,
  version          int NOT NULL DEFAULT 1,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS tasks_no_uq ON tasks (unit_id, task_no);
CREATE UNIQUE INDEX IF NOT EXISTS tasks_recurrence_uq ON tasks (parent_task_id, due_date) WHERE parent_task_id IS NOT NULL AND due_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS tasks_assignee_idx ON tasks (assigned_to_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS tasks_unit_due_idx ON tasks (unit_id, due_date) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS ops_task_dependencies (
  pred_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  succ_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  PRIMARY KEY (pred_id, succ_id),
  CHECK (pred_id <> succ_id)
);
CREATE TABLE IF NOT EXISTS task_checklist (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id    uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  seq        int NOT NULL,
  text       text NOT NULL,
  done       boolean NOT NULL DEFAULT false,
  done_by_id uuid,
  done_at    timestamptz
);
CREATE TABLE IF NOT EXISTS task_comments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id    uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL,
  body       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 2. Shift handover.
CREATE TABLE IF NOT EXISTS shift_handovers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id         uuid NOT NULL,
  department      text NOT NULL,
  handover_date   date NOT NULL,
  from_shift_id   uuid,
  to_shift_id     uuid,
  outgoing_user_id uuid NOT NULL,
  incoming_user_id uuid,
  lines           jsonb NOT NULL DEFAULT '[]'::jsonb,
  issues          text,
  safety_note     text,
  pending_jobs    jsonb NOT NULL DEFAULT '[]'::jsonb,
  materials_short text,
  status          text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SUBMITTED','ACCEPTED','REJECTED')),
  submitted_at    timestamptz,
  accept_by       timestamptz,
  accepted_at     timestamptz,
  reject_reason   text,
  late_alerted_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shift_handovers_unit_idx ON shift_handovers (unit_id, handover_date DESC);

-- 3. Visitors.
CREATE TABLE IF NOT EXISTS visitor_passes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id         uuid NOT NULL,
  fy_id           uuid,
  pass_no         text NOT NULL,
  visitor_name    text NOT NULL,
  mobile          text,
  company         text,
  host_user_id    uuid NOT NULL,
  department      text,
  visit_date      date NOT NULL,
  planned_in      timestamptz,
  planned_out     timestamptz,
  purpose         text NOT NULL,
  vehicle_no      text,
  id_type         text,
  id_last4        text CHECK (id_last4 IS NULL OR id_last4 ~ '^[0-9A-Za-z]{4}$'),
  photo_document_id uuid,
  items           jsonb NOT NULL DEFAULT '[]'::jsonb,
  status          text NOT NULL DEFAULT 'PRE_REGISTERED' CHECK (status IN ('PRE_REGISTERED','APPROVED','INSIDE','OUT','REJECTED','NO_SHOW','CANCELLED')),
  approved_by_id  uuid,
  approved_at     timestamptz,
  in_time         timestamptz,
  out_time        timestamptz,
  gate_pass_id    uuid,
  qr_token_hash   text,
  overstay_alerted_at timestamptz,
  anonymised_at   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by_id   uuid
);
CREATE UNIQUE INDEX IF NOT EXISTS visitor_passes_no_uq ON visitor_passes (unit_id, pass_no);
CREATE INDEX IF NOT EXISTS visitor_passes_status_idx ON visitor_passes (unit_id, status, visit_date);

-- 4. Canteen.
CREATE TABLE IF NOT EXISTS canteen_meal_types (
  code  text PRIMARY KEY,
  name  text NOT NULL,
  sort  int NOT NULL DEFAULT 0
);
INSERT INTO canteen_meal_types (code, name, sort) VALUES ('BREAKFAST','Breakfast',1), ('LUNCH','Lunch',2), ('DINNER','Dinner',3), ('TEA','Tea / Snacks',4) ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS canteen_rates (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id             uuid NOT NULL,
  meal_type           text NOT NULL REFERENCES canteen_meal_types(code),
  rate                numeric(10,2) NOT NULL CHECK (rate >= 0),
  gst_pct             numeric(5,2) NOT NULL DEFAULT 5 CHECK (gst_pct BETWEEN 0 AND 28),
  employee_share_pct  numeric(5,2) NOT NULL DEFAULT 40 CHECK (employee_share_pct BETWEEN 0 AND 100),
  effective_from      date NOT NULL DEFAULT CURRENT_DATE,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by_id       uuid
);
CREATE UNIQUE INDEX IF NOT EXISTS canteen_rates_uq ON canteen_rates (unit_id, meal_type, effective_from);

CREATE TABLE IF NOT EXISTS canteen_entitlements (
  unit_id   uuid NOT NULL,
  shift_id  uuid NOT NULL,
  meal_type text NOT NULL REFERENCES canteen_meal_types(code),
  PRIMARY KEY (unit_id, shift_id, meal_type)
);

CREATE TABLE IF NOT EXISTS canteen_coupons (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id        uuid NOT NULL,
  coupon_no      text NOT NULL,
  person_kind    text NOT NULL CHECK (person_kind IN ('EMPLOYEE','CONTRACT','VISITOR')),
  person_id      uuid NOT NULL,
  person_name    text,
  date           date NOT NULL,
  meal_type      text NOT NULL REFERENCES canteen_meal_types(code),
  seq            int NOT NULL DEFAULT 1,
  qty            int NOT NULL DEFAULT 1,
  rate           numeric(10,2) NOT NULL,
  gst            numeric(10,2) NOT NULL,
  total          numeric(10,2) NOT NULL,
  employee_share numeric(10,2) NOT NULL,
  company_share  numeric(10,2) NOT NULL,
  payment_mode   text NOT NULL DEFAULT 'PAYROLL' CHECK (payment_mode IN ('PAYROLL','CASH','FREE')),
  status         text NOT NULL DEFAULT 'SERVED' CHECK (status IN ('SERVED','CANCELLED')),
  served_at      timestamptz NOT NULL DEFAULT now(),
  served_by_id   uuid
);
CREATE UNIQUE INDEX IF NOT EXISTS canteen_coupons_no_uq ON canteen_coupons (unit_id, coupon_no);
CREATE UNIQUE INDEX IF NOT EXISTS canteen_coupons_once_uq ON canteen_coupons (person_kind, person_id, date, meal_type, seq) WHERE status = 'SERVED';
CREATE INDEX IF NOT EXISTS canteen_coupons_month_idx ON canteen_coupons (unit_id, date);

CREATE TABLE IF NOT EXISTS canteen_waste (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id   uuid NOT NULL,
  date      date NOT NULL,
  meal_type text NOT NULL REFERENCES canteen_meal_types(code),
  kg        numeric(8,2) NOT NULL CHECK (kg >= 0),
  reason    text,
  created_by_id uuid
);
CREATE TABLE IF NOT EXISTS canteen_months (
  unit_id     uuid NOT NULL,
  month       text NOT NULL CHECK (month ~ '^\d{4}-\d{2}$'),
  status      text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED')),
  meals       int,
  employee_total numeric(12,2),
  company_total  numeric(12,2),
  closed_at   timestamptz,
  closed_by_id uuid,
  PRIMARY KEY (unit_id, month)
);
CREATE TABLE IF NOT EXISTS canteen_vendor_bills (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id         uuid NOT NULL,
  month           text NOT NULL,
  supplier_id     uuid,
  vendor_name     text,
  meals_billed    int NOT NULL CHECK (meals_billed >= 0),
  meals_served    int NOT NULL,
  variance_pct    numeric(6,2) NOT NULL,
  needs_approval  boolean NOT NULL,
  status          text NOT NULL DEFAULT 'OK' CHECK (status IN ('OK','PENDING_APPROVAL','APPROVED')),
  approved_by_id  uuid,
  approved_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by_id   uuid
);

-- 5. The payroll component that carries the employee share of the canteen.
INSERT INTO pay_components (code, name, kind, calc_type, taxable, payslip_order, active)
SELECT 'CANTEEN_DED', 'Canteen deduction', 'DEDUCTION', 'INPUT', false, 85, true
 WHERE NOT EXISTS (SELECT 1 FROM pay_components WHERE code = 'CANTEEN_DED');

-- 6. Notification types.
INSERT INTO "notification_types"
  ("code", "module", "category", "label", "label_hi", "priority", "enabled",
   "allowed_channels", "default_channels", "mandatory_channels", "sensitive",
   "title_tpl", "body_tpl", "deep_link_tpl", "collapse_key_tpl", "digest_allowed")
VALUES
  ('task.assigned', 'Tasks', 'DOCUMENT', 'A task was assigned to you', 'आपको कार्य सौंपा गया', 'NORMAL', true, ARRAY['IN_APP','EMAIL','PUSH'], ARRAY['IN_APP'], ARRAY['IN_APP'], false, '{{title}}', '{{body}}', '/m/ops-tasks', 'task:{{entityId}}', true),
  ('task.overdue', 'Tasks', 'ALERT', 'A task is overdue', 'कार्य में देरी', 'HIGH', true, ARRAY['IN_APP','EMAIL','PUSH'], ARRAY['IN_APP'], ARRAY['IN_APP'], false, '{{title}}', '{{body}}', '/m/ops-tasks', 'task:{{entityId}}', true),
  ('task.approval', 'Tasks', 'DOCUMENT', 'A task is waiting for approval', 'कार्य स्वीकृति हेतु', 'NORMAL', true, ARRAY['IN_APP','EMAIL'], ARRAY['IN_APP'], ARRAY['IN_APP'], false, '{{title}}', '{{body}}', '/m/ops-tasks', 'task:{{entityId}}', true),
  ('handover.submitted', 'Shift', 'DOCUMENT', 'A shift handover is waiting for you', 'शिफ्ट हैंडओवर', 'HIGH', true, ARRAY['IN_APP','EMAIL','PUSH'], ARRAY['IN_APP'], ARRAY['IN_APP'], false, '{{title}}', '{{body}}', '/m/ops-shift-roster', 'ho:{{entityId}}', false),
  ('handover.late', 'Shift', 'ALERT', 'A shift handover was not accepted', 'हैंडओवर स्वीकार नहीं', 'HIGH', true, ARRAY['IN_APP','EMAIL','PUSH'], ARRAY['IN_APP'], ARRAY['IN_APP'], false, '{{title}}', '{{body}}', '/m/ops-shift-roster', 'ho:{{entityId}}', false),
  ('visitor.approval', 'Visitors', 'DOCUMENT', 'A visitor needs your approval', 'आगंतुक की स्वीकृति', 'NORMAL', true, ARRAY['IN_APP','EMAIL','PUSH'], ARRAY['IN_APP'], ARRAY['IN_APP'], false, '{{title}}', '{{body}}', '/m/ops-visitors', 'vis:{{entityId}}', false),
  ('visitor.arrived', 'Visitors', 'DOCUMENT', 'Your visitor has arrived', 'आपका आगंतुक आ गया', 'HIGH', true, ARRAY['IN_APP','EMAIL','PUSH'], ARRAY['IN_APP'], ARRAY['IN_APP'], false, '{{title}}', '{{body}}', '/m/ops-visitors', 'vis:{{entityId}}', false),
  ('visitor.overstay', 'Visitors', 'ALERT', 'A visitor has overstayed', 'आगंतुक अधिक रुका', 'HIGH', true, ARRAY['IN_APP','EMAIL','PUSH'], ARRAY['IN_APP'], ARRAY['IN_APP'], false, '{{title}}', '{{body}}', '/m/ops-visitors', 'vis:{{entityId}}', false),
  ('canteen.closed', 'Canteen', 'DOCUMENT', 'Canteen month closed', 'कैंटीन माह बंद', 'NORMAL', true, ARRAY['IN_APP','EMAIL'], ARRAY['IN_APP'], ARRAY['IN_APP'], false, '{{title}}', '{{body}}', '/m/ops-canteen', 'can:{{entityId}}', true)
ON CONFLICT ("code") DO NOTHING;
