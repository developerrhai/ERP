-- Phase 30: contract labour. Contractors, work orders, workers, onboarding checks, deployments, muster, wage sheets,
-- contractor bills, compliance months, minimum wages (needs_review rows), incidents. Forward-only and idempotent.

CREATE TABLE IF NOT EXISTS contractors (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code              text NOT NULL UNIQUE,
  name              text NOT NULL,
  legal_entity      text,
  pan               text CHECK (pan IS NULL OR pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  gstin             text,
  labour_licence_no text,
  licence_valid_until date,
  pf_code           text,
  esic_code         text,
  insurance_policy  text,
  insurance_expiry  date,
  agreement_no      text,
  agreement_start   date,
  agreement_end     date,
  contact_person    text,
  mobile            text,
  email             text,
  bank_account_last4 text,
  ifsc              text,
  risk_rating       text NOT NULL DEFAULT 'Medium' CHECK (risk_rating IN ('Low','Medium','High')),
  status            text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Suspended','Closed')),
  approval_status   text NOT NULL DEFAULT 'Pending' CHECK (approval_status IN ('Pending','Approved','Rejected')),
  supplier_id       uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by_id     uuid,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cl_work_orders (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id          uuid NOT NULL,
  number           text NOT NULL,
  contractor_id    uuid NOT NULL REFERENCES contractors(id),
  po_no            text,
  department       text,
  scope            text,
  skill_category   text NOT NULL DEFAULT 'Unskilled',
  required_headcount int NOT NULL CHECK (required_headcount > 0),
  rate_type        text NOT NULL DEFAULT 'DAILY' CHECK (rate_type IN ('DAILY','MONTHLY','PIECE')),
  rate             numeric(12,2) NOT NULL CHECK (rate >= 0),
  ot_rate          numeric(12,2),
  service_charge_pct numeric(5,2) NOT NULL DEFAULT 0,
  start_date       date NOT NULL,
  end_date         date NOT NULL,
  budget           numeric(14,2) NOT NULL DEFAULT 0,
  utilized         numeric(14,2) NOT NULL DEFAULT 0,
  balance          numeric(14,2) GENERATED ALWAYS AS (budget - utilized) STORED,
  status           text NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft','Active','Closed','Cancelled')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by_id    uuid,
  CONSTRAINT cl_wo_dates CHECK (end_date >= start_date)
);
CREATE UNIQUE INDEX IF NOT EXISTS cl_work_orders_no_uq ON cl_work_orders (unit_id, number);

CREATE TABLE IF NOT EXISTS cl_workers (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_no        text NOT NULL UNIQUE,
  name             text NOT NULL,
  contractor_id    uuid NOT NULL REFERENCES contractors(id),
  aadhaar_last4    text CHECK (aadhaar_last4 IS NULL OR aadhaar_last4 ~ '^[0-9]{4}$'),
  mobile           text,
  dob              date,
  gender           text CHECK (gender IN ('M','F','O')),
  skill_category   text NOT NULL DEFAULT 'Unskilled',
  trade            text,
  department       text,
  unit_id          uuid,
  joining_date     date,
  contract_end     date,
  wage_rate        numeric(12,2) NOT NULL DEFAULT 0,
  pf_uan           text,
  esic_ip_no       text,
  police_required  boolean NOT NULL DEFAULT false,
  biometric_code   text UNIQUE,
  photo_document_id uuid,
  status           text NOT NULL DEFAULT 'Registered' CHECK (status IN ('Registered','Deployed','Released','Blocked')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by_id    uuid
);

CREATE TABLE IF NOT EXISTS cl_onboarding_checks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id    uuid NOT NULL REFERENCES cl_workers(id) ON DELETE CASCADE,
  check_kind   text NOT NULL CHECK (check_kind IN ('KYC','MEDICAL','INDUCTION','POLICE','PPE','ID_CARD')),
  done_at      date NOT NULL DEFAULT CURRENT_DATE,
  valid_until  date,
  document_id  uuid,
  verified_by_id uuid,
  note         text,
  UNIQUE (worker_id, check_kind)
);

CREATE TABLE IF NOT EXISTS cl_deployments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id     uuid NOT NULL REFERENCES cl_workers(id),
  work_order_id uuid NOT NULL REFERENCES cl_work_orders(id),
  unit_id       uuid NOT NULL,
  department    text,
  from_date     date NOT NULL,
  to_date       date,
  released_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by_id uuid
);
CREATE INDEX IF NOT EXISTS cl_deployments_worker_idx ON cl_deployments (worker_id, from_date);
CREATE INDEX IF NOT EXISTS cl_deployments_wo_idx ON cl_deployments (work_order_id) WHERE released_at IS NULL;

CREATE TABLE IF NOT EXISTS cl_attendance (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id      uuid NOT NULL REFERENCES cl_workers(id),
  work_order_id  uuid,
  unit_id        uuid,
  att_date       date NOT NULL,
  punch_in       timestamptz,
  punch_out      timestamptz,
  regular_hours  numeric(5,2) NOT NULL DEFAULT 0,
  ot_hours       numeric(5,2) NOT NULL DEFAULT 0,
  status         text NOT NULL DEFAULT 'P' CHECK (status IN ('P','HD','A')),
  payable_days   numeric(3,1) NOT NULL DEFAULT 0,
  gate_match     boolean,
  supervisor_approved boolean NOT NULL DEFAULT false,
  remarks        text,
  UNIQUE (worker_id, att_date)
);
CREATE INDEX IF NOT EXISTS cl_attendance_date_idx ON cl_attendance (unit_id, att_date);

CREATE TABLE IF NOT EXISTS cl_min_wages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_category text NOT NULL,
  zone          text NOT NULL DEFAULT 'Maharashtra',
  daily_min     numeric(10,2) NOT NULL,
  effective_from date NOT NULL,
  law_basis     text,
  needs_review  boolean NOT NULL DEFAULT true,
  UNIQUE (skill_category, zone, effective_from)
);
INSERT INTO cl_min_wages (skill_category, zone, daily_min, effective_from, law_basis, needs_review) VALUES
  ('Unskilled', 'Maharashtra', 450, '2026-04-01', 'Minimum wages notification (Maharashtra) - confirm the current rate', true),
  ('Semi-skilled', 'Maharashtra', 500, '2026-04-01', 'Minimum wages notification (Maharashtra) - confirm the current rate', true),
  ('Skilled', 'Maharashtra', 560, '2026-04-01', 'Minimum wages notification (Maharashtra) - confirm the current rate', true),
  ('Highly skilled', 'Maharashtra', 620, '2026-04-01', 'Minimum wages notification (Maharashtra) - confirm the current rate', true)
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS cl_wage_sheets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id       uuid NOT NULL,
  month         text NOT NULL CHECK (month ~ '^\d{4}-\d{2}$'),
  contractor_id uuid NOT NULL REFERENCES contractors(id),
  status        text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','COMPUTED','LOCKED')),
  total_gross   numeric(14,2) NOT NULL DEFAULT 0,
  total_net     numeric(14,2) NOT NULL DEFAULT 0,
  computed_at   timestamptz,
  locked_at     timestamptz,
  locked_by_id  uuid,
  UNIQUE (unit_id, month, contractor_id)
);
CREATE TABLE IF NOT EXISTS cl_wage_lines (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sheet_id      uuid NOT NULL REFERENCES cl_wage_sheets(id) ON DELETE CASCADE,
  worker_id     uuid NOT NULL REFERENCES cl_workers(id),
  payable_days  numeric(5,1) NOT NULL,
  daily_rate    numeric(12,2) NOT NULL,
  basic_wages   numeric(12,2) NOT NULL,
  ot_hours      numeric(6,2) NOT NULL DEFAULT 0,
  ot_rate       numeric(12,2) NOT NULL DEFAULT 0,
  ot_amount     numeric(12,2) NOT NULL DEFAULT 0,
  allowance     numeric(12,2) NOT NULL DEFAULT 0,
  gross_wages   numeric(12,2) NOT NULL,
  pf_employee   numeric(12,2) NOT NULL DEFAULT 0,
  esic_employee numeric(12,2) NOT NULL DEFAULT 0,
  prof_tax      numeric(12,2) NOT NULL DEFAULT 0,
  other_deduction numeric(12,2) NOT NULL DEFAULT 0,
  total_deduction numeric(12,2) NOT NULL,
  net_pay       numeric(12,2) NOT NULL,
  UNIQUE (sheet_id, worker_id)
);

