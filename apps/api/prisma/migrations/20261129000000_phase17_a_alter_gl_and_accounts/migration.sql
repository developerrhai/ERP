-- Phase 17 Part A: Alter Ledger for Project & AMC tracking (ERRATA E-20) + Account Defaults

ALTER TABLE "journal_lines" ADD COLUMN IF NOT EXISTS "project_id" uuid;
ALTER TABLE "journal_lines" ADD COLUMN IF NOT EXISTS "amc_contract_id" uuid;
ALTER TABLE "gl_entries" ADD COLUMN IF NOT EXISTS "project_id" uuid;
ALTER TABLE "gl_entries" ADD COLUMN IF NOT EXISTS "amc_contract_id" uuid;

CREATE INDEX IF NOT EXISTS "journal_lines_project_idx" ON "journal_lines" ("project_id");
CREATE INDEX IF NOT EXISTS "journal_lines_amc_idx" ON "journal_lines" ("amc_contract_id");
CREATE INDEX IF NOT EXISTS "gl_entries_project_idx" ON "gl_entries" ("project_id");
CREATE INDEX IF NOT EXISTS "gl_entries_amc_idx" ON "gl_entries" ("amc_contract_id");

-- Seed Accounts for Phase 17
INSERT INTO "accounts" ("code","name","parent_id","is_group","root_type","normal_balance","sub_type","posting_allowed","cost_center_required","party_required","control_side","cf_class","is_system")
SELECT '5112','Project Labour Cost', p."id", false, 'Expense','Debit','Other', true, true, false, NULL, 'NA', true
  FROM "accounts" p WHERE p."code" = '5100'
ON CONFLICT DO NOTHING;

INSERT INTO "accounts" ("code","name","parent_id","is_group","root_type","normal_balance","sub_type","posting_allowed","cost_center_required","party_required","control_side","cf_class","is_system")
SELECT '5113','Labour Cost Absorbed', p."id", false, 'Expense','Credit','Other', true, true, false, NULL, 'NA', true
  FROM "accounts" p WHERE p."code" = '5100'
ON CONFLICT DO NOTHING;

INSERT INTO "accounts" ("code","name","parent_id","is_group","root_type","normal_balance","sub_type","posting_allowed","cost_center_required","party_required","control_side","cf_class","is_system")
SELECT '2402','AMC Deferred Revenue', p."id", false, 'Liability','Credit','Other', true, false, false, NULL, 'WC', true
  FROM "accounts" p WHERE p."code" = '2400'
ON CONFLICT DO NOTHING;

INSERT INTO "accounts" ("code","name","parent_id","is_group","root_type","normal_balance","sub_type","posting_allowed","cost_center_required","party_required","control_side","cf_class","is_system")
SELECT '4110','AMC Service Revenue', p."id", false, 'Income','Credit','Other', true, true, false, NULL, 'NA', true
  FROM "accounts" p WHERE p."code" = '4100'
ON CONFLICT DO NOTHING;

INSERT INTO "accounts" ("code","name","parent_id","is_group","root_type","normal_balance","sub_type","posting_allowed","cost_center_required","party_required","control_side","cf_class","is_system")
SELECT '6218','Warranty Cost', p."id", false, 'Expense','Debit','Other', true, true, false, NULL, 'NA', true
  FROM "accounts" p WHERE p."code" = '6200'
ON CONFLICT DO NOTHING;

INSERT INTO "accounts" ("code","name","parent_id","is_group","root_type","normal_balance","sub_type","posting_allowed","cost_center_required","party_required","control_side","cf_class","is_system")
SELECT '4205','Warranty Cost Recovery', p."id", false, 'Income','Credit','Other', true, true, false, NULL, 'NA', true
  FROM "accounts" p WHERE p."code" = '4200'
ON CONFLICT DO NOTHING;

INSERT INTO "accounts" ("code","name","parent_id","is_group","root_type","normal_balance","sub_type","posting_allowed","cost_center_required","party_required","control_side","cf_class","is_system")
SELECT '1205','Supplier Claim Receivable', p."id", false, 'Asset','Debit','Other', true, false, true, 'RECEIVABLE', 'WC', true
  FROM "accounts" p WHERE p."code" = '1200'
ON CONFLICT DO NOTHING;

INSERT INTO "accounts" ("code","name","parent_id","is_group","root_type","normal_balance","sub_type","posting_allowed","cost_center_required","party_required","control_side","cf_class","is_system")
SELECT '5114','AMC Service Cost', p."id", false, 'Expense','Debit','Other', true, true, false, NULL, 'NA', true
  FROM "accounts" p WHERE p."code" = '5100'
ON CONFLICT DO NOTHING;

INSERT INTO "accounts" ("code","name","parent_id","is_group","root_type","normal_balance","sub_type","posting_allowed","cost_center_required","party_required","control_side","cf_class","is_system")
SELECT '5115','Cost of Service Spares', p."id", false, 'Expense','Debit','Other', true, true, false, NULL, 'NA', true
  FROM "accounts" p WHERE p."code" = '5100'
ON CONFLICT DO NOTHING;

-- Seed account defaults
INSERT INTO "account_defaults" ("key","account_id")
SELECT 'PROJECT_LABOUR_COST', a."id" FROM "accounts" a WHERE a."code" = '5112'
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "account_defaults" ("key","account_id")
SELECT 'LABOUR_COST_ABSORBED', a."id" FROM "accounts" a WHERE a."code" = '5113'
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "account_defaults" ("key","account_id")
SELECT 'AMC_DEFERRED_REVENUE', a."id" FROM "accounts" a WHERE a."code" = '2402'
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "account_defaults" ("key","account_id")
SELECT 'AMC_SERVICE_REVENUE', a."id" FROM "accounts" a WHERE a."code" = '4110'
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "account_defaults" ("key","account_id")
SELECT 'WARRANTY_COST', a."id" FROM "accounts" a WHERE a."code" = '6218'
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "account_defaults" ("key","account_id")
SELECT 'WARRANTY_COST_RECOVERY', a."id" FROM "accounts" a WHERE a."code" = '4205'
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "account_defaults" ("key","account_id")
SELECT 'SUPPLIER_CLAIM_RECEIVABLE', a."id" FROM "accounts" a WHERE a."code" = '1205'
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "account_defaults" ("key","account_id")
SELECT 'AMC_SERVICE_COST', a."id" FROM "accounts" a WHERE a."code" = '5114'
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "account_defaults" ("key","account_id")
SELECT 'SERVICE_COST', a."id" FROM "accounts" a WHERE a."code" = '5115'
ON CONFLICT ("key") DO NOTHING;
