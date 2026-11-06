// Background data jobs (docs/phases/PHASE-04.md §4.3, §8): the data_jobs row is the user-visible
// state (status, counts, errors, output file); pg-boss only carries the job id. A job belongs to its
// creator; administrators can see all.
import { createHash } from 'node:crypto';
import type { DataJob, Prisma } from '@prisma/client';
import { z } from 'zod';
import { recordAudit } from '../../core/audit/audit-service';
import { prisma } from '../../core/db/prisma';
import { abandonIdempotent, beginIdempotent, finishIdempotent } from '../../core/http/idempotency';
import { accessUserOf, can } from '../../core/rbac/access';
import { Errors } from '../../core/http/errors';
import { QUEUES, enqueue } from '../../core/jobs';
import type { QueueName } from '../../core/jobs';
import { hasMinRole } from '../../core/rbac/role-rules';
import { defaultStorage } from '../../core/storage';
import { MAX_EXPORT_ROWS } from '../records/schemas';
import type { ExportRecordsQuery } from '../records/schemas';
import { recordService } from '../records/service';
import type { Caller } from '../records/service';

export const exportJobBodySchema = z
  .object({
    format: z.enum(['xlsx', 'csv']).default('xlsx'),
    q: z.string().trim().max(100).optional(),
    status: z.string().trim().min(1).max(30).optional(),
    sort: z.string().trim().min(1).max(81).default('-createdAt'),
    deleted: z.boolean().optional(),
    ids: z.array(z.string().uuid()).max(MAX_EXPORT_ROWS).optional(),
  })
  .strict();
export type ExportJobBody = z.output<typeof exportJobBodySchema>;

export const JOB_OUTPUT_DAYS = 7;
const MS_PER_DAY = 86_400_000;

export interface DataJobDto {
  id: string;
  kind: string;
  pageId: string;
  status: string;
  totalRows: number | null;
  okRows: number | null;
  errorRows: number | null;
  errors: unknown;
  hasOutput: boolean;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  expiresAt: string | null;
}

export function toJobDto(job: DataJob): DataJobDto {
  return {
    id: job.id,
    kind: job.kind,
    pageId: job.pageId,
    status: job.status,
    totalRows: job.totalRows,
    okRows: job.okRows,
    errorRows: job.errorRows,
    errors: job.errorSummary ?? null,
    hasOutput: job.outputFileId !== null,
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
    expiresAt: job.expiresAt?.toISOString() ?? null,
  };
}

const QUEUE_OF: Record<string, QueueName> = {
  EXPORT: QUEUES.exportRecords,
  IMPORT_VALIDATE: QUEUES.importValidate,
  IMPORT_COMMIT: QUEUES.importCommit,
};

