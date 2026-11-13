// Phase 27 routes (mounted at the API root): /print, /doc-center (catalog + send), /mail, /admin/mail-automation, /hr/letters, /qms/certificates.
import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { authenticate, requirePasswordChanged } from '../../core/auth/authenticate';
import { resolveContext } from '../../core/context/resolve-context';
import { asyncHandler } from '../../core/http/async-handler';
import { validate, validated } from '../../core/http/validate';
import { requirePageAction } from '../../core/rbac/access';
import { callerOf } from '../inventory/routes-shared';
import { workService } from '../work/service';
import { mailAutomation } from './automation';
import { certificatesService, lettersService } from './letters';
import { mailService27 } from './mail';
import { CATALOG, PRINT_KINDS, catalogCounts, catalogRecords, renderPrint } from './print';
import type { PrintKind } from './print';

const ok = (res: Response, data: unknown, status = 200) => res.status(status).json({ data });
const id = z.object({ id: z.string().uuid() }).strict();
const codeP = z.object({ code: z.string().min(1).max(60) }).strict();
const attach = z.object({ label: z.string().min(1).max(200), pageId: z.string().max(80).nullable().optional(), recordId: z.string().uuid().nullable().optional(), format: z.enum(['pdf', 'word', 'excel']).nullable().optional() }).strict();

