// Phase 10 CRM: lead sources, leads, opportunities (pipeline with stage gates), follow-ups, meetings and calls,
// customer feedback (NPS), Customer 360 and the demand-planning feed. These records are not approval documents:
// each has its own simple status list and its own "can still be edited" rule.
import { prisma } from '../../core/db/prisma';
import type { Db } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import type { Caller } from '../records/service';
import { D, ZERO, round2, str } from '../inventory/money';
import { makeCrud } from '../procurement/crud';
import {
  TX,
  S,
  allocateNumber,
  departmentOf,
  fyOfCaller,
  audit,
  exec,
  insertRow,
  loadDoc,
  norm,
  query,
  scopeSql,
  todayIst,
  updateRow,
} from '../procurement/core';
import type { DocDef, Row } from '../procurement/core';
import { concreteUnit } from '../inventory/typed';

export const LEAD_DEF: DocDef = {
  pageId: 'crm-leads',
  draftStatus: 'New',
  table: 'leads',
  title: 'Lead',
  amountCol: null,
};
export const OPP_DEF: DocDef = {
  pageId: 'crm-opportunities',
  draftStatus: 'Prospecting',
  table: 'opportunities',
  title: 'Opportunity',
  amountCol: 'amount',
};
export const FU_DEF: DocDef = {
  pageId: 'crm-followups',
  draftStatus: 'Open',
  table: 'crm_followups',
  title: 'Follow-up',
  amountCol: null,
};
export const MTG_DEF: DocDef = {
  pageId: 'crm-meetings',
  draftStatus: 'Planned',
  table: 'crm_meetings',
  title: 'Meeting',
  amountCol: null,
};
export const FB_DEF: DocDef = {
  pageId: 'crm-feedback',
  draftStatus: 'New',
  table: 'crm_feedback',
  title: 'Feedback',
  amountCol: null,
};

const notTerminal = (done: string[]) => (row: Row) => !done.includes(S(row.status));

export const leadCrud = makeCrud({
  def: LEAD_DEF,
  headerKeys: [
    'name',
    'company',
    'mobile',
    'email',
    'stateCode',
    'sourceId',
    'assignedToId',
    'interest',
    'estValue',
    'score',
  ],
  lineKeys: [],
  canEdit: notTerminal(['Converted']),
  prepare(c) {
    if (!c.header.name && !c.existing) throw Errors.validation({ name: 'Enter the lead name.' });
    return { header: c.header, lines: [] };
  },
});
export const oppCrud = makeCrud({
  hasCustomer: true,
  def: OPP_DEF,
  hasSupplier: false,
  headerKeys: [
    'customerId',
    'leadId',
    'title',
    'amount',
    'probability',
    'expectedClose',
    'ownerId',
  ],
  lineKeys: [],
  canEdit: notTerminal(['Won', 'Lost']),
  async afterSave(c) {
    await insertRow(c.tx, 'opportunity_stage_history', {
      opportunityId: c.id,
      fromStage: null,
      toStage: 'Prospecting',
      note: 'Created',
      changedById: c.caller.auth.userId,
    });
  },
});
export const followupCrud = makeCrud({
  hasCustomer: true,
  def: FU_DEF,
  headerKeys: ['relatedType', 'relatedId', 'customerId', 'title', 'kind', 'dueAt', 'assignedToId'],
  lineKeys: [],
  canEdit: notTerminal(['Done', 'Cancelled']),
});
export const meetingCrud = makeCrud({
  hasCustomer: true,
  def: MTG_DEF,
  headerKeys: [
    'relatedType',
    'relatedId',
    'customerId',
    'subject',
    'kind',
    'startsAt',
    'durationMin',
    'attendees',
    'ownerId',
  ],
  lineKeys: [],
  canEdit: notTerminal(['Held', 'Cancelled']),
});
export const feedbackCrud = makeCrud({
  hasCustomer: true,
  def: FB_DEF,
  headerKeys: ['customerId', 'rating', 'category', 'comment', 'givenOn'],
  lineKeys: [],
  canEdit: notTerminal(['Closed']),
});

