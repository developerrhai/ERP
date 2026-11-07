// Shared bits of the /inventory route files (kept apart from routes.ts so the route files can import them without a cycle).
import type { Request } from 'express';
import { z } from 'zod';
import { requestMeta, requireAuth } from '../../core/auth/auth-context';
import { Errors } from '../../core/http/errors';
import type { Caller } from '../records/service';

export const uuid = z.string().uuid('Invalid id.');
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-11-30.');
export const qtyNum = z.union([z.number(), z.string().regex(/^-?\d+(\.\d+)?$/, 'Enter a number.')]);
export const pageQuery = {
  page: z.coerce.number().int().min(1).max(100000).default(1),
  size: z.coerce.number().int().min(1).max(200).default(20),
};

export const callerOf = (req: Request): Caller => {
  if (!req.ctx) throw Errors.unauthenticated();
  return { auth: requireAuth(req), ctx: req.ctx, meta: requestMeta(req) };
};

export const idemOf = (req: Request): string | undefined => {
  const h = req.get('idempotency-key');
  return h && h.length >= 8 && h.length <= 120 ? h : undefined;
};
