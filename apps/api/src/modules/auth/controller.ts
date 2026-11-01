// HTTP layer for /auth: moves the refresh token between the `rt` cookie and the service, and shapes
// the {data:{accessToken, expiresIn, user}} replies. No business rules live here.
import type { Request, Response } from 'express';
import { requestMeta, requireAuth } from '../../core/auth/auth-context';
import { readBearer } from '../../core/auth/authenticate';
import {
  REFRESH_COOKIE,
  clearRefreshCookie,
  setRefreshCookie,
  verifyAccessToken,
} from '../../core/auth/tokens';
import { AppError } from '../../core/http/errors';
import { validated } from '../../core/http/validate';
import { changePasswordSchema, loginSchema } from './schemas';
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
    sendSession(res, await authService.login(body, requestMeta(req)));
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

  me: (req: Request, res: Response): Promise<void> => {
    res.set('Cache-Control', 'no-store');
    res.json({ data: authService.me(requireAuth(req)) });
    return Promise.resolve();
  },

  changePassword: async (req: Request, res: Response): Promise<void> => {
    const body = validated(res, 'body', changePasswordSchema);
    sendSession(res, await authService.changePassword(requireAuth(req), body, requestMeta(req)));
  },
};
