// Phase 34: external integrations. An encrypted vault with a mode per provider (DISABLED / SANDBOX / LIVE), the e-invoice (IRN) adapter,
// WhatsApp and bank inbound hooks, and the outbound webhook engine with retry, dead-letter queue and replay.
// A live call happens only when a provider is explicitly set to SANDBOX with a URL or to LIVE (R-12); DISABLED keeps the JSON download.
import { randomUUID } from 'node:crypto';
import { encryptSecret, decryptSecret } from '../../core/auth/mfa-crypto';
import { recordAudit } from '../../core/audit/audit-service';
import { prisma } from '../../core/db/prisma';
import { AppError, Errors } from '../../core/http/errors';
import { logger } from '../../core/logger';
import { signStandardWebhook, validateWebhookUrl } from '../bi/bi-calc';
import { notificationService } from '../notifications/service';
import { query } from '../procurement/core';
import type { Row } from '../procurement/core';
import type { Caller } from '../records/service';
import { MAX_ATTEMPTS, MODES, PROVIDERS, PROVIDER_LABEL, backoffMinutes, maskSecret, nextStep, sandboxIrn, verifyHexSignature } from './calc';
import type { Mode, Provider } from './calc';

const S = (v: unknown): string => String(v ?? '');
const N = (v: unknown): number => Number(v ?? 0);

export const adapterDisabled = (provider: Provider): AppError =>
  new AppError(409, 'ADAPTER_DISABLED', `Live ${provider} adapter is disabled; download JSON or enable Sandbox/Live in Integrations.`);
export const webhookSignatureInvalid = (): AppError => new AppError(403, 'WEBHOOK_SIGNATURE_INVALID', 'Webhook signature verification failed.');

/** Webhook secrets written by Phase 19 were plain text; new ones are encrypted. Both are read here. */
export function readSecret(stored: string): string {
  return stored.startsWith('v1:') ? decryptSecret(stored) : stored;
}

// ------------------------------------------------------------------------------------------ adapters
export interface IrpRequest { sellerGstin: string; buyerGstin: string; docNo: string; docDate: string; value: number }
export interface IrpResult { irn: string; ackNo: string; ackDate: string; signedQr: string }
export interface IrpClient { generate(req: IrpRequest): Promise<IrpResult>; ping(): Promise<{ ok: boolean; detail: string }> }

export class MockSandboxIrpClient implements IrpClient {
  async generate(req: IrpRequest): Promise<IrpResult> {
    return sandboxIrn({ sellerGstin: req.sellerGstin, docNo: req.docNo, docDate: req.docDate });
  }
  async ping(): Promise<{ ok: boolean; detail: string }> {
    return { ok: true, detail: 'Sandbox IRP (built-in) is ready.' };
  }
}

/** The live NIC / GSP call: the endpoint paths follow the common GSP pattern and are set in the provider's configuration. */
export class HttpGspIrpClient implements IrpClient {
  constructor(private readonly cfg: { baseUrl: string; clientId?: string; token?: string; timeoutMs?: number }) {}
  private async call(path: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), this.cfg.timeoutMs ?? 10_000);
    try {
      const res = await fetch(`${this.cfg.baseUrl.replace(/\/$/, '')}${path}`, {
        method: body ? 'POST' : 'GET',
        headers: { 'content-type': 'application/json', ...(this.cfg.token ? { authorization: `Bearer ${this.cfg.token}` } : {}), ...(this.cfg.clientId ? { 'x-client-id': this.cfg.clientId } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: ctl.signal,
      });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      return { status: res.status, json };
    } finally {
      clearTimeout(t);
    }
  }
  async generate(req: IrpRequest): Promise<IrpResult> {
    const { status, json } = await this.call('/einvoice/v1.03/Invoice', { Version: '1.1', TranDtls: { SupTyp: 'B2B' }, DocDtls: { Typ: 'INV', No: req.docNo, Dt: req.docDate }, SellerDtls: { Gstin: req.sellerGstin }, BuyerDtls: { Gstin: req.buyerGstin }, ValDtls: { TotInvVal: req.value } });
    if (status >= 300 || !json.Irn) throw new Error(`IRP answered ${status}: ${S(json.message ?? json.error ?? 'no IRN')}`.slice(0, 200));
    return { irn: S(json.Irn), ackNo: S(json.AckNo), ackDate: S(json.AckDt ?? new Date().toISOString()), signedQr: S(json.SignedQRCode ?? '') };
  }
  async ping(): Promise<{ ok: boolean; detail: string }> {
    const { status } = await this.call('/health');
    return { ok: status < 300, detail: `Endpoint answered ${status}.` };
  }
}

