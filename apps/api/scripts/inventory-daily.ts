// Runs the Phase 8 daily inventory job once, by hand: reservations that ran out, reorder suggestions, expiry and
// reorder alerts. The same function runs from pg-boss at 02:00 IST (queue inventory.daily).
import { prisma } from '../src/core/db/prisma';
import { runInventoryDaily } from '../src/modules/inventory/ops-service';

runInventoryDaily()
  .then((r) => process.stdout.write(`${JSON.stringify(r)}\n`))
  .catch((e: unknown) => {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
