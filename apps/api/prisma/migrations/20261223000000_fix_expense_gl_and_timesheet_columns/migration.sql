-- Seeding defects, idempotent (safe to run on a database that already has some or all of this).
--
-- 1. Expense categories pointed at GL keys 6251-6255 and 6260. In the chart of accounts 6251-6255 are Finance Costs
--    (interest) and 6260 is the group "Other Expenses", which cannot be posted to, so approving an expense claim
--    could not post a valid journal. Point each category at a real, postable employee-expense account, and create
--    the two accounts below only if the chart does not have them yet.
-- 2. timesheets had no updated_at column, but submitting, approving and rejecting a timesheet set it.

-- 1a. Missing accounts (only inserted when the code is absent)
INSERT INTO "accounts" ("code","name","parent_id","is_group","root_type","normal_balance","sub_type","posting_allowed","cost_center_required","party_required","control_side","cf_class","is_system")
SELECT '6223','Lodging', p."id", false, 'Expense','Debit','Other', true, true, false, NULL, 'NA', true
  FROM "accounts" p WHERE p."code" = '6200'
ON CONFLICT DO NOTHING;

INSERT INTO "accounts" ("code","name","parent_id","is_group","root_type","normal_balance","sub_type","posting_allowed","cost_center_required","party_required","control_side","cf_class","is_system")
SELECT '6264','Miscellaneous Expense', p."id", false, 'Expense','Debit','Other', true, true, false, NULL, 'NA', true
  FROM "accounts" p WHERE p."code" = '6260'
ON CONFLICT DO NOTHING;

-- 1b. Category mapping: only rows still on the old, wrong keys (a key an admin chose later is left alone)
UPDATE "expense_categories" SET "gl_key" = '6206' WHERE "name" = 'Travel & Conveyance'          AND "gl_key" IN ('6251','6260');
UPDATE "expense_categories" SET "gl_key" = '6218' WHERE "name" = 'Meals & Entertainment'        AND "gl_key" IN ('6252','6260');
UPDATE "expense_categories" SET "gl_key" = '6223' WHERE "name" = 'Lodging & Hotel'              AND "gl_key" IN ('6253','6260');
UPDATE "expense_categories" SET "gl_key" = '6217' WHERE "name" = 'Office Supplies'              AND "gl_key" IN ('6254','6260');
UPDATE "expense_categories" SET "gl_key" = '6204' WHERE "name" = 'Communication / Telephone'    AND "gl_key" IN ('6255','6260');
UPDATE "expense_categories" SET "gl_key" = '6264' WHERE "name" = 'Other Employee Expenses'      AND "gl_key" = '6260';
-- any other category still on the group key 6260 goes to Miscellaneous Expense
UPDATE "expense_categories" SET "gl_key" = '6264' WHERE "gl_key" = '6260';
ALTER TABLE "expense_categories" ALTER COLUMN "gl_key" SET DEFAULT '6264';

-- 2. timesheets.updated_at
ALTER TABLE "timesheets" ADD COLUMN IF NOT EXISTS "updated_at" timestamptz(3) NOT NULL DEFAULT now();
