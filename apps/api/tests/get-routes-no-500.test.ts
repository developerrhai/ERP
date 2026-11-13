// Phase 22: an API crawler. Every parameter-free GET route, called as the owner, must never answer 500
// (a 500 is a bug: a missing column, a bad query). 4xx answers (validation, not found, disabled) are fine.
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { newApp, signInOwner, XRW } from './helpers';

interface Layer {
  route?: { path: string; methods: Record<string, boolean> };
  name: string;
  regexp: RegExp;
  handle: { stack?: Layer[] };
  keys: { name: string }[];
}

function prefixOf(layer: Layer): string | null {
  if (layer.keys.length > 0) return null; // a mount with a parameter: skip
  const src = layer.regexp.source;
  if (src === '^\\/?(?=\\/|$)') return '';
  const m = /^\^((?:\\\/[^\\/()?^$|*+[\]]+)+)\\\/\?\(\?=\\\/\|\$\)$/.exec(src);
  if (!m?.[1]) return null;
  return m[1].replace(/\\\//g, '/');
}

function collect(stack: Layer[], base: string, out: Set<string>): void {
  for (const layer of stack) {
    if (layer.route) {
      if (layer.route.methods.get && !layer.route.path.includes(':') && !layer.route.path.includes('*')) {
        out.add(base + (layer.route.path === '/' ? '' : layer.route.path));
      }
    } else if (layer.name === 'router' && layer.handle.stack) {
      const p = prefixOf(layer);
      if (p !== null) collect(layer.handle.stack, base + p, out);
    }
  }
}

describe('GET routes never answer 500', () => {
  const app = newApp();
  let token = '';
  const paths = new Set<string>();

  beforeAll(async () => {
    token = (await signInOwner(app)).token;
    const root = (app as unknown as { _router: { stack: Layer[] } })._router.stack;
    collect(root, '', paths);
  });

  it('finds a meaningful number of routes', () => {
    expect(paths.size).toBeGreaterThan(100);
  });

  it('none of them is a 500', async () => {
    const skip = /\/(health|realtime|logout|export|download|stream|print|pdf|qr|label)/i;
    const bad: string[] = [];
    for (const p of [...paths].sort()) {
      if (skip.test(p) || !p.startsWith('/api/v1')) continue;
      const res = await request(app).get(p).set('Authorization', `Bearer ${token}`).set(XRW);
      if (res.status >= 500) bad.push(`${res.status} ${p}`);
    }
    expect(bad).toEqual([]);
  }, 300_000);
});
