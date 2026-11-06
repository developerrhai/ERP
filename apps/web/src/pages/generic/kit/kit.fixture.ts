// apps/web/src/pages/generic/kit/kit.fixture.ts
// Test fixture schema and mock data for Web Kit contract testing (docs/plans/07-ENGINE-KIT.md §12 T-KIT-12)

import type { PageSchema, RecordRow } from '../engineApi';

export const mockKitTestSchema: PageSchema = {
  kind: 'typed',
  pageId: 'kit-test',
  title: 'Kit Test Fixture Page',
  family: 'Quality / QMS',
  purpose: 'End-to-end verification of all Engine Kit extensions in the UI',
  ownerDepartment: 'Quality',
  approvalRequired: false,
  statuses: ['Draft', 'Active', 'Closed'],
  editableStatuses: ['Draft'],
  tabs: ['Register', 'Metrics', 'Kanban', 'Lines', 'History'],
  listColumns: ['code', 'title', 'category', 'severity', 'status'],
  fields: [
    { key: 'code', label: 'Code', type: 'code', required: true, readOnly: true },
    { key: 'title', label: 'Title', type: 'text', required: true, readOnly: false },
    {
      key: 'category',
      label: 'Category',
      type: 'enum',
      options: ['Mechanical', 'Electrical'],
      required: true,
      readOnly: false,
    },
    {
      key: 'severity',
      label: 'Severity',
      type: 'enum',
      options: ['Low', 'Medium', 'High'],
      required: true,
      readOnly: false,
    },
    { key: 'score', label: 'Score', type: 'qty', required: false, readOnly: false, suffix: 'pts' },
    { key: 'status', label: 'Status', type: 'status', required: true, readOnly: true },
  ],
  filters: [
    {
      key: 'severity',
      label: 'Severity',
      type: 'select',
      param: 'severity',
      options: ['Low', 'Medium', 'High'],
    },
    { key: 'activeOnly', label: 'Active Only', type: 'bool', param: 'activeOnly' },
  ],
  actions: [
    {
      key: 'activate',
      label: 'Activate',
      variant: 'primary',
      allowedFrom: ['Draft'],
      payloadFields: [{ key: 'reason', label: 'Activation Reason', type: 'text', required: true }],
    },
    {
      key: 'close',
      label: 'Close',
      variant: 'default',
      allowedFrom: ['Active'],
    },
  ],
  commands: [
    {
      key: 'recalc-all',
      label: 'Recalculate All',
      variant: 'primary',
      requires: 'add',
      fields: [{ key: 'multiplier', label: 'Multiplier', type: 'qty', required: true }],
    },
  ],
  tabPanels: [
    { tab: 'Metrics', key: 'kpis', scope: 'page', title: 'Overall KPIs' },
    { tab: 'Kanban', key: 'board', scope: 'page', title: 'Issue Board' },
    { tab: 'Lines', key: 'items-lines', scope: 'record', title: 'Item Lines' },
  ],
  printTemplates: [
    { key: 'formal-cert', label: 'Formal Certificate', kind: 'web', scope: 'record' },
    { key: 'summary-pdf', label: 'Monthly Summary PDF', kind: 'pdf', scope: 'page' },
  ],
};

export const mockRecords: RecordRow[] = [
  {
    id: 'f1e2d3c4-b5a6-4789-8012-3456789abcde',
    code: 'KT-0001',
    status: 'Draft',
    unitId: 'unit-1',
    fyId: 'fy-2026',
    department: 'Quality',
    createdAt: '2026-11-04T00:00:00Z',
    data: {
      code: 'KT-0001',
      title: 'Precision Bearing Test',
      category: 'Mechanical',
      severity: 'Low',
      score: 100,
      status: 'Draft',
    },
    version: 1,
  },
];
