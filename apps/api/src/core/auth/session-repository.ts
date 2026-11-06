import type { Role, Session, User, UserDepartment } from '@prisma/client';
import { prisma } from '../db/prisma';
import type { Db } from '../db/prisma';
import { env } from '../../config/env';
import type { SecurityPolicy } from './security-policy';

export type RevokeReason =
  | 'rotated'
  | 'reuse_detected'
  | 'logout'
  | 'logout_all'
  | 'password_changed'
  | 'password_reset'
  | 'deactivated'
  | 'admin_revoked'
  | 'user_revoked'
  | 'idle'
  | 'session_cap'
  | 'mfa_reset'
  | 'policy_migration';

export type SessionWithUser = Session & {
  user: User & { role: Role; extraDepartments: UserDepartment[] };
};

export interface NewSession {
  userId: string;
  familyId: string;
  familyStartedAt?: Date;
  refreshTokenHash: string;
  userAgent: string | null;
  ip: string | null;
  mfaVerified?: boolean;
  expiresAt: Date;
}

/** Live = not revoked, before its absolute expiry, and refreshed within the idle window. */
export function isSessionLive(
  session: Session,
  now: Date = new Date(),
  policy?: SecurityPolicy,
): boolean {
  if (session.revokedAt) return false;
  if (session.expiresAt.getTime() <= now.getTime()) return false;

  const idleMinutes = policy?.idleMinutes ?? env.SESSION_IDLE_MINUTES;
  const absoluteHours = policy?.absoluteHours ?? 12;

  const familyStart = session.familyStartedAt ?? session.createdAt;
  const absoluteDeadline = familyStart.getTime() + absoluteHours * 3600_000;
  if (absoluteDeadline <= now.getTime()) return false;

  const idleDeadline = session.lastUsedAt.getTime() + idleMinutes * 60_000;
  return idleDeadline > now.getTime();
}

function parseRevokeArgs(
  arg3?: string | null | Db,
  arg4?: Db,
): { revokedById: string | null; db: Db } {
  if (typeof arg3 === 'string' || arg3 === null) {
    return { revokedById: arg3 ?? null, db: arg4 ?? prisma };
  }
  if (arg3 && typeof arg3 === 'object') {
    return { revokedById: null, db: arg3 };
  }
  return { revokedById: null, db: arg4 ?? prisma };
}

export const sessionRepository = {
  create(data: NewSession, db: Db = prisma): Promise<Session> {
    return db.session.create({ data });
  },

  findWithUser(id: string, db: Db = prisma): Promise<SessionWithUser | null> {
    return db.session.findUnique({
      where: { id },
      include: { user: { include: { role: true, extraDepartments: true } } },
    });
  },

  findByTokenHashWithUser(hash: string, db: Db = prisma): Promise<SessionWithUser | null> {
    return db.session.findUnique({
      where: { refreshTokenHash: hash },
      include: { user: { include: { role: true, extraDepartments: true } } },
    });
  },

  /** Revokes one session only if it is still unrevoked; returns false if someone got there first. */
  async revokeIfActive(
    id: string,
    reason: RevokeReason,
    revokedByIdOrDb?: string | null | Db,
    dbOrNothing?: Db,
  ): Promise<boolean> {
    const { revokedById, db } = parseRevokeArgs(revokedByIdOrDb, dbOrNothing);
    const result = await db.session.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason, revokedById },
    });
    return result.count === 1;
  },

  /**
   * Atomically claims the one-time REFRESH_RACE grace for a rotated session. Returns false if it was
   * already used, so a second replay of the same rotated token is treated as reuse.
   */
  async claimRaceGrace(id: string, db: Db = prisma): Promise<boolean> {
    const result = await db.session.updateMany({
      where: { id, revokedReason: 'rotated', graceUsedAt: null },
      data: { graceUsedAt: new Date() },
    });
    return result.count === 1;
  },

  async revokeFamily(
    familyId: string,
    reason: RevokeReason,
    revokedByIdOrDb?: string | null | Db,
    dbOrNothing?: Db,
  ): Promise<number> {
    const { revokedById, db } = parseRevokeArgs(revokedByIdOrDb, dbOrNothing);
    const result = await db.session.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason, revokedById },
    });
    return result.count;
  },

  async revokeAllForUser(
    userId: string,
    reason: RevokeReason,
    revokedByIdOrDb?: string | null | Db,
    dbOrNothing?: Db,
  ): Promise<number> {
    const { revokedById, db } = parseRevokeArgs(revokedByIdOrDb, dbOrNothing);
    const result = await db.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason, revokedById },
    });
    return result.count;
  },

  async revokeOthers(
    userId: string,
    keepFamilyId: string,
    reason: RevokeReason,
    revokedByIdOrDb?: string | null | Db,
    dbOrNothing?: Db,
  ): Promise<number> {
    const { revokedById, db } = parseRevokeArgs(revokedByIdOrDb, dbOrNothing);
    const result = await db.session.updateMany({
      where: { userId, familyId: { not: keepFamilyId }, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason, revokedById },
    });
    return result.count;
  },

  async touchLastUsedIfStale(id: string, threshold: Date, db: Db = prisma): Promise<boolean> {
    const result = await db.session.updateMany({
      where: { id, lastUsedAt: { lt: threshold }, revokedAt: null },
      data: { lastUsedAt: new Date() },
    });
    return result.count > 0;
  },

  findLiveForUser(userId: string, db: Db = prisma): Promise<Session[]> {
    return db.session.findMany({
      where: { userId, revokedAt: null },
      orderBy: { createdAt: 'asc' },
    });
  },

  listForUser(userId: string, db: Db = prisma): Promise<Session[]> {
    return db.session.findMany({
      where: { userId },
      orderBy: { lastUsedAt: 'desc' },
    });
  },
};
