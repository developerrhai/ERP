// NotificationService v2 (Phase 5 + Phase 21 §5.2/§5.5).
// notify() executes inside caller's transaction `tx` so rolled-back actions never emit
// notifications, outbox deliveries, or pg_notify('erp_rt') SSE signals.
import type { Prisma } from '@prisma/client';
import { recordAudit } from '../../core/audit/audit-service';
import { prisma, type Db } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { companyName, queueEmail, renderDigest, renderEmail } from './email';
import {
  buildCollapseKey,
  decideChannels,
  type DeliverySkipReason,
  type NotificationGlobalSettings,
  type NotificationTypeConfig,
  type NotifyCategory,
  type NotifyChannel,
  type NotifyPriority,
  type UserChannelPrefInput,
} from './notify-calc';
import { emitRealtimeNotify } from './realtime';
import { NOTIFICATION_TYPES, notificationTypeDef, typesOfGroup } from './types';
import type { EmailMode, NotificationGroup, NotifyInput } from './types';

export interface NotificationDto {
  id: string;
  type: string;
  typeCode: string | null;
  category?: NotifyCategory;
  priority: NotifyPriority;
  severity: string;
  title: string;
  body: string;
  link: string | null;
  entityType: string | null;
  entityId: string | null;
  collapseKey?: string | null;
  broadcastId?: string | null;
  seq?: string;
  seenAt?: string | null;
  archivedAt?: string | null;
  createdAt: string;
  readAt: string | null;
}

export interface PreferenceDto {
  type: string;
  label: string;
  description: string;
  group: NotificationGroup;
  inApp: boolean;
  inAppLocked: boolean;
  email: EmailMode;
}

export interface NotificationTypeRowDto {
  code: string;
  module: string;
  category: NotifyCategory;
  label: string;
  labelHi: string;
  priority: NotifyPriority;
  enabled: boolean;
  allowedChannels: NotifyChannel[];
  defaultChannels: NotifyChannel[];
  mandatoryChannels: NotifyChannel[];
  sensitive: boolean;
  digestAllowed: boolean;
  deepLinkTpl: string;
  collapseKeyTpl: string | null;
}

export interface NotificationSettingsAdminDto {
  emailEnabled: boolean;
  pushEnabled: boolean;
  smsEnabled: boolean;
  marketingPaused: boolean;
  quietStart: string;
  quietEnd: string;
  pushMaxPerUserHour: number;
  digestTime: string;
  retentionDays: number;
  broadcastApprovalThresholdUsers: number;
  sseMaxStreamsPerUser: number;
  pushDeclarative: boolean;
}

interface RawNotifRow {
  id: string;
  type: string;
  type_code: string | null;
  category: NotifyCategory | null;
  priority: NotifyPriority | null;
  severity: string;
  title: string;
  body: string;
  link: string | null;
  entity_type: string | null;
  entity_id: string | null;
  collapse_key: string | null;
  broadcast_id: string | null;
  seq: bigint | number | null;
  seen_at: Date | null;
  archived_at: Date | null;
  created_at: Date;
  read_at: Date | null;
}

function toDto(r: {
  id: string;
  type: string;
  typeCode?: string | null;
  category?: NotifyCategory;
  priority?: NotifyPriority;
  severity: string;
  title: string;
  body: string;
  link: string | null;
  entityType: string | null;
  entityId: string | null;
  collapseKey?: string | null;
  broadcastId?: string | null;
  seq?: bigint | number | null;
  seenAt?: Date | null;
  archivedAt?: Date | null;
  createdAt: Date;
  readAt: Date | null;
}): NotificationDto {
  return {
    id: r.id,
    type: r.type,
    typeCode: r.typeCode ?? r.type,
    category: r.category,
    priority: r.priority ?? 'NORMAL',
    severity: r.severity,
    title: r.title,
    body: r.body,
    link: r.link,
    entityType: r.entityType,
    entityId: r.entityId,
    collapseKey: r.collapseKey ?? null,
    broadcastId: r.broadcastId ?? null,
    seq: r.seq !== undefined && r.seq !== null ? String(r.seq) : undefined,
    seenAt: r.seenAt ? r.seenAt.toISOString() : null,
    archivedAt: r.archivedAt ? r.archivedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
    readAt: r.readAt ? r.readAt.toISOString() : null,
  };
}

function mapRawToDto(r: RawNotifRow): NotificationDto {
  return toDto({
    id: r.id,
    type: r.type,
    typeCode: r.type_code ?? r.type,
    category: r.category ?? undefined,
    priority: r.priority ?? 'NORMAL',
    severity: r.severity,
    title: r.title,
    body: r.body,
    link: r.link,
    entityType: r.entity_type,
    entityId: r.entity_id,
    collapseKey: r.collapse_key,
    broadcastId: r.broadcast_id,
    seq: r.seq,
    seenAt: r.seen_at,
    archivedAt: r.archived_at,
    createdAt: r.created_at,
    readAt: r.read_at,
  });
}

function mapSkipReasonForDb(reason: DeliverySkipReason | undefined): string | null {
  if (!reason) return null;
  if (reason === 'CHANNEL_NOT_ALLOWED') return 'TYPE_OFF';
  return reason;
}

function mapCategoryFromLegacyGroup(group: NotificationGroup): NotifyCategory {
  if (group === 'Approvals') return 'APPROVAL';
  return 'ALERT';
}

function renderSimpleTpl(tpl: string, entityId?: string | null): string {
  if (!entityId) return tpl.replace(':{{entityId}}', '').replace('{{entityId}}', '');
  return tpl.replace(/\{\{entityId\}\}/g, entityId);
}

