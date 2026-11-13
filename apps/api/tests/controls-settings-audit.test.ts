// System Control Center, Letterhead and the Audit Trail viewer (Phase 2 §2.3, §2.6, §3): list
// filters, PATCH with If-Match, Administration protection, allow_* effects, letterhead validation
// (GSTIN/PAN/CIN/email/URL), and audit log filtering/paging.
import request from 'supertest';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { registry } from '../src/core/registry';
import {
  API,
  auditRows,
  errorOf,
  makeUser,
  newApp,
  signIn,
  signInAs,
  signInOwner,
} from './helpers';
import type { Signed } from './helpers';
import { controlVersion, permissionsOf, restoreGlobal, snapshotGlobal } from './phase2-helpers';
import type { GlobalSnapshot } from './phase2-helpers';

const app = newApp();
let owner: Signed;
let admin: Signed;
let snap: GlobalSnapshot;

beforeAll(async () => {
  owner = await signInOwner(app);
  admin = await signInAs(app, 'ADMIN');
  snap = await snapshotGlobal();
});

afterEach(async () => {
  await restoreGlobal(snap);
});

interface ControlRow {
  pageId: string;
  title: string;
  family: string;
  enabled: boolean;
  ownerDepartment: string;
  approvalRequired: boolean;
  version: number;
}

describe('GET /module-controls', () => {
  it('returns every registry page in registry order with prototype defaults', async () => {
    const res = await request(app).get(`${API}/module-controls`).set(admin.bearer);
    expect(res.status).toBe(200);
    const rows = (res.body as { data: ControlRow[] }).data;
    expect(rows).toHaveLength(registry.pages.size);
    expect(rows.map((r) => r.pageId)).toEqual([...registry.pages.keys()]);
    const byId = new Map(rows.map((r) => [r.pageId, r]));
    expect(byId.get('crm-leads')).toMatchObject({
      ownerDepartment: 'Sales',
      approvalRequired: true,
      enabled: true,
    });
    expect(byId.get('pay-payslip')?.ownerDepartment).toBe('HR');
    expect(byId.get('dashboard')).toMatchObject({
      ownerDepartment: 'Administration',
      approvalRequired: false,
    });
    expect(byId.get('admin-users')?.approvalRequired).toBe(false);
  });

  it('filters by family and text; 422 on unknown keys; ADMIN+ only', async () => {
    const fam = await request(app)
      .get(`${API}/module-controls`)
      .query({ family: 'CRM' })
      .set(admin.bearer);
    expect((fam.body as { data: ControlRow[] }).data).toHaveLength(8);
    const q = await request(app)
      .get(`${API}/module-controls`)
      .query({ q: 'PIPELINE' })
      .set(admin.bearer);
    expect((q.body as { data: ControlRow[] }).data.map((r) => r.pageId)).toContain('crm-pipeline');
    expect(
      (await request(app).get(`${API}/module-controls`).query({ x: 1 }).set(admin.bearer)).status,
    ).toBe(422);
    const manager = await signInAs(app, 'MANAGER');
    expect((await request(app).get(`${API}/module-controls`).set(manager.bearer)).status).toBe(403);
  });
});