export function createDocsMailRouter(): Router {
  const r = Router();
  r.use(['/print', '/doc-center', '/mail', '/admin/mail-automation', '/hr/letters', '/hr/letter-templates', '/qms/certificates'], authenticate, requirePasswordChanged, resolveContext);
  const h = (fn: (req: Request, res: Response) => Promise<unknown>) => asyncHandler(fn as (req: Request, res: Response) => Promise<void>);

  // ---- print
  const pp = z.object({ pageId: z.string().min(1).max(80), id: z.string().uuid() }).strict();
  const pq = z.object({ kind: z.enum(['standard', 'letterhead', 'commercial', 'word', 'excel']).default('standard'), copy: z.enum(['original', 'duplicate']).optional() }).strict();
  r.get('/print/:pageId/:id', validate({ params: pp, query: pq }), h(async (req, res) => {
    const p = validated(res, 'params', pp);
    const q = validated(res, 'query', pq);
    const out = await renderPrint(callerOf(req), p.pageId, p.id, q.kind as PrintKind, q.copy);
    res.setHeader('Content-Type', out.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${out.filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(out.buffer);
  }));
  r.get('/print-kinds', (_req, res) => ok(res, PRINT_KINDS));

  // ---- Document Center
  r.get('/doc-center/catalog', requirePageAction('business-documents', 'view'), h(async (req, res) => ok(res, await catalogCounts(callerOf(req)))));
  const cq = z.object({ q: z.string().max(40).default('') }).strict();
  const cp = z.object({ pageId: z.string().min(1).max(80) }).strict();
  r.get('/doc-center/catalog/:pageId/records', requirePageAction('business-documents', 'view'), validate({ params: cp, query: cq }), h(async (req, res) => ok(res, await catalogRecords(callerOf(req), validated(res, 'params', cp).pageId, validated(res, 'query', cq).q))));
  const send = z.object({ pageId: z.string().min(1).max(80), recordId: z.string().uuid(), docNo: z.string().max(60).optional(), toDepartmentId: z.string().uuid(), note: z.string().max(500).optional(), fromDepartmentId: z.string().uuid().nullable().optional() }).strict();
  r.post('/doc-center/send', requirePageAction('business-documents', 'edit'), validate({ body: send }), h(async (req, res) => {
    const b = validated(res, 'body', send);
    if (!CATALOG.some((c) => c.pageId === b.pageId)) return ok(res, { error: 'Unknown document type.' }, 422);
    ok(res, await workService.forward(callerOf(req), { docType: b.pageId, docId: b.recordId, ...(b.docNo ? { docNo: b.docNo } : {}), toDepartmentId: b.toDepartmentId, ...(b.fromDepartmentId ? { fromDepartmentId: b.fromDepartmentId } : {}), handoverNote: b.note ?? 'Please review the attached ERP document and complete the required action.' }), 201);
  }));

  // ---- mail
  r.get('/mail/departments', requirePageAction('dept-mail', 'view'), h(async (_req, res) => ok(res, await mailService27.departments())));
  const internal = z.object({ fromDepartment: z.string().max(80).nullable().optional(), toDepartmentIds: z.array(z.string().uuid()).max(20).optional(), toUserIds: z.array(z.string().uuid()).max(50).optional(), subject: z.string().max(200).optional(), body: z.string().max(5000).optional(), attachments: z.array(attach).max(10).optional(), unitId: z.string().uuid().optional() }).strict();
  r.post('/mail/internal', requirePageAction('dept-mail', 'add'), validate({ body: internal }), h(async (req, res) => ok(res, await mailService27.sendInternal(callerOf(req), validated(res, 'body', internal)), 201)));
  r.get('/mail/inbox', requirePageAction('dept-mail', 'view'), h(async (req, res) => ok(res, await mailService27.inbox(callerOf(req)))));
  r.get('/mail/sent', requirePageAction('dept-mail', 'view'), h(async (req, res) => ok(res, await mailService27.sent(callerOf(req)))));
  const external = z.object({ to: z.array(z.string().max(200)).min(1).max(20), subject: z.string().max(200).optional(), body: z.string().max(5000).optional(), attachments: z.array(attach).max(10).optional() }).strict();
  r.post('/mail/external', requirePageAction('dept-mail', 'add'), validate({ body: external }), h(async (req, res) => ok(res, await mailService27.sendExternal(callerOf(req), validated(res, 'body', external)), 201)));
  r.get('/mail/:id', requirePageAction('dept-mail', 'view'), validate({ params: id }), h(async (req, res) => ok(res, await mailService27.open(callerOf(req), validated(res, 'params', id).id))));

  // ---- mail automation (Administrator)
  r.get('/admin/mail-automation', requirePageAction('admin-mail-automation', 'view'), h(async (_req, res) => ok(res, await mailAutomation.list())));
  r.post('/admin/mail-automation/run', requirePageAction('admin-mail-automation', 'edit'), h(async (_req, res) => ok(res, await mailAutomation.runDue())));
  const upd = z.object({ enabled: z.boolean().optional(), subjectTpl: z.string().max(300).nullable().optional(), bodyTpl: z.string().max(5000).nullable().optional(), runTime: z.string().max(5).nullable().optional(), offsetDays: z.number().int().min(-60).max(60).nullable().optional() }).strict();
  r.put('/admin/mail-automation/:code', requirePageAction('admin-mail-automation', 'edit'), validate({ params: codeP, body: upd }), h(async (req, res) => ok(res, await mailAutomation.update(callerOf(req), validated(res, 'params', codeP).code, validated(res, 'body', upd)))));
  const plant = z.object({ code: z.string().max(60), unitId: z.string().uuid() }).strict();
  const plantB = z.object({ enabled: z.boolean() }).strict();
  r.put('/admin/mail-automation/:code/plants/:unitId', requirePageAction('admin-mail-automation', 'edit'), validate({ params: plant, body: plantB }), h(async (req, res) => { const p = validated(res, 'params', plant); await mailAutomation.setPlant(callerOf(req), p.code, p.unitId, validated(res, 'body', plantB).enabled); ok(res, { ok: true }); }));
  r.post('/admin/mail-automation/:code/test', requirePageAction('admin-mail-automation', 'edit'), validate({ params: codeP }), h(async (req, res) => ok(res, await mailAutomation.sendTest(callerOf(req), validated(res, 'params', codeP).code))));
  r.get('/admin/mail-automation/:code/runs', requirePageAction('admin-mail-automation', 'view'), validate({ params: codeP }), h(async (req, res) => ok(res, await mailAutomation.runs(validated(res, 'params', codeP).code))));

  // ---- letters
  r.get('/hr/letter-templates', requirePageAction('hr-offer-letter', 'view'), h(async (_req, res) => ok(res, await lettersService.templates())));
  const lq = z.object({ status: z.enum(['Draft', 'Approved', 'Issued']).optional() }).strict();
  r.get('/hr/letters', requirePageAction('hr-offer-letter', 'view'), validate({ query: lq }), h(async (req, res) => ok(res, await lettersService.list(callerOf(req), validated(res, 'query', lq).status))));
  const lb = z.object({ templateCode: z.string().min(1).max(40), personName: z.string().min(1).max(120), personEmail: z.string().max(200).nullable().optional(), data: z.record(z.string().max(200)).default({}), unitId: z.string().uuid().optional() }).strict();
  r.post('/hr/letters', requirePageAction('hr-offer-letter', 'add'), validate({ body: lb }), h(async (req, res) => ok(res, await lettersService.create(callerOf(req), validated(res, 'body', lb)), 201)));
  r.get('/hr/letters/:id', requirePageAction('hr-offer-letter', 'view'), validate({ params: id }), h(async (req, res) => ok(res, await lettersService.get(callerOf(req), validated(res, 'params', id).id))));
  r.post('/hr/letters/:id/approve', requirePageAction('hr-offer-letter', 'approve'), validate({ params: id }), h(async (req, res) => ok(res, await lettersService.approve(callerOf(req), validated(res, 'params', id).id))));
  r.post('/hr/letters/:id/issue', requirePageAction('hr-offer-letter', 'edit'), validate({ params: id }), h(async (req, res) => ok(res, await lettersService.issue(callerOf(req), validated(res, 'params', id).id))));
  r.post('/hr/letters/:id/email', requirePageAction('hr-offer-letter', 'edit'), validate({ params: id }), h(async (req, res) => ok(res, await lettersService.email(callerOf(req), validated(res, 'params', id).id))));

  // ---- quality certificates
  const cqy = z.object({ q: z.string().max(40).optional() }).strict();
  r.get('/qms/certificates', requirePageAction('quality-certificate', 'view'), validate({ query: cqy }), h(async (req, res) => ok(res, await certificatesService.list(callerOf(req), validated(res, 'query', cqy).q))));
  const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
  const cb = z.object({ jobCardNo: z.string().max(40).nullable().optional(), partCode: z.string().max(40).nullable().optional(), partName: z.string().min(1).max(120), inspectionDate: date.optional(), sampleQty: z.number().min(0), acceptedQty: z.number().min(0), rejectedQty: z.number().min(0), drawingRevision: z.string().max(20).nullable().optional(), inspector: z.string().max(80).nullable().optional(), result: z.enum(['Pass', 'Fail', 'Conditional']).optional(), ncrNo: z.string().max(40).nullable().optional(), remarks: z.string().max(500).nullable().optional(), soId: z.string().uuid().nullable().optional(), dcId: z.string().uuid().nullable().optional(), unitId: z.string().uuid().optional() }).strict();
  r.post('/qms/certificates', requirePageAction('quality-certificate', 'add'), validate({ body: cb }), h(async (req, res) => ok(res, await certificatesService.create(callerOf(req), validated(res, 'body', cb)), 201)));
  r.post('/qms/certificates/:id/approve', requirePageAction('quality-certificate', 'approve'), validate({ params: id }), h(async (req, res) => ok(res, await certificatesService.decide(callerOf(req), validated(res, 'params', id).id, true))));
  r.post('/qms/certificates/:id/reject', requirePageAction('quality-certificate', 'approve'), validate({ params: id }), h(async (req, res) => ok(res, await certificatesService.decide(callerOf(req), validated(res, 'params', id).id, false))));

  return r;
}
