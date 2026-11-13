// 11-A5 e-invoice and 11-A6 e-way bill. R-12: the app NEVER calls the IRP or the e-way bill portal. It writes the
// request JSON for a person to upload, and records the numbers the portal returned (IRN, Ack, EWB number).
import { recordAudit } from '../../core/audit/audit-service';
import { prisma } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { D, S, ddmmyyyy, iso, money, num2, ruleNum, unitGst } from './common';
import type { Row } from './common';

type DocType = 'INV' | 'CRN';

async function loadDoc(unitId: string, docType: DocType, docId: string) {
  if (docType === 'INV') {
    const r = (
      await prisma.$queryRawUnsafe<Row[]>(
        `SELECT i.id::text, i.number, i.invoice_date AS dt, i.status, i.taxable::text, i.cgst::text, i.sgst::text, i.igst::text,
                i.round_off::text, i.grand_total::text, i.customer_state, i.irn, c.name AS cust, c.gstin AS cust_gstin, c.state_code AS cust_state,
                a.line1 AS addr, a.city AS addr_city, a.pincode AS addr_pin
           FROM sales_invoices i JOIN customers c ON c.id=i.customer_id
           LEFT JOIN LATERAL (SELECT line1, city, pincode FROM customer_addresses WHERE customer_id=c.id ORDER BY (type='BILLING') DESC, is_default DESC LIMIT 1) a ON true
          WHERE i.id=$1::uuid AND i.unit_id=$2::uuid`,
        docId,
        unitId,
      )
    )[0];
    if (!r) throw Errors.notFound('Invoice not found for this unit.');
    // unpaginated: rows of one parent (invoice_id)
    const lines = await prisma.$queryRawUnsafe<Row[]>(
      `SELECT description, hsn_sac, qty::text, uom, rate::text, taxable::text, gst_pct::text, cgst::text, sgst::text, igst::text
         FROM sales_invoice_lines WHERE invoice_id=$1::uuid ORDER BY line_no`,
      docId,
    );
    return { r, lines, no: S(r.number), date: iso(r.dt), posted: S(r.status) === 'Posted' };
  }
  const r = (
    await prisma.$queryRawUnsafe<Row[]>(
      `SELECT x.id::text, x.credit_note_no AS number, x.return_date AS dt, x.status, x.taxable::text, x.cgst::text, x.sgst::text, x.igst::text,
              x.round_off::text, x.grand_total::text, i.customer_state, NULL AS irn, c.name AS cust, c.gstin AS cust_gstin, c.state_code AS cust_state, a.line1 AS addr, a.city AS addr_city, a.pincode AS addr_pin,
              i.number AS inv_no, i.invoice_date AS inv_date
         FROM sales_returns x JOIN sales_invoices i ON i.id=x.invoice_id JOIN customers c ON c.id=x.customer_id
         LEFT JOIN LATERAL (SELECT line1, city, pincode FROM customer_addresses WHERE customer_id=c.id ORDER BY (type='BILLING') DESC, is_default DESC LIMIT 1) a ON true
        WHERE x.id=$1::uuid AND x.unit_id=$2::uuid`,
      docId,
      unitId,
    )
  )[0];
  if (!r) throw Errors.notFound('Credit note not found for this unit.');
  // unpaginated: whole-period return build: GST/TDS returns must include every document of the period
  const lines = await prisma.$queryRawUnsafe<Row[]>(
    `SELECT il.description, il.hsn_sac, l.qty::text, il.uom, l.rate::text, l.taxable::text, l.gst_pct::text, l.cgst::text, l.sgst::text, l.igst::text
       FROM sales_return_lines l JOIN sales_invoice_lines il ON il.id=l.invoice_line_id WHERE l.return_id=$1::uuid ORDER BY l.line_no`,
    docId,
  );
  return { r, lines, no: S(r.number), date: iso(r.dt), posted: S(r.status) === 'Posted' };
}

