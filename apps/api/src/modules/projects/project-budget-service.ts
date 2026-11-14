// apps/api/src/modules/projects/project-budget-service.ts
import { prisma } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { norm, query, exec, insertRow } from '../procurement/core';
import type { Row } from '../procurement/core';
import type { Caller } from '../records/service';
import { PostingService } from '../finance/posting-service';

export class ProjectBudgetService {
  async listBudgets(caller: Caller, projectId: string): Promise<Row[]> {
    const rows = await query(
      prisma,
      `SELECT b.*,
              COALESCE(SUM(l.amount), 0)::numeric AS total_amount
       FROM project_budgets b
       LEFT JOIN project_budget_lines l ON l.budget_id = b.id
       WHERE b.project_id = $1::uuid
       GROUP BY b.id
       ORDER BY b.version DESC`,
      projectId,
    );
    return rows.map(norm);
  }

  async getBudget(caller: Caller, id: string): Promise<Row> {
    const rows = await query(prisma, `SELECT * FROM project_budgets WHERE id = $1::uuid`, id);
    if (!rows[0]) throw Errors.notFound(`Project budget not found: ${id}`);
    const b = norm(rows[0]);

    const lines = await query(
      prisma,
      `SELECT l.*, a.code AS account_code, a.name AS account_name
       FROM project_budget_lines l
       LEFT JOIN accounts a ON a.id = l.account_id
       WHERE l.budget_id = $1::uuid
       ORDER BY l.cost_head ASC`,
      id,
    );
    b.lines = lines.map(norm);
    return b;
  }

  async createBudget(
    caller: Caller,
    input: {
      projectId: string;
      lines: Array<{
        costHead: string;
        accountId?: string;
        amount: number;
      }>;
    },
  ): Promise<Row> {
    const vRows = await query(
      prisma,
      `SELECT COALESCE(MAX(version), 0) + 1 AS next_v FROM project_budgets WHERE project_id = $1::uuid`,
      input.projectId,
    );
    const version = Number(vRows[0]?.next_v ?? 1);

    const budgetId = await insertRow(prisma, 'project_budgets', {
      project_id: input.projectId,
      version,
      total_budget: input.lines.reduce((t, l) => t + Number(l.amount), 0),
      status: 'DRAFT',
      created_by_id: caller.auth.userId,
    });

    for (const l of input.lines) {
      await insertRow(prisma, 'project_budget_lines', {
        budget_id: budgetId,
        cost_head: l.costHead,
        account_id: l.accountId ?? null,
        amount: l.amount,
      });
    }

    return this.getBudget(caller, budgetId);
  }

  async approveBudget(caller: Caller, id: string): Promise<Row> {
    const b = await this.getBudget(caller, id);

    // Supersede previously approved budgets for this project
    await exec(
      prisma,
      `UPDATE project_budgets
       SET status = 'SUPERSEDED'
       WHERE project_id = $1::uuid AND status = 'APPROVED'`,
      b.project_id,
    );

    await exec(
      prisma,
      `UPDATE project_budgets
       SET status = 'APPROVED',
           approved_by_id = $1::uuid,
           approved_at = now()
       WHERE id = $2::uuid`,
      caller.auth.userId,
      id,
    );

    return this.getBudget(caller, id);
  }

  async getBudgetVsActual(caller: Caller, projectId: string): Promise<Row[]> {
    const budgetLines = await query(
      prisma,
      `SELECT l.cost_head, SUM(l.amount)::numeric AS budgeted_amount
       FROM project_budgets b
       JOIN project_budget_lines l ON l.budget_id = b.id
       WHERE b.project_id = $1::uuid AND b.status = 'APPROVED'
       GROUP BY l.cost_head`,
      projectId,
    );

    // Actuals from gl_entries
    const actualLines = await query(
      prisma,
      `SELECT
         CASE
           WHEN a.code = '5112' THEN 'LABOUR'
           WHEN a.code = '6251' THEN 'TRAVEL'
           WHEN a.code LIKE '51%' THEN 'MATERIAL'
           ELSE 'EXPENSE'
         END AS cost_head,
         SUM(g.debit - g.credit)::numeric AS actual_amount
       FROM gl_entries g
       JOIN accounts a ON a.id = g.account_id
       WHERE g.project_id = $1::uuid AND a.root_type = 'Expense'
       GROUP BY 1`,
      projectId,
    );

    const actualMap = new Map<string, number>();
    for (const a of actualLines) {
      actualMap.set(String(a.cost_head).toUpperCase(), Number(a.actual_amount ?? 0));
    }

    const heads = ['LABOUR', 'MATERIAL', 'SUBCONTRACT', 'TRAVEL', 'EXPENSE', 'OVERHEAD'];
    const result: Row[] = [];

    for (const h of heads) {
      const bMatch = budgetLines.find((b) => String(b.cost_head).toUpperCase() === h);
      const budgeted = Number(bMatch?.budgeted_amount ?? 0);
      const actual = actualMap.get(h) ?? 0;
      const variance = budgeted - actual;
      const pctUsed = budgeted > 0 ? Math.round((actual / budgeted) * 10000) / 100 : 0;

      result.push({
        costHead: h,
        budgeted,
        actual,
        variance,
        pctUsed,
      });
    }

    return result;
  }

