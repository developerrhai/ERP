// Phase 05 approval engine through the real API (docs/phases/PHASE-05.md §10): matrix validation,
// specificity, snapshot, level selection, segregation of duties, limits, department source,
// concurrency (Promise.all), the full lifecycle, locking, delegation and the audit rows.
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { invalidateAccessCache } from '../src/core/rbac/access';
import { resolveRuleSet } from '../src/modules/approvals/matrix';
import {
  API,
  auditRows,
  errorOf,
  makeUser,
  newApp,
  prisma,
  signIn,
  signInOwner,
  unitIds,
} from './helpers';
import type { Signed } from './helpers';
import { makeDepartment } from './phase2-helpers';
import { api, dataOf, sampleData, schemaOf } from './phase4-helpers';
import type { RecordBody } from './phase4-helpers';

const app = newApp();
const client = api(app);
const PAGE = 'scm-po';
const MONEY = schemaOf(PAGE).fields.find((f) => f.type === 'money')?.key ?? 'subtotal';
const DEPT = 'Purchase';

let TAL: string;
let owner: Signed;
let emp: Signed;
let mgr: Signed;
let head: Signed;
let gm: Signed;
let director: Signed;
let n = 0;

interface Req {
  id: string;
  status: string;
  version: number;
  currentLevel: number;
  totalLevels: number;
  steps: {
    level: number;
    status: string;
    actedBy: { name: string } | null;
    onBehalfOf: { name: string } | null;
  }[];
  timeline: {
    action: string;
    actor: { name: string } | null;
    onBehalfOf: { name: string } | null;
  }[];
  can: { approve: boolean; reject: boolean; return: boolean; withdraw: boolean };
}

const hdr = (s: Signed) => ({ ...s.bearer, 'X-Unit-Id': TAL });

async function setLimit(s: Signed, limit: number | null) {
  await prisma.user.update({ where: { id: s.user.id }, data: { approvalLimit: limit } });
}

async function newDoc(creator: Signed, amount: number | null, extra: Record<string, unknown> = {}) {
  n += 1;
  const data = { ...sampleData(schemaOf(PAGE), n), ...extra };
  if (amount === null) delete data[MONEY];
  else data[MONEY] = amount;
  const res = await client.create(creator, PAGE, data, { unit: TAL });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return dataOf<RecordBody>(res);
}

function submit(s: Signed, id: string, version: number, key?: string) {
  const r = request(app)
    .post(`${API}/pages/${PAGE}/records/${id}/submit`)
    .set(hdr(s))
    .set('If-Match', String(version));
  return key ? r.set('Idempotency-Key', key) : r;
}

async function pendingRequest(docId: string): Promise<Req> {
  const row = await prisma.approvalRequest.findFirstOrThrow({
    where: { docId },
    orderBy: { cycle: 'desc' },
  });
  return dataOf<Req>(await request(app).get(`${API}/approvals/requests/${row.id}`).set(hdr(owner)));
}

function decide(
  s: Signed,
  id: string,
  verb: string,
  version: number,
  body: Record<string, unknown> = {},
  key?: string,
) {
  const r = request(app)
    .post(`${API}/approvals/requests/${id}/${verb}`)
    .set(hdr(s))
    .set('If-Match', String(version));
  return (key ? r.set('Idempotency-Key', key) : r).send(body);
}

/** Submits as `emp` and returns the pending request. */
async function submitted(amount: number | null, creator: Signed = emp) {
  const doc = await newDoc(creator, amount);
  const res = await submit(creator, doc.id, doc.version);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return { doc, req: await pendingRequest(doc.id) };
}

const level = (
  l: number,
  threshold: number,
  roleId: string,
  extra: Record<string, unknown> = {},
) => ({
  level: l,
  threshold,
  approverRoleId: roleId,
  slaHours: 48,
  ...extra,
});

