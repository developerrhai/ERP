// apps/api/tests/kit-lookups.test.ts
// Tests for Kit Lookup registry and /lookups/:slug (docs/plans/07-ENGINE-KIT.md §2.7 & T-KIT-03)

import { Router } from 'express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { invalidateAccessCache } from '../src/core/rbac/access';
import { bootKit } from '../src/kit/boot';
import { clearKitRegistrationsForTest, registerKitModule } from '../src/kit/registry';
import { defineKitSchema } from '../src/kit/schema';
import { API, newApp, signInAs, signInOwner } from './helpers';
import type { Signed } from './helpers';

describe('T-KIT-03 — Kit Lookups Registry and Route', () => {
  const origAllow = process.env.KIT_ALLOW_TEST_PAGES;
  const app = newApp();
  let owner: Signed;
  let memberWithoutAccess: Signed;

  beforeAll(async () => {
    process.env.KIT_ALLOW_TEST_PAGES = 'true';
    owner = await signInOwner(app);
    // User in HR department has no view permission on Manufacturing or SCM family pages by default
    memberWithoutAccess = await signInAs(app, 'MEMBER', { department: 'HR' });
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

  it('1. known slug returns items', async () => {
    registerKitModule('mod-lookup-1', (kit) => {
      kit.lookup({
        name: 'testVendors',
        pageId: 'qms-supplier',
        search: async (_db, _caller, q, limit, filters) => {
          return [
            { id: 'v1', code: 'VEN-001', name: 'Vendor 1', extra: { city: 'Pune' } },
            { id: 'v2', code: 'VEN-002', name: 'Vendor 2', extra: { city: 'Mumbai' } },
          ];
        },
      });
    });

    bootKit(Router());
    invalidateAccessCache();

    const res = await request(app).get(`${API}/lookups/test-vendors`).set(owner.bearer);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].code).toBe('VEN-001');
    expect(res.body.data[0].extra?.city).toBe('Pune');
  });

  it('2. limit=51 -> 422', async () => {
    registerKitModule('mod-lookup-limit', (kit) => {
      kit.lookup({
        name: 'testLimitLookup',
        pageId: 'qms-supplier',
        search: async () => [],
      });
    });

    bootKit(Router());
    invalidateAccessCache();

    const res = await request(app)
      .get(`${API}/lookups/test-limit-lookup?limit=51`)
      .set(owner.bearer);

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('3. unknown -> 404', async () => {
    bootKit(Router());
    invalidateAccessCache();

    const res = await request(app).get(`${API}/lookups/non-existent-lookup-slug`).set(owner.bearer);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('4. permission 403 without view', async () => {
    registerKitModule('mod-lookup-perm', (kit) => {
      kit.lookup({
        name: 'restrictedLookup',
        pageId: 'mfg-work-orders',
        search: async () => [{ id: '1', code: 'WO-1', name: 'WO 1' }],
      });
    });

    bootKit(Router());
    invalidateAccessCache();

    // HR member has no access to Manufacturing family
    const res = await request(app)
      .get(`${API}/lookups/restricted-lookup`)
      .set(memberWithoutAccess.bearer);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('5. kebab slug mapping', async () => {
    registerKitModule('mod-lookup-kebab', (kit) => {
      kit.lookup({
        name: 'purchaseOrders',
        pageId: 'qms-supplier',
        search: async () => [{ id: 'po-1', code: 'PO-001', name: 'Purchase Order 1' }],
      });
    });

    bootKit(Router());
    invalidateAccessCache();

    const res = await request(app).get(`${API}/lookups/purchase-orders`).set(owner.bearer);

    expect(res.status).toBe(200);
    expect(res.body.data[0].code).toBe('PO-001');
  });

  it('6. boot throws for a field naming an unregistered lookup', () => {
    const invalidSchema = defineKitSchema({
      pageId: 'kit-bad-lookup-page',
      title: 'Bad Lookup Page',
      family: 'Quality / QMS',
      purpose: 'Testing lookup validation',
      department: 'Quality',
      statuses: ['Draft'],
      editableStatuses: ['Draft'],
      actions: [],
      fields: [
        { key: 'code', label: 'Code', type: 'code', required: true, readOnly: true },
        { key: 'status', label: 'Status', type: 'status', required: true, readOnly: true },
        {
          key: 'ghostRef',
          label: 'Ghost Reference',
          type: 'ref',
          required: false,
          readOnly: false,
          lookup: 'ghost-nonexistent-lookup',
        },
      ],
      tabs: ['Register'],
    });

    registerKitModule('mod-bad-lookup', (kit) => {
      kit.page({
        schema: invalidSchema,
        handler: {
          pageId: 'kit-bad-lookup-page',
          list: async () => ({ rows: [], total: 0 }),
          get: async () => ({}) as any,
        },
      });
    });

    expect(() => bootKit(Router())).toThrow(
      'KIT: field kit-bad-lookup-page.ghostRef names unregistered lookup ghost-nonexistent-lookup',
    );
  });
});
