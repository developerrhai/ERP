// Phase 31 routes: custom fields, form rules, modules per plant, numbering, sessions, login policies, View-as, API keys, console, health.
import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { authenticate, requirePasswordChanged } from '../../core/auth/authenticate';
import { resolveContext } from '../../core/context/resolve-context';
import { asyncHandler } from '../../core/http/async-handler';
import { Errors } from '../../core/http/errors';
import { validate, validated } from '../../core/http/validate';
import { requirePageAction, requireParamPageAction, setModuleGate } from '../../core/rbac/access';
import { callerOf } from '../inventory/routes-shared';
import { controlService } from './service';

const ok = (res: Response, data: unknown, status = 200) => res.status(status).json({ data });
const uuid = z.string().uuid();
const id = z.object({ id: uuid }).strict();
const page = z.string().min(1).max(80);

export function createControlRouter(): Router {
  setModuleGate(async (pageId, req) => {
    if (req.ctx?.unitId && req.auth) await controlService.assertModuleOn(pageId, req.ctx.unitId, req.auth.roleId);
  });
  const r = Router();
  r.use(['/admin/custom-fields', '/admin/form-rules', '/admin/module-plants', '/admin/numbering', '/admin/sessions', '/admin/login-policies', '/admin/api-keys', '/admin/health', '/owner', '/custom-fields', '/forms'], authenticate, requirePasswordChanged, resolveContext);
  const h = (fn: (req: Request, res: Response) => Promise<unknown>) => asyncHandler(fn as (req: Request, res: Response) => Promise<void>);

  // ---- custom fields
  const fq = z.object({ pageId: page }).strict();
  r.get('/admin/custom-fields', requirePageAction('admin-customfields', 'view'), validate({ query: fq }), h(async (req, res) => ok(res, await controlService.fieldDefs(validated(res, 'query', fq).pageId, { all: true }))));
  const fb = z.object({ pageId: page, key: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/, 'Use lower-case letters, digits and _ (like drawing_no).'), label: z.string().min(1).max(80), labelHi: z.string().max(80).nullable().optional(), type: z.enum(['text', 'number', 'decimal', 'date', 'bool', 'select', 'multiselect', 'lookup', 'file']), options: z.array(z.string().min(1).max(60)).max(50).optional(), lookupKind: z.enum(['customer', 'supplier', 'item', 'employee', 'project', 'plant']).nullable().optional(), required: z.boolean().optional(), defaultValue: z.string().max(200).nullable().optional(), help: z.string().max(200).nullable().optional(), unitIds: z.array(uuid).max(20).optional(), roleIds: z.array(uuid).max(20).optional(), inList: z.boolean().optional(), inFilter: z.boolean().optional(), inPdf: z.boolean().optional(), inExcel: z.boolean().optional(), inImport: z.boolean().optional(), sort: z.number().int().min(0).max(999).optional() }).strict();
  r.post('/admin/custom-fields', requirePageAction('admin-customfields', 'add'), validate({ body: fb }), h(async (req, res) => ok(res, await controlService.createFieldDef(callerOf(req), validated(res, 'body', fb)), 201)));
  const fu = z.object({ label: z.string().min(1).max(80).optional(), labelHi: z.string().max(80).nullable().optional(), required: z.boolean().optional(), help: z.string().max(200).nullable().optional(), active: z.boolean().optional(), options: z.array(z.string().min(1).max(60)).max(50).optional(), unitIds: z.array(uuid).max(20).optional(), roleIds: z.array(uuid).max(20).optional(), inList: z.boolean().optional(), inFilter: z.boolean().optional(), inPdf: z.boolean().optional(), inExcel: z.boolean().optional(), sort: z.number().int().min(0).max(999).optional() }).strict();
  r.put('/admin/custom-fields/:id', requirePageAction('admin-customfields', 'edit'), validate({ params: id, body: fu }), h(async (req, res) => ok(res, await controlService.updateFieldDef(callerOf(req), validated(res, 'params', id).id, validated(res, 'body', fu)))));

  const vp = z.object({ pageId: page, recordId: uuid }).strict();
  const vb = z.object({ status: z.string().max(40).nullable().optional(), values: z.record(z.unknown()) }).strict();
  r.get('/custom-fields/:pageId/:recordId', requireParamPageAction('view'), validate({ params: vp }), h(async (req, res) => { const p = validated(res, 'params', vp); ok(res, await controlService.values(p.pageId, p.recordId)); }));
  r.put('/custom-fields/:pageId/:recordId', requireParamPageAction('edit'), validate({ params: vp, body: vb }), h(async (req, res) => { const p = validated(res, 'params', vp); const b = validated(res, 'body', vb); ok(res, await controlService.setValues(callerOf(req), p.pageId, p.recordId, b.values, b.status ?? null)); }));
  const fm = z.object({ status: z.string().max(40).optional() }).strict();
  const fmp = z.object({ pageId: page }).strict();
  r.get('/forms/:pageId/meta', requireParamPageAction('view'), validate({ params: fmp, query: fm }), h(async (req, res) => ok(res, await controlService.formMeta(callerOf(req), validated(res, 'params', fmp).pageId, validated(res, 'query', fm).status ?? null))));

  // ---- form rules
  const rq = z.object({ pageId: page.optional() }).strict();
  r.get('/admin/form-rules', requirePageAction('admin-formbuilder', 'view'), validate({ query: rq }), h(async (req, res) => ok(res, await controlService.listRules(validated(res, 'query', rq).pageId))));
  const rb = z.object({ pageId: page, fieldKey: z.string().min(1).max(60), effect: z.enum(['HIDDEN', 'READONLY', 'REQUIRED']), roleId: uuid.nullable().optional(), status: z.string().max(40).nullable().optional(), unitId: uuid.nullable().optional() }).strict();
  r.post('/admin/form-rules', requirePageAction('admin-formbuilder', 'add'), validate({ body: rb }), h(async (req, res) => ok(res, await controlService.createRule(callerOf(req), validated(res, 'body', rb)), 201)));
  r.delete('/admin/form-rules/:id', requirePageAction('admin-formbuilder', 'delete'), validate({ params: id }), h(async (req, res) => { await controlService.deleteRule(callerOf(req), validated(res, 'params', id).id); ok(res, { ok: true }); }));

  // ---- modules per plant
  r.get('/admin/module-plants', requirePageAction('admin-security', 'view'), h(async (_req, res) => ok(res, await controlService.moduleControls())));
  const mb = z.object({ pageId: page, unitId: uuid, roleId: uuid.nullable().optional(), enabled: z.boolean() }).strict();
  r.put('/admin/module-plants', requirePageAction('admin-security', 'edit'), validate({ body: mb }), h(async (req, res) => { const out = await controlService.setModule(callerOf(req), validated(res, 'body', mb)); controlService.clearModuleCache(); ok(res, out); }));

  // ---- numbering
  r.get('/admin/numbering', requirePageAction('admin-numbering', 'view'), h(async (_req, res) => ok(res, await controlService.series())));
  const nb = z.object({ prefix: z.string().max(20), suffix: z.string().max(10).nullable().optional(), padding: z.number().int().min(1).max(10), next: z.number().int().min(1).optional(), plant: z.string().max(6).optional(), fy: z.string().max(8).optional(), gst: z.boolean().optional() }).strict();
  r.post('/admin/numbering/preview', requirePageAction('admin-numbering', 'view'), validate({ body: nb }), h(async (req, res) => ok(res, await controlService.previewSeries(validated(res, 'body', nb)))));

  // ---- sessions
  const sq = z.object({ userId: uuid.optional() }).strict();
  r.get('/admin/sessions', requirePageAction('admin-security', 'view'), validate({ query: sq }), h(async (req, res) => ok(res, await controlService.sessions(validated(res, 'query', sq)))));
  r.delete('/admin/sessions/:id', requirePageAction('admin-security', 'edit'), validate({ params: id }), h(async (req, res) => ok(res, await controlService.forceLogout(callerOf(req), validated(res, 'params', id).id))));

  // ---- login policies
  r.get('/admin/login-policies', requirePageAction('admin-security', 'view'), h(async (_req, res) => ok(res, await controlService.loginPolicies())));
  const lb = z.object({ roleId: uuid, hoursFrom: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(), hoursTo: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(), ipCidrs: z.array(z.string().max(20)).max(30).optional(), mfaRequired: z.boolean().optional(), inactiveDays: z.number().int().min(1).max(3650).nullable().optional() }).strict();
  r.put('/admin/login-policies', requirePageAction('admin-security', 'edit'), validate({ body: lb }), h(async (req, res) => ok(res, await controlService.setLoginPolicy(callerOf(req), validated(res, 'body', lb)))));

  // ---- View as
  const va = z.object({ targetUserId: uuid, reason: z.string().max(300) }).strict();
  r.post('/owner/view-as', requirePageAction('owner-console', 'view'), validate({ body: va }), h(async (req, res) => {
    if (callerOf(req).auth.level < 95) throw Errors.forbidden('Only the Owner or an Administrator can view as another person.');
    ok(res, await controlService.startViewAs(callerOf(req), validated(res, 'body', va).targetUserId, validated(res, 'body', va).reason), 201);
  }));
  r.delete('/owner/view-as/:id', requirePageAction('owner-console', 'view'), validate({ params: id }), h(async (req, res) => { await controlService.endViewAs(callerOf(req), validated(res, 'params', id).id); ok(res, { ok: true }); }));

  // ---- API keys
  r.get('/admin/api-keys', requirePageAction('admin-api', 'view'), h(async (_req, res) => ok(res, await controlService.apiKeys())));
  const ak = z.object({ name: z.string().min(1).max(80), scopes: z.array(z.string().max(40)).max(20).optional(), unitIds: z.array(uuid).max(20).optional(), expiresAt: z.string().max(40).nullable().optional() }).strict();
  r.post('/admin/api-keys', requirePageAction('admin-api', 'add'), validate({ body: ak }), h(async (req, res) => ok(res, await controlService.createApiKey(callerOf(req), validated(res, 'body', ak)), 201)));
  r.delete('/admin/api-keys/:id', requirePageAction('admin-api', 'delete'), validate({ params: id }), h(async (req, res) => { await controlService.revokeApiKey(callerOf(req), validated(res, 'params', id).id); ok(res, { ok: true }); }));

  // ---- console and health
  r.get('/owner/console', requirePageAction('owner-console', 'view'), h(async (_req, res) => ok(res, await controlService.consoleCards())));
  r.get('/admin/health', requirePageAction('admin-security', 'view'), h(async (_req, res) => ok(res, await controlService.health())));
  return r;
}
