// The one pino logger for the API. Secrets (passwords, hashes, auth headers, cookies) are redacted
// here, centrally, so no call site can leak them by accident (CONTRACT §6 Logging).
import pino from 'pino';
import type { DestinationStream, Logger } from 'pino';
import { env } from '../config/env';

const SECRET_KEYS = [
  'password',
  'newPassword',
  'currentPassword',
  'temporaryPassword',
  'passwordHash',
  'authorization',
  'cookie',
  'refreshToken',
];

export const REDACT_PATHS: string[] = [
  ...SECRET_KEYS,
  ...SECRET_KEYS.map((key) => `*.${key}`),
  ...SECRET_KEYS.map((key) => `*.*.${key}`),
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
];

export function createLogger(level: string, destination?: DestinationStream): Logger {
  const options = {
    level,
    base: { service: 'rhai-api' },
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
  };
  return destination ? pino(options, destination) : pino(options);
}

export const logger: Logger = createLogger(env.LOG_LEVEL);
