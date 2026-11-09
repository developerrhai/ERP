// Phase 14 fixed-asset documents: capitalisation (AS 10 cost, CWIP -> asset), allocation, transfer (inter-unit posts both sides),
// disposal (gain / loss, GST on sale, s.18(6) memo), depreciation runs (BOOK posts to the GL, TAX is a memo on IT-Act blocks),
// QR scans and physical verification. Every rupee goes through the PostingService; documents are never edited after posting.
import { Errors } from '../../core/http/errors';
import { prisma } from '../../core/db/prisma';
import type { Db } from '../../core/db/prisma';
import { NumberingService } from '../../core/numbering';
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
import type { Caller } from '../records/service';
import { costing, fallbackCostCentre } from '../mfg/costing-service';
import { S, oneUnit } from '../mfg/master-service';
import { assetService } from './asset-service';
import {
  D,
  MAX_RESIDUAL_PCT,
  blockDepreciation,
  bookDepreciation,
  capitalCost,
  addDays,
  daysIncl,
  gainLoss,
  isHalfRate,
  monthBounds,
  r2,
  s18_6,
  shiftFactor,
} from './calc';

const NO = {
  CAP: 'asset:CAP',
  ALC: 'asset:ALC',
  TRF: 'asset:TRF',
  DSP: 'asset:DSP',
  DEP: 'asset:DEP',
  PV: 'asset:PV',
} as const;
const nextNo = (tx: Db, unitId: string, fyId: string, k: keyof typeof NO) =>
  NumberingService.allocate(tx, { pageId: NO[k], unitId, fyId, prefix: k });

async function accountOk(code: string, field: string): Promise<void> {
  if (
    !(
      await query(
        prisma,
        `SELECT 1 FROM accounts WHERE code=$1 AND posting_allowed AND NOT party_required`,
        code,
      )
    ).length
  )
    throw Errors.validation({
      [field]: `Account ${code} does not exist, does not take postings, or needs a customer or supplier. Choose a bank, cash or other ledger account.`,
    });
}

const page = (q: { page: number; size: number }) =>
  `LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size}`;

/** The Schedule II parameters of a category that apply on a date. */
async function paramsAt(db: Db, categoryId: string, date: string): Promise<Row> {
  const p = (
    await query(
      db,
      `SELECT * FROM asset_category_book_params WHERE category_id=$1::uuid AND effective_from <= $2::date AND (effective_to IS NULL OR effective_to >= $2::date) ORDER BY effective_from DESC LIMIT 1`,
      categoryId,
      date,
    )
  )[0];
  if (!p)
    throw Errors.validation({
      categoryId: 'This category has no depreciation parameters for that date.',
    });
  return p;
}

