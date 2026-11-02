// Department Master (Phase 2 §2.3, §2.6, §3): list/create/patch/delete, If-Match, duplicates,
// Administration protection, 409 IN_USE, the users.department FK (cascade on rename, restrict on
// delete), and the Phase 1 changes (/meta/departments and user validation read the DB).
import request from 'supertest';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  API,
  auditRows,
  errorOf,
  makeUser,
  newApp,
  prisma,
  signInAs,
  signInOwner,
  unitIds,
} from './helpers';
import type { Signed } from './helpers';
import { makeDepartment, restoreGlobal, snapshotGlobal } from './phase2-helpers';
import type { GlobalSnapshot } from './phase2-helpers';

const app = newApp();
let owner: Signed;
let admin: Signed;
let snap: GlobalSnapshot;

interface DeptBody {
  id: string;
  code: string;
  name: string;
  head: string | null;
  status: string;
  userCount: number;
  version: number;
}

beforeAll(async () => {
  owner = await signInOwner(app);
  admin = await signInAs(app, 'ADMIN');
  snap = await snapshotGlobal();
});

afterEach(async () => {
  await restoreGlobal(snap);
});

const uniqueCode = () =>
  `Q${Math.random().toString(36).slice(2, 9).toUpperCase()}`.replace(/[^A-Z0-9]/g, 'X');

async function administration() {
  return prisma.department.findUniqueOrThrow({ where: { name: 'Administration' } });
}

describe('GET /departments', () => {
  it('lists the seeded departments in prototype order with user counts', async () => {
    const res = await request(app).get(`${API}/departments`).set(admin.bearer);
    expect(res.status).toBe(200);
    const rows = (res.body as { data: DeptBody[] }).data;
    expect(rows.slice(0, 11).map((d) => d.code)).toEqual([
      'ADMI',
      'SALE',
      'PURC',
      'FINA',
      'HR',
      'PROD',
      'QUAL',
      'MAIN',
      'WARE',
      'PROJ',
      'SERV',
    ]);
    const sales = rows.find((d) => d.name === 'Sales');
    expect(sales?.head).toBe('Sales Head');
    expect(sales?.userCount).toBe(await prisma.user.count({ where: { department: 'Sales' } }));
  });

  it('needs view on admin-departments: managers and below get 403', async () => {
    for (const role of ['MANAGER', 'LEAD', 'MEMBER'] as const) {
      const s = await signInAs(app, role);
      expect((await request(app).get(`${API}/departments`).set(s.bearer)).status).toBe(403);
    }
    expect((await request(app).get(`${API}/departments`)).status).toBe(401);
  });
});

describe('POST /departments', () => {
  it('creates (code upper-cased), audits, and appears in /meta/departments', async () => {
    const code = uniqueCode();
    const res = await request(app)
      .post(`${API}/departments`)
      .set(admin.bearer)
      .send({ code: code.toLowerCase(), name: `Research ${code}`, head: 'Dr. Who' });
    expect(res.status).toBe(201);
    const dept = (res.body as { data: DeptBody }).data;
    expect(dept).toMatchObject({ code, status: 'ACTIVE', userCount: 0, version: 1 });
    expect(await auditRows('DEPARTMENT_CREATED', { targetId: dept.id })).toHaveLength(1);
    const meta = await request(app).get(`${API}/meta/departments`).set(admin.bearer);
    expect((meta.body as { data: string[] }).data).toContain(`Research ${code}`);
  });

  it('409 DUPLICATE for an existing code or (case-insensitive) name', async () => {
    const dupCode = await request(app)
      .post(`${API}/departments`)
      .set(admin.bearer)
      .send({ code: 'SALE', name: `Other ${uniqueCode()}` });
    expect(dupCode.status).toBe(409);
    expect(errorOf(dupCode)).toMatchObject({ code: 'DUPLICATE' });
    expect(errorOf(dupCode).fields?.code).toBeDefined();
    const dupName = await request(app)
      .post(`${API}/departments`)
      .set(admin.bearer)
      .send({ code: uniqueCode(), name: 'sales' });
    expect(dupName.status).toBe(409);
    expect(errorOf(dupName).fields?.name).toBeDefined();
  });

  it('422 for bad codes, names, unknown keys; 403 below ADMIN', async () => {
    for (const body of [
      { code: 'A', name: 'Valid Name' },
      { code: 'TOOLONGCODE1', name: 'Valid Name' },
      { code: 'AB-1', name: 'Valid Name' },
      { code: uniqueCode(), name: 'X' },
      { code: uniqueCode(), name: 'Valid Name', status: 'ACTIVE' },
      { name: 'No Code' },
    ]) {
      const res = await request(app).post(`${API}/departments`).set(admin.bearer).send(body);
      expect(res.status, JSON.stringify(body)).toBe(422);
    }
    const manager = await signInAs(app, 'MANAGER');
    const res = await request(app)
      .post(`${API}/departments`)
      .set(manager.bearer)
      .send({ code: uniqueCode(), name: `Nope ${uniqueCode()}` });
    expect(res.status).toBe(403);
  });
});

