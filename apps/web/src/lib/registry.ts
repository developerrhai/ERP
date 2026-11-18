// Menu access rules in one place: which registry families a user may see (CONTRACT §2)
// and page lookups for /m/:pageId. Pure functions so they are unit-tested per role/department.
import rawRegistry from '@registry';
import type { RegistryFamily, RegistryItem } from '@registry';
export type { RegistryFamily, RegistryItem };
import type { RoleCode } from '../types';

/**
 * Titles that differ from the prototype because of owner decisions. The extracted registry stays an
 * exact copy of index.html (it has a staleness test); the web app relabels here, in one place.
 */
const TITLE_OVERRIDES: Readonly<Record<string, string>> = {
  'admin-company': 'Company Master',
  'admin-branches': 'Unit Master',
};

/**
 * Pages a later phase adds to the frozen prototype registry (the API does the same in
 * apps/api/src/core/registry.ts). Phase 6B: admin-formats, right after the Approval Matrix.
 */
const PHASE_ADDED_PAGES = [
  {
    id: 'admin-formats',
    title: 'Formats & Rules',
    family: 'Administration',
    after: 'admin-approval',
    purpose: 'All document formats and calculation rule sets, their versions, and who changed what.',
  },
  {
    id: 'notif-center',
    title: 'Notification Center',
    family: 'Executive',
    after: 'notifications',
    hidden: true, // same screen as V40 'notifications'; kept routable, not listed twice in the menu
    purpose: 'Full real-time notification history, category filters and read/archive state.',
  },
  {
    id: 'notif-preferences',
    title: 'Notification Preferences',
    family: 'Executive',
    after: 'notif-center',
    purpose: 'Per-type channel switches (in-app, push, email, SMS), quiet hours and registered devices.',
  },
  {
    id: 'admin-notif-types',
    title: 'Notification Types',
    family: 'Administration',
    after: 'admin-settings',
    purpose: 'Catalogue of notification events, allowed/mandatory channels and test sends.',
  },
  {
    id: 'admin-notif-broadcast',
    title: 'Broadcast Announcements',
    family: 'Administration',
    after: 'admin-notif-types',
    purpose: 'Scheduled announcements targeted to units, departments or roles with acknowledgement tracking.',
  },
  {
    id: 'admin-notif-health',
    title: 'Notification & Email Health',
    family: 'Administration',
    after: 'admin-notif-broadcast',
    purpose: '24h delivery telemetry, push devices, SES quota, DKIM/SPF/DMARC status and channel kill switches.',
  },
  {
    id: 'admin-email-rules',
    title: 'Email Automation Rules',
    family: 'Administration',
    after: 'admin-notif-health',
    purpose: 'Event-triggered transactional email rules, PDF attachments and send windows.',
  },
  {
    id: 'admin-email-suppressions',
    title: 'Email Suppressions',
    family: 'Administration',
    after: 'admin-email-rules',
    purpose: 'Blocked hard-bounced/complained addresses with audited unblock workflow.',
  },
  {
    id: 'admin-page-health',
    title: 'Page Health',
    family: 'Administration',
    after: 'admin-email-suppressions',
    purpose: 'Crawler results: every page, role and plant combination, errors and load time.',
  },
  {
    id: 'admin-registry',
    title: 'Page Registry',
    family: 'Administration',
    after: 'admin-page-health',
    purpose: 'Registry v2: every V40 page with its tabs, fields, buttons, status and owner phase.',
  },
  {
    id: 'my-dashboard',
    title: 'My Dashboard',
    family: 'Executive',
    after: 'dashboard',
    purpose: 'Your own numbers, queues and targets.',
  },
  {
    id: 'plant-dashboard',
    title: 'Plant Dashboard',
    family: 'Executive',
    after: 'my-dashboard',
    purpose: 'One plant, or a comparison of the plants you chose.',
  },
  {
    id: 'owner-console',
    title: 'Owner Console',
    family: 'Executive',
    after: 'plant-dashboard',
    purpose: 'KPIs per plant and in total, approvals by age and statutory rows to review.',
  },
  {
    id: 'kpi-targets',
    title: 'KPI Targets',
    family: 'Business Intelligence',
    after: 'bi-profit',
    purpose: 'Targets with green / amber / red limits per KPI, plant, department or person.',
  },
  {
    id: 'kpi-alerts',
    title: 'KPI Alerts',
    family: 'Business Intelligence',
    after: 'kpi-targets',
    purpose: 'Alert rules that notify people when a KPI crosses a limit.',
  },
  {
    id: 'bi-production',
    title: 'Production Analytics',
    family: 'Business Intelligence',
    after: 'kpi-alerts',
    purpose: 'Production KPIs for the chosen plants.',
  },
  {
    id: 'bi-quality',
    title: 'Quality Analytics',
    family: 'Business Intelligence',
    after: 'bi-production',
    purpose: 'Quality KPIs for the chosen plants.',
  },
  {
    id: 'bi-hr',
    title: 'HR Analytics',
    family: 'Business Intelligence',
    after: 'bi-quality',
    purpose: 'HR KPIs for the chosen plants.',
  },
  {
    id: 'bi-maintenance',
    title: 'Maintenance Analytics',
    family: 'Business Intelligence',
    after: 'bi-hr',
    purpose: 'Maintenance KPIs for the chosen plants.',
  },
  {
    id: 'bi-projects',
    title: 'Project Analytics',
    family: 'Business Intelligence',
    after: 'bi-maintenance',
    purpose: 'Project KPIs for the chosen plants.',
  },
  {
    id: 'bi-service',
    title: 'Service Analytics',
    family: 'Business Intelligence',
    after: 'bi-projects',
    purpose: 'Service KPIs for the chosen plants.',
  },
  {
    id: 'bi-logistics',
    title: 'Logistics Analytics',
    family: 'Business Intelligence',
    after: 'bi-service',
    purpose: 'Logistics KPIs for the chosen plants.',
  },
  {
    id: 'dept-inbox-administration',
    title: 'Administration Inbox',
    family: 'Department Inboxes',
    after: '',
    purpose: 'Department mailbox of Administration: documents, receipt, acceptance, work, approval and mail.',
  },
  {
    id: 'dept-inbox-sales',
    title: 'Sales Inbox',
    family: 'Department Inboxes',
    after: 'dept-inbox-administration',
    purpose: 'Department mailbox of Sales: documents, receipt, acceptance, work, approval and mail.',
  },
  {
    id: 'dept-inbox-purchase',
    title: 'Purchase Inbox',
    family: 'Department Inboxes',
    after: 'dept-inbox-sales',
    purpose: 'Department mailbox of Purchase: documents, receipt, acceptance, work, approval and mail.',
  },
  {
    id: 'dept-inbox-finance',
    title: 'Finance & Accounts Inbox',
    family: 'Department Inboxes',
    after: 'dept-inbox-purchase',
    purpose: 'Department mailbox of Finance: documents, receipt, acceptance, work, approval and mail.',
  },
  {
    id: 'dept-inbox-hr',
    title: 'HR Inbox',
    family: 'Department Inboxes',
    after: 'dept-inbox-finance',
    purpose: 'Department mailbox of HR: documents, receipt, acceptance, work, approval and mail.',
  },
  {
    id: 'dept-inbox-production',
    title: 'Production Inbox',
    family: 'Department Inboxes',
    after: 'dept-inbox-hr',
    purpose: 'Department mailbox of Production: documents, receipt, acceptance, work, approval and mail.',
  },
  {
    id: 'dept-inbox-quality',
    title: 'Quality Inbox',
    family: 'Department Inboxes',
    after: 'dept-inbox-production',
    purpose: 'Department mailbox of Quality: documents, receipt, acceptance, work, approval and mail.',
  },
  {
    id: 'dept-inbox-maintenance',
    title: 'Plant & Maintenance Inbox',
    family: 'Department Inboxes',
    after: 'dept-inbox-quality',
    purpose: 'Department mailbox of Maintenance: documents, receipt, acceptance, work, approval and mail.',
  },
  {
    id: 'dept-inbox-warehouse',
    title: 'Warehouse Inbox',
    family: 'Department Inboxes',
    after: 'dept-inbox-maintenance',
    purpose: 'Department mailbox of Warehouse: documents, receipt, acceptance, work, approval and mail.',
  },
  {
    id: 'dept-inbox-projects',
    title: 'Projects Inbox',
    family: 'Department Inboxes',
    after: 'dept-inbox-warehouse',
    purpose: 'Department mailbox of Projects: documents, receipt, acceptance, work, approval and mail.',
  },
  {
    id: 'dept-inbox-service',
    title: 'Service & Support Inbox',
    family: 'Department Inboxes',
    after: 'dept-inbox-projects',
    purpose: 'Department mailbox of Service: documents, receipt, acceptance, work, approval and mail.',
  },
  {
    id: 'dept-inbox-engineering',
    title: 'Engineering Inbox',
    family: 'Department Inboxes',
    after: 'dept-inbox-service',
    purpose: 'Department mailbox of Engineering: documents, receipt, acceptance, work, approval and mail.',
  },
  {
    id: 'dept-inbox',
    title: 'Department Inbox • My Desk',
    family: 'Department Inboxes',
    after: 'dept-inbox-engineering',
    hidden: false,
    purpose: 'Universal department mailbox: opens your logged-in department workspace.',
  },
  {
    id: 'dept-work',
    title: 'Department Work Center',
    family: 'Executive',
    after: 'dept-inbox',
    hidden: true,
    purpose: 'Accepted work of your department, grouped by document type.',
  },
  {
    id: 'dept-work-sales',
    title: 'Sales Work Center',
    family: 'Sales',
    after: '',
    purpose: 'Work Center of Sales: incoming work, routed documents, approvals and onward movement.',
  },
  {
    id: 'dept-work-purchase',
    title: 'Purchase Work Center',
    family: 'Procurement / SCM',
    after: '',
    purpose: 'Work Center of Purchase: incoming work, routed documents, approvals and onward movement.',
  },
  {
    id: 'dept-work-production',
    title: 'Production Work Center',
    family: 'Manufacturing',
    after: '',
    purpose: 'Work Center of Production: incoming work, routed documents, approvals and onward movement.',
  },
  {
    id: 'dept-work-engineering',
    title: 'Engineering Work Center',
    family: 'Manufacturing',
    after: 'dept-work-production',
    purpose: 'Work Center of Engineering: incoming work, routed documents, approvals and onward movement.',
  },
  {
    id: 'dept-work-quality',
    title: 'Quality Work Center',
    family: 'Quality / QMS',
    after: '',
    purpose: 'Work Center of Quality: incoming work, routed documents, approvals and onward movement.',
  },
  {
    id: 'dept-work-warehouse',
    title: 'Warehouse Work Center',
    family: 'Warehouse / WMS',
    after: '',
    purpose: 'Work Center of Warehouse: incoming work, routed documents, approvals and onward movement.',
  },
  {
    id: 'dept-work-finance',
    title: 'Finance Work Center',
    family: 'Finance & Accounts',
    after: '',
    purpose: 'Work Center of Finance: incoming work, routed documents, approvals and onward movement.',
  },
  {
    id: 'dept-work-hr',
    title: 'HR Work Center',
    family: 'HRMS',
    after: '',
    purpose: 'Work Center of HR: incoming work, routed documents, approvals and onward movement.',
  },
  {
    id: 'dept-work-projects',
    title: 'Projects Work Center',
    family: 'Projects',
    after: '',
    purpose: 'Work Center of Projects: incoming work, routed documents, approvals and onward movement.',
  },
  {
    id: 'dept-work-maintenance',
    title: 'Maintenance Work Center',
    family: 'Maintenance',
    after: '',
    purpose: 'Work Center of Maintenance: incoming work, routed documents, approvals and onward movement.',
  },
  {
    id: 'dept-work-service',
    title: 'Service Work Center',
    family: 'Service / Support',
    after: '',
    purpose: 'Work Center of Service: incoming work, routed documents, approvals and onward movement.',
  },
  {
    id: 'dept-work-administration',
    title: 'Administration Work Center',
    family: 'Administration',
    after: '',
    purpose: 'Work Center of Administration: incoming work, routed documents, approvals and onward movement.',
  },
  {
    id: 'dept-movement-inbox',
    title: 'All Department Movements',
    family: 'Executive',
    after: 'owner-console',
    purpose: 'Every department movement; Director, Admin and Owner.',
  },
  {
    id: 'master-customers',
    title: 'Customer Master',
    family: 'CRM',
    after: 'crm-customer360',
    purpose: 'Customer master: contacts, GST, credit and addresses.',
  },
  {
    id: 'master-products',
    title: 'Product Master',
    family: 'Inventory',
    after: 'inv-items',
    purpose: 'Finished products master with part, HSN, unit and cost.',
  },
  {
    id: 'master-materials',
    title: 'Material Master',
    family: 'Inventory',
    after: 'inv-items',
    purpose: 'Raw material master with HSN, unit, reorder level and cost.',
  },
  {
    id: 'my-approvals',
    title: 'Approval Inbox',
    family: 'Executive',
    after: 'dept-movement-inbox',
    purpose: 'Manager inbox for department acceptance, operational approvals, sent movements and decision history.',
  },
  {
    id: 'document-movement-center',
    title: 'Document Movement Center',
    family: 'Executive',
    after: 'dept-movement-inbox',
    purpose: 'Send ERP documents to a department inbox like email attachments; the record stays linked.',
  },
  {
    id: 'plant-flow-command',
    title: 'Plant Flow Command Center',
    family: 'Executive',
    after: 'ops-order-360',
    purpose: 'A project across departments and gates: pending receipt, acceptance, current gate and onward movement.',
  },
  {
    id: 'plant-project-forward',
    title: 'Project Department Forward Flow',
    family: 'Executive',
    after: 'ops-order-360',
    purpose: 'A project across departments and gates: pending receipt, acceptance, current gate and onward movement.',
  },
  {
    id: 'maint-part-movement',
    title: 'Maintenance Part Movement',
    family: 'Executive',
    after: 'plant-project-forward',
    purpose: 'Controlled movement register: sent, received, accepted, short quantity and history.',
  },
  {
    id: 'plant-process-movement',
    title: 'Process Movement',
    family: 'Executive',
    after: 'plant-project-forward',
    purpose: 'Controlled movement register: sent, received, accepted, short quantity and history.',
  },
  {
    id: 'plant-department-movement',
    title: 'Department Movement',
    family: 'Executive',
    after: 'plant-project-forward',
    purpose: 'Controlled movement register: sent, received, accepted, short quantity and history.',
  },
  {
    id: 'plant-interplant-movement',
    title: 'Plant-to-Plant Movement',
    family: 'Executive',
    after: 'plant-project-forward',
    purpose: 'Controlled movement register: sent, received, accepted, short quantity and history.',
  },
  {
    id: 'plant-unit-routing',
    title: 'Plant / Unit Routing',
    family: 'Manufacturing',
    after: 'mfg-orders',
    purpose: 'Plant routing, BOM and material approval and material transfer between plants.',
  },
  {
    id: 'mfg-unit-route',
    title: 'Multi-Unit Part Routing',
    family: 'Manufacturing',
    after: 'mfg-orders',
    purpose: 'Plant routing, BOM and material approval and material transfer between plants.',
  },
  {
    id: 'flow-bom-approval',
    title: 'BOM & Material Approval',
    family: 'Manufacturing',
    after: 'mfg-orders',
    purpose: 'Plant routing, BOM and material approval and material transfer between plants.',
  },
  {
    id: 'mfg-transfer-note',
    title: 'Material Transfer Note',
    family: 'Manufacturing',
    after: 'mfg-orders',
    purpose: 'Plant routing, BOM and material approval and material transfer between plants.',
  },
  {
    id: 'sales-enquiries',
    title: 'Sales Enquiries',
    family: 'Sales',
    after: 'sales-orders',
    purpose: 'Customer enquiries: qualify, make a quotation, start a project, win or lose.',
  },
  {
    id: 'ops-order-360',
    title: '360 Order Tracking',
    family: 'Executive',
    after: 'dept-movement-inbox',
    purpose: 'One order from enquiry to collection with progress.',
  },
  {
    id: 'project-global-history',
    title: 'Global Project History',
    family: 'Executive',
    after: 'ops-order-360',
    purpose: 'Every event of a project across departments.',
  },
  {
    id: 'process-exceptions',
    title: 'Process Exceptions & Disputes',
    family: 'Executive',
    after: 'project-global-history',
    purpose: 'Delays found automatically, grouped by the department that owns them.',
  },
  {
    id: 'business-documents',
    title: 'Document Center',
    family: 'Document Management',
    after: 'dms-search',
    purpose: 'Every business document in 5 formats; send to a department or email it.',
  },
  {
    id: 'dept-mail',
    title: 'Department Mail',
    family: 'Communication',
    after: 'comm-logs',
    purpose: 'Compose, inbox and sent mail between departments and to outside addresses.',
  },
  {
    id: 'admin-mail-automation',
    title: 'Mail Automation',
    family: 'Administration',
    after: 'admin-email-rules',
    purpose: 'The 40 ready automations: switch on or off, edit, time, plants, send a test.',
  },
  {
    id: 'quality-certificate',
    title: 'Quality Certificates',
    family: 'Quality / QMS',
    after: 'qms-final',
    purpose: 'Quality certificates with release approval and a customer copy.',
  },
  {
    id: 'hr-offer-letter',
    title: 'Offer & Appointment Letters',
    family: 'HRMS',
    after: 'hr-onboarding',
    purpose: 'Letters from approved templates, issued only after approval.',
  },
  {
    id: 'hr-attendance-devices',
    title: 'Devices & Sync',
    family: 'HRMS',
    after: 'hr-attendance',
    purpose: 'Biometric devices, agents and the sync log.',
  },
  {
    id: 'hr-attendance-policies',
    title: 'Attendance Policies',
    family: 'HRMS',
    after: 'hr-attendance-devices',
    purpose: 'Late marks, missed punches, absences, overtime, mobile punch and the month lock, per plant.',
  },
  {
    id: 'hr-geo-sites',
    title: 'Punch Sites',
    family: 'HRMS',
    after: 'hr-attendance-policies',
    purpose: 'Geo-fenced sites for mobile punch.',
  },
  {
    id: 'att-live-board',
    title: 'Live Attendance Board',
    family: 'HRMS',
    after: 'hr-geo-sites',
    purpose: 'Who is inside now, per plant and department.',
  },
  {
    id: 'ops-tasks',
    title: 'Task Management',
    family: 'Executive',
    after: 'dept-movement-inbox',
    purpose: 'Tasks for every employee: register, board, my tasks, overdue, workload, approval.',
  },
  {
    id: 'ops-shift-roster',
    title: 'Shift Roster & Handover',
    family: 'HRMS',
    after: 'hr-shifts',
    purpose: 'Shift handover between the outgoing and the incoming in-charge.',
  },
  {
    id: 'ops-visitors',
    title: 'Visitor Management',
    family: 'Logistics / Fleet',
    after: 'gate-return',
    purpose: 'Visitors from pre-approval to the gate and out.',
  },
  {
    id: 'ops-canteen',
    title: 'Canteen',
    family: 'HRMS',
    after: 'ops-shift-roster',
    purpose: 'Meals served by scan, rates, entitlement, cost and the payroll deduction.',
  },
  {
    id: 'cl-command-center',
    title: 'Contract Labour Command Center',
    family: 'Executive',
    after: 'dept-movement-inbox',
    purpose: 'Workers on site, licences expiring, wage sheets, blocked bills, incidents.',
  },
  {
    id: 'cl-contractors',
    title: 'Contractors',
    family: 'HRMS',
    after: 'hr-attendance',
    purpose: 'Contractor register with licence, agreement and insurance.',
  },
  {
    id: 'cl-workorders',
    title: 'Contract Work Orders',
    family: 'HRMS',
    after: 'cl-contractors',
    purpose: 'Work orders with headcount, rate and budget.',
  },
  {
    id: 'cl-workers',
    title: 'Contract Workers',
    family: 'HRMS',
    after: 'cl-workorders',
    purpose: 'Worker register with KYC, medical and safety checks.',
  },
  {
    id: 'cl-onboarding',
    title: 'Worker Onboarding',
    family: 'HRMS',
    after: 'cl-workers',
    purpose: 'KYC, medical, induction, police verification and PPE.',
  },
  {
    id: 'cl-deployment',
    title: 'Worker Deployment',
    family: 'HRMS',
    after: 'cl-onboarding',
    purpose: 'Deploy a worker to a work order only when everything is valid.',
  },
  {
    id: 'cl-attendance',
    title: 'Contract Attendance',
    family: 'HRMS',
    after: 'cl-deployment',
    purpose: 'Daily muster from the device punches.',
  },
  {
    id: 'cl-wages',
    title: 'Contract Wages',
    family: 'HRMS',
    after: 'cl-attendance',
    purpose: 'Wage sheets, wage lines and bank advice.',
  },
  {
    id: 'cl-invoices',
    title: 'Contractor Bills',
    family: 'HRMS',
    after: 'cl-wages',
    purpose: 'Contractor bills reconciled to the muster; payment blocked until the proofs are in.',
  },
  {
    id: 'cl-compliance',
    title: 'Contract Compliance',
    family: 'HRMS',
    after: 'cl-invoices',
    purpose: 'Compliance score and the monthly proofs.',
  },
  {
    id: 'cl-incidents',
    title: 'Contract Safety Incidents',
    family: 'HRMS',
    after: 'cl-compliance',
    purpose: 'Safety incidents of contract workers.',
  },
  {
    id: 'admin-sessions',
    title: 'Sessions',
    family: 'Administration',
    after: 'admin-security',
    purpose: 'Live sign-ins with force logout.',
  },
  {
    id: 'admin-login-policies',
    title: 'Login Policies',
    family: 'Administration',
    after: 'admin-sessions',
    purpose: 'Sign-in hours and IP ranges per role.',
  },
  {
    id: 'admin-view-as',
    title: 'View As',
    family: 'Administration',
    after: 'admin-login-policies',
    purpose: 'See the ERP as another person, read-only.',
  },
  {
    id: 'admin-health',
    title: 'System Health',
    family: 'Administration',
    after: 'admin-view-as',
    purpose: 'Database, queues and email health.',
  },
  {
    id: 'admin-module-plants',
    title: 'Modules per Plant',
    family: 'Administration',
    after: 'admin-health',
    purpose: 'Switch a module on or off for a plant or a role.',
  },
  {
    id: 'admin-webhooks',
    title: 'Outbound Webhooks',
    family: 'Administration',
    after: 'admin-integrations',
    purpose: 'Webhook endpoints, deliveries, the dead-letter queue and replay.',
  },
  {
    id: 'proj-stage-gates',
    title: 'Project Stage Gates',
    family: 'Projects',
    after: 'proj-gantt',
    purpose: 'Product development gates (BLDC / SPPM / custom) with readiness and approval.',
  },
  {
    id: 'proj-specifications',
    title: 'Engineering Specifications',
    family: 'Projects',
    after: 'proj-stage-gates',
    purpose: 'Project parameters with target and tolerance, by revision.',
  },
  {
    id: 'proj-test-records',
    title: 'Project Test Records',
    family: 'Projects',
    after: 'proj-specifications',
    purpose: 'Test results against the specifications (OK / NG).',
  },
  {
    id: 'proj-documents',
    title: 'Project Documents',
    family: 'Projects',
    after: 'proj-test-records',
    purpose: 'Project documents by type and revision; the dossier PDF.',
  },
] as const;

