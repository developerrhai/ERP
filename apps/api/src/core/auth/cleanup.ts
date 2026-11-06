// Daily cleanup for expired sessions, MFA challenges, and password reset tokens.
// Audit logs are NEVER deleted.
import { prisma } from '../db/prisma';
import type { Db } from '../db/prisma';
import { logger } from '../logger';

export async function runDailyCleanup(db: Db = prisma): Promise<{
  sessionsDeleted: number;
  challengesDeleted: number;
  tokensDeleted: number;
}> {
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 3600_000);
  const oneDayAgo = new Date(Date.now() - 24 * 3600_000);
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600_000);

  const sessions = await db.session.deleteMany({
    where: {
      OR: [
        { revokedAt: { lt: ninetyDaysAgo } },
        { expiresAt: { lt: ninetyDaysAgo } },
      ],
    },
  });

  const challenges = await db.mfaChallenge.deleteMany({
    where: {
      createdAt: { lt: oneDayAgo },
    },
  });

  const tokens = await db.passwordResetToken.deleteMany({
    where: {
      createdAt: { lt: sevenDaysAgo },
    },
  });

  logger.info(
    {
      sessionsDeleted: sessions.count,
      challengesDeleted: challenges.count,
      tokensDeleted: tokens.count,
    },
    'Daily security cleanup executed',
  );

  return {
    sessionsDeleted: sessions.count,
    challengesDeleted: challenges.count,
    tokensDeleted: tokens.count,
  };
}