export const dataJobService = {
  /** Creates the row and puts its id on the queue. */
  async create(
    caller: Caller,
    input: {
      kind: 'EXPORT' | 'IMPORT_VALIDATE' | 'IMPORT_COMMIT';
      pageId: string;
      params: Prisma.InputJsonObject;
      inputFileId?: string;
      status?: 'QUEUED' | 'DONE';
      enqueueNow?: boolean;
    },
  ): Promise<DataJob> {
    if (caller.ctx.unitId === null) {
      throw Errors.contextInvalid('Choose a unit first: "All units" is for viewing lists only.');
    }
    const job = await prisma.dataJob.create({
      data: {
        kind: input.kind,
        pageId: input.pageId,
        unitId: caller.ctx.unitId,
        fyId: caller.ctx.fyId,
        status: input.status ?? 'QUEUED',
        params: input.params,
        inputFileId: input.inputFileId ?? null,
        createdById: caller.auth.userId,
      },
    });
    if (input.enqueueNow !== false) await this.enqueueJob(job);
    return job;
  },

  /**
   * Background export: the permission, unit, FY and data scope are decided NOW and stored with the
   * job, so the worker needs no request. Replays of the same Idempotency-Key return the same job.
   */
  async createExport(
    caller: Caller,
    pageId: string,
    body: ExportJobBody,
    idempotencyKey: string | undefined,
  ): Promise<{ job: DataJobDto; replay: boolean }> {
    if (!(await can(accessUserOf(caller.auth.user), pageId, 'export'))) throw Errors.forbidden();
    if (caller.ctx.unitId === null) {
      throw Errors.contextInvalid('Choose a unit first: "All units" is for viewing lists only.');
    }
    const query: ExportRecordsQuery = {
      sort: body.sort,
      ...(body.q ? { q: body.q } : {}),
      ...(body.status ? { status: body.status } : {}),
      ...(body.ids ? { ids: body.ids } : {}),
      ...(body.deleted ? { deleted: true } : {}),
    };
    const spec = await recordService.exportSpec(caller, pageId, query);
    const scope = `export:create:${pageId}`;
    if (idempotencyKey) {
      const hash = createHash('sha256')
        .update(JSON.stringify([pageId, caller.ctx.unitId, caller.ctx.fyId, body]))
        .digest('hex');
      const start = await beginIdempotent(caller.auth.userId, scope, idempotencyKey, hash);
      if (start.kind === 'mismatch') {
        throw Errors.conflict('This Idempotency-Key was already used for a different request.');
      }
      if (start.kind === 'in_progress') throw Errors.inProgress();
      if (start.kind === 'replay') {
        const stored = start.body as { data?: DataJobDto } | null;
        if (stored?.data) return { job: stored.data, replay: true };
      }
    }
    try {
      const params = {
        format: body.format,
        visibility: spec.visibility,
        filters: spec.filters,
      } as unknown as Prisma.InputJsonObject;
      const job = await this.create(caller, { kind: 'EXPORT', pageId, params });
      const dto = toJobDto(job);
      await recordAudit({
        action: 'EXPORT_JOB_CREATED',
        actorId: caller.auth.userId,
        targetType: 'Record',
        targetId: pageId,
        meta: caller.meta,
        detail: { pageId, jobId: job.id, format: body.format },
      });
      if (idempotencyKey) {
        await finishIdempotent(caller.auth.userId, scope, idempotencyKey, 202, {
          data: JSON.parse(JSON.stringify(dto)) as Prisma.InputJsonObject,
        });
      }
      return { job: dto, replay: false };
    } catch (err) {
      if (idempotencyKey) await abandonIdempotent(caller.auth.userId, scope, idempotencyKey);
      throw err;
    }
  },

  async enqueueJob(job: DataJob): Promise<void> {
    const queue = QUEUE_OF[job.kind];
    if (!queue) throw new Error(`Unknown job kind ${job.kind}`);
    try {
      await enqueue(queue, { jobId: job.id });
    } catch {
      await prisma.dataJob.update({
        where: { id: job.id },
        data: {
          status: 'FAILED',
          finishedAt: new Date(),
          errorSummary: { message: 'Queue is not available.' },
        },
      });
      throw Errors.serverBusy();
    }
  },

  async load(caller: Caller, id: string): Promise<DataJob> {
    const job = await prisma.dataJob.findUnique({ where: { id } });
    if (!job) throw Errors.notFound('Job not found.');
    if (job.createdById !== caller.auth.userId && !hasMinRole(caller.auth.role, 'ADMIN')) {
      throw Errors.notFound('Job not found.');
    }
    return job;
  },

  async get(caller: Caller, id: string): Promise<DataJobDto> {
    return toJobDto(await this.load(caller, id));
  },

  async listMine(caller: Caller, pageId?: string): Promise<DataJobDto[]> {
    const rows = await prisma.dataJob.findMany({
      where: { createdById: caller.auth.userId, ...(pageId ? { pageId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });
    return rows.map(toJobDto);
  },

  async download(caller: Caller, id: string) {
    const job = await this.load(caller, id);
    if (job.status !== 'DONE') throw Errors.jobNotReady();
    if (!job.outputFileId) throw Errors.notFound('This job has no file.');
    if (job.expiresAt && job.expiresAt.getTime() < Date.now()) {
      throw Errors.notFound('The file has expired. Run the export again.');
    }
    const blob = await defaultStorage.get(job.outputFileId);
    if (!blob) throw Errors.notFound('The file is no longer available.');
    return {
      buffer: blob.buffer,
      fileName: blob.record.originalFilename,
      mimeType: blob.record.mimeType,
    };
  },

  expiry(): Date {
    return new Date(Date.now() + JOB_OUTPUT_DAYS * MS_PER_DAY);
  },
};