const builtFamilies = rawRegistry.families.map((f) => {
  const items = f.items.map((i) => ({ ...i, title: TITLE_OVERRIDES[i.id] ?? i.title }));
  for (const extra of PHASE_ADDED_PAGES) {
    if (extra.family !== f.name || ('hidden' in extra && extra.hidden) || items.some((i) => i.id === extra.id)) continue;
    const at = extra.after ? items.findIndex((i) => i.id === extra.after) : -1;
    if (!extra.after) {
      items.unshift({ id: extra.id, title: extra.title });
    } else {
      items.splice(at >= 0 ? at + 1 : items.length, 0, { id: extra.id, title: extra.title });
    }
  }
  return { ...f, items };
});

const DEPT_INBOX_ITEMS = [
  { id: 'dept-inbox-administration', title: 'Administration Inbox (0)' },
  { id: 'dept-inbox-sales', title: 'Sales Inbox (0)' },
  { id: 'dept-inbox-projects', title: 'Projects Inbox (0)' },
  { id: 'dept-inbox-engineering', title: 'Engineering Inbox (0)' },
  { id: 'dept-inbox-purchase', title: 'Purchase Inbox (0)' },
  { id: 'dept-inbox-warehouse', title: 'Warehouse Inbox (0)' },
  { id: 'dept-inbox-production', title: 'Production Inbox (0)' },
  { id: 'dept-inbox-quality', title: 'Quality Inbox (0)' },
  { id: 'dept-inbox-finance', title: 'Finance Inbox (0)' },
  { id: 'dept-inbox-service', title: 'Service Inbox (0)' },
  { id: 'dept-inbox-maintenance', title: 'Maintenance Inbox (0)' },
  { id: 'dept-inbox-hr', title: 'HR Inbox (0)' },
];

