// Phase 36 A1: create the local database rhai_erp_ui, migrate it, and seed ONLY the first Super User
// with the project's own seed script. The password is generated now and kept only in state.json
// (git-ignored). Nothing here prints a URL or a password.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { TEST_DATABASE_URL } from '../../../apps/api/scripts/reset-test-db';

const api = path.resolve(__dirname, '../../../apps/api');
const statePath = path.join(__dirname, 'state.json');
const dbUrl = TEST_DATABASE_URL.replace(/\/rhai_erp_test(\?.*)?$/, '/rhai_erp_ui$1');
const adminUrl = TEST_DATABASE_URL.replace(/\/rhai_erp_test(\?.*)?$/, '/postgres$1');
if (!dbUrl.includes('/rhai_erp_ui')) throw new Error('could not derive the rhai_erp_ui URL');

function run(args: string[], env: Record<string, string>): void {
  const r = spawnSync(process.execPath, args, { cwd: api, env: { ...process.env, ...env }, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${args[0]} failed:\n${r.stdout.slice(-800)}\n${r.stderr.slice(-800)}`);
}

// 1. create the database if missing (never drops anything)
run(['-e', `
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient({ datasources: { db: { url: process.env.ADMIN_URL } } });
(async () => {
  const r = await p.$queryRawUnsafe("SELECT 1 FROM pg_database WHERE datname='rhai_erp_ui'");
  if (process.env.RESET_UI === '1') {
    await p.$executeRawUnsafe("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='rhai_erp_ui' AND pid <> pg_backend_pid()");
    await p.$executeRawUnsafe('DROP DATABASE IF EXISTS rhai_erp_ui');
    await p.$executeRawUnsafe('CREATE DATABASE rhai_erp_ui');
  } else if (r.length === 0) await p.$executeRawUnsafe('CREATE DATABASE rhai_erp_ui');
  await p.$disconnect();
})().catch((e) => { console.error(String(e.message).slice(0, 300)); process.exit(1); });
`], { ADMIN_URL: adminUrl });

// 2. migrate to the latest
run([path.join(api, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy'], { DATABASE_URL: dbUrl });

// 3. first Super User only (seed is idempotent; keeps an existing state.json password)
const prev = existsSync(statePath) && process.env.RESET_UI !== '1' ? (JSON.parse(readFileSync(statePath, 'utf8')) as Record<string, string>) : {};
const password = prev.ownerInitialPassword ?? `Ui!${randomBytes(9).toString('base64url')}9a`;
const loginId = prev.ownerId ?? 'owner';
run([path.join(api, 'node_modules/tsx/dist/cli.mjs'), 'prisma/seed.ts'], {
  DATABASE_URL: dbUrl,
  SUPERADMIN_LOGIN_ID: loginId,
  SUPERADMIN_EMAIL: 'owner@ui.example',
  SUPERADMIN_NAME: 'UI Owner',
  SUPERADMIN_PASSWORD: password,
});
writeFileSync(statePath, JSON.stringify({ ownerId: loginId, ownerPassword: `Own!${randomBytes(9).toString('base64url')}5b`, ownerInitialPassword: password, tempPassword: `Tmp!${randomBytes(8).toString('base64url')}7a`, userPassword: `Usr!${randomBytes(8).toString('base64url')}8a`, ...prev }, null, 2));
process.stdout.write('rhai_erp_ui ready; owner login id: ' + loginId + '\n');
