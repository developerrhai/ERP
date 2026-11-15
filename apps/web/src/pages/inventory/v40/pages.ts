// Which Inventory pages draw their V40 tabs with InvTabView, and which tabs of them.
// No imports from the frame here: V40TabFrame reads CLAIMED_PAGES to know that these pages show their own panels.

/** Pages built as their own screens (not the generic register): every V40 tab after the first is an InvTabView. */
export const INV_CUSTOM_PAGES: ReadonlySet<string> = new Set([
  'inv-opening',
  'inv-transactions',
  'inv-adjustment',
  'inv-transfer',
  'inv-reservation',
  'inv-reconciliation',
  'inv-ageing',
  'inv-valuation',
  'inv-reorder',
  'inv-batch',
  'inv-serial',
  'inv-expiry',
]);

/** Product Master / Raw Material Master: every V40 tab, the first one too, is an InvTabView over the item master. */
export const INV_MASTER_PAGES: ReadonlySet<string> = new Set(['master-products', 'master-materials']);

/** Typed pages served by GenericModulePage. */
export const INV_TYPED_PAGES: ReadonlySet<string> = new Set(['inv-items', 'inv-stock']);

export const CLAIMED_PAGES: ReadonlySet<string> = new Set([...INV_CUSTOM_PAGES, ...INV_TYPED_PAGES, ...INV_MASTER_PAGES]);

const STANDARD_OWN = /^(documents|approvals?|calendar & schedule)$/i;

/** Whether InvTabView draws this V40 tab (index = position in the V40 strip). */
export function ownsTab(pageId: string, tabName: string, index: number): boolean {
  const name = tabName.trim();
  if (INV_MASTER_PAGES.has(pageId)) return true;
  if (INV_CUSTOM_PAGES.has(pageId)) return index > 0;
  if (pageId === 'inv-stock') return index === 4 || index === 5 || STANDARD_OWN.test(name);
  if (pageId === 'inv-items') return STANDARD_OWN.test(name);
  return false;
}
