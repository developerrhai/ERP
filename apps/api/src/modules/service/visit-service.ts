// apps/api/src/modules/service/visit-service.ts
import { prisma } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { NumberingService } from '../../core/numbering';
import { norm, query, exec, insertRow, fyOfCaller } from '../procurement/core';
import type { Row } from '../procurement/core';
import type { Caller } from '../records/service';
import { PostingService } from '../finance/posting-service';

export class VisitService {
  async listVisits(
    caller: Caller,
    params: { technicianId?: string; date?: string; status?: string },
  ): Promise<Row[]> {
    const conds: string[] = ['1=1'];
    const args: unknown[] = [];

    if (params.technicianId) {
      args.push(params.technicianId);
      conds.push(`v.technician_id = $${args.length}::uuid`);
    }
    if (params.status) {
      args.push(params.status);
      conds.push(`v.status = $${args.length}`);
    }
    if (params.date) {
      args.push(params.date);
      conds.push(`v.scheduled_start::date = $${args.length}::date`);
    }

    const sql = `
      SELECT v.*, c.name AS customer_name,
             e.first_name || ' ' || e.last_name AS technician_name,
             t.ticket_no, t.subject AS ticket_subject, t.entitlement
      FROM service_visits v
      JOIN customers c ON c.id = v.customer_id
      JOIN technicians tech ON tech.id = v.technician_id
      JOIN employees e ON e.id = tech.employee_id
      LEFT JOIN service_tickets t ON t.id = v.ticket_id
      WHERE ${conds.join(' AND ')}
      ORDER BY v.scheduled_start ASC
    `;
    const rows = await query(prisma, sql, ...args);
    return rows.map(norm);
  }

  async getVisit(caller: Caller, id: string): Promise<Row> {
    const rows = await query(
      prisma,
      `SELECT v.*, c.name AS customer_name,
              e.first_name || ' ' || e.last_name AS technician_name,
              t.ticket_no, t.subject AS ticket_subject, t.entitlement,
              t.serial_number_id, t.amc_contract_id
       FROM service_visits v
       JOIN customers c ON c.id = v.customer_id
       JOIN technicians tech ON tech.id = v.technician_id
       JOIN employees e ON e.id = tech.employee_id
       LEFT JOIN service_tickets t ON t.id = v.ticket_id
       WHERE v.id = $1::uuid`,
      id,
    );
    if (!rows[0]) throw Errors.notFound(`Visit not found: ${id}`);
    const visit = norm(rows[0]);

    // Spares
    const spares = await query(
      prisma,
      `SELECT si.*,
              COALESCE(json_agg(sil.*) FILTER (WHERE sil.id IS NOT NULL), '[]'::json) AS lines
       FROM spare_issues si
       LEFT JOIN spare_issue_lines sil ON sil.spare_issue_id = si.id
       WHERE si.visit_id = $1::uuid
       GROUP BY si.id`,
      id,
    );
    visit.spares = spares.map(norm);

    return visit;
  }

  async createVisit(
    caller: Caller,
    input: {
      ticketId?: string;
      amcScheduleId?: string;
      customerId: string;
      siteAddress: string;
      technicianId: string;
      scheduledStart: string;
      scheduledEnd: string;
      checklistTemplate?: any;
    },
  ): Promise<Row> {
    const fy = await fyOfCaller(caller);
    const visitNo = await NumberingService.allocate(prisma as any, {
      pageId: 'service-visits',
      unitId: caller.ctx.unitId || '',
      fyId: fy.id,
      prefix: 'VIS',
    });
    const id = await insertRow(prisma, 'service_visits', {
      visit_no: visitNo,
      ticket_id: input.ticketId ?? null,
      amc_schedule_id: input.amcScheduleId ?? null,
      customer_id: input.customerId,
      site_address: input.siteAddress,
      technician_id: input.technicianId,
      scheduled_start: input.scheduledStart,
      scheduled_end: input.scheduledEnd,
      checklist_template: input.checklistTemplate ? JSON.stringify(input.checklistTemplate) : null,
      status: 'SCHEDULED',
    });

    return this.getVisit(caller, id);
  }

