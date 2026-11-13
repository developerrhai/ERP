// Phase 21 §5.3: Real-time Server-Sent Events (SSE) + PostgreSQL `LISTEN erp_rt` multi-process bus.
// Supports max 5 streams/user (closing oldest), 25s comment heartbeat, Last-Event-ID replay (<= 200 items / 24h),
// and cross-process fan-out from pg_notify('erp_rt', ...).
import type { Request, Response } from 'express';
import { Client } from 'pg';
import { env } from '../../config/env';
import { requireAuth } from '../../core/auth/auth-context';
import { prisma, type Db } from '../../core/db/prisma';
import { logger } from '../../core/logger';

export const REALTIME_CHANNEL = 'erp_rt';
export const DEFAULT_MAX_STREAMS_PER_USER = 5;
export const HEARTBEAT_INTERVAL_MS = 25_000;

export type RealtimePayload = {
  /** Recipient user IDs */
  u?: string[];
  /** Kind: n=notification.new, r=notification.read, b=broadcast.banner, a=approval.changed, s=session.revoked,
   *  c=session.context_changed (plant access changed, Phase 23) */
  k: 'n' | 'r' | 'b' | 'a' | 's' | 'c';
  /** Related entity IDs (notifications/broadcasts/approvals) */
  ids?: string[];
  docType?: string;
  docId?: string;
};

interface SseStream {
  res: Response;
  userId: string;
  connectedAt: number;
  heartbeat: NodeJS.Timeout;
}

const streamsByUser = new Map<string, SseStream[]>();
let rtClient: Client | null = null;
let rtStarted = false;
let rtStopRequested = false;

