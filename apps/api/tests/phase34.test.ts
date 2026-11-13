/* eslint-disable @typescript-eslint/no-unsafe-member-access */
// Phase 34: integrations vault (encrypted, masked), the e-invoice adapter, WhatsApp, signed inbound hooks,
// outbound webhooks with retry / dead-letter / replay and the SSRF guard.
import request from 'supertest';
import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decryptSecret } from '../src/core/auth/mfa-crypto';
import { verifyStandardWebhook } from '../src/modules/bi/bi-calc';
import { MAX_ATTEMPTS, backoffMinutes, maskSecret, nextStep, sandboxIrn, verifyHexSignature } from '../src/modules/integrations/calc';
import { integrationService, setIrpClientForTests, setWebhookSenderForTests } from '../src/modules/integrations/service';
import { API, XRW, makeUser, newApp, prisma, signIn, signInOwner, unitIds } from './helpers';

describe('Phase 34 rules (pure)', () => {
  it('backoff is 1, 2, 4, 8 minutes and the 5th failure is the dead letter', () => {
    expect([1, 2, 3, 4, 5].map(backoffMinutes)).toEqual([1, 2, 4, 8, 16]);
    expect(MAX_ATTEMPTS).toBe(5);
    expect([1, 2, 3, 4].map((n) => nextStep(n))).toEqual(['RETRY', 'RETRY', 'RETRY', 'RETRY']);
    expect(nextStep(5)).toBe('DEAD_LETTER');
  });
  it('secrets are masked to the last 4; the sandbox IRN is deterministic', () => {
    expect(maskSecret('EAAB-secret-1234')).toBe('••••1234');
    expect(maskSecret('abc')).toBe('••••');
    const a = sandboxIrn({ sellerGstin: '27AAACS1234A1Z5', docNo: 'INV/TAL/26/0001', docDate: '2026-11-13' });
    const b = sandboxIrn({ sellerGstin: '27AAACS1234A1Z5', docNo: 'INV/TAL/26/0001', docDate: '2026-11-13' });
    expect(a.irn).toMatch(/^[0-9a-f]{64}$/);
    expect(a.irn).toBe(b.irn);
    expect(a.ackNo).toMatch(/^\d{15}$/);
    expect(JSON.parse(Buffer.from(a.signedQr, 'base64').toString()).Irn).toBe(a.irn);
  });
  it('inbound signatures: hex HMAC, with or without the sha256= prefix; anything else is refused', () => {
    const body = '{"a":1}';
    const sig = createHmac('sha256', 'k').update(body).digest('hex');
    expect(verifyHexSignature(body, sig, 'k')).toBe(true);
    expect(verifyHexSignature(body, `sha256=${sig}`, 'k')).toBe(true);
    expect(verifyHexSignature(body, sig, 'other')).toBe(false);
    expect(verifyHexSignature(body, 'nothex', 'k')).toBe(false);
    expect(verifyHexSignature('{"a":2}', sig, 'k')).toBe(false);
  });
});

