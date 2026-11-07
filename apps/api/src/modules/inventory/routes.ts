// Phase 8 API: /api/v1/inventory/... (docs/phases/PHASE-08.md, archive plan 02). Every route:
// authenticate -> requirePasswordChanged -> resolveContext -> requirePageAction(page, action) -> validate(zod)
// -> handler -> service. Quantities and money cross the wire as decimal strings or numbers; the services use Decimal.
import { Router } from 'express';
import type { Request, RequestHandler, Response } from 'express';
import { z } from 'zod';
import { authenticate, requirePasswordChanged } from '../../core/auth/authenticate';
import { resolveContext } from '../../core/context/resolve-context';
import { asyncHandler } from '../../core/http/async-handler';
import { Errors } from '../../core/http/errors';
import { parseIfMatch } from '../../core/http/if-match';
import { validate, validated } from '../../core/http/validate';
import { requirePageAction } from '../../core/rbac/access';
import type { Action } from '../../core/rbac/permission-model';
import { KINDS, voucherService } from './vouchers/voucher-service';
import type { HeaderInput, KindInfo } from './vouchers/voucher-service';
import { mountStockRoutes } from './routes-stock';
import { mountMastersRoutes } from './routes-masters';
import { mountCountsRoutes } from './routes-counts';
import { mountReportsRoutes } from './routes-reports';
import { mountCustomerMaterialRoutes } from './routes-customer-material';

import { callerOf, idemOf, isoDate, pageQuery, qtyNum, uuid } from './routes-shared';

const lineSchema = z
  .object({
    itemId: uuid,
    warehouseId: uuid.nullish(),
    qty: qtyNum.optional(),
    countedQty: qtyNum.nullish(),
    uom: z.string().max(20).nullish(),
    unitCost: qtyNum.nullish(),
    stockStatus: z.enum(['UNRESTRICTED', 'QUALITY_INSPECTION', 'BLOCKED']).nullish(),
    batchId: uuid.nullish(),
    batchNo: z.string().max(60).nullish(),
    mfgDate: isoDate.nullish(),
    expiryDate: isoDate.nullish(),
    serialNos: z.array(z.string().max(60)).max(5000).nullish(),
    binId: uuid.nullish(),
    reasonCode: z.string().max(30).nullish(),
    remarks: z.string().max(300).nullish(),
    reservationId: uuid.nullish(),
  })
  .strict();

const headerSchema = z
  .object({
    postingDate: isoDate.optional(),
    warehouseId: uuid,
    toWarehouseId: uuid.nullish(),
    txType: z.enum(['Receipt', 'Issue']).nullish(),
    reference: z.string().max(100).nullish(),
    narration: z.string().max(300).nullish(),
    vehicleRef: z.string().max(60).nullish(),
    expectedReceipt: isoDate.nullish(),
    reasonNote: z.string().max(300).nullish(),
    lines: z.array(lineSchema).max(200),
  })
  .strict();

const kindParams = z
  .object({ kind: z.enum(['opening', 'transactions', 'adjustment', 'transfer']) })
  .strict();
const kindIdParams = kindParams.extend({ id: uuid }).strict();

/** Permission check on the page of :kind. */
function kindGuard(action: Action): RequestHandler {
  return asyncHandler(async (req, res, next) => {
    const info = KINDS[String(req.params.kind)];
    if (!info) throw Errors.notFound('Unknown voucher kind.');
    await new Promise<void>((resolve, reject) =>
      requirePageAction(info.pageId, action)(req, res, (e?: unknown) =>
        e instanceof Error ? reject(e) : resolve(),
      ),
    );
    next();
  });
}
const infoOf = (req: Request): KindInfo => {
  const info = KINDS[String(req.params.kind)];
  if (!info) throw Errors.notFound('Unknown voucher kind.');
  return info;
};

const listQuery = z
  .object({
    q: z.string().trim().max(100).optional(),
    status: z.string().max(20).optional(),
    deleted: z
      .enum(['true', 'false'])
      .transform((v) => v === 'true')
      .optional(),
    ...pageQuery,
  })
  .strict();

