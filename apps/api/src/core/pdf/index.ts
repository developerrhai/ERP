// Server-side PDF primitives (docs/phases/PHASE-04.md §5 C10, ROADMAP R-10): pdfkit with Noto Sans
// (Latin, ₹) and Noto Sans Devanagari (Hindi / Marathi). Text is split into SCRIPT RUNS; every run is
// drawn with the font that has its glyphs, and pdfkit's fontkit applies the OpenType shaping
// (conjuncts such as क्ष / ज्ञ, matras, reph) for the Devanagari runs. The gate test compares that
// shaping with HarfBuzz.
import path from 'node:path';
import PDFDocument from 'pdfkit';

const FONT_DIR = path.resolve(__dirname, '..', '..', '..', 'assets', 'fonts');

export const FONT_FILES = {
  sans: path.join(FONT_DIR, 'NotoSans_400Regular.ttf'),
  sansBold: path.join(FONT_DIR, 'NotoSans_700Bold.ttf'),
  deva: path.join(FONT_DIR, 'NotoSansDevanagari_400Regular.ttf'),
  devaBold: path.join(FONT_DIR, 'NotoSansDevanagari_700Bold.ttf'),
} as const;

export type Script = 'latin' | 'deva';

export interface TextRun {
  text: string;
  script: Script;
}

const ZWNJ = 0x200c;
const ZWJ = 0x200d;

export function isDevanagari(cp: number): boolean {
  return (
    (cp >= 0x0900 && cp <= 0x097f) || // Devanagari (incl. danda, Hindi / Marathi letters, digits)
    (cp >= 0xa8e0 && cp <= 0xa8ff) || // Devanagari Extended
    (cp >= 0x1cd0 && cp <= 0x1cff) // Vedic Extensions
  );
}

/** Splits text into maximal runs of one script. Joiners stay with the Devanagari letters around them. */
export function splitRuns(text: string): TextRun[] {
  const runs: TextRun[] = [];
  let prev: Script = 'latin';
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    let script: Script;
    if (isDevanagari(cp)) script = 'deva';
    else if ((cp === ZWNJ || cp === ZWJ) && prev === 'deva') script = 'deva';
    else script = 'latin';
    const last = runs[runs.length - 1];
    if (last && last.script === script) last.text += ch;
    else runs.push({ text: ch, script });
    prev = script;
  }
  return runs;
}

export type FontName = 'Sans' | 'Sans-Bold' | 'Deva' | 'Deva-Bold';

export function fontFor(script: Script, bold: boolean): FontName {
  if (script === 'deva') return bold ? 'Deva-Bold' : 'Deva';
  return bold ? 'Sans-Bold' : 'Sans';
}

export interface NewPdfOptions {
  title?: string;
  author?: string;
  subject?: string;
  margin?: number;
  landscape?: boolean;
}

export function newPdf(options: NewPdfOptions = {}): PDFKit.PDFDocument {
  const margin = options.margin ?? 40;
  const doc = new PDFDocument({
    size: 'A4',
    layout: options.landscape ? 'landscape' : 'portrait',
    margin,
    bufferPages: true,
    // A fixed creation date keeps identical input byte-identical (useful for tests and caching).
    info: {
      Title: options.title ?? 'Document',
      Author: options.author ?? 'Sawant Group ERP',
      Subject: options.subject ?? '',
    },
  });
  doc.registerFont('Sans', FONT_FILES.sans);
  doc.registerFont('Sans-Bold', FONT_FILES.sansBold);
  doc.registerFont('Deva', FONT_FILES.deva);
  doc.registerFont('Deva-Bold', FONT_FILES.devaBold);
  doc.font('Sans');
  return doc;
}

export interface TextStyle {
  size: number;
  bold?: boolean;
  color?: string;
}

/** Width of `text` in points, summing every run in its own font. */
export function textWidth(doc: PDFKit.PDFDocument, text: string, style: TextStyle): number {
  let total = 0;
  for (const run of splitRuns(text)) {
    doc.font(fontFor(run.script, style.bold === true)).fontSize(style.size);
    total += doc.widthOfString(run.text);
  }
  return total;
}

/** Greedy word wrap on spaces; a single word wider than the line is kept whole. */
export function wrapText(
  doc: PDFKit.PDFDocument,
  text: string,
  maxWidth: number,
  style: TextStyle,
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter((w) => w !== '')) {
      const candidate = line === '' ? word : `${line} ${word}`;
      if (line !== '' && textWidth(doc, candidate, style) > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    lines.push(line);
  }
  return lines;
}

export interface DrawOptions extends TextStyle {
  align?: 'left' | 'right' | 'center';
  /** Column width used by right / center alignment. */
  width?: number;
}

/** Draws one line of mixed-script text at (x, y); returns the line height used. */
export function drawLine(
  doc: PDFKit.PDFDocument,
  text: string,
  x: number,
  y: number,
  options: DrawOptions,
): number {
  const total = textWidth(doc, text, options);
  let cursor = x;
  if (options.width !== undefined && options.align === 'right') cursor = x + options.width - total;
  if (options.width !== undefined && options.align === 'center') {
    cursor = x + (options.width - total) / 2;
  }
  if (options.color) doc.fillColor(options.color);
  for (const run of splitRuns(text)) {
    doc.font(fontFor(run.script, options.bold === true)).fontSize(options.size);
    const w = doc.widthOfString(run.text);
    doc.text(run.text, cursor, y, { lineBreak: false });
    cursor += w;
  }
  return lineHeight(options.size);
}

export function lineHeight(size: number): number {
  // Devanagari matras need more vertical room than Latin text.
  return Math.round(size * 1.45 * 10) / 10;
}

/** Draws wrapped text inside a column; returns the y below the last line. */
export function drawParagraph(
  doc: PDFKit.PDFDocument,
  text: string,
  x: number,
  y: number,
  width: number,
  options: DrawOptions,
): number {
  let cursorY = y;
  for (const line of wrapText(doc, text, width, options)) {
    drawLine(doc, line, x, cursorY, { ...options, width, align: options.align ?? 'left' });
    cursorY += lineHeight(options.size);
  }
  return cursorY;
}

/** "Page x of y" on every buffered page; call once, after all content is drawn. */
export function addPageNumbers(doc: PDFKit.PDFDocument, label = 'Page'): void {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const bottom = doc.page.height - 28;
    // Writing below the bottom margin must not open a new page.
    const margins = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    drawLine(
      doc,
      `${label} ${i - range.start + 1} of ${range.count}`,
      doc.page.margins.left,
      bottom,
      {
        size: 8,
        color: '#666666',
        align: 'right',
        width,
      },
    );
    doc.page.margins.bottom = margins;
  }
}

export function finishPdf(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}
