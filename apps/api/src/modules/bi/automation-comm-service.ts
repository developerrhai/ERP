// apps/api/src/modules/bi/automation-comm-service.ts
import { encryptSecret } from '../../core/auth/mfa-crypto';
import { readSecret } from '../integrations/service';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { prisma } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { recordAudit } from '../../core/audit/audit-service';
import { norm, query, exec } from '../procurement/core';
import type { Row } from '../procurement/core';
import type { Caller } from '../records/service';
import {
  evaluateConditionAst,
  validateConditionAst,
  signStandardWebhook,
  validateWebhookUrl,
  verifyMetaSignature,
  verifyRazorpaySignature,
  validateDltSms,
  validateWhatsAppPreSend,
  type ConditionAst,
} from './bi-calc';

const APPROVAL_ACTIONS = new Set(['set_field', 'create_document_draft', 'bulk_message']);

export const AUTOMATION_EVENTS = [
  { event: 'sales_order.confirmed', label: 'Sales Order Confirmed', module: 'Sales' },
  { event: 'invoice.overdue', label: 'Invoice Overdue', module: 'Finance' },
  { event: 'stock.below_reorder', label: 'Stock Below Reorder Point', module: 'Inventory' },
  { event: 'breakdown.reported', label: 'Machine Breakdown Reported', module: 'Maintenance' },
  { event: 'ncr.raised', label: 'Non-Conformance Raised', module: 'Quality' },
  { event: 'payment_link.paid', label: 'Payment Link Paid', module: 'Finance' },
];

export class AutomationCommService {
  // ------------------------------------------------------------------------- Automation Rules
  async listRules(): Promise<Row[]> {
    const rows = await query(prisma, `SELECT * FROM automation_rules ORDER BY priority ASC, created_at DESC`);
    return rows.map(norm);
  }

  async createRule(
    caller: Caller,
    input: {
      code: string;
      name: string;
      module: string;
      triggerEvent: string;
      conditions: ConditionAst;
      actions: Array<{ type: string; params?: Record<string, unknown> }>;
      priority?: number;
      maxRunsPerHour?: number;
    },
  ): Promise<Row> {
    try {
      validateConditionAst(input.conditions);
    } catch (err: any) {
      throw Errors.validation({ conditions: err.message }, err.message);
    }

    const needsApproval = input.actions.some((a) => APPROVAL_ACTIONS.has(a.type));

    const rows = await query(
      prisma,
      `INSERT INTO automation_rules (
        code, name, module, trigger_event, conditions, actions, priority,
        run_as_user_id, requires_approval, max_runs_per_hour, status, created_by_id
      ) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8::uuid,$9,$10,'DRAFT',$8::uuid)
      RETURNING *`,
      input.code.trim().toUpperCase(),
      input.name,
      input.module,
      input.triggerEvent,
      JSON.stringify(input.conditions),
      JSON.stringify(input.actions),
      input.priority ?? 10,
      caller.auth.userId,
      needsApproval,
      input.maxRunsPerHour ?? 60,
    );
    return norm(rows[0]!);
  }

  async activateRule(caller: Caller, id: string, opts?: { approved?: boolean }): Promise<Row> {
    const rows = await query(prisma, `SELECT * FROM automation_rules WHERE id = $1::uuid`, id);
    if (!rows[0]) throw Errors.notFound(`Rule not found: ${id}`);
    const rule = rows[0];

    const actions = (Array.isArray(rule.actions) ? rule.actions : []) as Array<{ type: string }>;
    const approvalAction = actions.find((a) => APPROVAL_ACTIONS.has(a.type));

    if (rule.requires_approval && !opts?.approved) {
      await exec(prisma, `UPDATE automation_rules SET status = 'PENDING_APPROVAL' WHERE id = $1::uuid`, id);
      const msg = `Action ${approvalAction?.type ?? 'write'} needs approval before activation.`;
      throw Errors.validation({ approval: msg }, msg);
    }

    const updated = await query(
      prisma,
      `UPDATE automation_rules SET status = 'ACTIVE', updated_at = now() WHERE id = $1::uuid RETURNING *`,
      id,
    );
    await recordAudit(
      {
        actorId: caller.auth.userId,
        action: 'automation.rule.activate',
        targetType: 'automation_rules',
        targetId: id,
      },
      prisma,
    );
    return norm(updated[0]!);
  }

