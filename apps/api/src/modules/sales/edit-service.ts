// "Edit" on the Sales pages whose records are not edited by re-entering the whole document: a delivery promise
// (on the sales order), the reference of a posted receipt, and the notes kept about a customer's credit.
// Nothing here changes money, stock, or an approved quantity.
import { recordAudit } from '../../core/audit/audit-service';
import { prisma } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { accessUserOf, scopeFor } from '../../core/rbac/access';
import type { Caller } from '../records/service';
import { exec, norm, query, scopeSql } from '../procurement/core';
import type { Row } from '../procurement/core';
import { creditExposure, resolveProject } from './crm-service';
import { SO_DEF } from './docs-service';

const S = (v: unknown): string => (v === null || v === undefined ? '' : String(v as string));
const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString().slice(0, 10) : v ? S(v).slice(0, 10) : null);

/** The record of this plant that the caller may see, or "not found". */
async function ownRow(caller: Caller, pageId: string, table: string, id: string): Promise<Row> {
  const sc = await scopeSql(caller, pageId);
  const row = (await query(prisma, `SELECT t.* FROM "${table}" t WHERE ${sc.sql} AND t.id = $${sc.args.length + 1}::uuid`, ...sc.args, id))[0];
  if (!row) throw Errors.notFound('Record not found.');
  return row;
}

// ------------------------------------------------------------------------------------------ delivery promise
export const deliveryPlanService = {
  async get(caller: Caller, id: string) {
    const o = await ownRow(caller, SO_DEF.pageId, SO_DEF.table, id);
    return {
      id: S(o.id),
      number: S(o.number),
      status: S(o.status),
      orderDate: iso(o.order_date),
      deliveryDate: iso(o.delivery_date),
      shipTo: S(o.ship_to),
      version: Number(o.version),
    };
  },
  async reschedule(caller: Caller, id: string, ifMatch: number | undefined, b: { deliveryDate: string; shipTo?: string | null; reason: string }) {
    const o = await ownRow(caller, SO_DEF.pageId, SO_DEF.table, id);
    if (ifMatch !== undefined && ifMatch !== Number(o.version)) throw Errors.versionConflict();
    if (/^(cancelled|closed)$/i.test(S(o.status))) throw Errors.conflict(`A ${S(o.status).toLowerCase()} order has no delivery to reschedule.`);
    const left = (await query(prisma, `SELECT COALESCE(sum(qty - dispatched_qty - closed_qty), 0)::text AS n FROM sales_order_lines WHERE order_id = $1::uuid`, id))[0];
    if (Number(left?.n ?? 0) <= 0) throw Errors.conflict('Everything on this order is already delivered.');
    const was = iso(o.delivery_date);
    const ordered = iso(o.order_date);
    if (ordered && b.deliveryDate < ordered) throw Errors.validation({ deliveryDate: `The order is dated ${ordered}: choose that day or later.` });
    await prisma.$transaction(async (tx) => {
      const n = await tx.$executeRawUnsafe(
        `UPDATE sales_orders SET delivery_date = $2::date, ship_to = $3, version = version + 1, updated_by_id = $4::uuid, updated_at = now() WHERE id = $1::uuid AND version = $5`,
        id,
        b.deliveryDate,
        b.shipTo === undefined ? (o.ship_to ?? null) : b.shipTo || null,
        caller.auth.userId,
        Number(o.version),
      );
      if (n !== 1) throw Errors.versionConflict();
      // lines that followed the order's date follow the new one; a line with a date of its own keeps it
      await exec(
        tx,
        `UPDATE sales_order_lines SET delivery_date = $2::date WHERE order_id = $1::uuid AND qty - dispatched_qty - closed_qty > 0 AND delivery_date IS NOT DISTINCT FROM $3::date AND delivery_date IS NOT NULL`,
        id,
        b.deliveryDate,
        was,
      );
      await recordAudit(
        {
          action: 'DELIVERY_RESCHEDULED',
          actorId: caller.auth.userId,
          targetType: 'record',
          targetId: id,
          meta: caller.meta,
          detail: { pageId: 'sales-delivery', code: S(o.number), from: was, to: b.deliveryDate, reason: b.reason.trim(), unitId: S(o.unit_id) },
        },
        tx,
      );
    });
    return deliveryPlanService.get(caller, id);
  },
};