export const faService = {
  // ---------------------------------------------------------------------------------------------- capitalisation
  async listCap(
    caller: Caller,
    pageId: string,
    q: { status?: string | undefined; assetId?: string | undefined; page: number; size: number },
  ) {
    const sc = await scopeSql(caller, pageId);
    const args = [...sc.args];
    const where = [sc.sql];
    for (const [c, v] of [
      [`t.status=?`, q.status],
      [`t.asset_id=?::uuid`, q.assetId],
    ] as const)
      if (v) {
        args.push(v);
        where.push(c.replace('?', `$${args.length}`));
      }
    const w = where.join(' AND ');
    const total = Number(
      (
        await query(
          prisma,
          `SELECT count(*)::int AS n FROM asset_capitalisations t WHERE ${w}`,
          ...args,
        )
      )[0]!.n,
    );
    const rows = await query(
      prisma,
      `SELECT t.*, a.asset_no, a.name AS asset_name FROM asset_capitalisations t JOIN assets a ON a.id=t.asset_id WHERE ${w} ORDER BY t.created_at DESC ${page(q)}`,
      ...args,
    );
    return { rows: rows.map((r) => norm<Row>(r)), total };
  },

  async getCap(caller: Caller, pageId: string, id: string): Promise<Row> {
    const sc = await scopeSql(caller, pageId);
    const c = (
      await query(
        prisma,
        `SELECT t.*, a.asset_no, a.name AS asset_name, a.category_id::text AS category_id FROM asset_capitalisations t JOIN assets a ON a.id=t.asset_id WHERE t.id=$${sc.args.length + 1}::uuid AND ${sc.sql}`,
        ...sc.args,
        id,
      )
    )[0];
    if (!c) throw Errors.notFound('Capitalisation not found.');
    const lines = await query(
      prisma,
      `SELECT * FROM asset_cap_cost_lines WHERE cap_id=$1::uuid ORDER BY component`,
      id,
    );
    return { ...norm<Row>(c), lines: lines.map((l) => norm<Row>(l)) };
  },

  async createCap(
    caller: Caller,
    pageId: string,
    b: {
      assetId: string;
      capitalisationDate: string;
      source: 'PURCHASE' | 'CWIP' | 'OPENING_IMPORT';
      lines: {
        component: 'BASE' | 'FREIGHT' | 'INSTALLATION' | 'TESTING' | 'PROF_FEE' | 'OTHER';
        sourceDocRef?: string | undefined;
        amount: string | number;
        glSourceAccount: string;
        gstAmount?: string | number | undefined;
        gstAddedToCost?: boolean | undefined;
      }[];
      residualOverridePct?: string | number | undefined;
      residualJustification?: string | undefined;
    },
  ): Promise<Row> {
    const unitId = oneUnit(caller);
    const fy = await fyOfCaller(caller);
    const a = (
      await query(
        prisma,
        `SELECT a.*, c.itc_eligible FROM assets a JOIN asset_categories c ON c.id=a.category_id WHERE a.id=$1::uuid AND a.deleted_at IS NULL`,
        b.assetId,
      )
    )[0];
    if (!a || S(a.unit_id) !== unitId)
      throw Errors.validation({ assetId: 'Choose an asset of this unit.' });
    if (S(a.status) !== 'CWIP')
      throw Errors.validation({
        assetId: 'Only an asset still in capital work in progress can be capitalised.',
      });
    if (
      (
        await query(
          prisma,
          `SELECT 1 FROM asset_capitalisations WHERE asset_id=$1::uuid AND status <> 'CANCELLED' AND deleted_at IS NULL`,
          b.assetId,
        )
      ).length
    )
      throw Errors.conflict('This asset already has a capitalisation.');
    if (!b.lines.length) throw Errors.validation({ lines: 'Add the cost lines.' });
    for (const [i, l] of b.lines.entries()) {
      if (D(String(l.amount)).lte(0))
        throw Errors.validation({ [`lines.${i}.amount`]: 'Enter an amount greater than 0.' });
      await accountOk(l.glSourceAccount, `lines.${i}.glSourceAccount`);
    }
    if (
      b.residualOverridePct !== undefined &&
      Number(b.residualOverridePct) > MAX_RESIDUAL_PCT &&
      !(b.residualJustification && b.residualJustification.trim().length >= 10)
    )
      throw Errors.validation({
        residualJustification:
          'A residual value above 5 % of cost needs a written reason (at least 10 characters).',
      });
    const cost = capitalCost(
      b.lines.map((l) => ({
        component: l.component,
        amount: l.amount,
        gst: l.gstAmount ?? 0,
        gstInCost: l.gstAddedToCost ?? false,
      })),
      a.itc_eligible === true,
    );
    const id = await prisma.$transaction(async (tx) => {
      const no = await nextNo(tx, unitId, fy.id, 'CAP');
      const cid = await insertRow(tx, 'asset_capitalisations', {
        unitId,
        fyId: fy.id,
        capNo: no,
        assetId: b.assetId,
        capitalisationDate: b.capitalisationDate,
        source: b.source,
        totalCost: cost.cost.toFixed(2),
        residualOverridePct:
          b.residualOverridePct === undefined ? null : D(String(b.residualOverridePct)).toFixed(4),
        residualJustification: b.residualJustification?.slice(0, 300) ?? null,
        createdById: caller.auth.userId,
        updatedById: caller.auth.userId,
      });
      for (const l of b.lines)
        await insertRow(tx, 'asset_cap_cost_lines', {
          capId: cid,
          component: l.component,
          sourceDocRef: l.sourceDocRef ?? null,
          amount: D(String(l.amount)).toFixed(2),
          glSourceAccount: l.glSourceAccount,
          gstAmount: D(String(l.gstAmount ?? 0)).toFixed(2),
          gstAddedToCost: l.gstAddedToCost ?? false,
        });
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'ASSET_CAP_CREATED',
        'asset_capitalisation',
        { id: cid, code: no },
        pageId,
        {},
      );
      return cid;
    }, TX);
    return faService.getCap(caller, pageId, id);
  },

  async submitCap(
    caller: Caller,
    pageId: string,
    id: string,
    version: number | undefined,
  ): Promise<Row> {
    return docStep(
      'asset_capitalisations',
      'asset_capitalisation',
      caller,
      pageId,
      id,
      version,
      'DRAFT',
      ['DRAFT', 'REJECTED'],
      `approval_status='PENDING'`,
      'ASSET_CAP_SUBMITTED',
      () => faService.getCap(caller, pageId, id),
    );
  },
  async approveCap(
    caller: Caller,
    pageId: string,
    id: string,
    version: number | undefined,
    approve: boolean,
  ): Promise<Row> {
    return approveStep(
      'asset_capitalisations',
      'asset_capitalisation',
      caller,
      pageId,
      id,
      version,
      approve,
      () => faService.getCap(caller, pageId, id),
    );
  },

  /** Posting: Dr the asset account (or CWIP is cleared) / Cr the source accounts; the book and tax profiles are set from the category. */
  async postCap(
    caller: Caller,
    pageId: string,
    id: string,
    version: number | undefined,
  ): Promise<Row> {
    await prisma.$transaction(async (tx) => {
      const c = await lockDoc(tx, caller, 'asset_capitalisations', id);
      checkVersion(norm<Row>(c), version);
      if (S(c.status) !== 'DRAFT' || S(c.approval_status) !== 'APPROVED')
        throw Errors.conflict('Approve the capitalisation before posting it.');
      const a = (
        await query(
          tx,
          `SELECT a.*, c.asset_class, c.asset_account, c.nesd, c.id AS cat_id FROM assets a JOIN asset_categories c ON c.id=a.category_id WHERE a.id=$1::uuid FOR UPDATE OF a`,
          S(c.asset_id),
        )
      )[0]!;
      if (S(a.status) !== 'CWIP')
        throw Errors.conflict('The asset is no longer in capital work in progress.');
      const lines = await query(tx, `SELECT * FROM asset_cap_cost_lines WHERE cap_id=$1::uuid`, id);
      const date = S(c.capitalisation_date).slice(0, 10);
      const cost = D(S(c.total_cost));
      const jl: { accountCode: string; debit: string; credit: string; costCenterId?: string }[] = [
        { accountCode: S(a.asset_account), debit: cost.toFixed(2), credit: '0' },
      ];
      const by = new Map<string, ReturnType<typeof D>>();
      for (const l of lines) {
        const gstIn = l.gst_added_to_cost === true ? D(S(l.gst_amount)) : D(0);
        by.set(
          S(l.gl_source_account),
          (by.get(S(l.gl_source_account)) ?? D(0)).plus(S(l.amount)).plus(gstIn),
        );
      }
      // GST that is not claimed because the category blocks it is part of the cost too
      const cat = (
        await query(tx, `SELECT itc_eligible FROM asset_categories WHERE id=$1::uuid`, S(a.cat_id))
      )[0]!;
      if (cat.itc_eligible !== true)
        for (const l of lines)
          if (l.gst_added_to_cost !== true && D(S(l.gst_amount)).gt(0))
            by.set(
              S(l.gl_source_account),
              (by.get(S(l.gl_source_account)) ?? D(0)).plus(S(l.gst_amount)),
            );
      let credits = D(0);
      for (const [code, amt] of by) {
        jl.push({ accountCode: code, debit: '0', credit: r2(amt).toFixed(2) });
        credits = credits.plus(r2(amt));
      }
      if (!credits.eq(cost))
        throw Errors.conflict('The cost lines do not add up to the asset cost.');
      const journal = await costing.journal(tx, caller, {
        unitId: S(c.unit_id),
        date,
        narration: `Capitalisation ${S(c.cap_no)}`,
        docType: 'asset_capitalisation',
        docId: id,
        docNo: S(c.cap_no),
        lines: jl,
      });
      const prm = await paramsAt(tx, S(a.cat_id), date);
      const pct =
        c.residual_override_pct !== null ? D(S(c.residual_override_pct)) : D(S(prm.residual_pct));
      const residual = r2(cost.mul(pct).div(100));
      await exec(
        tx,
        `INSERT INTO asset_book_profile (asset_id, area, method, life_months, residual_amount, dep_start_date, cost, accum_dep) VALUES ($1::uuid,'BOOK',$2,$3,$4::numeric,$5::date,$6::numeric,0)
         ON CONFLICT (asset_id, area) DO UPDATE SET method=EXCLUDED.method, life_months=EXCLUDED.life_months, residual_amount=EXCLUDED.residual_amount, dep_start_date=EXCLUDED.dep_start_date, cost=EXCLUDED.cost, accum_dep=0, last_dep_date=NULL, updated_at=now()`,
        S(a.id),
        S(prm.method),
        Number(prm.useful_life_months),
        residual.toFixed(2),
        date,
        cost.toFixed(2),
      );
      if (a.it_block_id) {
        const rate = (
          await query(
            tx,
            `SELECT rate_pct::text FROM it_block_rates WHERE block_id=$1::uuid AND effective_from <= $2::date ORDER BY effective_from DESC LIMIT 1`,
            S(a.it_block_id),
            date,
          )
        )[0];
        await exec(
          tx,
          `INSERT INTO asset_book_profile (asset_id, area, method, rate_pct, dep_start_date, cost) VALUES ($1::uuid,'TAX','WDV',$2::numeric,$3::date,$4::numeric)
           ON CONFLICT (asset_id, area) DO UPDATE SET rate_pct=EXCLUDED.rate_pct, dep_start_date=EXCLUDED.dep_start_date, cost=EXCLUDED.cost, updated_at=now()`,
          S(a.id),
          rate ? S(rate.rate_pct) : null,
          date,
          cost.toFixed(2),
        );
      }
      await exec(
        tx,
        `UPDATE assets SET status='ACTIVE', put_to_use_date=$1::date, commission_date=COALESCE(commission_date,$1::date), updated_at=now(), version=version+1 WHERE id=$2::uuid`,
        date,
        S(a.id),
      );
      await exec(
        tx,
        `UPDATE asset_capitalisations SET status='POSTED', journal_id=$1::uuid, updated_by_id=$2::uuid, updated_at=now(), version=version+1 WHERE id=$3::uuid`,
        journal.id,
        caller.auth.userId,
        id,
      );
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'ASSET_CAP_POSTED',
        'asset_capitalisation',
        { id, code: S(c.cap_no) },
        pageId,
        { cost: cost.toFixed(2) },
      );
    }, TX);
    return faService.getCap(caller, pageId, id);
  },

  async cancelCap(
    caller: Caller,
    pageId: string,
    id: string,
    version: number | undefined,
    reason: string,
  ): Promise<Row> {
    await prisma.$transaction(async (tx) => {
      const c = await lockDoc(tx, caller, 'asset_capitalisations', id);
      checkVersion(norm<Row>(c), version);
      if (S(c.status) === 'CANCELLED') throw Errors.conflict('Already cancelled.');
      if (S(c.status) === 'POSTED') {
        const p = (
          await query(
            tx,
            `SELECT accum_dep::text FROM asset_book_profile WHERE asset_id=$1::uuid AND area='BOOK' FOR UPDATE`,
            S(c.asset_id),
          )
        )[0];
        if (p && D(S(p.accum_dep)).gt(0))
          throw Errors.conflict('Depreciation has been posted on this asset: reverse it first.');
        if (
          (
            await query(
              tx,
              `SELECT 1 FROM asset_disposals WHERE asset_id=$1::uuid AND status='POSTED'`,
              S(c.asset_id),
            )
          ).length
        )
          throw Errors.conflict('The asset has been disposed.');
        if (c.journal_id)
          await costing.reverseJournal(tx, caller, S(c.journal_id), reason, todayIst());
        await exec(
          tx,
          `UPDATE asset_book_profile SET cost=0, accum_dep=0, last_dep_date=NULL, updated_at=now() WHERE asset_id=$1::uuid`,
          S(c.asset_id),
        );
        await exec(
          tx,
          `UPDATE assets SET status='CWIP', updated_at=now(), version=version+1 WHERE id=$1::uuid`,
          S(c.asset_id),
        );
      }
      await exec(
        tx,
        `UPDATE asset_capitalisations SET status='CANCELLED', updated_by_id=$1::uuid, updated_at=now(), version=version+1 WHERE id=$2::uuid`,
        caller.auth.userId,
        id,
      );
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'ASSET_CAP_CANCELLED',
        'asset_capitalisation',
        { id, code: S(c.cap_no) },
        pageId,
        { reason },
      );
    }, TX);
    return faService.getCap(caller, pageId, id);
  },

  // ---------------------------------------------------------------------------------------------- allocation
  async listAlloc(
    caller: Caller,
    pageId: string,
    q: { status?: string | undefined; assetId?: string | undefined; page: number; size: number },
  ) {
    const sc = await scopeSql(caller, pageId);
    const args = [...sc.args];
    const where = [sc.sql];
    for (const [c, v] of [
      [`t.status=?`, q.status],
      [`t.asset_id=?::uuid`, q.assetId],
    ] as const)
      if (v) {
        args.push(v);
        where.push(c.replace('?', `$${args.length}`));
      }
    const w = where.join(' AND ');
    const total = Number(
      (
        await query(
          prisma,
          `SELECT count(*)::int AS n FROM asset_allocations t WHERE ${w}`,
          ...args,
        )
      )[0]!.n,
    );
    const rows = await query(
      prisma,
      `SELECT t.*, a.asset_no, a.name AS asset_name, u.name AS employee_name FROM asset_allocations t JOIN assets a ON a.id=t.asset_id LEFT JOIN users u ON u.id=t.employee_id WHERE ${w} ORDER BY t.created_at DESC ${page(q)}`,
      ...args,
    );
    return { rows: rows.map((r) => norm<Row>(r)), total };
  },

  async allocate(
    caller: Caller,
    pageId: string,
    b: {
      assetId: string;
      employeeId?: string | undefined;
      department?: string | undefined;
      location?: string | undefined;
      allocatedOn?: string | undefined;
      conditionOut?: string | undefined;
      handoverDoc?: string | undefined;
      returnDue?: string | undefined;
    },
  ): Promise<Row> {
    const unitId = oneUnit(caller);
    const fy = await fyOfCaller(caller);
    const a = (
      await query(
        prisma,
        `SELECT unit_id::text, status FROM assets WHERE id=$1::uuid AND deleted_at IS NULL`,
        b.assetId,
      )
    )[0];
    if (!a || S(a.unit_id) !== unitId)
      throw Errors.validation({ assetId: 'Choose an asset of this unit.' });
    if (!['ACTIVE', 'IDLE'].includes(S(a.status)))
      throw Errors.validation({ assetId: 'Only an asset in service can be handed over.' });
    if (!b.employeeId && !b.department && !b.location)
      throw Errors.validation({ employeeId: 'Choose who or where the asset is handed to.' });
    if (
      (
        await query(
          prisma,
          `SELECT 1 FROM asset_allocations WHERE asset_id=$1::uuid AND status='ALLOCATED' AND deleted_at IS NULL`,
          b.assetId,
        )
      ).length
    )
      throw Errors.conflict('This asset is already allocated: take it back first.');
    const id = await prisma.$transaction(async (tx) => {
      const no = await nextNo(tx, unitId, fy.id, 'ALC');
      const aid = await insertRow(tx, 'asset_allocations', {
        unitId,
        allocNo: no,
        assetId: b.assetId,
        employeeId: b.employeeId ?? null,
        department: b.department ?? null,
        location: b.location ?? null,
        allocatedOn: b.allocatedOn ?? todayIst(),
        conditionOut: b.conditionOut ?? null,
        handoverDoc: b.handoverDoc ?? null,
        returnDue: b.returnDue ?? null,
        createdById: caller.auth.userId,
        updatedById: caller.auth.userId,
      });
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'ASSET_ALLOCATED',
        'asset_allocation',
        { id: aid, code: no },
        pageId,
        {},
      );
      return aid;
    }, TX);
    return norm<Row>(
      (await query(prisma, `SELECT * FROM asset_allocations WHERE id=$1::uuid`, id))[0]!,
    );
  },

  async returnAlloc(
    caller: Caller,
    pageId: string,
    id: string,
    b: { returnedOn?: string | undefined; conditionIn?: string | undefined },
  ): Promise<Row> {
    const sc = await scopeSql(caller, pageId);
    const r = (
      await query(
        prisma,
        `SELECT t.* FROM asset_allocations t WHERE t.id=$${sc.args.length + 1}::uuid AND ${sc.sql}`,
        ...sc.args,
        id,
      )
    )[0];
    if (!r) throw Errors.notFound('Allocation not found.');
    if (S(r.status) !== 'ALLOCATED') throw Errors.conflict('This asset was already taken back.');
    const on = b.returnedOn ?? todayIst();
    if (on < S(r.allocated_on).slice(0, 10))
      throw Errors.validation({ returnedOn: 'The return cannot be before the hand-over.' });
    await exec(
      prisma,
      `UPDATE asset_allocations SET status='RETURNED', returned_on=$1::date, condition_in=$2, updated_by_id=$3::uuid, updated_at=now(), version=version+1 WHERE id=$4::uuid`,
      on,
      b.conditionIn ?? null,
      caller.auth.userId,
      id,
    );
    await audit(
      prisma,
      caller,
      caller.auth.userId,
      'ASSET_RETURNED',
      'asset_allocation',
      { id, code: S(r.alloc_no) },
      pageId,
      {},
    );
    return norm<Row>(
      (await query(prisma, `SELECT * FROM asset_allocations WHERE id=$1::uuid`, id))[0]!,
    );
  },

  // ---------------------------------------------------------------------------------------------- transfer
  async listTransfers(
    caller: Caller,
    pageId: string,
    q: { status?: string | undefined; page: number; size: number },
  ) {
    const sc = await scopeSql(caller, pageId);
    const args = [...sc.args];
    const where = [sc.sql];
    if (q.status) {
      args.push(q.status);
      where.push(`t.status=$${args.length}`);
    }
    const w = where.join(' AND ');
    const total = Number(
      (
        await query(prisma, `SELECT count(*)::int AS n FROM asset_transfers t WHERE ${w}`, ...args)
      )[0]!.n,
    );
    const rows = await query(
      prisma,
      `SELECT t.*, a.asset_no, a.name AS asset_name, f.name AS from_unit, u.name AS to_unit FROM asset_transfers t JOIN assets a ON a.id=t.asset_id JOIN units f ON f.id=t.from_unit_id JOIN units u ON u.id=t.to_unit_id WHERE ${w} ORDER BY t.created_at DESC ${page(q)}`,
      ...args,
    );
    return { rows: rows.map((r) => norm<Row>(r)), total };
  },

  async getTransfer(caller: Caller, pageId: string, id: string): Promise<Row> {
    const sc = await scopeSql(caller, pageId);
    const r = (
      await query(
        prisma,
        `SELECT t.*, a.asset_no, a.name AS asset_name FROM asset_transfers t JOIN assets a ON a.id=t.asset_id WHERE t.id=$${sc.args.length + 1}::uuid AND ${sc.sql}`,
        ...sc.args,
        id,
      )
    )[0];
    if (!r) throw Errors.notFound('Transfer not found.');
    return norm<Row>(r);
  },

  async createTransfer(
    caller: Caller,
    pageId: string,
    b: {
      assetId: string;
      toUnitId?: string | undefined;
      toLocation?: string | undefined;
      toEmployeeId?: string | undefined;
      toCostCentreId?: string | undefined;
      condition?: string | undefined;
    },
  ): Promise<Row> {
    const unitId = oneUnit(caller);
    const fy = await fyOfCaller(caller);
    const a = (
      await query(
        prisma,
        `SELECT unit_id::text, status FROM assets WHERE id=$1::uuid AND deleted_at IS NULL`,
        b.assetId,
      )
    )[0];
    if (!a || S(a.unit_id) !== unitId)
      throw Errors.validation({ assetId: 'Choose an asset of this unit.' });
    if (!['ACTIVE', 'IDLE'].includes(S(a.status)))
      throw Errors.validation({ assetId: 'Only an asset in service can be transferred.' });
    const to = b.toUnitId ?? unitId;
    if (!(await query(prisma, `SELECT 1 FROM units WHERE id=$1::uuid`, to)).length)
      throw Errors.validation({ toUnitId: 'Unit not found.' });
    if (to === unitId && !b.toLocation && !b.toEmployeeId && !b.toCostCentreId)
      throw Errors.validation({ toLocation: 'Say where the asset goes.' });
    const id = await prisma.$transaction(async (tx) => {
      const no = await nextNo(tx, unitId, fy.id, 'TRF');
      const tid = await insertRow(tx, 'asset_transfers', {
        unitId,
        fyId: fy.id,
        trNo: no,
        assetId: b.assetId,
        fromUnitId: unitId,
        toUnitId: to,
        toLocation: b.toLocation ?? null,
        toEmployeeId: b.toEmployeeId ?? null,
        toCostCentreId: b.toCostCentreId ?? null,
        condition: b.condition ?? null,
        createdById: caller.auth.userId,
        updatedById: caller.auth.userId,
      });
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'ASSET_TRANSFER_CREATED',
        'asset_transfer',
        { id: tid, code: no },
        pageId,
        {},
      );
      return tid;
    }, TX);
    return faService.getTransfer(caller, pageId, id);
  },

  async submitTransfer(
    caller: Caller,
    pageId: string,
    id: string,
    version: number | undefined,
  ): Promise<Row> {
    return docStep(
      'asset_transfers',
      'asset_transfer',
      caller,
      pageId,
      id,
      version,
      'DRAFT',
      ['DRAFT', 'REJECTED'],
      `approval_status='PENDING'`,
      'ASSET_TRANSFER_SUBMITTED',
      () => faService.getTransfer(caller, pageId, id),
    );
  },
  async approveTransfer(
    caller: Caller,
    pageId: string,
    id: string,
    version: number | undefined,
    approve: boolean,
  ): Promise<Row> {
    return approveStep(
      'asset_transfers',
      'asset_transfer',
      caller,
      pageId,
      id,
      version,
      approve,
      () => faService.getTransfer(caller, pageId, id),
    );
  },

  /** A move inside a unit changes the record; a move between units posts both sides through the inter-unit clearing account. */
  async completeTransfer(
    caller: Caller,
    pageId: string,
    id: string,
    version: number | undefined,
    b: { verifiedById?: string | undefined; transferDate?: string | undefined },
  ): Promise<Row> {
    await prisma.$transaction(async (tx) => {
      const t = await lockDoc(tx, caller, 'asset_transfers', id);
      checkVersion(norm<Row>(t), version);
      if (S(t.status) !== 'DRAFT' || S(t.approval_status) !== 'APPROVED')
        throw Errors.conflict('Approve the transfer first.');
      const a = (
        await query(
          tx,
          `SELECT a.*, c.asset_account, c.accum_dep_account FROM assets a JOIN asset_categories c ON c.id=a.category_id WHERE a.id=$1::uuid FOR UPDATE OF a`,
          S(t.asset_id),
        )
      )[0]!;
      if (!['ACTIVE', 'IDLE'].includes(S(a.status)) || S(a.unit_id) !== S(t.from_unit_id))
        throw Errors.conflict('The asset is no longer where the transfer expects it.');
      if (b.verifiedById && b.verifiedById === S(t.created_by_id))
        throw Errors.conflict(
          'The receiving side must be verified by someone other than the requester.',
        );
      const date = b.transferDate ?? todayIst();
      let outJ: string | null = null;
      let inJ: string | null = null;
      if (S(t.to_unit_id) !== S(t.from_unit_id)) {
        const p = (
          await query(
            tx,
            `SELECT cost::text, accum_dep::text FROM asset_book_profile WHERE asset_id=$1::uuid AND area='BOOK' FOR UPDATE`,
            S(a.id),
          )
        )[0];
        const cost = D(S(p?.cost ?? 0));
        const acc = D(S(p?.accum_dep ?? 0));
        const nbv = cost.minus(acc);
        if (cost.gt(0)) {
          const clearing = '1308';
          const accCode = S(a.accum_dep_account) || S(a.asset_account);
          const lines = (sign: 'out' | 'in') => [
            {
              accountCode: S(a.asset_account),
              debit: sign === 'in' ? cost.toFixed(2) : '0',
              credit: sign === 'out' ? cost.toFixed(2) : '0',
            },
            ...(acc.gt(0)
              ? [
                  {
                    accountCode: accCode,
                    debit: sign === 'out' ? acc.toFixed(2) : '0',
                    credit: sign === 'in' ? acc.toFixed(2) : '0',
                  },
                ]
              : []),
            ...(nbv.gt(0)
              ? [
                  {
                    accountCode: clearing,
                    debit: sign === 'out' ? nbv.toFixed(2) : '0',
                    credit: sign === 'in' ? nbv.toFixed(2) : '0',
                  },
                ]
              : []),
          ];
          outJ = (
            await costing.journal(tx, caller, {
              unitId: S(t.from_unit_id),
              date,
              narration: `Asset ${S(a.asset_no)} transferred out (${S(t.tr_no)})`,
              docType: 'asset_transfer',
              docId: id,
              docNo: `${S(t.tr_no)}-OUT`,
              lines: lines('out'),
            })
          ).id;
          inJ = (
            await costing.journal(tx, caller, {
              unitId: S(t.to_unit_id),
              date,
              narration: `Asset ${S(a.asset_no)} transferred in (${S(t.tr_no)})`,
              docType: 'asset_transfer',
              docId: id,
              docNo: `${S(t.tr_no)}-IN`,
              lines: lines('in'),
            })
          ).id;
        }
        await exec(
          tx,
          `UPDATE assets SET unit_id=$1::uuid WHERE id=$2::uuid`,
          S(t.to_unit_id),
          S(a.id),
        );
        // the PM plans and open loans follow the asset to its new unit
        await exec(
          tx,
          `UPDATE pm_plans SET unit_id=$1::uuid WHERE asset_id=$2::uuid`,
          S(t.to_unit_id),
          S(a.id),
        );
        await exec(
          tx,
          `UPDATE asset_allocations SET unit_id=$1::uuid WHERE asset_id=$2::uuid AND status='ALLOCATED'`,
          S(t.to_unit_id),
          S(a.id),
        );
      }
      await exec(
        tx,
        `UPDATE assets SET location=COALESCE($1,location), cost_centre_id=COALESCE($2::uuid,cost_centre_id), updated_at=now(), version=version+1 WHERE id=$3::uuid`,
        t.to_location ?? null,
        t.to_cost_centre_id ? S(t.to_cost_centre_id) : null,
        S(a.id),
      );
      await exec(
        tx,
        `UPDATE asset_transfers SET status='COMPLETED', transfer_date=$1::date, verified_by_id=$2::uuid, journal_out_id=$3::uuid, journal_in_id=$4::uuid, updated_by_id=$5::uuid, updated_at=now(), version=version+1 WHERE id=$6::uuid`,
        date,
        b.verifiedById ?? null,
        outJ,
        inJ,
        caller.auth.userId,
        id,
      );
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'ASSET_TRANSFER_COMPLETED',
        'asset_transfer',
        { id, code: S(t.tr_no) },
        pageId,
        {},
      );
    }, TX);
    return faService.getTransfer(caller, pageId, id);
  },

  async cancelTransfer(
    caller: Caller,
    pageId: string,
    id: string,
    version: number | undefined,
  ): Promise<Row> {
    await prisma.$transaction(async (tx) => {
      const t = await lockDoc(tx, caller, 'asset_transfers', id);
      checkVersion(norm<Row>(t), version);
      if (S(t.status) !== 'DRAFT')
        throw Errors.conflict('A completed transfer cannot be cancelled: make a transfer back.');
      await exec(
        tx,
        `UPDATE asset_transfers SET status='CANCELLED', updated_at=now(), version=version+1 WHERE id=$1::uuid`,
        id,
      );
    }, TX);
    return faService.getTransfer(caller, pageId, id);
  },

  // ---------------------------------------------------------------------------------------------- disposal
  async listDisposals(
    caller: Caller,
    pageId: string,
    q: { status?: string | undefined; page: number; size: number },
  ) {
    const sc = await scopeSql(caller, pageId);
    const args = [...sc.args];
    const where = [sc.sql];
    if (q.status) {
      args.push(q.status);
      where.push(`t.status=$${args.length}`);
    }
    const w = where.join(' AND ');
    const total = Number(
      (
        await query(prisma, `SELECT count(*)::int AS n FROM asset_disposals t WHERE ${w}`, ...args)
      )[0]!.n,
    );
    const rows = await query(
      prisma,
      `SELECT t.*, a.asset_no, a.name AS asset_name FROM asset_disposals t JOIN assets a ON a.id=t.asset_id WHERE ${w} ORDER BY t.created_at DESC ${page(q)}`,
      ...args,
    );
    return { rows: rows.map((r) => norm<Row>(r)), total };
  },

  async getDisposal(caller: Caller, pageId: string, id: string): Promise<Row> {
    const sc = await scopeSql(caller, pageId);
    const r = (
      await query(
        prisma,
        `SELECT t.*, a.asset_no, a.name AS asset_name FROM asset_disposals t JOIN assets a ON a.id=t.asset_id WHERE t.id=$${sc.args.length + 1}::uuid AND ${sc.sql}`,
        ...sc.args,
        id,
      )
    )[0];
    if (!r) throw Errors.notFound('Disposal not found.');
    return norm<Row>(r);
  },

  async createDisposal(
    caller: Caller,
    pageId: string,
    b: {
      assetId: string;
      method: 'SALE' | 'SCRAP' | 'WRITE_OFF' | 'DONATION';
      disposalDate?: string | undefined;
      buyer?: string | undefined;
      saleValue?: string | number | undefined;
      gstOnSale?: string | number | undefined;
      gstIntraState?: boolean | undefined;
      proceedsAccount?: string | undefined;
      itcTaken?: string | number | undefined;
      quartersUsed?: number | undefined;
    },
  ): Promise<Row> {
    const unitId = oneUnit(caller);
    const fy = await fyOfCaller(caller);
    const a = (
      await query(
        prisma,
        `SELECT unit_id::text, status FROM assets WHERE id=$1::uuid AND deleted_at IS NULL`,
        b.assetId,
      )
    )[0];
    if (!a || S(a.unit_id) !== unitId)
      throw Errors.validation({ assetId: 'Choose an asset of this unit.' });
    if (!['ACTIVE', 'IDLE', 'UNDER_MAINT'].includes(S(a.status)))
      throw Errors.validation({ assetId: 'Only a capitalised asset can be disposed.' });
    if (
      (
        await query(
          prisma,
          `SELECT 1 FROM asset_disposals WHERE asset_id=$1::uuid AND status <> 'CANCELLED' AND deleted_at IS NULL`,
          b.assetId,
        )
      ).length
    )
      throw Errors.conflict('This asset already has a disposal.');
    if (
      (
        await query(
          prisma,
          `SELECT 1 FROM assets WHERE parent_asset_id=$1::uuid AND status <> 'DISPOSED' AND deleted_at IS NULL LIMIT 1`,
          b.assetId,
        )
      ).length
    )
      throw Errors.conflict('Dispose of the component assets first.');
    const sale = D(String(b.saleValue ?? 0));
    if (b.method === 'DONATION' || b.method === 'WRITE_OFF') {
      if (sale.gt(0))
        throw Errors.validation({ saleValue: 'A write-off or donation has no sale value.' });
    }
    if (sale.gt(0) && !b.proceedsAccount)
      throw Errors.validation({
        proceedsAccount: 'Choose the account the money goes to (bank, cash or a debtor).',
      });
    if (b.proceedsAccount) await accountOk(b.proceedsAccount, 'proceedsAccount');
    const gst = D(String(b.gstOnSale ?? 0));
    const calc =
      b.method === 'SALE' && D(String(b.itcTaken ?? 0)).gt(0)
        ? s18_6({ itc: String(b.itcTaken), quarters: b.quartersUsed ?? 0, taxOnSale: gst })
        : null;
    const id = await prisma.$transaction(async (tx) => {
      const no = await nextNo(tx, unitId, fy.id, 'DSP');
      const did = await insertRow(tx, 'asset_disposals', {
        unitId,
        fyId: fy.id,
        dispNo: no,
        assetId: b.assetId,
        method: b.method,
        disposalDate: b.disposalDate ?? todayIst(),
        buyer: b.buyer ?? null,
        saleValue: sale.toFixed(2),
        gstOnSale: gst.toFixed(2),
        gstIntraState: b.gstIntraState ?? true,
        proceedsAccount: b.proceedsAccount ?? null,
        itcTaken: D(String(b.itcTaken ?? 0)).toFixed(2),
        quartersUsed: b.quartersUsed ?? 0,
        createdById: caller.auth.userId,
        updatedById: caller.auth.userId,
      });
      if (calc)
        await exec(
          tx,
          `UPDATE asset_disposals SET s18_6_calc=$1::numeric, s18_6_payable_extra=$2::numeric WHERE id=$3::uuid`,
          calc.payable.toFixed(2),
          calc.extra.toFixed(2),
          did,
        );
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'ASSET_DISPOSAL_CREATED',
        'asset_disposal',
        { id: did, code: no },
        pageId,
        {},
      );
      return did;
    }, TX);
    return faService.getDisposal(caller, pageId, id);
  },

  async submitDisposal(
    caller: Caller,
    pageId: string,
    id: string,
    version: number | undefined,
  ): Promise<Row> {
    return docStep(
      'asset_disposals',
      'asset_disposal',
      caller,
      pageId,
      id,
      version,
      'DRAFT',
      ['DRAFT', 'REJECTED'],
      `approval_status='PENDING'`,
      'ASSET_DISPOSAL_SUBMITTED',
      () => faService.getDisposal(caller, pageId, id),
    );
  },
  async approveDisposal(
    caller: Caller,
    pageId: string,
    id: string,
    version: number | undefined,
    approve: boolean,
  ): Promise<Row> {
    return approveStep(
      'asset_disposals',
      'asset_disposal',
      caller,
      pageId,
      id,
      version,
      approve,
      () => faService.getDisposal(caller, pageId, id),
    );
  },

  async postDisposal(
    caller: Caller,
    pageId: string,
    id: string,
    version: number | undefined,
  ): Promise<Row> {
    await prisma.$transaction(async (tx) => {
      const d = await lockDoc(tx, caller, 'asset_disposals', id);
      checkVersion(norm<Row>(d), version);
      if (S(d.status) !== 'DRAFT' || S(d.approval_status) !== 'APPROVED')
        throw Errors.conflict('Approve the disposal before posting it.');
      const a = (
        await query(
          tx,
          `SELECT a.*, c.asset_account, c.accum_dep_account FROM assets a JOIN asset_categories c ON c.id=a.category_id WHERE a.id=$1::uuid FOR UPDATE OF a`,
          S(d.asset_id),
        )
      )[0]!;
      if (!['ACTIVE', 'IDLE', 'UNDER_MAINT'].includes(S(a.status)))
        throw Errors.conflict('The asset cannot be disposed in its present state.');
      const p = (
        await query(
          tx,
          `SELECT cost::text, accum_dep::text FROM asset_book_profile WHERE asset_id=$1::uuid AND area='BOOK' FOR UPDATE`,
          S(a.id),
        )
      )[0];
      const cost = D(S(p?.cost ?? 0));
      const acc = D(S(p?.accum_dep ?? 0));
      const nbv = cost.minus(acc);
      const sale = D(S(d.sale_value));
      const gst = D(S(d.gst_on_sale));
      const gl = gainLoss(sale, nbv);
      const date = S(d.disposal_date).slice(0, 10);
      const cc = await fallbackCostCentre(tx, S(d.unit_id));
      const lines: { accountCode: string; debit: string; credit: string; costCenterId?: string }[] =
        [];
      if (cost.gt(0))
        lines.push({ accountCode: S(a.asset_account), debit: '0', credit: cost.toFixed(2) });
      if (acc.gt(0))
        lines.push({
          accountCode: S(a.accum_dep_account) || S(a.asset_account),
          debit: acc.toFixed(2),
          credit: '0',
        });
      if (sale.gt(0) || gst.gt(0))
        lines.push({
          accountCode: S(d.proceeds_account),
          debit: sale.plus(gst).toFixed(2),
          credit: '0',
        });
      if (gst.gt(0)) {
        const half = r2(gst.div(2));
        if (d.gst_intra_state === true) {
          lines.push({ accountCode: '2301', debit: '0', credit: half.toFixed(2) });
          lines.push({ accountCode: '2302', debit: '0', credit: gst.minus(half).toFixed(2) });
        } else lines.push({ accountCode: '2303', debit: '0', credit: gst.toFixed(2) });
      }
      if (gl.gt(0)) lines.push({ accountCode: '4203', debit: '0', credit: gl.toFixed(2) });
      if (gl.lt(0))
        lines.push({
          accountCode: '6262',
          debit: gl.abs().toFixed(2),
          credit: '0',
          costCenterId: cc,
        });
      let journalId: string | null = null;
      if (lines.length)
        journalId = (
          await costing.journal(tx, caller, {
            unitId: S(d.unit_id),
            date,
            narration: `Disposal ${S(d.disp_no)} of ${S(a.asset_no)}`,
            docType: 'asset_disposal',
            docId: id,
            docNo: S(d.disp_no),
            lines,
          })
        ).id;
      await exec(
        tx,
        `UPDATE asset_book_profile SET frozen=true, updated_at=now() WHERE asset_id=$1::uuid`,
        S(a.id),
      );
      await exec(
        tx,
        `UPDATE assets SET status='DISPOSED', updated_at=now(), version=version+1 WHERE id=$1::uuid`,
        S(a.id),
      );
      await exec(
        tx,
        `UPDATE asset_disposals SET status='POSTED', nbv_at_disposal=$1::numeric, gain_loss=$2::numeric, journal_id=$3::uuid, updated_by_id=$4::uuid, updated_at=now(), version=version+1 WHERE id=$5::uuid`,
        nbv.toFixed(2),
        gl.toFixed(2),
        journalId,
        caller.auth.userId,
        id,
      );
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'ASSET_DISPOSAL_POSTED',
        'asset_disposal',
        { id, code: S(d.disp_no) },
        pageId,
        { nbv: nbv.toFixed(2), gainLoss: gl.toFixed(2) },
      );
    }, TX);
    return faService.getDisposal(caller, pageId, id);
  },

  async cancelDisposal(
    caller: Caller,
    pageId: string,
    id: string,
    version: number | undefined,
    reason: string,
  ): Promise<Row> {
    await prisma.$transaction(async (tx) => {
      const d = await lockDoc(tx, caller, 'asset_disposals', id);
      checkVersion(norm<Row>(d), version);
      if (S(d.status) === 'CANCELLED') throw Errors.conflict('Already cancelled.');
      if (S(d.status) === 'POSTED') {
        if (d.journal_id)
          await costing.reverseJournal(tx, caller, S(d.journal_id), reason, todayIst());
        await exec(
          tx,
          `UPDATE asset_book_profile SET frozen=false, updated_at=now() WHERE asset_id=$1::uuid`,
          S(d.asset_id),
        );
        await exec(
          tx,
          `UPDATE assets SET status='ACTIVE', updated_at=now(), version=version+1 WHERE id=$1::uuid`,
          S(d.asset_id),
        );
      }
      await exec(
        tx,
        `UPDATE asset_disposals SET status='CANCELLED', updated_by_id=$1::uuid, updated_at=now(), version=version+1 WHERE id=$2::uuid`,
        caller.auth.userId,
        id,
      );
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'ASSET_DISPOSAL_CANCELLED',
        'asset_disposal',
        { id, code: S(d.disp_no) },
        pageId,
        { reason },
      );
    }, TX);
    return faService.getDisposal(caller, pageId, id);
  },

  /** Placeholders of the spec: tables exist, the methods are not in scope. */
  revalue(): Promise<never> {
    return Promise.reject(
      Errors.validation({
        revaluation: 'NOT_IN_SCOPE: revaluation is not built in this phase.',
      }),
    );
  },
  impair(): Promise<never> {
    return Promise.reject(
      Errors.validation({ impairment: 'NOT_IN_SCOPE: impairment is not built in this phase.' }),
    );
  },

  // ---------------------------------------------------------------------------------------------- shift usage
  async saveShiftUsage(
    caller: Caller,
    pageId: string,
    b: {
      assetId: string;
      period: string;
      singleDays: number;
      doubleDays: number;
      tripleDays: number;
    },
  ): Promise<Row> {
    await assetService.get(caller, pageId, b.assetId);
    if (b.singleDays + b.doubleDays + b.tripleDays > monthDays(b.period))
      throw Errors.validation({ singleDays: 'The days add up to more than the month has.' });
    await exec(
      prisma,
      `INSERT INTO asset_shift_usage (asset_id, period, single_days, double_days, triple_days) VALUES ($1::uuid,$2,$3,$4,$5)
       ON CONFLICT (asset_id, period) DO UPDATE SET single_days=EXCLUDED.single_days, double_days=EXCLUDED.double_days, triple_days=EXCLUDED.triple_days`,
      b.assetId,
      b.period,
      b.singleDays,
      b.doubleDays,
      b.tripleDays,
    );
    return norm<Row>(
      (
        await query(
          prisma,
          `SELECT * FROM asset_shift_usage WHERE asset_id=$1::uuid AND period=$2`,
          b.assetId,
          b.period,
        )
      )[0]!,
    );
  },

  // ---------------------------------------------------------------------------------------------- depreciation
  async listRuns(
    caller: Caller,
    pageId: string,
    q: { area?: string | undefined; status?: string | undefined; page: number; size: number },
  ) {
    const sc = await scopeSql(caller, pageId, 't');
    const args = [...sc.args];
    const where = [sc.sql.replace('t.created_by_id', 't.run_by_id')];
    for (const [c, v] of [
      [`t.area=?`, q.area],
      [`t.status=?`, q.status],
    ] as const)
      if (v) {
        args.push(v);
        where.push(c.replace('?', `$${args.length}`));
      }
    const w = where.join(' AND ');
    const total = Number(
      (
        await query(
          prisma,
          `SELECT count(*)::int AS n FROM depreciation_runs t WHERE ${w}`,
          ...args,
        )
      )[0]!.n,
    );
    const rows = await query(
      prisma,
      `SELECT t.* FROM depreciation_runs t WHERE ${w} ORDER BY t.created_at DESC ${page(q)}`,
      ...args,
    );
    return { rows: rows.map((r) => norm<Row>(r)), total };
  },

  async getRun(caller: Caller, pageId: string, id: string): Promise<Row> {
    const sc = await scopeSql(caller, pageId);
    const r = (
      await query(
        prisma,
        `SELECT t.* FROM depreciation_runs t WHERE t.id=$${sc.args.length + 1}::uuid AND ${sc.sql.replace('t.created_by_id', 't.run_by_id')}`,
        ...sc.args,
        id,
      )
    )[0];
    if (!r) throw Errors.notFound('Depreciation run not found.');
    const lines = await query(
      prisma,
      `SELECT l.*, a.asset_no, a.name AS asset_name, b.code AS block_code FROM depreciation_run_lines l LEFT JOIN assets a ON a.id=l.asset_id LEFT JOIN it_blocks b ON b.id=l.block_id WHERE l.run_id=$1::uuid ORDER BY a.asset_no, b.code`,
      id,
    );
    return { ...norm<Row>(r), lines: lines.map((l) => norm<Row>(l)) };
  },

  /** Computes a DRAFT run. BOOK: one line per asset for the month. TAX: one line per IT block for the financial year. */
  async createRun(
    caller: Caller,
    pageId: string,
    b: {
      area: 'BOOK' | 'TAX';
      period?: string | undefined;
      openings?: Record<string, string | number> | undefined;
    },
  ): Promise<Row> {
    const unitId = oneUnit(caller);
    const fy = await fyOfCaller(caller);
    const period = b.area === 'BOOK' ? b.period : fy.code;
    if (b.area === 'BOOK' && !(period && /^\d{4}-\d{2}$/.test(period)))
      throw Errors.validation({ period: 'Choose the month (YYYY-MM).' });
    if (b.area === 'BOOK' && monthBounds(period!).to > todayIst())
      throw Errors.validation({ period: 'Depreciation is run after the month has ended.' });
    if (
      b.area === 'BOOK' &&
      (
        await query(
          prisma,
          `SELECT 1 FROM depreciation_runs WHERE area='BOOK' AND unit_id=$1::uuid AND period > $2 AND status <> 'REVERSED' AND deleted_at IS NULL LIMIT 1`,
          unitId,
          period!,
        )
      ).length
    )
      throw Errors.conflict(
        'A later month has already been run. Reverse it first, or run the months in order.',
      );
    if (
      b.area === 'BOOK' &&
      (period! < fy.code.slice(0, 4) + '-04' || period! > `${Number(fy.code.slice(0, 4)) + 1}-03`)
    )
      throw Errors.validation({
        period: 'The month is outside the financial year chosen at the top.',
      });
    if (
      (
        await query(
          prisma,
          `SELECT 1 FROM depreciation_runs WHERE area=$1 AND unit_id=$2::uuid AND period=$3 AND status <> 'REVERSED' AND deleted_at IS NULL`,
          b.area,
          unitId,
          period!,
        )
      ).length
    )
      throw Errors.conflict('A run for this period already exists. Reverse it to run again.');
    const id = await prisma.$transaction(async (tx) => {
      const no = await nextNo(tx, unitId, fy.id, 'DEP');
      const rid = await insertRow(tx, 'depreciation_runs', {
        unitId,
        fyId: fy.id,
        runNo: no,
        area: b.area,
        period: period!,
        runById: caller.auth.userId,
      });
      const total =
        b.area === 'BOOK'
          ? await computeBook(tx, unitId, rid, period!)
          : await computeTax(tx, unitId, rid, fy.id, fy.code, b.openings ?? {});
      await exec(
        tx,
        `UPDATE depreciation_runs SET total_amount=$1::numeric WHERE id=$2::uuid`,
        total.toFixed(2),
        rid,
      );
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'DEPRECIATION_RUN_CREATED',
        'depreciation_run',
        { id: rid, code: no },
        pageId,
        { area: b.area, period },
      );
      return rid;
    }, TX);
    return faService.getRun(caller, pageId, id);
  },

  async postRun(
    caller: Caller,
    pageId: string,
    id: string,
    version: number | undefined,
  ): Promise<Row> {
    await prisma.$transaction(async (tx) => {
      const r = (
        await query(
          tx,
          `SELECT * FROM depreciation_runs WHERE id=$1::uuid AND deleted_at IS NULL AND unit_id=$2::uuid FOR UPDATE`,
          id,
          oneUnit(caller),
        )
      )[0];
      if (!r) throw Errors.notFound('Depreciation run not found.');
      checkVersion(norm<Row>(r), version);
      if (S(r.status) !== 'DRAFT') throw Errors.conflict('Only a draft run can be posted.');
      const lines = await query(
        tx,
        `SELECT * FROM depreciation_run_lines WHERE run_id=$1::uuid`,
        id,
      );
      if (S(r.area) === 'TAX') {
        await exec(
          tx,
          `UPDATE depreciation_runs SET status='POSTED', posted_at=now(), version=version+1 WHERE id=$1::uuid`,
          id,
        );
        await audit(
          tx,
          caller,
          caller.auth.userId,
          'DEPRECIATION_RUN_POSTED',
          'depreciation_run',
          { id, code: S(r.run_no) },
          pageId,
          { memo: true },
        );
        return;
      }
      const { to } = monthBounds(S(r.period));
      const groups = new Map<
        string,
        { exp: string; acc: string; cc: string; amount: ReturnType<typeof D> }
      >();
      let total = D(0);
      for (const l of lines) {
        const a = (
          await query(
            tx,
            `SELECT a.id::text, a.cost_centre_id::text, c.expense_account, c.accum_dep_account, c.asset_account FROM assets a JOIN asset_categories c ON c.id=a.category_id WHERE a.id=$1::uuid`,
            S(l.asset_id),
          )
        )[0]!;
        const p = (
          await query(
            tx,
            `SELECT accum_dep::text, cost::text, last_dep_date FROM asset_book_profile WHERE asset_id=$1::uuid AND area='BOOK' FOR UPDATE`,
            S(l.asset_id),
          )
        )[0]!;
        if (p.last_dep_date && S(p.last_dep_date).slice(0, 10) >= to)
          throw Errors.conflict(
            'Depreciation of some assets was already posted for this month: recompute the run.',
          );
        const amt = D(S(l.amount));
        if (amt.lte(0)) continue;
        if (D(S(p.accum_dep)).plus(amt).gt(S(p.cost)))
          throw Errors.conflict(
            'Depreciation would exceed the cost of an asset: recompute the run.',
          );
        const cc = S(a.cost_centre_id) || (await fallbackCostCentre(tx, S(r.unit_id)));
        const key = `${S(a.expense_account) || '6241'}|${S(a.accum_dep_account) || S(a.asset_account)}|${cc}`;
        const g = groups.get(key) ?? {
          exp: S(a.expense_account) || '6241',
          acc: S(a.accum_dep_account) || S(a.asset_account),
          cc,
          amount: D(0),
        };
        g.amount = g.amount.plus(amt);
        groups.set(key, g);
        total = total.plus(amt);
        await exec(
          tx,
          `UPDATE asset_book_profile SET accum_dep=accum_dep+$1::numeric, last_dep_date=$2::date, updated_at=now() WHERE asset_id=$3::uuid AND area='BOOK'`,
          amt.toFixed(2),
          to,
          S(l.asset_id),
        );
      }
      let journalId: string | null = null;
      if (groups.size) {
        const jl = [...groups.values()].flatMap((g) => [
          { accountCode: g.exp, debit: g.amount.toFixed(2), credit: '0', costCenterId: g.cc },
          { accountCode: g.acc, debit: '0', credit: g.amount.toFixed(2) },
        ]);
        journalId = (
          await costing.journal(tx, caller, {
            unitId: S(r.unit_id),
            date: to,
            narration: `Depreciation ${S(r.period)} (${S(r.run_no)})`,
            docType: 'depreciation_run',
            docId: id,
            docNo: S(r.run_no),
            lines: jl,
          })
        ).id;
      }
      await exec(
        tx,
        `UPDATE depreciation_runs SET status='POSTED', journal_id=$1::uuid, total_amount=$2::numeric, posted_at=now(), version=version+1 WHERE id=$3::uuid`,
        journalId,
        total.toFixed(2),
        id,
      );
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'DEPRECIATION_RUN_POSTED',
        'depreciation_run',
        { id, code: S(r.run_no) },
        pageId,
        { total: total.toFixed(2) },
      );
    }, TX);
    return faService.getRun(caller, pageId, id);
  },

  async reverseRun(
    caller: Caller,
    pageId: string,
    id: string,
    version: number | undefined,
    reason: string,
  ): Promise<Row> {
    await prisma.$transaction(async (tx) => {
      const r = (
        await query(
          tx,
          `SELECT * FROM depreciation_runs WHERE id=$1::uuid AND deleted_at IS NULL AND unit_id=$2::uuid FOR UPDATE`,
          id,
          oneUnit(caller),
        )
      )[0];
      if (!r) throw Errors.notFound('Depreciation run not found.');
      checkVersion(norm<Row>(r), version);
      if (!['DRAFT', 'POSTED'].includes(S(r.status)))
        throw Errors.conflict('This run is already reversed.');
      if (S(r.status) === 'POSTED' && S(r.area) === 'BOOK') {
        const { from, to } = monthBounds(S(r.period));
        const lines = await query(
          tx,
          `SELECT * FROM depreciation_run_lines WHERE run_id=$1::uuid`,
          id,
        );
        for (const l of lines) {
          const p = (
            await query(
              tx,
              `SELECT last_dep_date FROM asset_book_profile WHERE asset_id=$1::uuid AND area='BOOK' FOR UPDATE`,
              S(l.asset_id),
            )
          )[0]!;
          if (D(S(l.amount)).gt(0) && S(p.last_dep_date).slice(0, 10) !== to)
            throw Errors.conflict(
              'Later depreciation was posted on an asset: reverse the later run first.',
            );
        }
        for (const l of lines)
          if (D(S(l.amount)).gt(0))
            await exec(
              tx,
              `UPDATE asset_book_profile SET accum_dep=accum_dep-$1::numeric, last_dep_date=($2::date - 1), updated_at=now() WHERE asset_id=$3::uuid AND area='BOOK'`,
              S(l.amount),
              from,
              S(l.asset_id),
            );
        if (r.journal_id)
          await costing.reverseJournal(tx, caller, S(r.journal_id), reason, todayIst());
      }
      await exec(
        tx,
        `UPDATE depreciation_runs SET status='REVERSED', version=version+1 WHERE id=$1::uuid`,
        id,
      );
      if (S(r.area) === 'TAX')
        await exec(tx, `DELETE FROM it_block_ledger WHERE run_id=$1::uuid`, id);
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'DEPRECIATION_RUN_REVERSED',
        'depreciation_run',
        { id, code: S(r.run_no) },
        pageId,
        { reason },
      );
    }, TX);
    return faService.getRun(caller, pageId, id);
  },

  async blockLedger(caller: Caller): Promise<Row[]> {
    const rows = await query(
      prisma,
      `SELECT l.*, b.code AS block_code, b.name AS block_name, f.code AS fy_code FROM it_block_ledger l JOIN it_blocks b ON b.id=l.block_id JOIN financial_years f ON f.id=l.fy_id WHERE ($1::uuid IS NULL OR l.unit_id=$1::uuid) ORDER BY f.code DESC, b.code`,
      caller.ctx.unitId ?? null,
    );
    return rows.map((r) => norm<Row>(r));
  },

  // ---------------------------------------------------------------------------------------------- QR and verification
  async scan(
    caller: Caller,
    pageId: string,
    b: {
      token: string;
      purpose?: 'VIEW' | 'VERIFY' | 'BREAKDOWN' | undefined;
      location?: string | undefined;
    },
  ): Promise<Row> {
    const a = (
      await query(
        prisma,
        `SELECT id::text, unit_id::text FROM assets WHERE qr_token=$1 AND deleted_at IS NULL`,
        b.token,
      )
    )[0];
    const ok =
      !!a &&
      (!caller.ctx.unitId || S(a.unit_id) === caller.ctx.unitId) &&
      (caller.ctx.allUnits || !!caller.ctx.unitId);
    await insertRow(prisma, 'asset_scans', {
      assetId: a ? S(a.id) : null,
      token: b.token.slice(0, 40),
      scannedById: caller.auth.userId,
      location: b.location ?? null,
      purpose: b.purpose ?? 'VIEW',
      valid: ok,
    });
    if (!ok) throw Errors.notFound('This label is not recognised in the unit you are working in.');
    return assetService.get(caller, pageId, S(a.id));
  },

  async labelTokens(
    caller: Caller,
    pageId: string,
    ids: string[],
  ): Promise<{ assetNo: string; name: string; token: string }[]> {
    const out: { assetNo: string; name: string; token: string }[] = [];
    for (const id of ids) {
      const a = await assetService.get(caller, pageId, id);
      const prior = (
        await query(
          prisma,
          `SELECT id::text FROM asset_qr_labels WHERE asset_id=$1::uuid ORDER BY printed_at DESC LIMIT 1`,
          id,
        )
      )[0];
      await insertRow(prisma, 'asset_qr_labels', {
        assetId: id,
        token: S(a.qrToken),
        printedById: caller.auth.userId,
        reprintOfId: prior ? S(prior.id) : null,
      });
      out.push({ assetNo: S(a.assetNo), name: S(a.name), token: S(a.qrToken) });
    }
    return out;
  },

  async startVerification(
    caller: Caller,
    pageId: string,
    b: { title: string; location?: string | undefined },
  ): Promise<Row> {
    const unitId = oneUnit(caller);
    const fy = await fyOfCaller(caller);
    const id = await prisma.$transaction(async (tx) => {
      const no = await nextNo(tx, unitId, fy.id, 'PV');
      const pid = await insertRow(tx, 'physical_verifications', {
        unitId,
        pvNo: no,
        title: b.title.trim(),
        createdById: caller.auth.userId,
      });
      await exec(
        tx,
        `INSERT INTO physical_verification_lines (pv_id, asset_id) SELECT $1::uuid, id FROM assets WHERE unit_id=$2::uuid AND deleted_at IS NULL AND status IN ('ACTIVE','IDLE','UNDER_MAINT') AND ($3::text IS NULL OR location=$3)`,
        pid,
        unitId,
        b.location ?? null,
      );
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'PHYSICAL_VERIFICATION_STARTED',
        'physical_verification',
        { id: pid, code: no },
        pageId,
        {},
      );
      return pid;
    }, TX);
    return faService.getVerification(caller, pageId, id);
  },

  async listVerifications(caller: Caller) {
    const rows = await query(
      prisma,
      `SELECT v.*, (SELECT count(*)::int FROM physical_verification_lines l WHERE l.pv_id=v.id) AS total, (SELECT count(*)::int FROM physical_verification_lines l WHERE l.pv_id=v.id AND l.found IS NOT NULL) AS checked, (SELECT count(*)::int FROM physical_verification_lines l WHERE l.pv_id=v.id AND l.found = false) AS missing FROM physical_verifications v WHERE v.deleted_at IS NULL AND ($1::uuid IS NULL OR v.unit_id=$1::uuid) ORDER BY v.created_at DESC LIMIT 100`,
      caller.ctx.unitId ?? null,
    );
    return rows.map((r) => norm<Row>(r));
  },

  async getVerification(caller: Caller, _pageId: string, id: string): Promise<Row> {
    const v = (
      await query(
        prisma,
        `SELECT * FROM physical_verifications WHERE id=$1::uuid AND deleted_at IS NULL AND ($2::uuid IS NULL OR unit_id=$2::uuid)`,
        id,
        caller.ctx.unitId ?? null,
      )
    )[0];
    if (!v) throw Errors.notFound('Verification not found.');
    const lines = await query(
      prisma,
      `SELECT l.*, a.asset_no, a.name AS asset_name, a.location AS book_location FROM physical_verification_lines l JOIN assets a ON a.id=l.asset_id WHERE l.pv_id=$1::uuid ORDER BY a.asset_no`,
      id,
    );
    return { ...norm<Row>(v), lines: lines.map((l) => norm<Row>(l)) };
  },

  async verifyLine(
    caller: Caller,
    pageId: string,
    pvId: string,
    assetId: string,
    b: { found: boolean; condition?: string | undefined; locationFound?: string | undefined },
  ): Promise<Row> {
    const v = await faService.getVerification(caller, pageId, pvId);
    if (S(v.status) !== 'OPEN') throw Errors.conflict('This verification is closed.');
    const n = await exec(
      prisma,
      `UPDATE physical_verification_lines SET found=$1, condition=$2, location_found=$3, checked_at=now(), checked_by_id=$4::uuid WHERE pv_id=$5::uuid AND asset_id=$6::uuid`,
      b.found,
      b.condition ?? null,
      b.locationFound ?? null,
      caller.auth.userId,
      pvId,
      assetId,
    );
    if (!n) throw Errors.notFound('That asset is not part of this verification.');
    return faService.getVerification(caller, pageId, pvId);
  },

  async closeVerification(caller: Caller, pageId: string, id: string): Promise<Row> {
    const v = await faService.getVerification(caller, pageId, id);
    if (S(v.status) !== 'OPEN') throw Errors.conflict('Already closed.');
    if ((v.lines as Row[]).some((l) => l.found === null))
      throw Errors.validation({ lines: 'Check every asset before closing.' });
    await exec(
      prisma,
      `UPDATE physical_verifications SET status='CLOSED', closed_on=CURRENT_DATE WHERE id=$1::uuid`,
      id,
    );
    await audit(
      prisma,
      caller,
      caller.auth.userId,
      'PHYSICAL_VERIFICATION_CLOSED',
      'physical_verification',
      { id, code: S(v.pvNo) },
      pageId,
      {},
    );
    return faService.getVerification(caller, pageId, id);
  },
};

