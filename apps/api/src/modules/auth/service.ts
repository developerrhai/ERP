// Authentication rules (CONTRACT §6, Phase 01): generic login failures, lockout, session creation,
// MFA challenge-response, refresh-token rotation with family-wide reuse detection, session cap,
// my sessions, password reset, logout and change-password.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { User } from '@prisma/client';
import * as OTPAuth from 'otpauth';
import { env } from '../../config/env';
import type { AuthContext, RequestMeta } from '../../core/auth/auth-context';
import {
  checkPasswordPolicy,
  dummyVerify,
  hashPassword,
  verifyPassword,
} from '../../core/auth/password';
import { getSecurityPolicy } from '../../core/auth/security-policy';
import { decryptMfaSecret } from '../../core/auth/mfa-crypto';
import { isSessionLive, sessionRepository } from '../../core/auth/session-repository';
import { generateRefreshToken, hashRefreshToken, signAccessToken } from '../../core/auth/tokens';
import { unknownIdentifierFailures } from '../../core/auth/unknown-identifier-lockout';
import { recordAudit } from '../../core/audit/audit-service';
import { prisma } from '../../core/db/prisma';
import type { Db } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { logger } from '../../core/logger';
import { mailService } from '../../core/mail/mail-service';
import { toUserDto } from '../users/dto';
import type { UserDto } from '../users/dto';
import { userRepository } from '../users/repository';
import { emailSchema, loginIdSchema } from '../users/schemas';
import type {
  ChangePasswordInput,
  LoginInput,
  MfaVerifyInput,
  PasswordResetConfirmInput,
  PasswordResetRequestInput,
} from './schemas';

export interface IssuedSession {
  accessToken: string;
  expiresIn: number;
  user: UserDto;
  refreshToken: string;
  refreshExpiresAt: Date;
}

export type LoginResult =
  | IssuedSession
  | { mfaRequired: true; challengeId: string; expiresIn: number };

function minutesUntil(date: Date): number {
  return Math.max(1, Math.ceil((date.getTime() - Date.now()) / 60_000));
}

async function issueSession(
  user: User,
  meta: RequestMeta,
  family: { familyId: string; familyStartedAt: Date } | null,
  db: Db,
): Promise<IssuedSession> {
  const policy = await getSecurityPolicy(db);
  const now = Date.now();
  const maxFamilyDuration = policy.absoluteHours * 3600_000;
  const familyStartedAt = family?.familyStartedAt ?? new Date(now);
  const familyEnd = familyStartedAt.getTime() + maxFamilyDuration;
  const twelveHours = now + 12 * 3600_000;
  const expiresAt = new Date(Math.min(familyEnd, twelveHours));

  const refreshToken = generateRefreshToken();
  const session = await sessionRepository.create(
    {
      userId: user.id,
      familyId: family?.familyId ?? randomUUID(),
      familyStartedAt,
      refreshTokenHash: hashRefreshToken(refreshToken),
      userAgent: meta.userAgent,
      ip: meta.ip,
      mfaVerified: user.mfaEnabled,
      expiresAt,
    },
    db,
  );

  const roleCode =
    typeof (user as any).role === 'string'
      ? (user as any).role
      : ((user as any).role?.code ?? (user as any).roleCode ?? 'EMPLOYEE');

  const { accessToken, expiresIn } = signAccessToken({
    sub: user.id,
    sid: session.id,
    role: roleCode,
  });

  const mfaSetupRequired = Boolean(
    policy.mfaRequiredForAdmins &&
    (roleCode === 'SUPER_ADMIN' || roleCode === 'ADMIN' || roleCode === 'SUPER_USER' || roleCode === 'ADMINISTRATOR') &&
    !user.mfaEnabled,
  );

  return {
    accessToken,
    expiresIn,
    user: toUserDto(await userRepository.withUnits(user, db), { mfaSetupRequired }),
    refreshToken,
    refreshExpiresAt: expiresAt,
  };
}

