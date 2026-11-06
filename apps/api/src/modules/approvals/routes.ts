// /approval-matrix (page admin-approval: view / controls) and /approvals (Approval Center: any
// signed-in user; every read is scoped in SQL and every verb is checked against the request).
import { Router } from 'express';
import type { Request, Response } from 'express';
import { requestMeta, requireAuth } from '../../core/auth/auth-context';
import { authenticate, requirePasswordChanged } from '../../core/auth/authenticate';
import { asyncHandler } from '../../core/http/async-handler';
import { parseIfMatch, parseOptionalIfMatch } from '../../core/http/if-match';
import { validate, validated } from '../../core/http/validate';
import { requirePageAction } from '../../core/rbac/access';
import { delegationService } from './delegations';
import { runIdempotent } from './idempotent';
import { matrixService } from './matrix';
import { approvalQueries } from './queries';
import {
  decisionBodySchema,
  delegationBodySchema,
  docParamsSchema,
  idParamsSchema,
  inboxQuerySchema,
  matrixPreviewBodySchema,
  matrixQuerySchema,
  matrixSetBodySchema,
  reassignBodySchema,
  requestsQuerySchema,
} from './schemas';
import { approvalService } from './service';
import type { ApprovalCaller } from './service';

function callerOf(req: Request): ApprovalCaller {
  return { auth: requireAuth(req), meta: requestMeta(req) };
}

export function createApprovalMatrixRouter(): Router {
  const router = Router();
  router.use(authenticate, requirePasswordChanged);

  router.get(
    '/',
    requirePageAction('admin-approval', 'view'),
    validate({ query: matrixQuerySchema }),
    asyncHandler(async (_req: Request, res: Response) => {
      const q = validated(res, 'query', matrixQuerySchema);
      res.set('Cache-Control', 'no-store');
      res.json({
        data: await matrixService.list({
          ...(q.department ? { department: q.department } : {}),
          ...(q.docType ? { docType: q.docType } : {}),
          ...(q.unit ? { unitId: q.unit } : {}),
        }),
      });
    }),
  );

  router.put(
    '/sets',
    requirePageAction('admin-approval', 'controls'),
    validate({ body: matrixSetBodySchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const body = validated(res, 'body', matrixSetBodySchema);
      const auth = requireAuth(req);
      const { set, created } = await matrixService.save(auth, requestMeta(req), {
        ...body,
        levels: body.levels.map((l) => ({
          level: l.level,
          threshold: l.threshold,
          approverRoleId: l.approverRoleId ?? null,
          approverUserId: l.approverUserId ?? null,
          slaHours: l.slaHours,
          escalateRoleId: l.escalateRoleId ?? null,
          escalateUserId: l.escalateUserId ?? null,
        })),
      });
      res
        .status(created ? 201 : 200)
        .set('ETag', `"${set.version}"`)
        .json({ data: set });
    }),
  );

  router.delete(
    '/sets/:id',
    requirePageAction('admin-approval', 'controls'),
    validate({ params: idParamsSchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = validated(res, 'params', idParamsSchema);
      await matrixService.remove(requireAuth(req), requestMeta(req), id);
      res.status(204).end();
    }),
  );

  router.post(
    '/preview',
    requirePageAction('admin-approval', 'view'),
    validate({ body: matrixPreviewBodySchema }),
    asyncHandler(async (_req: Request, res: Response) => {
      const body = validated(res, 'body', matrixPreviewBodySchema);
      res.json({ data: await matrixService.preview(body) });
    }),
  );

  return router;
}