// ---------------------------------------------------------------------------------------------- lead sources
export const sourceService = {
  async list() {
    return (await query(prisma, `SELECT * FROM lead_sources ORDER BY name`)).map((r) =>
      norm<Row>(r),
    );
  },
  async create(caller: Caller, b: { code: string; name: string }) {
    const id = await insertRow(prisma, 'lead_sources', {
      code: b.code.toUpperCase(),
      name: b.name,
      createdById: caller.auth.userId,
      updatedById: caller.auth.userId,
    });
    return norm<Row>((await query(prisma, `SELECT * FROM lead_sources WHERE id=$1::uuid`, id))[0]!);
  },
  async update(caller: Caller, id: string, b: { name?: string; status?: 'Active' | 'Inactive' }) {
    await updateRow(prisma, 'lead_sources', id, {
      ...b,
      updatedById: caller.auth.userId,
      updatedAt: new Date(),
    });
    return norm<Row>(
      (await query(prisma, `SELECT * FROM lead_sources WHERE id=$1::uuid`, id))[0] ??
        (() => {
          throw Errors.notFound('Source not found.');
        })(),
    );
  },
};

// ---------------------------------------------------------------------------------------------- actions
const STAGES = ['Prospecting', 'Qualification', 'Proposal', 'Negotiation', 'Won', 'Lost'];