const monthDays = (period: string): number => {
  const { from, to } = monthBounds(period);
  return daysIncl(from, to);
};

async function lockDoc(tx: Db, caller: Caller, table: string, id: string): Promise<Row> {
  const r = (
    await query(
      tx,
      `SELECT * FROM ${table} WHERE id=$1::uuid AND deleted_at IS NULL AND ($2::uuid IS NULL OR unit_id=$2::uuid) FOR UPDATE`,
      id,
      caller.ctx.unitId ?? null,
    )
  )[0];
  if (!r) throw Errors.notFound('Document not found.');
  return r;
}

async function docStep(
  table: string,
  entity: string,
  caller: Caller,
  pageId: string,
  id: string,
  version: number | undefined,
  _want: string,
  from: string[],
  set: string,
  action: string,
  get: () => Promise<Row>,
): Promise<Row> {
  await prisma.$transaction(async (tx) => {
    const d = await lockDoc(tx, caller, table, id);
    checkVersion(norm<Row>(d), version);
    if (S(d.status) !== 'DRAFT' || !from.includes(S(d.approval_status)))
      throw Errors.conflict('Only a draft can be sent for approval.');
    await exec(
      tx,
      `UPDATE ${table} SET ${set}, updated_by_id=$1::uuid, updated_at=now(), version=version+1 WHERE id=$2::uuid`,
      caller.auth.userId,
      id,
    );
    await audit(tx, caller, caller.auth.userId, action, entity, { id, code: id }, pageId, {});
  }, TX);
  return get();
}

