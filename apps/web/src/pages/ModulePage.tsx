// /m/:pageId[/:sub] — resolves the page in the registry (unknown → 404), asks the server what the
// user may do there (no view → Access denied), then renders the real screen or a placeholder.
import { useParams } from 'react-router-dom';
import { isAdminRole, lookupPage, type PageLookup } from '../lib/registry';
import { usePagePermissions } from '../lib/usePagePermissions';
import type { ActionSet, User } from '../types';
import { ContextChips } from '../components/ContextChips';
import { ApprovalMatrixPage } from './approvals/ApprovalMatrixPage';
import { PartyMasterPage } from './masters/PartyMasterPage';
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
import { ApprovalLimitsPage } from './finance/ApprovalLimitsPage';
import { BankRecoPage } from './finance/BankRecoPage';
import { CashFlowPage } from './finance/CashFlowPage';
import { ExpensesPage } from './finance/ExpensesPage';
import { NotesPage } from './finance/NotesPage';
import { PeriodClosePage } from './finance/PeriodClosePage';
import { TaxRegisterPage, TdsPage } from './finance/TaxPages';
import { BudgetPage } from './finance/BudgetPage';
import { CashBankPage } from './finance/CashBankPage';
import { ChartOfAccountsPage } from './finance/ChartOfAccountsPage';
import { DimensionsPage } from './finance/DimensionsPage';
import { JournalsPage } from './finance/JournalsPage';
import {
  AgeingPage,
  BalanceSheetPage,
  GeneralLedgerPage,
  ProfitLossPage,
  TrialBalancePage,
} from './finance/ReportsPages';
import { ExpiryPage, ScanPage, StockAgeingPage, ValuationPage } from './inventory/ReportsPages';
import { BatchesPage, BinsPage, SerialsPage } from './inventory/MastersPages';
import { CountsPage, CycleCountsPage, ReorderPage, ReservationsPage } from './inventory/StockPages';
import { VouchersPage } from './inventory/VouchersPage';
import { GenericModulePage } from './generic/GenericModulePage';
import { NotFoundPage } from './NotFoundPage';
import { UserMasterPage } from './users/UserMasterPage';
import { AdminFormatsPage } from './settings/AdminFormatsPage';
import { SettingsLauncher } from './settings/SettingsLauncher';

const SUB_PAGES: Record<string, readonly string[]> = {
  'admin-settings': ['controls', 'letterhead', 'finance-limits'],
  'admin-fy': ['close'],
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

  return (
    <>
      {pageId === 'admin-formats' ? null : (
        <SettingsLauncher pageId={pageId} title={page.item.title} />
      )}
      <PageBody user={user} page={page} sub={sub} actions={perms.actions} />
    </>
  );
}

function PageBody({
  user,
  page,
  sub,
  actions,
}: {
  user: User;
  page: PageLookup;
  sub?: string | undefined;
  actions: ActionSet;
}) {
  const pageId = page.item.id;
  switch (pageId) {
    case 'admin-formats':
      return <AdminFormatsPage />;
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
      if (sub === 'finance-limits') return <ApprovalLimitsPage actions={actions} />;
      return <SystemSetupPage />;
    case 'crm-customer360':
      return <PartyMasterPage kind="CUSTOMER" actions={actions} />;
    case 'scm-suppliers':
      return <PartyMasterPage kind="SUPPLIER" actions={actions} />;
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
      if (sub === 'close') return <PeriodClosePage actions={actions} />;
      return <FinancialYearsPage actions={actions} />;
    case 'admin-security':
      return <SecurityCenterPage actions={actions} />;
    case 'admin-designations':
      return <DesignationMasterPage actions={actions} />;
    case 'admin-currency':
      return <CurrencyMasterPage actions={actions} />;
    case 'admin-uom':
      return <UomMasterPage actions={actions} />;
    // Phase 7 finance screens
    case 'fin-coa':
      return <ChartOfAccountsPage actions={actions} />;
    case 'fin-journal':
      return <JournalsPage actions={actions} />;
    case 'fin-costcenter':
      return <DimensionsPage kind="cost" actions={actions} />;
    case 'fin-profitcenter':
      return <DimensionsPage kind="profit" actions={actions} />;
    case 'fin-cashbook':
      return <CashBankPage cash actions={actions} />;
    case 'fin-bankbook':
      return <CashBankPage cash={false} actions={actions} />;
    case 'fin-bankreco':
      return <BankRecoPage actions={actions} />;
    case 'fin-budget':
      return <BudgetPage actions={actions} />;
    case 'fin-creditnote':
      return <NotesPage kind="CREDIT" actions={actions} />;
    case 'fin-debitnote':
      return <NotesPage kind="DEBIT" actions={actions} />;
    case 'fin-expenses':
      return <ExpensesPage actions={actions} />;
    case 'fin-cashflow':
      return <CashFlowPage />;
    case 'tax-salesreg':
      return <TaxRegisterPage kind="sales" />;
    case 'tax-purchasereg':
      return <TaxRegisterPage kind="purchase" />;
    case 'tax-tds':
      return <TdsPage kind="tds" actions={actions} />;
    case 'tax-tcs':
      return <TdsPage kind="tcs" actions={actions} />;
    case 'fin-trial':
      return <TrialBalancePage />;
    case 'fin-pnl':
      return <ProfitLossPage />;
    case 'fin-bs':
      return <BalanceSheetPage />;
    case 'fin-gl':
      return <GeneralLedgerPage />;
    case 'fin-ar':
    case 'fin-ageing':
      return <AgeingPage side="RECEIVABLE" />;
    case 'fin-ap':
      return <AgeingPage side="PAYABLE" />;
    // Phase 8 inventory screens
    case 'inv-opening':
      return <VouchersPage kind="opening" actions={actions} />;
    case 'inv-transactions':
      return <VouchersPage kind="transactions" actions={actions} />;
    case 'inv-adjustment':
      return <VouchersPage kind="adjustment" actions={actions} />;
    case 'inv-transfer':
      return <VouchersPage kind="transfer" actions={actions} />;
    case 'inv-batch':
      return <BatchesPage actions={actions} />;
    case 'inv-serial':
      return <SerialsPage />;
    case 'wms-bins':
      return <BinsPage actions={actions} />;
    case 'inv-reservation':
      return <ReservationsPage actions={actions} />;
    case 'inv-reconciliation':
      return <CountsPage actions={actions} />;
    case 'wms-cycle':
      return <CycleCountsPage actions={actions} />;
    case 'wms-physical':
      return <CountsPage type="PHYSICAL" actions={actions} />;
    case 'inv-reorder':
      return <ReorderPage actions={actions} />;
    case 'inv-ageing':
      return <StockAgeingPage />;
    case 'inv-expiry':
      return <ExpiryPage />;
    case 'inv-valuation':
      return <ValuationPage actions={actions} />;
    case 'wms-barcode':
      return <ScanPage />;
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
