// Background jobs on pg-boss (Postgres only, ROADMAP R-10): one process, no Redis. The queue state
// lives in the `pgboss` schema, our own job rows (progress, files, errors) in `data_jobs`, so a
// restart loses nothing: pg-boss redelivers unfinished work and handlers are idempotent.
import PgBoss from 'pg-boss';
import { env } from '../../config/env';
import { logger } from '../logger';

export const QUEUES = {
  exportRecords: 'export-records',
  importValidate: 'import-validate',
  importCommit: 'import-commit',
  maintenance: 'maintenance',
  // Phase 5 (docs/phases/PHASE-05.md §5 Jobs); all run in Asia/Kolkata.
  approvalsSlaScan: 'approvals.sla-scan',
  approvalsReminder: 'approvals.reminder',
  notificationsDigest: 'notifications.digest',
  emailSend: 'email.send',
  notificationsPurge: 'notifications.purge',
  // Phase 8: reservations that ran out, reorder suggestions, expiry / reorder alerts.
  inventoryDaily: 'inventory.daily',
  // Phase 9: ITC-180 reversal + alerts, MSME / contract / delay alerts, monthly supplier evaluation.
  scmDaily: 'scm.daily',
  // Phase 12: calibration due / expired reminders.
  qmsDaily: 'qms.daily',
  // Phase 13: one MRP run (payload jobId = the run id), one at a time per unit.
  mfgMrp: 'mfg.mrp.run',
  // Phase 14: PM schedules and work orders that fall due, alerts and escalations.
  assetsDaily: 'assets.daily',
  // Phase 15: HRMS jobs
  hrAttendanceSync: 'hr.attendance.sync',
  hrAttendanceCompute: 'hr.attendance.compute',
  hrAttendanceSummarise: 'hr.attendance.summarise',
  hrLeaveAccrue: 'hr.leave.accrue',
  hrLeaveYearend: 'hr.leave.yearend',
  hrCompoffExpire: 'hr.compoff.expire',
  hrExitFinalise: 'hr.exit.finalise',
  hrCandidatesPurge: 'hr.candidates.purge',
  // Phase 16: Payroll jobs
  payrollCalculate: 'payroll.calculate',
  payrollPayslipEmail: 'payroll.payslip.email',
  payrollStatutoryReminder: 'payroll.statutory.reminder',
  // Phase 18: Logistics, Fleet, Gate & DMS jobs
  gateReturnableOverdue: 'gate.returnable.overdue',
  fleetDocsExpiry: 'fleet.docs.expiry',
  dmsExtract: 'dms.extract',
  dmsRetention: 'dms.retention',
  // Phase 19: BI, Search, AI, Automation & Webhooks jobs
  biKpiRefresh: 'bi.kpi.refresh',
  biScheduleRun: 'bi.schedule.run',
  searchUpsert: 'search.upsert',
  aiInsightsScan: 'ai.insights.scan',
  webhooksRetry: 'webhooks.retry',
  // Phase 20: Multi-process cleanup, audit partitioning, DPDP retention
  rateLimitCleanup: 'rate-limit.cleanup',
  auditPartitionMaintain: 'audit.partition-maintain',
  dpdpRetentionRun: 'dpdp.retention.run',
  // Phase 21: Real-time push, automated document emails, broadcasts & cleanup
  notifyPush: 'notify.push',
  notifyEmail: 'notify.email',
  notifySms: 'notify.sms',
  pushCleanup: 'push.cleanup',
  broadcastSend: 'broadcast.send',
  emailStatements: 'email.statements',
  emailDunning: 'email.dunning',
} as const;

