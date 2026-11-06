-- Migration A: Add 'UNIT' to DataScope enum before 'ALL'
-- Must be on its own because PostgreSQL cannot use a new enum value in the same transaction as ALTER TYPE.
ALTER TYPE "DataScope" ADD VALUE IF NOT EXISTS 'UNIT' BEFORE 'ALL';
