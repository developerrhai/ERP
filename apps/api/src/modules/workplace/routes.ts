// Phase 29 routes: /ops/tasks, /ops/handovers, /ops/visitors, /ops/canteen.
import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { authenticate, requirePasswordChanged } from '../../core/auth/authenticate';
import { resolveContext } from '../../core/context/resolve-context';
import { asyncHandler } from '../../core/http/async-handler';
import { validate, validated } from '../../core/http/validate';
import { requirePageAction } from '../../core/rbac/access';
import { callerOf } from '../inventory/routes-shared';
import { renderPrint } from '../docsmail/print';
import { canteenService, handoverService, taskService, visitorService } from './service';

const ok = (res: Response, data: unknown, status = 200) => res.status(status).json({ data });
const uuid = z.string().uuid();
const id = z.object({ id: uuid }).strict();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const month = z.string().regex(/^\d{4}-\d{2}$/);
const ts = z.string().max(40);

export function createWorkplaceRouter(): Router {
  const r = Router();
  r.use('/ops', authenticate, requirePasswordChanged, resolveContext);
  const h = (fn: (req: Request, res: Response) => Promise<unknown>) => asyncHandler(fn as (req: Request, res: Response) => Promise<void>);

  // ---------------------------------------------------------------- tasks
  const rec = z.object({ kind: z.enum(['DAILY', 'WEEKLY', 'MONTHLY', 'EVERY_N']), days: z.array(z.number().int().min(1).max(7)).max(7).optional(), n: z.number().int().min(1).max(365).optional() }).strict();
  const taskBody = z.object({ title: z.string().min(1).max(200), description: z.string().max(2000).nullable().optional(), department: z.string().max(60).nullable().optional(), assignedToId: uuid.nullable().optional(), priority: z.enum(['Low', 'Medium', 'High', 'Critical']).optional(), startDate: date.nullable().optional(), dueDate: date.nullable().optional(), approvalRequired: z.boolean().optional(), projectId: uuid.nullable().optional(), linkedDocType: z.string().max(60).nullable().optional(), linkedDocId: uuid.nullable().optional(), recurrence: rec.nullable().optional(), checklist: z.array(z.string().min(1).max(200)).max(30).optional(), dependsOn: z.array(uuid).max(10).optional(), unitId: uuid.optional() }).strict();
  const tq = z.object({ dept: z.string().max(60).optional(), mine: z.enum(['true', 'false']).optional(), status: z.enum(['Open', 'In Progress', 'Blocked', 'Done', 'Approved', 'Cancelled']).optional(), overdue: z.enum(['true', 'false']).optional(), q: z.string().max(40).optional(), unit: uuid.optional(), page: z.coerce.number().int().min(1).optional(), size: z.coerce.number().int().min(1).max(100).optional() }).strict();
  r.get('/ops/tasks', requirePageAction('ops-tasks', 'view'), validate({ query: tq }), h(async (req, res) => { const q = validated(res, 'query', tq); const out = await taskService.list(callerOf(req), { ...q, mine: q.mine === 'true', overdue: q.overdue === 'true' }); res.json({ data: out.rows, meta: { total: out.total, page: q.page ?? 1, size: q.size ?? 50 } }); }));
  const bq = z.object({ dept: z.string().max(60).optional(), unit: uuid.optional() }).strict();
  r.get('/ops/tasks/board', requirePageAction('ops-tasks', 'view'), validate({ query: bq }), h(async (req, res) => ok(res, await taskService.board(callerOf(req), validated(res, 'query', bq)))));
  const wq = z.object({ dept: z.string().max(60).optional() }).strict();
  r.get('/ops/tasks/workload', requirePageAction('ops-tasks', 'view'), validate({ query: wq }), h(async (req, res) => ok(res, await taskService.workload(callerOf(req), validated(res, 'query', wq)))));
  r.post('/ops/tasks', requirePageAction('ops-tasks', 'add'), validate({ body: taskBody }), h(async (req, res) => ok(res, await taskService.create(callerOf(req), validated(res, 'body', taskBody) as never), 201)));
  r.get('/ops/tasks/:id', requirePageAction('ops-tasks', 'view'), validate({ params: id }), h(async (req, res) => ok(res, await taskService.detail(callerOf(req), validated(res, 'params', id).id))));
  r.post('/ops/tasks/:id/start', requirePageAction('ops-tasks', 'edit'), validate({ params: id }), h(async (req, res) => ok(res, await taskService.start(callerOf(req), validated(res, 'params', id).id))));
  r.post('/ops/tasks/:id/done', requirePageAction('ops-tasks', 'edit'), validate({ params: id }), h(async (req, res) => ok(res, await taskService.done(callerOf(req), validated(res, 'params', id).id))));
  r.post('/ops/tasks/:id/approve', requirePageAction('ops-tasks', 'approve'), validate({ params: id }), h(async (req, res) => ok(res, await taskService.approve(callerOf(req), validated(res, 'params', id).id))));
  const reason = z.object({ reason: z.string().max(300).default('') }).strict();
  r.post('/ops/tasks/:id/reopen', requirePageAction('ops-tasks', 'edit'), validate({ params: id, body: reason }), h(async (req, res) => ok(res, await taskService.reopen(callerOf(req), validated(res, 'params', id).id, validated(res, 'body', reason).reason))));
  const pct = z.object({ progressPct: z.number().int().min(0).max(100) }).strict();
  r.post('/ops/tasks/:id/progress', requirePageAction('ops-tasks', 'edit'), validate({ params: id, body: pct }), h(async (req, res) => ok(res, await taskService.progress(callerOf(req), validated(res, 'params', id).id, validated(res, 'body', pct).progressPct))));
  const cm = z.object({ body: z.string().max(1000).default('') }).strict();
  r.post('/ops/tasks/:id/comment', requirePageAction('ops-tasks', 'view'), validate({ params: id, body: cm }), h(async (req, res) => ok(res, await taskService.comment(callerOf(req), validated(res, 'params', id).id, validated(res, 'body', cm).body), 201)));
  const tk = z.object({ id: uuid, itemId: uuid }).strict();
  const tkb = z.object({ done: z.boolean() }).strict();
  r.post('/ops/tasks/:id/checklist/:itemId', requirePageAction('ops-tasks', 'edit'), validate({ params: tk, body: tkb }), h(async (req, res) => { const p = validated(res, 'params', tk); ok(res, await taskService.tick(callerOf(req), p.id, p.itemId, validated(res, 'body', tkb).done)); }));
  const dep = z.object({ dependsOnId: uuid }).strict();
  r.post('/ops/tasks/:id/dependencies', requirePageAction('ops-tasks', 'edit'), validate({ params: id, body: dep }), h(async (req, res) => ok(res, await taskService.addDependency(callerOf(req), validated(res, 'params', id).id, validated(res, 'body', dep).dependsOnId), 201)));

  // ---------------------------------------------------------------- handovers
  const hb = z.object({ department: z.string().min(1).max(60), handoverDate: date, fromShiftId: uuid.nullable().optional(), toShiftId: uuid.nullable().optional(), incomingUserId: uuid.nullable().optional(), lines: z.array(z.record(z.unknown())).max(50).optional(), issues: z.string().max(2000).nullable().optional(), safetyNote: z.string().max(1000).nullable().optional(), pendingJobs: z.array(z.record(z.unknown())).max(50).optional(), materialsShort: z.string().max(1000).nullable().optional(), unitId: uuid.optional() }).strict();
  const hq = z.object({ status: z.enum(['DRAFT', 'SUBMITTED', 'ACCEPTED', 'REJECTED']).optional() }).strict();
  r.get('/ops/handovers', requirePageAction('ops-shift-roster', 'view'), validate({ query: hq }), h(async (req, res) => ok(res, await handoverService.list(callerOf(req), validated(res, 'query', hq).status))));
  r.post('/ops/handovers', requirePageAction('ops-shift-roster', 'add'), validate({ body: hb }), h(async (req, res) => ok(res, await handoverService.create(callerOf(req), validated(res, 'body', hb) as never), 201)));
  r.get('/ops/handovers/:id', requirePageAction('ops-shift-roster', 'view'), validate({ params: id }), h(async (req, res) => ok(res, await handoverService.get(callerOf(req), validated(res, 'params', id).id))));
  r.post('/ops/handovers/:id/submit', requirePageAction('ops-shift-roster', 'edit'), validate({ params: id }), h(async (req, res) => ok(res, await handoverService.submit(callerOf(req), validated(res, 'params', id).id))));
  r.post('/ops/handovers/:id/accept', requirePageAction('ops-shift-roster', 'edit'), validate({ params: id }), h(async (req, res) => ok(res, await handoverService.accept(callerOf(req), validated(res, 'params', id).id))));
  r.post('/ops/handovers/:id/reject', requirePageAction('ops-shift-roster', 'edit'), validate({ params: id, body: reason }), h(async (req, res) => ok(res, await handoverService.reject(callerOf(req), validated(res, 'params', id).id, validated(res, 'body', reason).reason))));

  // ---------------------------------------------------------------- visitors
  const vb = z.object({ visitorName: z.string().min(1).max(120), mobile: z.string().max(15).nullable().optional(), company: z.string().max(120).nullable().optional(), hostUserId: uuid.nullable().optional(), department: z.string().max(60).nullable().optional(), visitDate: date, plannedIn: ts.nullable().optional(), plannedOut: ts.nullable().optional(), purpose: z.string().min(1).max(300), vehicleNo: z.string().max(20).nullable().optional(), idType: z.string().max(30).nullable().optional(), idLast4: z.string().regex(/^[0-9A-Za-z]{4}$/, 'Give only the last 4 characters of the ID.').nullable().optional(), items: z.array(z.record(z.unknown())).max(30).optional(), unitId: uuid.optional() }).strict();
  const vq = z.object({ status: z.enum(['PRE_REGISTERED', 'APPROVED', 'INSIDE', 'OUT', 'REJECTED', 'NO_SHOW', 'CANCELLED']).optional(), date: date.optional(), q: z.string().max(40).optional() }).strict();
  r.get('/ops/visitors', requirePageAction('ops-visitors', 'view'), validate({ query: vq }), h(async (req, res) => ok(res, await visitorService.list(callerOf(req), validated(res, 'query', vq)))));
  r.get('/ops/visitors/inside', requirePageAction('ops-visitors', 'view'), h(async (req, res) => ok(res, await visitorService.inside(callerOf(req)))));
  r.post('/ops/visitors', requirePageAction('ops-visitors', 'add'), validate({ body: vb }), h(async (req, res) => ok(res, await visitorService.create(callerOf(req), validated(res, 'body', vb) as never), 201)));
  const ci = z.object({ id: uuid.optional(), token: z.string().max(80).optional(), idLast4: z.string().regex(/^[0-9A-Za-z]{4}$/).nullable().optional(), vehicleNo: z.string().max(20).nullable().optional() }).strict();
  r.post('/ops/visitors/check-in', requirePageAction('ops-visitors', 'edit'), validate({ body: ci }), h(async (req, res) => { const b = validated(res, 'body', ci); if (!b.id && !b.token) return ok(res, { error: 'Give the pass or the QR code.' }, 422); ok(res, await visitorService.checkIn(callerOf(req), b)); }));
  r.get('/ops/visitors/:id', requirePageAction('ops-visitors', 'view'), validate({ params: id }), h(async (req, res) => ok(res, await visitorService.get(callerOf(req), validated(res, 'params', id).id))));
  r.post('/ops/visitors/:id/approve', requirePageAction('ops-visitors', 'edit'), validate({ params: id }), h(async (req, res) => ok(res, await visitorService.decide(callerOf(req), validated(res, 'params', id).id, true))));
  r.post('/ops/visitors/:id/reject', requirePageAction('ops-visitors', 'edit'), validate({ params: id }), h(async (req, res) => ok(res, await visitorService.decide(callerOf(req), validated(res, 'params', id).id, false))));
  r.post('/ops/visitors/:id/qr', requirePageAction('ops-visitors', 'edit'), validate({ params: id }), h(async (req, res) => ok(res, await visitorService.issueQr(callerOf(req), validated(res, 'params', id).id))));
  r.post('/ops/visitors/:id/check-out', requirePageAction('ops-visitors', 'edit'), validate({ params: id }), h(async (req, res) => ok(res, await visitorService.checkOut(callerOf(req), validated(res, 'params', id).id))));
  r.get('/ops/visitors/:id/pass.pdf', requirePageAction('ops-visitors', 'view'), validate({ params: id }), h(async (req, res) => {
    const out = await renderPrint(callerOf(req), 'ops-visitors', validated(res, 'params', id).id, 'standard');
    res.setHeader('Content-Type', out.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${out.filename}"`);
    res.send(out.buffer);
  }));

  // ---------------------------------------------------------------- canteen
  r.get('/ops/canteen/rates', requirePageAction('ops-canteen', 'view'), h(async (req, res) => ok(res, await canteenService.rates(callerOf(req)))));
  const rb = z.object({ unitId: uuid.optional(), mealType: z.string().min(1).max(20), rate: z.number().min(0).max(100000), gstPct: z.number().min(0).max(28).optional(), employeeSharePct: z.number().min(0).max(100).optional(), effectiveFrom: date.optional() }).strict();
  r.put('/ops/canteen/rates', requirePageAction('ops-canteen', 'edit'), validate({ body: rb }), h(async (req, res) => ok(res, await canteenService.setRate(callerOf(req), validated(res, 'body', rb)))));
  r.get('/ops/canteen/entitlements', requirePageAction('ops-canteen', 'view'), h(async (req, res) => ok(res, await canteenService.entitlements(callerOf(req)))));
  const eb = z.object({ unitId: uuid.optional(), shiftId: uuid, mealType: z.string().min(1).max(20), on: z.boolean() }).strict();
  r.put('/ops/canteen/entitlements', requirePageAction('ops-canteen', 'edit'), validate({ body: eb }), h(async (req, res) => ok(res, await canteenService.setEntitlement(callerOf(req), validated(res, 'body', eb)))));
  const sc = z.object({ code: z.string().min(1).max(40), mealType: z.string().min(1).max(20), extra: z.boolean().optional(), unitId: uuid.optional() }).strict();
  r.post('/ops/canteen/scan', requirePageAction('ops-canteen', 'add'), validate({ body: sc }), h(async (req, res) => ok(res, await canteenService.scan(callerOf(req), validated(res, 'body', sc)), 201)));
  const tuq = z.object({ unit: uuid.optional() }).strict();
  r.get('/ops/canteen/today', requirePageAction('ops-canteen', 'view'), validate({ query: tuq }), h(async (req, res) => ok(res, await canteenService.today(callerOf(req), validated(res, 'query', tuq).unit))));
  const rq = z.object({ month: month.optional(), date: date.optional(), q: z.string().max(40).optional() }).strict();
  r.get('/ops/canteen/register', requirePageAction('ops-canteen', 'view'), validate({ query: rq }), h(async (req, res) => ok(res, await canteenService.register(callerOf(req), validated(res, 'query', rq)))));
  const mq = z.object({ month }).strict();
  r.get('/ops/canteen/department-cost', requirePageAction('ops-canteen', 'view'), validate({ query: mq }), h(async (req, res) => ok(res, await canteenService.departmentCost(callerOf(req), validated(res, 'query', mq).month))));
  const wb = z.object({ unitId: uuid.optional(), date, mealType: z.string().max(20), kg: z.number().min(0).max(100000), reason: z.string().max(200).nullable().optional() }).strict();
  r.post('/ops/canteen/waste', requirePageAction('ops-canteen', 'add'), validate({ body: wb }), h(async (req, res) => ok(res, await canteenService.addWaste(callerOf(req), validated(res, 'body', wb)), 201)));
  r.get('/ops/canteen/months', requirePageAction('ops-canteen', 'view'), h(async (req, res) => ok(res, await canteenService.months(callerOf(req)))));
  const cp = z.object({ month }).strict();
  const cb = z.object({ unitId: uuid.optional() }).strict();
  r.post('/ops/canteen/months/:month/close', requirePageAction('ops-canteen', 'approve'), validate({ params: cp, body: cb }), h(async (req, res) => ok(res, await canteenService.closeMonth(callerOf(req), validated(res, 'params', cp).month, validated(res, 'body', cb).unitId))));
  r.get('/ops/canteen/vendor-bills', requirePageAction('ops-canteen', 'view'), h(async (req, res) => ok(res, await canteenService.vendorBills(callerOf(req)))));
  const vbill = z.object({ unitId: uuid.optional(), month, vendorName: z.string().max(120).nullable().optional(), supplierId: uuid.nullable().optional(), mealsBilled: z.number().int().min(0).max(1_000_000) }).strict();
  r.post('/ops/canteen/vendor-bills', requirePageAction('ops-canteen', 'add'), validate({ body: vbill }), h(async (req, res) => ok(res, await canteenService.addVendorBill(callerOf(req), validated(res, 'body', vbill)), 201)));
  r.post('/ops/canteen/vendor-bills/:id/approve', requirePageAction('ops-canteen', 'approve'), validate({ params: id }), h(async (req, res) => ok(res, await canteenService.approveVendorBill(callerOf(req), validated(res, 'params', id).id))));

  return r;
}
