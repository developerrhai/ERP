// Shared form helpers for the Phase 36 feeders: find a control by its label, type-ahead pickers, line grids.
import type { Locator, Page } from '@playwright/test';

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Control by label text (label may carry " *" or a hint after it). */
export function byLabel(scope: Locator | Page, label: string, nth = 0): Locator {
  return scope.getByLabel(new RegExp(`^${esc(label)}(\\s|\\*|\\(|$)`)).nth(nth);
}

/**
 * Sets a control by label: select -> the option matching any candidate (else the first real option),
 * checkbox -> ticked/unticked, date input -> ISO text, anything else -> typed text.
 */
export async function setField(scope: Locator | Page, label: string, value: string | boolean | string[], nth = 0): Promise<void> {
  const ctl = byLabel(scope, label, nth);
  if ((await ctl.count()) === 0) throw new Error(`field "${label}" not on the form`);
  const tag = await ctl.evaluate((el) => el.tagName.toLowerCase());
  const type = await ctl.evaluate((el) => (el as HTMLInputElement).type ?? '');
  if (tag === 'select') {
    const options = await ctl.locator('option').allInnerTexts();
    const wanted = (Array.isArray(value) ? value : [String(value)]).filter((w) => w.trim() !== ''); // '' would match the placeholder
    const hit =
      wanted.map((w) => options.find((o) => o.trim().toLowerCase() === w.toLowerCase())).find(Boolean) ??
      wanted.map((w) => options.find((o) => o.trim().toLowerCase().includes(w.toLowerCase()))).find(Boolean) ??
      options.find((o) => o.trim() && !/^select|^choose|^--|^—|^…/i.test(o.trim()));
    if (!hit) throw new Error(`no option for "${label}"`);
    await ctl.selectOption({ label: hit });
  } else if (type === 'checkbox') {
    await ctl.setChecked(Boolean(value));
  } else await ctl.fill(String(Array.isArray(value) ? value[0] : value));
}

/** The n-th type-ahead picker (role=combobox) in the scope: type, then click the matching option. */
export async function pickCombo(scope: Locator, n: number, text: string): Promise<void> {
  const box = scope.locator('input[role=combobox]').nth(n);
  await box.click();
  await box.pressSequentially(text.split(' ')[0] ?? text, { delay: 60 }); // type like a person, then pick
  const opt = scope.page().getByRole('option').filter({ hasText: text }).first();
  await opt.waitFor({ state: 'visible', timeout: 10000 });
  await opt.click();
}

/** Opens a page and presses its Add button (by visible text), returning the dialog. */
export async function openAdd(page: Page, pageId: string, addText: string | RegExp): Promise<Locator> {
  await page.goto(`/m/${pageId}`);
  await page.locator('.main').first().waitFor({ state: 'visible' });
  await page.waitForTimeout(1500);
  await page.locator('.main button').filter({ hasText: addText }).first().click();
  const dlg = page.getByRole('dialog').first();
  await dlg.waitFor({ state: 'visible', timeout: 10000 });
  await page.waitForTimeout(600);
  return dlg;
}
