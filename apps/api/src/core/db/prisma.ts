// Shared shared PrismaClient for the process with connection_limit pooling cap (Phase 20 §4.4)
// and per-request SQL query counting / N+1 guard (Phase 20 §5(a)).
import { AsyncLocalStorage } from 'node:async_hooks';
import { PrismaClient } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import type { RequestHandler } from 'express';
import { env } from '../../config/env';
import { logger } from '../logger';

/** Appends connection_limit if absent so 2 processes stay well inside RDS t4g.medium connection limits. */
export function applyConnectionLimit(url: string, limit: number = env.PRISMA_CONNECTION_LIMIT): string {
  try {
    const parsed = new URL(url);
    if (!parsed.searchParams.has('connection_limit')) {
      parsed.searchParams.set('connection_limit', String(limit));
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

export interface QueryBudgetContext {
  count: number;
  limit: number;
  queries: string[];
  strict: boolean;
}

const queryBudgetStorage = new AsyncLocalStorage<QueryBudgetContext>();

export function runWithQueryBudget<T>(
  options: { limit?: number; strict?: boolean },
  fn: () => Promise<T>,
): Promise<{ result: T; count: number; queries: string[] }> {
  const ctx: QueryBudgetContext = {
    count: 0,
    limit: options.limit ?? env.N_PLUS_ONE_THRESHOLD,
    queries: [],
    strict: options.strict ?? false,
  };
  return queryBudgetStorage.run(ctx, async () => {
    const result = await fn();
    return { result, count: ctx.count, queries: ctx.queries };
  });
}

export function getRequestQueryCount(): number {
  return queryBudgetStorage.getStore()?.count ?? 0;
}

/** Express middleware attaching X-Query-Count and warning (or throwing in strict test header mode) on > 25 queries. */
export const queryBudgetMiddleware: RequestHandler = (req, res, next) => {
  const strict = req.headers['x-assert-no-n-plus-one'] === '1';
  const ctx: QueryBudgetContext = {
    count: 0,
    limit: env.N_PLUS_ONE_THRESHOLD,
    queries: [],
    strict,
  };
  const origEnd = res.end.bind(res);
  res.end = ((...args: Parameters<typeof res.end>) => {
    if (!res.headersSent) {
      res.setHeader('X-Query-Count', String(ctx.count));
    }
    if (ctx.count > ctx.limit) {
      logger.warn(
        { method: req.method, path: req.originalUrl, queryCount: ctx.count, limit: ctx.limit },
        'N+1 query budget exceeded',
      );
    }
    return origEnd(...args);
  }) as typeof res.end;
  queryBudgetStorage.run(ctx, next);
};

export const prisma = new PrismaClient({
  datasources: { db: { url: applyConnectionLimit(env.DATABASE_URL, env.PRISMA_CONNECTION_LIMIT) } },
});

prisma.$use(async (params, next) => {
  const store = queryBudgetStorage.getStore();
  if (store) {
    store.count += 1;
    if (store.queries.length < 100) {
      store.queries.push(`${params.model ?? '$raw'}.${params.action}`);
    }
    if (store.strict && store.count > store.limit) {
      throw new Error(
        `N+1 guard tripped: ${store.count} queries exceeded limit ${store.limit} (${store.queries.slice(-5).join(', ')})`,
      );
    }
  }
  return next(params);
});

/** Either the root client or a transaction client. */
export type Db = Prisma.TransactionClient;
