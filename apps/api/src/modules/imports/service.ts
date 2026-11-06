// Import wizard backend (docs/phases/PHASE-04.md §8.3): upload -> map -> validate -> commit.
// Permissions: the page's `add` AND `export` (owner decision for v1) in a concrete unit and an OPEN
// year. Nothing is created until commit, and commit is all-or-nothing.
import { createHash } from 'node:crypto';
import type { DataJob, Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { prisma } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { abandonIdempotent, beginIdempotent, finishIdempotent } from '../../core/http/idempotency';
import type { UploadedFile } from '../../core/http/multipart';
import { accessUserOf, can } from '../../core/rbac/access';
import { builtInScanner, extensionOf, sanitizeFilename, sniffKind } from '../../core/scan';
import { defaultStorage } from '../../core/storage';
import type { PageSchema } from '../../engine/field-schema';
import { dataJobService, toJobDto } from '../data-jobs/service';
import type { DataJobDto } from '../data-jobs/service';
import { genericSchema } from '../records/service';
import type { Caller } from '../records/service';
import { IMPORT_MAX_BYTES, parseSheet } from './parse';
import { importableFields, suggestMapping } from './rows';
import type { ColumnMapping } from './rows';
import type { ImportParams } from './worker';
import { safeCell } from '../records/export';

export const mappingBodySchema = z
  .object({
    mapping: z.record(z.string().max(80), z.number().int().min(0).max(200)),
  })
  .strict();

export interface ImportUploadDto {
  job: DataJobDto;
  headers: string[];
  sample: (string | number | boolean | null)[][];
  suggestedMapping: ColumnMapping;
  fields: { key: string; label: string; type: string; required: boolean; options?: string[] }[];
  totalRows: number;
}

async function requireImportAccess(caller: Caller, pageId: string): Promise<void> {
  const user = accessUserOf(caller.auth.user);
  if (!(await can(user, pageId, 'add')) || !(await can(user, pageId, 'export'))) {
    throw Errors.forbidden('Importing needs the Add and Export permissions on this page.');
  }
  if (caller.ctx.unitId === null) {
    throw Errors.contextInvalid('Choose a unit first: "All units" is for viewing lists only.');
  }
  const fy = await prisma.financialYear.findUnique({ where: { id: caller.ctx.fyId } });
  if (!fy || fy.status !== 'OPEN') {
    throw Errors.periodClosed(`Financial year ${fy?.code ?? ''} is closed.`);
  }
}

function fieldsOf(schema: PageSchema): ImportUploadDto['fields'] {
  return importableFields(schema).map((f) => ({
    key: f.key,
    label: f.label,
    type: f.type,
    required: f.required,
    ...(f.options ? { options: f.options } : {}),
  }));
}

async function ownImportJob(
  caller: Caller,
  jobId: string,
  kind: DataJob['kind'],
): Promise<DataJob> {
  const job = await dataJobService.load(caller, jobId);
  if (job.kind !== kind) throw Errors.notFound('Import not found.');
  if (job.createdById !== caller.auth.userId) throw Errors.notFound('Import not found.');
  return job;
}

export const importService = {
  async upload(caller: Caller, pageId: string, upload: UploadedFile): Promise<ImportUploadDto> {
    const schema = genericSchema(pageId);
    await requireImportAccess(caller, pageId);
    if (upload.buffer.length > IMPORT_MAX_BYTES) {
      throw Errors.fileTooLarge(`The file is larger than ${IMPORT_MAX_BYTES / 1048576} MB.`);
    }
    const fileName = sanitizeFilename(upload.filename);
    const ext = extensionOf(fileName);
    const kind = sniffKind(upload.buffer, ext);
    if ((kind !== 'xlsx' && kind !== 'csv') || (ext !== 'xlsx' && ext !== 'csv')) {
      throw Errors.fileTypeNotAllowed('Upload an .xlsx or .csv file.');
    }
    const verdict = await builtInScanner.scan(upload.buffer, kind);
    if (verdict.status === 'INFECTED') throw Errors.fileInfected();

    const sheet = await parseSheet(upload.buffer, kind);
    const stored = await defaultStorage.save({
      buffer: upload.buffer,
      originalFilename: fileName,
      mimeType:
        kind === 'csv'
          ? 'text/csv'
          : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      userId: caller.auth.userId,
    });
    await prisma.storedFile.update({
      where: { id: stored.id },
      data: { scanStatus: 'CLEAN', scannedAt: new Date() },
    });
    const suggested = suggestMapping(schema, sheet.headers);
    const params: ImportParams = {
      stage: 'UPLOADED',
      format: kind,
      fileName,
      headers: sheet.headers,
      mapping: suggested,
    };
    const job = await dataJobService.create(caller, {
      kind: 'IMPORT_VALIDATE',
      pageId,
      params: params as unknown as Prisma.InputJsonObject,
      inputFileId: stored.id,
      status: 'DONE',
      enqueueNow: false,
    });
    await prisma.dataJob.update({
      where: { id: job.id },
      data: { totalRows: sheet.rows.length, finishedAt: new Date() },
    });
    return {
      job: toJobDto({ ...job, totalRows: sheet.rows.length }),
      headers: sheet.headers,
      sample: sheet.rows.slice(0, 5),
      suggestedMapping: suggested,
      fields: fieldsOf(schema),
      totalRows: sheet.rows.length,
    };
  },

  async validate(caller: Caller, jobId: string, mapping: ColumnMapping): Promise<DataJobDto> {
    const job = await ownImportJob(caller, jobId, 'IMPORT_VALIDATE');
    await requireImportAccess(caller, job.pageId);
    const params = job.params as unknown as ImportParams;
    if (job.status === 'QUEUED' || job.status === 'RUNNING') throw Errors.inProgress();
    if (job.status === 'FAILED')
      throw Errors.importInvalid('This import failed. Upload the file again.');
    const schema = genericSchema(job.pageId);
    const fields = new Map(importableFields(schema).map((f) => [f.key, f]));
    const problems: Record<string, string> = {};
    for (const [key, index] of Object.entries(mapping)) {
      if (!fields.has(key)) problems[key] = 'This is not a field of the page.';
      else if (index >= params.headers.length) problems[key] = 'This column is not in the file.';
    }
    for (const f of fields.values()) {
      if (f.required && mapping[f.key] === undefined)
        problems[f.key] = 'Map a column to this required field.';
    }
    if (Object.keys(problems).length > 0) {
      throw Errors.importInvalid('Fix the column mapping.', problems);
    }
    const next: ImportParams = { ...params, mapping, stage: 'VALIDATING' };
    const queued = await prisma.dataJob.update({
      where: { id: job.id },
      data: {
        status: 'QUEUED',
        params: next as unknown as Prisma.InputJsonObject,
        okRows: null,
        errorRows: null,
        errorSummary: undefined,
        finishedAt: null,
      },
    });
    await dataJobService.enqueueJob(queued);
    return toJobDto(queued);
  },

  async commit(
    caller: Caller,
    jobId: string,
    idempotencyKey: string | undefined,
  ): Promise<{ job: DataJobDto; replay: boolean }> {
    const source = await ownImportJob(caller, jobId, 'IMPORT_VALIDATE');
    await requireImportAccess(caller, source.pageId);
    const params = source.params as unknown as ImportParams;
    if (source.status !== 'DONE' || params.stage !== 'VALIDATED') {
      throw Errors.importInvalid('Check the file first (step 3).');
    }
    if ((source.errorRows ?? 0) > 0 || (source.totalRows ?? 0) === 0) {
      throw Errors.importInvalid('The file still has errors. Fix them and check again.');
    }
    if (source.unitId !== caller.ctx.unitId || source.fyId !== caller.ctx.fyId) {
      throw Errors.contextInvalid(
        'The unit or year changed since the file was checked. Upload it again.',
      );
    }
    // One commit per checked file: a second request returns the first one's job.
    const existing = await prisma.dataJob.findFirst({
      where: {
        kind: 'IMPORT_COMMIT',
        createdById: caller.auth.userId,
        params: { path: ['validateJobId'], equals: source.id },
        status: { in: ['QUEUED', 'RUNNING', 'DONE'] },
      },
    });
    if (existing) return { job: toJobDto(existing), replay: true };

    const scope = `import:commit:${source.id}`;
    let begun = false;
    if (idempotencyKey) {
      const hash = createHash('sha256').update(source.id).digest('hex');
      const start = await beginIdempotent(caller.auth.userId, scope, idempotencyKey, hash);
      if (start.kind === 'in_progress') throw Errors.inProgress();
      if (start.kind === 'mismatch') {
        throw Errors.conflict('This Idempotency-Key was already used for a different request.');
      }
      if (start.kind === 'replay') {
        const stored = start.body as { data?: DataJobDto } | null;
        if (stored?.data) return { job: stored.data, replay: true };
      }
      begun = true;
    }
    try {
      const commitParams: ImportParams = { ...params, validateJobId: source.id };
      const job = await dataJobService.create(caller, {
        kind: 'IMPORT_COMMIT',
        pageId: source.pageId,
        params: commitParams as unknown as Prisma.InputJsonObject,
      });
      const dto = toJobDto(job);
      if (begun && idempotencyKey) {
        await finishIdempotent(caller.auth.userId, scope, idempotencyKey, 202, {
          data: JSON.parse(JSON.stringify(dto)) as Prisma.InputJsonObject,
        });
      }
      return { job: dto, replay: false };
    } catch (err) {
      if (begun && idempotencyKey)
        await abandonIdempotent(caller.auth.userId, scope, idempotencyKey);
      throw err;
    }
  },

  /** A workbook with the importable headings plus an "About" sheet that explains each column. */
  async template(caller: Caller, pageId: string): Promise<Buffer> {
    const schema = genericSchema(pageId);
    const user = accessUserOf(caller.auth.user);
    if (!(await can(user, pageId, 'add'))) throw Errors.forbidden();
    const fields = importableFields(schema);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Sawant Group ERP';
    const sheet = workbook.addWorksheet('Import');
    sheet.columns = fields.map((f) => ({
      header: safeCell(f.label + (f.required ? ' *' : '')),
      key: f.key,
      width: Math.min(Math.max(f.label.length + 4, 16), 40),
    }));
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    const about = workbook.addWorksheet('About');
    about.columns = [
      { header: 'Column', key: 'c', width: 32 },
      { header: 'Type', key: 't', width: 14 },
      { header: 'Required', key: 'r', width: 10 },
      { header: 'Allowed values / format', key: 'o', width: 60 },
    ];
    about.getRow(1).font = { bold: true };
    for (const f of fields) {
      about.addRow({
        c: safeCell(f.label),
        t: f.type,
        r: f.required ? 'Yes' : 'No',
        o: f.options
          ? safeCell(f.options.join(', '))
          : f.type === 'date'
            ? 'YYYY-MM-DD or DD-MM-YYYY'
            : f.type === 'bool'
              ? 'Yes / No'
              : '',
      });
    }
    return Buffer.from(await workbook.xlsx.writeBuffer());
  },
};
