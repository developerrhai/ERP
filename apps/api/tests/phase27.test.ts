/* eslint-disable @typescript-eslint/no-unsafe-member-access */
// Phase 27: print in 5 formats, Document Center, department mail, mail automation (library, idempotency, plants), letters, certificates.
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import JSZip from 'jszip';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_TEMPLATES, deliver, merge, mailAutomation, summaryText } from '../src/modules/docsmail/automation';
import { stripHtml } from '../src/modules/docsmail/letters';
import { CATALOG } from '../src/modules/docsmail/print';
import { pageResource } from '../src/core/rbac/permission-model';
import { seedPhase2Defaults } from '../src/core/seed/defaults';
import { API, XRW, makeUser, newApp, prisma, signIn, signInOwner, unitIds } from './helpers';

const binary = (res: request.Response, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

describe('Phase 27 rules (pure)', () => {
  it('merge fields are filled and unknown ones become empty', () => {
    expect(merge('Reminder: {{doc_no}} due {{due_date}} {{nothing}}', { doc_no: 'PO/1', due_date: '15-12-2026' })).toBe('Reminder: PO/1 due 15-12-2026 ');
  });
  it('letters are stripped to plain text', () => {
    expect(stripHtml('<p>Dear A,</p><p>Hello<br/>Bye &amp; thanks</p>')).toBe('Dear A,\n\nHello\nBye & thanks');
  });
  it('the catalog has the 21 documents and the wired automations have wording', () => {
    expect(CATALOG.length).toBeGreaterThanOrEqual(20);
    expect(new Set(CATALOG.map((c) => c.pageId)).size).toBe(CATALOG.length);
    for (const code of ['order_ack', 'delivery_reminder', 'delivery_overdue', 'approval_waiting', 'approval_escalation', 'approval_result', 'work_sent', 'work_late', 'work_returned', 'owner_daily_summary']) {
      expect(DEFAULT_TEMPLATES[code], code).toBeTruthy();
    }
  });
});

describe('Phase 27 (API)', () => {
  const app = newApp();
  let ownerToken = '';
  let tal = '';
  let saw = '';
  const cleanup: (() => Promise<unknown>)[] = [];
  const get = (token: string, path: string) => request(app).get(`${API}${path}`).set('Authorization', `Bearer ${token}`).set(XRW);
  const send = (method: 'post' | 'put' | 'delete', token: string, path: string, body?: unknown) =>
    request(app)[method](`${API}${path}`).set('Authorization', `Bearer ${token}`).set(XRW).send(body as object);
  const file = (token: string, path: string) => get(token, path).buffer(true).parse(binary);

  beforeAll(async () => {
    await seedPhase2Defaults(prisma); // permissions and module controls of the pages added since the test database was seeded
    // a manager role with rights on the Phase 27 pages (the test database has no permission rows for them)
    const role = await prisma.role.upsert({ where: { code: 'TEST27_MGR' }, update: {}, create: { code: 'TEST27_MGR', name: 'Test 27 manager', level: 60 } });
    for (const pid of ['quality-certificate', 'hr-offer-letter', 'dept-mail', 'business-documents']) {
      await prisma.rolePermission.upsert({
        where: { roleId_resource: { roleId: role.id, resource: pageResource(pid) } },
        update: { view: true, add: true, edit: true, approve: true, scope: 'UNIT' },
        create: { roleId: role.id, resource: pageResource(pid), view: true, add: true, edit: true, approve: true, scope: 'UNIT' },
      });
    }
    ownerToken = (await signInOwner(app)).token;
    [tal = '', saw = ''] = await unitIds(['TAL', 'SAW']);
    await prisma.$executeRaw`INSERT INTO module_controls (page_id, owner_department, approval_required, updated_at) VALUES ('quality-certificate', 'Quality', false, now()) ON CONFLICT (page_id) DO NOTHING`;
    await prisma.$executeRaw`UPDATE mail_automation_library SET enabled = default_on, subject_tpl = NULL, body_tpl = NULL`;
    await prisma.$executeRaw`DELETE FROM mail_automation_plants`;
  });

  afterAll(async () => {
    for (const fn of cleanup.reverse()) await fn().catch(() => undefined);
    await prisma.$executeRaw`DELETE FROM mail_automation_runs`;
    await prisma.$executeRaw`DELETE FROM mail_automation_plants`;
    await prisma.$executeRaw`UPDATE mail_automation_library SET enabled = default_on, subject_tpl = NULL, body_tpl = NULL`;
    await prisma.$executeRaw`DELETE FROM internal_messages WHERE subject LIKE 'TEST27%'`;
    await prisma.$executeRaw`DELETE FROM issued_letters WHERE person_name LIKE 'TEST27%'`;
    await prisma.$executeRaw`DELETE FROM quality_certificates WHERE part_name LIKE 'TEST27%'`;
    await prisma.$executeRaw`DELETE FROM email_outbox WHERE subject LIKE '%TEST27%' OR to_email LIKE '%test27%'`;
    await prisma.user.deleteMany({ where: { role: { code: 'TEST27_MGR' } } }).catch(() => undefined);
  });

  it('a quality certificate: rules, numbering, release by another person, and 5 print formats with copy labels', async () => {
    const bad = await send('post', ownerToken, '/qms/certificates', { partName: 'TEST27 Bracket', sampleQty: 10, acceptedQty: 8, rejectedQty: 5, unitId: tal });
    expect(bad.status).toBe(422);
    const failNoNcr = await send('post', ownerToken, '/qms/certificates', { partName: 'TEST27 Bracket', sampleQty: 10, acceptedQty: 8, rejectedQty: 2, result: 'Fail', unitId: tal });
    expect(failNoNcr.status).toBe(422);
    const c = await send('post', ownerToken, '/qms/certificates', { partName: 'TEST27 Bracket', partCode: 'BRK-14', jobCardNo: 'JC-1', sampleQty: 10, acceptedQty: 9, rejectedQty: 1, drawingRevision: 'B', inspector: 'R. Patil', unitId: tal });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    expect(c.body.data.number).toMatch(/^QCT\/TAL\//);
    const id = c.body.data.id as string;
    // a draft prints with a DRAFT mark
    const w0 = await file(ownerToken, `/print/quality-certificate/${id}?kind=word`);
    expect(w0.status, w0.text).toBe(200);
    const zip0 = await JSZip.loadAsync(w0.body as Buffer);
    expect(await zip0.file('word/document.xml')!.async('string')).toContain('DRAFT');
    // the maker cannot release it; another admin can
    expect((await send('post', ownerToken, `/qms/certificates/${id}/approve`)).status).toBe(403);
    const other = await makeUser({ roleCode: 'TEST27_MGR', department: 'Quality' });
    cleanup.push(() => prisma.userUnit.deleteMany({ where: { userId: other.id } }));
    const { token: t2 } = await signIn(app, other);
    const rel = await send('post', t2, `/qms/certificates/${id}/approve`);
    expect(rel.status, JSON.stringify(rel.body)).toBe(200);
    expect((await send('post', t2, `/qms/certificates/${id}/approve`)).status).toBe(409);
    const w1 = await file(ownerToken, `/print/quality-certificate/${id}?kind=word`);
    const doc1 = await (await JSZip.loadAsync(w1.body as Buffer)).file('word/document.xml')!.async('string');
    expect(doc1).toContain('Original');
    expect(doc1).toContain('BRK-14');
    const footer = Object.keys((await JSZip.loadAsync(w1.body as Buffer)).files).find((f) => /^word\/footer\d+\.xml$/.test(f));
    expect(footer).toBeTruthy();
    expect(await (await JSZip.loadAsync(w1.body as Buffer)).file(footer!)!.async('string')).toContain('Uncontrolled copy');
    const w2 = await file(ownerToken, `/print/quality-certificate/${id}?kind=word`);
    expect(await (await JSZip.loadAsync(w2.body as Buffer)).file('word/document.xml')!.async('string')).toContain('Duplicate');
    // all five formats render
    for (const kind of ['standard', 'letterhead', 'commercial'] as const) {
      const pdf = await file(ownerToken, `/print/quality-certificate/${id}?kind=${kind}`);
      expect(pdf.status, kind).toBe(200);
      expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
    }
    const xl = await file(ownerToken, `/print/quality-certificate/${id}?kind=excel`);
    expect(xl.status).toBe(200);
    const xz = await JSZip.loadAsync(xl.body as Buffer);
    expect(Object.keys(xz.files).some((f) => f.includes('worksheets/sheet2'))).toBe(true); // header sheet + lines sheet
    expect((await get(ownerToken, `/print/quality-certificate/${id}?kind=pdf`)).status).toBe(422);
    expect((await get(ownerToken, `/print/quality-certificate/${randomUUID()}?kind=word`)).status).toBe(404);
  });

  it('Document Center: every catalog document counts and lists without error; a sales order prints; send to a department is a movement', async () => {
    const cat = await get(ownerToken, '/doc-center/catalog');
    expect(cat.status, JSON.stringify(cat.body)).toBe(200);
    expect(cat.body.data).toHaveLength(CATALOG.length);
    for (const d of CATALOG) {
      const r = await get(ownerToken, `/doc-center/catalog/${d.pageId}/records`);
      expect(r.status, `${d.pageId}: ${JSON.stringify(r.body)}`).toBe(200);
    }
    const fy = await prisma.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM financial_years ORDER BY start_date DESC LIMIT 1`);
    const cust = await prisma.$queryRawUnsafe<{ id: string }[]>(`INSERT INTO customers (code, name, name_key, state_code, gst_registration_type) VALUES ($1, 'TEST27 Cust', 'test27 cust', '27', 'UNREGISTERED') RETURNING id`, `T27${Date.now().toString().slice(-6)}`);
    const so = await prisma.$queryRawUnsafe<{ id: string }[]>(`INSERT INTO sales_orders (unit_id, fy_id, number, customer_id, status, grand_total) VALUES ($1::uuid, $2::uuid, $3, $4::uuid, 'Approved', 118000) RETURNING id`, tal, fy[0]!.id, `T27-SO-${Date.now()}`, cust[0]!.id);
    cleanup.push(async () => {
      await prisma.$executeRawUnsafe(`DELETE FROM work_movements WHERE doc_id = $1::uuid`, so[0]!.id);
      await prisma.$executeRawUnsafe(`DELETE FROM sales_orders WHERE id = $1::uuid`, so[0]!.id);
      await prisma.$executeRawUnsafe(`DELETE FROM customers WHERE id = $1::uuid`, cust[0]!.id);
    });
    const list = await get(ownerToken, '/doc-center/catalog/sales-orders/records?q=T27-SO');
    expect(list.body.data.length).toBeGreaterThanOrEqual(1);
    for (const kind of ['standard', 'word', 'excel'] as const) {
      const out = await file(ownerToken, `/print/sales-orders/${so[0]!.id}?kind=${kind}`);
      expect(out.status, `${kind} ${out.text}`).toBe(200);
      expect((out.body as Buffer).length).toBeGreaterThan(1000);
    }
    const depts = (await get(ownerToken, '/mail/departments')).body.data as { id: string; name: string }[];
    const sales = depts.find((d) => d.name === 'Sales')!.id;
    const prod = depts.find((d) => d.name === 'Production')!.id;
    await makeUser({ department: 'Production', unitCodes: ['TAL'], defaultUnitCode: 'TAL' }).then((u) => cleanup.push(() => prisma.userUnit.deleteMany({ where: { userId: u.id } })));
    const sent = await send('post', ownerToken, '/doc-center/send', { pageId: 'sales-orders', recordId: so[0]!.id, docNo: 'T27-SO', toDepartmentId: prod, fromDepartmentId: sales });
    expect(sent.status, JSON.stringify(sent.body)).toBe(201);
    expect(sent.body.data.state).toBe('SENT');
    expect((await send('post', ownerToken, '/doc-center/send', { pageId: 'not-a-doc', recordId: so[0]!.id, toDepartmentId: prod })).status).toBe(422);
  });

  it('department mail: a message reaches only people who hold the plant (R-37); unread, open, sent; external mail is queued', async () => {
    const deptRes = await get(ownerToken, '/mail/departments');
    expect(deptRes.status, JSON.stringify(deptRes.body)).toBe(200);
    const depts = deptRes.body.data as { id: string; name: string }[];
    const prod = depts.find((d) => d.name === 'Production')!.id;
    const inTal = await makeUser({ roleCode: 'TEST27_MGR', department: 'Production', unitCodes: ['TAL'], defaultUnitCode: 'TAL' });
    const inSaw = await makeUser({ roleCode: 'TEST27_MGR', department: 'Production', unitCodes: ['SAW'], defaultUnitCode: 'SAW' });
    const sender = await makeUser({ roleCode: 'TEST27_MGR', department: 'Sales', unitCodes: ['TAL'], defaultUnitCode: 'TAL' });
    cleanup.push(() => prisma.userUnit.deleteMany({ where: { userId: { in: [inTal.id, inSaw.id, sender.id] } } }));
    const sTok = (await signIn(app, sender)).token;
    const none = await send('post', sTok, '/mail/internal', { subject: 'TEST27 x', unitId: tal });
    expect(none.status).toBe(422);
    const m = await send('post', sTok, '/mail/internal', { toDepartmentIds: [prod], subject: 'TEST27 Review', attachments: [{ label: 'Sales Order T27', pageId: 'sales-orders', recordId: randomUUID(), format: 'pdf' }], unitId: tal });
    expect(m.status, JSON.stringify(m.body)).toBe(201);
    expect(m.body.data.body).toBe('Please review the attached ERP document(s) and complete the required action.');
    const talTok = (await signIn(app, inTal)).token;
    const sawTok = (await signIn(app, inSaw)).token;
    const box = await get(talTok, '/mail/inbox');
    const mine = (box.body.data as { id: string; subject: string; read: boolean; attachments: number }[]).find((x) => x.subject === 'TEST27 Review');
    expect(mine?.read).toBe(false);
    expect(mine?.attachments).toBe(1);
    expect(((await get(sawTok, '/mail/inbox')).body.data as { subject: string }[]).some((x) => x.subject === 'TEST27 Review')).toBe(false);
    expect((await get(sawTok, `/mail/${m.body.data.id}`)).status).toBe(404);
    const opened = await get(talTok, `/mail/${m.body.data.id}`);
    expect(opened.status).toBe(200);
    expect(opened.body.data.attachments).toHaveLength(1);
    expect(((await get(talTok, '/mail/inbox')).body.data as { subject: string; read: boolean }[]).find((x) => x.subject === 'TEST27 Review')?.read).toBe(true);
    const sentBox = (await get(sTok, '/mail/sent')).body.data as { subject: string; recipients: number; read_by: number }[];
    expect(sentBox.find((x) => x.subject === 'TEST27 Review')?.recipients).toBeGreaterThanOrEqual(1);
    expect(sentBox.find((x) => x.subject === 'TEST27 Review')).toMatchObject({ read_by: 1 });
    // a person who does not work in the plant cannot be picked
    expect((await send('post', sTok, '/mail/internal', { toUserIds: [inSaw.id], subject: 'TEST27 no', unitId: tal })).status).toBe(422);
    // external
    expect((await send('post', sTok, '/mail/external', { to: ['not-an-email'] })).status).toBe(422);
    const ext = await send('post', sTok, '/mail/external', { to: ['buyer@test27.example'], subject: 'TEST27 Quote', body: 'Hello' });
    expect(ext.status, JSON.stringify(ext.body)).toBe(201);
    expect(Number((await prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM email_outbox WHERE to_email = 'buyer@test27.example'`))[0]!.n)).toBe(1);
  });

  it('mail automation library: 40 automations, switches, plants, test mail, idempotency, no recipient', async () => {
    const list = await get(ownerToken, '/admin/mail-automation');
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    expect(list.body.data).toHaveLength(40);
    expect((list.body.data as { wired: boolean }[]).filter((x) => x.wired).length).toBeGreaterThanOrEqual(12);
    expect((list.body.data as { code: string; default_on: boolean }[]).find((x) => x.code === 'birthday_anniversary')?.default_on).toBe(false);
    // a bad time is refused; a good edit is saved
    expect((await send('put', ownerToken, '/admin/mail-automation/owner_daily_summary', { runTime: '25:99' })).status).toBe(422);
    const edit = await send('put', ownerToken, '/admin/mail-automation/owner_daily_summary', { runTime: '07:30', subjectTpl: 'TEST27 Summary {{date}}' });
    expect(edit.status, JSON.stringify(edit.body)).toBe(200);
    expect(edit.body.data.run_time).toBe('07:30');
    await send('put', ownerToken, '/admin/mail-automation/owner_daily_summary', { runTime: '08:00', subjectTpl: null });
    // send a test to me
    const test = await send('post', ownerToken, '/admin/mail-automation/delivery_reminder/test');
    expect(test.status, JSON.stringify(test.body)).toBe(200);
    expect(test.body.data.to).toBe('owner@test.local');
    const runs = await get(ownerToken, '/admin/mail-automation/delivery_reminder/runs');
    expect(runs.body.data[0].status).toBe('TEST');
    // idempotency: the same key sends once
    const vars = { doc_no: 'TEST27/1', detail: '10 nos X', due_date: '15-12-2026' };
    expect(await deliver({ code: 'delivery_reminder', unitId: tal, runKey: 'k1', to: ['a@test27.example'], vars })).toBe('SENT');
    expect(await deliver({ code: 'delivery_reminder', unitId: tal, runKey: 'k1', to: ['a@test27.example'], vars })).toBe('DUPLICATE');
    // no usable address is a skipped run, not an error
    expect(await deliver({ code: 'delivery_reminder', unitId: tal, runKey: 'k2', to: ['', 'bad'], vars })).toBe('NO_RECIPIENT');
    // off for one plant only
    expect((await send('put', ownerToken, `/admin/mail-automation/delivery_reminder/plants/${saw}`, { enabled: false })).status).toBe(200);
    expect(await deliver({ code: 'delivery_reminder', unitId: saw, runKey: 'k3', to: ['a@test27.example'], vars })).toBe('OFF');
    expect(await deliver({ code: 'delivery_reminder', unitId: tal, runKey: 'k4', to: ['a@test27.example'], vars })).toBe('SENT');
    // off everywhere
    await send('put', ownerToken, '/admin/mail-automation/delivery_reminder', { enabled: false });
    expect(await deliver({ code: 'delivery_reminder', unitId: tal, runKey: 'k5', to: ['a@test27.example'], vars })).toBe('OFF');
    await send('put', ownerToken, '/admin/mail-automation/delivery_reminder', { enabled: true });
    const rows = await prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM email_outbox WHERE to_email = 'a@test27.example'`);
    expect(Number(rows[0]!.n)).toBe(2); // k1 and k4 only
  });

  it('delivery reminder and overdue: a PO line due in 3 days reminds the supplier contact with the buyer in CC, once a day', async () => {
    const fy = await prisma.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM financial_years ORDER BY start_date DESC LIMIT 1`);
    const code = `T27S${Date.now().toString().slice(-6)}`;
    const sup = await prisma.$queryRawUnsafe<{ id: string }[]>(`INSERT INTO suppliers (code, name, name_key, state_code, gst_registration_type) VALUES ($1, 'TEST27 Supplier', 'test27 supplier', '27', 'UNREGISTERED') RETURNING id`, code);
    await prisma.$executeRawUnsafe(`INSERT INTO supplier_contacts (supplier_id, name, email, is_primary, receives_po, receives_reminders) VALUES ($1::uuid, 'Contact', 'supplier@test27.example', true, true, true)`, sup[0]!.id);
    const buyer = await makeUser({ department: 'Purchase', unitCodes: ['TAL'], defaultUnitCode: 'TAL', email: 'buyer-cc@test27.example' });
    const num = `PO/TAL/T27/${Date.now().toString().slice(-5)}`;
    const po = await prisma.$queryRawUnsafe<{ id: string }[]>(`INSERT INTO purchase_orders (unit_id, fy_id, supplier_id, number, status, created_by_id) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, 'Approved', $5::uuid) RETURNING id`, tal, fy[0]!.id, sup[0]!.id, num, buyer.id);
    const line = await prisma.$queryRawUnsafe<{ id: string }[]>(`INSERT INTO purchase_order_lines (po_id, line_no, service_text, qty, uom, base_qty, rate, delivery_date, received_qty) VALUES ($1::uuid, 1, 'BRK-14', 200, 'Nos', 200, 10, CURRENT_DATE + 3, 0) RETURNING id`, po[0]!.id);
    cleanup.push(async () => {
      await prisma.$executeRawUnsafe(`DELETE FROM purchase_order_lines WHERE po_id = $1::uuid`, po[0]!.id);
      await prisma.$executeRawUnsafe(`DELETE FROM purchase_orders WHERE id = $1::uuid`, po[0]!.id);
      await prisma.$executeRawUnsafe(`DELETE FROM supplier_contacts WHERE supplier_id = $1::uuid`, sup[0]!.id);
      await prisma.$executeRawUnsafe(`DELETE FROM suppliers WHERE id = $1::uuid`, sup[0]!.id);
      await prisma.userUnit.deleteMany({ where: { userId: buyer.id } });
    });
    const lib = (await prisma.$queryRawUnsafe<Record<string, unknown>[]>(`SELECT * FROM mail_automation_library WHERE code = 'delivery_reminder'`))[0]!;
    const n1 = await mailAutomation.collect('delivery_reminder', lib, new Date());
    expect(n1).toBeGreaterThanOrEqual(1);
    const mails = await prisma.$queryRawUnsafe<{ to_email: string; subject: string; text: string }[]>(`SELECT to_email, subject, text FROM email_outbox WHERE to_email IN ('supplier@test27.example','buyer-cc@test27.example') ORDER BY to_email`);
    expect(mails.map((m) => m.to_email)).toEqual(['buyer-cc@test27.example', 'supplier@test27.example']);
    expect(mails[1]!.subject).toContain(num);
    expect(mails[1]!.text).toContain('200 nos BRK-14');
    // the same day again: nothing new
    await mailAutomation.collect('delivery_reminder', lib, new Date());
    expect(Number((await prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM email_outbox WHERE to_email = 'supplier@test27.example'`))[0]!.n)).toBe(1);
    // overdue: move the due date to yesterday
    await prisma.$executeRawUnsafe(`UPDATE purchase_order_lines SET delivery_date = CURRENT_DATE - 1 WHERE id = $1::uuid`, line[0]!.id);
    const lib2 = (await prisma.$queryRawUnsafe<Record<string, unknown>[]>(`SELECT * FROM mail_automation_library WHERE code = 'delivery_overdue'`))[0]!;
    expect(await mailAutomation.collect('delivery_overdue', lib2, new Date())).toBeGreaterThanOrEqual(1);
    // received in full: no reminder
    await prisma.$executeRawUnsafe(`UPDATE purchase_order_lines SET received_qty = 200, delivery_date = CURRENT_DATE + 3 WHERE id = $1::uuid`, line[0]!.id);
    await prisma.$executeRaw`DELETE FROM mail_automation_runs WHERE code = 'delivery_reminder'`;
    expect(await mailAutomation.collect('delivery_reminder', lib, new Date())).toBe(0);
  });

  it('owner summary counts only the plants the person holds', async () => {
    const text = await summaryText([tal], ['TAL']);
    expect(text).toContain('Plants: TAL');
    expect(text).not.toContain('SAW');
    expect(text).toMatch(/Sales invoiced yesterday: ₹ [\d,]+/);
    expect(text).toContain('Open exceptions:');
  });

  it('letters: merge fields, approval by another person, issue only after approval, email', async () => {
    const miss = await send('post', ownerToken, '/hr/letters', { templateCode: 'OFFER', personName: 'TEST27 Asha', data: { designation: 'Engineer' }, unitId: tal });
    expect(miss.status).toBe(422);
    expect(JSON.stringify(miss.body)).toContain('Fill in');
    const l = await send('post', ownerToken, '/hr/letters', { templateCode: 'OFFER', personName: 'TEST27 Asha', personEmail: 'asha@test27.example', data: { designation: 'Engineer', department: 'Production', gross: '45,000', joining_date: '01-12-2026' }, unitId: tal });
    expect(l.status, JSON.stringify(l.body)).toBe(201);
    expect(l.body.data.number).toMatch(/^LTR\/TAL\//);
    expect(l.body.data.body_html).toContain('Engineer');
    expect(l.body.data.body_html).not.toContain('{{');
    const id = l.body.data.id as string;
    const early = await send('post', ownerToken, `/hr/letters/${id}/issue`);
    expect(early.status).toBe(409);
    expect(JSON.stringify(early.body)).toContain('must be approved before issue');
    expect((await send('post', ownerToken, `/hr/letters/${id}/approve`)).status).toBe(403); // the maker cannot approve
    const other = await makeUser({ roleCode: 'TEST27_MGR', department: 'HR' });
    cleanup.push(() => prisma.userUnit.deleteMany({ where: { userId: other.id } }));
    const t2 = (await signIn(app, other)).token;
    expect((await send('post', t2, `/hr/letters/${id}/approve`)).status).toBe(200);
    expect((await send('post', ownerToken, `/hr/letters/${id}/email`)).status).toBe(409); // not issued yet
    expect((await send('post', ownerToken, `/hr/letters/${id}/issue`)).status).toBe(200);
    const em = await send('post', ownerToken, `/hr/letters/${id}/email`);
    expect(em.status, JSON.stringify(em.body)).toBe(200);
    expect(em.body.data.emailed_at).toBeTruthy();
    const pdf = await file(ownerToken, `/print/hr-offer-letter/${id}?kind=letterhead`);
    expect(pdf.status).toBe(200);
    const word = await file(ownerToken, `/print/hr-offer-letter/${id}?kind=word`);
    expect(await (await JSZip.loadAsync(word.body as Buffer)).file('word/document.xml')!.async('string')).toContain('Engineer');
  });
});
