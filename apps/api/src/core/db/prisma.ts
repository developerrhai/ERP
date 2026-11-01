// A single shared PrismaClient for the process. Repositories take an optional `Db` so the same
// function works inside or outside a transaction.
import { PrismaClient } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { env } from '../../config/env';

export const prisma = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });

/** Either the root client or a transaction client. */
export type Db = Prisma.TransactionClient;
