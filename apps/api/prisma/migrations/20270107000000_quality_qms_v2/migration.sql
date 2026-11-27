-- Quality / QMS (docs2/ERP_Quality_QMS_Visual_Specification-v2272.pdf).
-- Customer NCR and Conformance NCR, Template & Feature (categories, checklists, audit forms, record formats, switches),
-- Rejection & Revoke, priority (Minor / Major / Critical), conditioned checkpoints, Return with comment, meeting
-- minutes with a department, and the two new roles with full Quality rights.

-- ------------------------------------------------------------------ inspections: priority, conditioned check, return
ALTER TABLE "qms_inspections"
  ADD COLUMN "priority" varchar(10),
  ADD COLUMN "return_comment" varchar(500),
  ADD COLUMN "returned_at" timestamptz(3),
  ADD COLUMN "returned_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "qms_inspections" ADD CONSTRAINT "qms_insp_priority_chk" CHECK ("priority" IS NULL OR "priority" IN ('MINOR','MAJOR','CRITICAL'));
CREATE INDEX "qms_insp_returned_by_idx" ON "qms_inspections"("returned_by_id");

ALTER TABLE "qms_inspection_rows" ADD COLUMN "check_type" varchar(12) NOT NULL DEFAULT 'STANDARD';
ALTER TABLE "qms_inspection_rows" ADD CONSTRAINT "qms_rows_check_chk" CHECK ("check_type" IN ('STANDARD','CONDITIONED'));

-- ------------------------------------------------------------------ rejection register: a rejection can be revoked
ALTER TABLE "qms_rejections" DROP CONSTRAINT "qms_rej_status_chk";
ALTER TABLE "qms_rejections" ADD CONSTRAINT "qms_rej_status_chk" CHECK ("status" IN ('Open','Closed','Cancelled','Revoked'));

CREATE TABLE "qms_revoke_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "fy_id" uuid NOT NULL REFERENCES "financial_years"("id") ON DELETE RESTRICT,
  "number" varchar(40) NOT NULL,
  "rejection_id" uuid NOT NULL REFERENCES "qms_rejections"("id") ON DELETE RESTRICT,
  "reason" varchar(500) NOT NULL,
  "status" varchar(10) NOT NULL DEFAULT 'Pending',
  "previous_status" varchar(10),
  "requested_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "requested_at" timestamptz(3) NOT NULL DEFAULT now(),
  "decided_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "decided_at" timestamptz(3),
  "decision_note" varchar(500),
  "override" boolean NOT NULL DEFAULT false,
  CONSTRAINT "qms_revoke_status_chk" CHECK ("status" IN ('Pending','Approved','Refused','Withdrawn')),
  CONSTRAINT "qms_revoke_reason_chk" CHECK (char_length(btrim("reason")) >= 5)
);
CREATE UNIQUE INDEX "qms_revoke_number_uq" ON "qms_revoke_requests"("unit_id","fy_id","number");
-- one waiting request per rejection
CREATE UNIQUE INDEX "qms_revoke_pending_uq" ON "qms_revoke_requests"("rejection_id") WHERE "status" = 'Pending';
CREATE INDEX "qms_revoke_rejection_idx" ON "qms_revoke_requests"("rejection_id");
CREATE INDEX "qms_revoke_fy_idx" ON "qms_revoke_requests"("fy_id");
CREATE INDEX "qms_revoke_requested_by_idx" ON "qms_revoke_requests"("requested_by_id");
CREATE INDEX "qms_revoke_decided_by_idx" ON "qms_revoke_requests"("decided_by_id");

