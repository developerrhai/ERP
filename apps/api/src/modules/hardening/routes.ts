// Phase 20 routes: DPDP notice & data-principal requests (20-J), Audit partitions (20-D),
// Opening-balance cut-over & sign-off (20-G), and S3/hardening status.
import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  authenticate,
  requireMfaSatisfied,
  requirePasswordChanged,
} from '../../core/auth/authenticate';
import { requestMeta, requireAuth } from '../../core/auth/auth-context';
import { resolveContext } from '../../core/context/resolve-context';
import { asyncHandler } from '../../core/http/async-handler';
import { requirePageAction } from '../../core/rbac/access';
import { validate, validated } from '../../core/http/validate';
import { auditPartitionService } from './audit-partition-service';
import { cutoverService, OPENING_DATASETS } from './cutover-service';
import { dpdpService } from './dpdp-service';
import { callerOf } from '../inventory/routes-shared';
import { idempotencyKeyOf } from '../data-jobs/routes';

const noticeQuerySchema = z.object({ locale: z.enum(['en', 'hi', 'mr']).default('en') }).strict();
const ackSchema = z.object({ noticeId: z.string().uuid() }).strict();
const listReqQuerySchema = z
  .object({ status: z.enum(['OPEN', 'IN_PROGRESS', 'COMPLETED', 'REJECTED']).optional() })
  .strict();
const createReqSchema = z
  .object({
    requestType: z.enum(['ACCESS', 'CORRECTION', 'ERASURE']),
    principalType: z.enum(['EMPLOYEE', 'CUSTOMER', 'SUPPLIER', 'CONTACT']),
    principalId: z.string().uuid().nullable().optional(),
    principalName: z.string().trim().min(1).max(160),
    contactEmail: z.string().trim().email().nullable().optional(),
    contactPhone: z.string().trim().min(5).max(32).nullable().optional(),
    description: z.string().trim().min(3).max(2000),
  })
  .strict();
const updateReqSchema = z
  .object({
    status: z.enum(['OPEN', 'IN_PROGRESS', 'COMPLETED', 'REJECTED']),
    resolutionNotes: z.string().trim().max(2000).optional(),
  })
  .strict();
const uuidParam = z.object({ id: z.string().uuid() }).strict();
const datasetParam = z.object({ dataset: z.enum(OPENING_DATASETS) }).strict();
const batchParam = z.object({ batchId: z.string().uuid() }).strict();
const dryRunSchema = z
  .object({
    dataset: z.enum(OPENING_DATASETS),
    legacyTotal: z.union([z.number(), z.string()]),
    glControlBalance: z.union([z.number(), z.string()]).optional(),
    rows: z.array(z.record(z.unknown())).min(1).max(10_000),
  })
  .strict();
const signOffSchema = z
  .object({
    cfoUserId: z.string().uuid().optional(),
    deptHeadUserId: z.string().uuid().optional(),
    dmsDocumentId: z.string().uuid().nullable().optional(),
    notes: z.string().trim().max(1000).optional(),
  })
  .strict();

