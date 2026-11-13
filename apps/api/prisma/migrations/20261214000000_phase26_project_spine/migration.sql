-- Phase 26: project spine, stage gates, specs / tests / documents, sales enquiries, process exceptions, 360 cache.
-- Forward-only and idempotent (IF NOT EXISTS / ON CONFLICT). No existing column is changed.

-- 1. project_id on the document headers (optional, indexed).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'sales_quotations','sales_orders','sales_dispatches','sales_invoices','sales_returns',
    'purchase_requisitions','rfqs','purchase_orders','goods_receipts','purchase_invoices',
    'stock_vouchers','mfg_orders','qms_inspections','gate_passes','shipments','service_tickets'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES projects(id)', t);
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (project_id) WHERE project_id IS NOT NULL', t || '_project_idx', t);
    END IF;
  END LOOP;
END $$;

-- 2. Project events (timeline). source_event_id makes the feed idempotent.
CREATE TABLE IF NOT EXISTS project_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES projects(id),
  unit_id         uuid,
  at              timestamptz NOT NULL DEFAULT now(),
  department_id   uuid,
  actor_id        uuid,
  kind            text NOT NULL CHECK (kind IN ('DOC_CREATED','MOVED','RECEIVED','ACCEPTED','RETURNED','SUBMITTED','APPROVED','REJECTED','POSTED','CANCELLED','GATE_OPENED','GATE_APPROVED','NOTE','ATTACHMENT','EXCEPTION')),
  doc_type        text,
  doc_id          uuid,
  doc_no          text,
  text            text,
  source_event_id text UNIQUE
);
CREATE INDEX IF NOT EXISTS project_events_project_at_idx ON project_events (project_id, at DESC);

-- 3. Gate templates and project gates.
CREATE TABLE IF NOT EXISTS gate_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE,
  name        text NOT NULL,
  description text,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS gate_template_steps (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id          uuid NOT NULL REFERENCES gate_templates(id) ON DELETE CASCADE,
  seq                  int NOT NULL,
  code                 text NOT NULL,
  name                 text NOT NULL,
  owner_department_id  uuid,
  deliverable_name     text,
  deliverable_doc_type text,
  exit_criteria        text,
  linked_page          text,
  depends_on           text[] NOT NULL DEFAULT '{}',
  UNIQUE (template_id, code)
);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS gate_template_id uuid REFERENCES gate_templates(id);

CREATE TABLE IF NOT EXISTS project_gates (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  step_id             uuid REFERENCES gate_template_steps(id),
  seq                 int NOT NULL,
  code                text NOT NULL,
  name                text NOT NULL,
  owner_department_id uuid,
  deliverable_name    text,
  deliverable_doc_type text,
  exit_criteria       text,
  depends_on          text[] NOT NULL DEFAULT '{}',
  state               text NOT NULL DEFAULT 'LOCKED' CHECK (state IN ('LOCKED','OPEN','IN_WORK','SUBMITTED','APPROVED','REJECTED')),
  deliverable_doc_id  uuid,
  approval_request_id uuid,
  reject_comment      text,
  opened_at           timestamptz,
  submitted_at        timestamptz,
  approved_at         timestamptz,
  due_date            date,
  late                boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, code)
);
CREATE INDEX IF NOT EXISTS project_gates_project_idx ON project_gates (project_id, seq);

-- 4. Specifications, tests, documents.
CREATE TABLE IF NOT EXISTS project_specs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  spec_no     text NOT NULL,
  parameter   text NOT NULL,
  target      numeric(18,4),
  tol_minus   numeric(18,4),
  tol_plus    numeric(18,4),
  unit        text,
  revision    int NOT NULL DEFAULT 1,
  status      text NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft','Approved','Superseded')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by_id uuid,
  UNIQUE (project_id, spec_no, revision)
);
CREATE TABLE IF NOT EXISTS project_tests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  gate_id      uuid REFERENCES project_gates(id),
  test_name    text NOT NULL,
  method       text,
  spec_id      uuid REFERENCES project_specs(id),
  sample       text,
  value        numeric(18,4),
  result       text CHECK (result IN ('OK','NG')),
  report_doc_id uuid,
  tested_by_id uuid,
  tested_at    timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS project_tests_project_idx ON project_tests (project_id);