describe('PATCH /module-controls/:pageId', () => {
  const patch = (s: Signed, pageId: string, body: object, version?: number) => {
    const req = request(app).patch(`${API}/module-controls/${pageId}`).set(s.bearer);
    return (version === undefined ? req : req.set('If-Match', String(version))).send(body);
  };

  it('updates with If-Match, bumps the version and audits before/after', async () => {
    const version = await controlVersion('crm-leads');
    const res = await patch(
      admin,
      'crm-leads',
      { approvalRequired: false, ownerDepartment: 'Service' },
      version,
    );
    expect(res.status).toBe(200);
    expect((res.body as { data: ControlRow }).data).toMatchObject({
      approvalRequired: false,
      ownerDepartment: 'Service',
      version: version + 1,
    });
    const rows = await auditRows('MODULE_CONTROL_UPDATED', { targetId: 'crm-leads' });
    expect(rows.at(-1)?.detail).toMatchObject({
      before: { approvalRequired: true, ownerDepartment: 'Sales' },
      after: { approvalRequired: false, ownerDepartment: 'Service' },
    });
  });

  it('400 without If-Match, 409 stale, 404 unknown page, 422 bad body/owner', async () => {
    const version = await controlVersion('crm-leads');
    expect((await patch(admin, 'crm-leads', { enabled: false })).status).toBe(400);
    expect((await patch(admin, 'crm-leads', { enabled: false }, version + 1)).status).toBe(409);
    expect((await patch(admin, 'no-such-page', { enabled: false }, 1)).status).toBe(404);
    expect((await patch(admin, 'crm-leads', {}, version)).status).toBe(422);
    expect((await patch(admin, 'crm-leads', { enabled: 'no' }, version)).status).toBe(422);
    expect((await patch(admin, 'crm-leads', { title: 'x' }, version)).status).toBe(422);
    const owner422 = await patch(admin, 'crm-leads', { ownerDepartment: 'Nowhere' }, version);
    expect(owner422.status).toBe(422);
    expect(errorOf(owner422).fields?.ownerDepartment).toBeDefined();
  });

  it('Administration pages cannot be disabled (409 PROTECTED), even by the owner', async () => {
    for (const pageId of ['admin-settings', 'admin-users', 'admin-audit']) {
      const res = await patch(owner, pageId, { enabled: false }, await controlVersion(pageId));
      expect(res.status).toBe(409);
      expect(errorOf(res).code).toBe('PROTECTED');
    }
    // Phase 3: allow_* switches cannot be turned off on Administration pages either.
    const locked = await patch(
      owner,
      'admin-audit',
      { allowExport: false },
      await controlVersion('admin-audit'),
    );
    expect(locked.status).toBe(409);
    expect(errorOf(locked).code).toBe('PROTECTED');
    const ok = await patch(
      owner,
      'admin-audit',
      { approvalRequired: true },
      await controlVersion('admin-audit'),
    );
    expect(ok.status).toBe(200);
  });

  it('allow_* switches bind the Super Admin too; managers cannot PATCH', async () => {
    const res = await patch(
      owner,
      'sales-orders',
      { allowAdd: false },
      await controlVersion('sales-orders'),
    );
    expect(res.status).toBe(200);
    const perms = await permissionsOf(app, owner, 'sales-orders');
    expect(perms.data.actions.add).toBe(false);
    expect(perms.data.actions.view).toBe(true);
    const manager = await signInAs(app, 'MANAGER');
    expect(
      (
        await patch(
          manager,
          'sales-orders',
          { allowAdd: true },
          await controlVersion('sales-orders'),
        )
      ).status,
    ).toBe(403);
  });
});

describe('Letterhead', () => {
  const valid = {
    companyName: 'RHAI Industries Pvt. Ltd.',
    legalName: 'RHAI Industries Private Limited',
    address: '12 MG Road, Pune 411001',
    phone: '+91 20 1234 5678',
    email: 'accounts@rhai.example',
    website: 'https://rhai.example',
    gstin: '27aapfu0939f1zv',
    pan: 'AAPFU0939F',
    cin: 'U74999MH2020PTC123456',
    footer: 'Thank you for your business',
    signatory: 'Director',
  };

  async function current(s: Signed) {
    const res = await request(app).get(`${API}/settings/letterhead`).set(s.bearer);
    return res.body as { data: { value: typeof valid; version: number } };
  }

  it('any signed-in user can read the seeded defaults', async () => {
    const member = await signIn(app, await makeUser({ role: 'MEMBER' }));
    const body = await current(member);
    expect(Object.keys(body.data).sort()).toEqual(['value', 'version']);
    expect(body.data.value).toMatchObject({
      companyName: 'RHAI Industries Pvt. Ltd.',
      address: 'Configure registered address in System Settings',
      footer: 'System-generated document from RHAI Enterprise ERP',
      signatory: 'Authorized Signatory',
    });
    expect(body.data.version).toBeGreaterThanOrEqual(1);
  });

  it('PUT saves (GSTIN upper-cased), bumps the version, audits; reload shows it', async () => {
    const before = await current(admin);
    const res = await request(app)
      .put(`${API}/settings/letterhead`)
      .set(admin.bearer)
      .set('If-Match', String(before.data.version))
      .send(valid);
    expect(res.status).toBe(200);
    const saved = (res.body as { data: { value: typeof valid; version: number } }).data;
    expect(saved.value.gstin).toBe('27AAPFU0939F1ZV');
    expect(saved.version).toBe(before.data.version + 1);
    expect((await current(admin)).data.value.signatory).toBe('Director');
    const rows = await auditRows('SETTINGS_UPDATED', { targetId: 'letterhead' });
    expect(rows.at(-1)?.detail).toMatchObject({
      key: 'letterhead',
      after: { signatory: 'Director' },
    });
  });

  it('empty optional fields are fine; only companyName is required', async () => {
    const version = (await current(admin)).data.version;
    const res = await request(app)
      .put(`${API}/settings/letterhead`)
      .set(admin.bearer)
      .set('If-Match', String(version))
      .send({ companyName: 'Only Name' });
    expect(res.status).toBe(200);
    expect((res.body as { data: { value: typeof valid } }).data.value.gstin).toBe('');
  });

  it('422 per field for invalid GSTIN, PAN, CIN, email, website, lengths, unknown keys', async () => {
    const version = (await current(admin)).data.version;
    const bad: [Record<string, unknown>, string][] = [
      [{ ...valid, gstin: '27AAPFU0939F1Z' }, 'gstin'],
      [{ ...valid, pan: 'AAPF0939F' }, 'pan'],
      [{ ...valid, cin: 'X74999MH2020PTC123456' }, 'cin'],
      [{ ...valid, email: 'not-an-email' }, 'email'],
      [{ ...valid, website: 'ftp://rhai.example' }, 'website'],
      [{ ...valid, companyName: '' }, 'companyName'],
      [{ ...valid, phone: '1'.repeat(31) }, 'phone'],
      [{ ...valid, footer: 'x'.repeat(201) }, 'footer'],
      [{ ...valid, logo: 'x' }, 'logo'],
    ];
    for (const [body, field] of bad) {
      const res = await request(app)
        .put(`${API}/settings/letterhead`)
        .set(admin.bearer)
        .set('If-Match', String(version))
        .send(body);
      expect(res.status, field).toBe(422);
      expect(errorOf(res).fields?.[field], field).toBeDefined();
    }
  });

  it('400 without If-Match, 409 stale, 403 without controls on admin-settings', async () => {
    const version = (await current(admin)).data.version;
    expect(
      (await request(app).put(`${API}/settings/letterhead`).set(admin.bearer).send(valid)).status,
    ).toBe(400);
    const stale = await request(app)
      .put(`${API}/settings/letterhead`)
      .set(admin.bearer)
      .set('If-Match', String(version + 4))
      .send(valid);
    expect(stale.status).toBe(409);
    const manager = await signInAs(app, 'MANAGER');
    const res = await request(app)
      .put(`${API}/settings/letterhead`)
      .set(manager.bearer)
      .set('If-Match', String(version))
      .send(valid);
    expect(res.status).toBe(403);
  });
});

