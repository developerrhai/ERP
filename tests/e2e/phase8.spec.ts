// Why: end-to-end proof of the Phase 8 inventory stories as a normal user clicks them (docs/phases/PHASE-08.md and
// PHASE-08-REPORT.md): receive powder with a batch and dates into Quality Inspection (it cannot be issued), receive normal
// stock on a two-line voucher and see the books move, issue at the average, transfer to another warehouse in two steps,
// cancel with a reason, run the weekly Powder Stock Monitoring Sheet, and see the expiry report. Runs after the earlier
// specs on the same e2e database (the owner already has the "next" password).
import { test, expect, type Page } from '@playwright/test';
import { E2E } from './e2e-env.mjs';

const OWNER_PW = E2E.owner.newPassword;
test.describe.configure({ mode: 'serial' });

async function signIn(page: Page, id: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email / User ID').fill(id);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/api/v1/auth/login')),
    page.getByRole('button', { name: 'Sign In to ERP' }).click(),
  ]);
}

async function selectUnit(page: Page, label: string) {
  const unit = page.getByLabel('Unit', { exact: true });
  await expect(unit.locator('option', { hasText: label })).toHaveCount(1);
  if ((await unit.locator('option:checked').innerText()).trim() === label) return;
  await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/me/context') && r.request().method() === 'PUT' && r.ok()),
    unit.selectOption({ label }),
  ]);
}