export function createPhase20Router(): Router {
  const router = Router();
  const base = Router();

  // Privacy notice reading & first-login acknowledgement for any authenticated user.
  base.use(authenticate, requirePasswordChanged);

  base.get(
    '/privacy/notice',
    validate({ query: noticeQuerySchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const auth = requireAuth(req);
      const { locale } = validated(res, 'query', noticeQuerySchema);
      res.json({ data: await dpdpService.getNotice(auth.userId, locale) });
    }),
  );

  base.post(
    '/privacy/acknowledge',
    validate({ body: ackSchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const auth = requireAuth(req);
      const { noticeId } = validated(res, 'body', ackSchema);
      const meta = requestMeta(req);
      res.json({ data: await dpdpService.acknowledgeNotice(auth.userId, noticeId, meta.ip) });
    }),
  );

  // Scoped admin/governance routes
  const governed = Router();
  governed.use(authenticate, requirePasswordChanged, requireMfaSatisfied, resolveContext);

  governed.get(
    '/privacy/requests',
    requirePageAction('admin-security', 'view'),
    validate({ query: listReqQuerySchema }),
    asyncHandler(async (_req: Request, res: Response) => {
      const { status } = validated(res, 'query', listReqQuerySchema);
      res.json({ data: await dpdpService.listRequests(status) });
    }),
  );

  governed.post(
    '/privacy/requests',
    requirePageAction('admin-security', 'add'),
    validate({ body: createReqSchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const body = validated(res, 'body', createReqSchema);
      const data = await dpdpService.createRequest(callerOf(req), body);
      res.status(201).json({ data });
    }),
  );

  governed.patch(
    '/privacy/requests/:id',
    requirePageAction('admin-security', 'edit'),
    validate({ params: uuidParam, body: updateReqSchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = validated(res, 'params', uuidParam);
      const body = validated(res, 'body', updateReqSchema);
      res.json({ data: await dpdpService.updateRequest(callerOf(req), id, body) });
    }),
  );

  governed.get(
    '/privacy/retention',
    requirePageAction('admin-security', 'view'),
    asyncHandler(async (_req: Request, res: Response) => {
      res.json({ data: await dpdpService.listRetentionPolicies() });
    }),
  );

  governed.post(
    '/privacy/retention/run',
    requirePageAction('admin-security', 'edit'),
    asyncHandler(async (req: Request, res: Response) => {
      res.json({ data: await dpdpService.runRetentionSweep(requireAuth(req).userId) });
    }),
  );

  governed.get(
    '/audit-partitions',
    requirePageAction('admin-audit', 'view'),
    asyncHandler(async (_req: Request, res: Response) => {
      res.json({ data: await auditPartitionService.status() });
    }),
  );

  governed.post(
    '/audit-partitions/maintain',
    requirePageAction('admin-audit', 'edit'),
    asyncHandler(async (_req: Request, res: Response) => {
      res.json({ data: await auditPartitionService.maintain(3) });
    }),
  );

  governed.get(
    '/cutover/templates/:dataset',
    requirePageAction('admin-import', 'view'),
    validate({ params: datasetParam }),
    asyncHandler(async (_req: Request, res: Response) => {
      const { dataset } = validated(res, 'params', datasetParam);
      res.json({ data: cutoverService.getTemplate(dataset) });
    }),
  );

  governed.get(
    '/cutover/batches',
    requirePageAction('admin-import', 'view'),
    asyncHandler(async (req: Request, res: Response) => {
      res.json({ data: await cutoverService.listBatches(callerOf(req)) });
    }),
  );

  governed.post(
    '/cutover/dry-run',
    requirePageAction('admin-import', 'add'),
    validate({ body: dryRunSchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const body = validated(res, 'body', dryRunSchema);
      const data = await cutoverService.dryRun(callerOf(req), body);
      res.status(201).json({ data });
    }),
  );

  governed.post(
    '/cutover/:batchId/commit',
    requirePageAction('admin-import', 'add'),
    validate({ params: batchParam }),
    asyncHandler(async (req: Request, res: Response) => {
      const { batchId } = validated(res, 'params', batchParam);
      const { batch, replay } = await cutoverService.commit(
        callerOf(req),
        batchId,
        idempotencyKeyOf(req),
      );
      if (replay) res.set('Idempotent-Replay', 'true');
      res.json({ data: batch });
    }),
  );

  governed.post(
    '/cutover/:batchId/signoff',
    requirePageAction('admin-import', 'edit'),
    validate({ params: batchParam, body: signOffSchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const { batchId } = validated(res, 'params', batchParam);
      const body = validated(res, 'body', signOffSchema);
      res.json({ data: await cutoverService.signOff(callerOf(req), batchId, body) });
    }),
  );

  governed.get(
    '/cutover/:batchId/reconciliation.pdf',
    requirePageAction('admin-import', 'view'),
    validate({ params: batchParam }),
    asyncHandler(async (_req: Request, res: Response) => {
      const { batchId } = validated(res, 'params', batchParam);
      const { buffer, batchNo } = await cutoverService.reconciliationPdf(batchId);
      res
        .set({
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${batchNo}-reconciliation.pdf"`,
          'Cache-Control': 'private, no-store',
        })
        .send(buffer);
    }),
  );

  base.use(governed);
  router.use('/hardening', base);
  return router;
}
