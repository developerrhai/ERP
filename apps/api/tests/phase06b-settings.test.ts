// Phase 06B through the real API (docs/phases/PHASE-06B.md §10): only the Department Head of the owner
// department (and Administrators) can change settings, versions are append-only, the dynamic
// cascade (a changed rate reaches the next document, an old document keeps its version), customer
// formats, approval of money-affecting rule sets, the Excel import report and the audit rows.
import ExcelJS from 'exceljs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { invalidateAccessCache } from '../src/core/rbac/access';
import { applyPrintFormat } from '../src/core/settings/format-schema';
import {
  API,
  auditRows,
  errorOf,
  makeUser,
  newApp,
  prisma,
  signIn,
  signInOwner,
  unitIds,
} from './helpers';
import type { Signed } from './helpers';
import { api, dataOf, sampleData, schemaOf } from './phase4-helpers';

const app = newApp();
const client = api(app);
const QUOTE = 'sales-quotations'; // owner Sales, generic page with money fields
const LEAD = 'crm-leads'; // owner Sales, approval required
const NS = `/pages/${QUOTE}/settings`;

let TAL: string;
let owner: Signed;
let admin: Signed;
let salesHead: Signed;
let salesMgr: Signed;
let salesEmp: Signed;
let purchaseHead: Signed;
let n = 0;

interface Dto {
  id: string;
  version: number;
  versionNo: number;
  status: string;
  name: string;
  content: Record<string, unknown>;
  moneyAffecting: boolean | null;
  code: string | null;
  customer: { id: string } | null;
  sourceFileId: string | null;
  publishedBy: { name: string } | null;
}

const hdr = (s: Signed) => ({ ...s.bearer, 'X-Unit-Id': TAL });

function put(s: Signed, url: string, body: unknown, ifMatch: number | string = 0, key?: string) {
  const r = request(app).put(`${API}${url}`).set(hdr(s)).set('If-Match', String(ifMatch));
  return (key ? r.set('Idempotency-Key', key) : r).send(body as object);
}
function post(s: Signed, url: string, body: unknown = {}, ifMatch?: number | string, key?: string) {
  let r = request(app).post(`${API}${url}`).set(hdr(s));
  if (ifMatch !== undefined) r = r.set('If-Match', String(ifMatch));
  if (key) r = r.set('Idempotency-Key', key);
  return r.send(body as object);
}
const get = (s: Signed, url: string) => request(app).get(`${API}${url}`).set(hdr(s));

const formatSchema = (title: string, extra: Record<string, unknown> = {}) => ({
  title,
  header: [{ key: 'ref', label: 'Customer reference', type: 'text', required: true }],
  columns: [
    { key: 'item', label: 'Item', type: 'text' },
    { key: 'qty', label: 'Quantity', type: 'number' },
    { key: 'rate', label: 'Rate', type: 'money' },
    { key: 'amount', label: 'Amount', type: 'money', formula: 'qty * rate' },
  ],
  totals: [{ key: 'sub', label: 'Sub total', op: 'sum', column: 'amount' }],
  print: { paper: 'A4', orientation: 'portrait', signatures: ['Prepared by', 'Approved by'] },
  ...extra,
});

/** Saves a new draft of a FORM format and publishes it. Returns the published version. */
async function publishFormat(
  s: Signed,
  pageId: string,
  title: string,
  key: { kind?: string; customerId?: string } = {},
): Promise<Dto> {
  const base = `/pages/${pageId}/settings/formats`;
  const saved = await put(s, base, {
    kind: key.kind ?? 'FORM',
    name: title,
    schema: formatSchema(title),
    ...(key.customerId ? { customerId: key.customerId } : {}),
  });
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  const draft = dataOf<Dto>(saved);
  const pub = await post(
    s,
    `${base}/${draft.id}/publish`,
    { reason: `Publish ${title}` },
    draft.version,
  );
  expect(pub.status, JSON.stringify(pub.body)).toBe(200);
  return dataOf<Dto>(pub);
}

const quoteRule = (margin: string) => ({
  inputs: [
    { name: 'subtotal', label: 'Sub total' },
    { name: 'discount', label: 'Discount' },
    { name: 'freight', label: 'Freight' },
  ],
  parameters: [
    { name: 'margin_pct', label: 'Margin %', value: margin, unit: 'percent' },
    { name: 'gst_pct', label: 'GST % (test value)', value: '18', unit: 'percent' },
  ],
  tables: [],
  outputs: [
    {
      name: 'marked',
      expression: 'round((subtotal - discount) * (1 + margin_pct / 100), 2)',
      places: 2,
    },
    { name: 'taxable', expression: 'marked + freight', places: 2 },
    { name: 'gst', expression: 'round(taxable * gst_pct / 100, 2)', places: 2 },
    { name: 'grandTotal', expression: 'taxable + gst', places: 2 },
  ],
  bindings: {
    inputs: { subtotal: 'subtotal', discount: 'discount', freight: 'freight' },
    amountOutput: 'grandTotal',
    fieldOutputs: { taxable: 'taxable', gst: 'gst', grandTotal: 'grandTotal' },
  },
});

async function publishRule(
  s: Signed,
  pageId: string,
  code: string,
  definition: unknown,
  moneyAffecting = true,
) {
  const base = `/pages/${pageId}/settings/rules`;
  const saved = await put(s, base, { code, name: `Rules ${code}`, moneyAffecting, definition });
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  const draft = dataOf<Dto>(saved);
  return post(s, `${base}/${draft.id}/publish`, { reason: 'Rate review' }, draft.version);
}

