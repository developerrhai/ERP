-- Phase 20-D (§4.8): Least-privilege PostgreSQL Role Split for Amazon RDS / EC2 PostgreSQL.
-- Set actual strong passwords outside git before running on production.

-- erp_owner: schema DDL & migrations only (used via MIGRATION_DATABASE_URL during deploy)
-- CREATE ROLE erp_owner WITH LOGIN PASSWORD '<redacted-set-via-env>';
-- CREATE ROLE erp_app WITH LOGIN PASSWORD '<redacted-set-via-env>';
-- CREATE ROLE erp_readonly WITH LOGIN PASSWORD '<redacted-set-via-env>';

GRANT USAGE, CREATE ON SCHEMA public TO erp_owner;
ALTER DEFAULT PRIVILEGES FOR ROLE erp_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO erp_app;
ALTER DEFAULT PRIVILEGES FOR ROLE erp_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO erp_app;
ALTER DEFAULT PRIVILEGES FOR ROLE erp_owner IN SCHEMA public
  GRANT SELECT ON TABLES TO erp_readonly;

GRANT USAGE ON SCHEMA public TO erp_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO erp_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO erp_app;

-- audit_logs is strict INSERT + SELECT only for application runtime:
REVOKE UPDATE, DELETE, TRUNCATE ON "audit_logs" FROM erp_app;
REVOKE ALL ON "_prisma_migrations" FROM erp_app;

GRANT USAGE ON SCHEMA public TO erp_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO erp_readonly;

