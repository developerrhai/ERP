// Import workers (docs/phases/PHASE-04.md §8.3). VALIDATE reads the saved upload with the chosen
// column mapping and records per-row problems; COMMIT creates every record in ONE transaction, so a
// bad row (or a crash) leaves no records and no used numbers behind.
import type { Prisma } from '@prisma/client';
import { recordAudit } from '../../core/audit/audit-service';
import { prisma } from '../../core/db/prisma';
import { AppError } from '../../core/http/errors';
import { logger } from '../../core/logger';
import { defaultStorage } from '../../core/storage';
import { buildPageSchema } from '../../engine/field-schema';
import { markFailed, markRunning } from '../data-jobs/state';
import { recordService } from '../records/service';
import { parseSheet } from './parse';
import type { ParsedSheet } from './parse';
import { checkRow, duplicateKey, naturalKeyField, rowInput } from './rows';
import type { ColumnMapping } from './rows';

export const MAX_REPORTED_ERRORS = 200;
export const PREVIEW_ROWS = 20;

export interface ImportParams {
  stage: 'UPLOADED' | 'VALIDATING' | 'VALIDATED';
  format: 'xlsx' | 'csv';
  fileName: string;
  headers: string[];
  mapping?: ColumnMapping;
  validateJobId?: string;
}

export interface RowProblem {
  row: number;
  fields: Record<string, string>;
}

async function loadSheet(inputFileId: string | null, format: 'xlsx' | 'csv'): Promise<ParsedSheet> {
  if (!inputFileId) throw new Error('The uploaded file is missing.');
  const blob = await defaultStorage.get(inputFileId);
  if (!blob) throw new Error('The uploaded file is no longer available.');
  return parseSheet(blob.buffer, format);
}

export async function processImportValidate(jobId: string): Promise<void> {
  if (!(await markRunning(jobId))) return;
  const job = await prisma.dataJob.findUniqueOrThrow({ where: { id: jobId } });
  try {
    const params = job.params as unknown as ImportParams;
    const schema = buildPageSchema(job.pageId);
    if (!schema || !params.mapping) throw new Error('The import is not ready to validate.');
    const sheet = await loadSheet(job.inputFileId, params.format);

    const errors: RowProblem[] = [];
    const warnings: { row: number; message: string }[] = [];
    const preview: { row: number; values: Record<string, unknown> }[] = [];
    const seen = new Map<string, number>();
    const inputs: { row: number; input: Record<string, unknown> }[] = [];
    let errorRows = 0;

    sheet.rows.forEach((cells, i) => {
      const row = i + 2; // spreadsheet row number (row 1 holds the headings)
      const input = rowInput(schema, params.mapping as ColumnMapping, cells);
      let problem = checkRow(schema, input);
      const key = duplicateKey(input);
      const first = seen.get(key);
      if (!problem && first !== undefined) {
        problem = { _: `Same as row ${first}. Remove the duplicate.` };
      } else if (first === undefined) {
        seen.set(key, row);
      }
      if (problem) {
        errorRows += 1;
        if (errors.length < MAX_REPORTED_ERRORS) errors.push({ row, fields: problem });
      } else {
        inputs.push({ row, input });
        if (preview.length < PREVIEW_ROWS) preview.push({ row, values: input });
      }
    });

    // Warning only: a value that already exists on this page / unit / year.
    const keyField = naturalKeyField(schema);
    if (keyField && inputs.length > 0) {
      const values = inputs
        .map((r) => r.input[keyField.key])
        .filter((v): v is string => typeof v === 'string')
        .map((v) => v.toLowerCase());
      const existing = await prisma.$queryRaw<{ v: string }[]>`
        SELECT DISTINCT lower(data ->> ${keyField.key}) AS v FROM generic_records
        WHERE page_id = ${job.pageId} AND unit_id = ${job.unitId}::uuid AND fy_id = ${job.fyId}::uuid
          AND deleted_at IS NULL AND lower(data ->> ${keyField.key}) = ANY(${values})`;
      const taken = new Set(existing.map((e) => e.v));
      for (const r of inputs) {
        const v = r.input[keyField.key];
        if (typeof v === 'string' && taken.has(v.toLowerCase()) && warnings.length < 100) {
          warnings.push({ row: r.row, message: `${keyField.label} "${v}" already exists.` });
        }
      }
    }

    await prisma.dataJob.update({
      where: { id: jobId },
      data: {
        status: 'DONE',
        finishedAt: new Date(),
        totalRows: sheet.rows.length,
        okRows: sheet.rows.length - errorRows,
        errorRows,
        params: { ...params, stage: 'VALIDATED' } as unknown as Prisma.InputJsonObject,
        errorSummary: { errors, warnings, preview } as unknown as Prisma.InputJsonObject,
      },
    });
    await recordAudit({
      action: 'IMPORT_VALIDATED',
      actorId: job.createdById,
      targetType: 'Record',
      targetId: job.pageId,
      detail: { pageId: job.pageId, jobId, rows: sheet.rows.length, errorRows },
    });
  } catch (err) {
    logger.error({ err, jobId }, 'Import validation failed');
    await markFailed(
      jobId,
      err instanceof AppError ? err.message : 'The file could not be checked. Please try again.',
    );
  }
}

