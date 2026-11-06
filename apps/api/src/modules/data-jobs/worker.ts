// Job handlers (run inside pg-boss). Every handler is safe to run twice: a finished job is skipped,
// a failed attempt leaves the row FAILED with a readable message instead of throwing forever.
import type { Prisma } from '@prisma/client';
import { recordAudit } from '../../core/audit/audit-service';
import { runDailyCleanup } from '../../core/auth/cleanup';
import { prisma } from '../../core/db/prisma';
import { purgeExpiredIdempotency } from '../../core/http/idempotency';
import { QUEUES, registerJobHandler } from '../../core/jobs';
import type { DataJobPayload } from '../../core/jobs';
import { logger } from '../../core/logger';
import { defaultStorage } from '../../core/storage';
import { buildCsv, buildWorkbook } from '../records/export';
import type { Visibility } from '../records/repository';
import { ASYNC_EXPORT_ROWS } from '../records/schemas';
import { recordService } from '../records/service';
import { processImportCommit, processImportValidate } from '../imports/worker';
import { dataJobService } from './service';
import { markFailed, markRunning } from './state';

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export interface ExportJobParams {
  format: 'xlsx' | 'csv';
  visibility: Visibility;
  filters: { sort: string; q?: string; status?: string; ids?: string[] };
}

export async function processExport(jobId: string): Promise<void> {
  if (!(await markRunning(jobId))) return; // already DONE / FAILED / cancelled
  const job = await prisma.dataJob.findUniqueOrThrow({ where: { id: jobId } });
  try {
    const params = job.params as unknown as ExportJobParams;
    const { schema, rows } = await recordService.exportRowsFor(
      job.pageId,
      params.visibility,
      params.filters,
      ASYNC_EXPORT_ROWS + 1,
    );
    if (rows.length > ASYNC_EXPORT_ROWS) {
      await markFailed(
        jobId,
        `More than ${ASYNC_EXPORT_ROWS} rows match. Narrow the filters and try again.`,
      );
      return;
    }
    const buffer =
      params.format === 'csv' ? buildCsv(schema, rows) : await buildWorkbook(schema, rows);
    const stamp = new Date().toISOString().slice(0, 10);
    const stored = await defaultStorage.save({
      buffer,
      originalFilename: `${job.pageId}-${stamp}.${params.format}`,
      mimeType: params.format === 'csv' ? 'text/csv' : XLSX_TYPE,
      userId: job.createdById,
    });
    await prisma.storedFile.update({
      where: { id: stored.id },
      data: { scanStatus: 'CLEAN', scannedAt: new Date() },
    });
    await prisma.dataJob.update({
      where: { id: jobId },
      data: {
        status: 'DONE',
        outputFileId: stored.id,
        totalRows: rows.length,
        okRows: rows.length,
        errorRows: 0,
        finishedAt: new Date(),
        expiresAt: dataJobService.expiry(),
      },
    });
    await recordAudit({
      action: 'RECORDS_EXPORTED',
      actorId: job.createdById,
      targetType: 'Record',
      targetId: job.pageId,
      detail: {
        pageId: job.pageId,
        count: rows.length,
        format: params.format,
        jobId,
        filters: { unitId: job.unitId, fyId: job.fyId },
      } satisfies Prisma.InputJsonObject,
    });
  } catch (err) {
    logger.error({ err, jobId }, 'Export job failed');
    await markFailed(jobId, 'The export could not be completed. Please try again.');
  }
}

/** Expired sessions / tokens, idempotency keys, job outputs, and jobs stuck in QUEUED. */
export async function runMaintenance(): Promise<Record<string, number>> {
  const security = await runDailyCleanup();
  const keys = await purgeExpiredIdempotency();
  const expired = await prisma.dataJob.findMany({
    where: { expiresAt: { lt: new Date() }, outputFileId: { not: null } },
    select: { id: true, outputFileId: true },
    take: 500,
  });
  for (const job of expired) {
    if (job.outputFileId) await defaultStorage.delete(job.outputFileId);
    await prisma.dataJob.update({ where: { id: job.id }, data: { outputFileId: null } });
  }
  const stale = await prisma.dataJob.updateMany({
    where: { status: 'RUNNING', startedAt: { lt: new Date(Date.now() - 30 * 60_000) } },
    data: {
      status: 'FAILED',
      finishedAt: new Date(),
      errorSummary: { message: 'The job did not finish in time.' },
    },
  });
  const result = {
    sessionsDeleted: security.sessionsDeleted,
    challengesDeleted: security.challengesDeleted,
    tokensDeleted: security.tokensDeleted,
    idempotencyKeysDeleted: keys,
    jobOutputsRemoved: expired.length,
    staleJobsFailed: stale.count,
  };
  logger.info(result, 'Maintenance run');
  return result;
}

function payloadJobId(payload: DataJobPayload | Record<string, never>): string | null {
  return 'jobId' in payload && typeof payload.jobId === 'string' ? payload.jobId : null;
}

export function registerDataJobHandlers(): void {
  registerJobHandler(QUEUES.exportRecords, async (p) => {
    const id = payloadJobId(p);
    if (id) await processExport(id);
  });
  registerJobHandler(QUEUES.importValidate, async (p) => {
    const id = payloadJobId(p);
    if (id) await processImportValidate(id);
  });
  registerJobHandler(QUEUES.importCommit, async (p) => {
    const id = payloadJobId(p);
    if (id) await processImportCommit(id);
  });
  registerJobHandler(QUEUES.maintenance, async () => {
    await runMaintenance();
  });
}
