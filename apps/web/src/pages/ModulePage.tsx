// /m/:pageId[/:sub] — resolves the page in the registry (unknown → 404), asks the server what the
// user may do there (no view → Access denied), then renders the real screen or a placeholder.
import {
  EinvoicePage,
  EwayPage,
  Gstr1Page,
  Gstr3bPage,
  RegisterExport,
  TdsReturnsSection,
} from './tax/GstPages';
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
import { HardeningPage } from './admin/HardeningPage';
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
import { DocPage } from './procurement/DocPage';
import { CON_CFG, PO_CFG, PR_CFG, RFQ_CFG, VQ_CFG } from './procurement/configs';
import { FB_CFG, FU_CFG, LEAD_CFG, MTG_CFG, OPP_CFG, SO_CFG } from './procurement/salesConfigs';
import {
  CollectionsPage,
  CreditPage,
  DeliveryPlanPage,
  DispatchPage,
  PipelinePage,
  SalesInvoicesPage,
  SalesQuotationsPage,
  SalesReturnsPage,
  SourcesPage,
} from './procurement/SalesPages';
import {
  ApPage,
  ComparisonPage,
  EvaluationPage,
  GrnPage,
  InvoicePage,
  PutawayPage,
} from './procurement/SpecialPages';
import { GenericModulePage } from './generic/GenericModulePage';
import { NotFoundPage } from './NotFoundPage';
import { BomPage, RoutingPage, WorkCentresPage } from './mfg/MasterPages';
import { FgPage, OrdersPage, WorkOrdersPage } from './mfg/OrderPages';
import { MrpPage, ProductionPlansPage } from './mfg/PlanPages';
import { CostingPage, ReworkPage, ScrapPage, WipPage } from './mfg/RegisterPages';
import { ShopFloorPage } from './mfg/ShopFloor';
import { AssetMasterPage, EquipmentPage, MachinesPage, QrPage } from './assets/AssetPages';
import {
  AllocationPage,
  CapitalisationPage,
  DepreciationPage,
  DisposalPage,
  TransferPage,
} from './assets/DocPages';
import {
  AlertsPage as MaintAlertsPage,
  BreakdownPage,
  DowntimePage,
  MtbfPage,
  PreventivePage,
  SchedulePage,
  SparesPage,
  WorkOrdersPage as MaintWorkOrdersPage,
} from './assets/MaintPages';
import { CapaPage } from './qms/FormPages';
import { InspectionPage } from './qms/InspectionPages';
import { NcrPage } from './qms/RegisterPages';
import { CalibrationPage, PlansPage } from './qms/SetupPages';
import { UserMasterPage } from './users/UserMasterPage';
import { AdminFormatsPage } from './settings/AdminFormatsPage';
import { SettingsLauncher } from './settings/SettingsLauncher';
import { HrEmployeesPage } from './hr/HrEmployeesPage';
import { HrAttendancePage } from './hr/HrAttendancePage';
import { HrLeavePage } from './hr/HrLeavePage';
import { HrExpensePage } from './hr/HrExpensePage';
import { HrEssPage } from './hr/HrEssPage';
import { PayProcessingPage } from './payroll/PayProcessingPage';
import { PayStructurePage } from './payroll/PayStructurePage';
import { StatutoryRatesPage } from './payroll/StatutoryRatesPage';
import { PayPayslipPage } from './payroll/PayPayslipPage';
import { PayBankPage } from './payroll/PayBankPage';
import { ProjectsListPage } from './projects/ProjectsListPage';
import { ProjectGanttPage } from './projects/ProjectGanttPage';
import { ProjectKanbanPage } from './projects/ProjectKanbanPage';
import { TimesheetsPage } from './projects/TimesheetsPage';
import { ProjectProfitabilityPage } from './projects/ProjectProfitabilityPage';
import { ServiceDeskPage } from './service/ServiceDeskPage';
import { TechnicianBoardPage } from './service/TechnicianBoardPage';
import { MobileVisitsPage } from './service/MobileVisitsPage';
import { AmcPage } from './service/AmcPage';
import { WarrantyClaimsPage } from './service/WarrantyClaimsPage';
import { LogisticsPage } from './logistics/LogisticsPage';
import { FleetPage } from './logistics/FleetPage';
import { GateKioskPage } from './logistics/GateKioskPage';
import { DmsPage } from './logistics/DmsPage';
import { BiBuilderPage } from './bi/BiBuilderPage';
import { AiCopilotPage } from './bi/AiCopilotPage';
import { AutomationStudioPage } from './bi/AutomationStudioPage';
import { CommCenterPage } from './bi/CommCenterPage';
import { AdminNotifConsolePage } from './admin/AdminNotifConsolePage';
import { NotificationPrefsPage } from './notifications/NotificationPrefsPage';

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
      return (
        <>
          <TaxRegisterPage kind="sales" />
          <RegisterExport kind="sales" />
        </>
      );
    case 'tax-purchasereg':
      return (
        <>
          <TaxRegisterPage kind="purchase" />
          <RegisterExport kind="purchase" />
        </>
      );
    case 'tax-tds':
      return (
        <>
          <TdsPage kind="tds" actions={actions} />
          <RegisterExport kind="tds" />
          <TdsReturnsSection kind="tds" actions={actions} />
        </>
      );
    case 'tax-tcs':
      return (
        <>
          <TdsPage kind="tcs" actions={actions} />
          <RegisterExport kind="tcs" />
          <TdsReturnsSection kind="tcs" actions={actions} />
        </>
      );
    case 'tax-gstr1':
      return <Gstr1Page actions={actions} />;
    case 'tax-gstr3b':
      return <Gstr3bPage actions={actions} />;
    case 'tax-einvoice':
      return <EinvoicePage actions={actions} />;
    case 'tax-eway':
      return <EwayPage actions={actions} />;
    // Phase 12 quality screens
    case 'qms-plans':
      return <PlansPage actions={actions} />;
    case 'qms-incoming':
      return (
        <InspectionPage
          kinds={['INCOMING']}
          title="Incoming Quality"
          sub="Raw-material inspection sheets. A goods receipt of an item that needs inspection creates the lot; the usage decision releases or blocks the stock."
          actions={actions}
        />
      );
    case 'qms-process':
      return (
        <InspectionPage
          kinds={['IN_PROCESS']}
          title="In-Process Quality"
          sub="In-process inspection by machine and operation, with readings for parts 1 to 5."
          actions={actions}
        />
      );
    case 'qms-final':
      return (
        <InspectionPage
          kinds={['PRE_DISPATCH', 'WELDING', 'VT']}
          title="Final Quality"
          sub="Pre-dispatch inspection, welding inspection (before and after) and visual test reports."
          actions={actions}
        />
      );
    case 'qms-supplier':
      return (
        <InspectionPage
          kinds={['ISIR']}
          title="Supplier Quality (ISIR)"
          sub="Initial sample inspection reports of supplier parts: dimensions against tolerance, per sample."
          actions={actions}
        />
      );
    case 'qms-inspections':
      return (
        <InspectionPage
          kinds={[]}
          title="Quality Inspections"
          sub="Every inspection sheet of the unit in one list. Open a sheet to see its readings and decision."
          actions={actions}
          allowNew={false}
        />
      );
    case 'qms-ncr':
      return <NcrPage actions={actions} />;
    case 'qms-capa':
      return <CapaPage actions={actions} />;
    case 'qms-calibration':
      return <CalibrationPage actions={actions} />;
    // Phase 13 manufacturing screens
    case 'mfg-workcenters':
      return <WorkCentresPage actions={actions} />;
    case 'mfg-bom':
      return <BomPage actions={actions} />;
    case 'mfg-routing':
      return <RoutingPage actions={actions} />;
    case 'mfg-plan':
      return <ProductionPlansPage actions={actions} />;
    case 'mfg-orders':
      return <OrdersPage actions={actions} />;
    case 'mfg-mrp':
      return <MrpPage actions={actions} />;
    case 'mfg-workorders':
      return <WorkOrdersPage actions={actions} />;
    case 'mfg-shopfloor':
      return <ShopFloorPage actions={actions} />;
    case 'mfg-wip':
      return <WipPage actions={actions} />;
    case 'mfg-fg':
      return <FgPage actions={actions} />;
    case 'mfg-scrap':
      return <ScrapPage actions={actions} />;
    case 'mfg-rework':
      return <ReworkPage actions={actions} />;
    case 'mfg-costing':
      return <CostingPage actions={actions} />;
    // Phase 14 maintenance and assets
    case 'maint-machines':
      return <MachinesPage actions={actions} />;
    case 'maint-equipment':
      return <EquipmentPage actions={actions} />;
    case 'maint-preventive':
      return <PreventivePage actions={actions} />;
    case 'maint-schedule':
      return <SchedulePage actions={actions} />;
    case 'maint-breakdown':
      return <BreakdownPage actions={actions} />;
    case 'maint-workorders':
      return (
        <MaintWorkOrdersPage
          actions={actions}
          page="maint-workorders"
          base="/maint/work-orders"
          title="Maintenance Work Orders"
        />
      );
    case 'maint-spares':
      return <SparesPage />;
    case 'maint-downtime':
      return <DowntimePage actions={actions} />;
    case 'maint-mtbf':
      return <MtbfPage />;
    case 'maint-alerts':
      return <MaintAlertsPage actions={actions} />;
    case 'asset-master':
      return <AssetMasterPage actions={actions} />;
    case 'asset-capitalization':
      return <CapitalisationPage actions={actions} />;
    case 'asset-allocation':
      return <AllocationPage actions={actions} />;
    case 'asset-transfer':
      return <TransferPage actions={actions} />;
    case 'asset-maintenance':
      return (
        <MaintWorkOrdersPage
          actions={actions}
          page="asset-maintenance"
          base="/assets/maintenance"
          title="Asset Maintenance"
        />
      );
    case 'asset-depreciation':
      return <DepreciationPage actions={actions} />;
    case 'asset-disposal':
      return <DisposalPage actions={actions} />;
    case 'asset-qr':
      return <QrPage actions={actions} />;
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
      return <ApPage actions={actions} />;
    // Phase 10 CRM and sales screens
    case 'crm-leads':
      return <DocPage cfg={LEAD_CFG} actions={actions} />;
    case 'crm-opportunities':
      return <DocPage cfg={OPP_CFG} actions={actions} />;
    case 'crm-pipeline':
      return <PipelinePage actions={actions} />;
    case 'crm-followups':
      return <DocPage cfg={FU_CFG} actions={actions} />;
    case 'crm-meetings':
      return <DocPage cfg={MTG_CFG} actions={actions} />;
    case 'crm-feedback':
      return <DocPage cfg={FB_CFG} actions={actions} />;
    case 'crm-sources':
      return <SourcesPage actions={actions} />;
    case 'sales-quotations':
      return <SalesQuotationsPage actions={actions} />;
    case 'sales-orders':
      return <DocPage cfg={SO_CFG} actions={actions} />;
    case 'sales-reservations':
      return <ReservationsPage actions={actions} />;
    case 'sales-credit':
      return <CreditPage />;
    case 'sales-delivery':
      return <DeliveryPlanPage />;
    case 'sales-dispatch':
      return <DispatchPage actions={actions} />;
    case 'sales-invoices':
      return <SalesInvoicesPage actions={actions} />;
    case 'sales-collections':
      return <CollectionsPage actions={actions} />;
    case 'sales-returns':
      return <SalesReturnsPage actions={actions} />;
    // Phase 9 procurement screens
    case 'scm-pr':
      return <DocPage cfg={PR_CFG} actions={actions} />;
    case 'scm-rfq':
      return <DocPage cfg={RFQ_CFG} actions={actions} />;
    case 'scm-vendorquote':
      return <DocPage cfg={VQ_CFG} actions={actions} />;
    case 'scm-comparison':
      return <ComparisonPage actions={actions} />;
    case 'scm-po':
      return <DocPage cfg={PO_CFG} actions={actions} />;
    case 'scm-contracts':
      return <DocPage cfg={CON_CFG} actions={actions} />;
    case 'scm-grn':
      return <GrnPage actions={actions} />;
    case 'scm-purchaseinvoice':
      return <InvoicePage actions={actions} />;
    case 'scm-evaluation':
      return <EvaluationPage actions={actions} />;
    case 'wms-putaway':
      return <PutawayPage actions={actions} />;
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

    // Phase 15 HR screens
    case 'hr-employees':
    case 'hr-documents':
      return <HrEmployeesPage />;
    case 'hr-attendance':
    case 'hr-shifts':
      return <HrAttendancePage />;
    case 'hr-leave':
      return <HrLeavePage />;
    case 'hr-expense':
      return <HrExpensePage />;
    case 'hr-ess':
      return <HrEssPage />;

    // Phase 16 Payroll screens
    case 'pay-processing':
    case 'pay-register':
      return <PayProcessingPage />;
    case 'pay-structure':
      return <PayStructurePage />;
    case 'pay-pf':
    case 'pay-esic':
    case 'pay-pt':
    case 'pay-tds':
      return <StatutoryRatesPage />;
    case 'pay-payslip':
      return <PayPayslipPage />;
    case 'pay-bank':
      return <PayBankPage />;

    // Phase 17 Projects screens
    case 'proj-projects':
      return <ProjectsListPage />;
    case 'proj-tasks':
    case 'proj-gantt':
      return <ProjectGanttPage />;
    case 'proj-kanban':
      return <ProjectKanbanPage />;
    case 'proj-timesheets':
      return <TimesheetsPage />;
    case 'proj-profitability':
      return <ProjectProfitabilityPage />;

    // Phase 17 Service screens
    case 'service-tickets':
      return <ServiceDeskPage />;
    case 'service-technicians':
      return <TechnicianBoardPage />;
    case 'service-visits':
      return <MobileVisitsPage />;
    case 'service-amc':
      return <AmcPage />;
    case 'service-warranty':
    case 'service-claims':
      return <WarrantyClaimsPage />;

    // Phase 18 Logistics, Fleet, Gate & DMS screens
    case 'log-shipments':
    case 'log-tracking':
      return <LogisticsPage initialTab="SHIPMENTS" />;
    case 'log-freight':
      return <LogisticsPage initialTab="FREIGHT" />;
    case 'log-routes':
      return <LogisticsPage initialTab="ROUTES" />;
    case 'log-transporters':
      return <LogisticsPage initialTab="TRANSPORTERS" />;
    case 'log-pod':
      return <LogisticsPage initialTab="POD" />;
    case 'container-track':
      return <LogisticsPage initialTab="CONTAINERS" />;

    case 'fleet-vehicles':
    case 'fleet-documents':
      return <FleetPage initialTab="VEHICLES" />;
    case 'fleet-drivers':
      return <FleetPage initialTab="DRIVERS" />;
    case 'fleet-fuel':
      return <FleetPage initialTab="FUEL" />;
    case 'fleet-service':
      return <FleetPage initialTab="SERVICE" />;

    case 'gate-in':
      return <GateKioskPage initialMode="IN" />;
    case 'gate-out':
    case 'gate-nonreturn':
      return <GateKioskPage initialMode="OUT" />;
    case 'gate-return':
      return <GateKioskPage initialMode="RETURN" />;

    case 'dms-folders':
    case 'dms-docs':
    case 'dms-versions':
    case 'dms-permissions':
    case 'dms-tags':
    case 'dms-search':
      return <DmsPage />;

    // Phase 19 Dashboards, BI, Search, AI, Automation & Comm screens
    case 'command-center':
      return <BiBuilderPage initialTab="COMMAND" />;
    case 'global-search':
      return <BiBuilderPage initialTab="SEARCH" />;
    case 'bi-builder':
    case 'bi-dashboards':
      return <BiBuilderPage initialTab="BUILDER" />;
    case 'bi-reports':
    case 'bi-sales':
    case 'bi-purchase':
    case 'bi-inventory':
    case 'bi-finance':
    case 'bi-branch':
    case 'bi-profit':
      return <BiBuilderPage initialTab="REPORTS" />;
    case 'bi-scheduler':
      return <BiBuilderPage initialTab="SCHEDULER" />;

    case 'ai-copilot':
    case 'ai-executive':
      return <AiCopilotPage pageId={pageId} initialTab="COPILOT" />;
    case 'ai-demand':
    case 'ai-inventory':
    case 'ai-finance':
      return <AiCopilotPage pageId={pageId} initialTab="FORECAST" />;
    case 'ai-insights':
      return <AiCopilotPage pageId={pageId} initialTab="INSIGHTS" />;
    case 'ai-sales':
    case 'ai-vendor':
      return <AiCopilotPage pageId={pageId} />;

    case 'auto-rules':
    case 'auto-workflows':
      return <AutomationStudioPage initialTab="RULES" />;
    case 'auto-jobs':
      return <AutomationStudioPage initialTab="JOBS" />;
    case 'auto-webhooks':
      return <AutomationStudioPage initialTab="WEBHOOKS" />;

    case 'comm-templates':
      return <CommCenterPage initialTab="TEMPLATES" />;
    case 'comm-whatsapp':
    case 'comm-email':
    case 'comm-sms':
    case 'comm-logs':
      return <CommCenterPage initialTab="LOGS" />;
    case 'comm-payment':
      return <CommCenterPage initialTab="PAYMENT" />;

    // Phase 20 Hardening, Cut-over, Partitions & DPDP console
    case 'admin-backup':
      return <HardeningPage initialTab="partitions" />;

    // Phase 21 PWA, Realtime Notifications, Broadcasts & Email Automation
    case 'notif-center':
      return <NotificationCenterPage />;
    case 'notif-preferences':
      return <NotificationPrefsPage />;
    case 'admin-notif-types':
      return <AdminNotifConsolePage initialTab="TYPES" />;
    case 'admin-notif-broadcast':
      return <AdminNotifConsolePage initialTab="BROADCASTS" />;
    case 'admin-notif-health':
      return <AdminNotifConsolePage initialTab="HEALTH" />;
    case 'admin-email-rules':
      return <AdminNotifConsolePage initialTab="EMAIL_RULES" />;
    case 'admin-email-suppressions':
      return <AdminNotifConsolePage initialTab="SUPPRESSIONS" />;

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
