// Why: end-to-end proof of the first business flow the owner asked for (docs/phase3-4/CONTRACT.md Stage C):
// create a product -> opening stock in Talwade -> issue -> transfer to Sawardari (dispatch + receive) -> adjustment
// -> stock balance and ledger are right; stock can never go negative, even with two simultaneous issues; a member
// without inventory access cannot see these pages. Runs after phase4.spec.ts on the same e2e database.
import { test, expect, type Page } from '@playwright/test';
import { E2E } from './e2e-env.mjs';

const OWNER_PW = E2E.owner.newPassword;
const M2 = { loginId: 'member2', next: 'Member2#Real26x' };

test.describe.configure({ mode: 'serial' });
// SUPERSEDED by Phase 8 (single-item vouchers that post straight from Draft are gone, R-08): the same stories on the new
// header + lines vouchers with approval are in phase8.spec.ts. Kept, not deleted.
test.skip(true, 'Superseded by phase8.spec.ts');

async function signIn(page: Page, id: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email / User ID').fill(id);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/api/v1/auth/login')),
    page.getByRole('button', { name: 'Sign In to ERP' }).click(),
  ]);
}

type Res = { status: number; json: unknown };

/** One API call from inside the signed-in page (fresh access token from the httpOnly refresh cookie). */
async function api(page: Page, method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Res> {
  await page.waitForLoadState('networkidle');
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

type Rec = { id: string; code: string; status: string; version: number; data: Record<string, unknown> };
const rec = (r: Res) => (r.json as { data: Rec }).data;
const err = (r: Res) => (r.json as { error: { code: string; message: string } }).error;

async function selectUnit(page: Page, label: string) {
  const unit = page.getByLabel('Unit', { exact: true });
  await expect(unit.locator('option', { hasText: label })).toHaveCount(1);
  if ((await unit.locator('option:checked').innerText()).trim() === label) return;
  await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/me/context') && r.request().method() === 'PUT' && r.ok()),
    unit.selectOption({ label }),
  ]);
}

const ids: { item: string; talWh: string; sawWh: string } = { item: '', talWh: '', sawWh: '' };

test('warehouses exist for each unit (Main Store per unit)', async ({ page }) => {
  await signIn(page, 'owner', OWNER_PW);
  await selectUnit(page, 'All Units');
  const res = await api(page, 'GET', '/lookups/warehouses?q=Main');
  expect(res.status).toBe(200);
  const rows = (res.json as { data: { id: string; code: string; name: string }[] }).data;
  const codes = rows.map((w) => w.code).sort();
  expect(codes).toEqual(expect.arrayContaining(['SAW-MAIN', 'TAL-MAIN', 'VAR-MAIN']));
  ids.talWh = rows.find((w) => w.code === 'TAL-MAIN')?.id ?? '';
  ids.sawWh = rows.find((w) => w.code === 'SAW-MAIN')?.id ?? '';
});

test('create a product (Item Master) through the form', async ({ page }) => {
  await signIn(page, 'owner', OWNER_PW);
  await selectUnit(page, 'Talwade');
  await page.goto('/m/inv-items');
  await expect(page.getByRole('heading', { name: 'Item / SKU Master' })).toBeVisible();
  await page.getByRole('tab', { name: 'Item Master' }).click();
  await page.getByRole('button', { name: /Add$/ }).first().click();
  const d = page.getByRole('dialog');
  await d.getByLabel('Item Code').fill('BLDC-MOTOR-01');
  await d.getByLabel('Item Name').fill('BLDC Motor Assembly');
  await d.getByLabel('Base UOM').selectOption({ label: 'Nos' });
  await Promise.all([
    page.waitForResponse((r) => /\/pages\/inv-items\/records$/.test(r.url()) && r.request().method() === 'POST' && r.ok()),
    d.getByRole('button', { name: /Save/ }).last().click(),
  ]);
  await expect(d).toBeHidden();
  await expect(page.getByText('BLDC-MOTOR-01').first()).toBeVisible();
  const list = await api(page, 'GET', '/pages/inv-items/records?q=BLDC');
  ids.item = ((list.json as { data: Rec[] }).data[0] as Rec).id;
});

test('a duplicate item code is refused', async ({ page }) => {
  await signIn(page, 'owner', OWNER_PW);
  const dup = await api(page, 'POST', '/pages/inv-items/records', { data: { itemCode: 'BLDC-MOTOR-01', itemName: 'Copy', baseUom: 'Nos' } });
  expect([409, 422]).toContain(dup.status);
});