export const einvoiceService = {
  /** posted invoices / credit notes of B2B customers that have no IRN yet */
  async pending(unitId: string | null) {
    const ug = await unitGst(unitId);
    const limit = (
      await ruleNum('EINV_REPORT_DAYS', new Date().toISOString().slice(0, 10))
    ).toNumber();
    const rows = await prisma.$queryRawUnsafe<Row[]>(
      `SELECT * FROM (
         SELECT 'INV' AS doc_type, i.id::text AS id, i.number AS no, i.invoice_date AS dt, c.name AS cust, c.gstin AS cust_gstin, i.grand_total::text AS total
           FROM sales_invoices i JOIN customers c ON c.id=i.customer_id WHERE i.unit_id=$1::uuid AND i.status='Posted'
         UNION ALL
         SELECT 'CRN', x.id::text, x.credit_note_no, x.return_date, c.name, c.gstin, x.grand_total::text
           FROM sales_returns x JOIN customers c ON c.id=x.customer_id WHERE x.unit_id=$1::uuid AND x.status='Posted'
       ) q WHERE q.cust_gstin IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM einvoice_records e WHERE e.doc_id=q.id::uuid AND e.doc_type=q.doc_type AND e.status='Generated')
       ORDER BY dt DESC LIMIT 500`,
      ug.unitId,
    );
    const today = Date.parse(new Date().toISOString().slice(0, 10));
    return {
      enabled: ug.einvoiceEnabled,
      reportWithinDays: limit,
      rows: rows.map((r) => {
        const age = Math.round((today - Date.parse(iso(r.dt))) / 86_400_000);
        return {
          docType: S(r.doc_type),
          id: S(r.id),
          docNo: S(r.no),
          date: iso(r.dt),
          customer: S(r.cust),
          gstin: S(r.cust_gstin),
          total: money(S(r.total)),
          ageDays: age,
          late: age > limit,
        };
      }),
    };
  },

  async records(unitId: string | null) {
    const rows = await prisma.$queryRawUnsafe<Row[]>(
      `SELECT id::text, doc_type, doc_id::text, doc_no, doc_date, irn, ack_no, ack_date, status, late_reported, cancelled_at, cancel_reason
         FROM einvoice_records WHERE ($1::uuid IS NULL OR unit_id=$1::uuid) ORDER BY created_at DESC LIMIT 500`,
      unitId,
    );
    return rows.map((r) => ({
      id: S(r.id),
      docType: S(r.doc_type),
      docId: S(r.doc_id),
      docNo: S(r.doc_no),
      docDate: iso(r.doc_date),
      irn: r.irn ? S(r.irn) : null,
      ackNo: r.ack_no ? S(r.ack_no) : null,
      ackDate: r.ack_date ? (r.ack_date as Date).toISOString() : null,
      status: S(r.status),
      lateReported: r.late_reported === true,
      cancelledAt: r.cancelled_at ? (r.cancelled_at as Date).toISOString() : null,
      cancelReason: r.cancel_reason ? S(r.cancel_reason) : null,
    }));
  },

  /** the IRP request JSON (schema 1.1). Missing facts are listed, never invented. */
  async requestJson(unitId: string | null, docType: DocType, docId: string) {
    const ug = await unitGst(unitId);
    const d = await loadDoc(ug.unitId, docType, docId);
    const missing: string[] = [];
    if (!d.posted) missing.push('The document is not posted yet.');
    if (!S(d.r.cust_gstin)) missing.push('The customer has no GSTIN (e-invoice is for B2B).');
    if (!ug.pincode) missing.push('The unit has no pincode (Unit Master).');
    if (!ug.city) missing.push('The unit has no city (Unit Master).');
    const pos = S(d.r.customer_state || d.r.cust_state);
    const items = d.lines.map((l, i) => {
      if (!/^\d{4,8}$/.test(S(l.hsn_sac))) missing.push(`Line ${i + 1} has no HSN / SAC.`);
      const tot = D(S(l.taxable)).plus(S(l.cgst)).plus(S(l.sgst)).plus(S(l.igst));
      return {
        SlNo: String(i + 1),
        PrdDesc: S(l.description || 'Item').slice(0, 300),
        IsServc: S(l.hsn_sac).startsWith('99') ? 'Y' : 'N',
        HsnCd: S(l.hsn_sac),
        Qty: Number(S(l.qty)),
        Unit: (S(l.uom) || 'OTH').toUpperCase().slice(0, 8),
        UnitPrice: Number(S(l.rate)),
        TotAmt: num2(D(S(l.taxable))),
        AssAmt: num2(D(S(l.taxable))),
        GstRt: Number(S(l.gst_pct)),
        IgstAmt: num2(D(S(l.igst))),
        CgstAmt: num2(D(S(l.cgst))),
        SgstAmt: num2(D(S(l.sgst))),
        TotItemVal: num2(tot),
      };
    });
    const json = {
      Version: '1.1',
      TranDtls: { TaxSch: 'GST', SupTyp: 'B2B', RegRev: 'N', IgstOnIntra: 'N' },
      DocDtls: {
        Typ: docType === 'INV' ? 'INV' : 'CRN',
        No: d.no,
        Dt: ddmmyyyy(d.date).replace(/-/g, '/'),
      },
      SellerDtls: {
        Gstin: ug.gstin,
        LglNm: ug.legalName,
        Addr1: ug.unitName,
        Loc: ug.city,
        Pin: ug.pincode,
        Stcd: ug.stateCode,
      },
      BuyerDtls: {
        Gstin: S(d.r.cust_gstin),
        LglNm: S(d.r.cust),
        Pos: pos,
        Addr1: S(d.r.addr || ''),
        Loc: S(d.r.addr_city || ''),
        Pin: S(d.r.addr_pin || ''),
        Stcd: S(d.r.cust_state),
      },
      ItemList: items,
      ValDtls: {
        AssVal: num2(D(S(d.r.taxable))),
        CgstVal: num2(D(S(d.r.cgst))),
        SgstVal: num2(D(S(d.r.sgst))),
        IgstVal: num2(D(S(d.r.igst))),
        RndOffAmt: num2(D(S(d.r.round_off))),
        TotInvVal: num2(D(S(d.r.grand_total))),
      },
      ...(docType === 'CRN'
        ? {
            PrecDocDtls: [
              { InvNo: S(d.r.inv_no), InvDt: ddmmyyyy(iso(d.r.inv_date)).replace(/-/g, '/') },
            ],
          }
        : {}),
    };
    if (!S(d.r.addr))
      missing.push(
        'The buyer address is not stored (Customer Master): the IRP needs address, location and pincode.',
      );
    return { docNo: d.no, json, missing };
  },

  /** the person pastes what the IRP returned */
  async record(
    unitId: string | null,
    b: {
      docType: DocType;
      docId: string;
      irn: string;
      ackNo: string;
      ackDate: string;
      signedQr?: string;
    },
    actorId: string,
  ) {
    const ug = await unitGst(unitId);
    if (!/^[0-9a-fA-F]{64}$/.test(b.irn.trim()))
      throw Errors.validation({ irn: 'The IRN is 64 letters and digits (0-9, a-f).' });
    if (!/^\d{6,20}$/.test(b.ackNo.trim()))
      throw Errors.validation({ ackNo: 'The acknowledgement number is digits only.' });
    const ack = new Date(b.ackDate);
    if (Number.isNaN(ack.getTime()))
      throw Errors.validation({ ackDate: 'Enter the acknowledgement date and time.' });
    const d = await loadDoc(ug.unitId, b.docType, b.docId);
    if (!d.posted) throw Errors.conflict('Only a posted document can get an IRN.');
    const limit = (await ruleNum('EINV_REPORT_DAYS', d.date)).toNumber();
    const age = Math.round(
      (Date.parse(ack.toISOString().slice(0, 10)) - Date.parse(d.date)) / 86_400_000,
    );
    const late = age > limit;
    return prisma.$transaction(async (tx) => {
      const dup = (
        // unpaginated: rows of one parent (doc_id)
        await tx.$queryRawUnsafe<Row[]>(
          `SELECT 1 FROM einvoice_records WHERE doc_type=$1 AND doc_id=$2::uuid AND status='Generated'`,
          b.docType,
          b.docId,
        )
      )[0];
      if (dup)
        throw Errors.conflict(
          'This document already has an IRN. Cancel it first to record another.',
        );
      try {
        const rows = await tx.$queryRawUnsafe<Row[]>(
          `INSERT INTO einvoice_records (unit_id, doc_type, doc_id, doc_no, doc_date, irn, ack_no, ack_date, signed_qr, late_reported, created_by_id)
           VALUES ($1::uuid,$2,$3::uuid,$4,$5::date,$6,$7,$8::timestamptz,$9,$10,$11::uuid) RETURNING id::text`,
          ug.unitId,
          b.docType,
          b.docId,
          d.no,
          d.date,
          b.irn.trim().toLowerCase(),
          b.ackNo.trim(),
          ack.toISOString(),
          b.signedQr ?? null,
          late,
          actorId,
        );
        if (b.docType === 'INV')
          await tx.$executeRawUnsafe(
            `UPDATE sales_invoices SET irn=$2 WHERE id=$1::uuid`,
            b.docId,
            b.irn.trim().toLowerCase(),
          );
        await recordAudit(
          {
            action: 'EINVOICE_RECORDED',
            actorId,
            targetType: 'EInvoice',
            targetId: S(rows[0]?.id),
            detail: { docNo: d.no, late },
          },
          tx,
        );
        return {
          id: S(rows[0]?.id),
          docNo: d.no,
          late,
          warning: late
            ? `Reported ${age} days after the invoice date; the limit is ${limit} days.`
            : null,
        };
      } catch (e) {
        if (String((e as Error).message).includes('einvoice_irn_uq'))
          throw Errors.conflict('This IRN is already recorded on another document.');
        throw e;
      }
    });
  },

  async cancel(unitId: string | null, id: string, reason: string, actorId: string) {
    const ug = await unitGst(unitId);
    if (reason.trim().length < 5)
      throw Errors.validation({ reason: 'Give a reason of at least 5 letters.' });
    return prisma.$transaction(async (tx) => {
      const e = (
        await tx.$queryRawUnsafe<Row[]>(
          `SELECT * FROM einvoice_records WHERE id=$1::uuid AND unit_id=$2::uuid FOR UPDATE`,
          id,
          ug.unitId,
        )
      )[0];
      if (!e) throw Errors.notFound('E-invoice record not found.');
      if (S(e.status) !== 'Generated') throw Errors.conflict('This IRN is already cancelled.');
      const hours = (
        await ruleNum('EINV_CANCEL_HOURS', new Date().toISOString().slice(0, 10))
      ).toNumber();
      const since = (Date.now() - (e.ack_date as Date).getTime()) / 3_600_000;
      if (since > hours)
        throw Errors.conflict(
          `The cancel window of ${hours} hours after the acknowledgement has passed. Issue a credit note instead.`,
        );
      await tx.$executeRawUnsafe(
        `UPDATE einvoice_records SET status='Cancelled', cancelled_at=now(), cancel_reason=$2 WHERE id=$1::uuid`,
        id,
        reason.trim(),
      );
      if (S(e.doc_type) === 'INV')
        await tx.$executeRawUnsafe(
          `UPDATE sales_invoices SET irn=NULL WHERE id=$1::uuid`,
          S(e.doc_id),
        );
      await recordAudit(
        {
          action: 'EINVOICE_CANCELLED',
          actorId,
          targetType: 'EInvoice',
          targetId: id,
          detail: { reason: reason.trim() },
        },
        tx,
      );
      return { id, status: 'Cancelled' };
    });
  },
};

