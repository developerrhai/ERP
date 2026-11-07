-- Phase 07 M2: journals, journal lines, the immutable ledger (gl_entries), open items, allocations, posting rules.
-- Source: docs/archive/plans/05b 5.6-5.8 with these corrections (also listed in PHASE-07-REPORT.md):
--   F1  the journals guard trigger had `NEW.NEW.unit_id` / `OLD.OLD.unit_id` (invalid SQL): fixed, and deleted_at is now frozen too;
--   F2  balance is enforced PER UNIT inside a journal (owner rule), not only per journal;
--   F3  there is no `parties` table (E-13): party_type + party_id (CUSTOMER | SUPPLIER), checked by the service;
--   F4  the period table is the Phase 3 `financial_year_periods` (no second fiscal_periods table);
--   F5  a journal cannot become Posted unless its gl_entries exist and match its totals (deferred trigger).
-- Posted rows are never UPDATEd or DELETEd; corrections are reversal rows.

-- ---------------------------------------------------------------------------------------------------------
CREATE TABLE "journals" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id"         uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "fy_id"           uuid NOT NULL REFERENCES "financial_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "period_id"       uuid NULL REFERENCES "financial_year_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "code"            varchar(60) NOT NULL,
  "voucher_type"    varchar(30) NOT NULL REFERENCES "voucher_types"("code") ON DELETE RESTRICT ON UPDATE CASCADE,
  "doc_date"        date NOT NULL,
  "status"          text NOT NULL DEFAULT 'Draft',
  "posting_status"  text NOT NULL DEFAULT 'Not Posted',
  "source"          text NOT NULL DEFAULT 'MANUAL',
  "source_event"    text NULL,
  "source_doc_type" text NULL,
  "source_doc_id"   uuid NULL,
  "source_doc_no"   text NULL,
  "reference_no"    varchar(60) NULL,
  "narration"       text NULL,
  "supporting_doc"  varchar(200) NULL,
  "cost_center_id"  uuid NULL REFERENCES "cost_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "currency_code"   char(3) NOT NULL DEFAULT 'INR',
  "total_debit"     numeric(18,2) NOT NULL DEFAULT 0,
  "total_credit"    numeric(18,2) NOT NULL DEFAULT 0,
  "prepared_by"     uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "approved_by"     uuid NULL REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "approved_at"     timestamptz(3) NULL,
  "posted_by"       uuid NULL REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "posted_at"       timestamptz(3) NULL,
  "reversal_of_id"  uuid NULL REFERENCES "journals"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "reversed_by_id"  uuid NULL REFERENCES "journals"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "reversal_reason" varchar(300) NULL,
  "auto_reverse_on" date NULL,
  "warnings"        jsonb NOT NULL DEFAULT '[]'::jsonb,
  "version"         integer NOT NULL DEFAULT 1,
  "created_at"      timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id"   uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "updated_at"      timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id"   uuid NULL REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "deleted_at"      timestamptz(3) NULL,
  "deleted_by_id"   uuid NULL REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "journals_status_check" CHECK ("status" IN ('Draft','Posted','Cancelled')),
  CONSTRAINT "journals_posting_status_check" CHECK ("posting_status" IN ('Not Posted','Pending Approval','Approved','Rejected','Posted','Reversed')),
  CONSTRAINT "journals_source_check" CHECK ("source" IN ('MANUAL','EVENT','PAYMENT','NOTE','EXPENSE','TAX','SYSTEM')),
  CONSTRAINT "journals_totals_check" CHECK ("total_debit" >= 0 AND "total_credit" >= 0),
  CONSTRAINT "journals_posted_balanced_check" CHECK ("status" = 'Draft' OR "total_debit" = "total_credit"),
  CONSTRAINT "journals_posted_fields_check" CHECK ("status" = 'Draft' OR ("period_id" IS NOT NULL AND "posted_at" IS NOT NULL AND "code" NOT LIKE 'DRAFT-%')),
  CONSTRAINT "journals_reversal_check" CHECK ("reversal_of_id" IS NULL OR "reversal_of_id" <> "id"),
  CONSTRAINT "journals_currency_check" CHECK ("currency_code" = 'INR')
);
CREATE UNIQUE INDEX "journals_code_key" ON "journals" ("code");
CREATE UNIQUE INDEX "journals_event_idem_key" ON "journals" ("source_event","source_doc_type","source_doc_id")
  WHERE "source_event" IS NOT NULL AND "reversal_of_id" IS NULL;
