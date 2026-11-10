-- Phase 21-D: Email automation rules, SES v2 / SNS event tracking, suppressions & party contact preferences.

CREATE TABLE IF NOT EXISTS "email_rules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" varchar(40) NOT NULL UNIQUE,
  "name" varchar(160) NOT NULL,
  "event_code" varchar(64) NOT NULL,
  "enabled" boolean NOT NULL DEFAULT true,
  "unit_ids" uuid[],
  "conditions" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "recipient_resolver" varchar(32) NOT NULL CHECK ("recipient_resolver" IN ('CUSTOMER_DOC_CONTACT', 'SUPPLIER_DOC_CONTACT', 'EMPLOYEE', 'DOC_OWNER', 'ROLE', 'FIXED')),
  "cc_resolvers" text[] NOT NULL DEFAULT ARRAY[]::text[],
  "fixed_cc" text[] NOT NULL DEFAULT ARRAY[]::text[],
  "bcc_archive" boolean NOT NULL DEFAULT false,
  "template_code" varchar(40) NOT NULL,
  "attachment" varchar(24) NOT NULL DEFAULT 'DOC_PDF' CHECK ("attachment" IN ('NONE', 'DOC_PDF', 'STATEMENT_PDF', 'PAYSLIP_PDF')),
  "attach_mode" varchar(12) NOT NULL DEFAULT 'AUTO' CHECK ("attach_mode" IN ('ATTACH', 'LINK', 'AUTO')),
  "send_mode" varchar(16) NOT NULL DEFAULT 'IMMEDIATE' CHECK ("send_mode" IN ('IMMEDIATE', 'DELAY', 'WINDOW')),
  "delay_min" int NOT NULL DEFAULT 0,
  "send_window" varchar(48),
  "stream" varchar(16) NOT NULL DEFAULT 'TRANSACTIONAL' CHECK ("stream" IN ('TRANSACTIONAL', 'MARKETING')),
  "version" int NOT NULL DEFAULT 1,
  "updated_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "email_rules_event_idx" ON "email_rules" ("event_code");
CREATE INDEX IF NOT EXISTS "email_rules_updated_by_idx" ON "email_rules" ("updated_by_id");

-- Extend Phase 19 message_templates additively
ALTER TABLE "message_templates"
  ADD COLUMN IF NOT EXISTS "subject_tpl" varchar(240),
  ADD COLUMN IF NOT EXISTS "html_tpl" text,
  ADD COLUMN IF NOT EXISTS "text_tpl" text,
  ADD COLUMN IF NOT EXISTS "layout_code" varchar(40) DEFAULT 'LETTERHEAD',
  ADD COLUMN IF NOT EXISTS "sample_payload" jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Extend Phase 19 outbound_messages additively
ALTER TABLE "outbound_messages" DROP CONSTRAINT IF EXISTS "outbound_messages_status_check";
ALTER TABLE "outbound_messages"
  ADD CONSTRAINT "outbound_messages_status_check"
  CHECK ("status" IN ('QUEUED', 'HELD', 'SENT', 'DELIVERED', 'DELAYED', 'READ', 'FAILED', 'BLOCKED', 'SUPPRESSED'));

ALTER TABLE "outbound_messages"
  ADD COLUMN IF NOT EXISTS "rule_id" uuid REFERENCES "email_rules"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "doc_type" varchar(48),
  ADD COLUMN IF NOT EXISTS "doc_id" uuid,
  ADD COLUMN IF NOT EXISTS "email_to" text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS "cc" text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS "bcc" text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS "subject" varchar(300),
  ADD COLUMN IF NOT EXISTS "attachments" jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "share_link_id" uuid REFERENCES "dms_share_links"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "message_id_header" varchar(200),
  ADD COLUMN IF NOT EXISTS "ses_message_id" varchar(200),
  ADD COLUMN IF NOT EXISTS "idempotency_key" varchar(180) UNIQUE,
  ADD COLUMN IF NOT EXISTS "resend_of_id" uuid REFERENCES "outbound_messages"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "resend_reason" varchar(400),
  ADD COLUMN IF NOT EXISTS "body_stored" boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "stream" varchar(16) NOT NULL DEFAULT 'TRANSACTIONAL';

CREATE INDEX IF NOT EXISTS "outbound_messages_rule_idx" ON "outbound_messages" ("rule_id");
CREATE INDEX IF NOT EXISTS "outbound_messages_share_link_idx" ON "outbound_messages" ("share_link_id");
CREATE INDEX IF NOT EXISTS "outbound_messages_resend_of_idx" ON "outbound_messages" ("resend_of_id");
CREATE INDEX IF NOT EXISTS "outbound_messages_ses_id_idx" ON "outbound_messages" ("ses_message_id");
CREATE INDEX IF NOT EXISTS "outbound_messages_doc_idx" ON "outbound_messages" ("doc_type", "doc_id");