  async executeEvent(params: {
    eventName: string;
    eventId: string;
    payload: Record<string, unknown>;
    correlationId?: string;
    depth?: number;
  }): Promise<{ runs: Row[] }> {
    const depth = params.depth ?? 1;
    const corrId = params.correlationId ?? randomUUID();

    const rules = await query(
      prisma,
      `SELECT * FROM automation_rules WHERE trigger_event = $1 AND status = 'ACTIVE' ORDER BY priority ASC`,
      params.eventName,
    );

    const results: Row[] = [];
    for (const r of rules) {
      // Idempotency check per (rule_id, event_id)
      const existing = await query(
        prisma,
        `SELECT * FROM automation_runs WHERE rule_id = $1::uuid AND event_id = $2`,
        r.id,
        params.eventId,
      );
      if (existing[0]) {
        results.push(norm(existing[0]));
        continue;
      }

      // Guard 1: Depth > 3 -> LOOP_BLOCKED
      if (depth > 3) {
        const blk = await query(
          prisma,
          `INSERT INTO automation_runs (rule_id, event_name, event_id, correlation_id, depth, matched, status, error, finished_at)
           VALUES ($1::uuid, $2, $3, $4::uuid, $5, false, 'LOOP_BLOCKED', 'Loop depth exceeded (> 3)', now()) RETURNING *`,
          r.id,
          params.eventName,
          params.eventId,
          corrId,
          depth,
        );
        results.push(norm(blk[0]!));
        continue;
      }

      // Guard 2: Hourly rate cap -> auto-pause
      const rateRows = await query(
        prisma,
        `SELECT COUNT(*) AS cnt FROM automation_runs WHERE rule_id = $1::uuid AND started_at >= now() - interval '1 hour'`,
        r.id,
      );
      if (Number(rateRows[0]?.cnt ?? 0) >= Number(r.max_runs_per_hour)) {
        await exec(prisma, `UPDATE automation_rules SET status = 'PAUSED', updated_at = now() WHERE id = $1::uuid`, r.id);
        const paused = await query(
          prisma,
          `INSERT INTO automation_runs (rule_id, event_name, event_id, correlation_id, depth, matched, status, error, finished_at)
           VALUES ($1::uuid, $2, $3, $4::uuid, $5, false, 'PAUSED_RATE', 'Hourly rate cap exceeded; rule paused', now()) RETURNING *`,
          r.id,
          params.eventName,
          params.eventId,
          corrId,
          depth,
        );
        results.push(norm(paused[0]!));
        continue;
      }

      const matched = evaluateConditionAst(r.conditions as ConditionAst, params.payload);
      const runStatus = matched ? 'SUCCESS' : 'SKIPPED';
      const runRows = await query(
        prisma,
        `INSERT INTO automation_runs (rule_id, event_name, event_id, correlation_id, depth, matched, actions_result, status, finished_at)
         VALUES ($1::uuid, $2, $3, $4::uuid, $5, $6, $7::jsonb, $8, now()) RETURNING *`,
        r.id,
        params.eventName,
        params.eventId,
        corrId,
        depth,
        matched,
        JSON.stringify(matched ? r.actions : []),
        runStatus,
      );
      results.push(norm(runRows[0]!));
    }

    return { runs: results };
  }

  // ------------------------------------------------------------------------- Standard Webhooks
  async listWebhooks(): Promise<Row[]> {
    const rows = await query(
      prisma,
      `SELECT id, name, url, events, secret_last4, timeout_ms, max_retries, failure_count, status, created_at FROM webhook_endpoints ORDER BY created_at DESC`,
    );
    return rows.map(norm);
  }

