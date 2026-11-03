// The registry of typed Inventory pages: pageId -> handler. The records controller asks this first
// and falls back to the generic engine. Inventory Transactions lists the stock ledger by default and
// the Receipt / Issue vouchers with ?view=vouchers.
import { itemHandler } from './items/service';
import { ledgerList, stockHandler } from './stock/service';
import type { TypedHandler } from './typed';
import {
  adjustmentHandler,
  openingHandler,
  transactionHandler,
  transferHandler,
} from './vouchers/service';
import { warehouseHandler } from './warehouses/service';

const transactions: TypedHandler = {
  ...transactionHandler,
  list(caller, query) {
    return query.view === 'vouchers'
      ? transactionHandler.list(caller, query)
      : ledgerList(caller, query);
  },
  exportRows(caller, query) {
    return this.list(caller, { ...query, page: 1, size: 10_000 });
  },
};

const HANDLERS: Readonly<Record<string, TypedHandler>> = {
  'inv-items': itemHandler,
  'wms-warehouses': warehouseHandler,
  'inv-opening': openingHandler,
  'inv-transactions': transactions,
  'inv-adjustment': adjustmentHandler,
  'inv-transfer': transferHandler,
  'inv-stock': stockHandler,
};

import { kitHandlerFor } from '../../kit/registry';

export function typedHandlerFor(pageId: string): TypedHandler | undefined {
  return HANDLERS[pageId] ?? kitHandlerFor(pageId) ?? undefined;
}
