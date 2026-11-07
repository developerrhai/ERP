// apps/api/src/kit/print.ts
// Print / PDF registry and HTTP routes for declarative document printing (docs/plans/07-ENGINE-KIT.md §2.9, §12 T-KIT-11)

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { recordAudit } from '../core/audit/audit-service';
import { authenticate, requirePasswordChanged } from '../core/auth/authenticate';
import { requestMeta, requireAuth } from '../core/auth/auth-context';
import { resolveContext } from '../core/context/resolve-context';
import { prisma, type Db } from '../core/db/prisma';
import { asyncHandler } from '../core/http/async-handler';
import { Errors } from '../core/http/errors';
import { accessUserOf, can } from '../core/rbac/access';
import { typedSchema } from '../modules/inventory/definitions';
import { typedHandlerFor } from '../modules/inventory/typed-pages';
import type { Caller } from '../modules/records/service';
import { applyPrintFormat } from '../core/settings/format-schema';
import { FormatService } from '../modules/format-settings/resolve';
import { registerAuditVocabulary } from './audit';
import { registerTestResetter } from './registry';

// Register PRINT_RENDERED action and audit target types
registerAuditVocabulary(['PRINT_RENDERED'], ['record', 'page']);

export const printDtoSchema = z.object({
  templateKey: z.string().min(1),
  title: z.string().min(1),
  docNo: z.string().min(1),
  docDate: z.string().min(1),
  revision: z.string().optional(),
  unit: z.object({
    code: z.string().min(1),
    name: z.string().min(1),
    gstin: z.string().optional(),
    address: z.string().optional(),
  }),
  letterhead: z.record(z.string()).default({}),
  parties: z
    .array(
      z.object({
        role: z.string().min(1),
        name: z.string().min(1),
        gstin: z.string().optional(),
        address: z.string().optional(),
        contact: z.string().optional(),
      }),
    )
    .default([]),
  facts: z.array(z.object({ label: z.string(), value: z.string() })).default([]),
  lines: z
    .object({
      columns: z.array(
        z.object({
          key: z.string(),
          label: z.string(),
          format: z.string(),
          align: z.enum(['left', 'right']).optional(),
        }),
      ),
      rows: z.array(z.record(z.union([z.string(), z.number(), z.null()]))),
    })
    .nullable()
    .default(null),
  sections: z
    .array(
      z.object({
        title: z.string(),
        rows: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
        text: z.string().optional(),
      }),
    )
    .default([]),
  totals: z
    .array(
      z.object({
        label: z.string(),
        value: z.string(),
        bold: z.boolean().optional(),
      }),
    )
    .default([]),
  amountInWords: z.string().optional(),
  notes: z.string().optional(),
  signatures: z.array(z.object({ label: z.string(), name: z.string().optional() })).default([]),
  /** Phase 6B: set when a published PRINT format restyled this document. */
  layout: z
    .object({ paper: z.string(), orientation: z.string(), showLetterhead: z.boolean() })
    .optional(),
  formatVersion: z.object({ id: z.string(), version: z.number() }).optional(),
});

export type PrintDto = z.infer<typeof printDtoSchema>;

export type PrintDataBuilder = (ctx: {
  db: Db;
  caller: Caller;
  pageId: string;
  id?: string;
  query?: Record<string, unknown>;
}) => Promise<PrintDto>;

export type PdfRenderer = (ctx: {
  db: Db;
  caller: Caller;
  id?: string;
  key: string;
  query?: Record<string, unknown>;
}) => Promise<Buffer>;

export interface PrintDef {
  pageId: string;
  templateKey: string;
  kind: 'web' | 'pdf';
  builder?: PrintDataBuilder;
  renderer?: PdfRenderer;
}

const PRINT_DATA_REGISTRY = new Map<string, PrintDataBuilder>();
const PDF_REGISTRY = new Map<string, PdfRenderer>();

export function registerPrintData(pageId: string, templateKey: string, builder: PrintDataBuilder): void {
  const key = `${pageId}:${templateKey}`;
  if (PRINT_DATA_REGISTRY.has(key)) {
    throw new Error(`KIT: print builder ${pageId}.${templateKey} already registered`);
  }
  PRINT_DATA_REGISTRY.set(key, builder);
}