CREATE UNIQUE INDEX "journals_reversal_of_key" ON "journals" ("reversal_of_id") WHERE "reversal_of_id" IS NOT NULL;
CREATE INDEX "journals_unit_id_doc_date_idx" ON "journals" ("unit_id","doc_date");
CREATE INDEX "journals_fy_id_idx" ON "journals" ("fy_id");
CREATE INDEX "journals_period_id_idx" ON "journals" ("period_id");
CREATE INDEX "journals_status_idx" ON "journals" ("status","posting_status");
CREATE INDEX "journals_source_doc_idx" ON "journals" ("source_doc_type","source_doc_id");
CREATE INDEX "journals_cost_center_id_idx" ON "journals" ("cost_center_id");
CREATE INDEX "journals_prepared_by_idx" ON "journals" ("prepared_by");
CREATE INDEX "journals_reversed_by_id_idx" ON "journals" ("reversed_by_id");

CREATE TABLE "journal_lines" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "journal_id"       uuid NOT NULL REFERENCES "journals"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "line_no"          integer NOT NULL,
  "unit_id"          uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "account_id"       uuid NOT NULL REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "debit"            numeric(18,2) NOT NULL DEFAULT 0,
  "credit"           numeric(18,2) NOT NULL DEFAULT 0,
  "party_type"       text NULL,
  "party_id"         uuid NULL,
  "cost_center_id"   uuid NULL REFERENCES "cost_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "profit_center_id" uuid NULL REFERENCES "profit_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "narration"        varchar(300) NULL,
  "bill_mode"        text NULL,
  "bill_doc_no"      varchar(60) NULL,
  "bill_doc_date"    date NULL,
  "bill_due_date"    date NULL,
  "currency_code"    char(3) NOT NULL DEFAULT 'INR',
  CONSTRAINT "journal_lines_one_side_check" CHECK ("debit" >= 0 AND "credit" >= 0 AND (("debit" > 0 AND "credit" = 0) OR ("credit" > 0 AND "debit" = 0))),
  CONSTRAINT "journal_lines_bill_mode_check" CHECK ("bill_mode" IS NULL OR "bill_mode" IN ('NEW','AGAINST')),
  CONSTRAINT "journal_lines_party_check" CHECK (("party_id" IS NULL) = ("party_type" IS NULL) AND ("party_type" IS NULL OR "party_type" IN ('CUSTOMER','SUPPLIER')))
);
CREATE UNIQUE INDEX "journal_lines_journal_id_line_no_key" ON "journal_lines" ("journal_id","line_no");
CREATE INDEX "journal_lines_account_id_idx" ON "journal_lines" ("account_id");
CREATE INDEX "journal_lines_party_idx" ON "journal_lines" ("party_type","party_id");
CREATE INDEX "journal_lines_cost_center_id_idx" ON "journal_lines" ("cost_center_id");
CREATE INDEX "journal_lines_profit_center_id_idx" ON "journal_lines" ("profit_center_id");
CREATE INDEX "journal_lines_unit_id_idx" ON "journal_lines" ("unit_id");