CREATE TABLE IF NOT EXISTS cl_invoices (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id        uuid NOT NULL,
  invoice_no     text NOT NULL,
  invoice_date   date NOT NULL,
  contractor_id  uuid NOT NULL REFERENCES contractors(id),
  work_order_id  uuid REFERENCES cl_work_orders(id),
  billing_month  text NOT NULL CHECK (billing_month ~ '^\d{4}-\d{2}$'),
  headcount      int NOT NULL DEFAULT 0,
  billed_man_days numeric(10,1) NOT NULL,
  basic_labour_value numeric(14,2) NOT NULL,
  ot_value       numeric(14,2) NOT NULL DEFAULT 0,
  service_charge_pct numeric(5,2) NOT NULL DEFAULT 0,
  service_charge numeric(14,2) NOT NULL DEFAULT 0,
  taxable_value  numeric(14,2) NOT NULL,
  gst_rate_pct   numeric(5,2) NOT NULL DEFAULT 18,
  gst_amount     numeric(14,2) NOT NULL,
  gross_invoice  numeric(14,2) NOT NULL,
  tds_pct        numeric(5,2) NOT NULL DEFAULT 1,
  tds_amount     numeric(14,2) NOT NULL DEFAULT 0,
  net_payable    numeric(14,2) NOT NULL DEFAULT 0,
  recon          jsonb,
  disputed_amount numeric(14,2) NOT NULL DEFAULT 0,
  approved_amount numeric(14,2) NOT NULL DEFAULT 0,
  status         text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','RECONCILED','PAYMENT_BLOCKED','APPROVED')),
  block_reason   text,
  approved_by_id uuid,
  approved_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by_id  uuid,
  UNIQUE (contractor_id, invoice_no)
);

