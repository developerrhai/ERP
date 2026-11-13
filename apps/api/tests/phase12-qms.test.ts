/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any -- API test bodies are loose JSON */
// Phase 12: quality. A goods receipt that needs inspection creates an inspection lot; the sheet is judged against the
// plan's limits; the Usage Decision moves stock (accepted -> Unrestricted, rejected -> Blocked) and writes the rejection
// register; templates are versioned and customer specific; 8D / alert / MOM / CI close only when complete; PPM and quality
// cost are server numbers; calibration moves validity and the daily job reminds once.
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { invalidateAccessCache } from '../src/core/rbac/access';
import {
  addMonths,
  againstTarget,
  calibrationStatus,
  costPercent,
  headerErrors,
  judgeRow,
  overallResult,
  ppm,
} from '../src/modules/qms/logic';
import { runQmsDaily } from '../src/modules/qms/instruments-service';
import { newApp, prisma, signInAs, signInOwner } from './helpers';
import type { Signed } from './helpers';
import { setApproval, tag, vclient } from './phase08-helpers';
import { body, ifm, mkPo, mkSupplier, setup } from './phase09-helpers';
import { mkItem } from './phase08-helpers';

const app = newApp();
let owner: Signed;
let ctx: Awaited<ReturnType<typeof setup>>;
let restoreStock: Awaited<ReturnType<typeof setApproval>>;
const PAGES = ['scm-po', 'scm-grn'];
let saved: { pageId: string; approvalRequired: boolean }[] = [];
const shared: { item?: any; sup?: any; plan?: any; lot?: any } = {};
const patch = (path: string, b: unknown, extra: Record<string, string> = {}) =>
  request(app)
    .patch('/api/v1' + path)
    .set(owner.bearer)
    .set('X-Unit-Id', ctx.fx.unitId)
    .set(extra)
    .send(b as object);
const TODAY = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

beforeAll(async () => {
  owner = await signInOwner(app);
  restoreStock = await setApproval(false);
  saved = await prisma.moduleControl.findMany({
    where: { pageId: { in: PAGES } },
    select: { pageId: true, approvalRequired: true },
  });
  await prisma.moduleControl.updateMany({
    where: { pageId: { in: PAGES } },
    data: { approvalRequired: false },
  });
  invalidateAccessCache();
  ctx = await setup(app, owner);
});
afterAll(async () => {
  for (const r of [...saved, ...restoreStock])
    await prisma.moduleControl.update({
      where: { pageId: r.pageId },
      data: { approvalRequired: r.approvalRequired },
    });
  await prisma.$disconnect();
});

describe('pure rules', () => {
  it('judges numeric rows against the limits and attribute rows by OK / NOT OK', () => {
    const num = (r: string[], lsl: string | null = '9.5', usl: string | null = '10.5') =>
      judgeRow({ rowType: 'NUMERIC', lsl, usl, readings: r });
    expect(num(['10', '10.5', '9.5']).status).toBe('OK');
    expect(num(['10', '10.51']).status).toBe('NOT_OK');
    expect(num(['9.49']).status).toBe('NOT_OK');
    expect(num(['', ' ']).status).toBe('PENDING');
    expect(num(['10'], null, null).status).toBe('NA');
    expect(num(['10'], null, '10.5').status).toBe('OK');
    expect(num(['abc']).invalid[0]).toContain('not a number');
    const att = (r: string[]) =>
      judgeRow({ rowType: 'ATTRIBUTE', lsl: null, usl: null, readings: r });
    expect(att(['OK', 'ok']).status).toBe('OK');
    expect(att(['OK', 'Not OK']).status).toBe('NOT_OK');
    expect(att(['NA']).status).toBe('NA');
    expect(att(['maybe']).invalid).toHaveLength(1);
  });
  it('overall result: any NOT_OK rejects; nothing filled is undecided', () => {
    expect(overallResult(['OK', 'NOT_OK'])).toBe('REJECTED');
    expect(overallResult(['OK', 'NA'])).toBe('ACCEPTED');
    expect(overallResult(['PENDING'])).toBeNull();
  });
  it('validates a header against the template', () => {
    const f = [
      { key: 'a', label: 'A', required: true },
      { key: 'd', label: 'Date', type: 'date' as const },
      { key: 's', label: 'S', type: 'select' as const, options: ['X', 'Y'] },
    ];
    expect(headerErrors(f, {})).toEqual({ a: 'Enter a.' });
    expect(headerErrors(f, { a: 'x', d: '12-11-2026', s: 'Z', q: 1 })).toMatchObject({
      d: expect.any(String),
      s: 'Choose one of: X, Y.',
      q: expect.any(String),
    });
    expect(headerErrors(f, {}, { requireAll: false })).toEqual({});
  });
  it('calibration status, month arithmetic, PPM and cost percent', () => {
    expect(calibrationStatus(null, '2026-11-08', 15)).toBe('NOT_CALIBRATED');
    expect(calibrationStatus('2026-11-07', '2026-11-08', 15)).toBe('EXPIRED');
    expect(calibrationStatus('2026-11-08', '2026-11-08', 15)).toBe('DUE_SOON');
    expect(calibrationStatus('2026-11-23', '2026-11-08', 15)).toBe('DUE_SOON');
    expect(calibrationStatus('2026-11-24', '2026-11-08', 15)).toBe('VALID');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2027-11-30', 3)).toBe('2028-02-29');
    expect(addMonths('2026-11-15', 12)).toBe('2027-11-15');
    expect(ppm('25', '10000')).toBe('2500.00');
    expect(ppm('1', '3')).toBe('333333.33');
    expect(ppm('1', '0')).toBeNull();
    expect(costPercent('10000', '500000')).toBe('2.00');
    expect(costPercent('1', '0')).toBeNull();
    expect(againstTarget('2500.00', '3000')).toBe('OK');
    expect(againstTarget('3000.01', '3000')).toBe('OVER');
    expect(againstTarget('5', null)).toBeNull();
  });
});

