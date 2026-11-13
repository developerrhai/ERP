// apps/api/tests/kit-filters.test.ts
// Tests for Kit Typed Filters validation, parsing, route wiring, and error handling (docs/plans/07-ENGINE-KIT.md §2.8, §6 KR-08 & T-KIT-06)

import { Router } from 'express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { invalidateAccessCache } from '../src/core/rbac/access';
import { bootKit } from '../src/kit/boot';
import { clearKitRegistrationsForTest, registerKitModule } from '../src/kit/registry';
import { defineKitSchema } from '../src/kit/schema';
import type { TypedHandler, TypedListQuery, TypedRecordDto } from '../src/modules/inventory/typed';
import { API, newApp, signInOwner, unitIds } from './helpers';
import type { Signed } from './helpers';

describe('T-KIT-06 — Kit Typed Filters', () => {
  const origAllow = process.env.KIT_ALLOW_TEST_PAGES;
  const app = newApp();
  let owner: Signed;
  let unitTalId: string;
  let lastListQuery: TypedListQuery | null = null;
  let lastExportQuery: TypedListQuery | null = null;

  beforeAll(async () => {
    process.env.KIT_ALLOW_TEST_PAGES = 'true';
    owner = await signInOwner(app);
    const ids = await unitIds(['TAL']);
    unitTalId = ids[0] ?? '';
  });

  beforeEach(() => {
    process.env.KIT_ALLOW_TEST_PAGES = 'true';
    clearKitRegistrationsForTest();
    invalidateAccessCache();
    lastListQuery = null;
    lastExportQuery = null;
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

  function setupFiltersModule() {
    const testRecord: TypedRecordDto = {
      id: '55555555-4444-3333-2222-111111111111',
      code: 'FLT-001',
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
      pageId: 'kit-filters-page',
      title: 'Filters Test Page',
      family: 'Quality / QMS',
      purpose: 'Testing typed filters',
      department: 'Quality',
      statuses: ['Draft'],
      editableStatuses: ['Draft'],
      tabs: ['Register'],
      commands: [],
      actions: [],
      filters: [
        { key: 'active', label: 'Active', type: 'bool', param: 'isActive' },
        {
          key: 'priority',
          label: 'Priority',
          type: 'select',
          param: 'priority',
          options: ['low', 'med', 'high'],
        },
        { key: 'tag', label: 'Tag', type: 'text', param: 'tag' },
        { key: 'dueDate', label: 'Due Date', type: 'date', param: 'dueDate' },
        { key: 'targetMonth', label: 'Target Month', type: 'month', param: 'targetMonth' },
        {
          key: 'supplier',
          label: 'Supplier',
          type: 'lookup',
          param: 'supplierId',
          lookup: 'suppliers',
        },
      ],
      fields: [
        { key: 'code', label: 'Code', type: 'code', required: true, readOnly: true },
        { key: 'status', label: 'Status', type: 'status', required: true, readOnly: true },
      ],
    });

    const handler: TypedHandler = {
      pageId: 'kit-filters-page',
      list: async (_caller, query) => {
        lastListQuery = query;
        return { rows: [testRecord], total: 1 };
      },
      exportRows: async (_caller, query) => {
        lastExportQuery = query;
        return { rows: [testRecord], total: 1 };
      },
      get: async () => testRecord,
    };

    registerKitModule('mod-filters', (kit) => {
      kit.page({ schema, handler });
      kit.lookup({
        name: 'suppliers',
        pageId: 'kit-filters-page',
        search: async () => [],
      });
    });

    bootKit(Router());
    invalidateAccessCache();

    return testRecord;
  }

  it('1. bool / select / text / date / month / lookup valid params parsed into query.filters', async () => {
    setupFiltersModule();
    const supplierUuid = 'a0000000-0000-0000-0000-000000000001';

    const res = await request(app)
      .get(`${API}/pages/kit-filters-page/records`)
      .set(owner.bearer)
      .set('X-Unit-Id', unitTalId)
      .query({
        isActive: 'true',
        priority: 'high',
        tag: 'urgent-issue',
        dueDate: '2026-05-15',
        targetMonth: '2026-05',
        supplierId: supplierUuid,
      });

    expect(res.status).toBe(200);
    expect(lastListQuery).toBeDefined();
    expect(lastListQuery?.filters).toEqual({
      isActive: true,
      priority: 'high',
      tag: 'urgent-issue',
      dueDate: '2026-05-15',
      targetMonth: '2026-05',
      supplierId: supplierUuid,
    });
  });

  it('2. undeclared query param returns 422 VALIDATION_ERROR', async () => {
    setupFiltersModule();

    const res = await request(app)
      .get(`${API}/pages/kit-filters-page/records`)
      .set(owner.bearer)
      .set('X-Unit-Id', unitTalId)
      .query({ unknownParam: 'someValue' });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.fields).toHaveProperty('unknownParam');
  });

  it('3. legacy inventory page with warehouseId and belowReorder works unchanged', async () => {
    const res = await request(app)
      .get(`${API}/pages/inv-stock/records`)
      .set(owner.bearer)
      .set('X-Unit-Id', unitTalId)
      .query({
        warehouseId: '11111111-2222-3333-4444-555555555555',
        belowReorder: 'true',
      });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('meta');
  });

  it('4. export.xlsx honours typed filters', async () => {
    setupFiltersModule();

    const res = await request(app)
      .get(`${API}/pages/kit-filters-page/records/export.xlsx`)
      .set(owner.bearer)
      .set('X-Unit-Id', unitTalId)
      .query({ priority: 'med' });

    expect(res.status).toBe(200);
    expect(res.header['content-type']).toContain('spreadsheetml');
    expect(lastExportQuery).toBeDefined();
    expect(lastExportQuery?.filters).toEqual({ priority: 'med' });
  });

  it('5. month=2026-13 returns 422 VALIDATION_ERROR', async () => {
    setupFiltersModule();

    const res = await request(app)
      .get(`${API}/pages/kit-filters-page/records`)
      .set(owner.bearer)
      .set('X-Unit-Id', unitTalId)
      .query({ targetMonth: '2026-13' });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.fields).toHaveProperty('targetMonth');
  });

  it('6. date=2026-02-30 returns 422 VALIDATION_ERROR', async () => {
    setupFiltersModule();

    const res = await request(app)
      .get(`${API}/pages/kit-filters-page/records`)
      .set(owner.bearer)
      .set('X-Unit-Id', unitTalId)
      .query({ dueDate: '2026-02-30' });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.fields).toHaveProperty('dueDate');
  });

  it('7. lookup non-UUID returns 422 VALIDATION_ERROR', async () => {
    setupFiltersModule();

    const res = await request(app)
      .get(`${API}/pages/kit-filters-page/records`)
      .set(owner.bearer)
      .set('X-Unit-Id', unitTalId)
      .query({ supplierId: 'invalid-non-uuid-string' });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.fields).toHaveProperty('supplierId');
  });

  it('8. q max length: 100 characters allowed, 101 returns 422', async () => {
    setupFiltersModule();

    // 100 chars: allowed
    const validQ = 'a'.repeat(100);
    const resOk = await request(app)
      .get(`${API}/pages/kit-filters-page/records`)
      .set(owner.bearer)
      .set('X-Unit-Id', unitTalId)
      .query({ q: validQ });

    expect(resOk.status).toBe(200);

    // 101 chars: 422
    const invalidQ = 'a'.repeat(101);
    const resBad = await request(app)
      .get(`${API}/pages/kit-filters-page/records`)
      .set(owner.bearer)
      .set('X-Unit-Id', unitTalId)
      .query({ q: invalidQ });

    expect(resBad.status).toBe(422);
    expect(resBad.body.error.code).toBe('VALIDATION_ERROR');
    expect(resBad.body.error.fields).toHaveProperty('q');
  });
});
