/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any -- API test bodies are loose JSON */
// Service: warranty check (item column), technician create/update/deactivate, warranty-term create.
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newApp, prisma, signInOwner } from './helpers';
import type { Signed } from './helpers';
import { mkItem, ownerId, tag } from './phase08-helpers';
import { body, setup } from './phase09-helpers';

const app = newApp();
let owner: Signed;
let ctx: Awaited<ReturnType<typeof setup>>;

beforeAll(async () => {
  owner = await signInOwner(app);
  ctx = await setup(app, owner);
});
afterAll(async () => {
  await prisma.$disconnect();
});

const call = (method: 'get' | 'post' | 'patch' | 'delete', path: string, b?: unknown) => {
  const r = request(app)[method](`/api/v1${path}`).set(owner.bearer).set('X-Unit-Id', ctx.fx.unitId);
  return b === undefined ? r : r.send(b as object);
};

async function mkEmployee(inThisPlant: boolean): Promise<string> {
  const t = tag();
  const rows: any[] = await prisma.$queryRawUnsafe(
    `INSERT INTO employees (emp_code, first_name, last_name, gender, dob, mobile, joining_date, status)
     VALUES ($1, 'TECH', $1, 'M', '1990-01-01', $2, '2020-01-01', 'ACTIVE') RETURNING id::text AS id`,
    `TC${t}`.slice(0, 28),
    `8${String(Date.now()).slice(-9)}`,
  );
  const id = rows[0].id as string;
  if (inThisPlant)
    await prisma.$executeRawUnsafe(
      `INSERT INTO employee_assignments (employee_id, effective_from, unit_id, department) VALUES ($1::uuid, '2020-01-01', $2::uuid, 'Service')`,
      id,
      ctx.fx.unitId,
    );
  return id;
}

describe('warranty check and claims (items use column code, not item_code)', () => {
  it('checks a serial without a 500 and creates a claim', async () => {
    const item = await mkItem();
    const serial = `SN-${tag()}`;
    const sn: any[] = await prisma.$queryRawUnsafe(
      `INSERT INTO serial_numbers (item_id, serial_no, created_by_id) VALUES ($1::uuid, $2, $3::uuid) RETURNING id::text AS id`,
      item.id,
      serial,
      await ownerId(),
    );
    const r = await call('get', `/service/warranties/check?serial=${serial}`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(body(r).itemCode).toBe(item.code);
    expect(body(r).result).toBe('OUT_OF_WARRANTY');
    const cust = await prisma.customer.findFirst();
    if (cust) {
      const c = await call('post', '/service/warranty-claims', {
        customerId: cust.id,
        serialNumberId: sn[0].id,
        failureDate: new Date().toISOString().slice(0, 10),
        problemDescription: 'Does not start',
      });
      expect(c.status, JSON.stringify(c.body)).toBe(201);
    }
  });

  it('creates a warranty term, rejects a duplicate code and a bad month count', async () => {
    const code = `WT${tag()}`.slice(0, 40);
    const ok = await call('post', '/service/warranty-terms', { code, name: 'Standard 12 months', months: 12 });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(body(ok).months).toBe(12);
    expect((await call('post', '/service/warranty-terms', { code, name: 'Again', months: 6 })).status).toBe(409);
    expect((await call('post', '/service/warranty-terms', { code: `${code}X`, name: 'Bad', months: 0 })).status).toBe(422);
    const list = await call('get', '/service/warranty-terms');
    expect(body(list).some((t: any) => t.code === code)).toBe(true);
  });
});

describe('technicians: create, update, deactivate', () => {
  it('creates a technician from an employee of this plant, with skills, and audits it', async () => {
    const emp = await mkEmployee(true);
    const opts = await call('get', '/service/technicians/employee-options');
    expect(opts.status, JSON.stringify(opts.body)).toBe(200);
    expect(body(opts).some((o: any) => o.id === emp)).toBe(true);

    const c = await call('post', '/service/technicians', {
      employeeId: emp,
      maxOpenJobs: 3,
      skills: [{ skillCode: 'PUMP_MECH', level: 4 }],
    });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    const t = body(c);
    expect(t.employeeId).toBe(emp);
    expect(t.maxOpenJobs).toBe(3);
    expect(t.skills).toEqual([{ skillCode: 'PUMP_MECH', level: 4 }]);
    const audits: any[] = await prisma.$queryRawUnsafe(
      `SELECT 1 FROM audit_logs WHERE target_id = $1 AND action = 'TECHNICIAN_CREATED'`,
      t.id,
    );
    expect(audits.length).toBe(1);

    // listed on the board and no longer offered in the picker
    expect(body(await call('get', '/service/technicians')).some((x: any) => x.id === t.id)).toBe(true);
    expect(body(await call('get', '/service/technicians/employee-options')).some((o: any) => o.id === emp)).toBe(false);
    // a second technician for the same employee is a 409
    expect((await call('post', '/service/technicians', { employeeId: emp })).status).toBe(409);

    const u = await call('patch', `/service/technicians/${t.id}`, { maxOpenJobs: 8, skills: [] });
    expect(u.status, JSON.stringify(u.body)).toBe(200);
    expect(body(u).maxOpenJobs).toBe(8);
    expect(body(u).skills).toEqual([]);

    const d = await call('delete', `/service/technicians/${t.id}`);
    expect(d.status, JSON.stringify(d.body)).toBe(200);
    expect(body(d).active).toBe(false);
    expect(body(await call('get', '/service/technicians')).some((x: any) => x.id === t.id)).toBe(false);
  });

  it('rejects an employee of another plant, bad input and a missing technician', async () => {
    const other = await mkEmployee(false);
    const r = await call('post', '/service/technicians', { employeeId: other });
    expect(r.status, JSON.stringify(r.body)).toBe(422);
    expect(JSON.stringify(r.body)).toContain('plant');
    expect((await call('post', '/service/technicians', {})).status).toBe(422);
    expect((await call('post', '/service/technicians', { employeeId: 'nope' })).status).toBe(422);
    expect((await call('patch', '/service/technicians/00000000-0000-4000-8000-000000000001', { maxOpenJobs: 2 })).status).toBe(404);
  });
});
