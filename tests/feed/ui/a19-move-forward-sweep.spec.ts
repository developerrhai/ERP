// Move Forward on every V40 page: open the page as the owner, press Move Forward on the first row (or the page button) and record what happens.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from '@playwright/test';
import { enterAs } from '../../ui-audit/login';

const root = path.resolve(__dirname, '../../..');
const ids: string[] = (JSON.parse(readFileSync(path.join(root, 'packages/registry/registry.v2.json'), 'utf8')) as { pages: { id: string }[] }).pages.map((p) => p.id);
const only: string[] | null = process.env.MF_IDS ? (JSON.parse(readFileSync(process.env.MF_IDS, 'utf8')) as string[]) : null;
const OUT = path.join(root, process.env.MF_OUT ?? 'docs/ui-audit/move-forward-sweep.jsonl');

test('move forward sweep', async ({ page }) => {
  test.setTimeout(3 * 60 * 60_000);
  writeFileSync(OUT, '');
  const owner = JSON.parse(readFileSync(path.join(__dirname, 'state.json'), 'utf8')).ownerId as string;
  await enterAs(page, owner);
  for (const id of only ?? ids) {
    const r: Record<string, unknown> = { id };
    try {
      await page.goto(`/m/${id}`);
      await page.waitForTimeout(1800);
      const main = page.locator('.main').first();
      r.rows = await main.locator('tbody tr').count();
      const rowBtn = main.locator('tbody tr button:text-is("Move Forward")').first();
      const pageBtn = main.locator('button:text-is("Move Forward")').first();
      r.rowButton = (await rowBtn.count()) > 0;
      r.pageButton = (await pageBtn.count()) > 0;
      const target = r.rowButton ? rowBtn : pageBtn;
      if (!(await target.count())) r.result = 'NO BUTTON';
      else {
        const dis = await target.isDisabled();
        r.disabled = dis;
        if (dis) r.result = 'DISABLED';
        else {
          await target.click({ timeout: 5000 });
          await page.waitForTimeout(900);
          let dlg = page.getByRole('dialog').last();
          const pick = dlg.locator('tbody button:text-is("Move Forward")').first();
          if (!(await dlg.locator('#mf-to').count())) {
            await page.waitForTimeout(1200);
            if (await pick.count()) { r.viaPicker = true; await pick.click(); await page.waitForTimeout(900); dlg = page.getByRole('dialog').last(); }
            else if (await dlg.getByText(/no record on this page/i).count()) r.emptyPicker = true;
          }
          if (await dlg.locator('#mf-to').count()) { r.result = 'DIALOG'; r.depts = await dlg.locator('#mf-to option').count(); }
          else {
            const toast = (await page.locator('[role=status], [role=alert], .toast').allInnerTexts()).join(' ').slice(0, 160);
            r.result = toast ? `TOAST: ${toast}` : 'NOTHING HAPPENED';
          }
          await page.keyboard.press('Escape');
        }
      }
    } catch (e) { r.result = `ERROR ${String(e).slice(0, 120)}`; }
    appendFileSync(OUT, JSON.stringify(r) + '\n');
  }
});