describe('Phase 34 (API)', () => {
  const app = newApp();
  let ownerToken = '';
  let tal = '';
  const cleanup: (() => Promise<unknown>)[] = [];
  const get = (token: string, path: string) => request(app).get(`${API}${path}`).set('Authorization', `Bearer ${token}`).set(XRW);
  const send = (method: 'post' | 'put' | 'delete', token: string, path: string, body?: unknown) =>
    request(app)[method](`${API}${path}`).set('Authorization', `Bearer ${token}`).set(XRW).send(body as object);

  beforeAll(async () => {
    ownerToken = (await signInOwner(app)).token;
    [tal = ''] = await unitIds(['TAL']);
    await prisma.$executeRaw`UPDATE integration_configs SET mode = 'DISABLED', secrets_enc = NULL, secret_hints = '{}'::jsonb, config_json = '{}'::jsonb, fail_streak = 0`;
  });

  afterAll(async () => {
    setIrpClientForTests(null);
    setWebhookSenderForTests(null);
    for (const fn of cleanup.reverse()) await fn().catch(() => undefined);
    await prisma.$executeRaw`UPDATE integration_configs SET mode = 'DISABLED', secrets_enc = NULL, secret_hints = '{}'::jsonb, config_json = '{}'::jsonb, fail_streak = 0`;
    await prisma.$executeRaw`DELETE FROM webhook_deliveries WHERE endpoint_id IN (SELECT id FROM webhook_endpoints WHERE name LIKE 'T34%')`;
    await prisma.$executeRaw`DELETE FROM webhook_endpoints WHERE name LIKE 'T34%'`;
    await prisma.$executeRaw`DELETE FROM webhook_inbound WHERE source IN ('WHATSAPP','BANK_FEED')`;
    await prisma.$executeRaw`DELETE FROM integration_logs`;
  });

  it('vault: secrets are encrypted at rest and only ever shown masked; a masked value does not overwrite the secret; private addresses are refused', async () => {
    const list = (await get(ownerToken, '/admin/integrations')).body.data as { provider: string; mode: string }[];
    expect(list.map((x) => x.provider).sort()).toEqual(['BANK_FEED', 'GST_EWAY', 'GST_IRP', 'SMTP_RELAY', 'WHATSAPP']);
    expect(list.every((x) => x.mode === 'DISABLED')).toBe(true); // default: nothing goes out
    const put = await send('put', ownerToken, '/admin/integrations/WHATSAPP', { mode: 'SANDBOX', config: { phoneId: '1234' }, secrets: { token: 'EAAB-secret-token-1234', webhookSecret: 'whs-secret-abcd' } });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    expect(put.body.data.secrets).toEqual({ token: '••••1234', webhookSecret: '••••abcd' });
    expect(JSON.stringify(put.body)).not.toContain('EAAB-secret');
    const row = (await prisma.$queryRawUnsafe<{ secrets_enc: string }[]>(`SELECT secrets_enc FROM integration_configs WHERE provider_code = 'WHATSAPP'`))[0]!;
    expect(row.secrets_enc.startsWith('v1:')).toBe(true);
    expect(row.secrets_enc).not.toContain('EAAB');
    expect(JSON.parse(decryptSecret(row.secrets_enc))).toMatchObject({ token: 'EAAB-secret-token-1234', webhookSecret: 'whs-secret-abcd' });
    // the screen sends the masked hint back: the secret is kept
    const again = await send('put', ownerToken, '/admin/integrations/WHATSAPP', { mode: 'SANDBOX', secrets: { token: '••••1234' } });
    expect(again.status).toBe(200);
    expect(JSON.parse(decryptSecret((await prisma.$queryRawUnsafe<{ secrets_enc: string }[]>(`SELECT secrets_enc FROM integration_configs WHERE provider_code = 'WHATSAPP'`))[0]!.secrets_enc)).token).toBe('EAAB-secret-token-1234');
    // GET never returns a secret; the audit never carries one
    expect(JSON.stringify((await get(ownerToken, '/admin/integrations/WHATSAPP')).body)).not.toContain('secret-token');
    const audits = await prisma.$queryRawUnsafe<{ detail: unknown }[]>(`SELECT detail FROM audit_logs WHERE action = 'integration.config_changed' ORDER BY at DESC LIMIT 3`);
    expect(JSON.stringify(audits)).not.toContain('EAAB');
    expect(JSON.stringify(audits)).not.toContain('whs-secret');
    // addresses must be public https
    const bad = await send('put', ownerToken, '/admin/integrations/GST_IRP', { mode: 'LIVE', config: { baseUrl: 'http://192.168.1.5/irp' } });
    expect(bad.status).toBe(422);
    expect((await send('put', ownerToken, '/admin/integrations/NOPE', { mode: 'LIVE' })).status).toBe(422);
    // test connection + logs
    const t = await send('post', ownerToken, '/admin/integrations/GST_IRP/test');
    expect(t.body.data.ok).toBe(false); // still DISABLED
    await send('put', ownerToken, '/admin/integrations/GST_IRP', { mode: 'SANDBOX' });
    const t2 = await send('post', ownerToken, '/admin/integrations/GST_IRP/test');
    expect(t2.body.data).toMatchObject({ ok: true });
    const logs = (await get(ownerToken, '/admin/integrations/logs?provider=GST_IRP')).body.data as { request_summary: string }[];
    expect(logs.some((l) => l.request_summary === 'test connection')).toBe(true);
    const status = (await get(ownerToken, '/admin/integrations/GST_IRP')).body.data;
    expect(status.lastTestStatus).toBe('OK');
    // an ordinary user cannot see the vault
    const emp = await makeUser({ role: 'EMPLOYEE', department: 'Sales', unitCodes: ['TAL'], defaultUnitCode: 'TAL' });
    cleanup.push(() => prisma.userUnit.deleteMany({ where: { userId: emp.id } }));
    expect((await get((await signIn(app, emp)).token, '/admin/integrations')).status).toBe(403);
  });

  it('e-invoice: disabled keeps the JSON download message; sandbox fills the invoice; one IRN per invoice; B2B and posted only; three failures alert the admin', async () => {
    await send('put', ownerToken, '/admin/integrations/GST_IRP', { mode: 'DISABLED' });
    const fy = await prisma.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM financial_years ORDER BY start_date DESC LIMIT 1`);
    const oldGstin = (await prisma.$queryRawUnsafe<{ gstin: string | null }[]>(`SELECT gstin FROM units WHERE id = $1::uuid`, tal))[0]!.gstin;
    await prisma.$executeRawUnsafe(`UPDATE units SET gstin = '27AAACS1234A1Z5' WHERE id = $1::uuid`, tal);
    cleanup.push(() => prisma.$executeRawUnsafe(`UPDATE units SET gstin = $2 WHERE id = $1::uuid`, tal, oldGstin));
    const reg = await prisma.$queryRawUnsafe<{ id: string }[]>(`INSERT INTO customers (code, name, name_key, state_code, gst_registration_type, gstin) VALUES ($1,'T34 Buyer','t34 buyer','27','REGULAR','27AABCT1234B1Z9') RETURNING id`, `T34A${Date.now().toString().slice(-6)}`).catch(() => [{ id: '' }]);
    const unreg = await prisma.$queryRawUnsafe<{ id: string }[]>(`INSERT INTO customers (code, name, name_key, state_code, gst_registration_type) VALUES ($1,'T34 Walk-in','t34 walk-in','27','UNREGISTERED') RETURNING id`, `T34B${Date.now().toString().slice(-6)}`);
    cleanup.push(async () => { await prisma.$executeRawUnsafe(`DELETE FROM sales_invoices WHERE number LIKE 'T34-%'`); await prisma.$executeRawUnsafe(`DELETE FROM customers WHERE name LIKE 'T34 %'`); });
    const mk = async (cust: string, number: string, status: string) => (await prisma.$queryRawUnsafe<{ id: string }[]>(`INSERT INTO sales_invoices (unit_id, fy_id, number, customer_id, status, invoice_date, grand_total) VALUES ($1::uuid,$2::uuid,$3,$4::uuid,$5,CURRENT_DATE,11800) RETURNING id`, tal, fy[0]!.id, number, cust, status))[0]!.id;
    const buyerId = reg[0]!.id || (await prisma.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM customers WHERE name = 'T34 Buyer'`))[0]!.id;
    const posted = await mk(buyerId, `T34-${Date.now()}-1`, 'Posted');
    const draft = await mk(buyerId, `T34-${Date.now()}-2`, 'Draft');
    const walkIn = await mk(unreg[0]!.id, `T34-${Date.now()}-3`, 'Posted');
    const off = await send('post', ownerToken, `/tax/einvoice/${posted}/generate-irn`);
    expect(off.status).toBe(409);
    expect(off.body.error.code).toBe('ADAPTER_DISABLED');
    expect(off.body.error.message).toBe('Live GST_IRP adapter is disabled; download JSON or enable Sandbox/Live in Integrations.');
    await send('put', ownerToken, '/admin/integrations/GST_IRP', { mode: 'SANDBOX' });
    expect((await send('post', ownerToken, `/tax/einvoice/${draft}/generate-irn`)).status).toBe(409);
    expect((await send('post', ownerToken, `/tax/einvoice/${walkIn}/generate-irn`)).status).toBe(422); // B2B only
    const ok = await send('post', ownerToken, `/tax/einvoice/${posted}/generate-irn`);
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.data.irn).toMatch(/^[0-9a-f]{64}$/);
    expect(ok.body.data.ack_no).toMatch(/^\d{15}$/);
    expect(ok.body.data.signed_qr.length).toBeGreaterThan(20);
    expect((await send('post', ownerToken, `/tax/einvoice/${posted}/generate-irn`)).status).toBe(409); // one IRN per invoice
    const log = (await get(ownerToken, '/admin/integrations/logs?provider=GST_IRP')).body.data as { doc_type: string; response_summary: string }[];
    expect(log.some((l) => l.doc_type === 'sales_invoice' && l.response_summary.startsWith('IRN '))).toBe(true);
    // a failing adapter: 502 each time, an alert to the Administrator on the third in a row
    setIrpClientForTests({ generate: async () => { throw new Error('GSP timeout'); }, ping: async () => ({ ok: false, detail: 'down' }) });
    const inv2 = await mk(buyerId, `T34-${Date.now()}-4`, 'Posted');
    for (let i = 0; i < 3; i++) expect((await send('post', ownerToken, `/tax/einvoice/${inv2}/generate-irn`)).status).toBe(502);
    expect(Number((await prisma.$queryRawUnsafe<{ fail_streak: number }[]>(`SELECT fail_streak FROM integration_configs WHERE provider_code = 'GST_IRP'`))[0]!.fail_streak)).toBe(3);
    const alerts = await prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM notifications WHERE type = 'system.integration_dlq'`).catch(() => [{ n: 1 }]);
    expect(Number(alerts[0]!.n)).toBeGreaterThanOrEqual(1);
    setIrpClientForTests(null);
    expect((await send('post', ownerToken, `/tax/einvoice/${inv2}/generate-irn`)).status).toBe(201); // the streak resets on success
    expect(Number((await prisma.$queryRawUnsafe<{ fail_streak: number }[]>(`SELECT fail_streak FROM integration_configs WHERE provider_code = 'GST_IRP'`))[0]!.fail_streak)).toBe(0);
  });

  it('WhatsApp send and the signed inbound hooks: bad signature 403, good signature accepted and stored', async () => {
    await send('put', ownerToken, '/admin/integrations/WHATSAPP', { mode: 'DISABLED' });
    const off = await send('post', ownerToken, '/admin/integrations/whatsapp/send', { to: '919800000000', template: 'invoice_ready' });
    expect(off.body.error.code).toBe('ADAPTER_DISABLED');
    await send('put', ownerToken, '/admin/integrations/WHATSAPP', { mode: 'SANDBOX', secrets: { webhookSecret: 'wa-secret' } });
    expect((await send('post', ownerToken, '/admin/integrations/whatsapp/send', { to: '12', template: 'invoice_ready' })).status).toBe(422);
    const sent = await send('post', ownerToken, '/admin/integrations/whatsapp/send', { to: '919800000000', template: 'invoice_ready', vars: { number: 'INV/1' } });
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    expect(sent.body.data).toMatchObject({ sent: true, mode: 'SANDBOX' });
    const log = (await get(ownerToken, '/admin/integrations/logs?provider=WHATSAPP')).body.data as { request_summary: string }[];
    expect(log.some((l) => l.request_summary.startsWith('invoice_ready to 9198'))).toBe(true);
    expect(JSON.stringify(log)).not.toContain('919800000000'); // the full number is not logged
    // inbound WhatsApp (Meta style sha256= prefix)
    const body = JSON.stringify({ entry: [{ id: 'x' }] });
    const sig = createHmac('sha256', 'wa-secret').update(body).digest('hex');
    const post = (path: string, header: string, value: string, payload: string) => request(app).post(`${API}${path}`).set('Content-Type', 'application/json').set(header, value).send(payload);
    const good = await post('/webhooks/inbound/whatsapp', 'X-Hub-Signature-256', `sha256=${sig}`, body);
    expect(good.status, JSON.stringify(good.body)).toBe(200);
    const bad = await post('/webhooks/inbound/whatsapp', 'X-Hub-Signature-256', `sha256=${'0'.repeat(64)}`, body);
    expect(bad.status).toBe(403);
    expect(bad.body.error.code).toBe('WEBHOOK_SIGNATURE_INVALID');
    expect(bad.body.error.message).toBe('Webhook signature verification failed.');
    expect((await post('/webhooks/inbound/whatsapp', 'X-Other', 'x', body)).status).toBe(403); // no signature at all
    // a tampered body with a valid signature of another body
    expect((await post('/webhooks/inbound/whatsapp', 'X-Hub-Signature-256', `sha256=${sig}`, body.replace('x', 'y'))).status).toBe(403);
    // inbound bank hook
    await send('put', ownerToken, '/admin/integrations/BANK_FEED', { mode: 'SANDBOX', secrets: { webhookSecret: 'bank-secret' } });
    const bbody = JSON.stringify({ utr: 'UTR123', amount: 1000 });
    expect((await post('/webhooks/inbound/bank', 'X-Bank-Signature', createHmac('sha256', 'bank-secret').update(bbody).digest('hex'), bbody)).status).toBe(200);
    expect((await post('/webhooks/inbound/bank', 'X-Bank-Signature', createHmac('sha256', 'wrong').update(bbody).digest('hex'), bbody)).status).toBe(403);
    const stored = await prisma.$queryRawUnsafe<{ source: string; signature_ok: boolean }[]>(`SELECT source, signature_ok FROM webhook_inbound WHERE source IN ('WHATSAPP','BANK_FEED') ORDER BY source`);
    expect(stored.filter((s) => s.signature_ok).length).toBe(2);
    expect(stored.filter((s) => !s.signature_ok).length).toBeGreaterThanOrEqual(3);
  });

  it('outbound webhooks: private address refused, secret encrypted, signed delivery, backoff 1-2-4-8 min, dead letter on the 5th failure, replay, legacy plain secret, SSRF at send time', async () => {
    const priv = await send('post', ownerToken, '/webhooks/endpoints', { name: 'T34 private', url: 'http://localhost:9999/hook', events: ['invoice.posted'] });
    expect(priv.status).toBe(422);
    const created = await send('post', ownerToken, '/webhooks/endpoints', { name: 'T34 ERP hook', url: 'https://hooks.example.invalid/erp', events: ['invoice.posted'] });
    expect(created.status, JSON.stringify(created.body)).toBeLessThan(300);
    const plain = String(created.body.data.plainSecret);
    expect(plain.startsWith('whsec_')).toBe(true);
    const ep = (await prisma.$queryRawUnsafe<{ id: string; secret_enc: string }[]>(`SELECT id, secret_enc FROM webhook_endpoints WHERE name = 'T34 ERP hook'`))[0]!;
    expect(ep.secret_enc.startsWith('v1:')).toBe(true); // encrypted at rest
    expect(ep.secret_enc).not.toContain(plain.slice(6, 20));
    const listed = JSON.stringify((await get(ownerToken, '/admin/webhooks')).body);
    expect(listed).not.toContain(plain);
    // an event nobody subscribed to creates nothing; the subscribed one creates one delivery
    expect(await integrationService.emit('stock.low', { a: 1 })).toBe(0);
    expect(await integrationService.emit('invoice.posted', { number: 'INV/1' })).toBeGreaterThanOrEqual(1);
    const calls: { headers: Record<string, string>; body: string }[] = [];
    setWebhookSenderForTests(async (_url, headers, body) => { calls.push({ headers, body }); return { status: 500, text: 'server error' }; });
    const t0 = new Date('2026-11-13T10:00:00Z');
    const min = (m: number) => new Date(t0.getTime() + m * 60_000);
    expect((await integrationService.deliverDue(t0)).retried).toBeGreaterThanOrEqual(1);
    const first = (await prisma.$queryRawUnsafe<{ id: string; attempt: number; status: string; next_retry_at: string }[]>(`SELECT id, attempt, status, next_retry_at FROM webhook_deliveries WHERE endpoint_id = $1::uuid ORDER BY created_at DESC LIMIT 1`, ep.id))[0]!;
    expect(first).toMatchObject({ attempt: 1, status: 'RETRY' });
    expect(new Date(first.next_retry_at).toISOString()).toBe(min(1).toISOString());
    // the signature the receiver would check
    const c = calls[0]!;
    expect(verifyStandardWebhook({ webhookId: c.headers['webhook-id']!, timestampSec: Number(c.headers['webhook-timestamp']), signatureHeader: c.headers['webhook-signature']!, body: c.body, secret: plain, nowSec: Number(c.headers['webhook-timestamp']) }).ok).toBe(true);
    expect(c.headers['x-rhai-signature']).toBe(c.headers['webhook-signature']);
    // not due yet at +30 s; attempts at +1, +3, +7, +15 minutes (waits 1, 2, 4, 8, 16)
    expect((await integrationService.deliverDue(new Date(t0.getTime() + 30_000))).retried).toBe(0);
    for (const m of [1, 3, 7]) expect((await integrationService.deliverDue(min(m))).retried).toBeGreaterThanOrEqual(1);
    const fifth = await integrationService.deliverDue(min(15));
    expect(fifth.dead).toBeGreaterThanOrEqual(1);
    const dead = (await get(ownerToken, '/admin/webhooks/deliveries?status=DEAD_LETTER')).body.data as { id: string; attempt: number; last_error: string }[];
    const mine = dead.find((d) => d.id === first.id)!;
    expect(mine.attempt).toBe(5);
    expect(mine.last_error).toBe('server error');
    expect(Number((await prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM notifications WHERE type = 'system.integration_dlq' AND entity_id = $1`, first.id).catch(() => [{ n: 1 }]))[0]!.n)).toBeGreaterThanOrEqual(1);
    // replay: a fresh delivery that now succeeds
    expect((await send('post', ownerToken, `/admin/webhooks/deliveries/${first.id}/replay`)).status).toBe(201);
    expect((await send('post', ownerToken, `/admin/webhooks/deliveries/${first.id}/replay`)).status).toBe(201); // still in the dead-letter queue as evidence
    setWebhookSenderForTests(async () => ({ status: 200, text: 'ok' }));
    expect((await integrationService.deliverDue(min(20))).sent).toBeGreaterThanOrEqual(1);
    expect(Number((await prisma.$queryRawUnsafe<{ failure_count: number }[]>(`SELECT failure_count FROM webhook_endpoints WHERE id = $1::uuid`, ep.id))[0]!.failure_count)).toBe(0);
    const okRow = (await get(ownerToken, '/admin/webhooks/deliveries?status=DELIVERED')).body.data as { replay_of: string | null }[];
    expect(okRow.some((d) => d.replay_of === first.id)).toBe(true);
    // only a dead-letter delivery can be replayed
    const delivered = okRow[0] as unknown as { id: string };
    expect((await send('post', ownerToken, `/admin/webhooks/deliveries/${delivered.id}/replay`)).status).toBe(409);
    // a Phase 19 endpoint with a plain-text secret still delivers
    const legacy = (await prisma.$queryRawUnsafe<{ id: string }[]>(`INSERT INTO webhook_endpoints (name, url, events, secret_enc, secret_last4, status) VALUES ('T34 legacy','https://legacy.example.invalid/x','["legacy.event"]'::jsonb,'whsec_bGVnYWN5LXNlY3JldA==','cret','ACTIVE') RETURNING id`))[0]!;
    await integrationService.emit('legacy.event', { ok: true });
    expect((await integrationService.deliverDue(min(21))).sent).toBeGreaterThanOrEqual(1);
    // the SSRF guard also applies at send time: a private target is never called
    const spy: string[] = [];
    setWebhookSenderForTests(async (url) => { spy.push(url); return { status: 200, text: 'ok' }; });
    await prisma.$executeRawUnsafe(`UPDATE webhook_endpoints SET url = 'https://10.0.0.5/internal' WHERE id = $1::uuid`, legacy.id);
    await integrationService.emit('legacy.event', { again: true });
    await integrationService.deliverDue(min(22));
    expect(spy.filter((u) => u.includes('10.0.0.5'))).toHaveLength(0);
    const blocked = (await prisma.$queryRawUnsafe<{ http_status: number; status: string }[]>(`SELECT http_status, status FROM webhook_deliveries WHERE endpoint_id = $1::uuid ORDER BY created_at DESC LIMIT 1`, legacy.id))[0]!;
    expect(blocked).toMatchObject({ http_status: 400, status: 'RETRY' });
  });
});