// ---------------------------------------------------------------------------------------------------------------
export const ewayService = {
  async pending(unitId: string | null) {
    const ug = await unitGst(unitId);
    const today = new Date().toISOString().slice(0, 10);
    const min = (await ruleNum('EWB_MIN_VALUE', today)).toNumber();
    const rows = await prisma.$queryRawUnsafe<Row[]>(
      `SELECT i.id::text, i.number, i.invoice_date, c.name AS cust, i.grand_total::text AS total
         FROM sales_invoices i JOIN customers c ON c.id=i.customer_id
        WHERE i.unit_id=$1::uuid AND i.status='Posted' AND i.grand_total >= $2::numeric
          AND NOT EXISTS (SELECT 1 FROM eway_bills e WHERE e.invoice_id=i.id AND e.status='Active')
        ORDER BY i.invoice_date DESC LIMIT 300`,
      ug.unitId,
      min,
    );
    return {
      minValue: String(min),
      enabled: true,
      rows: rows.map((r) => ({
        id: S(r.id),
        docNo: S(r.number),
        date: iso(r.invoice_date),
        customer: S(r.cust),
        total: money(S(r.total)),
      })),
    };
  },

  async list(unitId: string | null) {
    const rows = await prisma.$queryRawUnsafe<Row[]>(
      `SELECT e.id::text, e.invoice_id::text, i.number, e.ewb_no, e.ewb_date, e.distance_km, e.valid_until, e.vehicle_no, e.transporter, e.extensions, e.status
         FROM eway_bills e JOIN sales_invoices i ON i.id=e.invoice_id WHERE ($1::uuid IS NULL OR e.unit_id=$1::uuid) ORDER BY e.created_at DESC LIMIT 300`,
      unitId,
    );
    const now = Date.now();
    return rows.map((r) => ({
      id: S(r.id),
      invoiceId: S(r.invoice_id),
      docNo: S(r.number),
      ewbNo: S(r.ewb_no),
      ewbDate: (r.ewb_date as Date).toISOString(),
      distanceKm: Number(r.distance_km),
      validUntil: (r.valid_until as Date).toISOString(),
      vehicleNo: r.vehicle_no ? S(r.vehicle_no) : null,
      transporter: r.transporter ? S(r.transporter) : null,
      extensions: Number(r.extensions),
      status: S(r.status),
      expired: (r.valid_until as Date).getTime() < now && S(r.status) === 'Active',
    }));
  },

  async requestJson(unitId: string | null, invoiceId: string, distanceKm?: number) {
    const ug = await unitGst(unitId);
    const d = await loadDoc(ug.unitId, 'INV', invoiceId);
    const missing: string[] = [];
    const igst = D(S(d.r.igst)).greaterThan(0);
    if (!d.posted) missing.push('The invoice is not posted.');
    if (!distanceKm) missing.push('Enter the distance in kilometres.');
    const json = {
      supplyType: 'O',
      subSupplyType: '1',
      docType: 'INV',
      docNo: d.no,
      docDate: ddmmyyyy(d.date).replace(/-/g, '/'),
      fromGstin: ug.gstin,
      fromTrdName: ug.legalName,
      fromPincode: ug.pincode,
      fromStateCode: Number(ug.stateCode),
      actFromStateCode: Number(ug.stateCode),
      toGstin: S(d.r.cust_gstin) || 'URP',
      toTrdName: S(d.r.cust),
      toStateCode: Number(S(d.r.customer_state || d.r.cust_state)),
      actToStateCode: Number(S(d.r.customer_state || d.r.cust_state)),
      totalValue: num2(D(S(d.r.taxable))),
      cgstValue: num2(D(S(d.r.cgst))),
      sgstValue: num2(D(S(d.r.sgst))),
      igstValue: num2(D(S(d.r.igst))),
      totInvValue: num2(D(S(d.r.grand_total))),
      transDistance: String(distanceKm ?? ''),
      transMode: '1',
      transporterId: '',
      vehicleNo: '',
      vehicleType: 'R',
      itemList: d.lines.map((l, i) => ({
        itemNo: i + 1,
        productName: S(l.description).slice(0, 100),
        hsnCode: Number(S(l.hsn_sac)),
        quantity: Number(S(l.qty)),
        qtyUnit: (S(l.uom) || 'OTH').toUpperCase().slice(0, 3),
        taxableAmount: num2(D(S(l.taxable))),
        sgstRate: igst ? 0 : Number(S(l.gst_pct)) / 2,
        cgstRate: igst ? 0 : Number(S(l.gst_pct)) / 2,
        igstRate: igst ? Number(S(l.gst_pct)) : 0,
      })),
    };
    if (!ug.pincode) missing.push('The unit has no pincode (Unit Master).');
    return {
      docNo: d.no,
      json,
      missing,
      partA: 'Supply, parties, items and values',
      partB: 'Transport mode, vehicle number and transporter (filled when the vehicle is known)',
    };
  },

  /** validity = one day per started 200 km (rule data), counted to the end of the last day, India time */
  async validity(from: Date, km: number): Promise<Date> {
    const perDay = (await ruleNum('EWB_KM_PER_DAY', from.toISOString().slice(0, 10))).toNumber();
    const days = Math.max(1, Math.ceil(km / perDay));
    const ist = new Date(from.getTime() + 330 * 60_000);
    const endIst = Date.UTC(
      ist.getUTCFullYear(),
      ist.getUTCMonth(),
      ist.getUTCDate() + days,
      23,
      59,
      59,
    );
    return new Date(endIst - 330 * 60_000);
  },

  async record(
    unitId: string | null,
    b: {
      invoiceId: string;
      ewbNo: string;
      ewbDate: string;
      distanceKm: number;
      vehicleNo?: string;
      transporter?: string;
      transporterId?: string;
    },
    actorId: string,
  ) {
    const ug = await unitGst(unitId);
    if (!/^\d{12}$/.test(b.ewbNo.trim()))
      throw Errors.validation({ ewbNo: 'The e-way bill number is 12 digits.' });
    const when = new Date(b.ewbDate);
    if (Number.isNaN(when.getTime()))
      throw Errors.validation({ ewbDate: 'Enter the e-way bill date and time.' });
    if (!Number.isInteger(b.distanceKm) || b.distanceKm <= 0)
      throw Errors.validation({ distanceKm: 'Enter the distance in whole kilometres.' });
    const valid = await this.validity(when, b.distanceKm);
    return prisma.$transaction(async (tx) => {
      const inv = (
        await tx.$queryRawUnsafe<Row[]>(
          `SELECT status FROM sales_invoices WHERE id=$1::uuid AND unit_id=$2::uuid FOR UPDATE`,
          b.invoiceId,
          ug.unitId,
        )
      )[0];
      if (!inv) throw Errors.notFound('Invoice not found for this unit.');
      if (S(inv.status) !== 'Posted')
        throw Errors.conflict('Only a posted invoice can get an e-way bill.');
      if (
        (
          // unpaginated: rows of one parent (invoice_id)
          await tx.$queryRawUnsafe<Row[]>(
            `SELECT 1 FROM eway_bills WHERE invoice_id=$1::uuid AND status='Active'`,
            b.invoiceId,
          )
        )[0]
      )
        throw Errors.conflict('This invoice already has an active e-way bill.');
      try {
        const rows = await tx.$queryRawUnsafe<Row[]>(
          `INSERT INTO eway_bills (unit_id, invoice_id, ewb_no, ewb_date, distance_km, valid_until, vehicle_no, transporter, transporter_id, created_by_id)
           VALUES ($1::uuid,$2::uuid,$3,$4::timestamptz,$5,$6::timestamptz,$7,$8,$9,$10::uuid) RETURNING id::text`,
          ug.unitId,
          b.invoiceId,
          b.ewbNo.trim(),
          when.toISOString(),
          b.distanceKm,
          valid.toISOString(),
          b.vehicleNo?.toUpperCase() ?? null,
          b.transporter ?? null,
          b.transporterId ?? null,
          actorId,
        );
        await tx.$executeRawUnsafe(
          `UPDATE sales_invoices SET ewb_no=$2 WHERE id=$1::uuid`,
          b.invoiceId,
          b.ewbNo.trim(),
        );
        await recordAudit(
          {
            action: 'EWAY_RECORDED',
            actorId,
            targetType: 'EwayBill',
            targetId: S(rows[0]?.id),
            detail: { ewbNo: b.ewbNo.trim(), km: b.distanceKm },
          },
          tx,
        );
        return { id: S(rows[0]?.id), validUntil: valid.toISOString() };
      } catch (e) {
        if (String((e as Error).message).includes('eway_no_uq'))
          throw Errors.conflict('This e-way bill number is already recorded.');
        throw e;
      }
    });
  },

  /** extension: only inside the window around the expiry; adds validity for the remaining distance */
  async extend(
    unitId: string | null,
    id: string,
    b: { remainingKm: number; reason: string },
    actorId: string,
  ) {
    const ug = await unitGst(unitId);
    if (b.reason.trim().length < 5)
      throw Errors.validation({ reason: 'Give a reason of at least 5 letters.' });
    if (!Number.isInteger(b.remainingKm) || b.remainingKm <= 0)
      throw Errors.validation({ remainingKm: 'Enter the remaining distance in whole kilometres.' });
    return prisma.$transaction(async (tx) => {
      const e = (
        await tx.$queryRawUnsafe<Row[]>(
          `SELECT * FROM eway_bills WHERE id=$1::uuid AND unit_id=$2::uuid FOR UPDATE`,
          id,
          ug.unitId,
        )
      )[0];
      if (!e) throw Errors.notFound('E-way bill not found.');
      if (S(e.status) !== 'Active') throw Errors.conflict('The e-way bill is cancelled.');
      const hours = (
        await ruleNum('EWB_EXTEND_HOURS', new Date().toISOString().slice(0, 10))
      ).toNumber();
      const until = (e.valid_until as Date).getTime();
      const diffH = (Date.now() - until) / 3_600_000;
      if (diffH < -hours || diffH > hours)
        throw Errors.conflict(
          `An e-way bill can be extended from ${hours} hours before to ${hours} hours after it expires.`,
        );
      const newValid = await this.validity(new Date(Math.max(Date.now(), until)), b.remainingKm);
      await tx.$executeRawUnsafe(
        `UPDATE eway_bills SET valid_until=$2::timestamptz, extensions=extensions+1 WHERE id=$1::uuid`,
        id,
        newValid.toISOString(),
      );
      await recordAudit(
        {
          action: 'EWAY_EXTENDED',
          actorId,
          targetType: 'EwayBill',
          targetId: id,
          detail: { reason: b.reason.trim(), remainingKm: b.remainingKm },
        },
        tx,
      );
      return { id, validUntil: newValid.toISOString() };
    });
  },

  async cancel(unitId: string | null, id: string, reason: string, actorId: string) {
    const ug = await unitGst(unitId);
    if (reason.trim().length < 5)
      throw Errors.validation({ reason: 'Give a reason of at least 5 letters.' });
    return prisma.$transaction(async (tx) => {
      const e = (
        await tx.$queryRawUnsafe<Row[]>(
          `SELECT * FROM eway_bills WHERE id=$1::uuid AND unit_id=$2::uuid FOR UPDATE`,
          id,
          ug.unitId,
        )
      )[0];
      if (!e) throw Errors.notFound('E-way bill not found.');
      if (S(e.status) !== 'Active') throw Errors.conflict('Already cancelled.');
      await tx.$executeRawUnsafe(
        `UPDATE eway_bills SET status='Cancelled', cancelled_at=now(), cancel_reason=$2 WHERE id=$1::uuid`,
        id,
        reason.trim(),
      );
      await tx.$executeRawUnsafe(
        `UPDATE sales_invoices SET ewb_no=NULL WHERE id=$1::uuid`,
        S(e.invoice_id),
      );
      await recordAudit(
        {
          action: 'EWAY_CANCELLED',
          actorId,
          targetType: 'EwayBill',
          targetId: id,
          detail: { reason: reason.trim() },
        },
        tx,
      );
      return { id, status: 'Cancelled' };
    });
  },
};