export const crmActions = {
  async leadStatus(
    caller: Caller,
    id: string,
    body: { status: 'Contacted' | 'Qualified' | 'Unqualified'; lostReason?: string },
  ) {
    await prisma.$transaction(async (tx) => {
      const l = await loadDoc(tx, caller, LEAD_DEF, id, { lock: true });
      if (l.status === 'Converted') throw Errors.conflict('This lead is already converted.');
      if (body.status === 'Unqualified' && (body.lostReason ?? '').trim().length < 3)
        throw Errors.validation({ lostReason: 'Say why the lead is not qualified.' });
      await updateRow(tx, 'leads', id, {
        status: body.status,
        lostReason: body.lostReason ?? null,
        updatedById: caller.auth.userId,
        updatedAt: new Date(),
      });
      await exec(tx, `UPDATE leads SET version=version+1 WHERE id=$1::uuid`, id);
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'SCM_UPDATED',
        LEAD_DEF.title,
        { id, code: S(l.number) },
        LEAD_DEF.pageId,
        { status: body.status },
      );
    }, TX);
    return leadCrud.get(caller, id);
  },

  /** Qualified lead -> opportunity (and the customer it belongs to, when it already is one). */
  async convert(
    caller: Caller,
    id: string,
    body: {
      customerId?: string | undefined;
      title?: string | undefined;
      amount?: string | undefined;
    },
  ) {
    concreteUnit(caller);
    const l = await loadDoc(prisma, caller, LEAD_DEF, id);
    if (l.status === 'Converted') throw Errors.conflict('This lead is already converted.');
    if (l.status !== 'Qualified')
      throw Errors.conflict('Only a qualified lead can be converted. Mark it Qualified first.');
    if (body.customerId) {
      const c = (
        await query(
          prisma,
          `SELECT 1 FROM customers WHERE id=$1::uuid AND deleted_at IS NULL AND status='ACTIVE'`,
          body.customerId,
        )
      )[0];
      if (!c) throw Errors.validation({ customerId: 'Choose an active customer.' });
    }
    const unitId = concreteUnit(caller);
    const fy = await fyOfCaller(caller);
    const oppId = await prisma.$transaction(async (tx) => {
      const cur = await loadDoc(tx, caller, LEAD_DEF, id, { lock: true });
      if (cur.status === 'Converted') throw Errors.conflict('This lead is already converted.');
      if (cur.status !== 'Qualified')
        throw Errors.conflict('Only a qualified lead can be converted. Mark it Qualified first.');
      const number = await allocateNumber(tx, OPP_DEF, unitId, fy.id);
      const oid = await insertRow(tx, 'opportunities', {
        unitId,
        fyId: fy.id,
        number,
        department: await departmentOf(tx, OPP_DEF.pageId, caller),
        status: 'Prospecting',
        customerId: body.customerId ?? null,
        leadId: id,
        title: body.title ?? (S(l.interest) || S(l.name)),
        amount: body.amount ?? (S(l.est_value) || '0'),
        ownerId: l.assigned_to_id ?? caller.auth.userId,
        createdById: caller.auth.userId,
        updatedById: caller.auth.userId,
      });
      await insertRow(tx, 'opportunity_stage_history', {
        opportunityId: oid,
        fromStage: null,
        toStage: 'Prospecting',
        note: 'Created from lead',
        changedById: caller.auth.userId,
      });
      await exec(
        tx,
        `UPDATE leads SET status='Converted', converted_at=now(), opportunity_id=$2::uuid, customer_id=$3::uuid, version=version+1 WHERE id=$1::uuid`,
        id,
        oid,
        body.customerId ?? null,
      );
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'SCM_UPDATED',
        LEAD_DEF.title,
        { id, code: S(cur.number) },
        LEAD_DEF.pageId,
        { converted: number },
      );
      return oid;
    }, TX);
    return oppCrud.get(caller, oppId);
  },

  /** Stage gates (archive plan 4.7): Proposal needs a value; Negotiation needs a quotation; Won needs an accepted quotation or an order; Lost needs a reason. */
  async moveStage(
    caller: Caller,
    id: string,
    body: { stage: string; note?: string; lostReason?: string },
  ) {
    await prisma.$transaction(async (tx) => {
      const o = await loadDoc(tx, caller, OPP_DEF, id, { lock: true });
      const from = S(o.status);
      if (from === 'Won' || from === 'Lost')
        throw Errors.conflict(`A ${from} opportunity cannot move again.`);
      if (!STAGES.includes(body.stage) || body.stage === from)
        throw Errors.validation({ stage: 'Choose a different stage.' });
      if (body.stage === 'Lost' && (body.lostReason ?? '').trim().length < 3)
        throw Errors.validation({ lostReason: 'Say why the opportunity was lost.' });
      if (body.stage === 'Proposal' && D(S(norm<Row>(o).amount)).lte(0))
        throw Errors.validation({ stage: 'Enter the expected value before moving to Proposal.' });
      if (['Negotiation', 'Won'].includes(body.stage) && !o.customer_id)
        throw Errors.validation({ stage: 'Link the opportunity to a customer first.' });
      if (body.stage === 'Negotiation') {
        const q = (
          await query(
            tx,
            `SELECT 1 FROM sales_quotations WHERE opportunity_id=$1::uuid AND deleted_at IS NULL AND status <> 'Cancelled' LIMIT 1`,
            id,
          )
        )[0];
        if (!q)
          throw Errors.validation({
            stage: 'Make a quotation for this opportunity before Negotiation.',
          });
      }
      if (body.stage === 'Won') {
        const q = (
          await query(
            tx,
            `SELECT 1 FROM sales_quotations WHERE opportunity_id=$1::uuid AND customer_status='ACCEPTED' AND deleted_at IS NULL LIMIT 1`,
            id,
          )
        )[0];
        if (!q)
          throw Errors.validation({
            stage: 'An accepted quotation is needed before the opportunity is Won.',
          });
      }
      const closed = body.stage === 'Won' || body.stage === 'Lost';
      await exec(
        tx,
        `UPDATE opportunities SET status=$2, lost_reason=$3, closed_at = CASE WHEN $4 THEN now() ELSE NULL END, probability = CASE WHEN $2='Won' THEN 100 WHEN $2='Lost' THEN 0 ELSE probability END, version=version+1, updated_by_id=$5::uuid, updated_at=now() WHERE id=$1::uuid`,
        id,
        body.stage,
        body.lostReason ?? null,
        closed,
        caller.auth.userId,
      );
      await insertRow(tx, 'opportunity_stage_history', {
        opportunityId: id,
        fromStage: from,
        toStage: body.stage,
        note: body.note ?? body.lostReason ?? null,
        changedById: caller.auth.userId,
      });
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'SCM_UPDATED',
        OPP_DEF.title,
        { id, code: S(o.number) },
        OPP_DEF.pageId,
        { from, to: body.stage },
      );
    }, TX);
    return oppCrud.get(caller, id);
  },

  async pipeline(caller: Caller) {
    const sc = await scopeSql(caller, OPP_DEF.pageId, 'o');
    const rows = await query(
      prisma,
      `SELECT o.*, c.name AS customer_name FROM opportunities o LEFT JOIN customers c ON c.id=o.customer_id WHERE ${sc.sql} ORDER BY o.created_at DESC LIMIT 500`,
      ...sc.args,
    );
    const cols = STAGES.map((stage) => {
      const items = rows.filter((r) => r.status === stage).map((r) => norm<Row>(r));
      return {
        stage,
        count: items.length,
        amount: str(items.reduce((a, r) => a.plus(D(S(r.amount))), ZERO)),
        weighted: str(
          round2(
            items.reduce(
              (a, r) => a.plus(D(S(r.amount)).mul(Number(r.probability)).div(100)),
              ZERO,
            ),
          ),
        ),
        items,
      };
    });
    return { stages: cols };
  },

  async history(caller: Caller, id: string) {
    await loadDoc(prisma, caller, OPP_DEF, id);
    return (
      await query(
        prisma,
        `SELECT h.*, u.name AS changed_by FROM opportunity_stage_history h LEFT JOIN users u ON u.id=h.changed_by_id WHERE h.opportunity_id=$1::uuid ORDER BY h.changed_at`,
        id,
      )
    ).map((r) => norm<Row>(r));
  },

  async followupDone(caller: Caller, id: string, outcome: string) {
    if (outcome.trim().length < 3) throw Errors.validation({ outcome: 'Write what happened.' });
    await prisma.$transaction(async (tx) => {
      const f = await loadDoc(tx, caller, FU_DEF, id, { lock: true });
      if (f.status !== 'Open')
        throw Errors.conflict(`A ${S(f.status)} follow-up cannot be closed.`);
      await exec(
        tx,
        `UPDATE crm_followups SET status='Done', outcome=$2, done_at=now(), version=version+1, updated_by_id=$3::uuid, updated_at=now() WHERE id=$1::uuid`,
        id,
        outcome.trim(),
        caller.auth.userId,
      );
    }, TX);
    return followupCrud.get(caller, id);
  },
  async meetingHeld(caller: Caller, id: string, outcome: string) {
    if (outcome.trim().length < 3) throw Errors.validation({ outcome: 'Write the outcome.' });
    await prisma.$transaction(async (tx) => {
      const m = await loadDoc(tx, caller, MTG_DEF, id, { lock: true });
      if (m.status !== 'Planned')
        throw Errors.conflict(`A ${S(m.status)} meeting cannot be closed.`);
      await exec(
        tx,
        `UPDATE crm_meetings SET status='Held', outcome=$2, version=version+1, updated_by_id=$3::uuid, updated_at=now() WHERE id=$1::uuid`,
        id,
        outcome.trim(),
        caller.auth.userId,
      );
    }, TX);
    return meetingCrud.get(caller, id);
  },
  async feedbackStatus(
    caller: Caller,
    id: string,
    body: { status: 'In review' | 'Closed'; actionNote?: string },
  ) {
    await prisma.$transaction(async (tx) => {
      const f = await loadDoc(tx, caller, FB_DEF, id, { lock: true });
      if (f.status === 'Closed') throw Errors.conflict('This feedback is already closed.');
      if (
        body.status === 'Closed' &&
        Number(f.rating) <= 6 &&
        (body.actionNote ?? '').trim().length < 5
      )
        throw Errors.validation({
          actionNote: 'Write the action taken before closing low-rated feedback.',
        });
      await exec(
        tx,
        `UPDATE crm_feedback SET status=$2, action_note=COALESCE($3, action_note), version=version+1, updated_by_id=$4::uuid, updated_at=now() WHERE id=$1::uuid`,
        id,
        body.status,
        body.actionNote ?? null,
        caller.auth.userId,
      );
    }, TX);
    return feedbackCrud.get(caller, id);
  },
};