// ------------------------------------------------------------------------------------------ receipt reference
/** A receipt of this plant (receipts are never soft-deleted, so they have no deleted_at to filter on). */
async function ownReceipt(caller: Caller, id: string): Promise<Row> {
  const r = (await query(prisma, `SELECT * FROM sales_receipts WHERE id = $1::uuid`, id))[0];
  const allowed = caller.ctx.unitId ? S(r?.unit_id) === caller.ctx.unitId : caller.ctx.allUnits;
  const ownOnly = (await scopeFor(accessUserOf(caller.auth.user), 'sales-collections')) === 'OWN';
  if (!r || !allowed || (ownOnly && S(r.created_by_id) !== caller.auth.userId)) throw Errors.notFound('Record not found.');
  return r;
}

export const receiptEditService = {
  async get(caller: Caller, id: string) {
    const r = await ownReceipt(caller, id);
    return {
      id: S(r.id),
      number: S(r.number),
      status: S(r.status),
      amount: S(norm<Row>(r).amount),
      mode: S(r.mode),
      reference: S(r.reference),
      version: Number(r.version),
    };
  },
  async update(caller: Caller, id: string, ifMatch: number | undefined, b: { mode?: string; reference?: string | null }) {
    const r = await ownReceipt(caller, id);
    if (ifMatch !== undefined && ifMatch !== Number(r.version)) throw Errors.versionConflict();
    if (S(r.status) !== 'Posted') throw Errors.conflict(`A ${S(r.status).toLowerCase()} receipt cannot be edited.`);
    const mode = b.mode ?? S(r.mode);
    if ((mode === 'Cash') !== (S(r.mode) === 'Cash'))
      throw Errors.validation({ mode: 'Cash and bank money go to different books: cancel this receipt and enter it again.' });
    const reference = b.reference === undefined ? S(r.reference) : S(b.reference).trim();
    await prisma.$transaction(async (tx) => {
      const n = await tx.$executeRawUnsafe(
        `UPDATE sales_receipts SET mode = $2, reference = $3, version = version + 1 WHERE id = $1::uuid AND version = $4`,
        id,
        mode,
        reference || null,
        Number(r.version),
      );
      if (n !== 1) throw Errors.versionConflict();
      await recordAudit(
        {
          action: 'SCM_UPDATED',
          actorId: caller.auth.userId,
          targetType: 'record',
          targetId: id,
          meta: caller.meta,
          detail: { pageId: 'sales-collections', code: S(r.number), before: { mode: S(r.mode), reference: S(r.reference) }, after: { mode, reference }, unitId: S(r.unit_id) },
        },
        tx,
      );
    });
    return receiptEditService.get(caller, id);
  },
};

