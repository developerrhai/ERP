// Phase 20-B: Sentry initialisation with zero PII transmission (sendDefaultPii: false + beforeSend scrub).
import * as Sentry from '@sentry/node';
import type { Request } from 'express';
import { env } from '../../config/env';
import { scrubSensitiveValue } from '../logger';

let initialized = false;

export function scrubSentryEvent<T extends Record<string, unknown>>(event: T): T {
  const copy: Record<string, unknown> = { ...event };
  if ('user' in copy) {
    delete copy.user;
  }
  if ('request' in copy && typeof copy.request === 'object' && copy.request !== null) {
    const req = { ...(copy.request as Record<string, unknown>) };
    delete req.cookies;
    if (typeof req.headers === 'object' && req.headers !== null) {
      const headers = { ...(req.headers as Record<string, unknown>) };
      delete headers.authorization;
      delete headers.cookie;
      delete headers['x-api-key'];
      req.headers = headers;
    }
    if (req.data) req.data = scrubSensitiveValue(req.data);
    copy.request = req;
  }
  if ('extra' in copy && copy.extra) {
    copy.extra = scrubSensitiveValue(copy.extra);
  }
  return copy as T;
}

export function initSentry(): boolean {
  if (initialized || !env.SENTRY_DSN) return false;
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV,
    release: env.RELEASE_SHA,
    sendDefaultPii: false,
    tracesSampleRate: env.isProduction ? 0.1 : 0,
    beforeSend(event) {
      return scrubSentryEvent(event as unknown as Record<string, unknown>) as unknown as typeof event;
    },
  });
  initialized = true;
  return true;
}

export function captureApiException(err: unknown, req?: Pick<Request, 'requestId' | 'method' | 'path'>): void {
  if (!initialized) return;
  Sentry.withScope((scope) => {
    if (req) {
      scope.setTag('requestId', req.requestId ?? 'unknown');
      scope.setContext('route', { method: req.method, path: req.path });
    }
    Sentry.captureException(err);
  });
}
