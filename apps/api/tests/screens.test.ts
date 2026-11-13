/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/require-await */
// Phase 22: GET /screens/:pageId - keyset walk returns every row exactly once, a tampered cursor is
// refused, limit > 100 is refused, an out-of-scope or unknown record is 404, and every row has `_a`.
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API, XRW, makeUser, newApp, prisma, signIn, signInOwner } from './helpers';
import { SCREENS, SCREEN_PAGE_IDS } from '../src/modules/screens/configs';

const PAGE = 'hr-training';
const TAG = `P22${Date.now().toString(36).toUpperCase()}`;

describe('screens API (hr-training)', () => {
  const app = newApp();
  let token = '';
  const ids: string[] = [];

  beforeAll(async () => {
    token = (await signInOwner(app)).token;
    // 60 programs; many share one created_at (the property test: duplicate sort values).
    for (let i = 0; i < 60; i += 1) {
      const id = randomUUID();
      ids.push(id);
      const at = `2026-11-0${1 + (i % 3)}T10:00:00Z`;
      await prisma.$executeRaw`
        INSERT INTO training_programs (id, code, name, trainer, duration_hours, active, created_at)
        VALUES (${id}::uuid, ${`${TAG}-${String(i).padStart(2, '0')}`}, ${`${TAG} program ${i}`}, 'In-house', 4, ${i % 5 !== 0}, ${at}::timestamptz)`;
    }
  });
  afterAll(async () => {
    await prisma.$executeRaw`DELETE FROM training_programs WHERE code LIKE ${`${TAG}-%`}`;
  });

  const get = (qs: string) =>
    request(app)
      .get(`${API}/screens/${PAGE}?${qs}`)
      .set('Authorization', `Bearer ${token}`)
      .set(XRW);

  it('walks all pages: each of the 60 rows exactly once, 25 per page', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res = await get(`q=${TAG}&size=25${cursor ? `&cursor=${cursor}` : ''}`);
      expect(res.status).toBe(200);
      pages += 1;
      for (const r of res.body.data as { id: string; _a: number; code: string }[]) {
        seen.push(r.id);
        expect(typeof r._a).toBe('number');
        expect(r._a & 1).toBe(1); // 'open' is allowed for the owner
      }
      expect(res.body.meta.total).toBe(60);
      expect(res.body.meta.totalIsEstimate).toBe(false);
      cursor = res.body.meta.nextCursor as string | null;
    } while (cursor);
    expect(pages).toBe(3);
    expect(new Set(seen).size).toBe(60);
    expect(new Set(seen)).toEqual(new Set(ids));
  });

  it('refuses a tampered cursor and a cursor made for another sort', async () => {
    const first = await get(`q=${TAG}&size=5`);
    const cursor = first.body.meta.nextCursor as string;
    expect((await get(`q=${TAG}&size=5&cursor=${cursor.slice(0, -4)}xxxx`)).status).toBe(400);
    const other = await get(`q=${TAG}&size=5&sort=name&cursor=${cursor}`);
    expect(other.status).toBe(400);
    expect(other.body.error.code).toBe('CURSOR_INVALID');
  });

  it('refuses more than 100 rows and unknown sorts', async () => {
    const big = await request(app)
      .get(`${API}/screens/${PAGE}?limit=1000`)
      .set('Authorization', `Bearer ${token}`)
      .set(XRW);
    expect(big.status).toBe(400);
    expect(big.body.error.code).toBe('PAGE_LIMIT_TOO_LARGE');
    expect((await get('sort=password')).status).toBe(400);
  });

  it('returns one record with its actions, and 404 for a missing one', async () => {
    const one = await request(app)
      .get(`${API}/screens/${PAGE}/${ids[0]}`)
      .set('Authorization', `Bearer ${token}`)
      .set(XRW);
    expect(one.status).toBe(200);
    expect(one.body.data.actions.allowed).toContain('open');
    const miss = await request(app)
      .get(`${API}/screens/${PAGE}/${randomUUID()}`)
      .set('Authorization', `Bearer ${token}`)
      .set(XRW);
    expect(miss.status).toBe(404);
    const acts = await request(app)
      .get(`${API}/screens/${PAGE}/${ids[0]}/actions`)
      .set('Authorization', `Bearer ${token}`)
      .set(XRW);
    expect(acts.body.data.blocked.word).toBe('Arrives in Phase 27.');
  });

  it('401 without a token, 404 for a page that is not a screen', async () => {
    expect((await request(app).get(`${API}/screens/${PAGE}`)).status).toBe(401);
    const res = await request(app)
      .get(`${API}/screens/inv-items`)
      .set('Authorization', `Bearer ${token}`)
      .set(XRW);
    expect(res.status).toBe(404);
  });

  it('a user with no rights on the page gets 403', async () => {
    const user = await makeUser({});
    const { token: t } = await signIn(app, user);
    const res = await request(app)
      .get(`${API}/screens/${PAGE}`)
      .set('Authorization', `Bearer ${t}`)
      .set(XRW);
    expect([403, 404]).toContain(res.status);
  });
});

describe('every screen config runs against the real schema', () => {
  const app = newApp();
  let token = '';
  beforeAll(async () => {
    token = (await signInOwner(app)).token;
  });
  it.each(SCREEN_PAGE_IDS)('%s lists without a SQL error and each sort works', async (pageId) => {
    const cfg = SCREENS[pageId]!;
    for (const sort of Object.keys(cfg.sorts)) {
      for (const dir of ['', '-']) {
        const res = await request(app)
          .get(`${API}/screens/${pageId}?size=2&sort=${dir}${sort}`)
          .set('Authorization', `Bearer ${token}`)
          .set(XRW);
        expect(
          res.status,
          `${pageId} ${dir}${sort}: ${JSON.stringify(res.body).slice(0, 200)}`,
        ).toBe(200);
        // when there is a second page its cursor must work too
        const next = res.body.meta.nextCursor as string | null;
        if (next) {
          const r2 = await request(app)
            .get(`${API}/screens/${pageId}?size=2&sort=${dir}${sort}&cursor=${next}`)
            .set('Authorization', `Bearer ${token}`)
            .set(XRW);
          expect(r2.status, `${pageId} next`).toBe(200);
        }
      }
    }
  });
});
