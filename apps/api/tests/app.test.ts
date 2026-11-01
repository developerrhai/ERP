// Cross-cutting HTTP behaviour: health, security headers, CORS, body limits, the error shape for
// 400/404/413/500, and request ids (CONTRACT §6 Headers and CORS, §7 Response shapes).
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { API, errorOf, newApp } from './helpers';

describe('GET /health', () => {
  it('reports ok when the database answers', async () => {
    const res = await request(newApp()).get(`${API}/health`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { status: 'ok', db: 'ok' } });
  });

  it('reports 503 when the database is down', async () => {
    const app = newApp({ dbPing: () => Promise.reject(new Error('connection refused')) });
    const res = await request(app).get(`${API}/health`);
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ data: { status: 'degraded', db: 'down' } });
  });
});

describe('security headers and CORS', () => {
  it('sets helmet headers and hides x-powered-by', async () => {
    const res = await request(newApp()).get(`${API}/health`);
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
  });

  it('allows the web origin with credentials', async () => {
    const res = await request(newApp())
      .options(`${API}/auth/login`)
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'POST');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('never reflects another origin', async () => {
    const res = await request(newApp()).get(`${API}/health`).set('Origin', 'https://evil.example');
    expect(res.headers['access-control-allow-origin']).not.toBe('https://evil.example');
  });
});

describe('error shape', () => {
  it('returns JSON 404 for unknown routes', async () => {
    const res = await request(newApp()).get(`${API}/does-not-exist`);
    expect(res.status).toBe(404);
    const err = errorOf(res);
    expect(err.code).toBe('NOT_FOUND');
    expect(err.status).toBe(404);
    expect(err.requestId).toBe(res.headers['x-request-id']);
  });

  it('returns 400 for malformed JSON', async () => {
    const res = await request(newApp())
      .post(`${API}/auth/login`)
      .set('Content-Type', 'application/json')
      .send('{"identifier": ');
    expect(res.status).toBe(400);
    expect(errorOf(res).code).toBe('BAD_REQUEST');
  });

  it('rejects JSON bodies over 100 kb', async () => {
    const res = await request(newApp())
      .post(`${API}/auth/login`)
      .send({ identifier: 'x', password: 'y'.repeat(110 * 1024) });
    expect(res.status).toBe(413);
    expect(errorOf(res).code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('hides the stack on 500', async () => {
    const app = newApp({
      extraRoutes: (a) =>
        a.get('/boom', () => {
          throw new Error('secret internal detail');
        }),
    });
    const res = await request(app).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: {
        code: 'INTERNAL',
        message: 'Something went wrong.',
        status: 500,
        requestId: res.headers['x-request-id'] as string,
      },
    });
    expect(JSON.stringify(res.body)).not.toContain('secret internal detail');
  });

  it('echoes a safe incoming X-Request-Id and replaces an unsafe one', async () => {
    const ok = await request(newApp()).get(`${API}/health`).set('X-Request-Id', 'abc-123');
    expect(ok.headers['x-request-id']).toBe('abc-123');
    const bad = await request(newApp()).get(`${API}/health`).set('X-Request-Id', '<script>');
    expect(bad.headers['x-request-id']).not.toBe('<script>');
  });
});