beforeAll(async () => {
  TAL = (await unitIds(['TAL']))[0] as string;
  owner = await signInOwner(app);
  const mk = async (role: string, limit: number | null) =>
    signIn(app, await makeUser({ role, department: DEPT, approvalLimit: limit }));
  emp = await mk('EMPLOYEE', 0);
  mgr = await mk('DEPT_MANAGER', 100_000);
  head = await mk('DEPT_HEAD', 100_000);
  gm = await mk('GENERAL_MANAGER', 1_000_000);
  director = await mk('DIRECTOR', 50_000_000);
  invalidateAccessCache();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('seed', () => {
  it('has the prototype matrix: 9 non-Administration departments seeded here, 4 levels each, CFO for Finance', async () => {
    const sets = await prisma.approvalRuleSet.findMany({
      where: { docType: null, unitId: null },
      include: { rules: { orderBy: { level: 'asc' } } },
    });
    expect(sets.length).toBeGreaterThanOrEqual(10);
    for (const s of sets) {
      expect(s.rules.map((r) => Number(r.threshold))).toEqual([0, 50000, 200000, 1000000]);
      expect(s.rules.every((r) => r.slaHours === 48)).toBe(true);
    }
    const finance = await prisma.department.findUniqueOrThrow({ where: { name: 'Finance' } });
    const fin = sets.find((s) => s.departmentId === finance.id);
    const cfo = await prisma.role.findUniqueOrThrow({ where: { code: 'CFO' } });
    expect(fin?.rules[3]?.approverRoleId).toBe(cfo.id);
    expect(sets.reduce((sum, s) => sum + s.rules.length, 0)).toBe(sets.length * 4);
  });
});

describe('matrix API', () => {
  let roleId: string;
  let deptName: string;

  beforeAll(async () => {
    roleId = (await prisma.role.findUniqueOrThrow({ where: { code: 'DEPT_MANAGER' } })).id;
    deptName = (await makeDepartment()).name;
  });

  const put = (body: Record<string, unknown>, s: Signed = owner) =>
    request(app).put(`${API}/approval-matrix/sets`).set(s.bearer).send(body);
  const base = () => ({ department: deptName, noAmountLevels: 1 });

  it.each([
    [
      'gap',
      [level(1, 0, 'R'), level(3, 50000, 'R')],
      'MATRIX_LEVEL_GAP',
      'Levels must run 1, 2, 3… without gaps. Level 2 is missing.',
    ],
    ['first threshold', [level(1, 10, 'R')], 'MATRIX_FIRST_THRESHOLD', 'Level 1 must start at ₹0.'],
    [
      'order',
      [level(1, 0, 'R'), level(2, 50000, 'R'), level(3, 50000, 'R')],
      'MATRIX_THRESHOLD_ORDER',
      'Level 3 threshold must be higher than level 2 (₹50,000).',
    ],
  ])('rejects %s', async (_name, levels, code, message) => {
    const res = await put({
      ...base(),
      levels: levels.map((l) => ({ ...l, approverRoleId: roleId })),
    });
    expect(res.status).toBe(422);
    expect(errorOf(res).code).toBe(code);
    expect(errorOf(res).message).toBe(message);
  });

  it('rejects role + user together or neither, and the same user on two levels', async () => {
    const u = await makeUser({ role: 'DEPT_HEAD', department: deptName });
    const both = await put({
      ...base(),
      levels: [{ ...level(1, 0, roleId), approverUserId: u.id }],
    });
    expect(errorOf(both).code).toBe('MATRIX_APPROVER_REQUIRED');
    expect(errorOf(both).message).toBe('Choose a role or a named user for level 1, not both.');
    const same = await put({
      ...base(),
      levels: [
        { level: 1, threshold: 0, approverUserId: u.id, slaHours: 48 },
        { level: 2, threshold: 1000, approverUserId: u.id, slaHours: 48 },
      ],
    });
    expect(errorOf(same).code).toBe('MATRIX_SAME_USER');
    expect(errorOf(same).message).toBe(
      `${u.name} cannot be the approver at two levels of the same set.`,
    );
  });

  it('creates, updates (version) and refuses a duplicate set; the default set cannot be deleted', async () => {
    const created = await put({ ...base(), levels: [level(1, 0, roleId)] });
    expect(created.status).toBe(201);
    const set = dataOf<{ id: string; version: number; isDefault: boolean }>(created);
    expect(set.isDefault).toBe(true);
    const dup = await put({ ...base(), levels: [level(1, 0, roleId)] });
    expect(dup.status).toBe(409);
    expect(errorOf(dup).code).toBe('MATRIX_DUPLICATE_SET');
    const upd = await put({
      ...base(),
      id: set.id,
      version: set.version,
      levels: [level(1, 0, roleId), level(2, 5000, roleId)],
    });
    expect(upd.status).toBe(200);
    const stale = await put({
      ...base(),
      id: set.id,
      version: set.version,
      levels: [level(1, 0, roleId)],
    });
    expect(stale.status).toBe(409);
    const del = await request(app)
      .delete(`${API}/approval-matrix/sets/${set.id}`)
      .set(owner.bearer);
    expect(del.status).toBe(409);
    expect((await auditRows('APPROVAL_MATRIX_CHANGED', { targetId: set.id })).length).toBe(2);
  });

  it('needs "controls" to write and "view" to read', async () => {
    const res = await put({ ...base(), levels: [level(1, 0, roleId)] }, emp);
    expect(res.status).toBe(403);
    const list = await request(app).get(`${API}/approval-matrix`).set(emp.bearer);
    expect(list.status).toBe(403);
    const ok = await request(app)
      .get(`${API}/approval-matrix?department=Purchase`)
      .set(owner.bearer);
    expect(ok.status).toBe(200);
    expect(dataOf<unknown[]>(ok).length).toBeGreaterThanOrEqual(1);
  });

  it('previews the chosen levels and the approvers by name', async () => {
    const res = await request(app)
      .post(`${API}/approval-matrix/preview`)
      .set(owner.bearer)
      .send({ department: DEPT, docType: PAGE, amount: 300000 });
    expect(res.status).toBe(200);
    const body = dataOf<{ levels: { level: number; approvers: { name: string }[] }[] }>(res);
    expect(body.levels.map((l) => l.level)).toEqual([1, 2, 3]);
    expect(body.levels[0]?.approvers.map((a) => a.name)).toContain(mgr.user.name);
  });
});

describe('rule set resolution', () => {
  it('the most specific set wins as a whole: dept+doc+unit > dept+doc > dept+unit > dept', async () => {
    const dept = await makeDepartment();
    const d = await prisma.department.findUniqueOrThrow({ where: { name: dept.name } });
    const [unit] = await unitIds(['SAW']);
    const mkSet = (docType: string | null, unitId: string | null) =>
      prisma.approvalRuleSet.create({ data: { departmentId: d.id, docType, unitId } });
    const [dflt, byUnit, byDoc, both] = [
      await mkSet(null, null),
      await mkSet(null, unit as string),
      await mkSet(PAGE, null),
      await mkSet(PAGE, unit as string),
    ];
    const at = (doc: string, u: string) => resolveRuleSet(prisma, d.id, doc, u).then((s) => s?.id);
    expect(await at(PAGE, unit as string)).toBe(both.id);
    expect(await at(PAGE, TAL)).toBe(byDoc.id);
    expect(await at('scm-pr', unit as string)).toBe(byUnit.id);
    expect(await at('scm-pr', TAL)).toBe(dflt.id);
    await prisma.approvalRuleSet.update({ where: { id: both.id }, data: { active: false } });
    expect(await at(PAGE, unit as string)).toBe(byDoc.id);
  });
});

describe('levels and the one-level / limit rules', () => {
  it.each([
    [0, 1],
    [49_999, 1],
    [50_000, 2],
    [200_000, 3],
    [1_000_000, 4],
    [1_000_001, 4],
  ])('amount %i needs %i level(s)', async (amount, levels) => {
    const { req } = await submitted(amount);
    expect(req.totalLevels).toBe(levels);
    expect(req.steps.length).toBe(levels);
  });

  it('a document with no amount needs no_amount_levels (default 1)', async () => {
    const { req } = await submitted(null);
    expect(req.totalLevels).toBe(1);
  });
});

describe('lifecycle', () => {
  it('₹3,00,000 runs Manager -> Head -> GM, each a different person, with names and times', async () => {
    const { doc, req } = await submitted(300_000);
    expect(req.totalLevels).toBe(3);
    expect(req.can.withdraw).toBe(false); // owner is not the requester
    let r: Req = req;
    for (const [who, expected] of [
      [mgr, 'PENDING'],
      [head, 'PENDING'],
      [gm, 'APPROVED'],
    ] as const) {
      const res = await decide(who, r.id, 'approve', r.version, {}, `k-${doc.id}-${who.user.id}`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      r = dataOf<Req>(res);
      expect(r.status).toBe(expected);
    }
    expect(r.steps.map((s) => s.actedBy?.name)).toEqual([
      mgr.user.name,
      head.user.name,
      gm.user.name,
    ]);
    const record = dataOf<RecordBody>(await client.get(emp, PAGE, doc.id, { unit: TAL }));
    expect(record.status).toBe('Approved');
    const audits = (await auditRows('APPROVAL_APPROVED_LEVEL', { targetId: doc.id })).length;
    expect(audits).toBe(2);
    expect((await auditRows('APPROVAL_APPROVED', { targetId: doc.id })).length).toBe(1);
    expect((await auditRows('APPROVAL_SUBMITTED', { targetId: doc.id })).length).toBe(1);
  });

  it('reject -> edit -> resubmit starts cycle 2; return -> Draft; withdraw -> Draft', async () => {
    const { doc, req } = await submitted(10_000);
    const short = await decide(mgr, req.id, 'reject', req.version, { comment: 'no' });
    expect(short.status).toBe(422);
    expect(errorOf(short).code).toBe('COMMENT_REQUIRED');
    expect(errorOf(short).message).toBe('Please write a reason (at least 10 characters).');
    const rej = await decide(mgr, req.id, 'reject', req.version, { comment: 'Quote is missing' });
    expect(rej.status).toBe(200);
    let rec = dataOf<RecordBody>(await client.get(emp, PAGE, doc.id, { unit: TAL }));
    expect(rec.status).toBe('Rejected');
    // a Rejected document is editable again
    const edit = await client.patch(
      emp,
      PAGE,
      doc.id,
      rec.version,
      { [MONEY]: 11_000 },
      { unit: TAL },
    );
    expect(edit.status, JSON.stringify(edit.body)).toBe(200);
    rec = dataOf<RecordBody>(edit);
    expect((await submit(emp, doc.id, rec.version)).status).toBe(200);
    const second = await pendingRequest(doc.id);
    expect(second.id).not.toBe(req.id);
    expect(
      await prisma.approvalRequest
        .findUniqueOrThrow({ where: { id: second.id } })
        .then((r) => r.cycle),
    ).toBe(2);

    const ret = await decide(mgr, second.id, 'return', second.version, {
      comment: 'Please add the GST number',
    });
    expect(ret.status).toBe(200);
    rec = dataOf<RecordBody>(await client.get(emp, PAGE, doc.id, { unit: TAL }));
    expect(rec.status).toBe('Draft');

    expect((await submit(emp, doc.id, rec.version)).status).toBe(200);
    const third = await pendingRequest(doc.id);
    const wd = await decide(emp, third.id, 'withdraw', third.version);
    expect(wd.status, JSON.stringify(wd.body)).toBe(200);
    rec = dataOf<RecordBody>(await client.get(emp, PAGE, doc.id, { unit: TAL }));
    expect(rec.status).toBe('Draft');
    const actions = (await pendingRequest(doc.id)).timeline.map((a) => a.action);
    expect(actions).toEqual(['SUBMIT', 'WITHDRAW']);
  });

  it('approval_required = false goes straight to Approved with AUTO_APPROVED evidence', async () => {
    const page = 'scm-pr';
    await prisma.moduleControl.update({
      where: { pageId: page },
      data: { approvalRequired: false },
    });
    try {
      invalidateAccessCache();
      const data = { ...sampleData(schemaOf(page), 77) };
      const created = dataOf<RecordBody>(await client.create(emp, page, data, { unit: TAL }));
      const res = await request(app)
        .post(`${API}/pages/${page}/records/${created.id}/submit`)
        .set(hdr(emp))
        .set('If-Match', String(created.version));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(dataOf<RecordBody>(res).status).toBe('Approved');
      const act = await prisma.approvalAction.findFirstOrThrow({
        where: { request: { docId: created.id } },
      });
      expect(act.action).toBe('AUTO_APPROVED');
    } finally {
      await prisma.moduleControl.update({
        where: { pageId: page },
        data: { approvalRequired: true },
      });
      invalidateAccessCache();
    }
  });
});

describe('submit rules', () => {
  it('a second submit is 409 ALREADY_PENDING (also when two arrive at once)', async () => {
    const doc = await newDoc(emp, 1000);
    const [a, b] = await Promise.all([
      submit(emp, doc.id, doc.version),
      submit(emp, doc.id, doc.version),
    ]);
    const codes = [a, b].map((r) => r.status).sort();
    expect(codes).toEqual([200, 409]);
    const loser = a.status === 409 ? a : b;
    expect(errorOf(loser).code).toBe('ALREADY_PENDING');
    expect(errorOf(loser).message).toBe('Already pending approval.');
    expect(await prisma.approvalRequest.count({ where: { docId: doc.id } })).toBe(1);
  });

  it('only Draft or Rejected can be submitted', async () => {
    const { doc } = await submitted(500);
    const again = await submit(emp, doc.id, doc.version + 1);
    expect(errorOf(again).code).toBe('ALREADY_PENDING');
    await prisma.genericRecord.update({ where: { id: doc.id }, data: { status: 'Approved' } });
    const res = await submit(emp, doc.id, doc.version);
    expect(res.status).toBe(409);
    expect(errorOf(res).code).toBe('NOT_SUBMITTABLE');
    expect(errorOf(res).message).toBe(
      'Only Draft or Rejected documents can be submitted. This one is Approved.',
    );
  });

  it('a user without "submit" gets 403', async () => {
    const noSubmit = await signIn(app, await makeUser({ role: 'EMPLOYEE', department: DEPT }));
    await prisma.rolePermission.updateMany({
      where: { role: { code: 'EMPLOYEE' }, resource: '*' },
      data: { submit: false },
    });
    invalidateAccessCache();
    try {
      const doc = await newDoc(emp, 10);
      const res = await submit(noSubmit, doc.id, doc.version);
      expect(res.status).toBe(403);
    } finally {
      await prisma.rolePermission.updateMany({
        where: { role: { code: 'EMPLOYEE' }, resource: '*' },
        data: { submit: true },
      });
      invalidateAccessCache();
    }
  });

  it('the department comes from the stored document, never from the body', async () => {
    const { req } = await submitted(100);
    const row = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: req.id } });
    const dept = await prisma.department.findUniqueOrThrow({ where: { name: DEPT } });
    expect(row.departmentId).toBe(dept.id);
    const doc = await newDoc(emp, 100);
    const res = await request(app)
      .post(`${API}/pages/${PAGE}/records/${doc.id}/submit`)
      .set(hdr(emp))
      .set('If-Match', String(doc.version))
      .send({ department: 'Sales', amount: 99_999_999 });
    expect(res.status).toBe(200);
    const sent = await prisma.approvalRequest.findFirstOrThrow({ where: { docId: doc.id } });
    expect(sent.departmentId).toBe(dept.id);
    expect(Number(sent.amount)).toBe(100);
  });

  it('NO_APPROVAL_RULE when a department has no set; NO_ELIGIBLE_APPROVER when nobody else can decide', async () => {
    const noRules = await makeDepartment(['Procurement / SCM']);
    const staff = await signIn(app, await makeUser({ role: 'EMPLOYEE', department: noRules.name }));
    const doc = await newDoc(staff, 100);
    const res = await submit(staff, doc.id, doc.version);
    expect(res.status).toBe(422);
    expect(errorOf(res).code).toBe('NO_APPROVAL_RULE');
    expect(errorOf(res).message).toBe(
      `No approval rules are set for ${noRules.name}. Ask the administrator to add them in Approval Matrix.`,
    );
    const dept = await prisma.department.findUniqueOrThrow({ where: { name: noRules.name } });
    const manager = await prisma.role.findUniqueOrThrow({ where: { code: 'DEPT_MANAGER' } });
    await prisma.approvalRuleSet.create({
      data: {
        departmentId: dept.id,
        rules: { create: [{ level: 1, threshold: 0, approverRoleId: manager.id, slaHours: 48 }] },
      },
    });
    const res2 = await submit(staff, doc.id, doc.version);
    expect(res2.status).toBe(422);
    expect(errorOf(res2).code).toBe('NO_ELIGIBLE_APPROVER');
    expect(errorOf(res2).message).toBe(
      'Nobody other than you can approve level 1 (Department Manager). Ask the administrator to assign an approver.',
    );
  });
});

