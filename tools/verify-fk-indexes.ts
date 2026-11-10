// Phase 20-D (§4.9): Verifies every foreign key constraint in public has a leading B-tree index.
import { prisma } from '../apps/api/src/core/db/prisma';

async function main() {
  const missing = await prisma.$queryRaw<{ table_name: string; conname: string }[]>`
    SELECT cl.relname AS table_name, c.conname
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
    ORDER BY 1, 2
  `;
  if (missing.length > 0) {
    console.error('Unindexed foreign keys detected:', missing);
    process.exitCode = 1;
    return;
  }
  console.log('FK index verification passed: 0 unindexed foreign keys.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

