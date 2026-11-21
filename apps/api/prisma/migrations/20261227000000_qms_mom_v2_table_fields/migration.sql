-- Minutes of meeting, version 2: attendees and action items as real rows (the new 'table' header-field type), not one
-- free-text "points discussed" block. Closes Quality_Department_ERP_Comparison.pdf row 8 ("no dedicated module /
-- structured rows for MOM"). Retires the version-1 global default template and republishes it under the same code.

UPDATE "qms_templates" SET "status" = 'RETIRED'
WHERE "code" = 'TPL-MOM' AND "status" = 'ACTIVE';

INSERT INTO "qms_templates" ("code","family","kind","name","version","header_fields","row_config","close_requires")
SELECT 'TPL-MOM','FORM','MOM','Minutes of meeting', COALESCE(MAX("version"), 0) + 1,
 '[{"key":"location","label":"Location","type":"text"},
   {"key":"customer_reps","label":"Customer representatives","type":"text"},
   {"key":"own_reps","label":"Our representatives","type":"text"},
   {"key":"attendees","label":"Attendees","type":"table","columns":[
     {"key":"name","label":"Name"},
     {"key":"designation","label":"Designation"},
     {"key":"organization","label":"Organization"}]},
   {"key":"agenda","label":"Agenda","type":"textarea","required":true},
   {"key":"action_items","label":"Action items","type":"table","columns":[
     {"key":"point","label":"Point"},
     {"key":"responsible","label":"Responsible"},
     {"key":"due_date","label":"Due date","type":"date"},
     {"key":"status","label":"Status"}]},
   {"key":"next_meeting_date","label":"Next meeting date","type":"date"}]',
 '{}','[]'
FROM "qms_templates" WHERE "code" = 'TPL-MOM';
