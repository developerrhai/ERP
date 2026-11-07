// /inventory/customer-material: customer-supplied material (shown as the "Customer Material" tab of Inventory
// Transactions, so it uses that page's permissions: view = see, add = receive / issue / return, edit = cancel).
import type { Request, Response, Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../core/http/async-handler';
import { parseIfMatch } from '../../core/http/if-match';
import { validate, validated } from '../../core/http/validate';
import { requirePageAction } from '../../core/rbac/access';
import { customerMaterialService } from './customer-material-service';
import { callerOf, isoDate, pageQuery, qtyNum, uuid } from './routes-shared';

const PAGE = 'inv-transactions';
const idParams = z.object({ id: uuid }).strict();
const opt = (n: number) => z.string().trim().max(n).nullish();

const header = {
  customerId: uuid,
  warehouseId: uuid,
  docDate: isoDate,
  challanNo: opt(60),
  challanDate: isoDate.nullish(),
  vehicleNo: opt(30),
  reference: opt(120),
  remarks: opt(300),
};
const receiptBody = z
  .object({
    ...header,
    lines: z
      .array(
        z
          .object({
            itemId: uuid,
            qty: qtyNum,
            batchNo: opt(60),
            mfgDate: isoDate.nullish(),
            expiryDate: isoDate.nullish(),
            remarks: opt(200),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();
const pickBody = z
  .object({
    ...header,
    lines: z
      .array(z.object({ lotId: uuid, qty: qtyNum, remarks: opt(200) }).strict())
      .min(1)
      .max(100),
  })
  .strict();

export function mountCustomerMaterialRoutes(r: Router): void {
  const lq = z
    .object({
      q: z.string().trim().max(100).optional(),
      customerId: uuid.optional(),
      itemId: uuid.optional(),
      warehouseId: uuid.optional(),
      withBalanceOnly: z
        .enum(['true', 'false'])
        .transform((v) => v === 'true')
        .optional(),
      ...pageQuery,
    })
    .strict();
  r.get(
    '/customer-material/lots',
    requirePageAction(PAGE, 'view'),
    validate({ query: lq }),
    asyncHandler(async (req: Request, res: Response) => {
      const q = validated(res, 'query', lq);
      const { rows, total } = await customerMaterialService.lots(callerOf(req), q);
      res.json({ data: rows, meta: { page: q.page, size: q.size, total } });
    }),
  );
  r.get(
    '/customer-material/customers',
    requirePageAction(PAGE, 'view'),
    asyncHandler(async (_req: Request, res: Response) => {
      res.json({ data: await customerMaterialService.customers() });
    }),
  );
  r.get(
    '/customer-material/balances',
    requirePageAction(PAGE, 'view'),
    asyncHandler(async (req: Request, res: Response) => {
      res.json({ data: await customerMaterialService.balances(callerOf(req)) });
    }),
  );
  r.get(
    '/customer-material/lots/:id/history',
    requirePageAction(PAGE, 'view'),
    validate({ params: idParams }),
    asyncHandler(async (req: Request, res: Response) => {
      res.json({
        data: await customerMaterialService.history(callerOf(req), String(req.params.id)),
      });
    }),
  );
  const dq = z
    .object({
      q: z.string().trim().max(100).optional(),
      type: z.enum(['RECEIPT', 'ISSUE', 'RETURN']).optional(),
      customerId: uuid.optional(),
      status: z.enum(['Posted', 'Cancelled']).optional(),
      ...pageQuery,
    })
    .strict();
  r.get(
    '/customer-material/docs',
    requirePageAction(PAGE, 'view'),
    validate({ query: dq }),
    asyncHandler(async (req: Request, res: Response) => {
      const q = validated(res, 'query', dq);
      const { rows, total } = await customerMaterialService.docs(callerOf(req), q);
      res.json({ data: rows, meta: { page: q.page, size: q.size, total } });
    }),
  );
  r.get(
    '/customer-material/docs/:id',
    requirePageAction(PAGE, 'view'),
    validate({ params: idParams }),
    asyncHandler(async (req: Request, res: Response) => {
      const d = await customerMaterialService.get(callerOf(req), String(req.params.id));
      res.set('ETag', `"${d.version}"`).json({ data: d });
    }),
  );
  r.post(
    '/customer-material/receipts',
    requirePageAction(PAGE, 'add'),
    validate({ body: receiptBody }),
    asyncHandler(async (req: Request, res: Response) => {
      const { lines, ...h } = validated(res, 'body', receiptBody);
      const d = await customerMaterialService.receipt(callerOf(req), h, lines);
      res.status(201).set('ETag', `"${d.version}"`).json({ data: d });
    }),
  );
  for (const [path, type] of [
    ['issues', 'ISSUE'],
    ['returns', 'RETURN'],
  ] as const) {
    r.post(
      `/customer-material/${path}`,
      requirePageAction(PAGE, 'add'),
      validate({ body: pickBody }),
      asyncHandler(async (req: Request, res: Response) => {
        const { lines, ...h } = validated(res, 'body', pickBody);
        const d = await customerMaterialService.take(callerOf(req), type, h, lines);
        res.status(201).set('ETag', `"${d.version}"`).json({ data: d });
      }),
    );
  }
  const cancelBody = z
    .object({ reason: z.string().trim().min(1).max(300), date: isoDate })
    .strict();
  r.post(
    '/customer-material/docs/:id/cancel',
    requirePageAction(PAGE, 'edit'),
    validate({ params: idParams, body: cancelBody }),
    asyncHandler(async (req: Request, res: Response) => {
      const b = validated(res, 'body', cancelBody);
      const d = await customerMaterialService.cancel(
        callerOf(req),
        String(req.params.id),
        parseIfMatch(req.get('if-match')) ?? -1,
        b.reason,
        b.date,
      );
      res.set('ETag', `"${d.version}"`).json({ data: d });
    }),
  );
}
