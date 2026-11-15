// Read-only helper: node tsx dbq.ts "<SELECT ...>" runs one SELECT on rhai_erp_ui and prints rows (never the URL).
import { PrismaClient } from '../../../apps/api/node_modules/@prisma/client';
import { TEST_DATABASE_URL } from '../../../apps/api/scripts/reset-test-db';
const sql = process.argv[2] ?? '';
if (!/^\s*select\b/i.test(sql)) throw new Error('SELECT only');
const p = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL.replace(/\/rhai_erp_test(\?.*)?$/, '/rhai_erp_ui$1') } } });
p.$queryRawUnsafe(sql).then((r) => console.log(JSON.stringify(r, (_k, v) => (typeof v === 'bigint' ? Number(v) : v))), (e) => console.log('ERR', String(e.message).slice(0, 200))).finally(() => p.$disconnect());
