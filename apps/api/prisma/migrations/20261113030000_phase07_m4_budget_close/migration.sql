-- Phase 07 M4: budgets and the year-end closing record.
-- Source: docs/archive/plans/05b 5.10 (budgets, budget_months, fiscal_year_closings), reduced to what v1 enforces.

CREATE TABLE "budgets" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "fy_id"          uuid NOT NULL REFERENCES "financial_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "unit_id"        uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "account_id"     uuid NOT NULL REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "cost_center_id" uuid NULL REFERENCES "cost_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "name"           varchar(120) NOT NULL,
  "status"         text NOT NULL DEFAULT 'Draft',
  "version"        integer NOT NULL DEFAULT 1,
  "created_at"     timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id"  uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "updated_at"     timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id"  uuid NULL REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "deleted_at"     timestamptz(3) NULL,
  "deleted_by_id"  uuid NULL REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "budgets_status_check" CHECK ("status" IN ('Draft','Active','Closed'))
);
-- one live budget per (year, unit, account, cost centre); NULL cost centre = the account as a whole
CREATE UNIQUE INDEX "budgets_scope_key" ON "budgets" ("fy_id","unit_id","account_id",COALESCE("cost_center_id", '00000000-0000-0000-0000-000000000000'::uuid)) WHERE "deleted_at" IS NULL;
CREATE INDEX "budgets_unit_id_idx" ON "budgets" ("unit_id");
CREATE INDEX "budgets_account_id_idx" ON "budgets" ("account_id");
CREATE INDEX "budgets_cost_center_id_idx" ON "budgets" ("cost_center_id");
CREATE INDEX "budgets_created_by_id_idx" ON "budgets" ("created_by_id");

CREATE TABLE "budget_months" (
  "id"        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "budget_id" uuid NOT NULL REFERENCES "budgets"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "period_no" smallint NOT NULL,
  "amount"    numeric(18,2) NOT NULL,
  CONSTRAINT "budget_months_period_check" CHECK ("period_no" BETWEEN 1 AND 12),
  CONSTRAINT "budget_months_amount_check" CHECK ("amount" >= 0)
);
CREATE UNIQUE INDEX "budget_months_key" ON "budget_months" ("budget_id","period_no");

-- one closing journal per unit per year (a journal must balance per unit, so closing is per unit)
CREATE TABLE "fy_closings" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "fy_id"         uuid NOT NULL REFERENCES "financial_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "unit_id"       uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "journal_id"    uuid NULL REFERENCES "journals"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "net_profit"    numeric(18,2) NOT NULL,
  "closed_at"     timestamptz(3) NOT NULL DEFAULT now(),
  "closed_by_id"  uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "fy_closings_fy_unit_key" ON "fy_closings" ("fy_id","unit_id");
CREATE INDEX "fy_closings_unit_id_idx" ON "fy_closings" ("unit_id");
CREATE INDEX "fy_closings_journal_id_idx" ON "fy_closings" ("journal_id");
CREATE INDEX "fy_closings_closed_by_id_idx" ON "fy_closings" ("closed_by_id");
