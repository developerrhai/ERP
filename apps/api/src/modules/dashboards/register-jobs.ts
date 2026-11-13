// Phase 24 background workers: KPI alert checks and emailed dashboards (cron schedules live in core/jobs).
import { QUEUES, registerJobHandler } from '../../core/jobs';
import { logger } from '../../core/logger';
import { workService } from '../work/service';
import { dashboardsService } from './service';

export function registerDashboardJobHandlers(): void {
  registerJobHandler(QUEUES.kpiAlerts, async () => {
    const res = await dashboardsService.evaluateAlerts();
    if (res.raised > 0) logger.info(res, 'Job kpi.alerts finished');
  });
  registerJobHandler(QUEUES.workLate, async () => {
    const res = await workService.markLate();
    if (res.marked > 0 || res.escalated > 0) logger.info(res, 'Job work.late finished');
  });
  registerJobHandler(QUEUES.dashboardEmails, async () => {
    const res = await dashboardsService.runDueSchedules();
    if (res.due > 0) logger.info(res, 'Job dashboard.emails finished');
  });
}