export function createApprovalsRouter(): Router {
  const router = Router();
  router.use(authenticate, requirePasswordChanged);

  router.get(
    '/inbox',
    validate({ query: inboxQuerySchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const q = validated(res, 'query', inboxQuerySchema);
      const result = await approvalQueries.inbox(requireAuth(req), q);
      res.set('Cache-Control', 'no-store');
      res.json({ data: result.rows, meta: { page: q.page, size: q.size, total: result.total } });
    }),
  );

  router.get(
    '/requests',
    validate({ query: requestsQuerySchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const q = validated(res, 'query', requestsQuerySchema);
      const result = await approvalQueries.list(requireAuth(req), q);
      res.set('Cache-Control', 'no-store');
      res.json({ data: result.rows, meta: { page: q.page, size: q.size, total: result.total } });
    }),
  );

  router.get(
    '/counts',
    asyncHandler(async (req: Request, res: Response) => {
      res.set('Cache-Control', 'no-store');
      res.json({ data: await approvalQueries.counts(requireAuth(req)) });
    }),
  );

  router.get(
    '/doc/:docType/:docId',
    validate({ params: docParamsSchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const { docType, docId } = validated(res, 'params', docParamsSchema);
      const list = await approvalQueries.forDocument(requireAuth(req), docType, docId);
      res.set('Cache-Control', 'no-store');
      res.json({ data: { latest: list[0] ?? null, history: list } });
    }),
  );

  router.get(
    '/requests/:id',
    validate({ params: idParamsSchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = validated(res, 'params', idParamsSchema);
      const dto = await approvalQueries.get(requireAuth(req), id);
      res.set('Cache-Control', 'no-store').set('ETag', `"${dto.version}"`).json({ data: dto });
    }),
  );

  for (const verb of ['approve', 'reject', 'return'] as const) {
    router.post(
      `/requests/:id/${verb}`,
      validate({ params: idParamsSchema, body: decisionBodySchema }),
      asyncHandler(async (req: Request, res: Response) => {
        const { id } = validated(res, 'params', idParamsSchema);
        const body = validated(res, 'body', decisionBodySchema);
        const version = parseIfMatch(req.get('if-match'));
        const caller = callerOf(req);
        await runIdempotent(
          req,
          res,
          caller.auth.userId,
          `approvals:${verb}:${id}`,
          [verb, id, version, body.comment ?? ''],
          (idemKey) =>
            approvalService.decide(caller, id, verb.toUpperCase() as 'APPROVE', {
              comment: body.comment,
              version,
              idemKey,
            }),
        );
      }),
    );
  }

  router.post(
    '/requests/:id/withdraw',
    validate({ params: idParamsSchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = validated(res, 'params', idParamsSchema);
      const version = parseIfMatch(req.get('if-match'));
      const caller = callerOf(req);
      await runIdempotent(
        req,
        res,
        caller.auth.userId,
        `approvals:withdraw:${id}`,
        ['withdraw', id, version],
        (idemKey) => approvalService.withdraw(caller, id, { version, idemKey }),
      );
    }),
  );

  router.post(
    '/steps/:id/reassign',
    validate({ params: idParamsSchema, body: reassignBodySchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = validated(res, 'params', idParamsSchema);
      const body = validated(res, 'body', reassignBodySchema);
      const version = parseOptionalIfMatch(req.get('if-match'));
      const caller = callerOf(req);
      await runIdempotent(
        req,
        res,
        caller.auth.userId,
        `approvals:reassign:${id}`,
        ['reassign', id, body.userId, body.reason],
        () => approvalService.reassign(caller, id, { ...body, version }),
      );
    }),
  );

  router.get(
    '/delegation-targets',
    asyncHandler(async (req: Request, res: Response) => {
      const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 60) : '';
      res.set('Cache-Control', 'no-store');
      res.json({ data: await delegationService.searchTargets(requireAuth(req), q) });
    }),
  );

  router.get(
    '/delegations',
    asyncHandler(async (req: Request, res: Response) => {
      res.set('Cache-Control', 'no-store');
      res.json({ data: await delegationService.list(requireAuth(req)) });
    }),
  );

  router.post(
    '/delegations',
    validate({ body: delegationBodySchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const body = validated(res, 'body', delegationBodySchema);
      const created = await delegationService.create(requireAuth(req), requestMeta(req), body);
      res.status(201).json({ data: created });
    }),
  );

  router.post(
    '/delegations/:id/revoke',
    validate({ params: idParamsSchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = validated(res, 'params', idParamsSchema);
      res.json({ data: await delegationService.revoke(requireAuth(req), requestMeta(req), id) });
    }),
  );

  return router;
}
