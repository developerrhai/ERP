// Phase 20-E (§5(a)): Performance data generator for k6 benchmarks.
// SAFETY GUARD: Strictly refuses NODE_ENV=production AND any DATABASE_URL not ending in `_perf`.
import { PrismaClient } from '@prisma/client';

export function assertPerfDatabaseSafe(nodeEnv: string | undefined, dbUrl: string | undefined): void {
  if (nodeEnv === 'production') {
    throw new Error('REFUSING: perf-seed cannot run when NODE_ENV=production.');
  }
  if (!dbUrl) {
    throw new Error('REFUSING: DATABASE_URL is required.');
  }
  const dbName = new URL(dbUrl).pathname.replace(/^\//, '');
  if (!dbName.endsWith('_perf')) {
    throw new Error(`REFUSING: perf-seed requires a database ending in '_perf' (got '${dbName}').`);
  }
}

async function main() {
  assertPerfDatabaseSafe(process.env.NODE_ENV, process.env.DATABASE_URL);
  const targetRows = Number(process.env.PERF_ROW_COUNT ?? '100000');
  const prisma = new PrismaClient();
  try {
    const unit = await prisma.unit.findFirst({ where: { status: 'ACTIVE' } });
    const fy = await prisma.financialYear.findFirst({ where: { status: 'OPEN' } });
    const user = await prisma.user.findFirst({ where: { status: 'ACTIVE' } });
    if (!unit || !fy || !user) {
      throw new Error('Run base seed first on *_perf DB so unit, fy, and owner user exist.');
    }

    const batchSize = 1000;
    console.log(`Seeding ${targetRows} generic_records into _perf DB in batches of ${batchSize}...`);
    for (let offset = 0; offset < targetRows; offset += batchSize) {
      const n = Math.min(batchSize, targetRows - offset);
      await prisma.$executeRaw`
        INSERT INTO generic_records (page_id, code, title, status, unit_id, fy_id, department, data, created_by_id)
        SELECT 'crm-leads',
               'PERF-LD-' || ($1::int + g),
               'Perf Lead ' || ($1::int + g),
               'DRAFT',
               ${unit.id}::uuid,
               ${fy.id}::uuid,
               'Sales',
               jsonb_build_object('source', 'k6-perf', 'seq', ($1::int + g)),
               ${user.id}::uuid
        FROM generate_series(1, ${n}) AS g
        ON CONFLICT DO NOTHING
      `;
    }
    await prisma.$executeRawUnsafe('ANALYZE;');
    console.log('Perf seeding & ANALYZE complete.');
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

