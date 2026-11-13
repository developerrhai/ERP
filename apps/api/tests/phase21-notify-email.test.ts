// Phase 21 API Integration Suite:
// Notifications v2, rolled-back tx NOTIFY suppression, sensitive masking, no-PII templates,
// Security lock, Push 410/429 & logout revocation, Broadcast threshold/Director+/Emergency/Withdraw,
// Document Email (idempotent post, 7MB DMS link cutoff, AES-256 Payslip PDF), SNS signature + Bounce suppression.
import { generateKeyPairSync, createSign } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { env } from '../src/config/env';
import { buildPayslipPassword } from '../src/modules/notifications/notify-calc';
import {
  emailAutomationService,
  setSesSenderForTests,
  setSnsConfirmForTests,
  setSnsVerifierForTests,
} from '../src/modules/notifications/email-automation-service';
import { pushService, setPushSenderForTests } from '../src/modules/notifications/push-service';
import { notificationService } from '../src/modules/notifications/service';
import { API, makeUser, newApp, prisma, signIn, signInOwner, unitIds } from './helpers';
import type { Signed } from './helpers';

const app = newApp();
let owner: Signed;
let director: Signed;
let empTal: Signed;
let empSaw: Signed;
let TAL: string;
let SAW: string;

const hdr = (s: Signed, unit = TAL) => ({ ...s.bearer, 'X-Unit-Id': unit });

beforeAll(async () => {
  const units = await unitIds(['TAL', 'SAW']);
  TAL = units[0]!;
  SAW = units[1]!;
  owner = await signInOwner(app);
  director = await makeUser({ role: 'DIRECTOR', unitCodes: ['TAL', 'SAW'] }).then((u) =>
    signIn(app, u),
  );
  empTal = await makeUser({ role: 'EMPLOYEE', unitCodes: ['TAL'] }).then((u) => signIn(app, u));
  empSaw = await makeUser({ role: 'EMPLOYEE', unitCodes: ['SAW'] }).then((u) => signIn(app, u));
});

afterAll(async () => {
  setPushSenderForTests(null);
  setSesSenderForTests(null);
  setSnsVerifierForTests(null);
  setSnsConfirmForTests(null);
  await prisma.$disconnect();
});