async function approveStep(
  table: string,
  entity: string,
  caller: Caller,
  pageId: string,
  id: string,
  version: number | undefined,
  approve: boolean,
  get: () => Promise<Row>,
): Promise<Row> {
  await prisma.$transaction(async (tx) => {
    const d = await lockDoc(tx, caller, table, id);
    checkVersion(norm<Row>(d), version);
    if (S(d.approval_status) !== 'PENDING')
      throw Errors.conflict('This document is not waiting for approval.');
    await exec(
      tx,
      `UPDATE ${table} SET approval_status=$1, approved_by_id=$2::uuid, updated_by_id=$2::uuid, updated_at=now(), version=version+1 WHERE id=$3::uuid`,
      approve ? 'APPROVED' : 'REJECTED',
      caller.auth.userId,
      id,
    );
    await audit(
      tx,
      caller,
      caller.auth.userId,
      approve ? `${entity.toUpperCase()}_APPROVED` : `${entity.toUpperCase()}_REJECTED`,
      entity,
      { id, code: id },
      pageId,
      {},
    );
  }, TX);
  return get();
}

/** One BOOK line per capitalised asset for the month, with the extra-shift factor for plant and machinery. */
async function computeBook(
  tx: Db,
  unitId: string,
  runId: string,
  period: string,
): Promise<ReturnType<typeof D>> {
  const { from, to } = monthBounds(period);
  const days = daysIncl(from, to);
  const assets = await query(
    tx,
    `SELECT a.id::text AS aid, c.asset_class, c.nesd, p.* FROM assets a JOIN asset_categories c ON c.id=a.category_id JOIN asset_book_profile p ON p.asset_id=a.id AND p.area='BOOK'
      WHERE a.unit_id=$1::uuid AND a.deleted_at IS NULL AND a.status IN ('ACTIVE','IDLE','UNDER_MAINT') AND NOT p.frozen AND p.cost > 0 AND p.dep_start_date IS NOT NULL
        AND (p.last_dep_date IS NULL OR p.last_dep_date < $2::date) FOR UPDATE OF p`,
    unitId,
    to,
  );
  let total = D(0);
  for (const a of assets) {
    const u = (
      await query(
        tx,
        `SELECT single_days, double_days, triple_days FROM asset_shift_usage WHERE asset_id=$1::uuid AND period=$2`,
        S(a.aid),
        period,
      )
    )[0];
    const f = shiftFactor(
      S(a.asset_class),
      a.nesd === true,
      u
        ? {
            single: Number(u.single_days),
            double: Number(u.double_days),
            triple: Number(u.triple_days),
          }
        : null,
      days,
    );
    const common = {
      cost: S(a.cost),
      residual: S(a.residual_amount),
      method: S(a.method) as 'SLM' | 'WDV',
      lifeMonths: Number(a.life_months),
      depStart: S(a.dep_start_date).slice(0, 10),
    };
    // months that were never run are caught up at the normal factor, then the month itself at its shift factor
    const catchFrom = a.last_dep_date
      ? addDays(S(a.last_dep_date).slice(0, 10), 1)
      : common.depStart;
    const pre =
      catchFrom < from
        ? bookDepreciation({
            ...common,
            from: catchFrom,
            to: addDays(from, -1),
            openingAccum: S(a.accum_dep),
          })
        : null;
    const cur = bookDepreciation({
      ...common,
      from: catchFrom > from ? catchFrom : from,
      to,
      openingAccum: D(S(a.accum_dep)).plus(pre ? pre.amount : 0),
      shiftFactor: f,
    });
    const r = {
      amount: cur.amount.plus(pre ? pre.amount : 0),
      days: cur.days + (pre ? pre.days : 0),
      base: cur.base,
      rate: cur.rate,
    };
    if (r.amount.lte(0)) continue;
    await insertRow(tx, 'depreciation_run_lines', {
      runId,
      assetId: S(a.aid),
      openingValue: D(S(a.cost)).minus(S(a.accum_dep)).toFixed(2),
      base: r.base.toFixed(2),
      method: S(a.method),
      rate: r.rate.toFixed(4),
      days: r.days,
      shiftFactor: f.toFixed(2),
      amount: r.amount.toFixed(2),
      closingValue: D(S(a.cost)).minus(S(a.accum_dep)).minus(r.amount).toFixed(2),
    });
    total = total.plus(r.amount);
  }
  return total;
}

