// Record documents (docs/phases/PHASE-04.md §5 C8): upload pipeline, list, download, remove.
// Rules: the caller needs the page permission AND must see the record (unit / data scope); add and
// remove obey the lock matrix ("documents"), download works in every status; only CLEAN files leave
// the server; every step is audited. Infected files are rejected and never stored.
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { recordAudit } from '../../core/audit/audit-service';
import { prisma } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { abandonIdempotent, beginIdempotent, finishIdempotent } from '../../core/http/idempotency';
import type { UploadedFile } from '../../core/http/multipart';
import { accessUserOf, can } from '../../core/rbac/access';
import {
  ALLOWED_KINDS,
  MAX_DOCUMENTS_PER_RECORD,
  MAX_FILE_BYTES,
  builtInScanner,
  extensionOf,
  sanitizeFilename,
  sniffKind,
} from '../../core/scan';
import type { Scanner } from '../../core/scan';
import { defaultStorage } from '../../core/storage';
import { recordService } from '../records/service';
import type { Caller } from '../records/service';

export const DOC_TYPES = [
  'GENERAL',
  'INVOICE',
  'CONTRACT',
  'CERTIFICATE',
  'DRAWING',
  'OTHER',
] as const;

export const uploadFieldsSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    docType: z.enum(DOC_TYPES).default('GENERAL'),
  })
  .strict();

export interface DocumentDto {
  id: string;
  recordId: string;
  title: string;
  docType: string;
  fileName: string;
  mimeType: string;
  size: number;
  scanStatus: string;
  sha256: string;
  createdAt: string;
  createdBy: { id: string; name: string } | null;
}

let scanner: Scanner = builtInScanner;
/** Tests / a future ClamAV adapter swap the scanner here. */
export function setScanner(next: Scanner): void {
  scanner = next;
}

async function requirePermission(caller: Caller, pageId: string, action: 'view' | 'edit') {
  if (!(await can(accessUserOf(caller.auth.user), pageId, action))) throw Errors.forbidden();
}

async function toDtos(
  rows: readonly {
    id: string;
    recordId: string;
    title: string;
    docType: string;
    fileId: string;
    createdAt: Date;
    createdById: string | null;
  }[],
): Promise<DocumentDto[]> {
  const files = await prisma.storedFile.findMany({
    where: { id: { in: rows.map((r) => r.fileId) } },
  });
  const users = await prisma.user.findMany({
    where: { id: { in: rows.flatMap((r) => (r.createdById ? [r.createdById] : [])) } },
    select: { id: true, name: true },
  });
  return rows.flatMap((r) => {
    const f = files.find((x) => x.id === r.fileId);
    if (!f) return [];
    const u = users.find((x) => x.id === r.createdById);
    return [
      {
        id: r.id,
        recordId: r.recordId,
        title: r.title,
        docType: r.docType,
        fileName: f.originalFilename,
        mimeType: f.mimeType,
        size: Number(f.fileSize),
        scanStatus: f.scanStatus,
        sha256: f.sha256Hash,
        createdAt: r.createdAt.toISOString(),
        createdBy: u ? { id: u.id, name: u.name } : null,
      },
    ];
  });
}