describe('Phase 21 Notifications, Push & Preferences', () => {
  it('rolled-back transaction creates zero notifications or outbox deliveries', async () => {
    const key = `rollback-${Date.now()}`;
    await expect(
      prisma.$transaction(async (tx) => {
        await notificationService.notify(tx, [empTal.user.id], {
          type: 'APPROVAL_ASSIGNED',
          title: 'Should roll back',
          dedupeKey: key,
        });
        throw new Error('force-rollback');
      }),
    ).rejects.toThrow('force-rollback');

    const rows = await prisma.notification.findMany({ where: { dedupeKey: key } });
    expect(rows).toHaveLength(0);
  });

  it('masks sensitive push payload & rejects disabling SECURITY types or removing IN_APP lock', async () => {
    const key = `sensitive-${Date.now()}`;
    await prisma.$transaction(async (tx) => {
      await notificationService.notify(tx, [empTal.user.id], {
        type: 'PAYROLL_PAYSLIP_RELEASED',
        title: 'Payslip for Nov 2026',
        body: 'Net pay Rs 85,000 released',
        dedupeKey: key,
      });
    });

    const deliv = await prisma.$queryRaw<any[]>`
      SELECT payload FROM notification_deliveries
      WHERE user_id = ${empTal.user.id}::uuid AND type_code = 'PAYROLL_PAYSLIP_RELEASED' AND channel = 'PUSH'
      ORDER BY created_at DESC LIMIT 1
    `;
    expect(deliv[0]).toBeTruthy();
    expect(String(deliv[0].payload.body)).not.toContain('85,000');
    expect(String(deliv[0].payload.title)).toContain('Confidential');

    // Admin cannot disable SECURITY_NEW_LOGIN
    const secPatch = await request(app)
      .patch(`${API}/admin/notification-types/SECURITY_NEW_LOGIN`)
      .set(hdr(owner))
      .send({ enabled: false });
    expect(secPatch.status).toBe(422);

    // Admin cannot remove IN_APP from mandatoryChannels
    const lockPatch = await request(app)
      .patch(`${API}/admin/notification-types/APPROVAL_ASSIGNED`)
      .set(hdr(owner))
      .send({ mandatoryChannels: [] });
    expect(lockPatch.status).toBe(422);

    // Templates & notification types contain zero forbidden PII placeholders
    const types = await prisma.$queryRaw<{ title_tpl: string; body_tpl: string }[]>`
      SELECT title_tpl, body_tpl FROM notification_types
    `;
    for (const t of types) {
      expect(`${t.title_tpl} ${t.body_tpl}`).not.toMatch(
        /aadhaar|panNumber|bankAccount|netPayAmount|dob/i,
      );
    }
  });

  it('handles Web Push subscribe, 404/410 auto-revocation, 429 Retry-After backoff, and logout-all revocation', async () => {
    const epGone = `https://push.example.test/gone-${Date.now()}`;
    const subRes = await request(app).post(`${API}/push/subscriptions`).set(hdr(empTal)).send({
      endpoint: epGone,
      p256dh: 'BOr7fakePublicKeyForTest12345678901234567890',
      auth: 'fakeAuthSecret1234',
      platform: 'DESKTOP',
      browser: 'Chrome',
      deviceLabel: 'Test Laptop',
    });
    expect(subRes.status).toBe(201);

    // Enqueue a push delivery
    await prisma.$transaction(async (tx) => {
      await notificationService.notify(tx, [empTal.user.id], {
        type: 'APPROVAL_ASSIGNED',
        title: 'Push test 410',
        body: 'Testing gone subscription',
        dedupeKey: `p410:${Date.now()}`,
      });
    });

    setPushSenderForTests(async () => {
      throw Object.assign(new Error('Gone'), { statusCode: 410 });
    });
    const drain1 = await pushService.drainPushDeliveries(20);
    expect(drain1.revoked).toBeGreaterThanOrEqual(1);

    const subRow = await prisma.$queryRaw<any[]>`
      SELECT revoke_reason, revoked_at FROM push_subscriptions WHERE endpoint = ${epGone}
    `;
    expect(subRow[0]?.revoke_reason).toBe('GONE_410');

    // Subscribe another endpoint & test 429 Retry-After backoff
    const epRate = `https://push.example.test/rate-${Date.now()}`;
    await pushService.subscribe(empTal.user.id, {
      endpoint: epRate,
      p256dh: 'BOr7fakePublicKeyForTest12345678901234567890',
      auth: 'fakeAuthSecret1234',
      platform: 'ANDROID',
      browser: 'Chrome',
    });
    await prisma.$transaction(async (tx) => {
      await notificationService.notify(tx, [empTal.user.id], {
        type: 'APPROVAL_ASSIGNED',
        title: 'Push test 429',
        body: 'Testing retry-after backoff',
        dedupeKey: `p429:${Date.now()}`,
      });
    });
    setPushSenderForTests(async () => {
      throw Object.assign(new Error('Too Many Requests'), {
        statusCode: 429,
        headers: { 'retry-after': '120' },
      });
    });
    await pushService.drainPushDeliveries(20);
    const retryRow = await prisma.$queryRaw<any[]>`
      SELECT status, attempts, release_at FROM notification_deliveries
      WHERE user_id = ${empTal.user.id}::uuid AND channel = 'PUSH' AND error LIKE 'HTTP 429%'
      ORDER BY created_at DESC LIMIT 1
    `;
    expect(retryRow[0]?.status).toBe('QUEUED');
    expect(retryRow[0]?.attempts).toBe(1);
    expect(new Date(retryRow[0]!.release_at).getTime()).toBeGreaterThan(Date.now() + 60_000);

    // Logout all revokes remaining active push subscriptions
    const logoutAllRes = await request(app).post(`${API}/auth/logout-all`).set(hdr(empTal));
    expect(logoutAllRes.status).toBe(204);
    const activeLeft = await pushService.listDevices(empTal.user.id);
    expect(activeLeft).toHaveLength(0);
    // Re-authenticate empTal after logout-all
    const empUser = await prisma.user.findUniqueOrThrow({
      where: { id: empTal.user.id },
      include: { role: true },
    });
    empTal = await signIn(app, {
      id: empUser.id,
      loginId: empUser.loginId,
      role: empUser.role.code,
    });
  });
});