/** NPS = % promoters (9-10) - % detractors (0-6) over the feedback of the unit. */
export async function npsReport(caller: Caller) {
  const sc = await scopeSql(caller, FB_DEF.pageId, 't');
  const r = (
    await query(
      prisma,
      `SELECT count(*)::int AS n, count(*) FILTER (WHERE rating >= 9)::int AS p, count(*) FILTER (WHERE rating <= 6)::int AS d, COALESCE(avg(rating),0)::text AS avg FROM crm_feedback t WHERE ${sc.sql}`,
      ...sc.args,
    )
  )[0]!;
  const n = Number(r.n);
  return {
    responses: n,
    promoters: Number(r.p),
    detractors: Number(r.d),
    average: n ? Number(D(S(r.avg)).toDecimalPlaces(1)) : null,
    nps: n ? Math.round(((Number(r.p) - Number(r.d)) * 100) / n) : null,
  };
}

// ---------------------------------------------------------------------------------------------- credit exposure
/** Unpaid invoices (net of advances / unapplied credit notes) + the value of orders not yet delivered. */
export async function creditExposure(
  db: Db,
  customerId: string,
  excludeOrderId?: string,
): Promise<{
  receivable: ReturnType<typeof D>;
  openOrders: ReturnType<typeof D>;
  total: ReturnType<typeof D>;
}> {
  const ar = (
    await query(
      db,
      `SELECT COALESCE(sum(outstanding),0)::text AS s FROM open_items WHERE party_type='CUSTOMER' AND party_id=$1::uuid AND status NOT IN ('Settled','Cancelled')`,
      customerId,
    )
  )[0];
  const oo = (
    await query(
      db,
      `SELECT COALESCE(sum((l.qty - l.dispatched_qty - l.closed_qty) * l.rate * (1 - l.discount_pct/100)),0)::text AS s
      FROM sales_order_lines l JOIN sales_orders o ON o.id=l.order_id
     WHERE o.customer_id=$1::uuid AND o.status='Approved' AND o.deleted_at IS NULL AND ($2::uuid IS NULL OR o.id <> $2::uuid) AND l.qty - l.dispatched_qty - l.closed_qty > 0`,
      customerId,
      excludeOrderId ?? null,
    )
  )[0];
  const receivable = D(S(ar?.s ?? 0));
  const openOrders = round2(D(S(oo?.s ?? 0)));
  return { receivable, openOrders, total: receivable.plus(openOrders) };
}

