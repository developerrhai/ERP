// apps/api/src/modules/payroll/routes.ts
// Payroll Router: /api/v1/payroll
import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { authenticate, requirePasswordChanged } from '../../core/auth/authenticate';
import { resolveContext } from '../../core/context/resolve-context';
import { asyncHandler } from '../../core/http/async-handler';
import { prisma } from '../../core/db/prisma';
import { callerOf } from '../inventory/routes-shared';
import { PayrollService } from './payroll-service';
import { BankFileService } from './bank-file-service';
import { StatutoryExportService } from './statutory-export-service';
import { PayslipService } from './payslip-service';

export const payrollRouter = Router();

// Authentication and Context
payrollRouter.use(authenticate);
payrollRouter.use(requirePasswordChanged);
payrollRouter.use(resolveContext);

// -------------------------------------------------------------
// Pay Components
// -------------------------------------------------------------
payrollRouter.get(
  '/components',
  asyncHandler(async (_req: Request, res: Response) => {
    const list = await PayrollService.listComponents(prisma);
    res.json({ data: list });
  }),
);

const CreateComponentSchema = z.object({
  code: z.string().min(1).max(30),
  name: z.string().min(1).max(100),
  kind: z.enum(['EARNING', 'DEDUCTION', 'EMPLOYER_CONTRIB']),
  calc_type: z.enum(['FIXED', 'FORMULA', 'ATTENDANCE', 'INPUT', 'STATUTORY']),
  formula: z.string().optional(),
  prorate: z.boolean().optional(),
  taxable: z.boolean().optional(),
  pf_wage: z.boolean().optional(),
  esic_wage: z.boolean().optional(),
  pt_wage: z.boolean().optional(),
  code_wage_class: z.enum(['INCLUDED', 'EXCLUDED']).optional(),
  bonus_wage: z.boolean().optional(),
  gratuity_wage: z.boolean().optional(),
  payslip_order: z.number().optional(),
  payslip_label_hi: z.string().optional(),
  gl_key: z.string().optional(),
});

payrollRouter.post(
  '/components',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const body = CreateComponentSchema.parse(req.body);
    const id = await PayrollService.createComponent(prisma, body, caller);
    res.status(201).json({ id });
  }),
);

// -------------------------------------------------------------
// Pay Structures
// -------------------------------------------------------------
payrollRouter.get(
  '/structures',
  asyncHandler(async (_req: Request, res: Response) => {
    const list = await PayrollService.listStructures(prisma);
    res.json({ data: list });
  }),
);

const CreateStructureSchema = z.object({
  code: z.string().min(1).max(30),
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  lines: z.array(
    z.object({
      component_id: z.string().uuid(),
      formula_override: z.string().optional(),
      amount_override: z.number().optional(),
      sequence: z.number().optional(),
    }),
  ),
});

payrollRouter.post(
  '/structures',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const body = CreateStructureSchema.parse(req.body);
    const id = await PayrollService.createStructure(prisma, body, caller);
    res.status(201).json({ id });
  }),
);

// -------------------------------------------------------------
// Salary Assignments
// -------------------------------------------------------------
const AssignSalarySchema = z.object({
  employee_id: z.string().uuid(),
  structure_id: z.string().uuid(),
  monthly_ctc: z.number().positive(),
  effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  lines: z
    .array(
      z.object({
        component_id: z.string().uuid(),
        monthly_amount: z.number().nonnegative(),
        formula_override: z.string().optional(),
      }),
    )
    .optional(),
});

payrollRouter.post(
  '/assignments',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const body = AssignSalarySchema.parse(req.body);
    const id = await PayrollService.assignSalary(prisma, body, caller);
    res.status(201).json({ id });
  }),
);

// -------------------------------------------------------------
// Statutory Rates
// -------------------------------------------------------------
payrollRouter.get(
  '/statutory-rates',
  asyncHandler(async (_req: Request, res: Response) => {
    const list = await PayrollService.listStatutoryRates(prisma);
    res.json({ data: list });
  }),
);

payrollRouter.patch(
  '/statutory-rates/:id/review',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const result = await PayrollService.reviewStatutoryRate(prisma, req.params.id!, caller);
    res.json(result);
  }),
);

// -------------------------------------------------------------
// Periods
// -------------------------------------------------------------
payrollRouter.get(
  '/periods',
  asyncHandler(async (_req: Request, res: Response) => {
    const list = await PayrollService.listPeriods(prisma);
    res.json({ data: list });
  }),
);

const CreatePeriodSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  days_basis: z.number().int().positive(),
});

payrollRouter.post(
  '/periods',
  asyncHandler(async (req: Request, res: Response) => {
    const body = CreatePeriodSchema.parse(req.body);
    const id = await PayrollService.createPeriod(prisma, body);
    res.status(201).json({ id });
  }),
);

// -------------------------------------------------------------
// Payroll Runs
// -------------------------------------------------------------
payrollRouter.get(
  '/runs',
  asyncHandler(async (req: Request, res: Response) => {
    const { period_id, unit_id } = req.query;
    const runs = await PayrollService.listRuns(prisma, {
      period_id: typeof period_id === 'string' ? period_id : undefined,
      unit_id: typeof unit_id === 'string' ? unit_id : undefined,
    });
    res.json({ data: runs });
  }),
);

payrollRouter.get(
  '/runs/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const run = await PayrollService.getRun(prisma, req.params.id!);
    res.json(run);
  }),
);

const CreateRunSchema = z.object({
  period_id: z.string().uuid(),
  unit_id: z.string().uuid().optional(),
  run_type: z.enum(['REGULAR', 'ARREAR', 'FNF', 'BONUS', 'REVERSAL']).optional(),
  reversal_of_id: z.string().uuid().optional(),
});

payrollRouter.post(
  '/runs',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const body = CreateRunSchema.parse(req.body);
    const id = await PayrollService.createRun(prisma, body, caller);
    res.status(201).json({ id });
  }),
);

payrollRouter.post(
  '/runs/:id/calculate',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const result = await PayrollService.calculateRun(prisma, req.params.id!, caller);
    res.json(result);
  }),
);

payrollRouter.post(
  '/runs/:id/lock',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const result = await PayrollService.lockRun(prisma, req.params.id!, caller);
    res.json(result);
  }),
);

payrollRouter.post(
  '/runs/:id/post',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const result = await PayrollService.postRun(prisma, req.params.id!, caller);
    res.json(result);
  }),
);

// -------------------------------------------------------------
// Bank Transfer Batches
// -------------------------------------------------------------
payrollRouter.get(
  '/bank-templates',
  asyncHandler(async (_req: Request, res: Response) => {
    const templates = await BankFileService.listTemplates(prisma);
    res.json({ data: templates });
  }),
);

payrollRouter.get(
  '/bank-batches',
  asyncHandler(async (req: Request, res: Response) => {
    const { run_id } = req.query;
    const batches = await BankFileService.listBatches(prisma, typeof run_id === 'string' ? run_id : undefined);
    res.json({ data: batches });
  }),
);

const GenerateBatchSchema = z.object({
  payroll_run_id: z.string().uuid(),
  bank_template_id: z.string().uuid(),
});

payrollRouter.post(
  '/bank-batches/generate',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const body = GenerateBatchSchema.parse(req.body);
    const result = await BankFileService.generateBatch(prisma, body, caller);
    res.status(201).json(result);
  }),
);

// -------------------------------------------------------------
// Statutory Exports
// -------------------------------------------------------------
payrollRouter.get(
  '/runs/:id/ecr',
  asyncHandler(async (req: Request, res: Response) => {
    const ecrText = await StatutoryExportService.generateEcrText(prisma, req.params.id!);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="ECR-${req.params.id}.txt"`);
    res.send(ecrText);
  }),
);

payrollRouter.get(
  '/runs/:id/esic-csv',
  asyncHandler(async (req: Request, res: Response) => {
    const esicCsv = await StatutoryExportService.generateEsicCsv(prisma, req.params.id!);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="ESIC-${req.params.id}.csv"`);
    res.send(esicCsv);
  }),
);

payrollRouter.get(
  '/runs/:id/pt-summary',
  asyncHandler(async (req: Request, res: Response) => {
    const summary = await StatutoryExportService.getPtStatement(prisma, req.params.id!);
    res.json(summary);
  }),
);

// -------------------------------------------------------------
// Payslips
// -------------------------------------------------------------
payrollRouter.get(
  '/payslips/:runEmployeeId',
  asyncHandler(async (req: Request, res: Response) => {
    const slip = await PayslipService.getPayslip(prisma, req.params.runEmployeeId!);
    res.json(slip);
  }),
);

payrollRouter.post(
  '/runs/:id/payslips/release',
  asyncHandler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const result = await PayslipService.releasePayslips(prisma, req.params.id!, caller);
    res.json(result);
  }),
);
