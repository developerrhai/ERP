// The new Quality / QMS pages (docs2/ERP_Quality_QMS_Visual_Specification): one component per menu item.
import type { ActionSet } from '../../../types';
import { CopqPage } from './CopqPage';
import { QualityDashboard } from './DashboardPage';
import { NcrDesk } from './NcrDesk';
import { RevokeDesk } from './RevokeDesk';
import { TemplatesDesk } from './TemplatesDesk';

export const QMS_V2_PAGES: ReadonlySet<string> = new Set([
  'qms-customer-ncr',
  'qms-conformance-ncr',
  'qms-templates',
  'qms-rejection-revoke',
  'qms-copq',
  'qms-dashboard',
]);

export function QmsV2Page({ pageId, title, sub, actions }: { pageId: string; title: string; sub: string; actions: ActionSet }) {
  const p = { actions, title, sub };
  switch (pageId) {
    case 'qms-customer-ncr':
      return <NcrDesk key={pageId} type="CUSTOMER" {...p} />;
    case 'qms-conformance-ncr':
      return <NcrDesk key={pageId} type="CONFORMANCE" {...p} />;
    case 'qms-templates':
      return <TemplatesDesk {...p} />;
    case 'qms-rejection-revoke':
      return <RevokeDesk {...p} />;
    case 'qms-copq':
      return <CopqPage {...p} />;
    default:
      return <QualityDashboard actions={actions} />;
  }
}
