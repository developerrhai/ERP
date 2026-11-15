// Phase 36 Part B: audit one batch of registry pages - V40 vs ERP - and append one JSON line per page.
// Env: AUDIT_ROLE (super|admin|mgr-purchase|emp-stores|sales-talsaw, default super), AUDIT_FROM (index), AUDIT_COUNT (default 20),
//      AUDIT_FAMILY, AUDIT_PAGE (comma list of ids), AUDIT_WIDTHS (default 1440,1024,390), AUDIT_FORCE=1 to redo.
// Resumable: ids already in data/<role>/pages.jsonl are skipped. One browser, fresh context per batch.
import { test, type Page, type BrowserContext } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { enterAs, ROLE_LOGINS } from './login';

const root = path.resolve(__dirname, '../..');
const registry = JSON.parse(readFileSync(path.join(root, 'packages/registry/registry.v2.json'), 'utf8')) as {
  pages: { id: string; title: string; family: string; tabs: string[]; buttons: string[] }[];
};
const role = process.env.AUDIT_ROLE ?? 'super';
const widths = (process.env.AUDIT_WIDTHS ?? '1440,1024,390').split(',').map(Number);
const tag = process.env.AUDIT_TAG ?? ''; // e.g. -after: separate data + screenshot names for the before/after comparison
const dataDir = path.join(root, 'docs/ui-audit/data', role + tag);
const outFile = path.join(dataDir, 'pages.jsonl');
mkdirSync(dataDir, { recursive: true });

const done = new Set<string>(
  existsSync(outFile) && !process.env.AUDIT_FORCE ? readFileSync(outFile, 'utf8').split('\n').filter(Boolean).map((l) => (JSON.parse(l) as { id: string }).id) : [],
);
let todo = registry.pages;
if (process.env.AUDIT_FAMILY) todo = todo.filter((p) => p.family === process.env.AUDIT_FAMILY);
if (process.env.AUDIT_PAGE) { const ids = process.env.AUDIT_PAGE.split(','); todo = todo.filter((p) => ids.includes(p.id)); }
todo = todo.filter((p) => !done.has(p.id)).slice(Number(process.env.AUDIT_FROM ?? 0), Number(process.env.AUDIT_FROM ?? 0) + Number(process.env.AUDIT_COUNT ?? 20));

const safe = (s: string) => s.replace(/[^a-z0-9]+/gi, '_');
const BAD_TEXT = /\b(undefined|NaN|null|\[object Object\]|Invalid Date|Arrives in Phase)\b/;

interface BtnInfo { text: string; area: string; disabled: boolean }