/** Credit view: every customer with a limit, what they owe and what is on order. */
export async function creditOverview() {
  const rows = await query(
    prisma,
    `SELECT c.id::text, c.code, c.name, c.credit_limit::text, c.credit_days, c.tier,
        COALESCE((SELECT sum(o.outstanding) FROM open_items o WHERE o.party_type='CUSTOMER' AND o.party_id=c.id AND o.status NOT IN ('Settled','Cancelled')),0)::text AS receivable,
        COALESCE((SELECT sum((l.qty - l.dispatched_qty - l.closed_qty) * l.rate * (1 - l.discount_pct/100)) FROM sales_order_lines l JOIN sales_orders so ON so.id=l.order_id
                   WHERE so.customer_id=c.id AND so.status='Approved' AND so.deleted_at IS NULL AND l.qty - l.dispatched_qty - l.closed_qty > 0),0)::text AS open_orders
       FROM customers c WHERE c.deleted_at IS NULL AND c.status='ACTIVE' AND c.credit_limit IS NOT NULL ORDER BY c.name LIMIT 500`,
  );
  return rows.map((r) => {
    const n = norm<Row>(r);
    const exposure = D(S(n.receivable)).plus(round2(D(S(n.openOrders))));
    const limit = D(S(n.creditLimit));
    return {
      ...n,
      exposure: str(exposure),
      available: str(limit.minus(exposure)),
      onHold: exposure.gt(limit),
    };
  });
}

