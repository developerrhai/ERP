/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument */
// Phase 37 C2: the HSN / SAC form carries the GST rate, so a document line takes it from the item's HSN.
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API, XRW, newApp, prisma, signInOwner, unitIds } from './helpers';
import { resolveGstPct } from '../src/modules/procurement/po-service';
import { lineNoGstRate } from '../src/modules/masters/party-rules';

const CODE = `99${Date.now().toString().slice(-6)}`;

describe('Phase 37 C2 - HSN master carries the GST rate', () => {
  const app = newApp();
  let token = '';
  let tal = '';
  let hsnId = '';

  beforeAll(async () => {
    token = (await signInOwner(app)).token;
    [tal = ''] = await unitIds(['TAL']);
  });
  afterAll(async () => {
    if (hsnId) {
      await prisma.$executeRaw`DELETE FROM hsn_sac_rates WHERE hsn_id = ${hsnId}::uuid`;
      await prisma.$executeRaw`DELETE FROM hsn_sac_codes WHERE id = ${hsnId}::uuid`;
    }
  });

  it('creates an HSN with its dated rate in one save', async () => {
    const rate = await prisma.$queryRaw<{ id: string; igst: string }[]>`
      SELECT id::text AS id, igst_pct::text AS igst FROM gst_rates WHERE igst_pct = 18 AND deleted_at IS NULL LIMIT 1`;
    expect(rate[0], 'an 18 % GST rate must be seeded').toBeDefined();
    const res = await request(app)
      .post(`${API}/screens/tax-hsn`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Unit-Id', tal)
      .set(XRW)
      .send({ values: { code: CODE, description: 'Phase 37 test', gstRate: rate[0]?.id, effectiveFrom: '2026-04-01' } });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    hsnId = res.body.data.id as string;
    expect(await resolveGstPct(prisma, CODE, '2026-11-14')).toBe('18.0000');
  });

  it('refuses a missing GST rate on the form', async () => {
    const res = await request(app)
      .post(`${API}/screens/tax-hsn`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Unit-Id', tal)
      .set(XRW)
      .send({ values: { code: `98${CODE.slice(2)}`, description: 'No rate' } });
    expect(res.status).toBe(422);
  });

  it('uses the standard message when an HSN has no rate', async () => {
    expect(await resolveGstPct(prisma, '99000000', '2026-11-14')).toBeNull();
    expect(lineNoGstRate('7208')).toBe('No GST rate for HSN 7208 — set it in HSN / SAC.');
  });
});