CREATE TABLE IF NOT EXISTS "email_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "outbound_message_id" uuid REFERENCES "outbound_messages"("id") ON DELETE CASCADE,
  "ses_event_id" varchar(180) NOT NULL UNIQUE,
  "type" varchar(24) NOT NULL CHECK ("type" IN ('SEND', 'DELIVERY', 'DELIVERY_DELAY', 'BOUNCE', 'COMPLAINT', 'REJECT')),
  "bounce_type" varchar(16),
  "sub_type" varchar(32),
  "recipient" varchar(254) NOT NULL,
  "diagnostic" text,
  "at" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "raw" jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS "email_events_msg_idx" ON "email_events" ("outbound_message_id");
CREATE INDEX IF NOT EXISTS "email_events_type_at_idx" ON "email_events" ("type", "at");

CREATE TABLE IF NOT EXISTS "email_suppressions" (
  "email_norm" varchar(254) PRIMARY KEY,
  "reason" varchar(24) NOT NULL CHECK ("reason" IN ('HARD_BOUNCE', 'COMPLAINT', 'MANUAL', 'UNSUBSCRIBE')),
  "source_message_id" uuid REFERENCES "outbound_messages"("id") ON DELETE SET NULL,
  "added_at" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "removed_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "removed_at" timestamptz(3),
  "removed_note" varchar(500)
);

CREATE INDEX IF NOT EXISTS "email_suppressions_source_msg_idx" ON "email_suppressions" ("source_message_id");
CREATE INDEX IF NOT EXISTS "email_suppressions_removed_by_idx" ON "email_suppressions" ("removed_by_id");

-- Contact email flags & bounce status on Phase 6 party contacts
ALTER TABLE "customer_contacts"
  ADD COLUMN IF NOT EXISTS "receives_invoices" boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "receives_statements" boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "receives_reminders" boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "email_status" varchar(16) NOT NULL DEFAULT 'OK';

ALTER TABLE "supplier_contacts"
  ADD COLUMN IF NOT EXISTS "receives_po" boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "receives_statements" boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "receives_reminders" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "email_status" varchar(16) NOT NULL DEFAULT 'OK';

ALTER TABLE "customers"
  ADD COLUMN IF NOT EXISTS "email_documents" boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "sms_documents" boolean NOT NULL DEFAULT false;

ALTER TABLE "suppliers"
  ADD COLUMN IF NOT EXISTS "email_documents" boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "sms_documents" boolean NOT NULL DEFAULT false;

