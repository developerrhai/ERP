// Phase 28 routes. Public device endpoints (serial / HMAC authenticated): /iclock/cdata, /iclock/getrequest, /att/agents/batch.
// Authenticated admin and ESS endpoints under /hr/att and /ess/punch.
import express, { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { authenticate, requirePasswordChanged } from '../../core/auth/authenticate';
import { resolveContext } from '../../core/context/resolve-context';
import { asyncHandler } from '../../core/http/async-handler';
import { Errors } from '../../core/http/errors';
import { validate, validated } from '../../core/http/validate';
import { requirePageAction } from '../../core/rbac/access';
import { callerOf } from '../inventory/routes-shared';
import { attService } from './service';

const ok = (res: Response, data: unknown, status = 200) => res.status(status).json({ data });
const uuid = z.string().uuid();
const id = z.object({ id: uuid }).strict();

/** Public routes for the machines. Devices speak plain text: "OK" on success, 401 for an unknown serial. */
export function createDevicePushRouter(): Router {
  const r = Router();
  const text = express.text({ type: '*/*', limit: '2mb' });

  const serialOf = (req: Request): string => String(req.query.SN ?? req.query.sn ?? '').trim();

  r.get('/cdata', asyncHandler(async (req, res) => {
    const dev = await attService.deviceBySerial(serialOf(req));
    if (!dev) {
      await attService.unknownDevice(serialOf(req));
      res.status(401).type('text/plain').send(`Device ${serialOf(req)} is not registered.`);
      return;
    }
    // handshake: the device asks for its options; a short reply keeps the connection alive
    res.type('text/plain').send(`GET OPTION FROM: ${serialOf(req)}\nStamp=0\nOpStamp=0\nErrorDelay=60\nDelay=30\nTransTimes=00:00;14:05\nTransInterval=1\nTransFlag=TransData AttLog\nRealtime=1\nEncrypt=0`);
  }));
  r.get('/getrequest', asyncHandler(async (req, res) => {
    const dev = await attService.deviceBySerial(serialOf(req));
    if (!dev) {
      res.status(401).type('text/plain').send('Unregistered');
      return;
    }
    await attService.touchDevice(dev);
    res.type('text/plain').send('OK');
  }));
  r.post('/cdata', text, asyncHandler(async (req, res) => {
    const dev = await attService.deviceBySerial(serialOf(req));
    if (!dev) {
      await attService.unknownDevice(serialOf(req));
      res.status(401).type('text/plain').send(`Device ${serialOf(req)} is not registered.`);
      return;
    }
    const table = String(req.query.table ?? 'ATTLOG').toUpperCase();
    if (table !== 'ATTLOG') {
      res.type('text/plain').send('OK'); // operation logs and user data are not attendance
      return;
    }
    const out = await attService.ingestPush(dev, typeof req.body === 'string' ? req.body : '');
    res.type('text/plain').send(`OK: ${out.inserted}`);
  }));

  // the agent posts JSON, signed over the raw text of the body
  r.post('/agents/batch', express.text({ type: '*/*', limit: '4mb' }), asyncHandler(async (req, res) => {
    const raw = typeof req.body === 'string' ? req.body : '';
    const agent = await attService.verifyAgent(String(req.get('x-agent-id') ?? ''), String(req.get('x-signature') ?? ''), raw);
    if (!agent) throw Errors.unauthenticated();
    let batch: { serial?: string; punches: { code: string; time: string; status?: string }[] };
    try {
      batch = z.object({ serial: z.string().max(60).optional(), punches: z.array(z.object({ code: z.string().max(40), time: z.string().max(25), status: z.string().max(4).optional() })).max(5000) }).parse(JSON.parse(raw));
    } catch {
      throw Errors.validation({ body: 'The batch is not valid.' });
    }
    ok(res, await attService.ingestAgent(agent, batch));
  }));
  return r;
}

export function createAttAutoRouter(): Router {
  const r = Router();
  r.use(['/hr/att', '/ess/punch'], authenticate, requirePasswordChanged, resolveContext);
  const h = (fn: (req: Request, res: Response) => Promise<unknown>) => asyncHandler(fn as (req: Request, res: Response) => Promise<void>);

  // ---- devices, agents, sync log, health
  r.get('/hr/att/devices', requirePageAction('hr-attendance-devices', 'view'), h(async (req, res) => ok(res, await attService.devices(callerOf(req)))));
  const dev = z.object({ code: z.string().min(2).max(30), name: z.string().min(1).max(80), unitId: uuid, connection: z.enum(['PUSH', 'AGENT', 'MANUAL']), serialNo: z.string().max(60).nullable().optional(), vendor: z.enum(['FILE_ZKTECO', 'FILE_ESSL', 'API_SMART_OFFICE']).nullable().optional() }).strict();
  r.post('/hr/att/devices', requirePageAction('hr-attendance-devices', 'add'), validate({ body: dev }), h(async (req, res) => ok(res, await attService.registerDevice(callerOf(req), validated(res, 'body', dev)), 201)));
  r.get('/hr/att/agents', requirePageAction('hr-attendance-devices', 'view'), h(async (req, res) => ok(res, await attService.agents(callerOf(req)))));
  const ag = z.object({ unitId: uuid, name: z.string().min(1).max(80) }).strict();
  r.post('/hr/att/agents', requirePageAction('hr-attendance-devices', 'add'), validate({ body: ag }), h(async (req, res) => ok(res, await attService.createAgent(callerOf(req), validated(res, 'body', ag)), 201)));
  r.get('/hr/att/sync-logs', requirePageAction('hr-attendance-devices', 'view'), h(async (req, res) => ok(res, await attService.syncLogs(callerOf(req)))));
  r.get('/hr/att/device-health', requirePageAction('hr-attendance-devices', 'view'), h(async (req, res) => ok(res, await attService.devices(callerOf(req)))));

  // ---- policies and sites
  r.get('/hr/att/policies', requirePageAction('hr-attendance-policies', 'view'), h(async (req, res) => ok(res, await attService.policies(callerOf(req)))));
  const pol = z.object({ policyKey: z.enum(['LATE_MARK', 'MISSED_PUNCH', 'AUTO_ABSENT', 'AUTO_LEAVE', 'AUTO_OT', 'AUTO_COMPOFF', 'AUTO_SHIFT', 'MOBILE_PUNCH', 'BUDDY_ALERT', 'AUTO_LOCK']), unitId: uuid.nullable().optional(), enabled: z.boolean(), params: z.record(z.unknown()).optional(), effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).strict();
  r.put('/hr/att/policies', requirePageAction('hr-attendance-policies', 'edit'), validate({ body: pol }), h(async (req, res) => ok(res, await attService.setPolicy(callerOf(req), validated(res, 'body', pol)))));
  r.get('/hr/att/geo-sites', requirePageAction('hr-geo-sites', 'view'), h(async (req, res) => ok(res, await attService.sites(callerOf(req)))));
  const site = z.object({ unitId: uuid, name: z.string().min(1).max(80), lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), radiusM: z.number().int().min(10).max(5000) }).strict();
  r.post('/hr/att/geo-sites', requirePageAction('hr-geo-sites', 'add'), validate({ body: site }), h(async (req, res) => ok(res, await attService.addSite(callerOf(req), validated(res, 'body', site)), 201)));

  // ---- live board
  const lq = z.object({ unit: uuid.optional(), dept: z.string().max(60).optional() }).strict();
  r.get('/hr/att/live', requirePageAction('att-live-board', 'view'), validate({ query: lq }), h(async (req, res) => ok(res, await attService.live(callerOf(req), validated(res, 'query', lq)))));

  // ---- automatic actions
  const aq = z.object({ employee: uuid.optional(), month: z.string().regex(/^\d{4}-\d{2}$/).optional(), policy: z.string().max(20).optional(), unit: uuid.optional() }).strict();
  r.get('/hr/att/auto-actions', requirePageAction('hr-attendance', 'view'), validate({ query: aq }), h(async (req, res) => ok(res, await attService.autoActions(callerOf(req), validated(res, 'query', aq)))));
  const rev = z.object({ reason: z.string().max(300).default('') }).strict();
  r.post('/hr/att/auto-actions/:id/reverse', requirePageAction('hr-attendance', 'edit'), validate({ params: id, body: rev }), h(async (req, res) => ok(res, await attService.reverse(callerOf(req), validated(res, 'params', id).id, validated(res, 'body', rev).reason))));

  // ---- lock / unlock
  const lk = z.object({ unitId: uuid, month: z.string().regex(/^\d{4}-\d{2}$/), reason: z.string().max(300).optional() }).strict();
  r.post('/hr/att/lock', requirePageAction('hr-attendance', 'approve'), validate({ body: lk }), h(async (req, res) => { const b = validated(res, 'body', lk); if (!callerOf(req).ctx.unitIds.includes(b.unitId)) throw Errors.forbidden(); ok(res, await attService.lockMonth(b.unitId, b.month, callerOf(req).auth.user.id)); }));
  r.post('/hr/att/unlock', requirePageAction('hr-attendance', 'approve'), validate({ body: lk }), h(async (req, res) => { const b = validated(res, 'body', lk); ok(res, await attService.unlockMonth(callerOf(req), b.unitId, b.month, b.reason ?? '')); }));
  r.post('/hr/att/run-daily', requirePageAction('hr-attendance', 'approve'), h(async (_req, res) => ok(res, await attService.runDaily())));

  // ---- ESS mobile punch
  const mp = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), accuracy: z.number().min(0).max(100000), deviceInfo: z.string().max(200).nullable().optional() }).strict();
  r.post('/ess/punch', requirePageAction('hr-ess', 'view'), validate({ body: mp }), h(async (req, res) => ok(res, await attService.mobilePunch(callerOf(req), validated(res, 'body', mp)), 201)));
  return r;
}
