// Page-by-page V40 vs ERP comparison. ONE Chromium, two tabs (V40 + ERP).
// Usage: node tools/parity/compare-page.mjs <pageId>[,<pageId>...] [--role=super|admin|mgr-purchase|emp-stores|sales-talsaw] [--web=http://localhost:5180] [--width=1440]
// Output: docs/ui-audit/pages/<pageId>/{v40-<tab>.png, erp-<tab>.png, diff.md, data.json} and one row update in docs/build/PAGES.md.
// Needs the local servers (see tests/ui-audit/README.md) and the git-ignored tests/feed/ui/state.json for the login. Never prints passwords.
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const opt = (k, d) => (args.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).split('=').slice(1).join('=');
const ids = (args.find((a) => !a.startsWith('--')) ?? '').split(',').filter(Boolean);
if (!ids.length) {
  console.error('usage: compare-page.mjs <pageId>[,<pageId>] [--role=super] [--width=1440]');
  process.exit(1);
}
const role = opt('role', 'super');
const web = opt('web', 'http://localhost:5180');
const width = Number(opt('width', 1440));
const ENV = JSON.parse(readFileSync(path.join(root, 'tests/feed/ui/state.json'), 'utf8'));
const LOGINS = { super: ENV.ownerId, admin: 'feed.admin', 'mgr-purchase': 'mgr.purchase.tal', 'emp-stores': 'emp.stores.tal', 'sales-talsaw': 'emp.sales.talsaw' };
const registry = JSON.parse(readFileSync(path.join(root, 'packages/registry/registry.v2.json'), 'utf8'));
const safe = (s) => s.replace(/[^a-z0-9]+/gi, '_').slice(0, 60);
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Everything we list, per tab. Runs inside the page.
const SNAP = (sel) => {
  const main = document.querySelector(sel) ?? document.body;
  const vis = (e) => {
    const r = e.getBoundingClientRect();
    const st = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
  };
  const txt = (e) => (e.textContent ?? '').replace(/\s+/g, ' ').trim();
  const uniq = (a) => [...new Set(a.filter(Boolean))];
  return {
    tabs: uniq([...main.querySelectorAll('[role=tab], .tabs button, .tab, .subtabs button, .v9-subtabs button')].filter(vis).map(txt)),
    columns: uniq([...main.querySelectorAll('th')].filter(vis).map(txt)),
    fields: uniq([...main.querySelectorAll('label')].filter(vis).map((l) => [...l.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' ').replace(/\s+/g, ' ').replace(/\*/g, '').trim() || txt(l).replace(/\*/g, '').trim())),
    buttons: uniq([...main.querySelectorAll('button, a.btn, [role=button]')].filter(vis).map(txt)),
    cards: uniq([...main.querySelectorAll('.kpi, .kpi-card, .stat, .metric, .card h3, .card-title, [class*=kpi]')].filter(vis).map((e) => txt(e).slice(0, 60))),
    filters: uniq([...main.querySelectorAll('select, input[type=search], input[placeholder]')].filter(vis).map((e) => (e.getAttribute('placeholder') || e.getAttribute('aria-label') || e.name || e.tagName).trim())),
    badges: uniq([...main.querySelectorAll('.badge, .pill, .chip, [class*=status]')].filter(vis).map((e) => txt(e).slice(0, 30))),
    rows: main.querySelectorAll('tbody tr').length,
    textLen: main.innerText.length,
    sideways: document.documentElement.scrollWidth > window.innerWidth + 2,
  };
};

async function loginErp(page) {
  const id = LOGINS[role] ?? LOGINS.super;
  const owner = id === ENV.ownerId;
  const pwd = owner ? ENV.ownerPassword : ENV.userPassword;
  await page.goto(`${web}/login`);
  await page.getByLabel('Email / User ID').fill(id);
  await page.getByLabel('Password', { exact: true }).fill(pwd);
  await page.getByRole('button', { name: 'Sign In to ERP' }).click();
  const all = page.getByRole('button', { name: 'All my plants' });
  if (await all.waitFor({ state: 'visible', timeout: 4000 }).then(() => true, () => false)) {
    await all.click();
    const remember = page.getByLabel(/Remember my choice/);
    if (await remember.count()) await remember.check();
    await page.getByRole('button', { name: 'Continue' }).click();
  }
  const ack = page.getByRole('button', { name: /I (have read|acknowledge|agree)|Acknowledge|Accept/i });
  if (await ack.first().isVisible({ timeout: 1500 }).catch(() => false)) await ack.first().click().catch(() => {});
  await page.locator('.main').first().waitFor({ state: 'visible', timeout: 15000 });
}

function diff(v, e) {
  const have = new Set(e.map(norm));
  const want = new Set(v.map(norm));
  return { missing: v.filter((x) => !have.has(norm(x))), extra: e.filter((x) => !want.has(norm(x))) };
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width, height: 900 } });
const erp = await ctx.newPage();
const v40 = await ctx.newPage();
await loginErp(erp);
await v40.goto(pathToFileURL(path.join(root, 'RHAI_ERP_V40_Edit_Update_Fixed.html')).href);
await v40.getByRole('button', { name: /Open Demo ERP/ }).click();
await v40.waitForTimeout(1500);

