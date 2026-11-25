-- Opportunity Management: the fields the V40 reference form has and this ERP lacked (QA report 24 Nov 2026):
-- Primary Contact, Competitor, Next Action and the Project Number link. Salesperson already is "owner_id", Stage is "status".
ALTER TABLE "opportunities" ADD COLUMN IF NOT EXISTS "primary_contact" varchar(150);
ALTER TABLE "opportunities" ADD COLUMN IF NOT EXISTS "competitor" varchar(150);
ALTER TABLE "opportunities" ADD COLUMN IF NOT EXISTS "next_action" varchar(300);
ALTER TABLE "opportunities" ADD COLUMN IF NOT EXISTS "project_id" uuid REFERENCES "projects"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "opps_project_idx" ON "opportunities"("project_id");
