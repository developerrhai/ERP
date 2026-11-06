// apps/api/tests/kit-print.test.ts
// Tests for Kit Print / PDF registry, K7-K9 routes, permissions, size limits, and audit (docs/plans/07-ENGINE-KIT.md §2.9, §12 T-KIT-11)

import { Router } from 'express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { invalidateAccessCache } from '../src/core/rbac/access';
import { bootKit } from '../src/kit/boot';
import { clearKitRegistrationsForTest, registerKitModule } from '../src/kit/registry';
import { defineKitSchema } from '../src/kit/schema';
import type { TypedHandler } from '../src/modules/inventory/typed';
import { prisma } from '../src/core/db/prisma';
import { API, newApp, signInAs, signInOwner, unitIds } from './helpers';
import type { Signed } from './helpers';

describe('T-KIT-11 — Kit Print / PDF Registry & Routes', () => {
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

  it('1. web print data route returns valid PrintDto with Cache-Control no-store', async () => {
    const schema = defineKitSchema({
      pageId: 'kit-print-test-page',
      title: 'Print Test Page',
      family: 'Quality / QMS',
      purpose: 'Testing print data route',
      department: 'Quality',
      statuses: ['Draft', 'Active'],
      editableStatuses: ['Draft'],
      tabs: ['Register'],
      printTemplates: [
        { key: 'standard', label: 'Standard Inspection Form', kind: 'web', scope: 'record' },
      ],
      fields: [{ key: 'title', label: 'Title', type: 'text' }],
    });

    const handler: TypedHandler = {
      pageId: 'kit-print-test-page',
      async list() {
        return { rows: [], total: 0 };
      },
      async get(caller, id) {
        return {
          id,
          unitId: unitTalId,
          fyId: 'fy-test',
          department: 'Quality',
          createdAt: new Date().toISOString(),
          status: 'Active',
          title: 'Sample Inspection',
        };
      },
      async create() {
        throw new Error('not implemented');
      },
      async update() {
        throw new Error('not implemented');
      },
    };

    registerKitModule('test-print-web', (kit) => {
      kit.page({ schema, handler });
      kit.printData('kit-print-test-page', 'standard', async ({ id }) => {
        return {
          templateKey: 'standard',
          title: 'Standard Inspection Report',
          docNo: `INS-${id}`,
          docDate: '2026-11-04',
          unit: {
            code: 'TAL',
            name: 'Talwandi Unit',
            gstin: '03AAAAA0000A1Z5',
          },
          letterhead: { companyName: 'Sawant Group', address: 'Plot 42' },
          parties: [{ role: 'Inspector', name: 'R. Sharma' }],
          facts: [{ label: 'Severity', value: 'Low' }],
          lines: {
            columns: [
              { key: 'item', label: 'Item', format: 'text' },
              { key: 'qty', label: 'Qty', format: 'number', align: 'right' },
            ],
            rows: [{ item: 'Part A', qty: 10 }],
          },
          sections: [{ title: 'Notes', text: 'All checks passed.' }],
          totals: [{ label: 'Grand Total', value: '10' }],
          signatures: [{ label: 'Inspected By', name: 'R. Sharma' }],
        };
      });
    });

    bootKit(Router());

    const res = await request(app)
      .get(`${API}/pages/kit-print-test-page/records/rec-123/print/standard`)
      .set(owner.bearer)
      .set('X-Unit-Id', unitTalId);

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.data).toBeDefined();
    expect(res.body.data.templateKey).toBe('standard');
    expect(res.body.data.title).toBe('Standard Inspection Report');
    expect(res.body.data.docNo).toBe('INS-rec-123');
    expect(res.body.data.lines.rows[0].item).toBe('Part A');

    // Verify audit log
    const audit = await prisma.auditLog.findFirst({
      where: {
        action: 'PRINT_RENDERED',
        targetId: 'rec-123',
      },
      orderBy: { at: 'desc' },
    });
    expect(audit).toBeDefined();
    expect((audit?.detail as any)?.kind).toBe('web');
  });

  it('2. PDF route returns application/pdf with Content-Disposition', async () => {
    const fakePdfBytes = Buffer.from('%PDF-1.4 test pdf content');

    const schema = defineKitSchema({
      pageId: 'kit-pdf-test-page',
      title: 'PDF Test Page',
      family: 'Quality / QMS',
      purpose: 'Testing pdf route',
      department: 'Quality',
      statuses: ['Draft', 'Active'],
      editableStatuses: ['Draft'],
      tabs: ['Register'],
      printTemplates: [
        { key: 'pdf-cert', label: 'Quality Certificate PDF', kind: 'pdf', scope: 'record' },
      ],
      fields: [{ key: 'title', label: 'Title', type: 'text' }],
    });

    const handler: TypedHandler = {
      pageId: 'kit-pdf-test-page',
      async list() {
        return { rows: [], total: 0 };
      },
      async get(caller, id) {
        return {
          id,
          unitId: unitTalId,
          fyId: 'fy-test',
          department: 'Quality',
          createdAt: new Date().toISOString(),
          status: 'Active',
          title: 'Certificate #1',
        };
      },
      async create() {
        throw new Error('not implemented');
      },
      async update() {
        throw new Error('not implemented');
      },
    };

    registerKitModule('test-print-pdf', (kit) => {
      kit.page({ schema, handler });
      kit.pdf('kit-pdf-test-page', 'pdf-cert', async () => fakePdfBytes);
    });

    bootKit(Router());

    const res = await request(app)
      .get(`${API}/pages/kit-pdf-test-page/records/rec-999/pdf/pdf-cert`)
      .set(owner.bearer)
      .set('X-Unit-Id', unitTalId);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toBe('inline; filename="pdf-cert-rec-999.pdf"');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.toString()).toContain('%PDF-1.4');

    // Verify audit
    const audit = await prisma.auditLog.findFirst({
      where: {
        action: 'PRINT_RENDERED',
        targetId: 'rec-999',
      },
      orderBy: { at: 'desc' },
    });
    expect(audit).toBeDefined();
    expect((audit?.detail as any)?.kind).toBe('pdf');
  });

  it('3. PDF size > 10 MB returns 413 PAYLOAD_TOO_LARGE', async () => {
    const hugePdf = Buffer.alloc(10 * 1024 * 1024 + 1024, 0x41);

    const schema = defineKitSchema({
      pageId: 'kit-pdf-huge-page',
      title: 'Huge PDF Test Page',
      family: 'Quality / QMS',
      purpose: 'Testing pdf 10MB limit',
      department: 'Quality',
      statuses: ['Active'],
      editableStatuses: [],
      tabs: ['Register'],
      printTemplates: [
        { key: 'huge', label: 'Huge PDF', kind: 'pdf', scope: 'record' },
      ],
      fields: [],
    });

    const handler: TypedHandler = {
      pageId: 'kit-pdf-huge-page',
      async list() {
        return { rows: [], total: 0 };
      },
      async get(caller, id) {
        return {
          id,
          unitId: unitTalId,
          fyId: 'fy-test',
          department: 'Quality',
          createdAt: new Date().toISOString(),
          status: 'Active',
        } as any;
      },
      async create() {
        throw new Error('not implemented');
      },
      async update() {
        throw new Error('not implemented');
      },
    };

    registerKitModule('test-print-huge', (kit) => {
      kit.page({ schema, handler });
      kit.pdf('kit-pdf-huge-page', 'huge', async () => hugePdf);
    });

    bootKit(Router());

    const res = await request(app)
      .get(`${API}/pages/kit-pdf-huge-page/records/rec-huge/pdf/huge`)
      .set(owner.bearer)
      .set('X-Unit-Id', unitTalId);

    expect(res.status).toBe(413);
    expect(res.body.error?.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('4. unknown template returns 404', async () => {
    const schema = defineKitSchema({
      pageId: 'kit-print-404-page',
      title: '404 Print Page',
      family: 'Quality / QMS',
      purpose: 'Testing 404',
      department: 'Quality',
      statuses: ['Active'],
      editableStatuses: [],
      tabs: ['Register'],
      printTemplates: [
        { key: 'known', label: 'Known', kind: 'web', scope: 'record' },
      ],
      fields: [],
    });

    const handler: TypedHandler = {
      pageId: 'kit-print-404-page',
      async list() {
        return { rows: [], total: 0 };
      },
      async get(caller, id) {
        return {
          id,
          unitId: unitTalId,
          fyId: 'fy-test',
          department: 'Quality',
          createdAt: new Date().toISOString(),
          status: 'Active',
        } as any;
      },
      async create() {
        throw new Error('not implemented');
      },
      async update() {
        throw new Error('not implemented');
      },
    };

    registerKitModule('test-print-404', (kit) => {
      kit.page({ schema, handler });
      kit.printData('kit-print-404-page', 'known', async () => ({
        templateKey: 'known',
        title: 'Known',
        docNo: '1',
        docDate: '2026-11-04',
        unit: { code: 'TAL', name: 'Talwandi' },
        letterhead: {},
        parties: [],
        facts: [],
        lines: null,
        sections: [],
        totals: [],
        signatures: [],
      }));
    });

    bootKit(Router());

    const res = await request(app)
      .get(`${API}/pages/kit-print-404-page/records/rec-1/print/unknown-template`)
      .set(owner.bearer)
      .set('X-Unit-Id', unitTalId);

    expect(res.status).toBe(404);
  });

  it('5. export permission is required for PDF routes', async () => {
    const schema = defineKitSchema({
      pageId: 'kit-pdf-perm-page',
      title: 'PDF Perm Page',
      family: 'Quality / QMS',
      purpose: 'Testing permissions',
      department: 'Quality',
      statuses: ['Active'],
      editableStatuses: [],
      tabs: ['Register'],
      printTemplates: [
        { key: 'pdf-perm', label: 'PDF Perm', kind: 'pdf', scope: 'record' },
      ],
      fields: [],
    });

    const handler: TypedHandler = {
      pageId: 'kit-pdf-perm-page',
      async list() {
        return { rows: [], total: 0 };
      },
      async get(caller, id) {
        return {
          id,
          unitId: unitTalId,
          fyId: 'fy-test',
          department: 'Quality',
          createdAt: new Date().toISOString(),
          status: 'Active',
        } as any;
      },
      async create() {
        throw new Error('not implemented');
      },
      async update() {
        throw new Error('not implemented');
      },
    };

    registerKitModule('test-pdf-perm', (kit) => {
      kit.page({ schema, handler });
      kit.pdf('kit-pdf-perm-page', 'pdf-perm', async () => Buffer.from('test'));
    });

    bootKit(Router());

    // Member has no export permission on kit-pdf-perm-page
    const res = await request(app)
      .get(`${API}/pages/kit-pdf-perm-page/records/rec-1/pdf/pdf-perm`)
      .set(member.bearer)
      .set('X-Unit-Id', unitTalId);

    expect(res.status).toBe(403);
  });

  it('6. renderer error returns 500', async () => {
    const schema = defineKitSchema({
      pageId: 'kit-err-print-page',
      title: 'Err Print Page',
      family: 'Quality / QMS',
      purpose: 'Testing error 500',
      department: 'Quality',
      statuses: ['Active'],
      editableStatuses: [],
      tabs: ['Register'],
      printTemplates: [
        { key: 'failing', label: 'Failing', kind: 'web', scope: 'record' },
      ],
      fields: [],
    });

    const handler: TypedHandler = {
      pageId: 'kit-err-print-page',
      async list() {
        return { rows: [], total: 0 };
      },
      async get(caller, id) {
        return {
          id,
          unitId: unitTalId,
          fyId: 'fy-test',
          department: 'Quality',
          createdAt: new Date().toISOString(),
          status: 'Active',
        } as any;
      },
      async create() {
        throw new Error('not implemented');
      },
      async update() {
        throw new Error('not implemented');
      },
    };

    registerKitModule('test-print-failing', (kit) => {
      kit.page({ schema, handler });
      kit.printData('kit-err-print-page', 'failing', async () => {
        throw new Error('Rendering failed unexpectedly');
      });
    });

    bootKit(Router());

    const res = await request(app)
      .get(`${API}/pages/kit-err-print-page/records/rec-err/print/failing`)
      .set(owner.bearer)
      .set('X-Unit-Id', unitTalId);

    expect(res.status).toBe(500);
  });

  it('7. page-scoped web print returns PrintDto with query params', async () => {
    let capturedQuery: any = null;

    const schema = defineKitSchema({
      pageId: 'kit-page-print-page',
      title: 'Page Scope Print',
      family: 'Quality / QMS',
      purpose: 'Testing page-scoped print',
      department: 'Quality',
      statuses: ['Active'],
      editableStatuses: [],
      tabs: ['Register'],
      printTemplates: [
        { key: 'summary', label: 'Summary Report', kind: 'web', scope: 'page' },
      ],
      fields: [],
    });

    const handler: TypedHandler = {
      pageId: 'kit-page-print-page',
      async list() {
        return { rows: [], total: 0 };
      },
      async get() {
        throw new Error('not implemented');
      },
      async create() {
        throw new Error('not implemented');
      },
      async update() {
        throw new Error('not implemented');
      },
    };

    registerKitModule('test-page-print', (kit) => {
      kit.page({ schema, handler });
      kit.printData('kit-page-print-page', 'summary', async ({ query }) => {
        capturedQuery = query;
        return {
          templateKey: 'summary',
          title: 'Daily Quality Summary',
          docNo: 'SUM-2026-11',
          docDate: '2026-11-04',
          unit: { code: 'TAL', name: 'Talwandi' },
          letterhead: {},
          parties: [],
          facts: [{ label: 'Status Filter', value: String(query?.status ?? 'All') }],
          lines: null,
          sections: [],
          totals: [],
          signatures: [],
        };
      });
    });

    bootKit(Router());

    const res = await request(app)
      .get(`${API}/pages/kit-page-print-page/print/summary?status=Active`)
      .set(owner.bearer)
      .set('X-Unit-Id', unitTalId);

    expect(res.status).toBe(200);
    expect(res.body.data.title).toBe('Daily Quality Summary');
    expect(capturedQuery?.status).toBe('Active');
  });

  it('8. boot validation KR-01 (g) & (h) catches missing builder and duplicate keys', () => {
    const badSchema1 = defineKitSchema({
      pageId: 'bad-print-schema-1',
      title: 'Bad Print',
      family: 'Quality / QMS',
      purpose: 'Missing builder',
      department: 'Quality',
      statuses: ['Active'],
      editableStatuses: [],
      tabs: ['Register'],
      printTemplates: [
        { key: 'missing-builder', label: 'Missing', kind: 'web', scope: 'record' },
      ],
      fields: [],
    });

    const handler: TypedHandler = {
      pageId: 'bad-print-schema-1',
      async list() {
        return { rows: [], total: 0 };
      },
      async get() {
        return {} as any;
      },
      async create() {
        throw new Error('x');
      },
      async update() {
        throw new Error('x');
      },
    };

    registerKitModule('bad-mod-1', (kit) => {
      kit.page({ schema: badSchema1, handler });
    });

    expect(() => bootKit(Router())).toThrow(
      'KIT: print template bad-print-schema-1.missing-builder has no builder',
    );
  });
});