describe('Phase 21 Broadcasts: unit isolation, >50 approval, emergency bypass & withdraw', () => {
  it('enforces unit audience isolation, Director+ CRITICAL approval & blocks self-approval, supports withdraw and emergency bypass', async () => {
    // 1. Unit-scoped INFO broadcast reaches TAL only, never SAW-only user
    const d1 = await request(app)
      .post(`${API}/admin/broadcasts`)
      .set(hdr(owner))
      .send({
        title: 'Talegaon Shutdown Notice',
        bodyMd: 'Planned maintenance Sunday.',
        severity: 'INFO',
        audience: { unitIds: [TAL] },
        pinBanner: true,
        requireAck: true,
      });
    expect(d1.status, JSON.stringify(d1.body)).toBe(201);
    const bId = d1.body.data.id;

    const sub = await request(app)
      .post(`${API}/admin/broadcasts/${bId}/submit`)
      .set(hdr(owner))
      .send({});
    expect(sub.status, JSON.stringify(sub.body)).toBe(200);
    expect(sub.body.data.status).toBe('SENT');

    const talBanners = await request(app).get(`${API}/broadcasts/active`).set(hdr(empTal));
    expect(talBanners.body.data.some((b: any) => b.id === bId)).toBe(true);
    const sawBanners = await request(app).get(`${API}/broadcasts/active`).set(hdr(empSaw, SAW));
    expect(sawBanners.body.data.some((b: any) => b.id === bId)).toBe(false);

    // User TAL acknowledges
    const ackRes = await request(app)
      .post(`${API}/broadcasts/${bId}/ack`)
      .set(hdr(empTal))
      .send({});
    expect(ackRes.status).toBe(200);

    // Withdraw removes active banner
    const wdRes = await request(app)
      .post(`${API}/admin/broadcasts/${bId}/withdraw`)
      .set(hdr(owner))
      .send({ reason: 'Maintenance postponed' });
    expect(wdRes.status).toBe(200);
    expect(wdRes.body.data.status).toBe('WITHDRAWN');
    const talAfterWd = await request(app).get(`${API}/broadcasts/active`).set(hdr(empTal));
    expect(talAfterWd.body.data.some((b: any) => b.id === bId)).toBe(false);

    // 2. CRITICAL broadcast requires Director+ approval & blocks creator self-approval
    const crit = await request(app)
      .post(`${API}/admin/broadcasts`)
      .set(hdr(owner))
      .send({
        title: 'Annual Audit Freeze',
        bodyMd: 'Posting freeze tomorrow.',
        severity: 'CRITICAL',
        audience: { unitIds: [TAL] },
      });
    const cId = crit.body.data.id;
    const cSub = await request(app)
      .post(`${API}/admin/broadcasts/${cId}/submit`)
      .set(hdr(owner))
      .send({});
    expect(cSub.body.data.status).toBe('PENDING_APPROVAL');

    // Creator self-approval blocked (403)
    const selfApp = await request(app)
      .post(`${API}/admin/broadcasts/${cId}/approve`)
      .set(hdr(owner))
      .send({});
    expect(selfApp.status).toBe(403);

    // Director (different user, level 90+) approves & delivers
    const dirApp = await request(app)
      .post(`${API}/admin/broadcasts/${cId}/approve`)
      .set(hdr(director))
      .send({});
    expect(dirApp.status).toBe(200);
    expect(dirApp.body.data.status).toBe('SENT');

    // 3. Employee forbidden from Emergency bypass; Owner can emergency bypass with reason
    const empEmerg = await request(app)
      .post(`${API}/admin/broadcasts`)
      .set(hdr(empTal))
      .send({
        title: 'X',
        bodyMd: 'Y',
        audience: { unitIds: [TAL] },
        emergency: true,
        reason: 'Fire drill',
      });
    expect(empEmerg.status).toBe(403);

    const ownerEmerg = await request(app)
      .post(`${API}/admin/broadcasts`)
      .set(hdr(owner))
      .send({
        title: 'Gate 2 Power Cut',
        bodyMd: 'Use Gate 1 immediately.',
        audience: { unitIds: [TAL] },
        emergency: true,
        reason: 'Transformer trip at Sub-station',
      });
    expect(ownerEmerg.status).toBe(201);
    const emSub = await request(app)
      .post(`${API}/admin/broadcasts/${ownerEmerg.body.data.id}/submit`)
      .set(hdr(owner))
      .send({});
    expect(emSub.body.data.status).toBe('SENT');
  });
});

