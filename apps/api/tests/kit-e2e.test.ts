// apps/api/tests/kit-e2e.test.ts
// End-to-end HTTP integration test across all Kit extensions using fixture module (docs/plans/07-ENGINE-KIT.md §12 T-KIT-12)

import { Router } from 'express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { invalidateAccessCache } from '../src/core/rbac/access';
import { bootKit } from '../src/kit/boot';
import { clearKitRegistrationsForTest, registerKitModule } from '../src/kit/registry';
import { API, newApp, signInOwner, unitIds } from './helpers';
import type { Signed } from './helpers';
import { registerFixtureModule, resetFixtureStore } from './kit-fixture-module';

describe('T-KIT-12 — Kit End-to-End Integration Suite', () => {
  const origAllow = process.env.KIT_ALLOW_TEST_PAGES;
  const app = newApp();
  let owner: Signed;
  let unitTalId: string;

  beforeAll(async () => {
    process.env.KIT_ALLOW_TEST_PAGES = 'true';
    owner = await signInOwner(app);
    const ids = await unitIds(['TAL']);
    unitTalId = ids[0] ?? '';
  });

  beforeEach(() => {
    process.env.KIT_ALLOW_TEST_PAGES = 'true';
    clearKitRegistrationsForTest();
    resetFixtureStore();
    invalidateAccessCache();

    registerKitModule('kit-fixture-e2e', registerFixtureModule);
    bootKit(Router());
  });

  afterEach(() => {
    clearKitRegistrationsForTest();
    resetFixtureStore();
    invalidateAccessCache();
  });

  afterAll(() => {
    process.env.KIT_ALLOW_TEST_PAGES = origAllow;
    clearKitRegistrationsForTest();
    resetFixtureStore();
    invalidateAccessCache();
  });

  it('1. schema endpoint returns extended schema with commands, panels, templates, filters', async () => {
    const res = await request(app)
      .get(`${API}/pages/kit-test/schema`)
      .set(owner.bearer);

    expect(res.status).toBe(200);
    expect(res.body.data.pageId).toBe('kit-test');
    expect(res.body.data.commands).toHaveLength(1);
    expect(res.body.data.commands[0].key).toBe('batch-recalc');
    expect(res.body.data.tabPanels).toHaveLength(4);
    expect(res.body.data.printTemplates).toHaveLength(2);
    expect(res.body.data.filters).toHaveLength(2);
  });

  it('2. full E2E flow: create → list with typed filters → panel → action with payload → command → lookup → print', async () => {
    // A. Create record
    const createRes = await request(app)
      .post(`${API}/pages/kit-test/records`)
      .set(owner.bearer)
      .set('X-Unit-Id', unitTalId)
      .send({
        data: {
          title: 'Precision Shaft Test',
          category: 'Mechanical',
          severity: 'Low',
          score: 50,
        },
      });

    expect(createRes.status).toBe(201);
    const recId = createRes.body.data.id;
    expect(recId).toBeDefined();
    expect(createRes.body.data.status).toBe('Draft');

    // B. List with typed filter
    const listRes = await request(app)
      .get(`${API}/pages/kit-test/records?severity=Low`)
      .set(owner.bearer)
      .set('X-Unit-Id', unitTalId);

    expect(listRes.status).toBe(200);
    expect(listRes.body.data).toHaveLength(1);
    expect(listRes.body.data[0].id).toBe(recId);

    // C. Record-scoped panel
    const recordPanelRes = await request(app)
      .get(`${API}/pages/kit-test/records/${recId}/panels/audit-view`)
      .set(owner.bearer)
      .set('X-Unit-Id', unitTalId);

    expect(recordPanelRes.status).toBe(200);
    expect(recordPanelRes.body.data.title).toBe('Record Audit');
    expect(recordPanelRes.body.data.sections[0].type).toBe('timeline');

    // D. Page-scoped panel
    const pagePanelRes = await request(app)
      .get(`${API}/pages/kit-test/panels/kpis`)
      .set(owner.bearer)
      .set('X-Unit-Id', unitTalId);

    expect(pagePanelRes.status).toBe(200);
    expect(pagePanelRes.body.data.kpis).toBeDefined();
    expect(pagePanelRes.body.data.kpis).toHaveLength(2);

    // E. Action with payload
    const actionRes = await request(app)
      .post(`${API}/pages/kit-test/records/${recId}/actions/activate`)
      .set(owner.bearer)
      .set('X-Unit-Id', unitTalId)
      .send({ payload: { reason: 'QA inspection completed successfully' } });

    expect(actionRes.status).toBe(200);
    expect(actionRes.body.data.status).toBe('Active');

    // F. Header command execution
    const cmdRes = await request(app)
      .post(`${API}/pages/kit-test/commands/batch-recalc`)
      .set(owner.bearer)
      .set('X-Unit-Id', unitTalId)
      .send({ payload: { multiplier: 3 } });

    expect(cmdRes.status).toBe(200);
    expect(cmdRes.body.result?.message).toContain('Recalculated with multiplier 3');

    // Verify record score was multiplied (50 * 3 = 150)
    const getRes = await request(app)
      .get(`${API}/pages/kit-test/records/${recId}`)
      .set(owner.bearer)
      .set('X-Unit-Id', unitTalId);

    expect(getRes.status).toBe(200);
    expect(getRes.body.data.score).toBe(150);

    // G. Lookup search
    const lookupRes = await request(app)
      .get(`${API}/lookups/kit-components?q=Shaft`)
      .set(owner.bearer)
      .set('X-Unit-Id', unitTalId);

    expect(lookupRes.status).toBe(200);
    expect(lookupRes.body.data).toHaveLength(1);
    expect(lookupRes.body.data[0].code).toBe('COMP01');

    // H. Web print data
    const printRes = await request(app)
      .get(`${API}/pages/kit-test/records/${recId}/print/formal-cert`)
      .set(owner.bearer)
      .set('X-Unit-Id', unitTalId);

    expect(printRes.status).toBe(200);
    expect(printRes.body.data.title).toBe('Formal Quality Certificate');
    expect(printRes.body.data.docNo).toBe(createRes.body.data.code);

    // I. PDF print export
    const pdfRes = await request(app)
      .get(`${API}/pages/kit-test/pdf/summary-pdf`)
      .set(owner.bearer)
      .set('X-Unit-Id', unitTalId);

    expect(pdfRes.status).toBe(200);
    expect(pdfRes.headers['content-type']).toBe('application/pdf');
    expect(pdfRes.body.toString()).toContain('%PDF-1.4');
  });
});
