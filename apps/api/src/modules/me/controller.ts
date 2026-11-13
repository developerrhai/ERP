// HTTP layer for /me: calls the me / context services and shapes {data:...}. Never cached by the
// browser, because the answer changes as soon as an admin edits permissions or unit access.
import { controlService } from '../control/service';
import type { Request, Response } from 'express';
import { requestMeta, requireAuth } from '../../core/auth/auth-context';
import { validated } from '../../core/http/validate';
import { contextService } from './context-service';
import { mePermissionsQuerySchema, putContextSchema, putLocaleSchema } from './schemas';
import { meService } from './service';
import { plantsService } from './plants-service';
import { homeService } from './home-service';
import { adminPlantsSchema, homePrefsSchema, putPlantsSchema, roleLandingSchema, searchQuerySchema } from './schemas';
import { prisma } from '../../core/db/prisma';

export const meController = {
  getPlants: async (req: Request, res: Response): Promise<void> => {
    res.set('Cache-Control', 'no-store');
    res.json({ data: await plantsService.get(requireAuth(req).user) });
  },
  putPlants: async (req: Request, res: Response): Promise<void> => {
    const body = validated(res, 'body', putPlantsSchema);
    res.set('Cache-Control', 'no-store');
    res.json({ data: await plantsService.put(requireAuth(req), body, requestMeta(req)) });
  },
  adminPlants: async (req: Request, res: Response): Promise<void> => {
    const body = validated(res, 'body', adminPlantsSchema);
    res.json({ data: await plantsService.adminSet(requireAuth(req), String(req.params.id), body, requestMeta(req)) });
  },
  menuV2: async (req: Request, res: Response): Promise<void> => {
    res.set('Cache-Control', 'private, max-age=60');
    const auth = requireAuth(req);
    const menu = await homeService.menu(auth);
    const hidden = await controlService.hiddenPages(req.ctx?.unitIds ?? [], auth.roleId); // Phase 31: modules switched off for the chosen plants
    res.json({ data: hidden.size === 0 ? menu : { ...menu, families: menu.families.map((f) => ({ ...f, pages: f.pages.filter((p) => !hidden.has(p.id)) })).filter((f) => f.pages.length > 0) } });
  },
  search: async (req: Request, res: Response): Promise<void> => {
    const { q } = validated(res, 'query', searchQuerySchema);
    res.set('Cache-Control', 'no-store');
    res.json({ data: await homeService.search(requireAuth(req), q) });
  },
  home: async (req: Request, res: Response): Promise<void> => {
    res.set('Cache-Control', 'no-store');
    const auth = requireAuth(req);
    res.json({
      data: { ...(await homeService.home(auth, req.ctx?.unitIds ?? [])), landingPage: await homeService.landingFor(auth) },
    });
  },
  putHomePrefs: async (req: Request, res: Response): Promise<void> => {
    const body = validated(res, 'body', homePrefsSchema);
    res.json({ data: await homeService.putPrefs(requireAuth(req).userId, body) });
  },
  addFavourite: async (req: Request, res: Response): Promise<void> => {
    res.status(201).json({ data: await homeService.addFavourite(requireAuth(req).userId, String(req.params.pageId)) });
  },
  removeFavourite: async (req: Request, res: Response): Promise<void> => {
    res.json({ data: await homeService.removeFavourite(requireAuth(req).userId, String(req.params.pageId)) });
  },
  touchRecent: async (req: Request, res: Response): Promise<void> => {
    await homeService.touchRecent(requireAuth(req).userId, String(req.params.pageId));
    res.status(204).end();
  },
  setRoleLanding: async (req: Request, res: Response): Promise<void> => {
    const body = validated(res, 'body', roleLandingSchema);
    await homeService.setRoleLanding(body.roleId, body.landing, requireAuth(req).userId);
    res.json({ data: { roleId: body.roleId, landing: body.landing } });
  },
  menu: async (req: Request, res: Response): Promise<void> => {
    res.set('Cache-Control', 'no-store');
    res.json({ data: await meService.menu(requireAuth(req)) });
  },
  permissions: async (req: Request, res: Response): Promise<void> => {
    const { pageId } = validated(res, 'query', mePermissionsQuerySchema);
    res.set('Cache-Control', 'no-store');
    res.json({ data: await meService.permissions(requireAuth(req), pageId) });
  },
  getContext: async (req: Request, res: Response): Promise<void> => {
    res.set('Cache-Control', 'no-store');
    res.json({ data: await contextService.get(requireAuth(req).user) });
  },
  putContext: async (req: Request, res: Response): Promise<void> => {
    const body = validated(res, 'body', putContextSchema);
    res.set('Cache-Control', 'no-store');
    res.json({ data: await contextService.put(requireAuth(req), body, requestMeta(req)) });
  },
  getLocale: async (req: Request, res: Response): Promise<void> => {
    const { userId } = requireAuth(req);
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { preferredLocale: true } });
    res.set('Cache-Control', 'no-store');
    res.json({ data: { locale: user?.preferredLocale === 'hi' ? 'hi' : 'en' } });
  },
  putLocale: async (req: Request, res: Response): Promise<void> => {
    const { userId } = requireAuth(req);
    const { locale } = validated(res, 'body', putLocaleSchema);
    await prisma.user.update({ where: { id: userId }, data: { preferredLocale: locale } });
    res.set('Cache-Control', 'no-store');
    res.json({ data: { locale } });
  },
};