-- ------------------------------------------------------------------ customer NCR and conformance NCR
CREATE TABLE "qms_ncrs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
  "fy_id" uuid NOT NULL REFERENCES "financial_years"("id") ON DELETE RESTRICT,
  "number" varchar(40) NOT NULL,
  "type" varchar(12) NOT NULL,
  "ncr_date" date NOT NULL DEFAULT CURRENT_DATE,
  "department" varchar(60) NOT NULL DEFAULT 'Quality',
  "priority" varchar(10) NOT NULL DEFAULT 'MINOR',
  "result" varchar(16) NOT NULL DEFAULT 'NON_CONFORMANCE',
  "customer_id" uuid REFERENCES "customers"("id") ON DELETE RESTRICT,
  "item_id" uuid REFERENCES "items"("id") ON DELETE RESTRICT,
  "reference" varchar(60),
  "process" varchar(120),
  "title" varchar(200) NOT NULL,
  "description" varchar(2000) NOT NULL,
  "qty" numeric(18,3),
  "claim_amount" numeric(18,2) NOT NULL DEFAULT 0,
  "eight_d" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "root_cause" varchar(2000),
  "corrective_action" varchar(2000),
  "preventive_action" varchar(2000),
  "owner_name" varchar(120),
  "target_date" date,
  "status" varchar(20) NOT NULL DEFAULT 'Open',
  "submitted_at" timestamptz(3),
  "submitted_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "return_comment" varchar(500),
  "returned_at" timestamptz(3),
  "returned_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "closed_at" timestamptz(3),
  "closed_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "closure_note" varchar(500),
  "cancel_reason" varchar(300),
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "deleted_at" timestamptz(3),
  "deleted_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "qms_ncrs_type_chk" CHECK ("type" IN ('CUSTOMER','CONFORMANCE')),
  CONSTRAINT "qms_ncrs_priority_chk" CHECK ("priority" IN ('MINOR','MAJOR','CRITICAL')),
  CONSTRAINT "qms_ncrs_result_chk" CHECK ("result" IN ('CONFORMANCE','NON_CONFORMANCE')),
  CONSTRAINT "qms_ncrs_status_chk" CHECK ("status" IN ('Open','Pending Acceptance','Closed','Cancelled')),
  CONSTRAINT "qms_ncrs_customer_chk" CHECK ("type" <> 'CUSTOMER' OR "customer_id" IS NOT NULL),
  CONSTRAINT "qms_ncrs_amount_chk" CHECK ("claim_amount" >= 0 AND ("qty" IS NULL OR "qty" >= 0))
);
CREATE UNIQUE INDEX "qms_ncrs_number_uq" ON "qms_ncrs"("unit_id","fy_id","number");
CREATE INDEX "qms_ncrs_unit_idx" ON "qms_ncrs"("unit_id","type","status");
CREATE INDEX "qms_ncrs_fy_idx" ON "qms_ncrs"("fy_id");
CREATE INDEX "qms_ncrs_customer_idx" ON "qms_ncrs"("customer_id");
CREATE INDEX "qms_ncrs_item_idx" ON "qms_ncrs"("item_id");
CREATE INDEX "qms_ncrs_submitted_by_idx" ON "qms_ncrs"("submitted_by_id");
CREATE INDEX "qms_ncrs_returned_by_idx" ON "qms_ncrs"("returned_by_id");
CREATE INDEX "qms_ncrs_closed_by_idx" ON "qms_ncrs"("closed_by_id");
CREATE INDEX "qms_ncrs_created_by_idx" ON "qms_ncrs"("created_by_id");
CREATE INDEX "qms_ncrs_updated_by_idx" ON "qms_ncrs"("updated_by_id");
CREATE INDEX "qms_ncrs_deleted_by_idx" ON "qms_ncrs"("deleted_by_id");

-- the approval trail of NCRs, inspections and revoke requests: who did what, and the comment they gave
CREATE TABLE "qms_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "entity" varchar(12) NOT NULL,
  "entity_id" uuid NOT NULL,
  "action" varchar(30) NOT NULL,
  "note" varchar(500),
  "by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "at" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "qms_events_entity_chk" CHECK ("entity" IN ('NCR','INSPECTION','REVOKE'))
);
CREATE INDEX "qms_events_entity_idx" ON "qms_events"("entity","entity_id","at");
CREATE INDEX "qms_events_by_idx" ON "qms_events"("by_id");

-- ------------------------------------------------------------------ record document formats, checklists, audit forms
CREATE TABLE "qms_doc_categories" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" varchar(80) NOT NULL,
  "description" varchar(300),
  "status" varchar(10) NOT NULL DEFAULT 'ACTIVE',
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "qms_doc_cat_status_chk" CHECK ("status" IN ('ACTIVE','INACTIVE'))
);
CREATE UNIQUE INDEX "qms_doc_cat_name_uq" ON "qms_doc_categories"(lower("name"));
CREATE INDEX "qms_doc_cat_created_by_idx" ON "qms_doc_categories"("created_by_id");