async function newQuote(s: Signed, values: Record<string, unknown>) {
  n += 1;
  const data = { ...sampleData(schemaOf(QUOTE), n), ...values };
  const res = await client.create(s, QUOTE, data, { unit: TAL });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return dataOf<{
    id: string;
    amount: number | null;
    data: Record<string, number>;
    version: number;
    formatVersionId: string | null;
    ruleSetVersionIds: Record<string, string> | null;
  }>(res);
}

async function mkCustomer() {
  const name = `Customer ${Date.now().toString(36)}${(n += 1)}`;
  return prisma.customer.create({
    data: {
      code: `C${Date.now().toString(36)}${n}`.toUpperCase().slice(0, 30),
      name,
      nameKey: `${name}`.toLowerCase(),
      stateCode: '27',
      gstRegistrationType: 'UNREGISTERED',
      approvalStatus: 'APPROVED',
    },
  });
}

async function xlsx(rows: (string | number)[][], sheet = 'Format'): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheet);
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

function upload(s: Signed, query: string, buffer: Buffer, filename = 'file.xlsx') {
  return request(app)
    .post(`${API}${NS}/import?${query}`)
    .set(hdr(s))
    .attach('file', buffer, filename);
}

let savedControl: { approvalRequired: boolean } | undefined;

beforeAll(async () => {
  TAL = (await unitIds(['TAL']))[0] as string;
  owner = await signInOwner(app);
  const mk = async (role: string, department: string, limit: number | null = 0) =>
    signIn(app, await makeUser({ role, department, approvalLimit: limit }));
  admin = await mk('ADMINISTRATOR', 'Administration', 0);
  salesHead = await mk('DEPT_HEAD', 'Sales', 100_000);
  salesMgr = await mk('DEPT_MANAGER', 'Sales', 100_000);
  salesEmp = await mk('EMPLOYEE', 'Sales');
  purchaseHead = await mk('DEPT_HEAD', 'Purchase', 100_000);
  invalidateAccessCache();
  savedControl = await prisma.moduleControl.findUniqueOrThrow({
    where: { pageId: QUOTE },
    select: { approvalRequired: true },
  });
});

afterAll(async () => {
  if (savedControl)
    await prisma.moduleControl.update({ where: { pageId: QUOTE }, data: savedControl });
  invalidateAccessCache();
});

describe('who may see and change settings', () => {
  it('401 without a token; 404 for an unknown page', async () => {
    expect((await request(app).get(`${API}${NS}/formats`)).status).toBe(401);
    expect((await request(app).put(`${API}${NS}/formats`).send({})).status).toBe(401);
    expect((await get(salesEmp, '/pages/no-such-page/settings/formats')).status).toBe(404);
  });

  it('everybody with view can read; the response says who may edit', async () => {
    const res = await get(salesEmp, `${NS}/formats`);
    expect(res.status).toBe(200);
    expect((res.body as { meta: object }).meta).toEqual({
      ownerDepartment: 'Sales',
      canEdit: false,
    });
    const head = await get(salesHead, `${NS}/rules`);
    expect((head.body as { meta: { canEdit: boolean } }).meta.canEdit).toBe(true);
    const adm = await get(admin, `${NS}/rules`);
    expect((adm.body as { meta: { canEdit: boolean } }).meta.canEdit).toBe(true);
  });

  it('an employee, a manager and another department head get 403 FORMAT_NOT_ALLOWED', async () => {
    const body = { kind: 'FORM', name: 'X', schema: formatSchema('X') };
    for (const who of [salesEmp, salesMgr]) {
      const res = await put(who, `${NS}/formats`, body);
      expect(res.status).toBe(403);
      expect(errorOf(res).code).toBe('FORMAT_NOT_ALLOWED');
      expect(errorOf(res).message).toBe(
        'Only the Department Head of Sales can change these settings.',
      );
    }
    // another department's head cannot even open the Sales page, so the page guard answers first
    expect((await put(purchaseHead, `${NS}/formats`, body)).status).toBe(403);
    const rule = await put(salesEmp, `${NS}/rules`, {
      code: 'X',
      name: 'X',
      definition: quoteRule('5'),
    });
    expect(rule.status).toBe(403);
    const imp = await upload(salesEmp, 'target=format', await xlsx([['Section', 'Key', 'Label']]));
    expect(imp.status).toBe(403);
    expect(errorOf(imp).code).toBe('FORMAT_NOT_ALLOWED');
    expect(await prisma.formatDefinition.count({ where: { pageId: QUOTE, name: 'X' } })).toBe(0);
  });

  it('publishing is refused to a non-head even when a head saved the draft', async () => {
    const saved = await put(salesHead, `${NS}/formats`, {
      kind: 'REPORT',
      name: 'Draft for others',
      schema: formatSchema('R'),
    });
    const draft = dataOf<Dto>(saved);
    const res = await post(
      salesEmp,
      `${NS}/formats/${draft.id}/publish`,
      { reason: 'try it' },
      draft.version,
    );
    expect(res.status).toBe(403);
    expect(errorOf(res).code).toBe('FORMAT_NOT_ALLOWED');
    const del = await request(app)
      .delete(`${API}${NS}/formats/${draft.id}`)
      .set(hdr(salesEmp))
      .set('If-Match', String(draft.version));
    expect(del.status).toBe(403);
    expect(
      (await prisma.formatDefinition.findUniqueOrThrow({ where: { id: draft.id } })).status,
    ).toBe('DRAFT');
    const own = await request(app)
      .delete(`${API}${NS}/formats/${draft.id}`)
      .set(hdr(salesHead))
      .set('If-Match', String(draft.version));
    expect(own.status).toBe(204);
  });

  it('admin-formats is Administration only', async () => {
    expect((await request(app).get(`${API}/formats`)).status).toBe(401);
    expect((await get(salesHead, '/formats')).status).toBe(403);
    expect((await get(admin, '/formats')).status).toBe(200);
  });
});

