// apps/api/tests/kit-schema.test.ts
// Tests for Kit schema extensions, requires, payload, readOnlyCreate, suffix, lookup (docs/plans/07-ENGINE-KIT.md T-KIT-02)

import { Router } from 'express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { invalidateAccessCache } from '../src/core/rbac/access';
import { bootKit } from '../src/kit/boot';
import { clearKitRegistrationsForTest, registerKitModule } from '../src/kit/registry';
import { defineKitSchema } from '../src/kit/schema';
import type { TypedHandler, TypedRecordDto } from '../src/modules/inventory/typed';
import { API, newApp, signInAs, signInOwner, unitIds } from './helpers';
import type { Signed } from './helpers';

describe('T-KIT-02 — Kit Schema Extensions, Actions, and Permissions', () => {
  const origAllow = process.env.KIT_ALLOW_TEST_PAGES;
  const app = newApp();
  let owner: Signed;
  let manager: Signed;
  let member: Signed;
  let unitId: string;

  beforeAll(async () => {
    process.env.KIT_ALLOW_TEST_PAGES = 'true';
    owner = await signInOwner(app);
    manager = await signInAs(app, 'MANAGER', { department: 'Quality' });
    member = await signInAs(app, 'MEMBER', { department: 'Quality' });
    const ids = await unitIds(['TAL']);
    unitId = ids[0] ?? '';
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

  it('1. extras pass through GET schema', async () => {
    const testSchema = defineKitSchema({
      pageId: 'kit-schema-extras',
      title: 'Kit Extras Test',
      family: 'Quality / QMS',
      purpose: 'Testing extras',
      department: 'Quality',
      statuses: ['Draft', 'Approved'],
      editableStatuses: ['Draft'],
      tabPanels: [
        { tab: 'Item Schedule', key: 'item-schedule', scope: 'record' },
        {
          tab: 'Release Orders',
          key: 'release-orders',
          scope: 'record',
          component: 'ScmReleaseOrders',
        },
      ],
      commands: [
        {
          key: 'auto-generate',
          label: 'Auto-generate PRs',
          variant: 'default',
          requires: 'add',
          confirm: null,
          fields: [{ key: 'horizonDays', label: 'Horizon (days)', type: 'qty', required: false }],
        },
      ],
      actions: [
        {
          key: 'approve',
          label: 'Approve',
          variant: 'primary',
          confirm: 'Approve record?',
          allowedFrom: ['Draft'],
          requires: 'approve',
          payloadFields: [
            { key: 'notes', label: 'Approval Notes', type: 'longtext', required: true },
          ],
        },
      ],
      filters: [
        { key: 'month', label: 'Month', type: 'month', param: 'month' },
        {
          key: 'supplier',
          label: 'Supplier',
          type: 'lookup',
          param: 'supplierId',
          lookup: 'suppliers',
        },
      ],
      printTemplates: [
        { key: 'po', label: 'Purchase Order', kind: 'pdf', scope: 'record', default: true },
      ],
      readOnlyCreate: true,
      fields: [
        { key: 'code', label: 'Code', type: 'code', required: true, readOnly: true },
        { key: 'status', label: 'Status', type: 'status', required: true, readOnly: true },
        {
          key: 'score',
          label: 'Score',
          type: 'qty',
          required: false,
          readOnly: false,
          suffix: '/10',
        },
      ],
      tabs: ['Register'],
    });

    registerKitModule('mod-extras', (kit) => {
      kit.page({
        schema: testSchema,
        handler: {
          pageId: 'kit-schema-extras',
          list: async () => ({ rows: [], total: 0 }),
          get: async () => ({}) as any,
        },
      });
      kit.lookup({
        name: 'suppliers',
        pageId: 'kit-schema-extras',
        search: async () => [],
      });
      kit.command('kit-schema-extras', 'auto-generate', async () => ({ message: 'ok' }));
      kit.panel('kit-schema-extras', 'item-schedule', 'record', async () => ({
        key: 'item-schedule',
        title: 'Schedule',
        sections: [],
      }));
      kit.pdf('kit-schema-extras', 'po', async () => Buffer.from('pdf'));
    });

    bootKit(Router());
    invalidateAccessCache();

    const res = await request(app).get(`${API}/pages/kit-schema-extras/schema`).set(owner.bearer);

    expect(res.status).toBe(200);
    const data = res.body.data;
    expect(data.tabPanels).toHaveLength(2);
    expect(data.commands).toHaveLength(1);
    expect(data.commands[0].key).toBe('auto-generate');
    expect(data.actions[0].requires).toBe('approve');
    expect(data.actions[0].payloadFields).toBeDefined();
    expect(data.filters).toHaveLength(2);
    expect(data.filters[0].type).toBe('month');
    expect(data.printTemplates).toHaveLength(1);
    expect(data.readOnlyCreate).toBe(true);
  });

  it('2. readOnlyCreate POST is 405 and GET works', async () => {
    const testSchema = defineKitSchema({
      pageId: 'kit-readonly-test',
      title: 'Kit Read Only Test',
      family: 'Quality / QMS',
      purpose: 'Testing readOnlyCreate',
      department: 'Quality',
      statuses: ['Draft'],
      editableStatuses: ['Draft'],
      readOnlyCreate: true,
      fields: [
        { key: 'code', label: 'Code', type: 'code', required: true, readOnly: true },
        { key: 'status', label: 'Status', type: 'status', required: true, readOnly: true },
      ],
      tabs: ['Register'],
      actions: [],
    });

    registerKitModule('mod-ro', (kit) => {
      kit.page({
        schema: testSchema,
        handler: {
          pageId: 'kit-readonly-test',
          list: async () => ({ rows: [], total: 0 }),
          get: async () => ({}) as any,
        },
      });
    });

    bootKit(Router());
    invalidateAccessCache();

    // POST should return 405 READ_ONLY
    const postRes = await request(app)
      .post(`${API}/pages/kit-readonly-test/records`)
      .set(owner.bearer)
      .set('X-Unit-Id', unitId)
      .send({ data: { test: 1 } });

    expect(postRes.status).toBe(405);
    expect(postRes.body.error.code).toBe('READ_ONLY');
    expect(postRes.body.error.message).toContain(
      'Records of this page are created by other documents.',
    );

    // GET should work (200 OK)
    const getRes = await request(app)
      .get(`${API}/pages/kit-readonly-test/records`)
      .set(owner.bearer)
      .set('X-Unit-Id', unitId);

    expect(getRes.status).toBe(200);
  });

  it('3. approve action: member 403, manager 200', async () => {
    let handledAction = false;
    const testRecord: TypedRecordDto = {
      id: '11111111-1111-1111-1111-111111111111',
      code: 'TEST-001',
      status: 'Draft',
      unitId,
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

    const testSchema = defineKitSchema({
      pageId: 'kit-approve-test',
      title: 'Kit Approve Test',
      family: 'Quality / QMS',
      purpose: 'Testing approve permission',
      department: 'Quality',
      statuses: ['Draft', 'Approved'],
      editableStatuses: ['Draft'],
      actions: [
        {
          key: 'approve',
          label: 'Approve',
          variant: 'primary',
          confirm: 'Approve?',
          allowedFrom: ['Draft'],
          requires: 'approve',
        },
      ],
      fields: [
        { key: 'code', label: 'Code', type: 'code', required: true, readOnly: true },
        { key: 'status', label: 'Status', type: 'status', required: true, readOnly: true },
      ],
      tabs: ['Register'],
    });

    const handler: TypedHandler = {
      pageId: 'kit-approve-test',
      list: async () => ({ rows: [testRecord], total: 1 }),
      get: async () => testRecord,
      action: async (_caller, id, actionName) => {
        handledAction = true;
        return {
          record: { ...testRecord, status: 'Approved', version: 2 },
          replay: false,
        };
      },
    };

    registerKitModule('mod-approve', (kit) => {
      kit.page({ schema: testSchema, handler });
    });

    bootKit(Router());
    invalidateAccessCache();

    // Member has role MEMBER -> approve is false -> 403
    const memberRes = await request(app)
      .post(`${API}/pages/kit-approve-test/records/${testRecord.id}/actions/approve`)
      .set(member.bearer)
      .set('X-Unit-Id', unitId)
      .send({});

    expect(memberRes.status).toBe(403);
    expect(memberRes.body.error.code).toBe('FORBIDDEN');

    // Manager has role MANAGER -> approve is true -> 200
    const managerRes = await request(app)
      .post(`${API}/pages/kit-approve-test/records/${testRecord.id}/actions/approve`)
      .set(manager.bearer)
      .set('X-Unit-Id', unitId)
      .send({});

    expect(managerRes.status).toBe(200);
    expect(handledAction).toBe(true);
    expect(managerRes.body.data.status).toBe('Approved');
  });

  it('4. payload accepted and passed to handler', async () => {
    let receivedPayload: Record<string, unknown> | undefined;
    const testRecord: TypedRecordDto = {
      id: '22222222-2222-2222-2222-222222222222',
      code: 'TEST-002',
      status: 'Draft',
      unitId,
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

    const testSchema = defineKitSchema({
      pageId: 'kit-payload-test',
      title: 'Kit Payload Test',
      family: 'Quality / QMS',
      purpose: 'Testing action payload',
      department: 'Quality',
      statuses: ['Draft', 'Posted'],
      editableStatuses: ['Draft'],
      actions: [
        {
          key: 'post',
          label: 'Post',
          variant: 'primary',
          confirm: null,
          allowedFrom: ['Draft'],
          requires: 'edit',
        },
      ],
      fields: [
        { key: 'code', label: 'Code', type: 'code', required: true, readOnly: true },
        { key: 'status', label: 'Status', type: 'status', required: true, readOnly: true },
      ],
      tabs: ['Register'],
    });

    registerKitModule('mod-payload', (kit) => {
      kit.page({
        schema: testSchema,
        handler: {
          pageId: 'kit-payload-test',
          list: async () => ({ rows: [testRecord], total: 1 }),
          get: async () => testRecord,
          action: async (_caller, id, actionName, body) => {
            receivedPayload = body.payload;
            return {
              record: { ...testRecord, status: 'Posted', version: 2 },
              replay: false,
            };
          },
        },
      });
    });

    bootKit(Router());
    invalidateAccessCache();

    const res = await request(app)
      .post(`${API}/pages/kit-payload-test/records/${testRecord.id}/actions/post`)
      .set(owner.bearer)
      .set('X-Unit-Id', unitId)
      .send({ payload: { reason: 'Material passed QA', score: 95 } });

    expect(res.status).toBe(200);
    expect(receivedPayload).toEqual({ reason: 'Material passed QA', score: 95 });
  });

  it('5. payload over 100 KB 413', async () => {
    const testRecord: TypedRecordDto = {
      id: '33333333-3333-3333-3333-333333333333',
      code: 'TEST-003',
      status: 'Draft',
      unitId,
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

    const testSchema = defineKitSchema({
      pageId: 'kit-oversize-test',
      title: 'Kit Oversize Test',
      family: 'Quality / QMS',
      purpose: 'Testing 100 KB limit',
      department: 'Quality',
      statuses: ['Draft'],
      editableStatuses: ['Draft'],
      actions: [
        {
          key: 'post',
          label: 'Post',
          variant: 'primary',
          confirm: null,
          allowedFrom: ['Draft'],
          requires: 'edit',
        },
      ],
      fields: [
        { key: 'code', label: 'Code', type: 'code', required: true, readOnly: true },
        { key: 'status', label: 'Status', type: 'status', required: true, readOnly: true },
      ],
      tabs: ['Register'],
    });

    registerKitModule('mod-oversize', (kit) => {
      kit.page({
        schema: testSchema,
        handler: {
          pageId: 'kit-oversize-test',
          list: async () => ({ rows: [testRecord], total: 1 }),
          get: async () => testRecord,
          action: async () => ({ record: testRecord, replay: false }),
        },
      });
    });

    bootKit(Router());
    invalidateAccessCache();

    const hugeString = 'x'.repeat(105 * 1024);
    const res = await request(app)
      .post(`${API}/pages/kit-oversize-test/records/${testRecord.id}/actions/post`)
      .set(owner.bearer)
      .set('X-Unit-Id', unitId)
      .send({ payload: { big: hugeString } });

    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('6. old body dispatchedQty still valid', async () => {
    let receivedDispatchedQty: number | undefined;
    const testRecord: TypedRecordDto = {
      id: '44444444-4444-4444-4444-444444444444',
      code: 'TEST-004',
      status: 'Draft',
      unitId,
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

    const testSchema = defineKitSchema({
      pageId: 'kit-legacy-body-test',
      title: 'Kit Legacy Body Test',
      family: 'Quality / QMS',
      purpose: 'Testing backward compatibility',
      department: 'Quality',
      statuses: ['Draft', 'Dispatched'],
      editableStatuses: ['Draft'],
      actions: [
        {
          key: 'dispatch',
          label: 'Dispatch',
          variant: 'primary',
          confirm: null,
          allowedFrom: ['Draft'],
          requires: 'edit',
        },
      ],
      fields: [
        { key: 'code', label: 'Code', type: 'code', required: true, readOnly: true },
        { key: 'status', label: 'Status', type: 'status', required: true, readOnly: true },
      ],
      tabs: ['Register'],
    });

    registerKitModule('mod-legacy-body', (kit) => {
      kit.page({
        schema: testSchema,
        handler: {
          pageId: 'kit-legacy-body-test',
          list: async () => ({ rows: [testRecord], total: 1 }),
          get: async () => testRecord,
          action: async (_caller, id, actionName, body) => {
            receivedDispatchedQty = body.dispatchedQty;
            return {
              record: { ...testRecord, status: 'Dispatched', version: 2 },
              replay: false,
            };
          },
        },
      });
    });

    bootKit(Router());
    invalidateAccessCache();

    const res = await request(app)
      .post(`${API}/pages/kit-legacy-body-test/records/${testRecord.id}/actions/dispatch`)
      .set(owner.bearer)
      .set('X-Unit-Id', unitId)
      .send({ dispatchedQty: 42 });

    expect(res.status).toBe(200);
    expect(receivedDispatchedQty).toBe(42);
  });

  it('7. unknown body key 422', async () => {
    const testRecord: TypedRecordDto = {
      id: '55555555-5555-5555-5555-555555555555',
      code: 'TEST-005',
      status: 'Draft',
      unitId,
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

    const testSchema = defineKitSchema({
      pageId: 'kit-strict-body-test',
      title: 'Kit Strict Body Test',
      family: 'Quality / QMS',
      purpose: 'Testing unknown keys',
      department: 'Quality',
      statuses: ['Draft'],
      editableStatuses: ['Draft'],
      actions: [
        {
          key: 'post',
          label: 'Post',
          variant: 'primary',
          confirm: null,
          allowedFrom: ['Draft'],
          requires: 'edit',
        },
      ],
      fields: [
        { key: 'code', label: 'Code', type: 'code', required: true, readOnly: true },
        { key: 'status', label: 'Status', type: 'status', required: true, readOnly: true },
      ],
      tabs: ['Register'],
    });

    registerKitModule('mod-strict', (kit) => {
      kit.page({
        schema: testSchema,
        handler: {
          pageId: 'kit-strict-body-test',
          list: async () => ({ rows: [testRecord], total: 1 }),
          get: async () => testRecord,
          action: async () => ({ record: testRecord, replay: false }),
        },
      });
    });

    bootKit(Router());
    invalidateAccessCache();

    const res = await request(app)
      .post(`${API}/pages/kit-strict-body-test/records/${testRecord.id}/actions/post`)
      .set(owner.bearer)
      .set('X-Unit-Id', unitId)
      .send({ unknownField: 'invalid' });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('8. suffix and string lookup survive serialization', async () => {
    const testSchema = defineKitSchema({
      pageId: 'kit-suffix-lookup-test',
      title: 'Kit Suffix Lookup Test',
      family: 'Quality / QMS',
      purpose: 'Testing suffix and lookup string serialization',
      department: 'Quality',
      statuses: ['Draft'],
      editableStatuses: ['Draft'],
      actions: [],
      fields: [
        { key: 'code', label: 'Code', type: 'code', required: true, readOnly: true },
        { key: 'status', label: 'Status', type: 'status', required: true, readOnly: true },
        {
          key: 'supplierId',
          label: 'Supplier',
          type: 'ref',
          required: true,
          readOnly: false,
          lookup: 'scm-suppliers',
        },
        {
          key: 'tolerance',
          label: 'Tolerance',
          type: 'qty',
          required: false,
          readOnly: false,
          suffix: '±mm',
        },
      ],
      tabs: ['Register'],
    });

    registerKitModule('mod-suffix-lookup', (kit) => {
      kit.page({
        schema: testSchema,
        handler: {
          pageId: 'kit-suffix-lookup-test',
          list: async () => ({ rows: [], total: 0 }),
          get: async () => ({}) as any,
        },
      });
      kit.lookup({
        name: 'scmSuppliers',
        pageId: 'kit-suffix-lookup-test',
        search: async () => [],
      });
    });

    bootKit(Router());
    invalidateAccessCache();

    const res = await request(app)
      .get(`${API}/pages/kit-suffix-lookup-test/schema`)
      .set(owner.bearer);

    expect(res.status).toBe(200);
    const fields = res.body.data.fields as Array<{ key: string; lookup?: string; suffix?: string }>;
    const supplierField = fields.find((f) => f.key === 'supplierId');
    const toleranceField = fields.find((f) => f.key === 'tolerance');

    expect(supplierField?.lookup).toBe('scm-suppliers');
    expect(toleranceField?.suffix).toBe('±mm');
  });
});