CREATE TABLE "gl_entries" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "seq"              bigint GENERATED ALWAYS AS IDENTITY,
  "unit_id"          uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "journal_id"       uuid NOT NULL REFERENCES "journals"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "journal_line_id"  uuid NOT NULL REFERENCES "journal_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "posting_date"     date NOT NULL,
  "fy_id"            uuid NOT NULL REFERENCES "financial_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "period_id"        uuid NOT NULL REFERENCES "financial_year_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "account_id"       uuid NOT NULL REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "debit"            numeric(18,2) NOT NULL DEFAULT 0,
  "credit"           numeric(18,2) NOT NULL DEFAULT 0,
  "party_type"       text NULL,
  "party_id"         uuid NULL,
  "cost_center_id"   uuid NULL REFERENCES "cost_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "profit_center_id" uuid NULL REFERENCES "profit_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "voucher_type"     varchar(30) NOT NULL REFERENCES "voucher_types"("code") ON DELETE RESTRICT ON UPDATE CASCADE,
  "voucher_no"       varchar(60) NOT NULL,
  "source_doc_type"  text NULL,
  "source_doc_id"    uuid NULL,
  "source_doc_no"    text NULL,
  "narration"        varchar(300) NULL,
  "is_closing"       boolean NOT NULL DEFAULT false,
  "is_reversal"      boolean NOT NULL DEFAULT false,
  "reverses_gl_id"   uuid NULL REFERENCES "gl_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "currency_code"    char(3) NOT NULL DEFAULT 'INR',
  "created_at"       timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id"    uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "gl_entries_one_side_check" CHECK ("debit" >= 0 AND "credit" >= 0 AND (("debit" > 0 AND "credit" = 0) OR ("credit" > 0 AND "debit" = 0))),
  CONSTRAINT "gl_entries_party_check" CHECK (("party_id" IS NULL) = ("party_type" IS NULL))
);
CREATE UNIQUE INDEX "gl_entries_journal_line_id_key" ON "gl_entries" ("journal_line_id");
CREATE UNIQUE INDEX "gl_entries_seq_key" ON "gl_entries" ("seq");
CREATE INDEX "gl_entries_account_date_idx" ON "gl_entries" ("account_id","posting_date","seq");
CREATE INDEX "gl_entries_unit_date_idx" ON "gl_entries" ("unit_id","posting_date");
CREATE INDEX "gl_entries_journal_id_idx" ON "gl_entries" ("journal_id");
CREATE INDEX "gl_entries_party_idx" ON "gl_entries" ("party_type","party_id","account_id");
CREATE INDEX "gl_entries_cost_center_idx" ON "gl_entries" ("cost_center_id","posting_date");
CREATE INDEX "gl_entries_profit_center_idx" ON "gl_entries" ("profit_center_id","posting_date");
CREATE INDEX "gl_entries_fy_period_idx" ON "gl_entries" ("fy_id","period_id");
CREATE INDEX "gl_entries_source_idx" ON "gl_entries" ("source_doc_type","source_doc_id");
CREATE INDEX "gl_entries_reverses_gl_id_idx" ON "gl_entries" ("reverses_gl_id");
CREATE INDEX "gl_entries_created_by_id_idx" ON "gl_entries" ("created_by_id");

-- ---------------------------------------------------------------------------------------------------------
-- TRIGGERS
-- (a) the ledger and the allocations are append-only
CREATE FUNCTION fin_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '% is append-only (% blocked)', TG_TABLE_NAME, TG_OP USING ERRCODE = 'P0001'; END $$;
CREATE TRIGGER gl_entries_no_update_delete BEFORE UPDATE OR DELETE ON "gl_entries"
  FOR EACH ROW EXECUTE FUNCTION fin_append_only();
CREATE TRIGGER gl_entries_no_truncate BEFORE TRUNCATE ON "gl_entries"
  FOR EACH STATEMENT EXECUTE FUNCTION fin_append_only();

-- (b) F2: every journal balances PER UNIT at COMMIT (deferred), and has at least 2 rows
CREATE FUNCTION fin_assert_journal_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE u record; n integer;
BEGIN
  SELECT COUNT(*) INTO n FROM "gl_entries" WHERE "journal_id" = NEW."journal_id";
  IF n < 2 THEN
    RAISE EXCEPTION 'JOURNAL_UNBALANCED journal=% rows=%', NEW."journal_id", n USING ERRCODE = 'P0001';
  END IF;
  FOR u IN
    SELECT "unit_id", SUM("debit") AS d, SUM("credit") AS c FROM "gl_entries"
     WHERE "journal_id" = NEW."journal_id" GROUP BY "unit_id"
  LOOP
    IF u.d <> u.c THEN
      RAISE EXCEPTION 'JOURNAL_UNBALANCED journal=% unit=% debit=% credit=%', NEW."journal_id", u."unit_id", u.d, u.c USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER gl_entries_balanced AFTER INSERT ON "gl_entries"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fin_assert_journal_balanced();

-- (c) journal lines are frozen unless the parent journal is a Draft
CREATE FUNCTION fin_journal_lines_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
  IF TG_OP = 'DELETE' THEN SELECT "status" INTO st FROM "journals" WHERE "id" = OLD."journal_id";
  ELSE SELECT "status" INTO st FROM "journals" WHERE "id" = NEW."journal_id"; END IF;
  IF st IS NOT NULL AND st <> 'Draft' THEN
    RAISE EXCEPTION 'journal lines of a % journal cannot be changed', st USING ERRCODE = 'P0001';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER journal_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON "journal_lines"
  FOR EACH ROW EXECUTE FUNCTION fin_journal_lines_guard();

