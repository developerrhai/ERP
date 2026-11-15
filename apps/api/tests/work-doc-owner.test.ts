// Move Forward on a page with no workflow rule: the owner does not pick the sending department; the server takes it from the page family.
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API, XRW, makeUser, newApp, prisma, signInOwner, unitIds } from './helpers';

describe('Move Forward: owning department of a document with no rule', () => {
  const app = newApp();
  let ownerToken = '';
  let tal = '';
  const made: string[] = [];
  const docs: string[] = [];
  const post = (path: string, body: object) => request(app).post(`${API}${path}`).set('Authorization', `Bearer ${ownerToken}`).set(XRW).set({ 'X-Unit-Id': tal }).send(body);

  beforeAll(async () => {
    ownerToken = (await signInOwner(app)).token;
    [tal = ''] = await unitIds(['TAL']);
  });
  afterAll(async () => {
    for (const d of docs) await prisma.$executeRaw`DELETE FROM work_movements WHERE doc_id = ${d}::uuid`;
  });

  it('a lead (CRM page) is sent from Sales; a purchase-side page from Purchase; the same department is refused', async () => {
    const prod = await makeUser({ department: 'Production', unitCodes: ['TAL'] });
    made.push(prod.id);
    const depts = (await request(app).get(`${API}/work/departments`).set('Authorization', `Bearer ${ownerToken}`).set(XRW)).body.data as { id: string; name: string }[];
    const id = (n: string): string => depts.find((d) => d.name === n)?.id ?? '';

    const lead = randomUUID();
    docs.push(lead);
    const r1 = await post('/work/movements', { docType: 'crm-leads', docId: lead, docNo: 'LD/TEST/1', toDepartmentId: id('Production') });
    expect(r1.status, JSON.stringify(r1.body)).toBe(201);
    expect(r1.body.data.from_department_id ?? r1.body.data.fromDepartmentId).toBe(id('Sales'));

    const supplier = randomUUID();
    docs.push(supplier);
    const r2 = await post('/work/movements', { docType: 'scm-suppliers', docId: supplier, docNo: 'SUP/TEST/1', toDepartmentId: id('Production') });
    expect(r2.status, JSON.stringify(r2.body)).toBe(201);
    expect(r2.body.data.from_department_id ?? r2.body.data.fromDepartmentId).toBe(id('Purchase'));

    const same = randomUUID();
    docs.push(same);
    const r3 = await post('/work/movements', { docType: 'crm-leads', docId: same, docNo: 'LD/TEST/2', toDepartmentId: id('Sales') });
    expect(r3.status).toBe(422);
  });
});
