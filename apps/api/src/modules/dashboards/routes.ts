// Phase 24 routes: dashboards (my / department / plant / owner / module), widget library, personal layouts,
// KPI targets, KPI alert rules, emailed-dashboard schedules, TV links. Each route checks the page right it belongs to.
import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { authenticate, requirePasswordChanged } from '../../core/auth/authenticate';
import { resolveContext } from '../../core/context/resolve-context';
import { asyncHandler } from '../../core/http/async-handler';
import { Errors } from '../../core/http/errors';
import { validate, validated } from '../../core/http/validate';
import { requirePageAction } from '../../core/rbac/access';
import { callerOf } from '../inventory/routes-shared';
import { dashboardsService } from './service';

const guard = [authenticate, requirePasswordChanged, resolveContext];
const ok = (res: Response, data: unknown, status = 200) => res.status(status).json({ data });

/** The BI page whose view right opens each analytics module. */
const MODULE_PAGE: Record<string, string> = {
  sales: 'bi-sales',
  purchase: 'bi-purchase',
  inventory: 'bi-inventory',
  finance: 'bi-finance',
  production: 'bi-production',
  quality: 'bi-quality',
  hr: 'bi-hr',
  maintenance: 'bi-maintenance',
  projects: 'bi-projects',
  service: 'bi-service',
  logistics: 'bi-logistics',
};

const keyParams = z.object({ key: z.string().min(1).max(80) }).strict();
const idParams = z.object({ id: z.string().uuid() }).strict();
const layoutBody = z
  .object({
    layout: z
      .array(
        z
          .object({
            widget: z.string().min(1).max(60),
            x: z.number().int().min(0).max(11),
            y: z.number().int().min(0).max(200),
            w: z.number().int().min(1).max(12),
            h: z.number().int().min(1).max(12),
          })
          .strict(),
      )
      .max(60),
  })
  .strict();
const targetBody = z
  .object({
    kpiCode: z.string().min(1).max(50),
    unitId: z.string().uuid().nullable().optional(),
    userId: z.string().uuid().nullable().optional(),
    departmentId: z.string().uuid().nullable().optional(),
    periodKind: z.enum(['DAY', 'WEEK', 'MONTH', 'QUARTER', 'FY']),
    periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    target: z.number().finite(),
    amberPct: z.number().min(1).max(100).optional(),
    redPct: z.number().min(1).max(100).optional(),
  })
  .strict();
const alertBody = z
  .object({
    kpiCode: z.string().min(1).max(50),
    unitId: z.string().uuid().nullable().optional(),
    condition: z.enum(['GT', 'LT', 'BELOW_TARGET', 'ABOVE_TARGET']),
    threshold: z.number().finite().nullable().optional(),
    recipientRoleIds: z.array(z.string().uuid()).max(20).optional(),
    recipientUserIds: z.array(z.string().uuid()).max(50).optional(),
    channels: z.array(z.enum(['in_app', 'push', 'email'])).min(1).max(3).optional(),
    cooldownHours: z.number().int().min(1).max(720).optional(),
    active: z.boolean().optional(),
  })
  .strict();
const alertToggle = z.object({ active: z.boolean() }).strict();
const scheduleBody = z
  .object({
    dashboardKey: z.string().min(1).max(80),
    name: z.string().trim().min(2).max(120),
    cronExpr: z.string().trim().min(5).max(60),
    recipientUserIds: z.array(z.string().uuid()).min(1).max(50),
  })
  .strict();
const tvBody = z.object({ unitId: z.string().uuid().nullable().optional(), days: z.number().int().min(1).max(365).optional() }).strict();

