// One dashboard per role (what each user sees first after login). The numbers are read from the API (GET /me/home,
// /work/inbox/counts, /work/audit, /projects) - a number that cannot be read shows "—", never an invented value.
// The links are real pages; the API still decides what each user may actually open (RBAC), so a page the role lacks
// is simply refused or absent from the user's own menu.

export type RoleKey =
  | 'SUPER_USER'
  | 'ADMINISTRATOR'
  | 'DIRECTOR'
  | 'CFO'
  | 'GENERAL_MANAGER'
  | 'DEPT_HEAD'
  | 'DEPT_MANAGER'
  | 'SUPERVISOR'
  | 'EMPLOYEE';

/** `w:` = a "my work" counter of GET /me/home, `c:` = a department inbox counter of GET /work/inbox/counts. */
export type KpiSource =
  | 'w:toReceive'
  | 'w:toAccept'
  | 'w:inWork'
  | 'w:myApprovals'
  | 'w:myTasks'
  | 'w:returnedToMe'
  | 'w:myDrafts'
  | 'w:overdue'
  | 'c:open'
  | 'c:approval'
  | 'c:ready'
  | 'c:returned'
  | 'c:sentWaiting'
  | 'c:pendingReceipt'
  | 'c:pendingAcceptance'
  | 'c:work';

export interface Kpi {
  label: string;
  source: KpiSource;
  to: string;
  red?: boolean;
}
export interface LinkGroup {
  title: string;
  links: { label: string; to: string }[];
}
export type Panel = 'activity' | 'projects';

export type AnalyticsKind = 'sales' | 'purchase' | 'inventory' | 'finance' | 'branch';
/** One chart card. `work`/`inbox`/`docs`/`age` use the user's own counters; the others read GET /bi/analytics/:kind. */
export type ChartSpec =
  | { type: 'work'; title: string }
  | { type: 'inbox'; title: string }
  | { type: 'docs'; title: string }
  | { type: 'age'; title: string }
  | { type: 'trend'; title: string; kind: AnalyticsKind; dataset: string; series: { key: string; name: string; color: string }[]; to: string }
  | { type: 'top'; title: string; kind: AnalyticsKind; dataset: string; labelKey: string; valueKey: string; limit: number; to: string; sort?: 'desc' }
  | { type: 'group'; title: string; kind: AnalyticsKind; dataset: string; groupKey: string; valueKey?: string; to: string };

export interface RoleDash {
  key: RoleKey;
  title: string;
  tagline: string;
  /** What this role sees, in plain words (the "access" box). */
  scope: string[];
  kpis: Kpi[];
  groups: LinkGroup[];
  panels: Panel[];
  /** The role's graphs, in order. A graph whose data the user may not read is left out. */
  charts: ChartSpec[];
  /** Company-wide numbers (true) or only the user's own department / own work (false). */
  companyWide: boolean;
}

const l = (label: string, to: string) => ({ label, to: `/m/${to}` });
const BLUE = '#2563eb';
const GREEN = '#16a34a';
const RED = '#ef4444';
const AMBER = '#f59e0b';
const WORK: ChartSpec = { type: 'work', title: 'My work by stage' };
const INBOX: ChartSpec = { type: 'inbox', title: 'Department inbox' };
const DOCS: ChartSpec = { type: 'docs', title: 'My documents by status' };
const AGE: ChartSpec = { type: 'age', title: 'Approvals waiting, by age' };
const SALES: ChartSpec = { type: 'trend', title: 'Sales revenue, last 12 months', kind: 'sales', dataset: 'monthly', series: [{ key: 'revenue', name: 'Revenue', color: BLUE }], to: '/m/bi-sales' };
const PL: ChartSpec = {
  type: 'trend', title: 'Revenue, expenses and net profit', kind: 'finance', dataset: 'monthly', to: '/m/bi-finance',
  series: [{ key: 'revenue', name: 'Revenue', color: BLUE }, { key: 'expense', name: 'Expenses', color: AMBER }, { key: 'net_profit', name: 'Net profit', color: GREEN }],
};
const BRANCH: ChartSpec = { type: 'top', title: 'Revenue by branch', kind: 'branch', dataset: 'branches', labelKey: 'branch', valueKey: 'revenue', limit: 6, to: '/m/bi-branch' };

