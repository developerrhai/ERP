-- Meetings & Calls: the detail fields of the V40 reference (QA report 24 Nov 2026): Location Mode, Agenda, Project Number,
-- and the Email / WhatsApp channels of the Add Activity panel. Organizer = owner_id, Participants = attendees (already there).
ALTER TABLE "crm_meetings" ADD COLUMN IF NOT EXISTS "location_mode" varchar(30);
ALTER TABLE "crm_meetings" ADD COLUMN IF NOT EXISTS "agenda" varchar(1000);
ALTER TABLE "crm_meetings" ADD COLUMN IF NOT EXISTS "project_id" uuid REFERENCES "projects"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "crm_meetings_project_idx" ON "crm_meetings"("project_id");
ALTER TABLE "crm_meetings" DROP CONSTRAINT IF EXISTS "meetings_kind_chk";
ALTER TABLE "crm_meetings" ADD CONSTRAINT "meetings_kind_chk" CHECK ("kind" IN ('Meeting','Call','Email','WhatsApp'));
