// Phase 41 API: /api/v1/routing (the main session mounts createRoutingRouter() in app.ts).
//   plant-unit-routing : /routes, /lookups                      mfg-unit-route : /plants, /live, /job-routes
//   flow-bom-approval  : /bom-flows                             mfg-transfer-note : /transfers
import { Router } from 'express';
import type { Request, RequestHandler, Response } from 'express';
import { z } from 'zod';
import { authenticate, requirePasswordChanged } from '../../core/auth/authenticate';
import { resolveContext } from '../../core/context/resolve-context';
import { asyncHandler } from '../../core/http/async-handler';
import { validate, validated } from '../../core/http/validate';
import { pageInfo } from '../../core/registry';
import { requirePageAction as guardPage } from '../../core/rbac/access';
import type { Action } from '../../core/rbac/permission-model';
import { camel } from '../procurement/core';
import { callerOf } from '../inventory/routes-shared';
import { bomFlowService } from './bom-flow-service';
import { routingService } from './service';
import { transferService } from './transfer-service';

/**
 * The four pages are guarded by their own page id once the registry knows them (the main session adds them to
 * core/registry.ts); until then the guard uses the closest existing page so the API is never left open.
 */
const FALLBACK: Record<string, string> = {
  'plant-unit-routing': 'mfg-routing',
  'mfg-unit-route': 'mfg-workorders',
  'flow-bom-approval': 'mfg-bom',
  'mfg-transfer-note': 'inv-transfer',
};
function requirePageAction(pageId: string, action: Action): RequestHandler {
  return (req, res, next) => guardPage(pageInfo(pageId) ? pageId : (FALLBACK[pageId] ?? pageId), action)(req, res, next);
}

/** Rows come from raw SQL in snake_case; the API speaks camelCase. */
function deep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(deep);
  if (v instanceof Date) return v.toISOString();
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [camel(k), k === 'dispatch_detail' || k === 'detail' ? x : deep(x)]));
  }
  return v;
}
const ok = (res: Response, data: unknown, status = 200): void => {
  res.status(status).json({ data: deep(data) });
};

const id = z.object({ id: z.string().uuid() }).strict();
const uuid = z.string().uuid();
const step = z
  .object({
    unitId: uuid,
    processName: z.string().min(1).max(120),
    departmentId: uuid.nullable().optional(),
    workCentreId: uuid.nullable().optional(),
    stdHours: z.number().min(0).max(999999.99).nullable().optional(),
    qcRequired: z.boolean().optional(),
    approvalRequired: z.boolean().optional(),
  })
  .strict();
const routeBody = z
  .object({
    code: z.string().min(1).max(30).optional(),
    name: z.string().min(1).max(120),
    itemOrFamily: z.string().max(120).nullable().optional(),
    active: z.boolean().optional(),
    steps: z.array(step).min(1).max(60),
  })
  .strict();
const qty = z.union([z.number(), z.string().regex(/^\d+(\.\d{1,3})?$/)]);
const noteBody = z
  .object({
    fromUnitId: uuid.nullable().optional(),
    toUnitId: uuid,
    quantity: qty,
    jobCardNo: z.string().max(40).nullable().optional(),
    itemId: uuid.nullable().optional(),
    fromProcess: z.string().max(120).nullable().optional(),
    toProcess: z.string().max(120).nullable().optional(),
    fromWarehouseId: uuid.nullable().optional(),
    toWarehouseId: uuid.nullable().optional(),
    vehiclePerson: z.string().max(120).nullable().optional(),
    remarks: z.string().max(300).nullable().optional(),
    transferDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    dispatch: z.boolean().optional(),
  })
  .strict();
const listQuery = z.object({ tab: z.string().max(20).optional(), q: z.string().max(60).optional(), view: z.string().max(20).optional(), unitId: uuid.optional() }).strict();
const empty = z.object({}).strict().default({});

