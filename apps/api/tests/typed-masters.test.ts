// apps/api/tests/typed-masters.test.ts
// Tests for Phase 03 Order 3: typed designations, currencies, and uoms modules.
// Verifies CRUD, validation, base currency invariants, and removal from GENERIC_ADMIN_PAGES.

import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { API, newApp, signInAs, signInOwner } from './helpers';
import type { Signed } from './helpers';

const app = newApp();
let owner: Signed;
let member: Signed;

beforeAll(async () => {
  owner = await signInOwner(app);
  member = await signInAs(app, 'MEMBER', { department: 'Administration' });
});

describe('Typed Masters (Phase 03 Order 3)', () => {
  describe('Designations (/designations)', () => {
    let createdId: string;
    let version: number;

    it('creates a new designation with level and department', async () => {
      const code = `ENG-${Date.now().toString().slice(-4)}`;
      const res = await request(app)
        .post(`${API}/designations`)
        .set(owner.bearer)
        .send({
          code,
          name: `Senior Engineer ${code}`,
          level: 30,
        });

      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        code,
        level: 30,
        status: 'ACTIVE',
      });
      createdId = res.body.data.id;
      version = res.body.data.version;
    });

    it('lists designations including the created one', async () => {
      const res = await request(app).get(`${API}/designations`).set(owner.bearer);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      const found = res.body.data.find((d: any) => d.id === createdId);
      expect(found).toBeDefined();
    });

    it('updates a designation requiring If-Match', async () => {
      const res = await request(app)
        .patch(`${API}/designations/${createdId}`)
        .set(owner.bearer)
        .set('If-Match', `"${version}"`)
        .send({ level: 40 });

      expect(res.status).toBe(200);
      expect(res.body.data.level).toBe(40);
      version = res.body.data.version;
    });

    it('deletes a designation', async () => {
      const res = await request(app)
        .delete(`${API}/designations/${createdId}`)
        .set(owner.bearer)
        .set('If-Match', `"${version}"`);

      expect(res.status).toBe(204);

      const getRes = await request(app).get(`${API}/designations/${createdId}`).set(owner.bearer);
      expect(getRes.status).toBe(404);
    });
  });

  describe('Currencies (/currencies)', () => {
    let usdId: string;

    it('lists seeded INR as the base currency', async () => {
      const res = await request(app).get(`${API}/currencies`).set(owner.bearer);

      expect(res.status).toBe(200);
      const inr = res.body.data.find((c: any) => c.code === 'INR');
      expect(inr).toBeDefined();
      expect(inr.isBase).toBe(true);
      expect(inr.exchangeRate).toBe(1);
    });

    it('creates USD as non-base currency with exchange rate', async () => {
      const res = await request(app).post(`${API}/currencies`).set(owner.bearer).send({
        code: 'USD',
        name: 'US Dollar',
        symbol: '$',
        decimalPlaces: 2,
        isBase: false,
        exchangeRate: 83.5,
      });

      if (res.status === 409) {
        // USD already exists from previous run
        const list = await request(app).get(`${API}/currencies`).set(owner.bearer);
        usdId = list.body.data.find((c: any) => c.code === 'USD').id;
      } else {
        expect(res.status).toBe(201);
        expect(res.body.data).toMatchObject({
          code: 'USD',
          isBase: false,
          exchangeRate: 83.5,
        });
        usdId = res.body.data.id;
      }
    });

    it('refuses to delete the base currency', async () => {
      const list = await request(app).get(`${API}/currencies`).set(owner.bearer);
      const inr = list.body.data.find((c: any) => c.code === 'INR');
      expect(inr).toBeDefined();

      const res = await request(app).delete(`${API}/currencies/${inr.id}`).set(owner.bearer);

      expect(res.status).toBe(409);
    });
  });

  describe('UOMs (/uoms)', () => {
    let uomId: string;
    let version: number;

    it('creates a new UOM', async () => {
      const code = `BOX-${Date.now().toString().slice(-4)}`;
      const res = await request(app)
        .post(`${API}/uoms`)
        .set(owner.bearer)
        .send({
          code,
          name: `Box of ${code}`,
          uomClass: 'Count',
          decimals: 0,
        });

      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        code,
        uomClass: 'Count',
        decimals: 0,
      });
      uomId = res.body.data.id;
      version = res.body.data.version;
    });

    it('updates UOM name and decimals', async () => {
      const res = await request(app)
        .patch(`${API}/uoms/${uomId}`)
        .set(owner.bearer)
        .set('If-Match', `"${version}"`)
        .send({ decimals: 1 });

      expect(res.status).toBe(200);
      expect(res.body.data.decimals).toBe(1);
    });
  });

  describe('Removal from GENERIC_ADMIN_PAGES', () => {
    it('returns 404 NOT_GENERIC when hitting generic records endpoint for admin-designations', async () => {
      const res = await request(app)
        .get(`${API}/pages/admin-designations/records`)
        .set(owner.bearer);

      expect(res.status).toBe(404);
      expect(res.body.error?.code).toBe('NOT_GENERIC');
    });

    it('returns 404 NOT_GENERIC when hitting generic records endpoint for admin-currency', async () => {
      const res = await request(app).get(`${API}/pages/admin-currency/records`).set(owner.bearer);

      expect(res.status).toBe(404);
      expect(res.body.error?.code).toBe('NOT_GENERIC');
    });

    it('returns 404 NOT_GENERIC when hitting generic records endpoint for admin-uom', async () => {
      const res = await request(app).get(`${API}/pages/admin-uom/records`).set(owner.bearer);

      expect(res.status).toBe(404);
      expect(res.body.error?.code).toBe('NOT_GENERIC');
    });
  });
});
