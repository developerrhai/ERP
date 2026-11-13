// Phase 34 routes: /admin/integrations, /admin/webhooks, /tax/einvoice/:id/generate-irn and the signed inbound hooks.
import express, { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { authenticate, requirePasswordChanged } from '../../core/auth/authenticate';
import { resolveContext } from '../../core/context/resolve-context';
import { asyncHandler } from '../../core/http/async-handler';
import { validate, validated } from '../../core/http/validate';
import { requirePageAction } from '../../core/rbac/access';
import { callerOf } from '../inventory/routes-shared';
import { MODES, PROVIDERS } from './calc';
import { integrationService } from './service';

const ok = (res: Response, data: unknown, status = 200) => res.status(status).json({ data });
const uuid = z.string().uuid();
const id = z.object({ id: uuid }).strict();
const provider = z.object({ provider: z.enum(PROVIDERS) }).strict();

/** Signed inbound hooks: mounted BEFORE the JSON body parser, because the signature is over the raw text. */
export function createInboundHooksRouter(): Router {
  const r = Router();
  const text = express.text({ type: '*/*', limit: '200kb' });
  r.post('/whatsapp', text, asyncHandler(async (req, res) => {
    const raw = typeof req.body === 'string' ? req.body : '';
    ok(res, await integrationService.inbound('WHATSAPP', raw, String(req.get('x-hub-signature-256') ?? '')));
  }));
  r.post('/bank', text, asyncHandler(async (req, res) => {
    const raw = typeof req.body === 'string' ? req.body : '';
    ok(res, await integrationService.inbound('BANK_FEED', raw, String(req.get('x-bank-signature') ?? '')));
  }));
  return r;
}

export function createIntegrationsRouter(): Router {
  const r = Router();
  r.use(['/admin/integrations', '/admin/webhooks', '/tax/einvoice'], authenticate, requirePasswordChanged, resolveContext);
  const h = (fn: (req: Request, res: Response) => Promise<unknown>) => asyncHandler(fn as (req: Request, res: Response) => Promise<void>);

  r.get('/admin/integrations', requirePageAction('admin-integrations', 'view'), h(async (_req, res) => ok(res, await integrationService.list())));
  const lq = z.object({ provider: z.enum(PROVIDERS).optional() }).strict();
  r.get('/admin/integrations/logs', requirePageAction('admin-integrations', 'view'), validate({ query: lq }), h(async (req, res) => ok(res, await integrationService.logs(validated(res, 'query', lq).provider))));
  r.get('/admin/integrations/:provider', requirePageAction('admin-integrations', 'view'), validate({ params: provider }), h(async (req, res) => ok(res, await integrationService.get(validated(res, 'params', provider).provider))));
  const pb = z.object({ mode: z.enum(MODES), config: z.record(z.unknown()).optional(), secrets: z.record(z.string().max(500)).optional() }).strict();
  r.put('/admin/integrations/:provider', requirePageAction('admin-integrations', 'edit'), validate({ params: provider, body: pb }), h(async (req, res) => ok(res, await integrationService.put(callerOf(req), validated(res, 'params', provider).provider, validated(res, 'body', pb)))));
  r.post('/admin/integrations/:provider/test', requirePageAction('admin-integrations', 'edit'), validate({ params: provider }), h(async (req, res) => ok(res, await integrationService.test(callerOf(req), validated(res, 'params', provider).provider))));
  const wa = z.object({ to: z.string().max(20), template: z.string().min(1).max(60), vars: z.record(z.string().max(200)).optional(), docType: z.string().max(40).optional(), docId: uuid.optional() }).strict();
  r.post('/admin/integrations/whatsapp/send', requirePageAction('admin-integrations', 'edit'), validate({ body: wa }), h(async (req, res) => ok(res, await integrationService.sendWhatsApp(callerOf(req), validated(res, 'body', wa)))));

  r.post('/tax/einvoice/:id/generate-irn', requirePageAction('sales-invoices', 'post'), validate({ params: id }), h(async (req, res) => ok(res, await integrationService.generateIrn(callerOf(req), validated(res, 'params', id).id), 201)));

  r.get('/admin/webhooks', requirePageAction('admin-webhooks', 'view'), h(async (_req, res) => ok(res, await integrationService.webhookEndpoints())));
  const dq = z.object({ status: z.enum(['PENDING', 'DELIVERED', 'RETRY', 'DEAD_LETTER']).optional(), endpoint: uuid.optional() }).strict();
  r.get('/admin/webhooks/deliveries', requirePageAction('admin-webhooks', 'view'), validate({ query: dq }), h(async (req, res) => ok(res, await integrationService.deliveries(validated(res, 'query', dq)))));
  r.post('/admin/webhooks/deliveries/:id/replay', requirePageAction('admin-webhooks', 'edit'), validate({ params: id }), h(async (req, res) => ok(res, await integrationService.replay(callerOf(req), validated(res, 'params', id).id), 201)));
  r.post('/admin/webhooks/run', requirePageAction('admin-webhooks', 'edit'), h(async (_req, res) => ok(res, await integrationService.deliverDue())));
  return r;
}