export function createDashboardsRouter(): Router {
  const r = Router();

  // ------------------------------------------------------------------ dashboards
  r.get('/dashboards/my', ...guard, requirePageAction('my-dashboard', 'view'), asyncHandler(async (req: Request, res: Response) => {
    ok(res, await dashboardsService.my(callerOf(req)));
  }));
  r.get('/dashboards/dept/:dept', ...guard, requirePageAction('dashboard', 'view'), asyncHandler(async (req: Request, res: Response) => {
    ok(res, await dashboardsService.department(callerOf(req), String(req.params.dept)));
  }));
  r.get('/dashboards/plant', ...guard, requirePageAction('plant-dashboard', 'view'), asyncHandler(async (req: Request, res: Response) => {
    ok(res, await dashboardsService.plant(callerOf(req)));
  }));
  r.get('/dashboards/owner', ...guard, requirePageAction('owner-console', 'view'), asyncHandler(async (req: Request, res: Response) => {
    ok(res, await dashboardsService.owner(callerOf(req)));
  }));
  r.get('/dashboards/module/:code', ...guard, asyncHandler(async (req: Request, res: Response) => {
    const code = String(req.params.code);
    const page = MODULE_PAGE[code];
    if (!page) throw Errors.notFound('Unknown analytics module.');
    await new Promise<void>((resolve, reject) => {
      requirePageAction(page, 'view')(req, res, (err?: unknown) => (err ? reject(err) : resolve()));
    });
    ok(res, await dashboardsService.module(callerOf(req), code));
  }));
  r.get('/dashboards/widgets', ...guard, asyncHandler(async (_req: Request, res: Response) => {
    ok(res, await dashboardsService.widgetLibrary());
  }));

  // personal layout: any signed-in user, only their own
  r.put('/dashboards/:key/layout', ...guard, validate({ params: keyParams, body: layoutBody }), asyncHandler(async (req: Request, res: Response) => {
    const { key } = validated(res, 'params', keyParams);
    const { layout } = validated(res, 'body', layoutBody);
    await dashboardsService.putOverride(callerOf(req).auth.userId, key, layout);
    ok(res, { key, layout });
  }));
  r.post('/dashboards/:key/reset', ...guard, validate({ params: keyParams }), asyncHandler(async (req: Request, res: Response) => {
    const { key } = validated(res, 'params', keyParams);
    await dashboardsService.resetOverride(callerOf(req).auth.userId, key);
    ok(res, { key, layout: null });
  }));
  r.post('/dashboards/:key/tv-token', ...guard, requirePageAction('bi-dashboards', 'edit'), validate({ params: keyParams, body: tvBody }), asyncHandler(async (req: Request, res: Response) => {
    const { key } = validated(res, 'params', keyParams);
    const body = validated(res, 'body', tvBody);
    ok(res, await dashboardsService.createTvToken(callerOf(req), key, body.unitId ?? null, body.days), 201);
  }));

  // ------------------------------------------------------------------ targets
  r.get('/kpi-targets', ...guard, requirePageAction('kpi-targets', 'view'), asyncHandler(async (_req: Request, res: Response) => {
    ok(res, await dashboardsService.listTargets());
  }));
  r.post('/kpi-targets', ...guard, requirePageAction('kpi-targets', 'add'), validate({ body: targetBody }), asyncHandler(async (req: Request, res: Response) => {
    ok(res, await dashboardsService.saveTarget(callerOf(req), validated(res, 'body', targetBody)), 201);
  }));
  r.delete('/kpi-targets/:id', ...guard, requirePageAction('kpi-targets', 'delete'), validate({ params: idParams }), asyncHandler(async (req: Request, res: Response) => {
    await dashboardsService.deleteTarget(callerOf(req), validated(res, 'params', idParams).id);
    res.status(204).end();
  }));

  // ------------------------------------------------------------------ alerts
  r.get('/kpi-alerts', ...guard, requirePageAction('kpi-alerts', 'view'), asyncHandler(async (_req: Request, res: Response) => {
    ok(res, await dashboardsService.listAlertRules());
  }));
  r.post('/kpi-alerts', ...guard, requirePageAction('kpi-alerts', 'add'), validate({ body: alertBody }), asyncHandler(async (req: Request, res: Response) => {
    ok(res, await dashboardsService.saveAlertRule(callerOf(req), validated(res, 'body', alertBody)), 201);
  }));
  r.patch('/kpi-alerts/:id', ...guard, requirePageAction('kpi-alerts', 'edit'), validate({ params: idParams, body: alertToggle }), asyncHandler(async (req: Request, res: Response) => {
    await dashboardsService.setAlertActive(callerOf(req), validated(res, 'params', idParams).id, validated(res, 'body', alertToggle).active);
    ok(res, { ok: true });
  }));
  r.delete('/kpi-alerts/:id', ...guard, requirePageAction('kpi-alerts', 'delete'), validate({ params: idParams }), asyncHandler(async (req: Request, res: Response) => {
    await dashboardsService.deleteAlertRule(callerOf(req), validated(res, 'params', idParams).id);
    res.status(204).end();
  }));

  // ------------------------------------------------------------------ emailed dashboards
  r.get('/dashboard-schedules', ...guard, requirePageAction('bi-dashboards', 'view'), asyncHandler(async (_req: Request, res: Response) => {
    ok(res, await dashboardsService.listSchedules());
  }));
  r.post('/dashboard-schedules', ...guard, requirePageAction('bi-dashboards', 'add'), validate({ body: scheduleBody }), asyncHandler(async (req: Request, res: Response) => {
    ok(res, await dashboardsService.saveSchedule(callerOf(req), validated(res, 'body', scheduleBody)), 201);
  }));
  r.delete('/dashboard-schedules/:id', ...guard, requirePageAction('bi-dashboards', 'delete'), validate({ params: idParams }), asyncHandler(async (req: Request, res: Response) => {
    await dashboardsService.deleteSchedule(callerOf(req), validated(res, 'params', idParams).id);
    res.status(204).end();
  }));

  return r;
}

/** GET /tv/:key?token= : read-only, no sign-in, the signed link is the credential. Any other method is refused. */
export function createTvRouter(): Router {
  const r = Router();
  r.get('/:key', asyncHandler(async (req: Request, res: Response) => {
    const token = typeof req.query.token === 'string' ? req.query.token : '';
    if (token.length < 16) throw Errors.unauthenticated();
    res.set('Cache-Control', 'no-store');
    ok(res, await dashboardsService.tvView(String(req.params.key), token));
  }));
  r.all('/:key', (_req, res) => {
    res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'This screen link is read-only.', status: 405 } });
  });
  return r;
}
