// Authentication rules (CONTRACT §6): generic login failures, lockout, session creation, refresh-token
// rotation with family-wide reuse detection, logout, logout-all and change-password.
import { randomUUID } from 'node:crypto';
import type { User } from '@prisma/client';
import { env } from '../../config/env';
import type { AuthContext, RequestMeta } from '../../core/auth/auth-context';
import {
  checkPasswordPolicy,
  dummyVerify,
  hashPassword,
  verifyPassword,
} from '../../core/auth/password';
import { isSessionLive, sessionRepository } from '../../core/auth/session-repository';
import { generateRefreshToken, hashRefreshToken, signAccessToken } from '../../core/auth/tokens';
import { unknownIdentifierFailures } from '../../core/auth/unknown-identifier-lockout';
import { recordAudit } from '../../core/audit/audit-service';
import { prisma } from '../../core/db/prisma';
import type { Db } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { logger } from '../../core/logger';
import { toUserDto } from '../users/dto';
import type { UserDto } from '../users/dto';
import { userRepository } from '../users/repository';
import { emailSchema, loginIdSchema } from '../users/schemas';
import type { ChangePasswordInput, LoginInput } from './schemas';

export const MAX_FAILED_LOGINS = 10;
export const LOCKOUT_MINUTES = 15;

export interface IssuedSession {
  accessToken: string;
  expiresIn: number;
  user: UserDto;
  refreshToken: string;
  refreshExpiresAt: Date;
}

function minutesUntil(date: Date): number {
  return Math.max(1, Math.ceil((date.getTime() - Date.now()) / 60_000));
}

async function issueSession(
  user: User,
  meta: RequestMeta,
  family: { familyId: string; expiresAt: Date } | null,
  db: Db,
): Promise<IssuedSession> {
  const refreshToken = generateRefreshToken();
  const expiresAt =
    family?.expiresAt ?? new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60_000);
  const session = await sessionRepository.create(
    {
      userId: user.id,
      familyId: family?.familyId ?? randomUUID(),
      refreshTokenHash: hashRefreshToken(refreshToken),
      userAgent: meta.userAgent,
      ip: meta.ip,
      expiresAt,
    },
    db,
  );
  const { accessToken, expiresIn } = signAccessToken({
    sub: user.id,
    sid: session.id,
    role: user.role,
  });
  return {
    accessToken,
    expiresIn,
    user: toUserDto(user),
    refreshToken,
    refreshExpiresAt: expiresAt,
  };
}

/**
 * Counts a failed password atomically and locks at the threshold (see the repository). Writes
 * ACCOUNT_LOCKED once, by the attempt that set the lock. Returns the lock expiry if locked.
 */
async function registerFailure(user: User, meta: RequestMeta): Promise<Date | null> {
  const result = await userRepository.registerFailedLogin(
    user.id,
    MAX_FAILED_LOGINS,
    LOCKOUT_MINUTES,
  );
  if (result.justLocked && result.lockedUntil) {
    await recordAudit({
      action: 'ACCOUNT_LOCKED',
      actorId: user.id,
      targetType: 'User',
      targetId: user.id,
      meta,
      detail: { failedAttempts: result.count, lockedUntil: result.lockedUntil.toISOString() },
    });
    logger.warn({ userId: user.id }, 'Account locked after repeated failed logins');
  }
  return result.locked ? result.lockedUntil : null;
}

const INVALID_FORMAT = '<invalid-format>';

/**
 * The identifier as stored in the audit log: only if it looks like a login ID or an email, so a
 * password typed into the ID field by mistake is never persisted.
 */
export function auditableIdentifier(identifier: string): string {
  if (loginIdSchema.safeParse(identifier).success) return identifier;
  const email = emailSchema.safeParse(identifier);
  if (email.success && email.data !== null) return identifier;
  return INVALID_FORMAT;
}

async function auditLoginFailed(
  identifier: string,
  reason: string,
  user: User | null,
  meta: RequestMeta,
): Promise<void> {
  await recordAudit({
    action: 'LOGIN_FAILED',
    actorId: user?.id ?? null,
    targetType: user ? 'User' : null,
    targetId: user?.id ?? null,
    meta,
    detail: { identifier: auditableIdentifier(identifier), reason },
  });
}