describe('format lifecycle: draft, publish, versions', () => {
  it('validates input in plain English (422) and needs If-Match (400)', async () => {
    const noMatch = await request(app)
      .put(`${API}${NS}/formats`)
      .set(hdr(salesHead))
      .send({ kind: 'FORM', name: 'a', schema: formatSchema('a') });
    expect(noMatch.status).toBe(400);
    const dup = await put(salesHead, `${NS}/formats`, {
      kind: 'FORM',
      name: 'dup',
      schema: {
        columns: [
          { key: 'a', label: 'A' },
          { key: 'A', label: 'Again' },
        ],
      },
    });
    expect(dup.status).toBe(422);
    expect(JSON.stringify(errorOf(dup).fields)).toMatch(/used twice/);
    const badFormula = await put(salesHead, `${NS}/formats`, {
      kind: 'FORM',
      name: 'f',
      schema: { columns: [{ key: 'a', label: 'Amount', formula: 'zzz * 2' }] },
    });
    expect(badFormula.status).toBe(422);
    expect(errorOf(badFormula).code).toBe('FORMULA_INVALID');
    const noReason = await put(salesHead, `${NS}/formats`, {
      kind: 'FORM',
      name: 'n',
      schema: formatSchema('n'),
    });
    const d = dataOf<Dto>(noReason);
    const pub = await post(salesHead, `${NS}/formats/${d.id}/publish`, {}, d.version);
    expect(pub.status).toBe(422);
    await request(app)
      .delete(`${API}${NS}/formats/${d.id}`)
      .set(hdr(salesHead))
      .set('If-Match', String(d.version));
  });

  it('draft -> publish -> a new version retires the old one; history is kept', async () => {
    const v1 = await publishFormat(salesHead, QUOTE, 'Quotation v1', { kind: 'PRINT' });
    expect(v1).toMatchObject({ status: 'ACTIVE', versionNo: 1 });
    expect(v1.publishedBy?.name).toBeTruthy();

    // edit the draft twice with If-Match, then publish
    const base = `${NS}/formats`;
    const first = dataOf<Dto>(
      await put(
        salesHead,
        base,
        { kind: 'PRINT', name: 'Quotation v2', schema: formatSchema('Quotation v2') },
        0,
      ),
    );
    expect(first).toMatchObject({ status: 'DRAFT', versionNo: 2, version: 1 });
    const stale = await put(
      salesHead,
      base,
      { kind: 'PRINT', name: 'Quotation v2', schema: formatSchema('stale') },
      0,
    );
    expect(stale.status).toBe(409);
    expect(errorOf(stale).code).toBe('VERSION_CONFLICT');
    const second = dataOf<Dto>(
      await put(
        salesHead,
        base,
        { kind: 'PRINT', name: 'Quotation v2', schema: formatSchema('Quotation v2 edited') },
        first.version,
      ),
    );
    expect(second.version).toBe(first.version + 1);
    expect(second.content.title).toBe('Quotation v2 edited');

    // v1 is still the live one until the publish
    const live = dataOf<{ id: string; versionNo: number } | null>(
      await get(salesEmp, `${NS}/formats/resolve?kind=PRINT`),
    );
    expect(live?.versionNo).toBe(1);

    const pub = await post(
      salesHead,
      `${base}/${second.id}/publish`,
      { reason: 'New layout' },
      second.version,
    );
    expect(pub.status).toBe(200);
    const after = dataOf<{ versionNo: number; schema: { title: string } } | null>(
      await get(salesEmp, `${NS}/formats/resolve?kind=PRINT`),
    );
    expect(after?.versionNo).toBe(2);
    expect(after?.schema.title).toBe('Quotation v2 edited');

    const versions = dataOf<Dto[]>(await get(salesEmp, `${NS}/formats/versions?kind=PRINT`));
    expect(versions.map((v) => [v.versionNo, v.status])).toEqual([
      [2, 'ACTIVE'],
      [1, 'RETIRED'],
    ]);
    const oldRow = await prisma.formatDefinition.findUniqueOrThrow({ where: { id: v1.id } });
    expect(oldRow.status).toBe('RETIRED');
    expect((oldRow.schema as { title: string }).title).toBe('Quotation v1'); // never rewritten
  });

  it('writes the audit rows and the append-only change history', async () => {
    const v = await publishFormat(salesHead, QUOTE, 'Audited', { kind: 'REPORT' });
    const audit = await auditRows('FORMAT_PUBLISHED', { targetId: v.id });
    expect(audit).toHaveLength(1);
    expect(audit[0]?.actorId).toBe(salesHead.user.id);
    expect((audit[0]?.detail as { reason: string }).reason).toBe('Publish Audited');
    expect((await auditRows('FORMAT_DRAFTED', { targetId: v.id })).length).toBeGreaterThanOrEqual(
      1,
    );
    const changes = await prisma.settingsChange.findMany({
      where: { targetId: v.id },
      orderBy: { at: 'asc' },
    });
    expect(changes.map((c) => c.action)).toEqual(['DRAFTED', 'PUBLISHED']);
    expect(changes[1]?.changedById).toBe(salesHead.user.id);
    const list = dataOf<{ action: string; changedBy: { name: string } | null }[]>(
      await get(admin, `/formats/changes?pageId=${QUOTE}`),
    );
    expect(list.length).toBeGreaterThan(0);
    expect(list[0]?.changedBy?.name).toBeTruthy();
  });

  it('published versions and the history cannot be changed, even in SQL', async () => {
    const v = await publishFormat(salesHead, QUOTE, 'Immutable', { kind: 'REPORT' });
    await expect(
      prisma.$executeRaw`UPDATE format_definitions SET schema = '{}'::jsonb WHERE id = ${v.id}::uuid`,
    ).rejects.toThrow(/cannot be edited/);
    await expect(
      prisma.$executeRaw`UPDATE format_definitions SET name = 'x' WHERE id = ${v.id}::uuid`,
    ).rejects.toThrow(/cannot be edited/);
    await expect(
      prisma.$executeRaw`DELETE FROM format_definitions WHERE id = ${v.id}::uuid`,
    ).rejects.toThrow(/never deleted/);
    await expect(
      prisma.$executeRaw`UPDATE settings_changes SET reason = 'x' WHERE target_id = ${v.id}::uuid`,
    ).rejects.toThrow(/append-only/);
    await expect(
      prisma.$executeRaw`DELETE FROM settings_changes WHERE target_id = ${v.id}::uuid`,
    ).rejects.toThrow(/append-only/);
  });

  it('restore-as-new-version copies an old version into a new draft; one draft at a time', async () => {
    const base = `${NS}/formats`;
    const versions = dataOf<Dto[]>(await get(salesHead, `${NS}/formats/versions?kind=PRINT`));
    const v1 = versions.find((v) => v.versionNo === 1) as Dto;
    const restored = await post(salesHead, `${base}/${v1.id}/restore`, {});
    expect(restored.status).toBe(200);
    const d = dataOf<Dto>(restored);
    expect(d.status).toBe('DRAFT');
    expect(d.versionNo).toBe(3);
    expect(d.content.title).toBe('Quotation v1');
    const again = await post(salesHead, `${base}/${v1.id}/restore`, {});
    expect(again.status).toBe(409);
    // a head of another department cannot restore
    expect((await post(purchaseHead, `${base}/${v1.id}/restore`, {})).status).toBe(403);
    // discard it again
    const del = await request(app)
      .delete(`${API}${base}/${d.id}`)
      .set(hdr(salesHead))
      .set('If-Match', String(d.version));
    expect(del.status).toBe(204);
    expect(await prisma.formatDefinition.count({ where: { id: d.id } })).toBe(0);
    expect((await auditRows('FORMAT_DISCARDED', { targetId: d.id })).length).toBe(1);
  });

  it('double publish: the same Idempotency-Key replays, a second click gets 409', async () => {
    const base = `${NS}/formats`;
    const draft = dataOf<Dto>(
      await put(salesHead, base, { kind: 'REPORT', name: 'Dbl', schema: formatSchema('Dbl') }, 0),
    );
    const key = `pub-${Date.now()}`;
    const a = await post(
      salesHead,
      `${base}/${draft.id}/publish`,
      { reason: 'once' },
      draft.version,
      key,
    );
    const b = await post(
      salesHead,
      `${base}/${draft.id}/publish`,
      { reason: 'once' },
      draft.version,
      key,
    );
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(b.get('Idempotent-Replay')).toBe('true');
    const c = await post(
      salesHead,
      `${base}/${draft.id}/publish`,
      { reason: 'once' },
      draft.version,
    );
    expect(c.status).toBe(409);
    expect(await auditRows('FORMAT_PUBLISHED', { targetId: draft.id })).toHaveLength(1);
  });

  it('concurrent publishes of one draft: exactly one wins', async () => {
    const base = `${NS}/formats`;
    const draft = dataOf<Dto>(
      await put(salesHead, base, { kind: 'REPORT', name: 'Race', schema: formatSchema('Race') }, 0),
    );
    const results = await Promise.all(
      [1, 2, 3].map(() =>
        post(salesHead, `${base}/${draft.id}/publish`, { reason: 'race' }, draft.version),
      ),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(2);
    expect(
      await prisma.formatDefinition.count({
        where: { pageId: QUOTE, kind: 'REPORT', status: 'ACTIVE', customerId: null, unitId: null },
      }),
    ).toBe(1);
  });
});

describe('customer-wise formats', () => {
  it('the customer picked decides the format; unknown customers use the default', async () => {
    const [a, b] = [await mkCustomer(), await mkCustomer()];
    const def = await publishFormat(salesHead, QUOTE, 'Default form');
    const forA = await publishFormat(salesHead, QUOTE, 'Form for A', { customerId: a.id });
    expect(forA.customer?.id).toBe(a.id);

    const resolve = async (customerId?: string) =>
      dataOf<{ id: string; name: string; matchedBy: string } | null>(
        await get(
          salesEmp,
          `${NS}/formats/resolve?kind=FORM${customerId ? `&customerId=${customerId}` : ''}`,
        ),
      );
    expect(await resolve()).toMatchObject({ id: def.id, matchedBy: 'default' });
    expect(await resolve(a.id)).toMatchObject({
      id: forA.id,
      name: 'Form for A',
      matchedBy: 'customer',
    });
    expect(await resolve(b.id)).toMatchObject({ id: def.id, matchedBy: 'default' });

    // publishing for customer A again retires only A's format
    await publishFormat(salesHead, QUOTE, 'Form for A v2', { customerId: a.id });
    expect((await resolve(a.id))?.name).toBe('Form for A v2');
    expect((await resolve())?.id).toBe(def.id);
  });

  it('a new document is pinned to the format of the customer it is for', async () => {
    const c = await mkCustomer();
    const mine = await publishFormat(salesHead, QUOTE, 'Pinned for customer', { customerId: c.id });
    const forCustomer = await newQuote(salesEmp, { customer: c.name.toUpperCase() });
    expect(forCustomer.formatVersionId).toBe(mine.id);
    const other = await newQuote(salesEmp, { customer: 'Nobody Ltd' });
    expect(other.formatVersionId).not.toBe(mine.id);
    // publishing a new customer version never moves the existing document
    await publishFormat(salesHead, QUOTE, 'Pinned for customer v2', { customerId: c.id });
    const again = dataOf<{ formatVersionId: string }>(
      await client.get(salesEmp, QUOTE, forCustomer.id, { unit: TAL }),
    );
    expect(again.formatVersionId).toBe(mine.id);
  });

  it('an unknown customer is a plain 422', async () => {
    const res = await put(salesHead, `${NS}/formats`, {
      kind: 'FORM',
      name: 'x',
      schema: formatSchema('x'),
      customerId: '11111111-1111-4111-8111-111111111111',
    });
    expect(res.status).toBe(422);
    expect(errorOf(res).fields?.customerId).toBe('Choose an existing customer.');
  });
});

describe('dynamic cascade: a changed rate reaches the next document only', () => {
  it('an old quotation keeps its version; the next one uses the new margin', async () => {
    await prisma.moduleControl.update({
      where: { pageId: QUOTE },
      data: { approvalRequired: false },
    });
    invalidateAccessCache();

    const v1 = await publishRule(salesHead, QUOTE, 'quotation', quoteRule('10'));
    expect(v1.status, JSON.stringify(v1.body)).toBe(200);
    const rule1 = dataOf<Dto>(v1);
    expect(rule1).toMatchObject({ status: 'ACTIVE', versionNo: 1 });

    const form = await publishFormat(salesHead, QUOTE, 'Pinned form');
    const q1 = await newQuote(salesEmp, { subtotal: 1000, discount: 0, freight: 0 });
    // 1000 + 10% margin = 1100; GST 18% = 198; total 1298
    expect(q1.amount).toBe(1298);
    expect(q1.data).toMatchObject({ taxable: 1100, gst: 198, grandTotal: 1298 });
    expect(q1.ruleSetVersionIds).toEqual({ quotation: rule1.id });
    expect(q1.formatVersionId).toBe(form.id);

    // the head changes the margin in Settings: no code change
    const v2 = await publishRule(salesHead, QUOTE, 'quotation', quoteRule('20'));
    expect(v2.status, JSON.stringify(v2.body)).toBe(200);
    const rule2 = dataOf<Dto>(v2);
    expect(rule2).toMatchObject({ status: 'ACTIVE', versionNo: 2 });

    const q2 = await newQuote(salesEmp, { subtotal: 1000, discount: 0, freight: 0 });
    expect(q2.amount).toBe(1416); // 1200 + 216
    expect(q2.ruleSetVersionIds).toEqual({ quotation: rule2.id });

    // the old quotation still reads and prints as it was created ...
    const old = dataOf<typeof q1>(await client.get(salesEmp, QUOTE, q1.id, { unit: TAL }));
    expect(old.amount).toBe(1298);
    expect(old.ruleSetVersionIds).toEqual({ quotation: rule1.id });
    // ... and editing it recalculates with ITS version, not the new one
    const edited = await client.patch(
      salesEmp,
      QUOTE,
      q1.id,
      old.version,
      { subtotal: 2000 },
      { unit: TAL },
    );
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    expect(dataOf<typeof q1>(edited).amount).toBe(2596); // (2000 * 1.10) * 1.18
    // the new one edited uses the new margin
    const edited2 = await client.patch(
      salesEmp,
      QUOTE,
      q2.id,
      q2.version,
      { subtotal: 2000 },
      { unit: TAL },
    );
    expect(dataOf<typeof q1>(edited2).amount).toBe(2832); // (2000 * 1.20) * 1.18

    const rows = await prisma.ruleSet.findMany({
      where: { pageId: QUOTE, code: 'quotation' },
      orderBy: { version: 'asc' },
    });
    expect(rows.map((r) => r.status)).toEqual(['RETIRED', 'ACTIVE']);
    expect(await auditRows('RULE_SET_PUBLISHED', { targetId: rule2.id })).toHaveLength(1);
  });

  it('evaluates a draft or the active rule set without saving anything', async () => {
    const res = await post(salesEmp, `${NS}/rules/evaluate`, {
      code: 'quotation',
      inputs: { subtotal: 500, discount: 100, freight: 50 },
    });
    expect(res.status).toBe(200);
    // (500-100) * 1.20 = 480; + 50 = 530; GST 95.40; total 625.40
    expect(dataOf<{ outputs: Record<string, string> }>(res).outputs).toEqual({
      marked: '480.00',
      taxable: '530.00',
      gst: '95.40',
      grandTotal: '625.40',
    });
    const bad = await post(salesEmp, `${NS}/rules/evaluate`, {
      code: 'quotation',
      inputs: { nope: 1 },
    });
    expect(bad.status).toBe(422);
    const none = await post(salesEmp, `${NS}/rules/evaluate`, { code: 'missing', inputs: {} });
    expect(none.status).toBe(404);
  });

  it('an invalid formula is refused with the plain message and nothing is saved', async () => {
    const def = quoteRule('10');
    def.outputs[0] = { name: 'marked', expression: 'subtotal * nope', places: 2 };
    const res = await put(salesHead, `${NS}/rules`, {
      code: 'broken',
      name: 'Broken',
      definition: def,
    });
    expect(res.status).toBe(422);
    expect(errorOf(res).code).toBe('FORMULA_INVALID');
    expect(errorOf(res).message).toBe(
      'The formula for marked is not valid: "nope" is not an input, a parameter or an earlier result.',
    );
    expect(await prisma.ruleSet.count({ where: { pageId: QUOTE, code: 'broken' } })).toBe(0);
    const code = await put(salesHead, `${NS}/rules`, {
      code: 'bad code!',
      name: 'x',
      definition: quoteRule('1'),
    });
    expect(code.status).toBe(422);
  });

  it('a format used by open documents cannot be retired (FORMAT_IN_USE)', async () => {
    const f = await publishFormat(salesHead, QUOTE, 'In use form', { kind: 'FORM' });
    await newQuote(salesEmp, { subtotal: 10, discount: 0, freight: 0 });
    const res = await post(
      salesHead,
      `${NS}/formats/${f.id}/retire`,
      { reason: 'drop it' },
      f.version,
    );
    expect(res.status).toBe(409);
    expect(errorOf(res).code).toBe('FORMAT_IN_USE');
    expect(errorOf(res).message).toBe(
      'This format is used by 1 open document. Publish a new version instead of editing.',
    );
    // publishing a new version is fine, and the old documents keep their pin
    const next = await publishFormat(salesHead, QUOTE, 'In use form v2', { kind: 'FORM' });
    expect(next.versionNo).toBe(f.versionNo + 1);
    expect(await prisma.genericRecord.count({ where: { formatVersionId: f.id } })).toBe(1);
  });

  it('retiring a format that no open document uses works and is audited', async () => {
    const f = await publishFormat(salesHead, QUOTE, 'To retire', { kind: 'REPORT' });
    const res = await post(
      salesHead,
      `${NS}/formats/${f.id}/retire`,
      { reason: 'No longer needed' },
      f.version,
    );
    expect(res.status).toBe(200);
    expect(dataOf<Dto>(res).status).toBe('RETIRED');
    expect((await auditRows('FORMAT_RETIRED', { targetId: f.id })).length).toBe(1);
    expect(dataOf<unknown>(await get(salesEmp, `${NS}/formats/resolve?kind=REPORT`))).toBeNull();
  });
});

describe('approval of money-affecting rule sets (Phase 5 engine)', () => {
  const LEAD_NS = `/pages/${LEAD}/settings`;
  const rule = (rate: string) => ({
    inputs: [{ name: 'hours' }],
    parameters: [{ name: 'rate', value: rate }],
    outputs: [{ name: 'cost', expression: 'hours * rate', places: 2 }],
  });

  it('the publish waits for approval; the approver activates it; the head cannot approve it', async () => {
    const saved = dataOf<Dto>(
      await put(salesHead, `${LEAD_NS}/rules`, {
        code: 'labour',
        name: 'Labour',
        moneyAffecting: true,
        definition: rule('500'),
      }),
    );
    const pub = await post(
      salesHead,
      `${LEAD_NS}/rules/${saved.id}/publish`,
      { reason: 'Annual rate review' },
      saved.version,
    );
    expect(pub.status, JSON.stringify(pub.body)).toBe(200);
    expect(dataOf<Dto>(pub).status).toBe('PENDING_APPROVAL');
    // not live yet
    expect(
      (await post(salesEmp, `${LEAD_NS}/rules/evaluate`, { code: 'labour', inputs: {} })).status,
    ).toBe(404);
    // the draft cannot be changed while waiting
    const edit = await put(
      salesHead,
      `${LEAD_NS}/rules`,
      { code: 'labour', name: 'Labour', definition: rule('600') },
      dataOf<Dto>(pub).version,
    );
    expect(edit.status).toBe(409);

    const reqRow = await prisma.approvalRequest.findFirstOrThrow({ where: { docId: saved.id } });
    expect(reqRow.docType).toBe('admin-formats');
    expect(reqRow.status).toBe('PENDING');
    const selfTry = await post(
      salesHead,
      `/approvals/requests/${reqRow.id}/approve`,
      {},
      reqRow.version,
    );
    expect(selfTry.status).toBe(403);

    const ok = await post(
      salesMgr,
      `/approvals/requests/${reqRow.id}/approve`,
      { comment: 'ok' },
      reqRow.version,
    );
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const row = await prisma.ruleSet.findUniqueOrThrow({ where: { id: saved.id } });
    expect(row.status).toBe('ACTIVE');
    expect(row.publishedById).toBe(salesHead.user.id);
    const audit = await auditRows('RULE_SET_PUBLISHED', { targetId: saved.id });
    expect(audit).toHaveLength(1);
    expect((audit[0]?.detail as { approvedBy: string }).approvedBy).toBe(salesMgr.user.id);
    const live = await post(salesEmp, `${LEAD_NS}/rules/evaluate`, {
      code: 'labour',
      inputs: { hours: 2 },
    });
    expect(dataOf<{ outputs: { cost: string } }>(live).outputs.cost).toBe('1000.00');
  });

  it('a rejection sends it back to a draft; a non-money rule set skips approval', async () => {
    const saved = dataOf<Dto>(
      await put(salesHead, `${LEAD_NS}/rules`, {
        code: 'labour',
        name: 'Labour',
        moneyAffecting: true,
        definition: rule('900'),
      }),
    );
    expect(saved.versionNo).toBe(2);
    await post(
      salesHead,
      `${LEAD_NS}/rules/${saved.id}/publish`,
      { reason: 'Too much' },
      saved.version,
    );
    const reqRow = await prisma.approvalRequest.findFirstOrThrow({ where: { docId: saved.id } });
    const rej = await post(
      salesMgr,
      `/approvals/requests/${reqRow.id}/reject`,
      { comment: 'Rate is too high' },
      reqRow.version,
    );
    expect(rej.status, JSON.stringify(rej.body)).toBe(200);
    const row = await prisma.ruleSet.findUniqueOrThrow({ where: { id: saved.id } });
    expect(row.status).toBe('DRAFT');
    // the live rate is unchanged
    const live = await post(salesEmp, `${LEAD_NS}/rules/evaluate`, {
      code: 'labour',
      inputs: { hours: 1 },
    });
    expect(dataOf<{ outputs: { cost: string } }>(live).outputs.cost).toBe('500.00');

    const free = await publishRule(
      salesHead,
      LEAD,
      'norms',
      { outputs: [{ name: 'x', expression: '1' }] },
      false,
    );
    expect(dataOf<Dto>(free).status).toBe('ACTIVE');
  });
});

describe('Excel import', () => {
  const formatRows = [
    ['Section', 'Key', 'Label', 'Type', 'Required', 'Options', 'Formula'],
    ['Title', '', 'Customer quotation', '', '', '', ''],
    ['Header', 'poNo', 'Customer PO number', 'text', 'yes', '', ''],
    ['Column', 'item', 'Description', 'text', 'yes', '', ''],
    ['Column', 'qty', 'Qty', 'number', 'yes', '', ''],
    ['Column', 'rate', 'Rate', 'money', 'yes', '', ''],
    ['Column', 'amount', 'Amount', 'money', '', '', 'qty * rate'],
    ['Total', 'sub', 'Sub total', 'sum', '', 'amount', ''],
    ['Signature', '', 'Prepared by', '', '', '', ''],
    ['Print', 'paper', 'A5', '', '', '', ''],
  ];

  it('a good file becomes a DRAFT format, the file is kept as evidence, and nothing is live', async () => {
    const res = await upload(
      salesHead,
      'target=format&kind=PRINT',
      await xlsx(formatRows),
      'quotation.xlsx',
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const { report, draft } = dataOf<{ report: { valid: boolean; summary: string }; draft: Dto }>(
      res,
    );
    expect(report.valid).toBe(true);
    expect(report.summary).toBe('1 header field(s), 4 column(s), 1 total(s).');
    expect(draft.status).toBe('DRAFT');
    expect(draft.content).toMatchObject({
      title: 'Customer quotation',
      print: { paper: 'A5', signatures: ['Prepared by'] },
    });
    expect(draft.sourceFileId).toBeTruthy();
    const file = await prisma.storedFile.findUniqueOrThrow({
      where: { id: draft.sourceFileId as string },
    });
    expect(file.originalFilename).toBe('quotation.xlsx');
    expect((await auditRows('FORMAT_IMPORTED', { targetId: draft.id })).length).toBe(1);
    // publishing is a separate step by the head
    const live = dataOf<{ name: string } | null>(
      await get(salesEmp, `${NS}/formats/resolve?kind=PRINT`),
    );
    expect(live?.name).not.toBe(draft.name);
    const pub = await post(
      salesHead,
      `${NS}/formats/${draft.id}/publish`,
      { reason: 'Client format' },
      draft.version,
    );
    expect(pub.status).toBe(200);
    const printLive = dataOf<{ schema: { print: { paper: string } } } | null>(
      await get(salesEmp, `${NS}/formats/resolve?kind=PRINT`),
    );
    expect(printLive?.schema.print.paper).toBe('A5');
  });

  it('a bad file returns a report with row numbers and saves nothing', async () => {
    const before = await prisma.formatDefinition.count({ where: { pageId: QUOTE } });
    const rows = [
      ['Section', 'Key', 'Label', 'Type'],
      ['Header', 'a', 'A', 'text'],
      ['Sidebar', 'b', 'B', 'text'],
      ['Signature', '', '', ''],
    ];
    const res = await upload(salesHead, 'target=format', await xlsx(rows));
    expect(res.status).toBe(200);
    const { report, draft } = dataOf<{
      report: { valid: boolean; errors: { row: number; message: string }[] };
      draft: null;
    }>(res);
    expect(draft).toBeNull();
    expect(report.valid).toBe(false);
    expect(report.errors).toEqual([
      {
        row: 3,
        message:
          'Section "Sidebar" is not known. Use Title, Header, Column, Total, Signature or Print.',
      },
      { row: 4, message: 'A Signature row needs a Label.' },
    ]);
    expect(await prisma.formatDefinition.count({ where: { pageId: QUOTE } })).toBe(before);
    const missing = await upload(salesHead, 'target=format', await xlsx([['x', 'y']]));
    expect(
      dataOf<{ report: { errors: { message: string }[] } }>(missing).report.errors[0]?.message,
    ).toMatch(/headings Section, Key, Label/);
  });

  it('refuses files that are not real Excel workbooks', async () => {
    const fake = await upload(
      salesHead,
      'target=format',
      Buffer.from('Section,Key,Label\nHeader,a,A'),
      'x.xlsx',
    );
    expect(fake.status).toBe(415);
    const csv = await upload(salesHead, 'target=format', Buffer.from('a,b'), 'x.csv');
    expect(csv.status).toBe(415);
  });

  it('a rate table lands in a draft of the rule set and can be used by lookup()', async () => {
    const rows = [
      ['Process', 'Rate per hour'],
      ['Cutting', 450],
      ['Welding', 600],
    ];
    const res = await upload(
      salesHead,
      'target=rate-table&code=processcost&tableName=process',
      await xlsx(rows, 'Rates'),
      'rates.xlsx',
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const { draft } = dataOf<{ draft: Dto }>(res);
    expect(draft).toMatchObject({ status: 'DRAFT', code: 'processcost' });
    expect(
      (draft.content as { tables: { name: string; rows: string[][] }[] }).tables[0],
    ).toMatchObject({
      name: 'process',
      rows: [
        ['Cutting', '450'],
        ['Welding', '600'],
      ],
    });
    expect(draft.sourceFileId).toBeTruthy();

    // add the real result, publish, evaluate
    const def = {
      ...draft.content,
      inputs: [{ name: 'hours' }],
      outputs: [{ name: 'cost', expression: 'hours * lookup("process", "Welding")', places: 2 }],
    };
    const edited = dataOf<Dto>(
      await put(
        salesHead,
        `${NS}/rules`,
        { code: 'processcost', name: 'Process cost', moneyAffecting: false, definition: def },
        draft.version,
      ),
    );
    const pub = await post(
      salesHead,
      `${NS}/rules/${edited.id}/publish`,
      { reason: 'Imported rates' },
      edited.version,
    );
    expect(pub.status, JSON.stringify(pub.body)).toBe(200);
    const ev = await post(salesEmp, `${NS}/rules/evaluate`, {
      code: 'processcost',
      inputs: { hours: 3 },
    });
    expect(dataOf<{ outputs: { cost: string } }>(ev).outputs.cost).toBe('1800.00');

    const dupRows = [
      ['Process', 'Rate'],
      ['Cutting', 1],
      ['cutting', 2],
      ['Welding', 'abc'],
    ];
    const bad = await upload(
      salesHead,
      'target=rate-table&code=processcost&tableName=process',
      await xlsx(dupRows, 'Rates'),
    );
    const report = dataOf<{
      report: { valid: boolean; errors: { row: number; message: string }[] };
      draft: null;
    }>(bad);
    expect(report.draft).toBeNull();
    expect(report.report.errors.map((e) => e.row)).toEqual([3, 4]);
    expect(report.report.errors[0]?.message).toBe('"cutting" appears twice in the first column.');
  });

  it('serves the two Excel templates', async () => {
    for (const target of ['format', 'rate-table']) {
      const res = await request(app)
        .get(`${API}${NS}/import-template?target=${target}`)
        .set(hdr(salesEmp))
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => cb(null, Buffer.concat(chunks)));
        });
      expect(res.status).toBe(200);
      expect((res.body as Buffer).subarray(0, 2).toString()).toBe('PK');
    }
  });
});

