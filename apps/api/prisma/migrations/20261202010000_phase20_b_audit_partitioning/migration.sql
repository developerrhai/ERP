-- Phase 20-D: Audit log declarative monthly range partitioning, retention helpers, and DB role split.

-- 1. Provision logical roles (cluster-wide; guarded for managed/non-superuser environments).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'erp_owner') THEN
    CREATE ROLE erp_owner NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'erp_app') THEN
    CREATE ROLE erp_app NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'erp_readonly') THEN
    CREATE ROLE erp_readonly NOLOGIN;
  END IF;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'Skipping role creation due to insufficient privileges; ensure erp_owner/erp_app/erp_readonly exist via infra/db/roles.sql';
END $$;

-- 2. Convert existing audit_logs table into monthly range-partitioned audit_logs.
DO $$
DECLARE
  relkind_val char;
  m_start date;
  m_end date;
  part_name text;
BEGIN
  SELECT c.relkind INTO relkind_val
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'audit_logs';

  IF relkind_val = 'r' THEN
    -- Create partitioned table matching audit_logs columns (PK includes partition key 'at').
    CREATE TABLE "audit_logs_part" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "at" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "actor_id" uuid,
      "action" varchar(64) NOT NULL,
      "target_type" varchar(40),
      "target_id" varchar(64),
      "ip" varchar(64),
      "user_agent" varchar(512),
      "detail" jsonb NOT NULL DEFAULT '{}'::jsonb,
      CONSTRAINT "audit_logs_part_pkey" PRIMARY KEY ("id", "at")
    ) PARTITION BY RANGE ("at");

    -- Pre-create partitions from 2026-09 through 6 months past current month + DEFAULT partition.
    CREATE TABLE "audit_logs_default" PARTITION OF "audit_logs_part" DEFAULT;

    m_start := LEAST(date '2026-09-01', date_trunc('month', CURRENT_DATE)::date);
    WHILE m_start <= (date_trunc('month', CURRENT_DATE)::date + interval '6 months')::date LOOP
      m_end := (m_start + interval '1 month')::date;
      part_name := format('audit_logs_y%sm%s', to_char(m_start, 'YYYY'), to_char(m_start, 'MM'));
      EXECUTE format(
        'CREATE TABLE IF NOT EXISTS %I PARTITION OF audit_logs_part FOR VALUES FROM (%L) TO (%L)',
        part_name,
        m_start::timestamptz,
        m_end::timestamptz
      );
      m_start := m_end;
    END LOOP;

    -- Preserve existing audit rows in the partitioned structure.
    INSERT INTO "audit_logs_part" ("id", "at", "actor_id", "action", "target_type", "target_id", "ip", "user_agent", "detail")
    SELECT "id", "at", "actor_id", "action", "target_type", "target_id", "ip", "user_agent", "detail"
    FROM "audit_logs";

    -- Keep legacy unpartitioned table for 7-day verification window before manual retirement.
    DROP TRIGGER IF EXISTS "audit_logs_no_update_delete" ON "audit_logs";
    DROP TRIGGER IF EXISTS "audit_logs_no_truncate" ON "audit_logs";
    ALTER TABLE "audit_logs" DROP CONSTRAINT IF EXISTS "audit_logs_actor_id_fkey";
    ALTER TABLE "audit_logs" RENAME TO "audit_logs_pre_partition_backup";
    ALTER TABLE "audit_logs_pre_partition_backup" RENAME CONSTRAINT "audit_logs_pkey" TO "audit_logs_pre_partition_backup_pkey";
    ALTER TABLE "audit_logs_part" RENAME TO "audit_logs";
    ALTER TABLE "audit_logs" RENAME CONSTRAINT "audit_logs_part_pkey" TO "audit_logs_pkey";

    ALTER TABLE "audit_logs"
      ADD CONSTRAINT "audit_logs_actor_id_fkey"
      FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

    CREATE INDEX IF NOT EXISTS "audit_logs_action_at_idx" ON "audit_logs" ("action", "at");
    CREATE INDEX IF NOT EXISTS "audit_logs_actor_id_idx" ON "audit_logs" ("actor_id");
    CREATE INDEX IF NOT EXISTS "audit_logs_target_id_idx" ON "audit_logs" ("target_id");

    -- Enforce append-only on partitioned audit_logs and on retained backup.
    CREATE TRIGGER "audit_logs_no_update_delete"
      BEFORE UPDATE OR DELETE ON "audit_logs"
      FOR EACH ROW EXECUTE FUNCTION "audit_logs_block_mutation"();
    CREATE TRIGGER "audit_logs_no_truncate"
      BEFORE TRUNCATE ON "audit_logs"
      FOR EACH STATEMENT EXECUTE FUNCTION "audit_logs_block_mutation"();

    CREATE TRIGGER "audit_logs_backup_no_update_delete"
      BEFORE UPDATE OR DELETE ON "audit_logs_pre_partition_backup"
      FOR EACH ROW EXECUTE FUNCTION "audit_logs_block_mutation"();
  END IF;
END $$;

-- 3. Monthly partition maintenance helper (pre-creates months_ahead + reports default partition overflow count).
CREATE OR REPLACE FUNCTION "ensure_audit_partitions"(months_ahead int DEFAULT 3)
RETURNS TABLE(partition_name text, range_start date, range_end date, created boolean, default_rows bigint)
LANGUAGE plpgsql AS $$
DECLARE
  cur_month date := date_trunc('month', CURRENT_DATE)::date;
  target_end date := (date_trunc('month', CURRENT_DATE)::date + (months_ahead || ' months')::interval)::date;
  m_start date;
  m_end date;
  p_name text;
  existed boolean;
  def_cnt bigint;
BEGIN
  SELECT count(*) INTO def_cnt FROM "audit_logs_default";
  m_start := cur_month;
  WHILE m_start <= target_end LOOP
    m_end := (m_start + interval '1 month')::date;
    p_name := format('audit_logs_y%sm%s', to_char(m_start, 'YYYY'), to_char(m_start, 'MM'));
    existed := to_regclass(format('public.%I', p_name)) IS NOT NULL;
    IF NOT existed THEN
      EXECUTE format(
        'CREATE TABLE IF NOT EXISTS %I PARTITION OF audit_logs FOR VALUES FROM (%L) TO (%L)',
        p_name,
        m_start::timestamptz,
        m_end::timestamptz
      );
    END IF;
    partition_name := p_name;
    range_start := m_start;
    range_end := m_end;
    created := NOT existed;
    default_rows := def_cnt;
    RETURN NEXT;
    m_start := m_end;
  END LOOP;
END $$;

-- 4. Apply least-privilege grants (erp_app: SELECT+INSERT only on audit_logs, no access on _prisma_migrations).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'erp_app') THEN
    GRANT USAGE ON SCHEMA public TO erp_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO erp_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO erp_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON "audit_logs" FROM erp_app;
    IF to_regclass('public.audit_logs_pre_partition_backup') IS NOT NULL THEN
      REVOKE ALL ON "audit_logs_pre_partition_backup" FROM erp_app;
    END IF;
    IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
      REVOKE ALL ON "_prisma_migrations" FROM erp_app;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'erp_readonly') THEN
    GRANT USAGE ON SCHEMA public TO erp_readonly;
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO erp_readonly;
  END IF;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'Skipping role grants due to insufficient privileges';
END $$;