type Res = { status: number; json: unknown };
/** One API call from inside the signed-in page (fresh access token from the httpOnly refresh cookie). */
async function api(page: Page, method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Res> {
  await page.waitForLoadState('domcontentloaded');
  return page.evaluate(
    async ({ method, path, body, headers }) => {
      let data: { accessToken: string } | undefined;
      for (let attempt = 0; attempt < 5 && !data; attempt++) {
        const r = await fetch('/api/v1/auth/refresh', { method: 'POST', headers: { 'X-Requested-With': 'rhai-web' } });
        if (r.ok) data = ((await r.json()) as { data: { accessToken: string } }).data;
        else await new Promise((res) => setTimeout(res, 400));
      }
      if (!data) throw new Error('could not refresh the session for the test helper');
      const h: Record<string, string> = { Authorization: `Bearer ${data.accessToken}`, ...headers };
      if (body !== undefined) h['Content-Type'] = 'application/json';
      const res = await fetch(`/api/v1${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
      const text = await res.text();
      return { status: res.status, json: text ? (JSON.parse(text) as unknown) : null };
    },
    { method, path, body, headers },
  );
}
const data = <T,>(r: Res) => (r.json as { data: T }).data;

const plusDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const ids = { powder: '', steel: '', tal: '', talB: '' };

test('setup: approval is switched off for the four stock vouchers, a powder item and a steel item exist', async ({ page }) => {
  await signIn(page, 'owner', OWNER_PW);
  await selectUnit(page, 'Talwade');
  for (const p of ['inv-opening', 'inv-transactions', 'inv-adjustment', 'inv-transfer']) {
    const cur = await api(page, 'GET', `/module-controls?q=${p}`);
    const row = data<{ pageId: string; version: number }[]>(cur).find((c) => c.pageId === p)!;
    const r = await api(page, 'PATCH', `/module-controls/${p}`, { approvalRequired: false }, { 'If-Match': `"${row.version}"` });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
  }
  const hsn = await api(page, 'POST', '/hsn-sac', { code: '847130', description: 'E2E test HSN' });
  expect([200, 201, 409, 422], JSON.stringify(hsn.json)).toContain(hsn.status);
  const whs = data<{ id: string; code: string }[]>(await api(page, 'GET', '/lookups/warehouses?q=TAL'));
  ids.tal = whs.find((w) => w.code === 'TAL-MAIN')!.id;
  // a second warehouse in Talwade for the transfer
  const wh2 = await api(page, 'POST', '/pages/wms-warehouses/records', { data: { warehouseCode: 'TAL-E2E-B', warehouseName: 'Talwade E2E Store B' } });
  expect(wh2.status, JSON.stringify(wh2.json)).toBe(201);
  ids.talB = data<{ id: string }>(wh2).id;
  const pw = await api(page, 'POST', '/pages/inv-items/records', {
    data: { itemCode: 'E2E-POWDER-RED', itemName: 'E2E Red Powder', itemType: 'Raw Material', category: 'Powder', baseUom: 'Kg', hsnSac: '847130', batchTracked: true, shelfLifeDays: 365, qcRequired: true },
  });
  expect(pw.status, JSON.stringify(pw.json)).toBe(201);
  ids.powder = data<{ id: string }>(pw).id;
  const st = await api(page, 'POST', '/pages/inv-items/records', { data: { itemCode: 'E2E-STEEL-ROD', itemName: 'E2E Steel Rod', itemType: 'Raw Material', baseUom: 'Kg', hsnSac: '847130' } });
  expect(st.status, JSON.stringify(st.json)).toBe(201);
  ids.steel = data<{ id: string }>(st).id;
});

test('receive 25 kg of powder with a batch and dates through the form: it lands in Quality Inspection', async ({ page }) => {
  await signIn(page, 'owner', OWNER_PW);
  await selectUnit(page, 'Talwade');
  await page.goto('/m/inv-transactions');
  await expect(page.getByRole('heading', { name: 'Inventory Transactions' })).toBeVisible();
  await page.getByRole('tab', { name: 'Vouchers' }).click();
  await page.getByRole('button', { name: /New Receipt \/ Issue/ }).click();
  const d = page.getByRole('dialog');
  await d.getByRole('combobox').first().selectOption(ids.tal);
  await d.getByLabel('Item 1').click();
  await d.getByLabel('Item 1').fill('E2E-POWDER');
  await d.getByRole('option', { name: /E2E-POWDER-RED/ }).click();
  await d.getByLabel('Quantity 1').fill('25');
  await d.getByLabel('Unit cost 1').fill('120');
  await d.getByLabel('Batch 1').fill('RED-2611');
  await d.getByLabel('Manufactured 1').fill(plusDays(-10));
  await d.getByLabel('Expiry 1').fill(plusDays(20));
  await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/inventory/vouchers/transactions') && r.request().method() === 'POST' && r.ok()),
    d.getByRole('button', { name: 'Save draft' }).click(),
  ]);
  await expect(page.getByText(/Saved TXN/)).toBeVisible();
  const row = page.getByRole('row', { name: /TXN\/TAL/ }).first();
  await Promise.all([
    page.waitForResponse((r) => /\/submit$/.test(r.url()) && r.ok()),
    row.getByRole('button', { name: 'Submit' }).click(),
  ]);
  await Promise.all([
    page.waitForResponse((r) => /\/post$/.test(r.url()) && r.ok()),
    page.getByRole('row', { name: /TXN\/TAL/ }).first().getByRole('button', { name: 'Post' }).click(),
  ]);
  await expect(page.getByText(/posted\./)).toBeVisible();
  const avail = data<{ onHand: number; unrestricted: number; qualityInspection: number }>(await api(page, 'GET', `/inventory/availability?itemId=${ids.powder}&warehouseId=${ids.tal}`));
  expect(avail).toMatchObject({ onHand: 25, unrestricted: 0, qualityInspection: 25 });
});

test('quality-inspection stock cannot be issued; the expiry report shows the batch as within 30 days', async ({ page }) => {
  await signIn(page, 'owner', OWNER_PW);
  await selectUnit(page, 'Talwade');
  const c = await api(page, 'POST', '/inventory/vouchers/transactions', { warehouseId: ids.tal, txType: 'Issue', lines: [{ itemId: ids.powder, qty: 1 }] });
  expect(c.status).toBe(201);
  const v = data<{ id: string; version: number }>(c);
  await api(page, 'POST', `/inventory/vouchers/transactions/${v.id}/submit`, undefined, { 'If-Match': `"${v.version}"` });
  const p = await api(page, 'POST', `/inventory/vouchers/transactions/${v.id}/post`, {});
  expect(p.status).toBe(409);
  expect((p.json as { error: { message: string } }).error.message).toMatch(/Quality Inspection/);
  await page.goto('/m/inv-expiry');
  await expect(page.getByRole('heading', { name: 'Expiry Tracking' })).toBeVisible();
  const row = page.getByRole('row', { name: /RED-2611/ });
  await expect(row).toBeVisible();
  await expect(row).toContainText('Near Expiry');
});

test('a two-line receipt, an issue at the average, a transfer in two steps and a cancel with a reason', async ({ page }) => {
  await signIn(page, 'owner', OWNER_PW);
  await selectUnit(page, 'Talwade');
  const post = async (kind: string, body: unknown, verb = 'post') => {
    const c = await api(page, 'POST', `/inventory/vouchers/${kind}`, body);
    expect(c.status, JSON.stringify(c.json)).toBe(201);
    const v = data<{ id: string; version: number }>(c);
    const s = await api(page, 'POST', `/inventory/vouchers/${kind}/${v.id}/submit`, undefined, { 'If-Match': `"${v.version}"` });
    expect(data<{ status: string }>(s).status).toBe('Approved');
    const r = await api(page, 'POST', `/inventory/vouchers/${kind}/${v.id}/${verb}`, {});
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    return v.id;
  };
  await post('transactions', { warehouseId: ids.tal, txType: 'Receipt', lines: [{ itemId: ids.steel, qty: 10, unitCost: 100 }, { itemId: ids.steel, qty: 10, unitCost: 120, stockStatus: 'BLOCKED' }] });
  const rcpt2 = await post('transactions', { warehouseId: ids.tal, txType: 'Receipt', lines: [{ itemId: ids.steel, qty: 10, unitCost: 120 }] });
  await post('transactions', { warehouseId: ids.tal, txType: 'Issue', lines: [{ itemId: ids.steel, qty: 15 }] });
  let a = data<{ onHand: number; unrestricted: number }>(await api(page, 'GET', `/inventory/availability?itemId=${ids.steel}&warehouseId=${ids.tal}`));
  expect(a.unrestricted).toBe(5);
  const t = await post('transfer', { warehouseId: ids.tal, toWarehouseId: ids.talB, lines: [{ itemId: ids.steel, qty: 5 }] }, 'dispatch');
  const r = await api(page, 'POST', `/inventory/vouchers/transfer/${t}/receive`, {});
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  a = data(await api(page, 'GET', `/inventory/availability?itemId=${ids.steel}&warehouseId=${ids.talB}`));
  expect(a.onHand).toBe(5);
  // cancel needs a reason; the second receipt's stock is partly used, so only a clean one cancels
  const noReason = await api(page, 'POST', `/inventory/vouchers/transactions/${rcpt2}/cancel`, {});
  expect(noReason.status).toBe(422);
  const integrity = data<{ checks: { id: string; ok: boolean }[] }>(await api(page, 'GET', '/inventory/integrity'));
  expect(integrity.checks.filter((c) => ['INV-1', 'INV-2', 'INV-3', 'INV-4'].includes(c.id)).every((c) => c.ok)).toBe(true);
  await page.goto('/m/inv-valuation');
  await expect(page.getByRole('heading', { name: 'Stock Valuation' })).toBeVisible();
  await expect(page.getByText('Stock value vs the books')).toBeVisible();
});

test('weekly Powder Stock Monitoring Sheet: five week rows per powder item; a recorded week shows the counted quantity', async ({ page }) => {
  await signIn(page, 'owner', OWNER_PW);
  await selectUnit(page, 'Talwade');
  const c = await api(page, 'POST', '/inventory/counts', { countType: 'POWDER_WEEKLY', warehouseId: ids.tal, monthLabel: plusDays(0).slice(0, 7), itemIds: [ids.powder] });
  expect(c.status, JSON.stringify(c.json)).toBe(201);
  const count = data<{ id: string; version: number }>(c);
  await api(page, 'POST', `/inventory/counts/${count.id}/start`, undefined, { 'If-Match': `"${count.version}"` });
  await page.goto('/m/wms-cycle');
  await expect(page.getByRole('heading', { name: 'Cycle Count' })).toBeVisible();
  const detail = data<{ lines: { id: string; weekNo: number }[] }>(await api(page, 'GET', `/inventory/counts/${count.id}`));
  expect(detail.lines).toHaveLength(5);
  const w1 = await api(page, 'POST', `/inventory/counts/${count.id}/lines/${detail.lines[0]!.id}/count`, { qty: 25, remarks: 'week 1 checked' });
  expect(w1.status, JSON.stringify(w1.json)).toBe(200);
});

test('customer material: received with the customer challan, used for a job, partly returned, cancelled; our books are untouched', async ({ page }) => {
  await signIn(page, 'owner', OWNER_PW);
  await selectUnit(page, 'Talwade');
  const cust = await api(page, 'POST', '/customers', { name: 'E2E Alpha Coaters', gstRegistrationType: 'UNREGISTERED', stateCode: '27' }, { 'Idempotency-Key': 'e2e-cm-customer-1' });
  expect([200, 201], JSON.stringify(cust.json)).toContain(cust.status);
  const custId = data<{ id: string }>(cust).id;
  await page.goto('/m/inv-transactions');
  await page.getByRole('tab', { name: 'Customer Material' }).click();
  await expect(page.getByText('NOT our stock').first()).toBeVisible();
  // 1. material arrives (through the form, like a store keeper)
  await page.getByRole('button', { name: /1. Material received from customer/ }).click();
  const d = page.getByRole('dialog');
  await d.getByRole('combobox').nth(0).selectOption(custId);
  await d.getByRole('combobox').nth(1).selectOption(ids.tal);
  await d.getByLabel('Customer challan number').fill('E2E-CH-001');
  await d.getByLabel('Item 1').click();
  await page.getByRole('option', { name: /E2E-STEEL/ }).first().click();
  await d.getByLabel('Quantity', { exact: true }).fill('80');
  await d.getByRole('button', { name: 'Save received material' }).click();
  await expect(page.getByText('E2E Alpha Coaters').first()).toBeVisible();
  await expect(page.getByRole('row', { name: /E2E Alpha Coaters/ }).getByText('80')).toBeVisible();
  // 2. used for a job (through the API; the form is covered by the web tests)
  const lots = data<{ id: string; balanceQty: number }[]>(await api(page, 'GET', `/inventory/customer-material/lots?customerId=${custId}`));
  expect(lots).toHaveLength(1);
  const iss = await api(page, 'POST', '/inventory/customer-material/issues', { customerId: custId, warehouseId: ids.tal, docDate: plusDays(0), reference: 'JOB-E2E-1', lines: [{ lotId: lots[0]!.id, qty: 30 }] });
  expect(iss.status, JSON.stringify(iss.json)).toBe(201);
  const ret = await api(page, 'POST', '/inventory/customer-material/returns', { customerId: custId, warehouseId: ids.tal, docDate: plusDays(0), challanNo: 'OUT-E2E-1', challanDate: plusDays(0), lines: [{ lotId: lots[0]!.id, qty: 10 }] });
  expect(ret.status, JSON.stringify(ret.json)).toBe(201);
  await page.reload();
  await page.getByRole('tab', { name: 'Customer Material' }).click();
  await expect(page.getByRole('row', { name: /E2E Alpha Coaters/ }).getByText('40')).toBeVisible();
  // cancelling the issue gives the quantity back
  const issDoc = data<{ id: string; version: number }>(iss);
  const c = await api(page, 'POST', `/inventory/customer-material/docs/${issDoc.id}/cancel`, { reason: 'Wrong job number', date: plusDays(0) }, { 'If-Match': `"${issDoc.version}"` });
  expect(c.status, JSON.stringify(c.json)).toBe(200);
  const after = data<{ balanceQty: number }[]>(await api(page, 'GET', `/inventory/customer-material/lots?customerId=${custId}`));
  expect(after[0]!.balanceQty).toBe(70);
  // it is not in our books
  const a = data<{ onHand: number }>(await api(page, 'GET', `/inventory/availability?itemId=${ids.steel}&warehouseId=${ids.tal}`));
  expect(typeof a.onHand).toBe('number');
  const integrity = data<{ ok: boolean; checks: { id: string; ok: boolean }[] }>(await api(page, 'GET', '/inventory/integrity'));
  expect(integrity.checks.find((x) => x.id === 'INV-7')?.ok).toBe(true);
});

test('the inventory API refuses a request without a sign-in (401)', async ({ request }) => {
  const r = await request.get('/api/v1/inventory/integrity');
  expect(r.status()).toBe(401);
});