CREATE TABLE IF NOT EXISTS project_documents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  gate_id     uuid REFERENCES project_gates(id),
  doc_type    text NOT NULL,
  title       text NOT NULL,
  revision    int NOT NULL DEFAULT 1,
  document_id uuid,
  status      text NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft','Approved','Superseded')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by_id uuid
);
CREATE INDEX IF NOT EXISTS project_documents_project_idx ON project_documents (project_id);

-- 5. Sales enquiries.
CREATE TABLE IF NOT EXISTS sales_enquiries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id         uuid NOT NULL,
  fy_id           uuid,
  number          text NOT NULL,
  enq_date        date NOT NULL DEFAULT CURRENT_DATE,
  customer_id     uuid REFERENCES customers(id),
  prospect_name   text,
  contact         text,
  product         text NOT NULL,
  application     text,
  qty             numeric(18,3),
  required_date   date,
  urs_document_id uuid,
  source          text,
  assigned_to_id  uuid,
  status          text NOT NULL DEFAULT 'New' CHECK (status IN ('New','Qualified','Quoted','Won','Lost')),
  lost_reason     text,
  quotation_id    uuid,
  project_id      uuid REFERENCES projects(id),
  project_template text CHECK (project_template IN ('BLDC','SPPM','CUSTOM')),
  version         int NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by_id   uuid,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by_id   uuid,
  deleted_at      timestamptz,
  deleted_by_id   uuid,
  CONSTRAINT sales_enquiries_party CHECK (customer_id IS NOT NULL OR prospect_name IS NOT NULL),
  CONSTRAINT sales_enquiries_lost CHECK (status <> 'Lost' OR (lost_reason IS NOT NULL AND length(btrim(lost_reason)) > 0))
);
CREATE UNIQUE INDEX IF NOT EXISTS sales_enquiries_number_uq ON sales_enquiries (unit_id, number);
CREATE INDEX IF NOT EXISTS sales_enquiries_unit_idx ON sales_enquiries (unit_id, status);

-- 6. Process exceptions.
CREATE TABLE IF NOT EXISTS exception_rules (
  code                text PRIMARY KEY,
  name                text NOT NULL,
  check_key           text NOT NULL,
  threshold_hours     int NOT NULL DEFAULT 24,
  owner_department    text NOT NULL,
  severity            text NOT NULL DEFAULT 'Medium' CHECK (severity IN ('Low','Medium','High')),
  active              boolean NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS process_exceptions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_code     text NOT NULL REFERENCES exception_rules(code),
  unit_id       uuid,
  doc_type      text NOT NULL,
  doc_id        uuid NOT NULL,
  doc_no        text,
  project_id    uuid,
  detail        text,
  raised_at     timestamptz NOT NULL DEFAULT now(),
  resolved_at   timestamptz,
  auto_resolved boolean NOT NULL DEFAULT false,
  note          text,
  assigned_to_id uuid
);
CREATE UNIQUE INDEX IF NOT EXISTS process_exceptions_open_uq ON process_exceptions (rule_code, doc_type, doc_id) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS process_exceptions_unit_idx ON process_exceptions (unit_id) WHERE resolved_at IS NULL;

INSERT INTO exception_rules (code, name, check_key, threshold_hours, owner_department, severity) VALUES
  ('SO_NO_FLOW',      'Sales order approved but nothing started', 'so_no_flow',      48,  'Sales',      'Medium'),
  ('SHORTAGE_NO_PR',  'Shortage with no purchase requisition',    'shortage_no_pr',  24,  'Purchase',   'High'),
  ('PO_LATE',         'Purchase order past its delivery date',    'po_late',          0,  'Purchase',   'High'),
  ('GRN_QC_HOLD',     'GRN waiting for quality check',            'grn_qc_hold',     72,  'Quality',    'Medium'),
  ('MOVEMENT_LATE',   'Department movement late',                 'movement_late',    0,  'Production', 'Medium'),
  ('FQC_NO_DC',       'Passed quality, no delivery challan',      'fqc_no_dc',       48,  'Warehouse',  'Medium'),
  ('DC_NO_INVOICE',   'Delivery challan without invoice',         'dc_no_invoice',   24,  'Finance',    'Medium'),
  ('INVOICE_OVERDUE', 'Invoice overdue more than 30 days',        'invoice_overdue', 720, 'Finance',    'High'),
  ('GATE_LATE',       'Project gate past its due date',           'gate_late',        0,  'Projects',   'Medium'),
  ('SHORT_RECEIPT',   'Short receipt open too long',              'short_receipt',   48,  'Warehouse',  'Medium')
