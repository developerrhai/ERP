// Phase 26 routes (mounted at the API root, paths as in PHASE-26 section 6).
import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { authenticate, requirePasswordChanged } from '../../core/auth/authenticate';
import { resolveContext } from '../../core/context/resolve-context';
import { asyncHandler } from '../../core/http/async-handler';
import { validate, validated } from '../../core/http/validate';
import { requirePageAction } from '../../core/rbac/access';
import { callerOf } from '../inventory/routes-shared';
import { spineService } from './service';
import { dossierModel, dossierPdf, historyWorkbook } from './export';

const ok = (res: Response, data: unknown, status = 200) => res.status(status).json({ data });
const id = z.object({ id: z.string().uuid() }).strict();
const pg = z.object({ id: z.string().uuid(), gateId: z.string().uuid() }).strict();
const num = z.number().finite().nullable().optional();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const enqBody = z.object({
  customerId: z.string().uuid().nullable().optional(), prospectName: z.string().max(120).nullable().optional(), contact: z.string().max(120).nullable().optional(),
  product: z.string().min(1).max(200), application: z.string().max(300).nullable().optional(), qty: num, requiredDate: date.nullable().optional(),
  source: z.string().max(60).nullable().optional(), assignedToId: z.string().uuid().nullable().optional(), projectTemplate: z.enum(['BLDC', 'SPPM', 'CUSTOM']).nullable().optional(),
  unitId: z.string().uuid().optional(),
}).strict();

