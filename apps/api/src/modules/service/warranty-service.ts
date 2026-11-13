// apps/api/src/modules/service/warranty-service.ts
import { prisma } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { NumberingService } from '../../core/numbering';
import { norm, query, exec, insertRow, fyOfCaller } from '../procurement/core';
import type { Row } from '../procurement/core';
import type { Caller } from '../records/service';
import { computeWarrantyEndDate, evaluateWarranty } from './service-calc';
import { PostingService } from '../finance/posting-service';

export class WarrantyService {
  async checkWarranty(caller: Caller, serial: string, dateStr?: string): Promise<Row> {
    const failureDate = dateStr ?? new Date().toISOString().slice(0, 10);

    // 1. Find serial and check sales invoice reference
    const sRows = await query(
      prisma,
      `SELECT sn.*, i.name AS item_name, i.item_code
       FROM serial_numbers sn
       JOIN items i ON i.id = sn.item_id
       WHERE sn.serial_no = $1`,
      serial,
    );
    if (!sRows[0]) {
      return {
        serial,
        result: 'OUT_OF_WARRANTY',
        reasons: ['NOT_SOLD: Serial number does not exist in registry.'],
      };
    }
    const serialRow = sRows[0];

    // Check sales history
    const salesRows = await query(
      prisma,
      `SELECT sil.id, si.customer_id, c.name AS customer_name
       FROM sales_invoice_lines sil
       JOIN sales_invoices si ON si.id = sil.sales_invoice_id
       JOIN customers c ON c.id = si.customer_id
       WHERE sil.item_id = $1::uuid
       LIMIT 1`,
      serialRow.item_id,
    );
    const hasSales = salesRows.length > 0;
    const customerId = salesRows[0]?.customer_id;

    // Check active registration
    const regRows = await query(
      prisma,
      `SELECT wr.*, wt.exclusions
       FROM warranty_registrations wr
       LEFT JOIN warranty_terms wt ON wt.id = wr.term_id
       WHERE wr.serial_number_id = $1::uuid`,
      serialRow.id,
    );
    const reg = regRows[0];

    // Check AMC coverage
    const amcRows = await query(
      prisma,
      `SELECT a.start_date, a.end_date, a.coverage, a.customer_id, a.status
       FROM amc_contract_assets ca
       JOIN amc_contracts a ON a.id = ca.amc_contract_id
       WHERE ca.serial_number_id = $1::uuid AND a.status = 'ACTIVE'`,
      serialRow.id,
    );
    const amc = amcRows[0];

    const evalResult = evaluateWarranty({
      hasSalesInvoice: hasSales,
      activeRegistration: reg
        ? {
            startDate: String(reg.start_date).slice(0, 10),
            endDate: String(reg.end_date).slice(0, 10),
            customerId: String(reg.customer_id),
            status: String(reg.status),
            exclusions: reg.exclusions ? [String(reg.exclusions)] : [],
          }
        : undefined,
      activeAmc: amc
        ? {
            startDate: String(amc.start_date).slice(0, 10),
            endDate: String(amc.end_date).slice(0, 10),
            coverage: String(amc.coverage),
            customerId: String(amc.customer_id),
            status: String(amc.status),
          }
        : undefined,
      failureDate,
      claimCustomerId: customerId ? String(customerId) : '',
    });

    return {
      serial,
      serialId: serialRow.id,
      itemCode: serialRow.item_code,
      itemName: serialRow.item_name,
      customerName: salesRows[0]?.customer_name,
      customerId,
      warrantyStart: reg?.start_date,
      warrantyEnd: reg?.end_date,
      result: evalResult.result,
      reasons: evalResult.reasons,
    };
  }

  async listWarranties(
    caller: Caller,
    params: { customerId?: string; status?: string; page?: number; size?: number },
  ): Promise<{ rows: Row[]; total: number }> {
    const conds: string[] = ['1=1'];
    const args: unknown[] = [];

    if (params.customerId) {
      args.push(params.customerId);
      conds.push(`wr.customer_id = $${args.length}::uuid`);
    }
    if (params.status) {
      args.push(params.status);
      conds.push(`wr.status = $${args.length}`);
    }

    const countRows = await query(
      prisma,
      `SELECT COUNT(*)::int AS count FROM warranty_registrations wr WHERE ${conds.join(' AND ')}`,
      ...args,
    );
    const total = (countRows[0]?.count as number) ?? 0;

    const page = Math.max(1, params.page ?? 1);
    const size = Math.max(1, Math.min(100, params.size ?? 25));
    const offset = (page - 1) * size;

    const sql = `
      SELECT wr.*, c.name AS customer_name, sn.serial_no AS serial_number, i.name AS item_name
      FROM warranty_registrations wr
      JOIN customers c ON c.id = wr.customer_id
      JOIN serial_numbers sn ON sn.id = wr.serial_number_id
      JOIN items i ON i.id = sn.item_id
      WHERE ${conds.join(' AND ')}
      ORDER BY wr.created_at DESC
      LIMIT ${size} OFFSET ${offset}
    `;
    const rows = await query(prisma, sql, ...args);
    return { rows: rows.map(norm), total };
  }