if (!builtFamilies.some((f) => f.name === 'Department Inboxes')) {
  const execIdx = builtFamilies.findIndex((f) => f.name === 'Executive');
  builtFamilies.splice(execIdx >= 0 ? execIdx + 1 : 1, 0, {
    name: 'Department Inboxes',
    icon: 'INBOX',
    items: DEPT_INBOX_ITEMS,
  });
}

export const registry: typeof rawRegistry = {
  ...rawRegistry,
  families: builtFamilies,
  profiles: {
    ...rawRegistry.profiles,
    ...Object.fromEntries(
      PHASE_ADDED_PAGES.map((p) => [
        p.id,
        { title: p.title, family: p.family, purpose: p.purpose, tabs: [], fields: [] },
      ]),
    ),
  },
};

const ALL_FAMILIES_ROLES: readonly RoleCode[] = ['SUPER_ADMIN', 'ADMIN'];

/** Families visible to a user: SUPER_ADMIN/ADMIN see all; others see deptFamilies[department]. */
export function familiesFor(
  role: RoleCode,
  department: string | null,
  families: RegistryFamily[] = registry.families,
  deptFamilies: Record<string, string[] | undefined> = registry.deptFamilies,
): RegistryFamily[] {
  if (ALL_FAMILIES_ROLES.includes(role)) return families;
  if (!department) return [];
  const allowed = deptFamilies[department];
  if (!allowed) return [];
  if (allowed.includes('*')) return families;
  return families.filter((f) => allowed.includes(f.name));
}

