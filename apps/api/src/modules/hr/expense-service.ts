// apps/api/src/modules/hr/expense-service.ts
// Employee expense claims and advances, posting directly to GL via PostingService.
import { prisma } from '../../core/db/prisma';
import type { Db } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { NumberingService } from '../../core/numbering';
import {
  exec,
  fyOfCaller,
  insertRow,
  norm,
  query,
} from '../procurement/core';
import type { Row } from '../procurement/core';
import type { Caller } from '../records/service';
import { PostingService } from '../finance/posting-service';
import { recordAudit } from '../../core/audit/audit-service';

export class ExpenseService {
  async listCategories(): Promise<Row[]> {
    const rows = await query(prisma, `SELECT * FROM expense_categories WHERE active = true ORDER BY name`);
    return rows.map(norm);
  }

  async listClaims(caller: Caller, params: { employeeId?: string; status?: string }): Promise<Row[]> {
    const conds: string[] = ['c.deleted_at IS NULL'];
    const args: unknown[] = [];

    if (params.employeeId) {
      args.push(params.employeeId);
      conds.push(`c.employee_id = $${args.length}::uuid`);
    }
    if (params.status) {
      args.push(params.status);
      conds.push(`c.status = $${args.length}`);
    }

    const sql = `
      SELECT c.*, e.emp_code, e.first_name || ' ' || e.last_name AS employee_name
      FROM hr_expense_claims c
      JOIN employees e ON e.id = c.employee_id
      WHERE ${conds.join(' AND ')}
      ORDER BY c.claim_date DESC, c.created_at DESC
    `;
    const rows = await query(prisma, sql, ...args);
    return rows.map(norm);
  }

  async createClaim(
    caller: Caller,
    input: {
      employeeId: string;
      unitId: string;
      claimDate: string;
      title: string;
      description?: string;
      lines: Array<{
        categoryId: string;
        expenseDate: string;
        amount: number;
        gstAmount?: number;
        description: string;
        receiptDocumentId?: string | null;
      }>;
    },
  ): Promise<Row> {
    if (!input.lines || input.lines.length === 0) {
      throw Errors.validation({ lines: 'At least one expense line is required.' });
    }

    const fy = await fyOfCaller(caller);

    return await prisma.$transaction(async (tx) => {
      const claimNo = await NumberingService.allocate(tx, {
        pageId: 'hr-expense',
        unitId: input.unitId,
        fyId: fy.id,
        prefix: 'EXP',
      });

      let total = 0;
      for (const ln of input.lines) {
        total += Number(ln.amount) + Number(ln.gstAmount ?? 0);
      }

      const claimId = await insertRow(tx, 'hr_expense_claims', {
        claimNo,
        employeeId: input.employeeId,
        unitId: input.unitId,
        fyId: fy.id,
        claimDate: input.claimDate,
        title: input.title,
        description: input.description ?? null,
        status: 'DRAFT',
        totalAmount: total.toFixed(2),
        approvedAmount: total.toFixed(2),
        createdById: caller.auth.userId,
      });

      for (const ln of input.lines) {
        const cat = (
          await query(tx, `SELECT receipt_required_above FROM expense_categories WHERE id = $1::uuid`, ln.categoryId)
        )[0];
        const reqAbove = Number(cat?.receipt_required_above ?? 500);
        let breach = false;
        let breachReason: string | null = null;
        if (Number(ln.amount) > reqAbove && !ln.receiptDocumentId) {
          breach = true;
          breachReason = `Receipt required above ₹${reqAbove}`;
        }

        await insertRow(tx, 'expense_claim_lines', {
          claimId,
          categoryId: ln.categoryId,
          expenseDate: ln.expenseDate,
          amount: Number(ln.amount).toFixed(2),
          gstAmount: Number(ln.gstAmount ?? 0).toFixed(2),
          description: ln.description,
          receiptDocumentId: ln.receiptDocumentId ?? null,
          policyBreach: breach,
          policyBreachReason: breachReason,
        });
      }

      await recordAudit({
        action: 'RECORD_CREATED',
        actorId: caller.auth.userId,
        targetType: 'ExpenseClaim',
        targetId: claimId,
        detail: { claimNo },
      }, tx);

      const claimRow = (await query(tx, `SELECT * FROM hr_expense_claims WHERE id = $1::uuid`, claimId))[0]!;
      return norm(claimRow);
    });
  }

  async submitClaim(caller: Caller, claimId: string): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const claim = (
        await query(tx, `SELECT status FROM hr_expense_claims WHERE id = $1::uuid FOR UPDATE`, claimId)
      )[0];
      if (!claim) throw Errors.notFound('Claim not found.');
      if (claim.status !== 'DRAFT') throw Errors.conflict('Only draft claims can be submitted.');