  async registerWarranty(
    caller: Caller,
    input: {
      serialNumberId: string;
      customerId: string;
      termId: string;
      startDate: string;
      invoiceRef?: string;
      installationDate?: string;
    },
  ): Promise<Row> {
    const termRows = await query(prisma, `SELECT months FROM warranty_terms WHERE id = $1::uuid`, input.termId);
    const months = Number(termRows[0]?.months ?? 12);
    const endDate = computeWarrantyEndDate(input.startDate, months);

    const id = await insertRow(prisma, 'warranty_registrations', {
      serial_number_id: input.serialNumberId,
      customer_id: input.customerId,
      term_id: input.termId,
      start_date: input.startDate,
      end_date: endDate,
      invoice_ref: input.invoiceRef ?? null,
      installation_date: input.installationDate ?? null,
      status: 'ACTIVE',
    });

    const rows = await query(prisma, `SELECT * FROM warranty_registrations WHERE id = $1::uuid`, id);
    return norm(rows[0]!);
  }

  async listClaims(caller: Caller, params: { customerId?: string; status?: string }): Promise<Row[]> {
    const conds: string[] = ['1=1'];
    const args: unknown[] = [];

    if (params.customerId) {
      args.push(params.customerId);
      conds.push(`wc.customer_id = $${args.length}::uuid`);
    }
    if (params.status) {
      args.push(params.status);
      conds.push(`wc.status = $${args.length}`);
    }

    const sql = `
      SELECT wc.*, c.name AS customer_name, sn.serial_no AS serial_number, i.name AS item_name,
             s.name AS supplier_name
      FROM warranty_claims wc
      JOIN customers c ON c.id = wc.customer_id
      JOIN serial_numbers sn ON sn.id = wc.serial_number_id
      JOIN items i ON i.id = sn.item_id
      LEFT JOIN suppliers s ON s.id = wc.supplier_id
      WHERE ${conds.join(' AND ')}
      ORDER BY wc.created_at DESC
    `;
    const rows = await query(prisma, sql, ...args);
    return rows.map(norm);
  }

  async getClaim(caller: Caller, id: string): Promise<Row> {
    const rows = await query(
      prisma,
      `SELECT wc.*, c.name AS customer_name, sn.serial_no AS serial_number, i.name AS item_name,
              s.name AS supplier_name, t.ticket_no
       FROM warranty_claims wc
       JOIN customers c ON c.id = wc.customer_id
       JOIN serial_numbers sn ON sn.id = wc.serial_number_id
       JOIN items i ON i.id = sn.item_id
       LEFT JOIN suppliers s ON s.id = wc.supplier_id
       LEFT JOIN service_tickets t ON t.id = wc.ticket_id
       WHERE wc.id = $1::uuid`,
      id,
    );
    if (!rows[0]) throw Errors.notFound(`Warranty claim not found: ${id}`);
    return norm(rows[0]);
  }

  async createClaim(
    caller: Caller,
    input: {
      customerId: string;
      serialNumberId: string;
      failureDate: string;
      problemDescription: string;
      ticketId?: string;
    },
  ): Promise<Row> {
    const fy = await fyOfCaller(caller);
    const claimNo = await NumberingService.allocate(prisma as any, {
      pageId: 'service-claims',
      unitId: caller.ctx.unitId || '',
      fyId: fy.id,
      prefix: 'WCL',
    });

    // Check warranty status
    const sRows = await query(prisma, `SELECT serial_no AS serial_number FROM serial_numbers WHERE id = $1::uuid`, input.serialNumberId);
    const sn = sRows[0]?.serial_number as string;
    const check = await this.checkWarranty(caller, sn, input.failureDate);

    const id = await insertRow(prisma, 'warranty_claims', {
      claim_no: claimNo,
      ticket_id: input.ticketId ?? null,
      customer_id: input.customerId,
      serial_number_id: input.serialNumberId,
      failure_date: input.failureDate,
      problem_description: input.problemDescription,
      eligibility_result: check.result,
      eligibility_notes: (check.reasons as string[]).join('; '),
      decision: 'PENDING',
      status: 'PENDING',
    });

    return this.getClaim(caller, id);
  }

