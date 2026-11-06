-- Helper functions used by every later migration -------------------------------------------
CREATE FUNCTION "inv_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (% not allowed)', TG_TABLE_NAME, TG_OP USING ERRCODE = 'restrict_violation';
END;
$$;
CREATE FUNCTION "inv_make_append_only"(tbl text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION inv_append_only()', tbl || '_no_update_delete', tbl);
  EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION inv_append_only()', tbl || '_no_truncate', tbl);
END;
$$;

-- uoms: Units of measure (foundation 3.3). Code is the same text the items table already stores in base_uom / alt_uom.
CREATE TABLE "uoms" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL,
  "code" varchar(20) NOT NULL,
  "name" varchar(60) NOT NULL,
  "uom_class" varchar(12) NOT NULL DEFAULT 'Count',
  "decimals" smallint NOT NULL DEFAULT 3,
  "status" varchar(10) NOT NULL DEFAULT 'Active',
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid NOT NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid,
  "version" integer NOT NULL DEFAULT 1,
  "deleted_at" timestamptz(3),
  "deleted_by_id" uuid,
  CONSTRAINT "uoms_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "uoms_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "uoms_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "uoms_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "uoms_deleted_by_id_fkey" FOREIGN KEY ("deleted_by_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "uoms_uom_class_check" CHECK (uom_class IN ('Count','Weight','Length','Volume','Area','Time','Other')),
  CONSTRAINT "uoms_decimals_check" CHECK (decimals BETWEEN 0 AND 6),
  CONSTRAINT "uoms_status_check" CHECK (status IN ('Active','Inactive')),
  CONSTRAINT "uoms_code_format" CHECK (code ~ '^[A-Za-z0-9._/ -]{1,20}$')
);
CREATE UNIQUE INDEX "uoms_code_key" ON "uoms" ("code");

-- uom_conversions: Conversion factors. item_id NULL = global row; an item row wins over a global row. 1 from_uom = factor x to_uom.
CREATE TABLE "uom_conversions" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL,
  "item_id" uuid,
  "from_uom_id" uuid NOT NULL,
  "to_uom_id" uuid NOT NULL,
  "factor" numeric(18,6) NOT NULL,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "created_by_id" uuid NOT NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_by_id" uuid,
  "version" integer NOT NULL DEFAULT 1,
  "deleted_at" timestamptz(3),
  "deleted_by_id" uuid,
  CONSTRAINT "uom_conversions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "uom_conversions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "uom_conversions_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "uom_conversions_from_uom_id_fkey" FOREIGN KEY ("from_uom_id") REFERENCES "uoms" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "uom_conversions_to_uom_id_fkey" FOREIGN KEY ("to_uom_id") REFERENCES "uoms" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "uom_conversions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "uom_conversions_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "uom_conversions_deleted_by_id_fkey" FOREIGN KEY ("deleted_by_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "uom_conversions_factor_check" CHECK (factor > 0),
  CONSTRAINT "uom_conversions_differ" CHECK (from_uom_id <> to_uom_id)
);
CREATE INDEX "uom_conversions_item_id_idx" ON "uom_conversions" ("item_id");
CREATE INDEX "uom_conversions_from_uom_id_idx" ON "uom_conversions" ("from_uom_id");
CREATE INDEX "uom_conversions_to_uom_id_idx" ON "uom_conversions" ("to_uom_id");
CREATE UNIQUE INDEX "uom_conversions_unique" ON "uom_conversions" (COALESCE("item_id", '00000000-0000-0000-0000-000000000000'::uuid), "from_uom_id", "to_uom_id") WHERE "deleted_at" IS NULL;

