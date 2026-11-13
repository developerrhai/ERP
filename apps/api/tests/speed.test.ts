// Phase 22-D: responses are gzip-compressed when the client accepts it, GETs carry a weak ETag and
// answer 304 to If-None-Match, and the SSE stream is never compressed.
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { API, XRW, newApp, signInOwner } from './helpers';

describe('speed middleware', () => {
  const app = newApp();

  it('compresses a large JSON list when the client accepts gzip', async () => {
    const { token } = await signInOwner(app);
    const res = await request(app)
      .get(`${API}/meta/registry`)
      .set('Authorization', `Bearer ${token}`)
      .set('Accept-Encoding', 'gzip')
      .set(XRW);
    expect(res.status).toBe(200);
    expect(res.headers['content-encoding']).toBe('gzip');
    expect((res.body as { data: { pages: unknown[] } }).data.pages.length).toBeGreaterThan(300);
  });

  it('sends a weak ETag on GET and 304 when it still matches', async () => {
    const { token } = await signInOwner(app);
    const first = await request(app)
      .get(`${API}/meta/registry`)
      .set('Authorization', `Bearer ${token}`)
      .set(XRW);
    const etag = first.headers.etag as string;
    expect(etag).toMatch(/^W\//);
    const again = await request(app)
      .get(`${API}/meta/registry`)
      .set('Authorization', `Bearer ${token}`)
      .set('If-None-Match', etag)
      .set(XRW);
    expect(again.status).toBe(304);
  });
});