  async inspectClaim(
    caller: Caller,
    id: string,
    input: {
      inspectionResult: string;
      decision: 'REPAIR' | 'REPLACE' | 'REJECT';
      replacementSerialId?: string;
      claimCost?: number;
    },
  ): Promise<Row> {
    await exec(
      prisma,
      `UPDATE warranty_claims
       SET inspection_result = $1,
           decision = $2,
           replacement_serial_id = $3::uuid,
           claim_cost = $4,
           status = CASE WHEN $2 = 'REJECT' THEN 'REJECTED' ELSE 'APPROVED' END,
           updated_at = now()
       WHERE id = $5::uuid`,
      input.inspectionResult,
      input.decision,
      input.replacementSerialId ?? null,
      input.claimCost ?? 0,
      id,
    );
    return this.getClaim(caller, id);
  }

  async claimSupplier(
    caller: Caller,
    id: string,
    input: { supplierId: string; supplierGrnRef?: string; supplierClaimAmount: number },
  ): Promise<Row> {
    await exec(
      prisma,
      `UPDATE warranty_claims
       SET supplier_id = $1::uuid,
           supplier_grn_ref = $2,
           supplier_claim_amount = $3,
           status = 'CLAIMED_SUPPLIER',
           updated_at = now()
       WHERE id = $4::uuid`,
      input.supplierId,
      input.supplierGrnRef ?? null,
      input.supplierClaimAmount,
      id,
    );
    return this.getClaim(caller, id);
  }

  async settleSupplierClaim(
    caller: Caller,
    id: string,
    input: { settledAmount: number },
  ): Promise<Row> {
    const claim = await this.getClaim(caller, id);
    const settled = Number(input.settledAmount);

    // GL Journal: Supplier accepts claim
    // Dr Supplier Claim Receivable 1205 / Cr Warranty Cost Recovery 4205
    try {
      await PostingService.postJournal(
        prisma,
        {
          unitId: caller.ctx.unitId || '',
          docDate: new Date().toISOString().slice(0, 10),
          voucherType: 'Journal',
          source: 'EVENT',
          sourceDocType: 'WARRANTY_CLAIM',
          sourceDocId: String(claim.id),
          sourceDocNo: String(claim.claim_no),
          narration: `Supplier warranty settlement for ${String(claim.claim_no)}`,
          lines: [
            {
              accountCode: '1205', // Supplier Claim Receivable
              debit: settled.toFixed(2),
              credit: '0.00',
              partyType: 'SUPPLIER',
              partyId: claim.supplier_id ? String(claim.supplier_id) : undefined,
              narration: `Claim receivable from ${String(claim.supplier_name ?? 'supplier')}`,
            },
            {
              accountCode: '4205', // Warranty Cost Recovery
              debit: '0.00',
              credit: settled.toFixed(2),
              narration: `Cost recovery on ${String(claim.claim_no)}`,
            },
          ],
        },
        { userId: caller.auth.userId },
      );
    } catch (err: any) {
      console.warn('Supplier warranty journal note:', err.message);
    }

    await exec(
      prisma,
      `UPDATE warranty_claims
       SET supplier_settled_amount = $1,
           status = 'SETTLED',
           updated_at = now()
       WHERE id = $2::uuid`,
      settled,
      id,
    );

    return this.getClaim(caller, id);
  }

  async getServiceHistory(caller: Caller, params: { serialNumberId?: string; customerId?: string }): Promise<Row[]> {
    const conds: string[] = ['1=1'];
    const args: unknown[] = [];

    if (params.serialNumberId) {
      args.push(params.serialNumberId);
      conds.push(`serial_number_id = $${args.length}::uuid`);
    }
    if (params.customerId) {
      args.push(params.customerId);
      conds.push(`customer_id = $${args.length}::uuid`);
    }

    const sql = `
      SELECT * FROM service_history
      WHERE ${conds.join(' AND ')}
      ORDER BY event_date DESC
    `;
    const rows = await query(prisma, sql, ...args);
    return rows.map(norm);
  }
}

export const warrantyService = new WarrantyService();
