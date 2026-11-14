// apps/api/src/modules/hr/routes.ts
// HRMS Router: /api/v1/hr
import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { authenticate, requirePasswordChanged } from '../../core/auth/authenticate';
import { resolveContext } from '../../core/context/resolve-context';
import { asyncHandler } from '../../core/http/async-handler';
import { Errors } from '../../core/http/errors';
import { requirePageAction } from '../../core/rbac/access';
import { prisma } from '../../core/db/prisma';
import { norm, query } from '../procurement/core';
import { callerOf } from '../inventory/routes-shared';
import type { Caller } from '../records/service';
import { employeeService } from './employee-service';
import { attendanceService } from './attendance-service';
import { leaveService } from './leave-service';
import { expenseService } from './expense-service';
import { recruitmentService } from './recruitment-service';
import { exitService } from './exit-service';
import { essService } from './ess-service';

export const hrRouter = Router();

// Middleware pipeline
hrRouter.use(authenticate);
hrRouter.use(requirePasswordChanged);
hrRouter.use(resolveContext);

// ---------------------------------------------------------------------------- Employees
hrRouter.get(
  '/employees',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const { q, unitId, department, status, page, size } = req.query;
    const result = await employeeService.list(caller, {
      q: typeof q === 'string' ? q : undefined,
      unitId: typeof unitId === 'string' ? unitId : undefined,
      department: typeof department === 'string' ? department : undefined,
      status: typeof status === 'string' ? status : undefined,
      page: page ? Number(page) : undefined,
      size: size ? Number(size) : undefined,
    });
    res.json({ data: result.rows, meta: { total: result.total } });
  }),
);

hrRouter.get(
  '/employees/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const row = await employeeService.get(caller, req.params.id!);
    res.json({ data: row });
  }),
);

hrRouter.post(
  '/employees',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const row = await employeeService.create(caller, req.body);
    res.status(201).json({ data: row });
  }),
);

hrRouter.put(
  '/employees/:id/biometric-code',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    await employeeService.updateBiometricCode(caller, req.params.id!, req.body.biometricCode ?? null);
    res.json({ ok: true });
  }),
);

hrRouter.post(
  '/employees/:id/assignments',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const row = await employeeService.addAssignment(caller, req.params.id!, req.body);
    res.status(201).json({ data: row });
  }),
);

hrRouter.post(
  '/employees/:id/reveal',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const { field, purpose } = req.body;
    const result = await employeeService.revealSensitive(caller, req.params.id!, field, purpose);
    res.json({ data: result });
  }),
);

// ---------------------------------------------------------------------------- Recruitment
hrRouter.get(
  '/requisitions',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const rows = await recruitmentService.listRequisitions(caller);
    res.json({ data: rows });
  }),
);

hrRouter.post(
  '/requisitions',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const row = await recruitmentService.createRequisition(caller, req.body);
    res.status(201).json({ data: row });
  }),
);

hrRouter.get(
  '/candidates',
  asyncHandler(async (req: Request, res: Response) => {
    const rows = await recruitmentService.listCandidates();
    res.json({ data: rows });
  }),
);

hrRouter.post(
  '/candidates',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const row = await recruitmentService.createCandidate(caller, req.body);
    res.status(201).json({ data: row });
  }),
);

hrRouter.get(
  '/offers',
  asyncHandler(async (req: Request, res: Response) => {
    const rows = await recruitmentService.listOffers();
    res.json({ data: rows });
  }),
);

hrRouter.post(
  '/offers',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const row = await recruitmentService.createOffer(caller, req.body);
    res.status(201).json({ data: row });
  }),
);

// ---------------------------------------------------------------------------- Time & Attendance
hrRouter.get(
  '/shifts',
  asyncHandler(async (req: Request, res: Response) => {
    const rows = await attendanceService.listShifts();
    res.json({ data: rows });
  }),
);

hrRouter.get(
  '/rosters',
  asyncHandler(async (req: Request, res: Response) => {
    const { from, to, unitId } = req.query;
    if (!from || !to) throw Errors.validation({ dates: 'from and to dates are required' });
    const rows = await attendanceService.getRosters({
      from: String(from),
      to: String(to),
      unitId: typeof unitId === 'string' ? unitId : undefined,
    });
    res.json({ data: rows });
  }),
);

hrRouter.put(
  '/rosters',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const result = await attendanceService.bulkSaveRoster(caller, req.body.items || []);
    res.json({ data: result });
  }),
);

hrRouter.get(
  '/attendance/devices',
  asyncHandler(async (req: Request, res: Response) => {
    const { unitId } = req.query;
    const rows = await attendanceService.listDevices(typeof unitId === 'string' ? unitId : undefined);
    res.json({ data: rows });
  }),
);

hrRouter.post(
  '/attendance/devices',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const row = await attendanceService.createDevice(caller, req.body);
    res.status(201).json({ data: row });
  }),
);

hrRouter.post(
  '/attendance/devices/:id/sync-now',
  asyncHandler(async (req: Request, res: Response) => {
    const result = await attendanceService.syncDevice(req.params.id!, 'MANUAL');
    res.json({ data: result });
  }),
);

