// Centralized pino logger + Phase 20 extended PII/financial redaction (passwords, hashes,
// auth headers, cookies, Aadhaar, PAN, bank account & IFSC fields).
import pino from 'pino';
import type { DestinationStream, Logger } from 'pino';
import { env } from '../config/env';

export const SECRET_KEYS = [
  'password',
  'newPassword',
  'currentPassword',
  'temporaryPassword',
  'passwordHash',
  'authorization',
  'cookie',
  'refreshToken',
  'mfaSecret',
  'aadhaar',
  'aadhaarNo',
  'aadhaarNumber',
  'aadhar',
  'aadharNo',
  'pan',
  'panNo',
  'panNumber',
  'bankAccount',
  'bankAccountNo',
  'accountNo',
  'accountNumber',
  'ifsc',
  'ifscCode',
] as const;

const REDACT_SUFFIXES = SECRET_KEYS.flatMap((key) => [
  key,
  `*.${key}`,
  `*.*.${key}`,
  `*.*.*.${key}`,
]);

export const REDACT_PATHS: string[] = [
  ...REDACT_SUFFIXES,
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
];

const SENSITIVE_KEY_RE =
  /^(password|newpassword|currentpassword|temporarypassword|passwordhash|authorization|cookie|refreshtoken|mfasecret|aadhaar|aadhaarno|aadhaarnumber|aadhar|aadharno|pan|panno|pannumber|bankaccount|bankaccountno|accountno|accountnumber|ifsc|ifsccode|token|secret)$/i;

/** Recursively scrubs PII/secret fields before forwarding payloads to external telemetry (e.g. Sentry). */
export function scrubSensitiveValue<T>(value: T, depth = 0): T {
  if (depth > 8 || value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return value
      .replace(/\b\d{4}\s?\d{4}\s?\d{4}\b/g, '[REDACTED_AADHAAR]')
      .replace(/\b[A-Z]{5}\d{4}[A-Z]\b/g, '[REDACTED_PAN]') as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => scrubSensitiveValue(item, depth + 1)) as T;
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_RE.test(k)) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = scrubSensitiveValue(v, depth + 1);
      }
    }
    return out as T;
  }
  return value;
}

export function createLogger(level: string, destination?: DestinationStream): Logger {
  const options = {
    level,
    base: { service: 'rhai-api', pid: process.pid },
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
  };
  return destination ? pino(options, destination) : pino(options);
}

export const logger: Logger = createLogger(env.LOG_LEVEL);
