// Phase 32: the style rules the Phase 26-31 pages rely on exist (a cheap guard until the visual baselines can run).
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(path.resolve(__dirname, 'app.css'), 'utf8');

describe('Phase 32 styles', () => {
  it('the dialog overlay used by the new pages is styled (not an unstyled block)', () => {
    expect(css).toMatch(/\.modal-backdrop\s*\{[^}]*position:\s*fixed/);
    expect(css).toMatch(/\.modal-actions\s*\{/);
  });
  it('keyboard focus is visible and phone tap targets are 44 px', () => {
    expect(css).toMatch(/:focus-visible[^{]*\{[^}]*outline:\s*3px/);
    expect(css).toMatch(/@media \(max-width: 600px\)[\s\S]*min-height:\s*44px/);
  });
  it('printing hides the dialogs, tabs and buttons of the new pages', () => {
    const print = css.slice(css.lastIndexOf('@media print'));
    expect(print).toContain('.modal-backdrop');
    expect(print).toContain('.row-actions');
  });
  it('every dialog in the new pages is announced as a dialog and named', () => {
    const dirs = ['spine', 'docsmail', 'attendance', 'ops', 'contractlabour', 'control'];
    for (const d of dirs) {
      const dir = path.resolve(__dirname, '..', 'pages', d);
      for (const f of readdirSync(dir).filter((x) => x.endsWith('.tsx'))) {
        const src = readFileSync(path.join(dir, f), 'utf8');
        const bad = [...src.matchAll(/className="modal-backdrop"([^>]*)>/g)].filter((m) => !/role="dialog"/.test(m[1] ?? '') || !/aria-modal="true"/.test(m[1] ?? '') || !/aria-label=/.test(m[1] ?? ''));
        expect(bad, `${d}/${f}`).toHaveLength(0);
      }
    }
  });
});