-- (d) F1: a posted journal is immutable (only status / posting_status / reversal link / version / audit columns move)
CREATE FUNCTION fin_journals_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'Draft' THEN RAISE EXCEPTION 'a posted journal cannot be deleted' USING ERRCODE = 'P0001'; END IF;
    RETURN OLD;
  END IF;
  IF OLD."status" = 'Cancelled' THEN RAISE EXCEPTION 'a cancelled journal cannot be changed' USING ERRCODE = 'P0001'; END IF;
  IF OLD."status" = 'Posted' THEN
    IF NEW."status" NOT IN ('Posted','Cancelled')
       OR (NEW."unit_id", NEW."fy_id", NEW."period_id", NEW."code", NEW."voucher_type", NEW."doc_date", NEW."total_debit",
           NEW."total_credit", NEW."narration", NEW."source", NEW."source_event", NEW."source_doc_id", NEW."reversal_of_id", NEW."deleted_at")
          IS DISTINCT FROM
          (OLD."unit_id", OLD."fy_id", OLD."period_id", OLD."code", OLD."voucher_type", OLD."doc_date", OLD."total_debit",
           OLD."total_credit", OLD."narration", OLD."source", OLD."source_event", OLD."source_doc_id", OLD."reversal_of_id", OLD."deleted_at")
    THEN RAISE EXCEPTION 'a posted journal is immutable (only status / reversal link may change)' USING ERRCODE = 'P0001'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER journals_guard BEFORE UPDATE OR DELETE ON "journals"
  FOR EACH ROW EXECUTE FUNCTION fin_journals_guard();

-- (e) F5: a journal that becomes Posted must have its ledger rows, equal to its totals (checked at COMMIT)
CREATE FUNCTION fin_journal_has_ledger() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d numeric; c numeric;
BEGIN
  IF NEW."status" = 'Posted' AND OLD."status" = 'Draft' THEN
    SELECT COALESCE(SUM("debit"),0), COALESCE(SUM("credit"),0) INTO d, c FROM "gl_entries" WHERE "journal_id" = NEW."id";
    IF d <> NEW."total_debit" OR c <> NEW."total_credit" OR d = 0 THEN
      RAISE EXCEPTION 'JOURNAL_UNBALANCED journal=% ledger debit=% credit=% header debit=% credit=%', NEW."id", d, c, NEW."total_debit", NEW."total_credit" USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER journals_posted_has_ledger AFTER UPDATE OF "status" ON "journals"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fin_journal_has_ledger();

-- ---------------------------------------------------------------------------------------------------------
-- Sub-ledger (bill-wise AR / AP)
CREATE TABLE "open_items" (
  "id"                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id"             uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "side"                text NOT NULL,
  "party_type"          text NOT NULL,
  "party_id"            uuid NOT NULL,
  "item_type"           text NOT NULL,
  "doc_type"            text NULL,
  "doc_id"              uuid NULL,
  "doc_no"              varchar(60) NOT NULL,
  "doc_date"            date NOT NULL,
  "due_date"            date NULL,
  "amount"              numeric(18,2) NOT NULL,
  "settled_amount"      numeric(18,2) NOT NULL DEFAULT 0,
  "outstanding"         numeric(18,2) GENERATED ALWAYS AS (CASE WHEN "amount" > 0 THEN "amount" - "settled_amount" ELSE "amount" + "settled_amount" END) STORED,
  "currency_code"       char(3) NOT NULL DEFAULT 'INR',
  "journal_id"          uuid NOT NULL REFERENCES "journals"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "status"              text NOT NULL DEFAULT 'Open',
  "blocked_reason"      varchar(200) NULL,
  "payment_method"      text NULL,
  "collection_owner_id" uuid NULL REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "promise_date"        date NULL,
  "promise_amount"      numeric(18,2) NULL,
  "msme_due_date"       date NULL,
  "tds_withheld"        numeric(18,2) NOT NULL DEFAULT 0,
  "dispute_reason"      varchar(200) NULL,
  "version"             integer NOT NULL DEFAULT 1,
  "created_at"          timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id"       uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "updated_at"          timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id"       uuid NULL REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "open_items_side_check" CHECK ("side" IN ('RECEIVABLE','PAYABLE')),
  CONSTRAINT "open_items_party_type_check" CHECK ("party_type" IN ('CUSTOMER','SUPPLIER')),
  CONSTRAINT "open_items_type_check" CHECK ("item_type" IN ('INVOICE','CREDIT_NOTE','DEBIT_NOTE','RECEIPT','PAYMENT','ADVANCE','OPENING','JOURNAL')),
  CONSTRAINT "open_items_amount_check" CHECK ("amount" <> 0),
  CONSTRAINT "open_items_settled_check" CHECK ("settled_amount" >= 0 AND "settled_amount" <= abs("amount")),
  CONSTRAINT "open_items_status_check" CHECK ("status" IN ('Open','Settled','Disputed','Blocked','Cancelled')),
  CONSTRAINT "open_items_method_check" CHECK ("payment_method" IS NULL OR "payment_method" IN ('NEFT','RTGS','IMPS','UPI','Cheque','Cash'))
);
CREATE UNIQUE INDEX "open_items_party_doc_key" ON "open_items" ("side","party_type","party_id","item_type","doc_no") WHERE "status" <> 'Cancelled';
CREATE INDEX "open_items_party_idx" ON "open_items" ("side","party_type","party_id","status");
CREATE INDEX "open_items_due_idx" ON "open_items" ("side","due_date") WHERE "outstanding" <> 0;
CREATE INDEX "open_items_unit_id_idx" ON "open_items" ("unit_id");
CREATE INDEX "open_items_journal_id_idx" ON "open_items" ("journal_id");
CREATE INDEX "open_items_doc_idx" ON "open_items" ("doc_type","doc_id");
CREATE INDEX "open_items_collection_owner_id_idx" ON "open_items" ("collection_owner_id");

