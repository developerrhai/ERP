// apps/api/src/kit/commands.ts
// Header command execution: permission guards, size checks and Postgres-backed idempotency
// (docs/plans/07-ENGINE-KIT.md §2.6, docs/phases/PHASE-04.md §5 C7). No in-memory state.

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma, type Db } from '../core/db/prisma';
import { abandonIdempotent, beginIdempotent, finishIdempotent } from '../core/http/idempotency';
import { Errors } from '../core/http/errors';
import { asyncHandler } from '../core/http/async-handler';
import { authenticate, requirePasswordChanged } from '../core/auth/authenticate';
import { resolveContext } from '../core/context/resolve-context';
import { requestMeta, requireAuth } from '../core/auth/auth-context';
import { accessUserOf, can } from '../core/rbac/access';
import { typedSchema } from '../modules/inventory/definitions';
import type { Caller } from '../modules/records/service';
import { idempotencyKeySchema } from '../modules/records/schemas';
import type { Requires } from './types';

/** What a command hands back; `result` must be JSON-serialisable. */
export interface CommandOutcome {
  message?: string;
  result?: Prisma.InputJsonValue;
}

export type CommandRunner = (ctx: {
  db: Db;
  caller: Caller;
  payload: Record<string, unknown>;
  idempotencyKey?: string;
}) => Promise<CommandOutcome | void>;

export interface CommandOpts {
  allowAllUnits?: boolean;
}

export interface CommandDef {
  pageId: string;
  key: string;
  run: CommandRunner;
  opts?: CommandOpts;
  moduleName?: string;
}

export const COMMAND_REGISTRY = new Map<string, CommandDef>();

export function registerCommand(
  pageId: string,
  key: string,
  run: CommandRunner,
  opts?: CommandOpts,
  moduleName?: string,
): void {
  const compound = `${pageId}:${key}`;
  const existing = COMMAND_REGISTRY.get(compound);
  if (existing) {
    throw new Error(
      `KIT: command ${pageId}.${key} registered twice (${existing.moduleName}, ${moduleName})`,
    );
  }
  COMMAND_REGISTRY.set(compound, { pageId, key, run, opts, moduleName });
}

export function getCommandDef(pageId: string, key: string): CommandDef | undefined {
  return COMMAND_REGISTRY.get(`${pageId}:${key}`);
}

export function clearKitCommandsForTest(): void {
  COMMAND_REGISTRY.clear();
}

function callerOf(req: Request): Caller {
  if (!req.ctx) throw Errors.unauthenticated();
  return { auth: requireAuth(req), ctx: req.ctx, meta: requestMeta(req) };
}

function idempotencyKeyOf(req: Request): string | undefined {
  const header = req.get('idempotency-key');
  if (header === undefined) return undefined;
  const parsed = idempotencyKeySchema.safeParse(header);
  if (!parsed.success) {
    throw Errors.badRequest(parsed.error.issues[0]?.message ?? 'Invalid Idempotency-Key header.');
  }
  return parsed.data;
}

const commandParamsSchema = z
  .object({
    pageId: z.string().trim().min(1).max(80),
    command: z.string().trim().min(1).max(50),
  })
  .strict();

const commandBodySchema = z
  .object({
    payload: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

function isPlainObject(v: unknown): v is Record<string, Prisma.InputJsonValue> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** One response body for every command: `{message}` is merged into an object result. */
export function normalizeOutcome(outcome: CommandOutcome | void): Prisma.InputJsonValue {
  if (!outcome) return {};
  const { message, result } = outcome;
  if (result === undefined) return message ? { message } : {};
  if (message && isPlainObject(result)) return { message, ...result };
  return result;
}

function respond(res: Response, body: Prisma.InputJsonValue, replay: boolean): void {
  if (replay) res.set('Idempotent-Replay', 'true');
  // `data` is the canonical key; `result` is kept as a deprecated alias for older clients.
  res.json({ data: body, result: body });
}

function replayBodyOf(stored: Prisma.JsonValue): Prisma.InputJsonValue {
  if (isPlainObject(stored) && 'data' in stored && stored.data !== undefined) {
    return stored.data;
  }
  return stored === null ? {} : (stored as Prisma.InputJsonValue);
}

function firstIssue(
  error: z.ZodError,
  fallbackField: string,
  fallbackMessage: string,
): { field: string; msg: string } {
  const issue = error.issues[0];
  return { field: issue?.path.join('.') || fallbackField, msg: issue?.message ?? fallbackMessage };
}

export function createKitCommandsRouter(): Router {
  const router = Router();

  router.post(
    '/:pageId/commands/:command',
    authenticate,
    requirePasswordChanged,
    resolveContext,
    asyncHandler(async (req: Request, res: Response) => {
      const parsedParams = commandParamsSchema.safeParse(req.params);
      if (!parsedParams.success) {
        const { field, msg } = firstIssue(
          parsedParams.error,
          'command',
          'Invalid command parameters.',
        );
        throw Errors.validation({ [field]: msg }, msg);
      }
      const { pageId, command } = parsedParams.data;

      const def = getCommandDef(pageId, command);
      if (!def) throw Errors.notFound('Unknown command.');

      const cmd = typedSchema(pageId)?.commands?.find((c) => c.key === command);
      if (!cmd) throw Errors.notFound('Unknown command.');

      // Concrete unit guard unless the runner declares allowAllUnits: true
      if (!def.opts?.allowAllUnits && (!req.ctx || req.ctx.unitId === null)) {
        throw Errors.contextInvalid('Choose a unit first: "All units" is for viewing lists only.');
      }

      const requiredPerm: Requires = cmd.requires ?? 'add';
      const authUser = requireAuth(req).user;
      if (!(await can(accessUserOf(authUser), pageId, requiredPerm))) throw Errors.forbidden();

      const parsedBody = commandBodySchema.safeParse(req.body ?? {});
      if (!parsedBody.success) {
        const { field, msg } = firstIssue(parsedBody.error, 'payload', 'Invalid command body.');
        throw Errors.validation({ [field]: msg }, msg);
      }
      const payload = parsedBody.data.payload ?? {};
      if (JSON.stringify(payload).length > 100 * 1024) throw Errors.payloadTooLarge();

      const idempotencyKey = idempotencyKeyOf(req);
      const caller = callerOf(req);
      const runArgs = { db: prisma, caller, payload };

      if (!idempotencyKey) {
        respond(res, normalizeOutcome(await def.run(runArgs)), false);
        return;
      }

      const scope = `cmd:${pageId}:${command}`;
      const requestHash = createHash('sha256')
        .update(JSON.stringify([pageId, command, req.ctx?.unitId, req.ctx?.fyId, payload]))
        .digest('hex');
      const start = await beginIdempotent(authUser.id, scope, idempotencyKey, requestHash);
      if (start.kind === 'mismatch') {
        throw Errors.conflict('This Idempotency-Key was already used for a different request.');
      }
      if (start.kind === 'in_progress') throw Errors.inProgress();
      if (start.kind === 'replay') {
        respond(res, replayBodyOf(start.body), true);
        return;
      }

      let body: Prisma.InputJsonValue;
      try {
        body = normalizeOutcome(await def.run({ ...runArgs, idempotencyKey }));
      } catch (err) {
        await abandonIdempotent(authUser.id, scope, idempotencyKey);
        throw err;
      }
      await finishIdempotent(authUser.id, scope, idempotencyKey, 200, { data: body });
      respond(res, body, false);
    }),
  );

  return router;
}
