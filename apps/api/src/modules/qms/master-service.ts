// Phase 12 form templates (versioned data, R-16/R-17) and inspection plans. Publishing a template retires the active
// version of the same (type, customer, unit) and adds the next one; documents keep the snapshot they were made with.
import { prisma } from '../../core/db/prisma';
import { AppError, Errors } from '../../core/http/errors';
import type { Caller } from '../records/service';
import { TX, audit, checkVersion, insertRow, norm, query } from '../procurement/core';
import type { Row } from '../procurement/core';
import type { HeaderField } from './logic';
import { S } from './inspection-service';

export const TEMPLATE_KINDS = [
  'INCOMING',
  'IN_PROCESS',
  'PRE_DISPATCH',
  'ISIR',
  'WELDING',
  'VT',
  'EIGHT_D',
  'ALERT',
  'MOM',
  'CI',
] as const;
const FORM_KINDS = new Set(['EIGHT_D', 'ALERT', 'MOM', 'CI']);

export interface TemplateInput {
  kind: (typeof TEMPLATE_KINDS)[number];
  name: string;
  customerId?: string | undefined;
  headerFields: HeaderField[];
  rowConfig?: Record<string, unknown> | undefined;
  closeRequires?: string[] | undefined;
  reason: string;
}

export const masterService = {
  async listTemplates(kind?: string, status?: string) {
    const rows = await query(
      prisma,
      `SELECT t.*, c.name AS customer_name, u.name AS unit_name FROM qms_templates t
         LEFT JOIN customers c ON c.id=t.customer_id LEFT JOIN units u ON u.id=t.unit_id
        WHERE ($1::text IS NULL OR t.kind=$1) AND ($2::text IS NULL OR t.status=$2)
        ORDER BY t.kind, t.status, (t.customer_id IS NOT NULL), t.code, t.version DESC`,
      kind ?? null,
      status ?? null,
    );
    return rows.map((r) => norm(r));
  },
  async getTemplate(id: string) {
    const r = (await query(prisma, `SELECT * FROM qms_templates WHERE id=$1::uuid`, id))[0];
    if (!r) throw Errors.notFound('Template not found.');
    return norm(r);
  },
  /** The template a new sheet of this type would use for this customer (what the screen re-renders on customer change). */
  async resolve(kind: string, customerId: string | null, unitId: string | null) {
    const t = (
      await query(
        prisma,
        `SELECT * FROM qms_templates WHERE kind=$1 AND status='ACTIVE' AND (customer_id IS NULL OR customer_id=$2::uuid) AND (unit_id IS NULL OR unit_id=$3::uuid)
         ORDER BY (customer_id IS NOT NULL) DESC, (unit_id IS NOT NULL) DESC LIMIT 1`,
        kind,
        customerId,
        unitId,
      )
    )[0];
    if (!t) throw Errors.notFound('There is no active form template for this type.');
    return norm(t);
  },
  async publishTemplate(caller: Caller, pageId: string, input: TemplateInput) {
    const keys = new Set<string>();
    for (const f of input.headerFields) {
      if (keys.has(f.key))
        throw Errors.validation({ headerFields: `The field key "${f.key}" is used twice.` });
      keys.add(f.key);
      if (f.type === 'select' && !(f.options ?? []).length)
        throw Errors.validation({
          headerFields: `"${f.label}" is a choice field: give its options.`,
        });
    }
    const unknown = (input.closeRequires ?? []).find((k) => !keys.has(k));
    if (unknown)
      throw Errors.validation({ closeRequires: `"${unknown}" is not a field of this form.` });
    const family = FORM_KINDS.has(input.kind) ? 'FORM' : 'INSPECTION';
    const id = await prisma.$transaction(async (tx) => {
      if (
        input.customerId &&
        !(await query(tx, `SELECT 1 FROM customers WHERE id=$1::uuid`, input.customerId))[0]
      )
        throw Errors.validation({ customerId: 'This customer does not exist.' });
      const cust = input.customerId ?? null;
      const cur = (
        await query(
          tx,
          `SELECT * FROM qms_templates WHERE kind=$1 AND status='ACTIVE' AND customer_id IS NOT DISTINCT FROM $2::uuid AND unit_id IS NULL FOR UPDATE`,
          input.kind,
          cust,
        )
      )[0];
      const code = cur
        ? S(cur.code)
        : cust
          ? `TPL-${input.kind}-${S((await query(tx, `SELECT code FROM customers WHERE id=$1::uuid`, cust))[0]?.code)}`.slice(
              0,
              30,
            )
          : `TPL-${input.kind}`;
      const ver = Number(
        (
          await query(
            tx,
            `SELECT COALESCE(max(version),0)+1 AS v FROM qms_templates WHERE code=$1`,
            code,
          )
        )[0]!.v,
      );
      if (cur)
        await tx.$executeRawUnsafe(
          `UPDATE qms_templates SET status='RETIRED' WHERE id=$1::uuid`,
          S(cur.id),
        );
      const nid = await insertRow(tx, 'qms_templates', {
        code,
        family,
        kind: input.kind,
        name: input.name,
        customerId: cust,
        version: ver,
        status: 'ACTIVE',
        headerFields: JSON.stringify(input.headerFields),
        rowConfig: input.rowConfig ?? (cur?.row_config as object | undefined) ?? {},
        closeRequires: JSON.stringify(input.closeRequires ?? []),
        changeReason: input.reason,
        createdById: caller.auth.userId,
      });
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'QMS_TEMPLATE_PUBLISHED',
        'qms_template',
        { id: nid, code },
        pageId,
        { version: ver, reason: input.reason },
      );
      return nid;
    }, TX);
    return this.getTemplate(id);
  },

  // ------------------------------------------------------------------ plans
  async listPlans(kind?: string, itemId?: string, status?: string) {
    const rows = await query(
      prisma,
      `SELECT p.*, i.name AS item_name, c.name AS customer_name FROM qms_plans p LEFT JOIN items i ON i.id=p.item_id LEFT JOIN customers c ON c.id=p.customer_id
        WHERE ($1::text IS NULL OR p.kind=$1) AND ($2::uuid IS NULL OR p.item_id=$2::uuid) AND ($3::text IS NULL OR p.status=$3) ORDER BY p.kind, p.code`,
      kind ?? null,
      itemId ?? null,
      status ?? null,
    );
    return rows.map((r) => norm(r));
  },
  async getPlan(id: string) {
    const r = (
      await query(
        prisma,
        `SELECT p.*, i.name AS item_name FROM qms_plans p LEFT JOIN items i ON i.id=p.item_id WHERE p.id=$1::uuid`,
        id,
      )
    )[0];
    if (!r) throw Errors.notFound('Inspection plan not found.');
    return norm(r);
  },
  async createPlan(
    caller: Caller,
    pageId: string,
    b: {
      code: string;
      name: string;
      kind: string;
      itemId?: string | undefined;
      customerId?: string | undefined;
      characteristics: Row[];
      notes?: string | undefined;
    },
  ) {
    checkChars(b.characteristics);
    const id = await prisma.$transaction(async (tx) => {
      if ((await query(tx, `SELECT 1 FROM qms_plans WHERE code=$1`, b.code))[0])
        throw new AppError(409, 'CONFLICT', `Plan code ${b.code} is already used.`);
      await refsOk(tx, b.itemId, b.customerId);
      const nid = await insertRow(tx, 'qms_plans', {
        code: b.code,
        name: b.name,
        kind: b.kind,
        itemId: b.itemId ?? null,
        customerId: b.customerId ?? null,
        characteristics: JSON.stringify(b.characteristics),
        notes: b.notes ?? null,
        createdById: caller.auth.userId,
        updatedById: caller.auth.userId,
      });
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'QMS_PLAN_CREATED',
        'qms_plan',
        { id: nid, code: b.code },
        pageId,
      );
      return nid;
    }, TX);
    return this.getPlan(id);
  },
  async updatePlan(
    caller: Caller,
    pageId: string,
    id: string,
    ifMatch: number,
    b: {
      name?: string | undefined;
      itemId?: string | null | undefined;
      customerId?: string | null | undefined;
      characteristics?: Row[] | undefined;
      status?: 'ACTIVE' | 'INACTIVE' | undefined;
      notes?: string | undefined;
    },
  ) {
    if (b.characteristics) checkChars(b.characteristics);
    await prisma.$transaction(async (tx) => {
      const cur = (await query(tx, `SELECT * FROM qms_plans WHERE id=$1::uuid FOR UPDATE`, id))[0];
      if (!cur) throw Errors.notFound('Inspection plan not found.');
      checkVersion(cur, ifMatch);
      await refsOk(tx, b.itemId ?? undefined, b.customerId ?? undefined);
      await tx.$executeRawUnsafe(
        `UPDATE qms_plans SET name=COALESCE($1,name), item_id=CASE WHEN $2::boolean THEN $3::uuid ELSE item_id END, customer_id=CASE WHEN $4::boolean THEN $5::uuid ELSE customer_id END,
           characteristics=COALESCE($6::jsonb, characteristics), status=COALESCE($7,status), notes=COALESCE($8,notes), version=version+1, updated_at=now(), updated_by_id=$9::uuid WHERE id=$10::uuid`,
        b.name ?? null,
        b.itemId !== undefined,
        b.itemId ?? null,
        b.customerId !== undefined,
        b.customerId ?? null,
        b.characteristics ? JSON.stringify(b.characteristics) : null,
        b.status ?? null,
        b.notes ?? null,
        caller.auth.userId,
        id,
      );
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'QMS_PLAN_UPDATED',
        'qms_plan',
        { id, code: S(cur.code) },
        pageId,
      );
    }, TX);
    return this.getPlan(id);
  },
};