-- the identity of an open item never changes; only the settlement and the follow-up fields do
CREATE FUNCTION fin_open_items_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW."unit_id", NEW."side", NEW."party_type", NEW."party_id", NEW."item_type", NEW."doc_no", NEW."doc_date", NEW."amount", NEW."journal_id")
     IS DISTINCT FROM
     (OLD."unit_id", OLD."side", OLD."party_type", OLD."party_id", OLD."item_type", OLD."doc_no", OLD."doc_date", OLD."amount", OLD."journal_id")
  THEN RAISE EXCEPTION 'an open item keeps its identity and amount; settle it with an allocation' USING ERRCODE = 'P0001'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER open_items_guard BEFORE UPDATE ON "open_items" FOR EACH ROW EXECUTE FUNCTION fin_open_items_guard();

CREATE TABLE "allocations" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id"        uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "source_item_id" uuid NOT NULL REFERENCES "open_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "target_item_id" uuid NOT NULL REFERENCES "open_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "amount"         numeric(18,2) NOT NULL,
  "allocated_on"   date NOT NULL,
  "payment_id"     uuid NULL,
  "journal_id"     uuid NULL REFERENCES "journals"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "reverses_id"    uuid NULL REFERENCES "allocations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "created_at"     timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id"  uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "allocations_amount_check" CHECK ("amount" <> 0),
  CONSTRAINT "allocations_distinct_check" CHECK ("source_item_id" <> "target_item_id"),
  CONSTRAINT "allocations_reversal_check" CHECK (("amount" < 0) = ("reverses_id" IS NOT NULL))
);
CREATE INDEX "allocations_source_idx" ON "allocations" ("source_item_id");
CREATE INDEX "allocations_target_idx" ON "allocations" ("target_item_id");
CREATE INDEX "allocations_payment_idx" ON "allocations" ("payment_id");
CREATE INDEX "allocations_unit_id_idx" ON "allocations" ("unit_id");
CREATE INDEX "allocations_journal_id_idx" ON "allocations" ("journal_id");
CREATE INDEX "allocations_reverses_id_idx" ON "allocations" ("reverses_id");
CREATE INDEX "allocations_created_by_id_idx" ON "allocations" ("created_by_id");
CREATE TRIGGER allocations_no_update_delete BEFORE UPDATE OR DELETE ON "allocations" FOR EACH ROW EXECUTE FUNCTION fin_append_only();
CREATE TRIGGER allocations_no_truncate BEFORE TRUNCATE ON "allocations" FOR EACH STATEMENT EXECUTE FUNCTION fin_append_only();