  // -------------------------------------------------------------------------- Expenses
  async listExpenses(caller: Caller, projectId: string): Promise<Row[]> {
    const rows = await query(
      prisma,
      `SELECT e.*, e.payee_employee_id AS employee_id, e.total_amount AS amount, e.total_tax AS tax_amount,
              (SELECT l.cost_head FROM project_expense_lines l WHERE l.project_expense_id = e.id ORDER BY l.date LIMIT 1) AS category,
              (SELECT l.description FROM project_expense_lines l WHERE l.project_expense_id = e.id ORDER BY l.date LIMIT 1) AS description,
              emp.first_name || ' ' || emp.last_name AS employee_name
       FROM project_expenses e
       LEFT JOIN employees emp ON emp.id = e.payee_employee_id
       WHERE e.project_id = $1::uuid
       ORDER BY e.created_at DESC
       LIMIT 500`,
      projectId,
    );
    return rows.map(norm);
  }

  async createExpense(
    caller: Caller,
    input: {
      projectId: string;
      employeeId?: string;
      /** LABOUR | MATERIAL | SUBCONTRACT | TRAVEL | EXPENSE | OVERHEAD */
      category: string;
      /** Amount before tax. */
      amount: number;
      taxAmount?: number;
      billable?: boolean;
      description: string;
    },
  ): Promise<Row> {
    const expenseNo = `PEXP-${input.projectId.slice(0, 6).toUpperCase()}-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
    const today = new Date().toISOString().slice(0, 10);
    const tax = input.taxAmount ?? 0;
    const id = await insertRow(prisma, 'project_expenses', {
      expense_no: expenseNo,
      project_id: input.projectId,
      date: today,
      payee_employee_id: input.employeeId ?? null,
      total_amount: input.amount + tax,
      total_tax: tax,
      status: 'SUBMITTED',
      created_by_id: caller.auth.userId,
    });
    await insertRow(prisma, 'project_expense_lines', {
      project_expense_id: id,
      date: today,
      cost_head: input.category.toUpperCase(),
      description: input.description,
      amount: input.amount,
      tax,
      billable: input.billable ?? false,
    });
    return this.getExpense(id);
  }

  /** Header with the first line's category / description and the old amount names the screens use. */
  private async getExpense(id: string): Promise<Row> {
    const rows = await query(
      prisma,
      `SELECT e.*, e.payee_employee_id AS employee_id, e.total_tax AS tax_amount,
              (e.total_amount - e.total_tax) AS amount,
              (SELECT l.cost_head FROM project_expense_lines l WHERE l.project_expense_id = e.id ORDER BY l.date LIMIT 1) AS category,
              (SELECT l.description FROM project_expense_lines l WHERE l.project_expense_id = e.id ORDER BY l.date LIMIT 1) AS description
         FROM project_expenses e WHERE e.id = $1::uuid`,
      id,
    );
    if (!rows[0]) throw Errors.notFound(`Project expense not found: ${id}`);
    return norm(rows[0]);
  }

  async approveExpense(caller: Caller, id: string): Promise<Row> {
    const exp = await this.getExpense(id);

    if (exp.status === 'APPROVED') return exp;

    // Post to GL through PostingService
    // Dr Category/Travel [with project_id], Dr Input Tax / Cr EMPLOYEE_PAYABLE
    const glLines: any[] = [];
    const baseAmt = Number(exp.amount ?? 0);
    const taxAmt = Number(exp.tax_amount ?? 0);
    const totalAmt = baseAmt + taxAmt;

    const projectId = String(exp.project_id);
    const expenseNo = String(exp.expense_no);
    const desc = String(exp.description);

    glLines.push({
      accountCode: '6251', // Travel & Conveyance
      debit: baseAmt.toFixed(2),
      credit: '0.00',
      projectId,
      narration: `Project expense ${expenseNo}: ${desc}`,
    });

    if (taxAmt > 0) {
      const halfTax = (taxAmt / 2).toFixed(2);
      glLines.push({
        accountCode: '1301', // Input CGST
        debit: halfTax,
        credit: '0.00',
        narration: `Input CGST on ${expenseNo}`,
      });
      glLines.push({
        accountCode: '1302', // Input SGST
        debit: halfTax,
        credit: '0.00',
        narration: `Input SGST on ${expenseNo}`,
      });
    }

    glLines.push({
      accountCode: '2104', // Employee Payable
      debit: '0.00',
      credit: totalAmt.toFixed(2),
      narration: `Reimbursement payable for ${expenseNo}`,
    });

    let journalId: string | null = null;
    try {
      const posted = await PostingService.postJournal(
        prisma,
        {
          unitId: caller.ctx.unitId || '',
          docDate: new Date().toISOString().slice(0, 10),
          voucherType: 'Journal',
          source: 'EXPENSE',
          sourceDocType: 'PROJECT_EXPENSE',
          sourceDocId: String(exp.id),
          sourceDocNo: expenseNo,
          narration: `Project expense ${expenseNo}`,
          lines: glLines,
        },
        { userId: caller.auth.userId },
      );
      journalId = posted.id;
    } catch (err: any) {
      console.warn('Project expense journal note:', err.message);
    }

    await exec(
      prisma,
      `UPDATE project_expenses
       SET status = 'APPROVED',
           journal_id = $1::uuid
       WHERE id = $2::uuid`,
      journalId,
      id,
    );

    return this.getExpense(id);
  }
}

export const projectBudgetService = new ProjectBudgetService();
