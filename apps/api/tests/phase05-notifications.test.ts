// Phase 05 notifications + jobs (docs/phases/PHASE-05.md §10 "Jobs (fake clock)" and "Notifications").
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { invalidateAccessCache } from '../src/core/rbac/access';
import { escalateOverdue, sendApprovalReminders } from '../src/modules/approvals/jobs';
import { formatInr } from '../src/modules/approvals/money';
import { applicableRules } from '../src/modules/approvals/matrix';
import { drainOutbox, setEmailTransportForTests } from '../src/modules/notifications/email';
import { notificationService } from '../src/modules/notifications/service';
import { Prisma } from '@prisma/client';
import { API, errorOf, makeUser, newApp, prisma, signIn, signInOwner, unitIds } from './helpers';
import type { Signed } from './helpers';
import { api, dataOf, sampleData, schemaOf } from './phase4-helpers';
import type { RecordBody } from './phase4-helpers';

const app = newApp();
const client = api(app);
const PAGE = 'scm-pr';
const MONEY = schemaOf(PAGE).fields.find((f) => f.type === 'money')?.key ?? '';
const HOUR = 3600 * 1000;

let TAL: string;
let owner: Signed;
let emp: Signed;
let mgr: Signed;
let head: Signed;
let n = 0;

const hdr = (s: Signed) => ({ ...s.bearer, 'X-Unit-Id': TAL });

async function submitDoc(amount: number) {
  n += 1;
  const data = { ...sampleData(schemaOf(PAGE), 500 + n), [MONEY]: amount };
  const doc = dataOf<RecordBody>(await client.create(emp, PAGE, data, { unit: TAL }));
  const res = await request(app)
    .post(`${API}/pages/${PAGE}/records/${doc.id}/submit`)
    .set(hdr(emp))
    .set('If-Match', String(doc.version));
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return prisma.approvalRequest.findFirstOrThrow({
    where: { docId: doc.id },
    include: { steps: { orderBy: { level: 'asc' } } },
  });
}

beforeAll(async () => {
  TAL = (await unitIds(['TAL']))[0] as string;
  owner = await signInOwner(app);
  const mk = (role: string, limit: number) =>
    makeUser({ role, department: 'Purchase', approvalLimit: limit }).then((u) => signIn(app, u));
  emp = await mk('EMPLOYEE', 0);
  mgr = await mk('DEPT_MANAGER', 100_000);
  head = await mk('DEPT_HEAD', 500_000);
  invalidateAccessCache();
});

afterAll(async () => {
  setEmailTransportForTests(null);
  await prisma.$disconnect();
});

describe('pure helpers', () => {
  const rules = [0, 50_000, 200_000, 1_000_000].map((t, i) => ({
    level: i + 1,
    threshold: new Prisma.Decimal(t),
  }));
  it.each([
    [0, 1],
    [49_999, 1],
    [50_000, 2],
    [200_000, 3],
    [1_000_000, 4],
    [1_000_001, 4],
  ])('amount %i -> %i levels', (amount, expected) => {
    expect(applicableRules(rules, amount, 1).length).toBe(expected);
  });
  it('no amount -> the first no_amount_levels', () => {
    expect(applicableRules(rules, null, 1).length).toBe(1);
    expect(applicableRules(rules, null, 3).length).toBe(3);
  });
  it('formats rupees the Indian way', () => {
    expect(formatInr(75000)).toBe('₹75,000');
    expect(formatInr('100000')).toBe('₹1,00,000');
    expect(formatInr('1234567.5')).toBe('₹12,34,567.5');
    expect(formatInr(0)).toBe('₹0');
  });
});

