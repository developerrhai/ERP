// Phase 20 §4.4: PostgreSQL advisory lock (`erp:boot-seed`) so two processes booting together
// never race during idempotent seed/defaults top-ups or CLI seed runs.
import { Client } from 'pg';

export const BOOT_SEED_LOCK_KEY = 'erp:boot-seed';

export async function withBootAdvisoryLock<T>(
  connectionString: string,
  work: () => Promise<T>,
  lockKey: string = BOOT_SEED_LOCK_KEY,
): Promise<T> {
  const client = new Client({ connectionString });
  await client.connect();
  let acquired = false;
  try {
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [lockKey]);
    acquired = true;
    return await work();
  } finally {
    if (acquired) {
      try {
        await client.query('SELECT pg_advisory_unlock(hashtext($1))', [lockKey]);
      } catch {
        // Session termination also releases session-level advisory locks.
      }
    }
    try {
      await client.end();
    } catch {
      // ignore
    }
  }
}