test('opening stock: 100 @ ₹50 in Talwade; posting fills the stock balance', async ({ page }) => {
  await signIn(page, 'owner', OWNER_PW);
  await selectUnit(page, 'Talwade');
  const created = await api(page, 'POST', '/pages/inv-opening/records', {
    data: { warehouse: ids.talWh, item: ids.item, openingQty: 100, unitCost: 50 },
  });
  expect(created.status).toBe(201);
  const r = rec(created);
  expect(r.status).toBe('Draft');
  expect(Number(r.data.openingValue)).toBe(5000);
  const post = await api(page, 'POST', `/pages/inv-opening/records/${r.id}/actions/post`, {}, { 'Idempotency-Key': `e2e-open-${r.id}` });
  expect(post.status).toBe(200);
  expect(rec(post).status).toBe('Posted');
  // posted vouchers are locked
  const edit = await api(page, 'PATCH', `/pages/inv-opening/records/${r.id}`, { data: { openingQty: 1 } }, { 'If-Match': `"${rec(post).version}"` });
  expect([409, 422]).toContain(edit.status);
  // the same item cannot get a second opening entry in that warehouse
  const second = await api(page, 'POST', '/pages/inv-opening/records', { data: { warehouse: ids.talWh, item: ids.item, openingQty: 5, unitCost: 50 } });
  const secondPost = second.status === 201 ? await api(page, 'POST', `/pages/inv-opening/records/${rec(second).id}/actions/post`) : second;
  expect(secondPost.status).toBe(409);
});

test('stock balance shows 100 on hand, avg ₹50, value ₹5,000 (UI + totals)', async ({ page }) => {
  await signIn(page, 'owner', OWNER_PW);
  await selectUnit(page, 'Talwade');
  await page.goto('/m/inv-stock');
  await expect(page.getByText('BLDC-MOTOR-01').first()).toBeVisible();
  const list = await api(page, 'GET', '/pages/inv-stock/records?q=BLDC');
  const row = (list.json as { data: Rec[]; meta: { totals?: Record<string, number> } }).data[0] as Rec;
  expect(Number(row.data.onHand)).toBe(100);
  expect(Number(row.data.avgRate)).toBe(50);
  expect(Number(row.data.stockValue)).toBe(5000);
});

test('issue 30 reduces stock at the average rate; issuing more than available is refused', async ({ page }) => {
  await signIn(page, 'owner', OWNER_PW);
  await selectUnit(page, 'Talwade');
  const issue = await api(page, 'POST', '/pages/inv-transactions/records', {
    data: { transactionType: 'Issue', reference: 'E2E issue', item: ids.item, warehouse: ids.talWh, qty: 30 },
  });
  expect(issue.status).toBe(201);
  const posted = await api(page, 'POST', `/pages/inv-transactions/records/${rec(issue).id}/actions/post`);
  expect(posted.status).toBe(200);
  const tooMuch = await api(page, 'POST', '/pages/inv-transactions/records', {
    data: { transactionType: 'Issue', reference: 'E2E too much', item: ids.item, warehouse: ids.talWh, qty: 500 },
  });
  const tooMuchPost = await api(page, 'POST', `/pages/inv-transactions/records/${rec(tooMuch).id}/actions/post`);
  expect(tooMuchPost.status).toBe(409);
  expect(err(tooMuchPost).code).toBe('INSUFFICIENT_STOCK');
  const stock = (await api(page, 'GET', '/pages/inv-stock/records?q=BLDC')).json as { data: Rec[] };
  expect(Number(stock.data[0]?.data.onHand)).toBe(70);
  expect(Number(stock.data[0]?.data.stockValue)).toBe(3500);
});

