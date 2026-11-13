// Phase 22-E: the page crawler. Roles x plant combos x every page x every tab, through the real login
// screen. Collects console errors, page errors, failed responses and forbidden text, checks the
// ActionBar and measures load time. The JSON goes to tools/import-page-health.ts -> page_health.
// The gate: 0 errors.
//
// Narrowing for a quick run (all default to "everything"):
//   CRAWL_ROLES="Super User,Employee"   CRAWL_PAGES="wms-racks,pay-loan"   CRAWL_TABS=0 (skip tabs)
//   CRAWL_COMBOS=default   (plant combos: default, Talwade+Sawardari, All)
//   CRAWL_OUT=path/to/result.json
import { test, type Page } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { E2E } from './e2e-env.mjs';
import { ensureUser, firstLogin, loginAs, logout, ROLES, type FeedEnv, type RoleName } from '../feed/lib';

const ENV: FeedEnv = {
  ownerId: E2E.owner.loginId,
  ownerPassword: E2E.owner.newPassword,
  ownerInitialPassword: E2E.owner.initialPassword,
  tempPassword: 'Feed#Temp2026xq',
  userPassword: 'Feed#Next2026xq',
};

/** Text that must never reach a user: raw error codes, stack traces, template leftovers. */
const FORBIDDEN = [
  /\bundefined\b/i,
  /\[object Object\]/,
  /\bNaN\b/,
  /Cannot read propert/i,
  /\bTypeError\b/,
  /\b(VALIDATION|FORBIDDEN|INTERNAL|UNAUTHENTICATED)_?\w*\b:/,
  /Something went wrong/i,
  /This module will be enabled in a later phase/i,
];
const BUDGET_MS = 2000;
const REPO = resolve(__dirname, '../..');

interface Check {
  page_id: string;
  role_code: string;
  unit_combo: string;
  status: 'OK' | 'ERROR';
  error_kind: string | null;
  error_text: string | null;
  p95_ms: number | null;
}

const only = (v: string | undefined): string[] | null => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : null);
const ROLE_FILTER = only(process.env.CRAWL_ROLES);
const PAGE_FILTER = only(process.env.CRAWL_PAGES);
const WITH_TABS = process.env.CRAWL_TABS !== '0';
const OUT = resolve(process.env.CRAWL_OUT ?? 'tests/e2e/.artifacts/page-health.json');

/** Multi-plant roles are also crawled with two plants and with all of them; others with their default. */
const MULTI_PLANT: RoleName[] = ['Super User', 'Administrator', 'Director', 'CFO', 'GM'];
const COMBO_FILTER = only(process.env.CRAWL_COMBOS);
function combosFor(role: RoleName): string[] {
  const all = MULTI_PLANT.includes(role) ? ['default', 'Talwade+Sawardari', 'All'] : ['default'];
  return COMBO_FILTER ? all.filter((c) => COMBO_FILTER.includes(c)) : all;
}

/** Built, non-dynamic pages of registry v2 (+ the pages later phases added), read from disk. */
function pagesToCrawl(): { id: string; tabs: number }[] {
  const reg = JSON.parse(readFileSync(resolve(REPO, 'packages/registry/registry.v2.json'), 'utf8')) as {
    pages: { id: string; tabs: string[]; dynamic: boolean; status: string }[];
  };
  const api = readFileSync(resolve(REPO, 'apps/api/src/core/registry.ts'), 'utf8');
  const extra = [...api.matchAll(/^\s{4}id: '([a-z0-9-]+)',$/gm)].map((m) => m[1] as string);
  const have = new Set(reg.pages.map((p) => p.id));
  const all = [
    ...reg.pages.filter((p) => p.status === 'built' && !p.dynamic).map((p) => ({ id: p.id, tabs: p.tabs.length })),
    ...extra.filter((id) => !have.has(id)).map((id) => ({ id, tabs: 0 })),
  ];
  const chosen = PAGE_FILTER ? all.filter((p) => PAGE_FILTER.includes(p.id)) : all;
  return chosen.map((p) => ({ id: p.id, tabs: WITH_TABS ? p.tabs : 0 }));
}

/**
 * "Network idle" for an app that keeps a live event stream open: resolves when no request is in
 * flight for 500 ms. The SSE stream (/realtime/) is ignored; Playwright's networkidle never fires with it.
 */
