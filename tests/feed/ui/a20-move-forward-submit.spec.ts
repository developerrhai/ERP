// Move Forward submitted for real on one document of each family (owner, local UI database): pick a document, choose a department, send.
// If the first document is already with another department, the next one is tried (up to 4).
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from '@playwright/test';
import { enterAs } from '../../ui-audit/login';

const PAGES = ['crm-leads', 'sales-quotations', 'scm-pr', 'inv-batch', 'mfg-orders', 'qms-ncr', 'maint-breakdown', 'fin-expenses', 'hr-recruitment', 'proj-projects', 'service-tickets', 'log-shipments', 'dms-docs', 'asset-capitalization', 'cl-workers', 'pay-loan', 'scm-suppliers', 'wms-zones'];
const NL = String.fromCharCode(10);
const OUT = path.resolve(__dirname, '../../../docs/ui-audit/move-forward-submit.jsonl');

test('move forward submit', async ({ page }) => {
  test.setTimeout(30 * 60_000);
  writeFileSync(OUT, '');
  const owner = JSON.parse(readFileSync(path.join(__dirname, 'state.json'), 'utf8')).ownerId as string;
  await enterAs(page, owner);
  for (const id of PAGES) {
    const r: Record<string, unknown> = { id };
    const notes: string[] = [];
    try {
      for (let n = 0; n < 4 && !r.result; n++) {
        await page.goto(`/m/${id}`);
        await page.waitForTimeout(1500);
        await page.locator('.main').first().locator('button:text-is("Move Forward")').first().click();
        await page.waitForTimeout(1200);
        let dlg = page.getByRole('dialog').last();
        if (!(await dlg.locator('#mf-to').count())) {
          const picks = dlg.locator('tbody button:text-is("Move Forward")');
          r.docs = await picks.count();
          if (n >= (r.docs as number)) { notes.push('no more documents'); break; }
          await picks.nth(n).click();
          await page.waitForTimeout(1000);
          dlg = page.getByRole('dialog').last();
        }
        const opts = (await dlg.locator('#mf-to option').allInnerTexts()).map((o) => o.trim());
        const target = ['Finance', 'Purchase', 'Quality', 'Warehouse', 'Production', 'Sales'].find((d) => opts.includes(d));
        if (!target) { notes.push(`no department option (${opts.join('|')})`); break; }
        await dlg.locator('#mf-to').selectOption({ label: target });
        await dlg.getByLabel(/Short Handover Note/).fill('Sweep: please take this forward').catch(() => undefined);
        await dlg.getByRole('button', { name: 'Move Forward' }).last().click();
        await page.waitForTimeout(1800);
        const open = page.getByRole('dialog').filter({ has: page.locator('#mf-to') });
        if (!(await open.count())) { r.result = `SENT (document ${n + 1}) to ${target}`; break; }
        notes.push(`doc ${n + 1} -> ${target}: ` + (await open.last().locator('[role=alert], .field-error, .err, .error, small').allInnerTexts()).join(' / ').replace(/ +/g, ' ').slice(0, 200));
        await page.keyboard.press('Escape');
      }
      if (!r.result) r.result = `NOT SENT ${notes.join(' || ')}`;
    } catch (e) { r.result = `ERROR ${String(e).slice(0, 150)}`; }
    appendFileSync(OUT, JSON.stringify(r) + NL);
  }
});