/**
 * Two tabs refreshing with the same cookie is normal, not theft. A rotated token presented again
 * within REFRESH_REUSE_GRACE_SECONDS of its rotation gets 409 REFRESH_RACE (the other tab already
 * holds the new cookie); only later replays are treated as reuse and revoke the family.
 */
function withinReuseGrace(revokedAt: Date): boolean {
  return Date.now() - revokedAt.getTime() <= env.REFRESH_REUSE_GRACE_SECONDS * 1000;
}

async function handleRace(
  familyId: string,
  sessionId: string,
  userId: string,
  meta: RequestMeta,
): Promise<void> {
  await recordAudit({
    action: 'REFRESH_RACE',
    actorId: userId,
    targetType: 'Session',
    targetId: familyId,
    meta,
    detail: { familyId, sessionId },
  });
}

async function handleReuse(familyId: string, userId: string, meta: RequestMeta): Promise<void> {
  const revoked = await sessionRepository.revokeFamily(familyId, 'reuse_detected');
  await recordAudit({
    action: 'TOKEN_REUSE_DETECTED',
    actorId: userId,
    targetType: 'Session',
    targetId: familyId,
    meta,
    detail: { familyId, sessionsRevoked: revoked },
  });
  logger.warn({ userId, familyId }, 'Refresh token reuse detected; session family revoked');
}

