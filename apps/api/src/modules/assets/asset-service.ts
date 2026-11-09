// Phase 14 asset spine: categories with their Schedule II parameters, IT-Act blocks, the assets themselves (one physical object =
// one row), meters and their readings. Book value is never stored: it is read from v_asset_book_value.
import { randomBytes } from 'node:crypto';
import { Errors } from '../../core/http/errors';
import { prisma } from '../../core/db/prisma';
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
} from '../procurement/core';
import type { Row } from '../procurement/core';
import type { Caller } from '../records/service';
import { S, oneUnit } from '../mfg/master-service';

export const ASSET_KINDS = [
  'MACHINE',
  'EQUIPMENT',
  'IT',
  'VEHICLE',
  'FURNITURE',
  'BUILDING',
  'OTHER',
] as const;
export const ASSET_CLASSES = [
  'BUILDING',
  'PM',
  'FURNITURE',
  'VEHICLE',
  'COMPUTER',
  'OFFICE_EQUIP',
  'ELECTRICAL',
  'INTANGIBLE',
] as const;

export interface AssetInput {
  name: string;
  categoryId: string;
  assetKind?: (typeof ASSET_KINDS)[number] | undefined;
  parentAssetId?: string | undefined;
  isComponent?: boolean | undefined;
  isMaintainable?: boolean | undefined;
  department?: string | undefined;
  location?: string | undefined;
  costCentreId?: string | undefined;
  workCentreId?: string | undefined;
  make?: string | undefined;
  model?: string | undefined;
  serialNo?: string | undefined;
  criticality?: 'A' | 'B' | 'C' | undefined;
  commissionDate?: string | undefined;
  warrantyEnd?: string | undefined;
  supplierId?: string | undefined;
  purchaseInvoiceRef?: string | undefined;
  putToUseDate?: string | undefined;
  itBlockId?: string | undefined;
  notes?: string | undefined;
}

const trim = (v: string | undefined): string | null => (v && v.trim() ? v.trim() : null);

/** The columns the list and the detail share, with the book value read from the view. */
const SELECT = `SELECT t.*, c.code AS category_code, c.name AS category_name, c.asset_class, c.nesd,
       v.cost, v.accum_dep, v.book_value, p.asset_no AS parent_asset_no, w.code AS work_centre_code,
       s.name AS supplier_name`;
const FROM = `FROM assets t JOIN asset_categories c ON c.id=t.category_id
       LEFT JOIN v_asset_book_value v ON v.asset_id=t.id
       LEFT JOIN assets p ON p.id=t.parent_asset_id
       LEFT JOIN mfg_work_centres w ON w.id=t.work_centre_id
       LEFT JOIN suppliers s ON s.id=t.supplier_id`;

