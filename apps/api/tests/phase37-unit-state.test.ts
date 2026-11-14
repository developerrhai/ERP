/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
// Phase 37 follow-up: the plant state code must really be saved (create and update) and returned.
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API, XRW, newApp, prisma, signInOwner } from './helpers';
import { unitState } from '../src/modules/procurement/core';

describe('plant state code is persisted', () => {
  const app = newApp();
  let token = '';
  let id = '';
  const code = `ST${Date.now().toString().slice(-6)}`;
  beforeAll(async () => {
    token = (await signInOwner(app)).token;
  });
  afterAll(async () => {
    if (id) await prisma.$executeRaw`DELETE FROM units WHERE id = ${id}::uuid`;
  });
  it('create saves stateCode and city', async () => {
    const res = await request(app).post(`${API}/units`).set('Authorization', `Bearer ${token}`).set(XRW)
      .send({ code, name: `Plant ${code}`, stateCode: '27', city: 'Pune' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    id = res.body.data.id as string;
    expect(res.body.data.stateCode).toBe('27');
    expect(await unitState(prisma, id)).toBe('27');
  });
  it('update changes stateCode', async () => {
    const res = await request(app).patch(`${API}/units/${id}`).set('Authorization', `Bearer ${token}`).set(XRW)
      .set('If-Match', '"1"').send({ stateCode: '24' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.stateCode).toBe('24');
    expect(await unitState(prisma, id)).toBe('24');
  });
});
