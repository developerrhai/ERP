/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument */
// Phase 37 C4: /hr/attendance/days exists, and a login without an employee gets 200 + a plain message.
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { API, newApp, signInOwner, makeUser, signIn } from './helpers';

describe('Phase 37 C4 - attendance days and ESS without an employee', () => {
  const app = newApp();

  it('GET /hr/attendance/days returns a list for the month', async () => {
    const { bearer } = await signInOwner(app);
    const res = await request(app).get(`${API}/hr/attendance/days?month=2027-02`).set(bearer);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    const bad = await request(app).get(`${API}/hr/attendance/days?month=02-2027`).set(bearer);
    expect(bad.status).toBe(422);
  });

  it('GET /hr/ess/me for a login with no employee record is 200 with a message', async () => {
    const user = await makeUser({ role: 'EMPLOYEE' });
    const s = await signIn(app, user);
    const res = await request(app).get(`${API}/hr/ess/me`).set(s.bearer);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toBeNull();
    expect(res.body.message).toBe('Your login is not linked to an employee record. Ask HR.');
  });
});
