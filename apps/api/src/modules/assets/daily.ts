// Phase 14 daily job (Asia/Kolkata, 02:45): for every unit, raise the PM schedules and work orders that are due, then the alerts
// (due and overdue PMs with escalation, unacknowledged breakdowns, warranty ends, loans due back). Safe to run twice.
import { prisma } from '../../core/db/prisma';
import { logger } from '../../core/logger';
import { query, todayIst } from '../procurement/core';
import { generatePmSchedules, maintService } from './maint-service';

export async function runAssetsDaily(): Promise<{
  units: number;
  schedules: number;
  alerts: number;
}> {
  const units = await query(prisma, `SELECT id::text FROM units WHERE status='ACTIVE'`);
  let schedules = 0;
  let alerts = 0;
  for (const u of units) {
    const unitId = String(u.id);
    try {
      const fy = (
        await query(
          prisma,
          `SELECT id::text FROM financial_years WHERE status='OPEN' AND $1::date BETWEEN start_date AND end_date ORDER BY start_date DESC LIMIT 1`,
          todayIst(),
        )
      )[0];
      if (fy)
        schedules += await prisma.$transaction(
          (tx) => generatePmSchedules(tx, unitId, String(fy.id), null, todayIst()),
          {
            timeout: 60000,
          },
        );
      alerts += await maintService.runAlerts(unitId);
    } catch (err) {
      logger.error({ err, unitId }, 'Assets daily job failed for a unit');
    }
  }
  return { units: units.length, schedules, alerts };
}