export function registerPdf(pageId: string, templateKey: string, renderer: PdfRenderer): void {
  const key = `${pageId}:${templateKey}`;
  if (PDF_REGISTRY.has(key)) {
    throw new Error(`KIT: pdf renderer ${pageId}.${templateKey} already registered`);
  }
  PDF_REGISTRY.set(key, renderer);
}

export function getPrintDataBuilder(pageId: string, templateKey: string): PrintDataBuilder | undefined {
  return PRINT_DATA_REGISTRY.get(`${pageId}:${templateKey}`);
}

export function getPdfRenderer(pageId: string, templateKey: string): PdfRenderer | undefined {
  return PDF_REGISTRY.get(`${pageId}:${templateKey}`);
}

export function resetPrintRegistryForTest(): void {
  PRINT_DATA_REGISTRY.clear();
  PDF_REGISTRY.clear();
}

registerTestResetter(resetPrintRegistryForTest);

/** Applies the ACTIVE published PRINT format of the page (customer / unit specific when one exists). */
async function withPrintFormat(pageId: string, dto: PrintDto, unitId: string | null): Promise<PrintDto> {
  const format = await FormatService.resolve(pageId, 'PRINT', { unitId });
  if (!format) return dto;
  return applyPrintFormat(dto, format.schema, { id: format.id, version: format.versionNo });
}

function getCaller(req: Request): Caller {
  if (!req.ctx) throw Errors.unauthenticated();
  return {
    auth: requireAuth(req),
    ctx: req.ctx,
    meta: requestMeta(req),
  };
}