async function quiet(pending: { n: number }, maxMs: number): Promise<boolean> {
  const started = Date.now();
  let quietSince = Date.now();
  await new Promise((r) => setTimeout(r, 300));
  while (Date.now() - started < maxMs) {
    if (pending.n > 0) quietSince = Date.now();
    else if (Date.now() - quietSince >= 500) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

async function visit(page: Page, url: string): Promise<{ ms: number; problems: { kind: string; text: string }[] }> {
  const problems: { kind: string; text: string }[] = [];
  const onConsole = (m: { type(): string; text(): string }) => {
    // a 422 is the API saying "fix your input / choose one plant" and the page shows that message: not a defect
    if (m.type() === 'error' && !/status of 422/.test(m.text())) problems.push({ kind: 'CONSOLE', text: m.text().slice(0, 300) });
  };
  const onPageError = (e: Error) => problems.push({ kind: 'PAGE_ERROR', text: String(e).slice(0, 300) });
  const onResponse = (r: { url(): string; status(): number }) => {
    const u = r.url();
    if (u.includes('/api/') && r.status() >= 400 && r.status() !== 401 && r.status() !== 422 && r.status() !== 304) {
      // a 403/404 the page asked for on purpose still counts: the crawler opens only allowed pages
      problems.push({ kind: 'HTTP', text: `${r.status()} ${u.replace(/^https?:\/\/[^/]+/, '')}`.slice(0, 300) });
    }
  };
  const pending = { n: 0 };
  const onReq = (r: { url(): string }) => {
    if (!r.url().includes('/realtime/')) pending.n += 1;
  };
  const onDone = (r: { url(): string }) => {
    if (!r.url().includes('/realtime/')) pending.n = Math.max(0, pending.n - 1);
  };
  page.on('request', onReq);
  page.on('requestfinished', onDone);
  page.on('requestfailed', onDone);
  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  page.on('response', onResponse);
  const t0 = Date.now();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    if (!(await quiet(pending, 15_000))) {
      problems.push({ kind: 'TIMEOUT', text: 'requests never finished in 15 s' });
    }
    const ms = Date.now() - t0;
    const text = await page.locator('body').innerText();
    for (const re of FORBIDDEN) {
      const m = re.exec(text);
      if (m) problems.push({ kind: 'FORBIDDEN_TEXT', text: `"${m[0]}"` });
    }
    if ((await page.getByTestId('actionbar').count()) === 0 && !/\/m\/dashboard/.test(url)) {
      problems.push({ kind: 'NO_ACTIONBAR', text: 'the V40 button bar is missing' });
    }
    return { ms, problems };
  } finally {
    page.off('request', onReq);
    page.off('requestfinished', onDone);
    page.off('requestfailed', onDone);
    page.off('console', onConsole);
    page.off('pageerror', onPageError);
    page.off('response', onResponse);
  }
}

test('crawl every page as every role', async ({ browser }) => {
  test.setTimeout(0);
  const results: Check[] = [];
  const runId = randomUUID();

  // one-time: the owner creates the feeder users on the real User Master screen
  const roles = (Object.keys(ROLES) as RoleName[]).filter((r) => !ROLE_FILTER || ROLE_FILTER.includes(r));
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await loginAs(page, ENV, 'Super User');
    for (const r of roles) await ensureUser(page, ENV, r);
    await ctx.close();
  }

  for (const role of roles) {
    for (const combo of combosFor(role)) {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      try {
        if (role === 'Super User') await loginAs(page, ENV, role, combo === 'default' ? '' : combo.replace('+', ' + '));
        else {
          await firstLogin(page, ENV, role).catch(async () => loginAs(page, ENV, role));
          if (combo !== 'default') await loginAs(page, ENV, role, combo === 'All' ? 'All units' : combo);
        }
        const list = pagesToCrawl();
        for (const p of list) {
          const urls = [`/m/${p.id}`, ...Array.from({ length: p.tabs }, (_, i) => `/m/${p.id}?tab=${i}`)];
          const times: number[] = [];
          const bad: { kind: string; text: string }[] = [];
          for (const u of urls) {
            try {
              const r = await visit(page, u);
              times.push(r.ms);
              bad.push(...r.problems);
            } catch (e) {
              bad.push({ kind: 'OTHER', text: String(e).slice(0, 300) });
            }
          }
          times.sort((a, b) => a - b);
          const p95 = times.length ? (times[Math.min(times.length - 1, Math.ceil(times.length * 0.95) - 1)] ?? null) : null;
          const first = bad[0];
          results.push({
            page_id: p.id,
            role_code: role.replace(/\s+/g, '_').toUpperCase(),
            unit_combo: combo,
            status: first ? 'ERROR' : 'OK',
            error_kind: first?.kind ?? null,
            error_text: first ? [...new Set(bad.map((b) => `${b.kind}: ${b.text}`))].slice(0, 5).join(' | ') : null,
            p95_ms: p95,
          });
        }
      } finally {
        await logout(page).catch(() => undefined);
        await ctx.close();
      }
    }
  }

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({ runId, budgetMs: BUDGET_MS, checks: results }, null, 2));
  const errors = results.filter((r) => r.status === 'ERROR');
  console.log(`crawl: ${results.length} checks, ${errors.length} errors -> ${OUT}`);
  for (const e of errors.slice(0, 40)) console.log(`  ${e.role_code}/${e.unit_combo}/${e.page_id}: ${e.error_text}`);
  if (errors.length > 0) throw new Error(`${errors.length} page checks failed (gate: 0 errors)`);
});