/** One line per IT block for the financial year: opening + additions (half rate under 180 days) - sale proceeds. */
async function computeTax(
  tx: Db,
  unitId: string,
  runId: string,
  fyId: string,
  fyCode: string,
  openings: Record<string, string | number>,
): Promise<ReturnType<typeof D>> {
  const fy = (
    await query(tx, `SELECT start_date, end_date FROM financial_years WHERE id=$1::uuid`, fyId)
  )[0]!;
  const start = S(fy.start_date).slice(0, 10);
  const end = S(fy.end_date).slice(0, 10);
  const blocks = await query(tx, `SELECT * FROM it_blocks ORDER BY code`);
  let total = D(0);
  for (const b of blocks) {
    const rate = (
      await query(
        tx,
        `SELECT rate_pct::text FROM it_block_rates WHERE block_id=$1::uuid AND effective_from <= $2::date ORDER BY effective_from DESC LIMIT 1`,
        S(b.id),
        end,
      )
    )[0];
    if (!rate) continue;
    const prior = (
      await query(
        tx,
        `SELECT l.closing_wdv::text FROM it_block_ledger l JOIN financial_years f ON f.id=l.fy_id WHERE l.unit_id=$1::uuid AND l.block_id=$2::uuid AND f.end_date < $3::date ORDER BY f.end_date DESC LIMIT 1`,
        unitId,
        S(b.id),
        start,
      )
    )[0];
    const opening = prior ? S(prior.closing_wdv) : String(openings[S(b.code)] ?? 0);
    const adds = await query(
      tx,
      `SELECT a.put_to_use_date, p.cost::text FROM assets a JOIN asset_book_profile p ON p.asset_id=a.id AND p.area='BOOK' WHERE a.unit_id=$1::uuid AND a.it_block_id=$2::uuid AND a.put_to_use_date BETWEEN $3::date AND $4::date AND a.deleted_at IS NULL`,
      unitId,
      S(b.id),
      start,
      end,
    );
    let ge = D(0);
    let lt = D(0);
    for (const x of adds) {
      if (isHalfRate(S(x.put_to_use_date).slice(0, 10), end)) lt = lt.plus(S(x.cost));
      else ge = ge.plus(S(x.cost));
    }
    const del = (
      await query(
        tx,
        `SELECT COALESCE(sum(d.sale_value),0)::text AS v FROM asset_disposals d JOIN assets a ON a.id=d.asset_id WHERE d.unit_id=$1::uuid AND a.it_block_id=$2::uuid AND d.status='POSTED' AND d.disposal_date BETWEEN $3::date AND $4::date`,
        unitId,
        S(b.id),
        start,
        end,
      )
    )[0]!;
    const r = blockDepreciation({
      opening,
      addGe180: ge,
      addLt180: lt,
      deletions: S(del.v),
      ratePct: S(rate.rate_pct),
    });
    if (D(opening).eq(0) && ge.eq(0) && lt.eq(0) && D(S(del.v)).eq(0)) continue;
    await insertRow(tx, 'depreciation_run_lines', {
      runId,
      blockId: S(b.id),
      openingValue: D(opening).toFixed(2),
      base: D(opening).plus(ge).plus(lt).minus(S(del.v)).toFixed(2),
      method: 'WDV',
      rate: S(rate.rate_pct),
      amount: r.depreciation.toFixed(2),
      closingValue: r.closing.toFixed(2),
    });
    await exec(
      tx,
      `INSERT INTO it_block_ledger (unit_id, block_id, fy_id, opening_wdv, additions_ge180, additions_lt180, deletions, depreciation, closing_wdv, needs_review, run_id) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::numeric,$5::numeric,$6::numeric,$7::numeric,$8::numeric,$9::numeric,true,$10::uuid)
      ON CONFLICT (unit_id, block_id, fy_id) DO UPDATE SET opening_wdv=EXCLUDED.opening_wdv, additions_ge180=EXCLUDED.additions_ge180, additions_lt180=EXCLUDED.additions_lt180, deletions=EXCLUDED.deletions, depreciation=EXCLUDED.depreciation, closing_wdv=EXCLUDED.closing_wdv, run_id=EXCLUDED.run_id`,
      unitId,
      S(b.id),
      fyId,
      D(opening).toFixed(2),
      ge.toFixed(2),
      lt.toFixed(2),
      D(S(del.v)).toFixed(2),
      r.depreciation.toFixed(2),
      r.closing.toFixed(2),
      runId,
    );
    total = total.plus(r.depreciation);
  }
  void fyCode;
  return total;
}
