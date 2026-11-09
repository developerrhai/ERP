// Phase 12 generic quality forms on the same template engine: 8D, quality alert, minutes of meeting and continuous
// improvement (SQDCPE). The template says which fields exist and which must be filled before the form can be closed.
import { prisma } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { NumberingService } from '../../core/numbering';
import type { Caller } from '../records/service';
import {
  TX,
  audit,
  checkVersion,
  exec,
  fyOfCaller,
  insertRow,
  norm,
  query,
  scopeSql,
  todayIst,
} from '../procurement/core';
import type { Row } from '../procurement/core';
import { headerErrors } from './logic';
import type { HeaderField } from './logic';
import { S, headerLabels, resolveTemplate } from './inspection-service';

export type FormKind = 'EIGHT_D' | 'ALERT' | 'MOM' | 'CI';
export const FORM_KINDS: FormKind[] = ['EIGHT_D', 'ALERT', 'MOM', 'CI'];
export const PAGE_OF_FORM: Record<FormKind, string> = {
  EIGHT_D: 'qms-capa',
  CI: 'qms-capa',
  MOM: 'qms-capa',
  ALERT: 'qms-ncr',
};
const PREFIX: Record<FormKind, string> = { EIGHT_D: '8D', ALERT: 'QA', MOM: 'MOM', CI: 'CI' };

const SELECT = `SELECT t.*, i.name AS item_name, c.name AS customer_name, s.name AS supplier_name
  FROM qms_forms t LEFT JOIN items i ON i.id=t.item_id LEFT JOIN customers c ON c.id=t.customer_id LEFT JOIN suppliers s ON s.id=t.supplier_id`;

/** customer / supplier / item named inside the form values */
function refsOf(fields: HeaderField[], data: Record<string, unknown>) {
  const pick = (t: string): string | null => {
    const f = fields.find((x) => x.type === t);
    const v = f ? S(data[f.key]).trim() : '';
    return v === '' ? null : v;
  };
  return { customerId: pick('customer'), supplierId: pick('supplier'), itemId: pick('item') };
}

export interface FormInput {
  kind: FormKind;
  title: string;
  docDate?: string | undefined;
  data: Record<string, unknown>;
  capaRef?: string | undefined;
  customerId?: string | undefined;
  supplierId?: string | undefined;
  itemId?: string | undefined;
}