-- accounting_event_queue: Foundation 5: operational modules record accounting events here until Finance drains the queue. Idempotent by (event, doc_type, doc_id).
CREATE TABLE "accounting_event_queue" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL,
  "event" varchar(40) NOT NULL,
  "doc_type" varchar(30) NOT NULL,
  "doc_id" uuid NOT NULL,
  "doc_date" date NOT NULL,
  "unit_id" uuid,
  "payload" jsonb NOT NULL,
  "status" varchar(8) NOT NULL DEFAULT 'PENDING',
  "journal_id" uuid,
  "error" text,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "processed_at" timestamptz(3),
  CONSTRAINT "accounting_event_queue_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "accounting_event_queue_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "accounting_event_queue_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "accounting_event_queue_status_check" CHECK (status IN ('PENDING','POSTED','FAILED'))
);
CREATE UNIQUE INDEX "accounting_event_queue_event_doc_type_doc_id_key" ON "accounting_event_queue" ("event", "doc_type", "doc_id");
CREATE INDEX "accounting_event_queue_status_created_at_idx" ON "accounting_event_queue" ("status", "created_at");
CREATE INDEX "accounting_event_queue_unit_id_idx" ON "accounting_event_queue" ("unit_id");

-- items ------------------------------------------------------------------------------------
ALTER TABLE "items"
  ADD COLUMN "valuation_method" varchar(12) NOT NULL DEFAULT 'MOVING_AVG',
  ADD COLUMN "qc_required"      boolean     NOT NULL DEFAULT false,
  ADD COLUMN "unit_weight_kg"   numeric(18,3),
  ADD COLUMN "storage_units"    numeric(18,6) NOT NULL DEFAULT 1;
ALTER TABLE "items" ADD CONSTRAINT "items_valuation_method" CHECK ("valuation_method" IN ('MOVING_AVG','FIFO','STANDARD'));
ALTER TABLE "items" ADD CONSTRAINT "items_unit_weight_kg" CHECK ("unit_weight_kg" IS NULL OR "unit_weight_kg" >= 0);
ALTER TABLE "items" ADD CONSTRAINT "items_storage_units" CHECK ("storage_units" > 0);
ALTER TABLE "items" ADD CONSTRAINT "items_one_tracking" CHECK (NOT ("batch_tracked" AND "serial_tracked")) NOT VALID;

-- warehouses -------------------------------------------------------------------------------
ALTER TABLE "warehouses"
  ADD COLUMN "bin_managed"      boolean    NOT NULL DEFAULT false,
  ADD COLUMN "putaway_required" boolean    NOT NULL DEFAULT false,
  ADD COLUMN "pick_method"      varchar(6) NOT NULL DEFAULT 'FEFO';
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_pick_method" CHECK ("pick_method" IN ('FEFO','FIFO','MANUAL'));

-- stock_balances ---------------------------------------------------------------------------
ALTER TABLE "stock_balances"
  ADD COLUMN "reserved_qty"     numeric(18,3) NOT NULL DEFAULT 0,
  ADD COLUMN "negative_allowed" boolean       NOT NULL DEFAULT false;
ALTER TABLE "stock_balances" DROP CONSTRAINT "stock_balances_not_negative";
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_not_negative" CHECK ("on_hand" >= 0 OR "negative_allowed");
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_reserved_valid" CHECK ("reserved_qty" >= 0 AND "reserved_qty" <= GREATEST("on_hand", 0));

-- stock_ledger (append-only trigger fires on UPDATE/DELETE/TRUNCATE only; ALTER TABLE is allowed) --
ALTER TABLE "stock_ledger"
  ADD COLUMN "batch_id"         uuid,
  ADD COLUMN "bin_id"           uuid,
  ADD COLUMN "uom"              varchar(20),
  ADD COLUMN "uom_factor"       numeric(18,6),
  ADD COLUMN "ppv"              numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN "reason_code"      varchar(30),
  ADD COLUMN "negative_allowed" boolean NOT NULL DEFAULT false;
ALTER TABLE "stock_ledger" DROP CONSTRAINT "stock_ledger_balance_not_negative";
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_balance_not_negative" CHECK ("balance_qty" >= 0 OR "negative_allowed");
ALTER TABLE "stock_ledger" DROP CONSTRAINT "stock_ledger_one_direction";
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_one_direction" CHECK (
  ("qty_in" > 0 AND "qty_out" = 0) OR ("qty_in" = 0 AND "qty_out" > 0)
  OR ("voucher_type" = 'REVALUATION' AND "qty_in" = 0 AND "qty_out" = 0));
