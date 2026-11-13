// The global integrity checks (Phase 33) hold on the test database after all the suites have written to it,
// and the safety guard refuses a production-looking database name.
import { describe, expect, it } from 'vitest';
import { INTEGRITY_CHECKS, assertSafeTarget, runIntegrityChecks } from '../src/core/integrity/checks';
import { prisma } from './helpers';

describe('integrity checks', () => {
  it('every check runs and none fails on the test database', async () => {
    const results = await runIntegrityChecks(prisma);
    expect(results).toHaveLength(INTEGRITY_CHECKS.length);
    const failed = results.filter((r) => r.status === 'FAIL');
    expect(failed.map((f) => `${f.code}: ${JSON.stringify(f.rows.slice(0, 2))}`)).toEqual([]);
    expect(results.filter((r) => r.status === 'PASS').length).toBeGreaterThanOrEqual(5);
  });
  it('refuses a database that does not say it is staging, e2e or test', () => {
    expect(() => assertSafeTarget('postgresql://u:p@host:5432/rhai_erp_prod')).toThrow(/Refusing/);
    expect(() => assertSafeTarget('postgresql://u:p@host:5432/erp')).toThrow(/Refusing/);
    expect(() => assertSafeTarget('postgresql://u:p@host:5432/rhai_erp_staging')).not.toThrow();
    expect(() => assertSafeTarget('postgresql://u:p@host:5432/rhai_erp_e2e?schema=public')).not.toThrow();
  });
});
