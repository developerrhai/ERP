// /m/:pageId[/:sub] — resolves the page in the registry (unknown → 404), asks the server what the
// user may do there (no view → Access denied), then renders the real screen or a placeholder.
import { useParams } from 'react-router-dom';
import { isAdminRole, lookupPage, type PageLookup } from '../lib/registry';
import { usePagePermissions } from '../lib/usePagePermissions';
import type { User } from '../types';
import { ContextChips } from '../components/ContextChips';
import { ApprovalMatrixPage } from './approvals/ApprovalMatrixPage';
import { NotificationCenterPage } from './notifications/NotificationCenterPage';
import { AuditTrailPage } from './admin/AuditTrailPage';
import { CompanyMasterPage } from './admin/CompanyMasterPage';
import { ControlCenterPage } from './admin/ControlCenterPage';
import { CurrencyMasterPage } from './admin/CurrencyMasterPage';
import { DepartmentMasterPage } from './admin/DepartmentMasterPage';
import { DesignationMasterPage } from './admin/DesignationMasterPage';
import { FinancialYearsPage } from './admin/FinancialYearsPage';
import { LetterheadPage } from './admin/LetterheadPage';
import { PermissionMasterPage } from './admin/PermissionMasterPage';
import { RoleMasterPage } from './admin/RoleMasterPage';
import { SecurityCenterPage } from './admin/SecurityCenterPage';
import { SystemSetupPage } from './admin/SystemSetupPage';
import { UnitMasterPage } from './admin/UnitMasterPage';
import { UomMasterPage } from './admin/UomMasterPage';
import { GenericModulePage } from './generic/GenericModulePage';
import { NotFoundPage } from './NotFoundPage';
import { UserMasterPage } from './users/UserMasterPage';

const SUB_PAGES: Record<string, readonly string[]> = {
  'admin-settings': ['controls', 'letterhead'],
};

export function AccessDenied({ message }: { message?: string }) {
  return (
    <NotFoundPage
      title="Access denied"
      message={message ?? 'Your account does not have access to this page.'}
    />
  );
}

export function ModulePage({ user }: { user: User }) {
  const { pageId = '', sub } = useParams();
  const page = lookupPage(pageId);
  if (!page) return <NotFoundPage />;
  if (sub !== undefined && !SUB_PAGES[pageId]?.includes(sub)) return <NotFoundPage />;
  return <GuardedPage key={`${pageId}/${sub ?? ''}`} user={user} page={page} sub={sub} />;
}

function GuardedPage({ user, page, sub }: { user: User; page: PageLookup; sub?: string }) {
  const pageId = page.item.id;
  const perms = usePagePermissions(pageId);

  if (perms.loading) {
    return (
      <p className="v8-sub" role="status">
        Checking access…
      </p>
    );
  }
  if (perms.error) {
    return <NotFoundPage title="Could not open this page" message={perms.error} />;
  }
  if (!perms.actions.view) return <AccessDenied />;

  const actions = perms.actions;
  switch (pageId) {
    case 'admin-users':
      if (!isAdminRole(user.role)) {
        return (
          <AccessDenied message="User Master is available to Super Admin and Admin accounts only." />
        );
      }
      return <UserMasterPage currentUser={user} actions={actions} />;
    case 'admin-departments':
      return <DepartmentMasterPage actions={actions} />;
    case 'admin-roles':
      return <RoleMasterPage />;
    case 'admin-permissions':
      return <PermissionMasterPage actions={actions} />;
    case 'admin-settings':
      if (sub === 'controls') return <ControlCenterPage actions={actions} />;
      if (sub === 'letterhead') return <LetterheadPage actions={actions} />;
      return <SystemSetupPage />;
    case 'admin-approval':
      return <ApprovalMatrixPage actions={actions} />;
    case 'notifications':
      return <NotificationCenterPage />;
    case 'admin-audit':
      return <AuditTrailPage />;
    case 'admin-company':
      return <CompanyMasterPage actions={actions} />;
    case 'admin-branches':
      return <UnitMasterPage actions={actions} />;
    case 'admin-fy':
      return <FinancialYearsPage actions={actions} />;
    case 'admin-security':
      return <SecurityCenterPage actions={actions} />;
    case 'admin-designations':
      return <DesignationMasterPage actions={actions} />;
    case 'admin-currency':
      return <CurrencyMasterPage actions={actions} />;
    case 'admin-uom':
      return <UomMasterPage actions={actions} />;
    default:
      return (
        <GenericModulePage
          pageId={pageId}
          user={user}
          perms={actions}
          fallback={
            <>
              <div className="page-head">
                <div>
                  <h1>{page.item.title}</h1>
                  <p>{page.purpose ?? page.family.name}</p>
                </div>
              </div>
              <ContextChips user={user} />
              <div className="notice" role="note">
                This module will be enabled in a later phase.
              </div>
            </>
          }
        />
      );
  }
}