const actionBody = z
  .object({ cancelDate: isoDate.optional(), reason: z.string().max(300).optional() })
  .strict()
  .default({});

export function createInventoryRouter(): Router {
  const router = Router();
  router.use(['/inventory'], authenticate, requirePasswordChanged, resolveContext);
  const r = Router();
  router.use('/inventory', r);

  // ---- vouchers (header + lines) ------------------------------------------------------------
  r.get(
    '/vouchers/:kind',
    kindGuard('view'),
    validate({ params: kindParams, query: listQuery }),
    asyncHandler(async (req: Request, res: Response) => {
      const q = validated(res, 'query', listQuery);
      const { rows, total } = await voucherService.list(callerOf(req), infoOf(req), q);
      res.json({ data: rows, meta: { page: q.page, size: q.size, total } });
    }),
  );
  r.get(
    '/vouchers/:kind/:id',
    kindGuard('view'),
    validate({ params: kindIdParams }),
    asyncHandler(async (req: Request, res: Response) => {
      const v = await voucherService.get(callerOf(req), infoOf(req), String(req.params.id));
      res.set('ETag', `"${v.version}"`).json({ data: v });
    }),
  );
  r.post(
    '/vouchers/:kind',
    kindGuard('add'),
    validate({ params: kindParams, body: headerSchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const v = await voucherService.create(
        callerOf(req),
        infoOf(req),
        validated(res, 'body', headerSchema) as HeaderInput,
      );
      res.status(201).set('ETag', `"${v.version}"`).json({ data: v });
    }),
  );
  r.put(
    '/vouchers/:kind/:id',
    kindGuard('edit'),
    validate({ params: kindIdParams, body: headerSchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const v = await voucherService.update(
        callerOf(req),
        infoOf(req),
        String(req.params.id),
        parseIfMatch(req.get('if-match')) ?? -1,
        validated(res, 'body', headerSchema) as HeaderInput,
      );
      res.set('ETag', `"${v.version}"`).json({ data: v });
    }),
  );
  r.delete(
    '/vouchers/:kind/:id',
    kindGuard('delete'),
    validate({ params: kindIdParams }),
    asyncHandler(async (req: Request, res: Response) => {
      await voucherService.remove(
        callerOf(req),
        infoOf(req),
        String(req.params.id),
        parseIfMatch(req.get('if-match')),
      );
      res.status(204).end();
    }),
  );
  r.post(
    '/vouchers/:kind/:id/restore',
    kindGuard('delete'),
    validate({ params: kindIdParams }),
    asyncHandler(async (req: Request, res: Response) => {
      res.json({
        data: await voucherService.restore(callerOf(req), infoOf(req), String(req.params.id)),
      });
    }),
  );
  r.post(
    '/vouchers/:kind/:id/submit',
    kindGuard('submit'),
    validate({ params: kindIdParams }),
    asyncHandler(async (req: Request, res: Response) => {
      const v = await voucherService.submit(
        callerOf(req),
        infoOf(req),
        String(req.params.id),
        parseIfMatch(req.get('if-match')),
      );
      res.set('ETag', `"${v.version}"`).json({ data: v });
    }),
  );
  for (const [verb, perm] of [
    ['post', 'post'],
    ['dispatch', 'post'],
    ['receive', 'post'],
    ['cancel', 'edit'],
  ] as const) {
    r.post(
      `/vouchers/:kind/:id/${verb}`,
      kindGuard(perm),
      validate({ params: kindIdParams, body: actionBody }),
      asyncHandler(async (req: Request, res: Response) => {
        const out = await voucherService.action(
          callerOf(req),
          infoOf(req),
          String(req.params.id),
          verb,
          validated(res, 'body', actionBody),
          idemOf(req),
        );
        if (out.replay) res.set('Idempotent-Replay', 'true');
        res.set('ETag', `"${out.record.version}"`).json({ data: out.record });
      }),
    );
  }

  mountStockRoutes(r);
  mountMastersRoutes(r);
  mountCountsRoutes(r);
  mountReportsRoutes(r);
  mountCustomerMaterialRoutes(r);
  return router;
}
