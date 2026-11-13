-- Phase 27: documents and mail. Print templates, letters, quality certificates, internal mail, the mail automation library.
-- Forward-only and idempotent.

-- 1. Print and letter templates.
CREATE TABLE IF NOT EXISTS print_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_type    text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('STANDARD','LETTERHEAD','COMMERCIAL','WORD')),
  version     int NOT NULL DEFAULT 1,
  layout_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  active      boolean NOT NULL DEFAULT true,
  approved_by_id uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by_id uuid,
  UNIQUE (doc_type, kind, version)
);

CREATE TABLE IF NOT EXISTS letter_templates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code          text NOT NULL,
  name          text NOT NULL,
  body_html     text NOT NULL,
  merge_fields  text[] NOT NULL DEFAULT '{}',
  version       int NOT NULL DEFAULT 1,
  approved      boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by_id uuid,
  UNIQUE (code, version)
);

CREATE TABLE IF NOT EXISTS issued_letters (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id       uuid NOT NULL,
  number        text NOT NULL,
  template_code text NOT NULL,
  person_name   text NOT NULL,
  person_email  text,
  data_json     jsonb NOT NULL DEFAULT '{}'::jsonb,
  body_html     text NOT NULL,
  status        text NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft','Approved','Issued')),
  approved_by_id uuid,
  approved_at   timestamptz,
  issued_at     timestamptz,
  emailed_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by_id uuid
);
CREATE UNIQUE INDEX IF NOT EXISTS issued_letters_number_uq ON issued_letters (unit_id, number);

INSERT INTO letter_templates (code, name, body_html, merge_fields, approved) VALUES
  ('OFFER', 'Offer letter',
   '<p>Dear {{name}},</p><p>We are pleased to offer you the position of <strong>{{designation}}</strong> in the {{department}} department at {{company}}, with a monthly gross salary of {{gross}}. Your expected joining date is {{joining_date}}.</p><p>This offer is subject to the joining terms shared with you.</p><p>Yours sincerely,<br/>{{company}}</p>',
   ARRAY['name','designation','department','company','gross','joining_date'], true),
  ('APPOINTMENT', 'Appointment letter',
   '<p>Dear {{name}},</p><p>With reference to your acceptance of our offer, we appoint you as <strong>{{designation}}</strong> in the {{department}} department from {{joining_date}}. Your monthly gross salary is {{gross}}.</p><p>Yours sincerely,<br/>{{company}}</p>',
   ARRAY['name','designation','department','company','gross','joining_date'], true)
ON CONFLICT (code, version) DO NOTHING;

-- 2. Quality certificates (the V40 fields).
CREATE TABLE IF NOT EXISTS quality_certificates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id         uuid NOT NULL,
  fy_id           uuid,
  number          text NOT NULL,
  job_card_no     text,
  part_code       text,
  part_name       text NOT NULL,
  inspection_date date NOT NULL DEFAULT CURRENT_DATE,
  sample_qty      numeric(18,3) NOT NULL DEFAULT 0,
  accepted_qty    numeric(18,3) NOT NULL DEFAULT 0,
  rejected_qty    numeric(18,3) NOT NULL DEFAULT 0,
  drawing_revision text,
  inspector       text,
  result          text NOT NULL DEFAULT 'Pass' CHECK (result IN ('Pass','Fail','Conditional')),
  ncr_no          text,
  quality_approval text NOT NULL DEFAULT 'Pending' CHECK (quality_approval IN ('Pending','Approved','Rejected')),
  remarks         text,
  so_id           uuid,
  dc_id           uuid,
  version         int NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by_id   uuid,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by_id   uuid,
  deleted_at      timestamptz,
  CONSTRAINT quality_certificates_qty_chk CHECK (accepted_qty + rejected_qty <= sample_qty)
);
CREATE UNIQUE INDEX IF NOT EXISTS quality_certificates_number_uq ON quality_certificates (unit_id, number);

