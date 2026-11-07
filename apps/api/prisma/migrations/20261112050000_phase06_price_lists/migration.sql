-- Phase 06 M6: price lists (docs/phases/PHASE-06.md §4). Base only: header, rows, quantity slabs, dates.
CREATE TABLE "price_lists" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" VARCHAR(30) NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "kind" VARCHAR(8) NOT NULL DEFAULT 'SELLING',
  "currency_code" VARCHAR(3) NOT NULL DEFAULT 'INR',
  "customer_id" UUID REFERENCES "customers"("id") ON DELETE CASCADE,
  "supplier_id" UUID REFERENCES "suppliers"("id") ON DELETE CASCADE,
  "customer_group_id" UUID REFERENCES "party_groups"("id") ON DELETE SET NULL,
  "price_includes_tax" BOOLEAN NOT NULL DEFAULT false,
  "valid_from" DATE,
  "valid_to" DATE,
  "is_default" BOOLEAN NOT NULL DEFAULT false,
  "status" VARCHAR(10) NOT NULL DEFAULT 'ACTIVE',
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "created_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "deleted_at" TIMESTAMPTZ(3),
  "deleted_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "price_lists_kind_chk" CHECK ("kind" IN ('SELLING','BUYING')),
  CONSTRAINT "price_lists_status_chk" CHECK ("status" IN ('ACTIVE','INACTIVE')),
  CONSTRAINT "price_lists_dates_chk" CHECK ("valid_to" IS NULL OR "valid_from" IS NULL OR "valid_to" >= "valid_from"),
  CONSTRAINT "price_lists_code_uq" UNIQUE ("code")
);
-- One default list per kind and currency.
CREATE UNIQUE INDEX "price_lists_default_uq" ON "price_lists"("kind", "currency_code") WHERE "is_default" AND "status" = 'ACTIVE' AND "deleted_at" IS NULL;
CREATE INDEX "price_lists_customer_idx" ON "price_lists"("customer_id");
CREATE INDEX "price_lists_supplier_idx" ON "price_lists"("supplier_id");
CREATE INDEX "price_lists_group_idx" ON "price_lists"("customer_group_id");
CREATE INDEX "price_lists_created_by_idx" ON "price_lists"("created_by_id");
CREATE INDEX "price_lists_updated_by_idx" ON "price_lists"("updated_by_id");
CREATE INDEX "price_lists_deleted_by_idx" ON "price_lists"("deleted_by_id");

CREATE TABLE "price_list_items" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "price_list_id" UUID NOT NULL REFERENCES "price_lists"("id") ON DELETE CASCADE,
  "item_id" UUID NOT NULL REFERENCES "items"("id") ON DELETE CASCADE,
  "uom_code" VARCHAR(20) NOT NULL,
  "min_qty" NUMERIC(18,3) NOT NULL DEFAULT 0,
  "rate" NUMERIC(18,6) NOT NULL,
  "discount_pct" NUMERIC(7,4) NOT NULL DEFAULT 0,
  "valid_from" DATE,
  "valid_to" DATE,
  CONSTRAINT "price_list_items_rate_chk" CHECK ("rate" >= 0),
  CONSTRAINT "price_list_items_qty_chk" CHECK ("min_qty" >= 0),
  CONSTRAINT "price_list_items_discount_chk" CHECK ("discount_pct" >= 0 AND "discount_pct" <= 100),
  CONSTRAINT "price_list_items_dates_chk" CHECK ("valid_to" IS NULL OR "valid_from" IS NULL OR "valid_to" >= "valid_from"),
  CONSTRAINT "price_list_items_uq" UNIQUE NULLS NOT DISTINCT ("price_list_id", "item_id", "uom_code", "min_qty", "valid_from")
);
CREATE INDEX "price_list_items_item_idx" ON "price_list_items"("item_id");

-- Close the loops opened by earlier tables.
ALTER TABLE "party_groups" ADD CONSTRAINT "party_groups_default_price_list_fk"
  FOREIGN KEY ("default_price_list_id") REFERENCES "price_lists"("id") ON DELETE SET NULL;
ALTER TABLE "customers" ADD CONSTRAINT "customers_price_list_fk"
  FOREIGN KEY ("price_list_id") REFERENCES "price_lists"("id") ON DELETE SET NULL;