export const formsService = {
  async list(
    caller: Caller,
    pageId: string,
    q: {
      kind: FormKind;
      status?: string | undefined;
      q?: string | undefined;
      page: number;
      size: number;
    },
  ) {
    const sc = await scopeSql(caller, pageId);
    const args = [...sc.args, q.kind];
    const where = [sc.sql, `t.kind=$${args.length}`];
    if (q.status) {
      args.push(q.status);
      where.push(`t.status=$${args.length}`);
    }
    if (q.q) {
      args.push(`%${q.q}%`);
      where.push(`(t.number ILIKE $${args.length} OR t.title ILIKE $${args.length})`);
    }
    const w = where.join(' AND ');
    const total = Number(
      (await query(prisma, `SELECT count(*)::int AS n FROM qms_forms t WHERE ${w}`, ...args))[0]!.n,
    );
    const rows = await query(
      prisma,
      `${SELECT} WHERE ${w} ORDER BY t.doc_date DESC, t.created_at DESC LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size}`,
      ...args,
    );
    return {
      rows: rows.map((r) => ({ ...norm(r), data: undefined, templateSnapshot: undefined })),
      total,
    };
  },
  async get(caller: Caller, pageId: string, id: string): Promise<Row> {
    const sc = await scopeSql(caller, pageId);
    const r = (
      await query(
        prisma,
        `${SELECT} WHERE t.id=$${sc.args.length + 1}::uuid AND ${sc.sql}`,
        ...sc.args,
        id,
      )
    )[0];
    if (!r) throw Errors.notFound('Form not found.');
    const out = norm(r);
    out.headerLabels = await headerLabels(
      prisma,
      (r.template_snapshot as { headerFields: HeaderField[] }).headerFields,
      r.data as Record<string, unknown>,
    );
    return out;
  },
  async kindOf(id: string): Promise<FormKind> {
    const r = (
      await query(prisma, `SELECT kind FROM qms_forms WHERE id=$1::uuid AND deleted_at IS NULL`, id)
    )[0];
    if (!r) throw Errors.notFound('Form not found.');
    return S(r.kind) as FormKind;
  },
  async create(caller: Caller, pageId: string, input: FormInput): Promise<Row> {
    const unitId = caller.ctx.unitId;
    if (!unitId) throw Errors.validation({ unit: 'Choose one unit in the top bar first.' });
    const fy = await fyOfCaller(caller);
    const id = await prisma.$transaction(async (tx) => {
      const tpl0 = await resolveTemplate(tx, input.kind, input.customerId ?? null, unitId);
      const fields = tpl0.header_fields as HeaderField[];
      const errs = headerErrors(fields, input.data);
      if (Object.keys(errs).length) throw Errors.validation(errs);
      const refs = refsOf(fields, input.data);
      const customerId = input.customerId ?? refs.customerId;
      const supplierId = input.supplierId ?? refs.supplierId;
      const itemId = input.itemId ?? refs.itemId;
      for (const [t, v, label] of [
        ['customers', customerId, 'customer'],
        ['suppliers', supplierId, 'supplier'],
        ['items', itemId, 'item'],
      ] as const)
        if (v && !(await query(tx, `SELECT 1 FROM ${t} WHERE id=$1::uuid`, v))[0])
          throw Errors.validation({ [label]: `This ${label} does not exist.` });
      const no = await NumberingService.allocate(tx, {
        pageId: `qms:${input.kind}`,
        unitId,
        fyId: fy.id,
        prefix: PREFIX[input.kind],
      });
      const nid = await insertRow(tx, 'qms_forms', {
        unitId,
        fyId: fy.id,
        number: no,
        kind: input.kind,
        status: 'Open',
        title: input.title,
        docDate: input.docDate ?? todayIst(),
        templateId: S(tpl0.id),
        templateSnapshot: {
          code: tpl0.code,
          name: tpl0.name,
          version: tpl0.version,
          headerFields: fields,
          closeRequires: tpl0.close_requires,
        },
        customerId,
        supplierId,
        itemId,
        data: input.data,
        capaRef: input.capaRef ?? null,
        createdById: caller.auth.userId,
        updatedById: caller.auth.userId,
      });
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'QMS_FORM_CREATED',
        'qms_form',
        { id: nid, code: no },
        pageId,
        { kind: input.kind },
      );
      return nid;
    }, TX);
    return this.get(caller, pageId, id);
  },
  async update(
    caller: Caller,
    pageId: string,
    id: string,
    ifMatch: number,
    b: {
      title?: string | undefined;
      docDate?: string | undefined;
      data?: Record<string, unknown> | undefined;
      capaRef?: string | undefined;
    },
  ): Promise<Row> {
    const sc = await scopeSql(caller, pageId);
    await prisma.$transaction(async (tx) => {
      const cur = (
        await query(
          tx,
          `SELECT t.* FROM qms_forms t WHERE t.id=$${sc.args.length + 1}::uuid AND ${sc.sql} FOR UPDATE OF t`,
          ...sc.args,
          id,
        )
      )[0];
      if (!cur) throw Errors.notFound('Form not found.');
      checkVersion(cur, ifMatch);
      if (S(cur.status) !== 'Open') throw Errors.conflict('Only an open form can be edited.');
      const snap = cur.template_snapshot as { headerFields: HeaderField[] };
      const data = b.data ?? (cur.data as Record<string, unknown>);
      const errs = headerErrors(snap.headerFields, data);
      if (Object.keys(errs).length) throw Errors.validation(errs);
      const refs = refsOf(snap.headerFields, data);
      await exec(
        tx,
        `UPDATE qms_forms SET title=COALESCE($1,title), doc_date=COALESCE($2::date,doc_date), data=$3::jsonb, capa_ref=COALESCE($4,capa_ref),
           customer_id=COALESCE($5::uuid,customer_id), supplier_id=COALESCE($6::uuid,supplier_id), item_id=COALESCE($7::uuid,item_id),
           updated_by_id=$8::uuid, updated_at=now(), version=version+1 WHERE id=$9::uuid`,
        b.title ?? null,
        b.docDate ?? null,
        JSON.stringify(data),
        b.capaRef ?? null,
        refs.customerId,
        refs.supplierId,
        refs.itemId,
        caller.auth.userId,
        id,
      );
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'QMS_FORM_UPDATED',
        'qms_form',
        { id, code: S(cur.number) },
        pageId,
      );
    }, TX);
    return this.get(caller, pageId, id);
  },
  /** Closing needs the fields the template lists, and for an 8D the CAPA reference. */
  async close(
    caller: Caller,
    pageId: string,
    id: string,
    ifMatch: number,
    note?: string,
  ): Promise<Row> {
    const sc = await scopeSql(caller, pageId);
    await prisma.$transaction(async (tx) => {
      const cur = (
        await query(
          tx,
          `SELECT t.* FROM qms_forms t WHERE t.id=$${sc.args.length + 1}::uuid AND ${sc.sql} FOR UPDATE OF t`,
          ...sc.args,
          id,
        )
      )[0];
      if (!cur) throw Errors.notFound('Form not found.');
      checkVersion(cur, ifMatch);
      if (S(cur.status) !== 'Open') throw Errors.conflict('Only an open form can be closed.');
      const snap = cur.template_snapshot as {
        headerFields: HeaderField[];
        closeRequires: string[];
      };
      const data = cur.data as Record<string, unknown>;
      const errs: Record<string, string> = {};
      for (const k of snap.closeRequires ?? []) {
        if (S(data[k]).trim() === '')
          errs[k] =
            `Fill in ${snap.headerFields.find((f) => f.key === k)?.label.toLowerCase() ?? k} before closing.`;
      }
      if (S(cur.kind) === 'EIGHT_D' && !S(cur.capa_ref).trim())
        errs.capaRef = 'Enter the CAPA reference before closing the 8D.';
      if (Object.keys(errs).length) throw Errors.validation(errs);
      await exec(
        tx,
        `UPDATE qms_forms SET status='Closed', closed_at=now(), close_note=$1, updated_by_id=$2::uuid, updated_at=now(), version=version+1 WHERE id=$3::uuid`,
        note ?? null,
        caller.auth.userId,
        id,
      );
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'QMS_FORM_CLOSED',
        'qms_form',
        { id, code: S(cur.number) },
        pageId,
      );
    }, TX);
    return this.get(caller, pageId, id);
  },
  async cancel(caller: Caller, pageId: string, id: string, reason: string): Promise<Row> {
    const sc = await scopeSql(caller, pageId);
    await prisma.$transaction(async (tx) => {
      const cur = (
        await query(
          tx,
          `SELECT t.* FROM qms_forms t WHERE t.id=$${sc.args.length + 1}::uuid AND ${sc.sql} FOR UPDATE OF t`,
          ...sc.args,
          id,
        )
      )[0];
      if (!cur) throw Errors.notFound('Form not found.');
      if (S(cur.status) !== 'Open') throw Errors.conflict('Only an open form can be cancelled.');
      await exec(
        tx,
        `UPDATE qms_forms SET status='Cancelled', cancelled_at=now(), cancel_reason=$1, updated_by_id=$2::uuid, updated_at=now(), version=version+1 WHERE id=$3::uuid`,
        reason,
        caller.auth.userId,
        id,
      );
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'QMS_FORM_CANCELLED',
        'qms_form',
        { id, code: S(cur.number) },
        pageId,
        { reason },
      );
    }, TX);
    return this.get(caller, pageId, id);
  },
};