export function createKitPrintRouter(): Router {
  const router = Router();
  router.use(authenticate, requirePasswordChanged, resolveContext);

  // K7: Record web print data
  router.get(
    '/:pageId/records/:id/print/:templateKey',
    asyncHandler(async (req: Request, res: Response) => {
      const pageId = req.params.pageId || '';
      const id = req.params.id || '';
      const templateKey = req.params.templateKey || '';
      const caller = getCaller(req);

      const allowed = await can(
        accessUserOf(caller.auth.user),
        pageId,
        'view',
      );
      if (!allowed) throw Errors.forbidden();

      const schema = typedSchema(pageId);
      const template = schema?.printTemplates?.find((t) => t.key === templateKey);
      if (!template || template.kind !== 'web') {
        throw Errors.notFound(`Print template ${templateKey} not found for page ${pageId}`);
      }

      const builder = getPrintDataBuilder(pageId, templateKey);
      if (!builder) {
        throw Errors.notFound(`No print builder registered for ${pageId}.${templateKey}`);
      }

      // Check record exists and is visible
      const handler = typedHandlerFor(pageId);
      if (handler) {
        await handler.get(caller, id);
      }

      const dto = await builder({ db: prisma, caller, pageId, id });
      const parsed = await withPrintFormat(pageId, printDtoSchema.parse(dto), caller.ctx.unitId);

      await recordAudit({
        action: 'PRINT_RENDERED',
        actorId: caller.auth.user.id,
        targetType: 'record',
        targetId: id,
        meta: caller.meta,
        detail: { pageId, templateKey, kind: 'web' },
      });

      res.setHeader('Cache-Control', 'no-store');
      res.json({ data: parsed });
    }),
  );

  // K8: Record PDF export
  router.get(
    '/:pageId/records/:id/pdf/:templateKey',
    asyncHandler(async (req: Request, res: Response) => {
      const pageId = req.params.pageId || '';
      const id = req.params.id || '';
      const templateKey = req.params.templateKey || '';
      const caller = getCaller(req);

      const canView = await can(
        accessUserOf(caller.auth.user),
        pageId,
        'view',
      );
      if (!canView) throw Errors.forbidden();

      const canExport = await can(
        accessUserOf(caller.auth.user),
        pageId,
        'export',
      );
      if (!canExport) throw Errors.forbidden('Export permission required.');

      const schema = typedSchema(pageId);
      const template = schema?.printTemplates?.find((t) => t.key === templateKey);
      if (!template || template.kind !== 'pdf') {
        throw Errors.notFound(`PDF template ${templateKey} not found for page ${pageId}`);
      }

      const renderer = getPdfRenderer(pageId, templateKey);
      if (!renderer) {
        throw Errors.notFound(`No PDF renderer registered for ${pageId}.${templateKey}`);
      }

      const handler = typedHandlerFor(pageId);
      if (handler) {
        await handler.get(caller, id);
      }

      const buffer = await renderer({ db: prisma, caller, id, key: templateKey });

      if (buffer.length > 10 * 1024 * 1024) {
        throw Errors.payloadTooLarge();
      }

      await recordAudit({
        action: 'PRINT_RENDERED',
        actorId: caller.auth.user.id,
        targetType: 'record',
        targetId: id,
        meta: caller.meta,
        detail: { pageId, templateKey, kind: 'pdf' },
      });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${templateKey}-${id}.pdf"`);
      res.setHeader('Cache-Control', 'no-store');
      res.send(buffer);
    }),
  );

  // K9 (a): Page-scoped web print
  router.get(
    '/:pageId/print/:templateKey',
    asyncHandler(async (req: Request, res: Response) => {
      const pageId = req.params.pageId || '';
      const templateKey = req.params.templateKey || '';
      const caller = getCaller(req);

      const allowed = await can(
        accessUserOf(caller.auth.user),
        pageId,
        'view',
      );
      if (!allowed) throw Errors.forbidden();

      const schema = typedSchema(pageId);
      const template = schema?.printTemplates?.find((t) => t.key === templateKey);
      if (!template || template.kind !== 'web') {
        throw Errors.notFound(`Print template ${templateKey} not found for page ${pageId}`);
      }

      const builder = getPrintDataBuilder(pageId, templateKey);
      if (!builder) {
        throw Errors.notFound(`No print builder registered for ${pageId}.${templateKey}`);
      }

      const dto = await builder({ db: prisma, caller, pageId, query: req.query as Record<string, unknown> });
      const parsed = await withPrintFormat(pageId, printDtoSchema.parse(dto), caller.ctx.unitId);

      await recordAudit({
        action: 'PRINT_RENDERED',
        actorId: caller.auth.user.id,
        targetType: 'page',
        targetId: pageId,
        meta: caller.meta,
        detail: { pageId, templateKey, kind: 'web' },
      });

      res.setHeader('Cache-Control', 'no-store');
      res.json({ data: parsed });
    }),
  );

  // K9 (b): Page-scoped PDF export
  router.get(
    '/:pageId/pdf/:templateKey',
    asyncHandler(async (req: Request, res: Response) => {
      const pageId = req.params.pageId || '';
      const templateKey = req.params.templateKey || '';
      const caller = getCaller(req);

      const canView = await can(
        accessUserOf(caller.auth.user),
        pageId,
        'view',
      );
      if (!canView) throw Errors.forbidden();

      const canExport = await can(
        accessUserOf(caller.auth.user),
        pageId,
        'export',
      );
      if (!canExport) throw Errors.forbidden('Export permission required.');

      const schema = typedSchema(pageId);
      const template = schema?.printTemplates?.find((t) => t.key === templateKey);
      if (!template || template.kind !== 'pdf') {
        throw Errors.notFound(`PDF template ${templateKey} not found for page ${pageId}`);
      }

      const renderer = getPdfRenderer(pageId, templateKey);
      if (!renderer) {
        throw Errors.notFound(`No PDF renderer registered for ${pageId}.${templateKey}`);
      }

      const buffer = await renderer({
        db: prisma,
        caller,
        key: templateKey,
        query: req.query as Record<string, unknown>,
      });

      if (buffer.length > 10 * 1024 * 1024) {
        throw Errors.payloadTooLarge();
      }

      await recordAudit({
        action: 'PRINT_RENDERED',
        actorId: caller.auth.user.id,
        targetType: 'page',
        targetId: pageId,
        meta: caller.meta,
        detail: { pageId, templateKey, kind: 'pdf' },
      });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${pageId}-${templateKey}.pdf"`);
      res.setHeader('Cache-Control', 'no-store');
      res.send(buffer);
    }),
  );

  return router;
}
