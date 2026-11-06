// Reads an uploaded .xlsx / .csv into plain rows of strings or numbers (docs/phases/PHASE-04.md §8.3).
// Limits are enforced here: 5,000 data rows, 60 columns. Dates become ISO yyyy-mm-dd text.
import ExcelJS from 'exceljs';
import { Errors } from '../../core/http/errors';

export const IMPORT_MAX_ROWS = 5_000;
export const IMPORT_MAX_COLUMNS = 60;
export const IMPORT_MAX_BYTES = 5 * 1024 * 1024;

export type Cell = string | number | boolean | null;

export interface ParsedSheet {
  headers: string[];
  rows: Cell[][];
}

/** RFC 4180 reader (quotes, doubled quotes, CRLF / LF, embedded newlines), BOM stripped. */
export function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

function normalizeCell(value: ExcelJS.CellValue): Cell {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if ('result' in value) return normalizeCell(value.result as ExcelJS.CellValue);
    if ('richText' in value) return value.richText.map((t) => t.text).join('');
    if ('text' in value) return String(value.text);
    return null;
  }
  return value;
}

function finish(matrix: Cell[][]): ParsedSheet {
  const [head, ...body] = matrix;
  if (!head || head.every((c) => c === null || String(c).trim() === '')) {
    throw Errors.importInvalid('The file is empty. The first row must hold the column headings.');
  }
  const headers = head.map((c) => String(c ?? '').trim());
  if (headers.length > IMPORT_MAX_COLUMNS) {
    throw Errors.importInvalid(`The file has more than ${IMPORT_MAX_COLUMNS} columns.`);
  }
  const rows = body.filter((r) => r.some((c) => c !== null && String(c).trim() !== ''));
  if (rows.length === 0) throw Errors.importInvalid('The file has headings but no data rows.');
  if (rows.length > IMPORT_MAX_ROWS) {
    throw Errors.importInvalid(`The file has more than ${IMPORT_MAX_ROWS} data rows. Split it.`);
  }
  return { headers, rows };
}

export async function parseSheet(buffer: Buffer, kind: 'xlsx' | 'csv'): Promise<ParsedSheet> {
  if (kind === 'csv') {
    return finish(parseCsv(buffer.toString('utf8')).map((r) => r.map((c): Cell => c)));
  }
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  } catch {
    throw Errors.importInvalid('The file is not a valid Excel workbook.');
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) throw Errors.importInvalid('The workbook has no sheet.');
  const matrix: Cell[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const cells: Cell[] = [];
    const count = Math.min(row.cellCount, IMPORT_MAX_COLUMNS + 1);
    for (let c = 1; c <= count; c += 1) cells.push(normalizeCell(row.getCell(c).value));
    matrix.push(cells);
  });
  return finish(matrix);
}
