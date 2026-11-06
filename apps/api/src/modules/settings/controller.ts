// HTTP layer for /settings: letterhead and security policy (If-Match). No business rules here.
import type { Request, Response } from 'express';
import { requestMeta, requireAuth } from '../../core/auth/auth-context';
import { securityPolicySchema } from '../../core/auth/security-policy';
import { parseIfMatch } from '../../core/http/if-match';
import { validated } from '../../core/http/validate';
import { letterheadSchema } from './schemas';
import { settingsService } from './service';

export const settingsController = {
  getLetterhead: async (_req: Request, res: Response): Promise<void> => {
    const letterhead = await settingsService.getLetterhead();
    res.set('ETag', `"${letterhead.version}"`).json({ data: letterhead });
  },

  putLetterhead: async (req: Request, res: Response): Promise<void> => {
    const version = parseIfMatch(req.get('if-match'));
    const body = validated(res, 'body', letterheadSchema);
    const saved = await settingsService.putLetterhead(
      requireAuth(req),
      version,
      body,
      requestMeta(req),
    );
    res.set('ETag', `"${saved.version}"`).json({ data: saved });
  },

  patchLetterhead: async (req: Request, res: Response): Promise<void> => {
    const version = parseIfMatch(req.get('if-match'));
    const patchBody = validated(res, 'body', letterheadSchema.partial());
    const current = await settingsService.getLetterhead();
    const merged = letterheadSchema.parse({ ...current.value, ...patchBody });
    const saved = await settingsService.putLetterhead(
      requireAuth(req),
      version,
      merged,
      requestMeta(req),
    );
    res.set('ETag', `"${saved.version}"`).json({ data: saved });
  },

  getSecurityPolicy: async (_req: Request, res: Response): Promise<void> => {
    const policy = await settingsService.getSecurityPolicy();
    res.set('ETag', `"${policy.version}"`).json({ data: policy });
  },

  putSecurityPolicy: async (req: Request, res: Response): Promise<void> => {
    const version = parseIfMatch(req.get('if-match'));
    const body = validated(res, 'body', securityPolicySchema);
    const saved = await settingsService.putSecurityPolicy(
      requireAuth(req),
      version,
      body,
      requestMeta(req),
    );
    res.set('ETag', `"${saved.version}"`).json({ data: saved });
  },

  testPdf: async (req: Request, res: Response): Promise<void> => {
    const pdfBuffer = await settingsService.generateTestPdf(req.body);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="letterhead-preview.pdf"');
    res.setHeader('Content-Length', pdfBuffer.length);
    res.send(pdfBuffer);
  },
};
