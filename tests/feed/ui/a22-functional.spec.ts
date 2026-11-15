// Functional exerciser: opens each page (env FN_IDS=a,b), presses EVERY button in the page body one by one and records what happens:
// URL change, dialog / drawer, toast, download, server errors (>= 400), page errors, and the number of audit_logs rows before and after.
// Output: docs/ui-audit/functional/<id>.json. Runs as the owner on the local UI database only.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from '@playwright/test';
import { enterAs } from '../../ui-audit/login';

const root = path.resolve(__dirname, '../../..');
const env = readFileSync(path.join(root, 'apps/api/.env'), 'utf8').match(/^DATABASE_URL=.*$/m)![0];
const DBU = env.replace(/.*:\/\/([^:]+):.*/, '$1');
const DBP = env.replace(/.*:\/\/[^:]+:([^@]+)@.*/, '$1');
const NL = String.fromCharCode(10);
const auditCount = (): number =>
  Number(execFileSync('psql', ['-U', DBU, '-h', 'localhost', '-d', 'rhai_erp_ui', '-At', '-c', 'SELECT count(*) FROM audit_logs'], { env: { ...process.env, PGPASSWORD: DBP } }).toString().trim().split(NL)[0]);

const ids = (process.env.FN_IDS ?? 'dashboard').split(',').filter(Boolean);
const SKIP = /^(Menu|All modules|Privacy Notice|Sign out|Log out|Logout)/i;

test('functional', async ({ page }) => {
  test.setTimeout(60 * 60_000);
  mkdirSync(path.join(root, 'docs/ui-audit/functional'), { recursive: true });
  const state = JSON.parse(readFileSync(path.join(__dirname, 'state.json'), 'utf8')) as { ownerId: string };
  await enterAs(page, state.ownerId);
  const bad: string[] = [];
  const errs: string[] = [];
  page.on('response', (r) => { if (r.status() >= 400 && r.url().includes('/api/')) bad.push(`${r.status()} ${r.request().method()} ${r.url().replace(/^https?:\/\/[^/]+/, '')}`); });
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
  for (const id of ids) {
    const rows: Record<string, unknown>[] = [];
    await page.goto(`/m/${id}`);
    await page.waitForTimeout(3000);
    const main = page.locator('.main').first();
    const labels = await main.locator('button:visible, a.btn:visible, [role=tab]:visible').evaluateAll((els) =>
      els.map((e, i) => ({ i, text: ((e as HTMLElement).innerText || e.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 60), disabled: (e as HTMLButtonElement).disabled === true })),
    );
    const seen = new Set<string>();
    for (const l of labels) {
      if (!l.text || SKIP.test(l.text)) continue;
      const key = `${l.text}#${[...seen].filter((s) => s.startsWith(l.text + '#')).length}`;
      seen.add(key);
      const r: Record<string, unknown> = { button: l.text, disabled: l.disabled };
      if (l.disabled) { r.result = 'DISABLED'; rows.push(r); continue; }
      bad.length = 0; errs.length = 0;
      const before = auditCount();
      try {
        await page.goto(`/m/${id}`);
        await page.waitForTimeout(1800);
        const target = page.locator('.main').first().locator('button:visible, a.btn:visible, [role=tab]:visible').nth(l.i);
        const url0 = page.url();
        const dl = page.waitForEvent('download', { timeout: 2500 }).then((d) => d.suggestedFilename(), () => null);
        await target.click({ timeout: 5000 });
        await page.waitForTimeout(1500);
        const file = await dl;
        r.url = page.url() !== url0 ? page.url().replace(/^https?:\/\/[^/]+/, '') : undefined;
        const dlg = page.getByRole('dialog');
        r.dialog = (await dlg.count()) ? (await dlg.last().innerText()).replace(/\s+/g, ' ').slice(0, 90) : undefined;
        r.toast = (await page.locator('[role=status], [role=alert], .toast').allInnerTexts()).join(' ').replace(/\s+/g, ' ').slice(0, 140) || undefined;
        r.download = file ?? undefined;
        r.errors = bad.length || errs.length ? [...bad, ...errs].slice(0, 3) : undefined;
        r.auditDelta = auditCount() - before;
        r.result = r.errors ? 'ERROR' : r.url || r.dialog || r.toast || r.download || r.auditDelta ? 'OK' : 'NOTHING HAPPENED';
        await page.keyboard.press('Escape');
      } catch (e) { r.result = `CLICK FAILED ${String(e).slice(0, 100)}`; }
      rows.push(r);
    }
    writeFileSync(path.join(root, `docs/ui-audit/functional/${id}.json`), JSON.stringify(rows, null, 1));
    console.log(`FN ${id}: ${rows.length} buttons, ${rows.filter((x) => x.result === 'OK').length} ok, ${rows.filter((x) => x.result === 'NOTHING HAPPENED').length} nothing, ${rows.filter((x) => String(x.result).startsWith('ERROR') || String(x.result).startsWith('CLICK')).length} error`);
  }
});
