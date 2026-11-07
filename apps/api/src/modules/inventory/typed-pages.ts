// The registry of typed Inventory pages: pageId -> handler. The records controller asks this first
// and falls back to the generic engine. Inventory Transactions lists the stock ledger by default and
// the Receipt / Issue vouchers with ?view=vouchers.
import { itemHandler } from './items/service';
import { ledgerList, stockHandler } from './stock/service';
import type { TypedHandler } from './typed';
import { voucherTypedHandler } from './vouchers/typed-adapter';
import { warehouseHandler } from './warehouses/service';

const transactionHandler = voucherTypedHandler('inv-transactions');
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
  'inv-opening': voucherTypedHandler('inv-opening'),
  'inv-transactions': transactions,
  'inv-adjustment': voucherTypedHandler('inv-adjustment'),
  'inv-transfer': voucherTypedHandler('inv-transfer'),
  'inv-stock': stockHandler,
};

import { kitHandlerFor } from '../../kit/registry';

export function typedHandlerFor(pageId: string): TypedHandler | undefined {
  return HANDLERS[pageId] ?? kitHandlerFor(pageId) ?? undefined;
}
