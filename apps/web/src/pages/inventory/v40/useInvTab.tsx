// The hook an Inventory page calls to let InvTabView draw the open V40 tab: it returns the tab body when this page owns the tab
// (see pages.ts) and null otherwise (the page then draws itself as before). Outside the V40 tab strip it always returns null.
import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { ApprovalsPanel, AuditPanel, tabKind, useFrame } from '../../frame/V40TabFrame';
import { PageHead } from '../shared';
import type { ActionSet } from '../../../types';
import { CLAIMED_PAGES, ownsTab } from './pages';
import { InvTabView } from './InvTabView';

export function useInvTab(
  pageId: string,
  perms?: Pick<ActionSet, 'edit'>,
  head?: { title: string; sub: string },
): ReactNode | null {
  const frame = useFrame();
  const claimed = !!frame && CLAIMED_PAGES.has(pageId);
  useEffect(() => {
    if (claimed) frame?.claim();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- claim once per page mount
  }, [claimed]);
  if (!frame || !ownsTab(pageId, frame.tabName, frame.index)) return null;
  const kind = tabKind(frame.tabName, frame.index);
  const view = (
    <InvTabView
      pageId={pageId}
      tab={frame.tabName}
      perms={perms}
      extra={
        kind === 'audit' ? (
          <>
            <h3 className="inv-v40-sub">Audit entries</h3>
            <AuditPanel pageId={pageId} />
          </>
        ) : kind === 'approvals' ? (
          <>
            <h3 className="inv-v40-sub">Approval requests</h3>
            <ApprovalsPanel pageId={pageId} />
          </>
        ) : null
      }
    />
  );
  return head ? (
    <>
      <PageHead title={head.title} sub={head.sub} />
      {view}
    </>
  ) : (
    view
  );
}
