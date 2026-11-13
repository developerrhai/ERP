/* eslint-disable @typescript-eslint/no-unsafe-member-access */
// Phase 31: owner and admin control. Custom fields, form rules (enforced by the API), modules per plant, login policies,
// sessions, View as, API keys, numbering preview, console cards.
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import JSZip from 'jszip';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pageResource } from '../src/core/rbac/permission-model';
import { seedPhase2Defaults } from '../src/core/seed/defaults';
import { checkValue, effectiveRules, hoursMessage, ipAllowed, moduleOn, numberLengthOk, previewNumber, ruleViolations, validCidr, withinHours } from '../src/modules/control/calc';
import { controlService } from '../src/modules/control/service';
import { API, PASSWORD, XRW, makeUser, newApp, prisma, signIn, signInOwner, unitIds } from './helpers';

describe('Phase 31 rules (pure)', () => {
  const def = (type: Parameters<typeof checkValue>[0]['type'], extra: Partial<Parameters<typeof checkValue>[0]> = {}) => ({ key: 'k', label: 'Field', type, options: ['A', 'B'], required: false, ...extra });
  it('every custom field type is checked', () => {
    expect(checkValue(def('text'), ' DRG-1 ')).toEqual({ ok: true, value: 'DRG-1' });
    expect(checkValue(def('number'), 4.5).ok).toBe(false);
    expect(checkValue(def('number'), '7')).toEqual({ ok: true, value: 7 });
    expect(checkValue(def('decimal'), 'x').ok).toBe(false);
    expect(checkValue(def('date'), '2026-13-45').ok).toBe(false);
    expect(checkValue(def('date'), '2026-11-30').ok).toBe(true);
    expect(checkValue(def('bool'), 'yes').ok).toBe(false);
    expect(checkValue(def('select'), 'C').ok).toBe(false);
    expect(checkValue(def('multiselect'), ['A', 'B']).ok).toBe(true);
    expect(checkValue(def('multiselect'), ['A', 'Z']).ok).toBe(false);
    expect(checkValue(def('lookup'), 'not-a-uuid').ok).toBe(false);
    expect(checkValue(def('text', { required: true }), '')).toEqual({ ok: false, error: 'Field is required.' });
    expect(checkValue(def('text'), '')).toEqual({ ok: true, value: null });
  });
  it('form rules: the strictest effect wins, role / status / plant narrow a rule, violations are named', () => {
    const rows = [
      { fieldKey: 'terms', effect: 'REQUIRED' as const, roleId: 'emp', status: 'Draft', unitId: null },
      { fieldKey: 'terms', effect: 'READONLY' as const, roleId: 'emp', status: 'Approved', unitId: null },
      { fieldKey: 'cost', effect: 'HIDDEN' as const, roleId: null, status: null, unitId: 'tal' },
    ];
    expect(effectiveRules(rows, { roleId: 'emp', status: 'Draft', unitId: 'tal' })).toEqual(new Map([['terms', 'REQUIRED'], ['cost', 'HIDDEN']]));
    expect(effectiveRules(rows, { roleId: 'emp', status: 'Approved', unitId: 'saw' }).get('terms')).toBe('READONLY');
    expect(effectiveRules(rows, { roleId: 'boss', status: 'Draft', unitId: 'saw' }).size).toBe(0);
    const rules = effectiveRules(rows, { roleId: 'emp', status: 'Draft', unitId: 'tal' });
    expect(ruleViolations(rules, ['cost'], { terms: '' }, { terms: 'Payment Terms', cost: 'Cost' })).toEqual({ cost: 'Cost is read-only here.', terms: 'Payment Terms is required.' });
    expect(ruleViolations(rules, [], { terms: '30 days' })).toEqual({});
  });
  it('sign-in hours (IST, across midnight too) and the IP allow-list', () => {
    const at = (ist: string) => new Date(new Date(`2026-11-13T${ist}:00Z`).getTime() - 330 * 60_000);
    expect(withinHours(at('06:00'), '06:00', '23:00')).toBe(true);
    expect(withinHours(at('22:59'), '06:00', '23:00')).toBe(true);
    expect(withinHours(at('23:30'), '06:00', '23:00')).toBe(false);
    expect(withinHours(at('05:59'), '06:00', '23:00')).toBe(false);
    expect(withinHours(at('23:30'), '22:00', '06:00')).toBe(true); // night window
    expect(withinHours(at('12:00'), '22:00', '06:00')).toBe(false);
    expect(withinHours(at('03:00'), null, null)).toBe(true);
    expect(hoursMessage('06:00:00', '23:00:00')).toBe('Sign-in is allowed 06:00–23:00 for your role.');
    expect(ipAllowed('203.0.113.77', ['203.0.113.0/24'])).toBe(true);
    expect(ipAllowed('203.0.114.1', ['203.0.113.0/24'])).toBe(false);
    expect(ipAllowed('10.1.2.3', [])).toBe(true);
    expect(ipAllowed('::ffff:10.0.0.5', ['10.0.0.5'])).toBe(true);
    expect(ipAllowed('::1', ['127.0.0.0/8'])).toBe(true);
    expect(validCidr('10.0.0.0/8')).toBe(true);
    expect(validCidr('10.0.0.0/33')).toBe(false);
    expect(validCidr('nope')).toBe(false);
  });
  it('numbering preview and the 16-character rule for GST documents; module switches', () => {
    const p = previewNumber({ prefix: 'INV/', padding: 5, next: 12, plant: 'TAL', fy: '2627' });
    expect(p).toBe('INV/TAL/2627/00012');
    expect(numberLengthOk(p, true)).toBe(false);
    expect(numberLengthOk('INV/TAL/26/00012', true)).toBe(true);
    expect(numberLengthOk(p, false)).toBe(true);
    const rows = [{ unitId: 'var', roleId: null, enabled: false }, { unitId: 'var', roleId: 'chef', enabled: true }];
    expect(moduleOn(rows, 'var', 'emp')).toBe(false);
    expect(moduleOn(rows, 'var', 'chef')).toBe(true);
    expect(moduleOn(rows, 'tal', 'emp')).toBe(true);
  });
});

