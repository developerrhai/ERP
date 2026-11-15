// Product Master (master-products) and Raw Material Master (master-materials): the item master read through the V40 tab layouts
// of those two ERP Process Control pages. The items themselves are created and edited on Item / SKU Master (Open on a row goes there).
import type { ActionSet } from '../../../types';
import { INV_HEADS } from './heads';
import { InvTabView } from './InvTabView';
import { useInvTab } from './useInvTab';

const FIRST_TAB: Record<string, string> = {
  'master-products': 'Product Register',
  'master-materials': 'Material Register',
};

export function MasterItemsPage({ pageId, actions }: { pageId: 'master-products' | 'master-materials'; actions: ActionSet }) {
  const tab = useInvTab(pageId, actions, INV_HEADS[pageId]);
  // outside the V40 tab strip (a bare render) the page opens on its first tab
  return tab ?? <InvTabView pageId={pageId} tab={FIRST_TAB[pageId] ?? ''} perms={actions} />;
}