-- ---------------------------------------------------------------------------------------------------------
-- Posting rules (MAP): producers send symbolic account keys (D-13); Finance maps them. Lower seq wins;
-- a rule with a condition applies only when the condition matches the line / payload.
CREATE TABLE "posting_rules" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "event"            varchar(60) NOT NULL,
  "line_key"         varchar(40) NOT NULL,
  "seq"              smallint NOT NULL,
  "description"      varchar(200) NOT NULL,
  "account_selector" text NOT NULL,
  "account_ref"      varchar(120) NOT NULL,
  "condition"        jsonb NULL,
  "effective_from"   date NOT NULL DEFAULT DATE '2000-01-01',
  "effective_to"     date NULL,
  "is_active"        boolean NOT NULL DEFAULT true,
  "version"          integer NOT NULL DEFAULT 1,
  "created_at"       timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id"    uuid NULL REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "updated_at"       timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id"    uuid NULL REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "posting_rules_selector_check" CHECK ("account_selector" IN ('FIXED_CODE','DEFAULT_KEY','PAYLOAD_BANK_ACCOUNT')),
  CONSTRAINT "posting_rules_dates_check" CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from")
);
CREATE UNIQUE INDEX "posting_rules_event_key_seq_from_key" ON "posting_rules" ("event","line_key","seq","effective_from");
CREATE INDEX "posting_rules_event_idx" ON "posting_rules" ("event","line_key","is_active");