  async createWebhookEndpoint(
    caller: Caller,
    input: { name: string; url: string; events: string[] },
  ): Promise<Row & { plainSecret: string }> {
    const check = validateWebhookUrl(input.url, process.env.NODE_ENV === 'development');
    if (!check.valid) {
      const msg = check.reason || 'Endpoint must be a public HTTPS URL.';
      throw Errors.validation({ url: msg }, msg);
    }

    const rawSecret = `whsec_${randomBytes(24).toString('base64')}`;
    const last4 = rawSecret.slice(-4);

    const rows = await query(
      prisma,
      `INSERT INTO webhook_endpoints (name, url, events, secret_enc, secret_last4, created_by_id)
       VALUES ($1,$2,$3::jsonb,$4,$5,$6::uuid)
       RETURNING id, name, url, events, secret_last4, status, created_at`,
      input.name,
      input.url,
      JSON.stringify(input.events),
      encryptSecret(rawSecret),
      last4,
      caller.auth.userId,
    );
    return { ...norm(rows[0]!), plainSecret: rawSecret };
  }

  async rotateWebhookSecret(caller: Caller, endpointId: string): Promise<{ plainSecret: string; secretLast4: string }> {
    const epRows = await query(prisma, `SELECT secret_enc FROM webhook_endpoints WHERE id = $1::uuid`, endpointId);
    if (!epRows[0]) throw Errors.notFound(`Webhook endpoint not found: ${endpointId}`);

    const newSecret = `whsec_${randomBytes(24).toString('base64')}`;
    const last4 = newSecret.slice(-4);
    const prevExpires = new Date(Date.now() + 24 * 3600 * 1000);

    await exec(
      prisma,
      `UPDATE webhook_endpoints SET secret_prev_enc = secret_enc, secret_prev_expires_at = $1::timestamptz, secret_enc = $2, secret_last4 = $3 WHERE id = $4::uuid`,
      prevExpires,
      newSecret,
      last4,
      endpointId,
    );
    await recordAudit(
      {
        actorId: caller.auth.userId,
        action: 'webhooks.secret.rotate',
        targetType: 'webhook_endpoints',
        targetId: endpointId,
      },
      prisma,
    );
    return { plainSecret: newSecret, secretLast4: last4 };
  }

  async queueWebhookDelivery(endpointId: string, eventName: string, payload: Record<string, unknown>): Promise<Row> {
    const epRows = await query(prisma, `SELECT * FROM webhook_endpoints WHERE id = $1::uuid`, endpointId);
    if (!epRows[0]) throw Errors.notFound(`Endpoint not found: ${endpointId}`);
    const ep = epRows[0];

    const webhookId = `msg_${randomUUID()}`;
    const ts = Math.floor(Date.now() / 1000);
    const bodyStr = JSON.stringify(payload);
    const sha = createHash('sha256').update(bodyStr).digest('hex');
    const sig = signStandardWebhook({
      webhookId,
      timestampSec: ts,
      body: bodyStr,
      secret: readSecret(String(ep.secret_enc)),
    });

    const headers = {
      'webhook-id': webhookId,
      'webhook-timestamp': String(ts),
      'webhook-signature': sig,
      'content-type': 'application/json',
    };

    const rows = await query(
      prisma,
      `INSERT INTO webhook_deliveries (endpoint_id, webhook_msg_id, event_name, headers, payload, payload_sha256, status)
       VALUES ($1::uuid, $2, $3, $4::jsonb, $5::jsonb, $6, 'PENDING') RETURNING *`,
      endpointId,
      webhookId,
      eventName,
      JSON.stringify(headers),
      bodyStr,
      sha,
    );
    return norm(rows[0]!);
  }