export async function processImportCommit(jobId: string): Promise<void> {
  if (!(await markRunning(jobId))) return;
  const job = await prisma.dataJob.findUniqueOrThrow({ where: { id: jobId } });
  try {
    const params = job.params as unknown as ImportParams;
    const source = await prisma.dataJob.findUniqueOrThrow({
      where: { id: params.validateJobId ?? '' },
    });
    const sourceParams = source.params as unknown as ImportParams;
    if (!sourceParams.mapping) throw new Error('The import has no column mapping.');
    const schema = buildPageSchema(job.pageId);
    if (!schema) throw new Error('Unknown page.');
    const fy = await prisma.financialYear.findUniqueOrThrow({ where: { id: job.fyId } });
    if (fy.status !== 'OPEN') {
      await markFailed(jobId, `Financial year ${fy.code} is closed.`);
      return;
    }
    const user = await prisma.user.findUniqueOrThrow({ where: { id: job.createdById } });
    const sheet = await loadSheet(source.inputFileId, sourceParams.format);

    let created = 0;
    let failure: string | null = null;
    try {
      await prisma.$transaction(
        async (tx) => {
          for (const [i, cells] of sheet.rows.entries()) {
            try {
              await recordService.insertInTx(tx, {
                pageId: job.pageId,
                unitId: job.unitId,
                fyId: job.fyId,
                department: user.department ?? 'Administration',
                userId: job.createdById,
                values: rowInput(schema, sourceParams.mapping as ColumnMapping, cells),
                detail: { imported: true, importJobId: jobId },
              });
              created += 1;
            } catch (err) {
              const msg = err instanceof AppError ? err.message : 'Unexpected error.';
              throw new Error(`Row ${i + 2}: ${msg}`);
            }
          }
          await recordAudit(
            {
              action: 'IMPORT_COMMITTED',
              actorId: job.createdById,
              targetType: 'Record',
              targetId: job.pageId,
              detail: { pageId: job.pageId, jobId, validateJobId: source.id, created },
            },
            tx,
          );
        },
        { maxWait: 15_000, timeout: 5 * 60_000 },
      );
    } catch (err) {
      failure = err instanceof Error ? err.message : 'The import failed.';
    }
    if (failure) {
      // The transaction rolled back: nothing was created and no numbers were used.
      await prisma.dataJob.update({
        where: { id: jobId },
        data: {
          status: 'FAILED',
          finishedAt: new Date(),
          totalRows: sheet.rows.length,
          okRows: 0,
          errorRows: sheet.rows.length,
          errorSummary: { message: `Nothing was imported. ${failure}` },
        },
      });
      return;
    }
    await prisma.dataJob.update({
      where: { id: jobId },
      data: {
        status: 'DONE',
        finishedAt: new Date(),
        totalRows: sheet.rows.length,
        okRows: created,
        errorRows: 0,
      },
    });
  } catch (err) {
    logger.error({ err, jobId }, 'Import commit failed');
    await markFailed(jobId, 'The import could not be completed. Nothing was imported.');
  }
}