ALTER TABLE "stock_ledger" DROP CONSTRAINT "stock_ledger_voucher_type";
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_voucher_type" CHECK ("voucher_type" IN
  ('OPENING','RECEIPT','ISSUE','ADJUSTMENT','TRANSFER_OUT','TRANSFER_IN','REVERSAL','RECONCILIATION','REVALUATION'));

-- stock_vouchers ---------------------------------------------------------------------------
ALTER TABLE "stock_vouchers"
  ADD COLUMN "entered_qty"       numeric(18,3),
  ADD COLUMN "uom"               varchar(20),
  ADD COLUMN "uom_factor"        numeric(18,6),
  ADD COLUMN "mfg_date"          date,
  ADD COLUMN "expiry_date"       date,
  ADD COLUMN "serial_nos"        jsonb,
  ADD COLUMN "approved_by_id"    uuid,
  ADD COLUMN "reason_note"       varchar(300),
  ADD COLUMN "upload_batch"      varchar(40),
  ADD COLUMN "validation_status" varchar(8);
ALTER TABLE "stock_vouchers" ADD CONSTRAINT "stock_vouchers_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "stock_vouchers" ADD CONSTRAINT "stock_vouchers_validation_status" CHECK ("validation_status" IS NULL OR "validation_status" IN ('Valid','Warning','Error'));
ALTER TABLE "stock_vouchers" ADD CONSTRAINT "stock_vouchers_uom_factor" CHECK ("uom_factor" IS NULL OR "uom_factor" > 0);

-- inventory policy (settings.key is varchar(60), value is jsonb)
INSERT INTO "settings" ("key","value","version","created_at","updated_at") VALUES ('inventory.policy', '{
 "allowNegativeStock": false, "enforceUomPrecision": false,
 "reservationDays": 14, "autoReleaseReservations": true, "releaseOnDemandCancel": true,
 "nearExpiryDays": 60, "approvalThresholdValue": 10000, "reconThresholdValue": 10000,
 "countTolerancePct": 2, "countToleranceValue": 500,
 "movementDays": {"fast": 30, "normal": 90, "slow": 180},
 "abc": {"aCumPct": 80, "bCumPct": 95, "freqDays": {"A": 30, "B": 90, "C": 365}},
 "xyz": {"xMaxCv": 0.5, "yMaxCv": 1.0},
 "usageWindowDays": 90, "serviceLevelDefaultPct": 95, "holdingCostPctDefault": 20,
 "packWeightTolerancePct": 2, "volumetricDivisor": 5000, "missedReadHours": 24
}'::jsonb, 1, now(), now()) ON CONFLICT ("key") DO NOTHING;

-- UOMs: the nine the item form already offers, plus any code already used by items
INSERT INTO "uoms" ("company_id","code","name","uom_class","decimals","status","created_by_id")
SELECT (SELECT "id" FROM "companies" ORDER BY "created_at" LIMIT 1), v.code, v.name, v.cls, v.dec, 'Active',
       (SELECT "id" FROM "users" ORDER BY "created_at" LIMIT 1)
FROM (VALUES ('Nos','Numbers','Count',0),('Set','Set','Count',0),('Pair','Pair','Count',0),('Box','Box','Count',0),
             ('Roll','Roll','Count',0),('Sheet','Sheet','Count',0),('Kg','Kilogram','Weight',3),
             ('Meter','Meter','Length',3),('Litre','Litre','Volume',3)) AS v(code,name,cls,dec)
WHERE EXISTS (SELECT 1 FROM "companies") AND EXISTS (SELECT 1 FROM "users")
ON CONFLICT DO NOTHING;
INSERT INTO "uoms" ("company_id","code","name","uom_class","decimals","status","created_by_id")
SELECT (SELECT "id" FROM "companies" ORDER BY "created_at" LIMIT 1), u.code, u.code, 'Other', 3, 'Active',
       (SELECT "id" FROM "users" ORDER BY "created_at" LIMIT 1)
FROM (SELECT "base_uom" AS code FROM "items" UNION SELECT "alt_uom" FROM "items" WHERE "alt_uom" IS NOT NULL) u
WHERE EXISTS (SELECT 1 FROM "companies") AND EXISTS (SELECT 1 FROM "users")
ON CONFLICT DO NOTHING;