  async handleInboundRazorpay(rawBody: string, headerSig: string, secret: string): Promise<{ accepted: boolean }> {
    const sigOk = verifyRazorpaySignature(rawBody, headerSig, secret);
    const payload: any = JSON.parse(rawBody || '{}');
    const extId = String(payload?.payload?.payment?.entity?.id || payload?.event_id || randomUUID());

    const existing = await query(
      prisma,
      `SELECT id FROM webhook_inbound WHERE source = 'RAZORPAY' AND external_id = $1`,
      extId,
    );
    if (existing[0]) return { accepted: true };

    await exec(
      prisma,
      `INSERT INTO webhook_inbound (source, external_id, signature_ok, payload) VALUES ('RAZORPAY', $1, $2, $3::jsonb)`,
      extId,
      sigOk,
      rawBody,
    );

    if (!sigOk) throw Errors.forbidden('Invalid X-Razorpay-Signature');

    if (payload.event === 'payment.captured' && payload.payload?.payment_link?.entity?.id) {
      const linkId = String(payload.payload.payment_link.entity.id);
      await exec(
        prisma,
        `UPDATE payment_links SET status = 'PAID', paid_at = now() WHERE link_id = $1`,
        linkId,
      );
      await this.executeEvent({
        eventName: 'payment_link.paid',
        eventId: extId,
        payload: { linkId, amount: payload.payload.payment?.entity?.amount },
      });
    }

    return { accepted: true };
  }

  async handleInboundMeta(rawBody: string, headerSig: string, appSecret: string): Promise<{ accepted: boolean }> {
    const sigOk = verifyMetaSignature(rawBody, headerSig, appSecret);
    const payload: any = JSON.parse(rawBody || '{}');
    const extId = String(payload?.entry?.[0]?.id || randomUUID());

    await exec(
      prisma,
      `INSERT INTO webhook_inbound (source, external_id, signature_ok, payload)
       VALUES ('META', $1, $2, $3::jsonb)
       ON CONFLICT (source, external_id) DO NOTHING`,
      extId,
      sigOk,
      rawBody,
    );

    if (!sigOk) throw Errors.forbidden('Invalid X-Hub-Signature-256');
    return { accepted: true };
  }

  // ------------------------------------------------------------------------- Communication & Payment Links
  async createTemplate(
    input: {
      code: string;
      channel: 'WHATSAPP' | 'SMS' | 'EMAIL';
      name: string;
      category?: string;
      body: string;
      variables?: string[];
      waTemplateName?: string;
      waStatus?: string;
      dltTemplateId?: string;
      dltHeader?: string;
      whitelistedUrls?: string[];
    },
  ): Promise<Row> {
    const rows = await query(
      prisma,
      `INSERT INTO message_templates (
        code, channel, name, category, body, variables, wa_template_name, wa_status,
        dlt_template_id, dlt_header, whitelisted_urls
      ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11::jsonb) RETURNING *`,
      input.code.trim().toUpperCase(),
      input.channel,
      input.name,
      input.category ?? 'TRANSACTIONAL',
      input.body,
      JSON.stringify(input.variables ?? []),
      input.waTemplateName ?? null,
      input.waStatus ?? 'APPROVED',
      input.dltTemplateId ?? null,
      input.dltHeader ?? null,
      JSON.stringify(input.whitelistedUrls ?? []),
    );
    return norm(rows[0]!);
  }

  async upsertConsent(input: {
    channel: 'WHATSAPP' | 'SMS' | 'EMAIL';
    address: string;
    optedIn: boolean;
    partyId?: string;
    source?: string;
  }): Promise<Row> {
    const rows = await query(
      prisma,
      `INSERT INTO contact_consents (channel, address, opted_in, party_id, source, opted_out_at)
       VALUES ($1,$2,$3,$4::uuid,$5, CASE WHEN $3 THEN NULL ELSE now() END)
       ON CONFLICT (channel, address) DO UPDATE SET
         opted_in = EXCLUDED.opted_in,
         opted_out_at = CASE WHEN EXCLUDED.opted_in THEN NULL ELSE now() END
       RETURNING *`,
      input.channel,
      input.address,
      input.optedIn,
      input.partyId ?? null,
      input.source ?? 'WEB_FORM',
    );
    return norm(rows[0]!);
  }

