// Phase 22-E: imports the crawler JSON (tests/e2e/crawl.spec.ts) into page_health, and when there
// are errors notifies the Administrators once per day (type system.page_health, deduped per day).
//   node apps/api/node_modules/tsx/dist/cli.mjs tools/import-page-health.ts [result.json]
// Refuses any database other than the local dev / test / e2e ones.
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ALLOWED_DBS = new Set(['rhai_erp', 'rhai_erp_test', 'rhai_erp_e2e']);

interface Check {
  page_id: string;
  role_code: string;
  unit_combo: string;
  status: 'OK' | 'ERROR';
  error_kind: string | null;
  error_text: string | null;
  p95_ms: number | null;
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL ?? '';
  const db = url ? new URL(url).pathname.replace(/^\//, '') : '';
  if (!ALLOWED_DBS.has(db)) {
    throw new Error(`Refusing to import into database "${db || '(none)'}": only ${[...ALLOWED_DBS].join(', ')}.`);
  }
  const file = process.argv[2] ?? path.resolve(__dirname, '..', 'tests', 'e2e', '.artifacts', 'page-health.json');
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as { runId: string; checks: Check[] };

  // imported late so DATABASE_URL (and the allow-list above) is settled first
  const { prisma } = await import('../apps/api/src/core/db/prisma');
  const { notificationService } = await import('../apps/api/src/modules/notifications/service');

  let n = 0;
  for (let i = 0; i < parsed.checks.length; i += 200) {
    const part = parsed.checks.slice(i, i + 200);
    await prisma.$executeRaw`
      INSERT INTO page_health (page_id, role_code, unit_combo, run_id, status, error_kind, error_text, p95_ms)
      SELECT x.page_id, x.role_code, x.unit_combo, ${parsed.runId}::uuid, x.status, x.error_kind, x.error_text, x.p95_ms
        FROM json_to_recordset(${JSON.stringify(part)}::json) AS x(
          page_id text, role_code text, unit_combo text, status text, error_kind text, error_text text, p95_ms int)
      ON CONFLICT (page_id, role_code, unit_combo, run_id) DO UPDATE
        SET status = EXCLUDED.status, error_kind = EXCLUDED.error_kind, error_text = EXCLUDED.error_text,
            p95_ms = EXCLUDED.p95_ms, checked_at = now()`;
    n += part.length;
  }
  const errors = parsed.checks.filter((c) => c.status === 'ERROR');
  console.log(`import-page-health: ${n} checks stored for run ${parsed.runId}, ${errors.length} errors`);

  if (errors.length > 0) {
    const admins = await prisma.$queryRaw<{ id: string }[]>`
      SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id
       WHERE u.status = 'ACTIVE' AND r.level >= 95 LIMIT 200`;
    const day = new Date().toISOString().slice(0, 10);
    await prisma.$transaction(async (tx) => {
      await notificationService.notify(
        tx,
        admins.map((a) => a.id),
        {
          type: 'system.page_health',
          title: `Page health: ${errors.length} page check${errors.length === 1 ? '' : 's'} failed`,
          body: errors
            .slice(0, 3)
            .map((e) => `${e.page_id} (${e.role_code}): ${e.error_kind}`)
            .join('; '),
          link: '/m/admin-page-health',
          entityType: 'PageHealthRun',
          entityId: parsed.runId,
          dedupeKey: `page_health:${day}`,
        },
      );
    });
    console.log(`import-page-health: notified ${admins.length} administrator(s) (once per day)`);
  }
  await prisma.$disconnect();
  process.exitCode = errors.length > 0 ? 1 : 0;
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(2);
});
