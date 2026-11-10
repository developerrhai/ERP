// Drops and re-migrates the TEST database (rhai_erp_test). Refuses any other database so it can never wipe dev data or the old `erp` DB.
import { spawnSync } from 'node:child_process';
import path from 'node:path';

export const TEST_DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/rhai_erp_test';

export function resetTestDatabase(url: string = TEST_DATABASE_URL): void {
  if (new URL(url).pathname !== '/rhai_erp_test') {
    throw new Error(`Refusing to reset a database that is not rhai_erp_test: ${url}`);
  }
  const root = path.resolve(__dirname, '..');
  const prismaCli = path.join(root, 'node_modules', 'prisma', 'build', 'index.js');
  const postgresUrl = url.replace('/rhai_erp_test', '/postgres');

  // Terminate open connections and recreate rhai_erp_test database to avoid
  // PostgreSQL "out of shared memory: max_locks_per_transaction" error when dropping 100+ tables.
  const recreateScript = `
    const { PrismaClient } = require('@prisma/client');
    const p = new PrismaClient({ datasources: { db: { url: ${JSON.stringify(postgresUrl)} } } });
    (async () => {
      try {
        await p.$executeRawUnsafe("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'rhai_erp_test' AND pid <> pg_backend_pid()");
        await p.$executeRawUnsafe("DROP DATABASE IF EXISTS rhai_erp_test");
        await p.$executeRawUnsafe("CREATE DATABASE rhai_erp_test");
      } finally {
        await p.$disconnect();
      }
    })().catch((err) => {
      console.error(err);
      process.exit(1);
    });
  `;

  const recreateResult = spawnSync(process.execPath, ['-e', recreateScript], { cwd: root, encoding: 'utf8' });
  if (recreateResult.status !== 0) {
    throw new Error(`database drop/recreate failed:\n${recreateResult.stdout}\n${recreateResult.stderr}`);
  }

  const deployResult = spawnSync(
    process.execPath,
    [prismaCli, 'migrate', 'deploy'],
    { cwd: root, env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8' },
  );
  if (deployResult.status !== 0) {
    throw new Error(`prisma migrate deploy failed:\n${deployResult.stdout}\n${deployResult.stderr}`);
  }
}

if (require.main === module) {
  resetTestDatabase();
  process.stdout.write('rhai_erp_test reset and migrated\n');
}