-- MAP seed (05a 4.1.3 d + errata E-10 names). Conditions: {"path":"line.itemType","eq":"..."} or {"path":"payload.x","eq":true}.
INSERT INTO "posting_rules" ("event","line_key","seq","description","account_selector","account_ref","condition") VALUES
 ('*','INVENTORY',1,'Semi-finished stock','FIXED_CODE','1302','{"path":"line.itemType","eq":"Semi-Finished"}'),
 ('*','INVENTORY',2,'Finished goods','FIXED_CODE','1303','{"path":"line.itemType","eq":"Finished Good"}'),
 ('*','INVENTORY',3,'Consumables','FIXED_CODE','1304','{"path":"line.itemType","eq":"Consumable"}'),
 ('*','INVENTORY',4,'Spare parts','FIXED_CODE','1305','{"path":"line.itemType","eq":"Spare Part"}'),
 ('*','INVENTORY',5,'Packing material','FIXED_CODE','1306','{"path":"line.itemType","eq":"Packing Material"}'),
 ('*','INVENTORY',99,'Raw materials (default)','FIXED_CODE','1301',NULL),
 ('*','INVENTORY_RM',99,'Inventory - raw material','DEFAULT_KEY','INVENTORY_RM',NULL),
 ('*','INVENTORY_WIP',99,'Inventory - work in progress','DEFAULT_KEY','INVENTORY_WIP',NULL),
 ('*','INVENTORY_FG',99,'Inventory - finished goods','DEFAULT_KEY','INVENTORY_FG',NULL),
 ('*','STOCK_IN_TRANSIT',99,'Materials in transit','DEFAULT_KEY','STOCK_IN_TRANSIT',NULL),
 ('*','INTER_UNIT_CLEARING',99,'Goods in transit (inter-unit)','FIXED_CODE','1308',NULL),
 ('*','OPENING_BALANCE_EQUITY',99,'Opening balance equity','DEFAULT_KEY','OPENING_BALANCE_EQUITY',NULL),
 ('*','STOCK_SUSPENSE',99,'Stock suspense','DEFAULT_KEY','STOCK_SUSPENSE',NULL),
 ('*','CONSUMPTION_EXPENSE',99,'Materials consumed','DEFAULT_KEY','CONSUMPTION_EXPENSE',NULL),
 ('*','STOCK_ADJUSTMENT',99,'Inventory adjustment','DEFAULT_KEY','STOCK_ADJUSTMENT',NULL),
 ('*','SCRAP_LOSS',99,'Scrap and wastage','FIXED_CODE','5109',NULL),
 ('*','INVENTORY_REVALUATION_GAIN',99,'Revaluation gain','FIXED_CODE','4209',NULL),
 ('*','INVENTORY_REVALUATION_LOSS',99,'Revaluation loss','FIXED_CODE','5113',NULL),
 ('*','INVENTORY_WRITE_DOWN',99,'NRV write-down','FIXED_CODE','5114',NULL),
 ('*','LANDED_COST_VARIANCE',99,'Landed cost variance','FIXED_CODE','5115',NULL),
 ('*','LANDED_COST_CLEARING',99,'Landed cost clearing','FIXED_CODE','2151',NULL),
 ('*','GRIR',99,'GRN clearing','FIXED_CODE','2150',NULL),
 ('*','GRNI',99,'GRN clearing','FIXED_CODE','2150',NULL),
 ('*','AP_CONTROL',1,'Employee reimbursements payable','FIXED_CODE','2104','{"path":"payload.partyType","eq":"EMPLOYEE"}'),
 ('*','AP_CONTROL',2,'Trade payables - imports','FIXED_CODE','2102','{"path":"payload.isImport","eq":true}'),
 ('*','AP_CONTROL',99,'Trade payables - domestic','FIXED_CODE','2101',NULL),
 ('*','PURCHASE_PRICE_VARIANCE',99,'Purchase price variance','FIXED_CODE','5111',NULL),
 ('*','PURCHASE_EXPENSE',99,'Non-stock purchases','FIXED_CODE','5102',NULL),
 ('*','ITC_INELIGIBLE_EXPENSE',99,'Ineligible GST credit expensed','FIXED_CODE','6269',NULL),
 ('*','INPUT_CGST',99,'Input CGST','FIXED_CODE','1401',NULL),
 ('*','INPUT_SGST',99,'Input SGST','FIXED_CODE','1402',NULL),
 ('*','INPUT_IGST',99,'Input IGST','FIXED_CODE','1403',NULL),
 ('*','INPUT_CESS',99,'Input cess','FIXED_CODE','1404',NULL),
 ('*','RCM_PAYABLE_CGST',99,'RCM CGST payable','FIXED_CODE','2305',NULL),
 ('*','RCM_PAYABLE_SGST',99,'RCM SGST payable','FIXED_CODE','2306',NULL),
 ('*','RCM_PAYABLE_IGST',99,'RCM IGST payable','FIXED_CODE','2307',NULL),
 ('*','RCM_PAYABLE_CESS',99,'RCM cess payable','FIXED_CODE','2308',NULL),
 ('*','TDS_PAYABLE',99,'TDS payable','FIXED_CODE','2311',NULL),
 ('*','TDS_RECEIVABLE',99,'TDS receivable','FIXED_CODE','1410',NULL),
 ('*','AR',1,'Trade receivables - export','FIXED_CODE','1202','{"path":"payload.invoiceType","in":["Export","SEZ"]}'),
 ('*','AR',99,'Trade receivables - domestic','FIXED_CODE','1201',NULL),
 ('*','SALES',1,'Sales - export','FIXED_CODE','4102','{"path":"payload.invoiceType","in":["Export","SEZ"]}'),
 ('*','SALES',2,'Service income','FIXED_CODE','4105','{"path":"line.itemType","eq":"Service"}'),
 ('*','SALES',3,'Job work income','FIXED_CODE','4104','{"path":"payload.dispatchType","eq":"Job Work"}'),
 ('*','SALES',99,'Sales - domestic','FIXED_CODE','4101',NULL),
 ('*','SALES_RETURNS',99,'Sales returns','FIXED_CODE','4107',NULL),
 ('*','COGS',99,'Cost of goods sold','FIXED_CODE','5101',NULL),
 ('*','OUTPUT_CGST',99,'Output CGST','FIXED_CODE','2301',NULL),
 ('*','OUTPUT_SGST',99,'Output SGST','FIXED_CODE','2302',NULL),
 ('*','OUTPUT_IGST',99,'Output IGST','FIXED_CODE','2303',NULL),
 ('*','OUTPUT_CESS',99,'Output cess','FIXED_CODE','2304',NULL),
 ('*','ROUND_OFF',99,'Round off','FIXED_CODE','6270',NULL),
 ('*','BANK_OR_CASH',1,'Receipt/payment through a named bank account','PAYLOAD_BANK_ACCOUNT','bankAccountId','{"path":"payload.bankAccountId","exists":true}'),
 ('*','BANK_OR_CASH',2,'Cash','FIXED_CODE','1101','{"path":"payload.paymentMode","eq":"Cash"}'),
 ('*','BANK_OR_CASH',99,'Default bank','DEFAULT_KEY','DEFAULT_BANK',NULL),
 ('*','CUSTOMER_ADVANCE',99,'Customer advances','FIXED_CODE','2401',NULL);