export const documentService = {
  async list(caller: Caller, pageId: string, recordId: string): Promise<DocumentDto[]> {
    await requirePermission(caller, pageId, 'view');
    await recordService.documentTarget(caller, pageId, recordId, null);
    const rows = await prisma.recordDocument.findMany({
      where: { pageId, recordId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return toDtos(rows);
  },

  async upload(
    caller: Caller,
    pageId: string,
    recordId: string,
    upload: UploadedFile,
    rawFields: Record<string, string>,
    idempotencyKey: string | undefined,
  ): Promise<{ document: DocumentDto; replay: boolean }> {
    await requirePermission(caller, pageId, 'edit');
    const target = await recordService.documentTarget(caller, pageId, recordId, 'documents');
    const parsed = uploadFieldsSchema.safeParse(rawFields);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw Errors.validation({
        [issue?.path.join('.') || 'file']: issue?.message ?? 'Invalid field.',
      });
    }

    const userId = caller.auth.userId;
    const fileName = sanitizeFilename(upload.filename);
    const sha256 = createHash('sha256').update(upload.buffer).digest('hex');
    const scope = `doc:upload:${recordId}`;
    let begun = false;
    if (idempotencyKey) {
      const hash = createHash('sha256')
        .update(JSON.stringify([pageId, recordId, fileName, sha256, parsed.data]))
        .digest('hex');
      const start = await beginIdempotent(userId, scope, idempotencyKey, hash);
      if (start.kind === 'mismatch') {
        throw Errors.conflict('This Idempotency-Key was already used for a different request.');
      }
      if (start.kind === 'in_progress') throw Errors.inProgress();
      if (start.kind === 'replay') {
        const stored = start.body as { data?: DocumentDto } | null;
        if (stored?.data) return { document: stored.data, replay: true };
      }
      begun = true;
    }

    try {
      const document = await this.store(
        caller,
        pageId,
        target,
        fileName,
        upload,
        sha256,
        parsed.data,
      );
      if (begun && idempotencyKey) {
        await finishIdempotent(userId, scope, idempotencyKey, 201, {
          data: JSON.parse(JSON.stringify(document)) as Record<string, never>,
        });
      }
      return { document, replay: false };
    } catch (err) {
      if (begun && idempotencyKey) await abandonIdempotent(userId, scope, idempotencyKey);
      throw err;
    }
  },

  async store(
    caller: Caller,
    pageId: string,
    target: { id: string; code: string },
    fileName: string,
    upload: UploadedFile,
    sha256: string,
    fields: z.infer<typeof uploadFieldsSchema>,
  ): Promise<DocumentDto> {
    const userId = caller.auth.userId;
    if (upload.buffer.length === 0) throw Errors.validation({ file: 'The file is empty.' });
    if (upload.buffer.length > MAX_FILE_BYTES) {
      throw Errors.fileTooLarge(`The file is larger than ${MAX_FILE_BYTES / 1048576} MB.`);
    }
    const ext = extensionOf(fileName);
    const kind = sniffKind(upload.buffer, ext);
    if (!kind || !ALLOWED_KINDS[kind].extensions.includes(ext)) {
      throw Errors.fileTypeNotAllowed(
        'Allowed files: PDF, PNG, JPG, XLSX, DOCX, CSV. The file content must match its extension.',
      );
    }
    const used = await prisma.recordDocument.count({
      where: { recordId: target.id, deletedAt: null },
    });
    if (used >= MAX_DOCUMENTS_PER_RECORD) {
      throw Errors.validation({
        file: `A record can hold at most ${MAX_DOCUMENTS_PER_RECORD} documents.`,
      });
    }

    const verdict = await scanner.scan(upload.buffer, kind);
    if (verdict.status === 'INFECTED') {
      await recordAudit({
        action: 'DOCUMENT_REJECTED',
        actorId: userId,
        targetType: 'Record',
        targetId: target.id,
        meta: caller.meta,
        detail: {
          pageId,
          code: target.code,
          fileName,
          reason: verdict.detail ?? 'infected',
          sha256,
        },
      });
      throw Errors.fileInfected();
    }

    const stored = await defaultStorage.save({
      buffer: upload.buffer,
      originalFilename: fileName,
      mimeType: ALLOWED_KINDS[kind].mime,
      userId,
    });
    const created = await prisma.$transaction(async (tx) => {
      await tx.storedFile.update({
        where: { id: stored.id },
        data: { scanStatus: 'CLEAN', scanDetail: null, scannedAt: new Date() },
      });
      const doc = await tx.recordDocument.create({
        data: {
          pageId,
          recordId: target.id,
          fileId: stored.id,
          docType: fields.docType,
          title: fields.title ?? fileName,
          createdById: userId,
        },
      });
      await recordAudit(
        {
          action: 'DOCUMENT_ADDED',
          actorId: userId,
          targetType: 'Record',
          targetId: target.id,
          meta: caller.meta,
          detail: {
            pageId,
            code: target.code,
            documentId: doc.id,
            fileName,
            size: upload.buffer.length,
            sha256,
          },
        },
        tx,
      );
      return doc;
    });
    const [dto] = await toDtos([created]);
    if (!dto) throw Errors.notFound('Document not found.');
    return dto;
  },

  async remove(caller: Caller, pageId: string, recordId: string, docId: string): Promise<void> {
    await requirePermission(caller, pageId, 'edit');
    const target = await recordService.documentTarget(caller, pageId, recordId, 'documents');
    const doc = await prisma.recordDocument.findFirst({
      where: { id: docId, recordId, pageId, deletedAt: null },
    });
    if (!doc) throw Errors.notFound('Document not found.');
    await prisma.$transaction(async (tx) => {
      await tx.recordDocument.update({
        where: { id: doc.id },
        data: { deletedAt: new Date(), deletedById: caller.auth.userId },
      });
      await recordAudit(
        {
          action: 'DOCUMENT_REMOVED',
          actorId: caller.auth.userId,
          targetType: 'Record',
          targetId: recordId,
          meta: caller.meta,
          detail: { pageId, code: target.code, documentId: doc.id, title: doc.title },
        },
        tx,
      );
    });
  },

  async download(caller: Caller, pageId: string, recordId: string, docId: string) {
    await requirePermission(caller, pageId, 'view');
    const target = await recordService.documentTarget(caller, pageId, recordId, null);
    const doc = await prisma.recordDocument.findFirst({
      where: { id: docId, recordId, pageId, deletedAt: null },
    });
    if (!doc) throw Errors.notFound('Document not found.');
    const file = await prisma.storedFile.findFirst({ where: { id: doc.fileId, deletedAt: null } });
    if (!file || file.scanStatus !== 'CLEAN') throw Errors.notFound('Document not found.');

    if (defaultStorage.getDownloadUrl) {
      const presigned = await defaultStorage.getDownloadUrl(file.id);
      if (presigned) {
        await recordAudit({
          action: 'DOCUMENT_DOWNLOADED',
          actorId: caller.auth.userId,
          targetType: 'Record',
          targetId: recordId,
          meta: caller.meta,
          detail: { pageId, code: target.code, documentId: doc.id, via: 's3_presigned' },
        });
        return {
          presignedUrl: presigned.url,
          expiresInSeconds: presigned.expiresInSeconds,
          fileName: file.originalFilename,
          mimeType: file.mimeType,
          sha256: file.sha256Hash,
          buffer: null as Buffer | null,
        };
      }
    }

    const blob = await defaultStorage.get(file.id);
    if (!blob) throw Errors.notFound('Document not found.');
    await recordAudit({
      action: 'DOCUMENT_DOWNLOADED',
      actorId: caller.auth.userId,
      targetType: 'Record',
      targetId: recordId,
      meta: caller.meta,
      detail: { pageId, code: target.code, documentId: doc.id, via: 'stream' },
    });
    return {
      presignedUrl: null as string | null,
      expiresInSeconds: 0,
      buffer: blob.buffer,
      fileName: file.originalFilename,
      mimeType: file.mimeType,
      sha256: file.sha256Hash,
    };
  },
};
