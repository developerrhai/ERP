-- Phase 16 Part F: Bank Transfers, Payslips, FnF & Gratuity

CREATE TABLE "bank_file_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" varchar(100) NOT NULL UNIQUE,
  "bank_name" varchar(100) NOT NULL,
  "file_format" varchar(20) NOT NULL DEFAULT 'CSV',
  "column_mapping" jsonb NOT NULL,
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz(3) NOT NULL DEFAULT now()
);

-- Seed standard bank template
INSERT INTO "bank_file_templates" ("name", "bank_name", "file_format", "column_mapping") VALUES
  ('HDFC Standard Corporate Salary', 'HDFC Bank', 'CSV', '{"accountCol":"AccountNo","nameCol":"BeneficiaryName","amountCol":"Amount","ifscCol":"IFSC","refCol":"PaymentRef"}'::jsonb),
  ('ICICI Bank Bulk Pay', 'ICICI Bank', 'CSV', '{"accountCol":"BeneficiaryAccount","nameCol":"BeneficiaryName","amountCol":"Amount","ifscCol":"IFSCCode","refCol":"Remarks"}'::jsonb),
  ('SBI Corporate Net Banking', 'State Bank of India', 'CSV', '{"accountCol":"AccountNumber","nameCol":"Name","amountCol":"Amount","ifscCol":"IFSC","refCol":"TxnRemarks"}'::jsonb);

CREATE TABLE "bank_transfer_batches" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "batch_no" varchar(50) NOT NULL UNIQUE,
  "payroll_run_id" uuid NOT NULL REFERENCES "payroll_runs"("id") ON DELETE RESTRICT,
  "bank_template_id" uuid REFERENCES "bank_file_templates"("id") ON DELETE SET NULL,
  "total_amount" numeric(18,2) NOT NULL DEFAULT 0,
  "total_records" integer NOT NULL DEFAULT 0,
  "file_doc_id" uuid REFERENCES "stored_files"("id") ON DELETE SET NULL,
  "status" varchar(20) NOT NULL DEFAULT 'GENERATED',
  "generated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "acknowledged_at" timestamptz(3),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "btb_status_chk" CHECK ("status" IN ('GENERATED','UPLOADED','ACKED','PARTIAL','FAILED'))
);

CREATE TABLE "bank_transfer_batch_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "batch_id" uuid NOT NULL REFERENCES "bank_transfer_batches"("id") ON DELETE CASCADE,
  "employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE RESTRICT,
  "beneficiary_name" varchar(150) NOT NULL,
  "ifsc_code" varchar(20) NOT NULL,
  "account_number_masked" varchar(30) NOT NULL,
  "amount" numeric(18,2) NOT NULL,
  "utr" varchar(100),
  "status" varchar(20) NOT NULL DEFAULT 'PENDING',
  "fail_reason" text,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "btbl_status_chk" CHECK ("status" IN ('PENDING','SUCCESS','FAILED'))
);

CREATE TABLE "payslips" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "payslip_no" varchar(50) NOT NULL UNIQUE,
  "run_employee_id" uuid NOT NULL UNIQUE REFERENCES "payroll_run_employees"("id") ON DELETE CASCADE,
  "employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE RESTRICT,
  "period_id" uuid NOT NULL REFERENCES "payroll_periods"("id") ON DELETE RESTRICT,
  "pdf_doc_id" uuid REFERENCES "stored_files"("id") ON DELETE SET NULL,
  "released_at" timestamptz(3),
  "email_status" varchar(20) NOT NULL DEFAULT 'PENDING',
  "download_count" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "ps_email_chk" CHECK ("email_status" IN ('PENDING','SENT','FAILED','SKIPPED'))
);

CREATE TABLE "fnf_settlements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "settlement_no" varchar(50) NOT NULL UNIQUE,
  "employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE RESTRICT,
  "fnf_handoff_id" uuid REFERENCES "fnf_handoffs"("id") ON DELETE SET NULL,
  "period_id" uuid REFERENCES "payroll_periods"("id") ON DELETE SET NULL,
  "exit_date" date NOT NULL,
  "notice_pay_recovery" numeric(18,2) NOT NULL DEFAULT 0,
  "leave_encashment_days" numeric(6,2) NOT NULL DEFAULT 0,
  "leave_encashment_amount" numeric(18,2) NOT NULL DEFAULT 0,
  "gratuity_amount" numeric(18,2) NOT NULL DEFAULT 0,
  "loan_balance_deducted" numeric(18,2) NOT NULL DEFAULT 0,
  "other_additions" numeric(18,2) NOT NULL DEFAULT 0,
  "other_deductions" numeric(18,2) NOT NULL DEFAULT 0,
  "net_payable" numeric(18,2) NOT NULL DEFAULT 0,
  "status" varchar(20) NOT NULL DEFAULT 'DRAFT',
  "approved_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "approved_at" timestamptz(3),
  "payroll_run_id" uuid REFERENCES "payroll_runs"("id") ON DELETE SET NULL,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "fnf_status_chk" CHECK ("status" IN ('DRAFT','APPROVED','PAID'))
);

CREATE TABLE "gratuity_records" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE RESTRICT,
  "date_of_joining" date NOT NULL,
  "date_of_leaving" date NOT NULL,
  "completed_years" integer NOT NULL,
  "last_drawn_wage" numeric(18,2) NOT NULL,
  "calculated_amount" numeric(18,2) NOT NULL,
  "paid_amount" numeric(18,2) NOT NULL,
  "paid_date" date,
  "status" varchar(20) NOT NULL DEFAULT 'PROVISIONED',
  "created_at" timestamptz(3) NOT NULL DEFAULT now()
);

CREATE INDEX "idx_batch_run" ON "bank_transfer_batches"("payroll_run_id");
CREATE INDEX "idx_payslips_emp" ON "payslips"("employee_id", "period_id");
CREATE INDEX "idx_fnf_emp" ON "fnf_settlements"("employee_id");