export const ROLE_DASHBOARDS: Record<RoleKey, RoleDash> = {
  SUPER_USER: {
    key: 'SUPER_USER',
    title: 'Super User Control Room',
    tagline: 'Whole-system control: every unit, every department, every user and every setting.',
    scope: [
      'All units and all departments',
      'Users, roles and permissions of every level',
      'Security, sessions and the audit trail',
      'Master settings, integrations and system health',
    ],
    kpis: [
      { label: 'Open documents (all depts)', source: 'c:open', to: '/m/document-movement-center' },
      { label: 'Awaiting approval', source: 'w:myApprovals', to: '/approvals' },
      { label: 'Returned / rejected', source: 'c:returned', to: '/m/document-movement-center', red: true },
      { label: 'Overdue', source: 'w:overdue', to: '/approvals', red: true },
    ],
    groups: [
      {
        title: 'People & access',
        links: [l('Users', 'admin-users'), l('Roles', 'admin-roles'), l('Permissions', 'admin-permissions'), l('View as user', 'admin-view-as'), l('Sessions', 'admin-sessions')],
      },
      {
        title: 'Security & audit',
        links: [l('Security', 'admin-security'), l('Login policies', 'admin-login-policies'), l('Audit log', 'admin-audit'), l('Backups', 'admin-backup')],
      },
      {
        title: 'System',
        links: [l('System health', 'admin-health'), l('Integrations', 'admin-integrations'), l('Company & units', 'admin-company'), l('Plants per module', 'admin-module-plants')],
      },
      {
        title: 'Business overview',
        links: [l('Executive dashboard', 'my-dashboard'), l('Owner console', 'owner-console'), l('Plant dashboard', 'plant-dashboard'), l('KPI alerts', 'kpi-alerts')],
      },
    ],
    charts: [PL, BRANCH, AGE, WORK, INBOX],
    panels: ['activity', 'projects'],
    companyWide: true,
  },
  ADMINISTRATOR: {
    key: 'ADMINISTRATOR',
    title: 'Administrator Console',
    tagline: 'Run the system day to day: users, masters, workflows, numbering and data quality.',
    scope: [
      'All departments (administration view)',
      'Create and manage users below Administrator level',
      'Masters, workflow, numbering and import',
      'Audit trail and notification set-up',
    ],
    kpis: [
      { label: 'Open documents', source: 'c:open', to: '/m/document-movement-center' },
      { label: 'Awaiting my approval', source: 'w:myApprovals', to: '/approvals' },
      { label: 'Returned', source: 'c:returned', to: '/m/document-movement-center', red: true },
      { label: 'Overdue', source: 'w:overdue', to: '/approvals', red: true },
    ],
    groups: [
      {
        title: 'Users & roles',
        links: [l('Users', 'admin-users'), l('Roles', 'admin-roles'), l('Departments', 'admin-departments'), l('Designations', 'admin-designations')],
      },
      {
        title: 'Masters & set-up',
        links: [l('Workflow', 'admin-workflow'), l('Approval matrix', 'admin-approval'), l('Numbering', 'admin-numbering'), l('Custom fields', 'admin-customfields'), l('Import data', 'admin-import'), l('Duplicates', 'admin-duplicates')],
      },
      {
        title: 'Monitor',
        links: [l('Audit log', 'admin-audit'), l('System health', 'admin-health'), l('Notification health', 'admin-notif-health'), l('Page health', 'admin-page-health')],
      },
      {
        title: 'Work',
        links: [l('Department inbox', 'dept-inbox'), l('Document movement', 'document-movement-center'), l('My approvals', 'my-approvals'), l('Mail', 'dept-mail')],
      },
    ],
    charts: [WORK, INBOX, DOCS],
    panels: ['activity'],
    companyWide: true,
  },
  DIRECTOR: {
    key: 'DIRECTOR',
    title: 'Director Dashboard',
    tagline: 'The whole business at a glance: approvals waiting on you, projects, plants and department flow.',
    scope: [
      'All plants and all departments (view and approve)',
      'High-value approvals',
      'Business-intelligence dashboards',
      'Cross-department document flow',
    ],
    kpis: [
      { label: 'Awaiting my approval', source: 'w:myApprovals', to: '/approvals' },
      { label: 'Open documents', source: 'c:open', to: '/m/document-movement-center' },
      { label: 'Returned', source: 'c:returned', to: '/m/process-exceptions', red: true },
      { label: 'Overdue', source: 'w:overdue', to: '/approvals', red: true },
    ],
    groups: [
      {
        title: 'Business view',
        links: [l('Executive dashboard', 'my-dashboard'), l('Owner console', 'owner-console'), l('Plant dashboard', 'plant-dashboard'), l('KPI targets', 'kpi-targets'), l('KPI alerts', 'kpi-alerts')],
      },
      {
        title: 'Analytics',
        links: [l('Production', 'bi-production'), l('Quality', 'bi-quality'), l('HR', 'bi-hr'), l('Projects', 'bi-projects'), l('Logistics', 'bi-logistics')],
      },
      {
        title: 'Decisions',
        links: [l('My approvals', 'my-approvals'), l('Process exceptions', 'process-exceptions'), l('Plant flow command', 'plant-flow-command'), l('Project history', 'project-global-history')],
      },
    ],
    charts: [SALES, PL, BRANCH, AGE, WORK],
    panels: ['projects', 'activity'],
    companyWide: true,
  },
  CFO: {
    key: 'CFO',
    title: 'Finance Dashboard (CFO)',
    tagline: 'Cash, receivables, payables, tax and the approvals that need a finance decision.',
    scope: [
      'Finance, tax and payroll modules',
      'Approval limits and finance approvals',
      'Company-wide financial statements',
      'Budget and cost-centre views',
    ],
    kpis: [
      { label: 'Awaiting my approval', source: 'w:myApprovals', to: '/approvals' },
      { label: 'Finance inbox - open', source: 'c:open', to: '/m/dept-inbox-finance' },
      { label: 'Returned to me', source: 'w:returnedToMe', to: '/approvals', red: true },
      { label: 'Overdue', source: 'w:overdue', to: '/approvals', red: true },
    ],
    groups: [
      {
        title: 'Books',
        links: [l('General ledger', 'fin-gl'), l('Journal', 'fin-journal'), l('Trial balance', 'fin-trial'), l('Profit & loss', 'fin-pnl'), l('Balance sheet', 'fin-bs'), l('Cash flow', 'fin-cashflow')],
      },
      {
        title: 'Receivables & payables',
        links: [l('Receivables', 'fin-ar'), l('Payables', 'fin-ap'), l('Ageing', 'fin-ageing'), l('Bank reconciliation', 'fin-bankreco'), l('Expenses', 'fin-expenses')],
      },
      {
        title: 'Tax & payroll',
        links: [l('GSTR-1', 'tax-gstr1'), l('GSTR-3B', 'tax-gstr3b'), l('e-Invoice', 'tax-einvoice'), l('TDS', 'tax-tds'), l('Payroll processing', 'pay-processing')],
      },
      {
        title: 'Planning',
        links: [l('Budget', 'fin-budget'), l('Cost centres', 'fin-costcenter'), l('Approval limits', 'finance-limits'), l('KPI targets', 'kpi-targets')],
      },
    ],
    charts: [PL,
      { type: 'trend', title: 'Cash in vs cash out', kind: 'finance', dataset: 'cash', to: '/m/bi-finance', series: [{ key: 'cash_in', name: 'Cash in', color: GREEN }, { key: 'cash_out', name: 'Cash out', color: RED }] },
      { type: 'top', title: 'Working capital', kind: 'finance', dataset: 'working', labelKey: 'component', valueKey: 'amount', limit: 6, to: '/m/bi-finance' },
      AGE, WORK],
    panels: ['activity'],
    companyWide: false,
  },
  GENERAL_MANAGER: {
    key: 'GENERAL_MANAGER',
    title: 'General Manager Dashboard',
    tagline: 'Plant operations: production, purchase, stores, quality and the flow between departments.',
    scope: [
      'Operations across assigned plants and departments',
      'Approvals up to the GM limit',
      'Production, procurement, inventory and quality views',
      'Department workload and bottlenecks',
    ],
    kpis: [
      { label: 'Awaiting my approval', source: 'w:myApprovals', to: '/approvals' },
      { label: 'Open documents', source: 'c:open', to: '/m/document-movement-center' },
      { label: 'Waiting on other depts', source: 'c:sentWaiting', to: '/m/document-movement-center' },
      { label: 'Overdue', source: 'w:overdue', to: '/approvals', red: true },
    ],
    groups: [
      {
        title: 'Operations',
        links: [l('Plant dashboard', 'plant-dashboard'), l('Plant flow command', 'plant-flow-command'), l('Process exceptions', 'process-exceptions'), l('Order 360', 'ops-order-360')],
      },
      {
        title: 'Supply chain',
        links: [l('Purchase requests', 'scm-pr'), l('Purchase orders', 'scm-po'), l('Goods receipt', 'scm-grn'), l('Stock valuation', 'inv-valuation'), l('Reorder', 'inv-reorder')],
      },
      {
        title: 'Quality & maintenance',
        links: [l('Inspections', 'qms-inspections'), l('NCR', 'qms-ncr'), l('CAPA', 'qms-capa'), l('Asset maintenance', 'asset-maintenance')],
      },
      {
        title: 'Analytics',
        links: [l('Production', 'bi-production'), l('Quality', 'bi-quality'), l('Maintenance', 'bi-maintenance'), l('Logistics', 'bi-logistics')],
      },
    ],
    charts: [SALES,
      { type: 'trend', title: 'Purchase spend, last 12 months', kind: 'purchase', dataset: 'monthly', series: [{ key: 'spend', name: 'Spend', color: '#9333ea' }], to: '/m/bi-purchase' },
      { type: 'group', title: 'Stock health (SKUs)', kind: 'inventory', dataset: 'issues', groupKey: 'state', to: '/m/bi-inventory' },
      { type: 'top', title: 'Top suppliers by spend', kind: 'purchase', dataset: 'suppliers', labelKey: 'name', valueKey: 'spend', limit: 6, to: '/m/bi-purchase' },
      WORK, INBOX],
    panels: ['projects', 'activity'],
    companyWide: true,
  },
  DEPT_HEAD: {
    key: 'DEPT_HEAD',
    title: 'Department Head Dashboard',
    tagline: 'Your department: what arrived, what is accepted, what is stuck and what needs your approval.',
    scope: [
      'Your own department (and any extra departments given to you)',
      'Approvals for your department',
      "Your team's tasks and attendance",
      'Documents moving in and out of your department',
    ],
    kpis: [
      { label: 'To receive', source: 'c:pendingReceipt', to: '/m/dept-inbox' },
      { label: 'To accept', source: 'c:pendingAcceptance', to: '/m/dept-inbox' },
      { label: 'Awaiting my approval', source: 'w:myApprovals', to: '/approvals' },
      { label: 'Returned', source: 'c:returned', to: '/m/dept-inbox', red: true },
    ],
    groups: [
      {
        title: 'My department',
        links: [l('Department inbox', 'dept-inbox'), l('Work center', 'dept-work'), l('Document movement', 'document-movement-center'), l('Department mail', 'dept-mail')],
      },
      {
        title: 'Team',
        links: [l('Team tasks', 'ops-tasks'), l('Shift & handover', 'ops-shift-roster'), l('Live attendance', 'att-live-board'), l('Leave', 'hr-leave')],
      },
      {
        title: 'Decisions',
        links: [l('My approvals', 'my-approvals'), l('Process exceptions', 'process-exceptions'), l('Business documents', 'business-documents')],
      },
    ],
    charts: [INBOX, WORK, DOCS],
    panels: ['activity'],
    companyWide: false,
  },
  DEPT_MANAGER: {
    key: 'DEPT_MANAGER',
    title: 'Manager Dashboard',
    tagline: "Run your team's work: receive, accept and complete documents, and keep tasks on time.",
    scope: [
      'Your own department',
      'Receive, accept, forward and complete documents',
      'Approvals within your limit',
      "Your team's tasks",
    ],
    kpis: [
      { label: 'To receive', source: 'w:toReceive', to: '/m/document-movement-center' },
      { label: 'To accept', source: 'w:toAccept', to: '/m/document-movement-center' },
      { label: 'In work', source: 'w:inWork', to: '/m/document-movement-center' },
      { label: 'Overdue', source: 'w:overdue', to: '/approvals', red: true },
    ],
    groups: [
      {
        title: 'Work',
        links: [l('Department inbox', 'dept-inbox'), l('Work center', 'dept-work'), l('Document movement', 'document-movement-center'), l('My approvals', 'my-approvals')],
      },
      {
        title: 'Team',
        links: [l('Tasks', 'ops-tasks'), l('Shift roster', 'ops-shift-roster'), l('Visitors', 'ops-visitors'), l('Canteen', 'ops-canteen')],
      },
      {
        title: 'Create',
        links: [l('Enquiries', 'sales-enquiries'), l('Purchase request', 'scm-pr'), l('Mail', 'dept-mail')],
      },
    ],
    charts: [WORK, DOCS, INBOX],
    panels: ['activity'],
    companyWide: false,
  },
  SUPERVISOR: {
    key: 'SUPERVISOR',
    title: 'Supervisor Dashboard',
    tagline: 'The shift: tasks to finish, handovers to accept, people and visitors on site.',
    scope: [
      'Your own department and shift',
      'Tasks assigned to you and your crew',
      'Handover, gate and visitor registers',
      'No approval or admin rights unless granted',
    ],
    kpis: [
      { label: 'My tasks', source: 'w:myTasks', to: '/m/ops-tasks' },
      { label: 'To accept', source: 'w:toAccept', to: '/m/document-movement-center' },
      { label: 'In work', source: 'w:inWork', to: '/m/document-movement-center' },
      { label: 'Returned to me', source: 'w:returnedToMe', to: '/m/document-movement-center', red: true },
    ],
    groups: [
      {
        title: 'This shift',
        links: [l('Tasks', 'ops-tasks'), l('Shift & handover', 'ops-shift-roster'), l('Live attendance', 'att-live-board')],
      },
      {
        title: 'Site',
        links: [l('Visitors', 'ops-visitors'), l('Canteen', 'ops-canteen'), l('Document movement', 'document-movement-center')],
      },
    ],
    charts: [WORK, DOCS],
    panels: [],
    companyWide: false,
  },
  EMPLOYEE: {
    key: 'EMPLOYEE',
    title: 'My Dashboard',
    tagline: 'Your own work: tasks, drafts, attendance, leave and payslips.',
    scope: [
      'Your own tasks, drafts and requests',
      'Your own attendance, leave and payslip',
      'Pages your department has opened for you',
    ],
    kpis: [
      { label: 'My tasks', source: 'w:myTasks', to: '/m/ops-tasks' },
      { label: 'My drafts', source: 'w:myDrafts', to: '/menu' },
      { label: 'Returned to me', source: 'w:returnedToMe', to: '/approvals', red: true },
      { label: 'Overdue', source: 'w:overdue', to: '/approvals', red: true },
    ],
    groups: [
      {
        title: 'Me',
        links: [l('My tasks', 'ops-tasks'), l('Self service (ESS)', 'hr-ess'), l('Leave', 'hr-leave'), l('Payslip', 'pay-payslip'), l('Attendance', 'hr-attendance')],
      },
      {
        title: 'Requests',
        links: [l('Expense claim', 'hr-expense'), l('Notifications', 'notif-center'), l('Preferences', 'notif-preferences')],
      },
    ],
    charts: [WORK, DOCS],
    panels: [],
    companyWide: false,
  },
};