/** Pages only SUPER_ADMIN/ADMIN may open; hidden from the menu for everyone else. */
export const ADMIN_ONLY_PAGES: readonly string[] = ['admin-users'];

/**
 * The sidebar menu: familiesFor() minus admin-only items for roles below ADMIN (even in the
 * Administration department, whose "*" grants every family). The route still guards itself.
 */
export function menuFor(role: RoleCode, department: string | null): RegistryFamily[] {
  const families = familiesFor(role, department);
  if (ALL_FAMILIES_ROLES.includes(role)) return families;
  return families
    .map((f) => ({ ...f, items: f.items.filter((i) => !ADMIN_ONLY_PAGES.includes(i.id)) }))
    .filter((f) => f.items.length > 0);
}

/** Prototype renderMenu(filter): a family matches by its name, otherwise items match by title. */
export function filterMenu(families: RegistryFamily[], filter: string): RegistryFamily[] {
  const q = filter.trim().toLowerCase();
  if (!q) return families;
  const out: RegistryFamily[] = [];
  for (const fam of families) {
    const famHit = fam.name.toLowerCase().includes(q);
    const items = famHit ? fam.items : fam.items.filter((i) => i.title.toLowerCase().includes(q));
    if (items.length) out.push({ ...fam, items });
  }
  return out;
}

