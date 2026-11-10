-- Phase 16 Part A: Payroll Masters & Statutory Rates (E-22 GL Keys)

-- Accounts for Phase 16: PT_PAYABLE, LWF_PAYABLE, EMPLOYEE_LOAN, BONUS_PAYABLE, GRATUITY_PROVISION
INSERT INTO "accounts" ("code","name","parent_id","is_group","root_type","normal_balance","sub_type","posting_allowed","cost_center_required","party_required","control_side","cf_class","is_system")
SELECT '2105','Professional Tax Payable', p."id", false, 'Liability','Credit','Other', true, false, false, NULL, 'WC', true
  FROM "accounts" p WHERE p."code" = '2100'
ON CONFLICT DO NOTHING;

INSERT INTO "accounts" ("code","name","parent_id","is_group","root_type","normal_balance","sub_type","posting_allowed","cost_center_required","party_required","control_side","cf_class","is_system")
SELECT '2106','Labour Welfare Fund Payable', p."id", false, 'Liability','Credit','Other', true, false, false, NULL, 'WC', true
  FROM "accounts" p WHERE p."code" = '2100'
ON CONFLICT DO NOTHING;

INSERT INTO "accounts" ("code","name","parent_id","is_group","root_type","normal_balance","sub_type","posting_allowed","cost_center_required","party_required","control_side","cf_class","is_system")
SELECT '1503','Employee Loans', p."id", false, 'Asset','Debit','Other', true, false, true, 'PAYABLE', 'WC', true
  FROM "accounts" p WHERE p."code" = '1500'
ON CONFLICT DO NOTHING;

INSERT INTO "accounts" ("code","name","parent_id","is_group","root_type","normal_balance","sub_type","posting_allowed","cost_center_required","party_required","control_side","cf_class","is_system")
SELECT '2107','Bonus Payable', p."id", false, 'Liability','Credit','Other', true, false, false, NULL, 'WC', true
  FROM "accounts" p WHERE p."code" = '2100'
ON CONFLICT DO NOTHING;

INSERT INTO "accounts" ("code","name","parent_id","is_group","root_type","normal_balance","sub_type","posting_allowed","cost_center_required","party_required","control_side","cf_class","is_system")
SELECT '2301','Gratuity Provision', p."id", false, 'Liability','Credit','Other', true, false, false, NULL, 'WC', true
  FROM "accounts" p WHERE p."code" = '2000'
ON CONFLICT DO NOTHING;

INSERT INTO "account_defaults" ("key","account_id")
SELECT 'PT_PAYABLE', a."id" FROM "accounts" a WHERE a."code" = '2105'
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "account_defaults" ("key","account_id")
SELECT 'LWF_PAYABLE', a."id" FROM "accounts" a WHERE a."code" = '2106'
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "account_defaults" ("key","account_id")
SELECT 'EMPLOYEE_LOAN', a."id" FROM "accounts" a WHERE a."code" = '1503'
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "account_defaults" ("key","account_id")
SELECT 'BONUS_PAYABLE', a."id" FROM "accounts" a WHERE a."code" = '2107'
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "account_defaults" ("key","account_id")
SELECT 'GRATUITY_PROVISION', a."id" FROM "accounts" a WHERE a."code" = '2301'
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "posting_rules" ("event","line_key","seq","description","account_selector","account_ref","condition") VALUES
  ('*','PT_PAYABLE',99,'Professional tax payable','FIXED_CODE','2105',NULL),
  ('*','LWF_PAYABLE',99,'Labour welfare fund payable','FIXED_CODE','2106',NULL),
  ('*','EMPLOYEE_LOAN',99,'Employee loan recovery','FIXED_CODE','1503',NULL),
  ('*','BONUS_PAYABLE',99,'Statutory bonus payable','FIXED_CODE','2107',NULL),
  ('*','GRATUITY_PROVISION',99,'Gratuity provision accrued','FIXED_CODE','2301',NULL)
ON CONFLICT DO NOTHING;

CREATE TABLE "pay_components" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" varchar(30) NOT NULL UNIQUE,
  "name" varchar(100) NOT NULL,
  "kind" varchar(20) NOT NULL,
  "calc_type" varchar(20) NOT NULL,
  "formula" text,
  "prorate" boolean NOT NULL DEFAULT true,
  "taxable" boolean NOT NULL DEFAULT true,
  "pf_wage" boolean NOT NULL DEFAULT true,
  "esic_wage" boolean NOT NULL DEFAULT true,
  "pt_wage" boolean NOT NULL DEFAULT true,
  "code_wage_class" varchar(10) NOT NULL DEFAULT 'INCLUDED',
  "bonus_wage" boolean NOT NULL DEFAULT true,
  "gratuity_wage" boolean NOT NULL DEFAULT true,
  "rounding" varchar(10) NOT NULL DEFAULT 'HALF_UP',
  "payslip_order" integer NOT NULL DEFAULT 10,
  "payslip_label_hi" varchar(60),
  "gl_key" varchar(40) NOT NULL DEFAULT 'SALARY_EXPENSE',
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "pc_kind_chk" CHECK ("kind" IN ('EARNING','DEDUCTION','EMPLOYER_CONTRIB')),
  CONSTRAINT "pc_calc_type_chk" CHECK ("calc_type" IN ('FIXED','FORMULA','ATTENDANCE','INPUT','STATUTORY')),
  CONSTRAINT "pc_code_wage_class_chk" CHECK ("code_wage_class" IN ('INCLUDED','EXCLUDED'))
);

