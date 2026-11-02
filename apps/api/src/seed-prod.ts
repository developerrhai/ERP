import { PrismaClient } from '@prisma/client';
import { runSeed } from './core/seed/run-seed';

async function main() {
  const db = new PrismaClient();
  try {
    const report = await runSeed(db, process.env);
    console.log('Seed completed successfully:', JSON.stringify(report, null, 2));
  } catch (err) {
    console.error('Seed failed:', err);
    process.exit(1);
  } finally {
    await db.$disconnect();
  }
}

void main();