-- Seed default EMAIL templates (zero PII placeholders in notification templates)
INSERT INTO "message_templates" ("code", "channel", "name", "category", "body", "subject_tpl", "html_tpl", "text_tpl", "variables")
VALUES
  ('inv_email', 'EMAIL', 'Sales Invoice Posted', 'TRANSACTIONAL', 'Invoice {{docNo}} attached.', 'Invoice {{docNo}} from {{unitName}}', '<p>Dear {{partyName}},</p><p>Please find attached tax invoice <strong>{{docNo}}</strong> dated {{docDate}} for {{amount}}.</p><p>{{body}}</p>', 'Dear {{partyName}},\nTax invoice {{docNo}} dated {{docDate}} for {{amount}} is enclosed.\n{{body}}', '["docNo","unitName","partyName","docDate","amount","body"]'::jsonb),
  ('inv_cancel', 'EMAIL', 'Sales Invoice Cancelled', 'TRANSACTIONAL', 'Invoice {{docNo}} cancelled.', 'Cancellation Notice: Invoice {{docNo}}', '<p>Dear {{partyName}},</p><p>Tax invoice <strong>{{docNo}}</strong> has been cancelled in our books.</p>', 'Dear {{partyName}},\nInvoice {{docNo}} has been cancelled.', '["docNo","partyName"]'::jsonb),
  ('cn_email', 'EMAIL', 'Credit Note Posted', 'TRANSACTIONAL', 'Credit Note {{docNo}} attached.', 'Credit Note {{docNo}} from {{unitName}}', '<p>Dear {{partyName}},</p><p>Credit Note <strong>{{docNo}}</strong> for {{amount}} is attached.</p>', 'Dear {{partyName}},\nCredit Note {{docNo}} for {{amount}} is enclosed.', '["docNo","unitName","partyName","amount"]'::jsonb),
  ('rcpt_email', 'EMAIL', 'Payment Receipt', 'TRANSACTIONAL', 'Receipt {{docNo}} for {{amount}}.', 'Payment Receipt {{docNo}} from {{unitName}}', '<p>Dear {{partyName}},</p><p>We confirm receipt of payment <strong>{{docNo}}</strong> ({{amount}}). Thank you.</p>', 'Dear {{partyName}},\nPayment receipt {{docNo}} ({{amount}}).', '["docNo","unitName","partyName","amount"]'::jsonb),
  ('stmt_monthly', 'EMAIL', 'Monthly Customer Statement', 'TRANSACTIONAL', 'Monthly AR Statement attached.', 'Monthly Statement of Account — {{unitName}}', '<p>Dear {{partyName}},</p><p>Please find attached your monthly statement of account.</p>', 'Dear {{partyName}},\nMonthly statement of account enclosed.', '["unitName","partyName"]'::jsonb),
  ('dunning', 'EMAIL', 'Payment Reminder', 'TRANSACTIONAL', 'Overdue invoice reminder {{docNo}}.', 'Payment Reminder: Invoice {{docNo}} ({{amount}})', '<p>Dear {{partyName}},</p><p>Friendly reminder for overdue invoice <strong>{{docNo}}</strong> ({{amount}}).</p>', 'Dear {{partyName}},\nFriendly reminder for overdue invoice {{docNo}} ({{amount}}).', '["partyName","docNo","amount"]'::jsonb),
  ('po_email', 'EMAIL', 'Purchase Order Approved', 'TRANSACTIONAL', 'Purchase Order {{docNo}} attached.', 'Purchase Order {{docNo}} from {{unitName}}', '<p>Dear {{partyName}},</p><p>Please find attached approved Purchase Order <strong>{{docNo}}</strong> ({{amount}}).</p>', 'Dear {{partyName}},\nApproved Purchase Order {{docNo}} ({{amount}}) attached.', '["partyName","docNo","unitName","amount"]'::jsonb),
  ('po_amend', 'EMAIL', 'Purchase Order Amended', 'TRANSACTIONAL', 'Revised PO {{docNo}} attached.', 'Revised Purchase Order {{docNo}} from {{unitName}}', '<p>Dear {{partyName}},</p><p>Please see revised Purchase Order <strong>{{docNo}}</strong>.</p>', 'Dear {{partyName}},\nRevised Purchase Order {{docNo}} attached.', '["partyName","docNo","unitName"]'::jsonb),
  ('payslip', 'EMAIL', 'Monthly Payslip (Password Protected)', 'TRANSACTIONAL', 'Payslip for {{periodLabel}}.', 'Payslip for {{periodLabel}} — {{unitName}}', '<p>Dear {{employeeName}},</p><p>Your payslip for <strong>{{periodLabel}}</strong> is attached as an encrypted PDF. Open it with the first 4 letters of your PAN in CAPITALS + DDMM of your date of birth (or Employee Code + DDMM if PAN is not on file).</p>', 'Dear {{employeeName}},\nYour password-protected payslip for {{periodLabel}} is attached. Password = first 4 letters of PAN (CAPITALS) + DDMM of DOB.', '["employeeName","periodLabel","unitName"]'::jsonb),
  ('amc_renewal', 'EMAIL', 'AMC Renewal Due', 'TRANSACTIONAL', 'AMC Contract {{docNo}} renewal.', 'AMC Renewal Notice: {{docNo}}', '<p>Dear {{partyName}},</p><p>Your AMC contract <strong>{{docNo}}</strong> is due for renewal within 30 days. Renewal quotation attached.</p>', 'Dear {{partyName}},\nAMC contract {{docNo}} renewal due.', '["partyName","docNo"]'::jsonb),
  ('digest', 'EMAIL', 'Daily Unread Digest', 'TRANSACTIONAL', 'Daily notification summary.', 'Daily ERP Summary ({{count}} unread)', '<p>You have <strong>{{count}}</strong> unread ERP notifications.</p>{{itemsHtml}}', 'You have {{count}} unread ERP notifications.', '["count","itemsHtml"]'::jsonb),
  ('welcome', 'EMAIL', 'Welcome Account Setup', 'TRANSACTIONAL', 'Set your ERP password.', 'Welcome to Sawant Group ERP — Set Your Password', '<p>Hello {{name}},</p><p>Your ERP account has been created. Sign in at {{appUrl}} and change your temporary password.</p>', 'Hello {{name}}, your ERP account is ready at {{appUrl}}.', '["name","appUrl"]'::jsonb),
  ('broadcast_generic', 'EMAIL', 'Broadcast Announcement', 'TRANSACTIONAL', '{{body}}', '[{{severity}}] {{title}}', '<h3>{{title}}</h3><p>{{body}}</p>', '{{title}}\n\n{{body}}', '["severity","title","body"]'::jsonb)
ON CONFLICT ("code") DO NOTHING;