export interface PageLookup {
  item: RegistryItem;
  family: RegistryFamily;
  purpose: string | null;
}

export function findPage(pageId: string, families: RegistryFamily[]): PageLookup | null {
  for (const family of families) {
    const item = family.items.find((i) => i.id === pageId);
    if (item) return { item, family, purpose: registry.profiles[pageId]?.purpose ?? null };
  }
  return null;
}

export function isAdminRole(role: RoleCode): boolean {
  return ALL_FAMILIES_ROLES.includes(role);
}

const ITEM_INDEX = new Map<string, { item: RegistryItem; family: RegistryFamily }>();
for (const family of registry.families) {
  for (const item of family.items) ITEM_INDEX.set(item.id, { item, family });
}
for (const extra of PHASE_ADDED_PAGES) {
  if (!ITEM_INDEX.has(extra.id)) {
    ITEM_INDEX.set(extra.id, {
      item: { id: extra.id, title: extra.title },
      family: { name: extra.family, icon: 'INBOX', items: [] },
    });
  }
}

/** The registry stays the source of titles and icons; the server decides which items appear. */
export function withRegistryLabels(families: RegistryFamily[]): RegistryFamily[] {
  return families.map((f) => {
    const regFamily = registry.families.find((r) => r.name === f.name);
    return {
      name: f.name,
      icon: regFamily?.icon ?? f.icon,
      items: f.items.map((i) => ({ id: i.id, title: ITEM_INDEX.get(i.id)?.item.title ?? i.title })),
    };
  });
}

/** Any registry page, regardless of access (access is decided by GET /me/permissions). */
export function lookupPage(pageId: string): PageLookup | null {
  const found = findPage(pageId, registry.families);
  if (found) return found;
  const extra = PHASE_ADDED_PAGES.find((p) => p.id === pageId);
  if (extra) {
    return {
      item: { id: extra.id, title: extra.title },
      family: { name: extra.family, icon: 'FOLDER', items: [] },
      purpose: extra.purpose ?? null,
    };
  }
  return null;
}