      await exec(
        tx,
        `UPDATE hr_expense_claims SET status = 'PENDING_APPROVAL', updated_at = now() WHERE id = $1::uuid`,
        claimId,
      );
      await recordAudit({
        action: 'RECORD_STATUS_CHANGED',
        actorId: caller.auth.userId,
        targetType: 'ExpenseClaim',
        targetId: claimId,
        detail: { status: 'PENDING_APPROVAL' },
      }, tx);
    });
  }

  private async costCenterFor(tx: Db, employeeId: string, unitId: string): Promise<string | null> {
    const rows = await query(
      tx,
      `SELECT c.id
         FROM cost_centers c
        WHERE c.deleted_at IS NULL AND c.status = 'Active' AND NOT c.is_group
          AND (c.unit_id IS NULL OR c.unit_id = $2::uuid)
        ORDER BY
          CASE
            WHEN EXISTS (SELECT 1 FROM employee_assignments a
                          WHERE a.employee_id = $1::uuid AND a.effective_to IS NULL
                            AND (lower(a.cost_centre) = lower(c.code) OR lower(a.cost_centre) = lower(c.name))) THEN 0
            WHEN EXISTS (SELECT 1 FROM employee_assignments a
                          WHERE a.employee_id = $1::uuid AND a.effective_to IS NULL
                            AND lower(a.department) = lower(c.department)) THEN 1
            ELSE 2
          END,
          CASE WHEN c.unit_id = $2::uuid THEN 0 ELSE 1 END,
          c.code
        LIMIT 1`,
      employeeId,
      unitId,
    );
    return rows[0] ? String(rows[0].id) : null;
  }

  async approveClaim(caller: Caller, claimId: string): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const claim = (
        await query(tx, `SELECT * FROM hr_expense_claims WHERE id = $1::uuid FOR UPDATE`, claimId)
      )[0];
      if (!claim) throw Errors.notFound('Claim not found.');
      if (claim.status !== 'PENDING_APPROVAL') {
        throw Errors.conflict('Only pending claims can be approved.');
      }

      const lines = await query(
        tx,
        `SELECT l.*, c.gl_key FROM expense_claim_lines l
         JOIN expense_categories c ON c.id = l.category_id
         WHERE l.claim_id = $1::uuid`,
        claimId,
      );

      // Most expense accounts need a cost centre: the employee's own, else their department's, else the plant's first.
      const costCenterId = await this.costCenterFor(tx, String(claim.employee_id), String(claim.unit_id));
      if (!costCenterId) {
        throw Errors.validation({
          costCenter: 'No cost centre is set up for this employee, their department or the plant. Ask Finance to add one, then approve again.',
        });
      }

      // The payable to the employee is kept against the employee's login (the party master for employees is the user).
      const login = (await query(tx, `SELECT user_id, emp_code FROM employees WHERE id = $1::uuid`, String(claim.employee_id)))[0];
      if (!login?.user_id) {
        throw Errors.validation({
          employee: `Employee ${String(login?.emp_code ?? '')} has no login linked, so the reimbursement cannot be booked. Ask HR to link the employee to a user, then approve again.`,
        });
      }

      const postLines = [];
      let totalClaim = 0;

      for (const ln of lines) {
        const amt = Number(ln.amount);
        totalClaim += amt;
        postLines.push({
          accountCode: String(ln.gl_key ?? '6264'),
          debit: amt.toFixed(2),
          credit: '0.00',
          costCenterId,
          narration: String(ln.description),
        });
      }

      postLines.push({
        accountCode: '2104',
        debit: '0.00',
        credit: totalClaim.toFixed(2),
        partyId: String(login.user_id),
        partyType: 'EMPLOYEE' as const,
        narration: `Expense claim ${claim.claim_no}`,
      });

      const journal = await PostingService.postJournal(
        tx,
        {
          unitId: String(claim.unit_id),
          docDate: claim.claim_date instanceof Date ? claim.claim_date.toISOString().slice(0, 10) : String(claim.claim_date).slice(0, 10),
          voucherType: 'Expense',
          source: 'EXPENSE',
          sourceDocType: 'hr-expense',
          sourceDocId: claimId,
          sourceDocNo: String(claim.claim_no),
          narration: `Approved expense claim ${claim.claim_no}: ${claim.title}`,
          lines: postLines,
        },
        { userId: caller.auth.userId },
      );

      await exec(
        tx,
        `UPDATE hr_expense_claims SET status = 'APPROVED', journal_id = $1::uuid, updated_at = now() WHERE id = $2::uuid`,
        journal.id,
        claimId,
      );

      await recordAudit({
        action: 'RECORD_STATUS_CHANGED',
        actorId: caller.auth.userId,
        targetType: 'ExpenseClaim',
        targetId: claimId,
        detail: { status: 'APPROVED', journalId: journal.id },
      }, tx);
    });
  }
}

export const expenseService = new ExpenseService();
