// Phase 21 §5.4: Web Push (VAPID via `web-push`) with classic + Apple Declarative Web Push payload,
// TTL / urgency / <=32 char collapse topic, 404/410 auto-revocation, 413 trim retry, and 60d cleanup.
import type * as WebPushNS from 'web-push';
import { env } from '../../config/env';
import { recordAudit } from '../../core/audit/audit-service';
import { prisma } from '../../core/db/prisma';
import { logger } from '../../core/logger';
import { buildCollapseKey } from './notify-calc';

type WebPushMod = typeof WebPushNS;
let webPushModPromise: Promise<WebPushMod> | null = null;
function loadWebPush(): Promise<WebPushMod> {
  // Dynamic ESM import safe under CommonJS compilation in Node 20+
  webPushModPromise ??= Function('return import("web-push")')() as Promise<WebPushMod>;
  return webPushModPromise;
}

export interface PushSenderResult {
  statusCode: number;
  headers?: Record<string, string>;
}

export type PushSendFn = (
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string,
  options: { TTL: number; urgency: 'very-low' | 'low' | 'normal' | 'high'; topic?: string },
) => Promise<PushSenderResult>;

let vapidReady = false;
async function ensureVapidConfigured(): Promise<WebPushMod | null> {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return null;
  const mod = await loadWebPush();
  const wp = (mod as unknown as { default?: WebPushMod }).default ?? mod;
  if (!vapidReady) {
    wp.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
    vapidReady = true;
  }
  return wp;
}

let customPushSender: PushSendFn | null = null;
export function setPushSenderForTests(fn: PushSendFn | null): void {
  customPushSender = fn;
}

const defaultSender: PushSendFn = async (sub, payload, options) => {
  const wp = await ensureVapidConfigured();
  if (!wp) {
    throw Object.assign(new Error('VAPID keys not configured'), { statusCode: 503 });
  }
  const res = await wp.sendNotification(sub, payload, options);
  return { statusCode: res.statusCode, headers: (res.headers as Record<string, string>) ?? {} };
};

export function pushTtlForPriority(priority: string): number {
  if (priority === 'URGENT') return 4 * 3600;
  if (priority === 'HIGH') return 24 * 3600;
  return 72 * 3600;
}

export function pushUrgencyForPriority(priority: string): 'high' | 'normal' | 'low' {
  if (priority === 'URGENT' || priority === 'HIGH') return 'high';
  if (priority === 'LOW') return 'low';
  return 'normal';
}

export function buildPushPayloadJson(input: {
  title: string;
  body: string;
  url: string;
  priority: string;
  badge: number;
  tag?: string;
  declarative?: boolean;
}): string {
  const safeUrl = input.url.startsWith('/') ? input.url : '/notifications';
  const baseObj: Record<string, unknown> = {
    title: input.title.slice(0, 100),
    body: input.body.slice(0, 240),
    url: safeUrl,
    priority: input.priority,
    badge: input.badge,
    tag: input.tag ? buildCollapseKey(input.tag) : undefined,
  };
  if (input.declarative !== false) {
    // Declarative Web Push fields per Apple WWDC25 spec (iOS/iPadOS 18.4+)
    baseObj.web_push = 8030;
    baseObj.notification = {
      title: input.title.slice(0, 100),
      body: input.body.slice(0, 240),
      navigate: safeUrl,
      app_badge: input.badge,
    };
  }
  const encoded = JSON.stringify(baseObj);
  if (Buffer.byteLength(encoded, 'utf8') <= 2048) return encoded;
  baseObj.body = String(baseObj.body).slice(0, 80);
  if (baseObj.notification && typeof baseObj.notification === 'object') {
    (baseObj.notification as Record<string, unknown>).body = baseObj.body;
  }
  return JSON.stringify(baseObj);
}

