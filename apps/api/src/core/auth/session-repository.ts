// The only code that touches the sessions table. Used by authenticate (per-request DB re-check),
// the auth service (login/refresh/logout) and the users service (revoke on deactivate/reset).
import type { Session, User } from '@prisma/client';
import { prisma } from '../db/prisma';
import type { Db } from '../db/prisma';
import { env } from '../../config/env';

export type RevokeReason =
  | 'rotated'
  | 'reuse_detected'
  | 'logout'
  | 'logout_all'
  | 'password_changed'
  | 'password_reset'
  | 'deactivated';

export type SessionWithUser = Session & { user: User };

export interface NewSession {
  userId: string;
  familyId: string;
  refreshTokenHash: string;
  userAgent: string | null;
  ip: string | null;
  expiresAt: Date;
}

/** Live = not revoked, before its absolute expiry, and refreshed within the idle window. */
export function isSessionLive(session: Session, now: Date = new Date()): boolean {
  if (session.revokedAt) return false;
  if (session.expiresAt.getTime() <= now.getTime()) return false;
  const idleDeadline = session.lastUsedAt.getTime() + env.SESSION_IDLE_MINUTES * 60_000;
  return idleDeadline > now.getTime();
}

export const sessionRepository = {
  create(data: NewSession, db: Db = prisma): Promise<Session> {
    return db.session.create({ data });
  },

  findWithUser(id: string, db: Db = prisma): Promise<SessionWithUser | null> {
    return db.session.findUnique({ where: { id }, include: { user: true } });
  },

  findByTokenHashWithUser(hash: string, db: Db = prisma): Promise<SessionWithUser | null> {
    return db.session.findUnique({ where: { refreshTokenHash: hash }, include: { user: true } });
  },

  /** Revokes one session only if it is still unrevoked; returns false if someone got there first. */
  async revokeIfActive(id: string, reason: RevokeReason, db: Db = prisma): Promise<boolean> {
    const result = await db.session.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
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

  async revokeFamily(familyId: string, reason: RevokeReason, db: Db = prisma): Promise<number> {
    const result = await db.session.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    return result.count;
  },

  async revokeAllForUser(userId: string, reason: RevokeReason, db: Db = prisma): Promise<number> {
    const result = await db.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    return result.count;
  },
};