async function loadTypeConfig(tx: Db, typeCode: string): Promise<{
  cfg: NotificationTypeConfig;
  inDb: boolean;
  collapseKeyTpl: string | null;
  deepLinkTpl: string;
} | null> {
  // unpaginated: system fan-out/queue worker: must visit every eligible row, runs in a job in batches or per event
  const rows = await tx.$queryRaw<
    {
      code: string;
      category: NotifyCategory;
      priority: NotifyPriority;
      enabled: boolean;
      allowed_channels: string[];
      default_channels: string[];
      mandatory_channels: string[];
      sensitive: boolean;
      digest_allowed: boolean;
      deep_link_tpl: string;
      collapse_key_tpl: string | null;
    }[]
  >`
    SELECT code, category, priority, enabled, allowed_channels, default_channels,
           mandatory_channels, sensitive, digest_allowed, deep_link_tpl, collapse_key_tpl
    FROM notification_types
    WHERE code = ${typeCode}
  `;
  if (rows.length > 0 && rows[0]) {
    const r = rows[0];
    return {
      cfg: {
        code: r.code,
        category: r.category,
        priority: r.priority,
        enabled: r.enabled,
        allowedChannels: r.allowed_channels as NotifyChannel[],
        defaultChannels: r.default_channels as NotifyChannel[],
        mandatoryChannels: r.mandatory_channels as NotifyChannel[],
        sensitive: r.sensitive,
        digestAllowed: r.digest_allowed,
      },
      inDb: true,
      collapseKeyTpl: r.collapse_key_tpl,
      deepLinkTpl: r.deep_link_tpl,
    };
  }
  const legacy = notificationTypeDef(typeCode);
  if (!legacy) return null;
  return {
    cfg: {
      code: legacy.type,
      category: mapCategoryFromLegacyGroup(legacy.group),
      priority: legacy.severity === 'ACTION' ? 'HIGH' : legacy.severity === 'WARN' ? 'HIGH' : 'NORMAL',
      enabled: true,
      allowedChannels: ['IN_APP', 'PUSH', 'EMAIL'],
      defaultChannels: ['IN_APP', 'EMAIL'],
      mandatoryChannels: legacy.inAppLocked ? ['IN_APP'] : [],
      sensitive: false,
      digestAllowed: true,
    },
    inDb: false,
    collapseKeyTpl: null,
    deepLinkTpl: '/notifications',
  };
}

async function loadGlobalSettings(tx: Db): Promise<NotificationGlobalSettings> {
  // unpaginated: system fan-out/queue worker: must visit every eligible row, runs in a job in batches or per event
  const rows = await tx.$queryRaw<
    {
      email_enabled: boolean;
      push_enabled: boolean;
      sms_enabled: boolean;
      quiet_start: string;
      quiet_end: string;
      push_max_per_user_hour: number;
    }[]
  >`
    SELECT email_enabled, push_enabled, sms_enabled, quiet_start, quiet_end, push_max_per_user_hour
    FROM notification_settings
    WHERE id = 1
  `;
  const r = rows[0];
  if (!r) {
    return {
      emailEnabled: true,
      pushEnabled: true,
      smsEnabled: true,
      quietStart: '22:00',
      quietEnd: '07:00',
      pushMaxPerUserHour: 20,
    };
  }
  return {
    emailEnabled: r.email_enabled,
    pushEnabled: r.push_enabled,
    smsEnabled: r.sms_enabled,
    quietStart: r.quiet_start,
    quietEnd: r.quiet_end,
    pushMaxPerUserHour: r.push_max_per_user_hour,
  };
}

const ALL_CHANNELS: readonly NotifyChannel[] = ['IN_APP', 'PUSH', 'EMAIL', 'SMS'];