CREATE TABLE IF NOT EXISTS cl_compliance_months (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id        uuid NOT NULL,
  contractor_id  uuid NOT NULL REFERENCES contractors(id),
  month          text NOT NULL CHECK (month ~ '^\d{4}-\d{2}$'),
  score_pct      numeric(5,2) NOT NULL DEFAULT 0,
  risk_level     text NOT NULL DEFAULT 'High',
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (unit_id, contractor_id, month)
);
CREATE TABLE IF NOT EXISTS cl_compliance_docs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  compliance_id  uuid NOT NULL REFERENCES cl_compliance_months(id) ON DELETE CASCADE,
  kind           text NOT NULL CHECK (kind IN ('PF_ECR','PF_CHALLAN','ESIC_CHALLAN','MUSTER_ROLL','WAGE_REGISTER','BANK_PROOF','BONUS_REGISTER','RETURN_FILED')),
  document_id    uuid,
  reference      text,
  uploaded_at    timestamptz NOT NULL DEFAULT now(),
  uploaded_by_id uuid,
  verified_by_id uuid,
  verified_at    timestamptz,
  UNIQUE (compliance_id, kind)
);

CREATE TABLE IF NOT EXISTS cl_incidents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id       uuid NOT NULL,
  incident_no   text NOT NULL,
  incident_date date NOT NULL,
  worker_id     uuid,
  contractor_id uuid,
  severity      text NOT NULL CHECK (severity IN ('Near miss','Minor','Major','Fatal')),
  description   text NOT NULL,
  lost_time_hours numeric(6,1) NOT NULL DEFAULT 0,
  status        text NOT NULL DEFAULT 'Open' CHECK (status IN ('Open','Investigating','Closed')),
  capa_id       uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by_id uuid,
  UNIQUE (unit_id, incident_no)
);

INSERT INTO "notification_types"
  ("code", "module", "category", "label", "label_hi", "priority", "enabled",
   "allowed_channels", "default_channels", "mandatory_channels", "sensitive",
   "title_tpl", "body_tpl", "deep_link_tpl", "collapse_key_tpl", "digest_allowed")
VALUES
  ('cl.payment_blocked', 'Contract labour', 'ALERT', 'A contractor payment is blocked', 'ठेकेदार भुगतान रुका', 'HIGH', true, ARRAY['IN_APP','EMAIL','PUSH'], ARRAY['IN_APP'], ARRAY['IN_APP'], false, '{{title}}', '{{body}}', '/m/cl-invoices', 'cl:{{entityId}}', false),
  ('cl.budget', 'Contract labour', 'ALERT', 'A work order budget is nearly used', 'कार्य आदेश बजट', 'NORMAL', true, ARRAY['IN_APP','EMAIL'], ARRAY['IN_APP'], ARRAY['IN_APP'], false, '{{title}}', '{{body}}', '/m/cl-workorders', 'cl:{{entityId}}', true)
ON CONFLICT ("code") DO NOTHING;