CREATE TABLE "qms_formats" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "type" varchar(14) NOT NULL,
  "category_id" uuid REFERENCES "qms_doc_categories"("id") ON DELETE RESTRICT,
  "code" varchar(40) NOT NULL,
  "title" varchar(200) NOT NULL,
  "revision" integer NOT NULL DEFAULT 0,
  "effective_date" date,
  "points" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "notes" varchar(1000),
  "status" varchar(10) NOT NULL DEFAULT 'ACTIVE',
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "deleted_at" timestamptz(3),
  "deleted_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "qms_formats_type_chk" CHECK ("type" IN ('CHECKLIST','AUDIT_FORM','RECORD_FORMAT')),
  CONSTRAINT "qms_formats_status_chk" CHECK ("status" IN ('ACTIVE','RETIRED'))
);
CREATE UNIQUE INDEX "qms_formats_code_uq" ON "qms_formats"(lower("code")) WHERE "deleted_at" IS NULL;
CREATE INDEX "qms_formats_category_idx" ON "qms_formats"("category_id");
CREATE INDEX "qms_formats_created_by_idx" ON "qms_formats"("created_by_id");
CREATE INDEX "qms_formats_updated_by_idx" ON "qms_formats"("updated_by_id");
CREATE INDEX "qms_formats_deleted_by_idx" ON "qms_formats"("deleted_by_id");

-- feature switches of the Quality module; every one of them changes what the server does
CREATE TABLE "qms_features" (
  "key" varchar(40) PRIMARY KEY,
  "enabled" boolean NOT NULL DEFAULT true,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL
);
CREATE INDEX "qms_features_updated_by_idx" ON "qms_features"("updated_by_id");
INSERT INTO "qms_features" ("key") VALUES ('CONDITIONED_CHECKS'), ('CRITICAL_ALERT'), ('CRITICAL_BLOCK');

-- ------------------------------------------------------------------ minutes of meeting: the department
-- A new version of the form in force: the same fields (whatever has been published), with a Department in front and the
-- action-item columns named as the specification names them. Written as three steps because only one version is active.
INSERT INTO "qms_templates" ("code","family","kind","name","version","status","header_fields","row_config","close_requires","change_reason")
SELECT t."code", t."family", t."kind", t."name",
  (SELECT max(x."version") FROM "qms_templates" x WHERE x."code" = t."code") + 1, 'RETIRED',
  '[{"key":"department","label":"Department","type":"select","options":["Administration","Sales","Purchase","Finance","HR","Production","Quality","Maintenance","Warehouse","Projects","Service"]}]'::jsonb
    || COALESCE((SELECT jsonb_agg(
          CASE WHEN f.field->>'key' = 'action_items' AND jsonb_typeof(f.field->'columns') = 'array' THEN
            jsonb_set(f.field, '{columns}', (SELECT jsonb_agg(
                CASE c.col->>'key'
                  WHEN 'point' THEN c.col || '{"label":"Action item"}'::jsonb
                  WHEN 'responsible' THEN c.col || '{"label":"Responsible owner"}'::jsonb
                  WHEN 'due_date' THEN c.col || '{"label":"Target date"}'::jsonb
                  ELSE c.col END ORDER BY c.at)
              FROM jsonb_array_elements(f.field->'columns') WITH ORDINALITY AS c(col, at)))
          ELSE f.field END ORDER BY f.at)
        FROM jsonb_array_elements(t."header_fields") WITH ORDINALITY AS f(field, at)), '[]'::jsonb),
  t."row_config", t."close_requires", 'quality-v2 department'
  FROM "qms_templates" t
 WHERE t."kind" = 'MOM' AND t."status" = 'ACTIVE' AND NOT t."header_fields" @> '[{"key":"department"}]';