async function collect(page: Page, scope: string): Promise<{ buttons: BtnInfo[]; tabs: string[]; text: string; tableRows: number; searchBoxes: number; h1: string; inlineStyles: number }> {
  return page.evaluate((sel) => {
    const main = document.querySelector(sel) ?? document.body;
    const vis = (e: Element) => { const r = (e as HTMLElement).getBoundingClientRect(); const st = getComputedStyle(e as HTMLElement); return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none'; };
    const buttons = [...main.querySelectorAll('button, a.btn, [role=button]')].filter(vis).map((b) => ({
      text: (b.textContent ?? '').replace(/\s+/g, ' ').trim(),
      area: ((b.parentElement?.className ?? '') + '').split(/\s+/).slice(0, 2).join('.'),
      disabled: (b as HTMLButtonElement).disabled === true,
    })).filter((b) => b.text);
    const tabs = [...main.querySelectorAll('[role=tab], .tabs button, .tab, .subtabs button, .v8-tabs button')].filter(vis).map((t) => (t.textContent ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean);
    return {
      buttons, tabs,
      text: (main as HTMLElement).innerText.slice(0, 6000),
      tableRows: main.querySelectorAll('tbody tr').length,
      searchBoxes: main.querySelectorAll('input[type=search], input[placeholder*=Search], input[placeholder*=search]').length,
      h1: (main.querySelector('h1, h2')?.textContent ?? '').trim().slice(0, 120),
      inlineStyles: main.querySelectorAll('[style]').length,
    };
  }, scope);
}

test('audit batch', async ({ browser }) => {
  test.setTimeout(3_000_000);
  if (todo.length === 0) { console.log('nothing to do'); return; }
  const ctx: BrowserContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const erp = await ctx.newPage();
  const v40 = await ctx.newPage();
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const api: { method: string; url: string; status: number; ms: number; bytes: number }[] = [];
  const started = new Map<string, number>();
  erp.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
  erp.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 200)));
  erp.on('request', (r) => { if (r.url().includes('/api/v1/')) started.set(r.url() + r.method(), Date.now()); });
  erp.on('response', (r) => {
    if (!r.url().includes('/api/v1/') || r.url().includes('/realtime/')) return;
    const t0 = started.get(r.url() + r.request().method()) ?? Date.now();
    api.push({ method: r.request().method(), url: r.url().replace(/^https?:\/\/[^/]+/, '').replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ':id'), status: r.status(), ms: Date.now() - t0, bytes: Number(r.headers()['content-length'] ?? 0) });
  });

  await enterAs(erp, ROLE_LOGINS[role] ?? ROLE_LOGINS.super!);
  await v40.goto(pathToFileURL(path.join(root, 'RHAI_ERP_V40_Edit_Update_Fixed.html')).href);
  await v40.getByRole('button', { name: /Open Demo ERP/ }).click();
  await v40.waitForTimeout(1500);

  for (const p of todo) {
    const dir = path.join(root, 'docs/ui-audit/shots', safe(p.family));
    mkdirSync(dir, { recursive: true });
    const shot = (kind: string, w: number) => path.join(dir, `${p.id}__main__${kind}${tag}__${w}.png`);
    const rec: Record<string, unknown> = { id: p.id, title: p.title, family: p.family, role, at: new Date().toISOString(), v40Tabs: p.tabs, registryButtons: p.buttons };

    // ---- V40
    try {
      await v40.evaluate((id) => (window as unknown as { nav: (i: string) => void }).nav(id), p.id);
      await v40.waitForTimeout(500);
      const v = await collect(v40, '.main, #main, main');
      rec.v40 = { buttons: v.buttons, tabs: v.tabs, tableRows: v.tableRows, h1: v.h1 };
      await v40.screenshot({ path: shot('v40', 1440) });
    } catch (e) { rec.v40 = { error: String((e as Error).message).slice(0, 160) }; }

    // ---- ERP
    consoleErrors.length = 0; pageErrors.length = 0; api.length = 0;
    const t0 = Date.now();
    let status = 'opened';
    try {
      await erp.setViewportSize({ width: 1440, height: 900 });
      await erp.goto(`/m/${p.id}`, { waitUntil: 'domcontentloaded' });
      await erp.locator('.main').first().waitFor({ state: 'visible', timeout: 15000 });
      await erp.waitForTimeout(1800);
    } catch (e) { status = `open-failed: ${String((e as Error).message).split('\n')[0].slice(0, 100)}`; }
    const loadMs = Date.now() - t0;
    rec.status = status; rec.loadMs = loadMs;
    rec.consoleErrors = [...consoleErrors]; rec.pageErrors = [...pageErrors];
    rec.api = api.slice(0, 40);
    try {
      const e = await collect(erp, '.main');
      const notFound = /Page not found|does not exist or is not available/.test(e.text);
      const denied = /Access denied|not allowed|don't have permission/i.test(e.text);
      rec.erp = { buttons: e.buttons, tabs: e.tabs, tableRows: e.tableRows, searchBoxes: e.searchBoxes, h1: e.h1, inlineStyles: e.inlineStyles, notFound, denied, badText: (BAD_TEXT.exec(e.text) ?? [])[0] ?? null, empty: /No .{1,40} yet|No records|Nothing to show|No data/i.test(e.text), textLen: e.text.length };
    } catch (e) { rec.erp = { error: String((e as Error).message).slice(0, 160) }; }
    const overflow: Record<string, boolean> = {};
    for (const w of widths) {
      try {
        await erp.setViewportSize({ width: w, height: w < 600 ? 844 : w < 1200 ? 768 : 900 });
        await erp.waitForTimeout(500);
        overflow[String(w)] = await erp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2 || (document.querySelector('.main') as HTMLElement | null)?.scrollWidth! > (document.querySelector('.main') as HTMLElement).clientWidth + 2);
        await erp.screenshot({ path: shot('erp', w) });
      } catch { overflow[String(w)] = false; }
    }
    rec.overflow = overflow;
    appendFileSync(outFile, JSON.stringify(rec) + '\n');
    console.log(`audited ${p.id} ${status}`);
  }
  await ctx.close();
});
