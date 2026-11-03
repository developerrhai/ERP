// apps/api/src/kit/commands.ts
// Header command execution with idempotency, permission guards, and size checks (docs/plans/07-ENGINE-KIT.md §2.6, §6 KR-07, §12 T-KIT-05)

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { prisma, type Db } from '../core/db/prisma';
import { Errors } from '../core/http/errors';
import { asyncHandler } from '../core/http/async-handler';
import { authenticate, requirePasswordChanged } from '../core/auth/authenticate';
import { resolveContext } from '../core/context/resolve-context';
import { requestMeta, requireAuth } from '../core/auth/auth-context';
import { accessUserOf, can } from '../core/rbac/access';
import { typedSchema } from '../modules/inventory/definitions';
import { recordRepository } from '../modules/records/repository';
import type { Caller } from '../modules/records/service';
import { idempotencyKeySchema } from '../modules/records/schemas';
import type { Requires } from './types';

export type CommandRunner = (ctx: {
  db: Db;
  caller: Caller;
  payload: Record<string, unknown>;
  idempotencyKey?: string;
}) => Promise<{ message?: string; result?: unknown }>;

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
export const COMMAND_RESULT_CACHE = new Map<string, { requestHash: string; result: unknown }>();
const IN_FLIGHT_COMMANDS = new Map<string, Promise<{ result: unknown }>>();

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
  COMMAND_RESULT_CACHE.clear();
  IN_FLIGHT_COMMANDS.clear();
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
        const issue = parsedParams.error.issues[0];
        const field = issue?.path.join('.') || 'command';
        const msg = issue?.message ?? 'Invalid command parameters.';
        throw Errors.validation({ [field]: msg }, msg);
      }
      const { pageId, command } = parsedParams.data;

      const def = getCommandDef(pageId, command);
      if (!def) {
        throw Errors.notFound('Unknown command.');
      }

      const schema = typedSchema(pageId);
      const cmd = schema?.commands?.find((c) => c.key === command);
      if (!cmd) {
        throw Errors.notFound('Unknown command.');
      }

      // Concrete unit guard unless runner declares allowAllUnits: true
      if (!def.opts?.allowAllUnits) {
        if (!req.ctx || req.ctx.unitId === null) {
          throw Errors.contextInvalid(
            'Choose a unit first: "All units" is for viewing lists only.',
          );
        }
      }

      // Check permission: default 'add' unless specified in schema
      const requiredPerm: Requires = cmd.requires ?? 'add';
      const authUser = requireAuth(req).user;
      const allowed = await can(accessUserOf(authUser), pageId, requiredPerm);
      if (!allowed) {
        throw Errors.forbidden();
      }

      // Validate body
      const parsedBody = commandBodySchema.safeParse(req.body ?? {});
      if (!parsedBody.success) {
        const issue = parsedBody.error.issues[0];
        const field = issue?.path.join('.') || 'payload';
        const msg = issue?.message ?? 'Invalid command body.';
        throw Errors.validation({ [field]: msg }, msg);
      }

      // Payload size check (<= 100 KB)
      if (parsedBody.data.payload && JSON.stringify(parsedBody.data.payload).length > 100 * 1024) {
        throw Errors.payloadTooLarge();
      }

      const payload = parsedBody.data.payload ?? {};
      const idempotencyKey = idempotencyKeyOf(req);
      const caller = callerOf(req);

      // Idempotency execution
      if (idempotencyKey) {
        const cacheKey = `${authUser.id}:${idempotencyKey}`;
        const requestHash = createHash('sha256')
          .update(
            JSON.stringify([
              pageId,
              command,
              req.ctx?.unitId,
              req.ctx?.fyId,
              payload,
            ]),
          )
          .digest('hex');

        // Check if an existing execution was finished
        const seen = await recordRepository.findIdempotency(authUser.id, idempotencyKey, prisma);
        if (seen) {
          if (seen.requestHash !== requestHash) {
            throw Errors.conflict('This Idempotency-Key was already used for a different request.');
          }
          const cached = COMMAND_RESULT_CACHE.get(cacheKey);
          res.set('Idempotent-Replay', 'true').json({ result: cached?.result ?? {} });
          return;
        }

        // Check if concurrent execution is in-flight
        const inFlight = IN_FLIGHT_COMMANDS.get(cacheKey);
        if (inFlight) {
          const finished = await inFlight;
          res.set('Idempotent-Replay', 'true').json({ result: finished.result });
          return;
        }

        // Execute and store in-flight promise
        const execPromise = (async () => {
          const outcome = await def.run({
            db: prisma,
            caller,
            payload,
            idempotencyKey,
          });

          let finalResult: unknown;
          if (
            outcome &&
            typeof outcome === 'object' &&
            'result' in outcome &&
            (outcome as any).result !== undefined
          ) {
            if (
              outcome.message &&
              typeof (outcome as any).result === 'object' &&
              (outcome as any).result !== null &&
              !Array.isArray((outcome as any).result)
            ) {
              finalResult = { message: outcome.message, ...(outcome as any).result };
            } else {
              finalResult = (outcome as any).result;
            }
          } else {
            finalResult = outcome;
          }

          COMMAND_RESULT_CACHE.set(cacheKey, { requestHash, result: finalResult });
          try {
            await recordRepository.saveIdempotency(
              {
                userId: authUser.id,
                key: idempotencyKey,
                requestHash,
                recordId: '00000000-0000-0000-0000-000000000000',
              },
              prisma,
            );
          } catch {
            // Duplicate key conflict or concurrency
          }
          return { result: finalResult };
        })();

        IN_FLIGHT_COMMANDS.set(cacheKey, execPromise);
        try {
          const finished = await execPromise;
          res.json({ result: finished.result });
        } finally {
          IN_FLIGHT_COMMANDS.delete(cacheKey);
        }
        return;
      }

      // No idempotency key provided: standard execution
      const outcome = await def.run({
        db: prisma,
        caller,
        payload,
      });

      let finalResult: unknown;
      if (
        outcome &&
        typeof outcome === 'object' &&
        'result' in outcome &&
        (outcome as any).result !== undefined
      ) {
        if (
          outcome.message &&
          typeof (outcome as any).result === 'object' &&
          (outcome as any).result !== null &&
          !Array.isArray((outcome as any).result)
        ) {
          finalResult = { message: outcome.message, ...(outcome as any).result };
        } else {
          finalResult = (outcome as any).result;
        }
      } else {
        finalResult = outcome;
      }

      res.json({ result: finalResult });
    }),
  );

  return router;
}