describe('PATCH /departments/:id', () => {
  const patch = (s: Signed, id: string, body: object, version?: string) => {
    const req = request(app).patch(`${API}/departments/${id}`).set(s.bearer);
    return (version === undefined ? req : req.set('If-Match', version)).send(body);
  };

  it('needs If-Match (400) and the current version (409)', async () => {
    const dept = await makeDepartment();
    expect((await patch(admin, dept.id, { head: 'New Head' })).status).toBe(400);
    const stale = await patch(admin, dept.id, { head: 'New Head' }, String(dept.version + 1));
    expect(stale.status).toBe(409);
    expect(errorOf(stale).code).toBe('VERSION_CONFLICT');
  });

  it('rename cascades to users, department families and module owners (FK ON UPDATE CASCADE)', async () => {
    const dept = await makeDepartment(['CRM', 'Sales']);
    const user = await makeUser({ department: dept.name });
    await prisma.moduleControl.update({
      where: { pageId: 'crm-leads' },
      data: { ownerDepartment: dept.name },
    });
    const newName = `Renamed ${uniqueCode()}`;
    const res = await patch(admin, dept.id, { name: newName, head: null }, String(dept.version));
    expect(res.status).toBe(200);
    expect((res.body as { data: DeptBody }).data).toMatchObject({
      name: newName,
      head: null,
      version: dept.version + 1,
      userCount: 1,
    });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).department).toBe(
      newName,
    );
    const families = await prisma.departmentFamily.findMany({ where: { departmentName: newName } });
    expect(families.map((f) => f.family).sort()).toEqual(['CRM', 'Sales']);
    expect(
      (await prisma.moduleControl.findUniqueOrThrow({ where: { pageId: 'crm-leads' } }))
        .ownerDepartment,
    ).toBe(newName);
    const rows = await auditRows('DEPARTMENT_UPDATED', { targetId: dept.id });
    expect(rows[0]?.detail).toMatchObject({
      before: { name: dept.name, head: 'Test Head' },
      after: { name: newName, head: null },
    });
  });

  it('Administration cannot be renamed or deactivated (409 PROTECTED), but its head can change', async () => {
    const adm = await administration();
    const rename = await patch(owner, adm.id, { name: 'Admin Office' }, String(adm.version));
    expect(rename.status).toBe(409);
    expect(errorOf(rename).code).toBe('PROTECTED');
    const deactivate = await patch(owner, adm.id, { status: 'INACTIVE' }, String(adm.version));
    expect(deactivate.status).toBe(409);
    expect(errorOf(deactivate).code).toBe('PROTECTED');
    const head = await patch(owner, adm.id, { head: 'Chief Admin' }, String(adm.version));
    expect(head.status).toBe(200);
    await patch(owner, adm.id, { head: 'Administration Head' }, String(adm.version + 1));
  });

  it('a deactivated department leaves /meta/departments and cannot be assigned to users', async () => {
    const dept = await makeDepartment();
    const res = await patch(admin, dept.id, { status: 'INACTIVE' }, String(dept.version));
    expect(res.status).toBe(200);
    const meta = await request(app).get(`${API}/meta/departments`).set(admin.bearer);
    expect((meta.body as { data: string[] }).data).not.toContain(dept.name);
    const create = await request(app)
      .post(`${API}/users`)
      .set(admin.bearer)
      .send({
        loginId: `inactive-${uniqueCode().toLowerCase()}`,
        name: 'Nobody Here',
        role: 'MEMBER',
        department: dept.name,
        temporaryPassword: 'Temp-Passw0rd!',
        unitIds: await unitIds(),
      });
    expect(create.status).toBe(422);
    expect(errorOf(create).fields?.department).toBeDefined();
  });

  it('409 DUPLICATE when renaming onto another department; 404/422 for bad ids; 422 for empty body', async () => {
    const dept = await makeDepartment();
    const dup = await patch(admin, dept.id, { name: 'Finance' }, String(dept.version));
    expect(dup.status).toBe(409);
    expect(errorOf(dup).code).toBe('DUPLICATE');
    expect(
      (await patch(admin, '00000000-0000-4000-8000-000000000000', { head: 'X' }, '1')).status,
    ).toBe(404);
    expect((await patch(admin, 'not-a-uuid', { head: 'X' }, '1')).status).toBe(422);
    expect((await patch(admin, dept.id, {}, String(dept.version))).status).toBe(422);
  });
});

