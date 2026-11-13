// apps/api/tests/kit-commands.test.ts
// Tests for Kit Header Commands execution, idempotency, permissions, and boot validation (docs/plans/07-ENGINE-KIT.md §2.6, §6 KR-07 & T-KIT-05)

import { Router } from 'express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { invalidateAccessCache } from '../src/core/rbac/access';
import { bootKit } from '../src/kit/boot';
import { clearKitRegistrationsForTest, registerKitModule } from '../src/kit/registry';
import { defineKitSchema } from '../src/kit/schema';
import type { TypedHandler } from '../src/modules/inventory/typed';
import { API, newApp, signInAs, signInOwner, unitIds } from './helpers';
import type { Signed } from './helpers';

describe('T-KIT-05 — Kit Header Commands Route & Registry', () => {
  const origAllow = process.env.KIT_ALLOW_TEST_PAGES;
  const app = newApp();
  let owner: Signed;
  let manager: Signed;
  let member: Signed;
  let unitTalId: string;

  beforeAll(async () => {
    process.env.KIT_ALLOW_TEST_PAGES = 'true';
    owner = await signInOwner(app);
    manager = await signInAs(app, 'MANAGER', { department: 'Quality' });
    member = await signInAs(app, 'MEMBER', { department: 'Quality' });
    const ids = await unitIds(['TAL']);
    unitTalId = ids[0] ?? '';
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

  it('1. command 200 + result with payload', async () => {
    let receivedPayload: any = null;

    const schema = defineKitSchema({
      pageId: 'kit-cmd-page',
      title: 'Commands Test Page',
      family: 'Quality / QMS',
      purpose: 'Testing commands',
      department: 'Quality',
      statuses: ['Draft'],
      editableStatuses: ['Draft'],
      tabs: ['Register'],
      commands: [
        {
          key: 'recalculate',
          label: 'Recalculate',
          requires: 'add',
        },
      ],
      actions: [],
      fields: [
        { key: 'code', label: 'Code', type: 'code', required: true, readOnly: true },
        { key: 'status', label: 'Status', type: 'status', required: true, readOnly: true },
      ],
    });

    const handler: TypedHandler = {
      pageId: 'kit-cmd-page',
      list: async () => ({ rows: [], total: 0 }),
      get: async () => {
        throw new Error('Not implemented');
      },
    };

    registerKitModule('mod-cmd', (kit) => {
      kit.page({ schema, handler });
      kit.command('kit-cmd-page', 'recalculate', async (ctx) => {
        receivedPayload = ctx.payload;
        return { message: 'Recalculation complete', result: { processed: 42 } };
      });
    });

    bootKit(Router());
    invalidateAccessCache();

    const res = await request(app)
      .post(`${API}/pages/kit-cmd-page/commands/recalculate`)
      .set(owner.bearer)
      .set('X-Unit-Id', unitTalId)
      .send({ payload: { scope: 'all-items', threshold: 10 } });

    expect(res.status).toBe(200);
    expect(res.body.result).toEqual({ message: 'Recalculation complete', processed: 42 });
    expect(receivedPayload).toEqual({ scope: 'all-items', threshold: 10 });
  });

  it('2. double click with same Idempotency-Key → one execution and Idempotent-Replay', async () => {
    let executionCount = 0;

    const schema = defineKitSchema({
      pageId: 'kit-cmd-page',
      title: 'Commands Test Page',
      family: 'Quality / QMS',
      purpose: 'Testing commands',
      department: 'Quality',
      statuses: ['Draft'],
      editableStatuses: ['Draft'],
      tabs: ['Register'],
      commands: [
        {
          key: 'batch-run',
          label: 'Batch Run',
        },
      ],
      actions: [],
      fields: [
        { key: 'code', label: 'Code', type: 'code', required: true, readOnly: true },
        { key: 'status', label: 'Status', type: 'status', required: true, readOnly: true },
      ],
    });

    const handler: TypedHandler = {
      pageId: 'kit-cmd-page',
      list: async () => ({ rows: [], total: 0 }),
      get: async () => {
        throw new Error('Not implemented');
      },
    };

    registerKitModule('mod-cmd-idem', (kit) => {
      kit.page({ schema, handler });
      kit.command('kit-cmd-page', 'batch-run', async () => {
        executionCount++;
        return { message: 'Done', result: { count: executionCount } };
      });
    });

    bootKit(Router());
    invalidateAccessCache();

    const idemKey = `test-key-${Date.now()}`;

    // First request
    const res1 = await request(app)
      .post(`${API}/pages/kit-cmd-page/commands/batch-run`)
      .set(owner.bearer)
      .set('X-Unit-Id', unitTalId)
      .set('Idempotency-Key', idemKey)
      .send({ payload: { test: 1 } });

    expect(res1.status).toBe(200);
    expect(res1.header['idempotent-replay']).toBeUndefined();
    expect(res1.body.result).toEqual({ message: 'Done', count: 1 });
    expect(executionCount).toBe(1);

    // Second request: same key, same payload -> replay
    const res2 = await request(app)
      .post(`${API}/pages/kit-cmd-page/commands/batch-run`)
      .set(owner.bearer)
      .set('X-Unit-Id', unitTalId)
      .set('Idempotency-Key', idemKey)
      .send({ payload: { test: 1 } });

    expect(res2.status).toBe(200);
    expect(res2.header['idempotent-replay']).toBe('true');
    expect(res2.body.result).toEqual({ message: 'Done', count: 1 });
    expect(executionCount).toBe(1);

    // Third request: same key, different payload -> 409 Conflict
    const res3 = await request(app)
      .post(`${API}/pages/kit-cmd-page/commands/batch-run`)
      .set(owner.bearer)
      .set('X-Unit-Id', unitTalId)
      .set('Idempotency-Key', idemKey)
      .send({ payload: { test: 999 } });

    expect(res3.status).toBe(409);
    expect(res3.body.error.code).toBe('CONFLICT');
  });

  it('3. requires: "approve" member 403, manager/owner 200', async () => {
    const schema = defineKitSchema({
      pageId: 'kit-cmd-page',
      title: 'Commands Test Page',
      family: 'Quality / QMS',
      purpose: 'Testing commands',
      department: 'Quality',
      statuses: ['Draft'],
      editableStatuses: ['Draft'],
      tabs: ['Register'],
      commands: [
        {
          key: 'approve-all',
          label: 'Approve All',
          requires: 'approve',
        },
      ],
      actions: [],
      fields: [
        { key: 'code', label: 'Code', type: 'code', required: true, readOnly: true },
        { key: 'status', label: 'Status', type: 'status', required: true, readOnly: true },
      ],
    });

    const handler: TypedHandler = {
      pageId: 'kit-cmd-page',
      list: async () => ({ rows: [], total: 0 }),
      get: async () => {
        throw new Error('Not implemented');
      },
    };

    registerKitModule('mod-cmd-auth', (kit) => {
      kit.page({ schema, handler });
      kit.command('kit-cmd-page', 'approve-all', async () => {
        return { message: 'All approved' };
      });
    });

    bootKit(Router());
    invalidateAccessCache();

    // Member: without approve right -> 403
    const resMember = await request(app)
      .post(`${API}/pages/kit-cmd-page/commands/approve-all`)
      .set(member.bearer)
      .set('X-Unit-Id', unitTalId)
      .send({});

    expect(resMember.status).toBe(403);
    expect(resMember.body.error.code).toBe('FORBIDDEN');

    // Manager: with approve right -> 200
    const resManager = await request(app)
      .post(`${API}/pages/kit-cmd-page/commands/approve-all`)
      .set(manager.bearer)
      .set('X-Unit-Id', unitTalId)
      .send({});

    expect(resManager.status).toBe(200);
    expect(resManager.body.result).toEqual({ message: 'All approved' });
  });

  it('4. concrete unit check: no unit is 422 CONTEXT_INVALID unless allowAllUnits: true', async () => {
    const schema = defineKitSchema({
      pageId: 'kit-cmd-page',
      title: 'Commands Test Page',
      family: 'Quality / QMS',
      purpose: 'Testing commands',
      department: 'Quality',
      statuses: ['Draft'],
      editableStatuses: ['Draft'],
      tabs: ['Register'],
      commands: [
        {
          key: 'unit-cmd',
          label: 'Unit Command',
        },
        {
          key: 'global-cmd',
          label: 'Global Command',
        },
      ],
      actions: [],
      fields: [
        { key: 'code', label: 'Code', type: 'code', required: true, readOnly: true },
        { key: 'status', label: 'Status', type: 'status', required: true, readOnly: true },
      ],
    });

    const handler: TypedHandler = {
      pageId: 'kit-cmd-page',
      list: async () => ({ rows: [], total: 0 }),
      get: async () => {
        throw new Error('Not implemented');
      },
    };

    registerKitModule('mod-cmd-unit', (kit) => {
      kit.page({ schema, handler });
      kit.command('kit-cmd-page', 'unit-cmd', async () => ({ message: 'ok' }));
      kit.command('kit-cmd-page', 'global-cmd', async () => ({ message: 'global ok' }), {
        allowAllUnits: true,
      });
    });

    bootKit(Router());
    invalidateAccessCache();

    // Default command without concrete unit ("All units" -> 422 CONTEXT_INVALID)
    const resNoUnit = await request(app)
      .post(`${API}/pages/kit-cmd-page/commands/unit-cmd`)
      .set(owner.bearer)
      .set('X-Unit-Id', 'all')
      .send({});

    expect(resNoUnit.status).toBe(422);
    expect(resNoUnit.body.error.code).toBe('CONTEXT_INVALID');

    // allowAllUnits: true command with "All units" -> 200
    const resGlobal = await request(app)
      .post(`${API}/pages/kit-cmd-page/commands/global-cmd`)
      .set(owner.bearer)
      .set('X-Unit-Id', 'all')
      .send({});

    expect(resGlobal.status).toBe(200);
    expect(resGlobal.body.result).toEqual({ message: 'global ok' });
  });

  it('5. unknown command returns 404', async () => {
    const schema = defineKitSchema({
      pageId: 'kit-cmd-page',
      title: 'Commands Test Page',
      family: 'Quality / QMS',
      purpose: 'Testing commands',
      department: 'Quality',
      statuses: ['Draft'],
      editableStatuses: ['Draft'],
      tabs: ['Register'],
      commands: [],
      actions: [],
      fields: [
        { key: 'code', label: 'Code', type: 'code', required: true, readOnly: true },
        { key: 'status', label: 'Status', type: 'status', required: true, readOnly: true },
      ],
    });

    registerKitModule('mod-cmd-empty', (kit) => {
      kit.page({
        schema,
        handler: {
          pageId: 'kit-cmd-page',
          list: async () => ({ rows: [], total: 0 }),
          get: async () => {
            throw new Error('Not implemented');
          },
        },
      });
    });

    bootKit(Router());
    invalidateAccessCache();

    const res = await request(app)
      .post(`${API}/pages/kit-cmd-page/commands/non-existent`)
      .set(owner.bearer)
      .set('X-Unit-Id', unitTalId)
      .send({});

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('6. payload over 100 KB returns 413 PAYLOAD_TOO_LARGE', async () => {
    const schema = defineKitSchema({
      pageId: 'kit-cmd-page',
      title: 'Commands Test Page',
      family: 'Quality / QMS',
      purpose: 'Testing commands',
      department: 'Quality',
      statuses: ['Draft'],
      editableStatuses: ['Draft'],
      tabs: ['Register'],
      commands: [{ key: 'big-data', label: 'Big Data' }],
      actions: [],
      fields: [
        { key: 'code', label: 'Code', type: 'code', required: true, readOnly: true },
        { key: 'status', label: 'Status', type: 'status', required: true, readOnly: true },
      ],
    });

    registerKitModule('mod-cmd-large', (kit) => {
      kit.page({
        schema,
        handler: {
          pageId: 'kit-cmd-page',
          list: async () => ({ rows: [], total: 0 }),
          get: async () => {
            throw new Error('Not implemented');
          },
        },
      });
      kit.command('kit-cmd-page', 'big-data', async () => ({ message: 'ok' }));
    });

    bootKit(Router());
    invalidateAccessCache();

    const hugeString = 'y'.repeat(105 * 1024);
    const res = await request(app)
      .post(`${API}/pages/kit-cmd-page/commands/big-data`)
      .set(owner.bearer)
      .set('X-Unit-Id', unitTalId)
      .send({ payload: { big: hugeString } });

    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('7. boot validation: schema command without runner throws', () => {
    const schema = defineKitSchema({
      pageId: 'kit-cmd-page',
      title: 'Commands Test Page',
      family: 'Quality / QMS',
      purpose: 'Testing commands',
      department: 'Quality',
      statuses: ['Draft'],
      editableStatuses: ['Draft'],
      tabs: ['Register'],
      commands: [{ key: 'missing-runner', label: 'Missing Runner' }],
      actions: [],
      fields: [
        { key: 'code', label: 'Code', type: 'code', required: true, readOnly: true },
        { key: 'status', label: 'Status', type: 'status', required: true, readOnly: true },
      ],
    });

    registerKitModule('mod-missing-runner', (kit) => {
      kit.page({
        schema,
        handler: {
          pageId: 'kit-cmd-page',
          list: async () => ({ rows: [], total: 0 }),
          get: async () => {
            throw new Error('Not implemented');
          },
        },
      });
    });

    expect(() => bootKit(Router())).toThrow(
      'KIT: command kit-cmd-page.missing-runner has no runner',
    );
  });

  it('8. boot validation: runner not referenced in schema commands throws', () => {
    const schema = defineKitSchema({
      pageId: 'kit-cmd-page',
      title: 'Commands Test Page',
      family: 'Quality / QMS',
      purpose: 'Testing commands',
      department: 'Quality',
      statuses: ['Draft'],
      editableStatuses: ['Draft'],
      tabs: ['Register'],
      commands: [],
      actions: [],
      fields: [
        { key: 'code', label: 'Code', type: 'code', required: true, readOnly: true },
        { key: 'status', label: 'Status', type: 'status', required: true, readOnly: true },
      ],
    });

    registerKitModule('mod-unused-runner', (kit) => {
      kit.page({
        schema,
        handler: {
          pageId: 'kit-cmd-page',
          list: async () => ({ rows: [], total: 0 }),
          get: async () => {
            throw new Error('Not implemented');
          },
        },
      });
      kit.command('kit-cmd-page', 'orphan-command', async () => ({ message: 'orphan' }));
    });

    expect(() => bootKit(Router())).toThrow(
      'KIT: command runner kit-cmd-page.orphan-command not referenced in schema commands',
    );
  });
});