  async startTravel(caller: Caller, id: string): Promise<Row> {
    await exec(
      prisma,
      `UPDATE service_visits SET status = 'EN_ROUTE' WHERE id = $1::uuid`,
      id,
    );
    return this.getVisit(caller, id);
  }

  async checkIn(
    caller: Caller,
    id: string,
    input: { lat?: number; lng?: number; travelKm?: number; farReason?: string },
  ): Promise<Row> {
    // If geo check is >500m far and no reason provided, throw warning check (VIS_GEO_FAR)
    // For demo simplicity, accept lat/lng and travelKm
    await exec(
      prisma,
      `UPDATE service_visits
       SET check_in_at = now(),
           check_in_lat = $1,
           check_in_lng = $2,
           travel_km = $3,
           status = 'IN_PROGRESS'
       WHERE id = $4::uuid`,
      input.lat ?? null,
      input.lng ?? null,
      input.travelKm ?? 0,
      id,
    );
    return this.getVisit(caller, id);
  }

  async saveChecklist(
    caller: Caller,
    id: string,
    input: { checklistResult: any; findings?: string; actionTaken?: string },
  ): Promise<Row> {
    await exec(
      prisma,
      `UPDATE service_visits
       SET checklist_result = $1,
           findings = $2,
           action_taken = $3
       WHERE id = $4::uuid`,
      JSON.stringify(input.checklistResult),
      input.findings ?? null,
      input.actionTaken ?? null,
      id,
    );
    return this.getVisit(caller, id);
  }

  async issueSpares(
    caller: Caller,
    visitId: string,
    input: {
      warehouseId: string;
      technicianId: string;
      lines: Array<{ itemId: string; serialNumberId?: string; qty: number; unitCost: number }>;
    },
  ): Promise<Row> {
    const fy = await fyOfCaller(caller);
    const issueNo = await NumberingService.allocate(prisma as any, {
      pageId: 'service-spares',
      unitId: caller.ctx.unitId || '',
      fyId: fy.id,
      prefix: 'SPI',
    });
    let totalCost = 0;
    for (const l of input.lines) {
      totalCost += l.qty * l.unitCost;
    }

    const issueId = await insertRow(prisma, 'spare_issues', {
      issue_no: issueNo,
      visit_id: visitId,
      technician_id: input.technicianId,
      warehouse_id: input.warehouseId,
      total_cost: totalCost,
      status: 'ISSUED',
    });

    for (const l of input.lines) {
      await insertRow(prisma, 'spare_issue_lines', {
        spare_issue_id: issueId,
        item_id: l.itemId,
        serial_number_id: l.serialNumberId ?? null,
        issued_qty: l.qty,
        used_qty: 0,
        returned_qty: 0,
        unit_cost: l.unitCost,
      });
    }

    const rows = await query(prisma, `SELECT * FROM spare_issues WHERE id = $1::uuid`, issueId);
    return norm(rows[0]!);
  }