const summary = [];
for (const id of ids) {
  const meta = registry.pages.find((p) => p.id === id) ?? { id, title: id, family: '?', tabs: [] };
  const dir = path.join(root, 'docs/ui-audit/pages', id);
  mkdirSync(dir, { recursive: true });
  const data = { id, role, at: new Date().toISOString(), tabs: {} };

  // V40 side: open the page, click each tab in turn.
  await v40.evaluate((p) => window.nav(p), id);
  await v40.waitForTimeout(400);
  const v40TabNames = await v40.evaluate(SNAP, '.main, #main, main').then((s) => s.tabs);
  const v40List = v40TabNames.length ? v40TabNames : ['main'];
  for (let i = 0; i < v40List.length; i++) {
    const name = v40List[i];
    if (name !== 'main') await v40.locator('#moduleTabs [data-tab-index], .tabs button').nth(i).click({ timeout: 3000 }).catch(() => {});
    await v40.waitForTimeout(250);
    const snap = await v40.evaluate(SNAP, '.main, #main, main');
    await v40.screenshot({ path: path.join(dir, `v40-${safe(name)}.png`) });
    data.tabs[name] = { v40: snap };
  }

  // ERP side: same route as the app uses, click the same tab names.
  await erp.goto(`${web}/m/${id}`, { waitUntil: 'domcontentloaded' });
  await erp.locator('.main').first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
  await erp.waitForTimeout(1500);
  const erpTabs = await erp.evaluate(SNAP, '.main').then((s) => s.tabs);
  for (const name of v40List) {
    if (name !== 'main') {
      const idx = erpTabs.findIndex((t) => norm(t) === norm(name));
      if (idx >= 0) {
        await erp.locator('.main').first().locator('[role=tab], .tabs button, .tab, .subtabs button').filter({ hasText: name }).first().click({ timeout: 3000 }).catch(() => {});
      }
      await erp.waitForTimeout(500);
    }
    const snap = await erp.evaluate(SNAP, '.main');
    await erp.screenshot({ path: path.join(dir, `erp-${safe(name)}.png`) });
    data.tabs[name] = { ...data.tabs[name], erp: snap };
  }
  // V40 pages whose views are plain buttons (no .tabs strip): also screenshot every ERP tab so the data can be checked.
  if (v40List.length === 1 && v40List[0] === 'main') {
    for (const name of erpTabs) {
      await erp.locator('.main').first().locator('[role=tab], .tabs button, .tab, .subtabs button').filter({ hasText: name }).first().click({ timeout: 3000 }).catch(() => {});
      await erp.waitForTimeout(600);
      await erp.screenshot({ path: path.join(dir, `erp-${safe(name)}.png`) });
      data.tabs[`erp-only: ${name}`] = { erp: await erp.evaluate(SNAP, '.main') };
    }
  }
  const notFound = /Page not found|does not exist or is not available/.test(await erp.locator('.main').first().innerText().catch(() => ''));

  // diff.md
  const L = [`# ${meta.title} (${id}) - V40 vs ERP`, '', `Family: ${meta.family} - role: ${role} - ${data.at}`, ''];
  let missingTotal = 0;
  const tot = { tabs: 0, columns: 0, fields: 0, buttons: 0 };
  if (notFound) {
    L.push('**ERP route not found.**', '');
    missingTotal++;
  }
  const tabDiff = diff(v40TabNames, erpTabs);
  tot.tabs = tabDiff.missing.length;
  missingTotal += tot.tabs;
  L.push('## Tabs', `V40: ${v40TabNames.join(' | ') || '(none)'}`, `ERP: ${erpTabs.join(' | ') || '(none)'}`, `Missing in ERP: ${tabDiff.missing.join(', ') || '-'}`, `Extra in ERP: ${tabDiff.extra.join(', ') || '-'}`, '');
  for (const [name, t] of Object.entries(data.tabs)) {
    if (!t.erp || !t.v40) continue;
    L.push(`## Tab: ${name}`);
    for (const k of ['columns', 'fields', 'buttons', 'cards', 'filters', 'badges']) {
      const d = diff(t.v40[k], t.erp[k]);
      if (k in tot) tot[k] += d.missing.length;
      missingTotal += d.missing.length;
      L.push(`- ${k}: V40 ${t.v40[k].length}, ERP ${t.erp[k].length}; **missing:** ${d.missing.join(', ') || '-'}; extra: ${d.extra.slice(0, 12).join(', ') || '-'}`);
    }
    L.push(`- rows: V40 ${t.v40.rows}, ERP ${t.erp.rows}${t.erp.rows === 0 ? ' **(empty data)**' : ''}; sideways scroll ERP: ${t.erp.sideways}`, '');
  }
  writeFileSync(path.join(dir, 'diff.md'), L.join('\n') + '\n');
  writeFileSync(path.join(dir, 'data.json'), JSON.stringify(data, null, 1));

  // PAGES.md row
  const pf = path.join(root, 'docs/build/PAGES.md');
  if (existsSync(pf)) {
    const ok = (n) => (n === 0 ? 'ok' : `${n} missing`);
    const lines = readFileSync(pf, 'utf8').split('\n');
    const i = lines.findIndex((l) => l.startsWith(`| ${id} |`));
    if (i >= 0) {
      const c = lines[i].split('|').map((s) => s.trim()).slice(1, 11);
      c[3] = ok(tot.tabs);
      c[4] = ok(tot.columns);
      c[5] = ok(tot.fields);
      c[6] = ok(tot.buttons);
      const rows = Object.values(data.tabs).reduce((a, t) => a + (t.erp?.rows ?? 0), 0);
      c[7] = rows > 0 ? 'rows shown' : 'EMPTY';
      if (c[9] === 'TODO') c[9] = 'BUILDING';
      lines[i] = `| ${c.join(' | ')} |`;
      writeFileSync(pf, lines.join('\n'));
    }
  }
  summary.push(`${id}: missing ${missingTotal} (tabs ${tot.tabs}, columns ${tot.columns}, fields ${tot.fields}, buttons ${tot.buttons})${notFound ? ' ROUTE NOT FOUND' : ''}`);
}
await browser.close();
console.log(summary.join('\n'));
