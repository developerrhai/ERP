// Pre-flight job for Phase 8: prints what must be fixed before the new inventory rules (and migration D) go live.
// Read-only. Usage:  npm run inventory:preflight        (uses DATABASE_URL; refuses the old `erp` database)
import { prisma } from '../src/core/db/prisma';
import { preflight } from '../src/modules/inventory/ops-service';
import { glCompare, integrity } from '../src/modules/inventory/reports-service';
import type { Caller } from '../src/modules/records/service';

async function main(): Promise<void> {
  const url = new URL(process.env.DATABASE_URL ?? 'postgresql://x/none');
  if (url.pathname === '/erp') throw new Error('Refusing to run against the old database `erp`.');
  const pf = await preflight();
  const integ = await integrity();
  const gl = await glCompare({ ctx: { unitId: null, allUnits: true } } as unknown as Caller);
  const mark = (c: { count: number; level: string }) =>
    c.count === 0 ? 'OK     ' : c.level === 'blocker' ? 'BLOCKER' : c.level === 'warning' ? 'WARNING' : 'INFO   ';
  process.stdout.write(`Database: ${url.pathname.slice(1)}\n\nPre-flight\n`);
  for (const c of pf.checks) {
    process.stdout.write(`  ${mark(c)} ${c.id}  ${c.name}${c.count ? `  [${c.count}] ${c.sample.join(', ')}` : ''}\n`);
  }
  process.stdout.write('\nIntegrity\n');
  for (const c of integ.checks) {
    process.stdout.write(`  ${c.ok ? 'OK     ' : 'FAIL   '} ${c.id}  ${c.name}${c.ok ? '' : `  [${c.mismatches.length}]`}\n`);
  }
  process.stdout.write(`\nStock value vs books: ${gl.inBalance ? 'in balance' : 'DIFFERENCE (run the GL cut-over per unit)'}\n`);
  for (const r of gl.rows) {
    process.stdout.write(`  ${r.unit} ${r.key}: stock ${r.stockValue} / books ${r.glBalance ?? '-'} / diff ${r.variance ?? '-'}\n`);
  }
  const ready = pf.ready && integ.ok;
  process.stdout.write(`\n${ready ? 'READY' : 'NOT READY'} for migration D\n`);
  process.exitCode = ready ? 0 : 1;
}

main()
  .catch((e: unknown) => {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = 2;
  })
  .finally(() => void prisma.$disconnect());
