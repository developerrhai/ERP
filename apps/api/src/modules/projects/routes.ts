// apps/api/src/modules/projects/routes.ts
// Projects & Tasks Router: /api/v1/projects
import { Router } from 'express';
import type { Request, Response } from 'express';
import { authenticate, requirePasswordChanged } from '../../core/auth/authenticate';
import { resolveContext } from '../../core/context/resolve-context';
import { asyncHandler } from '../../core/http/async-handler';
import { callerOf } from '../inventory/routes-shared';
import { projectService } from './project-service';
import { timesheetService } from './timesheet-service';
import { projectBudgetService } from './project-budget-service';

export const projectsRouter = Router();

// Middleware pipeline
projectsRouter.use(authenticate);
projectsRouter.use(requirePasswordChanged);
projectsRouter.use(resolveContext);

// ---------------------------------------------------------------------------- Projects CRUD
projectsRouter.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const { status, customerId, page, size } = req.query;
    const result = await projectService.listProjects(caller, {
      status: typeof status === 'string' ? status : undefined,
      customerId: typeof customerId === 'string' ? customerId : undefined,
      page: page ? Number(page) : undefined,
      size: size ? Number(size) : undefined,
    });
    res.json(result);
  }),
);

projectsRouter.post(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const result = await projectService.createProject(caller, {
      ...req.body,
      unitId: req.body.unitId || caller.ctx.unitId || '',
    });
    res.status(201).json(result);
  }),
);

// Timesheet Approval Queue (placed before :id route)
projectsRouter.get(
  '/timesheets/approval-queue',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const rows = await timesheetService.getApprovalQueue(caller);
    res.json(rows);
  }),
);

projectsRouter.get(
  '/timesheets',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const { employeeId, status, weekStart } = req.query;
    const rows = await timesheetService.listTimesheets(caller, {
      employeeId: typeof employeeId === 'string' ? employeeId : undefined,
      status: typeof status === 'string' ? status : undefined,
      weekStart: typeof weekStart === 'string' ? weekStart : undefined,
    });
    res.json(rows);
  }),
);

projectsRouter.post(
  '/timesheets',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const result = await timesheetService.createTimesheet(caller, req.body);
    res.status(201).json(result);
  }),
);

projectsRouter.get(
  '/timesheets/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const result = await timesheetService.getTimesheet(caller, req.params.id!);
    res.json(result);
  }),
);

projectsRouter.post(
  '/timesheets/:id/submit',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const result = await timesheetService.submitTimesheet(caller, req.params.id!);
    res.json(result);
  }),
);

projectsRouter.post(
  '/timesheets/:id/approve',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const result = await timesheetService.approveTimesheet(caller, req.params.id!);
    res.json(result);
  }),
);

projectsRouter.post(
  '/timesheets/:id/reject',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const result = await timesheetService.rejectTimesheet(caller, req.params.id!, req.body?.reason);
    res.json(result);
  }),
);

projectsRouter.get(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const result = await projectService.getProject(caller, req.params.id!);
    res.json(result);
  }),
);

projectsRouter.patch(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const result = await projectService.updateProject(caller, req.params.id!, req.body);
    res.json(result);
  }),
);

projectsRouter.post(
  '/:id/activate',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const result = await projectService.activateProject(caller, req.params.id!);
    res.json(result);
  }),
);

projectsRouter.post(
  '/:id/hold',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const result = await projectService.holdProject(caller, req.params.id!);
    res.json(result);
  }),
);

projectsRouter.post(
  '/:id/complete',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const result = await projectService.completeProject(caller, req.params.id!);
    res.json(result);
  }),
);

projectsRouter.post(
  '/:id/close',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const result = await projectService.closeProject(caller, req.params.id!);
    res.json(result);
  }),
);

projectsRouter.post(
  '/:id/set-baseline',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const result = await projectService.setBaseline(caller, req.params.id!);
    res.json(result);
  }),
);

projectsRouter.get(
  '/:id/gantt',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const result = await projectService.getGantt(caller, req.params.id!);
    res.json(result);
  }),
);

projectsRouter.get(
  '/:id/critical-path',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const gantt = await projectService.getGantt(caller, req.params.id!);
    res.json({
      criticalPathTaskIds: gantt.criticalPathTaskIds,
      projectDurationDays: gantt.projectDurationDays,
    });
  }),
);

projectsRouter.get(
  '/:id/evm',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const result = await projectService.getEvm(caller, req.params.id!);
    res.json(result);
  }),
);

projectsRouter.get(
  '/:id/profitability',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const result = await projectService.getProfitability(caller, req.params.id!);
    res.json(result);
  }),
);

projectsRouter.get(
  '/:id/budget-vs-actual',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const result = await projectBudgetService.getBudgetVsActual(caller, req.params.id!);
    res.json(result);
  }),
);

// ---------------------------------------------------------------------------- Tasks
projectsRouter.get(
  '/:id/tasks',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const rows = await projectService.listTasks(caller, req.params.id!);
    res.json(rows);
  }),
);

projectsRouter.post(
  '/:id/tasks',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const result = await projectService.createTask(caller, {
      ...req.body,
      projectId: req.params.id!,
    });
    res.status(201).json(result);
  }),
);

projectsRouter.patch(
  '/tasks/:id/progress',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const { progressPct } = req.body;
    const result = await projectService.updateTaskProgress(caller, req.params.id!, Number(progressPct ?? 0));
    res.json(result);
  }),
);

projectsRouter.post(
  '/tasks/:id/dependencies',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const result = await projectService.addDependency(caller, {
      predecessorId: req.params.id!,
      successorId: req.body.successorId,
      type: req.body.type,
      lagDays: req.body.lagDays,
    });
    res.status(201).json(result);
  }),
);

// ---------------------------------------------------------------------------- Budgets & Expenses
projectsRouter.get(
  '/:id/budgets',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const rows = await projectBudgetService.listBudgets(caller, req.params.id!);
    res.json(rows);
  }),
);

projectsRouter.post(
  '/:id/budgets',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const result = await projectBudgetService.createBudget(caller, {
      projectId: req.params.id!,
      lines: req.body.lines ?? [],
    });
    res.status(201).json(result);
  }),
);

projectsRouter.post(
  '/budgets/:id/approve',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const result = await projectBudgetService.approveBudget(caller, req.params.id!);
    res.json(result);
  }),
);

projectsRouter.get(
  '/:id/expenses',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const rows = await projectBudgetService.listExpenses(caller, req.params.id!);
    res.json(rows);
  }),
);

projectsRouter.post(
  '/:id/expenses',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const result = await projectBudgetService.createExpense(caller, {
      projectId: req.params.id!,
      ...req.body,
    });
    res.status(201).json(result);
  }),
);

projectsRouter.post(
  '/expenses/:id/approve',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const result = await projectBudgetService.approveExpense(caller, req.params.id!);
    res.json(result);
  }),
);
