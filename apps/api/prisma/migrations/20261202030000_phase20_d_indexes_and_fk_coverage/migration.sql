-- Phase 20-D: Hot-path list/keyset indexes, JSONB path_ops GIN indexes, trigram search indexes,
-- and full Foreign Key index coverage across public schema.
-- Note: Prisma runs migrations inside a transaction block; standalone zero-downtime CONCURRENTLY
-- commands for production hot tables are also provided in infra/db/concurrent-indexes.sql.

-- Keyset pagination composite indexes (unit, page/status, sort desc, id desc)
CREATE INDEX IF NOT EXISTS "generic_records_keyset_idx"
  ON "generic_records" ("unit_id", "page_id", "created_at" DESC, "id" DESC)
  WHERE "deleted_at" IS NULL;

CREATE INDEX IF NOT EXISTS "journals_keyset_idx"
  ON "journals" ("unit_id", "doc_date" DESC, "id" DESC)
  WHERE "deleted_at" IS NULL;

CREATE INDEX IF NOT EXISTS "stock_vouchers_keyset_idx"
  ON "stock_vouchers" ("unit_id", "posting_date" DESC, "id" DESC)
  WHERE "deleted_at" IS NULL;

CREATE INDEX IF NOT EXISTS "sales_invoices_keyset_idx"
  ON "sales_invoices" ("unit_id", "invoice_date" DESC, "id" DESC);

CREATE INDEX IF NOT EXISTS "purchase_orders_keyset_idx"
  ON "purchase_orders" ("unit_id", "po_date" DESC, "id" DESC);

CREATE INDEX IF NOT EXISTS "audit_logs_at_id_desc_idx"
  ON "audit_logs" ("at" DESC, "id" DESC);

-- jsonb_path_ops GIN indexes for fast JSONB containment queries
CREATE INDEX IF NOT EXISTS "generic_records_data_path_ops_gin"
  ON "generic_records" USING gin ("data" jsonb_path_ops);

CREATE INDEX IF NOT EXISTS "audit_logs_detail_path_ops_gin"
  ON "audit_logs" USING gin ("detail" jsonb_path_ops);

-- pg_trgm search index on search_index & audit_logs text search
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS "search_index_title_trgm_idx"
  ON "search_index" USING gin ("title" gin_trgm_ops);

-- Automatically index every FK in public that currently lacks a leading B-tree index (STANDARDS §5 & Phase 20 §4.9)
DO $$
DECLARE
  fk record;
  cols_csv text;
  idx_name text;
  table_rel text;
BEGIN
  FOR fk IN
    SELECT
      c.conrelid,
      c.conname,
      n.nspname AS schema_name,
      cl.relname AS table_name,
      c.conkey
    FROM pg_constraint c
    JOIN pg_class cl ON cl.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = cl.relnamespace
    WHERE c.contype = 'f'
      AND n.nspname = 'public'
      AND cl.relkind IN ('r', 'p')
      AND cl.relname <> 'audit_logs_pre_partition_backup'
      AND NOT EXISTS (
        SELECT 1
        FROM pg_index i
        WHERE i.indrelid = c.conrelid
          AND i.indisvalid
          AND i.indkey[0:array_length(c.conkey, 1)-1] = c.conkey
      )
  LOOP
    SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY u.ord)
    INTO cols_csv
    FROM unnest(fk.conkey) WITH ORDINALITY AS u(attnum, ord)
    JOIN pg_attribute a ON a.attrelid = fk.conrelid AND a.attnum = u.attnum;

    idx_name := left('fk_' || fk.table_name || '_' || replace(fk.conname, '_fkey', '') || '_idx', 63);
    table_rel := format('%I.%I', fk.schema_name, fk.table_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %s (%s)', idx_name, table_rel, cols_csv);
  END LOOP;
END $$;
