// Generic printable documents on top of core/pdf: letterhead + facts + parties + lines + totals +
// amount in words + signatures (record PDF), and a plain register table (list PDF).
// Data comes in as the Kit's PrintDto (docs/plans/07-ENGINE-KIT.md §2.9) so web print and PDF agree.
import type { PrintDto } from '../../kit/print';
import {
  addPageNumbers,
  drawLine,
  drawParagraph,
  finishPdf,
  lineHeight,
  newPdf,
  wrapText,
} from './index';
import { groupIndian } from './amount-words';

export interface PdfLetterhead {
  companyName: string;
  legalName?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  gstin?: string | null;
  pan?: string | null;
  footer?: string | null;
  primaryColor: string;
  showGstin: boolean;
  showPan: boolean;
}

export interface PdfAssets {
  logo?: Buffer | null;
}

const GREY = '#666666';
const INK = '#111111';

function pageWidth(doc: PDFKit.PDFDocument): number {
  return doc.page.width - doc.page.margins.left - doc.page.margins.right;
}

function bottomLimit(doc: PDFKit.PDFDocument): number {
  return doc.page.height - doc.page.margins.bottom - 24;
}

function drawLetterhead(
  doc: PDFKit.PDFDocument,
  lh: PdfLetterhead,
  assets: PdfAssets,
  extraRight?: string,
): number {
  const left = doc.page.margins.left;
  const width = pageWidth(doc);
  let y = doc.page.margins.top;
  let textX = left;
  if (assets.logo) {
    try {
      doc.image(assets.logo, left, y, { fit: [60, 44] });
      textX = left + 70;
    } catch {
      textX = left; // unreadable logo: print without it
    }
  }
  drawLine(doc, lh.companyName, textX, y, { size: 15, bold: true, color: lh.primaryColor });
  y += lineHeight(15);
  const details = [
    lh.legalName,
    lh.address,
    [lh.phone, lh.email].filter(Boolean).join('  |  '),
    [
      lh.showGstin && lh.gstin ? `GSTIN: ${lh.gstin}` : '',
      lh.showPan && lh.pan ? `PAN: ${lh.pan}` : '',
    ]
      .filter(Boolean)
      .join('   '),
  ].filter((v): v is string => typeof v === 'string' && v !== '');
  for (const d of details) {
    y = drawParagraph(doc, d, textX, y, width - (textX - left), { size: 8.5, color: GREY });
  }
  if (extraRight) {
    drawLine(doc, extraRight, left, doc.page.margins.top, {
      size: 8.5,
      color: GREY,
      align: 'right',
      width,
    });
  }
  y = Math.max(y, doc.page.margins.top + 46) + 4;
  doc
    .save()
    .moveTo(left, y)
    .lineTo(left + width, y)
    .lineWidth(1.5)
    .strokeColor(lh.primaryColor)
    .stroke()
    .restore();
  return y + 10;
}

function ensureRoom(
  doc: PDFKit.PDFDocument,
  y: number,
  needed: number,
  redraw: () => number,
): number {
  if (y + needed <= bottomLimit(doc)) return y;
  doc.addPage();
  return redraw();
}

function formatCell(value: string | number | null | undefined, format: string): string {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'number') {
    if (format === 'money') return groupIndian(value, 2);
    if (format === 'percent') return `${groupIndian(value, 2)}%`;
    return groupIndian(value, Number.isInteger(value) ? 0 : 3);
  }
  return value;
}