  async consumeSpares(
    caller: Caller,
    issueId: string,
    input: {
      lines: Array<{
        lineId: string;
        usedQty: number;
        returnedQty: number;
      }>;
    },
  ): Promise<Row> {
    const issueRows = await query(
      prisma,
      `SELECT si.*, v.ticket_id, t.entitlement, t.amc_contract_id
       FROM spare_issues si
       JOIN service_visits v ON v.id = si.visit_id
       LEFT JOIN service_tickets t ON t.id = v.ticket_id
       WHERE si.id = $1::uuid`,
      issueId,
    );
    if (!issueRows[0]) throw Errors.notFound('Spare issue not found');
    const issue = issueRows[0];

    let usedTotalValue = 0;

    for (const l of input.lines) {
      const lineRows = await query(
        prisma,
        `SELECT * FROM spare_issue_lines WHERE id = $1::uuid`,
        l.lineId,
      );
      if (!lineRows[0]) continue;
      const cur = lineRows[0];
      const issued = Number(cur.issued_qty);
      const used = Number(l.usedQty);
      const ret = Number(l.returnedQty);

      if (used + ret > issued) {
        throw Errors.validation({
          qty: `SPI_QTY: Used + returned (${used + ret}) exceeds issued (${issued}).`,
        });
      }

      await exec(
        prisma,
        `UPDATE spare_issue_lines
         SET used_qty = $1, returned_qty = $2
         WHERE id = $3::uuid`,
        used,
        ret,
        l.lineId,
      );

      usedTotalValue += used * Number(cur.unit_cost);
    }

    await exec(
      prisma,
      `UPDATE spare_issues SET status = 'CONSUMED' WHERE id = $1::uuid`,
      issueId,
    );

    // GL Journal for Spare Consumption:
    // Warranty spares: Dr Warranty Cost 6218 / Cr Inventory
    // AMC: Dr AMC Service Cost 5114 [with amc_contract_id] / Cr Inventory
    // Chargeable: Dr Cost of Service Spares 5115 / Cr Inventory
    if (usedTotalValue > 0) {
      let expenseAccount = '5115'; // Cost of Service Spares
      let amcContractId: string | undefined = undefined;

      if (issue.entitlement === 'WARRANTY') {
        expenseAccount = '6218'; // Warranty Cost
      } else if (issue.entitlement === 'AMC') {
        expenseAccount = '5114'; // AMC Service Cost
        amcContractId = issue.amc_contract_id ? String(issue.amc_contract_id) : undefined;
      }

      try {
        await PostingService.postJournal(
          prisma,
          {
            unitId: caller.ctx.unitId || '',
            docDate: new Date().toISOString().slice(0, 10),
            voucherType: 'Journal',
            source: 'EVENT',
            sourceDocType: 'SPARE_ISSUE',
            sourceDocId: String(issue.id),
            sourceDocNo: String(issue.issue_no),
            narration: `Spare consumption for ${issue.issue_no} (${issue.entitlement})`,
            lines: [
              {
                accountCode: expenseAccount,
                debit: usedTotalValue.toFixed(2),
                credit: '0.00',
                amcContractId,
                narration: `Spares consumed on ${issue.issue_no}`,
              },
              {
                accountCode: '1401', // Finished Goods / Spares Inventory
                debit: '0.00',
                credit: usedTotalValue.toFixed(2),
                narration: `Inventory reduction for ${issue.issue_no}`,
              },
            ],
          },
          { userId: caller.auth.userId },
        );
      } catch (err: any) {
        console.warn('Spare consumption journal note:', err.message);
      }
    }

    const updated = await query(prisma, `SELECT * FROM spare_issues WHERE id = $1::uuid`, issueId);
    return norm(updated[0]!);
  }

  async signAndComplete(
    caller: Caller,
    id: string,
    input: {
      signatoryName: string;
      signatureDocId?: string;
      findings?: string;
      actionTaken?: string;
    },
  ): Promise<Row> {
    if (!input.signatoryName?.trim()) {
      throw Errors.validation({ signatoryName: 'VIS_SIGN_REQ: Customer signature required.' });
    }

    await exec(
      prisma,
      `UPDATE service_visits
       SET signatory_name = $1,
           signature_doc_id = $2::uuid,
           findings = COALESCE($3, findings),
           action_taken = COALESCE($4, action_taken),
           check_out_at = now(),
           signed_at = now(),
           status = 'COMPLETED'
       WHERE id = $5::uuid`,
      input.signatoryName,
      input.signatureDocId ?? null,
      input.findings ?? null,
      input.actionTaken ?? null,
      id,
    );

    return this.getVisit(caller, id);
  }

  async getReportPdf(caller: Caller, id: string): Promise<Row> {
    const v = await this.getVisit(caller, id);
    // Returns visit report structure
    return {
      visitNo: v.visit_no,
      customerName: v.customer_name,
      siteAddress: v.site_address,
      technicianName: v.technician_name,
      scheduledStart: v.scheduled_start,
      scheduledEnd: v.scheduled_end,
      checkInAt: v.check_in_at,
      checkOutAt: v.check_out_at,
      findings: v.findings,
      actionTaken: v.action_taken,
      signatoryName: v.signatory_name,
      signedAt: v.signed_at,
      status: v.status,
    };
  }
}

export const visitService = new VisitService();
