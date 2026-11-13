// apps/api/src/modules/service/amc-service.ts
import { prisma } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { NumberingService } from '../../core/numbering';
import { norm, query, exec, insertRow, fyOfCaller } from '../procurement/core';
import type { Row } from '../procurement/core';
import type { Caller } from '../records/service';
import { computeAmcRevenueSchedule } from './service-calc';
import { PostingService } from '../finance/posting-service';

export class AmcService {
  async listContracts(
    caller: Caller,
    params: { customerId?: string; status?: string; page?: number; size?: number },
  ): Promise<{ rows: Row[]; total: number }> {
    const conds: string[] = ['1=1'];
    const args: unknown[] = [];

    if (params.customerId) {
      args.push(params.customerId);
      conds.push(`a.customer_id = $${args.length}::uuid`);
    }
    if (params.status) {
      args.push(params.status);
      conds.push(`a.status = $${args.length}`);
    }

    const countSql = `SELECT COUNT(*)::int AS count FROM amc_contracts a WHERE ${conds.join(' AND ')}`;
    const countRows = await query(prisma, countSql, ...args);
    const total = (countRows[0]?.count as number) ?? 0;

    const page = Math.max(1, params.page ?? 1);
    const size = Math.max(1, Math.min(100, params.size ?? 25));
    const offset = (page - 1) * size;

    const sql = `
      SELECT a.*, c.name AS customer_name,
             (SELECT COUNT(*)::int FROM amc_contract_assets ca WHERE ca.amc_contract_id = a.id) AS asset_count
      FROM amc_contracts a
      JOIN customers c ON c.id = a.customer_id
      WHERE ${conds.join(' AND ')}
      ORDER BY a.created_at DESC
      LIMIT ${size} OFFSET ${offset}
    `;
    const rows = await query(prisma, sql, ...args);
    return { rows: rows.map(norm), total };
  }

  async getContract(caller: Caller, id: string): Promise<Row> {
    const rows = await query(
      prisma,
      `SELECT a.*, c.name AS customer_name, i.name AS service_item_name
       FROM amc_contracts a
       JOIN customers c ON c.id = a.customer_id
       LEFT JOIN items i ON i.id = a.service_item_id
       WHERE a.id = $1::uuid`,
      id,
    );
    if (!rows[0]) throw Errors.notFound(`AMC contract not found: ${id}`);
    const amc = norm(rows[0]);

    const assets = await query(
      prisma,
      `SELECT ca.*, sn.serial_no AS serial_number, i.name AS item_name
       FROM amc_contract_assets ca
       JOIN serial_numbers sn ON sn.id = ca.serial_number_id
       LEFT JOIN items i ON i.id = sn.item_id
       WHERE ca.amc_contract_id = $1::uuid`,
      id,
    );
    const visits = await query(
      prisma,
      `SELECT vs.*, sn.serial_no AS serial_number
       FROM amc_visit_schedule vs
       LEFT JOIN serial_numbers sn ON sn.id = vs.serial_number_id
       WHERE vs.amc_contract_id = $1::uuid
       ORDER BY vs.due_date ASC`,
      id,
    );
    const bills = await query(
      prisma,
      `SELECT * FROM amc_billing_schedule WHERE amc_contract_id = $1::uuid ORDER BY due_date ASC`,
      id,
    );
    const revs = await query(
      prisma,
      `SELECT * FROM amc_revenue_schedule WHERE amc_contract_id = $1::uuid ORDER BY period ASC`,
      id,
    );

    amc.assets = assets.map(norm);
    amc.visitSchedule = visits.map(norm);
    amc.billingSchedule = bills.map(norm);
    amc.revenueSchedule = revs.map(norm);
    return amc;
  }