export async function customer360(caller: Caller, customerId: string) {
  const c = (
    await query(
      prisma,
      `SELECT id::text, code, name, gstin, state_code, credit_limit::text, credit_days, tier, status, approval_status FROM customers WHERE id=$1::uuid AND deleted_at IS NULL`,
      customerId,
    )
  )[0];
  if (!c) throw Errors.notFound('Customer not found.');
  const unitSql = caller.ctx.unitId ? 'AND unit_id = $2::uuid' : '';
  const args: unknown[] = [customerId, ...(caller.ctx.unitId ? [caller.ctx.unitId] : [])];
  const exp = await creditExposure(prisma, customerId);
  const limit = c.credit_limit === null ? null : D(S(c.credit_limit));
  const list = async (sql: string) => (await query(prisma, sql, ...args)).map((r) => norm<Row>(r));
  return {
    customer: norm<Row>(c),
    credit: {
      limit: limit ? str(limit) : null,
      receivable: str(exp.receivable),
      openOrders: str(exp.openOrders),
      exposure: str(exp.total),
      available: limit ? str(limit.minus(exp.total)) : null,
      onHold: limit ? exp.total.gt(limit) : false,
    },
    opportunities: await list(
      `SELECT id::text, number, title, status, amount::text FROM opportunities WHERE customer_id=$1::uuid AND deleted_at IS NULL ${unitSql} ORDER BY created_at DESC LIMIT 10`,
    ),
    quotations: await list(
      `SELECT id::text, number, status, customer_status, grand_total::text, quote_date FROM sales_quotations WHERE customer_id=$1::uuid AND deleted_at IS NULL ${unitSql} ORDER BY created_at DESC LIMIT 10`,
    ),
    orders: await list(
      `SELECT id::text, number, status, grand_total::text, order_date FROM sales_orders WHERE customer_id=$1::uuid AND deleted_at IS NULL ${unitSql} ORDER BY created_at DESC LIMIT 10`,
    ),
    invoices: await list(
      `SELECT id::text, number, status, grand_total::text, received_amount::text, due_date, receipt_status FROM sales_invoices WHERE customer_id=$1::uuid AND deleted_at IS NULL ${unitSql} ORDER BY created_at DESC LIMIT 10`,
    ),
    feedback: await list(
      `SELECT id::text, rating, category, comment, given_on FROM crm_feedback WHERE customer_id=$1::uuid AND deleted_at IS NULL ${unitSql} ORDER BY created_at DESC LIMIT 10`,
    ),
  };
}

