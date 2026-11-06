// NotificationService (docs/phases/PHASE-05.md §5, §6). notify() inserts inside the CALLER's
// transaction, so an action that rolls back sends nothing. INSTANT-email users also get an outbox row
// in the same transaction; the `email.send` job delivers it later.
import type { Prisma } from '@prisma/client';
import { prisma } from '../../core/db/prisma';
import type { Db } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { companyName, queueEmail, renderDigest, renderEmail } from './email';
import { NOTIFICATION_TYPES, notificationTypeDef, typesOfGroup } from './types';
import type { EmailMode, NotificationGroup, NotifyInput } from './types';

export interface NotificationDto {
  id: string;
  type: string;
  severity: string;
  title: string;
  body: string;
  link: string | null;
  entityType: string | null;
  entityId: string | null;
  createdAt: string;
  readAt: string | null;
}

interface NotificationRow {
  id: string;
  type: string;
  severity: string;
  title: string;
  body: string;
  link: string | null;
  entityType: string | null;
  entityId: string | null;
  createdAt: Date;
  readAt: Date | null;
}

function toDto(r: NotificationRow): NotificationDto {
  return {
    id: r.id,
    type: r.type,
    severity: r.severity,
    title: r.title,
    body: r.body,
    link: r.link,
    entityType: r.entityType,
    entityId: r.entityId,
    createdAt: r.createdAt.toISOString(),
    readAt: r.readAt ? r.readAt.toISOString() : null,
  };
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

export const notificationService = {
  /**
   * Delivers one notification to each user (deduplicated per user by dedupeKey). Returns the ids of
   * the users who got a NEW in-app item. Runs on `tx`, never on the root client by accident.
   */
  async notify(tx: Db, userIds: readonly string[], input: NotifyInput): Promise<string[]> {
    const def = notificationTypeDef(input.type);
    if (!def) throw new Error(`Unknown notification type ${input.type}`);
    const unique = [...new Set(userIds)];
    if (unique.length === 0) return [];
    const users = await tx.user.findMany({
      where: { id: { in: unique }, status: 'ACTIVE' },
      select: { id: true, email: true },
    });
    if (users.length === 0) return [];
    const prefs = await tx.notificationPreference.findMany({
      where: { userId: { in: users.map((u) => u.id) }, type: input.type },
    });
    const prefOf = new Map(prefs.map((p) => [p.userId, p]));
    const company = await companyName(tx);
    const delivered: string[] = [];
    for (const user of users) {
      const pref = prefOf.get(user.id);
      const inApp = def.inAppLocked ? true : (pref?.inApp ?? true);
      const email = (pref?.email ?? 'INSTANT') as EmailMode;
      if (!inApp) continue;
      const created = await tx.notification.createManyAndReturn({
        select: { id: true },
        data: [
          {
            userId: user.id,
            type: input.type,
            severity: input.severity ?? def.severity,
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
      const createdRow = created[0];
      if (!createdRow) continue;
      delivered.push(user.id);
      if (email === 'INSTANT' && user.email) {
        const content = renderEmail(company, {
          title: input.title,
          body: input.body ?? '',
          link: input.link ?? null,
          docCode: input.docCode ?? null,
          amount: input.amount ?? null,
        });
        await queueEmail(tx, user.email, `${company}: ${input.title}`, content);
        await tx.notification.update({
          where: { id: createdRow.id },
          data: { emailedAt: new Date() },
        });
      }
    }
    return delivered;
  },

  /** Active users whose role level is at least `minLevel` (Administrators = 95). */
  async usersAtLevel(tx: Db, minLevel: number): Promise<string[]> {
    const users = await tx.user.findMany({
      where: { status: 'ACTIVE', role: { level: { gte: minLevel } } },
      select: { id: true },
    });
    return users.map((u) => u.id);
  },

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
    return { rows: rows.map(toDto), total, unread };
  },

  unreadCount(userId: string): Promise<number> {
    return prisma.notification.count({ where: { userId, readAt: null } });
  },

  /** 404 for another user's item (never reveals that it exists). */
  async markRead(userId: string, id: string): Promise<NotificationDto> {
    const row = await prisma.notification.findFirst({ where: { id, userId } });
    if (!row) throw Errors.notFound('Notification not found.');
    if (row.readAt) return toDto(row);
    return toDto(await prisma.notification.update({ where: { id }, data: { readAt: new Date() } }));
  },

  async readAll(userId: string): Promise<number> {
    const r = await prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return r.count;
  },

  async preferences(userId: string): Promise<PreferenceDto[]> {
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

  /**
   * Daily digest: every DIGEST user's unread, not yet digested items in ONE email. The items are
   * marked in the same transaction as the outbox row, so running the job twice sends one email.
   */
  async sendDigests(): Promise<{ users: number; items: number }> {
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

  /** Weekly: read items older than 180 days. */
  async purge(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - 180 * 24 * 3600 * 1000);
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