describe('segregation of duties and limits', () => {
  it('the requester and the creator cannot approve; a Director cannot approve L1; Super User is refused', async () => {
    const creator = await signIn(app, await makeUser({ role: 'SUPERVISOR', department: DEPT }));
    // created by `creator`, submitted by `emp`
    const doc = await newDoc(creator, 100);
    await prisma.rolePermission.updateMany({
      where: { role: { code: 'EMPLOYEE' }, resource: '*' },
      data: { scope: 'ALL' },
    });
    invalidateAccessCache();
    try {
      expect((await submit(emp, doc.id, doc.version)).status).toBe(200);
    } finally {
      await prisma.rolePermission.updateMany({
        where: { role: { code: 'EMPLOYEE' }, resource: '*' },
        data: { scope: 'OWN' },
      });
      invalidateAccessCache();
    }
    const req = await pendingRequest(doc.id);
    for (const s of [emp, creator]) {
      const res = await decide(s, req.id, 'approve', req.version);
      expect(res.status).toBe(403);
      expect(errorOf(res).code).toBe('SELF_APPROVAL');
      expect(errorOf(res).message).toBe('You cannot approve a request you raised or created.');
    }
    const dir = await decide(director, req.id, 'approve', req.version);
    expect(dir.status).toBe(403);
    expect(errorOf(dir).code).toBe('NOT_YOUR_LEVEL');
    expect(errorOf(dir).message).toBe(
      'This level needs Department Manager. You are not an approver for it.',
    );
    const su = await decide(owner, req.id, 'approve', req.version);
    expect(su.status).toBe(403);
    expect(errorOf(su).code).toBe('NOT_YOUR_LEVEL');
  });

  it('one user approves at most one level (a user holding two eligible roles is still blocked)', async () => {
    const { req } = await submitted(60_000);
    expect((await decide(mgr, req.id, 'approve', req.version)).status).toBe(200);
    const row = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: req.id } });
    // The same user is forced into the next level's pool (e.g. by Reassign): still refused.
    const step2 = await prisma.approvalStep.findFirstOrThrow({
      where: { requestId: req.id, level: 2 },
    });
    await prisma.approvalStepAssignee.create({
      data: { stepId: step2.id, userId: mgr.user.id, via: 'REASSIGN' },
    });
    const res = await decide(mgr, req.id, 'approve', row.version);
    expect(res.status).toBe(403);
    expect(errorOf(res).code).toBe('ONE_LEVEL_ONLY');
    expect(errorOf(res).message).toBe(
      'You already approved level 1 of this request. Another approver must act.',
    );
  });

  it('the final-level approver needs a limit >= the amount (OVER_LIMIT) and a raised limit works', async () => {
    const lowGm = await signIn(
      app,
      await makeUser({ role: 'GENERAL_MANAGER', department: DEPT, approvalLimit: 500_000 }),
    );
    const bigGm = gm;
    invalidateAccessCache();
    const { req } = await submitted(800_000);
    let r = req;
    r = dataOf<Req>(await decide(mgr, r.id, 'approve', r.version));
    r = dataOf<Req>(await decide(head, r.id, 'approve', r.version));
    const over = await decide(lowGm, r.id, 'approve', r.version);
    expect(over.status).toBe(403);
    expect(errorOf(over).code).toBe('OVER_LIMIT');
    expect(errorOf(over).message).toBe(
      'This needs an approval limit of ₹8,00,000. Your limit is ₹5,00,000.',
    );
    await setLimit(lowGm, 1_000_000);
    expect((await decide(lowGm, r.id, 'approve', r.version)).status).toBe(200);
    expect(bigGm).toBeDefined();
  });

  it('refuses a submit when nobody at the final level has a high enough limit', async () => {
    const dir0 = await prisma.user.findMany({
      where: { role: { code: 'DIRECTOR' }, status: 'ACTIVE' },
    });
    const saved = dir0.map((u) => [u.id, u.approvalLimit] as const);
    await prisma.user.updateMany({
      where: { role: { code: 'DIRECTOR' } },
      data: { approvalLimit: 10 },
    });
    try {
      const doc = await newDoc(emp, 5_000_000);
      const res = await submit(emp, doc.id, doc.version);
      expect(res.status).toBe(422);
      expect(errorOf(res).code).toBe('NO_ELIGIBLE_APPROVER');
    } finally {
      for (const [id, limit] of saved)
        await prisma.user.update({ where: { id }, data: { approvalLimit: limit } });
    }
  });
});

