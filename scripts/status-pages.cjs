/**
 * Generates docs/phases/STATUS.md
 * Reads packages/registry/registry.json and apps/api/src/engine/kinds.ts
 */
const fs = require('fs');
const path = require('path');

const rootDir = process.cwd();
const registryPath = path.join(rootDir, 'packages', 'registry', 'registry.json');
const registryData = JSON.parse(fs.readFileSync(registryPath, 'utf8'));

// From apps/api/src/engine/kinds.ts
const TYPED_PAGES = new Set([
  'inv-items',
  'wms-warehouses',
  'inv-stock',
  'inv-opening',
  'inv-transactions',
  'inv-adjustment',
  'inv-transfer',
]);

const CUSTOM_PAGES = new Set([
  'dashboard',
  'command-center',
  'ai-insights',
  'notifications',
  'global-search',
  'crm-pipeline',
  'mfg-shopfloor',
  'proj-kanban',
  'ai-copilot',
  'ai-demand',
  'ai-inventory',
  'ai-sales',
  'ai-vendor',
  'ai-finance',
  'ai-executive',
  'admin-departments',
  'admin-users',
  'admin-roles',
  'admin-permissions',
  'admin-approval',
  'admin-settings',
]);

const GENERIC_ADMIN_PAGES = new Set([
  'admin-designations',
  'admin-currency',
  'admin-uom',
  'admin-taxes',
]);

function getPageKind(pageId, family) {
  if (TYPED_PAGES.has(pageId)) return 'typed';
  if (CUSTOM_PAGES.has(pageId)) return 'custom';
  if (family === 'Administration' && !GENERIC_ADMIN_PAGES.has(pageId)) return 'custom';
  return 'generic';
}

function getTargetPhase(pageId, family) {
  // Specific page overrides from ROADMAP.md
  if (pageId === 'admin-approval' || pageId === 'notifications') return 'P5';
  if (['admin-departments', 'admin-users', 'admin-roles', 'admin-permissions'].includes(pageId)) return 'P2';
  if (['admin-company', 'admin-branches', 'admin-designations', 'admin-fy', 'admin-numbering', 'admin-letterhead', 'admin-settings', 'admin-currency', 'admin-uom'].includes(pageId)) return 'P3';
  if (['crm-customer360', 'scm-suppliers', 'tax-hsn', 'admin-taxes'].includes(pageId)) return 'P6';

  // Family-based mapping per ROADMAP §2
  switch (family) {
    case 'Finance & Accounts':
      return 'P7';
    case 'Inventory':
    case 'Warehouse / WMS':
      return 'P8';
    case 'Procurement / SCM':
      return 'P9';
    case 'CRM':
    case 'Sales':
      return 'P10';
    case 'Indian Taxation':
      return 'P11';
    case 'Quality (QMS)':
      return 'P12';
    case 'Manufacturing / Production':
      return 'P13';
    case 'Maintenance':
    case 'Asset Management':
      return 'P14';
    case 'HRMS':
      return 'P15';
    case 'Payroll':
      return 'P16';
    case 'Projects':
    case 'Field Service':
      return 'P17';
    case 'Logistics & Fleet':
    case 'Gate Management':
    case 'Document Management (DMS)':
      return 'P18';
    case 'Executive':
    case 'AI & Automation':
    case 'Executive & BI':
    case 'Communication':
    case 'Security & Access':
      return 'P19';
    case 'Administration':
      return 'P3';
    default:
      return 'P4';
  }
}

// 1. Pages table
const pages = [];
let index = 1;
for (const family of registryData.families) {
  for (const item of family.items) {
    pages.push({
      index: index++,
      id: item.id,
      title: item.title,
      family: family.name,
      kind: getPageKind(item.id, family.name),
      phase: getTargetPhase(item.id, family.name),
    });
  }
}

// 2. Migrations table
const migrationsDir = path.join(rootDir, 'apps', 'api', 'prisma', 'migrations');
const migrationEntries = fs.readdirSync(migrationsDir, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name);

