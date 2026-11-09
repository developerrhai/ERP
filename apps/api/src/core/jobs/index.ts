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
  const instance = new PgBoss({ connectionString, max: 4 });
  instance.on('error', (err: Error) => logger.error({ err }, 'pg-boss error'));
  await instance.start();
  for (const queue of Object.values(QUEUES)) {
    await instance.createQueue(queue);
    const handler = handlers.get(queue);
    if (!handler) continue;
    await instance.work<DataJobPayload | Record<string, never>>(
      queue,
      { pollingIntervalSeconds: 2 },
      async (jobs) => {
        for (const job of jobs) await handler(job.data);
      },
    );
  }
  // Daily housekeeping at 02:30 server time (expired sessions / keys / job outputs).
  await instance.schedule(QUEUES.maintenance, '30 2 * * *', {});
  for (const [queue, cron] of Object.entries(PHASE5_SCHEDULES)) {
    await instance.schedule(queue, cron, {}, { tz: 'Asia/Kolkata' });
  }
  boss = instance;
  logger.info('Background jobs started (pg-boss)');
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
