// Phase 20-D: Audit partition maintenance helper & verification queries.
import { prisma } from '../../core/db/prisma';
import { logger } from '../../core/logger';
import { norm, query, type Row } from '../procurement/core';

export const auditPartitionService = {
  async status(): Promise<{ partitions: Row[]; defaultRows: number }> {
    const [partitions, defCount] = await Promise.all([
      query(
        prisma,
        `SELECT c.relname AS partition_name,
                pg_get_expr(c.relpartbound, c.oid) AS range_bound
         FROM pg_inherits i
         JOIN pg_class parent ON parent.oid = i.inhparent
         JOIN pg_class c ON c.oid = i.inhrelid
         WHERE parent.relname = 'audit_logs'
         ORDER BY c.relname`,
      ),
      query(prisma, `SELECT count(*)::int AS cnt FROM audit_logs_default`),
    ]);
    return {
      partitions: partitions.map((p) => norm(p)),
      defaultRows: Number(defCount[0]?.cnt ?? 0),
    };
  },

  async maintain(monthsAhead = 3): Promise<{ created: string[]; defaultRows: number }> {
    const rows = await query(prisma, `SELECT * FROM ensure_audit_partitions($1::int)`, monthsAhead);
    const created = rows.filter((r) => Boolean(r.created)).map((r) => String(r.partition_name));
    const defaultRows = Number(rows[0]?.default_rows ?? 0);
    if (defaultRows > 0) {
      logger.warn({ defaultRows }, 'ALERT: audit_logs_default partition is not empty!');
    }
    return { created, defaultRows };
  },
};
