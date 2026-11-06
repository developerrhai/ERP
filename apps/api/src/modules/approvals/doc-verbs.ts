// POST /pages/:p/records/:id/approve | reject | return | withdraw (docs/phases/PHASE-05.md §6, E-11):
// the same engine as /approvals/requests/:id/..., addressed by the document. If-Match is the version
// of the pending request (shown by GET /approvals/doc/:docType/:docId); Idempotency-Key is honoured.
import type { Request, Response } from 'express';
import { requestMeta, requireAuth } from '../../core/auth/auth-context';
import { prisma } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { parseIfMatch } from '../../core/http/if-match';
import { validated } from '../../core/http/validate';
import { recordParamsSchema } from '../records/schemas';
import { decisionBodySchema } from './schemas';
import { runIdempotent } from './idempotent';
import { approvalService } from './service';

export type DocVerb = 'approve' | 'reject' | 'return' | 'withdraw';

export function docVerbHandler(verb: DocVerb) {
  return async (req: Request, res: Response): Promise<void> => {
    const { pageId, id } = validated(res, 'params', recordParamsSchema);
    const version = parseIfMatch(req.get('if-match'));
    const body =
      verb === 'withdraw' ? { comment: undefined } : validated(res, 'body', decisionBodySchema);
    const pending = await prisma.approvalRequest.findFirst({
      where: { docType: pageId, docId: id, status: 'PENDING' },
      select: { id: true },
    });
    if (!pending) throw Errors.conflict('This document is not waiting for approval.');
    const caller = { auth: requireAuth(req), meta: requestMeta(req) };
    await runIdempotent(
      req,
      res,
      caller.auth.userId,
      `records:${verb}:${pageId}:${id}`,
      [verb, pageId, id, version, body.comment ?? ''],
      (idemKey) =>
        verb === 'withdraw'
          ? approvalService.withdraw(caller, pending.id, { version, idemKey })
          : approvalService.decide(caller, pending.id, verb.toUpperCase() as 'APPROVE', {
              comment: body.comment,
              version,
              idemKey,
            }),
    );
  };
}