const ALIAS: Record<string, RoleKey> = {
  SUPER_ADMIN: 'SUPER_USER',
  ADMIN: 'ADMINISTRATOR',
  MANAGER: 'DEPT_MANAGER',
  LEAD: 'SUPERVISOR',
  MEMBER: 'EMPLOYEE',
};

/** The dashboard of a user: by role code (legacy codes mapped), else by role level for custom roles. */
export function dashboardFor(roleCode: string | null | undefined, level: number | undefined): RoleDash {
  const code = (roleCode ?? '').toUpperCase();
  if (code in ROLE_DASHBOARDS) return ROLE_DASHBOARDS[code as RoleKey];
  const alias = ALIAS[code];
  if (alias) return ROLE_DASHBOARDS[alias];
  const n = level ?? 0;
  const key: RoleKey =
    n >= 99 ? 'SUPER_USER'
    : n >= 95 ? 'ADMINISTRATOR'
    : n >= 90 ? 'DIRECTOR'
    : n >= 80 ? 'CFO'
    : n >= 70 ? 'GENERAL_MANAGER'
    : n >= 60 ? 'DEPT_HEAD'
    : n >= 50 ? 'DEPT_MANAGER'
    : n >= 30 ? 'SUPERVISOR'
    : 'EMPLOYEE';
  return ROLE_DASHBOARDS[key];
}
