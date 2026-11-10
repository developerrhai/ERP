-- Phase 21-A: Notification catalogue, system/user settings, per-type/channel preferences,
-- extended in-app notifications (seq identity, priority, collapse_key, expires_at), and outbox deliveries.

CREATE TABLE IF NOT EXISTS "notification_types" (
  "code" varchar(64) PRIMARY KEY,
  "module" varchar(40) NOT NULL,
  "category" varchar(24) NOT NULL CHECK ("category" IN ('APPROVAL', 'ALERT', 'DOCUMENT', 'ANNOUNCEMENT', 'SECURITY', 'REMINDER', 'DIGEST', 'MARKETING')),
  "label" varchar(120) NOT NULL,
  "label_hi" varchar(160) NOT NULL,
  "priority" varchar(12) NOT NULL DEFAULT 'NORMAL' CHECK ("priority" IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
  "enabled" boolean NOT NULL DEFAULT true,
  "allowed_channels" text[] NOT NULL DEFAULT ARRAY['IN_APP', 'EMAIL']::text[],
  "default_channels" text[] NOT NULL DEFAULT ARRAY['IN_APP', 'EMAIL']::text[],
  "mandatory_channels" text[] NOT NULL DEFAULT ARRAY['IN_APP']::text[],
  "sensitive" boolean NOT NULL DEFAULT false,
  "title_tpl" varchar(200) NOT NULL DEFAULT '{{title}}',
  "body_tpl" varchar(500) NOT NULL DEFAULT '{{body}}',
  "deep_link_tpl" varchar(300) NOT NULL DEFAULT '/',
  "collapse_key_tpl" varchar(80),
  "digest_allowed" boolean NOT NULL DEFAULT true,
  "updated_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "notification_types_updated_by_idx" ON "notification_types" ("updated_by_id");

CREATE TABLE IF NOT EXISTS "notification_settings" (
  "id" int PRIMARY KEY DEFAULT 1 CHECK ("id" = 1),
  "email_enabled" boolean NOT NULL DEFAULT true,
  "push_enabled" boolean NOT NULL DEFAULT true,
  "sms_enabled" boolean NOT NULL DEFAULT true,
  "marketing_paused" boolean NOT NULL DEFAULT false,
  "quiet_start" varchar(5) NOT NULL DEFAULT '22:00',
  "quiet_end" varchar(5) NOT NULL DEFAULT '07:00',
  "push_max_per_user_hour" int NOT NULL DEFAULT 20 CHECK ("push_max_per_user_hour" >= 1),
  "digest_time" varchar(5) NOT NULL DEFAULT '08:30',
  "retention_days" int NOT NULL DEFAULT 180 CHECK ("retention_days" >= 7),
  "broadcast_approval_threshold_users" int NOT NULL DEFAULT 50 CHECK ("broadcast_approval_threshold_users" >= 1),
  "sse_max_streams_per_user" int NOT NULL DEFAULT 5 CHECK ("sse_max_streams_per_user" >= 1),
  "push_declarative" boolean NOT NULL DEFAULT true,
  "updated_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "notification_settings_updated_by_idx" ON "notification_settings" ("updated_by_id");

INSERT INTO "notification_settings" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING;

CREATE TABLE IF NOT EXISTS "user_notification_prefs" (
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "type_code" varchar(64) NOT NULL REFERENCES "notification_types"("code") ON DELETE CASCADE,
  "channel" varchar(12) NOT NULL CHECK ("channel" IN ('IN_APP', 'PUSH', 'EMAIL', 'SMS')),
  "enabled" boolean NOT NULL DEFAULT true,
  "mode" varchar(12) NOT NULL DEFAULT 'IMMEDIATE' CHECK ("mode" IN ('IMMEDIATE', 'DIGEST')),
  PRIMARY KEY ("user_id", "type_code", "channel")
);

CREATE INDEX IF NOT EXISTS "user_notification_prefs_type_idx" ON "user_notification_prefs" ("type_code");

CREATE TABLE IF NOT EXISTS "user_notification_settings" (
  "user_id" uuid PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
  "quiet_start" varchar(5),
  "quiet_end" varchar(5),
  "digest_enabled" boolean NOT NULL DEFAULT true,
  "language" varchar(8) NOT NULL DEFAULT 'en' CHECK ("language" IN ('en', 'hi')),
  "soft_ask_dismissed_at" timestamptz(3),
  "updated_at" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Seed notification_types from every Phase 5-21 notification event
INSERT INTO "notification_types" (
  "code", "module", "category", "label", "label_hi", "priority",
  "allowed_channels", "default_channels", "mandatory_channels", "sensitive",
  "deep_link_tpl", "collapse_key_tpl", "digest_allowed"
)
VALUES
  ('APPROVAL_ASSIGNED', 'Approvals', 'APPROVAL', 'Approval waiting for me', 'अनुमोदन लंबित है', 'HIGH', ARRAY['IN_APP','PUSH','EMAIL'], ARRAY['IN_APP','PUSH','EMAIL'], ARRAY['IN_APP'], false, '/approvals', 'approval:{{entityId}}', true),
  ('APPROVAL_DECIDED', 'Approvals', 'APPROVAL', 'My request was decided', 'मेरे अनुरोध पर निर्णय', 'NORMAL', ARRAY['IN_APP','PUSH','EMAIL'], ARRAY['IN_APP','EMAIL'], ARRAY['IN_APP'], false, '/approvals', 'approval:{{entityId}}', true),
  ('APPROVAL_LEVEL_PASSED', 'Approvals', 'APPROVAL', 'My request moved to next level', 'अनुरोध अगले स्तर पर गया', 'NORMAL', ARRAY['IN_APP','EMAIL'], ARRAY['IN_APP'], ARRAY['IN_APP'], false, '/approvals', 'approval:{{entityId}}', true),
  ('APPROVAL_ESCALATED', 'Approvals', 'APPROVAL', 'Approval escalated', 'अनुमोदन एस्केलेट हुआ', 'HIGH', ARRAY['IN_APP','PUSH','EMAIL'], ARRAY['IN_APP','PUSH','EMAIL'], ARRAY['IN_APP'], false, '/approvals', 'approval:{{entityId}}', false),
  ('APPROVAL_REMINDER', 'Approvals', 'REMINDER', 'Approval reminder', 'अनुमोदन अनुस्मारक', 'NORMAL', ARRAY['IN_APP','PUSH','EMAIL'], ARRAY['IN_APP','EMAIL'], ARRAY['IN_APP'], false, '/approvals', 'approval_rem', true),
  ('DELEGATION_STARTED', 'Approvals', 'APPROVAL', 'Approvals delegated to me', 'अनुमोदन मुझे सौंपे गए', 'NORMAL', ARRAY['IN_APP','PUSH','EMAIL'], ARRAY['IN_APP','EMAIL'], ARRAY['IN_APP'], false, '/approvals', null, true),
  ('SYSTEM_JOB_FAILED', 'System', 'ALERT', 'Background job failed', 'पृष्ठभूमि कार्य विफल', 'HIGH', ARRAY['IN_APP','PUSH','EMAIL'], ARRAY['IN_APP','EMAIL'], ARRAY['IN_APP'], false, '/m/admin-backup', 'sys_job', false),
  ('STOCK_EXPIRING', 'Inventory', 'ALERT', 'Stock expiring', 'स्टॉक समाप्ति निकट', 'NORMAL', ARRAY['IN_APP','PUSH','EMAIL'], ARRAY['IN_APP','EMAIL'], ARRAY['IN_APP'], false, '/m/inv-expiry', 'stock_exp', true),
  ('STOCK_REORDER', 'Inventory', 'ALERT', 'Items below reorder level', 'न्यूनतम स्टॉक चेतावनी', 'NORMAL', ARRAY['IN_APP','PUSH','EMAIL'], ARRAY['IN_APP','EMAIL'], ARRAY['IN_APP'], false, '/m/inv-reorder', 'stock_reorder', true),
  ('DOCUMENT_EXPIRING', 'Documents', 'REMINDER', 'Document expiring', 'दस्तावेज़ समाप्ति निकट', 'NORMAL', ARRAY['IN_APP','PUSH','EMAIL'], ARRAY['IN_APP','EMAIL'], ARRAY['IN_APP'], false, '/m/dms-docs', null, true),
  ('SCM_PO_APPROVED', 'Procurement', 'DOCUMENT', 'Purchase order approved', 'क्रय आदेश स्वीकृत', 'NORMAL', ARRAY['IN_APP','PUSH','EMAIL'], ARRAY['IN_APP','EMAIL'], ARRAY['IN_APP'], false, '/m/scm-po', 'po:{{entityId}}', true),
  ('SCM_GRN_POSTED', 'Procurement', 'DOCUMENT', 'Goods received (GRN)', 'माल प्राप्त हुआ (GRN)', 'NORMAL', ARRAY['IN_APP','EMAIL'], ARRAY['IN_APP'], ARRAY['IN_APP'], false, '/m/scm-grn', null, true),
  ('SCM_INVOICE_ON_HOLD', 'Procurement', 'ALERT', 'Purchase invoice on hold', 'क्रय चालान होल्ड पर', 'HIGH', ARRAY['IN_APP','PUSH','EMAIL'], ARRAY['IN_APP','PUSH','EMAIL'], ARRAY['IN_APP'], false, '/m/scm-purchaseinvoice', null, true),
  ('SCM_MSME_DUE', 'Procurement', 'REMINDER', 'MSME payment due soon', 'MSME भुगतान देय तिथि निकट', 'HIGH', ARRAY['IN_APP','PUSH','EMAIL'], ARRAY['IN_APP','EMAIL'], ARRAY['IN_APP'], false, '/m/fin-ap', null, true),
  ('SCM_ITC_180', 'Procurement', 'ALERT', 'ITC 180-day reversal risk', 'ITC 180-दिन जोखिम', 'HIGH', ARRAY['IN_APP','PUSH','EMAIL'], ARRAY['IN_APP','EMAIL'], ARRAY['IN_APP'], false, '/m/tax-gstr3b', null, true),
  ('SCM_CONTRACT_EXPIRING', 'Procurement', 'REMINDER', 'Rate contract expiring', 'अनुबंध समाप्ति निकट', 'NORMAL', ARRAY['IN_APP','EMAIL'], ARRAY['IN_APP'], ARRAY['IN_APP'], false, '/m/scm-contracts', null, true),
  ('SCM_PUTAWAY_EXCEPTION', 'Warehouse', 'ALERT', 'Put-away exception', 'पुट-अवे त्रुटि', 'HIGH', ARRAY['IN_APP','PUSH'], ARRAY['IN_APP','PUSH'], ARRAY['IN_APP'], false, '/m/wms-putaway', null, true),
  ('SCM_SUPPLIER_DOC_EXPIRING', 'Procurement', 'REMINDER', 'Supplier document expiring', 'आपूर्तिकर्ता दस्तावेज़ समाप्त हो रहा है', 'NORMAL', ARRAY['IN_APP','EMAIL'], ARRAY['IN_APP'], ARRAY['IN_APP'], false, '/m/scm-suppliers', null, true),
  ('SCM_PO_DELAYED', 'Procurement', 'ALERT', 'Purchase order delayed', 'क्रय आदेश विलंबित', 'NORMAL', ARRAY['IN_APP','PUSH','EMAIL'], ARRAY['IN_APP','EMAIL'], ARRAY['IN_APP'], false, '/m/scm-po', null, true),
  ('QMS_INSPECTION_PENDING', 'Quality', 'APPROVAL', 'Goods waiting for QA inspection', 'गुणवत्ता जांच लंबित', 'HIGH', ARRAY['IN_APP','PUSH','EMAIL'], ARRAY['IN_APP','PUSH'], ARRAY['IN_APP'], false, '/m/qms-incoming', null, true),
  ('QMS_CALIBRATION_DUE', 'Quality', 'REMINDER', 'Instrument calibration due', 'उपकरण अंशांकन देय', 'HIGH', ARRAY['IN_APP','PUSH','EMAIL'], ARRAY['IN_APP','EMAIL'], ARRAY['IN_APP'], false, '/m/qms-calibration', null, true),
  ('MFG_MRP', 'Manufacturing', 'ALERT', 'MRP run finished', 'MRP रन पूर्ण', 'NORMAL', ARRAY['IN_APP','EMAIL'], ARRAY['IN_APP'], ARRAY['IN_APP'], false, '/m/mfg-mrp', null, true),
  ('MFG_DOWNTIME', 'Manufacturing', 'ALERT', 'Long machine downtime (>30 min)', 'मशीन डाउनटाइम चेतावनी', 'HIGH', ARRAY['IN_APP','PUSH','SMS'], ARRAY['IN_APP','PUSH'], ARRAY['IN_APP'], false, '/m/maint-downtime', null, false),
  ('MFG_OVERDUE', 'Manufacturing', 'ALERT', 'Production order overdue', 'उत्पादन आदेश विलंबित', 'NORMAL', ARRAY['IN_APP','PUSH','EMAIL'], ARRAY['IN_APP'], ARRAY['IN_APP'], false, '/m/mfg-orders', null, true),
  ('MFG_QC_HOLD', 'Manufacturing', 'ALERT', 'Finished goods on QC hold', 'तैयार माल QC होल्ड पर', 'HIGH', ARRAY['IN_APP','PUSH','EMAIL'], ARRAY['IN_APP','PUSH'], ARRAY['IN_APP'], false, '/m/qms-final', null, true),
  ('MFG_SHORTAGE', 'Manufacturing', 'ALERT', 'Material shortage at release', 'सामग्री की कमी', 'HIGH', ARRAY['IN_APP','PUSH','EMAIL'], ARRAY['IN_APP','PUSH'], ARRAY['IN_APP'], false, '/m/mfg-orders', null, true),
  ('SECURITY_NEW_LOGIN', 'Security', 'SECURITY', 'New device sign-in', 'नए डिवाइस से लॉगिन', 'URGENT', ARRAY['IN_APP','PUSH','EMAIL'], ARRAY['IN_APP','PUSH','EMAIL'], ARRAY['IN_APP','EMAIL'], false, '/account/security', null, false),
  ('PAYROLL_PAYSLIP_RELEASED', 'Payroll', 'DOCUMENT', 'Payslip ready', 'वेतन पर्ची उपलब्ध है', 'NORMAL', ARRAY['IN_APP','PUSH','EMAIL'], ARRAY['IN_APP','PUSH','EMAIL'], ARRAY['IN_APP'], true, '/m/payroll-payslip', 'payslip:{{entityId}}', false),
  ('MAINT_BREAKDOWN_P1', 'Maintenance', 'ALERT', 'Priority-1 machine breakdown', 'अत्यावश्यक मशीन खराबी', 'URGENT', ARRAY['IN_APP','PUSH','SMS','EMAIL'], ARRAY['IN_APP','PUSH','SMS'], ARRAY['IN_APP','PUSH'], false, '/m/maint-breakdown', 'bd:{{entityId}}', false),
  ('SALES_INVOICE_POSTED', 'Sales', 'DOCUMENT', 'Sales invoice posted', 'बिक्री चालान पोस्ट किया गया', 'NORMAL', ARRAY['IN_APP','EMAIL'], ARRAY['IN_APP','EMAIL'], ARRAY['IN_APP'], false, '/m/sales-invoices', null, true),
  ('BROADCAST_ANNOUNCEMENT', 'Admin', 'ANNOUNCEMENT', 'Company broadcast announcement', 'कंपनी घोषणा', 'HIGH', ARRAY['IN_APP','PUSH','EMAIL','SMS'], ARRAY['IN_APP','PUSH'], ARRAY['IN_APP'], false, '/notifications', 'brc:{{entityId}}', false),
  ('EMAIL_BOUNCED', 'Communication', 'ALERT', 'Customer/supplier email bounced', 'ईमेल बाउंस चेतावनी', 'HIGH', ARRAY['IN_APP','PUSH'], ARRAY['IN_APP','PUSH'], ARRAY['IN_APP'], false, '/m/comm-logs', null, false),
  ('EMAIL_COMPLAINT_ALERT', 'Communication', 'ALERT', 'Email spam complaint rate alert', 'स्पैम शिकायत चेतावनी', 'URGENT', ARRAY['IN_APP','PUSH','EMAIL'], ARRAY['IN_APP','PUSH','EMAIL'], ARRAY['IN_APP'], false, '/m/admin-notif-health', null, false),
  ('EMAIL_QUOTA_WARN', 'Communication', 'ALERT', 'Daily SES quota warning (>80%)', 'दैनिक ईमेल कोटा चेतावनी', 'HIGH', ARRAY['IN_APP','EMAIL'], ARRAY['IN_APP','EMAIL'], ARRAY['IN_APP'], false, '/m/admin-notif-health', null, false),
  ('PUSH_FAILURE_ALERT', 'Communication', 'ALERT', 'Push delivery failure spike', 'पुश विफलता चेतावनी', 'HIGH', ARRAY['IN_APP','EMAIL'], ARRAY['IN_APP','EMAIL'], ARRAY['IN_APP'], false, '/m/admin-notif-health', null, false),
  ('GATE_OVERDUE_RETURNABLE', 'Logistics', 'REMINDER', 'Overdue returnable gate pass', 'अतिदेय वापसी गेट पास', 'HIGH', ARRAY['IN_APP','PUSH','EMAIL'], ARRAY['IN_APP','EMAIL'], ARRAY['IN_APP'], false, '/m/gate-out', null, true),
  ('FLEET_DOC_EXPIRING', 'Fleet', 'REMINDER', 'Vehicle / driver document expiring', 'वाहन दस्तावेज़ समाप्त हो रहा है', 'HIGH', ARRAY['IN_APP','PUSH','EMAIL'], ARRAY['IN_APP','EMAIL'], ARRAY['IN_APP'], false, '/m/fleet-documents', null, true),
  ('TICKET_SLA_BREACH', 'Service', 'ALERT', 'Service ticket SLA warning', 'सेवा टिकट SLA चेतावनी', 'HIGH', ARRAY['IN_APP','PUSH','EMAIL'], ARRAY['IN_APP','PUSH'], ARRAY['IN_APP'], false, '/m/service-tickets', null, false)
ON CONFLICT ("code") DO NOTHING;

-- Additive ALTER on Phase 5 notifications table (preserves all Phase 5 columns and behaviour)
ALTER TABLE "notifications"
  ADD COLUMN IF NOT EXISTS "type_code" varchar(64) REFERENCES "notification_types"("code") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "priority" varchar(12) NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN IF NOT EXISTS "collapse_key" varchar(64),
  ADD COLUMN IF NOT EXISTS "seq" bigint GENERATED BY DEFAULT AS IDENTITY,
  ADD COLUMN IF NOT EXISTS "seen_at" timestamptz(3),
  ADD COLUMN IF NOT EXISTS "archived_at" timestamptz(3),
  ADD COLUMN IF NOT EXISTS "broadcast_id" uuid,
  ADD COLUMN IF NOT EXISTS "expires_at" timestamptz(3);

CREATE INDEX IF NOT EXISTS "notifications_user_seq_desc_idx" ON "notifications" ("user_id", "seq" DESC);
CREATE INDEX IF NOT EXISTS "notifications_type_code_idx" ON "notifications" ("type_code");
CREATE INDEX IF NOT EXISTS "notifications_broadcast_id_idx" ON "notifications" ("broadcast_id");

UPDATE "notifications" n
SET "type_code" = n."type"
WHERE n."type_code" IS NULL
  AND EXISTS (SELECT 1 FROM "notification_types" nt WHERE nt."code" = n."type");

-- Multi-channel notification outbox / delivery ledger
CREATE TABLE IF NOT EXISTS "notification_deliveries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "notification_id" uuid REFERENCES "notifications"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "type_code" varchar(64) NOT NULL REFERENCES "notification_types"("code") ON DELETE CASCADE,
  "channel" varchar(12) NOT NULL CHECK ("channel" IN ('IN_APP', 'PUSH', 'EMAIL', 'SMS')),
  "target_ref" varchar(512),
  "status" varchar(16) NOT NULL CHECK ("status" IN ('QUEUED', 'HELD', 'SENT', 'DELIVERED', 'FAILED', 'SKIPPED', 'SUPPRESSED')),
  "skip_reason" varchar(24) CHECK ("skip_reason" IN ('PREF_OFF', 'TYPE_OFF', 'CHANNEL_KILLED', 'QUIET_HOURS', 'NO_DEVICE', 'NO_ADDRESS', 'NO_CONSENT', 'RATE_LIMIT', 'SUPPRESSED', 'DIGEST_HELD')),
  "release_at" timestamptz(3),
  "attempts" int NOT NULL DEFAULT 0,
  "provider_id" varchar(128),
  "error" text,
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "sent_at" timestamptz(3),
  "created_at" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "notification_deliveries_notif_idx" ON "notification_deliveries" ("notification_id");
CREATE INDEX IF NOT EXISTS "notification_deliveries_user_idx" ON "notification_deliveries" ("user_id");
CREATE INDEX IF NOT EXISTS "notification_deliveries_type_idx" ON "notification_deliveries" ("type_code");
CREATE INDEX IF NOT EXISTS "notification_deliveries_queue_idx" ON "notification_deliveries" ("channel", "status", "release_at");

