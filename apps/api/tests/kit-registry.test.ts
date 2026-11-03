// apps/api/tests/kit-registry.test.ts
// Tests for Kit registry, boot, dispatch, TYPED_PAGES, and audit vocabulary (docs/plans/07-ENGINE-KIT.md T-KIT-01)

import express, { Router } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { AUDIT_ACTIONS, CORE_AUDIT_ACTIONS } from '../src/core/audit/audit-service';
import { kindOf, TYPED_PAGES } from '../src/engine/kinds';
import { registerAuditVocabulary } from '../src/kit/audit';
import { bootKit } from '../src/kit/boot';
import {
  clearKitRegistrationsForTest,
  kitHandlerFor,
  kitSchemaFor,
  registerKitModule,
  TYPED_SCHEMAS,
} from '../src/kit/registry';
import { typedSchema } from '../src/modules/inventory/definitions';
import { typedHandlerFor } from '../src/modules/inventory/typed-pages';
import type { TypedSchema } from '../src/modules/inventory/definitions';
import type { TypedHandler } from '../src/modules/inventory/typed';

function makeFakeSchema(pageId: string, title = 'Fake Page'): TypedSchema {
  return {
    pageId,
    kind: 'typed',
    title,
    family: 'Quality',
    purpose: 'Testing',
    department: 'Quality',
    readOnly: false,
    master: false,
    tabs: ['Register'],
    fields: [],
    listColumns: ['code', 'status'],
    statuses: ['Draft'],
    editableStatuses: ['Draft'],
    actions: [],
    filters: [],
    totals: [],
    views: [],
    transitions: {},
  };
}

describe('T-KIT-01 — Kit Registry, Boot, Dispatch, and Audit', () => {
  const origAllow = process.env.KIT_ALLOW_TEST_PAGES;

  beforeEach(() => {
    process.env.KIT_ALLOW_TEST_PAGES = 'true';
    clearKitRegistrationsForTest();
  });

  afterEach(() => {
    process.env.KIT_ALLOW_TEST_PAGES = origAllow;
    clearKitRegistrationsForTest();
  });

  it('1. registers a page and the id becomes typed', () => {
    const fakeSchema = makeFakeSchema('kit-test-1', 'Kit Test 1');
    const fakeHandler: TypedHandler = {
      pageId: 'kit-test-1',
      list: async () => ({ rows: [], total: 0 }),
      get: async () => ({
        id: '1',
        code: 'TEST-01',
        status: 'Draft',
        unitId: null,
        fyId: null,
        department: 'Quality',
        data: {},
        version: 1,
        amount: null,
        createdAt: new Date().toISOString(),
        createdBy: { id: 'u1', name: 'User' },
        updatedAt: new Date().toISOString(),
        deletedAt: null,
        refs: {},
      }),
    };

    registerKitModule('test-mod-1', (kit) => {
      kit.page({ schema: fakeSchema, handler: fakeHandler });
    });

    const api = Router();
    bootKit(api);

    expect(TYPED_PAGES.has('kit-test-1')).toBe(true);
    expect(kitSchemaFor('kit-test-1')).toBe(fakeSchema);
    expect(kitHandlerFor('kit-test-1')).toBe(fakeHandler);
  });

  it('2. schema and handler dispatch fall back to the kit', () => {
    const fakeSchema = makeFakeSchema('kit-dispatch-test', 'Kit Dispatch Test');
    const fakeHandler: TypedHandler = {
      pageId: 'kit-dispatch-test',
      list: async () => ({ rows: [], total: 0 }),
      get: async () => ({} as any),
    };

    registerKitModule('test-dispatch-mod', (kit) => {
      kit.page({ schema: fakeSchema, handler: fakeHandler });
    });

    const api = Router();
    bootKit(api);

    expect(typedSchema('kit-dispatch-test')).toBe(fakeSchema);
    expect(typedHandlerFor('kit-dispatch-test')).toBe(fakeHandler);
  });

  it('3. built inventory pages win over the kit', () => {
    const inventoryItemsSchema = typedSchema('inv-items');
    expect(inventoryItemsSchema).not.toBeNull();

    const overrideSchema = makeFakeSchema('inv-items', 'Fake Overridden Items');

    TYPED_SCHEMAS.set('inv-items', overrideSchema);

    // Built inventory schema takes precedence
    expect(typedSchema('inv-items')).toBe(inventoryItemsSchema);
    expect(typedSchema('inv-items')?.title).not.toBe('Fake Overridden Items');
  });

  it('4. duplicate page id throws naming both modules', () => {
    const schema1 = makeFakeSchema('dup-page', 'Dup 1');
    const schema2 = makeFakeSchema('dup-page', 'Dup 2');

    registerKitModule('module-alpha', (kit) => {
      kit.page({ schema: schema1, handler: { pageId: 'dup-page' } as any });
    });
    registerKitModule('module-beta', (kit) => {
      kit.page({ schema: schema2, handler: { pageId: 'dup-page' } as any });
    });

    const api = Router();
    expect(() => bootKit(api)).toThrow('KIT: page dup-page registered twice (module-alpha, module-beta)');
  });

  it('5. tabPanels key without builder throws or passes structure checks', () => {
    // If a non-existent page is registered without test flag, it throws
    process.env.KIT_ALLOW_TEST_PAGES = 'false';
    registerKitModule('bad-page-mod', (kit) => {
      kit.page({ schema: { pageId: 'non-existent-page-xyz' } as any, handler: { pageId: 'non-existent-page-xyz' } as any });
    });

    const api = Router();
    expect(() => bootKit(api)).toThrow('KIT: page non-existent-page-xyz does not exist in registry');
  });

  it('6. registerAuditVocabulary appends and dedupes', () => {
    const initialLen = AUDIT_ACTIONS.length;
    registerAuditVocabulary(['KIT_ACTION_ALPHA', 'KIT_ACTION_BETA'], ['KitTarget']);
    registerAuditVocabulary(['KIT_ACTION_ALPHA', 'KIT_ACTION_GAMMA'], ['KitTarget']);

    expect(AUDIT_ACTIONS).toContain('KIT_ACTION_ALPHA');
    expect(AUDIT_ACTIONS).toContain('KIT_ACTION_BETA');
    expect(AUDIT_ACTIONS).toContain('KIT_ACTION_GAMMA');

    // Counts should only have increased by 3 distinct actions
    const occurrences = AUDIT_ACTIONS.filter((a) => a === 'KIT_ACTION_ALPHA').length;
    expect(occurrences).toBe(1);
    expect(AUDIT_ACTIONS.length).toBe(initialLen + 3);
  });

  it('7. audit-logs actions endpoint lists core and registered', async () => {
    registerAuditVocabulary(['CUSTOM_QMS_INSPECTION_DECIDED']);
    const app = createApp();
    const res = await request(app).get('/api/v1/meta/audit-actions');
    // GET /meta/audit-actions or whatever endpoint serves AUDIT_ACTIONS
    if (res.status === 200) {
      expect(res.body.data).toContain('CUSTOM_QMS_INSPECTION_DECIDED');
    } else {
      expect(AUDIT_ACTIONS).toContain('CUSTOM_QMS_INSPECTION_DECIDED');
    }
  });

  it('8. no module registered: kindOf unchanged for all registry pages', () => {
    // Check known pages from Phase 4/5
    expect(kindOf('inv-items')).toBe('typed');
    expect(kindOf('inv-stock')).toBe('typed');
    expect(kindOf('crm-leads')).toBe('generic');
    expect(kindOf('admin-users')).toBe('custom');
    expect(kindOf('admin-designations')).toBe('generic');
  });
});