-- Seed 14 Phase 21 email automation rules (§5.7)
INSERT INTO "email_rules" ("code", "name", "event_code", "enabled", "recipient_resolver", "cc_resolvers", "template_code", "attachment", "attach_mode", "send_mode", "send_window", "stream")
VALUES
  ('INV_EMAIL', 'Auto-email Sales Invoice on Post', 'sales_invoice.posted', true, 'CUSTOMER_DOC_CONTACT', ARRAY[]::text[], 'inv_email', 'DOC_PDF', 'AUTO', 'IMMEDIATE', null, 'TRANSACTIONAL'),
  ('INV_CANCEL', 'Auto-email Invoice Cancellation Notice', 'sales_invoice.cancelled', true, 'CUSTOMER_DOC_CONTACT', ARRAY[]::text[], 'inv_cancel', 'NONE', 'AUTO', 'IMMEDIATE', null, 'TRANSACTIONAL'),
  ('CN_EMAIL', 'Auto-email Credit Note on Post', 'sales_credit_note.posted', true, 'CUSTOMER_DOC_CONTACT', ARRAY[]::text[], 'cn_email', 'DOC_PDF', 'AUTO', 'IMMEDIATE', null, 'TRANSACTIONAL'),
  ('RCPT_EMAIL', 'Auto-email Payment Receipt on Post', 'sales_receipt.posted', true, 'CUSTOMER_DOC_CONTACT', ARRAY[]::text[], 'rcpt_email', 'DOC_PDF', 'AUTO', 'IMMEDIATE', null, 'TRANSACTIONAL'),
  ('STMT_MONTHLY', 'Monthly AR Statement (1st 09:00 IST)', 'ar.statement.monthly', true, 'CUSTOMER_DOC_CONTACT', ARRAY[]::text[], 'stmt_monthly', 'STATEMENT_PDF', 'AUTO', 'WINDOW', '09:00-19:00 Mon-Sat', 'TRANSACTIONAL'),
  ('DUNNING_D3', 'Overdue Invoice Reminder (+3 days)', 'invoice.overdue.d3', true, 'CUSTOMER_DOC_CONTACT', ARRAY['SALESPERSON']::text[], 'dunning', 'STATEMENT_PDF', 'AUTO', 'WINDOW', '09:00-19:00 Mon-Sat', 'TRANSACTIONAL'),
  ('DUNNING_D15', 'Overdue Invoice Reminder (+15 days)', 'invoice.overdue.d15', true, 'CUSTOMER_DOC_CONTACT', ARRAY['SALESPERSON']::text[], 'dunning', 'STATEMENT_PDF', 'AUTO', 'WINDOW', '09:00-19:00 Mon-Sat', 'TRANSACTIONAL'),
  ('DUNNING_D30', 'Overdue Invoice Reminder (+30 days)', 'invoice.overdue.d30', true, 'CUSTOMER_DOC_CONTACT', ARRAY['SALESPERSON']::text[], 'dunning', 'STATEMENT_PDF', 'AUTO', 'WINDOW', '09:00-19:00 Mon-Sat', 'TRANSACTIONAL'),
  ('PO_EMAIL', 'Auto-email Purchase Order on Approval', 'purchase_order.approved', true, 'SUPPLIER_DOC_CONTACT', ARRAY[]::text[], 'po_email', 'DOC_PDF', 'AUTO', 'IMMEDIATE', null, 'TRANSACTIONAL'),
  ('PO_AMEND', 'Auto-email Amended Purchase Order', 'purchase_order.amended', true, 'SUPPLIER_DOC_CONTACT', ARRAY[]::text[], 'po_amend', 'DOC_PDF', 'AUTO', 'IMMEDIATE', null, 'TRANSACTIONAL'),
  ('PAYSLIP', 'Auto-email Encrypted Payslip PDF on Release', 'payroll.payslip.released', true, 'EMPLOYEE', ARRAY[]::text[], 'payslip', 'PAYSLIP_PDF', 'ATTACH', 'IMMEDIATE', null, 'TRANSACTIONAL'),
  ('AMC_RENEWAL', 'AMC Renewal Due 30-Day Reminder', 'amc.renewal_due', true, 'CUSTOMER_DOC_CONTACT', ARRAY[]::text[], 'amc_renewal', 'DOC_PDF', 'AUTO', 'WINDOW', '09:00-19:00 Mon-Sat', 'TRANSACTIONAL'),
  ('DIGEST', 'Daily Unread Digest Email', 'notifications.digest', true, 'EMPLOYEE', ARRAY[]::text[], 'digest', 'NONE', 'AUTO', 'IMMEDIATE', null, 'TRANSACTIONAL'),
  ('WELCOME', 'New User Welcome Email', 'user.created', true, 'EMPLOYEE', ARRAY[]::text[], 'welcome', 'NONE', 'AUTO', 'IMMEDIATE', null, 'TRANSACTIONAL')
ON CONFLICT ("code") DO NOTHING;

