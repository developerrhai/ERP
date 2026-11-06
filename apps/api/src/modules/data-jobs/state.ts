// Job state transitions shared by every worker.
import { prisma } from '../../core/db/prisma';

/** Claims a QUEUED (or crashed RUNNING) job; false when it is already DONE / FAILED / cancelled. */
export async function markRunning(jobId: string): Promise<boolean> {
  const claimed = await prisma.dataJob.updateMany({
    where: { id: jobId, status: { in: ['QUEUED', 'RUNNING'] } },
    data: { status: 'RUNNING', startedAt: new Date() },
  });
  return claimed.count === 1;
}

export async function markFailed(jobId: string, message: string): Promise<void> {
  await prisma.dataJob.update({
    where: { id: jobId },
    data: { status: 'FAILED', finishedAt: new Date(), errorSummary: { message } },
  });
}
