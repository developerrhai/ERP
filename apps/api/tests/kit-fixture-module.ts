import { randomUUID } from 'node:crypto';
import type { KitRegistrar } from '../src/kit/registry';
import { defineKitSchema } from '../src/kit/schema';
import type { TypedHandler, TypedRecordDto } from '../src/modules/inventory/typed';
import { Errors } from '../src/core/http/errors';

export interface FixtureRecord {
  id: string;
  code: string;
  status: string;
  unitId: string;
  fyId: string;
  department: string;
  title: string;
  category: string;
  severity: string;
  score: number;
  lines: Array<{ id: string; item: string; qty: number; rate: number; amount: number }>;
  createdAt: string;
  version: number;
}

/** The fixture keeps flat in-memory records; the kit tests read them back in this flat shape. */
const asDto = (rec: FixtureRecord): TypedRecordDto => rec as unknown as TypedRecordDto;

export const inMemoryStore: FixtureRecord[] = [];
let counter = 1;

export function resetFixtureStore(): void {
  inMemoryStore.length = 0;
  counter = 1;
}

export const fixtureSchema = defineKitSchema({
  pageId: 'kit-test',
  title: 'Kit Test Fixture Page',
  family: 'Quality / QMS',
  purpose: 'End-to-end verification of all Engine Kit extensions',
  department: 'Quality',
  statuses: ['Draft', 'Active', 'Closed'],
  editableStatuses: ['Draft'],
  tabs: ['Register', 'Metrics', 'Kanban', 'Schedule'],
  fields: [
    { key: 'code', label: 'Code', type: 'code', required: true, readOnly: true },
    { key: 'title', label: 'Title', type: 'text', required: true, readOnly: false },
    { key: 'category', label: 'Category', type: 'enum', options: ['Mechanical', 'Electrical'], required: true, readOnly: false },
    { key: 'severity', label: 'Severity', type: 'enum', options: ['Low', 'Medium', 'High'], required: true, readOnly: false },
    { key: 'score', label: 'Score', type: 'qty', required: false, readOnly: false },
    { key: 'status', label: 'Status', type: 'status', required: true, readOnly: true },
  ],
  filters: [
    { key: 'severity', label: 'Severity', type: 'select', param: 'severity', options: ['Low', 'Medium', 'High'] },
    { key: 'activeOnly', label: 'Active Only', type: 'bool', param: 'activeOnly' },
  ],
  actions: [
    {
      key: 'activate',
      label: 'Activate',
      variant: 'primary',
      confirm: null,
      requires: 'edit',
      allowedFrom: ['Draft'],
      payloadFields: [
        { key: 'reason', label: 'Activation Reason', type: 'text', required: false },
      ],
    },
    {
      key: 'close',
      label: 'Close',
      variant: 'default',
      confirm: null,
      requires: 'edit',
      allowedFrom: ['Active'],
    },
  ],
  commands: [
    {
      key: 'batch-recalc',
      label: 'Batch Recalculate',
      variant: 'primary',
      requires: 'add',
      confirm: null,
      fields: [
        { key: 'multiplier', label: 'Multiplier', type: 'qty', required: true },
      ],
    },
  ],
  tabPanels: [
    { tab: 'Metrics', key: 'kpis', scope: 'page', title: 'Overall KPIs' },
    { tab: 'Kanban', key: 'board', scope: 'page', title: 'Issue Board' },
    { tab: 'Audit Trail', key: 'audit-view', scope: 'record', title: 'Record Audit' },
    { tab: 'Lines', key: 'items-lines', scope: 'record', title: 'Item Lines' },
  ],
  printTemplates: [
    { key: 'formal-cert', label: 'Formal Certificate', kind: 'web', scope: 'record' },
    { key: 'summary-pdf', label: 'Monthly Summary PDF', kind: 'pdf', scope: 'page' },
  ],
});

export const fixtureHandler: TypedHandler = {
  pageId: 'kit-test',
  async list(caller, query) {
    let rows = [...inMemoryStore];
    const severity = query?.filters?.severity;
    const activeOnly = query?.filters?.activeOnly;
    if (severity) {
      rows = rows.filter((r) => r.severity === severity);
    }
    if (activeOnly === true || activeOnly === 'true') {
      rows = rows.filter((r) => r.status === 'Active');
    }
    if (query?.q) {
      const q = String(query.q).toLowerCase();
      rows = rows.filter((r) => r.title.toLowerCase().includes(q) || r.code.toLowerCase().includes(q));
    }
    return {
      rows: rows.map(asDto),
      total: rows.length,
    };
  },
  async get(caller, id) {
    const found = inMemoryStore.find((r) => r.id === id);
    if (!found) throw Errors.notFound(`Record ${id} not found.`);
    return asDto(found);
  },
  async create(caller, body) {
    const id = randomUUID();
    const code = `KT-${String(counter++).padStart(4, '0')}`;
    const rec: FixtureRecord = {
      id,
      code,
      status: 'Draft',
      unitId: caller.ctx.unitId ?? 'UNIT01',
      fyId: caller.ctx.fyId ?? 'FY26',
      department: caller.auth.user.department ?? 'Quality',
      title: String(body.title ?? 'Untitled'),
      category: String(body.category ?? 'Mechanical'),
      severity: String(body.severity ?? 'Low'),
      score: Number(body.score ?? 0),
      lines: (body.lines as any) ?? [],
      createdAt: new Date().toISOString(),
      version: 1,
    };
    inMemoryStore.push(rec);
    return asDto(rec);
  },
  async update(caller, id, version, body) {
    const idx = inMemoryStore.findIndex((r) => r.id === id);
    if (idx === -1) throw Errors.notFound(`Record ${id} not found.`);
    const existing = inMemoryStore[idx]!;
    if (version !== undefined && existing.version !== version) {
      throw Errors.versionConflict();
    }
    const updated: FixtureRecord = {
      ...existing,
      title: body.title !== undefined ? String(body.title) : existing.title,
      category: body.category !== undefined ? String(body.category) : existing.category,
      severity: body.severity !== undefined ? String(body.severity) : existing.severity,
      score: body.score !== undefined ? Number(body.score) : existing.score,
      lines: body.lines !== undefined ? (body.lines as any) : existing.lines,
      version: existing.version + 1,
    };
    inMemoryStore[idx] = updated;
    return asDto(updated);
  },
  async action(caller, id, actionKey) {
    const idx = inMemoryStore.findIndex((r) => r.id === id);
    if (idx === -1) throw Errors.notFound(`Record ${id} not found.`);
    const existing = inMemoryStore[idx]!;

    if (actionKey === 'activate') {
      if (existing.status !== 'Draft') {
        throw Errors.conflict(`Cannot activate from ${existing.status}`);
      }
      existing.status = 'Active';
      existing.version += 1;
      return { record: asDto(existing), replay: false };
    }
    if (actionKey === 'close') {
      if (existing.status !== 'Active') {
        throw Errors.conflict(`Cannot close from ${existing.status}`);
      }
      existing.status = 'Closed';
      existing.version += 1;
      return { record: asDto(existing), replay: false };
    }
    throw Errors.badRequest(`Unknown action ${actionKey}`);
  },
};

