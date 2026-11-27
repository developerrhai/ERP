-- Lead Management (docs2 Lead_Management comparison report): the Add / Edit Lead form fields that had no column yet.
-- Source, Owner, Qualification Score and Expected Value already exist; Stage is the lead's status.
ALTER TABLE "leads"
  ADD COLUMN "campaign" varchar(150),
  ADD COLUMN "consent_status" varchar(10),
  ADD COLUMN "next_follow_up" date,
  ADD COLUMN "project_id" uuid REFERENCES "projects"("id") ON DELETE SET NULL;
ALTER TABLE "leads" ADD CONSTRAINT "leads_consent_chk" CHECK ("consent_status" IS NULL OR "consent_status" IN ('Pending', 'Granted', 'Withdrawn'));
CREATE INDEX "leads_project_idx" ON "leads"("project_id");
