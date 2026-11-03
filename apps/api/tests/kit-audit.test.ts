// apps/api/tests/kit-audit.test.ts
// Tests for kitAudit generic audit endpoint, scoping, unit filtering, and privacy (docs/plans/07-ENGINE-KIT.md §6 KR-14 & T-KIT-05)

import { Router } from 'express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { recordAudit } from '../src/core/audit/audit-service';
import { prisma } from '../src/core/db/prisma';
import { invalidateAccessCache } from '../src/core/rbac/access';
import { bootKit } from '../src/kit/boot';
import { clearKitRegistrationsForTest, registerKitModule } from '../src/kit/registry';
import { defineKitSchema } from '../src/kit/schema';
import type { TypedHandler, TypedRecordDto } from '../src/modules/inventory/typed';
import { API, newApp, signInAs, signInOwner, unitIds } from './helpers';
import type { Signed } from './helpers';

describe('T-KIT-05 — kitAudit Generic Audit View', () => {
  const origAllow = process.env.KIT_ALLOW_TEST_PAGES;
  const app = newApp();
  let owner: Signed;
  let member: Signed;
  let otherMember: Signed;
  let unitTalId: string;
  let unitSawId: string;

  beforeAll(async () => {
    process.env.KIT_ALLOW_TEST_PAGES = 'true';
    owner = await signInOwner(app);
    member = await signInAs(app, 'MEMBER', { department: 'Quality' });
    otherMember = await signInAs(app, 'MEMBER', { department: 'Quality' });
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

  function setupAuditModule() {
    const testRecord: TypedRecordDto = {
      id: '99999999-1111-2222-3333-444444444444',
      code: 'AUD-REC-01',
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
      pageId: 'kit-audit-page',
      title: 'Audit Test Page',
      family: 'Quality / QMS',
      purpose: 'Testing kitAudit',
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

    const handler: TypedHandler = {
      pageId: 'kit-audit-page',
      list: async () => ({ rows: [testRecord], total: 1 }),
      get: async (_caller, id) => {
        if (id !== testRecord.id) throw new Error('Not found');
        return testRecord;
      },
    };

    registerKitModule('mod-audit-test', (kit) => {
      kit.page({ schema, handler });
    });

    bootKit(Router());
    invalidateAccessCache();

    return testRecord;
  }

  it('1. kitAudit filters rows by pageId and unitId', async () => {
    const rec = setupAuditModule();

    // Create audit logs for kit-audit-page in TAL and SAW
    await recordAudit(
      {
        action: 'RECORD_CREATED',
        actorId: owner.user.id,
        targetType: 'KitRecord',
        targetId: rec.id,
        meta: { ip: '127.0.0.1', userAgent: 'test-agent' },
        detail: { pageId: 'kit-audit-page', unitId: unitTalId, note: 'TAL audit log' },
      },
      prisma,
    );

    await recordAudit(
      {
        action: 'RECORD_UPDATED',
        actorId: owner.user.id,
        targetType: 'KitRecord',
        targetId: '88888888-2222-3333-4444-555555555555',
        meta: { ip: '127.0.0.1', userAgent: 'test-agent' },
        detail: { pageId: 'kit-audit-page', unitId: unitSawId, note: 'SAW audit log' },
      },
      prisma,
    );

    // Also create an audit log for a different page
    await recordAudit(
      {
        action: 'RECORD_CREATED',
        actorId: owner.user.id,
        targetType: 'OtherRecord',
        targetId: '77777777-3333-4444-5555-666666666666',
        meta: { ip: '127.0.0.1', userAgent: 'test-agent' },
        detail: { pageId: 'other-page', unitId: unitTalId },
      },
      prisma,
    );

    // Query in TAL unit
    const resTal = await request(app)
      .get(`${API}/pages/kit-audit-page/audit`)
      .set(owner.bearer)
      .set('X-Unit-Id', unitTalId);

    expect(resTal.status).toBe(200);
    expect(resTal.body.data.length).toBeGreaterThanOrEqual(1);
    expect(resTal.body.data.every((r: any) => r.detail.pageId === 'kit-audit-page')).toBe(true);
    expect(resTal.body.data.every((r: any) => r.detail.unitId === unitTalId)).toBe(true);
    expect(resTal.body.data.some((r: any) => r.detail.note === 'TAL audit log')).toBe(true);
    expect(resTal.body.data.some((r: any) => r.detail.note === 'SAW audit log')).toBe(false);

    // Query in SAW unit
    const resSaw = await request(app)
      .get(`${API}/pages/kit-audit-page/audit`)
      .set(owner.bearer)
      .set('X-Unit-Id', unitSawId);

    expect(resSaw.status).toBe(200);
    expect(resSaw.body.data.some((r: any) => r.detail.note === 'SAW audit log')).toBe(true);
    expect(resSaw.body.data.some((r: any) => r.detail.note === 'TAL audit log')).toBe(false);
  });

  it('2. recordAudit filters rows for specific recordId', async () => {
    const rec = setupAuditModule();

    await recordAudit(
      {
        action: 'RECORD_CREATED',
        actorId: owner.user.id,
        targetType: 'KitRecord',
        targetId: rec.id,
        meta: { ip: '127.0.0.1', userAgent: 'test-agent' },
        detail: { pageId: 'kit-audit-page', unitId: unitTalId, note: 'Record audit log' },
      },
      prisma,
    );

    const res = await request(app)
      .get(`${API}/pages/kit-audit-page/records/${rec.id}/audit`)
      .set(owner.bearer)
      .set('X-Unit-Id', unitTalId);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data.every((r: any) => r.targetId === rec.id)).toBe(true);
  });

  it('3. privacy: ip and userAgent are hidden for non-admin callers', async () => {
    const rec = setupAuditModule();

    await recordAudit(
      {
        action: 'RECORD_CREATED',
        actorId: member.user.id,
        targetType: 'KitRecord',
        targetId: rec.id,
        meta: { ip: '10.0.0.99', userAgent: 'SecretBrowser/1.0' },
        detail: { pageId: 'kit-audit-page', unitId: unitTalId },
      },
      prisma,
    );

    // Member sees ip: null, userAgent: null
    const resMember = await request(app)
      .get(`${API}/pages/kit-audit-page/audit`)
      .set(member.bearer)
      .set('X-Unit-Id', unitTalId);

    expect(resMember.status).toBe(200);
    const memberEntry = resMember.body.data.find((r: any) => r.targetId === rec.id);
    expect(memberEntry).toBeDefined();
    expect(memberEntry.ip).toBeNull();
    expect(memberEntry.userAgent).toBeNull();

    // Owner (ADMIN+) sees ip and userAgent
    const resOwner = await request(app)
      .get(`${API}/pages/kit-audit-page/audit`)
      .set(owner.bearer)
      .set('X-Unit-Id', unitTalId);

    expect(resOwner.status).toBe(200);
    const ownerEntry = resOwner.body.data.find((r: any) => r.targetId === rec.id);
    expect(ownerEntry).toBeDefined();
    expect(ownerEntry.ip).toBe('10.0.0.99');
    expect(ownerEntry.userAgent).toBe('SecretBrowser/1.0');
  });

  it('4. inventory pages audit remains unchanged', async () => {
    const res = await request(app)
      .get(`${API}/pages/inv-items/audit`)
      .set(owner.bearer)
      .set('X-Unit-Id', unitTalId);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('meta');
  });
});