UPDATE "qms_templates" t SET "status" = 'RETIRED'
 WHERE t."kind" = 'MOM' AND t."status" = 'ACTIVE'
   AND EXISTS (SELECT 1 FROM "qms_templates" n WHERE n."code" = t."code" AND n."change_reason" = 'quality-v2 department');
UPDATE "qms_templates" SET "status" = 'ACTIVE' WHERE "kind" = 'MOM' AND "change_reason" = 'quality-v2 department';

-- ------------------------------------------------------------------ alerts
INSERT INTO "notification_types"
  ("code", "module", "category", "label", "label_hi", "priority", "enabled",
   "allowed_channels", "default_channels", "mandatory_channels", "sensitive",
   "title_tpl", "body_tpl", "deep_link_tpl", "collapse_key_tpl", "digest_allowed")
VALUES
  ('quality.critical', 'Quality', 'ALERT', 'Critical quality record', 'गंभीर गुणवत्ता रिकॉर्ड', 'HIGH', true,
   ARRAY['IN_APP','EMAIL','PUSH'], ARRAY['IN_APP'], ARRAY['IN_APP'], false, '{{title}}', '{{body}}', '/m/qms-customer-ncr', 'quality:{{entityId}}', false),
  ('quality.pending', 'Quality', 'DOCUMENT', 'Quality record waiting for acceptance', 'गुणवत्ता रिकॉर्ड स्वीकृति की प्रतीक्षा में', 'NORMAL', true,
   ARRAY['IN_APP','EMAIL','PUSH'], ARRAY['IN_APP'], ARRAY['IN_APP'], false, '{{title}}', '{{body}}', '/m/qms-incoming', 'quality:{{entityId}}', true),
  ('quality.returned', 'Quality', 'DOCUMENT', 'Quality record returned to you', 'गुणवत्ता रिकॉर्ड आपको वापस भेजा गया', 'HIGH', true,
   ARRAY['IN_APP','EMAIL','PUSH'], ARRAY['IN_APP'], ARRAY['IN_APP'], false, '{{title}}', '{{body}}', '/m/qms-incoming', 'quality:{{entityId}}', false)
ON CONFLICT ("code") DO NOTHING;

-- ------------------------------------------------------------------ menu pages (an existing database gets them without re-seeding)
INSERT INTO "module_controls" ("page_id","owner_department","approval_required","updated_at")
SELECT p.id, d.name, false, now()
  FROM (VALUES ('qms-customer-ncr'),('qms-conformance-ncr'),('qms-templates'),('qms-rejection-revoke'),('qms-copq'),('qms-dashboard')) AS p(id)
  JOIN "departments" d ON d.name = 'Quality'
ON CONFLICT ("page_id") DO NOTHING;

-- ------------------------------------------------------------------ Management Representative and Quality Head
INSERT INTO "roles" ("id","code","name","description","level","is_system","all_units","status","updated_at")
SELECT gen_random_uuid(), r.code, r.name, r.description, 60, false, r.all_units, 'ACTIVE', now()
  FROM (VALUES
    ('MR', 'Management Representative (MR)', 'Full rights on every Quality / QMS page and on all departments of the Quality dashboard', true),
    ('QUALITY_HEAD', 'Quality Head', 'Full rights on every Quality / QMS page and on all departments of the Quality dashboard', false)
  ) AS r(code, name, description, all_units)
 WHERE NOT EXISTS (SELECT 1 FROM "roles" x WHERE x.code = r.code OR x.name = r.name);

INSERT INTO "role_permissions" ("id","role_id","resource","view","add","edit","delete","approve","export","controls","submit","post","cancel","print","import","scope","updated_at")
SELECT gen_random_uuid(), r.id, p.resource, p.v, p.v, p.v, p.v, p.v, p.v, p.c, p.v, p.v, p.v, p.v, p.v, p.scope::"DataScope", now()
  FROM "roles" r
 CROSS JOIN (VALUES
    ('*', true, false, 'DEPARTMENT'),
    ('family:Administration', false, false, 'OWN'),
    ('family:Quality / QMS', true, true, 'ALL')
  ) AS p(resource, v, c, scope)
 WHERE r.code IN ('MR', 'QUALITY_HEAD')
ON CONFLICT ("role_id","resource") DO NOTHING;