export async function renderDocumentPdf(
  dto: PrintDto,
  lh: PdfLetterhead,
  assets: PdfAssets = {},
): Promise<Buffer> {
  const doc = newPdf({ title: `${dto.title} ${dto.docNo}`, subject: dto.templateKey });
  const left = doc.page.margins.left;
  const width = pageWidth(doc);
  const headerRight = dto.revision ? `Rev ${dto.revision}` : undefined;
  let y = drawLetterhead(doc, lh, assets, headerRight);

  // Title block
  drawLine(doc, dto.title.toUpperCase(), left, y, {
    size: 13,
    bold: true,
    align: 'center',
    width,
    color: INK,
  });
  y += lineHeight(13) + 2;
  drawLine(doc, `No: ${dto.docNo}`, left, y, { size: 9.5, bold: true, color: INK });
  drawLine(doc, `Date: ${dto.docDate}`, left, y, { size: 9.5, align: 'right', width, color: INK });
  y += lineHeight(9.5) + 4;
  const unitLine = [
    dto.unit.name,
    dto.unit.address,
    dto.unit.gstin ? `GSTIN ${dto.unit.gstin}` : '',
  ]
    .filter(Boolean)
    .join(', ');
  y = drawParagraph(doc, `Unit: ${unitLine}`, left, y, width, { size: 8.5, color: GREY }) + 4;

  // Parties side by side
  if (dto.parties.length > 0) {
    const colW = (width - 12) / 2;
    for (let i = 0; i < dto.parties.length; i += 2) {
      const pair = dto.parties.slice(i, i + 2);
      let rowBottom = y;
      pair.forEach((p, idx) => {
        const x = left + idx * (colW + 12);
        let py = y;
        drawLine(doc, p.role.toUpperCase(), x, py, { size: 7.5, bold: true, color: GREY });
        py += lineHeight(7.5);
        drawLine(doc, p.name, x, py, { size: 10, bold: true, color: INK });
        py += lineHeight(10);
        for (const extra of [p.address, p.gstin ? `GSTIN: ${p.gstin}` : '', p.contact]) {
          if (extra) py = drawParagraph(doc, extra, x, py, colW, { size: 8.5, color: INK });
        }
        rowBottom = Math.max(rowBottom, py);
      });
      y = rowBottom + 6;
    }
  }

  // Facts grid, two columns
  if (dto.facts.length > 0) {
    const colW = (width - 12) / 2;
    for (let i = 0; i < dto.facts.length; i += 2) {
      y = ensureRoom(doc, y, 30, () => drawLetterhead(doc, lh, assets));
      let rowBottom = y;
      dto.facts.slice(i, i + 2).forEach((f, idx) => {
        const x = left + idx * (colW + 12);
        drawLine(doc, f.label, x, y, { size: 7.5, color: GREY });
        const vy = drawParagraph(doc, f.value || '-', x, y + lineHeight(7.5), colW, {
          size: 9.5,
          color: INK,
        });
        rowBottom = Math.max(rowBottom, vy);
      });
      y = rowBottom + 3;
    }
    y += 4;
  }

  // Lines table
  if (dto.lines && dto.lines.columns.length > 0) {
    const cols = dto.lines.columns;
    const numeric = (c: (typeof cols)[number]): boolean =>
      c.align === 'right' || c.format === 'money' || c.format === 'number';
    const fixed = cols.filter(numeric).length * 62;
    const flexCount = Math.max(cols.filter((c) => !numeric(c)).length, 1);
    const flexW = Math.max((width - fixed) / flexCount, 50);
    const widths = cols.map((c) => (numeric(c) ? 62 : flexW));
    const scale = width / widths.reduce((a, b) => a + b, 0);
    const colWidths = widths.map((w) => w * scale);
    const head = (): number => {
      let hy = y;
      doc
        .save()
        .rect(left, hy - 3, width, 18)
        .fill(lh.primaryColor)
        .restore();
      let x = left;
      cols.forEach((c, i) => {
        const w = colWidths[i] ?? 60;
        drawLine(doc, c.label, x + 3, hy + 1, {
          size: 8.5,
          bold: true,
          color: '#ffffff',
          align: numeric(c) ? 'right' : 'left',
          width: w - 6,
        });
        x += w;
      });
      hy += 20;
      return hy;
    };
    y = head();
    dto.lines.rows.forEach((r, ri) => {
      const cells = cols.map((c, i) => {
        const w = (colWidths[i] ?? 60) - 6;
        return wrapText(doc, formatCell(r[c.key], c.format), w, { size: 8.5 });
      });
      const h = Math.max(...cells.map((l) => l.length)) * lineHeight(8.5) + 4;
      if (y + h > bottomLimit(doc)) {
        doc.addPage();
        y = drawLetterhead(doc, lh, assets);
        y = head();
      }
      if (ri % 2 === 1)
        doc
          .save()
          .rect(left, y - 2, width, h)
          .fill('#f3f4f6')
          .restore();
      let x = left;
      cols.forEach((c, i) => {
        const w = colWidths[i] ?? 60;
        (cells[i] ?? []).forEach((line, li) => {
          drawLine(doc, line, x + 3, y + li * lineHeight(8.5), {
            size: 8.5,
            color: INK,
            align: numeric(c) ? 'right' : 'left',
            width: w - 6,
          });
        });
        x += w;
      });
      y += h;
    });
    doc
      .save()
      .moveTo(left, y)
      .lineTo(left + width, y)
      .lineWidth(0.5)
      .strokeColor('#999999')
      .stroke()
      .restore();
    y += 8;
  }

  // Totals
  for (const t of dto.totals) {
    y = ensureRoom(doc, y, 18, () => drawLetterhead(doc, lh, assets));
    const style = { size: t.bold ? 10.5 : 9.5, bold: t.bold === true, color: INK };
    drawLine(doc, t.label, left, y, { ...style, align: 'right', width: width - 110 });
    drawLine(doc, t.value, left, y, { ...style, align: 'right', width });
    y += lineHeight(style.size);
  }
  if (dto.amountInWords) {
    y = ensureRoom(doc, y, 30, () => drawLetterhead(doc, lh, assets));
    y = drawParagraph(doc, `Amount in words: ${dto.amountInWords}`, left, y + 4, width, {
      size: 9,
      bold: true,
      color: INK,
    });
  }

  // Sections and notes
  for (const s of dto.sections) {
    y = ensureRoom(doc, y, 40, () => drawLetterhead(doc, lh, assets));
    drawLine(doc, s.title, left, y + 6, { size: 10, bold: true, color: lh.primaryColor });
    y += 6 + lineHeight(10);
    for (const r of s.rows ?? []) {
      y = ensureRoom(doc, y, 14, () => drawLetterhead(doc, lh, assets));
      drawLine(doc, r.label, left, y, { size: 8.5, color: GREY });
      y = drawParagraph(doc, r.value, left + 140, y, width - 140, { size: 9, color: INK });
    }
    if (s.text) y = drawParagraph(doc, s.text, left, y, width, { size: 9, color: INK });
  }
  if (dto.notes) {
    y = ensureRoom(doc, y, 30, () => drawLetterhead(doc, lh, assets));
    y = drawParagraph(doc, `Notes: ${dto.notes}`, left, y + 6, width, { size: 8.5, color: GREY });
  }

  // Signatures
  if (dto.signatures.length > 0) {
    y = ensureRoom(doc, Math.max(y + 30, y), 70, () => drawLetterhead(doc, lh, assets));
    y += 44;
    const slot = width / dto.signatures.length;
    dto.signatures.forEach((s, i) => {
      const x = left + i * slot;
      doc
        .save()
        .moveTo(x + 6, y)
        .lineTo(x + slot - 18, y)
        .lineWidth(0.5)
        .strokeColor('#555555')
        .stroke()
        .restore();
      drawLine(doc, s.label, x + 6, y + 3, { size: 8.5, bold: true, color: INK });
      if (s.name) drawLine(doc, s.name, x + 6, y + 3 + lineHeight(8.5), { size: 8, color: GREY });
    });
  }

  if (lh.footer) {
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i += 1) {
      doc.switchToPage(i);
      const margins = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      drawLine(doc, lh.footer, left, doc.page.height - 28, { size: 8, color: GREY });
      doc.page.margins.bottom = margins;
    }
  }
  addPageNumbers(doc);
  return finishPdf(doc);
}