function writeSseEvent(res: Response, event: string, data: unknown, id?: string | number): void {
  if (res.writableEnded) return;
  if (id !== undefined) res.write(`id: ${id}\n`);
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

export async function emitRealtimeNotify(db: Db | typeof prisma, payload: RealtimePayload): Promise<void> {
  const json = JSON.stringify(payload);
  // PostgreSQL NOTIFY limit is 8000 bytes; caller batches >500 users per §5.3.
  if (Buffer.byteLength(json, 'utf8') > 7900) {
    logger.warn({ length: json.length, kind: payload.k }, 'Truncating oversized erp_rt notify payload');
    return;
  }
  await db.$executeRaw`SELECT pg_notify('erp_rt', ${json})`;
}

async function deliverToLocalStreams(payload: RealtimePayload): Promise<void> {
  const userIds = payload.u ?? [];
  if (userIds.length === 0) return;

  const activeTargets = userIds.filter((uid) => (streamsByUser.get(uid)?.length ?? 0) > 0);
  if (activeTargets.length === 0) return;

  if (payload.k === 'n') {
    const rows = payload.ids?.length
      // unpaginated: system fan-out/queue worker: must visit every eligible row, runs in a job in batches or per event
      ? await prisma.$queryRaw<
          {
            id: string;
            user_id: string;
            seq: bigint;
            type: string;
            title: string;
            body: string;
            link: string | null;
            priority: string;
            created_at: Date;
          }[]
        >`
          SELECT id, user_id, seq, type, title, body, link, priority, created_at
          FROM notifications
          WHERE id = ANY(${payload.ids}::uuid[]) AND archived_at IS NULL
        `
      // unpaginated: system fan-out/queue worker: must visit every eligible row, runs in a job in batches or per event
      : await prisma.$queryRaw<
          {
            id: string;
            user_id: string;
            seq: bigint;
            type: string;
            title: string;
            body: string;
            link: string | null;
            priority: string;
            created_at: Date;
          }[]
        >`
          SELECT DISTINCT ON (user_id) id, user_id, seq, type, title, body, link, priority, created_at
          FROM notifications
          WHERE user_id = ANY(${activeTargets}::uuid[]) AND archived_at IS NULL
          ORDER BY user_id, seq DESC
        `;

    // unpaginated: system fan-out/queue worker: must visit every eligible row, runs in a job in batches or per event
    const unreadCounts = await prisma.$queryRaw<{ user_id: string; cnt: number }[]>`
      SELECT user_id, count(*)::int AS cnt
      FROM notifications
      WHERE user_id = ANY(${activeTargets}::uuid[]) AND read_at IS NULL AND archived_at IS NULL
      GROUP BY user_id
    `;
    const badgeByUser = new Map(unreadCounts.map((r) => [r.user_id, r.cnt]));

    for (const row of rows) {
      const list = streamsByUser.get(row.user_id) ?? [];
      for (const s of list) {
        writeSseEvent(
          s.res,
          'notification.new',
          {
            id: row.id,
            seq: Number(row.seq),
            type: row.type,
            title: row.title,
            body: row.body,
            link: row.link,
            priority: row.priority,
            createdAt: row.created_at.toISOString(),
          },
          Number(row.seq),
        );
        writeSseEvent(s.res, 'badge', { unread: badgeByUser.get(row.user_id) ?? 0 });
      }
    }
    return;
  }

  for (const uid of activeTargets) {
    const list = streamsByUser.get(uid) ?? [];
    if (list.length === 0) continue;

    if (payload.k === 'r') {
      const unreadRow = await prisma.$queryRaw<{ cnt: number }[]>`
        SELECT count(*)::int AS cnt FROM notifications WHERE user_id = ${uid}::uuid AND read_at IS NULL AND archived_at IS NULL
      `;
      const unread = unreadRow[0]?.cnt ?? 0;
      for (const s of list) {
        writeSseEvent(s.res, 'notification.read', { ids: payload.ids ?? [] });
        writeSseEvent(s.res, 'badge', { unread });
      }
    } else if (payload.k === 'b') {
      for (const s of list) {
        writeSseEvent(s.res, 'broadcast.banner', { ids: payload.ids ?? [] });
      }
    } else if (payload.k === 'a') {
      for (const s of list) {
        writeSseEvent(s.res, 'approval.changed', {
          docType: payload.docType ?? null,
          docId: payload.docId ?? null,
        });
      }
    } else if (payload.k === 's') {
      for (const s of list) {
        writeSseEvent(s.res, 'session.revoked', {});
      }
    } else if (payload.k === 'c') {
      for (const s of list) {
        writeSseEvent(s.res, 'session.context_changed', {});
      }
    }
  }
}

export async function startRealtimeBus(connectionString: string = env.DATABASE_URL): Promise<void> {
  if (rtStarted) return;
  rtStarted = true;
  rtStopRequested = false;

  const connect = async () => {
    if (rtStopRequested) return;
    const c = new Client({ connectionString });
    rtClient = c;
    c.on('notification', (msg) => {
      if (msg.channel !== REALTIME_CHANNEL || !msg.payload) return;
      try {
        const payload = JSON.parse(msg.payload) as RealtimePayload;
        void deliverToLocalStreams(payload).catch((err) => logger.warn({ err }, 'SSE dispatch error'));
      } catch {
        // ignore invalid payload
      }
    });
    c.on('error', (err) => logger.warn({ err }, 'Realtime erp_rt client error'));
    c.on('end', () => {
      if (!rtStopRequested) {
        setTimeout(() => void connect().catch(() => undefined), 2_000).unref();
      }
    });
    await c.connect();
    await c.query(`LISTEN ${REALTIME_CHANNEL}`);
    logger.info({ channel: REALTIME_CHANNEL }, 'Realtime SSE LISTEN ready');
  };

  try {
    await connect();
  } catch (err) {
    logger.warn({ err }, 'Realtime bus initial LISTEN failed; will retry');
    setTimeout(() => void connect().catch(() => undefined), 2_000).unref();
  }
}

export async function stopRealtimeBus(): Promise<void> {
  rtStopRequested = true;
  rtStarted = false;
  for (const list of streamsByUser.values()) {
    for (const s of list) {
      clearInterval(s.heartbeat);
      if (!s.res.writableEnded) s.res.end();
    }
  }
  streamsByUser.clear();
  const c = rtClient;
  rtClient = null;
  if (c) {
    try {
      await c.end();
    } catch {
      // ignore
    }
  }
}

export function activeSseStreamCount(userId?: string): number {
  if (userId) return streamsByUser.get(userId)?.length ?? 0;
  let sum = 0;
  for (const list of streamsByUser.values()) sum += list.length;
  return sum;
}

export async function sseStreamHandler(req: Request, res: Response): Promise<void> {
  const { userId } = requireAuth(req);
  // unpaginated: system fan-out/queue worker: must visit every eligible row, runs in a job in batches or per event
  const settingRow = await prisma.$queryRaw<{ sse_max_streams_per_user: number }[]>`
    SELECT sse_max_streams_per_user FROM notification_settings WHERE id = 1
  `.catch(() => []);
  const maxStreams = settingRow[0]?.sse_max_streams_per_user ?? DEFAULT_MAX_STREAMS_PER_USER;

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const existing = streamsByUser.get(userId) ?? [];
  while (existing.length >= maxStreams) {
    const oldest = existing.shift();
    if (oldest) {
      clearInterval(oldest.heartbeat);
      if (!oldest.res.writableEnded) oldest.res.end();
    }
  }

  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(':hb\n\n');
  }, HEARTBEAT_INTERVAL_MS);
  heartbeat.unref();

  const entry: SseStream = { res, userId, connectedAt: Date.now(), heartbeat };
  existing.push(entry);
  streamsByUser.set(userId, existing);

  req.on('close', () => {
    clearInterval(heartbeat);
    const list = streamsByUser.get(userId);
    if (!list) return;
    const next = list.filter((s) => s !== entry);
    if (next.length === 0) streamsByUser.delete(userId);
    else streamsByUser.set(userId, next);
  });

  // Replay Last-Event-ID (<= 200 items within last 24 h), else resync
  const rawLastId = req.header('last-event-id') ?? (typeof req.query.lastSeq === 'string' ? req.query.lastSeq : undefined);
  if (rawLastId && /^\d+$/.test(rawLastId)) {
    const lastSeq = BigInt(rawLastId);
    const missedCountRow = await prisma.$queryRaw<{ cnt: number }[]>`
      SELECT count(*)::int AS cnt
      FROM notifications
      WHERE user_id = ${userId}::uuid AND seq > ${lastSeq} AND created_at >= now() - interval '24 hours'
    `;
    const missedCount = missedCountRow[0]?.cnt ?? 0;
    if (missedCount > 200) {
      writeSseEvent(res, 'resync', { reason: 'TOO_MANY_MISSED', missedCount });
    } else if (missedCount > 0) {
      const missed = await prisma.$queryRaw<
        {
          id: string;
          seq: bigint;
          type: string;
          title: string;
          body: string;
          link: string | null;
          priority: string;
          created_at: Date;
        }[]
      >`
        SELECT id, seq, type, title, body, link, priority, created_at
        FROM notifications
        WHERE user_id = ${userId}::uuid AND seq > ${lastSeq} AND created_at >= now() - interval '24 hours'
        ORDER BY seq ASC
        LIMIT 200
      `;
      for (const row of missed) {
        writeSseEvent(
          res,
          'notification.new',
          {
            id: row.id,
            seq: Number(row.seq),
            type: row.type,
            title: row.title,
            body: row.body,
            link: row.link,
            priority: row.priority,
            createdAt: row.created_at.toISOString(),
          },
          Number(row.seq),
        );
      }
    }
  }

  const unreadRow = await prisma.$queryRaw<{ cnt: number }[]>`
    SELECT count(*)::int AS cnt FROM notifications WHERE user_id = ${userId}::uuid AND read_at IS NULL AND archived_at IS NULL
  `;
  writeSseEvent(res, 'badge', { unread: unreadRow[0]?.cnt ?? 0 });
}

