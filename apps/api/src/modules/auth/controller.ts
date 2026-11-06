// HTTP layer for /auth: moves the refresh token between the `rt` cookie and the service, and shapes
// the {data:{accessToken, expiresIn, user}} replies. No business rules live here.
import type { Request, Response } from 'express';
import { requestMeta, requireAuth } from '../../core/auth/auth-context';
import { readBearer } from '../../core/auth/authenticate';
import { mfaService } from '../../core/auth/mfa-service';
import {
  REFRESH_COOKIE,
  clearRefreshCookie,
  setRefreshCookie,
  verifyAccessToken,
} from '../../core/auth/tokens';
import { AppError } from '../../core/http/errors';
import { validated } from '../../core/http/validate';
import {
  changePasswordSchema,
  familyIdParamSchema,
  loginSchema,
  mfaDisableSchema,
  mfaEnableSchema,
  mfaRecoveryCodesSchema,
  mfaSetupSchema,
  mfaVerifySchema,
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
} from './schemas';
import { authService } from './service';
import type { IssuedSession } from './service';

function readRefreshCookie(req: Request): string | undefined {
  const cookies = req.cookies as Record<string, unknown> | undefined;
  const value = cookies?.[REFRESH_COOKIE];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function sendSession(res: Response, issued: IssuedSession): void {
  setRefreshCookie(res, issued.refreshToken, issued.refreshExpiresAt);
  res.set('Cache-Control', 'no-store');
  res.json({
    data: { accessToken: issued.accessToken, expiresIn: issued.expiresIn, user: issued.user },
  });
}

/** Bearer is optional on logout: use it if valid, ignore it if not. */
function optionalBearerSession(req: Request): { sessionId: string; userId: string } | null {
  const token = readBearer(req.headers.authorization);
  if (!token) return null;
  try {
    const claims = verifyAccessToken(token);
    return { sessionId: claims.sid, userId: claims.sub };
  } catch {
    return null;
  }
}

export const authController = {
  login: async (req: Request, res: Response): Promise<void> => {
    const body = validated(res, 'body', loginSchema);
    const result = await authService.login(body, requestMeta(req));
    if ('mfaRequired' in result) {
      res.set('Cache-Control', 'no-store');
      res.json({ data: result });
      return;
    }
    sendSession(res, result);
  },

  verifyMfa: async (req: Request, res: Response): Promise<void> => {
    const body = validated(res, 'body', mfaVerifySchema);
    const session = await authService.verifyMfa(body, requestMeta(req));
    sendSession(res, session);
  },

  refresh: async (req: Request, res: Response): Promise<void> => {
    try {
      sendSession(res, await authService.refresh(readRefreshCookie(req), requestMeta(req)));
    } catch (err) {
      // On a refresh race the browser already holds the newer cookie from the other tab: keep it.
      if (!(err instanceof AppError && err.code === 'REFRESH_RACE')) clearRefreshCookie(res);
      throw err;
    }
  },

  logout: async (req: Request, res: Response): Promise<void> => {
    await authService.logout(readRefreshCookie(req), optionalBearerSession(req), requestMeta(req));
    clearRefreshCookie(res);
    res.status(204).end();
  },

  logoutAll: async (req: Request, res: Response): Promise<void> => {
    await authService.logoutAll(requireAuth(req), requestMeta(req));
    clearRefreshCookie(res);
    res.status(204).end();
  },

  me: async (req: Request, res: Response): Promise<void> => {
    res.set('Cache-Control', 'no-store');
    res.json({ data: await authService.me(requireAuth(req)) });
  },

  changePassword: async (req: Request, res: Response): Promise<void> => {
    const body = validated(res, 'body', changePasswordSchema);
    sendSession(res, await authService.changePassword(requireAuth(req), body, requestMeta(req)));
  },

  listSessions: async (req: Request, res: Response): Promise<void> => {
    res.set('Cache-Control', 'no-store');
    const sessions = await authService.listSessions(requireAuth(req));
    res.json({ data: sessions });
  },

  revokeSession: async (req: Request, res: Response): Promise<void> => {
    const params = validated(res, 'params', familyIdParamSchema);
    await authService.revokeSession(requireAuth(req), params.familyId, requestMeta(req));
    res.status(204).end();
  },

  revokeOtherSessions: async (req: Request, res: Response): Promise<void> => {
    const result = await authService.revokeOtherSessions(requireAuth(req), requestMeta(req));
    res.json({ data: result });
  },

  getMfaStatus: async (req: Request, res: Response): Promise<void> => {
    const status = await mfaService.getStatus(requireAuth(req).userId);
    res.json({ data: status });
  },

  setupMfa: async (req: Request, res: Response): Promise<void> => {
    const body = validated(res, 'body', mfaSetupSchema);
    const result = await mfaService.startSetup(requireAuth(req).userId, body.currentPassword);
    res.json({ data: result });
  },

  enableMfa: async (req: Request, res: Response): Promise<void> => {
    const body = validated(res, 'body', mfaEnableSchema);
    const result = await mfaService.enable(requireAuth(req).userId, body.code, requestMeta(req));
    res.json({ data: result });
  },

  disableMfa: async (req: Request, res: Response): Promise<void> => {
    const body = validated(res, 'body', mfaDisableSchema);
    await mfaService.disable(requireAuth(req).userId, body.currentPassword, body.code, requestMeta(req));
    res.status(204).end();
  },

  regenerateRecoveryCodes: async (req: Request, res: Response): Promise<void> => {
    const body = validated(res, 'body', mfaRecoveryCodesSchema);
    const result = await mfaService.regenerateRecoveryCodes(
      requireAuth(req).userId,
      body.currentPassword,
      body.code,
      requestMeta(req),
    );
    res.json({ data: result });
  },

  getPasswordPolicy: async (_req: Request, res: Response): Promise<void> => {
    const policy = await authService.getPasswordPolicy();
    res.json({ data: policy });
  },

  requestPasswordReset: async (req: Request, res: Response): Promise<void> => {
    const body = validated(res, 'body', passwordResetRequestSchema);
    await authService.requestPasswordReset(body, requestMeta(req));
    res.status(202).json({
      data: {
        message: 'If this email belongs to an account, a reset link is on its way. It works for 30 minutes.',
      },
    });
  },

  confirmPasswordReset: async (req: Request, res: Response): Promise<void> => {
    const body = validated(res, 'body', passwordResetConfirmSchema);
    await authService.confirmPasswordReset(body, requestMeta(req));
    res.status(204).end();
  },
};
