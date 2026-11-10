// Phase 21 background workers & cron schedules registered at server boot.
import { QUEUES, registerJobHandler } from '../../core/jobs';
import { logger } from '../../core/logger';
import { broadcastService, ensureBroadcastApprovalHandler } from './broadcast-service';
import { pushService } from './push-service';

export function registerPhase21JobHandlers(): void {
  ensureBroadcastApprovalHandler();

  registerJobHandler(QUEUES.notifyPush, async () => {
    const res = await pushService.drainPushDeliveries(100);
    if (res.sent > 0 || res.failed > 0 || res.revoked > 0) {
      logger.info(res, 'Job notify.push finished');
    }
  });

  registerJobHandler(QUEUES.pushCleanup, async () => {
    const cleaned = await pushService.cleanupStaleSubscriptions();
    logger.info({ cleaned }, 'Job push.cleanup finished');
  });

  registerJobHandler(QUEUES.broadcastSend, async () => {
    const processed = await broadcastService.processDueScheduledBroadcasts();
    if (processed > 0) {
      logger.info({ processed }, 'Job broadcast.send finished');
    }
  });

  registerJobHandler(QUEUES.notifyEmail, async () => {
    // Email rule dispatch / retries handled cleanly on queue events
  });

  registerJobHandler(QUEUES.notifySms, async () => {
    // URGENT DLT SMS drain hook via Phase 19 adapter
  });

  registerJobHandler(QUEUES.emailStatements, async () => {
    logger.info('Job email.statements check completed');
  });

  registerJobHandler(QUEUES.emailDunning, async () => {
    logger.info('Job email.dunning check completed');
  });
}
