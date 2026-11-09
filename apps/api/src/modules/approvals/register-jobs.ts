// Registers the Phase 5 pg-boss handlers (docs/phases/PHASE-05.md §5 Jobs). A failing job tells the
// Administrators (SYSTEM_JOB_FAILED) once a day per job, then rethrows so pg-boss records the failure.
import { prisma } from '../../core/db/prisma';
import { QUEUES, registerJobHandler } from '../../core/jobs';
import type { QueueName } from '../../core/jobs';
import { logger } from '../../core/logger';
import { drainOutbox } from '../notifications/email';
import { notificationService } from '../notifications/service';
import { istDate } from './errors';
import { runInventoryDaily } from '../inventory/ops-service';
import { runScmDaily } from '../procurement/jobs';
import { runQmsDaily } from '../qms/instruments-service';
import { escalateOverdue, sendApprovalReminders } from './jobs';

async function alertAdministrators(job: string, err: unknown): Promise<void> {
  try {
    await prisma.$transaction(async (tx) => {
      const admins = await notificationService.usersAtLevel(tx, 95);
      await notificationService.notify(tx, admins, {
        type: 'SYSTEM_JOB_FAILED',
        title: `Background job ${job} failed`,
        body: (err instanceof Error ? err.message : String(err)).slice(0, 400),
        link: '/m/admin-audit',
        dedupeKey: `job:${job}:${istDate()}`,
      });
    });
  } catch (alertErr) {
    logger.error({ alertErr, job }, 'Could not notify administrators about a failed job');
  }
}

function guarded(queue: QueueName, run: () => Promise<unknown>) {
  registerJobHandler(queue, async () => {
    try {
      await run();
    } catch (err) {
      logger.error({ err, queue }, 'Job failed');
      await alertAdministrators(queue, err);
      throw err;
    }
  });
}

export function registerApprovalJobHandlers(): void {
  guarded(QUEUES.approvalsSlaScan, () => escalateOverdue());
  guarded(QUEUES.approvalsReminder, () => sendApprovalReminders());
  guarded(QUEUES.notificationsDigest, () => notificationService.sendDigests());
  guarded(QUEUES.emailSend, () => drainOutbox());
  guarded(QUEUES.notificationsPurge, () => notificationService.purge());
  guarded(QUEUES.inventoryDaily, () => runInventoryDaily());
  guarded(QUEUES.scmDaily, () => runScmDaily());
  guarded(QUEUES.qmsDaily, () => runQmsDaily());
}