let irpOverride: IrpClient | null = null;
export function setIrpClientForTests(c: IrpClient | null): void {
  irpOverride = c;
}
export function irpClientFor(mode: Mode, cfg: Record<string, unknown>, secrets: Record<string, string>): IrpClient {
  if (irpOverride) return irpOverride;
  const baseUrl = S(cfg.baseUrl);
  if (mode === 'SANDBOX' && !baseUrl) return new MockSandboxIrpClient();
  if (!baseUrl) throw Errors.validation({ baseUrl: 'Give the GSP / IRP address for LIVE mode.' });
  return new HttpGspIrpClient({ baseUrl, ...(secrets.clientId ? { clientId: secrets.clientId } : {}), ...(secrets.token ? { token: secrets.token } : {}) });
}

type Sender = (url: string, headers: Record<string, string>, body: string, timeoutMs: number) => Promise<{ status: number; text: string }>;
let sender: Sender = async (url, headers, body, timeoutMs) => {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: 'POST', headers, body, signal: ctl.signal });
    return { status: res.status, text: (await res.text().catch(() => '')).slice(0, 300) };
  } finally {
    clearTimeout(t);
  }
};
export function setWebhookSenderForTests(fn: Sender | null): void {
  sender = fn ?? (async () => ({ status: 599, text: 'no sender' }));
}

// ------------------------------------------------------------------------------------------ vault
async function loadConfig(provider: Provider): Promise<{ row: Row; secrets: Record<string, string> }> {
  const row = (await query(prisma, `SELECT * FROM integration_configs WHERE provider_code = $1`, provider))[0];
  if (!row) throw Errors.notFound('Unknown provider.');
  const secrets = row.secrets_enc ? (JSON.parse(decryptSecret(S(row.secrets_enc))) as Record<string, string>) : {};
  return { row, secrets };
}

async function logCall(provider: Provider, direction: 'OUTBOUND' | 'INBOUND', f: { docType?: string; docId?: string; status?: number; ms?: number; request?: string; response?: string; error?: string }): Promise<void> {
  await query(prisma, `INSERT INTO integration_logs (provider_code, direction, doc_type, doc_id, http_status, latency_ms, request_summary, response_summary, error_text) VALUES ($1,$2,$3,$4::uuid,$5,$6,$7,$8,$9)`, provider, direction, f.docType ?? null, f.docId ?? null, f.status ?? null, f.ms ?? null, (f.request ?? '').slice(0, 300) || null, (f.response ?? '').slice(0, 300) || null, (f.error ?? '').slice(0, 300) || null);
}

async function adminIds(): Promise<string[]> {
  return (await query(prisma, `SELECT u.id::text AS id FROM users u JOIN roles r ON r.id = u.role_id WHERE u.status = 'ACTIVE' AND r.level >= 95`)).map((r) => S(r.id));
}
async function tellAdmins(title: string, body: string, entityId: string, dedupe: string): Promise<void> {
  const ids = await adminIds();
  if (ids.length === 0) return;
  await prisma.$transaction(async (tx) => notificationService.notify(tx, ids, { type: 'system.integration_dlq', title, body, link: '/m/admin-integrations', entityType: 'integration', entityId, dedupeKey: dedupe }));
}