ON CONFLICT (code) DO NOTHING;

-- 7. Order journey cache.
CREATE TABLE IF NOT EXISTS order_journey_cache (
  so_id        uuid PRIMARY KEY,
  json         jsonb NOT NULL,
  refreshed_at timestamptz NOT NULL DEFAULT now()
);

-- 8. Seeded gate templates (BLDC and SPPM from the V40 prototype).
INSERT INTO gate_templates (code, name, description) VALUES ('BLDC', 'BLDC motor development', 'Seeded from the V40 prototype stage list; editable.') ON CONFLICT (code) DO NOTHING;
INSERT INTO gate_template_steps (template_id, seq, code, name, owner_department_id, deliverable_name, deliverable_doc_type, exit_criteria, linked_page, depends_on) SELECT t.id, 1, 'BLDC-G01', 'Enquiry & URS', (SELECT id FROM departments WHERE name = 'Sales' LIMIT 1), 'Sales Enquiry', 'URS', 'Customer requirement and application data accepted', 'sales-enquiries', '{}' FROM gate_templates t WHERE t.code = 'BLDC' ON CONFLICT (template_id, code) DO NOTHING;
INSERT INTO gate_template_steps (template_id, seq, code, name, owner_department_id, deliverable_name, deliverable_doc_type, exit_criteria, linked_page, depends_on) SELECT t.id, 2, 'BLDC-G02', 'Feasibility & Project Approval', (SELECT id FROM departments WHERE name = 'Projects' LIMIT 1), 'Project Charter', 'CHARTER', 'Technical, schedule and budget feasibility approved', 'proj-projects', '{BLDC-G01}' FROM gate_templates t WHERE t.code = 'BLDC' ON CONFLICT (template_id, code) DO NOTHING;
INSERT INTO gate_template_steps (template_id, seq, code, name, owner_department_id, deliverable_name, deliverable_doc_type, exit_criteria, linked_page, depends_on) SELECT t.id, 3, 'BLDC-G03', 'Electromagnetic & Mechanical Design Freeze', (SELECT id FROM departments WHERE name = 'Projects' LIMIT 1), 'Design Review Record', 'DRR', '24V / 400W / 1500 RPM design and interfaces frozen', 'proj-specifications', '{BLDC-G02}' FROM gate_templates t WHERE t.code = 'BLDC' ON CONFLICT (template_id, code) DO NOTHING;
INSERT INTO gate_template_steps (template_id, seq, code, name, owner_department_id, deliverable_name, deliverable_doc_type, exit_criteria, linked_page, depends_on) SELECT t.id, 4, 'BLDC-G04', 'BOM & Sourcing Release', (SELECT id FROM departments WHERE name = 'Purchase' LIMIT 1), 'Released BOM', 'BOM', 'Revision-controlled BOM approved for purchase', 'mfg-bom', '{BLDC-G03}' FROM gate_templates t WHERE t.code = 'BLDC' ON CONFLICT (template_id, code) DO NOTHING;
INSERT INTO gate_template_steps (template_id, seq, code, name, owner_department_id, deliverable_name, deliverable_doc_type, exit_criteria, linked_page, depends_on) SELECT t.id, 5, 'BLDC-G05', 'Material Receipt & Incoming Quality', (SELECT id FROM departments WHERE name = 'Warehouse' LIMIT 1), 'GRN and IQC Report', 'IQC', 'Critical materials accepted with traceable batch', 'qms-incoming', '{BLDC-G04}' FROM gate_templates t WHERE t.code = 'BLDC' ON CONFLICT (template_id, code) DO NOTHING;
INSERT INTO gate_template_steps (template_id, seq, code, name, owner_department_id, deliverable_name, deliverable_doc_type, exit_criteria, linked_page, depends_on) SELECT t.id, 6, 'BLDC-G06', 'Stator Winding & Rotor Build', (SELECT id FROM departments WHERE name = 'Production' LIMIT 1), 'Process Inspection', 'JC', 'Winding, rotor balance and magnet retention accepted', 'mfg-orders', '{BLDC-G05}' FROM gate_templates t WHERE t.code = 'BLDC' ON CONFLICT (template_id, code) DO NOTHING;
INSERT INTO gate_template_steps (template_id, seq, code, name, owner_department_id, deliverable_name, deliverable_doc_type, exit_criteria, linked_page, depends_on) SELECT t.id, 7, 'BLDC-G07', 'Controller Hardware & FOC Firmware', (SELECT id FROM departments WHERE name = 'Production' LIMIT 1), 'Controller Test Record', 'TR', 'FOC, PWM, protections and communication verified', 'proj-test-records', '{BLDC-G06}' FROM gate_templates t WHERE t.code = 'BLDC' ON CONFLICT (template_id, code) DO NOTHING;
INSERT INTO gate_template_steps (template_id, seq, code, name, owner_department_id, deliverable_name, deliverable_doc_type, exit_criteria, linked_page, depends_on) SELECT t.id, 8, 'BLDC-G08', 'Motor Assembly & No-Load Test', (SELECT id FROM departments WHERE name = 'Production' LIMIT 1), 'Assembly Job Card', 'JC', 'Assembly torque, insulation and no-load run accepted', 'mfg-unit-route', '{BLDC-G07}' FROM gate_templates t WHERE t.code = 'BLDC' ON CONFLICT (template_id, code) DO NOTHING;
INSERT INTO gate_template_steps (template_id, seq, code, name, owner_department_id, deliverable_name, deliverable_doc_type, exit_criteria, linked_page, depends_on) SELECT t.id, 9, 'BLDC-G09', 'Performance & Protection Validation', (SELECT id FROM departments WHERE name = 'Quality' LIMIT 1), 'Qualification Test Report', 'TR', 'Efficiency, speed, ripple, vibration, noise and protections pass', 'qms-final', '{BLDC-G08}' FROM gate_templates t WHERE t.code = 'BLDC' ON CONFLICT (template_id, code) DO NOTHING;
INSERT INTO gate_template_steps (template_id, seq, code, name, owner_department_id, deliverable_name, deliverable_doc_type, exit_criteria, linked_page, depends_on) SELECT t.id, 10, 'BLDC-G10', 'Qualified Motor Release', (SELECT id FROM departments WHERE name = 'Quality' LIMIT 1), 'Qualified Motor Certificate', 'SPEC', 'Qualified motor released for SPPM integration', 'quality-certificate', '{BLDC-G09}' FROM gate_templates t WHERE t.code = 'BLDC' ON CONFLICT (template_id, code) DO NOTHING;
INSERT INTO gate_template_steps (template_id, seq, code, name, owner_department_id, deliverable_name, deliverable_doc_type, exit_criteria, linked_page, depends_on) SELECT t.id, 11, 'BLDC-G11', 'Pilot Batch Manufacturing', (SELECT id FROM departments WHERE name = 'Production' LIMIT 1), 'Pilot Batch Record', 'JC', '10 motors completed with controlled yield', 'mfg-fg', '{BLDC-G10}' FROM gate_templates t WHERE t.code = 'BLDC' ON CONFLICT (template_id, code) DO NOTHING;
INSERT INTO gate_template_steps (template_id, seq, code, name, owner_department_id, deliverable_name, deliverable_doc_type, exit_criteria, linked_page, depends_on) SELECT t.id, 12, 'BLDC-G12', 'Delivery & Customer Receipt', (SELECT id FROM departments WHERE name = 'Warehouse' LIMIT 1), 'Delivery Challan / POD', 'DC', 'Accepted pilot batch delivered and acknowledged', 'dispatch-dc', '{BLDC-G11}' FROM gate_templates t WHERE t.code = 'BLDC' ON CONFLICT (template_id, code) DO NOTHING;
INSERT INTO gate_template_steps (template_id, seq, code, name, owner_department_id, deliverable_name, deliverable_doc_type, exit_criteria, linked_page, depends_on) SELECT t.id, 13, 'BLDC-G13', 'Invoice Release', (SELECT id FROM departments WHERE name = 'Finance' LIMIT 1), 'GST Tax Invoice', 'INV', 'Delivered quantity invoiced with correct GST', 'accounts-gst-invoice', '{BLDC-G12}' FROM gate_templates t WHERE t.code = 'BLDC' ON CONFLICT (template_id, code) DO NOTHING;
INSERT INTO gate_template_steps (template_id, seq, code, name, owner_department_id, deliverable_name, deliverable_doc_type, exit_criteria, linked_page, depends_on) SELECT t.id, 14, 'BLDC-G14', 'Payment Collection', (SELECT id FROM departments WHERE name = 'Finance' LIMIT 1), 'Payment Receipt', 'SPEC', 'Invoice value fully collected and reconciled', 'sales-collections', '{BLDC-G13}' FROM gate_templates t WHERE t.code = 'BLDC' ON CONFLICT (template_id, code) DO NOTHING;
INSERT INTO gate_template_steps (template_id, seq, code, name, owner_department_id, deliverable_name, deliverable_doc_type, exit_criteria, linked_page, depends_on) SELECT t.id, 15, 'BLDC-G15', 'Project Closure', (SELECT id FROM departments WHERE name = 'Projects' LIMIT 1), 'Closure & Lessons Learned', 'CLOSE', 'Customer acceptance, documents and costs closed', 'proj-documents', '{BLDC-G14}' FROM gate_templates t WHERE t.code = 'BLDC' ON CONFLICT (template_id, code) DO NOTHING;
INSERT INTO gate_templates (code, name, description) VALUES ('SPPM', 'SPPM machine development', 'Seeded from the V40 prototype stage list; editable.') ON CONFLICT (code) DO NOTHING;
INSERT INTO gate_template_steps (template_id, seq, code, name, owner_department_id, deliverable_name, deliverable_doc_type, exit_criteria, linked_page, depends_on) SELECT t.id, 1, 'SPPM-G01', 'Customer URS & Enquiry', (SELECT id FROM departments WHERE name = 'Sales' LIMIT 1), 'Approved URS', 'URS', 'Station sequence, takt, quality and safety needs accepted', 'sales-enquiries', '{}' FROM gate_templates t WHERE t.code = 'SPPM' ON CONFLICT (template_id, code) DO NOTHING;
INSERT INTO gate_template_steps (template_id, seq, code, name, owner_department_id, deliverable_name, deliverable_doc_type, exit_criteria, linked_page, depends_on) SELECT t.id, 2, 'SPPM-G02', 'Feasibility & Project Charter', (SELECT id FROM departments WHERE name = 'Projects' LIMIT 1), 'Project Charter', 'CHARTER', 'Scope, budget, schedule and resource plan approved', 'proj-projects', '{SPPM-G01}' FROM gate_templates t WHERE t.code = 'SPPM' ON CONFLICT (template_id, code) DO NOTHING;
INSERT INTO gate_template_steps (template_id, seq, code, name, owner_department_id, deliverable_name, deliverable_doc_type, exit_criteria, linked_page, depends_on) SELECT t.id, 3, 'SPPM-G03', 'Concept Layout & Cycle Study', (SELECT id FROM departments WHERE name = 'Projects' LIMIT 1), 'Concept Review', 'DRR', 'Six-station concept meets planned cycle time', 'proj-specifications', '{SPPM-G02}' FROM gate_templates t WHERE t.code = 'SPPM' ON CONFLICT (template_id, code) DO NOTHING;
INSERT INTO gate_template_steps (template_id, seq, code, name, owner_department_id, deliverable_name, deliverable_doc_type, exit_criteria, linked_page, depends_on) SELECT t.id, 4, 'SPPM-G04', 'Mechanical Design Freeze', (SELECT id FROM departments WHERE name = 'Projects' LIMIT 1), 'Mechanical Design Review', 'DRR', 'Frame, fixtures, guarding and tooling released', 'proj-documents', '{SPPM-G03}' FROM gate_templates t WHERE t.code = 'SPPM' ON CONFLICT (template_id, code) DO NOTHING;
INSERT INTO gate_template_steps (template_id, seq, code, name, owner_department_id, deliverable_name, deliverable_doc_type, exit_criteria, linked_page, depends_on) SELECT t.id, 5, 'SPPM-G05', 'Electrical / Pneumatic / PLC Design', (SELECT id FROM departments WHERE name = 'Projects' LIMIT 1), 'Controls Design Review', 'DRR', 'PLC, HMI, pneumatics, safety and I/O approved', 'proj-documents', '{SPPM-G04}' FROM gate_templates t WHERE t.code = 'SPPM' ON CONFLICT (template_id, code) DO NOTHING;
INSERT INTO gate_template_steps (template_id, seq, code, name, owner_department_id, deliverable_name, deliverable_doc_type, exit_criteria, linked_page, depends_on) SELECT t.id, 6, 'SPPM-G06', 'BOM, Purchase & Material Receipt', (SELECT id FROM departments WHERE name = 'Purchase' LIMIT 1), 'BOM / PO / GRN', 'IQC', 'Long-lead and bought-out items received', 'scm-grn', '{SPPM-G05}' FROM gate_templates t WHERE t.code = 'SPPM' ON CONFLICT (template_id, code) DO NOTHING;
INSERT INTO gate_template_steps (template_id, seq, code, name, owner_department_id, deliverable_name, deliverable_doc_type, exit_criteria, linked_page, depends_on) SELECT t.id, 7, 'SPPM-G07', 'Fabrication, Machining & Inspection', (SELECT id FROM departments WHERE name = 'Production' LIMIT 1), 'Fabrication Job Card', 'JC', 'Frame and precision parts accepted', 'mfg-orders', '{SPPM-G06}' FROM gate_templates t WHERE t.code = 'SPPM' ON CONFLICT (template_id, code) DO NOTHING;
INSERT INTO gate_template_steps (template_id, seq, code, name, owner_department_id, deliverable_name, deliverable_doc_type, exit_criteria, linked_page, depends_on) SELECT t.id, 8, 'SPPM-G08', 'Control Panel Build & Software', (SELECT id FROM departments WHERE name = 'Production' LIMIT 1), 'Panel Test Record', 'TR', 'Panel, PLC, HMI and safety program bench-tested', 'proj-test-records', '{SPPM-G07}' FROM gate_templates t WHERE t.code = 'SPPM' ON CONFLICT (template_id, code) DO NOTHING;
INSERT INTO gate_template_steps (template_id, seq, code, name, owner_department_id, deliverable_name, deliverable_doc_type, exit_criteria, linked_page, depends_on) SELECT t.id, 9, 'SPPM-G09', 'Machine Mechanical Assembly', (SELECT id FROM departments WHERE name = 'Production' LIMIT 1), 'Assembly Inspection', 'JC', 'Stations aligned and mechanical assembly complete', 'mfg-unit-route', '{SPPM-G08}' FROM gate_templates t WHERE t.code = 'SPPM' ON CONFLICT (template_id, code) DO NOTHING;
INSERT INTO gate_template_steps (template_id, seq, code, name, owner_department_id, deliverable_name, deliverable_doc_type, exit_criteria, linked_page, depends_on) SELECT t.id, 10, 'SPPM-G10', 'BLDC Drive Integration', (SELECT id FROM departments WHERE name = 'Production' LIMIT 1), 'Integration Test Record', 'TR', 'Qualified BLDC motor integrated with SPPM controls', 'proj-test-records', '{SPPM-G09}' FROM gate_templates t WHERE t.code = 'SPPM' ON CONFLICT (template_id, code) DO NOTHING;
INSERT INTO gate_template_steps (template_id, seq, code, name, owner_department_id, deliverable_name, deliverable_doc_type, exit_criteria, linked_page, depends_on) SELECT t.id, 11, 'SPPM-G11', 'I/O, Dry Cycle & Safety Validation', (SELECT id FROM departments WHERE name = 'Quality' LIMIT 1), 'Dry Cycle Report', 'TR', 'Interlocks, sensors, actuators and dry cycle accepted', 'qms-final', '{SPPM-G10}' FROM gate_templates t WHERE t.code = 'SPPM' ON CONFLICT (template_id, code) DO NOTHING;
INSERT INTO gate_template_steps (template_id, seq, code, name, owner_department_id, deliverable_name, deliverable_doc_type, exit_criteria, linked_page, depends_on) SELECT t.id, 12, 'SPPM-G12', 'Factory Acceptance Test', (SELECT id FROM departments WHERE name = 'Quality' LIMIT 1), 'FAT Protocol', 'FAT', 'Cycle, repeatability, quality and safety FAT passed', 'proj-test-records', '{SPPM-G11}' FROM gate_templates t WHERE t.code = 'SPPM' ON CONFLICT (template_id, code) DO NOTHING;
INSERT INTO gate_template_steps (template_id, seq, code, name, owner_department_id, deliverable_name, deliverable_doc_type, exit_criteria, linked_page, depends_on) SELECT t.id, 13, 'SPPM-G13', 'Dispatch & Installation', (SELECT id FROM departments WHERE name = 'Warehouse' LIMIT 1), 'DC / Installation Report', 'DC', 'Machine dispatched, installed and utilities connected', 'dispatch-dc', '{SPPM-G12}' FROM gate_templates t WHERE t.code = 'SPPM' ON CONFLICT (template_id, code) DO NOTHING;
INSERT INTO gate_template_steps (template_id, seq, code, name, owner_department_id, deliverable_name, deliverable_doc_type, exit_criteria, linked_page, depends_on) SELECT t.id, 14, 'SPPM-G14', 'SAT, Training & Handover', (SELECT id FROM departments WHERE name = 'Service' LIMIT 1), 'SAT / Training Record', 'SAT', 'Site acceptance, training and handover approved', 'proj-test-records', '{SPPM-G13}' FROM gate_templates t WHERE t.code = 'SPPM' ON CONFLICT (template_id, code) DO NOTHING;
INSERT INTO gate_template_steps (template_id, seq, code, name, owner_department_id, deliverable_name, deliverable_doc_type, exit_criteria, linked_page, depends_on) SELECT t.id, 15, 'SPPM-G15', 'Invoice, Payment & Closure', (SELECT id FROM departments WHERE name = 'Finance' LIMIT 1), 'Invoice / Receipt / Closure', 'INV', 'Commercial and project closure completed', 'accounts-gst-invoice', '{SPPM-G14}' FROM gate_templates t WHERE t.code = 'SPPM' ON CONFLICT (template_id, code) DO NOTHING;