  async sendMessage(
    caller: Caller,
    input: {
      channel: 'WHATSAPP' | 'SMS' | 'EMAIL';
      templateCode: string;
      recipient: string;
      variables: string[];
      renderedBody: string;
      within24hWindow?: boolean;
      istHour?: number;
    },
  ): Promise<Row> {
    const tplRows = await query(prisma, `SELECT * FROM message_templates WHERE code = $1`, input.templateCode.toUpperCase());
    if (!tplRows[0]) throw Errors.notFound(`Template not found: ${input.templateCode}`);
    const tpl = tplRows[0];

    const consentRows = await query(
      prisma,
      `SELECT opted_in FROM contact_consents WHERE channel = $1 AND address = $2`,
      input.channel,
      input.recipient,
    );
    const optedIn = Boolean(consentRows[0]?.opted_in);

    let status: 'SENT' | 'QUEUED' | 'BLOCKED' = 'SENT';
    let errorReason: string | null = null;

    if (input.channel === 'SMS') {
      const check = validateDltSms({
        dltTemplateId: tpl.dlt_template_id ? String(tpl.dlt_template_id) : null,
        dltHeader: tpl.dlt_header ? String(tpl.dlt_header) : null,
        templateBody: String(tpl.body),
        renderedBody: input.renderedBody,
        variables: input.variables,
        whitelistedUrls: Array.isArray(tpl.whitelisted_urls) ? (tpl.whitelisted_urls as string[]) : [],
        category: String(tpl.category),
        istHour: input.istHour,
      });
      if (check.status === 'BLOCKED') {
        status = 'BLOCKED';
        errorReason = check.reason ?? 'Blocked by TRAI DLT rules';
      } else if (check.status === 'QUEUED_WINDOW') {
        status = 'QUEUED';
        errorReason = check.reason ?? 'Queued for 10:00 IST';
      }
    } else if (input.channel === 'WHATSAPP') {
      const check = validateWhatsAppPreSend({
        optedIn,
        within24hWindow: input.within24hWindow,
        waStatus: tpl.wa_status ? String(tpl.wa_status) : null,
      });
      if (!check.allowed) {
        status = 'BLOCKED';
        errorReason = check.reason ?? 'Blocked by WhatsApp Cloud pre-send check';
      }
    }

    const msgRows = await query(
      prisma,
      `INSERT INTO outbound_messages (
        channel, template_id, recipient, variables, rendered_body, status, error, cost_inr, requested_by_id, sent_at
      ) VALUES ($1,$2::uuid,$3,$4::jsonb,$5,$6,$7,$8,$9::uuid, CASE WHEN $6 = 'SENT' THEN now() ELSE NULL END)
      RETURNING *`,
      input.channel,
      tpl.id,
      input.recipient,
      JSON.stringify(input.variables),
      input.renderedBody,
      status,
      errorReason,
      status === 'SENT' ? (input.channel === 'WHATSAPP' ? 0.85 : input.channel === 'SMS' ? 0.2 : 0.05) : 0,
      caller.auth.userId,
    );

    if (status === 'BLOCKED') {
      throw Errors.validation({ message: errorReason || 'Message blocked' }, errorReason || 'Message blocked');
    }

    return norm(msgRows[0]!);
  }

  async createPaymentLink(
    caller: Caller,
    input: { invoiceId?: string; amount: number; expiresHours?: number },
  ): Promise<Row> {
    const linkId = `plink_${randomBytes(8).toString('hex')}`;
    const shortUrl = `https://rzp.io/i/${linkId}`;
    const expiresAt = new Date(Date.now() + (input.expiresHours ?? 72) * 3600 * 1000);

    const rows = await query(
      prisma,
      `INSERT INTO payment_links (invoice_id, amount, gateway, link_id, short_url, expires_at, created_by_id)
       VALUES ($1::uuid, $2, 'RAZORPAY_TEST', $3, $4, $5::timestamptz, $6::uuid) RETURNING *`,
      input.invoiceId ?? null,
      input.amount,
      linkId,
      shortUrl,
      expiresAt,
      caller.auth.userId,
    );
    return norm(rows[0]!);
  }
}

export const automationCommService = new AutomationCommService();