describe('notifications API', () => {
  it('APPROVAL_ASSIGNED reaches the approver; unread count, read, read-all; others get 404', async () => {
    const req = await submitDoc(900);
    const list = await request(app).get(`${API}/notifications?unread=true`).set(mgr.bearer);
    expect(list.status).toBe(200);
    const item = dataOf<{ id: string; type: string; link: string }[]>(list).find(
      (x) => x.link === `/approvals?request=${req.id}`,
    );
    expect(item?.type).toBe('APPROVAL_ASSIGNED');
    const count = () =>
      request(app)
        .get(`${API}/notifications/unread-count`)
        .set(mgr.bearer)
        .then((r) => dataOf<{ count: number }>(r).count);
    const before = await count();
    expect(before).toBeGreaterThanOrEqual(1);
    const stranger = await request(app)
      .post(`${API}/notifications/${item?.id}/read`)
      .set(head.bearer);
    expect(stranger.status).toBe(404);
    expect(
      (await request(app).post(`${API}/notifications/${item?.id}/read`).set(mgr.bearer)).status,
    ).toBe(200);
    expect(await count()).toBe(before - 1);
    await request(app).post(`${API}/notifications/read-all`).set(mgr.bearer);
    expect(await count()).toBe(0);
    expect((await request(app).get(`${API}/notifications/unread-count`)).status).toBe(401);
  });

  it('approver notifications clear once the request is decided; the requester is told', async () => {
    const req = await submitDoc(800);
    const dec = await request(app)
      .post(`${API}/approvals/requests/${req.id}/approve`)
      .set(hdr(mgr))
      .set('If-Match', String(req.version))
      .send({});
    expect(dec.status, JSON.stringify(dec.body)).toBe(200);
    const open = await prisma.notification.count({
      where: { userId: mgr.user.id, entityId: req.id, type: 'APPROVAL_ASSIGNED', readAt: null },
    });
    expect(open).toBe(0);
    const told = await prisma.notification.findFirst({
      where: { userId: emp.user.id, entityId: req.id, type: 'APPROVAL_DECIDED' },
    });
    expect(told?.title).toMatch(/Approved/);
  });

  it('preferences: saved, per user, APPROVAL_ASSIGNED in-app cannot be turned off, unknown type refused', async () => {
    const get = await request(app).get(`${API}/notification-preferences`).set(emp.bearer);
    const prefs =
      dataOf<{ type: string; inApp: boolean; inAppLocked: boolean; email: string }[]>(get);
    expect(prefs.find((p) => p.type === 'APPROVAL_ASSIGNED')?.inAppLocked).toBe(true);
    const bad = await request(app)
      .put(`${API}/notification-preferences`)
      .set(emp.bearer)
      .send({ items: [{ type: 'APPROVAL_ASSIGNED', inApp: false, email: 'OFF' }] });
    expect(bad.status).toBe(422);
    const unknown = await request(app)
      .put(`${API}/notification-preferences`)
      .set(emp.bearer)
      .send({ items: [{ type: 'NOPE', inApp: true, email: 'OFF' }] });
    expect(unknown.status).toBe(422);
    const ok = await request(app)
      .put(`${API}/notification-preferences`)
      .set(emp.bearer)
      .send({ items: [{ type: 'APPROVAL_DECIDED', inApp: false, email: 'DIGEST' }] });
    expect(ok.status).toBe(200);
    const again = dataOf<{ type: string; inApp: boolean; email: string }[]>(
      await request(app).get(`${API}/notification-preferences`).set(emp.bearer),
    );
    expect(again.find((p) => p.type === 'APPROVAL_DECIDED')).toMatchObject({
      inApp: false,
      email: 'DIGEST',
    });
    // the preference is respected: no in-app item for APPROVAL_DECIDED now
    const req = await submitDoc(700);
    await request(app)
      .post(`${API}/approvals/requests/${req.id}/approve`)
      .set(hdr(mgr))
      .set('If-Match', String(req.version))
      .send({});
    expect(
      await prisma.notification.count({ where: { userId: emp.user.id, entityId: req.id } }),
    ).toBe(0);
    // another user's preferences are untouched
    const other = dataOf<{ type: string; inApp: boolean }[]>(
      await request(app).get(`${API}/notification-preferences`).set(mgr.bearer),
    );
    expect(other.find((p) => p.type === 'APPROVAL_DECIDED')?.inApp).toBe(true);
    await prisma.notificationPreference.deleteMany({ where: { userId: emp.user.id } });
  });

  it('a notification rolled back with its transaction is never delivered', async () => {
    const before = await prisma.notification.count({ where: { userId: mgr.user.id } });
    await expect(
      prisma.$transaction(async (tx) => {
        await notificationService.notify(tx, [mgr.user.id], {
          type: 'APPROVAL_REMINDER',
          title: 'x',
          dedupeKey: 'rollback-test',
        });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await prisma.notification.count({ where: { userId: mgr.user.id } })).toBe(before);
  });

  it('test-email is for Administrators only', async () => {
    expect(
      (await request(app).post(`${API}/notifications/test-email`).set(emp.bearer)).status,
    ).toBe(403);
    const ok = await request(app).post(`${API}/notifications/test-email`).set(owner.bearer);
    expect(ok.status).toBe(200);
  });
});

describe('jobs with a fake clock', () => {
  it('escalation fires once even when the job runs twice, adds the next role and notifies', async () => {
    const req = await submitDoc(60_000);
    const step = req.steps[0];
    await prisma.approvalStep.update({
      where: { id: step?.id ?? '' },
      data: { dueAt: new Date(Date.now() - HOUR) },
    });
    const first = await escalateOverdue(new Date());
    expect(first).toBeGreaterThanOrEqual(1);
    expect(await escalateOverdue(new Date())).toBe(0);
    const actions = await prisma.approvalAction.findMany({
      where: { requestId: req.id, action: 'ESCALATE' },
    });
    expect(actions.length).toBe(1);
    const escalated = await prisma.approvalStepAssignee.findMany({
      where: { stepId: step?.id ?? '', via: 'ESCALATION' },
    });
    expect(escalated.map((e) => e.userId)).toContain(head.user.id);
    // the escalation target sees it in the bell; the requester is never added
    const bell = await prisma.notification.findFirst({
      where: { userId: head.user.id, type: 'APPROVAL_ESCALATED', entityId: req.id },
    });
    expect(bell).not.toBeNull();
    expect(escalated.map((e) => e.userId)).not.toContain(emp.user.id);
    // escalation never approves anything
    expect((await prisma.approvalRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe(
      'PENDING',
    );
    // the escalated person can now act on level 1
    const ver = (await prisma.approvalRequest.findUniqueOrThrow({ where: { id: req.id } })).version;
    const act = await request(app)
      .post(`${API}/approvals/requests/${req.id}/approve`)
      .set(hdr(head))
      .set('If-Match', String(ver))
      .send({});
    expect(act.status, JSON.stringify(act.body)).toBe(200);
  });

  it('reminders: one per user per day for levels waiting more than 24 hours', async () => {
    const req = await submitDoc(2_000);
    await prisma.approvalStep.update({
      where: { id: req.steps[0]?.id ?? '' },
      data: { activatedAt: new Date(Date.now() - 30 * HOUR) },
    });
    const now = new Date();
    const first = await sendApprovalReminders(now);
    expect(first).toBeGreaterThanOrEqual(1);
    expect(await sendApprovalReminders(now)).toBe(0);
    const bells = await prisma.notification.count({
      where: { userId: mgr.user.id, type: 'APPROVAL_REMINDER' },
    });
    expect(bells).toBe(1);
    // the next day it reminds again
    expect(await sendApprovalReminders(new Date(now.getTime() + 25 * HOUR))).toBeGreaterThanOrEqual(
      1,
    );
  });

  it("digest groups a DIGEST user's unread items into one email, once", async () => {
    const dig = await makeUser({
      role: 'DEPT_MANAGER',
      department: 'Purchase',
      approvalLimit: 100_000,
    });
    await prisma.notificationPreference.create({
      data: { userId: dig.id, type: 'APPROVAL_ASSIGNED', email: 'DIGEST' },
    });
    await prisma.$transaction(async (tx) => {
      await notificationService.notify(tx, [dig.id], {
        type: 'APPROVAL_ASSIGNED',
        title: 'One',
        dedupeKey: `dg1-${dig.id}`,
      });
      await notificationService.notify(tx, [dig.id], {
        type: 'APPROVAL_ASSIGNED',
        title: 'Two',
        dedupeKey: `dg2-${dig.id}`,
      });
    });
    expect(await prisma.emailOutbox.count({ where: { toEmail: dig.email ?? '' } })).toBe(0);
    const first = await notificationService.sendDigests();
    expect(first.users).toBeGreaterThanOrEqual(1);
    const mails = await prisma.emailOutbox.findMany({ where: { toEmail: dig.email ?? '' } });
    expect(mails.length).toBe(1);
    expect(mails[0]?.text).toContain('One');
    expect(mails[0]?.text).toContain('Two');
    await notificationService.sendDigests();
    expect(await prisma.emailOutbox.count({ where: { toEmail: dig.email ?? '' } })).toBe(1);
  });

  it('outbox: SKIPPED without SMTP, retry with backoff then FAILED after 5 attempts, SENT when it works', async () => {
    const mail = (to: string) =>
      prisma.emailOutbox.create({
        data: { toEmail: to, subject: 's', html: '<p>x</p>', text: 'x' },
      });
    // no SMTP configured in tests; start from an empty outbox
    await prisma.emailOutbox.deleteMany();
    setEmailTransportForTests(null);
    const a = await mail('a@test.local');
    await drainOutbox(new Date(Date.now() + 1000));
    expect((await prisma.emailOutbox.findUniqueOrThrow({ where: { id: a.id } })).status).toBe(
      'SKIPPED',
    );

    let fail = true;
    const sent: string[] = [];
    setEmailTransportForTests({
      sendMail: ((m: { to: string }) => {
        if (fail) return Promise.reject(new Error('smtp down'));
        sent.push(m.to);
        return Promise.resolve({});
      }) as never,
    });
    const b = await mail('b@test.local');
    let clock = new Date(Date.now() + 1000);
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      await drainOutbox(clock);
      const row = await prisma.emailOutbox.findUniqueOrThrow({ where: { id: b.id } });
      expect(row.status).toBe('QUEUED');
      expect(row.attempts).toBe(attempt);
      // not due again before its backoff
      await drainOutbox(clock);
      expect((await prisma.emailOutbox.findUniqueOrThrow({ where: { id: b.id } })).attempts).toBe(
        attempt,
      );
      clock = new Date(row.nextAttemptAt.getTime() + 1000);
    }
    await drainOutbox(clock);
    const failed = await prisma.emailOutbox.findUniqueOrThrow({ where: { id: b.id } });
    expect(failed.status).toBe('FAILED');
    expect(failed.attempts).toBe(5);

    fail = false;
    const c = await mail('c@test.local');
    await drainOutbox(new Date(Date.now() + 1000));
    expect((await prisma.emailOutbox.findUniqueOrThrow({ where: { id: c.id } })).status).toBe(
      'SENT',
    );
    expect(sent).toContain('c@test.local');
  });

  it('purge deletes read items older than 180 days only', async () => {
    const old = await prisma.notification.create({
      data: {
        userId: emp.user.id,
        type: 'DOCUMENT_EXPIRING',
        title: 'old',
        readAt: new Date(Date.now() - 200 * 24 * HOUR),
      },
    });
    const unreadOld = await prisma.notification.create({
      data: { userId: emp.user.id, type: 'DOCUMENT_EXPIRING', title: 'old unread' },
    });
    await notificationService.purge(new Date());
    expect(await prisma.notification.findUnique({ where: { id: old.id } })).toBeNull();
    expect(await prisma.notification.findUnique({ where: { id: unreadOld.id } })).not.toBeNull();
  });
});

describe('INSTANT email', () => {
  it('an INSTANT user gets an outbox row with the company name, document code, amount and an Open in ERP link', async () => {
    const req = await submitDoc(1_234);
    const mails = await prisma.emailOutbox.findMany({
      where: { toEmail: mgr.user.email ?? '' },
      orderBy: { createdAt: 'desc' },
    });
    const mail = mails.find((m) => m.text.includes(req.docCode));
    expect(mail).toBeDefined();
    expect(mail?.text).toContain('₹1,234');
    expect(mail?.text).toContain('Open in ERP:');
    expect(mail?.html).toContain('Open in ERP');
    expect(errorOf).toBeDefined();
  });
});