-- 9. Notification types.
INSERT INTO "notification_types"
  ("code", "module", "category", "label", "label_hi", "priority", "enabled",
   "allowed_channels", "default_channels", "mandatory_channels", "sensitive",
   "title_tpl", "body_tpl", "deep_link_tpl", "collapse_key_tpl", "digest_allowed")
VALUES
  ('project.gate_opened', 'Projects', 'DOCUMENT', 'A project gate is open for your department', 'प्रोजेक्ट गेट आपके विभाग के लिए खुला', 'NORMAL', true,
   ARRAY['IN_APP','EMAIL','PUSH'], ARRAY['IN_APP'], ARRAY['IN_APP'], false, '{{title}}', '{{body}}', '/m/proj-stage-gates', 'gate:{{entityId}}', true),
  ('process.exception', 'Operations', 'ALERT', 'Process exception raised', 'प्रक्रिया अपवाद', 'HIGH', true,
   ARRAY['IN_APP','EMAIL','PUSH'], ARRAY['IN_APP'], ARRAY['IN_APP'], false, '{{title}}', '{{body}}', '/m/process-exceptions', 'exc:{{entityId}}', true),
  ('sales.enquiry_assigned', 'Sales', 'DOCUMENT', 'Enquiry assigned to you', 'पूछताछ आपको सौंपी गई', 'NORMAL', true,
   ARRAY['IN_APP','EMAIL'], ARRAY['IN_APP'], ARRAY[]::text[], false, '{{title}}', '{{body}}', '/m/sales-enquiries', 'enq:{{entityId}}', true)
ON CONFLICT ("code") DO NOTHING;