/** Cron schedules (Asia/Kolkata) of the Phase 5 queues. */
export const PHASE5_SCHEDULES: Readonly<Record<string, string>> = {
  [QUEUES.approvalsSlaScan]: '*/15 * * * *',
  [QUEUES.approvalsReminder]: '30 9 * * *',
  [QUEUES.notificationsDigest]: '30 8 * * *',
  [QUEUES.emailSend]: '* * * * *',
  [QUEUES.notificationsPurge]: '0 3 * * 0',
  [QUEUES.inventoryDaily]: '0 2 * * *',
  [QUEUES.scmDaily]: '30 1 * * *',
  [QUEUES.qmsDaily]: '15 2 * * *',
  [QUEUES.assetsDaily]: '45 2 * * *',
  [QUEUES.hrAttendanceSync]: '*/1 * * * *',
  [QUEUES.hrLeaveAccrue]: '0 1 1 * *',
  [QUEUES.hrLeaveYearend]: '0 2 1 1 *',
  [QUEUES.hrCompoffExpire]: '0 3 * * *',
  [QUEUES.hrCandidatesPurge]: '0 4 * * 0',
  [QUEUES.payrollStatutoryReminder]: '0 9 10 * *',
  [QUEUES.gateReturnableOverdue]: '0 7 * * *',
  [QUEUES.fleetDocsExpiry]: '15 7 * * *',
  [QUEUES.dmsRetention]: '0 1 1 * *',
  [QUEUES.biKpiRefresh]: '*/15 * * * *',
  [QUEUES.biScheduleRun]: '*/5 * * * *',
  [QUEUES.aiInsightsScan]: '0 6 * * *',
  [QUEUES.webhooksRetry]: '* * * * *',
  [QUEUES.rateLimitCleanup]: '*/5 * * * *',
  [QUEUES.auditPartitionMaintain]: '0 0 1 * *',
  [QUEUES.dpdpRetentionRun]: '30 3 * * 0',
  [QUEUES.notifyPush]: '* * * * *',
  [QUEUES.notifyEmail]: '* * * * *',
  [QUEUES.notifySms]: '* * * * *',
  [QUEUES.pushCleanup]: '0 4 * * *',
  [QUEUES.emailStatements]: '0 9 1 * *',
  [QUEUES.emailDunning]: '30 9 * * 1-6',
};
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export interface DataJobPayload {
  jobId: string;
}

export type JobHandler = (payload: DataJobPayload | Record<string, never>) => Promise<void>;

const handlers = new Map<QueueName, JobHandler>();

/** Modules register what runs for a queue; core/jobs never imports a module. */
export function registerJobHandler(queue: QueueName, handler: JobHandler): void {
  handlers.set(queue, handler);
}

let boss: PgBoss | null = null;

export function jobsRunning(): boolean {
  return boss !== null;
}

export async function startJobs(connectionString: string = env.DATABASE_URL): Promise<void> {
  if (boss) return;
  const instance = new PgBoss({ connectionString, max: env.PGBOSS_MAX_POOL });
  instance.on('error', (err: Error) => logger.error({ err }, 'pg-boss error'));
  await instance.start();
  for (const queue of Object.values(QUEUES)) {
    await instance.createQueue(queue);
    const handler = handlers.get(queue);
    if (!handler) continue;
    await instance.work<DataJobPayload | Record<string, never>>(
      queue,
      { pollingIntervalSeconds: 2, batchSize: env.PGBOSS_TEAM_SIZE },
      async (jobs) => {
        for (const job of jobs) await handler(job.data);
      },
    );
  }
  // Idempotent cron schedules across concurrent worker startups (Phase 20 §4.4).
  const safeSchedule = async (q: string, cron: string, opts?: { tz?: string }) => {
    try {
      await instance.schedule(q, cron, {}, opts);
    } catch (err) {
      logger.warn({ err, queue: q }, 'Schedule registration raced or already present');
    }
  };
  await safeSchedule(QUEUES.maintenance, '30 2 * * *');
  for (const [queue, cron] of Object.entries(PHASE5_SCHEDULES)) {
    await safeSchedule(queue, cron, { tz: 'Asia/Kolkata' });
  }
  boss = instance;
  logger.info({ maxPool: env.PGBOSS_MAX_POOL, batchSize: env.PGBOSS_TEAM_SIZE }, 'Background jobs started (pg-boss)');
}

/** Graceful: lets running handlers finish, then closes the pool. */
export async function stopJobs(): Promise<void> {
  if (!boss) return;
  const instance = boss;
  boss = null;
  await instance.stop({ graceful: true, timeout: 8000 });
}

/** Best effort "run the email drain now" (the per-minute schedule is the safety net). */
export async function kickEmailSend(): Promise<void> {
  if (!boss) return;
  await boss.send(QUEUES.emailSend, {}, { singletonSeconds: 5 });
}

export async function enqueue(
  queue: QueueName,
  payload: DataJobPayload | Record<string, never>,
): Promise<void> {
  if (!boss) throw new Error('Background jobs are not running.');
  await boss.send(queue, payload, { retryLimit: 2, retryDelay: 10, expireInSeconds: 30 * 60 });
}