-- 3. Internal mail between departments.
CREATE TABLE IF NOT EXISTS internal_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id         uuid NOT NULL,
  from_user_id    uuid NOT NULL,
  from_department text,
  to_department   text,
  to_user_ids     uuid[] NOT NULL DEFAULT '{}',
  subject         text NOT NULL,
  body            text NOT NULL,
  movement_id     uuid,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS internal_messages_dept_idx ON internal_messages (to_department, created_at DESC);
CREATE INDEX IF NOT EXISTS internal_messages_from_idx ON internal_messages (from_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS internal_message_attachments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id  uuid NOT NULL REFERENCES internal_messages(id) ON DELETE CASCADE,
  label       text NOT NULL,
  page_id     text,
  record_id   uuid,
  format      text CHECK (format IN ('pdf','word','excel'))
);
CREATE TABLE IF NOT EXISTS internal_message_reads (
  message_id  uuid NOT NULL REFERENCES internal_messages(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL,
  read_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);

-- 4. Mail automation library, per-plant switches and the run log (idempotency).
CREATE TABLE IF NOT EXISTS mail_automation_library (
  code            text PRIMARY KEY,
  seq             int NOT NULL,
  name            text NOT NULL,
  module          text NOT NULL,
  trigger_kind    text NOT NULL CHECK (trigger_kind IN ('EVENT','DATE','SCHEDULE')),
  trigger_text    text NOT NULL,
  recipients_text text NOT NULL,
  attachment_text text,
  default_on      boolean NOT NULL DEFAULT true,
  enabled         boolean NOT NULL DEFAULT true,
  wired           boolean NOT NULL DEFAULT false,
  p21_rule_code   text,
  subject_tpl     text,
  body_tpl        text,
  run_time        text,
  offset_days     int,
  description     text,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by_id   uuid
);

CREATE TABLE IF NOT EXISTS mail_automation_plants (
  code     text NOT NULL REFERENCES mail_automation_library(code) ON DELETE CASCADE,
  unit_id  uuid NOT NULL,
  enabled  boolean NOT NULL,
  PRIMARY KEY (code, unit_id)
);

CREATE TABLE IF NOT EXISTS mail_automation_runs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL REFERENCES mail_automation_library(code) ON DELETE CASCADE,
  unit_id     uuid,
  run_key     text NOT NULL,
  status      text NOT NULL CHECK (status IN ('SENT','SKIPPED','FAILED','TEST')),
  reason      text,
  recipients  int NOT NULL DEFAULT 0,
  doc_no      text,
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS mail_automation_runs_idem_uq ON mail_automation_runs (code, run_key) WHERE status IN ('SENT','SKIPPED');
CREATE INDEX IF NOT EXISTS mail_automation_runs_code_idx ON mail_automation_runs (code, at DESC);

INSERT INTO mail_automation_library (seq, code, name, module, trigger_kind, trigger_text, recipients_text, attachment_text, default_on, enabled, wired, p21_rule_code, run_time, offset_days, description) VALUES
  (1,'enquiry_ack','Enquiry acknowledgement','Sales','EVENT','Enquiry created with an email','Customer','',true,true,false,NULL,NULL,NULL,'Enquiry acknowledgement. Enquiry created with an email.'),
  (2,'quotation_sent','Quotation sent','Sales','EVENT','Quotation status becomes Sent','Customer contact','Quotation PDF',true,true,false,NULL,NULL,NULL,'Quotation sent. Quotation status becomes Sent.'),
  (3,'quotation_followup','Quotation follow-up reminder','Sales','DATE','7 days after sent, no reply','Salesperson','',true,true,false,NULL,'09:00',7,'Quotation follow-up reminder. 7 days after sent, no reply.'),
  (4,'order_ack','Order acknowledgement','Sales','EVENT','Sales order approved','Customer','Sales order PDF',true,true,true,NULL,NULL,NULL,'Order acknowledgement. Sales order approved.'),
  (5,'dispatch_intimation','Dispatch intimation','Sales','EVENT','Delivery challan posted / gate-out','Customer','DC + e-way bill no. + LR',true,true,false,NULL,NULL,NULL,'Dispatch intimation. Delivery challan posted / gate-out.'),
  (6,'invoice_email','Invoice email','Accounts','EVENT','Invoice posted','Customer accounts','Invoice PDF',true,true,true,'sales_invoice.posted',NULL,NULL,'Invoice email. Invoice posted.'),
  (7,'payment_receipt','Payment receipt','Accounts','EVENT','Receipt posted','Customer','Receipt PDF',true,true,false,NULL,NULL,NULL,'Payment receipt. Receipt posted.'),
  (8,'payment_reminders','Payment reminders','Accounts','DATE','Due +3 / +15 / +30 days','Customer, CC salesperson','Statement',true,true,false,NULL,'09:30',3,'Payment reminders. Due +3 / +15 / +30 days.'),
  (9,'monthly_statement','Monthly statement','Accounts','SCHEDULE','1st of the month 09:00','Customer','Statement',true,true,false,NULL,'09:00',NULL,'Monthly statement. 1st of the month 09:00.'),
  (10,'quality_cert_dispatch','Quality certificate with dispatch','Quality','EVENT','DC posted with a certificate','Customer','Certificate PDF',true,true,false,NULL,NULL,NULL,'Quality certificate with dispatch. DC posted with a certificate.'),
  (11,'rfq_to_suppliers','RFQ to suppliers','Procurement','EVENT','RFQ issued','Invited suppliers','RFQ PDF',true,true,false,NULL,NULL,NULL,'RFQ to suppliers. RFQ issued.'),
  (12,'purchase_order','Purchase order','Procurement','EVENT','PO approved','Supplier','PO PDF',true,true,false,NULL,NULL,NULL,'Purchase order. PO approved.'),
  (13,'po_amendment','PO amendment','Procurement','EVENT','PO amended','Supplier','Revised PO',true,true,false,NULL,NULL,NULL,'PO amendment. PO amended.'),
  (14,'delivery_reminder','Delivery reminder','Procurement','DATE','3 days before the line due date','Supplier, CC buyer','',true,true,true,NULL,'09:00',-3,'Delivery reminder. 3 days before the line due date.'),
  (15,'delivery_overdue','Delivery overdue','Procurement','DATE','1 day after the due date','Supplier and buyer','',true,true,true,NULL,'09:00',1,'Delivery overdue. 1 day after the due date.'),
  (16,'grn_short_supply','GRN / short supply note','Procurement','EVENT','GRN posted with short or rejected quantity','Supplier','GRN summary',true,true,false,NULL,NULL,NULL,'GRN / short supply note. GRN posted with short or rejected quantity.'),
  (17,'debit_note','Debit note','Procurement','EVENT','Debit note posted','Supplier','Debit note PDF',true,true,false,NULL,NULL,NULL,'Debit note. Debit note posted.'),
  (18,'payment_advice','Payment advice','Accounts','EVENT','Supplier payment posted','Supplier','Advice (TDS shown)',true,true,false,NULL,NULL,NULL,'Payment advice. Supplier payment posted.'),
  (19,'scar_supplier','SCAR to supplier','Quality','EVENT','SCAR raised','Supplier','8D form',true,true,false,NULL,NULL,NULL,'SCAR to supplier. SCAR raised.'),
  (20,'approval_waiting','Approval waiting','Approvals','DATE','Approval pending 24 hours','Approver','',true,true,true,NULL,'*',1,'Approval waiting. Approval pending 24 hours.'),
  (21,'approval_escalation','Approval escalation','Approvals','DATE','Approval pending 48 hours','Next level','',true,true,true,NULL,'*',2,'Approval escalation. Approval pending 48 hours.'),
  (22,'approval_result','Approval result','Approvals','EVENT','Approved or rejected','Requester','',true,true,true,NULL,NULL,NULL,'Approval result. Approved or rejected.'),
  (23,'work_sent','Work sent to department','Work','EVENT','Movement SENT','Target department managers','',true,true,true,NULL,NULL,NULL,'Work sent to department. Movement SENT.'),
  (24,'work_late','Work late','Work','EVENT','Movement late','Target manager, then head','',true,true,true,NULL,NULL,NULL,'Work late. Movement late.'),
  (25,'work_returned','Work returned','Work','EVENT','Movement RETURNED','Sender','',true,true,true,NULL,NULL,NULL,'Work returned. Movement RETURNED.'),
  (26,'welcome_user','Welcome / set password','Administration','EVENT','User created','User','',true,true,false,NULL,NULL,NULL,'Welcome / set password. User created.'),
  (27,'offer_letter','Offer letter','HR','EVENT','Offer issued','Candidate','Offer PDF',true,true,false,NULL,NULL,NULL,'Offer letter. Offer issued.'),
  (28,'appointment_letter','Appointment letter','HR','EVENT','Letter issued','Employee','PDF',true,true,false,NULL,NULL,NULL,'Appointment letter. Letter issued.'),
  (29,'payslip','Payslip','HR','EVENT','Payslip released','Employee','Encrypted PDF',true,true,true,'payroll.payslip.released',NULL,NULL,'Payslip. Payslip released.'),
  (30,'leave_decision','Leave decision','HR','EVENT','Leave approved or rejected','Employee','',true,true,false,NULL,NULL,NULL,'Leave decision. Leave approved or rejected.'),
  (31,'missed_punch','Missed punch','HR','EVENT','Missed punch found','Employee and manager','',true,true,false,NULL,NULL,NULL,'Missed punch. Missed punch found.'),
  (32,'daily_attendance','Daily attendance report','HR','SCHEDULE','Daily 10:30','Department managers','Excel',true,true,false,NULL,'10:30',NULL,'Daily attendance report. Daily 10:30.'),
  (33,'monthly_attendance','Monthly attendance summary','HR','SCHEDULE','1st of the month','Employee','',true,true,false,NULL,'09:00',NULL,'Monthly attendance summary. 1st of the month.'),
  (34,'birthday_anniversary','Birthday / work anniversary','HR','DATE','On the date (opt-in)','Employee','',false,false,false,NULL,'09:00',0,'Birthday / work anniversary. On the date (opt-in).'),
  (35,'document_expiry','Document expiry','Logistics','DATE','30 / 15 / 7 days before expiry','Owner and vendor','',true,true,false,NULL,'09:00',-30,'Document expiry. 30 / 15 / 7 days before expiry.'),
  (36,'pm_due_list','PM due list','Maintenance','SCHEDULE','Monday 08:00','Maintenance','Excel',true,true,false,NULL,'08:00',NULL,'PM due list. Monday 08:00.'),
  (37,'calibration_due','Calibration due','Quality','DATE','15 days before due','Quality','',true,true,false,NULL,'09:00',-15,'Calibration due. 15 days before due.'),
  (38,'owner_daily_summary','Owner daily summary','Management','SCHEDULE','Daily 08:00','Owner, Directors','Owner summary',true,true,true,NULL,'08:00',NULL,'Owner daily summary. Daily 08:00.'),
  (39,'weekly_mis','Weekly MIS','Management','SCHEDULE','Monday 09:00','Directors, CFO','MIS PDF',true,true,false,NULL,'09:00',NULL,'Weekly MIS. Monday 09:00.'),
  (40,'monthly_pnl','Monthly P&L snapshot','Management','SCHEDULE','5th of the month 10:00','Owner, CFO','P&L PDF',true,true,false,NULL,'10:00',NULL,'Monthly P&L snapshot. 5th of the month 10:00.')
ON CONFLICT (code) DO NOTHING;

-- 5. Notification types.
INSERT INTO "notification_types"
  ("code", "module", "category", "label", "label_hi", "priority", "enabled",
   "allowed_channels", "default_channels", "mandatory_channels", "sensitive",
   "title_tpl", "body_tpl", "deep_link_tpl", "collapse_key_tpl", "digest_allowed")
VALUES
  ('mail.internal', 'Mail', 'DOCUMENT', 'Mail from a department', 'विभाग का संदेश', 'NORMAL', true,
   ARRAY['IN_APP','EMAIL','PUSH'], ARRAY['IN_APP'], ARRAY['IN_APP'], false, '{{title}}', '{{body}}', '/m/dept-mail', 'mail:{{entityId}}', true)
ON CONFLICT ("code") DO NOTHING;
