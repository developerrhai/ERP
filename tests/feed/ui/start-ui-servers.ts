// Starts the API (4100) and the web dev server (5180) against the LOCAL rhai_erp_ui database.
// Stop with Ctrl+C. Never prints the database URL.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { TEST_DATABASE_URL } from '../../../apps/api/scripts/reset-test-db';

const root = path.resolve(__dirname, '../../..');
const dbUrl = TEST_DATABASE_URL.replace(/\/rhai_erp_test(\?.*)?$/, '/rhai_erp_ui$1');
if (!dbUrl.includes('/rhai_erp_ui')) throw new Error('bad db url');
const api = spawn(process.execPath, [path.join(root, 'apps/api/node_modules/tsx/dist/cli.mjs'), 'src/server.ts'], {
  cwd: path.join(root, 'apps/api'),
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: dbUrl, NODE_ENV: 'test', PORT: '4100', WEB_ORIGIN: 'http://localhost:5180', RATE_LIMIT_DISABLED: 'true', LOG_LEVEL: 'warn' },
});
const web = spawn(process.execPath, [path.join(root, 'apps/web/node_modules/vite/bin/vite.js')], {
  cwd: path.join(root, 'apps/web'),
  stdio: 'inherit',
  env: { ...process.env, VITE_PORT: '5180', VITE_API_TARGET: 'http://localhost:4100' },
});
const stop = () => { api.kill(); web.kill(); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
api.on('exit', () => web.kill());