  async createContract(
    caller: Caller,
    input: {
      customerId: string;
      coverage?: string;
      startDate: string;
      endDate: string;
      visitFrequency?: string;
      contractValue: number;
      billingFrequency?: string;
      serviceItemId?: string;
      slaPolicyId?: string;
      assetSerialIds?: string[];
    },
  ): Promise<Row> {
    if (input.endDate < input.startDate) {
      throw Errors.validation({ endDate: 'AMC_DATES: End date cannot be before start date.' });
    }

    // Check overlapping AMC on any asset serial (AMC_OVERLAP)
    if (input.assetSerialIds && input.assetSerialIds.length > 0) {
      for (const sId of input.assetSerialIds) {
        const overlapRows = await query(
          prisma,
          `SELECT a.contract_no, a.end_date, sn.serial_no AS serial_number
           FROM amc_contract_assets ca
           JOIN amc_contracts a ON a.id = ca.amc_contract_id
           JOIN serial_numbers sn ON sn.id = ca.serial_number_id
           WHERE ca.serial_number_id = $1::uuid
             AND a.status IN ('ACTIVE','DRAFT')
             AND daterange(a.start_date, a.end_date, '[]') && daterange($2::date, $3::date, '[]')
           LIMIT 1`,
          sId,
          input.startDate,
          input.endDate,
        );
        if (overlapRows[0]) {
          const o = overlapRows[0];
          throw Errors.conflict(
            `AMC_OVERLAP: Serial ${o.serial_number} already covered by ${o.contract_no} till ${o.end_date}.`,
          );
        }
      }
    }

    const fy = await fyOfCaller(caller);
    const contractNo = await NumberingService.allocate(prisma as any, {
      pageId: 'service-amc',
      unitId: caller.ctx.unitId || '',
      fyId: fy.id,
      prefix: 'AMC',
    });
    const id = await insertRow(prisma, 'amc_contracts', {
      contract_no: contractNo,
      customer_id: input.customerId,
      coverage: input.coverage ?? 'COMPREHENSIVE',
      start_date: input.startDate,
      end_date: input.endDate,
      visit_frequency: input.visitFrequency ?? 'QUARTERLY',
      contract_value: input.contractValue,
      billing_frequency: input.billingFrequency ?? 'QUARTERLY',
      service_item_id: input.serviceItemId ?? null,
      sla_policy_id: input.slaPolicyId ?? null,
      status: 'DRAFT',
    });

    if (input.assetSerialIds) {
      for (const sId of input.assetSerialIds) {
        await insertRow(prisma, 'amc_contract_assets', {
          amc_contract_id: id,
          serial_number_id: sId,
        });
      }
    }

    return this.getContract(caller, id);
  }

  async approveContract(caller: Caller, id: string): Promise<Row> {
    await exec(
      prisma,
      `UPDATE amc_contracts SET approval_status = 'APPROVED', updated_at = now() WHERE id = $1::uuid`,
      id,
    );
    return this.getContract(caller, id);
  }

  async activateContract(caller: Caller, id: string): Promise<Row> {
    const amc = await this.getContract(caller, id);

    // 1. Generate Daily Straight-line Revenue Schedule per Ind AS 115 / AS 9
    const revSchedule = computeAmcRevenueSchedule(
      String(amc.start_date),
      String(amc.end_date),
      Number(amc.contract_value),
    );

    for (const r of revSchedule) {
      await exec(
        prisma,
        `INSERT INTO amc_revenue_schedule (amc_contract_id, period, amount, status)
         VALUES ($1::uuid, $2, $3, 'PENDING')
         ON CONFLICT (amc_contract_id, period) DO UPDATE SET amount = EXCLUDED.amount`,
        id,
        r.period,
        r.amount,
      );
    }

    // 2. Generate Billing Schedule (e.g. quarterly: 4 bills)
    const billCount = amc.billing_frequency === 'MONTHLY' ? 12 : amc.billing_frequency === 'ANNUAL' ? 1 : 4;
    const billAmt = Math.round((Number(amc.contract_value) / billCount) * 100) / 100;
    const start = new Date(String(amc.start_date));

    for (let i = 0; i < billCount; i++) {
      const billDue = new Date(start);
      billDue.setMonth(start.getMonth() + (12 / billCount) * i);
      const periodLabel = `Period ${i + 1}`;

      await exec(
        prisma,
        `INSERT INTO amc_billing_schedule (amc_contract_id, period_name, amount, due_date, status)
         VALUES ($1::uuid, $2, $3, $4::date, 'PENDING')`,
        id,
        periodLabel,
        billAmt,
        billDue.toISOString().slice(0, 10),
      );
    }

    // 3. Generate Visit Schedule (every 1 / 3 / 6 months)
    const visitMonths = amc.visit_frequency === 'MONTHLY' ? 1 : amc.visit_frequency === 'ANNUAL' ? 12 : amc.visit_frequency === 'HALF_YEARLY' ? 6 : 3;
    let visitDate = new Date(start);
    const end = new Date(String(amc.end_date));
    const assets = (amc.assets as Row[]) || [];

    while (visitDate <= end) {
      const vDue = visitDate.toISOString().slice(0, 10);
      if (assets.length > 0) {
        for (const asset of assets) {
          await exec(
            prisma,
            `INSERT INTO amc_visit_schedule (amc_contract_id, serial_number_id, due_date, status)
             VALUES ($1::uuid, $2::uuid, $3::date, 'PENDING')
             ON CONFLICT (amc_contract_id, serial_number_id, due_date) DO NOTHING`,
            id,
            asset.serial_number_id,
            vDue,
          );
        }
      } else {
        await exec(
          prisma,
          `INSERT INTO amc_visit_schedule (amc_contract_id, due_date, status)
           VALUES ($1::uuid, $2::date, 'PENDING')
           ON CONFLICT DO NOTHING`,
          id,
          vDue,
        );
      }
      visitDate.setMonth(visitDate.getMonth() + visitMonths);
    }

    await exec(
      prisma,
      `UPDATE amc_contracts SET status = 'ACTIVE', updated_at = now() WHERE id = $1::uuid`,
      id,
    );

    return this.getContract(caller, id);
  }

