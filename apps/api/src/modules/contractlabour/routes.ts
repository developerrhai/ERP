// Phase 30 routes: /api/v1/cl/...
import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { authenticate, requirePasswordChanged } from '../../core/auth/authenticate';
import { resolveContext } from '../../core/context/resolve-context';
import { asyncHandler } from '../../core/http/async-handler';
import { validate, validated } from '../../core/http/validate';
import { requirePageAction } from '../../core/rbac/access';
import { callerOf } from '../inventory/routes-shared';
import { clService } from './service';

const ok = (res: Response, data: unknown, status = 200) => res.status(status).json({ data });
const uuid = z.string().uuid();
const id = z.object({ id: uuid }).strict();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const month = z.string().regex(/^\d{4}-\d{2}$/);

export function createContractLabourRouter(): Router {
  const r = Router();
  r.use('/cl', authenticate, requirePasswordChanged, resolveContext);
  const h = (fn: (req: Request, res: Response) => Promise<unknown>) => asyncHandler(fn as (req: Request, res: Response) => Promise<void>);

  r.get('/cl/command-center', requirePageAction('cl-command-center', 'view'), h(async (req, res) => ok(res, await clService.commandCenter(callerOf(req)))));

  // contractors
  const cq = z.object({ q: z.string().max(40).optional() }).strict();
  r.get('/cl/contractors', requirePageAction('cl-contractors', 'view'), validate({ query: cq }), h(async (req, res) => ok(res, await clService.contractors(callerOf(req), validated(res, 'query', cq).q))));
  const cb = z.object({ code: z.string().min(2).max(30), name: z.string().min(1).max(120), legalEntity: z.string().max(120).nullable().optional(), pan: z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, 'PAN looks like ABCDE1234F.').nullable().optional(), gstin: z.string().max(15).nullable().optional(), labourLicenceNo: z.string().max(40).nullable().optional(), licenceValidUntil: date.nullable().optional(), pfCode: z.string().max(30).nullable().optional(), esicCode: z.string().max(30).nullable().optional(), insurancePolicy: z.string().max(40).nullable().optional(), insuranceExpiry: date.nullable().optional(), agreementNo: z.string().max(40).nullable().optional(), agreementStart: date.nullable().optional(), agreementEnd: date.nullable().optional(), contactPerson: z.string().max(80).nullable().optional(), mobile: z.string().max(15).nullable().optional(), email: z.string().max(120).nullable().optional(), bankAccountLast4: z.string().regex(/^[0-9]{4}$/).nullable().optional(), ifsc: z.string().max(15).nullable().optional(), riskRating: z.enum(['Low', 'Medium', 'High']).nullable().optional() }).strict();
  r.post('/cl/contractors', requirePageAction('cl-contractors', 'add'), validate({ body: cb }), h(async (req, res) => ok(res, await clService.createContractor(callerOf(req), validated(res, 'body', cb)), 201)));
  r.post('/cl/contractors/:id/approve', requirePageAction('cl-contractors', 'approve'), validate({ params: id }), h(async (req, res) => ok(res, await clService.approveContractor(callerOf(req), validated(res, 'params', id).id))));

  // work orders
  r.get('/cl/work-orders', requirePageAction('cl-workorders', 'view'), h(async (req, res) => ok(res, await clService.workOrders(callerOf(req)))));
  const wb = z.object({ contractorId: uuid, unitId: uuid.optional(), poNo: z.string().max(40).nullable().optional(), department: z.string().max(60).nullable().optional(), scope: z.string().max(500).nullable().optional(), skillCategory: z.enum(['Unskilled', 'Semi-skilled', 'Skilled', 'Highly skilled']).optional(), requiredHeadcount: z.number().int().min(1).max(5000), rateType: z.enum(['DAILY', 'MONTHLY', 'PIECE']).optional(), rate: z.number().min(0), otRate: z.number().min(0).nullable().optional(), serviceChargePct: z.number().min(0).max(100).optional(), startDate: date, endDate: date, budget: z.number().min(0) }).strict();
  r.post('/cl/work-orders', requirePageAction('cl-workorders', 'add'), validate({ body: wb }), h(async (req, res) => ok(res, await clService.createWorkOrder(callerOf(req), validated(res, 'body', wb)), 201)));
  r.post('/cl/work-orders/:id/activate', requirePageAction('cl-workorders', 'approve'), validate({ params: id }), h(async (req, res) => ok(res, await clService.activateWorkOrder(callerOf(req), validated(res, 'params', id).id))));

  // workers
  const wq = z.object({ contractor: uuid.optional(), status: z.enum(['Registered', 'Deployed', 'Released', 'Blocked']).optional(), q: z.string().max(40).optional() }).strict();
  r.get('/cl/workers', requirePageAction('cl-workers', 'view'), validate({ query: wq }), h(async (req, res) => ok(res, await clService.workers(callerOf(req), validated(res, 'query', wq)))));
  const wkb = z.object({ name: z.string().min(1).max(120), contractorId: uuid, aadhaarLast4: z.string().regex(/^[0-9]{4}$/, 'Give only the last 4 digits of Aadhaar.').nullable().optional(), mobile: z.string().max(15).nullable().optional(), dob: date.nullable().optional(), gender: z.enum(['M', 'F', 'O']).nullable().optional(), skillCategory: z.enum(['Unskilled', 'Semi-skilled', 'Skilled', 'Highly skilled']).optional(), trade: z.string().max(60).nullable().optional(), department: z.string().max(60).nullable().optional(), unitId: uuid.nullable().optional(), joiningDate: date.nullable().optional(), contractEnd: date.nullable().optional(), wageRate: z.number().min(0), pfUan: z.string().max(20).nullable().optional(), esicIpNo: z.string().max(20).nullable().optional(), policeRequired: z.boolean().optional(), biometricCode: z.string().max(30).nullable().optional() }).strict();
  r.post('/cl/workers', requirePageAction('cl-workers', 'add'), validate({ body: wkb }), h(async (req, res) => ok(res, await clService.createWorker(callerOf(req), validated(res, 'body', wkb)), 201)));
  const chk = z.object({ kind: z.enum(['KYC', 'MEDICAL', 'INDUCTION', 'POLICE', 'PPE', 'ID_CARD']), doneAt: date.optional(), validUntil: date.nullable().optional(), note: z.string().max(200).nullable().optional() }).strict();
  r.post('/cl/workers/:id/checks', requirePageAction('cl-onboarding', 'add'), validate({ params: id, body: chk }), h(async (req, res) => ok(res, await clService.recordCheck(callerOf(req), validated(res, 'params', id).id, validated(res, 'body', chk)), 201)));
  const dep = z.object({ workOrderId: uuid, fromDate: date.optional(), department: z.string().max(60).nullable().optional() }).strict();
  r.post('/cl/workers/:id/deploy', requirePageAction('cl-deployment', 'add'), validate({ params: id, body: dep }), h(async (req, res) => ok(res, await clService.deploy(callerOf(req), validated(res, 'params', id).id, validated(res, 'body', dep)), 201)));
  const rel = z.object({ toDate: date.optional() }).strict();
  r.post('/cl/workers/:id/release', requirePageAction('cl-deployment', 'edit'), validate({ params: id, body: rel }), h(async (req, res) => ok(res, await clService.release(callerOf(req), validated(res, 'params', id).id, validated(res, 'body', rel).toDate))));

  // attendance
  const aq = z.object({ month: month.optional(), contractor: uuid.optional(), date: date.optional() }).strict();
  r.get('/cl/attendance', requirePageAction('cl-attendance', 'view'), validate({ query: aq }), h(async (req, res) => ok(res, await clService.attendance(callerOf(req), validated(res, 'query', aq)))));
  const gb = z.object({ date }).strict();
  r.post('/cl/attendance/generate', requirePageAction('cl-attendance', 'add'), validate({ body: gb }), h(async (req, res) => ok(res, await clService.generateMuster(callerOf(req), validated(res, 'body', gb).date))));
  r.post('/cl/attendance/:id/approve', requirePageAction('cl-attendance', 'edit'), validate({ params: id }), h(async (req, res) => ok(res, await clService.approveDay(callerOf(req), validated(res, 'params', id).id))));

  // wages
  r.get('/cl/wages', requirePageAction('cl-wages', 'view'), h(async (req, res) => ok(res, await clService.wageSheets(callerOf(req)))));
  const wc = z.object({ unitId: uuid.optional(), month, contractorId: uuid }).strict();
  r.post('/cl/wages/compute', requirePageAction('cl-wages', 'add'), validate({ body: wc }), h(async (req, res) => ok(res, await clService.computeWages(callerOf(req), validated(res, 'body', wc)), 201)));
  r.get('/cl/wages/:id/lines', requirePageAction('cl-wages', 'view'), validate({ params: id }), h(async (req, res) => ok(res, await clService.wageLines(callerOf(req), validated(res, 'params', id).id))));
  r.post('/cl/wages/:id/lock', requirePageAction('cl-wages', 'approve'), validate({ params: id }), h(async (req, res) => ok(res, await clService.lockWages(callerOf(req), validated(res, 'params', id).id))));
  r.get('/cl/wages/:id/bank-advice.xlsx', requirePageAction('cl-wages', 'view'), validate({ params: id }), h(async (req, res) => {
    const buf = await clService.bankAdvice(callerOf(req), validated(res, 'params', id).id);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="bank-advice.xlsx"');
    res.send(buf);
  }));

  // bills
  r.get('/cl/invoices', requirePageAction('cl-invoices', 'view'), h(async (req, res) => ok(res, await clService.invoices(callerOf(req)))));
  const ib = z.object({ unitId: uuid.optional(), invoiceNo: z.string().min(1).max(40), invoiceDate: date, contractorId: uuid, workOrderId: uuid, billingMonth: month, headcount: z.number().int().min(0), billedManDays: z.number().min(0), otValue: z.number().min(0).optional(), gstRatePct: z.number().min(0).max(28).optional() }).strict();
  r.post('/cl/invoices', requirePageAction('cl-invoices', 'add'), validate({ body: ib }), h(async (req, res) => ok(res, await clService.createInvoice(callerOf(req), validated(res, 'body', ib)), 201)));
  r.post('/cl/invoices/:id/reconcile', requirePageAction('cl-invoices', 'edit'), validate({ params: id }), h(async (req, res) => ok(res, await clService.reconcile(callerOf(req), validated(res, 'params', id).id))));
  const pb = z.object({ amount: z.number().min(0).optional() }).strict();
  r.post('/cl/invoices/:id/approve-payment', requirePageAction('cl-invoices', 'approve'), validate({ params: id, body: pb }), h(async (req, res) => ok(res, await clService.approvePayment(callerOf(req), validated(res, 'params', id).id, validated(res, 'body', pb).amount))));

  // compliance
  const cp = z.object({ contractor: uuid, month, unit: uuid.optional() }).strict();
  r.get('/cl/compliance', requirePageAction('cl-compliance', 'view'), validate({ query: cp }), h(async (req, res) => { const q = validated(res, 'query', cp); ok(res, { ...(await clService.compliance(callerOf(req), q.contractor, q.month, q.unit)), docs: await clService.docs(callerOf(req), q.contractor, q.month, q.unit) }); }));
  const ub = z.object({ contractorId: uuid, month, kind: z.string().max(30), reference: z.string().max(80).nullable().optional(), unitId: uuid.optional() }).strict();
  r.post('/cl/compliance/docs', requirePageAction('cl-compliance', 'add'), validate({ body: ub }), h(async (req, res) => ok(res, await clService.uploadDoc(callerOf(req), validated(res, 'body', ub)), 201)));
  r.post('/cl/compliance/docs/:id/verify', requirePageAction('cl-compliance', 'approve'), validate({ params: id }), h(async (req, res) => ok(res, await clService.verifyDoc(callerOf(req), validated(res, 'params', id).id))));

  // incidents
  r.get('/cl/incidents', requirePageAction('cl-incidents', 'view'), h(async (req, res) => ok(res, await clService.incidents(callerOf(req)))));
  const inc = z.object({ unitId: uuid.optional(), incidentDate: date, workerId: uuid.nullable().optional(), contractorId: uuid.nullable().optional(), severity: z.enum(['Near miss', 'Minor', 'Major', 'Fatal']), description: z.string().min(1).max(1000), lostTimeHours: z.number().min(0).max(10000).optional() }).strict();
  r.post('/cl/incidents', requirePageAction('cl-incidents', 'add'), validate({ body: inc }), h(async (req, res) => ok(res, await clService.addIncident(callerOf(req), validated(res, 'body', inc)), 201)));
  return r;
}
