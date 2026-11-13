-- Phase 22 fix: the Phase 16 payroll SQL reads employees.full_name, date_of_joining, has_disability,
-- designation and department, which the Phase 15 employees table does not have (it has first_name /
-- last_name / joining_date, and designation + department live on employee_assignments). Every payroll
-- calculation, payslip, bank file and ECR / ESIC export failed with "column does not exist".
-- This read-only view gives payroll the columns it expects, computed from real data only.
-- has_disability is NOT stored anywhere yet: it is false for everyone until HR captures it (no guess).
CREATE OR REPLACE VIEW "payroll_employees_v" AS
SELECT e.*,
       trim(e."first_name" || ' ' || coalesce(e."last_name", '')) AS "full_name",
       e."joining_date" AS "date_of_joining",
       false AS "has_disability",
       d."name" AS "designation",
       a."department" AS "department"
  FROM "employees" e
  LEFT JOIN LATERAL (
        SELECT x."department", x."designation_id"
          FROM "employee_assignments" x
         WHERE x."employee_id" = e."id" AND (x."effective_to" IS NULL OR x."effective_to" >= CURRENT_DATE)
         ORDER BY x."effective_from" DESC
         LIMIT 1
       ) a ON true
  LEFT JOIN "designations" d ON d."id" = a."designation_id";

-- The same drift for identity and bank details: payroll reads pan / uan / esic_number / aadhaar_encrypted
-- and account_number_encrypted / ifsc_code / account_name, the HR tables store pan, uan, esic_ip,
-- aadhaar_enc, account_enc and ifsc. Read-only views map them (no data is copied or changed).
CREATE OR REPLACE VIEW "payroll_identity_v" AS
SELECT e."id" AS "employee_id", e."pan", e."uan", e."esic_ip" AS "esic_number",
       v."aadhaar_enc" AS "aadhaar_encrypted"
  FROM "employees" e
  LEFT JOIN "employee_identity_vault" v ON v."employee_id" = e."id";

CREATE OR REPLACE VIEW "payroll_bank_v" AS
SELECT b."employee_id", b."is_primary", b."bank_name",
       b."account_enc" AS "account_number_encrypted",
       b."ifsc" AS "ifsc_code",
       NULL::varchar AS "account_name"
  FROM "employee_bank_accounts" b;
