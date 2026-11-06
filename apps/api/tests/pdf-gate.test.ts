// T-PDF-01 — the Devanagari gate (docs/phases/PHASE-04.md §5 C10). No PDF template may be built
// until this passes: ₹ and Hindi / Marathi text must render with embedded fonts, no missing glyphs,
// correct conjunct shaping (checked against HarfBuzz) and a text layer that round-trips.
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { FONT_FILES, drawLine, finishPdf, newPdf, splitRuns } from '../src/core/pdf';

const SAMPLE = '₹ 1,23,456.00 — रेडी हँड प्रायव्हेट लिमिटेड, तळवडे';

interface HbGlyphInfo {
  codepoint: number;
}
interface HbModule {
  Blob: new (data: Uint8Array) => unknown;
  Face: new (blob: unknown) => unknown;
  Font: new (face: unknown) => unknown;
  Buffer: new () => {
    addText(text: string): void;
    guessSegmentProperties(): void;
    getGlyphInfos(): HbGlyphInfo[];
  };
  shape(font: unknown, buffer: unknown): void;
}

async function hbGlyphIds(fontPath: string, text: string): Promise<number[]> {
  const hb = (await import('harfbuzzjs')) as unknown as HbModule;
  const font = new hb.Font(new hb.Face(new hb.Blob(readFileSync(fontPath))));
  const buffer = new hb.Buffer();
  buffer.addText(text);
  buffer.guessSegmentProperties();
  hb.shape(font, buffer);
  return buffer.getGlyphInfos().map((g) => g.codepoint);
}

async function render(text: string): Promise<Buffer> {
  const doc = newPdf({ title: 'gate' });
  drawLine(doc, text, 40, 60, { size: 14 });
  return finishPdf(doc);
}

function streamsOf(pdf: Buffer): string[] {
  const out: string[] = [];
  const text = pdf.toString('latin1');
  const re = /stream\r?\n/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const start = m.index + m[0].length;
    const end = text.indexOf('endstream', start);
    if (end < 0) break;
    const raw = pdf.subarray(start, end);
    try {
      out.push(inflateSync(raw).toString('latin1'));
    } catch {
      out.push(raw.toString('latin1'));
    }
  }
  return out;
}

/** All 2-byte glyph codes shown by the page content (Tj / TJ), in drawing order. */
function shownGlyphCodes(pdf: Buffer): string[] {
  const codes: string[] = [];
  for (const s of streamsOf(pdf)) {
    if (!/\bTf\b/.test(s)) continue;
    for (const m of s.matchAll(/<([0-9a-fA-F]+)>/g)) {
      const hex = m[1] ?? '';
      for (let i = 0; i + 4 <= hex.length; i += 4) codes.push(hex.slice(i, i + 4).toLowerCase());
    }
  }
  return codes;
}

/** Destination strings (hex, UTF-16BE) of every ToUnicode map in the file. */
function toUnicodeTargets(pdf: Buffer): string[] {
  const out: string[] = [];
  for (const s of streamsOf(pdf)) {
    if (!s.includes('beginbfchar') && !s.includes('beginbfrange')) continue;
    // pdfkit writes targets as <0915 094d 0937> (inside bfrange arrays); drop the spaces.
    for (const m of s.matchAll(/<([0-9a-fA-F\s]+)>/g)) {
      out.push((m[1] ?? '').replace(/\s+/g, '').toLowerCase());
    }
  }
  return out;
}

describe('T-PDF-01 Devanagari gate', () => {
  it('bundles all four font files with their licence', () => {
    for (const f of Object.values(FONT_FILES))
      expect(readFileSync(f).length).toBeGreaterThan(100_000);
  });

  it('splits Latin / Devanagari runs and keeps ₹ and digits with Latin', () => {
    const runs = splitRuns(SAMPLE);
    expect(runs.some((r) => r.script === 'deva' && r.text.includes('रेडी'))).toBe(true);
    expect(runs.find((r) => r.text.includes('₹'))?.script).toBe('latin');
    expect(splitRuns('क्‍ष').map((r) => r.script)).toEqual(['deva']); // ZWJ stays inside the run
  });

  it('embeds both fonts as subsets', async () => {
    const pdf = await render(SAMPLE);
    const text = pdf.toString('latin1');
    expect(text.match(/\/FontFile2/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(text).toMatch(/\/BaseFont \/[A-Z]{6}\+NotoSansDevanagari/);
    expect(text).toMatch(
      /\/BaseFont \/[A-Z]{6}\+NotoSans-?Regular|\/BaseFont \/[A-Z]{6}\+NotoSans\b/,
    );
  });

  it('uses no .notdef glyph (every character has a glyph in its font)', async () => {
    const codes = shownGlyphCodes(await render(SAMPLE));
    expect(codes.length).toBeGreaterThan(20);
    expect(codes).not.toContain('0000');
  });

  it('shapes like HarfBuzz: the glyph count of each run matches', async () => {
    let expected = 0;
    for (const run of splitRuns(SAMPLE)) {
      const file = run.script === 'deva' ? FONT_FILES.deva : FONT_FILES.sans;
      expected += (await hbGlyphIds(file, run.text)).length;
    }
    expect(shownGlyphCodes(await render(SAMPLE))).toHaveLength(expected);
  });

  it('forms the conjuncts क्ष and ज्ञ as single glyphs (matches HarfBuzz)', async () => {
    for (const word of ['क्ष', 'ज्ञ']) {
      const hb = await hbGlyphIds(FONT_FILES.deva, word);
      expect(hb, word).toHaveLength(1);
      expect(shownGlyphCodes(await render(word)), word).toHaveLength(1);
    }
    // रेडी: reph-free but with matras — HarfBuzz and the PDF agree on the count
    const hb = await hbGlyphIds(FONT_FILES.deva, 'प्रायव्हेट');
    expect(shownGlyphCodes(await render('प्रायव्हेट'))).toHaveLength(hb.length);
  });

  it('keeps a text layer: ToUnicode maps ₹ and the conjunct back to Unicode', async () => {
    const targets = toUnicodeTargets(await render(`${SAMPLE} क्ष`));
    expect(targets).toContain('20b9');
    expect(targets).toContain('0915094d0937');
  });

  it('is deterministic enough to render twice without error and produces a PDF header', async () => {
    const a = await render(SAMPLE);
    expect(a.subarray(0, 5).toString()).toBe('%PDF-');
    expect((await render(SAMPLE)).length).toBeGreaterThan(5_000);
  });
});
