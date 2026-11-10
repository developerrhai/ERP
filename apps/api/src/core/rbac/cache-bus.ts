// Phase 20 §4.2: Multi-process cache invalidation listener using PostgreSQL LISTEN/NOTIFY (`erp_cache`).
// Dedicated `pg.Client` maintains `LISTEN erp_cache`; clears local access cache on every message and on
// reconnect; exposes health state so `/health/ready` fails if the listener has been down > 30 s.
import { Client } from 'pg';
import { env } from '../../config/env';
import { logger } from '../logger';

export const CACHE_CHANNEL = 'erp_cache';
export const CACHE_BUS_STALE_MS = 30_000;

export interface CacheBusHealth {
  enabled: boolean;
  connected: boolean;
  downForMs: number;
  ok: boolean;
  lastMessageAt: string | null;
}

type ClearHandler = () => void;

let client: Client | null = null;
let started = false;
let connected = false;
let startedAt = 0;
let lastDisconnectedAt: number | null = null;
let lastMessageAt: number | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let reconnectDelayMs = 1_000;
let stopRequested = false;
let clearHandlers: ClearHandler[] = [];

export function onAccessCacheInvalidated(handler: ClearHandler): () => void {
  clearHandlers.push(handler);
  return () => {
    clearHandlers = clearHandlers.filter((h) => h !== handler);
  };
}

function clearAllCaches(): void {
  for (const h of clearHandlers) {
    try {
      h();
    } catch (err) {
      logger.error({ err }, 'Cache clear handler error');
    }
  }
}

async function connectAndListen(connectionString: string): Promise<void> {
  if (stopRequested) return;
  const c = new Client({ connectionString });
  client = c;

  c.on('notification', (msg) => {
    if (msg.channel !== CACHE_CHANNEL) return;
    lastMessageAt = Date.now();
    try {
      const payload = msg.payload ? (JSON.parse(msg.payload) as { scope?: string }) : { scope: 'access' };
      if (!payload.scope || payload.scope === 'access') {
        clearAllCaches();
      }
    } catch {
      clearAllCaches();
    }
  });

  c.on('error', (err) => {
    logger.warn({ err }, 'Cache bus pg client error');
    if (connected) {
      connected = false;
      lastDisconnectedAt = Date.now();
    }
  });

  c.on('end', () => {
    if (connected) {
      connected = false;
      lastDisconnectedAt = Date.now();
    }
    if (!stopRequested) {
      scheduleReconnect(connectionString);
    }
  });

  await c.connect();
  await c.query(`LISTEN ${CACHE_CHANNEL}`);
  connected = true;
  lastDisconnectedAt = null;
  reconnectDelayMs = 1_000;
  // Clear local cache on connect/reconnect (§4.2) so any updates missed while disconnected take effect immediately.
  clearAllCaches();
  logger.info({ channel: CACHE_CHANNEL }, 'Cache bus LISTEN ready');
}

function scheduleReconnect(connectionString: string): void {
  if (stopRequested || reconnectTimer) return;
  const wait = reconnectDelayMs;
  reconnectDelayMs = Math.min(reconnectDelayMs * 2, 10_000);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void connectAndListen(connectionString).catch((err: unknown) => {
      logger.warn({ err }, 'Cache bus reconnect failed');
      scheduleReconnect(connectionString);
    });
  }, wait);
  reconnectTimer.unref();
}

export async function startCacheBus(connectionString: string = env.DATABASE_URL): Promise<void> {
  if (started) return;
  started = true;
  stopRequested = false;
  startedAt = Date.now();
  try {
    await connectAndListen(connectionString);
  } catch (err) {
    connected = false;
    lastDisconnectedAt = Date.now();
    logger.error({ err }, 'Cache bus initial LISTEN failed; scheduling reconnect');
    scheduleReconnect(connectionString);
  }
}

export async function stopCacheBus(): Promise<void> {
  stopRequested = true;
  started = false;
  connected = false;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  const c = client;
  client = null;
  if (c) {
    try {
      await c.end();
    } catch {
      // ignore close errors
    }
  }
}

export function getCacheBusHealth(): CacheBusHealth {
  if (!started) {
    return {
      enabled: false,
      connected: false,
      downForMs: 0,
      ok: true,
      lastMessageAt: lastMessageAt ? new Date(lastMessageAt).toISOString() : null,
    };
  }
  const downForMs = connected ? 0 : Date.now() - (lastDisconnectedAt ?? startedAt);
  return {
    enabled: true,
    connected,
    downForMs,
    ok: connected || downForMs <= CACHE_BUS_STALE_MS,
    lastMessageAt: lastMessageAt ? new Date(lastMessageAt).toISOString() : null,
  };
}