describe('admin-formats list', () => {
  it('lists formats and rule sets with filters, versions and the change history', async () => {
    const all = await get(admin, `/formats?pageId=${QUOTE}&size=100`);
    expect(all.status).toBe(200);
    const rows = dataOf<Dto[]>(all);
    expect(rows.some((r) => r.code === 'quotation')).toBe(true);
    expect(rows.some((r) => r.code === null)).toBe(true);
    const onlyRules = dataOf<Dto[]>(
      await get(admin, `/formats?pageId=${QUOTE}&type=rule&status=ACTIVE`),
    );
    expect(onlyRules.length).toBeGreaterThan(0);
    expect(onlyRules.every((r) => r.code !== null && r.status === 'ACTIVE')).toBe(true);
    const rule = onlyRules.find((r) => r.code === 'quotation') as Dto;
    const versions = dataOf<Dto[]>(await get(admin, `/formats/${rule.id}/versions`));
    expect(versions.map((v) => v.versionNo)).toEqual([2, 1]);
    expect((await get(admin, '/formats/not-a-uuid/versions')).status).toBe(422);
    expect(
      (await get(admin, '/formats/11111111-1111-4111-8111-111111111111/versions')).status,
    ).toBe(404);
    expect((await get(admin, '/formats?size=1000')).status).toBe(422);
  });

  it('a Super User sees everything too', async () => {
    expect((await get(owner, '/formats')).status).toBe(200);
  });
});