hrRouter.get(
  '/attendance/days',
  requirePageAction('hr-attendance', 'view'),
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const { month, employeeId } = req.query;
    const rows = await attendanceService.listDays(
      caller,
      typeof month === 'string' ? month : new Date().toISOString().slice(0, 7),
      typeof employeeId === 'string' ? employeeId : undefined,
    );
    res.json({ data: rows });
  }),
);

hrRouter.post(
  '/attendance/periods/summarise',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const { employeeId, fromDate, toDate } = req.body;
    const summary = await attendanceService.summarizePeriod(caller, employeeId, fromDate, toDate);
    res.json({ data: summary });
  }),
);

// ---------------------------------------------------------------------------- Leave
hrRouter.get(
  '/leave/types',
  asyncHandler(async (req: Request, res: Response) => {
    const rows = await leaveService.listTypes();
    res.json({ data: rows });
  }),
);

hrRouter.get(
  '/leave/balances',
  asyncHandler(async (req: Request, res: Response) => {
    const { employeeId } = req.query;
    if (!employeeId) throw Errors.validation({ employeeId: 'employeeId is required' });
    const rows = await leaveService.getBalances(String(employeeId));
    res.json({ data: rows });
  }),
);

hrRouter.get(
  '/leave/ledger',
  asyncHandler(async (req: Request, res: Response) => {
    const { employeeId, leaveTypeId } = req.query;
    if (!employeeId) throw Errors.validation({ employeeId: 'employeeId is required' });
    const rows = await leaveService.getLedger(
      String(employeeId),
      typeof leaveTypeId === 'string' ? leaveTypeId : undefined,
    );
    res.json({ data: rows });
  }),
);

hrRouter.post(
  '/leave/apply',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const row = await leaveService.apply(caller, req.body);
    res.status(201).json({ data: row });
  }),
);

hrRouter.post(
  '/leave/applications/:id/approve',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    await leaveService.approve(caller, req.params.id!);
    res.json({ ok: true });
  }),
);

// ---------------------------------------------------------------------------- Expenses
hrRouter.get(
  '/expenses/categories',
  asyncHandler(async (req: Request, res: Response) => {
    const rows = await expenseService.listCategories();
    res.json({ data: rows });
  }),
);

hrRouter.get(
  '/expenses/claims',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const { employeeId, status } = req.query;
    const rows = await expenseService.listClaims(caller, {
      employeeId: typeof employeeId === 'string' ? employeeId : undefined,
      status: typeof status === 'string' ? status : undefined,
    });
    res.json({ data: rows });
  }),
);

hrRouter.post(
  '/expenses/claims',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const row = await expenseService.createClaim(caller, req.body);
    res.status(201).json({ data: row });
  }),
);

hrRouter.post(
  '/expenses/claims/:id/submit',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    await expenseService.submitClaim(caller, req.params.id!);
    res.json({ ok: true });
  }),
);

hrRouter.post(
  '/expenses/claims/:id/approve',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    await expenseService.approveClaim(caller, req.params.id!);
    res.json({ ok: true });
  }),
);

// ---------------------------------------------------------------------------- Exit & FNF
hrRouter.get(
  '/exits',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const rows = await exitService.listCases(caller);
    res.json({ data: rows });
  }),
);

hrRouter.get(
  '/exits/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const row = await exitService.getCase(req.params.id!);
    res.json({ data: row });
  }),
);

hrRouter.post(
  '/exits',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const row = await exitService.createCase(caller, req.body);
    res.status(201).json({ data: row });
  }),
);

hrRouter.post(
  '/exits/:id/handoff',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const row = await exitService.createHandoff(caller, req.params.id!);
    res.json({ data: row });
  }),
);

// ---------------------------------------------------------------------------- ESS
hrRouter.get(
  '/ess/me',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const row = await essService.findMyProfile(caller);
    // Phase 37 C4: a login without an employee record is not an error.
    if (!row) {
      res.json({ data: null, message: 'Your login is not linked to an employee record. Ask HR.' });
      return;
    }
    res.json({ data: row });
  }),
);

hrRouter.get(
  '/ess/attendance',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const { month } = req.query;
    const rows = await essService.getMyAttendance(caller, typeof month === 'string' ? month : undefined);
    res.json({ data: rows });
  }),
);

hrRouter.get(
  '/ess/leave',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const data = await essService.getMyLeave(caller);
    res.json({ data });
  }),
);

hrRouter.get(
  '/ess/privacy-notice',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const data = await essService.getPrivacyNotice(caller.auth.userId);
    res.json({ data });
  }),
);

hrRouter.post(
  '/ess/privacy-notice/accept',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const { noticeId } = req.body;
    await essService.acceptPrivacyNotice(caller, noticeId);
    res.json({ ok: true });
  }),
);

// ---------------------------------------------------------------------------- Statutory Rules
hrRouter.get(
  '/statutory-rules',
  asyncHandler(async (req: Request, res: Response) => {
    const rows = await query(prisma, `SELECT * FROM hr_statutory_rules ORDER BY law_basis_code, rule_key`);
    res.json({ data: rows.map(norm) });
  }),
);