export const integrationService = {
  /** The providers with their mode and the secrets as masked hints only (never the secret). */
  async list(): Promise<Row[]> {
    const rows = await query(prisma, `SELECT provider_code, mode, config_json, secret_hints, fail_streak, last_tested_at, last_test_status, updated_at FROM integration_configs ORDER BY provider_code`);
    return rows.map((r) => ({ provider: S(r.provider_code), label: PROVIDER_LABEL[S(r.provider_code) as Provider], mode: r.mode, config: r.config_json, secrets: r.secret_hints, failStreak: r.fail_streak, lastTestedAt: r.last_tested_at, lastTestStatus: r.last_test_status, updatedAt: r.updated_at }));
  },
  async get(provider: Provider): Promise<Row> {
    return (await integrationService.list()).find((r) => r.provider === provider)!;
  },
  /** Save the mode, the plain settings, and any NEW secrets (a secret that is not sent keeps its old value). */
  async put(caller: Caller, provider: Provider, b: { mode: Mode; config?: Record<string, unknown>; secrets?: Record<string, string> }): Promise<Row> {
    if (!(PROVIDERS as readonly string[]).includes(provider)) throw Errors.validation({ provider: 'Unknown provider.' });
    if (!(MODES as readonly string[]).includes(b.mode)) throw Errors.validation({ mode: 'Choose DISABLED, SANDBOX or LIVE.' });
    const { secrets: old } = await loadConfig(provider);
    const merged: Record<string, string> = { ...old };
    for (const [k, v] of Object.entries(b.secrets ?? {})) if (v && !v.startsWith('••••')) merged[k] = v;
    const hints = Object.fromEntries(Object.entries(merged).map(([k, v]) => [k, maskSecret(v)]));
    const config = b.config ?? {};
    if (config.baseUrl) {
      const check = validateWebhookUrl(S(config.baseUrl), false);
      if (!check.valid) throw Errors.validation({ baseUrl: check.reason ?? 'The address must be a public HTTPS URL.' });
    }
    await query(prisma, `UPDATE integration_configs SET mode = $2, config_json = $3::jsonb, secrets_enc = $4, secret_hints = $5::jsonb, updated_by_id = $6::uuid, updated_at = now() WHERE provider_code = $1`, provider, b.mode, JSON.stringify(config), Object.keys(merged).length ? encryptSecret(JSON.stringify(merged)) : null, JSON.stringify(hints), caller.auth.user.id);
    // the audit never carries a secret value
    await recordAudit({ action: 'integration.config_changed', actorId: caller.auth.user.id, targetType: 'integration', targetId: provider, detail: { mode: b.mode, config: config as Record<string, string | number | boolean | null>, secretsChanged: Object.keys(b.secrets ?? {}) } });
    return integrationService.get(provider);
  },
  async test(caller: Caller, provider: Provider): Promise<{ ok: boolean; detail: string }> {
    const { row, secrets } = await loadConfig(provider);
    const mode = S(row.mode) as Mode;
    const t0 = Date.now();
    let result: { ok: boolean; detail: string };
    if (mode === 'DISABLED') result = { ok: false, detail: `Live ${provider} adapter is disabled.` };
    else {
      try {
        if (provider === 'GST_IRP' || provider === 'GST_EWAY') result = await irpClientFor(mode, (row.config_json as Record<string, unknown>) ?? {}, secrets).ping();
        else result = { ok: true, detail: mode === 'SANDBOX' ? 'Sandbox settings accepted.' : 'Settings saved; the live connection is used on the first call.' };
      } catch (e) {
        result = { ok: false, detail: S((e as Error).message).slice(0, 200) };
      }
    }
    await query(prisma, `UPDATE integration_configs SET last_tested_at = now(), last_test_status = $2 WHERE provider_code = $1`, provider, result.ok ? 'OK' : 'FAILED');
    await logCall(provider, 'OUTBOUND', { ms: Date.now() - t0, request: 'test connection', response: result.detail, ...(result.ok ? {} : { error: result.detail }) });
    await recordAudit({ action: 'integration.tested', actorId: caller.auth.user.id, targetType: 'integration', targetId: provider, detail: { ok: result.ok } });
    return result;
  },
  async logs(provider?: string): Promise<Row[]> {
    return query(prisma, `SELECT * FROM integration_logs WHERE ($1::text IS NULL OR provider_code = $1) ORDER BY created_at DESC LIMIT 100`, provider ?? null);
  },

  // ------------------------------------------------------------------------------------------ e-invoice
  /** Generate the IRN for a posted invoice through the active adapter; disabled = a clear message that keeps the JSON download. */
  async generateIrn(caller: Caller, invoiceId: string): Promise<Row> {
    const { row, secrets } = await loadConfig('GST_IRP');
    const mode = S(row.mode) as Mode;
    if (mode === 'DISABLED') throw adapterDisabled('GST_IRP');
    const inv = (await query(prisma, `SELECT i.id, i.unit_id, i.number, i.status, i.invoice_date, i.grand_total, i.irn, c.gstin AS buyer_gstin, u.gstin AS seller_gstin FROM sales_invoices i JOIN customers c ON c.id = i.customer_id JOIN units u ON u.id = i.unit_id WHERE i.id = $1::uuid AND i.deleted_at IS NULL`, invoiceId))[0];
    if (!inv || !caller.ctx.unitIds.includes(S(inv.unit_id))) throw Errors.notFound('Invoice not found.');
    if (S(inv.status) !== 'Posted') throw Errors.conflict('Only a posted invoice can get an IRN.');
    if (inv.irn) throw Errors.conflict(`This invoice already has an IRN (${S(inv.irn).slice(0, 12)}…).`);
    if (!inv.buyer_gstin) throw Errors.validation({ customer: 'An e-invoice is for registered customers (B2B). This customer has no GSTIN.' });
    if (!inv.seller_gstin) throw Errors.validation({ unit: 'The plant has no GSTIN. Add it in Plants.' });
    const t0 = Date.now();
    try {
      const out = await irpClientFor(mode, (row.config_json as Record<string, unknown>) ?? {}, secrets).generate({ sellerGstin: S(inv.seller_gstin), buyerGstin: S(inv.buyer_gstin), docNo: S(inv.number), docDate: S(inv.invoice_date instanceof Date ? inv.invoice_date.toISOString() : inv.invoice_date).slice(0, 10), value: N(inv.grand_total) });
      const r = await query(prisma, `UPDATE sales_invoices SET irn = $2, ack_no = $3, ack_date = $4::timestamptz, signed_qr = $5 WHERE id = $1::uuid AND irn IS NULL RETURNING id, number, irn, ack_no, ack_date, signed_qr`, invoiceId, out.irn, out.ackNo, out.ackDate, out.signedQr);
      if (!r[0]) throw Errors.conflict('This invoice already has an IRN.');
      await query(prisma, `UPDATE integration_configs SET fail_streak = 0 WHERE provider_code = 'GST_IRP'`);
      await logCall('GST_IRP', 'OUTBOUND', { docType: 'sales_invoice', docId: invoiceId, status: 200, ms: Date.now() - t0, request: `IRN for ${S(inv.number)}`, response: `IRN ${out.irn.slice(0, 16)}…` });
      await recordAudit({ action: 'einvoice.irn_generated', actorId: caller.auth.user.id, targetType: 'sales_invoice', targetId: invoiceId, detail: { number: S(inv.number), mode } });
      return r[0];
    } catch (e) {
      if (e instanceof AppError) throw e;
      const msg = S((e as Error).message).slice(0, 200);
      const streak = N((await query(prisma, `UPDATE integration_configs SET fail_streak = fail_streak + 1 WHERE provider_code = 'GST_IRP' RETURNING fail_streak`))[0]?.fail_streak);
      await logCall('GST_IRP', 'OUTBOUND', { docType: 'sales_invoice', docId: invoiceId, status: 502, ms: Date.now() - t0, request: `IRN for ${S(inv.number)}`, error: msg });
      if (streak >= 3) await tellAdmins('GST e-invoice adapter keeps failing', `${streak} failures in a row. Last: ${msg}`, 'GST_IRP', `int:irp:${streak}`);
      throw new AppError(502, 'INTERNAL', `The GST e-invoice service did not accept the request: ${msg}`);
    }
  },

  // ------------------------------------------------------------------------------------------ WhatsApp
  /** A template message through the WhatsApp adapter. Sandbox only logs it; live sends it to the configured Cloud API. */
  async sendWhatsApp(caller: Caller, b: { to: string; template: string; vars?: Record<string, string>; docType?: string; docId?: string }): Promise<Row> {
    const { row, secrets } = await loadConfig('WHATSAPP');
    const mode = S(row.mode) as Mode;
    if (mode === 'DISABLED') throw adapterDisabled('WHATSAPP');
    if (!/^\+?\d{10,15}$/.test(b.to)) throw Errors.validation({ to: 'Give the number with the country code, for example 919800000000.' });
    const t0 = Date.now();
    const cfg = (row.config_json as Record<string, unknown>) ?? {};
    let status = 200;
    let response = 'sandbox: message recorded, not sent';
    if (mode === 'LIVE' || (mode === 'SANDBOX' && cfg.baseUrl)) {
      const r = await sender(`${S(cfg.baseUrl)}/messages`, { 'content-type': 'application/json', authorization: `Bearer ${secrets.token ?? ''}` }, JSON.stringify({ messaging_product: 'whatsapp', to: b.to, type: 'template', template: { name: b.template, language: { code: 'en' }, components: [{ type: 'body', parameters: Object.values(b.vars ?? {}).map((v) => ({ type: 'text', text: v })) }] } }), 10_000);
      status = r.status;
      response = r.text;
    }
    await logCall('WHATSAPP', 'OUTBOUND', { ...(b.docType ? { docType: b.docType } : {}), ...(b.docId ? { docId: b.docId } : {}), status, ms: Date.now() - t0, request: `${b.template} to ${b.to.slice(0, 4)}…${b.to.slice(-2)}`, response, ...(status >= 300 ? { error: response } : {}) });
    if (status >= 300) throw new AppError(502, 'INTERNAL', 'WhatsApp did not accept the message.');
    await recordAudit({ action: 'whatsapp.sent', actorId: caller.auth.user.id, targetType: 'integration', targetId: 'WHATSAPP', detail: { template: b.template } });
    return { sent: true, mode, status };
  },

  // ------------------------------------------------------------------------------------------ inbound hooks (signature first)
  async inbound(provider: 'WHATSAPP' | 'BANK_FEED', rawBody: string, signature: string): Promise<{ accepted: boolean }> {
    const { secrets } = await loadConfig(provider);
    const secret = secrets.webhookSecret ?? '';
    const ok = Boolean(secret) && verifyHexSignature(rawBody, signature, secret);
    let payload: unknown = {};
    try { payload = JSON.parse(rawBody); } catch { payload = { raw: rawBody.slice(0, 200) }; }
    await query(prisma, `INSERT INTO webhook_inbound (source, external_id, signature_ok, payload, processed_at) VALUES ($1,$2,$3,$4::jsonb, now())`, provider, randomUUID(), ok, JSON.stringify(ok ? payload : { rejected: true }));
    await logCall(provider, 'INBOUND', { status: ok ? 200 : 403, request: `${rawBody.length} bytes`, response: ok ? 'accepted' : 'signature invalid', ...(ok ? {} : { error: 'signature invalid' }) });
    if (!ok) throw webhookSignatureInvalid();
    return { accepted: true };
  },

  // ------------------------------------------------------------------------------------------ outbound webhooks: events, retry, dead letter, replay
  /** Queue a delivery for every active endpoint subscribed to the event (a delivery is signed when it is first built). */
  async emit(eventName: string, payload: Record<string, unknown>): Promise<number> {
    const eps = await query(prisma, `SELECT * FROM webhook_endpoints WHERE status = 'ACTIVE' AND (events ? $1 OR events ? '*')`, eventName);
    for (const ep of eps) await integrationService.queueDelivery(ep, eventName, payload, null);
    return eps.length;
  },
  async queueDelivery(ep: Row, eventName: string, payload: Record<string, unknown>, replayOf: string | null): Promise<Row> {
    const webhookId = `msg_${randomUUID()}`;
    const body = JSON.stringify(payload);
    const row = (await query(prisma, `INSERT INTO webhook_deliveries (endpoint_id, webhook_msg_id, event_name, headers, payload, payload_sha256, status, replay_of, attempt) VALUES ($1::uuid,$2,$3,'{}'::jsonb,$4::jsonb,encode(sha256($5::bytea),'hex'),'PENDING',$6::uuid,0) RETURNING *`, ep.id, webhookId, eventName, body, body, replayOf))[0]!;
    return row;
  },
  /** Job body (every minute): send what is due. A failure waits 1, 2, 4, 8, 16 minutes; the 5th failure goes to the dead-letter queue. */
  async deliverDue(now: Date = new Date()): Promise<{ sent: number; retried: number; dead: number }> {
    const due = await query(prisma, `SELECT d.*, e.url, e.secret_enc, e.timeout_ms, e.max_retries, e.name AS endpoint_name FROM webhook_deliveries d JOIN webhook_endpoints e ON e.id = d.endpoint_id WHERE d.status IN ('PENDING','RETRY') AND (d.next_retry_at IS NULL OR d.next_retry_at <= $1::timestamptz) AND e.status = 'ACTIVE' ORDER BY d.created_at LIMIT 50`, now.toISOString());
    let sent = 0;
    let retried = 0;
    let dead = 0;
    for (const d of due) {
      const secret = readSecret(S(d.secret_enc));
      const ts = Math.floor(now.getTime() / 1000);
      const body = JSON.stringify(d.payload);
      const headers = { 'content-type': 'application/json', 'webhook-id': S(d.webhook_msg_id), 'webhook-timestamp': String(ts), 'webhook-signature': signStandardWebhook({ webhookId: S(d.webhook_msg_id), timestampSec: ts, body, secret }), 'x-rhai-signature': signStandardWebhook({ webhookId: S(d.webhook_msg_id), timestampSec: ts, body, secret }), 'x-rhai-timestamp': String(ts) };
      const check = validateWebhookUrl(S(d.url), process.env.NODE_ENV === 'development');
      const t0 = Date.now();
      let status = 0;
      let text = '';
      if (!check.valid) { status = 400; text = check.reason ?? 'blocked address'; }
      else {
        try { const r = await sender(S(d.url), headers, body, N(d.timeout_ms) || 10_000); status = r.status; text = r.text; } catch (e) { status = 599; text = S((e as Error).message).slice(0, 200); }
      }
      const attempt = N(d.attempt) + 1;
      if (status >= 200 && status < 300) {
        await query(prisma, `UPDATE webhook_deliveries SET status = 'DELIVERED', attempt = $2, http_status = $3, response_snippet = $4, duration_ms = $5, headers = $6::jsonb, next_retry_at = NULL, last_error = NULL WHERE id = $1::uuid`, d.id, attempt, status, text.slice(0, 200), Date.now() - t0, JSON.stringify({ ...headers, 'webhook-signature': 'v1,***' }));
        await query(prisma, `UPDATE webhook_endpoints SET failure_count = 0 WHERE id = $1::uuid`, d.endpoint_id);
        sent += 1;
        continue;
      }
      const step = nextStep(attempt, Math.min(N(d.max_retries) || MAX_ATTEMPTS, MAX_ATTEMPTS)); // the dead-letter queue starts at the 5th failure at the latest
      const nextAt = step === 'RETRY' ? new Date(now.getTime() + backoffMinutes(attempt) * 60_000).toISOString() : null;
      await query(prisma, `UPDATE webhook_deliveries SET status = $2, attempt = $3, http_status = $4, response_snippet = $5, duration_ms = $6, next_retry_at = $7::timestamptz, last_error = $5 WHERE id = $1::uuid`, d.id, step, attempt, status, text.slice(0, 200), Date.now() - t0, nextAt);
      await query(prisma, `UPDATE webhook_endpoints SET failure_count = failure_count + 1 WHERE id = $1::uuid`, d.endpoint_id);
      if (step === 'DEAD_LETTER') {
        dead += 1;
        await tellAdmins(`Webhook to ${S(d.endpoint_name)} failed ${attempt} times`, `${S(d.event_name)}: ${text.slice(0, 120)}. Replay it from Outbound Webhooks.`, S(d.id), `int:wh:${S(d.id)}`).catch((e) => logger.warn({ err: e }, 'Could not notify admins'));
      } else retried += 1;
    }
    return { sent, retried, dead };
  },
  async deliveries(f: { status?: string; endpoint?: string }): Promise<Row[]> {
    return query(prisma, `SELECT d.id, d.endpoint_id, e.name AS endpoint, d.event_name, d.attempt, d.http_status, d.status, d.next_retry_at, d.last_error, d.created_at, d.replay_of FROM webhook_deliveries d JOIN webhook_endpoints e ON e.id = d.endpoint_id WHERE ($1::text IS NULL OR d.status = $1) AND ($2::uuid IS NULL OR d.endpoint_id = $2::uuid) ORDER BY d.created_at DESC LIMIT 200`, f.status ?? null, f.endpoint ?? null);
  },
  /** Replay a dead-lettered delivery: a fresh PENDING delivery with the same payload (the original stays as evidence). */
  async replay(caller: Caller, id: string): Promise<Row> {
    const d = (await query(prisma, `SELECT * FROM webhook_deliveries WHERE id = $1::uuid`, id))[0];
    if (!d) throw Errors.notFound('Delivery not found.');
    if (S(d.status) !== 'DEAD_LETTER') throw Errors.conflict('Only a delivery in the dead-letter queue can be replayed.');
    const ep = (await query(prisma, `SELECT * FROM webhook_endpoints WHERE id = $1::uuid`, d.endpoint_id))[0]!;
    const fresh = await integrationService.queueDelivery(ep, S(d.event_name), d.payload as Record<string, unknown>, id);
    await recordAudit({ action: 'webhook.replayed', actorId: caller.auth.user.id, targetType: 'webhook_delivery', targetId: id, detail: { newDelivery: S(fresh.id) } });
    return fresh;
  },
  async webhookEndpoints(): Promise<Row[]> {
    return query(prisma, `SELECT e.id, e.name, e.url, e.events, e.secret_last4, e.failure_count, e.status, e.created_at, (SELECT count(*)::int FROM webhook_deliveries d WHERE d.endpoint_id = e.id AND d.status = 'DEAD_LETTER') AS dead_letters FROM webhook_endpoints e ORDER BY e.created_at DESC`);
  },
};