export const authService = {
  async login(input: LoginInput, meta: RequestMeta): Promise<IssuedSession> {
    const user = await userRepository.findByIdentifier(input.identifier);
    if (!user) {
      // Same Argon2 cost and the same lockout behaviour as a real account, so neither timing nor
      // a 423 reveals whether the identifier exists.
      await dummyVerify(input.password);
      const unknown = unknownIdentifierFailures.registerFailure(input.identifier);
      await auditLoginFailed(
        input.identifier,
        unknown.locked ? 'locked' : 'unknown_user',
        null,
        meta,
      );
      if (unknown.locked && unknown.lockedUntil) {
        throw Errors.accountLocked(minutesUntil(unknown.lockedUntil));
      }
      throw Errors.invalidCredentials();
    }
    // Always run the verify so every branch costs the same Argon2 time. Lock state is decided
    // afterwards, atomically, so parallel attempts cannot race past the lockout.
    const passwordOk = await verifyPassword(user.passwordHash, input.password);
    if (user.status !== 'ACTIVE') {
      await auditLoginFailed(input.identifier, 'inactive', user, meta);
      throw Errors.invalidCredentials();
    }
    if (!passwordOk) {
      const lockedUntil = await registerFailure(user, meta);
      await auditLoginFailed(input.identifier, lockedUntil ? 'locked' : 'bad_password', user, meta);
      if (lockedUntil) throw Errors.accountLocked(minutesUntil(lockedUntil));
      throw Errors.invalidCredentials();
    }
    const issued = await prisma.$transaction(async (tx) => {
      // Conditional: succeeds only if no lock is active; a correct password never clears a lock.
      const fresh = await userRepository.recordSuccessfulLogin(user.id, new Date(), tx);
      if (!fresh) return null;
      const session = await issueSession(fresh, meta, null, tx);
      await recordAudit(
        {
          action: 'LOGIN_SUCCESS',
          actorId: fresh.id,
          targetType: 'User',
          targetId: fresh.id,
          meta,
          detail: { identifier: auditableIdentifier(input.identifier) },
        },
        tx,
      );
      return session;
    });
    if (!issued) {
      await auditLoginFailed(input.identifier, 'locked', user, meta);
      const current = await userRepository.findById(user.id);
      throw Errors.accountLocked(
        current?.lockedUntil ? minutesUntil(current.lockedUntil) : LOCKOUT_MINUTES,
      );
    }
    return issued;
  },

  async refresh(rawToken: string | undefined, meta: RequestMeta): Promise<IssuedSession> {
    if (!rawToken) throw Errors.unauthenticated('No session.');
    const session = await sessionRepository.findByTokenHashWithUser(hashRefreshToken(rawToken));
    if (!session) throw Errors.sessionExpired();

    if (session.revokedAt) {
      if (session.revokedReason === 'rotated') {
        // The grace is granted once per rotated token; a second replay is reuse even inside it.
        if (
          withinReuseGrace(session.revokedAt) &&
          (await sessionRepository.claimRaceGrace(session.id))
        ) {
          await handleRace(session.familyId, session.id, session.userId, meta);
          throw Errors.refreshRace();
        }
        await handleReuse(session.familyId, session.userId, meta);
      }
      throw Errors.sessionExpired();
    }
    if (!isSessionLive(session) || session.user.status !== 'ACTIVE') throw Errors.sessionExpired();

    const rotated = await prisma.$transaction(async (tx) => {
      // Conditional revoke: if a concurrent refresh rotated this token a moment ago, we lost a race.
      const won = await sessionRepository.revokeIfActive(session.id, 'rotated', tx);
      if (!won) return null;
      return issueSession(
        session.user,
        meta,
        { familyId: session.familyId, expiresAt: session.expiresAt },
        tx,
      );
    });
    if (!rotated) {
      // Another request rotated it just now (inside the window by definition), but grace is once only.
      if (await sessionRepository.claimRaceGrace(session.id)) {
        await handleRace(session.familyId, session.id, session.userId, meta);
        throw Errors.refreshRace();
      }
      await handleReuse(session.familyId, session.userId, meta);
      throw Errors.sessionExpired();
    }
    return rotated;
  },

  /** Revokes the session named by the refresh cookie, or failing that by the Bearer token's sid. */
  async logout(
    rawToken: string | undefined,
    bearerSession: { sessionId: string; userId: string } | null,
    meta: RequestMeta,
  ): Promise<void> {
    let target: { sessionId: string; userId: string } | null = null;
    if (rawToken) {
      const session = await sessionRepository.findByTokenHashWithUser(hashRefreshToken(rawToken));
      if (session) target = { sessionId: session.id, userId: session.userId };
    }
    target ??= bearerSession;
    if (!target) return;
    const revoked = await sessionRepository.revokeIfActive(target.sessionId, 'logout');
    if (revoked) {
      await recordAudit({
        action: 'LOGOUT',
        actorId: target.userId,
        targetType: 'Session',
        targetId: target.sessionId,
        meta,
      });
    }
  },

  async logoutAll(auth: AuthContext, meta: RequestMeta): Promise<void> {
    const revoked = await sessionRepository.revokeAllForUser(auth.userId, 'logout_all');
    await recordAudit({
      action: 'LOGOUT_ALL',
      actorId: auth.userId,
      targetType: 'User',
      targetId: auth.userId,
      meta,
      detail: { sessionsRevoked: revoked },
    });
  },

  me(auth: AuthContext): UserDto {
    return toUserDto(auth.user);
  },

  /**
   * Verifies the current password, applies the policy, clears mustChangePassword, revokes every
   * existing session (so all OTHER devices are signed out) and issues a brand-new session for the caller.
   */
  async changePassword(
    auth: AuthContext,
    input: ChangePasswordInput,
    meta: RequestMeta,
  ): Promise<IssuedSession> {
    // Re-read: lock state may have changed since authenticate loaded the user.
    const user = await userRepository.findById(auth.userId);
    if (!user) throw Errors.sessionExpired();
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      throw Errors.accountLocked(minutesUntil(user.lockedUntil));
    }
    if (!(await verifyPassword(user.passwordHash, input.currentPassword))) {
      const lockedUntil = await registerFailure(user, meta);
      if (lockedUntil) throw Errors.accountLocked(minutesUntil(lockedUntil));
      throw Errors.validation({ currentPassword: 'Current password is incorrect.' });
    }
    const problem = checkPasswordPolicy(input.newPassword, user);
    if (problem) throw Errors.validation({ newPassword: problem });
    if (input.newPassword === input.currentPassword) {
      throw Errors.validation({
        newPassword: 'New password must be different from the current one.',
      });
    }
    const passwordHash = await hashPassword(input.newPassword);
    return prisma.$transaction(async (tx) => {
      const updated = await userRepository.update(
        user.id,
        { passwordHash, mustChangePassword: false, failedLoginCount: 0, lockedUntil: null },
        tx,
      );
      const revoked = await sessionRepository.revokeAllForUser(user.id, 'password_changed', tx);
      const issued = await issueSession(updated, meta, null, tx);
      await recordAudit(
        {
          action: 'PASSWORD_CHANGED',
          actorId: user.id,
          targetType: 'User',
          targetId: user.id,
          meta,
          detail: { otherSessionsRevoked: Math.max(0, revoked - 1) },
        },
        tx,
      );
      return issued;
    });
  },
};