export function createRoutingRouter(): Router {
  const r = Router();
  r.use(authenticate, requirePasswordChanged, resolveContext);
  const get = <T>(path: string, page: string, fn: (req: Request) => Promise<T>) =>
    r.get(path, requirePageAction(page, 'view'), asyncHandler(async (req: Request, res: Response) => ok(res, await fn(req))));

  // ---- lookups + route builder (plant-unit-routing)
  get('/lookups', 'plant-unit-routing', async () => ({ units: await routingService.units(), departments: await routingService.departments() }));
  get('/work-centres', 'plant-unit-routing', async (req) => routingService.workCentres(uuid.parse(req.query.unitId)));
  get('/routes', 'plant-unit-routing', (req) => routingService.list(callerOf(req)));
  get('/routes/:id', 'plant-unit-routing', (req) => routingService.get(id.parse(req.params).id));
  r.post('/routes', requirePageAction('plant-unit-routing', 'add'), validate({ body: routeBody }), asyncHandler(async (req, res) => ok(res, await routingService.create(callerOf(req), validated(res, 'body', routeBody)), 201)));
  r.post('/routes/reset-sketch', requirePageAction('plant-unit-routing', 'edit'), asyncHandler(async (req, res) => ok(res, await routingService.resetSketch(callerOf(req)))));
  r.put('/routes/:id', requirePageAction('plant-unit-routing', 'edit'), validate({ params: id, body: routeBody }), asyncHandler(async (req, res) => ok(res, await routingService.update(callerOf(req), validated(res, 'params', id).id, validated(res, 'body', routeBody)))));
  r.post('/routes/:id/duplicate', requirePageAction('plant-unit-routing', 'add'), validate({ params: id }), asyncHandler(async (req, res) => ok(res, await routingService.duplicate(callerOf(req), validated(res, 'params', id).id), 201)));
  r.delete('/routes/:id', requirePageAction('plant-unit-routing', 'delete'), validate({ params: id }), asyncHandler(async (req, res) => ok(res, await routingService.remove(callerOf(req), validated(res, 'params', id).id))));

  // ---- live routing (mfg-unit-route)
  get('/plants', 'mfg-unit-route', (req) => routingService.plantStrip(callerOf(req)));
  r.get('/live', requirePageAction('mfg-unit-route', 'view'), validate({ query: listQuery }), asyncHandler(async (req, res) => {
    const q = validated(res, 'query', listQuery);
    ok(res, await routingService.live(callerOf(req), { view: q.view, unitId: q.unitId, q: q.q }));
  }));
  get('/assignable', 'mfg-unit-route', (req) => routingService.assignable(callerOf(req)));
  const assignBody = z.object({ orderId: uuid, routeId: uuid }).strict();
  r.post('/job-routes', requirePageAction('mfg-unit-route', 'add'), validate({ body: assignBody }), asyncHandler(async (req, res) => ok(res, await routingService.assign(callerOf(req), validated(res, 'body', assignBody)), 201)));
  const recordBody = z.object({ good: z.number().min(0).optional(), scrap: z.number().min(0).optional(), rejected: z.number().min(0).optional() }).strict();
  r.post('/job-routes/:id/record', requirePageAction('mfg-unit-route', 'edit'), validate({ params: id, body: recordBody }), asyncHandler(async (req, res) => ok(res, await routingService.record(callerOf(req), validated(res, 'params', id).id, validated(res, 'body', recordBody)))));
  r.post('/job-routes/:id/advance', requirePageAction('mfg-unit-route', 'edit'), validate({ params: id }), asyncHandler(async (req, res) => ok(res, await routingService.advance(callerOf(req), validated(res, 'params', id).id))));

  // ---- BOM & Material Approval (flow-bom-approval)
  get('/bom-flows/options', 'flow-bom-approval', (req) => bomFlowService.options(callerOf(req)));
  r.get('/bom-flows', requirePageAction('flow-bom-approval', 'view'), validate({ query: listQuery }), asyncHandler(async (req, res) => ok(res, await bomFlowService.list(callerOf(req), validated(res, 'query', listQuery)))));
  get('/bom-flows/:id', 'flow-bom-approval', (req) => bomFlowService.get(callerOf(req), id.parse(req.params).id));
  get('/bom-flows/:id/trace', 'flow-bom-approval', (req) => bomFlowService.trace(callerOf(req), id.parse(req.params).id));
  const flowBody = z.object({ bomId: uuid, qty, salesOrderId: uuid.nullable().optional() }).strict();
  r.post('/bom-flows', requirePageAction('flow-bom-approval', 'add'), validate({ body: flowBody }), asyncHandler(async (req, res) => ok(res, await bomFlowService.create(callerOf(req), validated(res, 'body', flowBody)), 201)));
  r.post('/bom-flows/:id/verify', requirePageAction('flow-bom-approval', 'edit'), validate({ params: id }), asyncHandler(async (req, res) => ok(res, await bomFlowService.verify(callerOf(req), validated(res, 'params', id).id))));
  const decisionBody = z.object({ approve: z.boolean() }).strict();
  r.post('/bom-flows/:id/sales-decision', requirePageAction('flow-bom-approval', 'approve'), validate({ params: id, body: decisionBody }), asyncHandler(async (req, res) => ok(res, await bomFlowService.salesDecision(callerOf(req), validated(res, 'params', id).id, validated(res, 'body', decisionBody).approve))));
  r.post('/bom-flows/:id/raise-pr', requirePageAction('flow-bom-approval', 'add'), validate({ params: id }), asyncHandler(async (req, res) => ok(res, await bomFlowService.raisePr(callerOf(req), validated(res, 'params', id).id), 201)));
  r.post('/bom-flows/:id/release', requirePageAction('flow-bom-approval', 'approve'), validate({ params: id }), asyncHandler(async (req, res) => ok(res, await bomFlowService.release(callerOf(req), validated(res, 'params', id).id))));

  // ---- Material Transfer Note (mfg-transfer-note)
  get('/transfers/options', 'mfg-transfer-note', (req) => transferService.options(callerOf(req)));
  get('/transfers/cards', 'mfg-transfer-note', (req) => transferService.cards(callerOf(req)));
  get('/transfers/disputes', 'mfg-transfer-note', (req) => transferService.disputes(callerOf(req)));
  get('/transfers/audit', 'mfg-transfer-note', (req) => transferService.audit(callerOf(req)));
  r.get('/transfers', requirePageAction('mfg-transfer-note', 'view'), validate({ query: listQuery }), asyncHandler(async (req, res) => ok(res, await transferService.list(callerOf(req), validated(res, 'query', listQuery)))));
  get('/transfers/:id', 'mfg-transfer-note', (req) => transferService.get(callerOf(req), id.parse(req.params).id));
  r.post('/transfers', requirePageAction('mfg-transfer-note', 'add'), validate({ body: noteBody }), asyncHandler(async (req, res) => ok(res, await transferService.create(callerOf(req), validated(res, 'body', noteBody)), 201)));
  const routingBody = z.object({ fromWarehouseId: uuid.nullable().optional(), toWarehouseId: uuid.nullable().optional(), itemId: uuid.nullable().optional() }).strict();
  r.put('/transfers/:id/routing', requirePageAction('mfg-transfer-note', 'edit'), validate({ params: id, body: routingBody }), asyncHandler(async (req, res) => ok(res, await transferService.setRouting(callerOf(req), validated(res, 'params', id).id, validated(res, 'body', routingBody)))));
  r.post('/transfers/:id/send', requirePageAction('mfg-transfer-note', 'edit'), validate({ params: id, body: empty }), asyncHandler(async (req, res) => ok(res, await transferService.dispatch(callerOf(req), validated(res, 'params', id).id))));
  const receiveBody = z.object({ receivedQty: qty.optional(), shortReason: z.string().max(300).nullable().optional() }).strict();
  r.post('/transfers/:id/receive', requirePageAction('mfg-transfer-note', 'edit'), validate({ params: id, body: receiveBody }), asyncHandler(async (req, res) => ok(res, await transferService.receive(callerOf(req), validated(res, 'params', id).id, validated(res, 'body', receiveBody)))));
  const reconBody = z.object({ note: z.string().max(300).nullable().optional() }).strict();
  r.post('/transfers/:id/reconcile', requirePageAction('mfg-transfer-note', 'edit'), validate({ params: id, body: reconBody }), asyncHandler(async (req, res) => ok(res, await transferService.reconcile(callerOf(req), validated(res, 'params', id).id, validated(res, 'body', reconBody)))));

  return r;
}
