// GET /pages/:pageId/schema (docs/phase3-4 B1): the shape, kinds (generic / typed / custom), field
// metadata (required, read-only, enum options, lookup targets), permissions, and the 404s.
import request from 'supertest';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { invalidateAccessCache } from '../src/core/rbac/access';
import { errorOf, newApp, prisma, signInAs, signInOwner } from './helpers';
import type { Signed } from './helpers';
import { controlVersion, restoreGlobal, snapshotGlobal } from './phase2-helpers';
import type { GlobalSnapshot } from './phase2-helpers';
import { api, dataOf } from './phase4-helpers';
import type { PageSchema } from '../src/engine/field-schema';

const app = newApp();
const client = api(app);
let owner: Signed;
let member: Signed;
let snap: GlobalSnapshot;

beforeAll(async () => {
  owner = await signInOwner(app);
  member = await signInAs(app, 'MEMBER');
  snap = await snapshotGlobal();
});

afterEach(async () => {
  await restoreGlobal(snap);
});

const field = (schema: PageSchema, label: string) => {
  const f = schema.fields.find((x) => x.label === label);
  if (!f) throw new Error(`no field ${label}`);
  return f;
};

describe('GET /pages/:pageId/schema', () => {
  it('returns the contract shape for a generic page', async () => {
    const res = await client.schema(member, 'crm-leads');
    expect(res.status).toBe(200);
    const s = dataOf<PageSchema>(res);
    expect(s).toMatchObject({
      pageId: 'crm-leads',
      title: 'Lead Management',
      family: 'CRM',
      kind: 'generic',
      master: false,
      statuses: ['Draft', 'Pending Approval', 'Approved', 'Rejected', 'Active', 'Inactive', 'Cancelled'],
      actions: [],
    });
    expect(s.purpose.length).toBeGreaterThan(5);
    expect(s.tabs).toHaveLength(6);
    expect(s.fields).toHaveLength(14);
    expect(s.listColumns).toEqual(s.fields.slice(0, 12).map((f) => f.key));
    expect(s.transitions.Draft).toEqual(['Active', 'Cancelled']);
    expect(s.transitions.Active).toEqual(['Inactive']);
  });

  it('field metadata: types, required, read-only, constraints, options, lookups', async () => {
    const s = dataOf<PageSchema>(await client.schema(owner, 'crm-leads'));
    expect(field(s, 'Lead No')).toMatchObject({
      key: 'leadNo',
      type: 'code',
      readOnly: true,
      required: true,
    });
    expect(field(s, 'Lead Name')).toMatchObject({ type: 'text', required: true, maxLength: 200 });
    expect(field(s, 'Next Follow-up')).toMatchObject({
      key: 'nextFollowUp',
      type: 'date',
      required: false,
      pattern: '^\\d{4}-\\d{2}-\\d{2}$',
    });
    expect(field(s, 'Mobile')).toMatchObject({ type: 'phone', pattern: '^[6-9]\\d{9}$' });
    expect(field(s, 'Email')).toMatchObject({ type: 'email', maxLength: 254 });
    expect(field(s, 'Qualification Score')).toMatchObject({ type: 'pct', min: 0, max: 100 });
    expect(field(s, 'Expected Value')).toMatchObject({ type: 'money', min: 0 });
    expect(field(s, 'Company')).toMatchObject({ type: 'ref' });
    expect(field(s, 'Status')).toMatchObject({
      type: 'status',
      readOnly: true,
      required: false,
      options: ['Draft', 'Pending Approval', 'Approved', 'Rejected', 'Active', 'Inactive', 'Cancelled'],
    });
    // Only "Status" is the workflow status; "Consent Status" is an ordinary, writable enum.
    expect(field(s, 'Consent Status')).toMatchObject({
      type: 'enum',
      readOnly: false,
      options: ['Pending', 'Granted', 'Withdrawn'],
    });
    // Per-page override, then the prototype default list, then free text.
    expect(field(s, 'Stage').options).toEqual([
      'New',
      'Contacted',
      'Qualified',
      'Converted',
      'Disqualified',
    ]);
    expect(field(s, 'Source').options).toEqual([
      'Website',
      'Referral',
      'WhatsApp',
      'Campaign',
      'Existing Customer',
      'Walk-in',
    ]);
    const opp = dataOf<PageSchema>(await client.schema(owner, 'crm-opportunities'));
    expect(field(opp, 'Stage').options).toEqual([
      'New',
      'Qualified',
      'Proposal',
      'Negotiation',
      'Won',
      'Lost',
    ]);
    const sources = dataOf<PageSchema>(await client.schema(owner, 'crm-sources'));
    expect(field(sources, 'Channel').options).toBeUndefined();
    expect(field(sources, 'Channel').maxLength).toBe(200);
  });

  it('masters start Active (Active / Inactive); refs to masters carry refPage; variance fields can be negative', async () => {
    const m = dataOf<PageSchema>(await client.schema(owner, 'crm-sources'));
    expect(m).toMatchObject({ master: true, statuses: ['Active', 'Inactive'] });
    expect(field(m, 'Source Code')).toMatchObject({ type: 'code' });
    const opp = dataOf<PageSchema>(await client.schema(owner, 'crm-opportunities'));
    expect(field(opp, 'Customer')).toMatchObject({ type: 'ref', refPage: 'crm-customer360' });
    const grn = dataOf<PageSchema>(await client.schema(owner, 'scm-grn'));
    expect(grn.fields.some((f) => f.refPage === 'wms-warehouses')).toBe(true);
    const sales = dataOf<PageSchema>(await client.schema(owner, 'bi-sales'));
    expect(field(sales, 'Forecast').min).toBe(0);
  });

  it('typed, custom and Administration pages answer with their kind', async () => {
    for (const [pageId, kind] of [
      ['inv-items', 'typed'],
      ['wms-warehouses', 'typed'],
      ['inv-stock', 'typed'],
      ['inv-opening', 'typed'],
      ['inv-transactions', 'typed'],
      ['inv-adjustment', 'typed'],
      ['inv-transfer', 'typed'],
      ['dashboard', 'custom'],
      ['crm-pipeline', 'custom'],
      ['ai-copilot', 'custom'],
      ['admin-users', 'custom'],
      ['admin-fy', 'custom'],
      ['admin-company', 'custom'],
      ['admin-designations', 'generic'],
      ['admin-currency', 'generic'],
      ['admin-uom', 'generic'],
      ['admin-taxes', 'generic'],
    ] as const) {
      const res = await client.schema(owner, pageId);
      expect(res.status, pageId).toBe(200);
      expect(dataOf<PageSchema>(res).kind, pageId).toBe(kind);
    }
    // A custom page without a profile has no fields or tabs.
    expect(dataOf<PageSchema>(await client.schema(owner, 'dashboard'))).toMatchObject({
      fields: [],
      tabs: [],
      listColumns: [],
    });
  });

  it('404 for an unknown page, 401 without a token, 403 without `view`', async () => {
    expect((await client.schema(owner, 'no-such-page')).status).toBe(404);
    const anon = await request(app).get('/api/v1/pages/crm-leads/schema');
    expect(anon.status).toBe(401);
    await prisma.moduleControl.update({ where: { pageId: 'crm-leads' }, data: { enabled: false } });
    invalidateAccessCache();
    const res = await client.schema(member, 'crm-leads');
    expect(res.status).toBe(403);
    expect(errorOf(res).code).toBe('FORBIDDEN');
    expect(await controlVersion('crm-leads')).toBeGreaterThan(0);
  });
});