async function refsOk(db: Parameters<typeof query>[0], itemId?: string, customerId?: string) {
  if (itemId && !(await query(db, `SELECT 1 FROM items WHERE id=$1::uuid`, itemId))[0])
    throw Errors.validation({ itemId: 'This item does not exist.' });
  if (customerId && !(await query(db, `SELECT 1 FROM customers WHERE id=$1::uuid`, customerId))[0])
    throw Errors.validation({ customerId: 'This customer does not exist.' });
}
function checkChars(list: Row[]): void {
  const errs: Record<string, string> = {};
  list.forEach((c, i) => {
    if (!S(c.name).trim()) errs[`characteristics.${i}.name`] = 'Name the characteristic.';
    const lsl = c.lsl === null || c.lsl === undefined || c.lsl === '' ? null : Number(c.lsl);
    const usl = c.usl === null || c.usl === undefined || c.usl === '' ? null : Number(c.usl);
    if ((lsl !== null && Number.isNaN(lsl)) || (usl !== null && Number.isNaN(usl)))
      errs[`characteristics.${i}.lsl`] = 'Limits must be numbers.';
    else if (lsl !== null && usl !== null && lsl > usl)
      errs[`characteristics.${i}.lsl`] = 'The lower limit is above the upper limit.';
  });
  if (Object.keys(errs).length) throw Errors.validation(errs);
}