  async recogniseRevenue(caller: Caller, amcId: string, period: string): Promise<Row> {
    const amc = await this.getContract(caller, amcId);
    const revRows = await query(
      prisma,
      `SELECT * FROM amc_revenue_schedule WHERE amc_contract_id = $1::uuid AND period = $2`,
      amcId,
      period,
    );
    if (!revRows[0]) throw Errors.notFound(`Revenue schedule for period ${period} not found`);
    const rev = revRows[0];
    if (rev.status === 'RECOGNISED') return norm(rev);

    const amount = Number(rev.amount);

    // GL Journal: Monthly recognition
    // Dr AMC Deferred Revenue 2402 [amcContractId] / Cr AMC Service Revenue 4110 [amcContractId]
    let journalId: string | null = null;
    try {
      const posted = await PostingService.postJournal(
        prisma,
        {
          unitId: caller.ctx.unitId || '',
          docDate: `${period}-01`,
          voucherType: 'Journal',
          source: 'EVENT',
          sourceDocType: 'AMC_REVENUE',
          sourceDocId: String(rev.id),
          sourceDocNo: `REV-${String(amc.contract_no)}-${period}`,
          narration: `Monthly AMC revenue recognition for ${period} (${String(amc.contract_no)})`,
          lines: [
            {
              accountCode: '2402', // AMC Deferred Revenue
              debit: amount.toFixed(2),
              credit: '0.00',
              amcContractId: amcId,
              narration: `Deferred revenue release: ${String(amc.contract_no)} (${period})`,
            },
            {
              accountCode: '4110', // AMC Service Revenue
              debit: '0.00',
              credit: amount.toFixed(2),
              amcContractId: amcId,
              narration: `Service revenue earned: ${String(amc.contract_no)} (${period})`,
            },
          ],
        },
        { userId: caller.auth.userId },
      );
      journalId = posted.id;
    } catch (err: any) {
      console.warn('AMC revenue journal note:', err.message);
    }

    await exec(
      prisma,
      `UPDATE amc_revenue_schedule
       SET status = 'RECOGNISED', journal_id = $1::uuid
       WHERE id = $2::uuid`,
      journalId,
      rev.id,
    );

    const updated = await query(prisma, `SELECT * FROM amc_revenue_schedule WHERE id = $1::uuid`, rev.id);
    return norm(updated[0]!);
  }

  async getProfitability(caller: Caller, amcId: string): Promise<Row> {
    const summaryRows = await query(
      prisma,
      `SELECT a.root_type, a.code, a.name,
              SUM(g.debit)::numeric AS total_debit,
              SUM(g.credit)::numeric AS total_credit,
              SUM(CASE WHEN a.root_type = 'Income' THEN (g.credit - g.debit)
                       ELSE (g.debit - g.credit) END)::numeric AS net_amount
       FROM gl_entries g
       JOIN accounts a ON a.id = g.account_id
       WHERE g.amc_contract_id = $1::uuid
       GROUP BY a.root_type, a.code, a.name
       ORDER BY a.root_type ASC, a.code ASC`,
      amcId,
    );

    let revenue = 0;
    let cost = 0;

    for (const r of summaryRows) {
      const amt = Number(r.net_amount ?? 0);
      if (r.root_type === 'Income') revenue += amt;
      else if (r.root_type === 'Expense') cost += amt;
    }

    const contribution = revenue - cost;
    const marginPct = revenue > 0 ? Math.round((contribution / revenue) * 10000) / 100 : null;

    const glLines = await query(
      prisma,
      `SELECT g.id, g.posting_date, g.voucher_type, g.voucher_no, g.narration,
              a.code AS account_code, a.name AS account_name,
              g.debit, g.credit
       FROM gl_entries g
       JOIN accounts a ON a.id = g.account_id
       WHERE g.amc_contract_id = $1::uuid
       ORDER BY g.posting_date DESC`,
      amcId,
    );

    return {
      amcId,
      revenue,
      totalCost: cost,
      contribution,
      marginPct: marginPct !== null ? `${marginPct}%` : '—',
      summary: summaryRows.map(norm),
      drillDown: glLines.map(norm),
    };
  }
}

export const amcService = new AmcService();