export const assetService = {
  // ---------------------------------------------------------------------------------------------- categories and blocks
  async listCategories(): Promise<Row[]> {
    const cats = await query(
      prisma,
      `SELECT * FROM asset_categories WHERE deleted_at IS NULL ORDER BY code`,
    );
    const params = await query(
      prisma,
      `SELECT * FROM asset_category_book_params ORDER BY category_id, effective_from DESC`,
    );
    return cats.map((c) => ({
      ...norm<Row>(c),
      params: params.filter((p) => S(p.category_id) === S(c.id)).map((p) => norm<Row>(p)),
    }));
  },

  async saveCategory(
    caller: Caller,
    pageId: string,
    id: string | null,
    b: {
      code?: string | undefined;
      name: string;
      assetClass: string;
      assetAccount: string;
      accumDepAccount?: string | undefined;
      expenseAccount?: string | undefined;
      cwipAccount?: string | undefined;
      itcEligible?: boolean | undefined;
      isMaintainableDefault?: boolean | undefined;
      nesd?: boolean | undefined;
      itBlockCode?: string | undefined;
      status?: 'ACTIVE' | 'INACTIVE' | undefined;
    },
  ): Promise<Row> {
    for (const [k, code] of [
      ['assetAccount', b.assetAccount],
      ['accumDepAccount', b.accumDepAccount],
      ['expenseAccount', b.expenseAccount],
      ['cwipAccount', b.cwipAccount],
    ] as const)
      if (
        code &&
        !(await query(prisma, `SELECT 1 FROM accounts WHERE code=$1 AND posting_allowed`, code))
          .length
      )
        throw Errors.validation({
          [k]: `Account ${code} does not exist or does not take postings.`,
        });
    if (
      b.itBlockCode &&
      !(await query(prisma, `SELECT 1 FROM it_blocks WHERE code=$1`, b.itBlockCode)).length
    )
      throw Errors.validation({ itBlockCode: 'Unknown income-tax block.' });
    const vals = {
      name: b.name.trim(),
      assetClass: b.assetClass,
      assetAccount: b.assetAccount,
      accumDepAccount: trim(b.accumDepAccount),
      expenseAccount: trim(b.expenseAccount),
      cwipAccount: trim(b.cwipAccount),
      itcEligible: b.itcEligible ?? true,
      isMaintainableDefault: b.isMaintainableDefault ?? false,
      nesd: b.nesd ?? false,
      itBlockCode: trim(b.itBlockCode),
      needsReview: false,
    };
    let rid = id;
    if (!id) {
      if (!b.code) throw Errors.validation({ code: 'Enter a code.' });
      if (
        (
          await query(
            prisma,
            `SELECT 1 FROM asset_categories WHERE code=$1 AND deleted_at IS NULL`,
            b.code,
          )
        ).length
      )
        throw Errors.validation({ code: 'This code is already used.' });
      rid = await insertRow(prisma, 'asset_categories', {
        code: b.code.trim().toUpperCase(),
        ...vals,
        createdById: caller.auth.userId,
        updatedById: caller.auth.userId,
      });
    } else {
      // the accounts and the GST rule are what the assets were booked with: they do not change once an asset exists
      const cur = (
        await query(
          prisma,
          `SELECT * FROM asset_categories WHERE id=$1::uuid AND deleted_at IS NULL`,
          id,
        )
      )[0];
      if (!cur) throw Errors.notFound('Category not found.');
      const used =
        (
          await query(
            prisma,
            `SELECT 1 FROM assets WHERE category_id=$1::uuid AND deleted_at IS NULL LIMIT 1`,
            id,
          )
        ).length > 0;
      if (
        used &&
        (S(cur.asset_account) !== b.assetAccount ||
          S(cur.accum_dep_account) !== (vals.accumDepAccount ?? '') ||
          S(cur.expense_account) !== (vals.expenseAccount ?? '') ||
          S(cur.cwip_account) !== (vals.cwipAccount ?? '') ||
          (cur.itc_eligible === true) !== vals.itcEligible)
      )
        throw Errors.conflict(
          'Assets already use this category, so its accounts and GST rule cannot be changed. Make a new category instead.',
        );
      await exec(
        prisma,
        `UPDATE asset_categories SET name=$1, asset_class=$2, asset_account=$3, accum_dep_account=$4, expense_account=$5, cwip_account=$6,
                itc_eligible=$7, is_maintainable_default=$8, nesd=$9, it_block_code=$10, needs_review=false, status=COALESCE($11,status),
                updated_by_id=$12::uuid, updated_at=now(), version=version+1 WHERE id=$13::uuid`,
        vals.name,
        vals.assetClass,
        vals.assetAccount,
        vals.accumDepAccount,
        vals.expenseAccount,
        vals.cwipAccount,
        vals.itcEligible,
        vals.isMaintainableDefault,
        vals.nesd,
        vals.itBlockCode,
        b.status ?? null,
        caller.auth.userId,
        id,
      );
    }
    await audit(
      prisma,
      caller,
      caller.auth.userId,
      id ? 'ASSET_CATEGORY_UPDATED' : 'ASSET_CATEGORY_CREATED',
      'asset_category',
      { id: rid!, code: b.code ?? rid! },
      pageId,
      {},
    );
    return (await assetService.listCategories()).find((c) => S(c.id) === rid)!;
  },

  /** Schedule II parameters of a category from a date: method, life, residual (at most 5 %). */
  async saveBookParam(
    caller: Caller,
    pageId: string,
    categoryId: string,
    b: {
      effectiveFrom: string;
      method: 'SLM' | 'WDV';
      usefulLifeMonths: number;
      residualPct: string | number;
      sch2Ref?: string | undefined;
    },
  ): Promise<Row[]> {
    if (Number(b.residualPct) > 5 || Number(b.residualPct) < 0)
      throw Errors.validation({
        residualPct:
          'The residual value is at most 5 % of cost. A higher value needs a written reason on the asset.',
      });
    if (
      !(await query(prisma, `SELECT 1 FROM asset_categories WHERE id=$1::uuid`, categoryId)).length
    )
      throw Errors.notFound('Category not found.');
    await exec(
      prisma,
      `INSERT INTO asset_category_book_params (category_id, effective_from, method, useful_life_months, residual_pct, sch2_ref, needs_review)
       VALUES ($1::uuid,$2::date,$3,$4,$5::numeric,$6,false)
       ON CONFLICT (category_id, effective_from) DO UPDATE SET method=EXCLUDED.method, useful_life_months=EXCLUDED.useful_life_months,
         residual_pct=EXCLUDED.residual_pct, sch2_ref=EXCLUDED.sch2_ref, needs_review=false`,
      categoryId,
      b.effectiveFrom,
      b.method,
      b.usefulLifeMonths,
      String(b.residualPct),
      trim(b.sch2Ref),
    );
    await audit(
      prisma,
      caller,
      caller.auth.userId,
      'ASSET_BOOK_PARAM_SAVED',
      'asset_category',
      { id: categoryId, code: categoryId },
      pageId,
      {},
    );
    return (await assetService.listCategories()).filter((c) => S(c.id) === categoryId);
  },

  async listBlocks(): Promise<Row[]> {
    const blocks = await query(prisma, `SELECT * FROM it_blocks ORDER BY code`);
    const rates = await query(
      prisma,
      `SELECT * FROM it_block_rates ORDER BY block_id, effective_from DESC`,
    );
    return blocks.map((b) => ({
      ...norm<Row>(b),
      rates: rates.filter((r) => S(r.block_id) === S(b.id)).map((r) => norm<Row>(r)),
    }));
  },

  async saveBlockRate(
    caller: Caller,
    pageId: string,
    b: {
      blockCode: string;
      effectiveFrom: string;
      ratePct: string | number;
      actRef: string;
      name?: string | undefined;
    },
  ): Promise<Row[]> {
    if (Number(b.ratePct) < 0 || Number(b.ratePct) > 100)
      throw Errors.validation({ ratePct: 'Enter a rate from 0 to 100.' });
    let blk = (await query(prisma, `SELECT id::text FROM it_blocks WHERE code=$1`, b.blockCode))[0];
    if (!blk) {
      if (!b.name) throw Errors.validation({ name: 'Name the new block.' });
      blk = {
        id: await insertRow(prisma, 'it_blocks', {
          code: b.blockCode.toUpperCase(),
          name: b.name,
          actRef: b.actRef,
        }),
      };
    }
    await exec(
      prisma,
      `INSERT INTO it_block_rates (block_id, effective_from, rate_pct, act_ref, needs_review) VALUES ($1::uuid,$2::date,$3::numeric,$4,false)
       ON CONFLICT (block_id, effective_from) DO UPDATE SET rate_pct=EXCLUDED.rate_pct, act_ref=EXCLUDED.act_ref, needs_review=false`,
      S(blk.id),
      b.effectiveFrom,
      String(b.ratePct),
      b.actRef,
    );
    await audit(
      prisma,
      caller,
      caller.auth.userId,
      'IT_BLOCK_RATE_SAVED',
      'it_block',
      { id: S(blk.id), code: b.blockCode },
      pageId,
      {},
    );
    return assetService.listBlocks();
  },

  // ---------------------------------------------------------------------------------------------- assets
  async list(
    caller: Caller,
    pageId: string,
    q: {
      kinds?: string[] | undefined;
      status?: string | undefined;
      categoryId?: string | undefined;
      parentId?: string | undefined;
      maintainable?: boolean | undefined;
      q?: string | undefined;
      page: number;
      size: number;
    },
  ) {
    const sc = await scopeSql(caller, pageId);
    const args = [...sc.args];
    const where = [sc.sql];
    const add = (cond: string, v: unknown) => {
      args.push(v);
      where.push(cond.split('?').join(`$${args.length}`));
    };
    if (q.kinds?.length) add(`t.asset_kind = ANY(?::text[])`, q.kinds);
    if (q.status) add(`t.status = ?`, q.status);
    if (q.categoryId) add(`t.category_id = ?::uuid`, q.categoryId);
    if (q.parentId) add(`t.parent_asset_id = ?::uuid`, q.parentId);
    if (q.maintainable !== undefined) add(`t.is_maintainable = ?`, q.maintainable);
    if (q.q) add(`(t.asset_no ILIKE ? OR t.name ILIKE ? OR t.serial_no ILIKE ?)`, `%${q.q}%`);
    const sql = where.join(' AND ');
    const total = Number(
      (await query(prisma, `SELECT count(*)::int AS n FROM assets t WHERE ${sql}`, ...args))[0]!.n,
    );
    const rows = await query(
      prisma,
      `${SELECT} ${FROM} WHERE ${sql} ORDER BY t.asset_no LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size}`,
      ...args,
    );
    return { rows: rows.map((r) => norm<Row>(r)), total };
  },

  async get(caller: Caller, pageId: string, id: string): Promise<Row> {
    const sc = await scopeSql(caller, pageId);
    const a = (
      await query(
        prisma,
        `${SELECT} ${FROM} WHERE t.id=$${sc.args.length + 1}::uuid AND ${sc.sql}`,
        ...sc.args,
        id,
      )
    )[0];
    if (!a) throw Errors.notFound('Asset not found.');
    const [children, meters, profiles, lastWo, nextPm, openBd] = await Promise.all([
      query(
        prisma,
        `SELECT id::text, asset_no, name, status, is_component FROM assets WHERE parent_asset_id=$1::uuid AND deleted_at IS NULL ORDER BY asset_no`,
        id,
      ),
      query(
        prisma,
        `SELECT m.id::text, m.meter_type, m.uom, (SELECT value::text FROM meter_readings r WHERE r.meter_id=m.id ORDER BY reading_at DESC, id DESC LIMIT 1) AS last_value,
                (SELECT reading_at FROM meter_readings r WHERE r.meter_id=m.id ORDER BY reading_at DESC, id DESC LIMIT 1) AS last_at
           FROM meters m WHERE m.asset_id=$1::uuid ORDER BY m.meter_type`,
        id,
      ),
      query(prisma, `SELECT * FROM asset_book_profile WHERE asset_id=$1::uuid`, id),
      query(
        prisma,
        `SELECT actual_end FROM maint_work_orders WHERE asset_id=$1::uuid AND wo_type='PM' AND status IN ('COMPLETED','CLOSED') AND deleted_at IS NULL ORDER BY actual_end DESC NULLS LAST LIMIT 1`,
        id,
      ),
      query(
        prisma,
        `SELECT min(s.due_date) AS d FROM pm_schedules s JOIN pm_plans p ON p.id=s.plan_id WHERE p.asset_id=$1::uuid AND s.status IN ('PLANNED','WO_CREATED')`,
        id,
      ),
      query(
        prisma,
        `SELECT count(*)::int AS n FROM breakdown_tickets WHERE asset_id=$1::uuid AND status IN ('OPEN','ACK','IN_REPAIR') AND deleted_at IS NULL`,
        id,
      ),
    ]);
    const kpi = await assetService.kpis(id, null, null);
    const openN = Number(openBd[0]!.n);
    return {
      ...norm<Row>(a),
      children: children.map((r) => norm<Row>(r)),
      meters: meters.map((r) => norm<Row>(r)),
      profiles: profiles.map((r) => norm<Row>(r)),
      lastService: lastWo[0]?.actual_end ?? null,
      nextService: nextPm[0]?.d ?? null,
      openBreakdowns: openN,
      health:
        openN > 0
          ? 'DOWN'
          : kpi.mtbfHours !== null && Number(kpi.availabilityPct) < 90
            ? 'WATCH'
            : 'GOOD',
      ...kpi,
    };
  },

  /** MTBF, MTTR and availability from the logged downtime events only (planned downtime is not a failure). */
  async kpis(
    assetId: string,
    from: string | null,
    to: string | null,
  ): Promise<{
    failures: number;
    mtbfHours: string | null;
    mttrHours: string | null;
    availabilityPct: string | null;
    downtimeMinutes: string;
  }> {
    const a = (
      await query(
        prisma,
        `SELECT commission_date, created_at FROM assets WHERE id=$1::uuid`,
        assetId,
      )
    )[0];
    if (!a) throw Errors.notFound('Asset not found.');
    const start = from ?? S(a.commission_date ?? a.created_at).slice(0, 10);
    const end = to ?? new Date().toISOString().slice(0, 10);
    const r = (
      await query(
        prisma,
        `SELECT count(*) FILTER (WHERE dt_type='UNPLANNED' AND end_at IS NOT NULL)::int AS failures,
                COALESCE(sum(duration_min) FILTER (WHERE dt_type='UNPLANNED'),0)::text AS unplanned_min,
                COALESCE(sum(duration_min),0)::text AS all_min
           FROM downtime_events WHERE asset_id=$1::uuid AND deleted_at IS NULL AND start_at >= $2::date AND start_at < ($3::date + 1)`,
        assetId,
        start,
        end,
      )
    )[0]!;
    const spanMin = Math.max(1, (Date.parse(end) - Date.parse(start)) / 60000 + 1440);
    const failures = Number(r.failures);
    const unplanned = Number(S(r.unplanned_min));
    const down = Number(S(r.all_min));
    const operating = Math.max(0, spanMin - down);
    return {
      failures,
      mtbfHours: failures ? (operating / failures / 60).toFixed(2) : null,
      mttrHours: failures ? (unplanned / failures / 60).toFixed(2) : null,
      availabilityPct: failures || down ? (((spanMin - down) / spanMin) * 100).toFixed(2) : null,
      downtimeMinutes: down.toFixed(0),
    };
  },

  async create(caller: Caller, pageId: string, b: AssetInput): Promise<Row> {
    const unitId = oneUnit(caller);
    const fy = await fyOfCaller(caller);
    const cat = (
      await query(
        prisma,
        `SELECT * FROM asset_categories WHERE id=$1::uuid AND deleted_at IS NULL AND status='ACTIVE'`,
        b.categoryId,
      )
    )[0];
    if (!cat) throw Errors.validation({ categoryId: 'Choose an active category.' });
    if (b.parentAssetId) await parentOk(unitId, b.parentAssetId);
    const blockId =
      b.itBlockId ??
      (cat.it_block_code
        ? S(
            (
              await query(
                prisma,
                `SELECT id::text FROM it_blocks WHERE code=$1`,
                S(cat.it_block_code),
              )
            )[0]?.id,
          ) || undefined
        : undefined);
    const id = await prisma.$transaction(async (tx) => {
      const no = await NumberingService.allocate(tx, {
        pageId: 'asset:AST',
        unitId,
        fyId: fy.id,
        prefix: 'AST',
      });
      const aid = await insertRow(tx, 'assets', {
        unitId,
        fyId: fy.id,
        assetNo: no,
        name: b.name.trim(),
        categoryId: b.categoryId,
        assetKind: b.assetKind ?? kindOfClass(S(cat.asset_class)),
        parentAssetId: b.parentAssetId ?? null,
        isComponent: b.isComponent ?? !!b.parentAssetId,
        isMaintainable: b.isMaintainable ?? cat.is_maintainable_default === true,
        department: trim(b.department),
        location: trim(b.location),
        costCentreId: b.costCentreId ?? null,
        workCentreId: b.workCentreId ?? null,
        make: trim(b.make),
        model: trim(b.model),
        serialNo: trim(b.serialNo),
        criticality: b.criticality ?? 'C',
        commissionDate: b.commissionDate ?? null,
        warrantyEnd: b.warrantyEnd ?? null,
        supplierId: b.supplierId ?? null,
        purchaseInvoiceRef: trim(b.purchaseInvoiceRef),
        putToUseDate: b.putToUseDate ?? null,
        itBlockId: blockId ?? null,
        status: 'CWIP',
        qrToken: randomBytes(10).toString('hex'),
        notes: trim(b.notes),
        createdById: caller.auth.userId,
        updatedById: caller.auth.userId,
      });
      if (b.workCentreId)
        await exec(
          tx,
          `UPDATE mfg_work_centres SET asset_id=$1::uuid WHERE id=$2::uuid AND asset_id IS NULL`,
          aid,
          b.workCentreId,
        );
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'ASSET_CREATED',
        'asset',
        { id: aid, code: no },
        pageId,
        {},
      );
      return aid;
    }, TX);
    return assetService.get(caller, pageId, id);
  },

  async update(
    caller: Caller,
    pageId: string,
    id: string,
    version: number | undefined,
    b: Partial<Omit<AssetInput, 'categoryId'>> & { status?: 'ACTIVE' | 'IDLE' | undefined },
  ): Promise<Row> {
    const cur = await assetService.get(caller, pageId, id);
    checkVersion(cur, version);
    if (S(cur.status) === 'DISPOSED') throw Errors.conflict('A disposed asset cannot be changed.');
    if (b.parentAssetId) {
      if (b.parentAssetId === id)
        throw Errors.validation({ parentAssetId: 'An asset cannot be its own parent.' });
      await parentOk(S(cur.unitId), b.parentAssetId);
    }
    if (b.status && !['ACTIVE', 'IDLE'].includes(b.status))
      throw Errors.validation({ status: 'Use Active or Idle.' });
    if (b.status && S(cur.status) === 'CWIP')
      throw Errors.conflict('Capitalise the asset before it is made active.');
    if (b.status && S(cur.status) === 'UNDER_MAINT')
      throw Errors.conflict('The asset is under maintenance: finish its work order first.');
    const map: Record<string, unknown> = {
      name: b.name?.trim(),
      parent_asset_id: b.parentAssetId,
      is_component: b.isComponent,
      is_maintainable: b.isMaintainable,
      department: b.department === undefined ? undefined : trim(b.department),
      location: b.location === undefined ? undefined : trim(b.location),
      cost_centre_id: b.costCentreId,
      work_centre_id: b.workCentreId,
      make: b.make === undefined ? undefined : trim(b.make),
      model: b.model === undefined ? undefined : trim(b.model),
      serial_no: b.serialNo === undefined ? undefined : trim(b.serialNo),
      criticality: b.criticality,
      commission_date: b.commissionDate,
      warranty_end: b.warrantyEnd,
      supplier_id: b.supplierId,
      purchase_invoice_ref:
        b.purchaseInvoiceRef === undefined ? undefined : trim(b.purchaseInvoiceRef),
      put_to_use_date: b.putToUseDate,
      it_block_id: b.itBlockId,
      notes: b.notes === undefined ? undefined : trim(b.notes),
      status: b.status,
    };
    const sets: string[] = [];
    const args: unknown[] = [];
    for (const [k, v] of Object.entries(map)) {
      if (v === undefined) continue;
      args.push(v);
      sets.push(
        `${k}=$${args.length}${k.endsWith('_id') || k === 'parent_asset_id' ? '::uuid' : k.endsWith('_date') || k === 'warranty_end' ? '::date' : ''}`,
      );
    }
    if (sets.length) {
      args.push(caller.auth.userId, id);
      try {
        await exec(
          prisma,
          `UPDATE assets SET ${sets.join(', ')}, updated_by_id=$${args.length - 1}::uuid, updated_at=now(), version=version+1 WHERE id=$${args.length}::uuid`,
          ...args,
        );
      } catch (e) {
        if (String((e as Error).message).includes('ASSET_PARENT_CYCLE'))
          throw Errors.validation({ parentAssetId: 'That would make the asset its own ancestor.' });
        throw e;
      }
      await audit(
        prisma,
        caller,
        caller.auth.userId,
        'ASSET_UPDATED',
        'asset',
        { id, code: S(cur.assetNo) },
        pageId,
        {},
      );
    }
    return assetService.get(caller, pageId, id);
  },

  // ---------------------------------------------------------------------------------------------- meters
  async addMeter(
    caller: Caller,
    pageId: string,
    assetId: string,
    b: { meterType: 'RUN_HRS' | 'STROKES' | 'KM'; uom?: string | undefined },
  ): Promise<Row> {
    await assetService.get(caller, pageId, assetId);
    const uom = b.uom ?? { RUN_HRS: 'hr', STROKES: 'nos', KM: 'km' }[b.meterType];
    if (
      (
        await query(
          prisma,
          `SELECT 1 FROM meters WHERE asset_id=$1::uuid AND meter_type=$2`,
          assetId,
          b.meterType,
        )
      ).length
    )
      throw Errors.conflict('The asset already has this meter.');
    await insertRow(prisma, 'meters', { assetId, meterType: b.meterType, uom });
    return assetService.get(caller, pageId, assetId);
  },

  async addReading(
    caller: Caller,
    pageId: string,
    meterId: string,
    b: {
      value: string | number;
      readingAt?: string | undefined;
      isReset?: boolean | undefined;
      source?: 'MANUAL' | 'IOT' | undefined;
    },
  ): Promise<Row> {
    const m = (
      await query(prisma, `SELECT asset_id::text FROM meters WHERE id=$1::uuid`, meterId)
    )[0];
    if (!m) throw Errors.notFound('Meter not found.');
    await assetService.get(caller, pageId, S(m.asset_id));
    try {
      await insertRow(prisma, 'meter_readings', {
        meterId,
        value: String(b.value),
        readingAt: b.readingAt ?? new Date().toISOString(),
        isReset: b.isReset ?? false,
        enteredById: caller.auth.userId,
        source: b.source ?? 'MANUAL',
      });
    } catch (e) {
      if (String((e as Error).message).includes('METER_READING_LOWER'))
        throw Errors.validation({
          value:
            'The reading is lower than the last one. If the meter was replaced, tick "meter reset".',
        });
      throw e;
    }
    return assetService.get(caller, pageId, S(m.asset_id));
  },

  async readings(caller: Caller, pageId: string, assetId: string): Promise<Row[]> {
    await assetService.get(caller, pageId, assetId);
    const r = await query(
      prisma,
      `SELECT r.id::text, m.meter_type, m.uom, r.reading_at, r.value::text, r.is_reset, r.source
         FROM meter_readings r JOIN meters m ON m.id=r.meter_id WHERE m.asset_id=$1::uuid ORDER BY r.reading_at DESC LIMIT 200`,
      assetId,
    );
    return r.map((x) => norm<Row>(x));
  },
};

function kindOfClass(cls: string): (typeof ASSET_KINDS)[number] {
  return (
    (
      {
        PM: 'MACHINE',
        BUILDING: 'BUILDING',
        FURNITURE: 'FURNITURE',
        VEHICLE: 'VEHICLE',
        COMPUTER: 'IT',
        ELECTRICAL: 'EQUIPMENT',
        OFFICE_EQUIP: 'EQUIPMENT',
      } as Record<string, (typeof ASSET_KINDS)[number]>
    )[cls] ?? 'OTHER'
  );
}

async function parentOk(unitId: string, parentId: string): Promise<void> {
  const p = (
    await query(
      prisma,
      `SELECT unit_id::text FROM assets WHERE id=$1::uuid AND deleted_at IS NULL`,
      parentId,
    )
  )[0];
  if (!p) throw Errors.validation({ parentAssetId: 'Parent asset not found.' });
  if (S(p.unit_id) !== unitId)
    throw Errors.validation({ parentAssetId: 'The parent belongs to another unit.' });
}

export { parentOk };