describe('401 / 403', () => {
  it('needs a token, and a plain employee cannot publish a template', async () => {
    expect((await request(app).get('/api/v1/qms/inspections')).status).toBe(401);
    const emp = await signInAs(app, 'EMPLOYEE');
    const v = vclient(app, emp, ctx.fx.unitId);
    const r = await v.call('post', '/qms/templates', {
      kind: 'VT',
      name: 'x',
      headerFields: [{ key: 'a', label: 'A' }],
      reason: 'test',
    });
    expect(r.status).toBe(403);
  });
});

describe('templates and plans (R-16 / R-17)', () => {
  it('seeds the ten client forms and publishes a customer-specific version', async () => {
    const { v } = ctx;
    const all = body(await v.call('get', '/qms/templates?status=ACTIVE'));
    const kinds = all.rows.map((t: any) => t.kind).sort();
    expect(kinds).toEqual(
      [
        'ALERT',
        'CI',
        'EIGHT_D',
        'INCOMING',
        'IN_PROCESS',
        'ISIR',
        'MOM',
        'PRE_DISPATCH',
        'VT',
        'WELDING',
      ].sort(),
    );
    const cust = await prisma.customer.create({
      data: {
        code: `C${tag()}`.slice(0, 28),
        name: `Cust ${tag()}`,
        nameKey: `c-${tag()}`.toLowerCase(),
        stateCode: '27',
        gstRegistrationType: 'UNREGISTERED',
        approvalStatus: 'APPROVED',
      },
    });
    // a customer-wise pre-dispatch sheet with a DFT-range field
    const pub = await v.call('post', '/qms/templates', {
      kind: 'PRE_DISPATCH',
      name: 'Pre-dispatch for customer',
      customerId: cust.id,
      headerFields: [
        { key: 'customer', label: 'Customer', type: 'customer', required: true },
        { key: 'part', label: 'Part', type: 'item', required: true },
        { key: 'dft_range', label: 'DFT range (micron)', type: 'text' },
      ],
      reason: 'Customer format received',
    });
    expect(pub.status, JSON.stringify(pub.body)).toBe(201);
    const t1 = body(pub);
    expect(t1.version).toBe(1);
    const res = body(
      await v.call('get', `/qms/templates/resolve?kind=PRE_DISPATCH&customerId=${cust.id}`),
    );
    expect(res.id).toBe(t1.id);
    const generic = body(await v.call('get', '/qms/templates/resolve?kind=PRE_DISPATCH'));
    expect(generic.customerId).toBeNull();
    // a second publish retires the first and bumps the version
    const again = body(
      await v.call('post', '/qms/templates', {
        kind: 'PRE_DISPATCH',
        name: 'Pre-dispatch for customer v2',
        customerId: cust.id,
        headerFields: t1.headerFields,
        reason: 'Added a field',
      }),
    );
    expect(again.version).toBe(2);
    expect(body(await v.call('get', `/qms/templates/${t1.id}`)).status).toBe('RETIRED');
    // bad definition
    const bad = await v.call('post', '/qms/templates', {
      kind: 'VT',
      name: 'x',
      headerFields: [{ key: 'a', label: 'A', type: 'select' }],
      reason: 'test',
    });
    expect(bad.status).toBe(422);
  });
});

