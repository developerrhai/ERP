-- Phase 16 Part B: Salary Assignments & Revisions

CREATE TABLE "salary_revisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
  "old_ctc" numeric(18,2) NOT NULL,
  "new_ctc" numeric(18,2) NOT NULL,
  "effective_from" date NOT NULL,
  "reason" text NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'PENDING',
  "approved_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "approved_at" timestamptz(3),
  "arrears_computed" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "sr_status_chk" CHECK ("status" IN ('PENDING','APPROVED','REJECTED'))
);

CREATE TABLE "employee_salary_assignments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
  "structure_id" uuid NOT NULL REFERENCES "pay_structures"("id") ON DELETE RESTRICT,
  "monthly_ctc" numeric(18,2) NOT NULL,
  "effective_from" date NOT NULL,
  "effective_to" date,
  "revision_id" uuid REFERENCES "salary_revisions"("id") ON DELETE SET NULL,
  "status" varchar(20) NOT NULL DEFAULT 'ACTIVE',
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "esa_status_chk" CHECK ("status" IN ('ACTIVE','SUPERSEDED','DRAFT'))
);

CREATE TABLE "salary_assignment_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "assignment_id" uuid NOT NULL REFERENCES "employee_salary_assignments"("id") ON DELETE CASCADE,
  "component_id" uuid NOT NULL REFERENCES "pay_components"("id") ON DELETE RESTRICT,
  "monthly_amount" numeric(18,2) NOT NULL DEFAULT 0,
  "formula_override" text,
  "created_at" timestamptz(3) NOT NULL DEFAULT now()
);

CREATE INDEX "idx_esa_emp_date" ON "employee_salary_assignments"("employee_id", "effective_from", "effective_to");
CREATE INDEX "idx_sal_assignment_lines" ON "salary_assignment_lines"("assignment_id");
CREATE INDEX "idx_salary_revisions_emp" ON "salary_revisions"("employee_id", "effective_from");

