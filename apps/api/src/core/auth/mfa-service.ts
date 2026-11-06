// Multi-Factor Authentication (TOTP RFC 6238 + single-use recovery codes)
// Compliant with OWASP ASVS 5.0 and NIST SP 800-63B.
import { createHash, randomBytes } from 'node:crypto';
import * as OTPAuth from 'otpauth';
import QRCode from 'qrcode';
import { prisma } from '../db/prisma';
import type { Db } from '../db/prisma';
import { Errors } from '../http/errors';
import { recordAudit } from '../audit/audit-service';
import type { RequestMeta } from './auth-context';
import { decryptMfaSecret, encryptMfaSecret } from './mfa-crypto';
import { verifyPassword } from './password';
import { getSecurityPolicy } from './security-policy';
import { sessionRepository } from './session-repository';

export interface MfaSetupResult {
  secret: string;
  qrCode: string;
}

export interface MfaVerifyResult {
  valid: boolean;
  isRecoveryCode?: boolean;
}

export const mfaService = {
  /** Generate a new pending TOTP secret for setup */
  async startSetup(userId: string, currentPassword: string, db: Db = prisma): Promise<MfaSetupResult> {
    const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
    const pwOk = await verifyPassword(user.passwordHash, currentPassword);
    if (!pwOk) {
      throw Errors.invalidCredentials();
    }

    const secret = new OTPAuth.Secret({ size: 20 });
    const totp = new OTPAuth.TOTP({
      issuer: 'Sawant Group ERP',
      label: user.loginId,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret,
    });

    const qrCode = await QRCode.toDataURL(totp.toString());
    const pendingEnc = encryptMfaSecret(secret.base32);

    await db.user.update({
      where: { id: userId },
      data: { mfaPendingSecretEnc: pendingEnc },
    });

    return {
      secret: secret.base32,
      qrCode,
    };
  },

  /** Enable MFA with verification code and return 10 recovery codes */
  async enable(
    userId: string,
    code: string,
    meta: RequestMeta,
    db: Db = prisma,
  ): Promise<{ recoveryCodes: string[] }> {
    const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.mfaPendingSecretEnc) {
      throw Errors.badRequest('MFA setup was not initiated.');
    }

    const secretBase32 = decryptMfaSecret(user.mfaPendingSecretEnc);
    const totp = new OTPAuth.TOTP({
      issuer: 'Sawant Group ERP',
      label: user.loginId,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(secretBase32),
    });

    const delta = totp.validate({ token: code.trim(), window: 1 });
    if (delta === null) {
      throw Errors.mfaCodeInvalid();
    }

    // Generate 10 single-use recovery codes formatted as ABCD-1234
    const recoveryCodes: string[] = [];
    const codeRows: { codeHash: string }[] = [];

    for (let i = 0; i < 10; i++) {
      const part1 = randomBytes(2).toString('hex').toUpperCase();
      const part2 = randomBytes(2).toString('hex').toUpperCase();
      const rawCode = `${part1}-${part2}`;
      recoveryCodes.push(rawCode);
      const codeHash = createHash('sha256').update(rawCode).digest('hex');
      codeRows.push({ codeHash });
    }

    const now = new Date();
    const currentStep = Math.floor(now.getTime() / 30_000) + delta;

    await prisma.$transaction(async (tx) => {
      // Clear old codes if any
      await tx.userMfaRecoveryCode.deleteMany({ where: { userId } });

      // Save new recovery codes
      for (const row of codeRows) {
        await tx.userMfaRecoveryCode.create({
          data: {
            userId,
            codeHash: row.codeHash,
          },
        });
      }

      // Activate MFA
      await tx.user.update({
        where: { id: userId },
        data: {
          mfaEnabled: true,
          mfaSecretEnc: user.mfaPendingSecretEnc,
          mfaPendingSecretEnc: null,
          mfaEnrolledAt: now,
          mfaLastStep: BigInt(currentStep),
        },
      });

      // Revoke other sessions
      await tx.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now, revokedReason: 'user_revoked' },
      });

      await recordAudit(
        {
          action: 'MFA_ENABLED',
          actorId: userId,
          targetType: 'User',
          targetId: userId,
          meta,
          detail: { enrolledAt: now.toISOString() },
        },
        tx,
      );
    });

    return { recoveryCodes };
  },

  /** Disable MFA (requires password and code; blocked if policy forces MFA for admins) */
  async disable(
    userId: string,
    currentPassword: string,
    code: string,
    meta: RequestMeta,
    db: Db = prisma,
  ): Promise<void> {
    const user = await db.user.findUniqueOrThrow({ where: { id: userId }, include: { role: true } });
    if (!user.mfaEnabled || !user.mfaSecretEnc) {
      throw Errors.badRequest('MFA is not enabled.');
    }

    const policy = await getSecurityPolicy(db);
    const isAdmin =
      (user.role?.level ?? 0) >= 95 ||
      user.role?.code === 'SUPER_USER' ||
      user.role?.code === 'ADMINISTRATOR' ||
      (user as any).role === 'SUPER_ADMIN' ||
      (user as any).role === 'ADMIN';
    if (policy.mfaRequiredForAdmins && isAdmin) {
      throw Errors.mfaCannotBeDisabled();
    }

    const pwOk = await verifyPassword(user.passwordHash, currentPassword);
    if (!pwOk) {
      throw Errors.invalidCredentials();
    }

    const secretBase32 = decryptMfaSecret(user.mfaSecretEnc);
    const totp = new OTPAuth.TOTP({
      issuer: 'Sawant Group ERP',
      label: user.loginId,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(secretBase32),
    });

    const delta = totp.validate({ token: code.trim(), window: 1 });
    if (delta === null) {
      throw Errors.mfaCodeInvalid();
    }

    await prisma.$transaction(async (tx) => {
      await tx.userMfaRecoveryCode.deleteMany({ where: { userId } });
      await tx.user.update({
        where: { id: userId },
        data: {
          mfaEnabled: false,
          mfaSecretEnc: null,
          mfaPendingSecretEnc: null,
          mfaEnrolledAt: null,
          mfaLastStep: null,
        },
      });

      await recordAudit(
        {
          action: 'MFA_DISABLED',
          actorId: userId,
          targetType: 'User',
          targetId: userId,
          meta,
          detail: {},
        },
        tx,
      );
    });
  },

  /** Regenerate 10 new recovery codes */
  async regenerateRecoveryCodes(
    userId: string,
    currentPassword: string,
    code: string,
    meta: RequestMeta,
    db: Db = prisma,
  ): Promise<{ recoveryCodes: string[] }> {
    const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.mfaEnabled || !user.mfaSecretEnc) {
      throw Errors.badRequest('MFA is not enabled.');
    }

    const pwOk = await verifyPassword(user.passwordHash, currentPassword);
    if (!pwOk) {
      throw Errors.invalidCredentials();
    }

    const secretBase32 = decryptMfaSecret(user.mfaSecretEnc);
    const totp = new OTPAuth.TOTP({
      issuer: 'Sawant Group ERP',
      label: user.loginId,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(secretBase32),
    });

    const delta = totp.validate({ token: code.trim(), window: 1 });
    if (delta === null) {
      throw Errors.mfaCodeInvalid();
    }

    const recoveryCodes: string[] = [];
    const codeRows: { codeHash: string }[] = [];

    for (let i = 0; i < 10; i++) {
      const part1 = randomBytes(2).toString('hex').toUpperCase();
      const part2 = randomBytes(2).toString('hex').toUpperCase();
      const rawCode = `${part1}-${part2}`;
      recoveryCodes.push(rawCode);
      const codeHash = createHash('sha256').update(rawCode).digest('hex');
      codeRows.push({ codeHash });
    }

    await prisma.$transaction(async (tx) => {
      await tx.userMfaRecoveryCode.deleteMany({ where: { userId } });
      for (const row of codeRows) {
        await tx.userMfaRecoveryCode.create({
          data: {
            userId,
            codeHash: row.codeHash,
          },
        });
      }

      await recordAudit(
        {
          action: 'MFA_RECOVERY_REGENERATED',
          actorId: userId,
          targetType: 'User',
          targetId: userId,
          meta,
          detail: {},
        },
        tx,
      );
    });

    return { recoveryCodes };
  },

  /** Get MFA status for current user */
  async getStatus(userId: string, db: Db = prisma) {
    const user = await db.user.findUniqueOrThrow({ where: { id: userId }, include: { role: true } });
    const policy = await getSecurityPolicy(db);
    const codesRemaining = await db.userMfaRecoveryCode.count({
      where: { userId, usedAt: null },
    });

    const isEligible =
      (user.role?.level ?? 0) >= 95 ||
      user.role?.code === 'SUPER_USER' ||
      user.role?.code === 'ADMINISTRATOR' ||
      (user as any).role === 'SUPER_ADMIN' ||
      (user as any).role === 'ADMIN';
    const isRequired = isEligible && policy.mfaRequiredForAdmins;

    return {
      eligible: isEligible,
      enabled: user.mfaEnabled,
      required: isRequired,
      recoveryCodesRemaining: codesRemaining,
      enrolledAt: user.mfaEnrolledAt,
    };
  },
};
