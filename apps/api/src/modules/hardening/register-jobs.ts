// Phase 20 pg-boss background job handlers.
import { QUEUES, registerJobHandler } from '../../core/jobs';
import { logger } from '../../core/logger';
import { cleanupRateLimitHits } from '../../core/rate-limit';
import { auditPartitionService } from './audit-partition-service';
import { dpdpService } from './dpdp-service';

export function registerPhase20JobHandlers(): void {
  registerJobHandler(QUEUES.rateLimitCleanup, async () => {
    const deleted = await cleanupRateLimitHits();
    logger.debug({ deleted }, 'Cleaned expired rate_limit_hits');
  });

  registerJobHandler(QUEUES.auditPartitionMaintain, async () => {
    const res = await auditPartitionService.maintain(3);
    logger.info(res, 'Audit log partition maintenance completed');
  });

  registerJobHandler(QUEUES.dpdpRetentionRun, async () => {
    const res = await dpdpService.runRetentionSweep(null);
    logger.info(res, 'DPDP retention sweep completed');
  });
}