-- Seed standard components
INSERT INTO "pay_components" ("code","name","kind","calc_type","prorate","taxable","pf_wage","code_wage_class","payslip_order","gl_key") VALUES
  ('BASIC', 'Basic Salary', 'EARNING', 'FIXED', true, true, true, 'INCLUDED', 1, 'SALARY_EXPENSE'),
  ('HRA', 'House Rent Allowance', 'EARNING', 'FIXED', true, true, false, 'EXCLUDED', 2, 'SALARY_EXPENSE'),
  ('SPECIAL', 'Special Allowance', 'EARNING', 'FIXED', true, true, true, 'INCLUDED', 3, 'SALARY_EXPENSE'),
  ('CONV', 'Conveyance Allowance', 'EARNING', 'FIXED', true, true, false, 'EXCLUDED', 4, 'SALARY_EXPENSE'),
  ('OT', 'Overtime Pay', 'EARNING', 'ATTENDANCE', false, true, false, 'EXCLUDED', 5, 'SALARY_EXPENSE'),
  ('PF', 'Provident Fund (Employee)', 'DEDUCTION', 'STATUTORY', false, false, false, 'EXCLUDED', 10, 'PF_PAYABLE'),
  ('ESIC', 'ESI (Employee)', 'DEDUCTION', 'STATUTORY', false, false, false, 'EXCLUDED', 11, 'ESI_PAYABLE'),
  ('PT', 'Professional Tax', 'DEDUCTION', 'STATUTORY', false, false, false, 'EXCLUDED', 12, 'PT_PAYABLE'),
  ('TDS', 'Tax Deducted at Source', 'DEDUCTION', 'STATUTORY', false, false, false, 'EXCLUDED', 13, 'TDS_PAYABLE'),
  ('LOAN', 'Loan EMI Deduction', 'DEDUCTION', 'INPUT', false, false, false, 'EXCLUDED', 14, 'EMPLOYEE_LOAN'),
  ('VPF', 'Voluntary Provident Fund', 'DEDUCTION', 'INPUT', false, false, false, 'EXCLUDED', 15, 'PF_PAYABLE'),
  ('MLWF', 'Maharashtra Labour Welfare Fund', 'DEDUCTION', 'STATUTORY', false, false, false, 'EXCLUDED', 16, 'LWF_PAYABLE');

CREATE TABLE "pay_structures" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" varchar(30) NOT NULL UNIQUE,
  "name" varchar(100) NOT NULL,
  "description" text,
  "active" boolean NOT NULL DEFAULT true,
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now()
);

CREATE TABLE "pay_structure_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "structure_id" uuid NOT NULL REFERENCES "pay_structures"("id") ON DELETE CASCADE,
  "component_id" uuid NOT NULL REFERENCES "pay_components"("id") ON DELETE RESTRICT,
  "formula_override" text,
  "amount_override" numeric(18,2),
  "sequence" integer NOT NULL DEFAULT 10,
  "created_at" timestamptz(3) NOT NULL DEFAULT now()
);

CREATE TABLE "statutory_rates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "rate_type" varchar(30) NOT NULL,
  "state" varchar(60),
  "regime" varchar(10),
  "gender" varchar(10),
  "slab_from" numeric(18,2),
  "slab_to" numeric(18,2),
  "month_applicable" integer,
  "rate" numeric(7,4),
  "amount" numeric(18,2),
  "cap" numeric(18,2),
  "min_amount" numeric(18,2),
  "effective_from" date NOT NULL,
  "effective_to" date,
  "source_url" text NOT NULL,
  "needs_review" boolean NOT NULL DEFAULT true,
  "reviewed_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "reviewed_at" timestamptz(3),
  "created_at" timestamptz(3) NOT NULL DEFAULT now()
);

-- Seed statutory rates (§3, all needs_review=true with source_url)
INSERT INTO "statutory_rates" ("rate_type","rate","amount","cap","min_amount","effective_from","source_url","needs_review") VALUES
  ('PF_EMPLOYEE', 0.12, NULL, NULL, NULL, '2026-01-01', 'https://epfindia.gov.in', true),
  ('PF_EMPLOYER', 0.12, NULL, NULL, NULL, '2026-01-01', 'https://epfindia.gov.in', true),
  ('EPS', 0.0833, NULL, 1250, NULL, '2026-01-01', 'https://epfindia.gov.in', true),
  ('EDLI', 0.005, NULL, NULL, NULL, '2026-01-01', 'https://epfindia.gov.in', true),
  ('PF_ADMIN', 0.005, NULL, NULL, 500, '2026-01-01', 'https://epfindia.gov.in', true),
  ('PF_CEILING', NULL, 15000, 15000, NULL, '2026-01-01', 'https://epfindia.gov.in', true),
  ('ESIC_EMPLOYEE', 0.0075, NULL, NULL, NULL, '2026-01-01', 'https://esic.gov.in', true),
  ('ESIC_EMPLOYER', 0.0325, NULL, NULL, NULL, '2026-01-01', 'https://esic.gov.in', true),
  ('ESIC_CEILING', NULL, 21000, 21000, NULL, '2026-01-01', 'https://esic.gov.in', true),
  ('ESIC_EXEMPT_DAILY', NULL, 176, NULL, NULL, '2026-01-01', 'https://esic.gov.in', true),
  ('BONUS_RATE', 0.0833, NULL, NULL, NULL, '2026-01-01', 'https://labour.gov.in', true),
  ('GRATUITY_RATE', 0.048077, NULL, NULL, NULL, '2026-01-01', 'https://labour.gov.in', true),
  ('OT_MULTIPLIER', 2.0, NULL, NULL, NULL, '2026-01-01', 'https://labour.gov.in', true);