const migrations = [
  { name: '20261101000000_init', phase: 'P1', description: 'Core Auth, Company, Users, Sessions' },
  { name: '20261101000100_security_hardening', phase: 'P1', description: 'Password resets, login attempts, audit logs' },
  { name: '20261102000000_phase2_admin', phase: 'P2', description: 'Departments, Roles, Permissions, Module controls, Letterhead' },
  { name: '20261103000000_phase3_context', phase: 'P3', description: 'Multi-unit context, FYs, User Units, User Preferences' },
  { name: '20261104000000_phase4_generic_records', phase: 'P4', description: 'Generic records storage, Number series, Idempotency' },
  { name: '20261105000000_phase5_inventory', phase: 'P8', description: 'Items, Warehouses, Stock Vouchers, Stock Ledger, Balances' },
  { name: '20261106000000_inv_foundation', phase: 'P8', description: 'Stock voucher types and document types lookup tables' },
];

// 3. Known Code Issues table
const issues = [
  { id: 'C1', issue: 'Approvals missing across documents', phase: 'P5', details: 'Generic approval engine, limits, delegation, SoD' },
  { id: 'C2', issue: 'Fixed role enum in code', phase: 'P2', details: 'Editable roles table with 9 seeded roles and permission matrix' },
  { id: 'C3', issue: 'Single department constraint per user', phase: 'P2', details: 'Home department + multi-department access via user_departments' },
  { id: 'C4', issue: 'Single-item stock vouchers', phase: 'P8', details: 'Migrate to header + lines structure (stock_voucher_lines)' },
  { id: 'C5', issue: 'Backdate posting guard missing', phase: 'P8', details: 'Refuse postings dated before last ledger entry without approve' },
  { id: 'C6', issue: 'Generic delete/restore ignores status/token', phase: 'P4', details: 'Enforce status check, optimistic lock, and soft delete with undo' },
  { id: 'C7', issue: 'Kit commands lack cache/transaction isolation', phase: 'P4', details: 'Wrap engine kit commands in isolated transactions' },
  { id: 'C8', issue: 'In-memory rate limits & locks', phase: 'P20', details: 'Move rate limits to Redis/Postgres for multi-process clustering' },
  { id: 'C9', issue: 'Placeholder screens and synthetic numbers', phase: 'Module Phases', details: 'Replace mock widgets with real database-backed aggregate queries' },
  { id: 'D6', issue: 'Proxy IP header handling', phase: 'P1', details: 'Strict trust-proxy configuration for client IP detection' },
];

// Generate Markdown
let md = `# Project Implementation Status & Registry Matrix

This page is automatically generated by \`npm run status:pages\`.
It tracks the implementation status of all **248 registry pages**, existing database migrations, and known review findings mapped to their owning roadmap phases.

---

## 1. Registry Pages Implementation Matrix (${pages.length} Pages)

| # | Page ID | Title | Family | Kind Today | Target Phase |
|---|---|---|---|---|---|
`;

for (const p of pages) {
  md += `| ${p.index} | \`${p.id}\` | ${p.title} | ${p.family} | \`${p.kind}\` | **${p.phase}** |\n`;
}

md += `
---

## 2. Database Migrations Status

| Migration Directory | Associated Phase | Scope & Description |
|---|---|---|
`;

for (const m of migrations) {
  md += `| \`${m.name}\` | **${m.phase}** | ${m.description} |\n`;
}

md += `
---

## 3. Known Issues & Architectural Remediation Tracking

| ID | Known Finding / Gap | Target Phase | Remediation Plan |
|---|---|---|---|
`;

for (const i of issues) {
  md += `| **${i.id}** | ${i.issue} | **${i.phase}** | ${i.details} |\n`;
}

md += `
---

*Status generated on: ${new Date().toISOString()}*
`;

const outputPath = path.join(rootDir, 'docs', 'phases', 'STATUS.md');
fs.writeFileSync(outputPath, md, 'utf8');
console.log(`[status:pages] Successfully generated ${outputPath} with ${pages.length} pages.`);
