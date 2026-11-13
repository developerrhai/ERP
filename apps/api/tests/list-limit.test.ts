// Phase 22-A: every GET list refuses more than 100 rows per page, before any other work.
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { API, errorOf, newApp } from './helpers';

const LISTS = [
  '/users',
  '/inventory/vouchers',
  '/finance/journals',
  '/approvals/inbox',
];

describe('GET list limit guard', () => {
  it.each(LISTS)('%s?limit=1000 -> 400 PAGE_LIMIT_TOO_LARGE', async (path) => {
    const res = await request(newApp()).get(`${API}${path}?limit=1000`);
    expect(res.status).toBe(400);
    expect(errorOf(res).code).toBe('PAGE_LIMIT_TOO_LARGE');
    expect(errorOf(res).message).toBe('Maximum 100 rows per page.');
  });

  it('limit=100 and limit=25 pass the guard (they reach auth); size keeps its own 422 contract', async () => {
    const app = newApp();
    expect((await request(app).get(`${API}/users?limit=100`)).status).toBe(401);
    expect((await request(app).get(`${API}/users?limit=25`)).status).toBe(401);
    expect((await request(app).get(`${API}/users?limit=0`)).status).toBe(400);
  });
});