export const pushService = {
  getPublicKey(): string | null {
    return env.VAPID_PUBLIC_KEY ?? null;
  },

  async subscribe(
    userId: string,
    input: {
      endpoint: string;
      p256dh: string;
      auth: string;
      platform: 'ANDROID' | 'IOS' | 'DESKTOP' | 'OTHER';
      browser: string;
      deviceLabel?: string;
      standalone?: boolean;
    },
  ) {
    const rows = await prisma.$queryRaw<any[]>`
      INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, platform, browser, device_label, standalone, revoked_at, revoke_reason)
      VALUES (${userId}::uuid, ${input.endpoint}, ${input.p256dh}, ${input.auth}, ${input.platform}, ${input.browser},
              ${input.deviceLabel || `${input.platform} ${input.browser}`}, ${Boolean(input.standalone)}, NULL, NULL)
      ON CONFLICT (endpoint) DO UPDATE SET
        user_id = EXCLUDED.user_id,
        p256dh = EXCLUDED.p256dh,
        auth = EXCLUDED.auth,
        platform = EXCLUDED.platform,
        browser = EXCLUDED.browser,
        device_label = EXCLUDED.device_label,
        standalone = EXCLUDED.standalone,
        revoked_at = NULL,
        revoke_reason = NULL,
        failure_count = 0
      RETURNING id, platform, browser, device_label, standalone, created_at, last_success_at
    `;
    return rows[0];
  },

  async listDevices(userId: string) {
    return prisma.$queryRaw<any[]>`
      SELECT id, platform, browser, device_label, standalone, created_at, last_success_at, failure_count
      FROM push_subscriptions
      WHERE user_id = ${userId}::uuid AND revoked_at IS NULL
      ORDER BY created_at DESC
    `;
  },

  async renameDevice(userId: string, id: string, label: string) {
    const rows = await prisma.$queryRaw<any[]>`
      UPDATE push_subscriptions
      SET device_label = ${label}
      WHERE id = ${id}::uuid AND user_id = ${userId}::uuid AND revoked_at IS NULL
      RETURNING id, platform, browser, device_label
    `;
    return rows[0] ?? null;
  },

  async revokeDevice(
    userId: string,
    id: string,
    reason: 'USER' | 'LOGOUT' | 'ADMIN' | 'DEACTIVATED' = 'USER',
    actorId?: string,
  ): Promise<boolean> {
    const res = await prisma.$executeRaw`
      UPDATE push_subscriptions
      SET revoked_at = now(), revoke_reason = ${reason}
      WHERE id = ${id}::uuid AND user_id = ${userId}::uuid AND revoked_at IS NULL
    `;
    if (res > 0 && reason === 'ADMIN' && actorId) {
      await recordAudit({
        action: 'PUSH_DEVICE_REVOKED_BY_ADMIN',
        actorId,
        targetType: 'PushSubscription',
        targetId: id,
        detail: { userId },
      });
    }
    return Number(res) > 0;
  },

  async revokeAllForUser(userId: string, reason: 'LOGOUT' | 'DEACTIVATED' | 'ADMIN'): Promise<number> {
    const res = await prisma.$executeRaw`
      UPDATE push_subscriptions
      SET revoked_at = now(), revoke_reason = ${reason}
      WHERE user_id = ${userId}::uuid AND revoked_at IS NULL
    `;
    return Number(res);
  },

  async revokeByEndpoint(userId: string, endpoint: string, reason: 'LOGOUT' | 'USER' = 'LOGOUT'): Promise<number> {
    const res = await prisma.$executeRaw`
      UPDATE push_subscriptions
      SET revoked_at = now(), revoke_reason = ${reason}
      WHERE user_id = ${userId}::uuid AND endpoint = ${endpoint} AND revoked_at IS NULL
    `;
    return Number(res);
  },

  async drainPushDeliveries(limit = 50): Promise<{ sent: number; failed: number; revoked: number }> {
    const settingRows = await prisma.$queryRaw<{ push_enabled: boolean; push_declarative: boolean }[]>`
      SELECT push_enabled, push_declarative FROM notification_settings WHERE id = 1
    `;
    if (!settingRows[0]?.push_enabled) return { sent: 0, failed: 0, revoked: 0 };
    const declarative = settingRows[0]?.push_declarative ?? true;

    if (!customPushSender && (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY)) {
      return { sent: 0, failed: 0, revoked: 0 };
    }
    const sender = customPushSender ?? defaultSender;

    const jobs = await prisma.$queryRaw<
      {
        id: string;
        user_id: string;
        notification_id: string | null;
        attempts: number;
        payload: any;
      }[]
    >`
      SELECT d.id, d.user_id, d.notification_id, d.attempts, d.payload
      FROM notification_deliveries d
      WHERE d.channel = 'PUSH'
        AND ((d.status = 'QUEUED') OR (d.status = 'HELD' AND d.release_at <= now()))
        AND (d.release_at IS NULL OR d.release_at <= now())
      ORDER BY d.created_at ASC
      LIMIT ${limit}
      FOR UPDATE OF d SKIP LOCKED
    `;

    let sent = 0;
    let failed = 0;
    let revoked = 0;

    for (const job of jobs) {
      const subs = await prisma.$queryRaw<{ id: string; endpoint: string; p256dh: string; auth: string }[]>`
        SELECT id, endpoint, p256dh, auth FROM push_subscriptions
        WHERE user_id = ${job.user_id}::uuid AND revoked_at IS NULL
      `;
      if (subs.length === 0) {
        await prisma.$executeRaw`
          UPDATE notification_deliveries SET status = 'SKIPPED', skip_reason = 'NO_DEVICE' WHERE id = ${job.id}::uuid
        `;
        continue;
      }

      const unreadRow = await prisma.$queryRaw<{ cnt: number }[]>`
        SELECT count(*)::int AS cnt FROM notifications WHERE user_id = ${job.user_id}::uuid AND read_at IS NULL
      `;
      const badge = unreadRow[0]?.cnt ?? 0;
      const meta = job.payload ?? {};
      const priority = String(meta.priority ?? 'NORMAL');
      const topic = meta.collapseKey ? buildCollapseKey(String(meta.collapseKey)) : undefined;
      let payloadStr = buildPushPayloadJson({
        title: String(meta.title ?? 'Sawant Group ERP'),
        body: String(meta.body ?? ''),
        url: String(meta.link ?? '/notifications'),
        priority,
        badge,
        tag: topic,
        declarative,
      });

      let anyOk = false;
      let lastError: string | null = null;
      let retryAfterSec = 0;

      for (const sub of subs) {
        try {
          await sender(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payloadStr,
            {
              TTL: pushTtlForPriority(priority),
              urgency: pushUrgencyForPriority(priority),
              ...(topic ? { topic } : {}),
            },
          );
          anyOk = true;
          await prisma.$executeRaw`
            UPDATE push_subscriptions SET last_success_at = now(), failure_count = 0 WHERE id = ${sub.id}::uuid
          `;
        } catch (err: any) {
          const status = Number(err?.statusCode ?? 0);
          if (status === 404 || status === 410) {
            await prisma.$executeRaw`
              UPDATE push_subscriptions SET revoked_at = now(), revoke_reason = 'GONE_410' WHERE id = ${sub.id}::uuid
            `;
            revoked += 1;
          } else if (status === 413) {
            // Trim body & retry once per §5.4
            payloadStr = buildPushPayloadJson({
              title: String(meta.title ?? 'Sawant Group ERP'),
              body: '',
              url: '/notifications',
              priority,
              badge,
              declarative: false,
            });
            try {
              await sender(
                { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
                payloadStr,
                { TTL: pushTtlForPriority(priority), urgency: pushUrgencyForPriority(priority) },
              );
              anyOk = true;
            } catch (err2: any) {
              lastError = String(err2?.message ?? '413 retry failed');
            }
          } else if (status === 429 || status >= 500) {
            const ra = Number(err?.headers?.['retry-after'] ?? 0);
            retryAfterSec = Number.isFinite(ra) && ra > 0 ? ra : 0;
            lastError = `HTTP ${status}: ${err?.message ?? 'Push service transient error'}`;
            await prisma.$executeRaw`
              UPDATE push_subscriptions SET failure_count = failure_count + 1 WHERE id = ${sub.id}::uuid
            `;
          } else {
            lastError = String(err?.message ?? 'Push delivery error');
          }
        }
      }

      if (anyOk) {
        await prisma.$executeRaw`
          UPDATE notification_deliveries SET status = 'SENT', sent_at = now(), attempts = attempts + 1 WHERE id = ${job.id}::uuid
        `;
        sent += 1;
      } else if (lastError) {
        const nextAttempt = job.attempts + 1;
        const backoffMin = nextAttempt === 1 ? 1 : nextAttempt === 2 ? 5 : 30;
        const delayMs = retryAfterSec > 0 ? retryAfterSec * 1000 : backoffMin * 60_000;
        if (nextAttempt >= 4) {
          await prisma.$executeRaw`
            UPDATE notification_deliveries SET status = 'FAILED', error = ${lastError}, attempts = ${nextAttempt} WHERE id = ${job.id}::uuid
          `;
          failed += 1;
        } else {
          const nextTime = new Date(Date.now() + delayMs);
          await prisma.$executeRaw`
            UPDATE notification_deliveries SET status = 'QUEUED', release_at = ${nextTime}, error = ${lastError}, attempts = ${nextAttempt} WHERE id = ${job.id}::uuid
          `;
        }
      } else {
        await prisma.$executeRaw`
          UPDATE notification_deliveries SET status = 'SKIPPED', skip_reason = 'NO_DEVICE' WHERE id = ${job.id}::uuid
        `;
      }
    }

    if (failed + sent >= 5 && failed / Math.max(1, sent + failed) > 0.2) {
      logger.warn({ sent, failed }, 'Push failure rate > 20% alert');
    }
    return { sent, failed, revoked };
  },

  async cleanupStaleSubscriptions(): Promise<number> {
    const res = await prisma.$executeRaw`
      UPDATE push_subscriptions
      SET revoked_at = now(), revoke_reason = 'GONE_410'
      WHERE revoked_at IS NULL
        AND COALESCE(last_success_at, created_at) < now() - interval '60 days'
    `;
    return Number(res);
  },
};

