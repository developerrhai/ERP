// The V40 tab views of the Warehouse / WMS, Logistics / Fleet / Gate and Assets pages: GET /fam/v40/:pageId?tab=<V40 tab name>
// (same answer as GET /sales/v40/:pageId) and POST /fam/v40/allocate, the Allocate / Reallocate button of the warehouse stock panel.
import type { Request, Response, Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../core/http/async-handler';
import { validate, validated } from '../../core/http/validate';
import { requirePageAction } from '../../core/rbac/access';
import { prisma } from '../../core/db/prisma';
import { callerOf, uuid } from '../inventory/routes-shared';
import { allocateStock } from '../inventory/v40/allocate';
import { scopeSql } from '../inventory/v40/stats';
import { mountV40 } from '../v40-route';
import type { PageDef } from '../sales/v40-views';
import { ASSETS_V40_PAGES } from './assets';
import { LOGISTICS_V40_PAGES } from './logistics';
import { WMS_V40_PAGES } from './wms';

export const FAM_V40_PAGES: Record<string, PageDef> = {
  ...WMS_V40_PAGES,
  ...LOGISTICS_V40_PAGES,
  ...ASSETS_V40_PAGES,
};

const allocBody = z.object({ warehouseId: uuid }).strict();

export function mountFamV40(router: Router): void {
  mountV40(router, '/fam', FAM_V40_PAGES, requirePageAction, (fn) =>
    asyncHandler(async (req: Request, res: Response) => {
      await fn(req, res);
    }),
  );
  // Allocate / Reallocate of a warehouse row: runs the stock allocator (BR-INV-17) for every item with open demand in the warehouse.
  router.post(
    '/fam/v40/allocate',
    requirePageAction('inv-reservation', 'edit'),
    validate({ body: allocBody }),
    asyncHandler(async (req: Request, res: Response) => {
      const { warehouseId } = validated(res, 'body', allocBody);
      const caller = callerOf(req);
      // unpaginated: the items with open demand in one warehouse of the caller's plant
      const items = await prisma.$queryRaw<{ id: string }[]>`
        SELECT DISTINCT r.item_id::text AS id FROM stock_reservations r JOIN warehouses w ON w.id = r.warehouse_id
        WHERE r.warehouse_id = ${warehouseId}::uuid AND r.status IN ('Waiting','Partial') AND ${scopeSql(caller)}`;
      let allocated = 0;
      let waiting = 0;
      for (const it of items) {
        const r = await allocateStock(caller, it.id, warehouseId);
        allocated += r.allocated;
        waiting += r.waiting;
      }
      res.json({ data: { items: items.length, allocated, waiting } });
    }),
  );
}