// ---------------------------------------------------------------------------------------------- demand planning (client req 5)
/** Confirmed sales-order balance by delivery month + independent forecasts: the feed for MRP (Phase 13). */
export async function demandPlan(
  caller: Caller,
  q: { from?: string | undefined; to?: string | undefined },
) {
  const args: unknown[] = [];
  let unit = 'false';
  if (caller.ctx.unitId) {
    args.push(caller.ctx.unitId);
    unit = `o.unit_id = $1::uuid`;
  } else if (caller.ctx.allUnits) unit = 'true';
  const orders = await query(
    prisma,
    `SELECT l.item_id::text, i.code AS item_code, i.name AS item_name, to_char(COALESCE(l.delivery_date, o.delivery_date, o.order_date), 'YYYY-MM') AS month,
        sum(l.qty - l.dispatched_qty - l.closed_qty)::text AS qty
      FROM sales_order_lines l JOIN sales_orders o ON o.id=l.order_id JOIN items i ON i.id=l.item_id
     WHERE ${unit} AND o.status='Approved' AND o.deleted_at IS NULL AND l.qty - l.dispatched_qty - l.closed_qty > 0
     GROUP BY 1,2,3,4 ORDER BY 4,2`,
    ...args,
  );
  const fargs: unknown[] = [];
  let funit = 'false';
  if (caller.ctx.unitId) {
    fargs.push(caller.ctx.unitId);
    funit = `f.unit_id = $1::uuid`;
  } else if (caller.ctx.allUnits) funit = 'true';
  const fc = await query(
    prisma,
    `SELECT f.item_id::text, i.code AS item_code, i.name AS item_name, f.month, sum(f.qty)::text AS qty FROM demand_forecasts f JOIN items i ON i.id=f.item_id WHERE ${funit} GROUP BY 1,2,3,4 ORDER BY 4,2`,
    ...fargs,
  );
  const key = (r: Row) => `${S(r.item_id)}|${S(r.month)}`;
  const m = new Map<
    string,
    {
      itemId: string;
      itemCode: string;
      itemName: string;
      month: string;
      confirmed: ReturnType<typeof D>;
      forecast: ReturnType<typeof D>;
    }
  >();
  for (const r of orders)
    m.set(key(r), {
      itemId: S(r.item_id),
      itemCode: S(r.item_code),
      itemName: S(r.item_name),
      month: S(r.month),
      confirmed: D(S(r.qty)),
      forecast: ZERO,
    });
  for (const r of fc) {
    const cur = m.get(key(r)) ?? {
      itemId: S(r.item_id),
      itemCode: S(r.item_code),
      itemName: S(r.item_name),
      month: S(r.month),
      confirmed: ZERO,
      forecast: ZERO,
    };
    cur.forecast = D(S(r.qty));
    m.set(key(r), cur);
  }
  return [...m.values()]
    .filter((x) => (!q.from || x.month >= q.from) && (!q.to || x.month <= q.to))
    .sort((a, b) => a.month.localeCompare(b.month) || a.itemCode.localeCompare(b.itemCode))
    .map((x) => ({
      ...x,
      confirmed: str(x.confirmed),
      forecast: str(x.forecast),
      total: str(x.confirmed.plus(x.forecast)),
    }));
}

export const forecastService = {
  async upsert(
    caller: Caller,
    b: {
      itemId: string;
      month: string;
      qty: string;
      customerId?: string | null;
      notes?: string | null;
    },
  ) {
    const unitId = concreteUnit(caller);
    await exec(
      prisma,
      `INSERT INTO demand_forecasts (unit_id, item_id, customer_id, month, qty, notes, created_by_id) VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5::numeric,$6,$7::uuid)
        ON CONFLICT (unit_id, item_id, month, COALESCE(customer_id,'00000000-0000-0000-0000-000000000000'::uuid)) DO UPDATE SET qty=EXCLUDED.qty, notes=EXCLUDED.notes, version=demand_forecasts.version+1`,
      unitId,
      b.itemId,
      b.customerId ?? null,
      b.month,
      b.qty,
      b.notes ?? null,
      caller.auth.userId,
    );
    return { ok: true };
  },
  async list(caller: Caller) {
    const rows = await query(
      prisma,
      `SELECT f.*, i.code AS item_code FROM demand_forecasts f JOIN items i ON i.id=f.item_id WHERE ($1::uuid IS NULL OR f.unit_id=$1::uuid) ORDER BY f.month, i.code LIMIT 500`,
      caller.ctx.unitId ?? null,
    );
    return rows.map((r) => norm<Row>(r));
  },
};

export { todayIst };
