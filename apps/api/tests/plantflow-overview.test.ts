/* eslint-disable @typescript-eslint/no-unsafe-member-access */
// Integrated Plant Flow: GET /work/plant-flow/:projectId. Real gates + movements, counters, and plant isolation.
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API, XRW, makeUser, newApp, prisma, signIn, signInOwner, unitIds } from './helpers';

describe('plant flow overview (API)', () => {
  const app = newApp();
  const tag = `PF${Date.now().toString(36).slice(-6)}`;
  const projTal = randomUUID();
  const projSaw = randomUUID();
  const made: string[] = [];
  let ownerToken = '';
  let tal = '';
  let saw = '';
  const get = (token: string, path: string, h: Record<string, string> = {}) =>
    request(app).get(`${API}${path}`).set('Authorization', `Bearer ${token}`).set(XRW).set(h);

  beforeAll(async () => {
    ownerToken = (await signInOwner(app)).token;
    [tal = '', saw = ''] = await unitIds(['TAL', 'SAW']);
    const dep = async (n: string) => ((await prisma.$queryRaw<{ id: string }[]>`SELECT id::text AS id FROM departments WHERE name = ${n} LIMIT 1`)[0]?.id ?? '');
    const sales = await dep('Sales');
    const prod = await dep('Production');
    expect(sales).not.toBe('');
    for (const [id, unit, code] of [[projTal, tal, `${tag}-T`], [projSaw, saw, `${tag}-S`]] as const) {
      await prisma.$executeRaw`INSERT INTO projects (id, code, name, unit_id, start_date, end_date, status) VALUES (${id}::uuid, ${code}, 'Flow test', ${unit}::uuid, '2026-04-01', '2027-03-31', 'ACTIVE')`;
      await prisma.$executeRaw`INSERT INTO project_gates (project_id, seq, code, name, owner_department_id, state, approved_at) VALUES (${id}::uuid, 1, 'G01', 'Order', ${sales}::uuid, 'APPROVED', now())`;
      await prisma.$executeRaw`INSERT INTO project_gates (project_id, seq, code, name, owner_department_id, state, depends_on) VALUES (${id}::uuid, 2, 'G02', 'Build', ${prod}::uuid, 'IN_WORK', ARRAY['G01'])`;
      await prisma.$executeRaw`INSERT INTO work_movements (number, unit_id, doc_type, doc_id, doc_no, project_id, from_department_id, to_department_id, state)
        VALUES (${`${code}-M1`}, ${unit}::uuid, 'pf-test', ${randomUUID()}::uuid, ${`${code}-DOC`}, ${id}::uuid, ${sales}::uuid, ${prod}::uuid, 'SENT')`;
    }
  });

  afterAll(async () => {
    await prisma.$executeRaw`DELETE FROM work_movements WHERE doc_type = 'pf-test'`;
    await prisma.$executeRaw`DELETE FROM project_gates WHERE project_id IN (${projTal}::uuid, ${projSaw}::uuid)`;
    await prisma.$executeRaw`DELETE FROM projects WHERE id IN (${projTal}::uuid, ${projSaw}::uuid)`;
    for (const id of made) await prisma.$executeRaw`DELETE FROM users WHERE id = ${id}::uuid`.catch(() => undefined);
  });

  it('returns progress, counters, gates and movements from the database', async () => {
    const r = await get(ownerToken, `/work/plant-flow/${projTal}`, { 'X-Unit-Id': tal });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const d = r.body.data;
    expect(d.project.code).toBe(`${tag}-T`);
    expect(d.progress).toEqual({ gatesTotal: 2, gatesDone: 1, progressPct: 50 });
    expect(d.pendingReceipt).toBe(1);
    expect(d.pendingAcceptance).toBe(0);
    expect(d.gates.map((g: { code: string }) => g.code)).toEqual(['G01', 'G02']);
    expect(d.gates[0].nextGateCode).toBe('G02');
    expect(d.currentGate.code).toBe('G02');
    expect(d.currentDepartment.name).toBe('Production');
    expect(d.movements).toHaveLength(1);
  });

  it('a project of another plant is 404, even for the Owner (unit scope = selected plants)', async () => {
    const r = await get(ownerToken, `/work/plant-flow/${projSaw}`, { 'X-Unit-Id': tal });
    expect(r.status).toBe(404);
  });

  it('a TAL-only user cannot read the SAW project; a bad id is 422', async () => {
    const u = await makeUser({ department: 'Sales', unitCodes: ['TAL'], defaultUnitCode: 'TAL' });
    made.push(u.id);
    const token = (await signIn(app, u)).token;
    expect((await get(token, `/work/plant-flow/${projSaw}`)).status).toBe(404);
    expect((await get(token, `/work/plant-flow/${projTal}`)).status).toBe(200);
    expect((await get(token, '/work/plant-flow/not-a-uuid')).status).toBe(422);
  });
});
