// Records every feed step (done / failed / finding) as JSON lines; render-log.ts turns them into DATA-FEED-LOG.md.
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';

const dir = path.resolve(__dirname, '../../../docs/ui-audit');
export const RESULTS = path.join(dir, 'feed-results.jsonl');

export interface FeedRecord { step: string; item: string; status: 'done' | 'exists' | 'failed' | 'finding'; note?: string; page?: string; api?: string; shot?: string; at: string }

export function record(r: Omit<FeedRecord, 'at'>): void {
  mkdirSync(dir, { recursive: true });
  appendFileSync(RESULTS, JSON.stringify({ ...r, at: new Date().toISOString() }) + '\n');
}

/** Runs one feed item; a failure is logged with a screenshot and the failing API call, and never stops the run. */
export async function attempt(page: Page, step: string, item: string, pageId: string, fn: () => Promise<'done' | 'exists'>): Promise<boolean> {
  let lastApi = '';
  const onResp = (r: import('@playwright/test').Response) => {
    if (r.url().includes('/api/v1/') && r.request().method() !== 'GET' && r.status() >= 400) {
      lastApi = `${r.request().method()} ${r.url().replace(/^https?:\/\/[^/]+/, '')} -> ${r.status()}`;
      void r.text().then((t) => {
        const f = /"fields":(\{[^}]*\})/.exec(t);
        if (f?.[1]) lastApi += ` fields ${f[1]}`;
      }).catch(() => undefined);
    }
  };
  page.on('response', onResp);
  try {
    record({ step, item, status: await fn(), page: pageId });
    return true;
  } catch (e) {
    if (/-> 409/.test(lastApi)) {
      record({ step, item, status: 'exists', page: pageId, note: 'already existed (409)' });
      await page.keyboard.press('Escape').catch(() => undefined);
      return true;
    }
    const shot = `docs/ui-audit/shots/feed/${step}-${item.replace(/[^a-z0-9]+/gi, '_')}.png`;
    await page.screenshot({ path: path.resolve(__dirname, '../../../', shot) }).catch(() => undefined);
    const toast = (await page.locator('.toast.show, [role="alert"]').first().innerText({ timeout: 800 }).catch(() => '')).replace(/\s+/g, ' ');
    record({ step, item, status: 'failed', page: pageId, note: `${String((e as Error).message).split('\n')[0].slice(0, 240)}${toast ? ` | screen says: ${toast.slice(0, 160)}` : ''}`, api: lastApi || undefined, shot });
    await page.keyboard.press('Escape').catch(() => undefined);
    return false;
  } finally {
    page.off('response', onResp);
  }
}
