// Why: end-to-end proof of Phase 6B (docs/phases/PHASE-06B.md §11) as a person would click it: open the
// Settings panel of a module page, create and publish a format with a reason, see the new version in
// Formats & Rules (admin-formats), then change a rate in a rule set and see the result computed by the
// server. Runs after phase5.spec.ts on the same e2e database.
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

type Res = { status: number; json: unknown };

async function api(page: Page, method: string, path: string, body?: unknown): Promise<Res> {
  await page.waitForLoadState('networkidle');
  return page.evaluate(
    async ({ method, path, body }) => {
      let data: { accessToken: string } | undefined;
      for (let attempt = 0; attempt < 5 && !data; attempt++) {
        const r = await fetch('/api/v1/auth/refresh', { method: 'POST', headers: { 'X-Requested-With': 'rhai-web' } });
        if (r.ok) data = ((await r.json()) as { data: { accessToken: string } }).data;
        else await new Promise((res) => setTimeout(res, 400));
      }
      if (!data) throw new Error('could not refresh the session for the test helper');
      const h: Record<string, string> = { Authorization: `Bearer ${data.accessToken}` };
      if (body !== undefined) h['Content-Type'] = 'application/json';
      const res = await fetch(`/api/v1${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
      const text = await res.text();
      return { status: res.status, json: text ? (JSON.parse(text) as unknown) : null };
    },
    { method, path, body },
  );
}

test('the Settings panel creates and publishes a format with a reason', async ({ page }) => {
  await signIn(page, 'owner', OWNER_PW);
  await page.goto('/m/crm-leads');
  await page.getByRole('button', { name: /Settings/ }).click();
  const panel = page.getByRole('dialog', { name: /Settings — / });
  await expect(panel.getByText(/Owned by/)).toBeVisible();
  await panel.getByRole('button', { name: '+ New format' }).click();

  const editor = page.getByRole('dialog', { name: 'New format' });
  await editor.getByLabel('Name *').fill('Lead intake form');
  await editor.getByRole('button', { name: '+ Add field' }).click();
  await editor.getByLabel('Label', { exact: true }).first().fill('Site visit date');
  await expect(editor.getByLabel('Preview Site visit date')).toBeVisible();
  await editor.getByRole('button', { name: 'Publish new version' }).click();
  await editor.getByRole('button', { name: 'Confirm publish' }).click();
  await expect(editor.getByText('Give a short reason (at least 3 characters).')).toBeVisible();
  await editor.getByLabel('Reason for this change *').fill('Sales wants the visit date on the form');
  await editor.getByRole('button', { name: 'Confirm publish' }).click();
  await expect(page.getByText(/Published v1/)).toBeVisible();
  await expect(panel.getByText('Lead intake form')).toBeVisible();

  const live = await api(page, 'GET', '/pages/crm-leads/settings/formats/resolve?kind=FORM');
  expect(live.status).toBe(200);
  const data = (live.json as { data: { name: string; versionNo: number; schema: { header: { label: string }[] } } }).data;
  expect(data).toMatchObject({ name: 'Lead intake form', versionNo: 1 });
  expect(data.schema.header[0]?.label).toBe('Site visit date');
});

test('Formats & Rules lists the new version and who changed it', async ({ page }) => {
  await signIn(page, 'owner', OWNER_PW);
  await page.goto('/m/admin-formats');
  await expect(page.getByRole('heading', { name: 'Formats & Rules' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Lead intake form' })).toBeVisible();
  await page.getByRole('tab', { name: 'Who changed what' }).click();
  await expect(page.getByText('Sales wants the visit date on the form')).toBeVisible();
});

test('a changed rate gives the new result with no code change', async ({ page }) => {
  await signIn(page, 'owner', OWNER_PW);
  await page.goto('/m/crm-leads');
  const rule = (rate: string) => ({
    code: 'siteVisit',
    name: 'Site visit cost',
    moneyAffecting: false,
    definition: {
      inputs: [{ name: 'hours' }],
      parameters: [{ name: 'rate', value: rate }],
      outputs: [{ name: 'cost', expression: 'hours * rate', places: 2 }],
    },
  });
  for (const [rate, hours, expected, ifMatch] of [['500', 2, '1000.00', '0'], ['650', 2, '1300.00', '0']] as const) {
    const saved = await page.evaluate(
      async ({ body, ifMatch }) => {
        const r = await fetch('/api/v1/auth/refresh', { method: 'POST', headers: { 'X-Requested-With': 'rhai-web' } });
        const token = ((await r.json()) as { data: { accessToken: string } }).data.accessToken;
        const h = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'If-Match': ifMatch };
        const put = await fetch('/api/v1/pages/crm-leads/settings/rules', { method: 'PUT', headers: h, body: JSON.stringify(body) });
        const draft = ((await put.json()) as { data: { id: string; version: number } }).data;
        const pub = await fetch(`/api/v1/pages/crm-leads/settings/rules/${draft.id}/publish`, {
          method: 'POST',
          headers: { ...h, 'If-Match': String(draft.version) },
          body: JSON.stringify({ reason: 'Rate review' }),
        });
        return pub.status;
      },
      { body: rule(rate), ifMatch },
    );
    expect(saved).toBe(200);
    const ev = await api(page, 'POST', '/pages/crm-leads/settings/rules/evaluate', { code: 'siteVisit', inputs: { hours } });
    expect((ev.json as { data: { outputs: { cost: string } } }).data.outputs.cost).toBe(expected);
  }
});