export const notificationService = {
  /**
   * Delivers one notification to each active user (deduplicated per user by dedupeKey).
   * Runs inside `tx` so rolled-back callers emit zero notifications, deliveries, or SSE events.
   */
  async notify(
    tx: Db,
    userIds: readonly string[],
    input: NotifyInput & {
      priority?: NotifyPriority;
      collapseKey?: string;
      broadcastId?: string;
      expiresAt?: Date;
      now?: Date;
    },
  ): Promise<string[]> {
    const typeInfo = await loadTypeConfig(tx, input.type);
    if (!typeInfo) throw new Error(`Unknown notification type ${input.type}`);

    const unique = [...new Set(userIds)];
    if (unique.length === 0) return [];

    const users = await tx.user.findMany({
      where: { id: { in: unique }, status: 'ACTIVE' },
      select: { id: true, email: true },
    });
    if (users.length === 0) return [];

    const uidList = users.map((u) => u.id);
    const [legacyPrefs, v2Prefs, userSettingsRows, pushCounts, empMobiles, pushHourCounts, suppressedRows, settings] =
      await Promise.all([
        // unpaginated: rows named by an id list
        tx.notificationPreference.findMany({
          where: { userId: { in: uidList }, type: input.type },
        }),
        // unpaginated: system fan-out/queue worker: must visit every eligible row, runs in a job in batches or per event
        tx.$queryRaw<{ user_id: string; channel: NotifyChannel; enabled: boolean; mode: 'IMMEDIATE' | 'DIGEST' }[]>`
          SELECT user_id::text AS user_id, channel, enabled, mode
          FROM user_notification_prefs
          WHERE user_id = ANY(${uidList}::uuid[]) AND type_code = ${input.type}
        `,
        // unpaginated: system fan-out/queue worker: must visit every eligible row, runs in a job in batches or per event
        tx.$queryRaw<{ user_id: string; quiet_start: string | null; quiet_end: string | null }[]>`
          SELECT user_id::text AS user_id, quiet_start, quiet_end
          FROM user_notification_settings
          WHERE user_id = ANY(${uidList}::uuid[])
        `,
        // unpaginated: system fan-out/queue worker: must visit every eligible row, runs in a job in batches or per event
        tx.$queryRaw<{ user_id: string; cnt: number }[]>`
          SELECT user_id::text AS user_id, count(*)::int AS cnt
          FROM push_subscriptions
          WHERE user_id = ANY(${uidList}::uuid[]) AND revoked_at IS NULL
          GROUP BY user_id
        `,
        // unpaginated: system fan-out/queue worker: must visit every eligible row, runs in a job in batches or per event
        tx.$queryRaw<{ user_id: string; mobile: string | null }[]>`
          SELECT user_id::text AS user_id, mobile
          FROM employees
          WHERE user_id = ANY(${uidList}::uuid[]) AND deleted_at IS NULL AND status = 'ACTIVE'
        `,
        // unpaginated: system fan-out/queue worker: must visit every eligible row, runs in a job in batches or per event
        tx.$queryRaw<{ user_id: string; cnt: number }[]>`
          SELECT user_id::text AS user_id, count(*)::int AS cnt
          FROM notification_deliveries
          WHERE user_id = ANY(${uidList}::uuid[])
            AND channel = 'PUSH'
            AND status IN ('QUEUED', 'SENT', 'DELIVERED')
            AND created_at >= now() - interval '1 hour'
          GROUP BY user_id
        `,
        // unpaginated: system fan-out/queue worker: must visit every eligible row, runs in a job in batches or per event
        tx.$queryRaw<{ email_norm: string }[]>`
          SELECT email_norm
          FROM email_suppressions
          WHERE removed_at IS NULL
            AND email_norm = ANY(${users.map((u) => (u.email ?? '').toLowerCase()).filter(Boolean)}::text[])
        `,
        loadGlobalSettings(tx),
      ]);

    const legacyPrefOf = new Map(legacyPrefs.map((p) => [p.userId, p]));
    const v2PrefsByUser = new Map<string, Partial<Record<NotifyChannel, UserChannelPrefInput>>>();
    for (const row of v2Prefs) {
      const m = v2PrefsByUser.get(row.user_id) ?? {};
      m[row.channel] = { enabled: row.enabled, mode: row.mode };
      v2PrefsByUser.set(row.user_id, m);
    }
    const userSettingsOf = new Map(userSettingsRows.map((s) => [s.user_id, s]));
    const pushCountOf = new Map(pushCounts.map((c) => [c.user_id, c.cnt]));
    const mobileOf = new Map(empMobiles.map((e) => [e.user_id, e.mobile]));
    const pushHourOf = new Map(pushHourCounts.map((c) => [c.user_id, c.cnt]));
    const suppressedEmails = new Set(suppressedRows.map((s) => s.email_norm.toLowerCase()));

    const company = await companyName(tx);
    const now = input.now ?? new Date();
    const legacyDef = notificationTypeDef(input.type);
    const effectiveMandatory =
      legacyDef && !legacyDef.inAppLocked
        ? typeInfo.cfg.mandatoryChannels.filter((c) => c !== 'IN_APP')
        : typeInfo.cfg.mandatoryChannels;
    const effectiveTypeCfg: NotificationTypeConfig = {
      ...typeInfo.cfg,
      mandatoryChannels: effectiveMandatory,
      ...(input.priority ? { priority: input.priority } : {}),
    };
    const rawCollapseKey =
      input.collapseKey ??
      (typeInfo.collapseKeyTpl ? renderSimpleTpl(typeInfo.collapseKeyTpl, input.entityId) : null);
    const collapseKey = rawCollapseKey ? buildCollapseKey(rawCollapseKey) : null;
    const severity: 'INFO' | 'ACTION' | 'WARN' =
      input.severity ??
      legacyDef?.severity ??
      (effectiveTypeCfg.priority === 'URGENT' || effectiveTypeCfg.priority === 'HIGH' ? 'WARN' : 'INFO');

    const delivered: string[] = [];
    const createdNotifIds: string[] = [];

    for (const user of users) {
      const legPref = legacyPrefOf.get(user.id);
      const v2Map = { ...(v2PrefsByUser.get(user.id) ?? {}) };
      // Honour legacy Phase 5 prefs cleanly unless Phase 21 v2 prefs already explicitly set the channel
      if (legPref) {
        if (!v2Map.IN_APP) {
          v2Map.IN_APP = { enabled: legPref.inApp };
        }
        if (!v2Map.EMAIL) {
          if (legPref.email === 'OFF') v2Map.EMAIL = { enabled: false };
          else if (legPref.email === 'DIGEST') v2Map.EMAIL = { enabled: true, mode: 'DIGEST' };
          else v2Map.EMAIL = { enabled: true, mode: 'IMMEDIATE' };
        }
      }

      const uSet = userSettingsOf.get(user.id);
      const decisions = decideChannels(
        effectiveTypeCfg,
        {
          quietStart: uSet?.quiet_start ?? undefined,
          quietEnd: uSet?.quiet_end ?? undefined,
          recentPushCountLastHour: pushHourOf.get(user.id) ?? 0,
          prefsByChannel: v2Map,
        },
        settings,
        now,
        {
          pushDeviceCount: pushCountOf.get(user.id) ?? 0,
          email: user.email,
          emailSuppressed: user.email ? suppressedEmails.has(user.email.toLowerCase()) : false,
          mobile: mobileOf.get(user.id) ?? null,
          smsConsent: true,
        },
      );

      let createdRowId: string | null = null;
      if (decisions.IN_APP.status === 'QUEUED') {
        const created = await tx.notification.createManyAndReturn({
          select: { id: true },
          data: [
            {
              userId: user.id,
              type: input.type,
              severity,
              title: input.title.slice(0, 200),
              body: (input.body ?? '').slice(0, 1000),
              link: input.link ?? null,
              entityType: input.entityType ?? null,
              entityId: input.entityId ?? null,
              dedupeKey: input.dedupeKey ?? null,
            },
          ],
          skipDuplicates: true,
        });
        if (!created[0]) {
          // Duplicate via dedupeKey -> do not duplicate outbox deliveries either
          continue;
        }
        createdRowId = created[0].id;
        createdNotifIds.push(createdRowId);
        delivered.push(user.id);

        await tx.$executeRaw`
          UPDATE notifications
          SET type_code = ${typeInfo.inDb ? input.type : null},
              priority = ${effectiveTypeCfg.priority},
              collapse_key = ${collapseKey},
              broadcast_id = ${input.broadcastId ?? null}::uuid,
              expires_at = ${input.expiresAt ?? null}
          WHERE id = ${createdRowId}::uuid
        `;
      }

      if (typeInfo.inDb) {
        for (const ch of ALL_CHANNELS) {
          if (!effectiveTypeCfg.allowedChannels.includes(ch) && ch !== 'IN_APP') continue;
          const dec = decisions[ch];
          const dbStatus = dec.status === 'SUMMARY_COLLAPSED' ? 'SKIPPED' : dec.status;
          const dbSkip = mapSkipReasonForDb(dec.reason);
          const safeTitle = effectiveTypeCfg.sensitive && ch === 'PUSH' ? 'Sawant ERP Confidential Alert' : input.title.slice(0, 100);
          const safeBody = effectiveTypeCfg.sensitive && ch === 'PUSH' ? 'Open Sawant ERP to view details.' : (input.body ?? '').slice(0, 240);
          const payloadJson = JSON.stringify({
            title: safeTitle,
            body: safeBody,
            link: input.link ?? typeInfo.deepLinkTpl ?? '/notifications',
            priority: effectiveTypeCfg.priority,
            collapseKey,
            sensitive: effectiveTypeCfg.sensitive,
          });
          await tx.$executeRaw`
            INSERT INTO notification_deliveries
              (notification_id, user_id, type_code, channel, status, skip_reason, release_at, payload, sent_at)
            VALUES (
              ${createdRowId}::uuid,
              ${user.id}::uuid,
              ${input.type},
              ${ch},
              ${dbStatus},
              ${dbSkip},
              ${dec.releaseAt ?? null},
              ${payloadJson}::jsonb,
              ${ch === 'IN_APP' && dbStatus === 'QUEUED' ? now : null}
            )
          `;
        }
      }

      // Queue instant transactional notification email when EMAIL channel decision is QUEUED
      if (decisions.EMAIL.status === 'QUEUED' && user.email) {
        const content = renderEmail(company, {
          title: effectiveTypeCfg.sensitive ? 'New secure document available' : input.title,
          body: effectiveTypeCfg.sensitive ? 'Sign in to Sawant ERP to view your notification.' : (input.body ?? ''),
          link: input.link ?? null,
          docCode: input.docCode ?? null,
          amount: input.amount ?? null,
        });
        await queueEmail(tx, user.email, `${company}: ${input.title}`, content);
        if (createdRowId) {
          await tx.notification.update({
            where: { id: createdRowId },
            data: { emailedAt: now },
          });
        }
      }
    }

    if (delivered.length > 0) {
      // Batched in chunks of <= 500 users so NOTIFY JSON stays well below PostgreSQL 8000-byte limit
      for (let i = 0; i < delivered.length; i += 400) {
        const chunk = delivered.slice(i, i + 400);
        await emitRealtimeNotify(tx, {
          u: chunk,
          k: 'n',
          ids: createdNotifIds.slice(i, i + 400),
        });
      }
    }

    return delivered;
  },

  /** Active users whose role level is at least `minLevel` (Administrators = 95). */
  async usersAtLevel(tx: Db, minLevel: number): Promise<string[]> {
    // unpaginated: system fan-out/queue worker: must visit every eligible row, runs in a job in batches or per event
    const users = await tx.user.findMany({
      where: { status: 'ACTIVE', role: { level: { gte: minLevel } } },
      select: { id: true },
    });
    return users.map((u) => u.id);
  },

  /** Phase 5 page-based listing (kept for backward compatibility). */
  async list(
    userId: string,
    query: {
      unread?: boolean;
      type?: string;
      group?: NotificationGroup;
      page: number;
      size: number;
    },
  ): Promise<{ rows: NotificationDto[]; total: number; unread: number }> {
    const where: Prisma.NotificationWhereInput = {
      userId,
      ...(query.unread ? { readAt: null } : {}),
      ...(query.type
        ? { type: query.type }
        : query.group
          ? { type: { in: typesOfGroup(query.group) } }
          : {}),
    };
    const [rows, total, unread] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.size,
        take: query.size,
      }),
      prisma.notification.count({ where }),
      prisma.notification.count({ where: { userId, readAt: null } }),
    ]);
    return { rows: rows.map((r) => toDto(r)), total, unread };
  },

  /** Phase 21 §5.2 cursor-based feed (category filter, archived hidden, expired hidden). */
  async listCursor(
    userId: string,
    opts: {
      unread?: boolean;
      category?: NotifyCategory;
      type?: string;
      cursor?: string;
      limit?: number;
      includeArchived?: boolean;
    },
  ): Promise<{ rows: NotificationDto[]; nextCursor: string | null; unread: number }> {
    const limit = Math.min(Math.max(1, opts.limit ?? 20), 100);
    const cursorSeq = opts.cursor && /^\d+$/.test(opts.cursor) ? BigInt(opts.cursor) : null;

    const rows = await prisma.$queryRaw<RawNotifRow[]>`
      SELECT n.id, n.type, n.type_code, nt.category, n.priority, n.severity,
             n.title, n.body, n.link, n.entity_type, n.entity_id,
             n.collapse_key, n.broadcast_id, n.seq, n.seen_at, n.archived_at,
             n.created_at, n.read_at
      FROM notifications n
      LEFT JOIN notification_types nt ON nt.code = COALESCE(n.type_code, n.type)
      WHERE n.user_id = ${userId}::uuid
        AND (${opts.includeArchived ? true : false} OR n.archived_at IS NULL)
        AND (n.expires_at IS NULL OR n.expires_at > now())
        AND (${opts.unread ? true : false} = false OR n.read_at IS NULL)
        AND (${opts.type ?? null}::varchar IS NULL OR COALESCE(n.type_code, n.type) = ${opts.type ?? null})
        AND (${opts.category ?? null}::varchar IS NULL OR nt.category = ${opts.category ?? null})
        AND (${cursorSeq}::bigint IS NULL OR n.seq < ${cursorSeq})
      ORDER BY n.seq DESC
      LIMIT ${limit + 1}
    `;

    const hasMore = rows.length > limit;
    const slice = hasMore ? rows.slice(0, limit) : rows;
    const last = slice[slice.length - 1];
    const nextCursor = hasMore && last?.seq !== null && last?.seq !== undefined ? String(last.seq) : null;
    const unread = await this.unreadCount(userId);
    return { rows: slice.map(mapRawToDto), nextCursor, unread };
  },

  async unreadCount(userId: string): Promise<number> {
    const rows = await prisma.$queryRaw<{ cnt: number }[]>`
      SELECT count(*)::int AS cnt
      FROM notifications
      WHERE user_id = ${userId}::uuid
        AND read_at IS NULL
        AND archived_at IS NULL
        AND (expires_at IS NULL OR expires_at > now())
    `;
    return rows[0]?.cnt ?? 0;
  },

  /** 404 for another user's item (never reveals that it exists). */
  async markRead(userId: string, id: string): Promise<NotificationDto> {
    const row = await prisma.notification.findFirst({ where: { id, userId } });
    if (!row) throw Errors.notFound('Notification not found.');
    if (row.readAt) return toDto(row);
    const updated = await prisma.notification.update({ where: { id }, data: { readAt: new Date() } });
    await emitRealtimeNotify(prisma, { u: [userId], k: 'r', ids: [id] });
    return toDto(updated);
  },

  async markSeen(userId: string, upToSeq?: string): Promise<number> {
    const seqBig = upToSeq && /^\d+$/.test(upToSeq) ? BigInt(upToSeq) : null;
    const res = await prisma.$executeRaw`
      UPDATE notifications
      SET seen_at = COALESCE(seen_at, now())
      WHERE user_id = ${userId}::uuid
        AND seen_at IS NULL
        AND (${seqBig}::bigint IS NULL OR seq <= ${seqBig})
    `;
    return Number(res);
  },

  async archiveNotification(userId: string, id: string): Promise<void> {
    const res = await prisma.$executeRaw`
      UPDATE notifications
      SET archived_at = COALESCE(archived_at, now()),
          read_at = COALESCE(read_at, now())
      WHERE id = ${id}::uuid AND user_id = ${userId}::uuid
    `;
    if (Number(res) === 0) throw Errors.notFound('Notification not found.');
    await emitRealtimeNotify(prisma, { u: [userId], k: 'r', ids: [id] });
  },

  async readAll(userId: string): Promise<number> {
    const r = await prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    if (r.count > 0) {
      await emitRealtimeNotify(prisma, { u: [userId], k: 'r' });
    }
    return r.count;
  },

  async preferences(userId: string): Promise<PreferenceDto[]> {
    // unpaginated: system fan-out/queue worker: must visit every eligible row, runs in a job in batches or per event
    const rows = await prisma.notificationPreference.findMany({ where: { userId } });
    const byType = new Map(rows.map((r) => [r.type, r]));
    return NOTIFICATION_TYPES.map((t) => {
      const p = byType.get(t.type);
      return {
        type: t.type,
        label: t.label,
        description: t.description,
        group: t.group,
        inApp: t.inAppLocked ? true : (p?.inApp ?? true),
        inAppLocked: t.inAppLocked,
        email: (p?.email ?? 'INSTANT') as EmailMode,
      };
    });
  },

  async savePreferences(
    userId: string,
    items: readonly { type: string; inApp: boolean; email: EmailMode }[],
  ): Promise<PreferenceDto[]> {
    const fields: Record<string, string> = {};
    for (const item of items) {
      const def = notificationTypeDef(item.type);
      if (!def) fields[item.type] = 'Unknown notification type.';
      else if (def.inAppLocked && !item.inApp) {
        fields[item.type] =
          'In-app notifications for approvals waiting on you cannot be turned off.';
      }
    }
    if (Object.keys(fields).length > 0) throw Errors.validation(fields);
    await prisma.$transaction(
      items.map((item) =>
        prisma.notificationPreference.upsert({
          where: { userId_type: { userId, type: item.type } },
          create: { userId, type: item.type, inApp: item.inApp, email: item.email },
          update: { inApp: item.inApp, email: item.email },
        }),
      ),
    );
    return this.preferences(userId);
  },

  /** Phase 21 §5.5: User channel preferences matrix across all 38 notification types. */
  async getPrefsV2(userId: string) {
    const [types, userPrefs] = await Promise.all([
      this.listTypesAdmin(),
      // unpaginated: system fan-out/queue worker: must visit every eligible row, runs in a job in batches or per event
      prisma.$queryRaw<{ type_code: string; channel: NotifyChannel; enabled: boolean; mode: 'IMMEDIATE' | 'DIGEST' }[]>`
        SELECT type_code, channel, enabled, mode
        FROM user_notification_prefs
        WHERE user_id = ${userId}::uuid
      `,
    ]);
    const prefMap = new Map(userPrefs.map((p) => [`${p.type_code}:${p.channel}`, p]));
    return types.map((t) => {
      const channels = {} as Record<NotifyChannel, { allowed: boolean; mandatory: boolean; enabled: boolean; mode: 'IMMEDIATE' | 'DIGEST' }>;
      for (const ch of ALL_CHANNELS) {
        const allowed = t.allowedChannels.includes(ch);
        const mandatory = t.mandatoryChannels.includes(ch);
        const stored = prefMap.get(`${t.code}:${ch}`);
        const enabled = mandatory ? true : (stored ? stored.enabled : t.defaultChannels.includes(ch));
        channels[ch] = {
          allowed,
          mandatory,
          enabled,
          mode: stored?.mode ?? 'IMMEDIATE',
        };
      }
      return {
        code: t.code,
        module: t.module,
        category: t.category,
        label: t.label,
        labelHi: t.labelHi,
        priority: t.priority,
        enabled: t.enabled,
        digestAllowed: t.digestAllowed,
        channels,
      };
    });
  },

  async savePrefsV2(
    userId: string,
    items: readonly {
      typeCode: string;
      channel: NotifyChannel;
      enabled: boolean;
      mode?: 'IMMEDIATE' | 'DIGEST';
    }[],
  ) {
    const types = await this.listTypesAdmin();
    const byCode = new Map(types.map((t) => [t.code, t]));
    const errors: Record<string, string> = {};

    for (const item of items) {
      const t = byCode.get(item.typeCode);
      if (!t) {
        errors[item.typeCode] = 'Unknown notification type.';
        continue;
      }
      if (t.mandatoryChannels.includes(item.channel) && !item.enabled) {
        errors[`${item.typeCode}:${item.channel}`] = `${item.channel} is mandatory for ${t.label} and cannot be disabled.`;
      }
      if (!t.allowedChannels.includes(item.channel) && item.enabled) {
        errors[`${item.typeCode}:${item.channel}`] = `${item.channel} is not supported for ${t.label}.`;
      }
    }
    if (Object.keys(errors).length > 0) throw Errors.validation(errors);

    await prisma.$transaction(async (tx) => {
      for (const item of items) {
        const mode = item.mode ?? 'IMMEDIATE';
        await tx.$executeRaw`
          INSERT INTO user_notification_prefs (user_id, type_code, channel, enabled, mode)
          VALUES (${userId}::uuid, ${item.typeCode}, ${item.channel}, ${item.enabled}, ${mode})
          ON CONFLICT (user_id, type_code, channel) DO UPDATE SET
            enabled = EXCLUDED.enabled,
            mode = EXCLUDED.mode
        `;
      }
    });
    return this.getPrefsV2(userId);
  },

  async getUserSettingsV2(userId: string) {
    const [uRows, g] = await Promise.all([
      // unpaginated: system fan-out/queue worker: must visit every eligible row, runs in a job in batches or per event
      prisma.$queryRaw<
        {
          quiet_start: string | null;
          quiet_end: string | null;
          digest_enabled: boolean;
          language: 'en' | 'hi';
          soft_ask_dismissed_at: Date | null;
        }[]
      >`
        SELECT quiet_start, quiet_end, digest_enabled, language, soft_ask_dismissed_at
        FROM user_notification_settings
        WHERE user_id = ${userId}::uuid
      `,
      this.getSettingsAdmin(),
    ]);
    const u = uRows[0];
    return {
      quietStart: u?.quiet_start ?? g.quietStart,
      quietEnd: u?.quiet_end ?? g.quietEnd,
      quietCustomised: Boolean(u?.quiet_start || u?.quiet_end),
      digestEnabled: u?.digest_enabled ?? true,
      language: u?.language ?? 'en',
      softAskDismissedAt: u?.soft_ask_dismissed_at ? u.soft_ask_dismissed_at.toISOString() : null,
    };
  },

  async saveUserSettingsV2(
    userId: string,
    patch: {
      quietStart?: string | null;
      quietEnd?: string | null;
      digestEnabled?: boolean;
      language?: 'en' | 'hi';
      dismissSoftAsk?: boolean;
    },
  ) {
    // unpaginated: system fan-out/queue worker: must visit every eligible row, runs in a job in batches or per event
    const current = await prisma.$queryRaw<{ user_id: string }[]>`
      SELECT user_id FROM user_notification_settings WHERE user_id = ${userId}::uuid
    `;
    const hmRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
    if (patch.quietStart && !hmRegex.test(patch.quietStart)) {
      throw Errors.validation({ quietStart: 'Use HH:MM 24-hour format' });
    }
    if (patch.quietEnd && !hmRegex.test(patch.quietEnd)) {
      throw Errors.validation({ quietEnd: 'Use HH:MM 24-hour format' });
    }
    if (current.length === 0) {
      await prisma.$executeRaw`
        INSERT INTO user_notification_settings (user_id, quiet_start, quiet_end, digest_enabled, language, soft_ask_dismissed_at)
        VALUES (
          ${userId}::uuid,
          ${patch.quietStart ?? null},
          ${patch.quietEnd ?? null},
          ${patch.digestEnabled ?? true},
          ${patch.language ?? 'en'},
          ${patch.dismissSoftAsk ? new Date() : null}
        )
      `;
    } else {
      await prisma.$executeRaw`
        UPDATE user_notification_settings
        SET quiet_start = CASE WHEN ${patch.quietStart !== undefined} THEN ${patch.quietStart ?? null} ELSE quiet_start END,
            quiet_end = CASE WHEN ${patch.quietEnd !== undefined} THEN ${patch.quietEnd ?? null} ELSE quiet_end END,
            digest_enabled = COALESCE(${patch.digestEnabled ?? null}, digest_enabled),
            language = COALESCE(${patch.language ?? null}, language),
            soft_ask_dismissed_at = CASE WHEN ${patch.dismissSoftAsk === true} THEN now() ELSE soft_ask_dismissed_at END,
            updated_at = now()
        WHERE user_id = ${userId}::uuid
      `;
    }
    return this.getUserSettingsV2(userId);
  },

  /** Phase 21 §5.5: Admin notification catalogue & global channel/quiet settings. */
  async listTypesAdmin(): Promise<NotificationTypeRowDto[]> {
    // unpaginated: admin-defined config table, a few hundred rows at most; page UIs read it whole
    const rows = await prisma.$queryRaw<
      {
        code: string;
        module: string;
        category: NotifyCategory;
        label: string;
        label_hi: string;
        priority: NotifyPriority;
        enabled: boolean;
        allowed_channels: NotifyChannel[];
        default_channels: NotifyChannel[];
        mandatory_channels: NotifyChannel[];
        sensitive: boolean;
        digest_allowed: boolean;
        deep_link_tpl: string;
        collapse_key_tpl: string | null;
      }[]
    >`
      SELECT code, module, category, label, label_hi, priority, enabled,
             allowed_channels, default_channels, mandatory_channels,
             sensitive, digest_allowed, deep_link_tpl, collapse_key_tpl
      FROM notification_types
      ORDER BY module ASC, code ASC
    `;
    return rows.map((r) => ({
      code: r.code,
      module: r.module,
      category: r.category,
      label: r.label,
      labelHi: r.label_hi,
      priority: r.priority,
      enabled: r.enabled,
      allowedChannels: r.allowed_channels,
      defaultChannels: r.default_channels,
      mandatoryChannels: r.mandatory_channels,
      sensitive: r.sensitive,
      digestAllowed: r.digest_allowed,
      deepLinkTpl: r.deep_link_tpl,
      collapseKeyTpl: r.collapse_key_tpl,
    }));
  },

  async updateTypeAdmin(
    code: string,
    patch: {
      enabled?: boolean;
      priority?: NotifyPriority;
      defaultChannels?: NotifyChannel[];
      mandatoryChannels?: NotifyChannel[];
      sensitive?: boolean;
      digestAllowed?: boolean;
    },
    actorId: string,
  ): Promise<NotificationTypeRowDto> {
    const cur = (await this.listTypesAdmin()).find((t) => t.code === code);
    if (!cur) throw Errors.notFound(`Notification type ${code} not found`);

    if (cur.category === 'SECURITY' && patch.enabled === false) {
      throw Errors.validation({ enabled: 'SECURITY notifications cannot be turned off.' });
    }
    const nextMandatory = patch.mandatoryChannels ?? cur.mandatoryChannels;
    if (!nextMandatory.includes('IN_APP')) {
      throw Errors.validation({ mandatoryChannels: 'IN_APP must always remain in mandatory channels.' });
    }
    const nextDefault = patch.defaultChannels ?? cur.defaultChannels;
    for (const m of nextMandatory) {
      if (!nextDefault.includes(m)) nextDefault.push(m);
    }

    await prisma.$executeRaw`
      UPDATE notification_types
      SET enabled = COALESCE(${patch.enabled ?? null}, enabled),
          priority = COALESCE(${patch.priority ?? null}, priority),
          default_channels = ${nextDefault}::text[],
          mandatory_channels = ${nextMandatory}::text[],
          sensitive = COALESCE(${patch.sensitive ?? null}, sensitive),
          digest_allowed = COALESCE(${patch.digestAllowed ?? null}, digest_allowed),
          updated_by_id = ${actorId}::uuid,
          updated_at = now()
      WHERE code = ${code}
    `;

    await recordAudit({
      action: 'NOTIFICATION_TYPE_UPDATED',
      actorId,
      targetType: 'NotificationType',
      targetId: code,
      detail: patch,
    });

    const updated = (await this.listTypesAdmin()).find((t) => t.code === code);
    return updated!;
  },

  async getSettingsAdmin(): Promise<NotificationSettingsAdminDto> {
    // unpaginated: system fan-out/queue worker: must visit every eligible row, runs in a job in batches or per event
    const rows = await prisma.$queryRaw<
      {
        email_enabled: boolean;
        push_enabled: boolean;
        sms_enabled: boolean;
        marketing_paused: boolean;
        quiet_start: string;
        quiet_end: string;
        push_max_per_user_hour: number;
        digest_time: string;
        retention_days: number;
        broadcast_approval_threshold_users: number;
        sse_max_streams_per_user: number;
        push_declarative: boolean;
      }[]
    >`SELECT * FROM notification_settings WHERE id = 1`;
    const r = rows[0];
    return {
      emailEnabled: r?.email_enabled ?? true,
      pushEnabled: r?.push_enabled ?? true,
      smsEnabled: r?.sms_enabled ?? true,
      marketingPaused: r?.marketing_paused ?? false,
      quietStart: r?.quiet_start ?? '22:00',
      quietEnd: r?.quiet_end ?? '07:00',
      pushMaxPerUserHour: r?.push_max_per_user_hour ?? 20,
      digestTime: r?.digest_time ?? '08:30',
      retentionDays: r?.retention_days ?? 180,
      broadcastApprovalThresholdUsers: r?.broadcast_approval_threshold_users ?? 50,
      sseMaxStreamsPerUser: r?.sse_max_streams_per_user ?? 5,
      pushDeclarative: r?.push_declarative ?? true,
    };
  },

  async updateSettingsAdmin(
    patch: Partial<NotificationSettingsAdminDto>,
    actorId: string,
  ): Promise<NotificationSettingsAdminDto> {
    await prisma.$executeRaw`
      UPDATE notification_settings
      SET email_enabled = COALESCE(${patch.emailEnabled ?? null}, email_enabled),
          push_enabled = COALESCE(${patch.pushEnabled ?? null}, push_enabled),
          sms_enabled = COALESCE(${patch.smsEnabled ?? null}, sms_enabled),
          marketing_paused = COALESCE(${patch.marketingPaused ?? null}, marketing_paused),
          quiet_start = COALESCE(${patch.quietStart ?? null}, quiet_start),
          quiet_end = COALESCE(${patch.quietEnd ?? null}, quiet_end),
          push_max_per_user_hour = COALESCE(${patch.pushMaxPerUserHour ?? null}, push_max_per_user_hour),
          digest_time = COALESCE(${patch.digestTime ?? null}, digest_time),
          retention_days = COALESCE(${patch.retentionDays ?? null}, retention_days),
          broadcast_approval_threshold_users = COALESCE(${patch.broadcastApprovalThresholdUsers ?? null}, broadcast_approval_threshold_users),
          sse_max_streams_per_user = COALESCE(${patch.sseMaxStreamsPerUser ?? null}, sse_max_streams_per_user),
          push_declarative = COALESCE(${patch.pushDeclarative ?? null}, push_declarative),
          updated_by_id = ${actorId}::uuid,
          updated_at = now()
      WHERE id = 1
    `;
    await recordAudit({
      action: 'NOTIFICATION_SETTINGS_UPDATED',
      actorId,
      targetType: 'NotificationSettings',
      targetId: '1',
      detail: patch,
    });
    return this.getSettingsAdmin();
  },

  async resetSystemDefaultsAdmin(actorId: string): Promise<NotificationSettingsAdminDto> {
    await prisma.$executeRaw`
      UPDATE notification_settings
      SET email_enabled = true,
          push_enabled = true,
          sms_enabled = true,
          marketing_paused = false,
          quiet_start = '22:00',
          quiet_end = '07:00',
          push_max_per_user_hour = 20,
          digest_time = '08:30',
          retention_days = 180,
          broadcast_approval_threshold_users = 50,
          sse_max_streams_per_user = 5,
          push_declarative = true,
          updated_by_id = ${actorId}::uuid,
          updated_at = now()
      WHERE id = 1
    `;
    await recordAudit({
      action: 'NOTIFICATION_SETTINGS_RESET',
      actorId,
      targetType: 'NotificationSettings',
      targetId: '1',
    });
    return this.getSettingsAdmin();
  },

  /**
   * Daily digest: every DIGEST user's unread, not yet digested items in ONE email. The items are
   * marked in the same transaction as the outbox row, so running the job twice sends one email.
   */
  async sendDigests(): Promise<{ users: number; items: number }> {
    // unpaginated: system fan-out/queue worker: must visit every eligible row, runs in a job in batches or per event
    const candidates = await prisma.$queryRaw<{ user_id: string; email: string | null }[]>`
      SELECT DISTINCT n.user_id, u.email FROM notifications n
      JOIN users u ON u.id = n.user_id AND u.status = 'ACTIVE'
      JOIN notification_preferences p ON p.user_id = n.user_id AND p.type = n.type AND p.email = 'DIGEST'
      WHERE n.read_at IS NULL AND n.digested_at IS NULL`;
    let users = 0;
    let items = 0;
    for (const c of candidates) {
      if (!c.email) continue;
      const sent = await prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<
          { id: string; title: string; body: string; link: string | null }[]
        >`SELECT n.id, n.title, n.body, n.link FROM notifications n
          JOIN notification_preferences p ON p.user_id = n.user_id AND p.type = n.type AND p.email = 'DIGEST'
          WHERE n.user_id = ${c.user_id}::uuid AND n.read_at IS NULL AND n.digested_at IS NULL
          ORDER BY n.created_at FOR UPDATE OF n SKIP LOCKED`;
        if (rows.length === 0) return 0;
        const company = await companyName(tx);
        const content = renderDigest(
          company,
          rows.map((r) => ({ title: r.title, body: r.body, link: r.link })),
        );
        await queueEmail(
          tx,
          c.email as string,
          `${company}: ${rows.length} unread notification${rows.length === 1 ? '' : 's'}`,
          content,
        );
        await tx.notification.updateMany({
          where: { id: { in: rows.map((r) => r.id) } },
          data: { digestedAt: new Date() },
        });
        return rows.length;
      });
      if (sent > 0) {
        users += 1;
        items += sent;
      }
    }
    return { users, items };
  },

  /** Purge read notifications older than configured `retention_days` (default 180d). */
  async purge(now: Date = new Date()): Promise<number> {
    const settings = await this.getSettingsAdmin();
    const days = Math.max(7, settings.retentionDays);
    const cutoff = new Date(now.getTime() - days * 24 * 3600 * 1000);
    const r = await prisma.notification.deleteMany({ where: { readAt: { lt: cutoff } } });
    return r.count;
  },

  /** Administrators: queue a test message to their own address so SMTP can be checked. */
  async testEmail(userId: string): Promise<{ queued: boolean; to: string | null }> {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (!user?.email) throw Errors.validation({ email: 'Your account has no email address.' });
    const company = await companyName();
    await queueEmail(
      prisma,
      user.email,
      `${company}: test email`,
      renderEmail(company, { title: 'Test email', body: 'Email delivery works.', link: '/' }),
    );
    return { queued: true, to: user.email };
  },
};
