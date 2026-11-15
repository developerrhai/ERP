// Phase 25 routes: /api/v1/work. Inbox, Work Center, Move Forward and the receive / accept / return / recall / complete
// actions, history, the Workflow Matrix. Nothing here forwards by itself.
import { commandItems } from './command-items';
import { docPicker } from './picker';
import { searchFamilies, searchRecords } from './record-search';
import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { authenticate, requirePasswordChanged } from '../../core/auth/authenticate';
import { resolveContext } from '../../core/context/resolve-context';
import { asyncHandler } from '../../core/http/async-handler';
import { validate, validated } from '../../core/http/validate';
import { requirePageAction } from '../../core/rbac/access';
import { callerOf } from '../inventory/routes-shared';
import { plantFlowService } from './plantflow';
import { workService } from './service';
// --- movements-ext begin
import { registerMovementRoutes } from './movements-ext';
// --- movements-ext end

const ok = (res: Response, data: unknown, status = 200) => res.status(status).json({ data });

const idParams = z.object({ id: z.string().uuid() }).strict();
const docParams = z.object({ docType: z.string().min(1).max(80), docId: z.string().uuid() }).strict();
const moduleParams = z.object({ moduleId: z.string().min(1).max(80) }).strict();

const inboxQuery = z
  .object({
    dept: z.union([z.string().uuid(), z.literal('all')]).optional(),
    tab: z.enum(['receive', 'accept', 'work', 'returned', 'sent', 'all', 'pending', 'completed', 'open', 'ready', 'waiting']).optional(),
    docType: z.string().max(80).optional(),
    late: z.enum(['true', 'false']).optional(),
    q: z.string().max(60).optional(),
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict();

const line = z
  .object({
    itemId: z.string().uuid().nullable().optional(),
    description: z.string().max(200).nullable().optional(),
    qty: z.number().positive(),
    uom: z.string().max(20).nullable().optional(),
    batch: z.string().max(40).nullable().optional(),
    fromLocation: z.string().max(60).nullable().optional(),
    toLocation: z.string().max(60).nullable().optional(),
  })
  .strict();

const forwardBody = z
  .object({
    fromDepartmentId: z.string().uuid().nullable().optional(),
    docType: z.string().min(1).max(80),
    docId: z.string().uuid(),
    docNo: z.string().max(60).optional(),
    toDepartmentId: z.string().uuid(),
    assignedManagerId: z.string().uuid().nullable().optional(),
    routeType: z
      .enum(['Department Work Handover', 'Technical Work', 'Purchase', 'Material Action', 'Manufacturing Action', 'Quality Action', 'Finance', 'Commercial Action', 'Project Action', 'Correction', 'Rework'])
      .optional(),
    priority: z.enum(['Normal', 'High', 'Critical']).optional(),
    requiredBy: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    workStatus: z
      .enum(['Work Required', 'Review Required', 'Material Action Required', 'Manufacturing Required', 'Quality Check Required', 'Dispatch Action Required', 'Finance Action Required', 'Correction Required'])
      .optional(),
    handoverNote: z.string().max(500).nullable().optional(),
    toUnitId: z.string().uuid().nullable().optional(),
    isPhysical: z.boolean().optional(),
    lines: z.array(line).max(200).optional(),
  })
  .strict();

const actBody = z
  .object({
    reason: z.string().max(500).optional(),
    lines: z
      .array(z.object({ lineNo: z.number().int().min(1), receivedQty: z.number().min(0), shortReason: z.string().max(300).optional() }).strict())
      .max(200)
      .optional(),
  })
  .strict()
  .default({});

const ruleBody = z
  .object({
    ownerDepartmentId: z.string().uuid().nullable().optional(),
    nextDepartmentId: z.string().uuid().nullable().optional(),
    approvalDepartmentId: z.string().uuid().nullable().optional(),
    routeMode: z.enum(['MANUAL', 'SUGGEST']).optional(),
    slaDays: z.number().min(0).max(60).optional(),
    routedEdit: z.boolean().optional(),
    active: z.boolean().optional(),
    requiredAttachmentTypes: z.array(z.string().max(40)).max(20).optional(),
    requiredFields: z.array(z.string().max(60)).max(30).optional(),
  })
  .strict();

export function createWorkRouter(): Router {
  const r = Router();
  r.use(authenticate, requirePasswordChanged, resolveContext);

  r.get('/departments', asyncHandler(async (_req: Request, res: Response) => {
    ok(res, await workService.departments());
  }));
  r.get('/managers', asyncHandler(async (req: Request, res: Response) => {
    const dept = z.string().uuid().parse(req.query.dept);
    const unit = callerOf(req).ctx.unitId ?? '';
    ok(res, unit ? await workService.managers(dept, unit) : []);
  }));

  r.get('/inbox', validate({ query: inboxQuery }), asyncHandler(async (req: Request, res: Response) => {
    const q = validated(res, 'query', inboxQuery);
    ok(res, await workService.inbox(callerOf(req), { ...q, late: q.late === 'true' }));
  }));
  r.get('/inbox/counts', asyncHandler(async (req: Request, res: Response) => {
    const dept = typeof req.query.dept === 'string' ? z.union([z.string().uuid(), z.literal('all')]).parse(req.query.dept) : undefined;
    ok(res, await workService.inboxCounts(callerOf(req), { dept }));
  }));
  r.get('/audit', asyncHandler(async (req: Request, res: Response) => {
    const dept = typeof req.query.dept === 'string' ? z.union([z.string().uuid(), z.literal('all')]).parse(req.query.dept) : undefined;
    ok(res, await workService.audit(callerOf(req), { dept }));
  }));
  r.get('/work-center', asyncHandler(async (req: Request, res: Response) => {
    const dept = typeof req.query.dept === 'string' ? z.string().uuid().parse(req.query.dept) : undefined;
    ok(res, await workService.workCenter(callerOf(req), dept));
  }));

  r.get('/plant-flow/:id', validate({ params: idParams }), asyncHandler(async (req: Request, res: Response) => {
    ok(res, await plantFlowService.overview(callerOf(req), validated(res, 'params', idParams).id));
  }));

  r.post('/movements', validate({ body: forwardBody }), asyncHandler(async (req: Request, res: Response) => {
    ok(res, await workService.forward(callerOf(req), validated(res, 'body', forwardBody)), 201);
  }));
  for (const action of ['receive', 'accept', 'return', 'recall', 'complete'] as const) {
    r.post(`/movements/:id/${action}`, validate({ params: idParams, body: actBody }), asyncHandler(async (req: Request, res: Response) => {
      ok(res, await workService.act(callerOf(req), validated(res, 'params', idParams).id, action, validated(res, 'body', actBody)));
    }));
  }
  r.get('/movements/:id/lines', validate({ params: idParams }), asyncHandler(async (req: Request, res: Response) => {
    ok(res, await workService.lines(validated(res, 'params', idParams).id));
  }));
  r.get('/docs/:docType/:docId/movement', validate({ params: docParams }), asyncHandler(async (req: Request, res: Response) => {
    const p = validated(res, 'params', docParams);
    ok(res, { holder: await workService.holder(p.docType, p.docId), ...(await workService.history(p.docType, p.docId)) });
  }));

  const cmdBody = z
    .object({
      issue: z.string().min(1).max(300),
      owner: z.string().max(80).nullable().optional(),
      severity: z.enum(['Critical', 'High', 'Medium', 'Low']).optional(),
      dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      departmentId: z.string().uuid().nullable().optional(),
    })
    .strict();
  r.get('/command-items', requirePageAction('command-center', 'view'), asyncHandler(async (req: Request, res: Response) => {
    ok(res, await commandItems.list(callerOf(req), req.query.all === 'true'));
  }));
  r.post('/command-items', requirePageAction('command-center', 'add'), validate({ body: cmdBody }), asyncHandler(async (req: Request, res: Response) => {
    ok(res, await commandItems.create(callerOf(req), validated(res, 'body', cmdBody)), 201);
  }));
  r.post('/command-items/:id/close', requirePageAction('command-center', 'edit'), validate({ params: idParams }), asyncHandler(async (req: Request, res: Response) => {
    ok(res, await commandItems.close(callerOf(req), validated(res, 'params', idParams).id));
  }));
  r.get('/record-search', asyncHandler(async (req: Request, res: Response) => {
    const q = z.string().max(80).default('').parse(req.query.q ?? '');
    const family = z.string().max(60).default('').parse(req.query.family ?? '');
    const status = z.string().max(30).default('').parse(req.query.status ?? '');
    ok(res, await searchRecords(callerOf(req), q, family, status));
  }));
  r.get('/record-search/families', asyncHandler(async (_req: Request, res: Response) => {
    ok(res, searchFamilies());
  }));
  r.get('/doc-picker/:pageId', asyncHandler(async (req: Request, res: Response) => {
    const pageId = z.string().min(1).max(80).parse(req.params.pageId);
    const q = z.string().max(60).default('').parse(req.query.q ?? '');
    ok(res, await docPicker(callerOf(req), pageId, q));
  }));
  r.get('/workflow-rules', requirePageAction('admin-workflow', 'view'), asyncHandler(async (_req: Request, res: Response) => {
    ok(res, await workService.listRules());
  }));
  r.put('/workflow-rules/:moduleId', requirePageAction('admin-workflow', 'edit'), validate({ params: moduleParams, body: ruleBody }), asyncHandler(async (req: Request, res: Response) => {
    await workService.putRule(callerOf(req), validated(res, 'params', moduleParams).moduleId, validated(res, 'body', ruleBody));
    ok(res, { ok: true });
  }));
  r.get('/workflow-rules/suggest', asyncHandler(async (req: Request, res: Response) => {
    ok(res, await workService.suggest(z.string().min(1).max(80).parse(req.query.docType)));
  }));

  // --- movements-ext begin
  registerMovementRoutes(r);
  // --- movements-ext end

  return r;
}
