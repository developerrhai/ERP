// Page head (title + one line) of the Inventory pages while a V40 tab drawn by InvTabView is open.
export const INV_HEADS: Readonly<Record<string, { title: string; sub: string }>> = {
  'master-products': { title: 'Product Master', sub: 'Finished product, tax, price and planning master connected to BOM and production.' },
  'master-materials': { title: 'Raw Material Master', sub: 'Raw material planning and vendor source used by BOM, MRP, purchase and inventory.' },
  'inv-opening': { title: 'Opening Stock', sub: 'Opening balance of an item in a warehouse, allowed before any other movement.' },
  'inv-transactions': { title: 'Inventory Transactions', sub: 'Every stock movement, newest first. Nothing here can be edited: a mistake is corrected by cancelling its voucher.' },
  'inv-adjustment': { title: 'Stock Adjustment', sub: 'Correct the stock of an item in a warehouse to the counted quantity.' },
  'inv-transfer': { title: 'Stock Transfer', sub: 'Move stock between warehouses in two steps: dispatch and receive.' },
  'inv-reservation': { title: 'Stock Reservation', sub: 'Earmark stock for an order, or put a quantity on hold. Reserved and held stock cannot be issued to anyone else.' },
  'inv-reconciliation': { title: 'Stock Reconciliation', sub: 'System stock against the physical count, with the variance and its value.' },
  'inv-ageing': { title: 'Stock Ageing', sub: 'How long the stock you hold has been lying in the store, and which items are slow or dead.' },
  'inv-valuation': { title: 'Stock Valuation', sub: 'Opening, receipts, issues and closing value of the stock, checked against the books.' },
  'inv-reorder': { title: 'Smart Reorder', sub: 'Tells you what to buy and how much, from the minimum, the maximum or the usage of each item.' },
  'inv-batch': { title: 'Batch / Lot Tracking', sub: 'Every batch with its dates, quality status and stock. Batches are created when stock is received.' },
  'inv-serial': { title: 'Serial Number Tracking', sub: 'Where every serial-numbered unit is, and everything that happened to it.' },
  'inv-expiry': { title: 'Expiry Tracking', sub: 'Batches that have expired or will soon. Expired stock cannot be issued.' },
};