describe('concurrency and idempotency', () => {
  it('two approvers on the same step at once: exactly one 200 and one 409', async () => {
    const mgr2 = await signIn(
      app,
      await makeUser({ role: 'DEPT_MANAGER', department: DEPT, approvalLimit: 100_000 }),
    );
    invalidateAccessCache();
    const doc = await newDoc(emp, 1_000);
    expect((await submit(emp, doc.id, doc.version)).status).toBe(200);
    const req = await pendingRequest(doc.id);
    const [a, b] = await Promise.all([
      decide(mgr, req.id, 'approve', req.version),
      decide(mgr2, req.id, 'approve', req.version),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const loser = a.status === 409 ? a : b;
    expect(['LEVEL_ALREADY_DECIDED', 'VERSION_CONFLICT']).toContain(errorOf(loser).code);
    expect(
      await prisma.approvalAction.count({ where: { requestId: req.id, action: 'APPROVE' } }),
    ).toBe(1);
  });

  it('a double Approve with the same key never approves level 2: one action row plus the replay header', async () => {
    const { req } = await submitted(60_000);
    const key = `dbl-${req.id}`;
    const first = await decide(mgr, req.id, 'approve', req.version, {}, key);
    expect(first.status).toBe(200);
    const again = await decide(mgr, req.id, 'approve', req.version, {}, key);
    expect(again.status).toBe(200);
    expect(again.headers['idempotent-replay']).toBe('true');
    expect(
      await prisma.approvalAction.count({ where: { requestId: req.id, action: 'APPROVE' } }),
    ).toBe(1);
    expect(
      await pendingRequest(
        req.id.length
          ? (await prisma.approvalRequest.findUniqueOrThrow({ where: { id: req.id } })).docId
          : '',
      ),
    ).toMatchObject({ currentLevel: 2 });
  });

  it('a stale If-Match is 409 and a missing one is 400', async () => {
    const { req } = await submitted(1_000);
    expect((await decide(mgr, req.id, 'approve', req.version + 5)).status).toBe(409);
    const none = await request(app)
      .post(`${API}/approvals/requests/${req.id}/approve`)
      .set(hdr(mgr))
      .send({});
    expect(none.status).toBe(400);
  });
});

describe('locking', () => {
  it('PATCH / DELETE / status are 409 RECORD_LOCKED while Pending Approval, Approved or Posted', async () => {
    const { doc, req } = await submitted(1_000);
    const check = async (status: string) => {
      const rec = dataOf<RecordBody>(await client.get(emp, PAGE, doc.id, { unit: TAL }));
      expect(rec.status).toBe(status);
      const patch = await client.patch(
        emp,
        PAGE,
        doc.id,
        rec.version,
        { [MONEY]: 5 },
        { unit: TAL },
      );
      expect(patch.status).toBe(409);
      expect(errorOf(patch).code).toBe('RECORD_LOCKED');
      expect(errorOf(patch).message).toBe(`This document is ${status} and cannot be changed.`);
      expect((await client.remove(owner, PAGE, doc.id, { unit: TAL })).status).toBe(409);
      const st = await client.status(emp, PAGE, doc.id, 'Cancelled', { unit: TAL });
      expect(st.status).toBe(409);
      expect(errorOf(st).code).toBe('RECORD_LOCKED');
    };
    await check('Pending Approval');
    expect((await decide(mgr, req.id, 'approve', req.version)).status).toBe(200);
    await check('Approved');
    await prisma.genericRecord.update({ where: { id: doc.id }, data: { status: 'Posted' } });
    await check('Posted');
  });

  it('nobody can set Approved or Rejected by hand', async () => {
    const doc = await newDoc(emp, 10);
    for (const to of ['Approved', 'Rejected', 'Pending Approval']) {
      const res = await client.status(emp, PAGE, doc.id, to, { unit: TAL });
      expect(res.status).toBe(422);
    }
  });
});

describe('delegation', () => {
  it('a delegate acts "on behalf of" the delegator; overlap is 409; self is 422; expired is 403; revoke removes the right', async () => {
    const boss = await signIn(
      app,
      await makeUser({ role: 'DEPT_MANAGER', department: DEPT, approvalLimit: 100_000 }),
    );
    const deputy = await signIn(app, await makeUser({ role: 'EMPLOYEE', department: DEPT }));
    await prisma.rolePermission.updateMany({
      where: { role: { code: 'EMPLOYEE' }, resource: '*' },
      data: { approve: true },
    });
    invalidateAccessCache();
    try {
      const today = new Date().toISOString().slice(0, 10);
      const post = (s: Signed, body: Record<string, unknown>) =>
        request(app).post(`${API}/approvals/delegations`).set(s.bearer).send(body);
      const self = await post(boss, { toUserId: boss.user.id, fromDate: today, toDate: today });
      expect(self.status).toBe(422);
      expect(errorOf(self).message).toBe('You cannot delegate to yourself.');

      const doc = await newDoc(emp, 500);
      expect((await submit(emp, doc.id, doc.version)).status).toBe(200);
      const req = await pendingRequest(doc.id);
      // pool contains boss (and every other Purchase manager)
      expect(
        await prisma.approvalStepAssignee.count({
          where: { userId: boss.user.id, step: { requestId: req.id } },
        }),
      ).toBe(1);

      const ok = await post(boss, {
        toUserId: deputy.user.id,
        fromDate: today,
        toDate: today,
        reason: 'Away today',
      });
      expect(ok.status, JSON.stringify(ok.body)).toBe(201);
      const overlap = await post(boss, {
        toUserId: deputy.user.id,
        fromDate: today,
        toDate: today,
      });
      expect(overlap.status).toBe(409);
      expect(errorOf(overlap).code).toBe('DELEGATION_OVERLAP');
      expect(errorOf(overlap).message).toMatch(
        /^You already have a delegation between \d\d-\d\d-\d{4} and \d\d-\d\d-\d{4}\.$/,
      );

      const dto = dataOf<{ id: string }>(ok);
      const res = await decide(deputy, req.id, 'approve', req.version);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const done = dataOf<Req>(res);
      expect(done.steps[0]?.onBehalfOf?.name).toBe(boss.user.name);
      expect(done.steps[0]?.actedBy?.name).toBe(deputy.user.name);
      expect(done.timeline.find((t) => t.action === 'APPROVE')?.onBehalfOf?.name).toBe(
        boss.user.name,
      );

      // expired: a second request while the delegation window is in the past
      await prisma.$executeRaw`UPDATE approval_delegations SET from_date = current_date - 5, to_date = current_date - 2 WHERE id = ${dto.id}::uuid`;
      const doc2 = await newDoc(emp, 500);
      await submit(emp, doc2.id, doc2.version);
      const req2 = await pendingRequest(doc2.id);
      const late = await decide(deputy, req2.id, 'approve', req2.version);
      expect(late.status).toBe(403);

      const revoke = await request(app)
        .post(`${API}/approvals/delegations/${dto.id}/revoke`)
        .set(boss.bearer);
      expect(revoke.status).toBe(200);
      expect((await auditRows('DELEGATION_CREATED', { actorId: boss.user.id })).length).toBe(1);
      expect((await auditRows('DELEGATION_REVOKED', { actorId: boss.user.id })).length).toBe(1);
    } finally {
      await prisma.rolePermission.updateMany({
        where: { role: { code: 'EMPLOYEE' }, resource: '*' },
        data: { approve: false },
      });
      invalidateAccessCache();
    }
  });

  it('a delegate who is the requester is blocked', async () => {
    const boss = await signIn(app, await makeUser({ role: 'DEPT_MANAGER', department: DEPT }));
    const today = new Date().toISOString().slice(0, 10);
    const doc = await newDoc(emp, 500);
    expect((await submit(emp, doc.id, doc.version)).status).toBe(200);
    const res = await request(app)
      .post(`${API}/approvals/delegations`)
      .set(boss.bearer)
      .send({ toUserId: emp.user.id, fromDate: today, toDate: today });
    expect(res.status).toBe(201);
    const req = await pendingRequest(doc.id);
    expect(
      await prisma.approvalStepAssignee.count({
        where: { userId: emp.user.id, step: { requestId: req.id } },
      }),
    ).toBe(0);
    const act = await decide(emp, req.id, 'approve', req.version);
    expect(act.status).toBe(403);
  });
});

describe('Approval Center reads and reassign', () => {
  it('inbox, counts, scoped list, 404 out of scope and the button flags', async () => {
    const { req } = await submitted(1_000);
    const inbox = await request(app).get(`${API}/approvals/inbox`).set(hdr(mgr));
    expect(inbox.status).toBe(200);
    const mine = dataOf<Req[]>(inbox).find((r) => r.id === req.id);
    expect(mine?.can).toEqual({ approve: true, reject: true, return: true, withdraw: false });
    const counts = dataOf<{ waitingForMe: number }>(
      await request(app).get(`${API}/approvals/counts`).set(hdr(mgr)),
    );
    expect(counts.waitingForMe).toBeGreaterThanOrEqual(1);
    const own = dataOf<Req>(
      await request(app).get(`${API}/approvals/requests/${req.id}`).set(hdr(emp)),
    );
    expect(own.can).toEqual({ approve: false, reject: false, return: false, withdraw: true });
    const stranger = await signIn(app, await makeUser({ role: 'EMPLOYEE', department: 'Sales' }));
    const hidden = await request(app)
      .get(`${API}/approvals/requests/${req.id}`)
      .set(stranger.bearer);
    expect(hidden.status).toBe(404);
    const list = await request(app).get(`${API}/approvals/requests?mine=submitted`).set(hdr(emp));
    expect(dataOf<Req[]>(list).some((r) => r.id === req.id)).toBe(true);
  });

  it('an Administrator can reassign the waiting level with a reason; others cannot', async () => {
    const { req } = await submitted(1_000);
    const step = await prisma.approvalStep.findFirstOrThrow({
      where: { requestId: req.id, level: 1 },
    });
    const spare = await signIn(
      app,
      await makeUser({ role: 'DEPT_MANAGER', department: DEPT, approvalLimit: 100_000 }),
    );
    const url = `${API}/approvals/steps/${step.id}/reassign`;
    expect(
      (
        await request(app)
          .post(url)
          .set(mgr.bearer)
          .send({ userId: spare.user.id, reason: 'Needs another approver' })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post(url)
          .set(owner.bearer)
          .send({ userId: spare.user.id, reason: 'short' })
      ).status,
    ).toBe(422);
    const ok = await request(app)
      .post(url)
      .set(owner.bearer)
      .send({ userId: spare.user.id, reason: 'Needs another approver' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect((await auditRows('APPROVAL_REASSIGNED')).length).toBeGreaterThanOrEqual(1);
    const act = await decide(spare, req.id, 'approve', dataOf<Req>(ok).version);
    expect(act.status).toBe(200);
  });
});

describe('the matrix snapshot', () => {
  it('editing the matrix does not change a request in flight', async () => {
    const { req } = await submitted(60_000);
    const dept = await prisma.department.findUniqueOrThrow({ where: { name: DEPT } });
    const set = await prisma.approvalRuleSet.findFirstOrThrow({
      where: { departmentId: dept.id, docType: null, unitId: null },
    });
    const before = await prisma.approvalStep.findMany({
      where: { requestId: req.id },
      orderBy: { level: 'asc' },
    });
    await prisma.approvalRule.updateMany({
      where: { ruleSetId: set.id, level: 2 },
      data: { threshold: 999_999 },
    });
    try {
      const after = await prisma.approvalStep.findMany({
        where: { requestId: req.id },
        orderBy: { level: 'asc' },
      });
      expect(after.map((s) => [s.level, s.threshold.toString(), s.approverRoleId])).toEqual(
        before.map((s) => [s.level, s.threshold.toString(), s.approverRoleId]),
      );
      expect(
        (
          await pendingRequest(
            req.id.length
              ? (await prisma.approvalRequest.findUniqueOrThrow({ where: { id: req.id } })).docId
              : '',
          )
        ).totalLevels,
      ).toBe(2);
    } finally {
      await prisma.approvalRule.updateMany({
        where: { ruleSetId: set.id, level: 2 },
        data: { threshold: 50_000 },
      });
    }
  });
});