export function registerFixtureModule(kit: KitRegistrar): void {
  kit.page({ schema: fixtureSchema, handler: fixtureHandler });

  kit.panel('kit-test', 'kpis', 'page', async () => ({
    key: 'kpis',
    title: 'KPIs',
    kpis: [
      { label: 'Total Records', value: inMemoryStore.length, format: 'number' },
      { label: 'Active', value: inMemoryStore.filter((r) => r.status === 'Active').length, format: 'number', tone: 'good' },
    ],
    sections: [],
  }));

  kit.panel('kit-test', 'board', 'page', async () => ({
    key: 'board',
    title: 'Issue Board',
    sections: [
      {
        type: 'board',
        draggable: true,
        lanes: [
          {
            key: 'Draft',
            label: 'Draft',
            cards: inMemoryStore
              .filter((r) => r.status === 'Draft')
              .map((r) => ({ id: r.id, title: r.title, subtitle: r.code })),
          },
          {
            key: 'Active',
            label: 'Active',
            cards: inMemoryStore
              .filter((r) => r.status === 'Active')
              .map((r) => ({ id: r.id, title: r.title, subtitle: r.code })),
          },
          {
            key: 'Closed',
            label: 'Closed',
            cards: inMemoryStore
              .filter((r) => r.status === 'Closed')
              .map((r) => ({ id: r.id, title: r.title, subtitle: r.code })),
          },
        ],
      },
    ],
  }));

  kit.panel('kit-test', 'audit-view', 'record', async () => ({
    key: 'audit-view',
    title: 'Record Audit',
    sections: [
      {
        type: 'timeline',
        events: [
          { at: '2026-11-04T00:00:00Z', title: 'Created', detail: 'Record created in Draft state' },
        ],
      },
    ],
  }));

  kit.panel('kit-test', 'items-lines', 'record', async () => {
    return {
      key: 'items-lines',
      title: 'Item Lines',
      sections: [
        {
          type: 'lines',
          lineKind: 'kitTestLines',
          editable: true,
        },
      ],
    };
  });

  kit.command('kit-test', 'batch-recalc', async ({ payload }) => {
    const mult = Number(payload.multiplier ?? 1);
    for (const r of inMemoryStore) {
      r.score = r.score * mult;
    }
    return { message: `Recalculated with multiplier ${mult}`, result: { count: inMemoryStore.length } };
  });

  kit.lookup({
    name: 'kitComponents',
    pageId: 'kit-test',
    async search(db, caller, q) {
      const items = [
        { id: 'c-01', code: 'COMP01', name: 'Shaft 12mm' },
        { id: 'c-02', code: 'COMP02', name: 'Bearing 6204' },
      ];
      if (q) {
        return items.filter((i) => i.name.toLowerCase().includes(q.toLowerCase()) || i.code.toLowerCase().includes(q.toLowerCase()));
      }
      return items;
    },
  });

  kit.printData('kit-test', 'formal-cert', async ({ id }) => {
    const rec = inMemoryStore.find((r) => r.id === id);
    return {
      templateKey: 'formal-cert',
      title: 'Formal Quality Certificate',
      docNo: rec?.code ?? 'N/A',
      docDate: '2026-11-04',
      unit: { code: 'TAL', name: 'Talwandi Unit' },
      letterhead: { companyName: 'Sawant Testing Lab' },
      parties: [{ role: 'Auditor', name: 'Chief Inspector' }],
      facts: [{ label: 'Severity', value: rec?.severity ?? 'Low' }],
      lines: null,
      sections: [{ title: 'Findings', text: 'All dimensions adhere to standard tolerances.' }],
      totals: [],
      signatures: [{ label: 'Approved By', name: 'Head of Quality' }],
    };
  });

  kit.pdf('kit-test', 'summary-pdf', async () => Buffer.from('%PDF-1.4 kit-test summary'));
}