describe('goods receipt -> inspection lot -> readings -> usage decision', () => {
  it('creates the lot, judges the readings and moves stock on the decision', async () => {
    const { v, fx } = ctx;
    shared.item = await mkItem({ qcRequired: true, itemType: 'Raw Material' });
    shared.sup = await mkSupplier();
    // a plan for the item: thickness 9.5..10.5 and a visual check
    const plan = await v.call('post', '/qms/plans', {
      code: `PL-${tag()}`,
      name: 'RM plan',
      kind: 'INCOMING',
      itemId: shared.item.id,
      characteristics: [
        {
          name: 'Thickness',
          spec: '10 +/- 0.5',
          method: 'Vernier',
          unit: 'mm',
          type: 'NUMERIC',
          lsl: 9.5,
          usl: 10.5,
        },
        { name: 'Surface', method: 'Visual', type: 'ATTRIBUTE' },
      ],
    });
    expect(plan.status, JSON.stringify(plan.body)).toBe(201);
    shared.plan = body(plan);
    const po = await mkPo(v, fx, shared.sup.id, shared.item.id, 100, 50);
    const g = body(
      await v.call('post', '/scm/grn', {
        poId: po.id,
        warehouseId: fx.warehouseId,
        vendorInvoiceRef: 'VINV-77',
        lines: [{ poLineId: po.lines[0].id, receivedQty: 100 }],
      }),
    );
    const sub = await v.call('post', `/scm/grn/${g.id}/submit`, {}, ifm(g.version));
    expect(sub.status, JSON.stringify(sub.body)).toBe(200);
    const grn = body(await v.call('get', `/scm/grn/${g.id}`));
    expect(grn.status).toBe('Posted');

    const list = body(await v.call('get', '/qms/inspections?kind=INCOMING&status=Draft&size=100'));
    const lot = list.find((x: any) => x.itemId === shared.item.id);
    expect(lot, 'the posted receipt created an inspection lot').toBeTruthy();
    expect(lot.sourceType).toBe('GRN_LINE');
    expect(lot.lotQty).toBe('100');
    const sheet = body(await v.call('get', `/qms/inspections/${lot.id}`));
    expect(sheet.rows.map((r: any) => r.label)).toEqual(['Thickness', 'Surface']);
    expect(sheet.header.invoice_no).toBe('VINV-77');
    expect(sheet.header.supplier).toBe(shared.sup.id);
    expect(sheet.grn.grnNo).toBe(grn.number);
    shared.lot = sheet;

    // an unreadable reading is refused in plain words
    const badRead = await patch(
      `/qms/inspections/${lot.id}`,
      { rows: [{ label: 'Thickness', lsl: 9.5, usl: 10.5, readings: ['ten'] }] },
      ifm(sheet.version),
    );
    expect(badRead.status).toBe(422);

    // 10.7 is out of limit -> NOT_OK, and the sheet cannot be marked accepted
    const filled = await patch(
      `/qms/inspections/${lot.id}`,
      {
        rows: [
          {
            label: 'Thickness',
            spec: '10 +/- 0.5',
            method: 'Vernier',
            unit: 'mm',
            rowType: 'NUMERIC',
            lsl: 9.5,
            usl: 10.5,
            readings: ['10.7'],
          },
          { label: 'Surface', method: 'Visual', rowType: 'ATTRIBUTE', readings: ['OK'] },
        ],
      },
      ifm(sheet.version),
    );
    expect(filled.status, JSON.stringify(filled.body)).toBe(200);
    const f1 = body(filled);
    expect(f1.rows.map((r: any) => r.rowStatus)).toEqual(['NOT_OK', 'OK']);
    const noAccept = await v.call(
      'post',
      `/qms/inspections/${lot.id}/submit`,
      { result: 'ACCEPTED' },
      ifm(f1.version),
    );
    expect(noAccept.status).toBe(422);
    expect(noAccept.body.error.code).toBe('QMS_READINGS_OUT_OF_LIMIT');

    // re-measure: all inside the limits
    const fixed = body(
      await patch(
        `/qms/inspections/${lot.id}`,
        {
          rows: [
            { label: 'Thickness', rowType: 'NUMERIC', lsl: 9.5, usl: 10.5, readings: ['10.1'] },
            { label: 'Surface', rowType: 'ATTRIBUTE', readings: ['OK'] },
          ],
        },
        ifm(f1.version),
      ),
    );
    // the decision needs a submitted sheet
    const early = await v.call('post', `/qms/inspections/${lot.id}/decide`, {
      acceptedQty: 100,
      rejectedQty: 0,
    });
    expect(early.status).toBe(409);
    const submitted = await v.call(
      'post',
      `/qms/inspections/${lot.id}/submit`,
      {},
      ifm(fixed.version),
    );
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);
    expect(body(submitted).result).toBe('ACCEPTED');
    expect(body(submitted).status).toBe('Submitted');

    // quantities must add up to the lot
    const wrong = await v.call('post', `/qms/inspections/${lot.id}/decide`, {
      acceptedQty: 90,
      rejectedQty: 5,
      note: 'cracks',
    });
    expect(wrong.status).toBe(422);
    expect(wrong.body.error.code).toBe('QC_QTY_MISMATCH');
    // a rejection needs a reason
    expect(
      (
        await v.call('post', `/qms/inspections/${lot.id}/decide`, {
          acceptedQty: 98,
          rejectedQty: 2,
        })
      ).status,
    ).toBe(422);

    const key = `qms-${tag()}-decide`;
    const dec = await v.call(
      'post',
      `/qms/inspections/${lot.id}/decide`,
      { acceptedQty: 98, rejectedQty: 2, note: 'Cracked edge' },
      { 'Idempotency-Key': key },
    );
    expect(dec.status, JSON.stringify(dec.body)).toBe(200);
    expect(body(dec).status).toBe('Decided');
    expect(body(dec).decision).toBe('PARTIAL');
    const replay = await v.call(
      'post',
      `/qms/inspections/${lot.id}/decide`,
      { acceptedQty: 98, rejectedQty: 2, note: 'Cracked edge' },
      { 'Idempotency-Key': key },
    );
    expect(replay.status).toBe(200);
    // a second, different decision is refused
    expect(
      (
        await v.call('post', `/qms/inspections/${lot.id}/decide`, {
          acceptedQty: 100,
          rejectedQty: 0,
        })
      ).status,
    ).toBe(409);
    expect(
      (await v.call('post', `/qms/inspections/${lot.id}/cancel`, { reason: 'oops' })).status,
    ).toBe(409);

    // stock moved: 98 Unrestricted, 2 Blocked; nothing stays in Quality Inspection
    const slices = await prisma.stockSlice.findMany({
      where: { itemId: shared.item.id, warehouseId: fx.warehouseId, qty: { gt: 0 } },
      orderBy: { stockStatus: 'asc' },
    });
    expect(slices.map((s) => [s.stockStatus, Number(s.qty)])).toEqual([
      ['BLOCKED', 2],
      ['UNRESTRICTED', 98],
    ]);
    const line = (
      await prisma.$queryRawUnsafe<any[]>(
        `SELECT accepted_qty::text a, rejected_qty::text r, qc_state FROM goods_receipt_lines WHERE id=$1::uuid`,
        grn.lines[0].id,
      )
    )[0];
    expect([Number(line.a), Number(line.r), line.qc_state]).toEqual([98, 2, 'DONE']);

    // the rejected 2 are in the register, returned to the vendor
    const reg = body(await v.call('get', '/qms/rejections?size=100'));
    const entry = reg.find((e: any) => e.sourceInspectionId === lot.id);
    expect(entry).toMatchObject({
      holdQty: '2',
      disposition: 'RETURN_TO_VENDOR',
      process: 'Incoming inspection',
      status: 'Open',
    });
    // audit rows
    const audits = await prisma.auditLog.count({
      where: { action: 'QMS_USAGE_DECISION', targetId: lot.id },
    });
    expect(audits).toBe(1);
  });

  it('a rejected sheet cannot release stock; a fully rejected lot goes to Blocked', async () => {
    const { v, fx } = ctx;
    const item = await mkItem({ qcRequired: true, itemType: 'Raw Material' });
    const po = await mkPo(v, fx, shared.sup.id, item.id, 10, 50);
    const g = body(
      await v.call('post', '/scm/grn', {
        poId: po.id,
        warehouseId: fx.warehouseId,
        lines: [{ poLineId: po.lines[0].id, receivedQty: 10 }],
      }),
    );
    expect((await v.call('post', `/scm/grn/${g.id}/submit`, {}, ifm(g.version))).status).toBe(200);
    const lot = body(await v.call('get', '/qms/inspections?kind=INCOMING&size=100')).find(
      (x: any) => x.itemId === item.id,
    );
    const sheet = body(await v.call('get', `/qms/inspections/${lot.id}`));
    // no plan for this item: add the characteristics by hand
    const f = body(
      await patch(
        `/qms/inspections/${lot.id}`,
        {
          rows: [{ label: 'Hardness', rowType: 'ATTRIBUTE', readings: ['NOT OK'] }],
          header: { ...sheet.header, invoice_no: 'X1' },
        },
        ifm(sheet.version),
      ),
    );
    const s = body(await v.call('post', `/qms/inspections/${lot.id}/submit`, {}, ifm(f.version)));
    expect(s.result).toBe('REJECTED');
    const rel = await v.call('post', `/qms/inspections/${lot.id}/decide`, {
      acceptedQty: 4,
      rejectedQty: 6,
      note: 'soft',
    });
    expect(rel.status).toBe(422);
    expect(rel.body.error.code).toBe('QMS_REJECTED_SHEET');
    const ok = await v.call('post', `/qms/inspections/${lot.id}/decide`, {
      acceptedQty: 0,
      rejectedQty: 10,
      note: 'Hardness below spec',
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(body(ok).decision).toBe('REJECTED');
    const sl = await prisma.stockSlice.findMany({
      where: { itemId: item.id, warehouseId: fx.warehouseId, qty: { gt: 0 } },
    });
    expect(sl.map((x) => [x.stockStatus, Number(x.qty)])).toEqual([['BLOCKED', 10]]);
  });
});

describe('other inspection forms on the same engine', () => {
  it('records an in-process sheet with 5 readings per row and the welding attribute sheet', async () => {
    const { v } = ctx;
    const item = await mkItem({ itemType: 'Finished Goods' });
    const ip = await v.call('post', '/qms/inspections', {
      kind: 'IN_PROCESS',
      header: { part: item.id, machine: 'CNC-1', operation: 'Turning' },
      rows: [
        {
          label: 'Outer dia',
          spec: '25 +/- 0.1',
          method: 'Micrometer',
          rowType: 'NUMERIC',
          lsl: 24.9,
          usl: 25.1,
          readings: ['25.0', '25.05', '24.95', '25.1', '24.9'],
        },
      ],
    });
    expect(ip.status, JSON.stringify(ip.body)).toBe(201);
    const s = body(ip);
    expect(s.number).toMatch(/^IPQC/);
    expect(s.rows[0].rowStatus).toBe('OK');
    // more readings than the form has columns
    const tooMany = await patch(
      `/qms/inspections/${s.id}`,
      { rows: [{ label: 'x', readings: ['1', '2', '3', '4', '5', '6'] }] },
      ifm(s.version),
    );
    expect(tooMany.status).toBe(422);
    const sub = await v.call('post', `/qms/inspections/${s.id}/submit`, {}, ifm(s.version));
    expect(sub.status, JSON.stringify(sub.body)).toBe(200);
    // conditional acceptance needs the condition
    const w = body(
      await v.call('post', '/qms/inspections', {
        kind: 'WELDING',
        header: {
          stage: 'AFTER',
          acceptance_class: 'C',
          weld_no: 'W-1',
          welder_no: 'WD-7',
          wps_no: 'WPS-3',
        },
        rows: [
          { label: 'Undercut', rowType: 'ATTRIBUTE', readings: ['NOT OK'] },
          { label: 'Spatter', rowType: 'ATTRIBUTE', readings: ['OK'] },
        ],
      }),
    );
    expect(w.number).toMatch(/^WLD/);
    const c1 = await v.call(
      'post',
      `/qms/inspections/${w.id}/submit`,
      { result: 'CONDITIONAL' },
      ifm(w.version),
    );
    expect(c1.status).toBe(422);
    const c2 = await v.call(
      'post',
      `/qms/inspections/${w.id}/submit`,
      { result: 'CONDITIONAL', note: 'Grind and re-inspect' },
      ifm(w.version),
    );
    expect(c2.status, JSON.stringify(c2.body)).toBe(200);
    // bad header value and stage not in the list
    const bad = await v.call('post', '/qms/inspections', {
      kind: 'WELDING',
      header: { stage: 'DURING' },
    });
    expect(bad.status).toBe(422);
    // the combined list sees both
    const all = body(await v.call('get', '/qms/inspections?size=100'));
    expect(all.some((x: any) => x.id === w.id)).toBe(true);
    expect(all.some((x: any) => x.id === s.id)).toBe(true);
  });

  it('an expired instrument cannot be used on a sheet', async () => {
    const { v } = ctx;
    // a customer-wise ISIR template that has an instrument field
    await v.call('post', '/qms/templates', {
      kind: 'VT',
      name: 'VT with instrument',
      headerFields: [
        { key: 'part', label: 'Part', type: 'text' },
        { key: 'gauge', label: 'Gauge', type: 'instrument', required: true },
      ],
      reason: 'Add the gauge used',
    });
    const inst = body(
      await v.call('post', '/qms/instruments', {
        historyCardNo: `HC-${tag()}`,
        name: 'Vernier 150',
        equipmentNo: `EQ-${tag()}`,
        frequencyMonths: 12,
      }),
    );
    const sheet = body(
      await v.call('post', '/qms/inspections', {
        kind: 'VT',
        header: { part: 'P', gauge: inst.id },
        rows: [{ label: 'Weld', rowType: 'ATTRIBUTE', readings: ['OK'] }],
      }),
    );
    // never calibrated -> refused
    const r = await v.call('post', `/qms/inspections/${sheet.id}/submit`, {}, ifm(sheet.version));
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('QMS_INSTRUMENT_EXPIRED');
    expect(
      (
        await v.call('post', `/qms/instruments/${inst.id}/calibrate`, {
          calibratedOn: TODAY,
          result: 'PASS',
          certificateNo: 'C-1',
        })
      ).status,
    ).toBe(200);
    const ok = await v.call('post', `/qms/inspections/${sheet.id}/submit`, {}, ifm(sheet.version));
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  });
});

describe('8D, alert, MOM and continuous improvement', () => {
  it('closes only when the template says the form is complete', async () => {
    const { v } = ctx;
    const item = await mkItem({ itemType: 'Finished Goods' });
    const d = await v.call('post', '/qms/forms', {
      kind: 'EIGHT_D',
      title: 'Paint peel on bracket',
      data: { d1_team: 'QA, Prod', d2_problem: 'Paint peels after 3 days' },
    });
    expect(d.status, JSON.stringify(d.body)).toBe(201);
    const f = body(d);
    expect(f.number).toMatch(/^8D/);
    const no = await v.call('post', `/qms/forms/${f.id}/close`, {}, ifm(f.version));
    expect(no.status).toBe(422);
    expect(Object.keys(no.body.error.fields).sort()).toEqual([
      'capaRef',
      'd4_root_cause',
      'd5_corrective',
      'd7_prevent',
    ]);
    const up = body(
      await patch(
        `/qms/forms/${f.id}`,
        {
          capaRef: 'CAPA-2026-01',
          data: {
            d1_team: 'QA, Prod',
            d2_problem: 'Paint peels',
            d4_root_cause: 'Pre-treatment bath low',
            d5_corrective: 'Maintain bath',
            d7_prevent: 'Daily titration',
            why_made: 'a;b;c',
            why_missed: 'x;y',
          },
        },
        ifm(f.version),
      ),
    );
    const closed = await v.call(
      'post',
      `/qms/forms/${f.id}/close`,
      { note: 'verified' },
      ifm(up.version),
    );
    expect(closed.status, JSON.stringify(closed.body)).toBe(200);
    expect(body(closed).status).toBe('Closed');
    expect(
      (await patch(`/qms/forms/${f.id}`, { title: 'x' }, ifm(body(closed).version))).status,
    ).toBe(409);

    const qa = await v.call('post', '/qms/forms', {
      kind: 'ALERT',
      title: 'Burr on flange',
      data: { part: item.id, notification_date: TODAY, issue: 'Burr found' },
    });
    expect(qa.status, JSON.stringify(qa.body)).toBe(201);
    expect(body(qa).itemId).toBe(item.id);
    const badQa = await v.call('post', '/qms/forms', {
      kind: 'ALERT',
      title: 'x',
      data: { part: 'not-an-id' },
    });
    expect(badQa.status).toBe(422);
    const mom = await v.call('post', '/qms/forms', {
      kind: 'MOM',
      title: 'Monthly quality review',
      data: { agenda: 'PPM, complaints', points: 'Reduce rejection / QA head / Nov' },
    });
    expect(mom.status).toBe(201);
    const ci = body(
      await v.call('post', '/qms/forms', {
        kind: 'CI',
        title: 'Cut scrap',
        data: { theme: 'Scrap', project_no: 'CI-01', category: 'Q' },
      }),
    );
    expect((await v.call('post', `/qms/forms/${ci.id}/close`, {}, ifm(ci.version))).status).toBe(
      422,
    );
    expect((await v.call('post', `/qms/forms/${ci.id}/cancel`, { reason: 'merged' })).status).toBe(
      200,
    );
    const open = body(await v.call('get', '/qms/forms?kind=EIGHT_D&status=Open&size=100'));
    expect(open.some((x: any) => x.id === f.id)).toBe(false);
  });
});

describe('rejection register, PPM and quality cost', () => {
  it('summarises a month and computes PPM and cost % against targets', async () => {
    const { v } = ctx;
    const M = '2026-03';
    await prisma.$executeRawUnsafe(
      `DELETE FROM qms_cost_entries WHERE unit_id=$1::uuid`,
      ctx.fx.unitId,
    );
    const mk = async (qty: number, process: string, defectType: string) =>
      v.call('post', '/qms/rejections', {
        rejectDate: `${M}-10`,
        process,
        operator: 'Ravi',
        part: 'Bracket',
        holdQty: qty,
        defect: 'Burr',
        defectType,
      });
    const r1 = await mk(5, 'Machining', 'DIMENSIONAL');
    expect(r1.status, JSON.stringify(r1.body)).toBe(201);
    await mk(3, 'Machining', 'VISUAL');
    await mk(2, 'Painting', 'VISUAL');
    const e = body(r1);
    expect(e.status).toBe('Open');
    const disposed = await v.call(
      'post',
      `/qms/rejections/${e.id}/dispose`,
      { disposition: 'REWORK' },
      ifm(e.version),
    );
    expect(disposed.status).toBe(422); // a rework needs the note
    const ok = await v.call(
      'post',
      `/qms/rejections/${e.id}/dispose`,
      { disposition: 'REWORK', note: 'Deburr and re-inspect' },
      ifm(e.version),
    );
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(body(ok).status).toBe('Closed');
    const sum = body(await v.call('get', `/qms/rejections/summary?month=${M}`));
    expect(sum.total).toMatchObject({ entries: 3, qty: '10' });
    expect(sum.byProcess).toEqual([
      { key: 'Machining', entries: 2, qty: '8' },
      { key: 'Painting', entries: 1, qty: '2' },
    ]);
    expect(sum.byDisposition.find((x: any) => x.key === 'REWORK')).toMatchObject({ qty: '5' });

    // PPM: 10,000 produced, 25 rejected, 5 returned by customers
    const noTarget = body(
      await v.call('put', '/qms/monthly', {
        month: M,
        producedQty: 10000,
        rejectedQty: 25,
        customerRejectedQty: 5,
        salesValue: 500000,
      }),
    );
    expect(noTarget.months[0]).toMatchObject({
      month: M,
      internalPpm: '2500.00',
      customerPpm: '500.00',
      internalVsTarget: null,
    });
    expect(
      (
        await v.call('put', '/qms/monthly', {
          month: M,
          producedQty: 10,
          rejectedQty: 25,
          customerRejectedQty: 0,
          salesValue: 1,
        })
      ).status,
    ).toBe(422);
    for (const [key, value] of [
      ['INTERNAL_PPM_TARGET', 3000],
      ['CUSTOMER_PPM_TARGET', 400],
    ] as const)
      expect((await v.call('put', '/qms/settings', { key, value, scope: 'UNIT' })).status).toBe(
        200,
      );
    const ppmR = body(await v.call('get', `/qms/reports/ppm?from=${M}&to=${M}`));
    expect(ppmR.months[0]).toMatchObject({ internalVsTarget: 'OK', customerVsTarget: 'OVER' });
    expect(ppmR.totals).toMatchObject({ produced: '10000', internalPpm: '2500.00' });

    // quality cost: 1000 + 2000 + 3000 + 4000 on sales of 5,00,000 = 2.00 %
    for (const [category, amount] of [
      ['PREVENTION', 1000],
      ['APPRAISAL', 2000],
      ['INTERNAL_FAILURE', 3000],
      ['EXTERNAL_FAILURE', 4000],
    ] as const)
      expect(
        (await v.call('post', '/qms/costs', { month: M, category, description: category, amount }))
          .status,
      ).toBe(201);
    await v.call('put', '/qms/settings', {
      key: 'QUALITY_COST_PCT_TARGET',
      value: 1.5,
      scope: 'UNIT',
    });
    const cost = body(await v.call('get', `/qms/reports/quality-cost?from=${M}&to=${M}`));
    expect(cost.months[0]).toMatchObject({
      prevention: '1000.00',
      appraisal: '2000.00',
      internalFailure: '3000.00',
      externalFailure: '4000.00',
      total: '10000.00',
      salesValue: '500000.00',
      costPercent: '2.00',
      vsTarget: 'OVER',
    });
    expect(cost.totals.costPercent).toBe('2.00');
    // the cost list and a delete
    const list = body(await v.call('get', `/qms/costs?month=${M}`));
    expect(list.rows).toHaveLength(4);
    expect((await v.call('delete', `/qms/costs/${list.rows[0].id}`)).status).toBe(204);
    expect(
      body(await v.call('get', `/qms/reports/quality-cost?from=${M}&to=${M}`)).months[0]
        .costPercent,
    ).not.toBe('2.00');
  });
});

describe('instruments and calibration reminders', () => {
  it('records calibrations, moves the validity and reminds once', async () => {
    const { v, fx } = ctx;
    const mk = (n: string) =>
      v.call('post', '/qms/instruments', {
        historyCardNo: `HC-${n}-${tag()}`,
        name: `Gauge ${n}`,
        equipmentNo: `EQ-${n}-${tag()}`,
        division: 'Quality',
        measuringRange: '0-150 mm',
        leastCount: '0.02 mm',
        frequencyMonths: 6,
      });
    const a = body(await mk('A'));
    expect(a.calibrationStatus).toBe('NOT_CALIBRATED');
    expect(
      (
        await v.call('post', '/qms/instruments', {
          historyCardNo: a.historyCardNo,
          name: 'dup',
          equipmentNo: 'EQ-DUP-1',
        })
      ).status,
    ).toBe(409);
    // calibrated 6 months ago for 6 months: due now
    const from = addMonths(TODAY, -6);
    const cal = await v.call('post', `/qms/instruments/${a.id}/calibrate`, {
      calibratedOn: from,
      result: 'PASS',
      certificateNo: 'NABL-1',
      agency: 'Lab',
    });
    expect(cal.status, JSON.stringify(cal.body)).toBe(200);
    const c = body(cal);
    expect(c.validUntil).toBe(TODAY);
    expect(c.calibrationStatus).toBe('DUE_SOON');
    expect(c.calibrations).toHaveLength(1);
    // a failed calibration takes it out of service and needs the error
    expect(
      (
        await v.call('post', `/qms/instruments/${a.id}/calibrate`, {
          calibratedOn: TODAY,
          result: 'FAIL',
        })
      ).status,
    ).toBe(422);
    const fail = body(
      await v.call('post', `/qms/instruments/${a.id}/calibrate`, {
        calibratedOn: TODAY,
        result: 'FAIL',
        errorFound: '0.1 mm out',
      }),
    );
    expect(fail.status).toBe('OUT_OF_SERVICE');
    expect(fail.validUntil).toBe(TODAY);
    const pass = body(
      await v.call('post', `/qms/instruments/${a.id}/calibrate`, {
        calibratedOn: TODAY,
        result: 'PASS',
      }),
    );
    expect(pass.status).toBe('ACTIVE');
    expect(pass.validUntil).toBe(addMonths(TODAY, 6));
    expect(pass.calibrations).toHaveLength(3);
    // another instrument whose validity runs out in 5 days -> one reminder, not two
    const b = body(await mk('B'));
    await prisma.$executeRawUnsafe(
      `UPDATE qms_instruments SET valid_until=(CURRENT_DATE + 5) WHERE id=$1::uuid`,
      b.id,
    );
    const due = body(await v.call('get', '/qms/instruments?due=true&size=100'));
    expect(due.some((x: any) => x.id === b.id)).toBe(true);
    expect(due.some((x: any) => x.id === pass.id)).toBe(false);
    const before = await prisma.notification.count({
      where: { type: 'QMS_CALIBRATION_DUE', entityId: b.id },
    });
    await runQmsDaily();
    await runQmsDaily();
    const after = await prisma.notification.count({
      where: { type: 'QMS_CALIBRATION_DUE', entityId: b.id },
    });
    expect(after).toBeGreaterThan(before);
    const once = await prisma.notification.groupBy({
      by: ['userId'],
      where: { type: 'QMS_CALIBRATION_DUE', entityId: b.id },
      _count: true,
    });
    expect(once.every((x) => x._count === 1)).toBe(true);
    void fx;
  });
});