/**
 * Counts a failed password atomically and locks at the threshold per security policy.
 * Writes ACCOUNT_LOCKED once, by the attempt that set the lock. Returns the lock expiry if locked.
 */
async function registerFailure(user: User, meta: RequestMeta): Promise<Date | null> {
  const policy = await getSecurityPolicy();
  const result = await userRepository.registerFailedLogin(
    user.id,
    policy.maxFailedLogins,
    policy.lockoutMinutes,
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

/** Enforces the maxSessionsPerUser cap by revoking the oldest live family in tx. */
async function enforceSessionCap(userId: string, tx: Db): Promise<void> {
  const policy = await getSecurityPolicy(tx);
  const liveSessions = await sessionRepository.findLiveForUser(userId, tx);
  if (liveSessions.length >= policy.maxSessionsPerUser && liveSessions[0]) {
    await sessionRepository.revokeFamily(liveSessions[0].familyId, 'session_cap', null, tx);
  }
}

export const authService = {
  async login(input: LoginInput, meta: RequestMeta): Promise<LoginResult> {
    const user = await userRepository.findByIdentifier(input.identifier);
    if (!user) {
      await dummyVerify(input.password);
      const unknown = unknownIdentifierFailures.registerFailure(input.identifier);
      await auditLoginFailed(
        input.identifier,
        unknown.locked ? 'locked' : 'unknown_user',
        null,
        meta,
      );
      if (unknown.locked && unknown.lockedUntil) {
        throw Errors.accountLocked(minutesUntil(unknown.lockedUntil), false);
      }
      throw Errors.invalidCredentials();
    }

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

    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      await auditLoginFailed(input.identifier, 'locked', user, meta);
      throw Errors.accountLocked(minutesUntil(user.lockedUntil));
    }

    // Step 2: If MFA is enabled on user account, issue challenge and require verification
    if (user.mfaEnabled) {
      const challengeId = randomUUID();
      await prisma.mfaChallenge.create({
        data: {
          id: challengeId,
          userId: user.id,
          attempts: 0,
          expiresAt: new Date(Date.now() + 300_000), // 5 minutes
          ip: meta.ip,
          userAgent: meta.userAgent,
        },
      });
      await recordAudit({
        action: 'MFA_CHALLENGE_ISSUED',
        actorId: user.id,
        targetType: 'User',
        targetId: user.id,
        meta,
        detail: { challengeId },
      });
      return {
        mfaRequired: true,
        challengeId,
        expiresIn: 300,
      };
    }

    // Normal sign-in without MFA
    const issued = await prisma.$transaction(async (tx) => {
      const fresh = await userRepository.recordSuccessfulLogin(user.id, new Date(), meta.ip, tx);
      if (!fresh) return null;
      await enforceSessionCap(fresh.id, tx);
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
      const policy = await getSecurityPolicy();
      throw Errors.accountLocked(
        current?.lockedUntil ? minutesUntil(current.lockedUntil) : policy.lockoutMinutes,
      );
    }
    return issued;
  },

  /**
   * Verifies an MFA challenge with row-level locking (FOR UPDATE). Accepts 6-digit TOTP
   * (with replay guard) or 8-char recovery code.
   */
  async verifyMfa(input: MfaVerifyInput, meta: RequestMeta): Promise<IssuedSession> {
    const rawCode = input.code.trim();
    const isRecoveryCode = /^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/i.test(rawCode);
    const isTotp = /^\d{6}$/.test(rawCode);

    return prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<
          Array<{
            id: string;
            user_id: string;
            attempts: number;
            expires_at: Date;
            consumed_at: Date | null;
          }>
        >`SELECT id, user_id, attempts, expires_at, consumed_at FROM mfa_challenges WHERE id = ${input.challengeId}::uuid FOR UPDATE`;

        const challenge = rows[0];
        if (!challenge) {
          throw Errors.mfaChallengeExpired();
        }
        if (challenge.consumed_at || challenge.expires_at.getTime() <= Date.now()) {
          throw Errors.mfaChallengeExpired();
        }
        if (challenge.attempts >= 5) {
          throw Errors.mfaChallengeExpired();
        }

        const user = await tx.user.findUniqueOrThrow({ where: { id: challenge.user_id } });
        if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
          throw Errors.accountLocked(minutesUntil(user.lockedUntil));
        }

        let verified = false;
        let usedRecovery = false;

        if (isRecoveryCode) {
          const formattedCode = rawCode.toUpperCase();
          const codeHash = createHash('sha256').update(formattedCode).digest('hex');
          const recoveryRow = await tx.userMfaRecoveryCode.findFirst({
            where: { userId: user.id, codeHash, usedAt: null },
          });
          if (recoveryRow) {
            await tx.userMfaRecoveryCode.update({
              where: { id: recoveryRow.id },
              data: { usedAt: new Date() },
            });
            verified = true;
            usedRecovery = true;
          }
        } else if (isTotp && user.mfaSecretEnc) {
          const secretBase32 = decryptMfaSecret(user.mfaSecretEnc);
          const totp = new OTPAuth.TOTP({
            issuer: 'Sawant Group ERP',
            label: user.loginId,
            algorithm: 'SHA1',
            digits: 6,
            period: 30,
            secret: OTPAuth.Secret.fromBase32(secretBase32),
          });
          const delta = totp.validate({ token: rawCode, window: 1 });
          if (delta !== null) {
            const now = Date.now();
            const currentStep = Math.floor(now / 30_000) + delta;
            if (user.mfaLastStep !== null && BigInt(currentStep) <= user.mfaLastStep) {
              // Replay detected
              verified = false;
            } else {
              await tx.user.update({
                where: { id: user.id },
                data: { mfaLastStep: BigInt(currentStep) },
              });
              verified = true;
            }
          }
        }

        if (!verified) {
          const nextAttempts = challenge.attempts + 1;
          await tx.mfaChallenge.update({
            where: { id: challenge.id },
            data: { attempts: nextAttempts },
          });
          await recordAudit(
            {
              action: 'MFA_FAILED',
              actorId: user.id,
              targetType: 'User',
              targetId: user.id,
              meta,
              detail: { challengeId: challenge.id, attempts: nextAttempts },
            },
            tx,
          );
          const lockedUntil = await registerFailure(user, meta);
          if (lockedUntil) {
            throw Errors.accountLocked(minutesUntil(lockedUntil));
          }
          if (nextAttempts >= 5) {
            throw Errors.mfaChallengeExpired();
          }
          throw Errors.mfaCodeInvalid();
        }

        // Consume challenge
        await tx.mfaChallenge.update({
          where: { id: challenge.id },
          data: { consumedAt: new Date() },
        });

        if (usedRecovery) {
          await recordAudit(
            {
              action: 'MFA_RECOVERY_CODE_USED',
              actorId: user.id,
              targetType: 'User',
              targetId: user.id,
              meta,
              detail: { challengeId: challenge.id },
            },
            tx,
          );
        }

        await recordAudit(
          {
            action: 'MFA_SUCCESS',
            actorId: user.id,
            targetType: 'User',
            targetId: user.id,
            meta,
            detail: { challengeId: challenge.id, method: usedRecovery ? 'recovery_code' : 'totp' },
          },
          tx,
        );

        const fresh = await userRepository.recordSuccessfulLogin(user.id, new Date(), meta.ip, tx);
        if (!fresh) {
          const policy = await getSecurityPolicy(tx);
          throw Errors.accountLocked(policy.lockoutMinutes);
        }

        await enforceSessionCap(fresh.id, tx);
        return issueSession(fresh, meta, null, tx);
      },
      { maxWait: 10_000, timeout: 10_000 },
    );
  },

  async refresh(rawToken: string | undefined, meta: RequestMeta): Promise<IssuedSession> {
    if (!rawToken) throw Errors.unauthenticated('No session.');
    const session = await sessionRepository.findByTokenHashWithUser(hashRefreshToken(rawToken));
    if (!session) throw Errors.sessionExpired();

    if (session.revokedAt) {
      if (session.revokedReason === 'rotated') {
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
    const policy = await getSecurityPolicy();
    if (!isSessionLive(session, new Date(), policy) || session.user.status !== 'ACTIVE') {
      throw Errors.sessionExpired();
    }

    const rotated = await prisma.$transaction(async (tx) => {
      const won = await sessionRepository.revokeIfActive(session.id, 'rotated', null, tx);
      if (!won) return null;
      return issueSession(
        session.user,
        meta,
        { familyId: session.familyId, familyStartedAt: session.familyStartedAt },
        tx,
      );
    });
    if (!rotated) {
      if (await sessionRepository.claimRaceGrace(session.id)) {
        await handleRace(session.familyId, session.id, session.userId, meta);
        throw Errors.refreshRace();
      }
      await handleReuse(session.familyId, session.userId, meta);
      throw Errors.sessionExpired();
    }
    return rotated;
  },

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
    const revoked = await sessionRepository.revokeIfActive(target.sessionId, 'logout', target.userId);
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
    const revoked = await sessionRepository.revokeAllForUser(auth.userId, 'logout_all', auth.userId);
    await recordAudit({
      action: 'LOGOUT_ALL',
      actorId: auth.userId,
      targetType: 'User',
      targetId: auth.userId,
      meta,
      detail: { sessionsRevoked: revoked },
    });
  },

  async me(auth: AuthContext): Promise<UserDto> {
    const policy = await getSecurityPolicy();
    const isAdmin =
      auth.level >= 95 ||
      auth.roleCode === 'SUPER_USER' ||
      auth.roleCode === 'ADMINISTRATOR' ||
      auth.roleCode === 'SUPER_ADMIN' ||
      auth.roleCode === 'ADMIN';
    const mfaSetupRequired = Boolean(
      policy.mfaRequiredForAdmins &&
      isAdmin &&
      !auth.user.mfaEnabled,
    );
    const userWithUnits = await userRepository.withUnits(auth.user);
    return toUserDto(userWithUnits, { mfaSetupRequired });
  },

  async changePassword(
    auth: AuthContext,
    input: ChangePasswordInput,
    meta: RequestMeta,
  ): Promise<IssuedSession> {
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
        {
          passwordHash,
          passwordChangedAt: new Date(),
          mustChangePassword: false,
          failedLoginCount: 0,
          lockedUntil: null,
        },
        tx,
      );
      const revoked = await sessionRepository.revokeAllForUser(user.id, 'password_changed', user.id, tx);
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
      if (user.email) {
        void mailService.sendPasswordChanged(user.email);
      }
      return issued;
    });
  },

  /** My Sessions: list user's signed-in devices */
  async listSessions(auth: AuthContext) {
    const sessions = await sessionRepository.listForUser(auth.userId);
    const policy = await getSecurityPolicy();
    const now = new Date();
    return sessions.map((s) => ({
      id: s.id,
      familyId: s.familyId,
      userAgent: s.userAgent,
      ip: s.ip,
      createdAt: s.createdAt.toISOString(),
      lastUsedAt: s.lastUsedAt.toISOString(),
      isCurrent: s.id === auth.sessionId,
      isLive: isSessionLive(s, now, policy),
      mfaVerified: s.mfaVerified ?? false,
    }));
  },

  /** Sign out a specific device family */
  async revokeSession(auth: AuthContext, familyId: string, meta: RequestMeta): Promise<void> {
    if (auth.familyId && auth.familyId === familyId) {
      throw Errors.currentSession();
    }
    const count = await prisma.session.count({
      where: { familyId, userId: auth.userId, revokedAt: null },
    });
    if (count === 0) {
      throw Errors.notFound('Session not found.');
    }
    await sessionRepository.revokeFamily(familyId, 'user_revoked', auth.userId);
    await recordAudit({
      action: 'SESSION_REVOKED',
      actorId: auth.userId,
      targetType: 'Session',
      targetId: familyId,
      meta,
      detail: { familyId },
    });
  },

  /** Sign out all other devices */
  async revokeOtherSessions(auth: AuthContext, meta: RequestMeta): Promise<{ revoked: number }> {
    const keepFamilyId = auth.familyId ?? '';
    const revoked = await sessionRepository.revokeOthers(
      auth.userId,
      keepFamilyId,
      'user_revoked',
      auth.userId,
    );
    await recordAudit({
      action: 'SESSIONS_REVOKED_OTHERS',
      actorId: auth.userId,
      targetType: 'User',
      targetId: auth.userId,
      meta,
      detail: { revoked },
    });
    return { revoked };
  },

  /** Public password policy info */
  async getPasswordPolicy() {
    const policy = await getSecurityPolicy();
    return {
      passwordMinLength: policy.passwordMinLength,
      passwordMaxLength: 128,
      emailResetAvailable: mailService.isConfigured(),
    };
  },

  /** Request password reset email */
  async requestPasswordReset(
    input: PasswordResetRequestInput,
    meta: RequestMeta,
  ): Promise<void> {
    if (!mailService.isConfigured()) {
      throw Errors.featureDisabled(
        'Password reset via email is disabled because SMTP is not configured.',
      );
    }

    const start = Date.now();
    const cleanEmail = input.email.trim().toLowerCase();
    const user = await prisma.user.findFirst({
      where: { email: { equals: cleanEmail, mode: 'insensitive' }, status: 'ACTIVE' },
    });

    if (user && user.email) {
      const rawToken = randomBytes(32).toString('hex');
      const tokenHash = createHash('sha256').update(rawToken).digest('hex');
      const expiresAt = new Date(Date.now() + 30 * 60_000); // 30 minutes

      await prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash,
          expiresAt,
          requestedIp: meta.ip,
        },
      });

      const resetUrl = `${env.APP_BASE_URL}/reset-password#token=${rawToken}`;
      await mailService.sendPasswordReset(user.email, resetUrl);

      const emailHash = createHash('sha256').update(cleanEmail).digest('hex');
      await recordAudit({
        action: 'PASSWORD_RESET_REQUESTED',
        actorId: user.id,
        targetType: 'User',
        targetId: user.id,
        meta,
        detail: { emailHash },
      });
    }

    // Always delay ~300ms to prevent timing side-channel attacks on whether email exists
    const elapsed = Date.now() - start;
    if (elapsed < 300) {
      await new Promise((r) => setTimeout(r, 300 - elapsed));
    }
  },

  /** Confirm password reset with token */
  async confirmPasswordReset(
    input: PasswordResetConfirmInput,
    meta: RequestMeta,
  ): Promise<void> {
    const tokenHash = createHash('sha256').update(input.token.trim()).digest('hex');
    const now = new Date();

    await prisma.$transaction(async (tx) => {
      const resetToken = await tx.passwordResetToken.findFirst({
        where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
      });
      if (!resetToken) {
        throw Errors.resetLinkInvalid();
      }

      const user = await tx.user.findUniqueOrThrow({ where: { id: resetToken.userId } });
      const problem = checkPasswordPolicy(input.newPassword, user);
      if (problem) throw Errors.validation({ newPassword: problem });

      const sameAsCurrent = await verifyPassword(user.passwordHash, input.newPassword);
      if (sameAsCurrent) {
        throw Errors.validation({
          newPassword: 'New password must be different from the current one.',
        });
      }

      const passwordHash = await hashPassword(input.newPassword);
      await tx.passwordResetToken.update({
        where: { id: resetToken.id },
        data: { usedAt: now },
      });

      await tx.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          passwordChangedAt: now,
          mustChangePassword: false,
          failedLoginCount: 0,
          lockedUntil: null,
        },
      });

      await sessionRepository.revokeAllForUser(user.id, 'password_reset', null, tx);

      await recordAudit(
        {
          action: 'PASSWORD_RESET_COMPLETED',
          actorId: user.id,
          targetType: 'User',
          targetId: user.id,
          meta,
          detail: {},
        },
        tx,
      );

      if (user.email) {
        void mailService.sendPasswordChanged(user.email);
      }
    });
  },
};