export function createSpineRouter(): Router {
  const r = Router();
  // Mounted at the API root: the login check must only cover this phase's own paths (public routes follow it).
  r.use(['/sales/enquiries', '/orders', '/projects', '/gate-templates', '/exceptions'], authenticate, requirePasswordChanged, resolveContext);
  const h = (fn: (req: Request, res: Response) => Promise<unknown>) => asyncHandler(fn as (req: Request, res: Response) => Promise<void>);

  // ---- enquiries
  const eq = z.object({ status: z.enum(['New', 'Qualified', 'Quoted', 'Won', 'Lost']).optional(), q: z.string().max(60).optional(), page: z.coerce.number().int().min(1).optional(), size: z.coerce.number().int().min(1).max(100).optional() }).strict();
  r.get('/sales/enquiries', requirePageAction('sales-enquiries', 'view'), validate({ query: eq }), h(async (req, res) => {
    const q = validated(res, 'query', eq);
    const { rows, total } = await spineService.listEnquiries(callerOf(req), q);
    res.json({ data: rows, meta: { page: q.page ?? 1, size: q.size ?? 25, total } });
  }));
  r.post('/sales/enquiries', requirePageAction('sales-enquiries', 'add'), validate({ body: enqBody }), h(async (req, res) => ok(res, await spineService.createEnquiry(callerOf(req), validated(res, 'body', enqBody)), 201)));
  r.get('/sales/enquiries/:id', requirePageAction('sales-enquiries', 'view'), validate({ params: id }), h(async (req, res) => ok(res, await spineService.enquiry(callerOf(req), validated(res, 'params', id).id))));
  r.post('/sales/enquiries/:id/qualify', requirePageAction('sales-enquiries', 'edit'), validate({ params: id }), h(async (req, res) => ok(res, await spineService.setEnquiryStatus(callerOf(req), validated(res, 'params', id).id, 'Qualified'))));
  r.post('/sales/enquiries/:id/won', requirePageAction('sales-enquiries', 'edit'), validate({ params: id }), h(async (req, res) => ok(res, await spineService.setEnquiryStatus(callerOf(req), validated(res, 'params', id).id, 'Won'))));
  r.post('/sales/enquiries/:id/to-quotation', requirePageAction('sales-enquiries', 'edit'), validate({ params: id }), h(async (req, res) => ok(res, await spineService.toQuotation(callerOf(req), validated(res, 'params', id).id))));
  const toProj = z.object({ template: z.enum(['BLDC', 'SPPM', 'CUSTOM']).optional(), projectManagerId: z.string().uuid().optional() }).strict();
  r.post('/sales/enquiries/:id/to-project', requirePageAction('sales-enquiries', 'edit'), validate({ params: id, body: toProj }), h(async (req, res) => ok(res, await spineService.toProject(callerOf(req), validated(res, 'params', id).id, validated(res, 'body', toProj)), 201)));
  const lost = z.object({ lostReason: z.string().max(300).default('') }).strict();
  r.post('/sales/enquiries/:id/mark-lost', requirePageAction('sales-enquiries', 'edit'), validate({ params: id, body: lost }), h(async (req, res) => ok(res, await spineService.markLost(callerOf(req), validated(res, 'params', id).id, validated(res, 'body', lost).lostReason))));

  // ---- 360
  r.get('/orders/:id/360', requirePageAction('ops-order-360', 'view'), validate({ params: id }), h(async (req, res) => ok(res, await spineService.order360(callerOf(req), validated(res, 'params', id).id))));

  // ---- projects: options, history, gates, specs, tests, documents, dossier
  const oq = z.object({ q: z.string().max(60).default('') }).strict();
  r.get('/projects/options', validate({ query: oq }), h(async (req, res) => ok(res, await spineService.options(callerOf(req), validated(res, 'query', oq).q))));
  const hq = z.object({ kind: z.string().max(20).optional(), dept: z.string().uuid().optional(), unit: z.string().uuid().optional(), cursor: z.string().max(40).optional(), limit: z.coerce.number().int().min(1).max(200).optional() }).strict();
  r.get('/projects/:id/history', requirePageAction('project-global-history', 'view'), validate({ params: id, query: hq }), h(async (req, res) => {
    const out = await spineService.history(callerOf(req), validated(res, 'params', id).id, validated(res, 'query', hq));
    res.json({ data: out.rows, meta: { next: out.next } });
  }));
  r.get('/projects/:id/history/export.xlsx', requirePageAction('project-global-history', 'view'), validate({ params: id }), h(async (req, res) => {
    const out = await spineService.history(callerOf(req), validated(res, 'params', id).id, { limit: 200 });
    const buf = await historyWorkbook(out.rows);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="project-history.xlsx"');
    res.send(buf);
  }));

  r.get('/gate-templates', requirePageAction('proj-stage-gates', 'view'), h(async (_req, res) => ok(res, await spineService.templates())));
  const apply = z.object({ template: z.enum(['BLDC', 'SPPM', 'CUSTOM']) }).strict();
  r.get('/projects/:id/gates', requirePageAction('proj-stage-gates', 'view'), validate({ params: id }), h(async (req, res) => ok(res, await spineService.gates(callerOf(req), validated(res, 'params', id).id))));
  r.post('/projects/:id/gates', requirePageAction('proj-stage-gates', 'add'), validate({ params: id, body: apply }), h(async (req, res) => ok(res, await spineService.applyTemplate(callerOf(req), validated(res, 'params', id).id, validated(res, 'body', apply).template), 201)));
  r.post('/projects/:id/gates/:gateId/start', requirePageAction('proj-stage-gates', 'edit'), validate({ params: pg }), h(async (req, res) => { const p = validated(res, 'params', pg); ok(res, await spineService.startGate(callerOf(req), p.id, p.gateId)); }));
  const due = z.object({ dueDate: date.nullable() }).strict();
  r.put('/projects/:id/gates/:gateId/due', requirePageAction('proj-stage-gates', 'edit'), validate({ params: pg, body: due }), h(async (req, res) => { const p = validated(res, 'params', pg); ok(res, await spineService.setGateDue(callerOf(req), p.id, p.gateId, validated(res, 'body', due).dueDate)); }));
  r.post('/projects/:id/gates/:gateId/submit', requirePageAction('proj-stage-gates', 'submit'), validate({ params: pg }), h(async (req, res) => { const p = validated(res, 'params', pg); ok(res, await spineService.submitGate(callerOf(req), p.id, p.gateId)); }));

  const spec = z.object({ parameter: z.string().min(1).max(120), target: num, tolMinus: num, tolPlus: num, unit: z.string().max(20).nullable().optional(), specNo: z.string().max(30).optional() }).strict();
  const rev = z.object({ target: num, tolMinus: num, tolPlus: num }).strict();
  const sp = z.object({ id: z.string().uuid(), specId: z.string().uuid() }).strict();
  r.get('/projects/:id/specs', requirePageAction('proj-specifications', 'view'), validate({ params: id }), h(async (req, res) => ok(res, await spineService.listSpecs(callerOf(req), validated(res, 'params', id).id))));
  r.post('/projects/:id/specs', requirePageAction('proj-specifications', 'add'), validate({ params: id, body: spec }), h(async (req, res) => ok(res, await spineService.addSpec(callerOf(req), validated(res, 'params', id).id, validated(res, 'body', spec)), 201)));
  r.post('/projects/:id/specs/:specId/approve', requirePageAction('proj-specifications', 'edit'), validate({ params: sp }), h(async (req, res) => { const p = validated(res, 'params', sp); ok(res, await spineService.approveSpec(callerOf(req), p.id, p.specId)); }));
  r.post('/projects/:id/specs/:specId/revise', requirePageAction('proj-specifications', 'edit'), validate({ params: sp, body: rev }), h(async (req, res) => { const p = validated(res, 'params', sp); ok(res, await spineService.reviseSpec(callerOf(req), p.id, p.specId, validated(res, 'body', rev)), 201); }));

  const test = z.object({ testName: z.string().min(1).max(120), gateId: z.string().uuid().nullable().optional(), method: z.string().max(200).nullable().optional(), specId: z.string().uuid().nullable().optional(), sample: z.string().max(60).nullable().optional(), value: num, result: z.enum(['OK', 'NG']).nullable().optional() }).strict();
  r.get('/projects/:id/tests', requirePageAction('proj-test-records', 'view'), validate({ params: id }), h(async (req, res) => ok(res, await spineService.listTests(callerOf(req), validated(res, 'params', id).id))));
  r.post('/projects/:id/tests', requirePageAction('proj-test-records', 'add'), validate({ params: id, body: test }), h(async (req, res) => ok(res, await spineService.addTest(callerOf(req), validated(res, 'params', id).id, validated(res, 'body', test)), 201)));

  const doc = z.object({ docType: z.enum(['URS', 'CHARTER', 'SPEC', 'DRR', 'BOM', 'PO', 'IQC', 'JC', 'TR', 'FAT', 'DC', 'SAT', 'INV', 'CLOSE']), title: z.string().min(1).max(160), gateId: z.string().uuid().nullable().optional(), documentId: z.string().uuid().nullable().optional() }).strict();
  const dp = z.object({ id: z.string().uuid(), docId: z.string().uuid() }).strict();
  r.get('/projects/:id/documents', requirePageAction('proj-documents', 'view'), validate({ params: id }), h(async (req, res) => ok(res, await spineService.listDocuments(callerOf(req), validated(res, 'params', id).id))));
  r.post('/projects/:id/documents', requirePageAction('proj-documents', 'add'), validate({ params: id, body: doc }), h(async (req, res) => ok(res, await spineService.addDocument(callerOf(req), validated(res, 'params', id).id, validated(res, 'body', doc)), 201)));
  r.post('/projects/:id/documents/:docId/approve', requirePageAction('proj-documents', 'edit'), validate({ params: dp }), h(async (req, res) => { const p = validated(res, 'params', dp); ok(res, await spineService.approveDocument(callerOf(req), p.id, p.docId)); }));

  r.get('/projects/:id/dossier.pdf', requirePageAction('proj-stage-gates', 'view'), validate({ params: id }), h(async (req, res) => {
    const pid = validated(res, 'params', id).id;
    const caller = callerOf(req);
    const model = await dossierModel(caller, pid);
    const buf = await dossierPdf(model);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="dossier-${String(model.project.code).replace(/[^A-Za-z0-9-]/g, '_')}.pdf"`);
    res.send(buf);
  }));

  // ---- exceptions
  const xq = z.object({ dept: z.string().max(40).optional(), severity: z.enum(['Low', 'Medium', 'High']).optional(), state: z.enum(['open', 'resolved', 'all']).optional() }).strict();
  r.get('/exceptions', requirePageAction('process-exceptions', 'view'), validate({ query: xq }), h(async (req, res) => ok(res, await spineService.exceptions(callerOf(req), validated(res, 'query', xq)))));
  const xa = z.object({ note: z.string().max(500).optional(), assignedToId: z.string().uuid().optional() }).strict();
  for (const action of ['note', 'assign', 'resolve'] as const) {
    r.post(`/exceptions/:id/${action}`, requirePageAction('process-exceptions', 'edit'), validate({ params: id, body: xa }), h(async (req, res) => ok(res, await spineService.exceptionAction(callerOf(req), validated(res, 'params', id).id, action, validated(res, 'body', xa)))));
  }
  r.post('/exceptions/run', requirePageAction('process-exceptions', 'edit'), h(async (_req, res) => ok(res, await spineService.runExceptionChecks())));

  return r;
}
