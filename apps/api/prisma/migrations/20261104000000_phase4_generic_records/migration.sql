-- Phase 4 (docs/phase3-4/CONTRACT.md Stage B): generic_records, number_series, idempotency_keys.
-- The generated tsvector column + GIN index and the CHECKs are raw SQL (Prisma cannot express them).

-- CreateTable
CREATE TABLE "generic_records" (
    "id" UUID NOT NULL,
    "page_id" VARCHAR(80) NOT NULL,
    "unit_id" UUID NOT NULL,
    "fy_id" UUID NOT NULL,
    "department" VARCHAR(60) NOT NULL,
    "code" VARCHAR(60) NOT NULL,
    "status" VARCHAR(30) NOT NULL,
    "amount" DECIMAL(18,2),
    "doc_date" DATE,
    "data" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "generic_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "number_series" (
    "page_id" VARCHAR(80) NOT NULL,
    "unit_id" UUID NOT NULL,
    "fy_id" UUID NOT NULL,
    "next_value" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "number_series_pkey" PRIMARY KEY ("page_id","unit_id","fy_id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "user_id" UUID NOT NULL,
    "key" VARCHAR(128) NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "record_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("user_id","key")
);

-- CreateIndex
CREATE INDEX "generic_records_page_id_unit_id_deleted_at_idx" ON "generic_records"("page_id", "unit_id", "deleted_at");

-- CreateIndex
CREATE INDEX "generic_records_page_id_fy_id_idx" ON "generic_records"("page_id", "fy_id");

-- CreateIndex
CREATE UNIQUE INDEX "generic_records_page_id_code_key" ON "generic_records"("page_id", "code");

-- AddForeignKey
ALTER TABLE "generic_records" ADD CONSTRAINT "generic_records_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generic_records" ADD CONSTRAINT "generic_records_fy_id_fkey" FOREIGN KEY ("fy_id") REFERENCES "financial_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generic_records" ADD CONSTRAINT "generic_records_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generic_records" ADD CONSTRAINT "generic_records_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generic_records" ADD CONSTRAINT "generic_records_deleted_by_id_fkey" FOREIGN KEY ("deleted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "number_series" ADD CONSTRAINT "number_series_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "number_series" ADD CONSTRAINT "number_series_fy_id_fkey" FOREIGN KEY ("fy_id") REFERENCES "financial_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Rules Prisma cannot express
-- ---------------------------------------------------------------------------

-- Full-text search over the code and every string value in `data` (kept in step by PostgreSQL).
ALTER TABLE "generic_records" ADD COLUMN "search" tsvector
  GENERATED ALWAYS AS (
    to_tsvector('simple', coalesce("code", '')) || jsonb_to_tsvector('simple', "data", '["string"]')
  ) STORED;
CREATE INDEX "generic_records_search_idx" ON "generic_records" USING GIN ("search");

ALTER TABLE "generic_records" ADD CONSTRAINT "generic_records_code_length" CHECK (char_length("code") BETWEEN 3 AND 60);
ALTER TABLE "generic_records" ADD CONSTRAINT "generic_records_status_not_blank" CHECK (char_length(btrim("status")) > 0);
ALTER TABLE "generic_records" ADD CONSTRAINT "generic_records_data_is_object" CHECK (jsonb_typeof("data") = 'object');
ALTER TABLE "number_series" ADD CONSTRAINT "number_series_next_value_positive" CHECK ("next_value" >= 1);
