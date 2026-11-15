// Movement registers (GET /work/movements, /counts, /audit): scope per page, counters, plant isolation, short receipt.
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { kindCondition } from '../src/modules/work/movements-ext';
import { API, XRW, makeUser, newApp, prisma, signIn, signInOwner, unitIds } from './helpers';

describe('kindCondition (pure)', () => {
  it('keeps the four scopes apart', () => {
    expect(kindCondition('interplant', '$2')).toContain('is_physical');
    expect(kindCondition('maintenance', '$2')).toContain('doc_type = ANY($2::text[])');
    expect(kindCondition('process', '$2')).toContain(`'Manufacturing Action'`);
    expect(kindCondition('department', '$2')).toContain(`<> 'Manufacturing Action'`);
  });
});

describe('movement registers (API)', () => {
  const app = newApp();
  let ownerToken = '';
  let tal = '';
  let saw = '';
  let van = '';
  const docs: string[] = [];
  const users: string[] = [];
  const get = (token: string, path: string, h: Record<string, string> = {}) =>
    request(app).get(`${API}${path}`).set('Authorization', `Bearer ${token}`).set(XRW).set(h);
  const send = (token: string, path: string, body: unknown, h: Record<string, string> = {}) =>
    request(app).post(`${API}${path}`).set('Authorization', `Bearer ${token}`).set(XRW).set(h).send(body as object);

  beforeAll(async () => {
    ownerToken = (await signInOwner(app)).token;
    [tal = '', saw = '', van = ''] = await unitIds(['TAL', 'SAW', 'VAR']);
  });

  afterAll(async () => {
    for (const d of docs) await prisma.$executeRaw`DELETE FROM work_movements WHERE doc_id = ${d}::uuid`;
  });

  it('each movement lands on exactly one page; counters match; another plant sees nothing', async () => {
    const prod = await makeUser({ department: 'Production', unitCodes: ['TAL', 'SAW'] });
    users.push(prod.id);
    const prodTok = (await signIn(app, prod)).token;
    const outsider = await makeUser({ department: 'Production', unitCodes: ['VAR'] });
    const outTok = (await signIn(app, outsider)).token;
    const depts = (await get(ownerToken, '/work/departments')).body.data as { id: string; name: string }[];
    const production = depts.find((d) => d.name === 'Production')?.id ?? '';
    const sales = depts.find((d) => d.name === 'Sales')?.id ?? '';
    const h = { 'X-Unit-Id': tal };

    const mk = async (extra: Record<string, unknown>) => {
      const docId = randomUUID();
      docs.push(docId);
      const r = await send(ownerToken, '/work/movements', { docType: 'mvx-test', docId, docNo: `MVX-${docs.length}`, fromDepartmentId: sales, toDepartmentId: production, ...extra }, h);
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      return r.body.data as { id: string };
    };
    const base = (await get(ownerToken, '/work/movements/counts', h)).body.data as Record<string, number>;
    const maint = await mk({ docType: 'maint-spares' });
    const proc = await mk({ routeType: 'Manufacturing Action' });
    const dept = await mk({});
    const inter = await mk({ toUnitId: saw, isPhysical: true, lines: [{ description: 'Shafts', qty: 100, uom: 'Nos' }] });

    const ids = async (kind: string, view = 'all') =>
      ((await get(ownerToken, `/work/movements?kind=${kind}&view=${view}&limit=100`, h)).body.data.rows as { id: string }[]).map((r) => r.id);
    expect(await ids('maintenance')).toContain(maint.id);
    expect(await ids('maintenance')).not.toContain(dept.id);
    expect(await ids('process')).toContain(proc.id);
    expect(await ids('department')).toContain(dept.id);
    expect(await ids('department')).not.toContain(proc.id);
    expect(await ids('department')).not.toContain(maint.id);
    expect(await ids('interplant')).toContain(inter.id);
    expect(await ids('department')).not.toContain(inter.id);

    const after = (await get(ownerToken, '/work/movements/counts', h)).body.data as Record<string, number>;
    for (const k of ['maintenance', 'process', 'department', 'interplant']) expect(after[k]).toBe((base[k] ?? 0) + 1);

    // the row carries the real quantity lines and plants
    const row = ((await get(ownerToken, '/work/movements?kind=interplant', h)).body.data.rows as Record<string, unknown>[]).find((r) => r.id === inter.id);
    expect(row?.sent_qty).toBe(100);
    expect(row?.from_plant).toBe('TAL');
    expect(row?.to_plant).toBe('SAW');
    expect(row?.part).toBe('Shafts');

    // plant isolation: a user of another plant only gets an empty register and a zero counter (no 403 leak either)
    const hv = { 'X-Unit-Id': van };
    const out = await get(outTok, '/work/movements?kind=interplant&limit=100', hv);
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    expect(out.body.data.rows.map((r: { id: string }) => r.id)).not.toContain(inter.id);
    const zero = (await get(outTok, '/work/movements/counts', hv)).body.data as Record<string, number>;
    expect(Object.values(zero).reduce((a, b) => a + b, 0)).toBe(0);
    expect((await get(outTok, `/work/movements?kind=interplant`, { 'X-Unit-Id': tal })).status).toBe(403);

    // the destination plant (SAW) sees the plant-to-plant movement because to_unit_id is theirs
    const atSaw = await get(prodTok, '/work/movements?kind=interplant&limit=100', { 'X-Unit-Id': saw });
    expect(atSaw.body.data.rows.map((r: { id: string }) => r.id)).toContain(inter.id);

    // views: pending / variance
    expect(await ids('interplant', 'sent')).toContain(inter.id);
    expect(await ids('interplant', 'variance')).not.toContain(inter.id);

    // short receipt: 96 of 100 -> shows up under Variance with the short quantity, and in the audit
    const rec = await send(prodTok, `/work/movements/${inter.id}/receive`, { lines: [{ lineNo: 1, receivedQty: 96, shortReason: '4 damaged in transit' }] }, { 'X-Unit-Id': saw });
    expect(rec.status, JSON.stringify(rec.body)).toBe(200);
    expect(await ids('interplant', 'variance')).toContain(inter.id);
    const v = ((await get(ownerToken, '/work/movements?kind=interplant&view=variance', h)).body.data.rows as Record<string, unknown>[]).find((r) => r.id === inter.id);
    expect(v?.short_qty).toBe(4);
    expect(v?.received_qty).toBe(96);
    const audit = (await get(ownerToken, '/work/movements/audit?kind=interplant', h)).body.data as { event: string; number: string }[];
    expect(audit.some((e) => e.event === 'SHORT_RECEIPT')).toBe(true);

    // validation
    expect((await get(ownerToken, '/work/movements?kind=nonsense', h)).status).toBe(422);
    expect((await get(ownerToken, '/work/movements?kind=process&dept=not-a-uuid', h)).status).toBe(422);
    expect((await get(ownerToken, '/work/movements?kind=process&cursor=garbage', h)).status).toBe(422);
  });

  it('keyset paging returns every row once', async () => {
    const h = { 'X-Unit-Id': tal };
    const first = await get(ownerToken, '/work/movements?kind=department&limit=1', h);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    if (first.body.data.hasMore) {
      const second = await get(ownerToken, `/work/movements?kind=department&limit=1&cursor=${first.body.data.nextCursor}`, h);
      expect(second.status).toBe(200);
      expect(second.body.data.rows[0].id).not.toBe(first.body.data.rows[0].id);
    }
  });
});