// ------------------------------------------------------------------------------------------ credit profile
export const creditProfileService = {
  /** Everything the Credit Limit form shows for one customer: the limit, what is used of it, and the notes. */
  async get(customerId: string) {
    const c = (
      await query(
        prisma,
        `SELECT c.id::text, c.code, c.name, c.status, c.credit_limit::text AS credit_limit, c.credit_days, p.risk_grade, p.review_date, pj.code AS project_number,
                (SELECT COALESCE(sum(o.outstanding),0)::text FROM open_items o WHERE o.party_type='CUSTOMER' AND o.party_id=c.id AND o.status NOT IN ('Settled','Cancelled') AND o.due_date < CURRENT_DATE) AS overdue,
                (SELECT max(CURRENT_DATE - o.due_date) FROM open_items o WHERE o.party_type='CUSTOMER' AND o.party_id=c.id AND o.status NOT IN ('Settled','Cancelled') AND o.outstanding > 0 AND o.due_date < CURRENT_DATE) AS oldest_due_days,
                EXISTS (SELECT 1 FROM customer_credit_requests q WHERE q.customer_id=c.id AND q.status='PENDING') AS pending,
                (SELECT so.number || ': ' || so.credit_override_reason FROM sales_orders so WHERE so.customer_id=c.id AND so.credit_override_reason IS NOT NULL AND so.deleted_at IS NULL ORDER BY so.updated_at DESC LIMIT 1) AS last_override
           FROM customers c LEFT JOIN customer_credit_profiles p ON p.customer_id=c.id LEFT JOIN projects pj ON pj.id=p.project_id
          WHERE c.id=$1::uuid AND c.deleted_at IS NULL`,
        customerId,
      )
    )[0];
    if (!c) throw Errors.notFound('Customer not found.');
    const used = Number((await creditExposure(prisma, customerId)).total);
    const limit = c.credit_limit === null ? null : Number(S(c.credit_limit));
    return {
      customerId: S(c.id),
      code: S(c.code),
      name: S(c.name),
      customerStatus: S(c.status),
      creditLimit: limit,
      creditDays: c.credit_days === null ? null : Number(c.credit_days),
      usedLimit: used,
      availableLimit: limit === null ? null : limit - used,
      overdue: Number(S(c.overdue) || '0'),
      oldestDueDays: c.oldest_due_days === null ? null : Number(c.oldest_due_days),
      status: limit === null ? 'No limit' : used > limit ? 'Over limit' : 'Within limit',
      holdStatus: limit !== null && used > limit ? 'On hold: a new order needs a credit override' : 'Not on hold',
      lastOverride: S(c.last_override),
      pendingRequest: c.pending === true,
      riskGrade: S(c.risk_grade),
      reviewDate: iso(c.review_date),
      projectNumber: S(c.project_number),
    };
  },
  async save(caller: Caller, customerId: string, b: { riskGrade?: string | null; reviewDate?: string | null; projectNumber?: string | null }) {
    const before = await creditProfileService.get(customerId);
    await prisma.$transaction(async (tx) => {
      const header: Row = 'projectNumber' in b ? await resolveProject(tx, { projectNumber: b.projectNumber ?? '' }) : {};
      const project = 'projectId' in header ? header.projectId : undefined;
      const risk = b.riskGrade === undefined ? before.riskGrade : (b.riskGrade ?? '');
      const review = b.reviewDate === undefined ? before.reviewDate : b.reviewDate;
      await exec(
        tx,
        `INSERT INTO customer_credit_profiles (customer_id, risk_grade, review_date, project_id, updated_by_id)
         VALUES ($1::uuid, $2, $3::date, $4::uuid, $5::uuid)
         ON CONFLICT (customer_id) DO UPDATE SET risk_grade = EXCLUDED.risk_grade, review_date = EXCLUDED.review_date,
           project_id = CASE WHEN $6 THEN EXCLUDED.project_id ELSE customer_credit_profiles.project_id END,
           updated_by_id = EXCLUDED.updated_by_id, updated_at = now()`,
        customerId,
        risk || null,
        review || null,
        project ?? null,
        caller.auth.userId,
        project !== undefined,
      );
      await recordAudit(
        {
          action: 'CUSTOMER_CREDIT_CHANGED',
          actorId: caller.auth.userId,
          targetType: 'Customer',
          targetId: customerId,
          meta: caller.meta,
          detail: { pageId: 'sales-credit', code: before.code, profile: { riskGrade: risk, reviewDate: review, projectNumber: b.projectNumber ?? before.projectNumber } },
        },
        tx,
      );
    });
    return creditProfileService.get(customerId);
  },
};