test('two simultaneous issues of the last units: exactly one succeeds (no negative stock)', async ({ page }) => {
  await signIn(page, 'owner', OWNER_PW);
  await selectUnit(page, 'Talwade');
  const mk = async (n: number) =>
    rec(await api(page, 'POST', '/pages/inv-transactions/records', {
      data: { transactionType: 'Issue', reference: `race ${n}`, item: ids.item, warehouse: ids.talWh, qty: 50 },
    }));
  const [a, b] = [await mk(1), await mk(2)];
  await page.waitForLoadState('networkidle');
  const results = await page.evaluate(
    async ({ a, b }) => {
      const r = await fetch('/api/v1/auth/refresh', { method: 'POST', headers: { 'X-Requested-With': 'rhai-web' } });
      const { data } = (await r.json()) as { data: { accessToken: string } };
      const go = async (id: string) => {
        const res = await fetch(`/api/v1/pages/inv-transactions/records/${id}/actions/post`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${data.accessToken}`, 'Content-Type': 'application/json' },
          body: '{}',
        });
        return res.status;
      };
      return Promise.all([go(a), go(b)]);
    },
    { a: a.id, b: b.id },
  );
  expect(results.sort()).toEqual([200, 409]);
  const stock = (await api(page, 'GET', '/pages/inv-stock/records?q=BLDC')).json as { data: Rec[] };
  expect(Number(stock.data[0]?.data.onHand)).toBe(20);
});

test('transfer 20 from Talwade to Sawardari: dispatch then receive; both unit balances are right', async ({ page }) => {
  await signIn(page, 'owner', OWNER_PW);
  await selectUnit(page, 'Talwade');
  const t = await api(page, 'POST', '/pages/inv-transfer/records', {
    data: { sourceWarehouse: ids.talWh, destinationWarehouse: ids.sawWh, item: ids.item, requestedQty: 20 },
  });
  expect(t.status).toBe(201);
  const id = rec(t).id;
  // cannot receive before dispatch
  const early = await api(page, 'POST', `/pages/inv-transfer/records/${id}/actions/receive`);
  expect([409, 422]).toContain(early.status);
  const dispatched = await api(page, 'POST', `/pages/inv-transfer/records/${id}/actions/dispatch`);
  expect(dispatched.status).toBe(200);
  expect(rec(dispatched).status).toBe('Dispatched');
  let tal = (await api(page, 'GET', '/pages/inv-stock/records?q=BLDC')).json as { data: Rec[] };
  expect(Number(tal.data[0]?.data.onHand)).toBe(0); // 20 left at dispatch time -> 0 after 20 dispatched

  await selectUnit(page, 'Sawardari');
  const received = await api(page, 'POST', `/pages/inv-transfer/records/${id}/actions/receive`);
  expect(received.status).toBe(200);
  expect(rec(received).status).toBe('Received');
  const saw = (await api(page, 'GET', '/pages/inv-stock/records?q=BLDC')).json as { data: Rec[] };
  expect(Number(saw.data[0]?.data.onHand)).toBe(20);
  expect(Number(saw.data[0]?.data.avgRate)).toBe(50);
  expect(Number(saw.data[0]?.data.stockValue)).toBe(1000);
  await selectUnit(page, 'Talwade');
  tal = (await api(page, 'GET', '/pages/inv-stock/records?q=BLDC')).json as { data: Rec[] };
  expect(Number(tal.data[0]?.data.onHand ?? 0)).toBe(0);
});

test('adjustment after a count: counted 25 vs system 20 in Sawardari posts +5', async ({ page }) => {
  await signIn(page, 'owner', OWNER_PW);
  await selectUnit(page, 'Sawardari');
  const adj = await api(page, 'POST', '/pages/inv-adjustment/records', {
    data: { warehouse: ids.sawWh, item: ids.item, countedQty: 25, reasonCode: 'Count Correction' },
  });
  expect(adj.status).toBe(201);
  expect(Number(rec(adj).data.varianceQty)).toBe(5);
  const posted = await api(page, 'POST', `/pages/inv-adjustment/records/${rec(adj).id}/actions/post`);
  expect(posted.status).toBe(200);
  const stock = (await api(page, 'GET', '/pages/inv-stock/records?q=BLDC')).json as { data: Rec[] };
  expect(Number(stock.data[0]?.data.onHand)).toBe(25);
});

test('the ledger adds up: movements sum to the balance, and cancelling a posted receipt reverses it', async ({ page }) => {
  await signIn(page, 'owner', OWNER_PW);
  await selectUnit(page, 'All Units');
  const ledger = (await api(page, 'GET', '/pages/inv-transactions/records?size=100&q=BLDC')).json as { data: Rec[] };
  const lines = ledger.data.filter((r) => String(r.data.item ?? '').length > 0 || r.data.qtyIn !== undefined);
  expect(lines.length).toBeGreaterThan(3);
  const stock = (await api(page, 'GET', '/pages/inv-stock/records?size=100&q=BLDC')).json as { data: Rec[] };
  const total = stock.data.reduce((s, r) => s + Number(r.data.onHand ?? 0), 0);
  expect(total).toBe(25); // Talwade 0 + Sawardari 25
});

test('a member without inventory access cannot see the inventory pages or call them', async ({ page }) => {
  await signIn(page, M2.loginId, M2.next);
  const stock = await api(page, 'GET', '/pages/inv-stock/records');
  expect([403, 404]).toContain(stock.status);
  const create = await api(page, 'POST', '/pages/inv-transactions/records', { data: { transactionType: 'Issue', qty: 1 } });
  expect([403, 404]).toContain(create.status);
});