describe('Phase 31 (API)', () => {
  const app = newApp();
  let ownerToken = '';
  let tal = '';
  let saw = '';
  let sawName = '';
  let mgrRoleId = '';
  const cleanup: (() => Promise<unknown>)[] = [];
  const get = (token: string, path: string, h: Record<string, string> = {}) => request(app).get(`${API}${path}`).set('Authorization', `Bearer ${token}`).set(XRW).set(h);
  const send = (method: 'post' | 'put' | 'delete' | 'patch', token: string, path: string, body?: unknown, h: Record<string, string> = {}) =>
    request(app)[method](`${API}${path}`).set('Authorization', `Bearer ${token}`).set(XRW).set(h).send(body as object);

  beforeAll(async () => {
    await seedPhase2Defaults(prisma);
    ownerToken = (await signInOwner(app)).token;
    [tal = '', saw = ''] = await unitIds(['TAL', 'SAW']);
    sawName = String((await prisma.$queryRawUnsafe<{ name: string }[]>(`SELECT name FROM units WHERE id = $1::uuid`, saw))[0]!.name);
    const role = await prisma.role.upsert({ where: { code: 'TEST31_MGR' }, update: {}, create: { code: 'TEST31_MGR', name: 'Test 31 manager', level: 60 } });
    mgrRoleId = role.id;
    for (const pid of ['ops-canteen', 'crm-leads', 'sales-orders']) {
      await prisma.rolePermission.upsert({
        where: { roleId_resource: { roleId: role.id, resource: pageResource(pid) } },
        update: { view: true, add: true, edit: true, scope: 'UNIT' },
        create: { roleId: role.id, resource: pageResource(pid), view: true, add: true, edit: true, scope: 'UNIT' },
      });
    }
  });

  afterAll(async () => {
    for (const fn of cleanup.reverse()) await fn().catch(() => undefined);
    await prisma.$executeRaw`DELETE FROM custom_field_values WHERE key LIKE 't31_%'`;
    await prisma.$executeRaw`DELETE FROM custom_field_defs WHERE key LIKE 't31_%'`;
    await prisma.$executeRaw`DELETE FROM form_rules WHERE field_key LIKE 't31%' OR page_id = 'crm-leads'`;
    await prisma.$executeRaw`DELETE FROM module_plant_controls`;
    await prisma.$executeRaw`DELETE FROM role_login_policies`;
    await prisma.$executeRaw`DELETE FROM view_as_sessions`;
    await prisma.$executeRaw`DELETE FROM api_keys WHERE name LIKE 'T31%'`;
    await prisma.$executeRaw`DELETE FROM records WHERE page_id = 'crm-leads' AND data->>'leadName' LIKE 'T31%'`.catch(() => 0);
    controlService.clearModuleCache();
  });

  it('custom fields: a "Drawing No" end to end - definition, plant rule, value checks, form meta, and it prints on the document', async () => {
    const bad = await send('post', ownerToken, '/admin/custom-fields', { pageId: 'sales-orders', key: 'Bad Key', label: 'x', type: 'text' });
    expect(bad.status).toBe(422);
    expect((await send('post', ownerToken, '/admin/custom-fields', { pageId: 'no-such-page', key: 't31_x', label: 'x', type: 'text' })).status).toBe(422);
    expect((await send('post', ownerToken, '/admin/custom-fields', { pageId: 'sales-orders', key: 't31_sel', label: 'Grade', type: 'select' })).status).toBe(422); // no choices
    const d = await send('post', ownerToken, '/admin/custom-fields', { pageId: 'sales-orders', key: 't31_drawing_no', label: 'Drawing No', labelHi: 'ड्रॉइंग नं.', type: 'text', required: false, unitIds: [tal], inList: true, inFilter: true });
    expect(d.status, JSON.stringify(d.body)).toBe(201);
    expect((await send('post', ownerToken, '/admin/custom-fields', { pageId: 'sales-orders', key: 't31_drawing_no', label: 'dup', type: 'text' })).status).toBe(409);
    const grade = await send('post', ownerToken, '/admin/custom-fields', { pageId: 'sales-orders', key: 't31_grade', label: 'Grade', type: 'select', options: ['A', 'B'], unitIds: [tal] });
    expect(grade.status).toBe(201);
    // a sales order of Talwade
    const fy = await prisma.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM financial_years ORDER BY start_date DESC LIMIT 1`);
    const cust = await prisma.$queryRawUnsafe<{ id: string }[]>(`INSERT INTO customers (code, name, name_key, state_code, gst_registration_type) VALUES ($1,'T31 Cust','t31 cust','27','UNREGISTERED') RETURNING id`, `T31${Date.now().toString().slice(-6)}`);
    const so = await prisma.$queryRawUnsafe<{ id: string }[]>(`INSERT INTO sales_orders (unit_id, fy_id, number, customer_id, status, grand_total) VALUES ($1::uuid,$2::uuid,$3,$4::uuid,'Approved',1000) RETURNING id`, tal, fy[0]!.id, `T31-SO-${Date.now()}`, cust[0]!.id);
    cleanup.push(async () => { await prisma.$executeRawUnsafe(`DELETE FROM sales_orders WHERE id = $1::uuid`, so[0]!.id); await prisma.$executeRawUnsafe(`DELETE FROM customers WHERE id = $1::uuid`, cust[0]!.id); });
    const rid = so[0]!.id;
    expect((await send('put', ownerToken, `/custom-fields/sales-orders/${rid}`, { values: { t31_grade: 'C' } }, { 'X-Units': 'TAL' })).status).toBe(422); // not one of the choices
    expect((await send('put', ownerToken, `/custom-fields/sales-orders/${rid}`, { values: { nope: 'x' } }, { 'X-Units': 'TAL' })).status).toBe(422);
    const ok = await send('put', ownerToken, `/custom-fields/sales-orders/${rid}`, { values: { t31_drawing_no: 'DRG-4412-B', t31_grade: 'A' } }, { 'X-Units': 'TAL' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.data).toMatchObject({ t31_drawing_no: 'DRG-4412-B', t31_grade: 'A' });
    expect((await get(ownerToken, `/custom-fields/sales-orders/${rid}`)).body.data.t31_drawing_no).toBe('DRG-4412-B');
    // the field is for Talwade only: a Sawardari session does not see it
    const metaTal = (await get(ownerToken, '/forms/sales-orders/meta', { 'X-Units': 'TAL' })).body.data;
    expect((metaTal.customFields as { key: string }[]).some((f) => f.key === 't31_drawing_no')).toBe(true);
    const metaSaw = (await get(ownerToken, '/forms/sales-orders/meta', { 'X-Units': 'SAW' })).body.data;
    expect((metaSaw.customFields as { key: string }[]).some((f) => f.key === 't31_drawing_no')).toBe(false);
    // required
    const req = await send('put', ownerToken, `/admin/custom-fields/${d.body.data.id}`, { required: true });
    expect(req.status).toBe(200);
    expect((await send('put', ownerToken, `/custom-fields/sales-orders/${rid}`, { values: { t31_drawing_no: '' } }, { 'X-Units': 'TAL' })).status).toBe(422);
    await send('put', ownerToken, `/admin/custom-fields/${d.body.data.id}`, { required: false });
    // it prints: the Word file and the Excel file carry "Drawing No: DRG-4412-B"
    const bin = (token: string, path: string) => get(token, path).buffer(true).parse((r, cb) => { const c: Buffer[] = []; r.on('data', (x: Buffer) => c.push(x)); r.on('end', () => cb(null, Buffer.concat(c))); });
    const word = await bin(ownerToken, `/print/sales-orders/${rid}?kind=word`);
    expect(word.status).toBe(200);
    const xml = await (await JSZip.loadAsync(word.body as Buffer)).file('word/document.xml')!.async('string');
    expect(xml).toContain('Drawing No');
    expect(xml).toContain('DRG-4412-B');
    const xl = await bin(ownerToken, `/print/sales-orders/${rid}?kind=excel`);
    const sheet = await (await JSZip.loadAsync(xl.body as Buffer)).file('xl/sharedStrings.xml')!.async('string');
    expect(sheet).toContain('DRG-4412-B');
    // switched off for the PDF / Word? (in_pdf false) it disappears from the PDF side only
    await send('put', ownerToken, `/admin/custom-fields/${d.body.data.id}`, { inPdf: false });
    const word2 = await bin(ownerToken, `/print/sales-orders/${rid}?kind=word`);
    expect(await (await JSZip.loadAsync(word2.body as Buffer)).file('word/document.xml')!.async('string')).not.toContain('DRG-4412-B');
  });

  it('form rules are enforced by the API, not just the screen (the shared record engine)', async () => {
    const ownerRole = (await prisma.$queryRawUnsafe<{ id: string }[]>(`SELECT r.id FROM users u JOIN roles r ON r.id = u.role_id WHERE u.email = 'owner@test.local'`))[0]!.id;
    // a system field cannot be hidden
    const sys = await send('post', ownerToken, '/admin/form-rules', { pageId: 'crm-leads', fieldKey: 'status', effect: 'HIDDEN' });
    expect(sys.status).toBe(422);
    expect(JSON.stringify(sys.body)).toContain("status is required by the system and can't be made optional.");
    const rule = await send('post', ownerToken, '/admin/form-rules', { pageId: 'crm-leads', fieldKey: 'company', effect: 'REQUIRED', roleId: ownerRole, status: 'Draft' });
    expect(rule.status, JSON.stringify(rule.body)).toBe(201);
    expect((await send('post', ownerToken, '/admin/form-rules', { pageId: 'crm-leads', fieldKey: 'company', effect: 'REQUIRED', roleId: ownerRole, status: 'Draft' })).status).toBe(409);
    const create = (data: Record<string, unknown>) => send('post', ownerToken, '/pages/crm-leads/records', { data }, { 'X-Units': 'TAL' });
    const noCompany = await create({ leadName: 'T31 lead one' });
    expect(noCompany.status).toBe(422);
    expect(JSON.stringify(noCompany.body)).toContain('company is required.');
    const withCompany = await create({ leadName: 'T31 lead one', company: 'Acme' });
    expect(withCompany.status, JSON.stringify(withCompany.body)).toBe(201);
    // a read-only rule on an existing record: changing the field through the API is refused
    const ro = await send('post', ownerToken, '/admin/form-rules', { pageId: 'crm-leads', fieldKey: 'company', effect: 'READONLY', roleId: ownerRole, status: 'Draft' });
    expect(ro.status).toBe(201);
    const patch = await send('patch', ownerToken, `/pages/crm-leads/records/${withCompany.body.data.id}`, { data: { company: 'Other Co' } }, { 'If-Match': String(withCompany.body.data.version), 'X-Units': 'TAL' });
    expect(patch.status, JSON.stringify(patch.body)).toBe(422);
    expect(JSON.stringify(patch.body)).toContain('company is read-only here.');
    // removing the rules lets the change through (the rules are data, not code)
    await send('delete', ownerToken, `/admin/form-rules/${ro.body.data.id}`);
    await send('delete', ownerToken, `/admin/form-rules/${rule.body.data.id}`);
    const patch2 = await send('patch', ownerToken, `/pages/crm-leads/records/${withCompany.body.data.id}`, { data: { company: 'Other Co' } }, { 'If-Match': String(withCompany.body.data.version), 'X-Units': 'TAL' });
    expect(patch2.status, JSON.stringify(patch2.body)).toBe(200);
  });

  it('module off for one plant: 403 MODULE_OFF with the plant name, hidden in the menu, other plants unaffected, a role can be re-enabled', async () => {
    const tUser = await makeUser({ roleCode: 'TEST31_MGR', department: 'HR', unitCodes: ['TAL'], defaultUnitCode: 'TAL' });
    const sUser = await makeUser({ roleCode: 'TEST31_MGR', department: 'HR', unitCodes: ['SAW'], defaultUnitCode: 'SAW' });
    cleanup.push(() => prisma.userUnit.deleteMany({ where: { userId: { in: [tUser.id, sUser.id] } } }));
    const tTok = (await signIn(app, tUser)).token;
    const sTok = (await signIn(app, sUser)).token;
    expect((await get(sTok, '/ops/canteen/rates')).status).toBe(200);
    const off = await send('put', ownerToken, '/admin/module-plants', { pageId: 'ops-canteen', unitId: saw, enabled: false });
    expect(off.status, JSON.stringify(off.body)).toBe(200);
    const blocked = await get(sTok, '/ops/canteen/rates');
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('MODULE_OFF');
    expect(blocked.body.error.message).toBe(`Canteen is turned off for ${sawName}.`);
    expect((await get(tTok, '/ops/canteen/rates')).status).toBe(200); // Talwade is unaffected
    const menu = (await get(sTok, '/me/menu-v2')).body.data.families as { pages: { id: string }[] }[];
    expect(menu.flatMap((f) => f.pages).some((p) => p.id === 'ops-canteen')).toBe(false);
    const menuT = (await get(tTok, '/me/menu-v2')).body.data.families as { pages: { id: string }[] }[];
    expect(menuT.flatMap((f) => f.pages).some((p) => p.id === 'ops-canteen')).toBe(true);
    // a role-specific "on" row re-enables it for that role in that plant
    await send('put', ownerToken, '/admin/module-plants', { pageId: 'ops-canteen', unitId: saw, roleId: mgrRoleId, enabled: true });
    expect((await get(sTok, '/ops/canteen/rates')).status).toBe(200);
    await send('put', ownerToken, '/admin/module-plants', { pageId: 'ops-canteen', unitId: saw, roleId: mgrRoleId, enabled: false });
    expect((await get(sTok, '/ops/canteen/rates')).status).toBe(403);
    expect(((await get(ownerToken, '/admin/module-plants')).body.data as unknown[]).length).toBeGreaterThanOrEqual(2);
    await prisma.$executeRaw`DELETE FROM module_plant_controls`;
    controlService.clearModuleCache();
    expect((await get(sTok, '/ops/canteen/rates')).status).toBe(200);
  });

  it('login policy: an address outside the allowed range is refused at sign-in; hours are checked in IST; sessions can be ended', async () => {
    const u = await makeUser({ roleCode: 'TEST31_MGR', department: 'HR', unitCodes: ['TAL'], defaultUnitCode: 'TAL' });
    cleanup.push(() => prisma.userUnit.deleteMany({ where: { userId: u.id } }));
    const login = () => request(app).post(`${API}/auth/login`).set(XRW).send({ identifier: u.loginId, password: PASSWORD });
    expect((await login()).status).toBe(200);
    expect((await send('put', ownerToken, '/admin/login-policies', { roleId: mgrRoleId, ipCidrs: ['not-an-ip'] })).status).toBe(422);
    expect((await send('put', ownerToken, '/admin/login-policies', { roleId: mgrRoleId, hoursFrom: '06:00' })).status).toBe(422); // both ends needed
    const set = await send('put', ownerToken, '/admin/login-policies', { roleId: mgrRoleId, ipCidrs: ['203.0.113.0/24'], mfaRequired: false });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    const refused = await login();
    expect(refused.status).toBe(403);
    expect(JSON.stringify(refused.body)).toContain('Sign-in from this address is not allowed for your role.');
    // the refusal is audited
    const audited = await prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'LOGIN_BLOCKED_POLICY' AND target_id = $1`, u.id);
    expect(Number(audited[0]!.n)).toBeGreaterThanOrEqual(1);
    // hours, with a chosen clock (IST 23:30 against 06:00-23:00)
    await send('put', ownerToken, '/admin/login-policies', { roleId: mgrRoleId, hoursFrom: '06:00', hoursTo: '23:00', ipCidrs: [] });
    await expect(controlService.assertLoginPolicy(mgrRoleId, '127.0.0.1', new Date(new Date('2026-11-13T23:30:00Z').getTime() - 330 * 60_000), u.id)).rejects.toThrow('Sign-in is allowed 06:00–23:00 for your role.');
    await expect(controlService.assertLoginPolicy(mgrRoleId, '127.0.0.1', new Date(new Date('2026-11-13T12:00:00Z').getTime() - 330 * 60_000), u.id)).resolves.toBeUndefined();
    await prisma.$executeRaw`DELETE FROM role_login_policies`;
    // sessions: list and force logout
    const signed = await signIn(app, u);
    const list = (await get(ownerToken, `/admin/sessions?userId=${u.id}`)).body.data as { id: string }[];
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect((await get(signed.token, '/auth/me')).status).toBe(200);
    for (const s of list) expect((await send('delete', ownerToken, `/admin/sessions/${s.id}`)).status).toBe(200);
    expect((await get(signed.token, '/auth/me')).status).toBe(401);
    expect((await send('delete', ownerToken, `/admin/sessions/${list[0]!.id}`)).status).toBe(404); // already ended
  });

  it('View as: needs a reason, answers as the other person, cannot write, ends; API keys are shown once; numbering preview', async () => {
    const emp = await makeUser({ role: 'EMPLOYEE', department: 'Sales', unitCodes: ['TAL'], defaultUnitCode: 'TAL', name: 'Asha Employee' });
    cleanup.push(() => prisma.userUnit.deleteMany({ where: { userId: emp.id } }));
    expect((await send('post', ownerToken, '/owner/view-as', { targetUserId: emp.id, reason: 'x' })).status).toBe(422);
    const va = await send('post', ownerToken, '/owner/view-as', { targetUserId: emp.id, reason: 'Checking what the employee sees' });
    expect(va.status, JSON.stringify(va.body)).toBe(201);
    expect(va.body.data.banner).toBe('Viewing as Asha Employee — read-only.');
    const hdr = { 'X-View-As': String(va.body.data.id) };
    const me = await get(ownerToken, '/auth/me', hdr);
    expect(me.status, JSON.stringify(me.body)).toBe(200);
    expect(JSON.stringify(me.body)).toContain(emp.id);
    expect(me.headers['x-viewing-as']).toBe(encodeURIComponent('Asha Employee'));
    const write = await send('post', ownerToken, '/pages/crm-leads/records', { data: { leadName: 'T31 view-as write' } }, hdr);
    expect(write.status).toBe(403);
    expect(JSON.stringify(write.body)).toContain('Viewing as Asha Employee — read-only.');
    const wrong = await get(ownerToken, '/auth/me', { 'X-View-As': randomUUID() });
    expect(JSON.stringify(wrong.body)).toContain('owner@test.local'); // an unknown session is ignored: still the owner
    expect((await send('delete', ownerToken, `/owner/view-as/${va.body.data.id}`)).status).toBe(200);
    const after = await get(ownerToken, '/auth/me', hdr);
    expect(JSON.stringify(after.body)).toContain('owner@test.local');
    // an ordinary employee cannot start it
    const empTok = (await signIn(app, emp)).token;
    expect((await send('post', empTok, '/owner/view-as', { targetUserId: emp.id, reason: 'trying it out' })).status).toBe(403);
    // API keys
    const k = await send('post', ownerToken, '/admin/api-keys', { name: 'T31 key', scopes: ['read'] });
    expect(k.status, JSON.stringify(k.body)).toBe(201);
    expect(k.body.data.key).toMatch(/^rhk_[0-9a-f]{8}\.[0-9a-f]{48}$/);
    const keys = (await get(ownerToken, '/admin/api-keys')).body.data as Record<string, unknown>[];
    const mine = keys.find((x) => x.id === k.body.data.id)!;
    expect(mine).not.toHaveProperty('key_hash');
    expect(JSON.stringify(keys)).not.toContain(String(k.body.data.key).split('.')[1]);
    expect((await send('delete', ownerToken, `/admin/api-keys/${k.body.data.id}`)).status).toBe(200);
    expect((await send('delete', ownerToken, `/admin/api-keys/${k.body.data.id}`)).status).toBe(404);
    // numbering: the preview and the length rule
    const pv = await send('post', ownerToken, '/admin/numbering/preview', { prefix: 'INV/', padding: 5, next: 12, plant: 'TAL', fy: '2627', gst: true });
    expect(pv.body.data).toEqual({ preview: 'INV/TAL/2627/00012', length: 18, ok: false });
    expect((await get(ownerToken, '/admin/numbering')).status).toBe(200);
    // console cards and health
    const cards = (await get(ownerToken, '/owner/console')).body.data;
    expect(cards).toHaveProperty('sessionsNow');
    expect(cards.customFields).toBeGreaterThanOrEqual(2);
    expect(cards.viewAsToday).toBeGreaterThanOrEqual(1);
    const health = (await get(ownerToken, '/admin/health')).body.data;
    expect(typeof health.dbMs).toBe('number');
  });
});
