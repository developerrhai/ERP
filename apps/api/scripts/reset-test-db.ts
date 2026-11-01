// Drops and re-migrates the TEST database (rhai_erp_test) with `prisma migrate reset --force
// --skip-seed`. Refuses any other database so it can never wipe dev data or the old `erp` DB.
import { spawnSync } from 'node:child_process';
import path from 'node:path';

export const TEST_DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/rhai_erp_test';

export function resetTestDatabase(url: string = TEST_DATABASE_URL): void {
  if (new URL(url).pathname !== '/rhai_erp_test') {
    throw new Error(`Refusing to reset a database that is not rhai_erp_test: ${url}`);
  }
  const root = path.resolve(__dirname, '..');
  const prismaCli = path.join(root, 'node_modules', 'prisma', 'build', 'index.js');
  const result = spawnSync(
    process.execPath,
    [prismaCli, 'migrate', 'reset', '--force', '--skip-seed', '--skip-generate'],
    { cwd: root, env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8' },
  );
  if (result.status !== 0) {
    throw new Error(`prisma migrate reset failed:\n${result.stdout}\n${result.stderr}`);
  }
}

if (require.main === module) {
  resetTestDatabase();
  process.stdout.write('rhai_erp_test reset and migrated\n');
}
