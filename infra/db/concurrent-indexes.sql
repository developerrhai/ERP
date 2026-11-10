-- Phase 20-D (§4.9): Zero-downtime CONCURRENTLY index script for live production tables.
-- Run via psql with autocommit enabled (cannot run inside a transaction block).

CREATE INDEX CONCURRENTLY IF NOT EXISTS "generic_records_keyset_idx"
  ON "generic_records" ("unit_id", "page_id", "created_at" DESC, "id" DESC)
  WHERE "deleted_at" IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "journals_keyset_idx"
  ON "journals" ("unit_id", "doc_date" DESC, "id" DESC)
  WHERE "deleted_at" IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "stock_vouchers_keyset_idx"
  ON "stock_vouchers" ("unit_id", "posting_date" DESC, "id" DESC)
  WHERE "deleted_at" IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "sales_invoices_keyset_idx"
  ON "sales_invoices" ("unit_id", "invoice_date" DESC, "id" DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "purchase_orders_keyset_idx"
  ON "purchase_orders" ("unit_id", "po_date" DESC, "id" DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "audit_logs_at_id_desc_idx"
  ON "audit_logs" ("at" DESC, "id" DESC);

-- Enable pg_stat_statements + auto_explain for post-k6 plan checks (Phase 20 §5(a)):
-- shared_preload_libraries = 'pg_stat_statements,auto_explain'
-- auto_explain.log_min_duration = '300ms'

