// npm run integrity -- (uses DATABASE_URL). Prints PASS / FAIL / SKIPPED per check and exits 1 when anything fails.
import { PrismaClient } from '@prisma/client';
import { assertSafeTarget, runIntegrityChecks } from '../src/core/integrity/checks';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL ?? '';
  assertSafeTarget(url);
  const db = new PrismaClient();
  try {
    const results = await runIntegrityChecks(db);
    let failed = 0;
    for (const r of results) {
      console.log(`${r.status.padEnd(7)} ${r.code}  ${r.name}`);
      if (r.status === 'FAIL') {
        failed += 1;
        console.log(JSON.stringify(r.rows.slice(0, 5)));
      }
    }
    console.log(failed === 0 ? 'All integrity checks passed.' : `${failed} check(s) failed.`);
    process.exitCode = failed === 0 ? 0 : 1;
  } finally {
    await db.$disconnect();
  }
}

void main();
