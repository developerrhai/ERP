// Phase 24 background workers: KPI alert checks and emailed dashboards (cron schedules live in core/jobs).
import { QUEUES, registerJobHandler } from '../../core/jobs';
import { logger } from '../../core/logger';
import { workService } from '../work/service';
import { attService } from '../attauto/service';
import { handoverService, taskService, visitorService } from '../workplace/service';
import { mailAutomation } from '../docsmail/automation';
import { spineService } from '../spine/service';
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
  registerJobHandler(QUEUES.opsDaily, async () => {
    // 18:35 UTC = 00:05 IST: recurring tasks for the day, visitors who never came, anonymise old visits
    const rec = await taskService.runRecurring();
    const ns = await visitorService.markNoShow();
    const an = await visitorService.anonymise();
    if (rec.created > 0 || ns > 0 || an.anonymised > 0) logger.info({ ...rec, noShow: ns, ...an }, 'Job ops.daily finished');
  });
  registerJobHandler(QUEUES.opsWatch, async () => {
    const a = await visitorService.alertOverstay();
    const b = await handoverService.alertLate();
    const c = await taskService.notifyOverdue();
    if (a.alerted > 0 || b.alerted > 0 || c.notified > 0) logger.info({ overstay: a.alerted, handover: b.alerted, overdue: c.notified }, 'Job ops.watch finished');
  });
  registerJobHandler(QUEUES.attDaily, async () => {
    const now = new Date();
    // from 10:00 IST: policies on the last days, missed-punch reminders; from 10:30: the daily department reports
    if (new Date(now.getTime() + 330 * 60_000).getUTCHours() >= 10) {
      await attService.runDaily(now);
      const reminders = await attService.remindMissedPunches(now);
      const reports = await attService.sendDailyReports(now);
      if (reminders > 0 || reports > 0) logger.info({ reminders, reports }, 'Job att.daily finished');
    }
  });
  registerJobHandler(QUEUES.attHealth, async () => {
    const res = await attService.deviceHealthCheck();
    if (res.stale > 0 || res.offline > 0) logger.info(res, 'Job att.health finished');
  });
  registerJobHandler(QUEUES.attLock, async () => {
    const res = await attService.autoLock();
    if (res.locked > 0) logger.info(res, 'Job att.lock finished');
  });
  registerJobHandler(QUEUES.mailAutomation, async () => {
    const res = await mailAutomation.runDue();
    if (res.sent > 0) logger.info(res, 'Job mail.automation finished');
  });
  registerJobHandler(QUEUES.processExceptions, async () => {
    const res = await spineService.runExceptionChecks();
    if (res.raised > 0 || res.resolved > 0) logger.info(res, 'Job process.exceptions finished');
  });
  registerJobHandler(QUEUES.dashboardEmails, async () => {
    const res = await dashboardsService.runDueSchedules();
    if (res.due > 0) logger.info(res, 'Job dashboard.emails finished');
  });
}