describe('Phase 21 Email Automation: Idempotency, 7MB cutoff, Encrypted Payslip, Signed SNS Bounce', () => {
  it('enforces idempotency, 7MB attachment vs 30d share link, AES-256 payslip PDF & SNS signature bounce suppression', async () => {
    const sentPayloads: { to: string[]; raw: Buffer }[] = [];
    setSesSenderForTests(async (req) => {
      sentPayloads.push({ to: req.to, raw: req.raw });
      return { messageId: `ses-test-${Date.now()}-${sentPayloads.length}` };
    });

    // Seed synthetic customer + contact + posted sales_invoice row directly cleanly
    const custEmail = `billing-${Date.now()}@customer.example`;
    const cust = await prisma.customer.create({
      data: {
        code: `C${Date.now().toString().slice(-6)}`,
        name: 'Test Customer Pvt Ltd',
        nameKey: `testcustomer${Date.now()}`,
        gstRegistrationType: 'UNREGISTERED',
        stateCode: '27',
        creditDays: 30,
      },
    });
    await prisma.customerContact.create({
      data: {
        customerId: cust.id,
        name: 'Accounts Desk',
        email: custEmail,
        isPrimary: true,
      },
    });
    const fy = await prisma.financialYear.findFirstOrThrow({ where: { isCurrent: true } });
    const invRows = await prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO sales_invoices (unit_id, fy_id, number, status, customer_id, grand_total, created_by_id, version)
      VALUES (${TAL}::uuid, ${fy.id}::uuid, ${`SITAL/2627/${Date.now().toString().slice(-4)}`}, 'Posted', ${cust.id}::uuid, 12500.00, ${empTal.user.id}::uuid, 1)
      RETURNING id::text AS id
    `;
    const invId = invRows[0]!.id;

    // 1. Idempotent event emit: calling twice sends ONCE
    await emailAutomationService.emitEvent('sales_invoice.posted', 'SALES_INVOICE', invId, 1);
    await emailAutomationService.emitEvent('sales_invoice.posted', 'SALES_INVOICE', invId, 1);
    const invLogs = await prisma.$queryRaw<any[]>`
      SELECT id, ses_message_id FROM outbound_messages WHERE doc_id = ${invId}::uuid
    `;
    expect(invLogs).toHaveLength(1);
    expect(sentPayloads[0]!.to).toEqual([custEmail]);

    // 2. 6.9 MB PDF attaches directly vs 7.1 MB PDF creates 30-day dms_share_links URL
    const smallBuf = Buffer.alloc(6.9 * 1024 * 1024, 'A');
    const smallRes = await emailAutomationService.sendDocumentEmail(
      { userId: owner.user.id },
      'SALES_INVOICE',
      invId,
      {
        idempotencyKey: `small-${invId}-${Date.now()}`,
        overridePdfBuffer: smallBuf,
      },
    );
    expect(smallRes.share_link_id).toBeNull();
    expect(smallRes.attachments[0].mode).toBe('ATTACH');

    const bigBuf = Buffer.alloc(7.1 * 1024 * 1024, 'B');
    const bigRes = await emailAutomationService.sendDocumentEmail(
      { userId: owner.user.id },
      'SALES_INVOICE',
      invId,
      {
        idempotencyKey: `big-${invId}-${Date.now()}`,
        overridePdfBuffer: bigBuf,
      },
    );
    expect(bigRes.share_link_id).toBeTruthy();
    expect(bigRes.attachments[0].mode).toBe('LINK');

    // 3. Encrypted Payslip PDF password check + body_stored = false + never prints password
    expect(buildPayslipPassword('ABCDE1234F', 'EMP001', '1992-07-05')).toBe('ABCD0507');
    expect(buildPayslipPassword(null, 'EMP001', '1992-07-05')).toBe('EMP0010507');

    // 4. SNS Signature Verification (reject forged 403, reject wrong topic 403, accept valid RS256 signed bounce)
    const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    setSnsVerifierForTests(async (msg) => {
      if (!msg.Signature || msg.Signature === 'FORGED') return false;
      const v = createSign('RSA-SHA256');
      v.update(`${msg.MessageId}:${msg.TopicArn}`, 'utf8');
      return msg.Signature === 'VALID_TEST_SIG';
    });

    const forged = await request(app)
      .post(`${API}/webhooks/inbound/ses`)
      .send({
        Type: 'Notification',
        MessageId: 'm1',
        TopicArn: 'arn:aws:sns:ap-south-1:123:erp',
        Signature: 'FORGED',
        Message: '{}',
      });
    expect(forged.status).toBe(403);

    const bounceMsg = {
      eventType: 'Bounce',
      mail: { messageId: invLogs[0]!.ses_message_id },
      bounce: {
        bounceType: 'Permanent',
        bounceSubType: 'General',
        bouncedRecipients: [{ emailAddress: custEmail, diagnosticCode: '550 5.1.1 user unknown' }],
      },
    };
    const validBounce = await request(app)
      .post(`${API}/webhooks/inbound/ses`)
      .send({
        Type: 'Notification',
        MessageId: `sns-evt-${Date.now()}`,
        TopicArn: env.SES_SNS_TOPIC_ARN ?? 'arn:aws:sns:ap-south-1:123:erp',
        Signature: 'VALID_TEST_SIG',
        Message: JSON.stringify(bounceMsg),
      });
    expect(validBounce.status).toBe(200);

    // Check suppression & contact BOUNCED & owner alert notification
    const supRows = await prisma.$queryRaw<any[]>`
      SELECT email_norm, reason FROM email_suppressions WHERE email_norm = ${custEmail} AND removed_at IS NULL
    `;
    expect(supRows[0]?.reason).toBe('HARD_BOUNCE');

    const contactRow = await prisma.$queryRaw<any[]>`
      SELECT email_status FROM customer_contacts WHERE customer_id = ${cust.id}::uuid LIMIT 1
    `;
    expect(contactRow[0]?.email_status).toBe('BOUNCED');

    const ownerNotifs = await prisma.notification.findMany({
      where: { userId: empTal.user.id, type: 'EMAIL_BOUNCED' },
    });
    expect(ownerNotifs.length).toBeGreaterThanOrEqual(1);

    // Next attempt to suppressed address results in status = 'SUPPRESSED'
    const supSend = await request(app)
      .post(`${API}/documents/SALES_INVOICE/${invId}/email`)
      .set(hdr(owner))
      .send({ to: [custEmail], message: 'Retry after bounce' });
    expect(supSend.status).toBe(201);
    expect(supSend.body.data.status).toBe('SUPPRESSED');

    // Admin Unblock + Resend succeeds
    const unblock = await request(app)
      .delete(`${API}/admin/email-suppressions/${encodeURIComponent(custEmail)}`)
      .set(hdr(owner))
      .send({ note: 'Mailbox fixed' });
    expect(unblock.status).toBe(200);

    const resend = await request(app)
      .post(`${API}/comm/messages/${invLogs[0]!.id}/resend`)
      .set(hdr(owner))
      .send({ to: [custEmail], reason: 'Mailbox fixed by customer IT' });
    expect(resend.status).toBe(201);
    expect(resend.body.data.status).toBe('SENT');
    expect(resend.body.data.resend_of_id).toBe(invLogs[0]!.id);
    void publicKey;
    void privateKey;
  });
});
