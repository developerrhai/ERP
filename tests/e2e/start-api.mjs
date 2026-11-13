// Why: Playwright's webServer starts the API for end-to-end tests. Before the server starts, this script
// wipes and re-migrates the dedicated e2e database (rhai_erp_e2e) and seeds a known Super Admin, so every
// e2e run begins from a clean, reproducible state (PLAN §11.8 three-run rule).
import { spawnSync, spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { E2E } from './e2e-env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const apiDir = path.join(root, 'apps', 'api');
const env = { ...process.env, ...E2E.apiEnv };

if (!E2E.apiEnv.DATABASE_URL.endsWith('/rhai_erp_e2e')) throw new Error('Refusing: e2e must use rhai_erp_e2e');

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: apiDir, env, stdio: 'inherit', shell: true });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed with ${r.status}`);
}

// "prisma migrate reset" drops table by table and now runs out of shared memory (max_locks_per_transaction)
// with 100+ tables. Drop and re-create the whole e2e database instead (same approach as db:reset:test).
const recreate = `
  const { PrismaClient } = require('@prisma/client');
  const url = ${JSON.stringify(E2E.apiEnv.DATABASE_URL.replace('/rhai_erp_e2e', '/postgres'))};
  const p = new PrismaClient({ datasources: { db: { url } } });
  (async () => {
    try {
      await p.$executeRawUnsafe("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'rhai_erp_e2e' AND pid <> pg_backend_pid()");
      await p.$executeRawUnsafe('DROP DATABASE IF EXISTS rhai_erp_e2e');
      await p.$executeRawUnsafe('CREATE DATABASE rhai_erp_e2e');
    } finally { await p.$disconnect(); }
  })().catch((e) => { console.error(e); process.exit(1); });
`;
{
  const r = spawnSync(process.execPath, ['-e', recreate], { cwd: apiDir, env, stdio: 'inherit' });
  if (r.status !== 0) throw new Error('could not re-create rhai_erp_e2e');
}
run('npx', ['prisma', 'migrate', 'deploy']);
run('npx', ['tsx', 'prisma/seed.ts']);

const server = spawn('npx', ['tsx', 'src/server.ts'], { cwd: apiDir, env, stdio: 'inherit', shell: true });
const stop = () => server.kill();
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
server.on('exit', (code) => process.exit(code ?? 0));
