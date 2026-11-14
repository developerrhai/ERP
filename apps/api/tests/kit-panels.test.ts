// apps/api/tests/kit-panels.test.ts
// Tests for Kit Panels DTO, registry, routes, and helpers (docs/plans/07-ENGINE-KIT.md §2.3, §2.4, §6 KR-04 & T-KIT-04)

import { Router } from 'express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Errors } from '../src/core/http/errors';
import { invalidateAccessCache } from '../src/core/rbac/access';
import { bootKit } from '../src/kit/boot';
import { kpi, pagedTable, tableSection } from '../src/kit/panels/helpers';
import { clearKitRegistrationsForTest, registerKitModule } from '../src/kit/registry';
import { defineKitSchema } from '../src/kit/schema';
import type { TypedHandler, TypedRecordDto } from '../src/modules/inventory/typed';
import { API, newApp, signInAs, signInOwner, unitIds } from './helpers';
import type { Signed } from './helpers';

describe('T-KIT-04 — Kit Panels DTO, Registry, Routes, and Helpers', () => {
  const origAllow = process.env.KIT_ALLOW_TEST_PAGES;
  const app = newApp();
  let owner: Signed;
  let manager: Signed;
  let member: Signed;
  let unitTalId: string;
  let unitSawId: string;

  beforeAll(async () => {
    process.env.KIT_ALLOW_TEST_PAGES = 'true';
    owner = await signInOwner(app);
    manager = await signInAs(app, 'MANAGER', { department: 'Quality' });
    member = await signInAs(app, 'MEMBER', { department: 'Quality' });
    const ids = await unitIds(['TAL', 'SAW']);
    unitTalId = ids[0] ?? '';
    unitSawId = ids[1] ?? '';
  });

  beforeEach(() => {
    process.env.KIT_ALLOW_TEST_PAGES = 'true';
    clearKitRegistrationsForTest();
    invalidateAccessCache();
  });

  afterEach(() => {
    clearKitRegistrationsForTest();
    invalidateAccessCache();
  });

  afterAll(() => {
    process.env.KIT_ALLOW_TEST_PAGES = origAllow;
    clearKitRegistrationsForTest();
    invalidateAccessCache();
  });

  function setupPanelsModule(overrides?: {
    builderOverview?: any;
    builderSummary?: any;
    summaryRequires?: 'approve' | 'edit';
  }) {
    const testRecordTal: TypedRecordDto = {
      id: '11111111-2222-3333-4444-555555555555',
      code: 'PANEL-REC-01',
      status: 'Draft',
      unitId: unitTalId,
      fyId: null,
      department: 'Quality',
      data: {},
      version: 1,
      amount: null,
      createdAt: new Date().toISOString(),
      createdBy: { id: owner.user.id, name: owner.user.name },
      updatedAt: new Date().toISOString(),
      deletedAt: null,
      refs: {},
    };

    const schema = defineKitSchema({
      pageId: 'kit-panels-page',
      title: 'Kit Panels Test Page',
      family: 'Quality / QMS',
      purpose: 'Testing panels',
      department: 'Quality',
      statuses: ['Draft'],
      editableStatuses: ['Draft'],
      tabs: ['Register', 'Overview Tab', 'Summary Tab'],
      tabPanels: [
        { tab: 'Overview Tab', key: 'overview', scope: 'page' },
        { tab: 'Summary Tab', key: 'summary', scope: 'record' },
      ],
      actions: [],
      fields: [
        { key: 'code', label: 'Code', type: 'code', required: true, readOnly: true },
        { key: 'status', label: 'Status', type: 'status', required: true, readOnly: true },
      ],
    });

    const handler: TypedHandler = {
      pageId: 'kit-panels-page',
      list: async () => ({ rows: [testRecordTal], total: 1 }),
      get: async (caller, id) => {
        if (id !== testRecordTal.id) throw Errors.notFound('Record not found.');
        // Check unit scope: caller without access to TAL gets 404
        if (
          caller.ctx.unitId &&
          caller.ctx.unitId !== testRecordTal.unitId &&
          !caller.ctx.allUnits
        ) {
          throw Errors.notFound('Record outside unit scope.');
        }
        return testRecordTal;
      },
    };

    registerKitModule('mod-panels', (kit) => {
      kit.page({ schema, handler });

      kit.panel(
        'kit-panels-page',
        'overview',
        'page',
        overrides?.builderOverview ??
          (async () => ({
            key: 'overview',
            title: 'Overview Panel',
            kpis: [kpi('Total Inspections', 120, 'number', 'good', 'Year to date')],
            sections: [
              tableSection({
                columns: [
                  { key: 'code', label: 'Code', format: 'text' },
                  { key: 'score', label: 'Score', format: 'number' },
                ],
                rows: [{ id: 'r1', code: 'INS-01', score: 98 }],
                meta: { page: 1, size: 20, total: 1 },
              }),
            ],
          })),
      );

      kit.panel(
        'kit-panels-page',
        'summary',
        'record',
        overrides?.builderSummary ??
          (async ({ recId }) => ({
            key: 'summary',
            title: `Summary for ${recId}`,
            kpis: [kpi('Defects', 0, 'number', 'good')],
            sections: [
              {
                type: 'facts',
                title: 'Key Metrics',
                items: [{ label: 'Inspected By', value: 'Inspector A' }],
              },
            ],
          })),
        overrides?.summaryRequires ? { requires: overrides.summaryRequires } : undefined,
      );
    });

    bootKit(Router());
    invalidateAccessCache();

    return { testRecordTal };
  }

  it('1. page panel 200 shape', async () => {
    setupPanelsModule();

    const res = await request(app)
      .get(`${API}/pages/kit-panels-page/panels/overview`)
      .set(owner.bearer);

    expect(res.status).toBe(200);
    expect(res.body.data.key).toBe('overview');
    expect(res.body.data.title).toBe('Overview Panel');
    expect(res.body.data.kpis).toHaveLength(1);
    expect(res.body.data.kpis[0].value).toBe(120);
    expect(res.body.data.sections).toHaveLength(1);
    expect(res.body.data.sections[0].type).toBe('table');
  });

  it('2. record panel 200', async () => {
    const { testRecordTal } = setupPanelsModule();

    const res = await request(app)
      .get(`${API}/pages/kit-panels-page/records/${testRecordTal.id}/panels/summary`)
      .set(owner.bearer)
      .set('X-Unit-Id', unitTalId);

    expect(res.status).toBe(200);
    expect(res.body.data.key).toBe('summary');
    expect(res.body.data.title).toContain(testRecordTal.id);
    expect(res.body.data.sections[0].type).toBe('facts');
  });

  it('3. scope mismatch 404', async () => {
    const { testRecordTal } = setupPanelsModule();

    // Calling record-scoped panel 'summary' on page endpoint -> 404
    const res1 = await request(app)
      .get(`${API}/pages/kit-panels-page/panels/summary`)
      .set(owner.bearer);

    expect(res1.status).toBe(404);
    expect(res1.body.error.code).toBe('NOT_FOUND');

    // Calling page-scoped panel 'overview' on record endpoint -> 404
    const res2 = await request(app)
      .get(`${API}/pages/kit-panels-page/records/${testRecordTal.id}/panels/overview`)
      .set(owner.bearer)
      .set('X-Unit-Id', unitTalId);

    expect(res2.status).toBe(404);
    expect(res2.body.error.code).toBe('NOT_FOUND');
  });

  it('4. other-unit record 404', async () => {
    const { testRecordTal } = setupPanelsModule();

    // Member caller querying record in TAL while locked to SAW unit -> 404
    const res = await request(app)
      .get(`${API}/pages/kit-panels-page/records/${testRecordTal.id}/panels/summary`)
      .set(member.bearer)
      .set('X-Unit-Id', unitSawId);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('5. permission 403', async () => {
    const { testRecordTal } = setupPanelsModule({ summaryRequires: 'approve' });

    // Member has no 'approve' permission -> 403 FORBIDDEN
    const res = await request(app)
      .get(`${API}/pages/kit-panels-page/records/${testRecordTal.id}/panels/summary`)
      .set(member.bearer)
      .set('X-Unit-Id', unitTalId);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('6. size=500 422', async () => {
    setupPanelsModule();

    const res = await request(app)
      .get(`${API}/pages/kit-panels-page/panels/overview?size=500`)
      .set(owner.bearer);

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('7. builder returning unknown section type -> 500', async () => {
    setupPanelsModule({
      builderOverview: async () => ({
        key: 'overview',
        title: 'Bad Section Panel',
        sections: [{ type: 'non-existent-section-type', data: 123 } as any],
      }),
    });

    const res = await request(app)
      .get(`${API}/pages/kit-panels-page/panels/overview`)
      .set(owner.bearer);

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL');
  });

  it('8. > 500 rows -> 500', async () => {
    const excessiveRows = Array.from({ length: 501 }, (_, i) => ({ id: `r${i}`, code: `C-${i}` }));

    setupPanelsModule({
      builderOverview: async () => ({
        key: 'overview',
        title: 'Too Many Rows',
        sections: [
          tableSection({
            columns: [{ key: 'code', label: 'Code', format: 'text' }],
            rows: excessiveRows,
          }),
        ],
      }),
    });

    const res = await request(app)
      .get(`${API}/pages/kit-panels-page/panels/overview`)
      .set(owner.bearer);

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL');
  });

  it('9. pagedTable paging + totals of the full set', async () => {
    const fakeRows = Array.from({ length: 45 }, (_, i) => ({
      id: `id-${i}`,
      score: i * 10,
    }));

    const result = await pagedTable({} as any, {
      rows: fakeRows,
      query: { page: 2, size: 10 },
      columns: [{ key: 'score', label: 'Score', format: 'number' }],
    });

    expect(result.meta.page).toBe(2);
    expect(result.meta.size).toBe(10);
    expect(result.meta.total).toBe(45);
    expect(result.rows).toHaveLength(10);
    expect(result.rows[0]!.id).toBe('id-10');
    expect(result.rows[9]!.id).toBe('id-19');
  });

  it('10. Cache-Control: no-store', async () => {
    setupPanelsModule();

    const res = await request(app)
      .get(`${API}/pages/kit-panels-page/panels/overview`)
      .set(owner.bearer);

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
  });
});