export interface TablePdfInput {
  title: string;
  subtitle?: string;
  columns: { key: string; label: string; align?: 'left' | 'right' }[];
  rows: Record<string, string>[];
}

/** A register / list as a landscape table, repeating the header on each page. */
export async function renderTablePdf(
  input: TablePdfInput,
  lh: PdfLetterhead,
  assets: PdfAssets = {},
): Promise<Buffer> {
  const doc = newPdf({ title: input.title, landscape: true });
  const left = doc.page.margins.left;
  const width = pageWidth(doc);
  const top = (): number => {
    let y = drawLetterhead(doc, lh, assets);
    drawLine(doc, input.title, left, y, { size: 12, bold: true, color: INK });
    y += lineHeight(12);
    if (input.subtitle) {
      drawLine(doc, input.subtitle, left, y, { size: 8.5, color: GREY });
      y += lineHeight(8.5);
    }
    return y + 4;
  };
  const colW = width / Math.max(input.columns.length, 1);
  const head = (y: number): number => {
    doc
      .save()
      .rect(left, y - 3, width, 18)
      .fill(lh.primaryColor)
      .restore();
    input.columns.forEach((c, i) => {
      drawLine(doc, c.label, left + i * colW + 3, y + 1, {
        size: 8,
        bold: true,
        color: '#ffffff',
        align: c.align ?? 'left',
        width: colW - 6,
      });
    });
    return y + 20;
  };
  let y = head(top());
  input.rows.forEach((row, ri) => {
    const cells = input.columns.map((c) =>
      wrapText(doc, row[c.key] ?? '', colW - 6, { size: 8 }).slice(0, 3),
    );
    const h = Math.max(...cells.map((l) => l.length), 1) * lineHeight(8) + 3;
    if (y + h > bottomLimit(doc)) {
      doc.addPage();
      y = head(top());
    }
    if (ri % 2 === 1)
      doc
        .save()
        .rect(left, y - 2, width, h)
        .fill('#f3f4f6')
        .restore();
    input.columns.forEach((c, i) => {
      (cells[i] ?? []).forEach((line, li) => {
        drawLine(doc, line, left + i * colW + 3, y + li * lineHeight(8), {
          size: 8,
          color: INK,
          align: c.align ?? 'left',
          width: colW - 6,
        });
      });
    });
    y += h;
  });
  if (input.rows.length === 0) {
    drawLine(doc, 'No records match the filters.', left, y, { size: 9, color: GREY });
  }
  addPageNumbers(doc);
  return finishPdf(doc);
}
