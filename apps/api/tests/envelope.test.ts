// Phase 22 (crawler finding): Projects and Service answer in the { data } envelope the web app reads.
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { API, XRW, newApp, signInOwner } from './helpers';

describe('data envelope on the Projects and Service routers', () => {
  const app = newApp();
  let token = '';
  beforeAll(async () => {
    token = (await signInOwner(app)).token;
  });
  const get = (path: string) => request(app).get(`${API}${path}`).set('Authorization', `Bearer ${token}`).set(XRW);

  it('GET /projects returns { data: { rows, total } }', async () => {
    const res = await get('/projects');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data?.rows)).toBe(true);
    expect(typeof res.body.data?.total).toBe('number');
  });

  it('an already-enveloped body is not wrapped twice', async () => {
    const res = await get('/service/tickets');
    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.data).toBeUndefined();
  });
});