describe('print formats', () => {
  it('applyPrintFormat restyles the print document and never changes its data', () => {
    const dto = {
      title: 'Quotation',
      lines: {
        columns: [
          { key: 'item', label: 'Item', format: 'text' },
          { key: 'qty', label: 'Qty', format: 'qty' },
          { key: 'rate', label: 'Rate', format: 'money' },
          { key: 'secret', label: 'Cost', format: 'money' },
        ],
        rows: [{ item: 'Pump', qty: 2, rate: 10, secret: 5 }],
      },
      amountInWords: 'Twenty',
      notes: 'old',
      signatures: [{ label: 'Old' }],
      letterhead: { name: 'Sawant' },
    };
    const schema = {
      title: 'Tax quotation',
      header: [],
      columns: [
        {
          key: 'rate',
          label: 'Unit price',
          type: 'money' as const,
          required: false,
          hidden: false,
          align: 'right' as const,
        },
        {
          key: 'item',
          label: 'Description',
          type: 'text' as const,
          required: false,
          hidden: false,
        },
        { key: 'secret', label: 'Cost', type: 'money' as const, required: false, hidden: true },
      ],
      totals: [],
      validations: [],
      print: {
        paper: 'A5' as const,
        orientation: 'landscape' as const,
        showLetterhead: false,
        showAmountInWords: false,
        footerNote: 'Thank you',
        signatures: ['Prepared by'],
      },
    };
    const out = applyPrintFormat(dto, schema, { id: 'f1', version: 4 });
    expect(out.title).toBe('Tax quotation');
    expect(out.lines?.columns.map((c) => [c.key, c.label])).toEqual([
      ['rate', 'Unit price'],
      ['item', 'Description'],
      ['qty', 'Qty'],
    ]);
    expect(out.lines?.rows).toEqual(dto.lines.rows);
    expect(out.amountInWords).toBeUndefined();
    expect(out.notes).toBe('Thank you');
    expect(out.signatures).toEqual([{ label: 'Prepared by' }]);
    expect(out.letterhead).toEqual({});
    expect(out.layout).toEqual({ paper: 'A5', orientation: 'landscape', showLetterhead: false });
    expect(out.formatVersion).toEqual({ id: 'f1', version: 4 });
    expect(dto.title).toBe('Quotation'); // input untouched
  });
});
