-- Meetings & Calls: the person picks the status from the V40 list instead of it being fixed at Planned.
ALTER TABLE "crm_meetings" DROP CONSTRAINT IF EXISTS "crm_meetings_status_chk";
ALTER TABLE "crm_meetings" ADD CONSTRAINT "crm_meetings_status_chk" CHECK ("status" IN ('Planned', 'Draft', 'Open', 'Active', 'Submitted', 'Pending', 'Pending Approval', 'Pending Inspection', 'In Progress', 'Ready', 'Released', 'Approved', 'Dispatched', 'In Transit', 'Delivered', 'Received', 'Accepted', 'Partially Accepted', 'On Hold', 'Rework', 'Completed', 'Closed', 'Held', 'Cancelled'));