describe('GET /audit-logs', () => {
  interface AuditBody {
    id: string;
    at: string;
    action: string;
    actor: { name: string; loginId: string } | null;
    detail: unknown;
  }

  it('newest first, with actor name/loginId and detail; paging meta', async () => {
    const res = await request(app).get(`${API}/audit-logs`).query({ size: 5 }).set(admin.bearer);
    expect(res.status).toBe(200);
    const body = res.body as {
      data: AuditBody[];
      meta: { page: number; size: number; total: number };
    };
    expect(body.data).toHaveLength(5);
    expect(body.meta).toMatchObject({ page: 1, size: 5 });
    expect(body.meta.total).toBeGreaterThan(5);
    const times = body.data.map((r) => Date.parse(r.at));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    expect(Object.keys(body.data[0] ?? {}).sort()).toEqual(
      ['action', 'actor', 'at', 'detail', 'id', 'ip', 'targetId', 'targetType', 'userAgent'].sort(),
    );
    const withActor = body.data.find((r) => r.actor);
    expect(withActor?.actor).toHaveProperty('loginId');
  });

  it('filters by action, actor, text and date range', async () => {
    const member = await makeUser();
    await signIn(app, member);
    const byAction = await request(app)
      .get(`${API}/audit-logs`)
      .query({ action: 'LOGIN_SUCCESS', actorId: member.id })
      .set(admin.bearer);
    const rows = (byAction.body as { data: AuditBody[] }).data;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actor?.loginId).toBe(member.loginId);
    const byText = await request(app)
      .get(`${API}/audit-logs`)
      .query({ q: member.loginId })
      .set(admin.bearer);
    expect((byText.body as { data: AuditBody[] }).data.length).toBeGreaterThanOrEqual(1);
    const future = await request(app)
      .get(`${API}/audit-logs`)
      .query({ from: '2999-01-01' })
      .set(admin.bearer);
    expect((future.body as { data: AuditBody[] }).data).toHaveLength(0);
    const today = new Date().toISOString().slice(0, 10);
    const day = await request(app)
      .get(`${API}/audit-logs`)
      .query({ from: today, to: today, actorId: member.id })
      .set(admin.bearer);
    expect((day.body as { data: AuditBody[] }).data.length).toBeGreaterThanOrEqual(1);
  });

  it('GET /audit-logs/:id; 404 unknown; 422 bad query; ADMIN+ only', async () => {
    const list = await request(app).get(`${API}/audit-logs`).query({ size: 1 }).set(admin.bearer);
    const first = (list.body as { data: AuditBody[] }).data[0];
    const one = await request(app)
      .get(`${API}/audit-logs/${first?.id ?? ''}`)
      .set(admin.bearer);
    expect(one.status).toBe(200);
    expect((one.body as { data: AuditBody }).data.id).toBe(first?.id);
    expect(
      (
        await request(app)
          .get(`${API}/audit-logs/00000000-0000-4000-8000-000000000000`)
          .set(admin.bearer)
      ).status,
    ).toBe(404);
    for (const query of [{ size: 101 }, { from: 'yesterday' }, { actorId: 'x' }, { foo: 1 }]) {
      expect(
        (await request(app).get(`${API}/audit-logs`).query(query).set(admin.bearer)).status,
      ).toBe(422);
    }
    const manager = await signInAs(app, 'MANAGER');
    expect((await request(app).get(`${API}/audit-logs`).set(manager.bearer)).status).toBe(403);
  });
});