describe('DELETE /departments/:id', () => {
  it('409 IN_USE while users belong to it, with the contract message', async () => {
    const dept = await makeDepartment();
    await makeUser({ department: dept.name });
    const res = await request(app).delete(`${API}/departments/${dept.id}`).set(admin.bearer);
    expect(res.status).toBe(409);
    expect(errorOf(res)).toMatchObject({
      code: 'IN_USE',
      message: 'This department has 1 user. Move them first or deactivate the department.',
    });
  });

  it('409 IN_USE while it owns modules', async () => {
    const dept = await makeDepartment();
    await prisma.moduleControl.update({
      where: { pageId: 'crm-sources' },
      data: { ownerDepartment: dept.name },
    });
    const res = await request(app).delete(`${API}/departments/${dept.id}`).set(admin.bearer);
    expect(res.status).toBe(409);
    expect(errorOf(res).code).toBe('IN_USE');
  });

  it('deletes an unused department and its family rows, audited', async () => {
    const dept = await makeDepartment(['CRM']);
    const res = await request(app).delete(`${API}/departments/${dept.id}`).set(admin.bearer);
    expect(res.status).toBe(204);
    expect(await prisma.department.findUnique({ where: { id: dept.id } })).toBeNull();
    expect(await prisma.departmentFamily.count({ where: { departmentName: dept.name } })).toBe(0);
    expect(await auditRows('DEPARTMENT_DELETED', { targetId: dept.id })).toHaveLength(1);
  });

  it('Administration cannot be deleted; a stale optional If-Match is refused; MANAGER 403', async () => {
    const adm = await administration();
    const res = await request(app).delete(`${API}/departments/${adm.id}`).set(owner.bearer);
    expect(res.status).toBe(409);
    expect(errorOf(res).code).toBe('PROTECTED');
    const dept = await makeDepartment();
    const stale = await request(app)
      .delete(`${API}/departments/${dept.id}`)
      .set(admin.bearer)
      .set('If-Match', String(dept.version + 3));
    expect(stale.status).toBe(409);
    const manager = await signInAs(app, 'MANAGER');
    expect(
      (await request(app).delete(`${API}/departments/${dept.id}`).set(manager.bearer)).status,
    ).toBe(403);
  });

  it('the DB itself restricts deleting a referenced department (FK ON DELETE RESTRICT)', async () => {
    const dept = await makeDepartment();
    await makeUser({ department: dept.name });
    await expect(prisma.department.delete({ where: { id: dept.id } })).rejects.toThrow();
    await expect(makeUser({ department: 'No Such Department' })).rejects.toThrow();
  });
});
